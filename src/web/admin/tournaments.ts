// src/web/admin/tournaments.ts
import { Router, Request, Response } from "express";
import { prisma } from "../../services/db.js";
import {
  getTournamentConfig,
  setTournamentConfig,
  distributeTournamentPrizes,
  calculateDynamicPrizePool,
  displayTournamentPrizePool,
  getTournamentLeaderboard,
  TournamentConfig
} from "../../services/tournaments.js";

export const tournamentsRouter = Router();

// Get all tournaments
tournamentsRouter.get("/tournaments", async (_req: Request, res: Response) => {
  try {
    const tournaments = await prisma.appConfig.findMany({
      where: {
        key: {
          startsWith: "tournament_"
        },
        NOT: {
          key: {
            endsWith: "_results"
          }
        }
      },
      orderBy: { updatedAt: "desc" }
    });

    const formattedTournaments = tournaments.map(tournament => {
      const config = JSON.parse(tournament.value as string) as TournamentConfig;
      return {
        id: config.id,
        name: config.name,
        description: config.description,
        status: config.status,
        type: config.type,
        maxParticipants: config.maxParticipants,
        prizeTokens: config.prizeTokens,
        createdAt: tournament.createdAt,
        updatedAt: tournament.updatedAt
      };
    });

    res.json({ ok: true, tournaments: formattedTournaments });
  } catch (error) {
    console.error("Failed to fetch tournaments:", error);
    res.status(500).json({ ok: false, error: "Failed to fetch tournaments" });
  }
});

// Get specific tournament details
tournamentsRouter.get("/tournaments/:id", async (req: Request, res: Response) => {
  try {
    const tournamentId = req.params.id;
    const config = await getTournamentConfig(tournamentId);

    if (!config) {
      return res.status(404).json({ ok: false, error: "Tournament not found" });
    }

    // Get prize pool display
    const prizeDisplay = await displayTournamentPrizePool(tournamentId);

    // Get current leaderboard
    const leaderboard = await getTournamentLeaderboard(tournamentId, 20);

    // Get results if tournament is completed
    let results = null;
    try {
      const resultsConfig = await prisma.appConfig.findUnique({
        where: { key: `tournament_${tournamentId}_results` }
      });
      if (resultsConfig) {
        results = JSON.parse(resultsConfig.value as string);
      }
    } catch (e) {
      // Results don't exist yet
    }

    res.json({
      ok: true,
      tournament: config,
      prizeDisplay,
      leaderboard,
      results
    });

  } catch (error) {
    console.error("Failed to fetch tournament details:", error);
    res.status(500).json({ ok: false, error: "Failed to fetch tournament details" });
  }
});

// Create tournament
tournamentsRouter.post("/tournaments", async (req: Request, res: Response) => {
  try {
    const {
      id,
      name,
      description,
      type = 'LEADERBOARD',
      entryFeeUSD,
      maxParticipants,
      prizeTokens,
      prizeDistribution,
      registrationStart,
      registrationEnd,
      tournamentStart,
      tournamentEnd
    } = req.body;

    if (!id || !name || !prizeTokens || !prizeDistribution) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields: id, name, prizeTokens, prizeDistribution"
      });
    }

    // Validate prize tokens exist
    for (const prizeToken of prizeTokens) {
      const token = await prisma.token.findUnique({
        where: { id: Number(prizeToken.tokenId) }
      });
      if (!token) {
        return res.status(400).json({
          ok: false,
          error: `Token with ID ${prizeToken.tokenId} not found`
        });
      }
      prizeToken.tokenSymbol = token.symbol;
    }

    // Validate prize distribution percentages sum to 100
    const totalPercentage = Object.values(prizeDistribution).reduce((sum: number, pct: number) => sum + pct, 0);
    if (Math.abs(totalPercentage - 100) > 0.01) {
      return res.status(400).json({
        ok: false,
        error: `Prize distribution percentages must sum to 100% (currently ${totalPercentage}%)`
      });
    }

    const tournamentConfig: TournamentConfig = {
      id,
      name,
      description: description || '',
      status: 'SETUP',
      type,
      entryFeeUSD,
      maxParticipants,
      prizeTokens,
      prizeDistribution,
      registrationStart: registrationStart ? new Date(registrationStart) : undefined,
      registrationEnd: registrationEnd ? new Date(registrationEnd) : undefined,
      tournamentStart: tournamentStart ? new Date(tournamentStart) : undefined,
      tournamentEnd: tournamentEnd ? new Date(tournamentEnd) : undefined,
      createdBy: 'admin', // TODO: Get from authenticated user
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const success = await setTournamentConfig(tournamentConfig);
    if (!success) {
      return res.status(500).json({
        ok: false,
        error: "Failed to save tournament configuration"
      });
    }

    res.json({
      ok: true,
      tournament: tournamentConfig,
      message: "Tournament created successfully"
    });

  } catch (error) {
    console.error("Failed to create tournament:", error);
    res.status(500).json({ ok: false, error: "Failed to create tournament" });
  }
});

// Update tournament
tournamentsRouter.put("/tournaments/:id", async (req: Request, res: Response) => {
  try {
    const tournamentId = req.params.id;
    const existingConfig = await getTournamentConfig(tournamentId);

    if (!existingConfig) {
      return res.status(404).json({ ok: false, error: "Tournament not found" });
    }

    // Prevent modifications of completed tournaments
    if (existingConfig.status === 'COMPLETED') {
      return res.status(400).json({
        ok: false,
        error: "Cannot modify completed tournaments"
      });
    }

    const updatedConfig: TournamentConfig = {
      ...existingConfig,
      ...req.body,
      id: tournamentId, // Ensure ID doesn't change
      updatedAt: new Date()
    };

    // Validate prize tokens if updated
    if (req.body.prizeTokens) {
      for (const prizeToken of updatedConfig.prizeTokens) {
        const token = await prisma.token.findUnique({
          where: { id: Number(prizeToken.tokenId) }
        });
        if (!token) {
          return res.status(400).json({
            ok: false,
            error: `Token with ID ${prizeToken.tokenId} not found`
          });
        }
        prizeToken.tokenSymbol = token.symbol;
      }
    }

    // Validate prize distribution if updated
    if (req.body.prizeDistribution) {
      const totalPercentage = Object.values(updatedConfig.prizeDistribution).reduce((sum: number, pct: number) => sum + pct, 0);
      if (Math.abs(totalPercentage - 100) > 0.01) {
        return res.status(400).json({
          ok: false,
          error: `Prize distribution percentages must sum to 100% (currently ${totalPercentage}%)`
        });
      }
    }

    const success = await setTournamentConfig(updatedConfig);
    if (!success) {
      return res.status(500).json({
        ok: false,
        error: "Failed to update tournament configuration"
      });
    }

    res.json({
      ok: true,
      tournament: updatedConfig,
      message: "Tournament updated successfully"
    });

  } catch (error) {
    console.error("Failed to update tournament:", error);
    res.status(500).json({ ok: false, error: "Failed to update tournament" });
  }
});

// Distribute tournament prizes
tournamentsRouter.post("/tournaments/:id/distribute-prizes", async (req: Request, res: Response) => {
  try {
    const tournamentId = req.params.id;
    const config = await getTournamentConfig(tournamentId);

    if (!config) {
      return res.status(404).json({ ok: false, error: "Tournament not found" });
    }

    if (config.status !== 'COMPLETED' && config.status !== 'ACTIVE') {
      return res.status(400).json({
        ok: false,
        error: "Tournament must be active or completed to distribute prizes"
      });
    }

    // Get final leaderboard
    const leaderboard = await getTournamentLeaderboard(tournamentId, 50);

    if (leaderboard.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No participants found for prize distribution"
      });
    }

    // Distribute prizes
    const result = await distributeTournamentPrizes(tournamentId, leaderboard);

    // Update tournament status to completed
    if (result.success) {
      const updatedConfig = { ...config, status: 'COMPLETED' as const, updatedAt: new Date() };
      await setTournamentConfig(updatedConfig);
    }

    res.json({
      ok: result.success,
      distributed: result.distributed,
      errors: result.errors,
      message: result.success
        ? `Successfully distributed prizes to ${result.distributed} winners`
        : `Prize distribution completed with ${result.errors.length} errors`
    });

  } catch (error) {
    console.error("Failed to distribute tournament prizes:", error);
    res.status(500).json({ ok: false, error: "Failed to distribute tournament prizes" });
  }
});

// Get tournament prize pool breakdown
tournamentsRouter.get("/tournaments/:id/prize-pool", async (req: Request, res: Response) => {
  try {
    const tournamentId = req.params.id;
    const prizeDisplay = await displayTournamentPrizePool(tournamentId);

    if (!prizeDisplay) {
      return res.status(404).json({ ok: false, error: "Tournament not found" });
    }

    // Also calculate dynamic prize pool if applicable
    const dynamicPool = await calculateDynamicPrizePool(tournamentId);

    res.json({
      ok: true,
      fixedPrizes: prizeDisplay,
      dynamicPool,
      combinedPool: Object.keys(dynamicPool).length > 0
    });

  } catch (error) {
    console.error("Failed to get tournament prize pool:", error);
    res.status(500).json({ ok: false, error: "Failed to get tournament prize pool" });
  }
});

// Start tournament
tournamentsRouter.post("/tournaments/:id/start", async (req: Request, res: Response) => {
  try {
    const tournamentId = req.params.id;
    const config = await getTournamentConfig(tournamentId);

    if (!config) {
      return res.status(404).json({ ok: false, error: "Tournament not found" });
    }

    if (config.status !== 'SETUP' && config.status !== 'REGISTRATION') {
      return res.status(400).json({
        ok: false,
        error: `Cannot start tournament with status: ${config.status}`
      });
    }

    const updatedConfig = {
      ...config,
      status: 'ACTIVE' as const,
      tournamentStart: new Date(),
      updatedAt: new Date()
    };

    const success = await setTournamentConfig(updatedConfig);
    if (!success) {
      return res.status(500).json({
        ok: false,
        error: "Failed to start tournament"
      });
    }

    res.json({
      ok: true,
      tournament: updatedConfig,
      message: "Tournament started successfully"
    });

  } catch (error) {
    console.error("Failed to start tournament:", error);
    res.status(500).json({ ok: false, error: "Failed to start tournament" });
  }
});

// Complete tournament
tournamentsRouter.post("/tournaments/:id/complete", async (req: Request, res: Response) => {
  try {
    const tournamentId = req.params.id;
    const config = await getTournamentConfig(tournamentId);

    if (!config) {
      return res.status(404).json({ ok: false, error: "Tournament not found" });
    }

    if (config.status !== 'ACTIVE') {
      return res.status(400).json({
        ok: false,
        error: `Cannot complete tournament with status: ${config.status}`
      });
    }

    const updatedConfig = {
      ...config,
      status: 'COMPLETED' as const,
      tournamentEnd: new Date(),
      updatedAt: new Date()
    };

    const success = await setTournamentConfig(updatedConfig);
    if (!success) {
      return res.status(500).json({
        ok: false,
        error: "Failed to complete tournament"
      });
    }

    res.json({
      ok: true,
      tournament: updatedConfig,
      message: "Tournament completed successfully. You can now distribute prizes."
    });

  } catch (error) {
    console.error("Failed to complete tournament:", error);
    res.status(500).json({ ok: false, error: "Failed to complete tournament" });
  }
});