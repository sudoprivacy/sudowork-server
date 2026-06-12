/**
 * Scheduled task definitions
 * TimescaleDB handles most aggregation and cleanup via continuous aggregates and retention policies
 */

import { aggregationService } from "../services/aggregation.js";
import { cleanupService } from "../services/cleanup.js";
import { alertService } from "../services/alert.js";
import { aggregateCrashDailyStats, cleanupOldCrashEvents } from "../services/crashAggregation.js";
import { processQueue } from "../services/queue.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";

type TaskCallback = () => Promise<void>;

interface ScheduledTask {
  name: string;
  interval: number; // milliseconds
  callback: TaskCallback;
  lastRun?: number;
  lastError?: string;
  running?: boolean;
}

class TaskScheduler {
  private tasks: ScheduledTask[] = [];
  private running = false;
  private intervalId?: ReturnType<typeof setInterval>;

  /**
   * Add a scheduled task
   */
  addTask(name: string, intervalMs: number, callback: TaskCallback): void {
    this.tasks.push({
      name,
      interval: intervalMs,
      callback,
    });
    logger.info("Task scheduled: " + name + " every " + (intervalMs / 1000) + "s");
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.running) {
      logger.warn("Scheduler already running");
      return;
    }

    this.running = true;
    logger.info("Starting task scheduler");

    // Check tasks every minute
    this.intervalId = setInterval(() => {
      this.checkTasks();
    }, 60 * 1000);

    // Run initial check after 10 seconds
    setTimeout(() => {
      this.checkTasks();
    }, 10 * 1000);
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    logger.info("Task scheduler stopped");
  }

  /**
   * Check and run tasks that are due
   */
  private async checkTasks(): Promise<void> {
    const now = Date.now();

    for (const task of this.tasks) {
      if (!task.lastRun || now - task.lastRun >= task.interval) {
        task.running = true;
        try {
          logger.info("Running task: " + task.name);
          await task.callback();
          task.lastRun = now;
          task.lastError = undefined;
        } catch (error) {
          logger.error("Task failed: " + task.name + " - " + String(error));
          task.lastError = error instanceof Error ? error.message : String(error);
          task.lastRun = now; // Still update to prevent immediate retry
        } finally {
          task.running = false;
        }
      }
    }
  }

  /**
   * Run a specific task immediately
   */
  async runTask(name: string): Promise<void> {
    const task = this.tasks.find((t) => t.name === name);
    if (!task) {
      logger.warn("Task not found:", name);
      return;
    }

    task.running = true;
    try {
      logger.info("Running task manually: " + name);
      await task.callback();
      task.lastRun = Date.now();
      task.lastError = undefined;
    } catch (error) {
      logger.error("Task failed: " + name + " - " + String(error));
      task.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      task.running = false;
    }
  }

  /**
   * Get task status
   */
  getTaskStatus(): { name: string; lastRun: number | null; nextRun: number; running: boolean; lastError: string | null }[] {
    return this.tasks.map((task) => ({
      name: task.name,
      lastRun: task.lastRun || null,
      nextRun: task.lastRun ? task.lastRun + task.interval : Date.now() + task.interval,
      running: task.running || false,
      lastError: task.lastError || null,
    }));
  }
}

/**
 * Create and configure the scheduler
 * Tasks are simplified since TimescaleDB handles:
 * - Daily aggregation (via continuous aggregates)
 * - Data cleanup (via retention policies)
 */
export function createScheduler(): TaskScheduler {
  const scheduler = new TaskScheduler();

  // Queue processing - process telemetry queue every 3 seconds or when batch size reached
  scheduler.addTask("queue-process", config.queue.flushIntervalMs, async () => {
    await processQueue();
  });

  // Refresh continuous aggregates - optional, for immediate data availability
  // TimescaleDB auto-refreshes based on policy, but we can trigger manual refresh
  scheduler.addTask("aggregation-refresh", 60 * 60 * 1000, async () => {
    await aggregationService.refreshContinuousAggregates();
  });

  // Cleanup sessions (not handled by TimescaleDB)
  // Run every hour
  scheduler.addTask("session-cleanup", 60 * 60 * 1000, async () => {
    await cleanupService.runCleanup();
  });

  // Alert check - run every 5 minutes
  scheduler.addTask("alert-check", 5 * 60 * 1000, async () => {
    await alertService.runAlertChecks();
  });

  // Crash daily aggregation - fallback for non-TimescaleDB environments
  // Run every hour
  scheduler.addTask("crash-aggregation", 60 * 60 * 1000, async () => {
    await aggregateCrashDailyStats();
  });

  // Crash cleanup - fallback for non-TimescaleDB environments
  // Run every 6 hours (90 days retention)
  scheduler.addTask("crash-cleanup", 6 * 60 * 60 * 1000, async () => {
    await cleanupOldCrashEvents(90);
  });

  return scheduler;
}

export { TaskScheduler };
export default createScheduler;