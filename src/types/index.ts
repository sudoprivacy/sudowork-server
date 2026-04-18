/**
 * Type definitions for sudowork-server
 */

import type { OrderStatus, UserStatus, UserRole, LedgerType, ConfigItemStatus } from '../utils/constants.js';

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

// ==================== Config Item Types ====================

export interface ConfigItem {
  id: number;
  name: string;
  description: string | null;
  status: ConfigItemStatus;
  created_by_id: number | null;
  created_by_name: string | null;
  updated_by_id: number | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConfigEntry {
  id: number;
  config_item_id: number;
  config_key: string;
  name: string;
  config_desc: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConfigEnterpriseRel {
  id: number;
  config_item_id: number;
  enterprise_id: number;
}