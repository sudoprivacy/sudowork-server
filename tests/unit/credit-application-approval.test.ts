import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { Database } from "bun:sqlite";

const testDb = new Database(":memory:");

mock.module("../../src/db/index.js", () => ({
  db: testDb,
  SECRET: "test-secret",
}));

const { initSchema } = await import("../../src/db/schema.js");
const { runMigrations } = await import("../../src/db/migrations.js");
const { db } = await import("../../src/db/index.js");
const { creditApplicationService } = await import(
  "../../src/services/CreditApplicationService.js"
);
const { creditApplicationGrantService } = await import(
  "../../src/services/CreditApplicationGrantService.js"
);

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
    `INSERT INTO users(
      id, phone, nickname, role, status, enterprise_id,
      balance, quota, sudorouter_user_id
    ) VALUES (?, ?, ?, 'USER', 1, ?, 0, 0, ?)`,
    [
      enterpriseId * 10,
      `1880000000${enterpriseId}`,
      `User ${enterpriseId}`,
      enterpriseId,
      enterpriseId * 100,
    ],
  );
  db.run(
    `INSERT INTO credit_applications(
      application_no, user_id, enterprise_id, requested_points, reason, status
    ) VALUES (?, ?, ?, 1000, '测试申请', 'PENDING')`,
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
      expect(result.error).toBe(
        "申请发放状态不确定，请先人工核对 Sudorouter 和充值记录",
      );
    }
  });

  it("approves own-enterprise application and writes linked recharge record", async () => {
    const application = seedApplication(1);
    const originalGrant = creditApplicationGrantService.grantApplicationPoints;
    creditApplicationGrantService.grantApplicationPoints = async (input) => {
      const quota = Math.round(input.points / 0.002);
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
        [
          input.userId,
          input.adminId,
          input.points,
          quota,
          `积分申请审批发放: ${input.applicationNo}`,
          input.applicationId,
        ],
      );
      db.run(
        "INSERT INTO ledger(user_id, amount, type, memo) VALUES (?, ?, 'CREDIT_APPLICATION_APPROVED', ?)",
        [input.userId, input.points, `积分申请审批发放: ${input.applicationNo}`],
      );
      return {
        success: true,
        points: input.points,
        quota,
        newBalance: input.points,
        newQuota: quota,
      };
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
      expect(linked).toEqual({
        source: "CREDIT_APPLICATION",
        source_id: application.id,
      });
    } finally {
      creditApplicationGrantService.grantApplicationPoints = originalGrant;
    }
  });
});
