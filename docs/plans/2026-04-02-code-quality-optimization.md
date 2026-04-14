# Code Quality Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce code duplication, enhance type safety, and improve file organization in sudowork-server.

**Architecture:** Extract common utilities (logger, constants), add TypeScript type definitions, and split large route files into focused modules.

**Tech Stack:** TypeScript, Bun, Hono, SQLite (bun:sqlite)

---

## Task 1: Create Constants Module

**Files:**
- Create: `src/utils/constants.ts`

**Step 1: Create constants file with status definitions**

```typescript
/**
 * Status constants for the application
 */

// ==================== Order Status ====================

export const ORDER_STATUS = {
  PENDING: 0,      // 待支付
  PAYING: 1,       // 支付中
  SUCCESS: 2,      // 支付成功
  FAILED: 3,       // 支付失败
  REFUNDED: 4,     // 已退款
  CANCELLED: 5,    // 已取消
} as const;

export type OrderStatus = typeof ORDER_STATUS[keyof typeof ORDER_STATUS];

export const ORDER_STATUS_TEXT: Record<OrderStatus, string> = {
  [ORDER_STATUS.PENDING]: '待支付',
  [ORDER_STATUS.PAYING]: '支付中',
  [ORDER_STATUS.SUCCESS]: '支付成功',
  [ORDER_STATUS.FAILED]: '支付失败',
  [ORDER_STATUS.REFUNDED]: '已退款',
  [ORDER_STATUS.CANCELLED]: '已取消',
};

// ==================== User Status ====================

export const USER_STATUS = {
  PENDING: 0,      // 待审批
  APPROVED: 1,     // 正常
  DISABLED: 2,     // 禁用
} as const;

export type UserStatus = typeof USER_STATUS[keyof typeof USER_STATUS];

export const USER_STATUS_TEXT: Record<UserStatus, string> = {
  [USER_STATUS.PENDING]: '待审批',
  [USER_STATUS.APPROVED]: '正常',
  [USER_STATUS.DISABLED]: '禁用',
};

// ==================== User Roles ====================

export const USER_ROLES = {
  USER: 'USER',
  ENTERPRISE_ADMIN: 'ENTERPRISE_ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;

export type UserRole = typeof USER_ROLES[keyof typeof USER_ROLES];

// ==================== Ledger Types ====================

export const LEDGER_TYPES = {
  BONUS: 'BONUS',
  RECHARGE: 'RECHARGE',
  CONSUME: 'CONSUME',
  ADMIN_RECHARGE: 'ADMIN_RECHARGE',
  ADMIN_DEDUCT_PENDING: 'ADMIN_DEDUCT_PENDING',
  ADMIN_RECHARGE_PENDING: 'ADMIN_RECHARGE_PENDING',
  REFUND: 'REFUND',
} as const;

export type LedgerType = typeof LEDGER_TYPES[keyof typeof LEDGER_TYPES];
```

**Step 2: Verify file compiles**

Run: `bun build src/utils/constants.ts --outfile /dev/null`
Expected: No errors

**Step 3: Commit**

```bash
git add src/utils/constants.ts
git commit -m "feat: add status constants module"
```

---

## Task 2: Create Operation Logger Utility

**Files:**
- Create: `src/utils/logger.ts`

**Step 1: Create logger utility**

```typescript
/**
 * Operation logging utility
 */

import { db } from '../db/index.js';

export interface LogOperationParams {
  userId: number;
  userPhone: string;
  action: string;
  resource: string;
  resourceId?: number;
  method?: string;
  path?: string;
  requestData?: unknown;
  responseData?: unknown;
  responseStatus?: number;
  durationMs?: number;
  errorMessage?: string;
}

/**
 * Log an operation to the operation_logs table
 */
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
      params.resourceId ?? null,
      params.method ?? null,
      params.path ?? null,
      params.requestData ? JSON.stringify(params.requestData) : null,
      params.responseData ? JSON.stringify(params.responseData) : null,
      params.responseStatus ?? null,
      params.durationMs ?? null,
      params.errorMessage ?? null,
    ]
  );
}

/**
 * Log a Sudorouter API call
 */
export function logSudorouterCall(params: {
  userId: number;
  userPhone: string;
  action: string;
  resourceId?: number;
  method: string;
  url: string;
  requestBody?: unknown;
  responseBody?: unknown;
  responseStatus: number;
  durationMs: number;
  errorMessage?: string;
}): void {
  logOperation({
    userId: params.userId,
    userPhone: params.userPhone,
    action: params.action,
    resource: 'sudorouter_api',
    resourceId: params.resourceId,
    method: params.method,
    path: params.url,
    requestData: params.requestBody,
    responseData: params.responseBody,
    responseStatus: params.responseStatus,
    durationMs: params.durationMs,
    errorMessage: params.errorMessage,
  });
}
```

**Step 2: Verify file compiles**

Run: `bun build src/utils/logger.ts --outfile /dev/null`
Expected: No errors

**Step 3: Commit**

```bash
git add src/utils/logger.ts
git commit -m "feat: add operation logger utility"
```

---

## Task 3: Create Type Definitions

**Files:**
- Create: `src/types/index.ts`

**Step 1: Create types file**

```typescript
/**
 * Type definitions for sudowork-server
 */

import type { OrderStatus, UserStatus, UserRole, LedgerType } from '../utils/constants.js';

// ==================== API Response ====================

export interface ApiResponse<T = unknown> {
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
  password_hash: string | null;
  must_change_password: boolean;
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
  callback_amount_cents: number | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
  expired_at: string;
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
  type: LedgerType;
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
  status: 0 | 1;
  used_by_user_id: number | null;
  created_at: string;
  used_at: string | null;
}

// ==================== Stats Types ====================

export interface DashboardStats {
  enterprises: number;
  users: number;
  approved: number;
  pending: number;
  points: {
    total: number;
    bonus: number;
    consumed: number;
  };
}
```

**Step 2: Verify file compiles**

Run: `bun build src/types/index.ts --outfile /dev/null`
Expected: No errors

**Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add type definitions"
```

---

## Task 4: Create Admin Routes Directory Structure

**Files:**
- Create: `src/routes/admin/stats.ts`
- Create: `src/routes/admin/index.ts`

**Step 1: Create stats route module**

```typescript
/**
 * Admin statistics routes
 */

import { Hono } from 'hono';
import { db } from '../../db/index.js';
import { authMiddleware, adminMiddleware } from '../../middleware/auth.js';
import type { DashboardStats } from '../../types/index.js';

const statsRoutes = new Hono();

// GET /api/v1/admin/stats - Dashboard statistics
statsRoutes.get('/stats', authMiddleware, adminMiddleware, async (c) => {
  const enterpriseCount = db
    .prepare('SELECT COUNT(*) as count FROM enterprises')
    .get() as { count: number };

  const userCount = db
    .prepare("SELECT COUNT(*) as count FROM users WHERE phone != 'sudo'")
    .get() as { count: number };

  const approvedCount = db
    .prepare("SELECT COUNT(*) as count FROM users WHERE status = 1 AND phone != 'sudo'")
    .get() as { count: number };

  const pendingCount = db
    .prepare("SELECT COUNT(*) as count FROM users WHERE status = 0 AND phone != 'sudo'")
    .get() as { count: number };

  const totalPoints = db
    .prepare("SELECT SUM(balance) as total FROM users WHERE phone != 'sudo'")
    .get() as { total: number | null };

  const totalBonus = db
    .prepare("SELECT SUM(amount) as total FROM ledger WHERE type = 'BONUS'")
    .get() as { total: number | null };

  const totalConsumed = db
    .prepare("SELECT SUM(amount) as total FROM ledger WHERE type = 'CONSUME'")
    .get() as { total: number | null };

  const stats: DashboardStats = {
    enterprises: enterpriseCount?.count || 0,
    users: userCount?.count || 0,
    approved: approvedCount?.count || 0,
    pending: pendingCount?.count || 0,
    points: {
      total: totalPoints?.total || 0,
      bonus: totalBonus?.total || 0,
      consumed: Math.abs(totalConsumed?.total || 0),
    },
  };

  return c.json({ success: true, data: stats });
});

export { statsRoutes };
```

**Step 2: Create admin index (temporary placeholder)**

```typescript
/**
 * Admin routes index
 * Mounts all admin sub-routes
 */

import { Hono } from 'hono';
import { statsRoutes } from './stats.js';

const adminRoutes = new Hono();

// Mount sub-routes
adminRoutes.route('/', statsRoutes);

// Placeholder: other routes will be added in subsequent tasks
// For now, we re-export from admin-users.ts

export { adminRoutes };
```

**Step 3: Verify files compile**

Run: `bun build src/routes/admin/index.ts --outfile /dev/null`
Expected: No errors

**Step 4: Commit**

```bash
git add src/routes/admin/
git commit -m "feat: create admin routes directory with stats module"
```

---

## Task 5: Create Users Route Module

**Files:**
- Create: `src/routes/admin/users.ts`
- Modify: `src/routes/admin/index.ts`

**Step 1: Create users route module (user CRUD)**

Create `src/routes/admin/users.ts` with user management routes extracted from `admin-users.ts`:
- GET /users - User list
- POST /users - Create user
- PUT /users/:id - Update user
- DELETE /users/:id - Delete user
- POST /users/:id/role - Set role
- POST /users/:id/manage - Enable/Disable
- GET /users/:id/ledger - User ledger

Use the new `logOperation` from `utils/logger.ts` and types from `types/index.ts`.

**Step 2: Update admin index to mount users routes**

```typescript
import { usersRoutes } from './users.js';
// ...add to adminRoutes.route('/', usersRoutes);
```

**Step 3: Verify compilation**

Run: `bun build src/routes/admin/index.ts --outfile /dev/null`

**Step 4: Commit**

```bash
git add src/routes/admin/users.ts src/routes/admin/index.ts
git commit -m "feat: extract users routes to admin/users.ts"
```

---

## Task 6: Create Points Route Module

**Files:**
- Create: `src/routes/admin/points.ts`
- Modify: `src/routes/admin/index.ts`

**Step 1: Create points route module**

Create `src/routes/admin/points.ts` with points-related routes:
- POST /users/:id/points - Adjust points
- POST /users/:id/recharge - Admin recharge
- POST /users/:id/sync-quota - Sync quota

**Step 2: Update admin index**

**Step 3: Verify compilation**

**Step 4: Commit**

```bash
git add src/routes/admin/points.ts src/routes/admin/index.ts
git commit -m "feat: extract points routes to admin/points.ts"
```

---

## Task 7: Create Recharge Route Module

**Files:**
- Create: `src/routes/admin/recharge.ts`
- Modify: `src/routes/admin/index.ts`

**Step 1: Create recharge route module**

Create `src/routes/admin/recharge.ts` with recharge order routes:
- GET /recharge/orders - Order list
- GET /recharge/orders/:orderNo - Order detail
- GET /recharge/stats - Statistics
- POST /recharge/orders/:orderNo/refund - Refund
- GET /recharge/refund-calc/:orderNo - Calculate refund
- POST /recharge/simulate-payment/:orderNo - Simulate (test)
- GET /recharge-records - All recharge records

Use `ORDER_STATUS` and `ORDER_STATUS_TEXT` from constants.

**Step 2: Update admin index**

**Step 3: Verify compilation**

**Step 4: Commit**

```bash
git add src/routes/admin/recharge.ts src/routes/admin/index.ts
git commit -m "feat: extract recharge routes to admin/recharge.ts"
```

---

## Task 8: Create Sync Route Module

**Files:**
- Create: `src/routes/admin/sync.ts`
- Modify: `src/routes/admin/index.ts`

**Step 1: Create sync route module**

Create `src/routes/admin/sync.ts` with sync-related routes:
- POST /recharge/orders/:id/retry - Retry failed order
- POST /recharge/sync - Sync all pending
- POST /recharge/orders/:orderNo/sync - Sync single order

**Step 2: Update admin index to mount all routes**

**Step 3: Verify compilation**

**Step 4: Commit**

```bash
git add src/routes/admin/sync.ts src/routes/admin/index.ts
git commit -m "feat: extract sync routes to admin/sync.ts"
```

---

## Task 9: Update Main Admin Router

**Files:**
- Modify: `src/routes/admin.ts`

**Step 1: Update imports to use new admin routes**

```typescript
// Change from:
import { adminUserRoutes } from './admin-users.js';

// To:
import { adminRoutes as newAdminRoutes } from './admin/index.js';
```

**Step 2: Update route mounting**

Ensure `/api/v1/admin/*` paths remain unchanged.

**Step 3: Remove old admin-users.ts import**

**Step 4: Verify compilation**

Run: `bun build src/index.ts --outfile /dev/null`

**Step 5: Commit**

```bash
git add src/routes/admin.ts
git commit -m "refactor: switch to new admin routes structure"
```

---

## Task 10: Update RechargeService with Types

**Files:**
- Modify: `src/services/RechargeService.ts`

**Step 1: Add type imports**

```typescript
import type { RechargeOrder, User } from '../types/index.js';
import { ORDER_STATUS, ORDER_STATUS_TEXT } from '../utils/constants.js';
```

**Step 2: Replace magic numbers with constants**

Replace `status === 0` with `status === ORDER_STATUS.PENDING`, etc.
Replace status text arrays with `ORDER_STATUS_TEXT[status]`.

**Step 3: Replace `as any` with typed interfaces**

Change query results from `as any` to `as RechargeOrder | undefined` or `as User | undefined`.

**Step 4: Verify compilation**

**Step 5: Commit**

```bash
git add src/services/RechargeService.ts
git commit -m "refactor: use types and constants in RechargeService"
```

---

## Task 11: Update Auth Routes with Types

**Files:**
- Modify: `src/routes/auth.ts`

**Step 1: Add type imports**

```typescript
import type { User } from '../types/index.js';
import { logSudorouterCall } from '../utils/logger.js';
```

**Step 2: Replace `as any` with `User` type**

**Step 3: Use `logSudorouterCall` for API logging**

Replace repetitive INSERT INTO operation_logs with `logSudorouterCall()`.

**Step 4: Verify compilation**

**Step 5: Commit**

```bash
git add src/routes/auth.ts
git commit -m "refactor: use types and logger in auth routes"
```

---

## Task 12: Clean Up Old Files

**Files:**
- Delete: `src/routes/admin-users.ts`

**Step 1: Verify no remaining imports**

Run: `grep -r "admin-users" src/`
Expected: No results

**Step 2: Delete old file**

```bash
git rm src/routes/admin-users.ts
```

**Step 3: Commit**

```bash
git commit -m "chore: remove old admin-users.ts (migrated to admin/)"
```

---

## Task 13: Final Verification

**Files:**
- None (verification only)

**Step 1: Run TypeScript check**

Run: `bunx tsc --noEmit`
Expected: No errors

**Step 2: Start server and test**

Run: `bun run src/index.ts`
Test: curl http://localhost:3000/api/v1/admin/stats (with auth)

**Step 3: Create summary commit if needed**

```bash
git status
# If any uncommitted changes:
git add -A
git commit -m "chore: final cleanup for code quality optimization"
```

---

## Summary

| Task | Description | Files Changed |
|------|-------------|---------------|
| 1 | Create constants module | +1 |
| 2 | Create logger utility | +1 |
| 3 | Create type definitions | +1 |
| 4 | Create admin/stats.ts | +2 |
| 5 | Create admin/users.ts | +2 |
| 6 | Create admin/points.ts | +2 |
| 7 | Create admin/recharge.ts | +2 |
| 8 | Create admin/sync.ts | +2 |
| 9 | Update main admin router | 1 |
| 10 | Update RechargeService | 1 |
| 11 | Update auth routes | 1 |
| 12 | Remove old files | -1 |
| 13 | Final verification | 0 |

**Total: ~14 new files, ~4 modified, 1 deleted**