# Sudorouter API 集成文档

## 配置信息

### 环境变量配置 (.env)

```env
SUDOROUTER_BASE_URL=http://10.0.1.8:3000
SUDOROUTER_API_TOKEN=7Rbb+omsFuRRIGEfhjpf5ESlRNhlkcq0
SUDOROUTER_ADMIN_USER_ID=13
USER_INITIAL_QUOTA=500000
```

### 鉴权说明

所有接口需要在请求头中添加以下鉴权信息：

```
Content-Type: application/json
Authorization: Bearer <your_access_token>
New-Api-User: <admin_user_id>
```

---

## 积分换算规则

```
积分 = 额度 × 0.002
```

| 额度 (quota) | 积分 (points) |
|-------------|---------------|
| 500,000 | 1,000 |
| 250,000 | 500 |
| 100,000 | 200 |
| 50,000 | 100 |

---

## 接口速查表

| # | 接口 | Method | URL | 封装方法 | 作用 | 主要调用处 |
|---|------|--------|-----|----------|------|-----------|
| 1 | 创建用户 | POST | `/api/user/` | `createUser(WithLog)` | 在网关侧建 AI 账号 | 注册 / 后台建户 / 第三方登录 |
| 2 | 获取用户信息 | GET | `/api/user/{id}` | `getUser(WithLog)` | 查实时额度/已用/请求数 | 登录回填、用户中心、后台 |
| 3 | 精确查找用户 | GET | `/api/user/search` | `findUserByUsernameWithLog` | 模糊搜索+完全匹配复用账号 | `AuthUserService` |
| 4 | 更新额度 | PUT | `/api/user/quota` | `updateUserQuota(WithLog)` | 充值/扣费/赠送 | 充值、积分后台、授信 |
| 5 | 启用/禁用 | POST | `/api/user/manage` | `manageUser` | 封禁/解封 | `admin/users` |
| 6 | 删除用户 | DELETE | `/api/user/{id}` | `deleteUser(WithLog)` | 删号（靠 HTTP 码判断） | `admin/users` |
| 7 | 创建令牌 | POST | `/api/token/` | `createToken(WithLog)` | 签发不限额永久 API Key | 注册/建户流程 |
| 8 | 使用日志（单页） | GET | `/api/log/query` | `getUsageLogs` | 日志列表 | `user` |
| 9 | 使用日志（全量） | GET | `/api/log/query` | `getAllUsageLogs` | 并行分页汇总统计 | `user`、模型统计 |
| 10 | 模型用量统计 | — | 本地聚合 | `getModelUsageStats` | 按日期+模型 Top5+other | `user` |
| 11 | 模型列表 | GET | `chat.sudorouter.ai/api/specific_pricing` | `getAvailableModels` | 可用模型清单（24h 缓存） | 登录返回 |
| 12 | 测试连接 | GET | `/api/user/13` | `testConnection` | 健康检查 | 运维 |

---

## 用户接口

### 1. 创建用户

创建一个新的 sudorouter 用户。

- **URL**: `/api/user/`
- **Method**: `POST`
- **Auth**: Admin Auth

**请求参数：**

```json
{
  "username": "13800138001",
  "password": "13800138001",
  "display_name": "13800138001",
  "role": 1,
  "utm_source": "sudowork"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名（手机号），不能重复 |
| password | string | 是 | 密码（长度 8-20） |
| display_name | string | 否 | 显示名称，默认同用户名 |
| role | int | 否 | 角色（1: 普通用户, 10: 管理员），默认为 1 |
| utm_source | string | 是 | 固定传 "sudowork"，用于区分用户来源 |

**响应示例：**

```json
{
  "success": true,
  "message": "",
  "data": {
    "id": 18,
    "username": "13800138001"
  }
}
```

**cURL 示例：**

```bash
curl --request POST \
  --url http://10.0.1.8:3000/api/user/ \
  --header 'Authorization: Bearer 7Rbb+omsFuRRIGEfhjpf5ESlRNhlkcq0' \
  --header 'New-Api-User: 13' \
  --header 'Content-Type: application/json' \
  --data '{
    "username": "13800138001",
    "password": "13800138001",
    "display_name": "13800138001",
    "role": 1,
    "utm_source": "sudowork"
  }'
```

---

### 2. 获取用户信息

获取指定用户的详细信息，包括额度、已用额度等。

- **URL**: `/api/user/{user_id}`
- **Method**: `GET`
- **Auth**: Admin Auth

**路径参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| user_id | int | sudorouter 用户 ID |

**响应示例：**

```json
{
  "data": {
    "id": 18,
    "username": "13800138001",
    "password": "",
    "display_name": "13800138001",
    "role": 1,
    "status": 1,
    "quota": 500000,
    "used_quota": 0,
    "request_count": 0,
    "group": "default",
    "utm_source": ""
  },
  "message": "",
  "success": true
}
```

**关键字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| quota | int | 可用余额 |
| used_quota | int | 已用余额 |
| request_count | int | API 调用次数 |

**cURL 示例：**

```bash
curl --request GET \
  --url http://10.0.1.8:3000/api/user/18 \
  --header 'Authorization: Bearer 7Rbb+omsFuRRIGEfhjpf5ESlRNhlkcq0' \
  --header 'New-Api-User: 13'
```

---

### 3. 更新用户额度（充值/扣费）

管理员更新特定用户的额度。

- **URL**: `/api/user/quota`
- **Method**: `PUT`
- **Auth**: Admin Auth

**额度说明：**
- 1 美元 ($1.00) = 500,000 quota
- 1 quota = $0.000002

**请求参数：**

```json
{
  "id": 18,
  "quota": 500000,
  "comment": "新用户注册赠送额度"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | int | 是 | 用户 ID |
| quota | int | 是 | 变动的额度值（正数增加，负数减少） |
| comment | string | 否 | 备注信息，用于记录日志 |

**响应示例：**

```json
{
  "success": true,
  "message": ""
}
```

**cURL 示例：**

```bash
curl --request PUT \
  --url http://10.0.1.8:3000/api/user/quota \
  --header 'Authorization: Bearer 7Rbb+omsFuRRIGEfhjpf5ESlRNhlkcq0' \
  --header 'New-Api-User: 13' \
  --header 'Content-Type: application/json' \
  --data '{
    "id": 18,
    "quota": 500000,
    "comment": "新用户注册赠送额度"
  }'
```

---

## 令牌接口

### 4. 创建令牌

为用户创建 API 令牌。

- **URL**: `/api/token/`
- **Method**: `POST`
- **Auth**: Admin Auth

**请求参数：**

```json
{
  "name": "13800138001-token",
  "expired_time": -1,
  "unlimited_quota": true,
  "user_id": 18
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 令牌名称（最多 30 字符） |
| expired_time | int | 否 | 过期时间戳（秒），-1 表示永不过期 |
| remain_quota | int | 否 | 剩余额度（unlimited_quota=false 时有效） |
| unlimited_quota | bool | 否 | 是否无限额度，默认 false |
| user_id | int | 否 | 目标用户 ID（仅管理员可用） |

**响应示例：**

```json
{
  "data": {
    "id": 26,
    "user_id": 18,
    "key": "BNrCkG1OnGBLtlMwyEPZavy0yKohrXmzpdPbhBdoQC9HleGF",
    "status": 1,
    "name": "13800138001-token",
    "created_time": 1774487628,
    "expired_time": -1,
    "remain_quota": 0,
    "unlimited_quota": true,
    "used_quota": 0
  },
  "message": "",
  "success": true
}
```

**cURL 示例：**

```bash
curl --request POST \
  --url http://10.0.1.8:3000/api/token/ \
  --header 'Authorization: Bearer 7Rbb+omsFuRRIGEfhjpf5ESlRNhlkcq0' \
  --header 'New-Api-User: 13' \
  --header 'Content-Type: application/json' \
  --data '{
    "name": "13800138001-token",
    "expired_time": -1,
    "unlimited_quota": true,
    "user_id": 18
  }'
```

---

## 使用日志接口

### 5. 获取使用日志

获取用户的 API 调用日志。

- **URL**: `/api/log/query`
- **Method**: `GET`
- **Auth**: Admin Auth

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| user_id | int | 是 | 用户 ID |
| time_from | int | 否 | 开始时间戳（秒） |
| time_to | int | 否 | 结束时间戳（秒） |
| page_num | int | 否 | 页码，默认 1 |
| page_size | int | 否 | 每页数量，默认 10 |
| order_by | string | 否 | 排序字段，如 "created_at" |
| desc | string | 否 | 是否降序，"true" 或 "false" |

**响应示例：**

```json
{
  "success": true,
  "message": "",
  "data": {
    "count": 100,
    "data": [
      {
        "id": 1,
        "user_id": 18,
        "created_at": 1678888888,
        "type": 1,
        "model_name": "gpt-4o",
        "quota": 5000,
        "prompt_tokens": 100,
        "completion_tokens": 200,
        "use_time": 1500,
        "channel": 1,
        "is_stream": true
      }
    ]
  }
}
```

**日志字段说明（封装层 `UsageLog` 接口，见 `SudorouterService.ts:52`）：**

> 注意：封装层 TS 接口对部分字段做了重命名，与上方原始响应示例的字段名不完全一致。以代码中的 `UsageLog` 接口为准。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 日志 ID |
| user_id | int | 用户 ID |
| created_at | int | 创建时间（Unix 秒） |
| type | string | 日志类型（如 `manage` 为管理操作，需在统计时过滤） |
| model_name | string | 使用的模型名称 |
| cost | number | 消耗的额度（原始响应字段为 `quota`） |
| prompt_tokens | int | 输入 token 数 |
| completion_tokens | int | 输出 token 数 |
| duration | int | 请求耗时，毫秒（原始响应字段为 `use_time`） |
| channel_id | int | 渠道 ID（原始响应字段为 `channel`） |
| api_key_name | string | 使用的令牌名称 |
| detail | string | 详情 |
| user_name | string | 用户名 |
| other | object | 附加计费信息：`cache_ratio` / `cache_tokens` / `completion_ratio` / `group_ratio` / `model_price` / `model_ratio` |

**cURL 示例：**

```bash
curl --request GET \
  --url 'http://10.0.1.8:3000/api/log/query?user_id=18&time_from=1678000000&time_to=1679000000&page_num=1&page_size=100&order_by=created_at&desc=true' \
  --header 'Authorization: Bearer 7Rbb+omsFuRRIGEfhjpf5ESlRNhlkcq0' \
  --header 'New-Api-User: 13'
```

> 封装层提供两种拉取方式：
> - `getUsageLogs(userId, timeFrom, timeTo, page, pageSize)`：单页拉取，用于列表展示。
> - `getAllUsageLogs(userId, timeFrom, timeTo)`：先取第 1 页拿 `count`，再**并行**拉取剩余页（每页固定 100 条）汇总，用于统计分析。

---

## 用户管理接口

### 6. 精确查找用户

按用户名查找用户。**注意 sudorouter 的 `search` 是模糊查询**，封装层 `findUserByUsernameWithLog` 会在返回结果中筛选出 `username` **完全一致**、且**未删除、状态正常**（`status === 1`）的那一个。主要用于第三方登录时复用已存在的网关账号，避免重复建号。

- **URL**: `/api/user/search`
- **Method**: `GET`
- **Auth**: Admin Auth

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| keyword | string | 是 | 搜索关键词（模糊匹配用户名/显示名等） |
| page | int | 否 | 页码，封装层固定传 1 |
| page_size | int | 否 | 每页数量，封装层固定传 100 |

**响应示例：**

```json
{
  "success": true,
  "message": "",
  "data": {
    "items": [
      {
        "id": 18,
        "username": "13800138001",
        "status": 1,
        "quota": 500000,
        "used_quota": 0,
        "request_count": 0,
        "DeletedAt": null
      }
    ]
  }
}
```

**可用性校验（`getUnavailableSudorouterUserReason`）：**

| 情况 | 处理 |
|------|------|
| `DeletedAt` / `deleted_at` 有效 | 视为「已删除」，不返回 |
| `status !== 1` | 视为「状态不可用」，不返回 |
| 无完全匹配项 | 返回「未找到完全匹配的 Sudorouter 用户」 |

**cURL 示例：**

```bash
curl --request GET \
  --url 'http://10.0.1.8:3000/api/user/search?keyword=13800138001&page=1&page_size=100' \
  --header 'Authorization: Bearer 7Rbb+omsFuRRIGEfhjpf5ESlRNhlkcq0' \
  --header 'New-Api-User: 13'
```

---

### 7. 启用/禁用用户

管理员启用或禁用用户网关账号（封禁/解封）。

- **URL**: `/api/user/manage`
- **Method**: `POST`
- **Auth**: Admin Auth

**请求参数：**

```json
{
  "id": 18,
  "action": "disable"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | int | 是 | 用户 ID |
| action | string | 是 | 操作：`enable`（启用）/ `disable`（禁用） |

**响应示例：**

```json
{
  "success": true,
  "message": ""
}
```

**cURL 示例：**

```bash
curl --request POST \
  --url http://10.0.1.8:3000/api/user/manage \
  --header 'Authorization: Bearer 7Rbb+omsFuRRIGEfhjpf5ESlRNhlkcq0' \
  --header 'New-Api-User: 13' \
  --header 'Content-Type: application/json' \
  --data '{ "id": 18, "action": "disable" }'
```

---

### 8. 删除用户

管理员删除指定 sudorouter 用户。

- **URL**: `/api/user/{user_id}`
- **Method**: `DELETE`
- **Auth**: Admin Auth

**路径参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| user_id | int | sudorouter 用户 ID |

> **重要**：该删除接口**无响应体**，封装层 `deleteUserWithLog` 通过 **HTTP 状态码**判断结果——`2xx` 视为删除成功，非 `2xx` 尝试解析 `message` 作为错误信息。

**cURL 示例：**

```bash
curl --request DELETE \
  --url http://10.0.1.8:3000/api/user/18 \
  --header 'Authorization: Bearer 7Rbb+omsFuRRIGEfhjpf5ESlRNhlkcq0' \
  --header 'New-Api-User: 13'
```

---

## 模型接口

### 9. 获取可用模型列表

获取平台支持的模型清单及定价。此接口为**独立域名**（`SUDOROUTER_MODELS_API_URL`，默认 `https://chat.sudorouter.ai/api/specific_pricing`），**无需鉴权**，封装层带 **24 小时内存缓存**。

- **URL**: `https://chat.sudorouter.ai/api/specific_pricing`
- **Method**: `GET`
- **Auth**: 无

**响应示例：**

```json
{
  "success": true,
  "message": "",
  "data": [
    {
      "model_id": "gpt-4o",
      "...": "其余定价字段"
    },
    {
      "model_id": "claude-opus-4-8"
    }
  ]
}
```

> 封装层 `getAvailableModels()` 只提取 `data[].model_id`，返回字符串数组，例如 `["gpt-4o", "claude-opus-4-8", ...]`。可传 `forceRefresh=true` 跳过缓存强制刷新。

**cURL 示例：**

```bash
curl --request GET \
  --url https://chat.sudorouter.ai/api/specific_pricing
```

---

### 10. 测试连接

健康检查/配置验证。封装层 `testConnection()` 通过请求管理员账号（`/api/user/13`）探测服务可达性，超时 5 秒。

- **URL**: `/api/user/13`
- **Method**: `GET`
- **Auth**: Admin Auth

**cURL 示例：**

```bash
curl --request GET \
  --url http://10.0.1.8:3000/api/user/13 \
  --header 'Authorization: Bearer 7Rbb+omsFuRRIGEfhjpf5ESlRNhlkcq0' \
  --header 'New-Api-User: 13'
```

---

## SudorouterService 封装

### 服务类方法

位置: `src/services/SudorouterService.ts`

```typescript
import { sudorouterService } from "./services/SudorouterService";

// —— 用户 ——
// 1. 创建用户（createUserWithLog 返回含 request/response/耗时的完整结果用于审计）
const user = await sudorouterService.createUser(phone, nickname);
const userResult = await sudorouterService.createUserWithLog(phone, nickname);

// 2. 获取用户信息
const userInfo = await sudorouterService.getUser(sudorouterUserId);
const userInfoResult = await sudorouterService.getUserWithLog(sudorouterUserId);

// 3. 按用户名精确查找（模糊搜索 + 完全匹配 + 可用性校验）
const found = await sudorouterService.findUserByUsernameWithLog(username);

// 4. 更新用户额度（充值/扣费，正数增加、负数减少）
const success = await sudorouterService.updateUserQuota(sudorouterUserId, 500000, "充值备注");
const quotaResult = await sudorouterService.updateUserQuotaWithLog(sudorouterUserId, 500000, "充值备注");

// 5. 启用/禁用用户
const manage = await sudorouterService.manageUser(sudorouterUserId, "disable"); // "enable" | "disable"

// 6. 删除用户
const deleted = await sudorouterService.deleteUser(sudorouterUserId);
const deleteResult = await sudorouterService.deleteUserWithLog(sudorouterUserId);

// —— 令牌 ——
// 7. 创建令牌（unlimited_quota=true → 不限额、永久）
const tokenKey = await sudorouterService.createToken(sudorouterUserId, phone, true);
const tokenResult = await sudorouterService.createTokenWithLog(sudorouterUserId, phone, true);

// —— 日志与统计 ——
// 8. 单页日志（列表展示）
const logs = await sudorouterService.getUsageLogs(sudorouterUserId, timeFrom, timeTo, page, pageSize);

// 9. 全量日志（并行分页汇总，统计分析）
const allLogs = await sudorouterService.getAllUsageLogs(sudorouterUserId, timeFrom, timeTo);

// 10. 模型用量统计（本地聚合：按日期+模型，Top5 + other）
const stats = await sudorouterService.getModelUsageStats(sudorouterUserId, "2026-08-01", "2026-08-11");

// —— 模型与连接 ——
// 11. 可用模型列表（24 小时缓存，独立域名、无需鉴权）
const models = await sudorouterService.getAvailableModels(); // string[]

// 12. 测试连接（探测 /api/user/13，5s 超时）
const conn = await sudorouterService.testConnection();

// —— 配置与换算 ——
const initialQuota = sudorouterService.getInitialQuota();   // USER_INITIAL_QUOTA
const initialPoints = sudorouterService.getInitialPoints(); // initialQuota × 0.002
const points = sudorouterService.quotaToPoints(500000);     // 额度 → 积分：1000
const quota = sudorouterService.pointsToQuota(1000);        // 积分 → 额度：500000
const q = sudorouterService.usdToQuota(1);                  // 美元 → 额度：500000
const rate = sudorouterService.getConversionRate();         // 0.002
const modelServiceUrl = sudorouterService.getModelServiceUrl();

// 检查服务是否配置（baseUrl + apiToken 均存在）
if (sudorouterService.isConfigured()) {
  // 可以调用 sudorouter API
}
```

> **`WithLog` 变体说明**：涉及审计的写操作/查询大多提供两个版本——简化版（`createUser`/`getUser`/`updateUserQuota`/`createToken`/`deleteUser`）只返回数据（失败返回 `null`/`false`），`xxxWithLog` 版本额外返回 `ApiCallResult<T>`（`{ success, data, request, response, duration_ms, error }`），用于写入操作日志。

---

## 创建用户完整流程

### 流程图

```
┌─────────────────────┐
│ 1. 创建 sudorouter  │
│    用户             │
│    POST /api/user/  │
└──────────┬──────────┘
           │ 返回 user.id
           ▼
┌─────────────────────┐
│ 2. 充值额度         │
│    500000 quota     │
│    PUT /api/user/   │
│    quota            │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 3. 创建不限额令牌   │
│    unlimited_quota  │
│    = true           │
│    POST /api/token/ │
└──────────┬──────────┘
           │ 返回 token.key
           ▼
┌─────────────────────┐
│ 4. 保存到本地数据库 │
│    - sudorouter_    │
│      user_id        │
│    - sudorouter_key │
│    - quota          │
│    - balance        │
└─────────────────────┘
```

### 代码示例

```typescript
// 管理后台创建用户接口
app.post("/api/v1/admin/users", async (c) => {
  const { phone, nickname, enterprise_id, invitation_code_id } = await c.req.json();

  // 1. 创建 sudorouter 用户
  const sudorouterUser = await sudorouterService.createUser(phone);
  if (!sudorouterUser) {
    return c.json({ success: false, msg: "创建用户失败" }, 500);
  }

  // 2. 充值额度 (500000)
  const initialQuota = sudorouterService.getInitialQuota();
  await sudorouterService.updateUserQuota(
    sudorouterUser.id,
    initialQuota,
    "新用户注册赠送额度"
  );

  // 3. 创建不限额令牌
  const sudorouterKey = await sudorouterService.createToken(
    sudorouterUser.id,
    phone,
    true  // unlimited_quota = true
  );

  // 4. 计算初始积分
  const initialBalance = sudorouterService.quotaToPoints(initialQuota);

  // 5. 保存到本地数据库
  db.run(
    `INSERT INTO users (
      phone, nickname, enterprise_id,
      sudorouter_user_id, sudorouter_key,
      quota, used_quota, balance
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [phone, nickname, enterprise_id, sudorouterUser.id, sudorouterKey,
     initialQuota, 0, initialBalance]
  );
});
```

---

## 同步用户额度流程

每次查看用户列表时，同步每个用户的额度信息：

```typescript
app.get("/api/v1/admin/users", async (c) => {
  const users = db.prepare("SELECT * FROM users").all();

  // 同步每个用户的额度
  for (const user of users) {
    if (user.sudorouter_user_id) {
      const sudorouterUser = await sudorouterService.getUser(
        user.sudorouter_user_id
      );
      if (sudorouterUser) {
        const quota = sudorouterUser.quota || 0;
        const usedQuota = sudorouterUser.used_quota || 0;
        const remainingPoints = sudorouterService.quotaToPoints(quota);

        // 更新本地数据库
        db.run(
          "UPDATE users SET quota = ?, used_quota = ?, balance = ? WHERE id = ?",
          [quota, usedQuota, remainingPoints, user.id]
        );
      }
    }
  }

  return c.json({ success: true, data: users });
});
```

---

## 错误处理

所有接口在调用失败时会返回：

```json
{
  "success": false,
  "message": "错误信息"
}
```

建议在调用时进行错误处理：

```typescript
const user = await sudorouterService.createUser(phone);
if (!user) {
  // 创建失败，返回错误信息
  return c.json({ success: false, msg: "创建用户失败" }, 500);
}
```