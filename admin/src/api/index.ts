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

  // User Auth APIs (SMS login)
  sendCode: (phone: string) => api.post("/v1/auth/send-code", { phone }),

  userLogin: (data: { phone: string; code: string }) =>
    api.post("/v1/auth/login", data),

  changePassword: (data: { oldPassword: string; newPassword: string }) =>
    api.post("/v1/admin/change-password", data),

  getStats: () => api.get("/v1/admin/stats"),

  // Enterprise APIs
  getEnterprises: () => api.get("/v1/admin/enterprises"),

  createEnterprise: (data: {
    name: string;
    code: string;
    credit_pool?: number;
    logo?: string;
    app_name?: string;
    top_name?: string;
    about_name?: string;
    app_company_name?: string;
    login_desp?: string;
  }) => api.post("/v1/admin/enterprises", data),

  updateEnterprise: (
    id: number,
    data: {
      name: string;
      credit_pool?: number;
      logo?: string;
      app_name?: string;
      top_name?: string;
      about_name?: string;
      app_company_name?: string;
      login_desp?: string;
    },
  ) => api.put(`/v1/admin/enterprises/${id}`, data),

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
    api.get(`/v1/admin/invitation-codes/available`, {
      params: { enterprise_id: enterpriseId },
    }),

  setUserRole: (id: number, role: string) =>
    api.post(`/v1/admin/users/${id}/role`, { role }),

  adjustPoints: (
    id: number,
    data: { amount: number; reason?: string; operation: "add" | "subtract" },
  ) => api.post(`/v1/admin/users/${id}/points`, data),

  manageUser: (id: number, action: "enable" | "disable") =>
    api.post(`/v1/admin/users/${id}/manage`, { action }),

  syncUserQuota: (id: number) => api.post(`/v1/admin/members/${id}/sync-quota`),

  getUserLedger: (id: number, limit?: number) =>
    api.get(`/v1/admin/users/${id}/ledger`, { params: { limit } }),

  // Invitation Code APIs
  getInvitationCodes: (params?: {
    status?: number;
    enterprise_id?: number;
    page?: number;
    page_size?: number;
  }) => api.get("/v1/admin/invitation-codes", { params }),

  createInvitationCodes: (
    enterpriseId: number,
    count: number,
    initialQuotaUsd?: number | null,
  ) =>
    api.post("/v1/admin/invitation-codes", {
      enterprise_id: enterpriseId,
      count,
      initial_quota_usd: initialQuotaUsd,
    }),

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
  getRechargeStats: () => api.get("/v1/admin/recharge/stats"),

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

  // Sync pending orders
  syncPendingOrders: () => api.post("/v1/admin/recharge/sync"),

  syncOrderStatus: (orderNo: string) =>
    api.post(`/v1/admin/recharge/orders/${orderNo}/sync`),

  // Admin Recharge (后台给用户充值)
  adminRecharge: (
    userId: number,
    data: {
      points: number;
      reason: string;
      payment_reference?: string;
    },
  ) => api.post(`/v1/admin/users/${userId}/recharge`, data),

  // Sync user quota
  syncUserQuotaNew: (userId: number) =>
    api.post(`/v1/admin/users/${userId}/sync-quota`),

  // Get user recharge records
  getUserRecharges: (
    userId: number,
    params?: { page?: number; page_size?: number },
  ) => api.get(`/v1/admin/users/${userId}/recharges`, { params }),

  // Config Items APIs
  getConfigItems: (params?: {
    enterprise_name?: string;
    name?: string;
    status?: number;
    page?: number;
    page_size?: number;
  }) => api.get("/v1/admin/config-items", { params }),

  createConfigItem: (data: {
    name: string;
    description?: string;
    icon?: string;
    url_pattern?: string;
    scheme?: string;
    bearer_prefix?: string;
    visible_to_all?: number;
  }) => api.post("/v1/admin/config-items", data),

  getConfigItemDetail: (id: number) => api.get(`/v1/admin/config-items/${id}`),

  updateConfigItem: (
    id: number,
    data: {
      name?: string;
      description?: string;
      icon?: string;
      pinyin?: string;
      url_pattern?: string;
      scheme?: string;
      bearer_prefix?: string;
      visible_to_all?: number;
    },
  ) => api.put(`/v1/admin/config-items/${id}`, data),

  updateConfigItemStatus: (id: number, status: number) =>
    api.put(`/v1/admin/config-items/${id}/status`, { status }),

  getConfigEntries: (id: number) =>
    api.get(`/v1/admin/config-items/${id}/entries`),

  saveConfigEntries: (
    id: number,
    entries: {
      config_key: string;
      name: string;
      config_desc?: string;
      required?: number;
    }[],
  ) => api.put(`/v1/admin/config-items/${id}/entries`, { entries }),

  getConfigEnterprises: (
    id: number,
    params?: {
      enterprise_name?: string;
      enterprise_id?: number;
      page?: number;
      page_size?: number;
    },
  ) => api.get(`/v1/admin/config-items/${id}/enterprises`, { params }),

  addConfigEnterprise: (configItemId: number, enterpriseId: number) =>
    api.post(
      `/v1/admin/config-items/${configItemId}/enterprises/${enterpriseId}`,
    ),

  removeConfigEnterprise: (configItemId: number, enterpriseId: number) =>
    api.delete(
      `/v1/admin/config-items/${configItemId}/enterprises/${enterpriseId}`,
    ),

  // Upload config item icon
  uploadConfigItemIcon: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post("/v1/admin/upload/config-item-icon", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  // Upload enterprise logo
  uploadEnterpriseLogo: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post("/v1/admin/upload/enterprise-logo", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  // Skills APIs
  getSkillsByCursor: (params?: {
    cursor?: string;
    limit?: number;
    query?: string;
    categories?: string;
    tenant_id?: string;
  }) => api.get("/skills/cursor", { params }),

  approveSkill: (skillId: string) => api.post(`/skills/${skillId}/approve`),

  deleteSkill: (skillId: string) => api.delete(`/skills/${skillId}`),

  // Assistants APIs
  getAssistantsByCursor: (params?: {
    cursor?: string;
    limit?: number;
    query?: string;
    category?: string;
    tenant_id?: string;
  }) => api.get("/assistants/cursor", { params }),

  approveAssistant: (assistantId: string) =>
    api.post(`/assistants/${assistantId}/approve`),

  deleteAssistant: (assistantId: string) =>
    api.delete(`/assistants/${assistantId}`),

  // System Config APIs (登录方式可配置)
  getSystemConfig: () => api.get("/v1/system-config"),

  getAdminSystemConfig: () => api.get("/v1/admin/system-config"),

  updateSystemConfig: (data: {
    login_method?: number;
    third_party_auth?: {
      enabled: number;
      default_provider: string;
      providers: Array<{
        id: string;
        name: string;
        type: "cas";
        enabled: number;
        cas_url: string;
        login_path: string;
        validate_path: string;
        logout_path: string;
        logout_service_url: string;
        service_param: string;
        service_encode_mode: "component" | "raw";
        callback_mode: "direct_app" | "server_callback";
        server_callback_url: string;
        app_callback_url: string;
        enterprise_code: string;
        auto_provision: number;
      }>;
    };
    log_report?: {
      enabled: number;
      protocol?: string;
      domain?: string;
      key?: string;
    };
    version_update?: { enabled: number; cos_domain?: string };
    product_improvement?: {
      enabled: number;
      protocol?: string;
      domain?: string;
	    };
	    scode_auto_model?: string;
	    recharge_mode?: "pay" | "approve" | "disabled";
	    credit_application?: {
	      min_points?: number;
	      max_points?: number;
	      allow_duplicate_pending?: boolean;
	    };
	  }) => api.put("/v1/admin/system-config", data),

  // Password login user APIs (用户名密码登录方式)
  createPasswordUser: (data: {
    phone: string;
    nickname?: string;
    password?: string;
    enterprise_id: number;
    invitation_code_id?: number;
  }) => api.post("/v1/admin/users-password", data),

  updatePasswordUser: (
    id: number,
    data: {
      nickname?: string;
      password?: string;
      enterprise_id?: number;
      status?: number;
    },
  ) => api.put(`/v1/admin/users-password/${id}`, data),

  // Unified login dispatched by system login_method
  loginByConfig: (data: { phone: string; code?: string; password?: string }) =>
    api.post("/v1/auth/login-by-config", data),

  // ============================================
  // Dify integration (enterprise assistants + datasets + enhancement)
  // ============================================

  /**
   * Probe capability flags. Currently exposes `dify.enabled` so the SPA can
   * render "disabled" banners on assistant / dataset pages when the operator
   * hasn't filled in DIFY_* env vars on sudowork-server.
   */
  getFeatures: () => api.get("/v1/admin/features"),

  /**
   * List sudohub assistants in the (resolved) enterprise, annotated with
   * binding + ACL. SUPER_ADMIN must pass `enterprise_id`; ENTERPRISE_ADMIN
   * may omit it (auto-scoped to their own).
   */
  getEnterpriseAssistants: (params?: { enterprise_id?: number }) =>
    api.get("/v1/admin/dify/enterprise-assistants", { params }),

  /** List tenant options that can receive cross-tenant assistant sharing. */
  getShareableTenants: (params?: { enterprise_id?: number }) =>
    api.get("/v1/admin/dify/shareable-tenants", { params }),

  /** Load one enterprise assistant with editable metadata and prompt content. */
  getEnterpriseAssistant: (
    assistantId: string,
    params?: { enterprise_id?: number },
  ) => api.get(`/v1/admin/dify/enterprise-assistants/${assistantId}`, { params }),

  /** Get datasets visible to the (resolved) tenant. */
  getDifyDatasets: (params?: { enterprise_id?: number }) =>
    api.get("/v1/admin/dify/datasets", { params }),

  /**
   * Create an enterprise assistant (sudohub + optional Dify enhancement + ACL).
   * Multipart because sudohub wants the prompt.md and avatar as files. The
   * caller (form builder) must append `enterprise_id` as a form field when
   * acting as super admin.
   */
  createEnterpriseAssistant: (form: FormData) =>
    api.post("/v1/admin/dify/enterprise-assistants", form, {
      headers: { "Content-Type": "multipart/form-data" },
    }),

  /** Update an enterprise assistant's sudohub-owned base fields and bump package version. */
  updateEnterpriseAssistant: (assistantId: string, form: FormData) =>
    api.put(`/v1/admin/dify/enterprise-assistants/${assistantId}`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    }),

  /** Toggle Dify enhancement on an existing assistant. */
  setEnterpriseAssistantEnhancement: (
    assistantId: string,
    data: {
      enable: boolean;
      mode?: "agent-chat" | "workflow" | "rag-only";
      app_name?: string;
      enterprise_id?: number;
    },
  ) =>
    api.put(
      `/v1/admin/dify/enterprise-assistants/${assistantId}/enhancement`,
      data,
    ),

  getEnterpriseAssistantEnhancement: (
    assistantId: string,
    params?: { enterprise_id?: number },
  ) =>
    api.get(`/v1/admin/dify/enterprise-assistants/${assistantId}/enhancement`, {
      params,
    }),

  /** Replace the assistant's ACL entries. Empty list = enterprise-wide visible. */
  setAgentAcl: (
    assistantId: string,
    entries: Array<{
      subject_type: "user" | "all" | "department" | "role";
      subject_id?: string | null;
    }>,
    enterprise_id?: number,
  ) =>
    api.put(`/v1/admin/dify/agents/${assistantId}/acl`, {
      entries,
      enterprise_id,
    }),

  /** Read the assistant's current dataset bindings. */
  getAgentDatasets: (
    assistantId: string,
    params?: { enterprise_id?: number },
  ) => api.get(`/v1/admin/dify/agents/${assistantId}/datasets`, { params }),

  /** Replace the assistant's dataset bindings. */
  setAgentDatasets: (
    assistantId: string,
    datasetIds: string[],
    enterprise_id?: number,
  ) =>
    api.put(`/v1/admin/dify/agents/${assistantId}/datasets`, {
      dataset_ids: datasetIds,
      enterprise_id,
    }),

  /** Delete an enterprise assistant (cascades sudohub + Dify App + local rows). */
  deleteEnterpriseAssistant: (
    assistantId: string,
    params?: { enterprise_id?: number },
  ) => api.delete(`/v1/admin/dify/agents/${assistantId}`, { params }),

  /** Get an SSO link to Dify Studio. */
  getDifyStudioLink: (next?: string, enterprise_id?: number) =>
    api.get("/v1/admin/dify/sso", { params: { next, enterprise_id } }),

  // ==========================================================================
  // P3 RAG 挂载: knowledge base (dataset) management. Proxies to Dify Service
  // API via the sudowork-server admin layer. See 2026-06-17 design doc P3.
  // ==========================================================================

  /** Page-list datasets in the (resolved) enterprise's Dify tenant. */
  listDatasetsAdmin: (params: {
    enterprise_id?: number;
    page?: number;
    limit?: number;
    keyword?: string;
  }) => api.get("/v1/admin/datasets", { params }),

  /** Create a new dataset (knowledge base). */
  createDataset: (data: {
    enterprise_id?: number;
    name: string;
    description?: string;
    indexing_technique?: "high_quality" | "economy";
    permission?: "only_me" | "all_team_members" | "partial_members";
  }) => api.post("/v1/admin/datasets", data),

  /** Get a single dataset's full detail (counts, embedding model, etc.). */
  getDataset: (datasetId: string, params?: { enterprise_id?: number }) =>
    api.get(`/v1/admin/datasets/${datasetId}`, { params }),

  /** Rename / re-describe / change visibility of a dataset. */
  updateDataset: (
    datasetId: string,
    data: {
      enterprise_id?: number;
      name?: string;
      description?: string;
      permission?: "only_me" | "all_team_members" | "partial_members";
    },
  ) => api.patch(`/v1/admin/datasets/${datasetId}`, data),

  /** Permanently delete a dataset (drops vectors + docs). */
  deleteDataset: (datasetId: string, params?: { enterprise_id?: number }) =>
    api.delete(`/v1/admin/datasets/${datasetId}`, { params }),

  /** Page-list documents inside a dataset. */
  listDatasetDocuments: (
    datasetId: string,
    params: {
      enterprise_id?: number;
      page?: number;
      limit?: number;
      keyword?: string;
    },
  ) => api.get(`/v1/admin/datasets/${datasetId}/documents`, { params }),

  /** Create a text-only document (no file upload). */
  createDatasetDocumentByText: (
    datasetId: string,
    data: {
      enterprise_id?: number;
      name: string;
      text: string;
      indexing_technique?: "high_quality" | "economy";
    },
  ) => api.post(`/v1/admin/datasets/${datasetId}/documents`, data),

  /**
   * Upload a document file (.txt/.md/.pdf/.docx/.csv/etc.). The caller must
   * provide a FormData with `file` (and optionally `enterprise_id`,
   * `indexing_technique`).
   */
  createDatasetDocumentByFile: (datasetId: string, form: FormData) =>
    api.post(`/v1/admin/datasets/${datasetId}/documents`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    }),

  /** Delete a single document from a dataset. */
  deleteDatasetDocument: (
    datasetId: string,
    documentId: string,
    params?: { enterprise_id?: number },
  ) =>
    api.delete(`/v1/admin/datasets/${datasetId}/documents/${documentId}`, {
      params,
    }),

  /** Run a test query (hit-testing) against a dataset. */
  retrieveDataset: (
    datasetId: string,
    data: {
      enterprise_id?: number;
      query: string;
      retrieval_model?: Record<string, unknown>;
    },
  ) => api.post(`/v1/admin/datasets/${datasetId}/retrieve`, data),
};
