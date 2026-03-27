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

## 🔐 安全特性

| 特性 | 说明 |
|------|------|
| **Rate Limiting** | 登录/验证码接口 15 分钟最多 5-10 次/IP |
| **余额检查** | 消费前检查余额，防止负数 |
| **JWT 认证** | 24 小时过期，支持多角色权限 |
| **密码加密** | bcrypt 加密存储 |
| **敏感信息保护** | Token/验证码不打印日志 |

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
- 🎫 邀请码 - 批量生成/查看邀请码
- 👥 用户管理 - 添加/修改/删除用户，设置积分
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
| `DB_PATH` | SQLite 数据库路径 | `/app/data/sudowork.db` |
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
- `POST /api/v1/admin/users/:id/points` - 调整积分
- `POST /api/v1/admin/users/:id/manage` - 启用/禁用用户

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
│   ├── index.ts                 # 主入口、路由定义
│   ├── redis.ts                 # Redis 连接
│   ├── middleware/
│   │   ├── auth.ts              # JWT 认证中间件
│   │   └── rateLimiter.ts       # 速率限制中间件
│   ├── services/
│   │   ├── SmsService.ts        # 短信服务
│   │   └── SudorouterService.ts # Sudorouter API 封装
│   └── utils/
│       └── password.ts          # 密码加密工具
├── admin/                       # 管理后台前端源码
├── admin-dist/                  # 构建后的前端静态文件
├── data/                        # SQLite 数据库（持久化）
├── docker-compose.yml           # Docker 编排
├── Dockerfile                   # Docker 镜像
├── .env.example                 # 环境变量模板
└── README.md                    # 本文档
```

### 数据模型

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