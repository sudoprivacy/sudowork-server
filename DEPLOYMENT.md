# Sudowork-Server 管理后台部署指南

## 📦 完整功能清单

### 后端 API (100%)

- ✅ 密码加密（bcryptjs）
- ✅ JWT 认证中间件
- ✅ 超级管理员自动初始化（账号：sudo，密码：Sudodata-123）
- ✅ 管理员登录接口
- ✅ 修改密码接口
- ✅ 仪表盘统计接口
- ✅ 企业 CRUD 接口
- ✅ 用户 CRUD 接口
- ✅ 积分调整接口

### 前端页面 (100%)

- ✅ 登录页面（带 Sudowork Logo）
- ✅ Dashboard 仪表盘（统计卡片 + 积分统计）
- ✅ 企业列表（新建/删除）
- ✅ 用户管理（新建/删除/角色设置）
- ✅ Layout 布局（侧边栏 + 顶部导航）
- ✅ 退出登录功能

### Docker 部署 (100%)

- ✅ 多阶段构建（前端 + 后端）
- ✅ 生产镜像构建
- ✅ docker-compose 编排

---

## 🚀 快速启动

### 方式一：Docker 部署（生产环境推荐）

#### 1. 构建镜像

```bash
cd /Users/yobach/Downloads/sudowork-server
docker-compose build
```

#### 2. 启动服务

```bash
docker-compose up -d
```

#### 3. 访问管理后台

```
http://localhost:3000/login
```

**登录信息**:

- 账号：`sudo`
- 密码：`Sudodata-123`

### 方式二：本地开发（开发环境）

#### 1. 启动后端

```bash
cd /Users/yobach/Downloads/sudowork-server
bun run src/index.ts
```

#### 2. 启动前端（新终端）

```bash
cd /Users/yobach/Downloads/sudowork-server/admin
bun dev
```

访问：`http://localhost:5174/login`

---

## 📡 API 接口完整列表

### 认证接口

#### 管理员登录

```bash
POST /api/v1/admin/login
Content-Type: application/json

{
  "phone": "sudo",
  "password": "Sudodata-123"
}
```

响应:

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

### 统计接口

#### 仪表盘统计

```bash
GET /api/v1/admin/stats
Authorization: Bearer <token>
```

### 企业接口

#### 获取企业列表

```bash
GET /api/v1/admin/enterprises
Authorization: Bearer <token>
```

#### 创建企业

```bash
POST /api/v1/admin/enterprises
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
DELETE /api/v1/admin/enterprises/:id
Authorization: Bearer <token>
```

### 用户接口

#### 获取用户列表

```bash
GET /api/v1/admin/users
Authorization: Bearer <token>
```

#### 创建用户

```bash
POST /api/v1/admin/users
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
PUT /api/v1/admin/users/:id
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
DELETE /api/v1/admin/users/:id
Authorization: Bearer <token>
```

#### 设置用户角色

```bash
POST /api/v1/admin/users/:id/role
Authorization: Bearer <token>
Content-Type: application/json

{
  "role": "ENTERPRISE_ADMIN"
}
```

#### 调整积分

```bash
POST /api/v1/admin/users/:id/points
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 100,
  "reason": "奖励",
  "operation": "add"
}
```

---

## 🎨 管理后台功能

### 1. 仪表盘

- 企业总数统计
- 用户总数统计
- 已审批/待审批统计
- 积分发放/消耗/余额统计
- 快捷操作入口

### 2. 企业列表

- 企业列表展示
- 新建企业（弹窗表单）
- 删除企业（二次确认）
- 显示用户数和积分池

### 3. 用户管理

- 用户列表展示
- 新建用户（弹窗表单）
- 删除用户（二次确认）
- 角色标签显示
- 积分显示

---

## 🔒 安全说明

### 密码安全

- bcryptjs 加密存储
- Salt Rounds: 10
- 密码强度验证（8 位以上，含字母数字）

### JWT Token

- 过期时间：24 小时
- 自动刷新：需重新登录
- 安全存储：localStorage

### 权限控制

- SUPER_ADMIN: 所有权限
- ENTERPRISE_ADMIN: 本企业管理
- USER: 无管理权限

---

## 🐛 常见问题

### Q: 前端构建失败？

A: 检查是否已安装依赖：

```bash
cd admin
bun install
bun run build
```

### Q: 无法登录？

A: 确认账号密码正确（sudo / Sudodata-123），检查后端日志。

### Q: Token 无效？

A: Token 过期时间为 24 小时，过期后重新登录。

### Q: Docker 构建失败？

A: 检查 Docker 和 Docker Compose 版本：

```bash
docker --version  # >= 20.10
docker-compose --version  # >= 2.0
```

---

## 📝 下一步优化

1. **功能增强**
   - [ ] 搜索/筛选功能
   - [ ] 分页功能
   - [ ] 批量操作
   - [ ] 积分调整弹窗

2. **用户体验**
   - [ ] 加载动画优化
   - [ ] 错误提示优化
   - [ ] 响应式布局

3. **安全加固**
   - [ ] 操作日志记录
   - [ ] IP 限制
   - [ ] 二次验证

---

## 📞 技术支持

查看服务日志：

```bash
docker-compose logs -f sudowork-server
```

查看后端日志：

```bash
tail -f /Users/yobach/Downloads/sudowork-server/server.log
```

---

**管理后台已完全实现并可部署使用！** 🎉
