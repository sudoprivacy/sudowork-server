/**
 * Logger utility
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private level: LogLevel;
  private prefix: string;

  constructor(prefix: string = "QMS", level: LogLevel = "info") {
    this.prefix = prefix;
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private formatMessage(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase();
    const base = `[${timestamp}] [${this.prefix}] [${levelStr}] ${message}`;

    if (data !== undefined) {
      return `${base} ${typeof data === "object" ? JSON.stringify(data) : data}`;
    }
    return base;
  }

  debug(message: string, data?: unknown): void {
    if (this.shouldLog("debug")) {
      console.debug(this.formatMessage("debug", message, data));
    }
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog("info")) {
      console.info(this.formatMessage("info", message, data));
    }
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage("warn", message, data));
    }
  }

  error(message: string, data?: unknown): void {
    if (this.shouldLog("error")) {
      console.error(this.formatMessage("error", message, data));
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

// Default logger instance
export const logger = new Logger(
  "QMS",
  (process.env.LOG_LEVEL as LogLevel) || "info"
);

// Create child logger with custom prefix
export function createLogger(prefix: string): Logger {
  return new Logger(prefix, (process.env.LOG_LEVEL as LogLevel) || "info");
}

export default logger;