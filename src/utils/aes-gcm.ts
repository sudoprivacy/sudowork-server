/**
 * AES-256-GCM symmetric encryption utility.
 *
 * 与 src/qms/middleware/decrypt.ts 的 AES 部分使用同一套约定:
 *   AES-256-GCM / 12 字节随机 nonce / 16 字节 tag / WebCrypto subtle.
 * subtle.encrypt 在 GCM 模式返回 "密文 + tag" 拼接, 整体 Base64,
 * 与 decrypt.ts "ciphertext + tag 拼接后传入 subtle.decrypt" 完全对应,
 * 客户端可用同一套方式解密。
 *
 * 纯工具, 不内嵌任何 key (遵循项目惯例, 见 crypto.ts / decrypt.ts);
 * key 由调用方传入。
 */

const NONCE_LENGTH = 12;

export interface GcmEncrypted {
  /** 12 字节 nonce/IV, Base64 */
  nonce: string;
  /** 密文 + 16 字节 tag 拼接, Base64 */
  ciphertext: string;
}

/**
 * 用 AES-256-GCM 加密明文。
 * @param plaintext 明文字节
 * @param key       32 字节 (256 bit) AES key
 *
 * 注:Bun + TS strict 下 `Uint8Array<ArrayBufferLike>` 与 WebCrypto `BufferSource`
 * 类型存在不兼容(TS2769/TS2345),需要 `as any` 强制断言。这是项目惯例,与
 * src/qms/middleware/decrypt.ts:129/144/148/174 同款处理。运行时语义无影响,
 * Uint8Array 本身就是有效的 BufferSource。
 */
export async function encryptGcm(
  plaintext: Uint8Array,
  key: Uint8Array,
): Promise<GcmEncrypted> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as any,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as any },
    cryptoKey,
    plaintext as any,
  );

  return {
    nonce: Buffer.from(nonce).toString("base64"),
    ciphertext: Buffer.from(new Uint8Array(encryptedBuffer)).toString("base64"),
  };
}

/**
 * 用 AES-256-GCM 解密 Base64 nonce/ciphertext, 与 encryptGcm 对称。
 * 参考 src/qms/middleware/decrypt.ts:132-151 的 subtle.decrypt 模式 (importKey "raw" + as any)。
 */
export async function decryptGcm(
  nonceBase64: string,
  ciphertextBase64: string,
  key: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as any,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  const nonce = Buffer.from(nonceBase64, "base64");
  const ciphertext = Buffer.from(ciphertextBase64, "base64");

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce as any },
    cryptoKey,
    ciphertext as any,
  );

  return new Uint8Array(decryptedBuffer);
}
