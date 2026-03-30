/**
 * Database connection and configuration
 */

import { Database } from "bun:sqlite";

export const db = new Database(process.env.DB_PATH || "/app/data/sudowork.db");

export const SECRET = process.env.JWT_SECRET || "sudowork-secret-key";