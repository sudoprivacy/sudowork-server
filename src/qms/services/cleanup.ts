/**
 * Data cleanup service
 * TimescaleDB handles most cleanup via retention policies
 * Sessions are now stored in Redis with TTL, no DB cleanup needed
 */

import { db } from "../db/index.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";

class CleanupService {
  /**
   * Check if TimescaleDB is available
   */
  private async isTimescaleDBAvailable(): Promise<boolean> {
    try {
      const result = await db`
        SELECT EXISTS (
          SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'
        ) as available
      `;
      return result[0]?.available ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Run cleanup tasks
   * TimescaleDB retention policies handle most data cleanup automatically
   * Sessions are stored in Redis with TTL, no cleanup needed here
   */
  async runCleanup(): Promise<void> {
    logger.info("[Cleanup] Running cleanup tasks...");

    const timescaleAvailable = await this.isTimescaleDBAvailable();

    if (!timescaleAvailable) {
      // Manual cleanup for non-TimescaleDB
      await this.cleanupPerfData();
      await this.cleanupConversationData();
      await this.cleanupInstallData();
    }

    logger.info("[Cleanup] Cleanup completed");
  }

  /**
   * Clean up old performance raw data (manual, for non-TimescaleDB)
   */
  private async cleanupPerfData(): Promise<number> {
    const retentionDays = config.telemetry.dataRetentionDays.perf;
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    logger.info(`[Cleanup] Cleaning perf data older than ${retentionDays} days...`);

    const result = await db`
      DELETE FROM telemetry_perf_raw WHERE created_at < ${cutoffDate}
    `;

    logger.info(`[Cleanup] Perf: ${result.count} records deleted`);
    return result.count;
  }

  /**
   * Clean up old conversation raw data (manual, for non-TimescaleDB)
   */
  private async cleanupConversationData(): Promise<number> {
    const retentionDays = config.telemetry.dataRetentionDays.conversations;
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    logger.info(`[Cleanup] Cleaning conversation data older than ${retentionDays} days...`);

    const result = await db`
      DELETE FROM telemetry_conversations WHERE created_at < ${cutoffDate}
    `;

    logger.info(`[Cleanup] Conversations: ${result.count} records deleted`);
    return result.count;
  }

  /**
   * Clean up old install raw data (manual, for non-TimescaleDB)
   */
  private async cleanupInstallData(): Promise<number> {
    const retentionDays = config.telemetry.dataRetentionDays.perf;
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    logger.info(`[Cleanup] Cleaning install data older than ${retentionDays} days...`);

    const result = await db`
      DELETE FROM telemetry_install WHERE created_at < ${cutoffDate}
    `;

    logger.info(`[Cleanup] Installs: ${result.count} records deleted`);
    return result.count;
  }
}

export const cleanupService = new CleanupService();
export default cleanupService;
