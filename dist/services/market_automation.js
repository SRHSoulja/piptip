import { marketResolver } from "./market_resolver.js";
import { marketConfig } from "./market_config.js";
class MarketAutomationService {
  resolutionInterval = null;
  isRunning = false;
  /**
   * Start the automated market resolution system
   */
  start() {
    if (this.isRunning) {
      console.log("\u26A0\uFE0F Market automation already running");
      return;
    }
    const config = marketConfig.getConfig();
    if (!config.settings.autoResolveEnabled) {
      console.log("\u{1F4CA} Market auto-resolution disabled in config");
      return;
    }
    const intervalMs = config.settings.autoResolveInterval;
    console.log(`\u{1F680} Starting market automation (checking every ${intervalMs / 1e3}s)`);
    this.isRunning = true;
    this.resolveExpiredMarkets().catch((error) => {
      console.error("Error in initial market resolution:", error);
    });
    this.resolutionInterval = setInterval(() => {
      this.resolveExpiredMarkets().catch((error) => {
        console.error("Error in automated market resolution:", error);
      });
    }, intervalMs);
  }
  /**
   * Stop the automated market resolution system
   */
  stop() {
    if (!this.isRunning) {
      console.log("\u26A0\uFE0F Market automation not running");
      return;
    }
    console.log("\u{1F6D1} Stopping market automation");
    if (this.resolutionInterval) {
      clearInterval(this.resolutionInterval);
      this.resolutionInterval = null;
    }
    this.isRunning = false;
  }
  /**
   * Check and resolve expired markets
   */
  async resolveExpiredMarkets() {
    try {
      console.log("\u{1F50D} Checking for expired markets...");
      const result = await marketResolver.resolveExpiredMarkets();
      if (result.resolved > 0 || result.errors > 0) {
        console.log(`\u{1F4CA} Market resolution complete: ${result.resolved} resolved, ${result.errors} errors`);
      } else {
        console.log("\u2705 No expired markets found");
      }
    } catch (error) {
      console.error("\u274C Error in automated market resolution:", error);
    }
  }
  /**
   * Force resolution of all expired markets (manual trigger)
   */
  async forceResolveExpiredMarkets() {
    console.log("\u{1F527} Manually triggering market resolution...");
    return await marketResolver.resolveExpiredMarkets();
  }
  /**
   * Get automation status
   */
  getStatus() {
    const config = marketConfig.getConfig();
    return {
      running: this.isRunning,
      intervalMs: this.isRunning ? config.settings.autoResolveInterval : null
    };
  }
  /**
   * Restart automation with new settings
   */
  restart() {
    console.log("\u{1F504} Restarting market automation...");
    this.stop();
    setTimeout(() => {
      this.start();
    }, 1e3);
  }
}
const marketAutomation = new MarketAutomationService();
export {
  MarketAutomationService,
  marketAutomation
};
//# sourceMappingURL=market_automation.js.map
