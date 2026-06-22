/**
 * System configuration service (KV store in system_config table).
 *
 * 系统级配置的读写服务。
 * - getLoginMethod(): 当前登录方式 0=手机验证码 / 1=用户名密码
 * - setLoginMethod(): 设置登录方式
 * - isSmsChannelConfigured(): 短信通道是否已真正配置(仅腾讯云完整配置才算)
 * - getLogReport/setLogReport: 日志上报开关配置(开关 + 协议 + 域名)
 * - getVersionUpdate/setVersionUpdate: 版本自动更新开关配置(开关 + COS 域名)
 * - getProductImprovement/setProductImprovement: 参与产品改进计划开关配置(开关 + 协议 + 域名)
 */

import { db } from "../db/index.js";

const LOGIN_METHOD_KEY = "login_method";
const LOG_REPORT_KEY = "log_report";
const VERSION_UPDATE_KEY = "version_update";
const PRODUCT_IMPROVEMENT_KEY = "product_improvement";

export interface LogReportConfig {
  enabled: number;
  protocol?: string;
  domain?: string;
}

export interface VersionUpdateConfig {
  enabled: number;
  cos_domain?: string;
}

export interface ProductImprovementConfig {
  enabled: number;
  protocol?: string;
  domain?: string;
}

export class SystemConfigService {
  /**
   * 获取当前登录方式。0=手机验证码(默认), 1=用户名密码。
   */
  getLoginMethod(): number {
    const row = db
      .prepare("SELECT value FROM system_config WHERE key = ?")
      .get(LOGIN_METHOD_KEY) as { value: string } | undefined;
    const value = parseInt(row?.value ?? "0", 10);
    return value === 1 ? 1 : 0;
  }

  /**
   * 设置登录方式。
   */
  setLoginMethod(value: number): void {
    const v = value === 1 ? "1" : "0";
    const result = db.run(
      "UPDATE system_config SET value = ?, updated_at = datetime('now') WHERE key = ?",
      [v, LOGIN_METHOD_KEY],
    );
    if (result.changes === 0) {
      db.run(
        "INSERT INTO system_config(key, value) VALUES(?, ?)",
        [LOGIN_METHOD_KEY, v],
      );
    }
  }

  /**
   * 通用 JSON 配置读取 helper。
   * SELECT 取 value,JSON.parse 后与 defaultValue merge 容错(parse 失败/无值返回 defaultValue)。
   */
  private getJsonConfig<T extends object>(key: string, defaultValue: T): T {
    const row = db
      .prepare("SELECT value FROM system_config WHERE key = ?")
      .get(key) as { value: string } | undefined;
    if (!row?.value) {
      return defaultValue;
    }
    try {
      const parsed = JSON.parse(row.value);
      return { ...defaultValue, ...parsed };
    } catch {
      return defaultValue;
    }
  }

  /**
   * 通用 JSON 配置写入 helper。
   * 整体替换:JSON.stringify(value) 写入 value 列,不做字段级合并。
   * UPDATE 失败(changes===0)再 INSERT,与 setLoginMethod 模式一致。
   */
  private setJsonConfig(key: string, value: unknown): void {
    const v = JSON.stringify(value);
    const result = db.run(
      "UPDATE system_config SET value = ?, updated_at = datetime('now') WHERE key = ?",
      [v, key],
    );
    if (result.changes === 0) {
      db.run(
        "INSERT INTO system_config(key, value) VALUES(?, ?)",
        [key, v],
      );
    }
  }

  /**
   * 获取日志上报配置。enabled=0 关闭(默认), enabled=1 开启需 protocol+domain 完整。
   */
  getLogReport(): LogReportConfig {
    return this.getJsonConfig<LogReportConfig>(LOG_REPORT_KEY, {
      enabled: 0,
      protocol: "",
      domain: "",
    });
  }

  /**
   * 设置日志上报配置。整体替换,前端约定传入完整对象。
   */
  setLogReport(value: LogReportConfig): void {
    this.setJsonConfig(LOG_REPORT_KEY, value);
  }

  /**
   * 获取版本自动更新配置。enabled=0 关闭(默认), enabled=1 开启需 cos_domain 非空。
   */
  getVersionUpdate(): VersionUpdateConfig {
    return this.getJsonConfig<VersionUpdateConfig>(VERSION_UPDATE_KEY, {
      enabled: 0,
      cos_domain: "",
    });
  }

  /**
   * 设置版本自动更新配置。整体替换。
   */
  setVersionUpdate(value: VersionUpdateConfig): void {
    this.setJsonConfig(VERSION_UPDATE_KEY, value);
  }

  /**
   * 获取产品改进计划配置。enabled=0 关闭(默认), enabled=1 开启需 protocol+domain 完整。
   */
  getProductImprovement(): ProductImprovementConfig {
    return this.getJsonConfig<ProductImprovementConfig>(
      PRODUCT_IMPROVEMENT_KEY,
      {
        enabled: 0,
        protocol: "",
        domain: "",
      },
    );
  }

  /**
   * 设置产品改进计划配置。整体替换。
   */
  setProductImprovement(value: ProductImprovementConfig): void {
    this.setJsonConfig(PRODUCT_IMPROVEMENT_KEY, value);
  }

  /**
   * 短信通道是否已真正配置。
   * 判定:SMS_PROVIDER=tencent 且 6 个腾讯云凭证齐全 → 已配置(唯一允许切换到手机验证码的条件)。
   * SMS_PROVIDER=mock 或其他/未设置 → 未配置。
   */
  isSmsChannelConfigured(): boolean {
    if (process.env.SMS_PROVIDER !== "tencent") {
      return false;
    }
    const credentials = [
      process.env.TENCENT_SECRET_ID,
      process.env.TENCENT_SECRET_KEY,
      process.env.TENCENT_SDK_APP_ID,
      process.env.TENCENT_SIGN_NAME,
      process.env.TENCENT_TEMPLATE_ID,
      process.env.TENCENT_SIGN_ID,
    ];
    return credentials.every(
      (c) => typeof c === "string" && c.trim().length > 0,
    );
  }
}

export const systemConfigService = new SystemConfigService();
