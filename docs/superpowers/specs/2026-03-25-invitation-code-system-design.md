# sudowork-server 邀请码系统与 Sudorouter 集成设计文档

**日期**: 2026-03-25
**版本**: v1.0
**状态**: 待实现

---

## 一、需求概述

| 项目 | 变更内容 |
|------|----------|
| 企业数据 | 清理数据库，只保留一个默认企业（编码：sudo，名称：数牍科技） |
| 邀请码系统 | 新增邀请码功能，支持批量创建、一对一绑定用户 |
| 登录流程 | 隐藏企业码（固定 sudo），用户输入：手机号 + 短信验证码 + 邀请码 |
| 用户创建 | 新用户自动创建并同步到 sudorouter，状态默认已批准 |
| 积分同步 | 用户积分从 sudorouter 额度实时同步（积分 = 额度 × 0.002） |
| 使用流水 | 从 sudorouter 获取用户使用日志 |

---

## 二、数据库设计

### 2.1 新增表：`invitation_codes`

```sql
CREATE TABLE invitation_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,           -- 6位数字邀请码
  enterprise_id INTEGER NOT NULL,      -- 所属企业ID
  status INTEGER DEFAULT 0,            -- 0=未使用, 1=已使用
  used_by_user_id INTEGER,             -- 使用的用户ID
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  used_at DATETIME,
  FOREIGN KEY (enterprise_id) REFERENCES enterprises(id),
  FOREIGN KEY (used_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_invitation_codes_code ON invitation_codes(code);
CREATE INDEX idx_invitation_codes_status ON invitation_codes(status);
```

### 2.2 修改表：`users` 新增字段

```sql
ALTER TABLE users ADD COLUMN sudorouter_user_id INTEGER;  -- sudorouter 用户ID
ALTER TABLE users ADD COLUMN sudorouter_key TEXT;         -- sudorouter API Key
ALTER TABLE users ADD COLUMN invitation_code_id INTEGER;  -- 使用的邀请码ID
ALTER TABLE users ADD COLUMN quota INTEGER DEFAULT 0;     -- 用户额度
ALTER TABLE users ADD COLUMN used_quota INTEGER DEFAULT 0; -- 已用额度
```

### 2.3 数据清理脚本

```sql
-- 1. 清理企业（保留 sudo）
DELETE FROM enterprises WHERE code != 'sudo';
UPDATE enterprises SET name = '数牍科技' WHERE code = 'sudo';

-- 2. 清理非管理员用户
DELETE FROM users WHERE role NOT IN ('SUPER_ADMIN', 'ENTERPRISE_ADMIN');

-- 3. 清空账本
DELETE FROM ledger;
```

---

## 三、环境变量配置

```env
# .env 新增配置

# Sudorouter 服务配置
SUDOROUTER_BASE_URL=http://10.0.1.8:3000
SUDOROUTER_API_TOKEN=7Rbb+omsFuRRIGEfhjpf5ESlRNhlkcq0
SUDOROUTER_ADMIN_USER_ID=13

# 用户初始额度（创建新用户时的默认额度）
USER_INITIAL_QUOTA=100000
```

---

## 四、Sudorouter 服务封装

### 4.1 新建文件：`src/services/SudorouterService.ts`

```typescript
class SudorouterService {
  private baseUrl: string;
  private apiToken: string;
  private adminUserId: string;

  // 创建用户
  async createUser(phone: string): Promise<{ id: number; username: string }>

  // 创建令牌
  async createToken(
    sudorouterUserId: number, 
    phone: string, 
    quota: number
  ): Promise<{ key: string }>

  // 获取用户信息（余额）
  async getUser(sudorouterUserId: number): Promise<{
    id: number;
    quota: number;       // 可用余额
    used_quota: number;  // 已用余额
  }>

  // 获取用户使用日志
  async getUsageLogs(
    sudorouterUserId: number,
    timeFrom: number,
    timeTo: number,
    page: number,
    pageSize: number
  ): Promise<{ count: number; data: UsageLog[] }>
}
```

### 4.2 认证 Headers

所有 sudorouter API 请求携带：
```
Authorization: Bearer ${SUDOROUTER_API_TOKEN}
New-Api-User: ${SUDOROUTER_ADMIN_USER_ID}
```

### 4.3 Sudorouter API 参考

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/user/` | 创建用户 |
| POST | `/api/token/` | 创建令牌 |
| GET | `/api/user/{id}` | 获取用户余额 |
| GET | `/api/log/` | 获取用户使用日志 |

---

## 五、API 变更

### 5.1 新增接口：邀请码管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/admin/invitation-codes` | 获取邀请码列表 |
| POST | `/api/v1/admin/invitation-codes` | 批量创建邀请码 |
| DELETE | `/api/v1/admin/invitation-codes/:id` | 删除邀请码（仅未使用的） |

**创建邀请码**：
```json
// POST /api/v1/admin/invitation-codes
{
  "count": 10  // 创建10个邀请码
}

// Response
{
  "success": true,
  "data": {
    "codes": ["123456", "789012", "345678", ...],
    "count": 10
  }
}
```

**邀请码列表**：
```json
// GET /api/v1/admin/invitation-codes?status=0
{
  "success": true,
  "data": [
    {
      "id": 1,
      "code": "123456",
      "status": 0,
      "used_by_user_id": null,
      "created_at": "2026-03-25 10:00:00"
    }
  ]
}
```

### 5.2 修改接口：登录

**接口**：`POST /api/v1/auth/login`

**请求参数变更**：
```json
// 原
{ "phone": "xxx", "code": "xxx", "enterprise_code": "xxx" }

// 新
{ "phone": "xxx", "code": "xxx", "invitation_code": "xxx", "enterprise_code": "sudo" }
```

**核心逻辑变更**：
```
1. 验证手机号格式
2. 验证短信验证码（smsService.verifyCode）
3. 验证邀请码：
   - 是否存在
   - 是否已使用
   - 是否属于默认企业
4. 查询用户是否存在：
   ├─ 存在 → 生成 JWT，返回登录成功
   └─ 不存在 →
      a. 调用 sudorouter.createUser(phone) 创建用户
      b. 调用 sudorouter.createToken(userId, phone, quota) 创建令牌
      c. 创建本地用户：
         - phone = 手机号
         - nickname = 手机号
         - status = 1（已批准）
         - enterprise_id = 默认企业ID
         - sudorouter_user_id = sudorouter返回的用户ID
         - sudorouter_key = sudorouter返回的key
         - quota = 初始额度
         - balance = quota * 0.002
      d. 标记邀请码已使用
      e. 创建积分流水（初始积分）
      f. 生成 JWT，返回登录成功
```

### 5.3 修改接口：用户信息

**接口**：`GET /api/v1/user/profile`

**新增逻辑**：
```
1. 获取用户的 sudorouter_user_id
2. 调用 sudorouter.getUser(userId) 获取最新余额
3. 计算积分：balance = (quota - used_quota) * 0.002
4. 更新本地用户表：quota、used_quota、balance
5. 返回用户信息
```

**返回值新增字段**：
```json
{
  "success": true,
  "data": {
    "id": 1,
    "phone": "13800138000",
    "nickname": "13800138000",
    "balance": 190,        // 可用积分
    "quota": 100000,       // 可用额度
    "used_quota": 5000,    // 已用额度
    "total_points": 200,   // 总积分 = quota * 0.002
    "used_points": 10,     // 已用积分 = used_quota * 0.002
    ...
  }
}
```

### 5.4 修改接口：用户流水

**接口**：`GET /api/v1/user/ledger`

**新增参数**：
```
time_from: 开始时间戳（秒）
time_to: 结束时间戳（秒）
```

**逻辑变更**：
```
1. 获取用户的 sudorouter_user_id
2. 调用 sudorouter.getUsageLogs(userId, timeFrom, timeTo, page, pageSize)
3. 转换日志格式返回
```

---

## 六、客户端变更

### 6.1 登录页面（sudowork 客户端）

**变更点**：
- 企业码输入框：隐藏（自动携带 "sudo"）
- 新增：邀请码输入框
- 保留：手机号、验证码输入框

**UI 布局**：
```
┌─────────────────────────────────┐
│  手机号：[___________________]  │
│  验证码：[______] [获取验证码]  │
│  邀请码：[______]               │
│           [登录]                │
└─────────────────────────────────┘
```

### 6.2 登录请求变更

```typescript
// 登录请求
fetch('/api/v1/auth/login', {
  method: 'POST',
  body: JSON.stringify({
    phone: phone,
    code: smsCode,
    invitation_code: invitationCode,
    enterprise_code: 'sudo'  // 固定值，隐藏
  })
})
```

---

## 七、实现步骤

| 阶段 | 任务 | 文件 |
|------|------|------|
| **Phase 1: 数据库** | 创建 invitation_codes 表 | `src/index.ts` |
| | users 表新增字段 | `src/index.ts` |
| | 数据清理脚本 | SQL |
| **Phase 2: 后端服务** | SudorouterService 服务 | `src/services/SudorouterService.ts` |
| | 邀请码管理接口 | `src/index.ts` |
| | 修改登录接口 | `src/index.ts` |
| | 修改用户信息接口 | `src/index.ts` |
| | 修改用户流水接口 | `src/index.ts` |
| **Phase 3: 前端** | 管理后台：邀请码管理页面 | `admin/src/pages/InvitationCodeList.tsx` |
| | 客户端：登录页面修改 | `../sudowork/src/renderer/pages/login/index.tsx` |
| **Phase 4: 配置** | 环境变量配置 | `.env` |

---

## 八、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/index.ts` | 修改 | 数据库初始化、API 路由 |
| `src/services/SudorouterService.ts` | 新增 | Sudorouter API 封装 |
| `admin/src/pages/InvitationCodeList.tsx` | 新增 | 邀请码管理页面 |
| `admin/src/App.tsx` | 修改 | 添加路由 |
| `admin/src/api/index.ts` | 修改 | 添加邀请码 API |
| `../sudowork/src/renderer/pages/login/index.tsx` | 修改 | 登录页面 UI |
| `.env` | 修改 | 新增配置项 |
| `README.md` | 修改 | 更新文档 |

---

## 九、积分计算规则

| 概念 | 计算方式 |
|------|----------|
| 用户额度 | Sudorouter 中的余额 |
| 已用额度 | Sudorouter 中记录的已使用额度 |
| 可用积分 | `(quota - used_quota) * 0.002` |
| 总积分 | `quota * 0.002` |
| 已用积分 | `used_quota * 0.002` |

---

## 十、注意事项

1. **邀请码唯一性**：一个邀请码只能被一个用户使用，使用后标记为已使用
2. **用户自动创建**：新用户通过邀请码登录时自动创建，无需管理员审批
3. **积分实时同步**：每次获取用户信息时从 sudorouter 同步最新额度
4. **管理员登录**：保持现有管理员登录接口不变（手机号 + 密码）