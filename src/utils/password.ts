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
 * Requirements: 8-20 characters, must contain uppercase + lowercase + digit
 */
export function validatePasswordStrength(password: string): {
  valid: boolean;
  message?: string;
} {
  if (!password) {
    return { valid: false, message: "密码不能为空" };
  }

  if (password.length < 8) {
    return { valid: false, message: "密码长度不能少于 8 位" };
  }

  if (password.length > 20) {
    return { valid: false, message: "密码长度不能超过 20 位" };
  }

  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: "密码必须包含大写字母" };
  }

  if (!/[a-z]/.test(password)) {
    return { valid: false, message: "密码必须包含小写字母" };
  }

  if (!/\d/.test(password)) {
    return { valid: false, message: "密码必须包含数字" };
  }

  return { valid: true };
}
