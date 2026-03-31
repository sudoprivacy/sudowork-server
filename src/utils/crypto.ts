/**
 * RSA Crypto utilities for Fuiou Payment API
 * Uses node-forge (pure JS) for PKCS1 v1.5 padding support
 * Bun's crypto doesn't support PKCS1 for private decryption
 */

import forge from "node-forge";
import iconv from "iconv-lite";

const FUIOU_CHARSET = "GBK";

/**
 * RSA Crypto class for Fuiou payment integration
 * Uses node-forge library for PKCS1 v1.5 padding support
 */
export class RsaCrypto {
  private publicKey: forge.pki.rsa.PublicKey | null = null;
  private privateKey: forge.pki.rsa.PrivateKey | null = null;
  private keySize: number = 1024;

  /**
   * Normalize key format - handles raw Base64 from Fuiou docs
   */
  private normalizeKey(key: string, type: "public" | "private"): string {
    // Replace \n escape sequences with actual newlines
    let normalizedKey = key.replace(/\\n/g, "\n");

    // If no PEM headers, add them (support raw Base64 from Fuiou docs)
    if (!normalizedKey.includes("-----BEGIN")) {
      const header =
        type === "public" ? "-----BEGIN PUBLIC KEY-----" : "-----BEGIN PRIVATE KEY-----";
      const footer =
        type === "public" ? "-----END PUBLIC KEY-----" : "-----END PRIVATE KEY-----";
      normalizedKey = `${header}\n${normalizedKey}\n${footer}`;
    }

    return normalizedKey;
  }

  /**
   * Convert Buffer to forge bytes (binary string)
   */
  private bufferToForgeBytes(buffer: Buffer): string {
    return Array.from(buffer)
      .map((b) => String.fromCharCode(b))
      .join("");
  }

  /**
   * Convert forge bytes (binary string) to Buffer
   */
  private forgeBytesToBuffer(bytes: string): Buffer {
    return Buffer.from(
      bytes.split("").map((c) => c.charCodeAt(0))
    );
  }

  /**
   * Load public key from PEM format string
   */
  loadPublicKey(pemKey: string): void {
    const normalizedKey = this.normalizeKey(pemKey, "public");
    this.publicKey = forge.pki.publicKeyFromPem(normalizedKey);
    this.keySize = this.publicKey.n.bitLength();

    if (process.env.NODE_ENV !== "production") {
      console.log(`[RsaCrypto] Loaded public key, size: ${this.keySize} bits`);
    }
  }

  /**
   * Load private key from PEM format string
   */
  loadPrivateKey(pemKey: string): void {
    const normalizedKey = this.normalizeKey(pemKey, "private");
    this.privateKey = forge.pki.decryptRsaPrivateKey(normalizedKey);
    this.keySize = this.privateKey.n.bitLength();

    if (process.env.NODE_ENV !== "production") {
      console.log(`[RsaCrypto] Loaded private key, size: ${this.keySize} bits`);
    }
  }

  /**
   * Load key from file
   */
  async loadKeyFromFile(filePath: string, type: "public" | "private"): Promise<void> {
    const file = Bun.file(filePath);
    const pemKey = await file.text();

    if (type === "public") {
      this.loadPublicKey(pemKey);
    } else {
      this.loadPrivateKey(pemKey);
    }
  }

  /**
   * Load key from Base64 encoded PEM
   */
  loadKeyFromBase64(base64Key: string, type: "public" | "private"): void {
    const pemKey = Buffer.from(base64Key, "base64").toString("utf-8");

    if (type === "public") {
      this.loadPublicKey(pemKey);
    } else {
      this.loadPrivateKey(pemKey);
    }
  }

  /**
   * RSA public key encryption (chunked for large data)
   * Uses PKCS1 v1.5 padding (required by Fuiou)
   * Data is encoded as GBK before encryption (Fuiou requirement)
   * For RSA 1024-bit key: chunk size = 128 - 11 (padding) = 117 bytes
   */
  encryptWithPublicKey(data: Buffer): Buffer {
    if (!this.publicKey) {
      throw new Error("Public key not loaded");
    }

    const blockSize = Math.floor(this.keySize / 8) - 11; // 117 for 1024-bit key
    const chunks: string[] = [];

    for (let i = 0; i < data.length; i += blockSize) {
      const chunk = data.subarray(i, Math.min(i + blockSize, data.length));
      // Convert Buffer chunk to forge bytes
      const forgeBytes = this.bufferToForgeBytes(chunk);
      // Encrypt with PKCS1 v1.5 padding
      const encrypted = this.publicKey.encrypt(forgeBytes, "RSAES-PKCS1-V1_5");
      chunks.push(encrypted);
    }

    // Concatenate all encrypted chunks and convert to Buffer
    const encryptedForgeBytes = chunks.join("");
    return this.forgeBytesToBuffer(encryptedForgeBytes);
  }

  /**
   * RSA private key decryption (chunked)
   * Uses PKCS1 v1.5 padding (required by Fuiou)
   * Returns data that should be decoded as GBK (Fuiou requirement)
   */
  decryptWithPrivateKey(data: Buffer): Buffer {
    if (!this.privateKey) {
      throw new Error("Private key not loaded");
    }

    const blockSize = Math.floor(this.keySize / 8); // 128 for 1024-bit key
    const chunks: string[] = [];

    for (let i = 0; i < data.length; i += blockSize) {
      const chunk = data.subarray(i, Math.min(i + blockSize, data.length));
      // Convert Buffer chunk to forge bytes
      const forgeBytes = this.bufferToForgeBytes(chunk);
      // Decrypt with PKCS1 v1.5 padding
      const decrypted = this.privateKey.decrypt(forgeBytes, "RSAES-PKCS1-V1_5");
      chunks.push(decrypted);
    }

    // Concatenate all decrypted chunks and convert to Buffer
    const decryptedForgeBytes = chunks.join("");
    return this.forgeBytesToBuffer(decryptedForgeBytes);
  }

  /**
   * Check if public key is loaded
   */
  hasPublicKey(): boolean {
    return this.publicKey !== null;
  }

  /**
   * Check if private key is loaded
   */
  hasPrivateKey(): boolean {
    return this.privateKey !== null;
  }

  /**
   * Get key size in bits
   */
  getKeySize(): number {
    return this.keySize;
  }
}

/**
 * Fetch with timeout
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Encode string to GBK Buffer (for Fuiou API)
 */
export function encodeGBK(str: string): Buffer {
  return iconv.encode(str, FUIOU_CHARSET);
}

/**
 * Decode GBK Buffer to string (for Fuiou API response)
 */
export function decodeGBK(buffer: Buffer): string {
  return iconv.decode(buffer, FUIOU_CHARSET);
}