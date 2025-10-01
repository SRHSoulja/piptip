import { Router } from "express";
import { prisma } from "../../services/db.js";
import {
  getTournamentConfig,
  setTournamentConfig,
  distributeTournamentPrizes,
  calculateDynamicPrizePool,
  displayTournamentPrizePool,
  getTournamentLeaderboard
} from "../../services/tournaments.js";
const tournamentsRouter = Router();
tournamentsRouter.get("/tournaments", async (_req, res) => {
  try {
    const tournaments = await prisma.tournamentSession.findMany({
      orderBy: { startTime: "desc" }
    });
    const formattedTournaments = tournaments.map((tournament) => ({
      id: tournament.id,
      name: tournament.name,
      description: tournament.description || "No description",
      status: tournament.status,
      type: "PREDICTION",
      maxParticipants: tournament.maxPlayers,
      prizeTokens: tournament.prizeTokens,
      createdAt: tournament.createdAt,
      updatedAt: tournament.startTime
    }));
    res.json({ ok: true, tournaments: formattedTournaments });
  } catch (error) {
    console.error("Failed to fetch tournaments:", error);
    res.status(500).json({ ok: false, error: "Failed to fetch tournaments" });
  }
});
tournamentsRouter.get("/tournaments/:id", async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const config = await getTournamentConfig(tournamentId);
    if (!config) {
      return res.status(404).json({ ok: false, error: "Tournament not found" });
    }
    const prizeDisplay = await displayTournamentPrizePool(tournamentId);
    const leaderboard = await getTournamentLeaderboard(tournamentId, 20);
    let results = null;
    try {
      results = null;
    } catch (e) {
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
tournamentsRouter.post("/tournaments", async (req, res) => {
  try {
    const {
      id,
      name,
      description,
      type = "LEADERBOARD",
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
    const totalPercentage = Object.values(prizeDistribution).reduce((sum, pct) => sum + pct, 0);
    if (Math.abs(totalPercentage - 100) > 0.01) {
      return res.status(400).json({
        ok: false,
        error: `Prize distribution percentages must sum to 100% (currently ${totalPercentage}%)`
      });
    }
    const tournamentConfig = {
      id,
      name,
      description: description || "",
      status: "SETUP",
      type,
      entryFeeUSD,
      maxParticipants,
      prizeTokens,
      prizeDistribution,
      registrationStart: registrationStart ? new Date(registrationStart) : void 0,
      registrationEnd: registrationEnd ? new Date(registrationEnd) : void 0,
      tournamentStart: tournamentStart ? new Date(tournamentStart) : void 0,
      tournamentEnd: tournamentEnd ? new Date(tournamentEnd) : void 0,
      createdBy: "admin",
      // TODO: Get from authenticated user
      createdAt: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date()
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
tournamentsRouter.put("/tournaments/:id", async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const existingConfig = await getTournamentConfig(tournamentId);
    if (!existingConfig) {
      return res.status(404).json({ ok: false, error: "Tournament not found" });
    }
    if (existingConfig.status === "COMPLETED") {
      return res.status(400).json({
        ok: false,
        error: "Cannot modify completed tournaments"
      });
    }
    const updatedConfig = {
      ...existingConfig,
      ...req.body,
      id: tournamentId,
      // Ensure ID doesn't change
      updatedAt: /* @__PURE__ */ new Date()
    };
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
    if (req.body.prizeDistribution) {
      const totalPercentage = Object.values(updatedConfig.prizeDistribution).reduce((sum, pct) => sum + pct, 0);
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
tournamentsRouter.post("/tournaments/:id/distribute-prizes", async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const config = await getTournamentConfig(tournamentId);
    if (!config) {
      return res.status(404).json({ ok: false, error: "Tournament not found" });
    }
    if (config.status !== "COMPLETED" && config.status !== "ACTIVE") {
      return res.status(400).json({
        ok: false,
        error: "Tournament must be active or completed to distribute prizes"
      });
    }
    const leaderboard = await getTournamentLeaderboard(tournamentId, 50);
    if (leaderboard.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No participants found for prize distribution"
      });
    }
    const result = await distributeTournamentPrizes(tournamentId, leaderboard);
    if (result.success) {
      const updatedConfig = { ...config, status: "COMPLETED", updatedAt: /* @__PURE__ */ new Date() };
      await setTournamentConfig(updatedConfig);
    }
    res.json({
      ok: result.success,
      distributed: result.distributed,
      errors: result.errors,
      message: result.success ? `Successfully distributed prizes to ${result.distributed} winners` : `Prize distribution completed with ${result.errors.length} errors`
    });
  } catch (error) {
    console.error("Failed to distribute tournament prizes:", error);
    res.status(500).json({ ok: false, error: "Failed to distribute tournament prizes" });
  }
});
tournamentsRouter.get("/tournaments/:id/prize-pool", async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const prizeDisplay = await displayTournamentPrizePool(tournamentId);
    if (!prizeDisplay) {
      return res.status(404).json({ ok: false, error: "Tournament not found" });
    }
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
tournamentsRouter.post("/tournaments/:id/start", async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const config = await getTournamentConfig(tournamentId);
    if (!config) {
      return res.status(404).json({ ok: false, error: "Tournament not found" });
    }
    if (config.status !== "SETUP" && config.status !== "REGISTRATION") {
      return res.status(400).json({
        ok: false,
        error: `Cannot start tournament with status: ${config.status}`
      });
    }
    const updatedConfig = {
      ...config,
      status: "ACTIVE",
      tournamentStart: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date()
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
tournamentsRouter.post("/tournaments/:id/complete", async (req, res) => {
  try {
    const tournamentId = req.params.id;
    const config = await getTournamentConfig(tournamentId);
    if (!config) {
      return res.status(404).json({ ok: false, error: "Tournament not found" });
    }
    if (config.status !== "ACTIVE") {
      return res.status(400).json({
        ok: false,
        error: `Cannot complete tournament with status: ${config.status}`
      });
    }
    const updatedConfig = {
      ...config,
      status: "COMPLETED",
      tournamentEnd: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date()
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
export {
  tournamentsRouter
};
//# sourceMappingURL=tournaments.js.map
