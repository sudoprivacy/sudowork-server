/**
 * Encryption types for hybrid RSA + AES-GCM encryption
 */

/**
 * Algorithm version for encryption
 */
export type EncryptionAlgorithm = "hybrid-v1";

/**
 * Encrypted payload structure sent from client
 */
export interface EncryptedPayload {
  /** RSA-OAEP encrypted AES-256 key (Base64 encoded) */
  encrypted_key: string;

  /** AES-256-GCM encrypted request body (Base64 encoded) */
  encrypted_data: string;

  /** AES-GCM nonce/IV (12 bytes, Base64 encoded) */
  nonce: string;

  /** AES-GCM authentication tag (16 bytes, Base64 encoded) */
  tag: string;

  /** Encryption algorithm version */
  algorithm?: EncryptionAlgorithm;

  /** Client timestamp for server validation */
  timestamp?: number;
}

/**
 * Decrypted batch request after decryption
 */
export interface DecryptedBatchRequest {
  events?: unknown[];
  perf?: unknown[];
  errors?: unknown[];
  conversations?: unknown[];
  installs?: unknown[];
  timestamp?: number;
}

/**
 * Encryption configuration
 */
export interface EncryptionConfig {
  /** RSA private key PEM (server-side) */
  privateKeyPem?: string;

  /** Whether encryption is required for requests */
  encryptionRequired: boolean;

  /** Encryption algorithm version */
  algorithm: EncryptionAlgorithm;

  /** RSA parameters */
  rsa: {
    modulusLength: 2048;
    hash: "SHA-256";
    algorithm: "RSA-OAEP";
  };

  /** AES parameters */
  aes: {
    algorithm: "AES-GCM";
    keyLength: 256;
    nonceLength: 12;
    tagLength: 16;
  };
}

/**
 * Encryption error codes
 */
export type EncryptionErrorCode =
  | "ENCRYPTION_REQUIRED"
  | "DECRYPTION_FAILED"
  | "INVALID_PAYLOAD"
  | "RSA_DECRYPT_ERROR"
  | "AES_DECRYPT_ERROR"
  | "INVALID_PRIVATE_KEY";

/**
 * Encryption error response
 */
export interface EncryptionError {
  code: EncryptionErrorCode;
  message: string;
}

/**
 * Check if request body is encrypted
 */
export function isEncryptedPayload(body: unknown): body is EncryptedPayload {
  if (!body || typeof body !== "object") return false;
  const payload = body as Record<string, unknown>;
  return (
    typeof payload.encrypted_key === "string" &&
    typeof payload.encrypted_data === "string" &&
    typeof payload.nonce === "string" &&
    typeof payload.tag === "string"
  );
}