/**
 * Rate Limiter Middleware
 * 使用 Redis 实现基于 IP 的速率限制
 */

import type { Context } from "hono";
import { redis } from "../redis.js";

interface RateLimitConfig {
  windowMs: number; // 时间窗口（毫秒）
  max: number; // 最大请求数
  message?: string; // 自定义错误消息
  keyGenerator?: (c: Context) => string; // 自定义 key 生成器
}

/**
 * 创建速率限制中间件
 */
export function rateLimiter(config: RateLimitConfig) {
  return async (c: Context, next: () => Promise<void>) => {
    // 获取客户端 IP
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
      c.req.header("x-real-ip") ||
      "unknown";

    // 生成 Redis key
    const keyGenerator = config.keyGenerator || ((c: Context) => `rate_limit:${ip}:${c.req.path}`);
    const key = keyGenerator(c);

    try {
      // 获取当前计数
      const current = parseInt((await redis.get(key)) || "0");

      if (current >= config.max) {
        // 获取剩余时间
        const ttl = await redis.ttl(key);
        return c.json(
          {
            success: false,
            msg: config.message || "请求过于频繁，请稍后再试",
            retry_after: ttl > 0 ? ttl : Math.floor(config.windowMs / 1000),
          },
          429,
        );
      }

      // 计数 +1
      if (current === 0) {
        await redis.setex(
          key,
          Math.floor(config.windowMs / 1000),
          "1",
        );
      } else {
        await redis.incr(key);
      }

      await next();
    } catch (error) {
      // Redis 错误时放行请求，避免影响服务
      console.error("[RateLimiter] Redis error:", error);
      await next();
    }
  };
}

/**
 * 预设配置
 */
export const rateLimitPresets = {
  // 验证码发送：每 IP 每 15 分钟最多 5 次
  smsCode: {
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: "验证码发送过于频繁，请 15 分钟后再试",
  },
  // 登录：每 IP 每 15 分钟最多 10 次
  login: {
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: "登录尝试过于频繁，请 15 分钟后再试",
  },
  // API 通用：每 IP 每分钟最多 100 次
  api: {
    windowMs: 60 * 1000,
    max: 100,
    message: "API 请求过于频繁，请稍后再试",
  },
};