/**
 * Alert service - checks and sends alerts
 */

import { db } from "../db/index.js";
import { logger } from "../utils/logger.js";
import { notificationService } from "./notification.js";
import type { AlertConfig, AlertPayload, AlertChannel } from "../types/alert.js";

class AlertService {
  /**
   * Check alerts for a specific metric type
   */
  async checkAlerts(type: "perf" | "error" | "conversation" | "install" | "crash"): Promise<void> {
    logger.info("Checking alerts for: " + type);

    // Get enabled alert configs for this type
    const configs = await db`
      SELECT * FROM alert_config WHERE enabled = TRUE AND type = ${type}
    `;

    for (const config of configs) {
      await this.checkSingleAlert(config as AlertConfig);
    }
  }

  /**
   * Check a single alert config
   */
  private async checkSingleAlert(config: AlertConfig): Promise<void> {
    logger.info(`[${config.name}] 开始检查告警规则`);

    // Get current metric value
    const value = await this.getMetricValue(config);

    if (value === null) {
      logger.info(`[${config.name}] 无数据 - metric: ${config.metric}, 时间范围: 最近5分钟`);
      return;
    }

    logger.info(`[${config.name}] 当前值: ${Number(value).toFixed(2)}, 阈值: ${config.threshold}, 比较: ${config.comparison}`);

    // Check if threshold is exceeded
    const isTriggered = this.checkThreshold(value, config.threshold, config.comparison);

    if (!isTriggered) {
      logger.info(`[${config.name}] 未触发 - 值未超过阈值`);
      return;
    }

    // Check cooldown
    const lastAlert = await db`
      SELECT * FROM alert_history
      WHERE config_id = ${config.id} AND success = TRUE
      ORDER BY sent_at DESC LIMIT 1
    `;

    if (lastAlert.length > 0) {
      const cooldownMs = config.cooldown_minutes * 60 * 1000;
      const lastSentAt = lastAlert[0]!.sent_at as Date;
      const elapsed = Date.now() - lastSentAt.getTime();

      if (elapsed < cooldownMs) {
        const remainingMinutes = Math.ceil((cooldownMs - elapsed) / 60000);
        logger.info(`[${config.name}] 冷却期中 - 上次发送: ${lastSentAt.toISOString()}, 剩余: ${remainingMinutes}分钟`);
        return;
      }
    }

    logger.info(`[${config.name}] 告警触发! 正在发送通知...`);

    // Send alert
    await this.sendAlertNotification(config, value);
  }

  /**
   * Get current metric value from database
   */
  private async getMetricValue(config: AlertConfig): Promise<number | null> {
    const now = new Date();
    const startTime = new Date(now.getTime() - 5 * 60 * 1000); // Last 5 minutes

    switch (config.type) {
      case "perf":
        // Get average value for metric
        const perfResult = await db`
          SELECT AVG(value_ms) as avg
          FROM telemetry_perf_raw
          WHERE metric = ${config.metric} AND created_at >= ${startTime}
        `;
        // Convert BIGINT string to number
        return perfResult[0]?.avg ? Number(perfResult[0].avg) : null;

      case "error":
        // Get conversation error count or error count by error_code
        if (config.metric === "error_count") {
          const errorResult = await db`
            SELECT COUNT(*) as count
            FROM telemetry_conversations
            WHERE status = 'error' AND created_at >= ${startTime}
          `;
          return Number(errorResult[0]?.count ?? 0);
        } else if (config.metric === "error_rate") {
          const convResult = await db`
            SELECT
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
              COUNT(*) as total
            FROM telemetry_conversations
            WHERE created_at >= ${startTime}
          `;
          const errors = Number(convResult[0]?.errors ?? 0);
          const total = Number(convResult[0]?.total ?? 0);
          return total > 0 ? (errors / total) * 100 : 0;
        } else if (config.metric.startsWith("error_code:")) {
          // Count errors by specific error code, e.g., "error_code:1001"
          const errorCode = config.metric.replace("error_code:", "");
          const codeResult = await db`
            SELECT COUNT(*) as count
            FROM telemetry_conversations
            WHERE status = 'error' AND error_code = ${errorCode} AND created_at >= ${startTime}
          `;
          return Number(codeResult[0]?.count ?? 0);
        }
        return null;

      case "conversation":
        // Get relevant conversation metric
        if (config.metric === "error_rate") {
          const convResult = await db`
            SELECT
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
              COUNT(*) as total
            FROM telemetry_conversations
            WHERE created_at >= ${startTime}
          `;
          const errors = Number(convResult[0]?.errors ?? 0);
          const total = Number(convResult[0]?.total ?? 0);
          return total > 0 ? (errors / total) * 100 : 0;
        } else if (config.metric === "avg_duration") {
          const durResult = await db`
            SELECT AVG(duration_ms) as avg
            FROM telemetry_conversations
            WHERE created_at >= ${startTime}
          `;
          // Convert BIGINT string to number
          return durResult[0]?.avg ? Number(durResult[0].avg) : null;
        }
        return null;

      case "install":
        // Get install failure count or rate
        if (config.metric === "failure_count") {
          const installResult = await db`
            SELECT COUNT(*) as count
            FROM telemetry_install
            WHERE status = 'failed' AND created_at >= ${startTime}
          `;
          return Number(installResult[0]?.count ?? 0);
        }
        return null;

      case "crash":
        // Get crash event count or stats
        if (config.metric === "crash_count") {
          // Total crash events
          const crashResult = await db`
            SELECT COUNT(*) as count
            FROM crash_events
            WHERE created_at >= ${startTime}
          `;
          return Number(crashResult[0]?.count ?? 0);
        } else if (config.metric === "native_crash_count") {
          // Native crash count (renderer or main process crash)
          const nativeResult = await db`
            SELECT COUNT(*) as count
            FROM crash_events
            WHERE type IN ('native_crash', 'renderer_crash') AND created_at >= ${startTime}
          `;
          return Number(nativeResult[0]?.count ?? 0);
        } else if (config.metric === "js_exception_count") {
          // JS exception count
          const jsResult = await db`
            SELECT COUNT(*) as count
            FROM crash_events
            WHERE type = 'js_exception' AND created_at >= ${startTime}
          `;
          return Number(jsResult[0]?.count ?? 0);
        } else if (config.metric.startsWith("crash_type:")) {
          // Count by specific crash type, e.g., "crash_type:native_crash"
          const crashType = config.metric.replace("crash_type:", "");
          const typeResult = await db`
            SELECT COUNT(*) as count
            FROM crash_events
            WHERE type = ${crashType} AND created_at >= ${startTime}
          `;
          return Number(typeResult[0]?.count ?? 0);
        } else if (config.metric.startsWith("process_type:")) {
          // Count by process type, e.g., "process_type:main" or "process_type:renderer"
          const processType = config.metric.replace("process_type:", "");
          const processResult = await db`
            SELECT COUNT(*) as count
            FROM crash_events
            WHERE process_type = ${processType} AND created_at >= ${startTime}
          `;
          return Number(processResult[0]?.count ?? 0);
        }
        return null;

      default:
        return null;
    }
  }

  /**
   * Check if threshold is exceeded based on comparison operator
   */
  private checkThreshold(value: number, threshold: number, comparison: string): boolean {
    switch (comparison) {
      case "gt":
        return value > threshold;
      case "gte":
        return value >= threshold;
      case "lt":
        return value < threshold;
      case "lte":
        return value <= threshold;
      case "eq":
        return value === threshold;
      case "neq":
        return value !== threshold;
      default:
        return false;
    }
  }

  /**
   * Send alert notification
   */
  private async sendAlertNotification(config: AlertConfig, value: number): Promise<void> {
    const channels = JSON.parse(config.channels as unknown as string) as AlertChannel[];
    const now = new Date();

    const payload: AlertPayload = {
      title: `[${config.level.toUpperCase()}] ${config.name}`,
      message: `${config.metric} 当前值: ${value.toFixed(2)}, 阈值: ${config.threshold} (${config.comparison})`,
      level: config.level,
      type: config.type,
      detail: config.description,
      timestamp: now.getTime(),
    };

    const results = await notificationService.sendAlert(payload, channels);
    const success = results.every((r) => r.success);

    // Record channel results for tooltip display
    const channelResults = results.map((r) => ({
      channel: r.channel,
      success: r.success,
      error: r.error,
    }));

    // Record in history
    await db`
      INSERT INTO alert_history (config_id, type, title, detail, level, channels, channel_results, sent_at, success, error_message)
      VALUES (
        ${config.id},
        ${config.type},
        ${payload.title},
        ${payload.message},
        ${config.level},
        ${JSON.stringify(channels)},
        ${JSON.stringify(channelResults)},
        ${now},
        ${success},
        ${results.find((r) => r.error)?.error || null}
      )
    `;

    if (success) {
      logger.info("Alert sent successfully: " + config.name);
    } else {
      const failedChannels = results.filter((r) => !r.success).map((r) => r.channel).join(",");
      logger.error("Alert send failed for " + config.name + ": " + failedChannels);
    }
  }

  /**
   * Run all alert checks
   */
  async runAlertChecks(): Promise<void> {
    logger.info("Running alert checks");

    await this.checkAlerts("perf");
    await this.checkAlerts("error");
    await this.checkAlerts("conversation");
    await this.checkAlerts("install");
    await this.checkAlerts("crash");

    logger.info("Alert checks completed");
  }
}

export const alertService = new AlertService();
export default alertService;
