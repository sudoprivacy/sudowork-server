# Credit Application Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable credit-application workflow that appears only when `recharge_mode=approve`, lets users freely request integer points, lets admins approve/reject from a dedicated admin menu, and credits Sudorouter quota after approval without changing existing Fuiou recharge or manual admin recharge behavior.

**Architecture:** Keep all existing recharge HTTP endpoints, Fuiou payment code, and the existing manual admin recharge endpoint behavior intact. Add a new `credit_applications` domain with separate user/admin routes, a system-config switch that defaults to `pay` when missing or invalid, and a credit-application-only grant service used by approval. Approval is explicitly open to both `SUPER_ADMIN` and `ENTERPRISE_ADMIN`; an `ENTERPRISE_ADMIN` may only see and approve/reject applications from their own enterprise, while `SUPER_ADMIN` sees all enterprises. Add `source/source_id` to `admin_recharge_records` so recharge records can distinguish manual admin grants from application-approved grants and link back to the related application record.

**Tech Stack:** sudowork-server uses Bun, Hono, TypeScript, SQLite via `better-sqlite3`; admin UI uses React + Ant Design; desktop client uses Electron, React 19, TypeScript strict mode, Arco Design, UnoCSS, and i18n JSON files.

---

## Non-Negotiable Compatibility Rules

- `recharge_mode` missing, empty, or invalid means `pay`.
- Existing Fuiou payment endpoints keep their current behavior:
  - `GET /api/v1/recharge/packages`
  - `POST /api/v1/recharge/create`
  - `POST /api/v1/recharge/pay`
  - `POST /api/v1/recharge/callback`
  - `GET /api/v1/recharge/query/:orderNo`
  - `GET /api/v1/recharge/list`
  - `POST /api/v1/recharge/cancel/:orderNo`
- Existing manual admin recharge endpoint keeps working:
  - `POST /api/v1/admin/users/:id/recharge`
  - Do not refactor this endpoint in the first implementation pass; preserve its current validation, Sudorouter call order, response shape, and ledger behavior.
- New credit-application endpoints reject requests unless normalized `recharge_mode` is `approve`.
- The dedicated admin menu "积分申请" appears only when normalized `recharge_mode` is `approve`.
- The "积分申请" menu and approval actions are open to both `SUPER_ADMIN` and `ENTERPRISE_ADMIN`; an `ENTERPRISE_ADMIN` can only view/approve/reject applications whose `enterprise_id` matches their own, while `SUPER_ADMIN` can operate on all enterprises.
- Recharge records must distinguish:
  - `ADMIN_MANUAL`: 后台手工充值
  - `CREDIT_APPLICATION`: 积分申请审批发放
- A `CREDIT_APPLICATION` recharge record must return enough fields to find and display the related application record.
- `ENTERPRISE_ADMIN` approval is a new product capability for this workflow only. It does not imply that the existing manual admin recharge endpoint becomes available to `ENTERPRISE_ADMIN`.

## File Structure

### `/Users/yobach/VSCodeProject/sudowork-server`

- Modify `src/db/schema.ts`
  - Create `credit_applications`.
  - Add `source/source_id` columns to `admin_recharge_records` for fresh installs.
  - Add a unique idempotency index for `CREDIT_APPLICATION` recharge records by `source/source_id`.
- Modify `src/db/migrations.ts`
  - Add idempotent migration for `credit_applications`.
  - Add idempotent migration for `admin_recharge_records.source/source_id`.
  - Add idempotent unique index migration for `admin_recharge_records(source, source_id)` when `source='CREDIT_APPLICATION'`.
  - Seed `system_config.recharge_mode` only when missing, with value `pay`.
  - Seed `system_config.credit_application` only when missing.
- Modify `src/types/index.ts`
  - Add recharge mode, credit-application status, and record interfaces.
- Modify `src/services/SystemConfigService.ts`
  - Add `getRechargeMode()`, `setRechargeMode()`, `getCreditApplicationConfig()`, and `setCreditApplicationConfig()`.
  - Normalize missing/empty/invalid modes to `pay`.
- Modify `src/routes/system-config.ts`
  - Expose `recharge_mode` and sanitized `credit_application` in public system config.
  - Include both fields in admin system-config get/update.
- Modify `src/utils/constants.ts`
  - Add `CREDIT_APPLICATION_APPROVED` to `LEDGER_TYPES` so `LedgerType` remains complete.
- Create `src/services/CreditApplicationGrantService.ts`
  - Dedicated internal grant path for credit-application approval only.
  - Calls Sudorouter, updates local user quota/balance, writes `admin_recharge_records`, writes `ledger`, and logs operations.
- Create `src/services/CreditApplicationService.ts`
  - Create/list/get applications.
  - Approve/reject/retry sync.
  - Enforce `recharge_mode=approve`.
  - Enforce admin scope: `SUPER_ADMIN` sees all enterprises; `ENTERPRISE_ADMIN` only sees/approves/rejects applications of their own enterprise (scope comes from the JWT `enterprise_id`).
  - Before approval, verify the target user still exists, is active, still belongs to the application enterprise, and still has `sudorouter_user_id`.
  - Use `creditApplicationGrantService.grantApplicationPoints()` for successful approval.
  - Use a `PROCESSING` status plus a unique `source/source_id` recharge-record guard to prevent duplicate approval grants.
- Create `src/routes/credit-applications.ts`
  - User-facing application routes mounted at `/api/v1/credit-applications`.
- Create `src/routes/admin/credit-applications.ts`
  - Admin-facing application routes mounted under `/api/v1/admin/credit-applications`.
  - Guarded by `authMiddleware` + `adminMiddleware` (both `SUPER_ADMIN` and `ENTERPRISE_ADMIN` allowed).
  - For `ENTERPRISE_ADMIN`, derive `enterpriseScope` from the JWT `enterprise_id` and pass it to `listAdminApplications` / `getAdminApplication`, and pass `adminRole` / `adminEnterpriseId` to approve/reject so the service can enforce enterprise scoping.
- Modify `src/routes/admin/index.ts`
  - Mount admin credit-application routes.
- Modify `src/index.ts`
  - Mount user credit-application routes.
- Modify `src/routes/admin/recharge.ts`
  - Enrich `/recharge-records` records with `source`, `source_text`, `application_id`, `application_no`, `requested_points`, `approved_points`, `application_reason`, and `admin_comment`.
- Create `tests/unit/recharge-mode-config.test.ts`
  - Covers defaulting and config normalization.
- Create `tests/unit/credit-applications-api.test.ts`
  - Covers user creation/list validation and mode gating.
- Create `tests/unit/credit-application-approval.test.ts`
  - Covers enterprise scope, approval, rejection, `PROCESSING`/`SYNC_UNKNOWN` guards, retry, and recharge-record linkage.
- Modify `admin/src/api/index.ts`
  - Add credit-application API client methods.
  - Reuse existing `getSystemConfig()` and `getAdminSystemConfig()` methods; do not add a duplicate `getSystemConfig` key.
- Modify `admin/src/App.tsx`
  - Move conditional "积分申请" menu calculation into `MainLayout`, because the existing `menuConfig` is module-level.
  - Add "积分申请" route.
- Create `admin/src/pages/CreditApplications.tsx`
  - Dedicated admin list and approval page.

### `/Users/yobach/VSCodeProject/sudowork`

- Modify `src/common/systemConfig.ts`
  - Add `recharge_mode` and `credit_application` to public config type.
  - Normalize missing/invalid `recharge_mode` to `pay`.
  - Keep existing `fetchSystemConfig()` and `getSystemConfigCache()` APIs; do not introduce a nonexistent `getSystemConfig()`.
- Modify `src/renderer/layouts/components/SettingsSider.tsx`
  - Show "充值中心" when `recharge_mode=pay`.
  - Show "积分申请" when `recharge_mode=approve`.
  - Hide the tab when `recharge_mode=disabled`.
- Modify `src/renderer/pages/settings/recharge/index.tsx`
  - Preserve current Fuiou payment UI for `pay`.
  - Render credit-application UI for `approve`.
  - Render closed state for `disabled`.
- Create `src/renderer/pages/settings/recharge/components/CreditApplicationPanel.tsx`
  - User free-form integer point application form and personal application list.
- Modify `src/renderer/i18n/locales/zh-CN/settings.json`
  - Add credit-application text.
- Modify `src/renderer/i18n/locales/en-US/settings.json`
  - Add credit-application text.
- Regenerate `src/renderer/i18n/i18n-keys.d.ts` with `bun run i18n:types`.
- Create `tests/unit/creditApplicationConfig.test.ts`
  - Covers config normalization.
- Create `tests/unit/creditApplicationPanel.dom.test.tsx`
  - Covers user-side UI behavior.

## Data Contracts

### Public Config

```ts
type RechargeMode = 'pay' | 'approve' | 'disabled';

interface ICreditApplicationPublicConfig {
  min_points: number;
  max_points: number;
  allow_duplicate_pending: boolean;
}

interface IPublicSystemConfig {
  recharge_mode: RechargeMode;
  credit_application: ICreditApplicationPublicConfig;
}
```

Default behavior:

```ts
function normalizeRechargeMode(value: unknown): RechargeMode {
  return value === 'approve' || value === 'disabled' || value === 'pay'
    ? value
    : 'pay';
}
```

Default credit-application config:

```ts
const DEFAULT_CREDIT_APPLICATION_CONFIG = {
  min_points: 100,
  max_points: 1000000,
  allow_duplicate_pending: false,
};
```

### Credit Application Status

```ts
type CreditApplicationStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'APPROVED'
  | 'REJECTED'
  | 'SYNC_FAILED'
  | 'SYNC_UNKNOWN';
```

### User Create Request

```ts
interface ICreateCreditApplicationInput {
  requested_points: number;
  reason: string;
}
```

Validation:

- `requested_points` must be a positive integer.
- `requested_points >= min_points`.
- `requested_points <= max_points`.
- `reason.trim().length` must be between 1 and 500.
- When `allow_duplicate_pending=false`, reject if the current user already has an active `PENDING`, `PROCESSING`, or `SYNC_UNKNOWN` application.

### Admin Approve Request

```ts
interface IApproveCreditApplicationInput {
  approved_points?: number;
  admin_comment?: string;
}
```

Validation:

- Only `SUPER_ADMIN`, or an `ENTERPRISE_ADMIN` whose `enterprise_id` matches the application's `enterprise_id`, can approve.
- Only `PENDING` or `SYNC_FAILED` can be approved.
- `approved_points` defaults to `requested_points`.
- `approved_points` must be a positive integer.
- `approved_points <= max_points`.
- The target user must exist, be active, still belong to the application's `enterprise_id`, and have `sudorouter_user_id`.
- Approval first moves the application to `PROCESSING` with a compare-and-set update; duplicate approval attempts must fail or finalize an already-recorded grant without calling Sudorouter again.
- `SYNC_UNKNOWN` means Sudorouter may have succeeded but local completion could not be verified; it is intentionally excluded from automatic retry and requires manual reconciliation.

### Admin Reject Request

```ts
interface IRejectCreditApplicationInput {
  admin_comment: string;
}
```

Validation:

- Only `SUPER_ADMIN`, or an `ENTERPRISE_ADMIN` whose `enterprise_id` matches the application's `enterprise_id`, can reject.
- Only `PENDING` can be rejected.
- `admin_comment.trim().length` must be between 1 and 500.

## Task 1: Server Config And Database

**Files:**
- Modify: `/Users/yobach/VSCodeProject/sudowork-server/src/db/schema.ts`
- Modify: `/Users/yobach/VSCodeProject/sudowork-server/src/db/migrations.ts`
- Modify: `/Users/yobach/VSCodeProject/sudowork-server/src/types/index.ts`
- Modify: `/Users/yobach/VSCodeProject/sudowork-server/src/utils/constants.ts`
- Modify: `/Users/yobach/VSCodeProject/sudowork-server/src/services/SystemConfigService.ts`
- Modify: `/Users/yobach/VSCodeProject/sudowork-server/src/routes/system-config.ts`
- Test: `/Users/yobach/VSCodeProject/sudowork-server/tests/unit/recharge-mode-config.test.ts`

- [ ] **Step 1: Write config normalization tests**

Create `/Users/yobach/VSCodeProject/sudowork-server/tests/unit/recharge-mode-config.test.ts`:

```ts
import { describe, expect, it } from "bun:test";

type RechargeMode = "pay" | "approve" | "disabled";

function normalizeRechargeModeForTest(value: unknown): RechargeMode {
  return value === "approve" || value === "disabled" || value === "pay"
    ? value
    : "pay";
}

describe("recharge mode config", () => {
  it("defaults missing mode to pay", () => {
    expect(normalizeRechargeModeForTest(undefined)).toBe("pay");
    expect(normalizeRechargeModeForTest(null)).toBe("pay");
    expect(normalizeRechargeModeForTest("")).toBe("pay");
  });

  it("accepts known modes", () => {
    expect(normalizeRechargeModeForTest("pay")).toBe("pay");
    expect(normalizeRechargeModeForTest("approve")).toBe("approve");
    expect(normalizeRechargeModeForTest("disabled")).toBe("disabled");
  });

  it("treats invalid modes as pay", () => {
    expect(normalizeRechargeModeForTest("approval")).toBe("pay");
    expect(normalizeRechargeModeForTest("fuiou")).toBe("pay");
    expect(normalizeRechargeModeForTest(1)).toBe("pay");
  });
});
```

- [ ] **Step 2: Run the config test and verify it passes as a contract test**

Run:

```bash
bun test tests/unit/recharge-mode-config.test.ts
```

Expected: PASS. This test documents the required defaulting behavior before wiring it into `SystemConfigService`.

- [ ] **Step 3: Add schema for fresh installs**

In `/Users/yobach/VSCodeProject/sudowork-server/src/db/schema.ts`, after `admin_recharge_records`, add `source` fields to the existing table definition:

```sql
source TEXT DEFAULT 'ADMIN_MANUAL',
source_id INTEGER,
```

Then create the new table:

```ts
  db.run(`
    CREATE TABLE IF NOT EXISTS credit_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_no TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      enterprise_id INTEGER,
      requested_points INTEGER NOT NULL,
      approved_points INTEGER,
      quota_amount INTEGER,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      admin_id INTEGER,
      admin_comment TEXT,
      sudorouter_user_id INTEGER,
      sudorouter_success BOOLEAN DEFAULT FALSE,
      sudorouter_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (enterprise_id) REFERENCES enterprises(id),
      FOREIGN KEY (admin_id) REFERENCES users(id)
    );
  `);

  db.run(
    `CREATE INDEX IF NOT EXISTS idx_credit_applications_user_id ON credit_applications(user_id)`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_credit_applications_status ON credit_applications(status)`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_credit_applications_created_at ON credit_applications(created_at)`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_credit_applications_application_no ON credit_applications(application_no)`,
  );
  db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_recharge_records_credit_application_once
     ON admin_recharge_records(source, source_id)
     WHERE source = 'CREDIT_APPLICATION' AND source_id IS NOT NULL`,
  );
```

- [ ] **Step 4: Add idempotent migrations**

In `/Users/yobach/VSCodeProject/sudowork-server/src/db/migrations.ts`, add to `runMigrations()` after existing recharge-related migration calls:

```ts
  addColumnIfNotExists("admin_recharge_records", "source", "TEXT DEFAULT 'ADMIN_MANUAL'");
  addColumnIfNotExists("admin_recharge_records", "source_id", "INTEGER");
  createCreditApplicationsTable();
  createCreditApplicationRechargeRecordIndex();
  insertSystemConfigIfMissing("recharge_mode", "pay");
  insertSystemConfigIfMissing(
    "credit_application",
    '{"min_points":100,"max_points":1000000,"allow_duplicate_pending":false}',
  );
```

Add helper in the same file:

```ts
function createCreditApplicationsTable(): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS credit_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_no TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      enterprise_id INTEGER,
      requested_points INTEGER NOT NULL,
      approved_points INTEGER,
      quota_amount INTEGER,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      admin_id INTEGER,
      admin_comment TEXT,
      sudorouter_user_id INTEGER,
      sudorouter_success BOOLEAN DEFAULT FALSE,
      sudorouter_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (enterprise_id) REFERENCES enterprises(id),
      FOREIGN KEY (admin_id) REFERENCES users(id)
    );
  `);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_credit_applications_user_id ON credit_applications(user_id)`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_credit_applications_status ON credit_applications(status)`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_credit_applications_created_at ON credit_applications(created_at)`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_credit_applications_application_no ON credit_applications(application_no)`,
  );
}

function createCreditApplicationRechargeRecordIndex(): void {
  db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_recharge_records_credit_application_once
     ON admin_recharge_records(source, source_id)
     WHERE source = 'CREDIT_APPLICATION' AND source_id IS NOT NULL`,
  );
}
```

- [ ] **Step 5: Add shared types**

In `/Users/yobach/VSCodeProject/sudowork-server/src/types/index.ts`, add:

```ts
export type RechargeMode = "pay" | "approve" | "disabled";

export type CreditApplicationStatus =
  | "PENDING"
  | "PROCESSING"
  | "APPROVED"
  | "REJECTED"
  | "SYNC_FAILED"
  | "SYNC_UNKNOWN";

export interface CreditApplication {
  id: number;
  application_no: string;
  user_id: number;
  enterprise_id: number | null;
  requested_points: number;
  approved_points: number | null;
  quota_amount: number | null;
  reason: string | null;
  status: CreditApplicationStatus;
  admin_id: number | null;
  admin_comment: string | null;
  sudorouter_user_id: number | null;
  sudorouter_success: boolean;
  sudorouter_error: string | null;
  created_at: string;
  reviewed_at: string | null;
  updated_at: string;
}

export interface CreditApplicationWithUser extends CreditApplication {
  user_phone: string | null;
  user_nickname: string | null;
  enterprise_name: string | null;
  admin_phone: string | null;
  admin_nickname: string | null;
}
```

- [ ] **Step 6: Register the credit-application ledger type**

In `/Users/yobach/VSCodeProject/sudowork-server/src/utils/constants.ts`, add `CREDIT_APPLICATION_APPROVED` to `LEDGER_TYPES`:

```ts
export const LEDGER_TYPES = {
  BONUS: 'BONUS',
  RECHARGE: 'RECHARGE',
  CONSUME: 'CONSUME',
  ADMIN_RECHARGE: 'ADMIN_RECHARGE',
  CREDIT_APPLICATION_APPROVED: 'CREDIT_APPLICATION_APPROVED',
  ADMIN_DEDUCT_PENDING: 'ADMIN_DEDUCT_PENDING',
  ADMIN_RECHARGE_PENDING: 'ADMIN_RECHARGE_PENDING',
  REFUND: 'REFUND',
} as const;
```

This keeps `LedgerType` complete for any code that displays or narrows ledger entries by `LEDGER_TYPES`.

- [ ] **Step 7: Add config service methods**

In `/Users/yobach/VSCodeProject/sudowork-server/src/services/SystemConfigService.ts`, add constants:

```ts
const RECHARGE_MODE_KEY = "recharge_mode";
const CREDIT_APPLICATION_KEY = "credit_application";
```

Add interfaces:

```ts
export type RechargeMode = "pay" | "approve" | "disabled";

export interface CreditApplicationConfig {
  min_points: number;
  max_points: number;
  allow_duplicate_pending: boolean;
}

const DEFAULT_CREDIT_APPLICATION_CONFIG: CreditApplicationConfig = {
  min_points: 100,
  max_points: 1000000,
  allow_duplicate_pending: false,
};
```

Add methods:

```ts
  getRechargeMode(): RechargeMode {
    const row = db
      .prepare("SELECT value FROM system_config WHERE key = ?")
      .get(RECHARGE_MODE_KEY) as { value: string } | undefined;
    return this.normalizeRechargeMode(row?.value);
  }

  setRechargeMode(value: unknown): void {
    const mode = this.normalizeRechargeMode(value);
    const result = db.run(
      "UPDATE system_config SET value = ?, updated_at = datetime('now') WHERE key = ?",
      [mode, RECHARGE_MODE_KEY],
    );
    if (result.changes === 0) {
      this.insertConfigValue(RECHARGE_MODE_KEY, mode);
    }
  }

  normalizeRechargeMode(value: unknown): RechargeMode {
    return value === "approve" || value === "disabled" || value === "pay"
      ? value
      : "pay";
  }

  getCreditApplicationConfig(): CreditApplicationConfig {
    const raw = this.getJsonConfig<Partial<CreditApplicationConfig>>(
      CREDIT_APPLICATION_KEY,
      DEFAULT_CREDIT_APPLICATION_CONFIG,
    );
    const minPoints = Number(raw.min_points);
    const maxPoints = Number(raw.max_points);
    return {
      min_points: Number.isInteger(minPoints) && minPoints > 0 ? minPoints : 100,
      max_points:
        Number.isInteger(maxPoints) && maxPoints >= minPoints
          ? maxPoints
          : 1000000,
      allow_duplicate_pending: raw.allow_duplicate_pending === true,
    };
  }

  setCreditApplicationConfig(value: Partial<CreditApplicationConfig>): void {
    const minPoints = Number(value.min_points);
    const maxPoints = Number(value.max_points);
    const next: CreditApplicationConfig = {
      min_points: Number.isInteger(minPoints) && minPoints > 0 ? minPoints : 100,
      max_points:
        Number.isInteger(maxPoints) && maxPoints >= minPoints
          ? maxPoints
          : 1000000,
      allow_duplicate_pending: value.allow_duplicate_pending === true,
    };
    this.setJsonConfig(CREDIT_APPLICATION_KEY, next);
  }
```

- [ ] **Step 8: Expose config in public and admin system-config routes**

In `/Users/yobach/VSCodeProject/sudowork-server/src/routes/system-config.ts`, add to `PUBLIC_CONFIG`:

```ts
  recharge_mode: () => systemConfigService.getRechargeMode(),
  credit_application: () => systemConfigService.getCreditApplicationConfig(),
```

In admin GET response, add:

```ts
        recharge_mode: systemConfigService.getRechargeMode(),
        credit_application: systemConfigService.getCreditApplicationConfig(),
```

In admin PUT route, after login-method handling, add:

```ts
    if (body.recharge_mode !== undefined) {
      const before = systemConfigService.getRechargeMode();
      systemConfigService.setRechargeMode(body.recharge_mode);
      changes.recharge_mode = {
        before,
        after: systemConfigService.getRechargeMode(),
      };
    }

    if (body.credit_application !== undefined) {
      const before = systemConfigService.getCreditApplicationConfig();
      systemConfigService.setCreditApplicationConfig(body.credit_application);
      changes.credit_application = {
        before,
        after: systemConfigService.getCreditApplicationConfig(),
      };
    }
```

- [ ] **Step 9: Run server checks**

Run:

```bash
bun test tests/unit/recharge-mode-config.test.ts
bunx tsc --noEmit
```

Expected: test passes and TypeScript reports no errors.

- [ ] **Step 10: Commit server config and schema work**

```bash
git add src/db/schema.ts src/db/migrations.ts src/types/index.ts src/utils/constants.ts src/services/SystemConfigService.ts src/routes/system-config.ts tests/unit/recharge-mode-config.test.ts
git commit -m "feat(recharge): add configurable recharge mode"
```

## Task 2: Credit-Application-Only Point Grant Service

**Files:**
- Create: `/Users/yobach/VSCodeProject/sudowork-server/src/services/CreditApplicationGrantService.ts`
- Test: `/Users/yobach/VSCodeProject/sudowork-server/tests/unit/credit-application-grant.test.ts`

- [ ] **Step 1: Create unit test for grant contract**

Create `/Users/yobach/VSCodeProject/sudowork-server/tests/unit/credit-application-grant.test.ts`:

```ts
import { describe, expect, it } from "bun:test";

function validateApplicationGrant(points: number, sourceId: number | null) {
  if (!Number.isInteger(points) || points <= 0) {
    return "points must be a positive integer";
  }
  if (!sourceId || sourceId <= 0) {
    return "credit application source id is required";
  }
  return null;
}

function buildApplicationGrant(points: number, sourceId: number) {
  return {
    quota: points * 500,
    ledgerType: "CREDIT_APPLICATION_APPROVED",
    source: "CREDIT_APPLICATION",
    sourceId,
  };
}

describe("credit application grant contract", () => {
  it("converts approved points to quota and application source metadata", () => {
    expect(buildApplicationGrant(1000, 9)).toEqual({
      quota: 500000,
      ledgerType: "CREDIT_APPLICATION_APPROVED",
      source: "CREDIT_APPLICATION",
      sourceId: 9,
    });
  });

  it("rejects invalid application grants", () => {
    expect(validateApplicationGrant(0, 1)).toBe("points must be a positive integer");
    expect(validateApplicationGrant(-1, 1)).toBe("points must be a positive integer");
    expect(validateApplicationGrant(1.5, 1)).toBe("points must be a positive integer");
    expect(validateApplicationGrant(100, null)).toBe("credit application source id is required");
  });
});
```

- [ ] **Step 2: Run the grant contract test**

Run:

```bash
bun test tests/unit/credit-application-grant.test.ts
```

Expected: PASS.

- [ ] **Step 3: Create `CreditApplicationGrantService`**

Create `/Users/yobach/VSCodeProject/sudowork-server/src/services/CreditApplicationGrantService.ts`:

```ts
import { db } from "../db/index.js";
import { sudorouterService } from "./SudorouterService.js";
import { logOperation } from "../utils/logger.js";
import type { User } from "../types/index.js";

export interface ICreditApplicationGrantInput {
  userId: number;
  adminId: number;
  points: number;
  applicationId: number;
  applicationNo: string;
}

export interface ICreditApplicationGrantResult {
  success: boolean;
  sudorouterSucceeded?: boolean;
  points?: number;
  quota?: number;
  newBalance?: number;
  newQuota?: number;
  error?: string;
}

class CreditApplicationGrantService {
  async grantApplicationPoints(
    input: ICreditApplicationGrantInput,
  ): Promise<ICreditApplicationGrantResult> {
    if (!Number.isInteger(input.points) || input.points <= 0) {
      return { success: false, error: "审批积分必须为正整数" };
    }
    if (!input.applicationId || input.applicationId <= 0) {
      return { success: false, error: "申请记录 ID 不能为空" };
    }

    const user = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(input.userId) as User | undefined;
    if (!user) {
      return { success: false, error: "用户不存在" };
    }
    if (!user.sudorouter_user_id) {
      return { success: false, error: "用户未绑定 sudorouter 账号" };
    }

    const admin = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(input.adminId) as User | undefined;
    const quotaDelta = sudorouterService.pointsToQuota(input.points);
    const reason = `积分申请审批发放: ${input.applicationNo}`;

    const quotaResult = await sudorouterService.updateUserQuotaWithLog(
      user.sudorouter_user_id,
      quotaDelta,
      reason,
    );
    if (!quotaResult.success) {
      logOperation({
        userId: input.adminId,
        userPhone: admin?.phone || "",
        action: "SUDOROUTER_QUOTA_UPDATE_FAILED",
        resource: "sudorouter_quota",
        resourceId: user.sudorouter_user_id,
        method: quotaResult.request.method,
        path: quotaResult.request.url,
        requestData: quotaResult.request.body,
        responseData: quotaResult.response.data,
        responseStatus: quotaResult.response.status,
        durationMs: quotaResult.duration_ms,
        errorMessage: quotaResult.error,
      });
      return {
        success: false,
        sudorouterSucceeded: false,
        error: `sudorouter 额度更新失败: ${quotaResult.error}`,
      };
    }

    db.run("BEGIN EXCLUSIVE TRANSACTION");
    try {
      const lockedUser = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(input.userId) as User | undefined;
      if (!lockedUser) {
        db.run("ROLLBACK");
        return { success: false, error: "用户不存在" };
      }

      const newQuota = (lockedUser.quota || 0) + quotaDelta;
      const newBalance = (lockedUser.balance || 0) + input.points;

      db.run("UPDATE users SET balance = ?, quota = ? WHERE id = ?", [
        newBalance,
        newQuota,
        input.userId,
      ]);

      db.run(
        `INSERT INTO admin_recharge_records (
          user_id, admin_id, points, quota, reason,
          payment_reference, sudorouter_user_id, sudorouter_success,
          source, source_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.userId,
          input.adminId,
          input.points,
          quotaDelta,
          reason,
          null,
          lockedUser.sudorouter_user_id,
          true,
          "CREDIT_APPLICATION",
          input.applicationId,
        ],
      );

      db.run(
        "INSERT INTO ledger (user_id, amount, type, memo) VALUES (?, ?, ?, ?)",
        [input.userId, input.points, "CREDIT_APPLICATION_APPROVED", reason],
      );

      logOperation({
        userId: input.adminId,
        userPhone: admin?.phone || "",
        action: "CREDIT_APPLICATION_GRANT",
        resource: "user",
        resourceId: input.userId,
        method: "POST",
        path: `/api/v1/admin/credit-applications/${input.applicationId}/approve`,
        requestData: input,
        responseData: { points: input.points, quota: quotaDelta, newBalance, newQuota },
      });

      db.run("COMMIT");
      return {
        success: true,
        points: input.points,
        quota: quotaDelta,
        newBalance,
        newQuota,
      };
    } catch (error) {
      db.run("ROLLBACK");
      console.error("[CreditApplicationGrantService] Grant failed:", error);
      return {
        success: false,
        sudorouterSucceeded: true,
        error: "Sudorouter 可能已发放成功，但本地记录写入失败，请人工核对",
      };
    }
  }
}

export const creditApplicationGrantService = new CreditApplicationGrantService();
```

- [ ] **Step 4: Confirm manual admin recharge is not modified**

Run:

```bash
git diff -- src/routes/admin/points.ts
```

Expected: no diff. First implementation pass must not change `/api/v1/admin/users/:id/recharge`; existing manual recharge records are classified as `ADMIN_MANUAL` by the new column default/migration.

- [ ] **Step 5: Run server checks**

Run:

```bash
bun test tests/unit/credit-application-grant.test.ts
bunx tsc --noEmit
```

Expected: test passes and TypeScript reports no errors.

- [ ] **Step 6: Commit credit-application grant work**

```bash
git add src/services/CreditApplicationGrantService.ts tests/unit/credit-application-grant.test.ts
git commit -m "feat(recharge): add credit application grant service"
```

## Task 3: Credit Application Service And User Routes

**Files:**
- Create: `/Users/yobach/VSCodeProject/sudowork-server/src/services/CreditApplicationService.ts`
- Create: `/Users/yobach/VSCodeProject/sudowork-server/src/routes/credit-applications.ts`
- Modify: `/Users/yobach/VSCodeProject/sudowork-server/src/index.ts`
- Test: `/Users/yobach/VSCodeProject/sudowork-server/tests/unit/credit-applications-api.test.ts`

- [ ] **Step 1: Write user route validation test**

Create `/Users/yobach/VSCodeProject/sudowork-server/tests/unit/credit-applications-api.test.ts`:

```ts
import { describe, expect, it } from "bun:test";

function validateRequestedPoints(
  value: unknown,
  config = { min_points: 100, max_points: 1000000 },
): string | null {
  if (!Number.isInteger(value)) return "申请积分必须为正整数";
  const points = Number(value);
  if (points <= 0) return "申请积分必须为正整数";
  if (points < config.min_points) return `申请积分不能小于 ${config.min_points}`;
  if (points > config.max_points) return `申请积分不能大于 ${config.max_points}`;
  return null;
}

describe("credit application user validation", () => {
  it("accepts free-form integer points inside configured range", () => {
    expect(validateRequestedPoints(100)).toBeNull();
    expect(validateRequestedPoints(12345)).toBeNull();
    expect(validateRequestedPoints(1000000)).toBeNull();
  });

  it("rejects invalid point amounts", () => {
    expect(validateRequestedPoints(0)).toBe("申请积分必须为正整数");
    expect(validateRequestedPoints(1.5)).toBe("申请积分必须为正整数");
    expect(validateRequestedPoints(99)).toBe("申请积分不能小于 100");
    expect(validateRequestedPoints(1000001)).toBe("申请积分不能大于 1000000");
  });
});
```

- [ ] **Step 2: Run the user validation test**

Run:

```bash
bun test tests/unit/credit-applications-api.test.ts
```

Expected: PASS.

- [ ] **Step 3: Create `CreditApplicationService`**

Create `/Users/yobach/VSCodeProject/sudowork-server/src/services/CreditApplicationService.ts` with these public methods:

```ts
import { db } from "../db/index.js";
import { systemConfigService } from "./SystemConfigService.js";
import { creditApplicationGrantService } from "./CreditApplicationGrantService.js";
import type {
  CreditApplication,
  CreditApplicationWithUser,
  User,
} from "../types/index.js";

interface ICreateApplicationInput {
  userId: number;
  requestedPoints: number;
  reason: string;
}

interface IListUserApplicationsInput {
  userId: number;
  page: number;
  pageSize: number;
}

interface IListAdminApplicationsInput {
  keyword?: string;
  enterpriseId?: number;
  /** Undefined = SUPER_ADMIN (all enterprises); number = ENTERPRISE_ADMIN scoped to own enterprise. */
  enterpriseScope?: number | null;
  status?: string;
  page: number;
  pageSize: number;
}

interface IApproveApplicationInput {
  applicationId: number;
  adminId: number;
  adminRole: "SUPER_ADMIN" | "ENTERPRISE_ADMIN";
  adminEnterpriseId: number | null;
  approvedPoints?: number;
  adminComment?: string;
}

interface IRejectApplicationInput {
  applicationId: number;
  adminId: number;
  adminRole: "SUPER_ADMIN" | "ENTERPRISE_ADMIN";
  adminEnterpriseId: number | null;
  adminComment: string;
}

class CreditApplicationService {
  private ensureApproveMode(): string | null {
    return systemConfigService.getRechargeMode() === "approve"
      ? null
      : "当前未启用积分申请模式";
  }

  private validateReason(reason: unknown): string | null {
    if (typeof reason !== "string" || reason.trim().length === 0) {
      return "申请原因不能为空";
    }
    if (reason.trim().length > 500) {
      return "申请原因不能超过 500 个字符";
    }
    return null;
  }

  private validatePoints(points: unknown): string | null {
    const config = systemConfigService.getCreditApplicationConfig();
    if (!Number.isInteger(points) || Number(points) <= 0) {
      return "申请积分必须为正整数";
    }
    const value = Number(points);
    if (value < config.min_points) {
      return `申请积分不能小于 ${config.min_points}`;
    }
    if (value > config.max_points) {
      return `申请积分不能大于 ${config.max_points}`;
    }
    return null;
  }

  /**
   * Approve/reject is open to SUPER_ADMIN (all enterprises) and to an
   * ENTERPRISE_ADMIN whose `enterprise_id` matches the application's.
   * This is the product permission model for credit applications only; it does
   * not change manual admin recharge permissions.
   */
  private canReview(
    application: { enterprise_id: number | null },
    adminRole: "SUPER_ADMIN" | "ENTERPRISE_ADMIN",
    adminEnterpriseId: number | null,
  ): boolean {
    if (adminRole === "SUPER_ADMIN") return true;
    return application.enterprise_id === adminEnterpriseId;
  }

  /**
   * `approved_points` validation: positive integer and `<= max_points`.
   * Unlike `validatePoints` (user application), it deliberately has NO
   * `min_points` check — admins may approve less than the requested minimum.
   */
  private validateApprovedPoints(points: unknown): string | null {
    const config = systemConfigService.getCreditApplicationConfig();
    if (!Number.isInteger(points) || Number(points) <= 0) {
      return "审批积分必须为正整数";
    }
    if (Number(points) > config.max_points) {
      return `审批积分不能大于 ${config.max_points}`;
    }
    return null;
  }

  private validateTargetUser(application: CreditApplication): { user?: User; error?: string } {
    const user = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(application.user_id) as User | undefined;
    if (!user) return { error: "用户不存在" };
    if (user.status !== 1) return { error: "用户状态不可发放积分" };
    if (user.enterprise_id !== application.enterprise_id) {
      return { error: "用户当前企业与申请企业不一致，请重新核对" };
    }
    if (!user.sudorouter_user_id) return { error: "用户未绑定 sudorouter 账号" };
    return { user };
  }

  private finalizeExistingGrant(
    application: CreditApplication,
    adminId: number,
    adminComment?: string,
  ): { success: boolean; data?: unknown; error?: string } {
    const existingGrant = db
      .prepare(
        `SELECT points, quota, sudorouter_user_id
         FROM admin_recharge_records
         WHERE source = 'CREDIT_APPLICATION' AND source_id = ?`,
      )
      .get(application.id) as
      | { points: number; quota: number; sudorouter_user_id: number | null }
      | undefined;

    if (!existingGrant) {
      return { success: false, error: "申请正在处理中或需人工核对" };
    }

    db.run(
      `UPDATE credit_applications
       SET status = 'APPROVED',
           approved_points = COALESCE(approved_points, ?),
           quota_amount = ?,
           admin_id = COALESCE(admin_id, ?),
           admin_comment = COALESCE(admin_comment, ?),
           sudorouter_user_id = ?,
           sudorouter_success = 1,
           sudorouter_error = NULL,
           reviewed_at = COALESCE(reviewed_at, datetime('now')),
           updated_at = datetime('now')
       WHERE id = ?`,
      [
        existingGrant.points,
        existingGrant.quota,
        adminId,
        adminComment ?? null,
        existingGrant.sudorouter_user_id,
        application.id,
      ],
    );
    return { success: true, data: existingGrant };
  }

  createApplication(input: ICreateApplicationInput): { success: boolean; data?: CreditApplication; error?: string } {
    const modeError = this.ensureApproveMode();
    if (modeError) return { success: false, error: modeError };

    const pointError = this.validatePoints(input.requestedPoints);
    if (pointError) return { success: false, error: pointError };

    const reasonError = this.validateReason(input.reason);
    if (reasonError) return { success: false, error: reasonError };

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(input.userId) as User | undefined;
    if (!user) return { success: false, error: "用户不存在" };
    if (user.status !== 1) return { success: false, error: "用户状态不可申请积分" };

    const config = systemConfigService.getCreditApplicationConfig();
    if (!config.allow_duplicate_pending) {
      const pending = db
        .prepare(
          `SELECT id FROM credit_applications
           WHERE user_id = ? AND status IN ('PENDING', 'PROCESSING', 'SYNC_UNKNOWN')`,
        )
        .get(input.userId);
      if (pending) {
        return { success: false, error: "已有待审批申请，请勿重复提交" };
      }
    }

    const applicationNo = `CA${Date.now()}${Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()}`;
    const result = db.run(
      `INSERT INTO credit_applications (
        application_no, user_id, enterprise_id, requested_points, reason, status
      ) VALUES (?, ?, ?, ?, ?, 'PENDING')`,
      [
        applicationNo,
        input.userId,
        user.enterprise_id,
        input.requestedPoints,
        input.reason.trim(),
      ],
    );

    const created = db
      .prepare("SELECT * FROM credit_applications WHERE id = ?")
      .get(result.lastInsertRowid) as CreditApplication;
    return { success: true, data: created };
  }

  listUserApplications(input: IListUserApplicationsInput): { list: CreditApplication[]; total: number; page: number; pageSize: number } {
    const offset = (input.page - 1) * input.pageSize;
    const list = db
      .prepare(
        `SELECT * FROM credit_applications
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(input.userId, input.pageSize, offset) as CreditApplication[];
    const total = db
      .prepare("SELECT COUNT(*) as count FROM credit_applications WHERE user_id = ?")
      .get(input.userId) as { count: number };
    return { list, total: total.count, page: input.page, pageSize: input.pageSize };
  }

  getUserApplication(userId: number, applicationId: number): CreditApplication | null {
    return (
      (db
        .prepare("SELECT * FROM credit_applications WHERE id = ? AND user_id = ?")
        .get(applicationId, userId) as CreditApplication | undefined) ?? null
    );
  }

  listAdminApplications(input: IListAdminApplicationsInput): { list: CreditApplicationWithUser[]; total: number; page: number; pageSize: number } {
    const params: unknown[] = [];
    let where = "WHERE 1=1";
    if (input.status) {
      where += " AND ca.status = ?";
      params.push(input.status);
    }
    if (input.enterpriseId) {
      where += " AND ca.enterprise_id = ?";
      params.push(input.enterpriseId);
    }
    // Authorization scope: SUPER_ADMIN passes undefined (all enterprises);
    // ENTERPRISE_ADMIN passes their own enterprise_id.
    if (input.enterpriseScope != null) {
      where += " AND ca.enterprise_id = ?";
      params.push(input.enterpriseScope);
    }
    if (input.keyword) {
      where += " AND (u.phone LIKE ? OR u.nickname LIKE ? OR ca.application_no LIKE ?)";
      params.push(`%${input.keyword}%`, `%${input.keyword}%`, `%${input.keyword}%`);
    }

    const offset = (input.page - 1) * input.pageSize;
    const list = db
      .prepare(
        `SELECT ca.*, u.phone as user_phone, u.nickname as user_nickname,
                e.name as enterprise_name,
                a.phone as admin_phone, a.nickname as admin_nickname
         FROM credit_applications ca
         LEFT JOIN users u ON ca.user_id = u.id
         LEFT JOIN enterprises e ON ca.enterprise_id = e.id
         LEFT JOIN users a ON ca.admin_id = a.id
         ${where}
         ORDER BY ca.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, input.pageSize, offset) as CreditApplicationWithUser[];
    const total = db
      .prepare(
        `SELECT COUNT(*) as count
         FROM credit_applications ca
         LEFT JOIN users u ON ca.user_id = u.id
         ${where}`,
      )
      .get(...params) as { count: number };
    return { list, total: total.count, page: input.page, pageSize: input.pageSize };
  }

  getAdminApplication(applicationId: number, enterpriseScope?: number | null): CreditApplicationWithUser | null {
    const params: unknown[] = [applicationId];
    let where = "ca.id = ?";
    // ENTERPRISE_ADMIN is scoped to their own enterprise; SUPER_ADMIN (null/undefined) sees all.
    if (enterpriseScope != null) {
      where += " AND ca.enterprise_id = ?";
      params.push(enterpriseScope);
    }
    return (
      (db
        .prepare(
          `SELECT ca.*, u.phone as user_phone, u.nickname as user_nickname,
                  e.name as enterprise_name,
                  a.phone as admin_phone, a.nickname as admin_nickname
           FROM credit_applications ca
           LEFT JOIN users u ON ca.user_id = u.id
           LEFT JOIN enterprises e ON ca.enterprise_id = e.id
           LEFT JOIN users a ON ca.admin_id = a.id
           WHERE ${where}`,
        )
        .get(...params) as CreditApplicationWithUser | undefined) ?? null
    );
  }

  async approveApplication(input: IApproveApplicationInput): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const modeError = this.ensureApproveMode();
    if (modeError) return { success: false, error: modeError };

    const application = db
      .prepare("SELECT * FROM credit_applications WHERE id = ?")
      .get(input.applicationId) as CreditApplication | undefined;
    if (!application) return { success: false, error: "申请记录不存在" };

    if (!this.canReview(application, input.adminRole, input.adminEnterpriseId)) {
      return { success: false, error: "无权审批该企业的申请" };
    }

    const existingGrantResult = this.finalizeExistingGrant(
      application,
      input.adminId,
      input.adminComment,
    );
    if (existingGrantResult.success) {
      return existingGrantResult;
    }

    if (application.status !== "PENDING" && application.status !== "SYNC_FAILED") {
      return {
        success: false,
        error:
          application.status === "SYNC_UNKNOWN" || application.status === "PROCESSING"
            ? "申请发放状态不确定，请先人工核对 Sudorouter 和充值记录"
            : "当前状态不可审批通过",
      };
    }

    const approvedPoints = input.approvedPoints ?? application.requested_points;
    const pointError = this.validateApprovedPoints(approvedPoints);
    if (pointError) return { success: false, error: pointError };

    const target = this.validateTargetUser(application);
    if (target.error) return { success: false, error: target.error };

    const locked = db.run(
      `UPDATE credit_applications
       SET status = 'PROCESSING',
           approved_points = ?,
           quota_amount = ?,
           admin_id = ?,
           admin_comment = ?,
           reviewed_at = COALESCE(reviewed_at, datetime('now')),
           updated_at = datetime('now')
       WHERE id = ? AND status IN ('PENDING', 'SYNC_FAILED')`,
      [
        approvedPoints,
        approvedPoints * 500,
        input.adminId,
        input.adminComment ?? null,
        application.id,
      ],
    );
    if (locked.changes === 0) {
      return { success: false, error: "申请状态已变化，请刷新后重试" };
    }

    const grant = await creditApplicationGrantService.grantApplicationPoints({
      userId: application.user_id,
      adminId: input.adminId,
      points: approvedPoints,
      applicationId: application.id,
      applicationNo: application.application_no,
    });

    if (!grant.success) {
      const nextStatus = grant.sudorouterSucceeded ? "SYNC_UNKNOWN" : "SYNC_FAILED";
      db.run(
        `UPDATE credit_applications
         SET status = ?,
             sudorouter_success = 0,
             sudorouter_error = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
        [nextStatus, grant.error ?? "Sudorouter 同步失败", application.id],
      );
      return { success: false, error: grant.error || "Sudorouter 同步失败" };
    }

    db.run(
      `UPDATE credit_applications
       SET status = 'APPROVED',
           sudorouter_user_id = ?,
           sudorouter_success = 1,
           sudorouter_error = NULL,
           updated_at = datetime('now')
       WHERE id = ?`,
      [
        target.user?.sudorouter_user_id ?? null,
        application.id,
      ],
    );
    return { success: true, data: grant };
  }

  rejectApplication(input: IRejectApplicationInput): { success: boolean; error?: string } {
    const modeError = this.ensureApproveMode();
    if (modeError) return { success: false, error: modeError };
    if (!input.adminComment || input.adminComment.trim().length === 0) {
      return { success: false, error: "拒绝原因不能为空" };
    }
    if (input.adminComment.trim().length > 500) {
      return { success: false, error: "拒绝原因不能超过 500 个字符" };
    }

    const application = db
      .prepare("SELECT * FROM credit_applications WHERE id = ?")
      .get(input.applicationId) as CreditApplication | undefined;
    if (!application) return { success: false, error: "申请记录不存在" };

    if (!this.canReview(application, input.adminRole, input.adminEnterpriseId)) {
      return { success: false, error: "无权审批该企业的申请" };
    }
    if (application.status !== "PENDING") {
      return { success: false, error: "当前状态不可拒绝" };
    }

    db.run(
      `UPDATE credit_applications
       SET status = 'REJECTED',
           admin_id = ?,
           admin_comment = ?,
           reviewed_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?`,
      [input.adminId, input.adminComment.trim(), application.id],
    );
    return { success: true };
  }
}

export const creditApplicationService = new CreditApplicationService();
```

- [ ] **Step 4: Create user-facing routes**

Create `/Users/yobach/VSCodeProject/sudowork-server/src/routes/credit-applications.ts`:

```ts
import { Hono } from "hono";
import { getAuthUser } from "../middleware/auth.js";
import { creditApplicationService } from "../services/CreditApplicationService.js";

const creditApplicationRoutes = new Hono();

creditApplicationRoutes.post("/", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload?.id) return c.json({ success: false, msg: "未授权" }, 401);

  const body = await c.req.json();
  const result = creditApplicationService.createApplication({
    userId: Number(payload.id),
    requestedPoints: Number(body.requested_points),
    reason: body.reason,
  });
  if (!result.success) {
    return c.json({ success: false, msg: result.error }, 400);
  }
  return c.json({ success: true, data: result.data });
});

creditApplicationRoutes.get("/", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload?.id) return c.json({ success: false, msg: "未授权" }, 401);

  const page = parseInt(c.req.query("page") || "1", 10);
  const pageSize = parseInt(c.req.query("pageSize") || "20", 10);
  const data = creditApplicationService.listUserApplications({
    userId: Number(payload.id),
    page,
    pageSize,
  });
  return c.json({ success: true, data });
});

creditApplicationRoutes.get("/:id", async (c) => {
  const payload = (await getAuthUser(c)) as any;
  if (!payload?.id) return c.json({ success: false, msg: "未授权" }, 401);

  const application = creditApplicationService.getUserApplication(
    Number(payload.id),
    Number(c.req.param("id")),
  );
  if (!application) return c.json({ success: false, msg: "申请记录不存在" }, 404);
  return c.json({ success: true, data: application });
});

export { creditApplicationRoutes };
```

- [ ] **Step 5: Mount user routes**

In `/Users/yobach/VSCodeProject/sudowork-server/src/index.ts`, import:

```ts
import { creditApplicationRoutes } from "./routes/credit-applications.js";
```

Mount after recharge routes:

```ts
app.route("/api/v1/credit-applications", creditApplicationRoutes);
```

- [ ] **Step 6: Run checks**

Run:

```bash
bun test tests/unit/credit-applications-api.test.ts
bunx tsc --noEmit
```

Expected: test passes and TypeScript reports no errors.

- [ ] **Step 7: Commit user application API**

```bash
git add src/services/CreditApplicationService.ts src/routes/credit-applications.ts src/index.ts tests/unit/credit-applications-api.test.ts
git commit -m "feat(recharge): add user credit application API"
```

## Task 4: Admin Approval Routes And Recharge Record Linkage

**Files:**
- Create: `/Users/yobach/VSCodeProject/sudowork-server/src/routes/admin/credit-applications.ts`
- Modify: `/Users/yobach/VSCodeProject/sudowork-server/src/routes/admin/index.ts`
- Modify: `/Users/yobach/VSCodeProject/sudowork-server/src/routes/admin/recharge.ts`
- Test: `/Users/yobach/VSCodeProject/sudowork-server/tests/unit/credit-application-approval.test.ts`

- [ ] **Step 1: Write service-level approval and linkage tests**

Create `/Users/yobach/VSCodeProject/sudowork-server/tests/unit/credit-application-approval.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Database } from "bun:sqlite";

const testDb = new Database(":memory:");

mock.module("../../src/db/index.js", () => ({
  db: testDb,
  SECRET: "test-secret",
}));

const { initSchema } = await import("../../src/db/schema.js");
const { runMigrations } = await import("../../src/db/migrations.js");
const { db } = await import("../../src/db/index.js");
const { creditApplicationService } = await import("../../src/services/CreditApplicationService.js");
const { creditApplicationGrantService } = await import("../../src/services/CreditApplicationGrantService.js");

function resetCreditApplicationTestData() {
  db.run("DELETE FROM admin_recharge_records");
  db.run("DELETE FROM credit_applications");
  db.run("DELETE FROM ledger");
  db.run("DELETE FROM users");
  db.run("DELETE FROM enterprises");
  db.run(
    "INSERT OR REPLACE INTO system_config(key, value) VALUES('recharge_mode', 'approve')",
  );
  db.run(
    "INSERT OR REPLACE INTO system_config(key, value) VALUES('credit_application', ?)",
    ['{"min_points":100,"max_points":1000000,"allow_duplicate_pending":false}'],
  );
}

function seedApplication(enterpriseId: number) {
  db.run("INSERT INTO enterprises(id, name, code) VALUES (?, ?, ?)", [
    enterpriseId,
    `Enterprise ${enterpriseId}`,
    `ent-${enterpriseId}`,
  ]);
  db.run(
    `INSERT INTO users(id, phone, nickname, role, status, enterprise_id, balance, quota, sudorouter_user_id)
     VALUES (?, ?, ?, 'USER', 1, ?, 0, 0, ?)`,
    [enterpriseId * 10, `1880000000${enterpriseId}`, `User ${enterpriseId}`, enterpriseId, enterpriseId * 100],
  );
  db.run(
    `INSERT INTO credit_applications(application_no, user_id, enterprise_id, requested_points, reason, status)
     VALUES (?, ?, ?, 1000, '测试申请', 'PENDING')`,
    [`CA-TEST-${enterpriseId}`, enterpriseId * 10, enterpriseId],
  );
  return db
    .prepare("SELECT id FROM credit_applications WHERE application_no = ?")
    .get(`CA-TEST-${enterpriseId}`) as { id: number };
}

describe("credit application approval service", () => {
  beforeAll(() => {
    initSchema();
    runMigrations();
  });

  afterAll(() => {
    testDb.close();
  });

  beforeEach(() => {
    resetCreditApplicationTestData();
  });

  it("blocks ENTERPRISE_ADMIN from approving another enterprise's application", async () => {
    const application = seedApplication(2);
    const result = await creditApplicationService.approveApplication({
      applicationId: application.id,
      adminId: 9001,
      adminRole: "ENTERPRISE_ADMIN",
      adminEnterpriseId: 1,
      approvedPoints: 1000,
      adminComment: "cross enterprise",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("无权审批该企业的申请");
  });

  it("does not auto-retry unknown or processing grants", async () => {
    const application = seedApplication(1);
    for (const status of ["PROCESSING", "SYNC_UNKNOWN"]) {
      db.run("UPDATE credit_applications SET status = ? WHERE id = ?", [
        status,
        application.id,
      ]);
      const result = await creditApplicationService.approveApplication({
        applicationId: application.id,
        adminId: 9002,
        adminRole: "ENTERPRISE_ADMIN",
        adminEnterpriseId: 1,
        approvedPoints: 1000,
        adminComment: "retry guard",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("申请发放状态不确定，请先人工核对 Sudorouter 和充值记录");
    }
  });

  it("approves own-enterprise application and writes linked recharge record", async () => {
    const application = seedApplication(1);
    const originalGrant = creditApplicationGrantService.grantApplicationPoints;
    creditApplicationGrantService.grantApplicationPoints = async (input) => {
      const quota = input.points * 500;
      db.run("UPDATE users SET balance = balance + ?, quota = quota + ? WHERE id = ?", [
        input.points,
        quota,
        input.userId,
      ]);
      db.run(
        `INSERT INTO admin_recharge_records (
          user_id, admin_id, points, quota, reason, payment_reference,
          sudorouter_user_id, sudorouter_success, source, source_id
        ) VALUES (?, ?, ?, ?, ?, NULL, 100, 1, 'CREDIT_APPLICATION', ?)`,
        [input.userId, input.adminId, input.points, quota, `积分申请审批发放: ${input.applicationNo}`, input.applicationId],
      );
      db.run(
        "INSERT INTO ledger(user_id, amount, type, memo) VALUES (?, ?, 'CREDIT_APPLICATION_APPROVED', ?)",
        [input.userId, input.points, `积分申请审批发放: ${input.applicationNo}`],
      );
      return { success: true, points: input.points, quota, newBalance: input.points, newQuota: quota };
    };

    try {
      const result = await creditApplicationService.approveApplication({
        applicationId: application.id,
        adminId: 9002,
        adminRole: "ENTERPRISE_ADMIN",
        adminEnterpriseId: 1,
        approvedPoints: 800,
        adminComment: "own enterprise",
      });

      expect(result.success).toBe(true);
      const approved = db
        .prepare("SELECT status, approved_points FROM credit_applications WHERE id = ?")
        .get(application.id) as { status: string; approved_points: number };
      expect(approved).toEqual({ status: "APPROVED", approved_points: 800 });

      const linked = db
        .prepare("SELECT source, source_id FROM admin_recharge_records WHERE source_id = ?")
        .get(application.id) as { source: string; source_id: number };
      expect(linked).toEqual({ source: "CREDIT_APPLICATION", source_id: application.id });
    } finally {
      creditApplicationGrantService.grantApplicationPoints = originalGrant;
    }
  });
});
```

- [ ] **Step 2: Run linkage test**

Run:

```bash
bun test tests/unit/credit-application-approval.test.ts
```

Expected: PASS.

- [ ] **Step 3: Create admin approval routes**

Create `/Users/yobach/VSCodeProject/sudowork-server/src/routes/admin/credit-applications.ts`:

```ts
import { Hono } from "hono";
import { authMiddleware, adminMiddleware, getAuthUser } from "../../middleware/auth.js";
import { creditApplicationService } from "../../services/CreditApplicationService.js";
import type { User } from "../../types/index.js";

const adminCreditApplicationRoutes = new Hono();

adminCreditApplicationRoutes.get(
  "/credit-applications",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const adminUser = (await getAuthUser(c)) as User;
    const page = parseInt(c.req.query("page") || "1", 10);
    const pageSize = parseInt(c.req.query("pageSize") || c.req.query("page_size") || "20", 10);
    const enterpriseId = c.req.query("enterprise_id")
      ? Number(c.req.query("enterprise_id"))
      : undefined;
    const data = creditApplicationService.listAdminApplications({
      keyword: c.req.query("keyword")?.trim().slice(0, 50),
      enterpriseId,
      // ENTERPRISE_ADMIN is hard-scoped to their own enterprise; SUPER_ADMIN sees all.
      enterpriseScope:
        adminUser.role === "ENTERPRISE_ADMIN" ? (adminUser.enterprise_id ?? null) : undefined,
      status: c.req.query("status") || undefined,
      page,
      pageSize,
    });
    return c.json({ success: true, data });
  },
);

adminCreditApplicationRoutes.get(
  "/credit-applications/:id",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const adminUser = (await getAuthUser(c)) as User;
    const application = creditApplicationService.getAdminApplication(
      Number(c.req.param("id")),
      adminUser.role === "ENTERPRISE_ADMIN" ? (adminUser.enterprise_id ?? null) : undefined,
    );
    if (!application) return c.json({ success: false, msg: "申请记录不存在" }, 404);
    return c.json({ success: true, data: application });
  },
);

adminCreditApplicationRoutes.post(
  "/credit-applications/:id/approve",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const adminUser = (await getAuthUser(c)) as User;
    const body = await c.req.json().catch(() => ({}));
    const result = await creditApplicationService.approveApplication({
      applicationId: Number(c.req.param("id")),
      adminId: adminUser.id,
      adminRole: adminUser.role as "SUPER_ADMIN" | "ENTERPRISE_ADMIN",
      adminEnterpriseId: adminUser.enterprise_id,
      approvedPoints:
        body.approved_points === undefined ? undefined : Number(body.approved_points),
      adminComment: body.admin_comment,
    });
    if (!result.success) {
      return c.json({ success: false, msg: result.error }, 400);
    }
    return c.json({ success: true, msg: "审批通过", data: result.data });
  },
);

adminCreditApplicationRoutes.post(
  "/credit-applications/:id/reject",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const adminUser = (await getAuthUser(c)) as User;
    const body = await c.req.json();
    const result = creditApplicationService.rejectApplication({
      applicationId: Number(c.req.param("id")),
      adminId: adminUser.id,
      adminRole: adminUser.role as "SUPER_ADMIN" | "ENTERPRISE_ADMIN",
      adminEnterpriseId: adminUser.enterprise_id,
      adminComment: body.admin_comment,
    });
    if (!result.success) {
      return c.json({ success: false, msg: result.error }, 400);
    }
    return c.json({ success: true, msg: "已拒绝" });
  },
);

adminCreditApplicationRoutes.post(
  "/credit-applications/:id/retry-sync",
  authMiddleware,
  adminMiddleware,
  async (c) => {
    const adminUser = (await getAuthUser(c)) as User;
    const application = creditApplicationService.getAdminApplication(
      Number(c.req.param("id")),
      adminUser.role === "ENTERPRISE_ADMIN" ? (adminUser.enterprise_id ?? null) : undefined,
    );
    if (!application) return c.json({ success: false, msg: "申请记录不存在" }, 404);
    if (application.status !== "SYNC_FAILED") {
      return c.json({ success: false, msg: "只有同步失败的申请可以重试" }, 400);
    }
    const result = await creditApplicationService.approveApplication({
      applicationId: application.id,
      adminId: adminUser.id,
      adminRole: adminUser.role as "SUPER_ADMIN" | "ENTERPRISE_ADMIN",
      adminEnterpriseId: adminUser.enterprise_id,
      approvedPoints: application.approved_points ?? application.requested_points,
      adminComment: application.admin_comment ?? "重试同步",
    });
    if (!result.success) {
      return c.json({ success: false, msg: result.error }, 400);
    }
    return c.json({ success: true, msg: "重试成功", data: result.data });
  },
);

export { adminCreditApplicationRoutes };
```

- [ ] **Step 4: Mount admin routes**

In `/Users/yobach/VSCodeProject/sudowork-server/src/routes/admin/index.ts`, import:

```ts
import { adminCreditApplicationRoutes } from './credit-applications.js';
```

Mount:

```ts
adminRoutes.route('/', adminCreditApplicationRoutes);
```

- [ ] **Step 5: Enrich recharge records**

In `/Users/yobach/VSCodeProject/sudowork-server/src/routes/admin/recharge.ts`, modify the `adminQuery` SELECT to include source and application fields:

```sql
arr.source,
arr.source_id,
ca.application_no,
ca.requested_points,
ca.approved_points,
ca.reason as application_reason,
ca.admin_comment
```

Add join:

```sql
LEFT JOIN credit_applications ca
  ON arr.source = 'CREDIT_APPLICATION'
 AND arr.source_id = ca.id
```

Update formatted admin record:

```ts
    source: r.source || "ADMIN_MANUAL",
    source_text:
      r.source === "CREDIT_APPLICATION"
        ? "积分申请审批发放"
        : "后台手工充值",
    application_id:
      r.source === "CREDIT_APPLICATION" ? r.source_id : null,
    application_no: r.application_no || null,
    requested_points: r.requested_points || null,
    approved_points: r.approved_points || null,
    application_reason: r.application_reason || null,
    admin_comment: r.admin_comment || null,
```

- [ ] **Step 6: Run checks**

Run:

```bash
bun test tests/unit/credit-application-approval.test.ts
bunx tsc --noEmit
```

Expected: test passes and TypeScript reports no errors.

- [ ] **Step 7: Commit admin API work**

```bash
git add src/routes/admin/credit-applications.ts src/routes/admin/index.ts src/routes/admin/recharge.ts tests/unit/credit-application-approval.test.ts
git commit -m "feat(admin): add credit application approval API"
```

## Task 5: Admin UI Dedicated Menu

**Files:**
- Modify: `/Users/yobach/VSCodeProject/sudowork-server/admin/src/api/index.ts`
- Modify: `/Users/yobach/VSCodeProject/sudowork-server/admin/src/App.tsx`
- Create: `/Users/yobach/VSCodeProject/sudowork-server/admin/src/pages/CreditApplications.tsx`

- [ ] **Step 1: Add admin API client methods**

In `/Users/yobach/VSCodeProject/sudowork-server/admin/src/api/index.ts`, add methods under `adminApi`:

```ts
  getCreditApplications: (params?: {
    keyword?: string;
    enterprise_id?: number;
    status?: string;
    page?: number;
    pageSize?: number;
  }) => api.get("/v1/admin/credit-applications", { params }),

  getCreditApplicationDetail: (id: number) =>
    api.get(`/v1/admin/credit-applications/${id}`),

  approveCreditApplication: (
    id: number,
    data: { approved_points?: number; admin_comment?: string },
  ) => api.post(`/v1/admin/credit-applications/${id}/approve`, data),

  rejectCreditApplication: (
    id: number,
    data: { admin_comment: string },
  ) => api.post(`/v1/admin/credit-applications/${id}/reject`, data),

  retryCreditApplicationSync: (id: number) =>
    api.post(`/v1/admin/credit-applications/${id}/retry-sync`),
```

- [ ] **Step 2: Create `CreditApplications` page**

Create `/Users/yobach/VSCodeProject/sudowork-server/admin/src/pages/CreditApplications.tsx`:

```tsx
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import { adminApi } from "../api";

interface ICreditApplicationRecord {
  id: number;
  application_no: string;
  user_phone: string | null;
  user_nickname: string | null;
  enterprise_name: string | null;
  requested_points: number;
  approved_points: number | null;
  reason: string | null;
  status:
    | "PENDING"
    | "PROCESSING"
    | "APPROVED"
    | "REJECTED"
    | "SYNC_FAILED"
    | "SYNC_UNKNOWN";
  admin_comment: string | null;
  created_at: string;
  reviewed_at: string | null;
  sudorouter_error: string | null;
}

function CreditApplications() {
  const [form] = Form.useForm();
  const [approveForm] = Form.useForm();
  const [rejectForm] = Form.useForm();
  const [records, setRecords] = useState<ICreditApplicationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<ICreditApplicationRecord | null>(null);
  const [approveVisible, setApproveVisible] = useState(false);
  const [rejectVisible, setRejectVisible] = useState(false);

  const loadRecords = async () => {
    setLoading(true);
    try {
      const values = form.getFieldsValue();
      const response = await adminApi.getCreditApplications({
        keyword: values.keyword,
        status: values.status,
        page: 1,
        pageSize: 50,
      });
      if ((response as any).success) {
        setRecords((response as any).data.list);
      } else {
        message.error((response as any).msg || "加载积分申请失败");
      }
    } catch (error: any) {
      message.error(error.response?.data?.msg || "加载积分申请失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRecords();
  }, []);

  const openApprove = (record: ICreditApplicationRecord) => {
    setCurrent(record);
    approveForm.setFieldsValue({
      approved_points: record.approved_points ?? record.requested_points,
      admin_comment: record.admin_comment ?? "",
    });
    setApproveVisible(true);
  };

  const openReject = (record: ICreditApplicationRecord) => {
    setCurrent(record);
    rejectForm.resetFields();
    setRejectVisible(true);
  };

  const submitApprove = async (values: { approved_points: number; admin_comment?: string }) => {
    if (!current) return;
    const response = await adminApi.approveCreditApplication(current.id, {
      approved_points: values.approved_points,
      admin_comment: values.admin_comment,
    });
    if ((response as any).success) {
      message.success("审批通过");
      setApproveVisible(false);
      setCurrent(null);
      await loadRecords();
      return;
    }
    message.error((response as any).msg || "审批失败");
  };

  const submitReject = async (values: { admin_comment: string }) => {
    if (!current) return;
    const response = await adminApi.rejectCreditApplication(current.id, values);
    if ((response as any).success) {
      message.success("已拒绝");
      setRejectVisible(false);
      setCurrent(null);
      await loadRecords();
      return;
    }
    message.error((response as any).msg || "拒绝失败");
  };

  const retrySync = async (record: ICreditApplicationRecord) => {
    const response = await adminApi.retryCreditApplicationSync(record.id);
    if ((response as any).success) {
      message.success("重试同步成功");
      await loadRecords();
      return;
    }
    message.error((response as any).msg || "重试同步失败");
  };

  const statusMap: Record<ICreditApplicationRecord["status"], { color: string; text: string }> = {
    PENDING: { color: "orange", text: "待审批" },
    PROCESSING: { color: "blue", text: "处理中" },
    APPROVED: { color: "green", text: "已通过" },
    REJECTED: { color: "red", text: "已拒绝" },
    SYNC_FAILED: { color: "volcano", text: "同步失败" },
    SYNC_UNKNOWN: { color: "purple", text: "待人工核对" },
  };

  const columns: ColumnsType<ICreditApplicationRecord> = [
    { title: "申请单号", dataIndex: "application_no", width: 180 },
    {
      title: "用户",
      width: 160,
      render: (_, record) => record.user_nickname || record.user_phone || "-",
    },
    { title: "企业", dataIndex: "enterprise_name", width: 140 },
    {
      title: "申请积分",
      dataIndex: "requested_points",
      width: 120,
      render: (value: number) => value.toLocaleString(),
    },
    {
      title: "审批积分",
      dataIndex: "approved_points",
      width: 120,
      render: (value: number | null) => (value ? value.toLocaleString() : "-"),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 110,
      render: (value: ICreditApplicationRecord["status"]) => (
        <Tag color={statusMap[value].color}>{statusMap[value].text}</Tag>
      ),
    },
    { title: "申请原因", dataIndex: "reason", ellipsis: true },
    { title: "申请时间", dataIndex: "created_at", width: 170 },
    {
      title: "操作",
      width: 220,
      render: (_, record) => (
        <Space size="small">
          {record.status === "PENDING" && (
            <>
              <Button type="link" onClick={() => openApprove(record)}>
                通过
              </Button>
              <Button type="link" danger onClick={() => openReject(record)}>
                拒绝
              </Button>
            </>
          )}
          {record.status === "SYNC_FAILED" && (
            <Button type="link" onClick={() => retrySync(record)}>
              重试同步
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <h2>积分申请</h2>
      <Card style={{ marginBottom: 12 }} styles={{ body: { padding: 12 } }}>
        <Form form={form} layout="inline">
          <Form.Item name="keyword">
            <Input placeholder="用户/申请单号" allowClear style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="status">
            <Select placeholder="状态" allowClear style={{ width: 140 }}>
              <Select.Option value="PENDING">待审批</Select.Option>
              <Select.Option value="PROCESSING">处理中</Select.Option>
              <Select.Option value="APPROVED">已通过</Select.Option>
              <Select.Option value="REJECTED">已拒绝</Select.Option>
              <Select.Option value="SYNC_FAILED">同步失败</Select.Option>
              <Select.Option value="SYNC_UNKNOWN">待人工核对</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item>
            <Space>
              <Button onClick={() => form.resetFields()}>重置</Button>
              <Button type="primary" onClick={() => void loadRecords()}>
                查询
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
      <Card styles={{ body: { padding: 0 } }}>
        <Table
          columns={columns}
          dataSource={records}
          loading={loading}
          rowKey="id"
          scroll={{ x: 1200 }}
          pagination={{ pageSize: 20 }}
        />
      </Card>
      <Modal
        title="审批通过"
        open={approveVisible}
        onOk={() => approveForm.submit()}
        onCancel={() => setApproveVisible(false)}
      >
        <Form form={approveForm} layout="vertical" onFinish={submitApprove}>
          <Form.Item
            label="发放积分"
            name="approved_points"
            rules={[{ required: true, message: "请输入发放积分" }]}
          >
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="审批备注" name="admin_comment">
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="拒绝申请"
        open={rejectVisible}
        onOk={() => rejectForm.submit()}
        onCancel={() => setRejectVisible(false)}
      >
        <Form form={rejectForm} layout="vertical" onFinish={submitReject}>
          <Form.Item
            label="拒绝原因"
            name="admin_comment"
            rules={[{ required: true, message: "请输入拒绝原因" }]}
          >
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default CreditApplications;
```

- [ ] **Step 3: Add conditional admin route and menu**

In `/Users/yobach/VSCodeProject/sudowork-server/admin/src/App.tsx`, import the page (and the hooks if not already imported):

```ts
import React, { useEffect, useState } from "react";
import { adminApi } from "./api";
import CreditApplications from "./pages/CreditApplications";
```

`menuConfig` is module-level, so the conditional "积分申请" item cannot live there. Compute it inside `MainLayout`, which already derives the role-filtered `visibleMenuConfig` per render. Add state and fetch the mode:

```ts
const [rechargeMode, setRechargeMode] = useState<"pay" | "approve" | "disabled">("pay");

useEffect(() => {
  // getSystemConfig is the existing public-config method (key already on adminApi).
  adminApi.getSystemConfig().then((response: any) => {
    const mode = response?.data?.recharge_mode;
    setRechargeMode(mode === "approve" || mode === "disabled" ? mode : "pay");
  });
}, []);
```

Append the menu item only when `rechargeMode === "approve"` and the user is an admin role. Because the push happens after role filtering, gate on the role explicitly (same roles the base `menuConfig` uses):

```ts
  // visibleMenuConfig is built above via menuConfig.filter(...)
  if (rechargeMode === "approve" && (userRole === "SUPER_ADMIN" || userRole === "ENTERPRISE_ADMIN")) {
    visibleMenuConfig.push({
      key: "/credit-applications",
      icon: <PayCircleOutlined />,
      label: "积分申请",
      roles: ["SUPER_ADMIN", "ENTERPRISE_ADMIN"],
    });
  }
```

`menuItems`/breadcrumb are derived from `visibleMenuConfig`, so the new item appears in both without further changes.

Add route:

```tsx
<Route path="credit-applications" element={<CreditApplications />} />
```

- [ ] **Step 4: Run admin build**

Run:

```bash
cd admin
bunx tsc --noEmit
bun run build
```

Expected: TypeScript and build pass.

- [ ] **Step 5: Commit admin UI work**

```bash
git add admin/src/api/index.ts admin/src/App.tsx admin/src/pages/CreditApplications.tsx
git commit -m "feat(admin): add credit application menu"
```

## Task 6: Desktop Client Config And Credit Application Page

**Files:**
- Modify: `/Users/yobach/VSCodeProject/sudowork/src/common/systemConfig.ts`
- Modify: `/Users/yobach/VSCodeProject/sudowork/src/renderer/layouts/components/SettingsSider.tsx`
- Modify: `/Users/yobach/VSCodeProject/sudowork/src/renderer/pages/settings/recharge/types/index.ts`
- Create: `/Users/yobach/VSCodeProject/sudowork/src/renderer/pages/settings/recharge/components/CreditApplicationPanel.tsx`
- Modify: `/Users/yobach/VSCodeProject/sudowork/src/renderer/pages/settings/recharge/index.tsx`
- Modify: `/Users/yobach/VSCodeProject/sudowork/src/renderer/i18n/locales/zh-CN/settings.json`
- Modify: `/Users/yobach/VSCodeProject/sudowork/src/renderer/i18n/locales/en-US/settings.json`
- Test: `/Users/yobach/VSCodeProject/sudowork/tests/unit/creditApplicationConfig.test.ts`
- Test: `/Users/yobach/VSCodeProject/sudowork/tests/unit/creditApplicationPanel.dom.test.tsx`

- [ ] **Step 1: Add client config normalization test**

Create `/Users/yobach/VSCodeProject/sudowork/tests/unit/creditApplicationConfig.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

type RechargeMode = 'pay' | 'approve' | 'disabled';

function normalizeRechargeMode(value: unknown): RechargeMode {
  return value === 'approve' || value === 'disabled' || value === 'pay' ? value : 'pay';
}

describe('credit application config', () => {
  it('defaults missing recharge_mode to pay', () => {
    expect(normalizeRechargeMode(undefined)).toBe('pay');
    expect(normalizeRechargeMode('')).toBe('pay');
    expect(normalizeRechargeMode('approval')).toBe('pay');
  });

  it('keeps approve and disabled modes', () => {
    expect(normalizeRechargeMode('approve')).toBe('approve');
    expect(normalizeRechargeMode('disabled')).toBe('disabled');
  });
});
```

- [ ] **Step 2: Run client config test**

Run:

```bash
cd /Users/yobach/VSCodeProject/sudowork
bunx vitest run tests/unit/creditApplicationConfig.test.ts
```

Expected: PASS.

- [ ] **Step 3: Extend client system-config type**

In `/Users/yobach/VSCodeProject/sudowork/src/common/systemConfig.ts`, add:

```ts
export type RechargeMode = 'pay' | 'approve' | 'disabled';

export interface ICreditApplicationConfig {
  min_points: number;
  max_points: number;
  allow_duplicate_pending: boolean;
}
```

Extend system config shape:

```ts
  recharge_mode?: RechargeMode;
  credit_application?: ICreditApplicationConfig;
```

Add helper:

```ts
export function normalizeRechargeMode(value: unknown): RechargeMode {
  return value === 'approve' || value === 'disabled' || value === 'pay' ? value : 'pay';
}
```

- [ ] **Step 4: Add credit application types**

In `/Users/yobach/VSCodeProject/sudowork/src/renderer/pages/settings/recharge/types/index.ts`, add:

```ts
export type RechargeMode = 'pay' | 'approve' | 'disabled';

export type CreditApplicationStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'APPROVED'
  | 'REJECTED'
  | 'SYNC_FAILED'
  | 'SYNC_UNKNOWN';

export interface CreditApplication {
  id: number;
  application_no: string;
  requested_points: number;
  approved_points: number | null;
  quota_amount: number | null;
  reason: string | null;
  status: CreditApplicationStatus;
  admin_comment: string | null;
  created_at: string;
  reviewed_at: string | null;
  sudorouter_error: string | null;
}
```

- [ ] **Step 5: Create credit application panel**

Create `/Users/yobach/VSCodeProject/sudowork/src/renderer/pages/settings/recharge/components/CreditApplicationPanel.tsx`:

```tsx
import { Button, Form, Input, InputNumber, Message, Spin, Tag } from '@arco-design/web-react';
import { Send, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { useAuth } from '@/renderer/context/AuthContext';
import type { CreditApplication } from '../types';

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'orange',
  PROCESSING: 'blue',
  APPROVED: 'green',
  REJECTED: 'red',
  SYNC_FAILED: 'red',
  SYNC_UNKNOWN: 'purple',
};

export default function CreditApplicationPanel({ onSubmitted }: ICreditApplicationPanelProps) {
  const { t } = useTranslation();
  const { user: currentUser, ensureValidToken } = useAuth();
  const [form] = Form.useForm();
  const [applications, setApplications] = useState<CreditApplication[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchApplications = useCallback(async () => {
    if (!currentUser?.token) return;
    setIsLoading(true);
    try {
      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
      const token = await ensureValidToken();
      if (!token) return;
      const response = await fetch(`${serverConfig.baseUrl}/api/v1/credit-applications?page=1&pageSize=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        setApplications(data.data.list);
      } else {
        Message.error(data.msg || t('settings.creditApplication.loadFailed', '加载积分申请失败'));
      }
    } catch (error) {
      console.error('Failed to fetch credit applications:', error);
      Message.error(t('settings.creditApplication.loadFailed', '加载积分申请失败'));
    } finally {
      setIsLoading(false);
    }
  }, [currentUser?.token, ensureValidToken, t]);

  useEffect(() => {
    void fetchApplications();
  }, [fetchApplications]);

  const onSubmit = async (values: { requested_points: number; reason: string }) => {
    if (!currentUser?.token) return;
    setIsSubmitting(true);
    try {
      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
      const token = await ensureValidToken();
      if (!token) return;
      const response = await fetch(`${serverConfig.baseUrl}/api/v1/credit-applications`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requested_points: values.requested_points,
          reason: values.reason,
        }),
      });
      const data = await response.json();
      if (!data.success) {
        Message.error(data.msg || t('settings.creditApplication.submitFailed', '提交申请失败'));
        return;
      }
      Message.success(t('settings.creditApplication.submitSuccess', '申请已提交'));
      form.resetFields();
      await fetchApplications();
      onSubmitted?.();
    } catch (error) {
      console.error('Failed to submit credit application:', error);
      Message.error(t('settings.creditApplication.submitFailed', '提交申请失败'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className='p-6 bg-muted rd-16px border border-light'>
      <div className='text-14px font-600 text-foreground mb-4'>
        {t('settings.creditApplication.title', '积分申请')}
      </div>
      <Form form={form} layout='vertical' onSubmit={onSubmit}>
        <Form.Item
          field='requested_points'
          label={t('settings.creditApplication.points', '申请积分')}
          rules={[{ required: true, message: t('settings.creditApplication.pointsRequired', '请输入申请积分') }]}
        >
          <InputNumber min={1} precision={0} className='w-full' />
        </Form.Item>
        <Form.Item
          field='reason'
          label={t('settings.creditApplication.reason', '申请原因')}
          rules={[{ required: true, message: t('settings.creditApplication.reasonRequired', '请输入申请原因') }]}
        >
          <Input.TextArea maxLength={500} showWordLimit autoSize={{ minRows: 3, maxRows: 5 }} />
        </Form.Item>
        <div className='flex justify-end'>
          <Button type='primary' htmlType='submit' loading={isSubmitting} icon={<Send size={16} />}>
            {t('settings.creditApplication.submit', '提交申请')}
          </Button>
        </div>
      </Form>

      <div className='mt-6 border-t border-light pt-4'>
        <div className='flex items-center justify-between mb-3'>
          <div className='text-14px font-600 text-foreground'>
            {t('settings.creditApplication.history', '申请记录')}
          </div>
          <Button type='text' size='mini' icon={<RefreshCw size={14} />} onClick={() => void fetchApplications()} />
        </div>
        {isLoading ? (
          <div className='f-center py-6'><Spin /></div>
        ) : applications.length === 0 ? (
          <div className='py-6 text-center text-tertiary text-14px'>
            {t('settings.creditApplication.empty', '暂无申请记录')}
          </div>
        ) : (
          <div className='space-y-2'>
            {applications.map((item) => (
              <div key={item.id} className='flex items-center gap-3 p-3 bg-emphasis rd-8px'>
                <div className='flex-1 min-w-0'>
                  <div className='text-13px text-foreground truncate'>{item.application_no}</div>
                  <div className='text-12px text-secondary truncate'>{item.reason}</div>
                </div>
                <div className='text-14px text-primary font-500'>{item.requested_points.toLocaleString()} PTS</div>
                <Tag color={STATUS_COLOR[item.status] || 'gray'}>{item.status}</Tag>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ICreditApplicationPanelProps {
  onSubmitted?: () => void;
}
```

- [ ] **Step 6: Branch recharge page by `recharge_mode`**

In `/Users/yobach/VSCodeProject/sudowork/src/renderer/pages/settings/recharge/index.tsx`, import:

```ts
import { fetchSystemConfig, normalizeRechargeMode } from '@/common/systemConfig';
import CreditApplicationPanel from './components/CreditApplicationPanel';
import type { RechargeMode } from './types';
```

Add state:

```ts
const [rechargeMode, setRechargeMode] = useState<RechargeMode>('pay');
```

Load mode (the client module exposes `fetchSystemConfig`, not `getSystemConfig`):

```ts
useEffect(() => {
  void fetchSystemConfig().then((config) => {
    setRechargeMode(normalizeRechargeMode(config?.recharge_mode));
  });
}, []);
```

Before rendering old payment content, branch:

```tsx
if (rechargeMode === 'approve') {
  return (
    <PageWrapper title={t('settings.creditApplication.title', '积分申请')}>
      <div className='flex flex-col gap-6 pb-2'>
        {statsLoading ? (
          <div className='flex justify-center py-10'><Spin /></div>
        ) : (
          <PointsDashboard remainingPoints={stats?.remaining ?? 0} usedPoints={stats?.used ?? 0} bonusPoints={stats?.bonus ?? 0} />
        )}
        <CreditApplicationPanel onSubmitted={() => void fetchStats()} />
      </div>
    </PageWrapper>
  );
}

if (rechargeMode === 'disabled') {
  return (
    <PageWrapper title={t('settings.rechargeCenter', '充值中心')}>
      <div className='p-6 bg-muted rd-16px border border-light text-secondary'>
        {t('settings.recharge.disabled', '充值入口已关闭')}
      </div>
    </PageWrapper>
  );
}
```

Keep the existing `pay` return unchanged after this branch.

- [ ] **Step 7: Update settings sider**

In `/Users/yobach/VSCodeProject/sudowork/src/renderer/layouts/components/SettingsSider.tsx`, load public system config and normalize mode. For `recharge` item label:

```ts
recharge: {
  id: 'recharge',
  label:
    rechargeMode === 'approve'
      ? t('settings.creditApplication.title') || '积分申请'
      : t('settings.rechargeCenter') || '充值中心',
  icon: <CreditCard />,
  path: 'recharge',
  hidden: rechargeMode === 'disabled',
},
```

Keep existing guest filtering.

- [ ] **Step 8: Add i18n keys**

In `/Users/yobach/VSCodeProject/sudowork/src/renderer/i18n/locales/zh-CN/settings.json`, add under `settings`:

```json
"creditApplication": {
  "title": "积分申请",
  "points": "申请积分",
  "pointsRequired": "请输入申请积分",
  "reason": "申请原因",
  "reasonRequired": "请输入申请原因",
  "submit": "提交申请",
  "submitSuccess": "申请已提交",
  "submitFailed": "提交申请失败",
  "loadFailed": "加载积分申请失败",
  "history": "申请记录",
  "empty": "暂无申请记录"
}
```

In `/Users/yobach/VSCodeProject/sudowork/src/renderer/i18n/locales/en-US/settings.json`, add:

```json
"creditApplication": {
  "title": "Credit Application",
  "points": "Requested Points",
  "pointsRequired": "Enter requested points",
  "reason": "Reason",
  "reasonRequired": "Enter a reason",
  "submit": "Submit",
  "submitSuccess": "Application submitted",
  "submitFailed": "Failed to submit application",
  "loadFailed": "Failed to load applications",
  "history": "Application History",
  "empty": "No applications"
}
```

- [ ] **Step 9: Regenerate i18n types and run client checks**

Run:

```bash
cd /Users/yobach/VSCodeProject/sudowork
bun run i18n:types
bunx eslint src/common/systemConfig.ts src/renderer/layouts/components/SettingsSider.tsx src/renderer/pages/settings/recharge/index.tsx src/renderer/pages/settings/recharge/components/CreditApplicationPanel.tsx src/renderer/pages/settings/recharge/types/index.ts --fix
bunx tsc --noEmit
bunx vitest run tests/unit/creditApplicationConfig.test.ts
```

Expected: i18n types regenerate, lint succeeds, TypeScript succeeds, and the config test passes.

- [ ] **Step 10: Commit desktop client work**

```bash
cd /Users/yobach/VSCodeProject/sudowork
git add src/common/systemConfig.ts src/renderer/layouts/components/SettingsSider.tsx src/renderer/pages/settings/recharge/index.tsx src/renderer/pages/settings/recharge/components/CreditApplicationPanel.tsx src/renderer/pages/settings/recharge/types/index.ts src/renderer/i18n/locales/zh-CN/settings.json src/renderer/i18n/locales/en-US/settings.json src/renderer/i18n/i18n-keys.d.ts tests/unit/creditApplicationConfig.test.ts
git commit -m "feat(recharge): show credit application mode"
```

## Task 7: End-To-End Verification

**Files:**
- No source file changes.
- Verify both repositories.

- [ ] **Step 1: Verify server default mode does not break existing recharge**

Run:

```bash
cd /Users/yobach/VSCodeProject/sudowork-server
bunx tsc --noEmit
bun test tests/unit/recharge-mode-config.test.ts tests/unit/credit-application-grant.test.ts tests/unit/credit-applications-api.test.ts tests/unit/credit-application-approval.test.ts
```

Expected: TypeScript succeeds and all four tests pass.

- [ ] **Step 2: Verify old recharge endpoints remain present**

Run:

```bash
cd /Users/yobach/VSCodeProject/sudowork-server
rg -n 'app.route\\("/api/v1/recharge", rechargeRoutes\\)|/packages|/create|/pay|/callback|/query/:orderNo|/list|/cancel/:orderNo' src/index.ts src/routes/recharge.ts
```

Expected: output shows `/api/v1/recharge` route mount and all old recharge routes.

- [ ] **Step 3: Verify new routes are mounted**

Run:

```bash
cd /Users/yobach/VSCodeProject/sudowork-server
rg -n 'creditApplicationRoutes|adminCreditApplicationRoutes|/api/v1/credit-applications|credit-applications' src/index.ts src/routes/admin/index.ts src/routes/credit-applications.ts src/routes/admin/credit-applications.ts
```

Expected: output shows user route mount, admin route mount, and route files.

- [ ] **Step 4: Verify desktop client**

Run:

```bash
cd /Users/yobach/VSCodeProject/sudowork
bunx tsc --noEmit
bunx vitest run tests/unit/creditApplicationConfig.test.ts
```

Expected: TypeScript succeeds and the config test passes.

- [ ] **Step 5: Manual smoke test in approve mode**

Start server:

```bash
cd /Users/yobach/VSCodeProject/sudowork-server
bun run start
```

Set config through admin system-config API or DB:

```sql
INSERT INTO system_config(key, value) VALUES('recharge_mode', 'approve')
ON CONFLICT(key) DO UPDATE SET value = 'approve';
```

Start desktop app:

```bash
cd /Users/yobach/VSCodeProject/sudowork
bun run start
```

Expected manual results:

- Desktop settings shows "积分申请" instead of payment-oriented recharge UI.
- User submits a free-form integer point application.
- Admin app shows "积分申请" menu.
- Admin approves application.
- User quota/balance increases after Sudorouter succeeds.
- `/api/v1/admin/recharge-records` returns `source='CREDIT_APPLICATION'` and `application_no`.
- Login as an `ENTERPRISE_ADMIN`: "积分申请" menu is visible, the list contains only that enterprise's applications, and approving/rejecting an application of another enterprise returns 400 "无权审批该企业的申请".
- Login as `SUPER_ADMIN`: the list contains applications of all enterprises, and cross-enterprise approve/reject succeeds.

- [ ] **Step 6: Manual smoke test in default pay mode**

Remove or blank `recharge_mode`:

```sql
DELETE FROM system_config WHERE key = 'recharge_mode';
```

Restart server and desktop app.

Expected manual results:

- Desktop settings shows existing "充值中心".
- Existing payment package UI is visible.
- Credit application page/menu is not visible.
- `POST /api/v1/credit-applications` returns a mode error.
- Old `/api/v1/recharge/packages` still returns recharge packages.

## Self-Review

- Spec coverage: This plan covers `recharge_mode` defaulting to `pay`, `approve`-only page/menu visibility, new application APIs, dedicated admin menu, free-form integer point input, Sudorouter quota update after approval, old Fuiou endpoint/manual-admin-recharge compatibility, recharge-record source linkage back to application records, and two-role approval — both `SUPER_ADMIN` (all enterprises) and `ENTERPRISE_ADMIN` (own enterprise only, scoped by JWT `enterprise_id`) can list/approve/reject, with `PROCESSING`/`SYNC_UNKNOWN` plus a unique `source/source_id` recharge-record guard to reduce double-grant risk.
- Placeholder scan: No open-ended placeholders are left for implementers. Each new table, route, service method, UI page, and verification command has concrete names and paths.
- Type consistency: The mode values are consistently `pay | approve | disabled`; application statuses are consistently `PENDING | PROCESSING | APPROVED | REJECTED | SYNC_FAILED | SYNC_UNKNOWN`; record sources are consistently `ADMIN_MANUAL | CREDIT_APPLICATION`; reviewer roles are consistently `SUPER_ADMIN | ENTERPRISE_ADMIN` (carried as `adminRole` plus `adminEnterpriseId` into service calls).
