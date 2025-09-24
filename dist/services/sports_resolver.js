// src/services/sports_resolver.ts - Sports betting resolution with TheSportsDB API
/**
 * Handles sports betting resolution using TheSportsDB API
 */
export class SportsResolverService {
    API_BASE = 'https://www.thesportsdb.com/api/v1/json/3';
    /**
     * Get supported leagues with their IDs
     */
    getSupportedLeagues() {
        return {
            'NFL': '4391',
            'NBA': '4387',
            'Premier League': '4328',
            'MLB': '4424',
            'Champions League': '4480',
            'La Liga': '4335',
            'Serie A': '4332',
            'Bundesliga': '4331'
        };
    }
    /**
     * Fetch upcoming games for a league in the next 7 days
     */
    async fetchUpcomingGames(league) {
        try {
            const leagues = this.getSupportedLeagues();
            const leagueId = leagues[league];
            if (!leagueId) {
                return {
                    success: false,
                    error: `Unsupported league: ${league}. Supported: ${Object.keys(leagues).join(', ')}`
                };
            }
            const url = `${this.API_BASE}/eventsnextleague.php?id=${leagueId}`;
            console.log(`Fetching upcoming games for ${league}...`);
            const response = await fetch(url);
            if (!response.ok) {
                return {
                    success: false,
                    error: `TheSportsDB API error: ${response.status}`
                };
            }
            const data = await response.json();
            if (!data.events || data.events.length === 0) {
                return {
                    success: false,
                    error: `No upcoming games found for ${league}`
                };
            }
            // Filter games in next 7 days
            const now = new Date();
            const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
            const upcomingGames = data.events
                .filter((event) => {
                if (!event.dateEvent || !event.strTime)
                    return false;
                const gameDate = new Date(`${event.dateEvent} ${event.strTime}`);
                return gameDate > now && gameDate <= weekFromNow;
            })
                .map((event) => ({
                id: event.idEvent,
                homeTeam: event.strHomeTeam,
                awayTeam: event.strAwayTeam,
                date: event.dateEvent,
                time: event.strTime,
                league: event.strLeague,
                season: event.strSeason,
                venue: event.strVenue
            }))
                .slice(0, 10); // Limit to 10 games
            console.log(`Found ${upcomingGames.length} upcoming games for ${league}`);
            return {
                success: true,
                games: upcomingGames
            };
        }
        catch (error) {
            console.error(`Error fetching upcoming games for ${league}:`, error);
            return {
                success: false,
                error: `Failed to fetch games: ${error}`
            };
        }
    }
    /**
     * Fetch game result by event ID
     */
    async fetchGameResult(eventId) {
        try {
            const url = `${this.API_BASE}/lookupevent.php?id=${eventId}`;
            console.log(`Fetching game result for event ${eventId}...`);
            const response = await fetch(url);
            if (!response.ok) {
                return {
                    success: false,
                    error: `TheSportsDB API error: ${response.status}`
                };
            }
            const data = await response.json();
            if (!data.events || data.events.length === 0) {
                return {
                    success: false,
                    error: `Event ${eventId} not found`
                };
            }
            const event = data.events[0];
            // Check if game is finished
            if (event.strStatus !== 'Match Finished' && event.strStatus !== 'FT') {
                return {
                    success: false,
                    error: `Game not finished yet. Status: ${event.strStatus || 'Unknown'}`
                };
            }
            // Extract scores
            const homeScore = parseInt(event.intHomeScore || '0');
            const awayScore = parseInt(event.intAwayScore || '0');
            if (isNaN(homeScore) || isNaN(awayScore)) {
                return {
                    success: false,
                    error: 'Score data not available or invalid'
                };
            }
            const result = {
                eventId,
                homeTeam: event.strHomeTeam,
                awayTeam: event.strAwayTeam,
                homeScore,
                awayScore,
                totalScore: homeScore + awayScore,
                winner: homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'tie',
                scoreDifference: Math.abs(homeScore - awayScore),
                status: event.strStatus,
                date: event.dateEvent,
                league: event.strLeague
            };
            console.log(`Game result: ${result.homeTeam} ${homeScore} - ${awayScore} ${result.awayTeam} (Winner: ${result.winner})`);
            return {
                success: true,
                result
            };
        }
        catch (error) {
            console.error(`Error fetching game result for ${eventId}:`, error);
            return {
                success: false,
                error: `Failed to fetch result: ${error}`
            };
        }
    }
    /**
     * Search for a specific team's next game
     */
    async findTeamNextGame(teamName, league) {
        try {
            // First try to search by team name
            const url = `${this.API_BASE}/searchteams.php?t=${encodeURIComponent(teamName)}`;
            const response = await fetch(url);
            if (!response.ok) {
                return { success: false, error: `API error: ${response.status}` };
            }
            const data = await response.json();
            if (!data.teams || data.teams.length === 0) {
                return { success: false, error: `Team "${teamName}" not found` };
            }
            const team = data.teams[0];
            const teamId = team.idTeam;
            const teamLeague = team.strLeague;
            // Get next game for this team
            const nextGameUrl = `${this.API_BASE}/eventsnext.php?id=${teamId}`;
            const nextGameResponse = await fetch(nextGameUrl);
            if (!nextGameResponse.ok) {
                return { success: false, error: `Failed to fetch next game` };
            }
            const nextGameData = await nextGameResponse.json();
            if (!nextGameData.events || nextGameData.events.length === 0) {
                return { success: false, error: `No upcoming games for ${teamName}` };
            }
            const nextGame = nextGameData.events[0];
            return {
                success: true,
                game: {
                    id: nextGame.idEvent,
                    homeTeam: nextGame.strHomeTeam,
                    awayTeam: nextGame.strAwayTeam,
                    date: nextGame.dateEvent,
                    time: nextGame.strTime,
                    league: nextGame.strLeague || teamLeague,
                    venue: nextGame.strVenue
                }
            };
        }
        catch (error) {
            console.error(`Error finding next game for ${teamName}:`, error);
            return {
                success: false,
                error: `Search failed: ${error}`
            };
        }
    }
    /**
     * Resolve a sports market based on game result
     */
    async resolveSportsMarket(market) {
        const { marketData, marketType } = market;
        const eventId = marketData.eventId;
        if (!eventId) {
            return {
                outcome: 'CANCEL',
                data: { error: 'No event ID found for sports market' }
            };
        }
        const gameResult = await this.fetchGameResult(eventId);
        if (!gameResult.success) {
            console.error(`Failed to get game result for event ${eventId}, cancelling market ${market.id}`);
            return {
                outcome: 'CANCEL',
                data: { error: gameResult.error }
            };
        }
        const { result } = gameResult;
        if (!result) {
            return {
                outcome: 'CANCEL',
                data: { error: 'Game result is missing' }
            };
        }
        let outcome;
        switch (marketType) {
            case 'SPORTS_WINNER':
                // "Will [TEAM] beat [OPPONENT]?"
                const betTeam = marketData.betTeam;
                const isHomeTeam = result.homeTeam.toLowerCase().includes(betTeam.toLowerCase()) ||
                    betTeam.toLowerCase().includes(result.homeTeam.toLowerCase());
                if (result.winner === 'tie') {
                    outcome = 'NO'; // Ties count as NO for winner markets
                }
                else if (isHomeTeam) {
                    outcome = result.winner === 'home' ? 'YES' : 'NO';
                }
                else {
                    outcome = result.winner === 'away' ? 'YES' : 'NO';
                }
                break;
            case 'SPORTS_OVER_UNDER':
                // "Will total score be over/under [POINTS]?"
                const targetTotal = marketData.targetTotal;
                outcome = result.totalScore > targetTotal ? 'YES' : 'NO';
                break;
            case 'SPORTS_SPREAD':
                // "Will [TEAM] win by more than [POINTS]?"
                const spreadTeam = marketData.spreadTeam;
                const spreadPoints = marketData.spreadPoints;
                const isSpreadHome = result.homeTeam.toLowerCase().includes(spreadTeam.toLowerCase()) ||
                    spreadTeam.toLowerCase().includes(result.homeTeam.toLowerCase());
                let actualSpread;
                if (isSpreadHome) {
                    actualSpread = result.homeScore - result.awayScore;
                }
                else {
                    actualSpread = result.awayScore - result.homeScore;
                }
                outcome = actualSpread > spreadPoints ? 'YES' : 'NO';
                break;
            default:
                console.error(`Unknown sports market type: ${marketType}`);
                return {
                    outcome: 'CANCEL',
                    data: { error: `Unsupported market type: ${marketType}` }
                };
        }
        const resolutionData = {
            gameResult: result,
            marketType,
            marketData,
            resolvedAt: new Date().toISOString()
        };
        console.log(`Sports market ${market.id} resolved: ${outcome} (${result.homeTeam} ${result.homeScore} - ${result.awayScore} ${result.awayTeam})`);
        return { outcome: outcome, data: resolutionData };
    }
    /**
     * Parse team matchup string like "Lakers vs Celtics" or "Lakers @ Celtics"
     */
    parseTeamMatchup(teamsString) {
        const separators = [' vs ', ' v ', ' @ ', ' at ', ' VS ', ' V ', ' AT '];
        for (const sep of separators) {
            if (teamsString.includes(sep)) {
                const [team1, team2] = teamsString.split(sep).map(t => t.trim());
                return { team1, team2, success: true };
            }
        }
        return {
            success: false,
            error: 'Invalid team format. Use "Team1 vs Team2" or "Team1 @ Team2"'
        };
    }
    /**
     * Validate sports market parameters
     */
    validateSportsMarket(marketType, params) {
        switch (marketType) {
            case 'SPORTS_WINNER':
                if (!params.betTeam) {
                    return { valid: false, error: 'betTeam is required for winner markets' };
                }
                break;
            case 'SPORTS_OVER_UNDER':
                if (!params.targetTotal || isNaN(params.targetTotal)) {
                    return { valid: false, error: 'Valid targetTotal is required for over/under markets' };
                }
                break;
            case 'SPORTS_SPREAD':
                if (!params.spreadTeam || !params.spreadPoints || isNaN(params.spreadPoints)) {
                    return { valid: false, error: 'spreadTeam and valid spreadPoints are required for spread markets' };
                }
                break;
            default:
                return { valid: false, error: `Unknown sports market type: ${marketType}` };
        }
        if (!params.eventId) {
            return { valid: false, error: 'eventId is required for all sports markets' };
        }
        return { valid: true };
    }
}
// Export singleton instance
export const sportsResolver = new SportsResolverService();
