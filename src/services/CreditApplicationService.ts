import { db } from "../db/index.js";
import {
  creditApplicationGrantService,
  type ICreditApplicationGrantResult,
} from "./CreditApplicationGrantService.js";
import { systemConfigService } from "./SystemConfigService.js";
import { sudorouterService } from "./SudorouterService.js";
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

interface IResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

class CreditApplicationService {
  createApplication(input: ICreateApplicationInput): IResult<CreditApplication> {
    const modeError = this.ensureApproveMode();
    if (modeError) return { success: false, error: modeError };

    const pointError = this.validateRequestedPoints(input.requestedPoints);
    if (pointError) return { success: false, error: pointError };

    const reasonError = this.validateReason(input.reason);
    if (reasonError) return { success: false, error: reasonError };

    const user = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(input.userId) as User | undefined;
    if (!user) return { success: false, error: "用户不存在" };
    if (user.status !== 1) {
      return { success: false, error: "用户状态不可申请积分" };
    }

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

    const result = db.run(
      `INSERT INTO credit_applications (
        application_no, user_id, enterprise_id, requested_points, reason, status
      ) VALUES (?, ?, ?, ?, ?, 'PENDING')`,
      [
        this.createApplicationNo(),
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

  listUserApplications(input: IListUserApplicationsInput): {
    list: CreditApplication[];
    total: number;
    page: number;
    pageSize: number;
  } {
    const page = this.normalizePage(input.page);
    const pageSize = this.normalizePageSize(input.pageSize);
    const offset = (page - 1) * pageSize;
    const list = db
      .prepare(
        `SELECT * FROM credit_applications
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(input.userId, pageSize, offset) as CreditApplication[];
    const total = db
      .prepare("SELECT COUNT(*) as count FROM credit_applications WHERE user_id = ?")
      .get(input.userId) as { count: number };
    return { list, total: total.count, page, pageSize };
  }

  getUserApplication(
    userId: number,
    applicationId: number,
  ): CreditApplication | null {
    return (
      (db
        .prepare("SELECT * FROM credit_applications WHERE id = ? AND user_id = ?")
        .get(applicationId, userId) as CreditApplication | undefined) ?? null
    );
  }

  listAdminApplications(input: IListAdminApplicationsInput): {
    list: CreditApplicationWithUser[];
    total: number;
    page: number;
    pageSize: number;
  } {
    const params: any[] = [];
    let where = "WHERE 1=1";
    if (input.status) {
      where += " AND ca.status = ?";
      params.push(input.status);
    }
    if (input.enterpriseId) {
      where += " AND ca.enterprise_id = ?";
      params.push(input.enterpriseId);
    }
    if (input.enterpriseScope !== undefined) {
      where += " AND ca.enterprise_id = ?";
      params.push(input.enterpriseScope);
    }
    if (input.keyword) {
      where +=
        " AND (u.phone LIKE ? OR u.nickname LIKE ? OR ca.application_no LIKE ?)";
      params.push(
        `%${input.keyword}%`,
        `%${input.keyword}%`,
        `%${input.keyword}%`,
      );
    }

    const page = this.normalizePage(input.page);
    const pageSize = this.normalizePageSize(input.pageSize);
    const offset = (page - 1) * pageSize;
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
      .all(...params, pageSize, offset) as CreditApplicationWithUser[];
    const total = db
      .prepare(
        `SELECT COUNT(*) as count
         FROM credit_applications ca
         LEFT JOIN users u ON ca.user_id = u.id
         ${where}`,
      )
      .get(...params) as { count: number };
    return { list, total: total.count, page, pageSize };
  }

  getAdminApplication(
    applicationId: number,
    enterpriseScope?: number | null,
  ): CreditApplicationWithUser | null {
    const params: any[] = [applicationId];
    let where = "ca.id = ?";
    if (enterpriseScope !== undefined) {
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

  async approveApplication(input: IApproveApplicationInput): Promise<IResult> {
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
          application.status === "SYNC_UNKNOWN" ||
          application.status === "PROCESSING"
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
        sudorouterService.pointsToQuota(approvedPoints),
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
      return this.markGrantFailure(application.id, grant);
    }

    db.run(
      `UPDATE credit_applications
       SET status = 'APPROVED',
           quota_amount = ?,
           sudorouter_user_id = ?,
           sudorouter_success = 1,
           sudorouter_error = NULL,
           updated_at = datetime('now')
       WHERE id = ?`,
      [grant.quota ?? 0, target.user?.sudorouter_user_id ?? null, application.id],
    );
    return { success: true, data: grant };
  }

  rejectApplication(input: IRejectApplicationInput): IResult {
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

  private validateRequestedPoints(points: unknown): string | null {
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

  private canReview(
    application: { enterprise_id: number | null },
    adminRole: "SUPER_ADMIN" | "ENTERPRISE_ADMIN",
    adminEnterpriseId: number | null,
  ): boolean {
    if (adminRole === "SUPER_ADMIN") return true;
    if (adminEnterpriseId == null) return false;
    return application.enterprise_id === adminEnterpriseId;
  }

  private validateTargetUser(
    application: CreditApplication,
  ): { user?: User; error?: string } {
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
  ): IResult {
    const existingGrant = db
      .prepare(
        `SELECT points, quota, sudorouter_user_id
         FROM admin_recharge_records
         WHERE source = 'CREDIT_APPLICATION' AND source_id = ?`,
      )
      .get(application.id) as
      | { points: number; quota: number; sudorouter_user_id: number | null }
      | undefined;

    if (!existingGrant) return { success: false };

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

  private markGrantFailure(
    applicationId: number,
    grant: ICreditApplicationGrantResult,
  ): IResult {
    const nextStatus = grant.sudorouterSucceeded ? "SYNC_UNKNOWN" : "SYNC_FAILED";
    db.run(
      `UPDATE credit_applications
       SET status = ?,
           sudorouter_success = 0,
           sudorouter_error = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
      [nextStatus, grant.error ?? "Sudorouter 同步失败", applicationId],
    );
    return { success: false, error: grant.error || "Sudorouter 同步失败" };
  }

  private normalizePage(page: number): number {
    return Number.isInteger(page) && page > 0 ? page : 1;
  }

  private normalizePageSize(pageSize: number): number {
    return Number.isInteger(pageSize) && pageSize > 0
      ? Math.min(pageSize, 100)
      : 20;
  }

  private createApplicationNo(): string {
    return `CA${Date.now()}${Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()}`;
  }
}

export const creditApplicationService = new CreditApplicationService();
