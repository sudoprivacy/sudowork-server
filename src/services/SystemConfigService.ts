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
import { encryptGcm, decryptGcm } from "../utils/aes-gcm.js";

const LOGIN_METHOD_KEY = "login_method";
const LOG_REPORT_KEY = "log_report";
const VERSION_UPDATE_KEY = "version_update";
const PRODUCT_IMPROVEMENT_KEY = "product_improvement";

// 与 src/routes/system-config.ts:20 同一把 key（用户要求复用同一密钥；
// 独立定义以避免对路由模块的反向依赖与最小化已有代码修改）。
const LOG_REPORT_KEY_AES_KEY = Buffer.from(
  "L7CbnQlwVrzWlaehCWSIiKuwBxFDh9i1AFaifYv7UXE=",
  "base64",
);

export interface LogReportConfig {
  enabled: number;
  protocol?: string;
  domain?: string;
  key_cipher?: string;
  key_nonce?: string;
  key_set?: boolean;
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
   * 获取日志上报配置(同步)。enabled=0 关闭(默认), enabled=1 开启需 protocol+domain+key 完整。
   * 返回值含 key_cipher/key_nonce 持久化字段与派生 key_set, 但不含明文 key。
   * 明文 key 仅可通过 async getLogReportKeyPlaintext() 获得。
   */
  getLogReport(): LogReportConfig {
    const raw = this.getJsonConfig<LogReportConfig>(LOG_REPORT_KEY, {
      enabled: 0,
      protocol: "",
      domain: "",
    });
    return {
      enabled: raw.enabled,
      protocol: raw.protocol,
      domain: raw.domain,
      key_cipher: raw.key_cipher,
      key_nonce: raw.key_nonce,
      key_set: !!(raw.key_cipher && raw.key_nonce),
    };
  }

  /**
   * 获取日志上报凭证 key 的明文(async, 仅供 credentials 接口下发使用)。
   * 若 cipher/nonce 任一为空返回 "" ; 否则用 LOG_REPORT_KEY_AES_KEY 解密。
   */
  async getLogReportKeyPlaintext(): Promise<string> {
    const raw = this.getJsonConfig<LogReportConfig>(LOG_REPORT_KEY, {
      enabled: 0,
      protocol: "",
      domain: "",
    });
    if (!raw.key_cipher || !raw.key_nonce) {
      return "";
    }
    const plaintextBytes = await decryptGcm(
      raw.key_nonce,
      raw.key_cipher,
      LOG_REPORT_KEY_AES_KEY,
    );
    return new TextDecoder().decode(plaintextBytes);
  }

  /**
   * 设置日志上报配置(async, 因 key 加密走 WebCrypto)。
   * - key 非空字符串 → encryptGcm 加密得新 cipher/nonce 入库
   * - key 为空字符串/undefined → 取既有 cipher/nonce 沿用 (业务上"空=不动 key"语义封装在 service 内部)
   * 明文 key 不会落库, 也不会进入 LogReportConfig 流转。
   */
  async setLogReport(value: {
    enabled: number;
    protocol?: string;
    domain?: string;
    key?: string;
  }): Promise<void> {
    let keyCipher: string | undefined;
    let keyNonce: string | undefined;
    if (typeof value.key === "string" && value.key.length > 0) {
      const enc = await encryptGcm(
        new TextEncoder().encode(value.key),
        LOG_REPORT_KEY_AES_KEY,
      );
      keyCipher = enc.ciphertext;
      keyNonce = enc.nonce;
    } else {
      const existing = this.getJsonConfig<LogReportConfig>(LOG_REPORT_KEY, {
        enabled: 0,
        protocol: "",
        domain: "",
      });
      keyCipher = existing.key_cipher;
      keyNonce = existing.key_nonce;
    }
    this.setJsonConfig(LOG_REPORT_KEY, {
      enabled: value.enabled,
      protocol: value.protocol ?? "",
      domain: value.domain ?? "",
      key_cipher: keyCipher,
      key_nonce: keyNonce,
    });
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
