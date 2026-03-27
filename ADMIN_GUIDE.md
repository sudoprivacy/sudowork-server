# Sudowork-Server 管理后台部署指南

## 📦 当前进度

### 已完成

- ✅ 后端 API 接口（登录、企业 CRUD、用户 CRUD、积分调整）
- ✅ 数据库扩展（password_hash, role, must_change_password 字段）
- ✅ 超级管理员初始化（账号：sudo, 密码：Sudodata-123）
- ✅ 密码加密（bcryptjs）
- ✅ JWT 认证中间件
- ✅ 前端登录页面（React + Vite + Arco Design）

### 开发中

- 🔄 管理后台页面（Dashboard、企业列表、用户管理）
- 🔄 Docker 集成（前端构建打包到镜像）

## 🚀 快速启动（开发模式）

### 1. 启动后端服务

```bash
cd /Users/yobach/Downloads/sudowork-server
bun run src/index.ts
```

首次启动会显示：

```
=== 超级管理员已创建 ===
登录账号：sudo
登录密码：Sudodata-123
请妥善保管密码！
```

### 2. 启动前端（新终端）

```bash
cd /Users/yobach/Downloads/sudowork-server/admin
bun dev
```

访问：`http://localhost:5174/login`

## 🔐 管理员账户

### 账户类型

- **SUPER_ADMIN**: 超级管理员（sudo），管理所有企业和用户
- **ENTERPRISE_ADMIN**: 企业管理员，管理本企业用户
- **USER**: 普通用户

### 默认账户

```
账号：sudo
密码：Sudodata-123
角色：SUPER_ADMIN
```

## 📡 API 接口

### 认证接口

#### 管理员登录

```bash
POST http://localhost:3000/api/v1/admin/login
Content-Type: application/json

{
  "phone": "sudo",
  "password": "Sudodata-123"
}
```

响应：

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGc...",
    "user": {
      "id": 1,
      "phone": "sudo",
      "nickname": "超级管理员",
      "role": "SUPER_ADMIN"
    }
  }
}
```

### 企业接口

#### 获取企业列表

```bash
GET http://localhost:3000/api/v1/admin/enterprises
Authorization: Bearer <token>
```

#### 创建企业

```bash
POST http://localhost:3000/api/v1/admin/enterprises
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "测试企业",
  "code": "TEST",
  "credit_pool": 10000
}
```

#### 删除企业

```bash
DELETE http://localhost:3000/api/v1/admin/enterprises/:id
Authorization: Bearer <token>
```

### 用户接口

#### 获取用户列表

```bash
GET http://localhost:3000/api/v1/admin/users?enterprise_id=1&status=1
Authorization: Bearer <token>
```

#### 创建用户

```bash
POST http://localhost:3000/api/v1/admin/users
Authorization: Bearer <token>
Content-Type: application/json

{
  "phone": "13800138000",
  "nickname": "测试用户",
  "enterprise_id": 1,
  "role": "USER",
  "balance": 100
}
```

#### 更新用户

```bash
PUT http://localhost:3000/api/v1/admin/users/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "nickname": "新昵称",
  "role": "ENTERPRISE_ADMIN",
  "status": 1
}
```

#### 删除用户

```bash
DELETE http://localhost:3000/api/v1/admin/users/:id
Authorization: Bearer <token>
```

#### 设置用户角色

```bash
POST http://localhost:3000/api/v1/admin/users/:id/role
Authorization: Bearer <token>
Content-Type: application/json

{
  "role": "ENTERPRISE_ADMIN"
}
```

#### 调整积分

```bash
POST http://localhost:3000/api/v1/admin/users/:id/points
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 100,
  "reason": "奖励",
  "operation": "add"  // 或 "subtract"
}
```

## 🗄️ 数据库

### 用户表扩展字段

```sql
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN must_change_password BOOLEAN DEFAULT FALSE;
```

### 角色类型

- `SUPER_ADMIN`: 超级管理员
- `ENTERPRISE_ADMIN`: 企业管理员
- `USER`: 普通用户

## 🔒 安全说明

### 密码加密

- 使用 bcryptjs 加密存储
- Salt Rounds: 10
- 密码强度要求：至少 8 位，包含字母和数字

### JWT Token

- 过期时间：24 小时
- 签名算法：HS256
- 密钥：`sudowork-secret-key`（建议生产环境修改）

## 📝 下一步计划

### 待完成功能

1. Dashboard 仪表盘页面
2. 企业列表页面（完整 CRUD）
3. 用户管理页面（完整 CRUD）
4. 积分调整弹窗
5. Docker 构建集成

### 优化建议

1. 支持批量操作
2. 添加搜索/筛选功能
3. 添加分页功能
4. 完善错误处理
5. 添加操作日志

## 🐛 常见问题

### Q: 无法登录？

A: 确认账号是 `sudo`，密码是 `Sudodata-123`，检查后端是否正常运行。

### Q: Token 无效？

A: Token 过期时间为 24 小时，过期后重新登录即可。

### Q: 权限不足？

A: 部分接口需要 SUPER_ADMIN 权限，请使用超级管理员账号操作。

## 📞 技术支持

如有问题，请查看服务器日志：

```bash
tail -f /Users/yobach/Downloads/sudowork-server/server.log
```
