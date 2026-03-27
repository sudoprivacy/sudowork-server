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

- **URL**: `/api/log/`
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

**日志字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| quota | int | 消耗的额度 |
| prompt_tokens | int | 输入 token 数 |
| completion_tokens | int | 输出 token 数 |
| model_name | string | 使用的模型名称 |
| use_time | int | 请求耗时（毫秒） |

**cURL 示例：**

```bash
curl --request GET \
  --url 'http://10.0.1.8:3000/api/log/?user_id=18&page_num=1&page_size=20&order_by=created_at&desc=true' \
  --header 'Authorization: Bearer 7Rbb+omsFuRRIGEfhjpf5ESlRNhlkcq0' \
  --header 'New-Api-User: 13'
```

---

## SudorouterService 封装

### 服务类方法

位置: `src/services/SudorouterService.ts`

```typescript
import { sudorouterService } from "./services/SudorouterService";

// 1. 创建用户
const user = await sudorouterService.createUser(phone);

// 2. 获取用户信息
const userInfo = await sudorouterService.getUser(sudorouterUserId);

// 3. 更新用户额度
const success = await sudorouterService.updateUserQuota(
  sudorouterUserId,
  500000,  // 额度变动值
  "充值备注"
);

// 4. 创建令牌
const tokenKey = await sudorouterService.createToken(
  sudorouterUserId,
  phone,
  true  // unlimited_quota
);

// 5. 获取使用日志
const logs = await sudorouterService.getUsageLogs(
  sudorouterUserId,
  timeFrom,  // Unix 时间戳
  timeTo,
  page,
  pageSize
);

// 6. 获取配置
const initialQuota = sudorouterService.getInitialQuota();  // 500000
const initialPoints = sudorouterService.getInitialPoints(); // 1000

// 7. 额度与积分转换
const points = sudorouterService.quotaToPoints(500000);  // 1000
const quota = sudorouterService.pointsToQuota(1000);    // 500000

// 8. 检查服务是否配置
if (sudorouterService.isConfigured()) {
  // 可以调用 sudorouter API
}
```

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