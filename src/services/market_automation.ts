// src/services/market_automation.ts - Automated market resolution system
import { marketResolver } from "./market_resolver.js";
import { marketConfig } from "./market_config.js";

export class MarketAutomationService {
  private resolutionInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start the automated market resolution system
   */
  start(): void {
    if (this.isRunning) {
      console.log("⚠️ Market automation already running");
      return;
    }

    const config = marketConfig.getConfig();

    if (!config.settings.autoResolveEnabled) {
      console.log("📊 Market auto-resolution disabled in config");
      return;
    }

    const intervalMs = config.settings.autoResolveInterval;

    console.log(`🚀 Starting market automation (checking every ${intervalMs / 1000}s)`);

    this.isRunning = true;

    // Run initial resolution check
    this.resolveExpiredMarkets().catch(error => {
      console.error("Error in initial market resolution:", error);
    });

    // Set up recurring resolution checks
    this.resolutionInterval = setInterval(() => {
      this.resolveExpiredMarkets().catch(error => {
        console.error("Error in automated market resolution:", error);
      });
    }, intervalMs);
  }

  /**
   * Stop the automated market resolution system
   */
  stop(): void {
    if (!this.isRunning) {
      console.log("⚠️ Market automation not running");
      return;
    }

    console.log("🛑 Stopping market automation");

    if (this.resolutionInterval) {
      clearInterval(this.resolutionInterval);
      this.resolutionInterval = null;
    }

    this.isRunning = false;
  }

  /**
   * Check and resolve expired markets
   */
  private async resolveExpiredMarkets(): Promise<void> {
    try {
      console.log("🔍 Checking for expired markets...");

      const result = await marketResolver.resolveExpiredMarkets();

      if (result.resolved > 0 || result.errors > 0) {
        console.log(`📊 Market resolution complete: ${result.resolved} resolved, ${result.errors} errors`);
      } else {
        console.log("✅ No expired markets found");
      }

    } catch (error) {
      console.error("❌ Error in automated market resolution:", error);
    }
  }

  /**
   * Force resolution of all expired markets (manual trigger)
   */
  async forceResolveExpiredMarkets(): Promise<{ resolved: number; errors: number }> {
    console.log("🔧 Manually triggering market resolution...");
    return await marketResolver.resolveExpiredMarkets();
  }

  /**
   * Get automation status
   */
  getStatus(): { running: boolean; intervalMs: number | null } {
    const config = marketConfig.getConfig();
    return {
      running: this.isRunning,
      intervalMs: this.isRunning ? config.settings.autoResolveInterval : null
    };
  }

  /**
   * Restart automation with new settings
   */
  restart(): void {
    console.log("🔄 Restarting market automation...");
    this.stop();
    // Small delay to ensure cleanup
    setTimeout(() => {
      this.start();
    }, 1000);
  }
}

// Export singleton instance
export const marketAutomation = new MarketAutomationService();