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

// ==================== Config Item Status ====================

export const CONFIG_ITEM_STATUS = {
  DISABLED: 0,    // 禁用
  ENABLED: 1,     // 正常
} as const;

export type ConfigItemStatus = typeof CONFIG_ITEM_STATUS[keyof typeof CONFIG_ITEM_STATUS];

export const CONFIG_ITEM_STATUS_TEXT: Record<ConfigItemStatus, string> = {
  [CONFIG_ITEM_STATUS.DISABLED]: '禁用',
  [CONFIG_ITEM_STATUS.ENABLED]: '正常',
};