# Sudowork-Server

企业级 Agent 协同管理平台后端服务，提供用户认证、企业管理、积分管理、Sudorouter 集成等功能。

## 📋 功能特性

- ✅ **用户认证**: 两阶段登录（短信验证码 + 邀请码注册），JWT Token
- ✅ **企业管理**: 多企业支持，邀请码管理，成员管理
- ✅ **积分管理**: 余额查询、流水记录、积分消费（带余额检查）
- ✅ **Sudorouter 集成**: API Key 分发、用量上报、模型查询
- ✅ **短信服务**: 腾讯云 SMS 集成，支持 Mock 模式
- ✅ **安全防护**: Rate Limiting、余额检查、输入验证
- ✅ **权限控制**: JWT 认证，角色管理（SUPER_ADMIN/ENTERPRISE_ADMIN/USER）
- ✅ **管理后台**: Web 管理界面，支持企业/用户/邀请码管理
- ✅ **充值系统**: 富友支付集成，支持支付宝/微信扫码充值，美元计价
- ✅ **退款功能**: 按积分使用比例计算退款金额，富友退款接口对接
- ✅ **订单同步**: 回调失败时自动/手动同步订单状态，确保积分到账

## 🔐 安全特性

| 特性 | 说明 |
|------|------|
| **Rate Limiting** | 登录/验证码接口 15 分钟最多 5-10 次/IP |
| **余额检查** | 消费前检查余额，防止负数 |
| **JWT 认证** | 支持多角色权限 |
| **密码加密** | bcrypt 加密存储 |
| **敏感信息保护** | Token/验证码不打印日志 |
| **支付安全** | RSA 加密验签、商户号验证、金额验证、并发锁 |
| **订单过期** | 30 分钟未支付订单自动取消 |

## 🚀 快速开始

### 方式一：Docker 部署（推荐）

#### 前置要求

- Docker >= 20.10
- Docker Compose >= 2.0

#### 部署步骤

1. **克隆项目**

```bash
git clone https://github.com/sudoprivacy/sudowork-server.git
cd sudowork-server
```

2. **配置环境变量**

```bash
cp .env.example .env
# 编辑 .env 文件，配置必要参数（特别是 JWT_SECRET 和 SUPER_ADMIN_PASSWORD）
```

3. **创建数据目录**

```bash
mkdir -p data
```

4. **启动服务**

```bash
# 后台运行
docker-compose up -d

# 查看日志
docker-compose logs -f sudowork-server
```

5. **验证部署**

```bash
curl http://localhost:3000/
```

6. **停止服务**

```bash
docker-compose down
```

#### 数据持久化

- `./data/` - SQLite 数据库文件
- Redis 数据通过 Docker Volume 持久化

### 方式二：手动部署

#### 前置要求

- Bun >= 1.0
- Redis >= 7.0

#### 部署步骤

1. **安装依赖**

```bash
bun install
```

2. **配置环境变量**

```bash
cp .env.example .env
# 编辑 .env 文件
```

3. **启动 Redis**

```bash
redis-server
```

4. **启动服务**

```bash
bun run src/index.ts
```

## 🎯 管理后台

### 超级管理员账户

首次启动会自动创建超级管理员账户（需配置 `SUPER_ADMIN_PASSWORD`）：

- **账号**: 由 `SUPER_ADMIN_PHONE` 配置（默认 `sudo`）
- **密码**: 由 `SUPER_ADMIN_PASSWORD` 配置

### 访问管理后台

启动服务后，访问：`http://localhost:3000/`

登录后可管理：

- 📊 仪表盘 - 查看统计数据
- 🏢 企业列表 - 添加/删除企业
- 👥 用户管理 - 添加/修改/删除用户，设置积分，后台充值
- 📋 订单管理 - 充值订单列表，统计报表，失败订单重试，订单退款，订单同步
- 💰 充值记录 - 客户端充值 + 后台充值综合记录
- 🎫 邀请码 - 批量生成/查看邀请码
- 📝 操作日志 - 查看系统操作记录

## 📖 环境变量说明

### 必需配置

| 变量名 | 说明 | 默认值 | 必需 |
|--------|------|--------|------|
| `JWT_SECRET` | JWT 密钥 | - | ✅ |
| `SUPER_ADMIN_PASSWORD` | 超级管理员密码 | - | ✅ |
| `REDIS_HOST` | Redis 主机地址 | `localhost` | ✅ |
| `SUDOROUTER_API_TOKEN` | Sudorouter API Token | - | ✅ |

### 服务配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `SERVER_PORT` | 服务端口 | `3000` |
| `SUPER_ADMIN_PHONE` | 超级管理员账号 | `sudo` |

### Sudorouter 配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `SUDOROUTER_BASE_URL` | Sudorouter API 地址 | `http://10.0.1.8:3000` |
| `SUDOROUTER_ADMIN_USER_ID` | Sudorouter 管理员 ID | `13` |
| `USER_INITIAL_QUOTA` | 新用户初始额度 | `500000` (1000 积分) |

### SMS 配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `SMS_PROVIDER` | 短信提供商 | `mock` |
| `SMS_CODE_EXPIRE_MINUTES` | 验证码过期时间 | `5` 分钟 |
| `SMS_CODE_MAX_PER_DAY` | 每日最大发送次数 | `10` |

### Rate Limiting 配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `RATE_LIMIT_ENABLED` | 启用速率限制 | `true` |
| `RATE_LIMIT_LOGIN_MAX` | 登录最大尝试次数/IP/15分钟 | `10` |
| `RATE_LIMIT_API_MAX` | API 最大请求次数/IP/分钟 | `100` |

### 富友支付配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `FUIOU_TEST_MODE` | 测试模式 | `true` |
| `FUIOU_MERCHANT_CODE` | 商户代码 | (测试) |
| `FUIOU_MERCHANT_PRIVATE_KEY` | 商户私钥 (Base64) | - |
| `FUIOU_PUBLIC_KEY` | 富友公钥 (Base64) | - |
| `FUIOU_TIMEOUT_MS` | 请求超时 (毫秒) | `10000` |
| `FUIOU_TEST_API_URL` | 测试环境 API 地址 | `https://hlwnets-test.fuioupay.com` |
| `FUIOU_PROD_API_URL` | 生产环境 API 地址 | `https://hlwnets.fuioupay.com` |
| `SERVER_URL` | 服务器地址 (回调用) | `http://localhost:3000` |
| `USD_TO_CNY_RATE` | 美元转人民币汇率 | `7.3` |
| `RECHARGE_MIN_AMOUNT` | 最小充值金额 (美元) | `1` |
| `RECHARGE_ORDER_EXPIRE_MINUTES` | 订单过期时间 (分钟) | `30` |

## 🔌 API 文档

### 基础信息

- **Base URL**: `http://localhost:3000`
- **认证方式**: Bearer Token (JWT)
- **请求格式**: `application/json`

---

### 认证接口

#### 1. 发送短信验证码

**POST** `/api/v1/auth/send-code`

**Rate Limit**: 5 次/IP/15分钟

```json
// Request
{ "phone": "13800138000" }

// Response
{
  "success": true,
  "msg": "验证码已发送",
  "expire": 300,
  "next_send_in": 60,
  "daily_remaining": 9
}
```

---

#### 2. 短信验证码登录（两阶段）

**POST** `/api/v1/auth/login`

**Rate Limit**: 10 次/IP/15分钟

**阶段一：已注册用户登录**

```json
// Request
{ "phone": "13800138000", "code": "123456" }

// Response（用户已存在，直接登录）
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": 1,
      "phone": "13800138000",
      "nickname": "用户昵称",
      "role": "USER",
      "sudorouter_key": "sk-xxx...",
      "points": { "total": 1000, "used": 0, "remaining": 1000 }
    }
  }
}
```

**阶段二：新用户注册**

```json
// Response（用户不存在，需注册）
{
  "success": false,
  "need_register": true,
  "register_token": "abc123...",
  "phone": "13800138000",
  "msg": "用户不存在，请先注册"
}
```

---

#### 3. 新用户注册

**POST** `/api/v1/auth/register`

**Rate Limit**: 10 次/IP/15分钟

```json
// Request
{
  "register_token": "abc123...",
  "nickname": "我的昵称",
  "invitation_code": "ABC123"
}

// Response
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": { ... }
  }
}
```

---

### 用户接口

需要 JWT 认证：`Authorization: Bearer <token>`

#### 4. 获取用户信息

**GET** `/api/v1/user/profile`

#### 5. 获取用户仪表盘

**GET** `/api/v1/user/dashboard`

返回积分、今日使用统计、使用流水。

#### 6. 用量上报（扣费）

**POST** `/api/v1/usage/report`

```json
// Request
{
  "inputTokens": 100,
  "outputTokens": 200,
  "model": "claude-3-5-sonnet"
}

// Response
{
  "success": true,
  "deducted": 0.3,
  "newBalance": 999.7
}

// 余额不足时
{
  "success": false,
  "msg": "余额不足",
  "data": { "balance": 0.1, "required": 0.3 }
}
```

**计费规则**: 1000 Tokens = 1 积分

---

### 管理接口

需要管理员权限（`SUPER_ADMIN` 或 `ENTERPRISE_ADMIN`）

#### 7. 管理员登录

**POST** `/api/v1/admin/login`

#### 8. 获取统计数据

**GET** `/api/v1/admin/stats`

#### 9. 企业管理

- `GET /api/v1/admin/enterprises` - 企业列表
- `POST /api/v1/admin/enterprises` - 创建企业
- `PUT /api/v1/admin/enterprises/:id` - 更新企业
- `DELETE /api/v1/admin/enterprises/:id` - 删除企业

#### 10. 邀请码管理

- `GET /api/v1/admin/invitation-codes` - 邀请码列表
- `POST /api/v1/admin/invitation-codes` - 批量创建邀请码
- `DELETE /api/v1/admin/invitation-codes/:id` - 删除邀请码

#### 11. 用户管理

- `GET /api/v1/admin/users` - 用户列表
- `POST /api/v1/admin/users` - 创建用户
- `PUT /api/v1/admin/users/:id` - 更新用户
- `DELETE /api/v1/admin/users/:id` - 删除用户
- `POST /api/v1/admin/users/:id/points` - 调整积分（同步 sudorouter）
- `POST /api/v1/admin/users/:id/recharge` - 后台充值积分
- `POST /api/v1/admin/users/:id/sync-quota` - 同步用户额度
- `POST /api/v1/admin/users/:id/manage` - 启用/禁用用户

#### 12. 订单管理

- `GET /api/v1/admin/recharge/stats` - 充值统计
- `GET /api/v1/admin/recharge/orders` - 充值订单列表
- `GET /api/v1/admin/recharge/orders/:orderNo` - 订单详情
- `POST /api/v1/admin/recharge/orders/:orderNo/retry` - 重试失败订单
- `POST /api/v1/admin/recharge/orders/:orderNo/sync` - 同步单个订单状态
- `POST /api/v1/admin/recharge/sync` - 同步所有待处理订单
- `GET /api/v1/admin/recharge/refund-calc/:orderNo` - 计算退款金额
- `POST /api/v1/admin/recharge/orders/:orderNo/refund` - 执行退款
- `GET /api/v1/admin/recharge-records` - 充值记录列表（客户端+后台）

#### 13. 订单同步机制

当富友支付回调失败时，系统会自动同步订单状态：

**自动同步**：服务启动后，每 5 分钟自动查询富友订单状态，同步"支付中"订单的真实状态。

**手动同步**：
- 后台订单管理页面提供"同步待处理订单"按钮
- 单个订单可点击"同步"按钮查询最新状态

**同步范围**：只同步 30 分钟内创建的"支付中"订单。

#### 14. 退款规则

退款金额根据用户剩余积分计算：
- 剩余积分 ≥ 订单积分：全额退款，扣除全部订单积分
- 剩余积分 < 订单积分：按使用比例退款，扣除剩余积分

```json
// GET /api/v1/admin/recharge/refund-calc/:orderNo
{
  "success": true,
  "data": {
    "orderPoints": 11000,      // 订单积分（购买+赠送）
    "userBalance": 5000,       // 用户剩余积分
    "usedPoints": 6000,        // 已使用积分
    "originalAmount": 73.0,    // 订单原金额（元）
    "refundAmount": 43.8,      // 退款金额（元）
    "deductPoints": 5000       // 扣除积分
  }
}
```

退款后：
- 订单状态变为 `4`（已退款）
- 用户积分和额度同步扣减
- 退款记录写入 `refund_records` 表

---

### 充值接口（用户端）

需要 JWT 认证：`Authorization: Bearer <token>`

#### 15. 获取充值套餐

**GET** `/api/v1/recharge/packages`

```json
// Response
{
  "success": true,
  "data": [
    { "amount": 1, "amount_cny": 7.3, "points": 1000, "bonus": 0, "description": "基础充值" },
    { "amount": 5, "amount_cny": 36.5, "points": 5000, "bonus": 500, "description": "充5送500积分" },
    { "amount": 10, "amount_cny": 73.0, "points": 10000, "bonus": 1000, "description": "充10送1000积分" },
    { "amount": 20, "amount_cny": 146.0, "points": 20000, "bonus": 3000, "description": "充20送3000积分" },
    { "amount": 50, "amount_cny": 365.0, "points": 50000, "bonus": 10000, "description": "充50送10000积分" }
  ]
}
```

#### 16. 创建充值订单

**POST** `/api/v1/recharge/create`

```json
// Request
{ "amount": 10, "payment_method": "ALIPAY" }

// Response
{
  "success": true,
  "data": {
    "order_no": "USR123NO20260331...",
    "amount_usd": 10,
    "amount_cny": 73.0,
    "points": 11000,
    "quota": 5500000,
    "expired_at": "2026-03-31T12:30:00.000Z"
  }
}
```

#### 17. 发起支付

**POST** `/api/v1/recharge/pay`

```json
// Request
{ "order_no": "USR123NO20260331..." }

// Response
{
  "success": true,
  "data": {
    "order_no": "USR123NO20260331...",
    "qr_code_url": "https://qr.alipay.com/...",
    "order_info": "alipay://..."
  }
}
```

#### 18. 查询订单状态

**GET** `/api/v1/recharge/query/:orderNo`

#### 19. 充值记录列表

**GET** `/api/v1/recharge/list`

#### 20. 取消订单

**POST** `/api/v1/recharge/cancel/:orderNo`

**充值规则**:
- 1 美元 = 1000 积分
- 订单 30 分钟未支付自动取消
- 支付成功后自动同步 sudorouter 额度

---

## 🏗️ 架构说明

### 技术栈

- **运行时**: Bun 1.0+
- **Web 框架**: Hono
- **数据库**: SQLite (bun:sqlite)
- **缓存**: Redis (ioredis)
- **短信服务**: 腾讯云 SMS
- **认证**: JWT (hono/jwt)
- **前端**: React + Ant Design

### 目录结构

```
sudowork-server/
├── src/
│   ├── index.ts                 # 主入口（启动服务、挂载路由）
│   ├── redis.ts                 # Redis 连接
│   ├── db/
│   │   ├── index.ts             # 数据库连接
│   │   ├── schema.ts            # 表结构定义（含充值相关表）
│   │   ├── migrations.ts        # 数据库迁移
│   │   └── init.ts              # 初始化函数（含订单过期清理）
│   ├── middleware/
│   │   ├── auth.ts              # JWT 认证中间件
│   │   └── rateLimiter.ts       # 速率限制中间件
│   ├── routes/
│   │   ├── admin.ts             # 管理员路由挂载
│   │   ├── admin-auth.ts        # 管理员登录/改密
│   │   ├── admin-enterprises.ts # 企业管理接口
│   │   ├── admin-invitation-codes.ts # 邀请码管理
│   │   ├── admin-users.ts       # 用户管理接口（含后台充值、额度同步）
│   │   ├── admin-logs.ts        # 操作日志接口
│   │   ├── auth.ts              # 用户认证接口
│   │   ├── user.ts              # 用户中心接口
│   │   ├── recharge.ts          # 充值接口（用户端）
│   │   └── misc.ts              # 杂项路由
│   ├── services/
│   │   ├── SmsService.ts        # 短信服务
│   │   ├── SudorouterService.ts # Sudorouter API 封装
│   │   ├── FuiouPayService.ts   # 富友支付服务
│   │   └── RechargeService.ts   # 充值业务逻辑
│   └── utils/
│       ├── password.ts          # 密码加密工具
│       ├── validation.ts        # 输入验证工具
│       ├── invitation.ts        # 邀请码生成工具
│       └── crypto.ts            # RSA 加解密工具（富友支付）
├── admin/                       # 管理后台前端源码
├── admin-dist/                  # 构建后的前端静态文件
├── data/                        # SQLite 数据库（持久化）
├── docker-compose.yml           # Docker 编排
├── Dockerfile                   # Docker 镜像
├── .env.example                 # 环境变量模板
└── README.md                    # 本文档
```

### 数据模型

#### 模块化设计

项目采用模块化架构，每个模块职责单一：

| 模块 | 职责 | 文件 |
|------|------|------|
| **db/** | 数据库连接、表结构、迁移、初始化 | `index.ts`, `schema.ts`, `migrations.ts`, `init.ts` |
| **routes/** | API 路由处理，按功能域拆分 | `admin-*.ts`, `auth.ts`, `user.ts`, `recharge.ts`, `misc.ts` |
| **services/** | 外部服务封装（Sudorouter、SMS、FuiouPay） | `SudorouterService.ts`, `SmsService.ts`, `FuiouPayService.ts`, `RechargeService.ts` |
| **middleware/** | 认证、授权、限流中间件 | `auth.ts`, `rateLimiter.ts` |
| **utils/** | 通用工具函数 | `password.ts`, `validation.ts`, `invitation.ts`, `crypto.ts` |

#### 用户表 (users)

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 主键 |
| `phone` | TEXT | 手机号 |
| `nickname` | TEXT | 昵称 |
| `role` | TEXT | 角色 (SUPER_ADMIN/ENTERPRISE_ADMIN/USER) |
| `status` | INTEGER | 状态 (0:待审批/1:正常/2:禁用) |
| `enterprise_id` | INTEGER | 企业 ID |
| `sudorouter_user_id` | INTEGER | Sudorouter 用户 ID |
| `sudorouter_key` | TEXT | Sudorouter API Key |
| `balance` | REAL | 积分余额 |

#### 企业表 (enterprises)

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 主键 |
| `name` | TEXT | 企业名称 |
| `code` | TEXT | 企业码（唯一） |

#### 邀请码表 (invitation_codes)

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 主键 |
| `code` | TEXT | 邀请码（唯一） |
| `enterprise_id` | INTEGER | 所属企业 |
| `status` | INTEGER | 状态 (0:未使用/1:已使用) |
| `used_by_user_id` | INTEGER | 使用者 ID |

#### 充值订单表 (recharge_orders)

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 主键 |
| `order_no` | TEXT | 订单号（唯一） |
| `user_id` | INTEGER | 用户 ID |
| `amount_usd` | REAL | 美元金额 |
| `amount_yuan` | REAL | 人民币金额 |
| `exchange_rate` | REAL | 汇率 |
| `points_amount` | INTEGER | 积分数量 |
| `bonus_points` | INTEGER | 赠送积分 |
| `payment_method` | TEXT | 支付方式 (ALIPAY/WECHAT) |
| `status` | INTEGER | 状态 (0:待支付/1:支付中/2:成功/3:失败/4:已退款/5:已取消) |
| `expired_at` | DATETIME | 过期时间 |

#### 充值记录表 (recharge_records)

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 主键 |
| `order_id` | INTEGER | 订单 ID |
| `user_id` | INTEGER | 用户 ID |
| `quota_before/after/delta` | INTEGER | 额度变动 |
| `balance_before/after/delta` | REAL | 积分变动 |
| `sudorouter_success` | BOOLEAN | sudorouter 同步状态 |

#### 后台充值记录表 (admin_recharge_records)

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 主键 |
| `user_id` | INTEGER | 用户 ID |
| `admin_id` | INTEGER | 管理员 ID |
| `points` | INTEGER | 充值积分 |
| `reason` | TEXT | 充值原因 |
| `payment_reference` | TEXT | 支付参考号 |

#### 退款记录表 (refund_records)

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 主键 |
| `refund_no` | TEXT | 退款单号（唯一） |
| `order_id` | INTEGER | 原订单 ID |
| `order_no` | TEXT | 原订单号 |
| `user_id` | INTEGER | 用户 ID |
| `refund_amount_yuan` | REAL | 退款金额（元） |
| `refund_quota` | INTEGER | 退款额度 |
| `refund_points` | INTEGER | 扣除积分 |
| `refund_reason` | TEXT | 退款原因 |
| `refund_type` | TEXT | 退款类型 |
| `status` | INTEGER | 退款状态 |
| `fuiou_refund_no` | TEXT | 富友退款流水号 |
| `fuiou_response` | TEXT | 富友响应 |
| `created_at` | DATETIME | 创建时间 |
| `processed_at` | DATETIME | 处理时间 |

#### 流水表 (ledger)

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 主键 |
| `user_id` | INTEGER | 用户 ID |
| `amount` | REAL | 金额（正=收入，负=支出） |
| `type` | TEXT | 类型 (BONUS/RECHARGE/ADMIN_RECHARGE/CONSUME) |
| `memo` | TEXT | 备注 |

---

## 🔧 常见问题

### 1. Rate Limit 触发后如何处理

等待 `retry_after` 秒后重试，或联系管理员。

### 2. 短信发送失败

**Mock 模式**: 验证码不会打印到日志，需查看 Redis 或使用腾讯云模式。

**腾讯云模式**: 检查 SecretId/SecretKey、签名和模板是否审核通过。

### 3. Redis 连接失败

```bash
docker-compose ps redis
docker-compose logs redis
```

### 4. 忘记超级管理员密码

删除数据库文件重新初始化，或直接修改数据库中的 `password_hash`。

---

## 📄 许可证

Apache-2.0

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！