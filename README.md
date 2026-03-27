# Sudowork-Server

企业级 Agent 协同管理平台后端服务，提供用户认证、企业管理、积分管理、Sudorouter 集成等功能。

## 📋 功能特性

- ✅ **用户认证**: 短信验证码登录，支持企业码验证
- ✅ **企业管理**: 多企业支持，管理员审批流，成员管理
- ✅ **积分管理**: 余额查询、流水记录、积分消费
- ✅ **Sudorouter 集成**: API Key 分发、用量上报、模型查询
- ✅ **短信服务**: 腾讯云 SMS 集成，支持 Mock 模式
- ✅ **权限控制**: JWT 认证，角色管理（管理员/普通用户）
- ✅ **管理后台**: Web 管理界面，支持企业/用户管理

## 🎯 管理后台

### 超级管理员账户

首次启动会自动创建超级管理员账户：

- **账号**: `sudo`
- **密码**: `Sudodata-123`
- **角色**: `SUPER_ADMIN`

⚠️ **重要**: 首次登录后建议修改默认密码！

### 访问管理后台

启动服务后，访问：`http://localhost:3000/`

登录后可管理：

- 📊 仪表盘 - 查看统计数据
- 🏢 企业列表 - 添加/删除企业
- 👥 用户管理 - 添加/修改/删除用户，设置积分

## 🚀 快速开始

### 方式一：Docker 部署（推荐）

#### 前置要求

- Docker >= 20.10
- Docker Compose >= 2.0

#### 部署步骤

1. **克隆项目**

```bash
git clone <repository-url>
cd sudowork-server
```

2. **配置环境变量**

```bash
cp .env.example .env
# 编辑 .env 文件，配置必要参数
```

3. **启动服务**

```bash
# 后台运行
docker-compose up -d

# 查看日志
docker-compose logs -f sudowork-server
```

4. **验证部署**

```bash
curl http://localhost:3000/
```

5. **停止服务**

```bash
docker-compose down
```

#### 数据持久化

SQLite 数据库和 Redis 数据会自动挂载到本地：

- `./data/` - SQLite 数据库文件
- `redis-data` 卷 - Redis 数据

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
```

3. **启动 Redis**

```bash
redis-server
```

4. **启动服务**

```bash
bun run src/index.ts
```

## 📖 环境变量说明

### 必需配置

| 变量名         | 说明           | 默认值      | 示例                |
| -------------- | -------------- | ----------- | ------------------- |
| `REDIS_HOST`   | Redis 主机地址 | `localhost` | `redis` (Docker)    |
| `REDIS_PORT`   | Redis 端口     | `6379`      | `6379`              |
| `SMS_PROVIDER` | 短信提供商     | `mock`      | `mock` 或 `tencent` |

### 腾讯云短信配置（SMS_PROVIDER=tencent 时必需）

| 变量名                | 说明             | 获取方式                                                   |
| --------------------- | ---------------- | ---------------------------------------------------------- |
| `TENCENT_SECRET_ID`   | 腾讯云 SecretId  | [腾讯云控制台](https://console.cloud.tencent.com/cam/capi) |
| `TENCENT_SECRET_KEY`  | 腾讯云 SecretKey | [腾讯云控制台](https://console.cloud.tencent.com/cam/capi) |
| `TENCENT_SDK_APP_ID`  | 短信 SDK AppID   | [短信控制台](https://console.cloud.tencent.com/smsv2)      |
| `TENCENT_SIGN_NAME`   | 短信签名         | 需审核通过                                                 |
| `TENCENT_TEMPLATE_ID` | 短信模板 ID      | 需审核通过                                                 |
| `TENCENT_REGION`      | 腾讯云区域       | `ap-beijing`                                               |

### 验证码配置

| 变量名                    | 说明                   | 默认值 |
| ------------------------- | ---------------------- | ------ |
| `SMS_CODE_LENGTH`         | 验证码长度             | `6`    |
| `SMS_CODE_EXPIRE_MINUTES` | 验证码过期时间（分钟） | `5`    |
| `SMS_CODE_SEND_INTERVAL`  | 发送间隔（秒）         | `60`   |
| `SMS_CODE_MAX_PER_DAY`    | 每日最大发送次数       | `10`   |

## 🔌 API 文档

### 基础信息

- **Base URL**: `http://localhost:3000`
- **认证方式**: Bearer Token (JWT)
- **请求格式**: `application/json`

### 认证接口

#### 1. 发送短信验证码

**POST** `/api/v1/auth/send-code`

**请求体**:

```json
{
  "phone": "13653658804"
}
```

**响应**:

```json
{
  "success": true,
  "msg": "验证码已发送",
  "expire": 300,
  "next_send_in": 60,
  "daily_remaining": 9
}
```

**错误响应**:

```json
{
  "success": false,
  "msg": "发送过于频繁，请 30 秒后再试",
  "next_send_in": 30
}
```

---

#### 2. 验证码登录

**POST** `/api/v1/auth/login`

**请求体**:

```json
{
  "phone": "13653658804",
  "code": "123456",
  "enterprise_code": "sudo"
}
```

**响应** (登录成功):

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "nickname": "管理员",
      "role": "ADMIN",
      "status": 1,
      "enterprise_code": "sudo"
    }
  }
}
```

**响应** (待审批):

```json
{
  "success": false,
  "status": 0,
  "msg": "账号审核中，暂时无法进入系统"
}
```

---

### 用户接口

需要 JWT 认证，请求头包含：

```
Authorization: Bearer <your-jwt-token>
```

#### 3. 获取用户信息

**GET** `/api/v1/user/profile`

**响应**:

```json
{
  "success": true,
  "data": {
    "id": 1,
    "phone": "13653658804",
    "nickname": "管理员",
    "role": "ADMIN",
    "status": 1,
    "enterprise_code": "sudo",
    "balance": 1000,
    "total_points": 1000,
    "used_points": 0
  }
}
```

---

#### 4. 获取积分流水

**GET** `/api/v1/user/ledger`

**响应**:

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "user_id": 1,
      "amount": 1000,
      "type": "BONUS",
      "reason": "系统初始化配额",
      "balance": 1000,
      "timestamp": "2026-03-23T10:00:00.000Z"
    }
  ]
}
```

---

#### 5. 用量上报

**POST** `/api/v1/usage/report`

**请求体**:

```json
{
  "inputTokens": 100,
  "outputTokens": 200,
  "model": "claude-3-5-sonnet"
}
```

**响应**:

```json
{
  "success": true,
  "deducted": 0.3,
  "newBalance": 999.7
}
```

**计费规则**:

- 1000 Tokens = 1 积分
- 计算公式：`points = ceil((inputTokens + outputTokens) / 1000 * 100) / 100`

---

### 管理接口

需要管理员权限（role: ADMIN）

#### 6. 获取成员列表

**GET** `/api/v1/admin/members`

**响应**:

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "phone": "13653658804",
      "nickname": "管理员",
      "role": "ADMIN",
      "status": 1,
      "enterprise_id": 1,
      "balance": 1000
    },
    {
      "id": 2,
      "phone": "13800138000",
      "nickname": "13800138000",
      "role": "USER",
      "status": 0,
      "enterprise_id": 1,
      "balance": 0
    }
  ]
}
```

**状态说明**:

- `status: 0` - 待审批
- `status: 1` - 已批准
- `status: 2` - 已拒绝

---

#### 7. 审批用户

**POST** `/api/v1/admin/approve`

**请求体**:

```json
{
  "userId": 2
}
```

**响应**:

```json
{
  "success": true,
  "msg": "审批成功"
}
```

**操作**:

- 用户状态变为 `已批准` (status: 1)
- 分配 Sudorouter API Key
- 赠送 100 初始积分

---

#### 8. 拒绝用户

**POST** `/api/v1/admin/reject`

**请求体**:

```json
{
  "userId": 2
}
```

**响应**:

```json
{
  "success": true,
  "msg": "已拒绝申请"
}
```

**操作**:

- 用户状态变为 `已拒绝` (status: 2)
- 记录拒绝日志

---

#### 9. 删除用户

**POST** `/api/v1/admin/delete`

**请求体**:

```json
{
  "userId": 2
}
```

**响应**:

```json
{
  "success": true,
  "msg": "用户已删除"
}
```

**注意**:

- 不能删除管理员账户
- 会删除用户相关的积分流水记录

---

### Sudorouter 接口

#### 10. 获取模型列表

**GET** `/api/v1/router/models`

**响应**:

```json
{
  "success": true,
  "data": [
    {
      "label": "Claude 3.5 Sonnet (Global)",
      "value": "claude-3-5-sonnet"
    },
    {
      "label": "GPT-4o (Global)",
      "value": "gpt-4o"
    },
    {
      "label": "DeepSeek V3",
      "value": "deepseek-v3"
    }
  ]
}
```

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
│   ├── index.ts              # 主入口
│   ├── redis.ts              # Redis 连接
│   └── services/
│       ├── SmsService.ts     # 短信服务
│       └── SudoworkService.ts # Sudorouter 服务
├── admin/                    # 管理后台前端源码
├── admin-dist/               # 构建后的前端静态文件
├── data/                     # SQLite 数据库（持久化）
├── docker-compose.yml        # Docker 编排
├── Dockerfile               # Docker 镜像
├── .env.example             # 环境变量模板
└── README.md                # 本文档
```

### 数据模型

#### 用户表 (users)

- `id`: 主键
- `phone`: 手机号
- `nickname`: 昵称
- `role`: 角色 (ADMIN/USER)
- `status`: 状态 (0:待审批/1:已批准/2:已拒绝)
- `enterprise_id`: 企业 ID
- `api_key`: Sudorouter API Key
- `balance`: 积分余额

#### 企业表 (enterprises)

- `id`: 主键
- `name`: 企业名称
- `code`: 企业码（唯一）
- `credit_pool`: 积分池

#### 积分流水表 (ledger)

- `id`: 主键
- `user_id`: 用户 ID
- `amount`: 变动金额
- `type`: 类型 (BONUS/CONSUME/REJECT)
- `reason`: 原因
- `timestamp`: 时间戳

---

## 🔧 常见问题

### 1. 短信发送失败

**Mock 模式**: 查看服务器日志获取验证码

```bash
docker-compose logs sudowork-server | grep "验证码"
```

**腾讯云模式**:

- 检查 SecretId/SecretKey 是否正确
- 确认短信签名和模板已审核通过
- 检查手机号格式（支持 11 位或 +86 格式）

### 2. Redis 连接失败

检查 Redis 服务状态：

```bash
docker-compose ps redis
docker-compose logs redis
```

### 3. 数据库文件位置

SQLite 数据库文件位于 `./data/sudowork.db`，会自动创建。

### 4. 管理员账户

首次启动会自动创建管理员账户：

- **手机号**: `13653658804`
- **企业码**: `sudo`
- **角色**: ADMIN
- **初始积分**: 1000

---

## 📝 开发指南

### 本地调试

```bash
# 安装依赖
bun install

# 启动 Redis
redis-server

# 启动服务（热重载）
bun run --hot src/index.ts
```

### 添加新功能

1. 在 `src/services/` 创建服务模块
2. 在 `src/index.ts` 注册 API 路由
3. 更新本文档的 API 章节

---

## 📄 许可证

Apache-2.0

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
