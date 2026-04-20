/**
 * Pinyin utility for config item name conversion
 */
import pinyin from "pinyin";
import { db } from "../db/index.js";

/**
 * Convert Chinese text to lowercase pinyin string (no spaces, no tones)
 * Example: "建设库" => "jiansheku"
 */
export function textToPinyin(text: string): string {
  const result = pinyin(text, { style: pinyin.STYLE_NORMAL });
  return result.flat().join("").toLowerCase();
}

/**
 * Generate a unique pinyin for a config item name.
 * If the base pinyin already exists, appends _1, _2, etc.
 */
export function generateUniquePinyin(name: string): string {
  const base = textToPinyin(name);
  if (!base) {
    return `item_${Date.now()}`;
  }

  // Check if base pinyin is available
  const existing = db
    .prepare("SELECT id FROM config_items WHERE pinyin = ?")
    .get(base);
  if (!existing) return base;

  // Find next available suffix
  let suffix = 1;
  while (true) {
    const candidate = `${base}_${suffix}`;
    const existing = db
      .prepare("SELECT id FROM config_items WHERE pinyin = ?")
      .get(candidate);
    if (!existing) return candidate;
    suffix++;
  }
}
