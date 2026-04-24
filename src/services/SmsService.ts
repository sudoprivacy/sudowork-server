import { redis } from "../redis.js";

const SMS_CODE_PREFIX = "sms_code";
const SMS_SEND_LIMIT_PREFIX = "sms_send_limit";
const SMS_DAILY_COUNT_PREFIX = "sms_daily_count";

interface SmsCodeRecord {
  phone: string;
  code: string;
  expiresAt: number;
  attempts: number;
}

export class SmsService {
  private smsConfig = {
    provider: process.env.SMS_PROVIDER || "mock",
    code: {
      length: parseInt(process.env.SMS_CODE_LENGTH || "6"),
      expireMinutes: parseInt(process.env.SMS_CODE_EXPIRE_MINUTES || "5"),
      sendInterval: parseInt(process.env.SMS_CODE_SEND_INTERVAL || "60"),
      maxPerDay: parseInt(process.env.SMS_CODE_MAX_PER_DAY || "10"),
    },
    tencent: {
      secretId: process.env.TENCENT_SECRET_ID || "",
      secretKey: process.env.TENCENT_SECRET_KEY || "",
      sdkAppId: process.env.TENCENT_SDK_APP_ID || "",
      signName: process.env.TENCENT_SIGN_NAME || "",
      templateId: process.env.TENCENT_TEMPLATE_ID || "",
      signId: process.env.TENCENT_SIGN_ID || "",
      region: process.env.TENCENT_REGION || "ap-beijing",
    },
  };

  private tencentSms: any = null;

  constructor() {
    if (this.smsConfig.provider === "tencent") {
      this.initTencentSms();
    }
  }

  private initTencentSms() {
    const tencentcloud = require("tencentcloud-sdk-nodejs");
    const SmsClient = tencentcloud.sms.v20210111.Client;

    this.tencentSms = new SmsClient({
      credential: {
        secretId: this.smsConfig.tencent.secretId,
        secretKey: this.smsConfig.tencent.secretKey,
      },
      region: this.smsConfig.tencent.region,
    });

    console.log("腾讯云短信服务初始化成功, secretId:", this.smsConfig.tencent.secretId?.substring(0, 8) + "...");
  }

  private generateCode(): string {
    const length = this.smsConfig.code.length;
    return Array.from({ length }, () => Math.floor(Math.random() * 10)).join(
      "",
    );
  }

  private normalizePhoneToE164(phone: string): string {
    if (phone.startsWith("+")) {
      return phone;
    }
    if (phone.length === 11 && phone.startsWith("1")) {
      return "+86" + phone;
    }
    return phone;
  }

  async sendCode(phone: string): Promise<{
    success: boolean;
    message?: string;
    expire?: number;
    nextSendIn?: number;
    dailyRemaining?: number;
  }> {
    const today = new Date().toISOString().split("T")[0];
    const dailyKey = `${SMS_DAILY_COUNT_PREFIX}:${phone}:${today}`;
    const dailyCount = parseInt((await redis.get(dailyKey)) || "0");

    // 24小时内最多发送 maxPerDay 条
    if (dailyCount >= this.smsConfig.code.maxPerDay) {
      return {
        success: false,
        message: `今日发送次数已达上限（${this.smsConfig.code.maxPerDay}次），请明天再试`,
      };
    }

    // 检查60秒内是否已发送（验证码key存在且未过期）
    const codeKey = `${SMS_CODE_PREFIX}:${phone}`;
    const existingCode = await redis.get(codeKey);
    if (existingCode) {
      const ttl = await redis.ttl(codeKey);
      const elapsed = this.smsConfig.code.expireMinutes * 60 - ttl;
      const nextSendIn = this.smsConfig.code.sendInterval - elapsed;
      if (nextSendIn > 0) {
        return {
          success: false,
          message: `发送过于频繁，请 ${nextSendIn} 秒后再试`,
          nextSendIn,
        };
      }
    }

    const code = this.generateCode();
    const expireSeconds = this.smsConfig.code.expireMinutes * 60;

    const pipe = redis.pipeline();
    pipe.setex(
      codeKey,
      expireSeconds,
      JSON.stringify({
        phone,
        code,
        expiresAt: Date.now() + expireSeconds * 1000,
        attempts: 0,
      }),
    );
    pipe.incr(dailyKey);
    pipe.expire(dailyKey, 86400);
    await pipe.exec();

    const updatedDailyCount = parseInt((await redis.get(dailyKey)) || "0");
    const dailyRemaining = this.smsConfig.code.maxPerDay - updatedDailyCount;

    if (this.smsConfig.provider === "tencent" && this.tencentSms) {
      const e164Phone = this.normalizePhoneToE164(phone);

      try {
        // 使用腾讯云 Node.js SDK 正确的参数名
        const params = {
          PhoneNumberSet: [e164Phone],
          TemplateId: this.smsConfig.tencent.templateId,
          SmsSdkAppId: this.smsConfig.tencent.sdkAppId,
          SignName: this.smsConfig.tencent.signName,
          TemplateParamSet: [
            code,
            this.smsConfig.code.expireMinutes.toString(),
          ],
        };

        console.log("[SMS] 腾讯云发送参数:", JSON.stringify(params, null, 2));
        const res = await this.tencentSms.SendSms(params);
        console.log("[SMS] 腾讯云响应:", JSON.stringify(res, null, 2));

        if (res.SendStatusSet[0]?.Code !== "Ok") {
          await redis.del(codeKey);
          return {
            success: false,
            message: `短信发送失败：${res.SendStatusSet[0]?.Message}`,
          };
        }

        console.log(`[SMS] 腾讯云短信发送成功，手机号：${phone}`);
      } catch (error: any) {
        await redis.del(codeKey);
        console.error("[SMS] 腾讯云短信发送异常:", error.message);
        return {
          success: false,
          message: `短信发送异常：${error.message}`,
        };
      }
    } else {
      // Mock 模式：打印验证码方便测试
      console.log(`[SMS] Mock 模式：验证码已发送至 ${phone}，验证码：${code}，有效期 ${this.smsConfig.code.expireMinutes} 分钟`);
    }

    return {
      success: true,
      expire: expireSeconds,
      nextSendIn: this.smsConfig.code.sendInterval,
      dailyRemaining,
    };
  }

  async verifyCode(
    phone: string,
    code: string,
  ): Promise<{
    success: boolean;
    message?: string;
  }> {
    const codeKey = `${SMS_CODE_PREFIX}:${phone}`;
    const storedData = await redis.get(codeKey);

    if (!storedData) {
      return {
        success: false,
        message: "验证码已过期或不存在",
      };
    }

    const record: SmsCodeRecord = JSON.parse(storedData);

    if (record.code !== code) {
      const newAttempts = record.attempts + 1;

      if (newAttempts >= 5) {
        await redis.del(codeKey);
        return {
          success: false,
          message: "验证次数过多，请重新获取验证码",
        };
      }

      await redis.setex(
        codeKey,
        300,
        JSON.stringify({
          ...record,
          attempts: newAttempts,
        }),
      );

      return {
        success: false,
        message: "验证码错误",
      };
    }

    await redis.del(codeKey);
    return { success: true };
  }
}

export const smsService = new SmsService();
