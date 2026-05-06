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

/**
 * Validate URL pattern for config items.
 * - Optional (empty/null/undefined is valid)
 * - Max 256 characters
 * - Must start with http:// or https://
 * - URL must have a valid host (domain, IP, localhost; allows *.subdomain wildcard)
 * - Path may contain * and ? wildcards (glob-style), but no **, [], or {}
 */
export function isValidUrlPattern(value: string): boolean {
  if (!value || !value.trim()) return true;

  const trimmed = value.trim();

  if (trimmed.length > 256) return false;

  if (!/^https?:\/\//.test(trimmed)) return false;

  const afterScheme = trimmed.replace(/^https?:\/\//, "");
  const slashIdx = afterScheme.indexOf("/");
  const hostPart = slashIdx === -1 ? afterScheme : afterScheme.slice(0, slashIdx);
  const pathPart = slashIdx === -1 ? "" : afterScheme.slice(slashIdx);

  if (!hostPart) return false;

  if (!isValidUrlPatternHost(hostPart)) return false;

  if (pathPart && !isValidUrlPatternPath(pathPart)) return false;

  return true;
}

function isValidUrlPatternHost(host: string): boolean {
  const colonIdx = host.lastIndexOf(":");
  const hostWithoutPort = colonIdx > 0 ? host.slice(0, colonIdx) : host;
  const port = colonIdx > 0 ? host.slice(colonIdx + 1) : null;

  if (port !== null) {
    if (!/^\d{1,5}$/.test(port)) return false;
    const portNum = parseInt(port, 10);
    if (portNum < 1 || portNum > 65535) return false;
  }

  if (hostWithoutPort === "*") return true;
  if (hostWithoutPort.startsWith("*.")) {
    return isValidDomainName(hostWithoutPort.slice(2));
  }

  if (hostWithoutPort.includes("*") || hostWithoutPort.includes("?")) return false;

  if (hostWithoutPort === "localhost") return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostWithoutPort)) return true;

  return isValidDomainName(hostWithoutPort);
}

function isValidDomainName(domain: string): boolean {
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (!label) return false;
    if (label.length > 63) return false;
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)) return false;
  }
  return true;
}

function isValidUrlPatternPath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.includes("**")) return false;
  if (/[\[\]{}]/.test(path)) return false;
  return /^[a-zA-Z0-9\-._~!$&'()*+,;=:%@?/]+$/.test(path);
}