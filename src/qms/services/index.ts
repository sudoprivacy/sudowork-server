/**
 * Services exports
 */

export { aggregationService } from "./aggregation.js";
export { cleanupService } from "./cleanup.js";
export { notificationService } from "./notification.js";
export { alertService } from "./alert.js";
export {
  generateFingerprint,
  processCrashEvent,
  insertCrashEvent,
  getCrashIssues,
  getCrashIssueById,
  updateCrashIssue,
  getCrashEvents,
  getCrashEventById,
  getCrashStatsSummary,
  getCrashTrend,
  getCrashDistribution,
  aggregateCrashDailyStats,
  cleanupOldCrashEvents,
} from "./crashAggregation.js";