/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { hash, compare } from "bcryptjs";

const SALT_ROUNDS = 10;

/**
 * Hash password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return await hash(password, SALT_ROUNDS);
}

/**
 * Verify password against hash
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return await compare(password, hash);
}

/**
 * Validate password strength
 * Requirements: At least 8 characters, contains letters and numbers
 */
export function validatePasswordStrength(password: string): {
  valid: boolean;
  message?: string;
} {
  if (password.length < 8) {
    return { valid: false, message: "密码必须至少 8 位" };
  }

  if (!/(?=.*[A-Za-z])(?=.*\d)/.test(password)) {
    return { valid: false, message: "密码必须包含字母和数字" };
  }

  return { valid: true };
}
