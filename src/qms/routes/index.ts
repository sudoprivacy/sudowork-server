/**
 * API routes exports
 */

import telemetry from "./telemetry.js";
import dashboard from "./dashboard.js";
import alerts from "./alerts.js";
import system from "./system.js";
import crash from "./crash.js";
import userStats from "./userStats.js";

export const routes = {
  telemetry,
  dashboard,
  alerts,
  system,
  crash,
  userStats,
};

export default routes;
