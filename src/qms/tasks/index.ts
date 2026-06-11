/**
 * Tasks exports
 */

export { createScheduler, TaskScheduler } from "./scheduler.js";

// Global scheduler instance (initialized on server start)
import { TaskScheduler } from "./scheduler.js";

let schedulerInstance: TaskScheduler | null = null;

export function setSchedulerInstance(scheduler: TaskScheduler): void {
  schedulerInstance = scheduler;
}

export function getSchedulerInstance(): TaskScheduler | null {
  return schedulerInstance;
}