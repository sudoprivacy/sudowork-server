/**
 * Decrypt middleware for hybrid RSA + AES-GCM encryption
 *
 * Client encrypts with RSA-2048 public key + AES-256-GCM
 * Server decrypts with RSA-2048 private key
 */

import type { Context, Next } from "hono";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import type {
  EncryptedPayload,
  DecryptedBatchRequest,
  EncryptionError,
} from "../types/encryption.js";
import { isEncryptedPayload } from "../types/encryption.js";

declare module "hono" {
  interface ContextVariableMap {
    decryptedBody: unknown;
    wasEncrypted: boolean;
  }
}

/**
 * RSA-2048 + AES-256-GCM hybrid decryption middleware
 *
 * Flow:
 * 1. Check if request has encryption header or encrypted payload
 * 2. If encrypted: RSA-OAEP decrypt AES key, then AES-GCM decrypt body
 * 3. If plaintext + encryption required: reject
 * 4. If plaintext + encryption optional: proceed
 */
export async function decryptMiddleware(c: Context, next: Next) {
  const privateKeyPem = config.encryption.privateKeyPem;
  const encryptionRequired = config.encryption.encryptionRequired;

  // No private key configured - skip decryption
  if (!privateKeyPem) {
    if (encryptionRequired) {
      logger.warn("[DecryptMiddleware] Encryption required but no private key configured");
      return c.json<EncryptionError>(
        { code: "INVALID_PRIVATE_KEY", message: "Encryption configured but private key missing" },
        500
      );
    }
    await next();
    return;
  }

  // Check encryption header
  const encryptionHeader = c.req.header("X-Encryption");

  try {
    // Clone request body for parsing (can only read once)
    const body = await c.req.json();

    // Check if body is encrypted payload
    if (!isEncryptedPayload(body)) {
      if (encryptionRequired) {
        logger.warn("[DecryptMiddleware] Plaintext request rejected (encryption required)");
        return c.json<EncryptionError>(
          { code: "ENCRYPTION_REQUIRED", message: "Encryption required for this endpoint" },
          400
        );
      }
      // Plaintext request, allowed - set body directly
      c.set("decryptedBody", body as DecryptedBatchRequest);
      await next();
      return;
    }

    // Decrypt the payload
    logger.debug("[DecryptMiddleware] Decrypting hybrid-v1 payload");
    const decrypted = await decryptPayload(body, privateKeyPem);
    logger.debug("[DecryptMiddleware] Decrypted plaintext payload", decrypted);
    c.set("decryptedBody", decrypted as DecryptedBatchRequest);

    // Set flag that request was encrypted
    c.set("wasEncrypted", true);

    await next();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("[DecryptMiddleware] Decryption failed:", errorMessage);

    // Determine error code based on error type
    let errorCode: EncryptionError["code"] = "DECRYPTION_FAILED";
    if (errorMessage.includes("RSA") || errorMessage.includes("decrypt")) {
      errorCode = "RSA_DECRYPT_ERROR";
    } else if (errorMessage.includes("AES") || errorMessage.includes("tag")) {
      errorCode = "AES_DECRYPT_ERROR";
    }

    return c.json<EncryptionError>(
      { code: errorCode, message: "Decryption failed" },
      400
    );
  }
}

/**
 * Decrypt hybrid encrypted payload
 *
 * Steps:
 * 1. Import RSA private key
 * 2. Base64 decode components
 * 3. RSA-OAEP decrypt AES key
 * 4. AES-GCM decrypt data with key + nonce + tag
 * 5. Parse JSON result
 */
async function decryptPayload(
  payload: EncryptedPayload,
  privateKeyPem: string
): Promise<unknown> {
  // Step 1: Import RSA private key
  const privateKey = await importPrivateKey(privateKeyPem);

  // Step 2: Base64 decode all components
  const encryptedKey = base64ToBuffer(payload.encrypted_key);
  const encryptedData = base64ToBuffer(payload.encrypted_data);
  const nonce = base64ToBuffer(payload.nonce);
  const tag = base64ToBuffer(payload.tag);

  // Step 3: RSA-OAEP decrypt to get AES key
  const aesKeyBuffer = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    encryptedKey as any
  );

  // Import AES key
  const aesKey = await crypto.subtle.importKey(
    "raw",
    aesKeyBuffer,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  // Step 4: Combine ciphertext and tag for AES-GCM (output format)
  const ciphertextWithTag = new Uint8Array(encryptedData.length + tag.length);
  ciphertextWithTag.set(encryptedData, 0);
  ciphertextWithTag.set(tag, encryptedData.length);

  // AES-GCM decrypt
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce as any },
    aesKey,
    ciphertextWithTag as any
  );

  // Step 5: Parse JSON
  const plaintext = new TextDecoder().decode(decryptedBuffer);
  return JSON.parse(plaintext);
}

/**
 * Import RSA private key from PEM format
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Strip PEM headers and whitespace
  const base64Key = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  // Decode Base64 to binary
  const keyBuffer = base64ToBuffer(base64Key);

  // Import as PKCS8 private key
  return await crypto.subtle.importKey(
    "pkcs8",
    keyBuffer as any,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"]
  );
}

/**
 * Base64 decode to Uint8Array
 *
 * Handles both standard and URL-safe Base64
 */
function base64ToBuffer(base64: string): Uint8Array {
  // Convert URL-safe Base64 to standard
  const standardBase64 = base64.replace(/-/g, "+").replace(/_/g, "/");

  // Decode
  const binary = atob(standardBase64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
