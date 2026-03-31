/**
 * Fuiou Payment Service
 * Handles Fuiou payment API integration
 */

import { RsaCrypto, fetchWithTimeout } from "../utils/crypto.js";
import iconv from "iconv-lite";

// 默认 API 地址
const DEFAULT_TEST_URL = "https://hlwnets-test.fuioupay.com";
const DEFAULT_PROD_URL = "https://hlwnets.fuioupay.com";

// 富友支付使用 GBK 编码
const FUIOU_CHARSET = "GBK";

// ==================== Type Definitions ====================

interface FuiouConfig {
  isTest: boolean;
  merchantCode: string;
  callbackUrl: string;
  timeoutMs: number;
  testApiUrl: string;
  prodApiUrl: string;
  // Private key (3 ways)
  merchantPrivateKeyPem?: string;
  merchantPrivateKeyBase64?: string;
  merchantPrivateKeyFile?: string;
  // Public key (3 ways)
  fuiouPublicKeyPem?: string;
  fuiouPublicKeyBase64?: string;
  fuiouPublicKeyFile?: string;
}

export interface OrderRequest {
  orderId: string;
  orderDate: string;
  orderAmt: string;
  orderPayType: "ALIPAY" | "WECHAT";
  goodsName: string;
  goodsDetail: string;
}

export interface OrderResponse {
  orderDate: string;
  orderPayType: string;
  orderAmt: string;
  mchntCd: string;
  orderId: string;
  orderInfo: string;
}

export interface CallbackPayload {
  mchnt_cd: string;
  message: string;
  resp_code: string;
  resp_desc: string;
}

export interface CallbackMessage {
  orderId: string;
  orderSt: "1" | "2";
  orderAmt: string;
  orderDate: string;
}

export interface QueryResponse {
  orderId: string;
  orderSt: string;
  orderAmt: string;
  orderDate: string;
}

// API call result interface (reused from SudorouterService pattern)
export interface ApiCallResult<T> {
  success: boolean;
  data: T | null;
  request: {
    method: string;
    url: string;
    body?: any;
  };
  response: {
    status: number;
    data: any;
  };
  duration_ms: number;
  error?: string;
}

// ==================== FuiouPayService Class ====================

class FuiouPayService {
  private config: FuiouConfig;
  private baseUrl: string;
  private rsa: RsaCrypto;
  private initialized: boolean = false;

  constructor() {
    this.config = this.loadConfig();
    this.baseUrl = this.config.isTest
      ? this.config.testApiUrl
      : this.config.prodApiUrl;
    this.rsa = new RsaCrypto();
  }

  private loadConfig(): FuiouConfig {
    return {
      isTest: process.env.FUIOU_TEST_MODE === "true",
      merchantCode: process.env.FUIOU_MERCHANT_CODE || "",
      callbackUrl: `${process.env.SERVER_URL || "http://localhost:3000"}/api/v1/recharge/callback`,
      timeoutMs: parseInt(process.env.FUIOU_TIMEOUT_MS || "10000"),
      testApiUrl: process.env.FUIOU_TEST_API_URL || DEFAULT_TEST_URL,
      prodApiUrl: process.env.FUIOU_PROD_API_URL || DEFAULT_PROD_URL,
      merchantPrivateKeyPem: process.env.FUIOU_MERCHANT_PRIVATE_KEY,
      merchantPrivateKeyBase64: process.env.FUIOU_MERCHANT_PRIVATE_KEY_BASE64,
      merchantPrivateKeyFile: process.env.FUIOU_MERCHANT_PRIVATE_KEY_FILE,
      fuiouPublicKeyPem: process.env.FUIOU_PUBLIC_KEY,
      fuiouPublicKeyBase64: process.env.FUIOU_PUBLIC_KEY_BASE64,
      fuiouPublicKeyFile: process.env.FUIOU_PUBLIC_KEY_FILE,
    };
  }

  /**
   * Initialize the service (load keys)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load private key
      if (this.config.merchantPrivateKeyFile) {
        await this.rsa.loadKeyFromFile(this.config.merchantPrivateKeyFile, "private");
      } else if (this.config.merchantPrivateKeyBase64) {
        this.rsa.loadKeyFromBase64(this.config.merchantPrivateKeyBase64, "private");
      } else if (this.config.merchantPrivateKeyPem) {
        this.rsa.loadPrivateKey(this.config.merchantPrivateKeyPem);
      } else {
        throw new Error("Merchant private key not configured");
      }

      // Load public key
      if (this.config.fuiouPublicKeyFile) {
        await this.rsa.loadKeyFromFile(this.config.fuiouPublicKeyFile, "public");
      } else if (this.config.fuiouPublicKeyBase64) {
        this.rsa.loadKeyFromBase64(this.config.fuiouPublicKeyBase64, "public");
      } else if (this.config.fuiouPublicKeyPem) {
        this.rsa.loadPublicKey(this.config.fuiouPublicKeyPem);
      } else {
        throw new Error("Fuiou public key not configured");
      }

      this.initialized = true;
      console.log(`[FuiouPay] Initialized (test mode: ${this.config.isTest})`);
    } catch (error) {
      console.error("[FuiouPay] Failed to initialize:", error);
      throw error;
    }
  }

  /**
   * Check if service is configured
   */
  isConfigured(): boolean {
    return !!(
      this.config.merchantCode &&
      (this.config.merchantPrivateKeyFile ||
        this.config.merchantPrivateKeyBase64 ||
        this.config.merchantPrivateKeyPem) &&
      (this.config.fuiouPublicKeyFile ||
        this.config.fuiouPublicKeyBase64 ||
        this.config.fuiouPublicKeyPem)
    );
  }

  /**
   * Create payment order
   */
  async createOrder(request: OrderRequest): Promise<ApiCallResult<OrderResponse>> {
    if (!this.initialized) {
      await this.initialize();
    }

    const url = `${this.baseUrl}/aggpos/order.fuiou`;
    const startTime = Date.now();

    // Build request message (match official demo format)
    const message: Record<string, string> = {
      mchnt_cd: this.config.merchantCode,
      order_date: request.orderDate,
      order_id: request.orderId,
      order_amt: request.orderAmt,
      order_pay_type: request.orderPayType,
      back_notify_url: this.config.callbackUrl,
      goods_name: request.goodsName,
      goods_detail: request.goodsDetail,
      appid: "", // 小程序/公众号支付必传
      openid: "", // 小程序/公众号支付必传
      ver: "1.0.0",
    };

    const messageJson = JSON.stringify(message);
    // 富友支付要求使用 GBK 编码
    const messageBuffer = iconv.encode(messageJson, FUIOU_CHARSET);
    const encryptedMessage = this.rsa.encryptWithPublicKey(messageBuffer);
    const requestBody = {
      mchnt_cd: this.config.merchantCode,
      message: encryptedMessage.toString("base64"),
    };

    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json;charset=UTF-8" },
          body: JSON.stringify(requestBody),
        },
        this.config.timeoutMs
      );

      const data = (await response.json()) as any;
      const duration = Date.now() - startTime;

      if (data.resp_code !== "0000") {
        return {
          success: false,
          data: null,
          request: { method: "POST", url, body: requestBody },
          response: { status: response.status, data },
          duration_ms: duration,
          error: `Fuiou payment failed: ${data.resp_code} - ${data.resp_desc}`,
        };
      }

      // Decrypt response - 富友返回的数据也使用 GBK 编码
      const decryptedMessage = this.rsa.decryptWithPrivateKey(
        Buffer.from(data.message, "base64")
      );
      const decryptedJson = iconv.decode(decryptedMessage, FUIOU_CHARSET);
      const orderResponse: OrderResponse = JSON.parse(decryptedJson);

      return {
        success: true,
        data: orderResponse,
        request: { method: "POST", url, body: requestBody },
        response: { status: response.status, data },
        duration_ms: duration,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const errorMsg =
        error.name === "AbortError"
          ? `Request timeout (${this.config.timeoutMs}ms)`
          : `Network error: ${error.message}`;

      return {
        success: false,
        data: null,
        request: { method: "POST", url, body: requestBody },
        response: { status: 0, data: null },
        duration_ms: duration,
        error: errorMsg,
      };
    }
  }

  /**
   * Handle payment callback
   *
   * Security validation:
   * 1. Verify response code
   * 2. Verify merchant code
   * 3. RSA decrypt and verify signature
   */
  async handleCallback(payload: CallbackPayload): Promise<CallbackMessage> {
    if (!this.initialized) {
      await this.initialize();
    }

    // 1. Verify response code
    if (payload.resp_code !== "0000") {
      throw new Error(`Callback failed: ${payload.resp_code} - ${payload.resp_desc}`);
    }

    // 2. Verify merchant code (prevent forgery)
    if (payload.mchnt_cd !== this.config.merchantCode) {
      throw new Error(
        `Merchant code mismatch: expected ${this.config.merchantCode}, got ${payload.mchnt_cd}`
      );
    }

    // 3. RSA decrypt - 富友返回的数据使用 GBK 编码
    const decryptedMessage = this.rsa.decryptWithPrivateKey(
      Buffer.from(payload.message, "base64")
    );
    const decryptedJson = iconv.decode(decryptedMessage, FUIOU_CHARSET);
    const callbackMessage: CallbackMessage = JSON.parse(decryptedJson);

    return callbackMessage;
  }

  /**
   * Query order status
   */
  async queryOrder(orderId: string, orderDate: string): Promise<ApiCallResult<QueryResponse>> {
    if (!this.initialized) {
      await this.initialize();
    }

    const url = `${this.baseUrl}/aggpos/orderQuery.fuiou`;
    const startTime = Date.now();

    const message = {
      mchnt_cd: this.config.merchantCode,
      order_date: orderDate,
      order_id: orderId,
      appid: "",
      openid: "",
      ver: "1.0.1",
    };

    const messageJson = JSON.stringify(message);
    // 富友支付要求使用 GBK 编码
    const messageBuffer = iconv.encode(messageJson, FUIOU_CHARSET);
    const encryptedMessage = this.rsa.encryptWithPublicKey(messageBuffer);
    const requestBody = {
      mchnt_cd: this.config.merchantCode,
      message: encryptedMessage.toString("base64"),
    };

    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json;charset=UTF-8" },
          body: JSON.stringify(requestBody),
        },
        this.config.timeoutMs
      );

      const data = (await response.json()) as any;
      const duration = Date.now() - startTime;

      if (data.resp_code !== "0000") {
        return {
          success: false,
          data: null,
          request: { method: "POST", url, body: requestBody },
          response: { status: response.status, data },
          duration_ms: duration,
          error: `Query failed: ${data.resp_code}`,
        };
      }

      // Decrypt response - 富友返回的数据也使用 GBK 编码
      const decryptedMessage = this.rsa.decryptWithPrivateKey(
        Buffer.from(data.message, "base64")
      );
      const decryptedJson = iconv.decode(decryptedMessage, FUIOU_CHARSET);
      const queryResponse: QueryResponse = JSON.parse(decryptedJson);

      return {
        success: true,
        data: queryResponse,
        request: { method: "POST", url, body: requestBody },
        response: { status: response.status, data },
        duration_ms: duration,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        data: null,
        request: { method: "POST", url, body: requestBody },
        response: { status: 0, data: null },
        duration_ms: duration,
        error: error.message,
      };
    }
  }

  /**
   * Get merchant code for validation
   */
  getMerchantCode(): string {
    return this.config.merchantCode;
  }

  /**
   * Check if test mode
   */
  isTestMode(): boolean {
    return this.config.isTest;
  }
}

// Export singleton
export const fuiouPayService = new FuiouPayService();