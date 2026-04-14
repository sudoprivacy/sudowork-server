# 代码质量优化设计文档

**日期**: 2026-04-02
**状态**: 待实施
**范围**: 小幅改进，不改变现有架构

---

## 背景

sudowork-server 项目经过分析，发现以下代码质量问题需要优化：

| 问题类型 | 严重程度 | 示例位置 |
|---------|---------|---------|
| 代码重复 | 高 | 操作日志记录在 admin-users.ts 中重复 10+ 次 |
| 文件过长 | 中 | admin-users.ts: 1497 行，RechargeService.ts: 1067 行 |
| 类型安全 | 中 | 大量 `as any` 类型断言 |
| 魔法数字 | 低 | 状态码 0/1/2/3/4/5 没有常量定义 |

---

## 设计目标

1. 减少代码重复，提取公共工具函数
2. 增强类型安全，减少 `as any` 使用
3. 拆分大文件，提高代码可读性
4. 保持 API 接口完全兼容

---

## 实施方案

### 阶段一：提取公共工具函数

#### 1.1 创建 `src/utils/logger.ts`

封装操作日志记录功能：

```typescript
import { db } from '../db/index.js';

export interface LogOperationParams {
  userId: number;
  userPhone: string;
  action: string;
  resource: string;
  resourceId?: number;
  method?: string;
  path?: string;
  requestData?: any;
  responseData?: any;
  responseStatus?: number;
  durationMs?: number;
  errorMessage?: string;
}

export function logOperation(params: LogOperationParams): void {
  db.run(
    `INSERT INTO operation_logs (
      user_id, user_phone, action, resource, resource_id,
      method, path, request_data, response_data,
      response_status, duration_ms, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.userId,
      params.userPhone,
      params.action,
      params.resource,
      params.resourceId || null,
      params.method || null,
      params.path || null,
      params.requestData ? JSON.stringify(params.requestData) : null,
      params.responseData ? JSON.stringify(params.responseData) : null,
      params.responseStatus || null,
      params.durationMs || null,
      params.errorMessage || null,
    ]
  );
}
```

#### 1.2 创建 `src/utils/constants.ts`

定义状态常量：

```typescript
// 订单状态
export const ORDER_STATUS = {
  PENDING: 0,      // 待支付
  PAYING: 1,       // 支付中
  SUCCESS: 2,      // 支付成功
  FAILED: 3,       // 支付失败
  REFUNDED: 4,     // 已退款
  CANCELLED: 5,    // 已取消
} as const;

export type OrderStatus = typeof ORDER_STATUS[keyof typeof ORDER_STATUS];

// 订单状态文本映射
export const ORDER_STATUS_TEXT: Record<OrderStatus, string> = {
  [ORDER_STATUS.PENDING]: '待支付',
  [ORDER_STATUS.PAYING]: '支付中',
  [ORDER_STATUS.SUCCESS]: '支付成功',
  [ORDER_STATUS.FAILED]: '支付失败',
  [ORDER_STATUS.REFUNDED]: '已退款',
  [ORDER_STATUS.CANCELLED]: '已取消',
};

// 用户状态
export const USER_STATUS = {
  PENDING: 0,      // 待审批
  APPROVED: 1,     // 正常
  DISABLED: 2,     // 禁用
} as const;

export type UserStatus = typeof USER_STATUS[keyof typeof USER_STATUS];

// 用户角色
export const USER_ROLES = {
  USER: 'USER',
  ENTERPRISE_ADMIN: 'ENTERPRISE_ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;

export type UserRole = typeof USER_ROLES[keyof typeof USER_ROLES];
```

---

### 阶段二：增强类型定义

#### 2.1 创建 `src/types/index.ts`

```typescript
import type { OrderStatus, UserStatus, UserRole } from '../utils/constants.js';

// ==================== API Response ====================

export interface ApiResponse<T = any> {
  success: boolean;
  msg?: string;
  data?: T;
}

// ==================== User Types ====================

export interface User {
  id: number;
  phone: string;
  nickname: string | null;
  role: UserRole;
  status: UserStatus;
  enterprise_id: number | null;
  sudorouter_user_id: number | null;
  sudorouter_key: string | null;
  balance: number;
  quota: number;
  used_quota: number;
  invitation_code_id: number | null;
  created_at: string;
}

export interface UserWithEnterprise extends User {
  enterprise_name: string | null;
  invitation_code: string | null;
}

// ==================== Order Types ====================

export interface RechargeOrder {
  id: number;
  order_no: string;
  user_id: number;
  user_phone: string | null;
  enterprise_id: number | null;
  amount_usd: number;
  amount_yuan: number;
  amount_cents: number;
  exchange_rate: number;
  quota_amount: number;
  points_amount: number;
  bonus_points: number;
  payment_method: 'ALIPAY' | 'WECHAT';
  order_date: string;
  fuiou_order_info: string | null;
  status: OrderStatus;
  callback_data: string | null;
  callback_time: string | null;
  expired_at: string;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface RechargeOrderWithUser extends RechargeOrder {
  user_phone: string | null;
  user_nickname: string | null;
}

// ==================== Ledger Types ====================

export interface LedgerEntry {
  id: number;
  user_id: number;
  amount: number;
  type: 'BONUS' | 'RECHARGE' | 'CONSUME' | 'ADMIN_RECHARGE' | 'REFUND';
  memo: string | null;
  timestamp: string;
}

// ==================== Enterprise Types ====================

export interface Enterprise {
  id: number;
  name: string | null;
  code: string;
  credit_pool: number;
}

// ==================== Invitation Code Types ====================

export interface InvitationCode {
  id: number;
  code: string;
  enterprise_id: number;
  status: 0 | 1;  // 0: 未使用, 1: 已使用
  used_by_user_id: number | null;
  created_at: string;
  used_at: string | null;
}
```

#### 2.2 替换 `as any` 的策略

| 文件 | 当前 `as any` 数量 | 替换方式 |
|------|-------------------|---------|
| admin-users.ts | ~30 处 | 使用 `User`, `RechargeOrder` 类型 |
| auth.ts | ~10 处 | 使用 `User` 类型 |
| RechargeService.ts | ~15 处 | 使用 `RechargeOrder`, `User` 类型 |
| user.ts | ~5 处 | 使用 `User`, `LedgerEntry` 类型 |

---

### 阶段三：拆分大文件

#### 3.1 新目录结构

```
src/routes/admin/
├── index.ts          # 挂载所有管理路由
├── stats.ts          # 统计数据接口
├── users.ts          # 用户 CRUD
├── points.ts         # 积分调整
├── recharge.ts       # 充值订单管理
└── sync.ts           # 同步相关
```

#### 3.2 文件职责划分

| 文件 | 行数 | 职责 |
|------|------|------|
| `stats.ts` | ~40 行 | GET /stats - 仪表盘统计 |
| `users.ts` | ~400 行 | 用户 CRUD、角色设置、启用/禁用 |
| `points.ts` | ~200 行 | 积分调整、后台充值、额度同步 |
| `recharge.ts` | ~500 行 | 订单列表、详情、退款、统计 |
| `sync.ts` | ~100 行 | 订单重试、同步 |

#### 3.3 路由挂载方式

```typescript
// src/routes/admin/index.ts
import { Hono } from 'hono';
import { statsRoutes } from './stats.js';
import { usersRoutes } from './users.js';
import { pointsRoutes } from './points.js';
import { rechargeRoutes } from './recharge.js';
import { syncRoutes } from './sync.js';

const adminRoutes = new Hono();

adminRoutes.route('/', statsRoutes);
adminRoutes.route('/', usersRoutes);
adminRoutes.route('/', pointsRoutes);
adminRoutes.route('/', rechargeRoutes);
adminRoutes.route('/', syncRoutes);

export { adminRoutes };
```

---

## 文件变更清单

### 新增文件

| 文件路径 | 说明 |
|---------|------|
| `src/utils/logger.ts` | 操作日志工具函数 |
| `src/utils/constants.ts` | 状态常量定义 |
| `src/types/index.ts` | 类型定义 |
| `src/routes/admin/index.ts` | 管理路由挂载 |
| `src/routes/admin/stats.ts` | 统计接口 |
| `src/routes/admin/users.ts` | 用户管理接口 |
| `src/routes/admin/points.ts` | 积分管理接口 |
| `src/routes/admin/recharge.ts` | 充值订单接口 |
| `src/routes/admin/sync.ts` | 同步接口 |

### 修改文件

| 文件路径 | 修改内容 |
|---------|---------|
| `src/routes/admin-users.ts` | 删除（拆分到 admin/ 目录） |
| `src/routes/admin.ts` | 更新导入路径 |
| `src/routes/auth.ts` | 使用新类型和日志工具 |
| `src/services/RechargeService.ts` | 使用新类型和常量 |
| `src/routes/user.ts` | 使用新类型 |

---

## 验证计划

1. **类型检查**: 运行 `bun run tsc --noEmit` 确保无类型错误
2. **API 测试**: 验证所有 API 端点响应不变
3. **功能测试**:
   - 用户登录/注册
   - 管理后台用户管理
   - 充值订单流程
   - 积分调整

---

## 风险评估

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|-------|------|---------|
| 路由挂载错误 | 低 | 高 | 保持单元测试覆盖 |
| 类型定义不完整 | 中 | 中 | 逐步替换，保持兼容 |
| 遗漏日志字段 | 低 | 低 | 对照原 SQL 语句检查 |

---

## 后续优化建议

1. 添加 ESLint 和 Prettier 配置
2. 移除生产代码中的 `console.log`
3. 添加单元测试覆盖
4. 考虑引入 Zod 进行请求验证