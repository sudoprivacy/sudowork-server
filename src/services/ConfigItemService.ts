import { db } from "../db/index.js";
import { redis } from "../redis.js";

export interface ConfigEntry {
  id: number;
  config_key: string;
  name: string;
  config_desc: string | null;
  required: number;
}

export interface ConfigItemWithEntries {
  id: number;
  name: string;
  icon: string | null;
  icon_url: string;
  pinyin: string | null;
  url_pattern: string | null;
  entries: ConfigEntry[];
}

const CACHE_PREFIX = "config_items:";
const CACHE_TTL_SECONDS = 300; // 5 minutes
const DEFAULT_ICON_URL = "/config-item-default.svg";

function getIconUrl(icon: string | null): string {
  if (icon) {
    return `/uploads/config-items/${icon}`;
  }
  return DEFAULT_ICON_URL;
}

export async function getConfigItemsForEnterprise(
  enterpriseId: number
): Promise<ConfigItemWithEntries[]> {
  const cacheKey = `${CACHE_PREFIX}${enterpriseId}`;

  // Try cache first
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as ConfigItemWithEntries[];
    }
  } catch (error) {
    console.error("[ConfigItemService] Redis get error:", error);
  }

  // Query DB
  const rows = db
    .prepare(
      `
      SELECT
        ci.id,
        ci.name,
        ci.icon,
        ci.pinyin,
        ci.url_pattern,
        ce.id AS entry_id,
        ce.config_key,
        ce.name AS entry_name,
        ce.config_desc,
        ce.required
      FROM config_enterprise_rel cer
      JOIN config_items ci ON ci.id = cer.config_item_id
      JOIN config_entries ce ON ce.config_item_id = ci.id
      WHERE cer.enterprise_id = ?
        AND ci.status = 1
      ORDER BY ci.id, ce.id
      `
    )
    .all(enterpriseId) as any[];

  // Group entries under their parent config item
  const itemMap = new Map<number, ConfigItemWithEntries>();
  for (const row of rows) {
    if (!itemMap.has(row.id)) {
      itemMap.set(row.id, {
        id: row.id,
        name: row.name,
        icon: row.icon || null,
        icon_url: getIconUrl(row.icon),
        pinyin: row.pinyin || null,
        url_pattern: row.url_pattern || null,
        entries: [],
      });
    }
    itemMap.get(row.id)!.entries.push({
      id: row.entry_id,
      config_key: row.config_key,
      name: row.entry_name,
      config_desc: row.config_desc,
      required: row.required !== undefined ? row.required : 1,
    });
  }

  const result = Array.from(itemMap.values());

  // Write to cache
  try {
    await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result));
  } catch (error) {
    console.error("[ConfigItemService] Redis setex error:", error);
  }

  return result;
}
