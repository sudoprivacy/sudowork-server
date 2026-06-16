/**
 * System configuration service (KV store in system_config table).
 *
 * 系统级配置的读写服务。当前仅承载 login_method(登录方式)。
 * - getLoginMethod(): 当前登录方式 0=手机验证码 / 1=用户名密码
 * - setLoginMethod(): 设置登录方式
 * - isSmsChannelConfigured(): 短信通道是否已真正配置(仅腾讯云完整配置才算)
 */

import { db } from "../db/index.js";

const LOGIN_METHOD_KEY = "login_method";

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
