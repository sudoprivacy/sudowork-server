/**
 * Validation utilities
 */

/**
 * Validate phone number format
 * Supports:
 * 1. Simple format: 11 digits, starting with 1 (e.g., 13800138000)
 * 2. E.164 format: +[country code][phone number] (e.g., +8613800138000)
 */
export function isValidPhone(phone: string): boolean {
  if (phone.length === 11) {
    return phone[0] === "1" && /^\d{11}$/.test(phone);
  } else if (phone.length >= 13 && phone[0] === "+") {
    if (!phone.startsWith("+86")) return false;
    const phoneNumber = phone.slice(3);
    return (
      phoneNumber.length === 11 &&
      phoneNumber[0] === "1" &&
      /^\d{11}$/.test(phoneNumber)
    );
  }
  return false;
}

/**
 * Validate SMS verification code format (6 digits)
 */
export function isValidSmsCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}