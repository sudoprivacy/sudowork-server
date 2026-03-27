/**
 * 从 Sudorouter 同步用户数据到本地数据库
 */

import { Database } from "bun:sqlite";

const db = new Database("./sudowork.db");

// Sudorouter 配置
const SUDOROUTER_BASE_URL = "http://10.0.1.8:3000";
const SUDOROUTER_API_TOKEN = "7Rbb+omsFuRRIGEfhjpf5ESlRNhlkcq0";
const SUDOROUTER_ADMIN_USER_ID = "13";

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${SUDOROUTER_API_TOKEN}`,
  "New-Api-User": SUDOROUTER_ADMIN_USER_ID,
};

interface SudorouterUser {
  id: number;
  username: string;
  display_name: string;
  status: number;
  quota: number;
  used_quota: number;
  utm_source: string;
}

interface SudorouterToken {
  key: string;
}

// 获取所有用户
async function getUsers(): Promise<SudorouterUser[]> {
  const res = await fetch(`${SUDOROUTER_BASE_URL}/api/user/?page_num=1&page_size=100`, {
    headers,
  });
  const data = await res.json();
  if (data.success && data.data?.items) {
    // 过滤出手机号格式的用户（11位数字）
    return data.data.items.filter((u: SudorouterUser) => /^1\d{10}$/.test(u.username));
  }
  return [];
}

// 获取用户的 token
async function getUserToken(userId: number): Promise<string | null> {
  const res = await fetch(`${SUDOROUTER_BASE_URL}/api/token/?user_id=${userId}`, {
    headers,
  });
  const data = await res.json();
  if (data.success && data.data?.items?.length > 0) {
    return data.data.items[0].key;
  }
  return null;
}

// 为用户创建 token
async function createToken(userId: number, username: string): Promise<string | null> {
  const res = await fetch(`${SUDOROUTER_BASE_URL}/api/token/`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: `${username}-token`,
      expired_time: -1,
      unlimited_quota: true,
      user_id: userId,
    }),
  });
  const data = await res.json();
  if (data.success && data.data?.key) {
    console.log(`  Created token for ${username}`);
    return data.data.key;
  }
  console.error(`  Failed to create token for ${username}:`, data.message);
  return null;
}

// 获取企业 ID
function getEnterpriseId(): number {
  const ent = db.prepare("SELECT id FROM enterprises WHERE code = 'sudo'").get() as any;
  return ent?.id || 1;
}

// 检查用户是否已存在
function userExists(phone: string): boolean {
  const user = db.prepare("SELECT id FROM users WHERE phone = ?").get(phone);
  return !!user;
}

// 插入用户
function insertUser(
  phone: string,
  sudorouterUserId: number,
  sudorouterKey: string,
  quota: number,
  usedQuota: number,
  enterpriseId: number
): void {
  const balance = Math.round(quota * 0.002);
  db.run(
    `INSERT INTO users (phone, nickname, role, status, enterprise_id, sudorouter_user_id, sudorouter_key, quota, used_quota, balance)
     VALUES (?, ?, 'USER', 1, ?, ?, ?, ?, ?, ?)`,
    [phone, phone, enterpriseId, sudorouterUserId, sudorouterKey, quota, usedQuota, balance]
  );
}

async function main() {
  console.log("=== 从 Sudorouter 同步用户数据 ===\n");

  // 获取企业 ID
  const enterpriseId = getEnterpriseId();
  console.log(`Enterprise ID: ${enterpriseId}\n`);

  // 获取所有 sudowork 用户
  const users = await getUsers();
  console.log(`找到 ${users.length} 个 sudowork 用户\n`);

  let synced = 0;
  let skipped = 0;

  for (const user of users) {
    const phone = user.username;
    console.log(`处理用户: ${phone} (sudorouter_id: ${user.id})`);

    // 检查是否已存在
    if (userExists(phone)) {
      console.log(`  已存在，跳过`);
      skipped++;
      continue;
    }

    // 获取或创建 token
    let token = await getUserToken(user.id);
    if (!token) {
      token = await createToken(user.id, phone);
    }

    if (!token) {
      console.log(`  无法获取 token，跳过`);
      continue;
    }

    // 插入用户
    insertUser(phone, user.id, token, user.quota, user.used_quota, enterpriseId);
    console.log(`  同步成功，余额: ${Math.round(user.quota * 0.002)} 积分`);
    synced++;
  }

  console.log(`\n=== 同步完成 ===`);
  console.log(`同步: ${synced} 个用户`);
  console.log(`跳过: ${skipped} 个用户`);
}

main().catch(console.error);