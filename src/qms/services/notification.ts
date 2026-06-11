/**
 * Notification service for alerts
 */

import nodemailer from "nodemailer";
import { db } from "../db/index.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import type { AlertPayload, AlertChannel } from "../types/alert.js";

// Create SMTP transporter (lazy initialization)
let smtpTransporter: nodemailer.Transporter | null = null;

/**
 * Get notification config from database, fallback to env config
 */
async function getNotificationConfigFromDB() {
  const dbConfigs = await db`
    SELECT key, value FROM system_config
    WHERE key LIKE 'notification_%'
  `;

  const getConfigValue = (key: string, fallback?: string): string => {
    const dbConfig = dbConfigs.find(c => c.key === key);
    return dbConfig?.value || fallback || "";
  };

  return {
    lark: {
      webhookUrl: getConfigValue("notification_lark_webhook", config.notifications.lark.webhookUrl),
    },
    email: {
      smtpHost: getConfigValue("notification_email_smtp_host", config.notifications.email.smtpHost),
      smtpPort: parseInt(getConfigValue("notification_email_smtp_port", String(config.notifications.email.smtpPort))) || 587,
      smtpUser: getConfigValue("notification_email_smtp_user", config.notifications.email.smtpUser),
      smtpPass: getConfigValue("notification_email_smtp_pass", config.notifications.email.smtpPass),
      from: getConfigValue("notification_email_from", config.notifications.email.from),
      to: getConfigValue("notification_email_to", config.notifications.email.to),
    },
  };
}

function getSmtpTransporter(emailConfig: {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}): nodemailer.Transporter | null {
  if (!emailConfig.smtpHost || !emailConfig.smtpUser || !emailConfig.smtpPass) {
    return null;
  }

  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: emailConfig.smtpHost,
      port: emailConfig.smtpPort,
      secure: emailConfig.smtpPort === 465,
      auth: {
        user: emailConfig.smtpUser,
        pass: emailConfig.smtpPass,
      },
    });
  }

  return smtpTransporter;
}

class NotificationService {
  /**
   * Test notification for a channel
   */
  async testNotification(
    channel: "lark" | "email",
    config: {
      lark: { webhookUrl: string };
      email: {
        smtpHost: string;
        smtpPort: number;
        smtpUser: string;
        smtpPass: string;
        from: string;
        to: string;
      };
    }
  ): Promise<{ success: boolean; error?: string }> {
    const testPayload: AlertPayload = {
      type: "system",
      title: "测试通知",
      message: "这是一条来自 Sudoclaw QMS 系统的测试通知，请忽略。",
      level: "info",
      timestamp: Date.now(),
    };

    if (channel === "lark") {
      return this.sendToLarkWithConfig(testPayload, config.lark);
    } else {
      return this.sendToEmailWithConfig(testPayload, config.email);
    }
  }

  /**
   * Send alert to specified channels
   */
  async sendAlert(payload: AlertPayload, channels: AlertChannel[]): Promise<{ channel: AlertChannel; success: boolean; error?: string }[]> {
    const results: { channel: AlertChannel; success: boolean; error?: string }[] = [];

    for (const channel of channels) {
      try {
        switch (channel) {
          case "lark":
            results.push(await this.sendToLark(payload));
            break;
          case "email":
            results.push(await this.sendToEmail(payload));
            break;
          default:
            results.push({
              channel,
              success: false,
              error: `Unknown channel: ${channel}`,
            });
        }
      } catch (error) {
        results.push({
          channel,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return results;
  }

  /**
   * Send to Lark webhook
   */
  private async sendToLark(payload: AlertPayload): Promise<{ channel: AlertChannel; success: boolean; error?: string }> {
    // Get config from database
    const notificationConfig = await getNotificationConfigFromDB();
    const larkConfig = notificationConfig.lark;

    if (!larkConfig.webhookUrl) {
      return {
        channel: "lark",
        success: false,
        error: "Lark webhook URL not configured",
      };
    }

    try {
      const levelColor = this.getLevelColor(payload.level);
      const body = {
        msg_type: "interactive",
        card: {
          config: {
            wide_screen_mode: true,
          },
          elements: [
            {
              tag: "div",
              text: {
                content: payload.message,
                tag: "lark_md",
              },
            },
            {
              tag: "note",
              elements: [
                {
                  tag: "plain_text",
                  content: `时间: ${new Date(payload.timestamp).toLocaleString("zh-CN")}`,
                },
              ],
            },
          ],
          header: {
            title: {
              tag: "plain_text",
              content: payload.title,
            },
            template: levelColor,
          },
        },
      };

      const response = await fetch(larkConfig.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const result = await response.json() as { StatusCode?: number; StatusMessage?: string };

      if (result.StatusCode !== 0) {
        return {
          channel: "lark",
          success: false,
          error: result.StatusMessage || "Lark API error",
        };
      }

      logger.info("Alert sent to Lark:", payload.title);
      return { channel: "lark", success: true };
    } catch (error) {
      logger.error("Failed to send to Lark:", error);
      return {
        channel: "lark",
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Send to Email (SMTP)
   */
  private async sendToEmail(payload: AlertPayload): Promise<{ channel: AlertChannel; success: boolean; error?: string }> {
    // Get config from database
    const notificationConfig = await getNotificationConfigFromDB();
    const emailConfig = notificationConfig.email;

    if (!emailConfig.smtpHost || !emailConfig.smtpUser || !emailConfig.smtpPass) {
      return {
        channel: "email",
        success: false,
        error: "Email SMTP not configured",
      };
    }

    if (!emailConfig.to) {
      return {
        channel: "email",
        success: false,
        error: "No recipient email address configured",
      };
    }

    try {
      const transporter = getSmtpTransporter(emailConfig);

      if (!transporter) {
        return {
          channel: "email",
          success: false,
          error: "Failed to create SMTP transporter",
        };
      }

      const levelEmoji = this.getLevelEmoji(payload.level);
      const subject = `${levelEmoji} [${payload.level.toUpperCase()}] ${payload.title}`;
      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: ${payload.level === 'critical' ? '#dc3545' : payload.level === 'warning' ? '#ffc107' : '#17a2b8'};">
            ${payload.title}
          </h2>
          <p style="font-size: 16px;">${payload.message}</p>
          ${payload.detail ? `<p style="background: #f5f5f5; padding: 10px; border-radius: 5px;">${payload.detail}</p>` : ''}
          <hr style="margin: 20px 0;"/>
          <p style="color: #666; font-size: 14px;">
            <strong>告警类型:</strong> ${payload.type}<br/>
            <strong>告警级别:</strong> ${payload.level}<br/>
            <strong>时间:</strong> ${new Date(payload.timestamp).toLocaleString('zh-CN')}
          </p>
          <p style="color: #999; font-size: 12px; margin-top: 20px;">
            此邮件来自 Sudoclaw QMS 告警系统
          </p>
        </div>
      `;

      const info = await transporter.sendMail({
        from: emailConfig.from || emailConfig.smtpUser,
        to: emailConfig.to,
        subject: subject,
        html: htmlBody,
      });

      logger.info("Alert sent to Email:", `${payload.title} (messageId: ${info.messageId})`);
      return { channel: "email", success: true };
    } catch (error) {
      logger.error("Failed to send to Email:", error);
      return {
        channel: "email",
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Send to Lark webhook with custom config
   */
  private async sendToLarkWithConfig(payload: AlertPayload, larkConfig: { webhookUrl: string }): Promise<{ success: boolean; error?: string }> {
    if (!larkConfig.webhookUrl) {
      return {
        success: false,
        error: "飞书 Webhook URL 未配置",
      };
    }

    try {
      const levelColor = this.getLevelColor(payload.level);
      const body = {
        msg_type: "interactive",
        card: {
          config: {
            wide_screen_mode: true,
          },
          elements: [
            {
              tag: "div",
              text: {
                content: payload.message,
                tag: "lark_md",
              },
            },
            {
              tag: "note",
              elements: [
                {
                  tag: "plain_text",
                  content: `时间: ${new Date(payload.timestamp).toLocaleString("zh-CN")}`,
                },
              ],
            },
          ],
          header: {
            title: {
              tag: "plain_text",
              content: payload.title,
            },
            template: levelColor,
          },
        },
      };

      const response = await fetch(larkConfig.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const result = await response.json() as { StatusCode?: number; StatusMessage?: string };

      if (result.StatusCode !== 0) {
        return {
          success: false,
          error: result.StatusMessage || "飞书 API 错误",
        };
      }

      logger.info("Alert sent to Lark:", payload.title);
      return { success: true };
    } catch (error) {
      logger.error("Failed to send to Lark:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "发送异常",
      };
    }
  }

  /**
   * Send to Email with custom config
   */
  private async sendToEmailWithConfig(payload: AlertPayload, emailConfig: {
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPass: string;
    from: string;
    to: string;
  }): Promise<{ success: boolean; error?: string }> {
    if (!emailConfig.smtpHost || !emailConfig.smtpUser || !emailConfig.smtpPass) {
      return {
        success: false,
        error: "邮件 SMTP 未完整配置",
      };
    }

    if (!emailConfig.to) {
      return {
        success: false,
        error: "未配置邮件接收地址",
      };
    }

    try {
      const transporter = nodemailer.createTransport({
        host: emailConfig.smtpHost,
        port: emailConfig.smtpPort,
        secure: emailConfig.smtpPort === 465,
        auth: {
          user: emailConfig.smtpUser,
          pass: emailConfig.smtpPass,
        },
      });

      const levelEmoji = this.getLevelEmoji(payload.level);
      const subject = `${levelEmoji} [${payload.level.toUpperCase()}] ${payload.title}`;
      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: ${payload.level === 'critical' ? '#dc3545' : payload.level === 'warning' ? '#ffc107' : '#17a2b8'};">
            ${payload.title}
          </h2>
          <p style="font-size: 16px;">${payload.message}</p>
          <hr style="margin: 20px 0;"/>
          <p style="color: #666; font-size: 14px;">
            <strong>告警级别:</strong> ${payload.level}<br/>
            <strong>时间:</strong> ${new Date(payload.timestamp).toLocaleString('zh-CN')}
          </p>
          <p style="color: #999; font-size: 12px; margin-top: 20px;">
            此邮件来自 Sudoclaw QMS 告警系统
          </p>
        </div>
      `;

      await transporter.sendMail({
        from: emailConfig.from || emailConfig.smtpUser,
        to: emailConfig.to,
        subject: subject,
        html: htmlBody,
      });

      logger.info("Alert sent to Email:", payload.title);
      return { success: true };
    } catch (error) {
      logger.error("Failed to send to Email:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "发送异常",
      };
    }
  }

  /**
   * Get emoji for alert level
   */
  private getLevelEmoji(level: string): string {
    switch (level) {
      case "critical":
        return "🔴";
      case "warning":
        return "🟡";
      case "info":
        return "🟢";
      default:
        return "⚪";
    }
  }

  /**
   * Get color for alert level (for Lark)
   */
  private getLevelColor(level: string): string {
    switch (level) {
      case "critical":
        return "red";
      case "warning":
        return "orange";
      case "info":
        return "blue";
      default:
        return "grey";
    }
  }
}

export const notificationService = new NotificationService();
export default notificationService;