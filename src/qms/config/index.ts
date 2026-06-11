/**
 * Application configuration
 */

// Bun automatically loads .env files, no need to call loadEnv()

export const config = {
  // Server
  port: parseInt(process.env.QMS_PORT || process.env.PORT || "6078", 10),
  host: process.env.QMS_HOST || process.env.HOST || "0.0.0.0",

  // CORS
  corsOrigins: process.env.CORS_ORIGINS?.split(",") || ["http://localhost:5173", "http://localhost:3000"],

  // Database (PostgreSQL + TimescaleDB)
  database: {
    host: process.env.QMS_DB_HOST || process.env.DB_HOST || "localhost",
    port: parseInt(process.env.QMS_DB_PORT || process.env.DB_PORT || "5432", 10),
    name: process.env.QMS_DB_NAME || process.env.DB_NAME || "sudowork_qms",
    user: process.env.QMS_DB_USER || process.env.DB_USER || "postgres",
    password: process.env.QMS_DB_PASSWORD || process.env.DB_PASSWORD || "postgres",
    maxConnections: parseInt(process.env.QMS_DB_MAX_CONNECTIONS || process.env.DB_MAX_CONNECTIONS || "20", 10),
    idleTimeout: parseInt(process.env.QMS_DB_IDLE_TIMEOUT || process.env.DB_IDLE_TIMEOUT || "30000", 10),
    connectTimeout: parseInt(process.env.QMS_DB_CONNECT_TIMEOUT || process.env.DB_CONNECT_TIMEOUT || "10000", 10),
  },

  // Redis (for queue and session storage)
  redis: {
    host: process.env.QMS_REDIS_HOST || process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.QMS_REDIS_PORT || process.env.REDIS_PORT || "6379", 10),
    password: process.env.QMS_REDIS_PASSWORD || process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.QMS_REDIS_DB || process.env.REDIS_DB || "0", 10),
    keyPrefix: process.env.QMS_REDIS_KEY_PREFIX || "qms:",
  },

  // Queue settings
  queue: {
    flushIntervalMs: parseInt(process.env.QMS_QUEUE_FLUSH_INTERVAL || process.env.QUEUE_FLUSH_INTERVAL || "3000", 10), // 3 seconds
    batchSize: parseInt(process.env.QMS_QUEUE_BATCH_SIZE || process.env.QUEUE_BATCH_SIZE || "50", 10),
  },

  // Authentication
  auth: {
    jwtSecret: process.env.JWT_SECRET || "sudo-qms-secret-key-change-in-production",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "24h",
    apiKeyHeader: process.env.QMS_API_KEY_HEADER || process.env.API_KEY_HEADER || "X-API-Key",
    defaultApiKey: process.env.QMS_DEFAULT_API_KEY || process.env.DEFAULT_API_KEY,
  },

  // Telemetry
  telemetry: {
    dataRetentionDays: {
      perf: parseInt(process.env.QMS_PERF_RETENTION_DAYS || process.env.PERF_RETENTION_DAYS || "90", 10),
      conversations: parseInt(process.env.QMS_CONVERSATION_RETENTION_DAYS || process.env.CONVERSATION_RETENTION_DAYS || "180", 10),
    },
    aggregationCron: process.env.QMS_AGGREGATION_CRON || process.env.AGGREGATION_CRON || "0 1 * * *",
    cleanupCron: process.env.QMS_CLEANUP_CRON || process.env.CLEANUP_CRON || "0 2 * * *",
  },

  // Notifications
  notifications: {
    lark: {
      webhookUrl: process.env.QMS_LARK_WEBHOOK_URL || process.env.LARK_WEBHOOK_URL,
    },
    email: {
      smtpHost: process.env.QMS_SMTP_HOST || process.env.QMS_EMAIL_SMTP_HOST || process.env.SMTP_HOST,
      smtpPort: parseInt(process.env.QMS_SMTP_PORT || process.env.QMS_EMAIL_SMTP_PORT || process.env.SMTP_PORT || "587", 10),
      smtpUser: process.env.QMS_SMTP_USER || process.env.QMS_EMAIL_SMTP_USER || process.env.SMTP_USER,
      smtpPass: process.env.QMS_SMTP_PASS || process.env.QMS_EMAIL_SMTP_PASS || process.env.SMTP_PASS,
      from: process.env.QMS_ALERT_EMAIL_FROM || process.env.QMS_EMAIL_FROM || process.env.ALERT_EMAIL_FROM,
      to: process.env.QMS_ALERT_EMAIL_TO || process.env.QMS_EMAIL_TO || process.env.ALERT_EMAIL_TO,
    },
  },

  // Encryption (hybrid RSA + AES-GCM)
  encryption: {
    /** RSA-2048 private key PEM for decryption */
    privateKeyPem: process.env.QMS_TELEMETRY_PRIVATE_KEY || process.env.TELEMETRY_PRIVATE_KEY,
    /** Whether encryption is required for telemetry/crash endpoints */
    encryptionRequired: (process.env.QMS_TELEMETRY_ENCRYPTION_REQUIRED || process.env.TELEMETRY_ENCRYPTION_REQUIRED) === "true",
    /** Encryption algorithm version */
    algorithm: (process.env.QMS_TELEMETRY_ENCRYPTION_ALGORITHM || process.env.TELEMETRY_ENCRYPTION_ALGORITHM || "hybrid-v1") as "hybrid-v1",
  },

  // Admin frontend
  serveAdmin: process.env.SERVE_ADMIN === "true" || process.env.NODE_ENV === "production",

  // Logging
  logLevel: process.env.LOG_LEVEL || "info",

  // Environment
  env: process.env.NODE_ENV || "development",
};
