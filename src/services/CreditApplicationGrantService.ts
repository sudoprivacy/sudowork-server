import { db } from "../db/index.js";
import { logOperation } from "../utils/logger.js";
import { sudorouterService } from "./SudorouterService.js";
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
        [
          input.userId,
          input.points,
          "CREDIT_APPLICATION_APPROVED",
          reason,
        ],
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
        responseData: {
          points: input.points,
          quota: quotaDelta,
          newBalance,
          newQuota,
        },
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

export const creditApplicationGrantService =
  new CreditApplicationGrantService();
