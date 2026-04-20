import axios from "axios";

const API_BASE_URL = import.meta.env.PROD ? "/api" : "/api";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("admin_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// Response interceptor
api.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("admin_token");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);

// Admin APIs
export const adminApi = {
  login: (data: { phone: string; password: string }) =>
    api.post("/v1/admin/login", data),

  changePassword: (data: { oldPassword: string; newPassword: string }) =>
    api.post("/v1/admin/change-password", data),

  getStats: () => api.get("/v1/admin/stats"),

  // Enterprise APIs
  getEnterprises: () => api.get("/v1/admin/enterprises"),

  createEnterprise: (data: {
    name: string;
    code: string;
    credit_pool?: number;
  }) => api.post("/v1/admin/enterprises", data),

  updateEnterprise: (id: number, data: { name: string; credit_pool?: number }) =>
    api.put(`/v1/admin/enterprises/${id}`, data),

  deleteEnterprise: (id: number) => api.delete(`/v1/admin/enterprises/${id}`),

  // User APIs
  getUsers: (params?: {
    keyword?: string;
    enterprise_id?: number;
    status?: number;
    role?: string;
  }) => api.get("/v1/admin/users", { params }),

  createUser: (data: {
    phone: string;
    nickname?: string;
    enterprise_id: number;
    invitation_code_id?: number;
  }) => api.post("/v1/admin/users", data),

  updateUser: (
    id: number,
    data: {
      nickname?: string;
      status?: number;
      enterprise_id?: number;
    },
  ) => api.put(`/v1/admin/users/${id}`, data),

  deleteUser: (id: number) => api.delete(`/v1/admin/users/${id}`),

  getAvailableInvitationCodes: (enterpriseId: number) =>
    api.get(`/v1/admin/invitation-codes/available`, { params: { enterprise_id: enterpriseId } }),

  setUserRole: (id: number, role: string) =>
    api.post(`/v1/admin/users/${id}/role`, { role }),

  adjustPoints: (
    id: number,
    data: { amount: number; reason?: string; operation: "add" | "subtract" },
  ) => api.post(`/v1/admin/users/${id}/points`, data),

  manageUser: (id: number, action: "enable" | "disable") =>
    api.post(`/v1/admin/users/${id}/manage`, { action }),

  syncUserQuota: (id: number) =>
    api.post(`/v1/admin/members/${id}/sync-quota`),

  getUserLedger: (id: number, limit?: number) =>
    api.get(`/v1/admin/users/${id}/ledger`, { params: { limit } }),

  // Invitation Code APIs
  getInvitationCodes: (params?: { status?: number; enterprise_id?: number; page?: number; page_size?: number }) =>
    api.get("/v1/admin/invitation-codes", { params }),

  createInvitationCodes: (enterpriseId: number, count: number) =>
    api.post("/v1/admin/invitation-codes", { enterprise_id: enterpriseId, count }),

  deleteInvitationCode: (id: number) =>
    api.delete(`/v1/admin/invitation-codes/${id}`),

  // Operation Logs APIs
  getOperationLogs: (params?: {
    user_id?: number;
    action?: string;
    date_from?: number;
    date_to?: number;
    page?: number;
    page_size?: number;
  }) => api.get("/v1/admin/logs", { params }),

  // Recharge APIs
  getRechargeStats: () =>
    api.get("/v1/admin/recharge/stats"),

  getRechargeOrders: (params?: {
    order_no?: string;
    user_phone?: string;
    status?: string;
    start_date?: string;
    end_date?: string;
    page?: number;
    page_size?: number;
  }) => api.get("/v1/admin/recharge/orders", { params }),

  getRechargeOrderDetail: (orderNo: string) =>
    api.get(`/v1/admin/recharge/orders/${orderNo}`),

  retryRechargeOrder: (orderNo: string) =>
    api.post(`/v1/admin/recharge/orders/${orderNo}/retry`),

  simulatePayment: (orderNo: string) =>
    api.post(`/v1/admin/recharge/simulate-payment/${orderNo}`),

  refundOrder: (orderNo: string, reason?: string) =>
    api.post(`/v1/admin/recharge/orders/${orderNo}/refund`, { reason }),

  getRefundCalc: (orderNo: string) =>
    api.get(`/v1/admin/recharge/refund-calc/${orderNo}`),

  getRechargeRecords: (params?: {
    keyword?: string;
    type?: string;
    payment_method?: string;
    page?: number;
    pageSize?: number;
  }) => api.get("/v1/admin/recharge-records", { params }),

  // Sync pending orders
  syncPendingOrders: () =>
    api.post("/v1/admin/recharge/sync"),

  syncOrderStatus: (orderNo: string) =>
    api.post(`/v1/admin/recharge/orders/${orderNo}/sync`),

  // Admin Recharge (后台给用户充值)
  adminRecharge: (userId: number, data: {
    points: number;
    reason: string;
    payment_reference?: string;
  }) => api.post(`/v1/admin/users/${userId}/recharge`, data),

  // Sync user quota
  syncUserQuotaNew: (userId: number) =>
    api.post(`/v1/admin/users/${userId}/sync-quota`),

  // Get user recharge records
  getUserRecharges: (userId: number, params?: { page?: number; page_size?: number }) =>
    api.get(`/v1/admin/users/${userId}/recharges`, { params }),

  // Config Items APIs
  getConfigItems: (params?: {
    enterprise_name?: string;
    name?: string;
    status?: number;
    page?: number;
    page_size?: number;
  }) => api.get("/v1/admin/config-items", { params }),

  createConfigItem: (data: { name: string; description?: string; icon?: string }) =>
    api.post("/v1/admin/config-items", data),

  getConfigItemDetail: (id: number) =>
    api.get(`/v1/admin/config-items/${id}`),

  updateConfigItem: (id: number, data: { name?: string; description?: string; icon?: string; pinyin?: string }) =>
    api.put(`/v1/admin/config-items/${id}`, data),

  updateConfigItemStatus: (id: number, status: number) =>
    api.put(`/v1/admin/config-items/${id}/status`, { status }),

  getConfigEntries: (id: number) =>
    api.get(`/v1/admin/config-items/${id}/entries`),

  saveConfigEntries: (id: number, entries: { config_key: string; name: string; config_desc?: string; required?: number }[]) =>
    api.put(`/v1/admin/config-items/${id}/entries`, { entries }),

  getConfigEnterprises: (id: number, params?: {
    enterprise_name?: string;
    enterprise_id?: number;
    page?: number;
    page_size?: number;
  }) => api.get(`/v1/admin/config-items/${id}/enterprises`, { params }),

  addConfigEnterprise: (configItemId: number, enterpriseId: number) =>
    api.post(`/v1/admin/config-items/${configItemId}/enterprises/${enterpriseId}`),

  removeConfigEnterprise: (configItemId: number, enterpriseId: number) =>
    api.delete(`/v1/admin/config-items/${configItemId}/enterprises/${enterpriseId}`),

  // Upload config item icon
  uploadConfigItemIcon: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post("/v1/admin/upload/config-item-icon", formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};
