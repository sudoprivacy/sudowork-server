import type { ThirdPartyAuthProviderConfig } from "./SystemConfigService.js";

export class CasAuthServiceError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface CasUserProfile {
  user: string;
  username: string;
  account: string;
  nickname: string;
  isActive: boolean;
  attributes: Record<string, string>;
}

class CasAuthService {
  async validateTicket(
    provider: ThirdPartyAuthProviderConfig,
    service: string,
    ticket: string,
  ): Promise<CasUserProfile> {
    const url = this.buildValidateUrl(provider, service, ticket);
    const response = await fetch(url, { method: "GET" });
    const xml = await response.text();

    if (!response.ok) {
      throw new CasAuthServiceError(
        502,
        `CAS 服务校验失败: HTTP ${response.status}`,
      );
    }

    return this.parseValidateResponse(xml);
  }

  private buildValidateUrl(
    provider: ThirdPartyAuthProviderConfig,
    service: string,
    ticket: string,
  ): string {
    const url = new URL(provider.validate_path, provider.cas_url);
    url.searchParams.set(provider.service_param || "service", service);
    url.searchParams.set("ticket", ticket);
    return url.toString();
  }

  private parseValidateResponse(xml: string): CasUserProfile {
    const failure = getXmlTagValue(xml, "authenticationFailure");
    if (failure) {
      throw new CasAuthServiceError(401, `CAS 认证失败: ${failure}`);
    }

    const user = getXmlTagValue(xml, "user");
    if (!user) {
      throw new CasAuthServiceError(401, "CAS 响应缺少用户标识");
    }

    const attributesXml = getXmlTagValue(xml, "attributes") || "";
    const attributes: Record<string, string> = {};
    for (const key of [
      "username",
      "first_name",
      "last_name",
      "email",
      "phone",
      "mobile",
      "is_active",
    ]) {
      const value = getXmlTagValue(attributesXml, key);
      if (value !== undefined) {
        attributes[key] = value;
      }
    }

    const username = attributes.username || user;
    const account =
      attributes.email ||
      attributes.phone ||
      attributes.mobile ||
      username ||
      user;
    const nickname =
      [attributes.first_name, attributes.last_name]
        .filter((item) => item && item.trim().length > 0)
        .join(" ")
        .trim() || username;
    const isActive = parseCasActiveFlag(attributes.is_active);

    return {
      user,
      username,
      account,
      nickname,
      isActive,
      attributes,
    };
  }
}

function getXmlTagValue(xml: string, tagName: string): string | undefined {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${escapedTagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escapedTagName}>`,
    "i",
  );
  const match = xml.match(pattern);
  if (!match?.[1]) {
    return undefined;
  }
  return decodeXmlEntities(match[1].trim());
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseCasActiveFlag(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }
  return !["0", "false", "no", "disabled"].includes(value.trim().toLowerCase());
}

export const casAuthService = new CasAuthService();
