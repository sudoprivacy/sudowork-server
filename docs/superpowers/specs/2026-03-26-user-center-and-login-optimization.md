# 用户中心与登录接口优化开发计划

**日期**: 2026-03-26
**版本**: v1.1
**状态**: ✅ 已完成

---

## 一、需求概述

### 1.1 登录接口修复
修复客户端登录流程，确保新用户创建时正确充值初始额度。

### 1.2 用户中心功能
客户端用户中心展示：
- sudorouter_key（API Key）
- 总积分（quota × 0.002）
- 已用积分（used_quota × 0.002）
- 剩余积分
- 使用流水

---

## 二、问题分析

### 2.1 登录接口问题

#### 问题1：新用户缺少充值步骤（P0 - 关键）

**当前代码位置**：`src/index.ts:1595-1622`

**当前流程**：
```
1. 创建 sudorouter 用户 ✅
2. 创建令牌 ✅
3. 创建本地用户 ✅
```

**正确流程**：
```
1. 创建 sudorouter 用户
2. 充值初始额度（updateUserQuota）← 缺失
3. 创建令牌 (unlimited_quota=true)
4. 创建本地用户
```

**说明**：
- `unlimited_quota=true` 表示 token 本身不限额
- sudorouter 会根据 key 扣减用户额度
- 用户额度通过 `updateUserQuota` 充值

#### 问题2：已存在用户返回信息不完整（P1）

**当前代码位置**：`src/index.ts:1557-1570`

**当前返回**：
```json
{
  "token": "jwt...",
  "user": {
    "id": 1,
    "phone": "xxx",
    "nickname": "xxx",
    "role": "USER",
    "status": 1,
    "enterprise_code": "sudo"
  }
}
```

**缺少**：
- `sudorouter_key` - API Key
- `points` - 积分信息（总积分、已用积分、剩余积分）

### 2.2 用户流水接口

**当前状态**：已实现 `GET /api/v1/user/ledger`

**需确认**：返回格式是否满足客户端需求

---

## 三、Sudorouter API 流程说明

### 3.1 创建用户流程

```
┌─────────────────────────────────────────────────────────────┐
│                    客户端登录流程                             │
├─────────────────────────────────────────────────────────────┤
│  1. 用户输入：手机号 + 短信验证码 + 邀请码                     │
│  2. sudowork-server 校验                                     │
│     ├─ 验证短信验证码                                         │
│     ├─ 验证邀请码                                             │
│     └─ 验证企业码（固定 sudo）                                 │
│                                                              │
│  3. 用户存在？                                                │
│     ├─ 是 → 从 sudorouter 同步额度 → 返回用户信息              │
│     └─ 否 → 创建用户流程                                      │
│         ├─ 调用 sudorouter createUser                        │
│         ├─ 调用 sudorouter updateUserQuota（充值初始额度）     │
│         ├─ 调用 sudorouter createToken（unlimited_quota=true）│
│         └─ 创建本地用户 → 返回用户信息                         │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Sudorouter API 说明

| API | 用途 | 说明 |
|-----|------|------|
| POST /api/user/ | 创建用户 | 返回 user.id |
| PUT /api/user/quota | 更新额度 | 正数=充值，负数=扣减 |
| POST /api/token/ | 创建令牌 | unlimited_quota=true |
| GET /api/user/{id} | 获取用户信息 | 返回 quota、used_quota |
| GET /api/log/ | 获取使用日志 | 模型使用记录 |

---

## 四、实现计划

### Phase 1：修复登录接口 - 新用户充值（P0）

**文件**：`src/index.ts`

**修改位置**：1605-1607 行之间

**修改内容**：
```typescript
// 调用 sudorouter 创建用户
const sudorouterUser = await sudorouterService.createUser(phone);
if (!sudorouterUser) { ... }

// 【新增】充值初始额度
const initialQuota = sudorouterService.getInitialQuota();
const quotaResult = await sudorouterService.updateUserQuota(
  sudorouterUser.id,
  initialQuota,
  "新用户注册赠送额度"
);

if (!quotaResult.success) {
  console.error(`[Login] 用户 ${phone} 额度充值失败: ${quotaResult.error}`);
  // 记录日志但不阻止流程
}

// 调用 sudorouter 创建令牌
const sudorouterKey = await sudorouterService.createToken(
  sudorouterUser.id,
  phone,
  true, // unlimited_quota
);
```

**预计工作量**：0.5 小时

---

### Phase 2：优化登录接口 - 已存在用户返回信息（P1）

**文件**：`src/index.ts`

**修改位置**：1533-1570 行

**修改内容**：

1. 从 sudorouter 同步用户额度
2. 返回 sudorouter_key 和积分信息

```typescript
if (user) {
  // 验证邀请码
  if (user.invitation_code_id !== invitationCode.id) {
    return c.json({ success: false, msg: "邀请码错误" }, 400);
  }

  // 从 sudorouter 同步额度
  let totalPoints = 0;
  let usedPoints = 0;
  let remainingPoints = 0;

  if (user.sudorouter_user_id && sudorouterService.isConfigured()) {
    const sudorouterUser = await sudorouterService.getUser(user.sudorouter_user_id);
    if (sudorouterUser) {
      totalPoints = sudorouterService.quotaToPoints(sudorouterUser.quota || 0);
      usedPoints = sudorouterService.quotaToPoints(sudorouterUser.used_quota || 0);
      remainingPoints = totalPoints;

      // 更新本地数据库
      db.run(
        "UPDATE users SET quota = ?, used_quota = ?, balance = ? WHERE id = ?",
        [sudorouterUser.quota, sudorouterUser.used_quota, remainingPoints, user.id]
      );
    }
  }

  // 生成 token
  const token = await sign({ ... }, SECRET);

  return c.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        phone: user.phone,
        nickname: user.nickname,
        role: user.role,
        status: user.status,
        enterprise_code: enterprise.code,
        sudorouter_key: user.sudorouter_key ? `sk-${user.sudorouter_key.substring(0, 24)}...` : null,
        points: {
          total: totalPoints,
          used: usedPoints,
          remaining: remainingPoints,
          bonus: sudorouterService.getInitialPoints()
        }
      }
    }
  });
}
```

**预计工作量**：1 小时

---

### Phase 3：统一新用户返回信息（P1）

**文件**：`src/index.ts`

**修改位置**：1684-1697 行

**修改内容**：与新用户返回格式保持一致，包含 sudorouter_key 和 points

**预计工作量**：0.5 小时

---

### Phase 4：确认用户流水接口（P2）

**文件**：`src/index.ts`

**当前实现**：`GET /api/v1/user/ledger`

**需要确认**：
- 返回格式是否满足客户端需求
- 是否需要添加分页元数据

**预计工作量**：0.5 小时

---

### Phase 5：新增用户统计接口 ✅ 已完成

**新接口**：`GET /api/v1/user/stats`

**用途**：快速获取用户中心统计数据

**实现位置**：`src/index.ts:1878-1948`

**返回示例**：
```json
{
  "success": true,
  "data": {
    "points": {
      "total": 200,
      "used": 10,
      "remaining": 190,
      "bonus": 1000
    },
    "usage_today": {
      "tokens": 5000,
      "cost_points": 1.0,
      "requests": 15
    }
  }
}
```

**预计工作量**：1 小时

---

## 五、API 接口文档

### 5.1 POST /api/v1/auth/login

**请求参数**：
```json
{
  "phone": "13800138000",
  "code": "123456",
  "invitation_code": "777302",
  "enterprise_code": "sudo"
}
```

**响应（用户存在）**：
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": 1,
      "phone": "13800138000",
      "nickname": "用户昵称",
      "role": "USER",
      "status": 1,
      "enterprise_code": "sudo",
      "sudorouter_key": "sk-xxx...xxx",
      "points": {
        "total": 200,
        "used": 10,
        "remaining": 190,
        "bonus": 1000
      }
    }
  }
}
```

**响应（新用户创建成功）**：
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": 2,
      "phone": "13900139000",
      "nickname": "13900139000",
      "role": "USER",
      "status": 1,
      "enterprise_code": "sudo",
      "sudorouter_key": "sk-yyy...yyy",
      "points": {
        "total": 1000,
        "used": 0,
        "remaining": 1000,
        "bonus": 1000
      }
    }
  }
}
```

### 5.2 GET /api/v1/user/ledger

**请求参数**：
- `time_from`: 开始时间戳（秒）
- `time_to`: 结束时间戳（秒）
- `page`: 页码
- `page_size`: 每页数量

**响应**：
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "created_at": 1640000000,
      "model_name": "claude-3-5-sonnet",
      "quota": 1250,
      "prompt_tokens": 1500,
      "completion_tokens": 500,
      "use_time": 1500
    }
  ],
  "total": 100,
  "page": 1,
  "page_size": 20
}
```

---

## 六、积分计算规则

| 概念 | 计算方式 | 示例 |
|------|----------|------|
| 初始额度 | 环境变量 USER_INITIAL_QUOTA | 500000 |
| 初始积分 | quota × 0.002 | 1000 |
| 总积分 | quota × 0.002 | 200 |
| 已用积分 | used_quota × 0.002 | 10 |
| 剩余积分 | (quota - used_quota) × 0.002 | 190 |

---

## 七、风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 新用户无初始额度 | 🔴 高 | Phase 1 优先修复 |
| sudorouter 服务不可用 | 🟡 中 | 添加超时和错误处理，降级使用本地数据 |
| API Key 安全 | 🟡 中 | 返回时脱敏处理（仅显示前24字符） |

---

## 八、依赖关系

```
Phase 1（充值步骤）✅ 已完成
    ↓
Phase 2（已存在用户优化）✅ 已完成
    ↓
Phase 3（新用户返回格式统一）✅ 已完成
    ↓
Phase 4（流水接口确认）✅ 已完成
    ↓
Phase 5（统计接口）✅ 已完成
```

---

## 九、工作量估计

| 阶段 | 工作量 | 优先级 | 状态 |
|------|--------|--------|------|
| Phase 1 | 0.5 小时 | P0 | ✅ 已完成 |
| Phase 2 | 1 小时 | P1 | ✅ 已完成 |
| Phase 3 | 0.5 小时 | P1 | ✅ 已完成 |
| Phase 4 | 0.5 小时 | P2 | ✅ 已完成 |
| Phase 5 | 1 小时 | 可选 | ✅ 已完成 |
| 测试验证 | 1 小时 | - | ✅ 已完成 |
| **总计** | **4.5 小时** | - | **全部完成** |

---

## 十、关键文件

| 文件 | 修改内容 |
|------|----------|
| `src/index.ts` | 登录接口、用户信息接口、用户流水接口、用户统计接口 |
| `src/services/SudorouterService.ts` | 已完整实现，无需修改 |
| `admin/src/pages/UserList.tsx` | 已实现 API Key 展示 |

---

## 十一、已实现接口汇总

| 接口 | 方法 | 用途 | 状态 |
|------|------|------|------|
| `/api/v1/auth/login` | POST | 用户登录/注册 | ✅ 已完成 |
| `/api/v1/user/profile` | GET | 获取用户信息 | ✅ 已完成 |
| `/api/v1/user/ledger` | GET | 获取使用流水 | ✅ 已完成 |
| `/api/v1/user/stats` | GET | 获取用户统计 | ✅ 已完成 |