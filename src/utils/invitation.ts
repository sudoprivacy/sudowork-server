/**
 * Invitation code utilities
 */

/**
 * Generate a 6-character invitation code
 * Uses letters and numbers, excluding confusing characters (I, O, 0, 1)
 */
export function generateInvitationCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Exclude I, O, 0, 1
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}