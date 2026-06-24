import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Card,
  Input,
  Button,
  Space,
  message,
  Tag,
  Typography,
  Empty,
  Select,
  Form,
  Table,
  Modal,
  Descriptions,
  Upload,
  Drawer,
  Divider,
  Radio,
  Tooltip,
} from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import type { ColumnsType } from "antd/es/table";
import {
  SearchOutlined,
  LoadingOutlined,
  DownloadOutlined,
  LinkOutlined,
  PlusOutlined,
  SettingOutlined,
  UploadOutlined,
  ProfileOutlined,
  EyeOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import { adminApi } from "../api";

/** Display labels for Dify enhancement modes (2026-06-22 P2.5.1: rag-only retired). */
const ENH_MODE_LABEL: Record<"agent-chat" | "workflow", string> = {
  "agent-chat": "Agent (完整工具体系)",
  workflow: "工作流 (固定流程)",
};

/**
 * prompt.md templates. `{{name}}` / `{{profession}}` / `{{description}}` get
 * substituted with the form's current values when the admin clicks a template
 * button. We deliberately keep these short — they're skeletons, not finished
 * persona definitions. The four flavors map 1:1 to "no enhancement / rag-only /
 * workflow / agent-chat" so the admin gets a coherent starting point per mode.
 */
const PROMPT_TEMPLATES: Record<"basic" | "rag" | "workflow" | "agent", { label: string; body: string }> = {
  basic: {
    label: "基础模板",
    body: `# 你是 {{name}}，一位 {{profession}}。

## 角色定位
{{description}}

## 工作原则
- 用专业、简洁的语言与用户沟通
- 优先调用可用的本地技能完成任务
- 遇到不确定的问题主动澄清，不要编造信息

## 输出风格
- 关键结论放在最前面
- 必要时给出步骤化的执行建议
`,
  },
  rag: {
    label: "RAG 模板",
    body: `# 你是 {{name}}，一位 {{profession}}。

{{description}}

## 工作方式
- 当收到 <knowledge_context> 标签包裹的内容时，把它作为权威背景知识
- 整合知识内容到回答中，必要时直接引用，并注明来源
- 没有 <knowledge_context> 时按你自身的常识回答，并提示"以下来自模型常识"
- 优先调用本地技能（文件操作、代码生成、网页等）完成具体任务

## 输出风格
- 先给结论再展开
- 引用知识库内容时清晰区分"知识库" vs "模型常识"
`,
  },
  workflow: {
    label: "Workflow 模板",
    body: `# 你是 {{name}}，一位 {{profession}}。

{{description}}

## 工作方式
- 复杂任务上游会有 Dify 工作流先行处理，结果通过 <knowledge_context> 注入
- <knowledge_context> 里通常是结构化的中间产物（分析结果、文档摘要、字段提取等）
- 你的职责是把这些结果用自然语言整理给用户，并配合本地技能完成最终落地

## 输出风格
- 把工作流结果转译成易读的回答
- 不重复执行工作流已经完成的步骤
`,
  },
  agent: {
    label: "Agent 模板",
    body: `# 你是 {{name}}，一位 {{profession}}。

{{description}}

## 协作机制
- 你身后还有一位 Dify 子智能体在做信息搜集与外部检索
- 它的输出通过 <knowledge_context> 提前注入；当存在时优先采信
- 本地技能与子智能体输出冲突时：执行类以本地为先，事实类以子智能体为先

## 工作原则
- 先用 <knowledge_context> 补强答案，再决定是否调用本地技能
- 多轮对话中保持身份一致
`,
  },
};

function renderPromptTemplate(
  key: keyof typeof PROMPT_TEMPLATES,
  vars: { name?: string; profession?: string; description?: string },
): string {
  return PROMPT_TEMPLATES[key].body
    .replaceAll("{{name}}", vars.name?.trim() || "<助手名称>")
    .replaceAll("{{profession}}", vars.profession?.trim() || "<职业/角色>")
    .replaceAll("{{description}}", vars.description?.trim() || "");
}

/**
 * Visual section header used inside the create modal / edit drawer.
 * Icon + colored label + divider gives an admin a quick scannable hierarchy
 * across "基础信息 / 可见范围 / 知识增强" — much more obvious than a plain
 * Divider of identical weight.
 */
function SectionTitle(props: {
  icon: React.ReactNode;
  text: string;
  /** brand accent color for the icon + text (kept subtle to avoid noise) */
  color?: string;
}): React.JSX.Element {
  const c = props.color ?? "var(--ant-color-primary, #1677ff)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        margin: "18px 0 12px 0",
        fontSize: 14,
        fontWeight: 600,
        color: c,
      }}
    >
      <span style={{ fontSize: 16, display: "inline-flex" }}>{props.icon}</span>
      <span>{props.text}</span>
      <div
        style={{
          flex: 1,
          height: 1,
          marginLeft: 8,
          background: "var(--ant-color-split, #f0f0f0)",
        }}
      />
    </div>
  );
}

/**
 * Shown beneath the `agent-chat` mode selector to address an UX confusion:
 * admins expect the prompt.md they wrote to also drive the Dify Agent, but the
 * two prompts live in different processes (local ACP vs. Dify sub-agent) and
 * are independent. See "TODO-1" in 2026-06-17-dify-integration-design.md.
 */
const AGENT_CHAT_PROMPT_NOTICE = (
  <div
    style={{
      padding: "8px 12px",
      borderRadius: 6,
      background: "var(--ant-color-warning-bg, #fff7e6)",
      border: "1px solid var(--ant-color-warning-border, #ffe7ba)",
      fontSize: 12,
      lineHeight: 1.6,
      color: "var(--ant-color-text-secondary, #595959)",
      marginTop: -4,
      marginBottom: 8,
    }}
  >
    <div style={{ fontWeight: 600, color: "var(--ant-color-warning, #d48806)", marginBottom: 4 }}>
      Agent 模式提示
    </div>
    上方填写的「提示词 (.md)」是<b>本地助手主大脑</b>的人格与对话指令。点击「Dify Studio」跳转后看到的「提示词」框是<b>Dify 子大脑（检索代理）</b>的指令，与 .md 内容相互独立、各自约束不同的 LLM 调用——
    <b>不冲突，但也不会自动同步</b>。子大脑提示词留空时 Dify 会用默认人格回答，建议在 Dify Studio 中明确写出"作为
    XXX 助手的知识检索代理，输出简洁可引用的事实片段"等指令。
  </div>
);

/** Server returns this annotated row for each sudohub assistant. */
interface EnhancementInfo {
  enabled: boolean;
  mode?: "agent-chat" | "workflow";
  dify_app_id?: string;
}
interface AclSummary {
  scope: "all" | "specific";
  user_ids: string[];
}
interface EnterpriseAssistantMetaRow {
  assistant_id: string;
  enhancement: EnhancementInfo;
  /** 纯知识库路径关联的 dataset ids（互斥于 enhancement.enabled）。 */
  dataset_ids?: string[];
  acl_summary: AclSummary;
}

const { Title, Text } = Typography;
const { Search } = Input;
const { Option } = Select;

type AssetType = "skills" | "assistants";

interface SkillVersion {
  changelog: string | null;
  checksum: string;
  created_at: string;
  source_url: string;
  version: string;
}

interface Skill {
  id: string;
  name: string;
  display_name: string;
  description: string;
  category: string | null;
  categories: string[];
  core_features: string;
  applicable_scenarios: string;
  emoji: string | null;
  homepage: string | null;
  sort_order: number;
  icon: string | null;
  author_id: string;
  created_at: string;
  updated_at: string;
  status: number;
  tenant_id: string | null;
  latestVersion?: SkillVersion | null;
}

interface Assistant {
  id: string;
  name: string;
  profession: string;
  description: string;
  avatar: string | null;
  categories: string[];
  defaultInitPrompt: string | null;
  promptFile: string | null;
  sourceUrl: string;
  skills: string[];
  sortOrder: number;
  status: number;
  tenantId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Enterprise {
  id: number;
  name: string;
  code: string;
}

interface SkillsListProps {
  assetType: AssetType;
}

const SkillsList: React.FC<SkillsListProps> = ({ assetType }) => {
  const [loading, setLoading] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [approvingSkillId, setApprovingSkillId] = useState<string | null>(null);
  const [approvingAssistantId, setApprovingAssistantId] = useState<string | null>(null);
  const [deletingSkillId, setDeletingSkillId] = useState<string | null>(null);
  const [deletingAssistantId, setDeletingAssistantId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEnterprise, setSelectedEnterprise] = useState<string | number | null>(null);
  const [detailRecord, setDetailRecord] = useState<Skill | Assistant | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [filterForm] = Form.useForm();

  // Dify-enhancement annotations for the assistants tab. Loaded once per
  // tenant change so each list page costs at most one extra request. Keyed
  // by sudohub assistant_id so the columns can short-circuit on lookup.
  const [enhancementMap, setEnhancementMap] = useState<Record<string, EnhancementInfo>>({});
  const [aclMap, setAclMap] = useState<Record<string, AclSummary>>({});
  // 2026-06-22 P2.5.1: per-assistant dataset attachment (mutually exclusive
  // with enhancement). Drives the new "知识增强" Radio in the create modal /
  // edit drawer and the list column.
  const [datasetMap, setDatasetMap] = useState<Record<string, string[]>>({});
  // Bump this counter from any post-mutation handler (saveDrawer, create,
  // delete...) to force the annotation useEffect to re-fetch enhancement /
  // dataset / ACL maps. Without this, `resetAndLoadData()` only refreshes the
  // sudohub assistant list — the annotation columns ("知识增强", "可见范围")
  // would keep showing pre-edit values, making the save look like a no-op.
  const [annotationsTick, setAnnotationsTick] = useState(0);

  // -- Create modal state (Phase 3 port) --
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [promptFile, setPromptFile] = useState<UploadFile | null>(null);
  const [avatarFile, setAvatarFile] = useState<UploadFile | null>(null);
  // Prompt editor: inline-edit (default) mirrors the client-side AssistantEditDrawer
  // (Edit / Preview tabs over a single Markdown TextArea). Upload remains a fallback
  // for admins who already have a curated .md file.
  const [promptInputMode, setPromptInputMode] = useState<"inline" | "upload">("inline");
  const [promptText, setPromptText] = useState<string>("");
  const [promptViewMode, setPromptViewMode] = useState<"edit" | "preview">("edit");
  const [creating, setCreating] = useState(false);

  // -- Edit drawer state (Phase 3 port) --
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<Assistant | null>(null);
  const [drawerForm] = Form.useForm();
  const [savingDrawer, setSavingDrawer] = useState(false);
  // Drawer/modal use destroyOnClose so the Form remounts on every open. That
  // means setFieldsValue called BEFORE setOpen(true) writes to a still-empty
  // form and gets dropped. Instead we snapshot the initial values into state
  // and pass them via Form's `initialValues` prop, which the freshly-mounted
  // form reads on registration.
  const [drawerInitialValues, setDrawerInitialValues] = useState<Record<string, unknown>>({});

  // -- Picker data (users for ACL + datasets for binding) --
  const [users, setUsers] = useState<Array<{ id: number; phone: string; nickname: string }>>([]);
  const [datasets, setDatasets] = useState<Array<{ id: string; name: string }>>([]);

  const userStr = localStorage.getItem("admin_user");
  let currentUser: any = {};
  try {
    currentUser = userStr ? JSON.parse(userStr) : {};
  } catch {
    currentUser = {};
  }

  const isSuperAdmin = currentUser.role === "SUPER_ADMIN";
  const currentTenantId = currentUser.enterprise_code || currentUser.tenant_id;
  const isSkillsPage = assetType === "skills";
  const pageTitle = isSkillsPage ? "专属技能" : "专属助手";

  /**
   * Server endpoints under `/admin/dify/*` use the numeric enterprise id, not
   * the sudohub tenant code. Super admin selects a tenant code from the
   * dropdown; we look up the matching numeric id from the cached enterprise
   * list. Enterprise admin reuses their JWT enterprise_id (already exposed
   * via the login response's `user.enterprise_id`).
   */
  const selectedEnterpriseId = useMemo<number | undefined>(() => {
    if (isSuperAdmin) {
      if (!selectedEnterprise) return undefined;
      const match = enterprises.find((e) => e.code === selectedEnterprise);
      return match?.id;
    }
    return (currentUser.enterprise_id as number | undefined) ?? undefined;
  }, [isSuperAdmin, selectedEnterprise, enterprises, currentUser.enterprise_id]);

  const isCursorResponseSuccess = (response: any) =>
    response?.success === true || response?.status === "success";

  useEffect(() => {
    if (isSuperAdmin) {
      void loadEnterprises();
    } else if (currentTenantId) {
      setSelectedEnterprise(currentTenantId as any);
    }
  }, []);

  useEffect(() => {
    if (selectedEnterprise || currentTenantId) {
      resetAndLoadData();
    }
  }, [selectedEnterprise, assetType, currentTenantId]);

  // Fetch Dify enhancement + ACL annotations whenever the resolved enterprise
  // changes. Skills tab skips this — annotations are assistants-only. We use
  // `selectedEnterpriseId` (numeric, server contract) rather than the tenant
  // code, and a failure here just leaves both maps empty so the columns
  // degrade to "未启用 / 企业全员" without blocking the list.
  useEffect(() => {
    if (isSkillsPage) return;
    if (!selectedEnterpriseId) {
      setEnhancementMap({});
      setAclMap({});
      setDatasetMap({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = (await adminApi.getEnterpriseAssistants({
          enterprise_id: selectedEnterpriseId,
        })) as any;
        if (cancelled) return;
        if (!resp?.success || !Array.isArray(resp.data)) {
          setEnhancementMap({});
          setAclMap({});
          setDatasetMap({});
          return;
        }
        const eMap: Record<string, EnhancementInfo> = {};
        const aMap: Record<string, AclSummary> = {};
        const dMap: Record<string, string[]> = {};
        for (const row of resp.data as EnterpriseAssistantMetaRow[]) {
          if (!row?.assistant_id) continue;
          eMap[row.assistant_id] = row.enhancement;
          aMap[row.assistant_id] = row.acl_summary;
          dMap[row.assistant_id] = row.dataset_ids ?? [];
        }
        setEnhancementMap(eMap);
        setAclMap(aMap);
        setDatasetMap(dMap);
      } catch (err) {
        console.warn("Failed to load enhancement/ACL annotations:", err);
        if (!cancelled) {
          setEnhancementMap({});
          setAclMap({});
          setDatasetMap({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSkillsPage, selectedEnterpriseId, assetType, annotationsTick]);

  // Load users (for the ACL "specific users" picker). One pass per tenant
  // change. Failure here is non-fatal — admin can still pick "全员可见".
  useEffect(() => {
    if (isSkillsPage) return;
    if (!selectedEnterpriseId) {
      setUsers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = (await adminApi.getUsers({ enterprise_id: selectedEnterpriseId })) as any;
        if (cancelled) return;
        if (resp?.success) {
          // adminApi.getUsers shape may be { data: User[] } or { data: { list: [] }}
          const list = Array.isArray(resp.data) ? resp.data : resp.data?.list ?? [];
          setUsers(list);
        }
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSkillsPage, selectedEnterpriseId]);

  // Load Dify datasets for the binding picker. Same lifecycle as users.
  useEffect(() => {
    if (isSkillsPage) return;
    if (!selectedEnterpriseId) {
      setDatasets([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = (await adminApi.getDifyDatasets({
          enterprise_id: selectedEnterpriseId,
        })) as any;
        if (cancelled) return;
        if (resp?.success && Array.isArray(resp.data)) {
          setDatasets(resp.data);
        }
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSkillsPage, selectedEnterpriseId]);

  const userOptions = useMemo(
    () =>
      users.map((u) => ({
        label: `${u.nickname || u.phone} (${u.phone})`,
        value: String(u.id),
      })),
    [users],
  );

  const loadEnterprises = async () => {
    try {
      const response = await adminApi.getEnterprises();
      if ((response as any).success) {
        setEnterprises((response as any).data);
      }
    } catch (error) {
      console.error("Failed to load enterprises:", error);
    }
  };

  const getTenantId = () =>
    (isSuperAdmin ? selectedEnterprise : currentTenantId) as string | null;

  const resetAndLoadData = (query: string = searchQuery) => {
    if (isSkillsPage) {
      setSkills([]);
    } else {
      setAssistants([]);
    }
    setNextCursor(null);
    setHasMore(true);
    void loadData(null, query);
  };

  const loadSkills = useCallback(
    async (cursor: string | null = null, query: string = "") => {
      const tenantId = getTenantId();
      if (!tenantId) return;

      setLoading(true);
      try {
        const params: any = { limit: 20, tenant_id: tenantId };
        if (cursor) params.cursor = cursor;
        if (query) params.query = query;

        const response = await adminApi.getSkillsByCursor(params);
        if (isCursorResponseSuccess(response)) {
          const data = (response as any).data;
          const newSkills = (data.skills || []) as Skill[];
          setSkills((prev) => (cursor ? [...prev, ...newSkills] : newSkills));
          setNextCursor(data.next_cursor);
          setHasMore(data.has_more);
        } else {
          message.error((response as any).message || "加载技能列表失败");
        }
      } catch (error: any) {
        message.error(error?.response?.data?.message || error?.message || "加载技能列表失败，请刷新重试");
      } finally {
        setLoading(false);
      }
    },
    [selectedEnterprise, currentTenantId, isSuperAdmin]
  );

  const loadAssistants = useCallback(
    async (cursor: string | null = null, query: string = "") => {
      const tenantId = getTenantId();
      if (!tenantId) return;

      setLoading(true);
      try {
        const params: any = { limit: 20, tenant_id: tenantId };
        if (cursor) params.cursor = cursor;
        if (query) params.query = query;

        const response = await adminApi.getAssistantsByCursor(params);
        if (isCursorResponseSuccess(response)) {
          const data = (response as any).data;
          const newAssistants = (data.assistants || []) as Assistant[];
          setAssistants((prev) => (cursor ? [...prev, ...newAssistants] : newAssistants));
          setNextCursor(data.next_cursor);
          setHasMore(data.has_more);
        } else {
          message.error((response as any).message || "加载助手列表失败");
        }
      } catch (error: any) {
        message.error(error?.response?.data?.message || error?.message || "加载助手列表失败，请刷新重试");
      } finally {
        setLoading(false);
      }
    },
    [selectedEnterprise, currentTenantId, isSuperAdmin]
  );

  const loadData = useCallback(
    async (cursor: string | null = null, query: string = "") => {
      if (isSkillsPage) {
        await loadSkills(cursor, query);
      } else {
        await loadAssistants(cursor, query);
      }
    },
    [isSkillsPage, loadSkills, loadAssistants]
  );

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    resetAndLoadData(value);
  };

  const loadMore = () => {
    if (hasMore && !loading && nextCursor) {
      void loadData(nextCursor, searchQuery);
    }
  };

  const handleEnterpriseChange = (value: string) => {
    setSelectedEnterprise(value);
  };

  const openExternalUrl = (url?: string | null) => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const isActionSuccess = (response: any) =>
    response?.success === true || response?.status === "success";

  const triggerDownload = (url?: string | null, filename?: string) => {
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    if (filename) link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const openDetail = (record: Skill | Assistant) => {
    setDetailRecord(record);
    setDetailOpen(true);
  };

  // ----- Create modal (Phase 3) -----

  const openCreateModal = () => {
    createForm.resetFields();
    setPromptFile(null);
    setAvatarFile(null);
    setPromptInputMode("inline");
    setPromptText("");
    setPromptViewMode("edit");
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!selectedEnterpriseId) {
      message.error("请先选择企业");
      return;
    }
    const values = await createForm.validateFields();
    // Resolve the prompt source. Inline-edit synthesizes a .md File on the fly
    // so the server-side contract (multipart `prompt_file`) stays unchanged.
    let promptFileToSend: File | undefined;
    if (promptInputMode === "inline") {
      if (!promptText.trim()) {
        message.error("请填写提示词内容");
        return;
      }
      const blob = new Blob([promptText], { type: "text/markdown" });
      const baseName =
        (typeof values.name === "string" && values.name.trim()) || "prompt";
      promptFileToSend = new File([blob], `${baseName}.md`, { type: "text/markdown" });
    } else {
      if (!promptFile?.originFileObj) {
        message.error("请上传提示词文件 (.md)");
        return;
      }
      promptFileToSend = promptFile.originFileObj as File;
    }
    setCreating(true);
    try {
      const form = new FormData();
      // Super admin must explicitly specify enterprise; enterprise admin can
      // also pass it (server validates it matches their JWT).
      form.append("enterprise_id", String(selectedEnterpriseId));
      form.append("name", values.name);
      form.append("profession", values.profession);
      if (values.description) form.append("description", values.description);
      if (values.default_init_prompt)
        form.append("default_init_prompt", values.default_init_prompt);
      if (values.categories) form.append("categories", JSON.stringify(values.categories));
      if (values.skills) form.append("skills", JSON.stringify(values.skills));
      const aclEntries =
        values.acl_scope === "specific"
          ? (values.acl_user_ids || []).map((id: string) => ({
              subjectType: "user",
              subjectId: id,
            }))
          : [];
      form.append("acl_entries", JSON.stringify(aclEntries));
      // 2026-06-22 P2.5.1: knowledge_mode is the single source of truth for
      // the two-dimensional knowledge attachment model. The radio's three
      // states are mutually exclusive; we split into the legacy multipart
      // fields here so the server contract stays the same.
      const knowledgeMode: "none" | "datasets" | "enhancement" =
        values.knowledge_mode || "none";
      if (knowledgeMode === "enhancement") {
        form.append("enable_enhancement", "true");
        // Defensive default — the mode field is conditionally rendered, so
        // even with initialValue="agent-chat" the form value may be
        // undefined if the user enabled the toggle and submitted within the
        // same React tick.
        form.append("enhancement_mode", values.enhancement_mode || "agent-chat");
      } else if (knowledgeMode === "datasets") {
        const datasetIds = Array.isArray(values.dataset_ids) ? values.dataset_ids : [];
        form.append("dataset_ids", JSON.stringify(datasetIds));
      }
      form.append("prompt_file", promptFileToSend, promptFileToSend.name);
      if (avatarFile?.originFileObj) {
        form.append("avatar", avatarFile.originFileObj as File, avatarFile.name);
      }

      const res: any = await adminApi.createEnterpriseAssistant(form);
      if (res?.success) {
        message.success("创建成功");
        setCreateOpen(false);
        resetAndLoadData();
        setAnnotationsTick((t) => t + 1);
      } else {
        message.error(res?.msg || "创建失败");
      }
    } catch (err: any) {
      message.error(err?.message || "创建失败");
    } finally {
      setCreating(false);
    }
  };

  // ----- Edit drawer (Phase 3) -----

  const openEditDrawer = async (record: Assistant) => {
    if (!selectedEnterpriseId) {
      message.error("请先选择企业");
      return;
    }
    const enh = enhancementMap[record.id];
    const acl = aclMap[record.id];
    const initialDatasets = datasetMap[record.id] ?? [];
    const initialKnowledgeMode: "none" | "datasets" | "enhancement" = enh?.enabled
      ? "enhancement"
      : initialDatasets.length > 0
        ? "datasets"
        : "none";
    setDrawerInitialValues({
      knowledge_mode: initialKnowledgeMode,
      enhancement_mode: enh?.mode || "agent-chat",
      acl_scope: acl?.scope || "all",
      acl_user_ids: acl?.user_ids || [],
      dataset_ids: initialDatasets,
    });
    setEditingRow(record);
    setDrawerOpen(true);
  };

  const saveDrawer = async () => {
    if (!editingRow || !selectedEnterpriseId) return;
    const values = await drawerForm.validateFields();
    setSavingDrawer(true);
    try {
      // 2026-06-22 P2.5.1: knowledge_mode drives both enhancement and dataset
      // attachment as mutually-exclusive branches. The server also enforces
      // mutex but we have to apply the changes in the right order to avoid
      // a transient conflicting state (e.g., enabling enhancement while
      // datasets are still attached → server rejects).
      const prevEnh = enhancementMap[editingRow.id];
      const prevDatasets = datasetMap[editingRow.id] ?? [];
      const prevMode: "none" | "datasets" | "enhancement" = prevEnh?.enabled
        ? "enhancement"
        : prevDatasets.length > 0
          ? "datasets"
          : "none";
      const nextMode: "none" | "datasets" | "enhancement" =
        values.knowledge_mode || "none";

      // Step A: tear down the side that's switching off. This must happen
      // before we set up the new side so the server's mutex check passes.
      if (prevMode === "enhancement" && nextMode !== "enhancement") {
        await adminApi.setEnterpriseAssistantEnhancement(editingRow.id, {
          enable: false,
          enterprise_id: selectedEnterpriseId,
        });
      }
      if (prevMode === "datasets" && nextMode !== "datasets") {
        await adminApi.setAgentDatasets(editingRow.id, [], selectedEnterpriseId);
      }

      // Step B: set up the new side.
      if (nextMode === "enhancement") {
        const modeChanged = prevEnh?.mode !== values.enhancement_mode;
        if (prevMode !== "enhancement" || modeChanged) {
          await adminApi.setEnterpriseAssistantEnhancement(editingRow.id, {
            enable: true,
            mode: values.enhancement_mode,
            enterprise_id: selectedEnterpriseId,
          });
        }
      } else if (nextMode === "datasets") {
        const desired: string[] = Array.isArray(values.dataset_ids)
          ? values.dataset_ids
          : [];
        const changed =
          desired.length !== prevDatasets.length ||
          desired.some((id, idx) => prevDatasets[idx] !== id);
        if (prevMode !== "datasets" || changed) {
          await adminApi.setAgentDatasets(editingRow.id, desired, selectedEnterpriseId);
        }
      }

      // Step C: ACL (independent of knowledge dimension).
      const aclEntries =
        values.acl_scope === "specific"
          ? (values.acl_user_ids || []).map((id: string) => ({
              subject_type: "user" as const,
              subject_id: id,
            }))
          : [];
      await adminApi.setAgentAcl(editingRow.id, aclEntries, selectedEnterpriseId);

      message.success("已保存");
      setDrawerOpen(false);
      resetAndLoadData();
      // Force the annotation maps (enhancement / dataset / ACL) to re-fetch,
      // otherwise the table columns keep the pre-save snapshot and the admin
      // can't tell the save took effect.
      setAnnotationsTick((t) => t + 1);
    } catch (err: any) {
      message.error(err?.message || "保存失败");
    } finally {
      setSavingDrawer(false);
    }
  };

  /**
   * Open the Dify Studio configuration page for a given assistant via SSO.
   *
   * We can't just `window.open('/api/v1/admin/dify/sso?...')` directly: that
   * lands the browser at sudowork-server WITHOUT the Authorization header
   * (only set by axios on XHR calls) and the auth middleware rejects it.
   *
   * Instead, ask the backend for the signed SSO URL via axios (which carries
   * the Bearer token), then open the resulting URL in a new tab. The URL
   * itself is a Dify endpoint that carries a one-shot HMAC JWT, so it does
   * not need any session for the cross-domain hop.
   */
  const openInStudio = async (record: Assistant) => {
    const enh = enhancementMap[record.id];
    if (!enh?.enabled || !enh.dify_app_id) {
      message.info("该助手未启用 Dify 增强");
      return;
    }
    const next = `/app/${enh.dify_app_id}/configuration`;
    try {
      const res: any = await adminApi.getDifyStudioLink(next, selectedEnterpriseId);
      const url = res?.data?.url;
      if (!res?.success || !url) {
        message.error(res?.msg || "无法获取 SSO 链接");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      message.error(err?.response?.data?.msg || err?.message || "跳转失败");
    }
  };

  const handleApproveSkill = (record: Skill) => {
    Modal.confirm({
      title: "确认审批上线",
      content: `确定将技能“${record.display_name || record.name}”从审核中改为已上线吗？`,
      okText: "确认上线",
      cancelText: "取消",
      onOk: async () => {
        setApprovingSkillId(record.id);
        try {
          const response = await adminApi.approveSkill(record.id);
          if (isActionSuccess(response)) {
            message.success((response as any).msg || (response as any).message || "审批上线成功");
            if (detailRecord && "id" in detailRecord && detailRecord.id === record.id) {
              setDetailRecord({ ...record, status: 1 });
            }
            resetAndLoadData();
          } else {
            message.error((response as any).msg || (response as any).message || "审批上线失败");
          }
        } catch (error: any) {
          message.error(error?.response?.data?.msg || error?.response?.data?.message || error?.message || "审批上线失败");
        } finally {
          setApprovingSkillId(null);
        }
      },
    });
  };

  const handleDeleteSkill = (record: Skill) => {
    Modal.confirm({
      title: "确认删除技能",
      content: `确定删除技能“${record.display_name || record.name}”吗？删除后不可恢复。`,
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        setDeletingSkillId(record.id);
        try {
          const response = await adminApi.deleteSkill(record.id);
          if (isActionSuccess(response)) {
            message.success((response as any).msg || (response as any).message || "删除成功");
            if (detailRecord && "id" in detailRecord && detailRecord.id === record.id) {
              closeDetail();
            }
            resetAndLoadData();
          } else {
            message.error((response as any).msg || (response as any).message || "删除失败");
          }
        } catch (error: any) {
          message.error(error?.response?.data?.msg || error?.response?.data?.message || error?.message || "删除失败");
        } finally {
          setDeletingSkillId(null);
        }
      },
    });
  };

  const handleApproveAssistant = (record: Assistant) => {
    Modal.confirm({
      title: "确认审批发布",
      content: `确定将助手“${record.name}”从审核中改为已发布吗？`,
      okText: "确认发布",
      cancelText: "取消",
      onOk: async () => {
        setApprovingAssistantId(record.id);
        try {
          const response = await adminApi.approveAssistant(record.id);
          if (isActionSuccess(response)) {
            message.success((response as any).msg || (response as any).message || "审批发布成功");
            if (detailRecord && "id" in detailRecord && detailRecord.id === record.id) {
              setDetailRecord({ ...record, status: 1 });
            }
            resetAndLoadData();
          } else {
            message.error((response as any).msg || (response as any).message || "审批发布失败");
          }
        } catch (error: any) {
          message.error(error?.response?.data?.msg || error?.response?.data?.message || error?.message || "审批发布失败");
        } finally {
          setApprovingAssistantId(null);
        }
      },
    });
  };

  const handleDeleteAssistant = (record: Assistant) => {
    Modal.confirm({
      title: "确认删除助手",
      content: `确定删除助手“${record.name}”吗？删除后不可恢复。`,
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        setDeletingAssistantId(record.id);
        try {
          const response = await adminApi.deleteAssistant(record.id);
          if (isActionSuccess(response)) {
            message.success((response as any).msg || (response as any).message || "删除成功");
            if (detailRecord && "id" in detailRecord && detailRecord.id === record.id) {
              closeDetail();
            }
            resetAndLoadData();
          } else {
            message.error((response as any).msg || (response as any).message || "删除失败");
          }
        } catch (error: any) {
          message.error(error?.response?.data?.msg || error?.response?.data?.message || error?.message || "删除失败");
        } finally {
          setDeletingAssistantId(null);
        }
      },
    });
  };

  const closeDetail = () => {
    setDetailOpen(false);
    setDetailRecord(null);
  };

  const formatValue = (value?: string | number | boolean | null) => {
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "boolean") return value ? "是" : "否";
    return String(value);
  };

  const getStatusLabel = (status: number) => {
    if (status === 1) {
      return isSkillsPage ? "已上线" : "已发布";
    }
    return "审核中";
  };

  const getStatusColor = (status: number) => (status === 1 ? "green" : "orange");

  const parseStructuredText = (value?: string | null) => {
    if (!value) return "-";
    try {
      const parsed = JSON.parse(value);
      return (
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {JSON.stringify(parsed, null, 2)}
        </pre>
      );
    } catch {
      return <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{value}</div>;
    }
  };

  const skillColumns: ColumnsType<Skill> = [
    {
      title: "名称",
      dataIndex: "display_name",
      key: "display_name",
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{record.display_name || record.name}</Text>
          <Text type="secondary">{record.name}</Text>
        </Space>
      ),
    },
    {
      title: "版本",
      key: "version",
      width: 120,
      render: (_, record) => record.latestVersion?.version || "-",
    },
    {
      title: "分类",
      key: "category",
      render: (_, record) =>
        record.categories?.length ? (
          <Space wrap>
            {record.categories.map((item) => (
              <Tag key={item}>{item}</Tag>
            ))}
          </Space>
        ) : (
          record.category || "-"
        ),
    },
    {
      title: "状态",
      key: "status",
      width: 120,
      render: (_, record) => <Tag color={getStatusColor(record.status)}>{getStatusLabel(record.status)}</Tag>,
    },
    {
      title: "更新时间",
      dataIndex: "updated_at",
      key: "updated_at",
      width: 200,
    },
    {
      title: "操作",
      key: "actions",
      width: 300,
      render: (_, record) => (
        <Space>
          <Button type="link" onClick={() => openDetail(record)}>
            查看详情
          </Button>
          {record.status !== 1 && (
            <Button
              type="link"
              onClick={() => handleApproveSkill(record)}
              loading={approvingSkillId === record.id}
            >
              审批上线
            </Button>
          )}
          {record.latestVersion?.source_url && (
            <Button
              type="link"
              icon={<DownloadOutlined />}
              onClick={() => triggerDownload(record.latestVersion?.source_url, `${record.name || "skill"}.zip`)}
            >
              下载
            </Button>
          )}
          {record.homepage && (
            <Button type="link" icon={<LinkOutlined />} onClick={() => openExternalUrl(record.homepage)}>
              链接
            </Button>
          )}
          <Button
            type="link"
            danger
            onClick={() => handleDeleteSkill(record)}
            loading={deletingSkillId === record.id}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const assistantColumns: ColumnsType<Assistant> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      width: 220,
      // Force horizontal wrapping inside the cell rather than letting antd
      // squeeze the column to a single-character width once the other
      // fixed-width columns (added with Dify integration) exceed the table's
      // intrinsic content width.
      render: (_, record) => (
        <Space direction="vertical" size={0} style={{ wordBreak: "break-word" }}>
          <Text strong>{record.name}</Text>
          <Text type="secondary">{record.profession || "-"}</Text>
        </Space>
      ),
    },
    {
      title: "版本",
      key: "version",
      width: 100,
      render: () => "-",
    },
    {
      title: "分类",
      key: "categories",
      width: 160,
      render: (_, record) =>
        record.categories?.length ? (
          <Space wrap>
            {record.categories.map((item) => (
              <Tag key={item}>{item}</Tag>
            ))}
          </Space>
        ) : (
          "-"
        ),
    },
    {
      title: "知识增强",
      key: "knowledge",
      width: 200,
      render: (_, record) => {
        const e = enhancementMap[record.id];
        if (e?.enabled) {
          return <Tag color="blue">{ENH_MODE_LABEL[e.mode || "agent-chat"]}</Tag>;
        }
        const datasets = datasetMap[record.id] ?? [];
        if (datasets.length > 0) {
          return <Tag color="cyan">知识库 ({datasets.length})</Tag>;
        }
        return <Tag>未启用</Tag>;
      },
    },
    {
      title: "可见范围",
      key: "acl",
      width: 140,
      render: (_, record) => {
        const a = aclMap[record.id];
        if (!a || a.scope === "all") return <Tag color="green">企业全员</Tag>;
        return <Tag color="orange">{a.user_ids.length} 位用户</Tag>;
      },
    },
    {
      title: "状态",
      key: "status",
      width: 120,
      render: (_, record) => <Tag color={getStatusColor(record.status)}>{getStatusLabel(record.status)}</Tag>,
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 200,
    },
    {
      title: "操作",
      key: "actions",
      width: 530,
      render: (_, record) => (
        <Space size="small" wrap>
          <Button
            type="link"
            size="small"
            icon={<SettingOutlined />}
            onClick={() => openEditDrawer(record)}
          >
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            icon={<LinkOutlined />}
            disabled={!enhancementMap[record.id]?.enabled}
            onClick={() => openInStudio(record)}
          >
            Dify Studio
          </Button>
          <Button type="link" size="small" onClick={() => openDetail(record)}>
            查看详情
          </Button>
          {record.status !== 1 && (
            <Button
              type="link"
              size="small"
              onClick={() => handleApproveAssistant(record)}
              loading={approvingAssistantId === record.id}
            >
              审批发布
            </Button>
          )}
          {record.sourceUrl && (
            <Button
              type="link"
              size="small"
              icon={<DownloadOutlined />}
              onClick={() => triggerDownload(record.sourceUrl, `${record.name || "assistant"}.zip`)}
            >
              下载
            </Button>
          )}
          <Button
            type="link"
            size="small"
            danger
            onClick={() => handleDeleteAssistant(record)}
            loading={deletingAssistantId === record.id}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const renderDetailContent = () => {
    if (!detailRecord) return null;

    if (isSkillsPage) {
      const record = detailRecord as Skill;
      return (
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="名称">{record.display_name || record.name}</Descriptions.Item>
          <Descriptions.Item label="标识">{formatValue(record.name)}</Descriptions.Item>
          <Descriptions.Item label="版本">{formatValue(record.latestVersion?.version)}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={getStatusColor(record.status)}>{getStatusLabel(record.status)}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="分类">
            {record.categories?.length ? record.categories.join(", ") : formatValue(record.category)}
          </Descriptions.Item>
          <Descriptions.Item label="描述">{formatValue(record.description)}</Descriptions.Item>
          <Descriptions.Item label="核心功能">{parseStructuredText(record.core_features)}</Descriptions.Item>
          <Descriptions.Item label="适用场景">{parseStructuredText(record.applicable_scenarios)}</Descriptions.Item>
          <Descriptions.Item label="作者">{formatValue(record.author_id)}</Descriptions.Item>
          <Descriptions.Item label="租户">{formatValue(record.tenant_id)}</Descriptions.Item>
          <Descriptions.Item label="资源地址">{formatValue(record.latestVersion?.source_url)}</Descriptions.Item>
          <Descriptions.Item label="链接">{formatValue(record.homepage)}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{formatValue(record.created_at)}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{formatValue(record.updated_at)}</Descriptions.Item>
        </Descriptions>
      );
    }

    const record = detailRecord as Assistant;
    return (
      <Descriptions bordered column={1} size="small">
        <Descriptions.Item label="名称">{record.name}</Descriptions.Item>
        <Descriptions.Item label="职业">{formatValue(record.profession)}</Descriptions.Item>
        <Descriptions.Item label="版本">-</Descriptions.Item>
        <Descriptions.Item label="状态">
          <Tag color={getStatusColor(record.status)}>{getStatusLabel(record.status)}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="分类">
          {record.categories?.length ? record.categories.join(", ") : "-"}
        </Descriptions.Item>
        <Descriptions.Item label="描述">{formatValue(record.description)}</Descriptions.Item>
        <Descriptions.Item label="默认提示词">
          <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {formatValue(record.defaultInitPrompt)}
          </div>
        </Descriptions.Item>
        <Descriptions.Item label="提示词文件">{formatValue(record.promptFile)}</Descriptions.Item>
        <Descriptions.Item label="技能列表">
          {record.skills?.length ? record.skills.join(", ") : "-"}
        </Descriptions.Item>
        <Descriptions.Item label="租户">{formatValue(record.tenantId)}</Descriptions.Item>
        <Descriptions.Item label="资源地址">{formatValue(record.sourceUrl)}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{formatValue(record.createdAt)}</Descriptions.Item>
        <Descriptions.Item label="更新时间">{formatValue(record.updatedAt)}</Descriptions.Item>
      </Descriptions>
    );
  };

  const dataSource = isSkillsPage ? skills : assistants;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <Title level={2} style={{ margin: 0 }}>
          {pageTitle}
        </Title>
        {!isSkillsPage && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            // Super admin must pick a tenant first; enterprise admin always can.
            disabled={isSuperAdmin && !selectedEnterprise}
            onClick={openCreateModal}
          >
            新建助手
          </Button>
        )}
      </div>

      <Card style={{ marginBottom: 12 }} styles={{ body: { padding: 12 } }}>
        <Form form={filterForm} layout="inline">
          {isSuperAdmin && (
            <Form.Item name="enterprise_id" label="所属企业">
              <Select
                placeholder="选择企业"
                style={{ width: 200 }}
                onChange={handleEnterpriseChange}
                value={selectedEnterprise}
              >
                {enterprises.map((e) => (
                  <Option key={e.id} value={e.code}>
                    {e.name}
                  </Option>
                ))}
              </Select>
            </Form.Item>
          )}
          <Form.Item>
            <Search
              placeholder={`搜索${isSkillsPage ? "技能" : "助手"}名称或描述`}
              allowClear
              enterButton={<SearchOutlined />}
              style={{ width: 320 }}
              onSearch={handleSearch}
            />
          </Form.Item>
        </Form>
      </Card>

      <Card styles={{ body: { padding: 16 } }}>
        {!selectedEnterprise && isSuperAdmin ? (
          <Empty description={`请先选择企业查看其${pageTitle}`} />
        ) : dataSource.length === 0 && !loading ? (
          <Empty description={`暂无${pageTitle}`} />
        ) : (
          <>
            {isSkillsPage ? (
              <Table<Skill>
                rowKey="id"
                dataSource={skills}
                columns={skillColumns}
                loading={loading}
                pagination={false}
                scroll={{ x: 1100 }}
              />
            ) : (
              <Table<Assistant>
                rowKey="id"
                dataSource={assistants}
                columns={assistantColumns}
                loading={loading}
                pagination={false}
                // Fixed-column widths now total ~1640 (name 220 + version 100
                // + categories 160 + enhancement 170 + acl 140 + status 120
                // + updated 200 + actions 530). Give scroll.x some slack so a
                // narrow viewport simply triggers horizontal scrolling rather
                // than squashing the cells.
                scroll={{ x: 1700 }}
              />
            )}
            {dataSource.length > 0 && (
              <div style={{ textAlign: "center", marginTop: 20 }}>
                {hasMore ? (
                  <Button
                    type="primary"
                    onClick={loadMore}
                    loading={loading}
                    icon={loading ? <LoadingOutlined spin /> : null}
                  >
                    {loading ? "加载中..." : "加载更多"}
                  </Button>
                ) : (
                  <Text type="secondary">已加载全部{pageTitle}</Text>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      <Modal
        open={detailOpen}
        title={`${pageTitle}详情`}
        onCancel={closeDetail}
        width={820}
        footer={
          detailRecord ? [
            isSkillsPage && (detailRecord as Skill).status !== 1 ? (
              <Button
                key="approve"
                type="primary"
                loading={approvingSkillId === (detailRecord as Skill).id}
                onClick={() => handleApproveSkill(detailRecord as Skill)}
              >
                审批上线
              </Button>
            ) : null,
            isSkillsPage ? (
              <Button
                key="delete"
                danger
                loading={deletingSkillId === (detailRecord as Skill).id}
                onClick={() => handleDeleteSkill(detailRecord as Skill)}
              >
                删除技能
              </Button>
            ) : null,
            isSkillsPage && (detailRecord as Skill).latestVersion?.source_url ? (
              <Button
                key="download"
                icon={<DownloadOutlined />}
                onClick={() =>
                  triggerDownload((detailRecord as Skill).latestVersion?.source_url, `${(detailRecord as Skill).name}.zip`)
                }
              >
                下载资源
              </Button>
            ) : !isSkillsPage && (detailRecord as Assistant).sourceUrl ? (
              <Button
                key="download"
                icon={<DownloadOutlined />}
                onClick={() =>
                  triggerDownload((detailRecord as Assistant).sourceUrl, `${(detailRecord as Assistant).name}.zip`)
                }
              >
                下载资源
              </Button>
            ) : null,
            !isSkillsPage && (detailRecord as Assistant).promptFile ? (
              <Button
                key="prompt"
                icon={<DownloadOutlined />}
                onClick={() =>
                  triggerDownload((detailRecord as Assistant).promptFile, `${(detailRecord as Assistant).name}-prompt.txt`)
                }
              >
                下载提示词
              </Button>
            ) : null,
            !isSkillsPage && (detailRecord as Assistant).status !== 1 ? (
              <Button
                key="approve"
                type="primary"
                loading={approvingAssistantId === (detailRecord as Assistant).id}
                onClick={() => handleApproveAssistant(detailRecord as Assistant)}
              >
                审批发布
              </Button>
            ) : null,
            isSkillsPage && (detailRecord as Skill).homepage ? (
              <Button
                key="link"
                icon={<LinkOutlined />}
                onClick={() => openExternalUrl((detailRecord as Skill).homepage)}
              >
                访问链接
              </Button>
            ) : null,
            <Button key="close" type="primary" onClick={closeDetail}>
              关闭
            </Button>,
          ].filter(Boolean) as React.ReactNode[]
          : undefined
        }
      >
        {renderDetailContent()}
      </Modal>

      {/* ====================== Create modal (assistants tab) ====================== */}
      {!isSkillsPage && (
        <Modal
          title="新建专属助手"
          open={createOpen}
          onCancel={() => setCreateOpen(false)}
          onOk={handleCreate}
          okText="创建"
          cancelText="取消"
          confirmLoading={creating}
          width={720}
          destroyOnClose
        >
          <Form form={createForm} layout="vertical">
            <SectionTitle icon={<ProfileOutlined />} text="基础信息" />
            <Form.Item name="name" label="助手名称" rules={[{ required: true }]}>
              <Input placeholder="例如 recruitment_expert" />
            </Form.Item>
            <Form.Item name="profession" label="职业 / 角色" rules={[{ required: true }]}>
              <Input placeholder="例如 招聘专家" />
            </Form.Item>
            <Form.Item name="description" label="描述">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item name="default_init_prompt" label="默认问候语">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item name="categories" label="分类">
              <Select mode="tags" placeholder="按回车添加" />
            </Form.Item>
            <Form.Item label="提示词 (.md, 必填)" required>
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Radio.Group
                  value={promptInputMode}
                  onChange={(e) => setPromptInputMode(e.target.value)}
                  optionType="button"
                  buttonStyle="solid"
                  size="small"
                  options={[
                    { label: "内联编辑", value: "inline" },
                    { label: "上传文件", value: "upload" },
                  ]}
                />
                {promptInputMode === "inline" ? (
                  <>
                    <Space size={4} wrap>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        插入模板：
                      </Text>
                      {(Object.keys(PROMPT_TEMPLATES) as Array<keyof typeof PROMPT_TEMPLATES>).map(
                        (key) => (
                          <Tooltip
                            key={key}
                            title={`使用「${PROMPT_TEMPLATES[key].label}」覆盖当前编辑框内容`}
                          >
                            <Button
                              size="small"
                              onClick={() => {
                                const apply = () => {
                                  const formValues = createForm.getFieldsValue();
                                  setPromptText(
                                    renderPromptTemplate(key, {
                                      name: formValues.name,
                                      profession: formValues.profession,
                                      description: formValues.description,
                                    }),
                                  );
                                  setPromptViewMode("edit");
                                };
                                if (promptText.trim()) {
                                  Modal.confirm({
                                    title: "替换当前提示词？",
                                    content: "当前编辑框内容会被模板覆盖。",
                                    okText: "替换",
                                    cancelText: "取消",
                                    onOk: apply,
                                  });
                                } else {
                                  apply();
                                }
                              }}
                            >
                              {PROMPT_TEMPLATES[key].label}
                            </Button>
                          </Tooltip>
                        ),
                      )}
                    </Space>
                    {/* Visual style mirrors the sudowork client's AssistantEditDrawer:
                        bordered box with an Edit/Preview tab bar on top. Edit mode is
                        a plain TextArea (no syntax highlighting), Preview renders
                        markdown — same minimal UX the user sees client-side. */}
                    <div
                      style={{
                        border: "1px solid var(--ant-color-border, #d9d9d9)",
                        borderRadius: 6,
                        overflow: "hidden",
                        height: 320,
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          height: 36,
                          borderBottom: "1px solid var(--ant-color-border, #d9d9d9)",
                          background: "var(--ant-color-fill-quaternary, #fafafa)",
                          flexShrink: 0,
                        }}
                      >
                        {(["edit", "preview"] as const).map((m) => (
                          <div
                            key={m}
                            onClick={() => setPromptViewMode(m)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              padding: "0 16px",
                              height: "100%",
                              cursor: "pointer",
                              fontSize: 13,
                              fontWeight: 500,
                              color:
                                promptViewMode === m
                                  ? "var(--ant-color-primary, #1677ff)"
                                  : "var(--ant-color-text-secondary, #666)",
                              borderBottom:
                                promptViewMode === m
                                  ? "2px solid var(--ant-color-primary, #1677ff)"
                                  : "2px solid transparent",
                              background:
                                promptViewMode === m
                                  ? "var(--ant-color-bg-container, #fff)"
                                  : "transparent",
                              transition: "all 0.15s",
                            }}
                          >
                            {m === "edit" ? "Edit" : "Preview"}
                          </div>
                        ))}
                      </div>
                      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                        {promptViewMode === "edit" ? (
                          <Input.TextArea
                            value={promptText}
                            onChange={(e) => setPromptText(e.target.value)}
                            placeholder="使用 Markdown 编写提示词，例如：&#10;&#10;# 你是 ... &#10;## 工作方式 ..."
                            autoSize={false}
                            style={{
                              border: "none",
                              borderRadius: 0,
                              height: "100%",
                              resize: "none",
                              fontFamily:
                                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                              fontSize: 13,
                              lineHeight: 1.6,
                              background: "transparent",
                            }}
                          />
                        ) : (
                          <div
                            className="prompt-md-preview"
                            style={{ padding: 16, fontSize: 13, lineHeight: 1.7 }}
                          >
                            {promptText.trim() ? (
                              <ReactMarkdown>{promptText}</ReactMarkdown>
                            ) : (
                              <Text
                                type="secondary"
                                style={{ display: "block", textAlign: "center", padding: "32px 0" }}
                              >
                                无内容可预览
                              </Text>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <Upload
                    accept=".md,text/markdown"
                    maxCount={1}
                    beforeUpload={() => false}
                    fileList={promptFile ? [promptFile] : []}
                    onChange={({ fileList }) => setPromptFile(fileList[0] || null)}
                  >
                    <Button icon={<UploadOutlined />}>选择文件</Button>
                  </Upload>
                )}
              </Space>
            </Form.Item>
            <Form.Item label="头像 (.png, 可选)">
              <Upload
                accept=".png,image/png"
                maxCount={1}
                beforeUpload={() => false}
                fileList={avatarFile ? [avatarFile] : []}
                onChange={({ fileList }) => setAvatarFile(fileList[0] || null)}
              >
                <Button icon={<UploadOutlined />}>选择头像</Button>
              </Upload>
            </Form.Item>

            <SectionTitle icon={<EyeOutlined />} text="可见范围" color="#52c41a" />
            <Form.Item name="acl_scope" label="可见范围" initialValue="all">
              <Select
                options={[
                  { label: "企业全员可见", value: "all" },
                  { label: "指定用户", value: "specific" },
                ]}
              />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(p, c) => p.acl_scope !== c.acl_scope}>
              {({ getFieldValue }) =>
                getFieldValue("acl_scope") === "specific" ? (
                  <Form.Item
                    name="acl_user_ids"
                    label="选择用户"
                    rules={[{ required: true, message: "请选择至少一位用户" }]}
                  >
                    <Select
                      mode="multiple"
                      showSearch
                      optionFilterProp="label"
                      options={userOptions}
                      placeholder="按姓名 / 手机号搜索"
                    />
                  </Form.Item>
                ) : null
              }
            </Form.Item>

            <SectionTitle icon={<ThunderboltOutlined />} text="知识增强 (可选)" color="#fa8c16" />
            <Form.Item
              name="knowledge_mode"
              label="增强方式"
              initialValue="none"
              tooltip="纯知识库与 Dify 增强互斥；启用 Dify 增强后，知识库需在 Dify Studio 内自行关联"
            >
              <Radio.Group
                options={[
                  { label: "不启用", value: "none" },
                  { label: "启用知识库（纯检索）", value: "datasets" },
                  { label: "启用 Dify 增强", value: "enhancement" },
                ]}
              />
            </Form.Item>
            <Form.Item
              noStyle
              shouldUpdate={(p, c) => p.knowledge_mode !== c.knowledge_mode}
            >
              {({ getFieldValue }) => {
                const km = getFieldValue("knowledge_mode");
                if (km === "datasets") {
                  return (
                    <Form.Item
                      name="dataset_ids"
                      label="关联知识库"
                      rules={[{ required: true, message: "请选择至少一个知识库" }]}
                      tooltip="运行时 sudowork-server 会调 Dify retrieve API 取片段，作为 <knowledge_context> 注入"
                    >
                      <Select
                        mode="multiple"
                        showSearch
                        optionFilterProp="label"
                        options={datasets.map((d) => ({ label: d.name, value: d.id }))}
                        placeholder="选择知识库（来自 Dify）"
                      />
                    </Form.Item>
                  );
                }
                if (km === "enhancement") {
                  return (
                    <Form.Item
                      name="enhancement_mode"
                      label="增强模式"
                      initialValue="agent-chat"
                      rules={[{ required: true }]}
                    >
                      <Select
                        options={[
                          { label: ENH_MODE_LABEL["agent-chat"], value: "agent-chat" },
                          { label: ENH_MODE_LABEL.workflow, value: "workflow" },
                        ]}
                      />
                    </Form.Item>
                  );
                }
                return null;
              }}
            </Form.Item>
            <Form.Item
              noStyle
              shouldUpdate={(p, c) =>
                p.knowledge_mode !== c.knowledge_mode ||
                p.enhancement_mode !== c.enhancement_mode
              }
            >
              {({ getFieldValue }) =>
                getFieldValue("knowledge_mode") === "enhancement" &&
                getFieldValue("enhancement_mode") === "agent-chat"
                  ? AGENT_CHAT_PROMPT_NOTICE
                  : null
              }
            </Form.Item>
          </Form>
        </Modal>
      )}

      {/* ====================== Edit drawer (assistants tab) ====================== */}
      {!isSkillsPage && (
        <Drawer
          title={editingRow ? `编辑：${editingRow.name}` : ""}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={520}
          destroyOnClose
          extra={
            <Button type="primary" loading={savingDrawer} onClick={saveDrawer}>
              保存
            </Button>
          }
        >
          {editingRow && (
            <Form
              form={drawerForm}
              layout="vertical"
              initialValues={drawerInitialValues}
            >
              <SectionTitle icon={<ThunderboltOutlined />} text="知识增强" color="#fa8c16" />
              <Form.Item
                name="knowledge_mode"
                label="增强方式"
                tooltip="纯知识库与 Dify 增强互斥；切换时会先解除旧绑定，再建立新绑定"
              >
                <Radio.Group
                  options={[
                    { label: "不启用", value: "none" },
                    { label: "启用知识库（纯检索）", value: "datasets" },
                    { label: "启用 Dify 增强", value: "enhancement" },
                  ]}
                />
              </Form.Item>
              <Form.Item
                noStyle
                shouldUpdate={(p, c) => p.knowledge_mode !== c.knowledge_mode}
              >
                {({ getFieldValue }) => {
                  const km = getFieldValue("knowledge_mode");
                  if (km === "datasets") {
                    return (
                      <Form.Item
                        name="dataset_ids"
                        label="关联知识库"
                        rules={[{ required: true, message: "请选择至少一个知识库" }]}
                      >
                        <Select
                          mode="multiple"
                          showSearch
                          optionFilterProp="label"
                          options={datasets.map((d) => ({ label: d.name, value: d.id }))}
                          placeholder="选择知识库（来自 Dify）"
                        />
                      </Form.Item>
                    );
                  }
                  if (km === "enhancement") {
                    // Lock the mode select when the assistant already has a
                    // Dify App bound. Switching Agent ↔ Workflow on the Dify
                    // side means a different App entity (different Studio
                    // page, different runtime endpoint), and "in-place
                    // conversion" doesn't exist there — flipping the value
                    // would silently leave the old App orphaned. The escape
                    // hatch is to first switch this radio to "不启用" (which
                    // deletes the App) and save, then come back and pick a
                    // new mode.
                    const modeLocked = !!enhancementMap[editingRow.id]?.enabled;
                    return (
                      <>
                        <Form.Item
                          name="enhancement_mode"
                          label="增强模式"
                          rules={[{ required: true }]}
                          tooltip={
                            modeLocked
                              ? "已创建的 Dify 增强助手不允许直接切换 Agent / Workflow（两者在 Dify 中是不同应用类型，无法直接转换）。"
                              : undefined
                          }
                        >
                          <Select
                            disabled={modeLocked}
                            options={[
                              { label: ENH_MODE_LABEL["agent-chat"], value: "agent-chat" },
                              { label: ENH_MODE_LABEL.workflow, value: "workflow" },
                            ]}
                          />
                        </Form.Item>
                        <Form.Item
                          noStyle
                          shouldUpdate={(p, c) => p.enhancement_mode !== c.enhancement_mode}
                        >
                          {({ getFieldValue: getInner }) =>
                            getInner("enhancement_mode") === "agent-chat"
                              ? AGENT_CHAT_PROMPT_NOTICE
                              : null
                          }
                        </Form.Item>
                        {enhancementMap[editingRow.id]?.dify_app_id && (
                          <Button
                            block
                            icon={<LinkOutlined />}
                            onClick={() => openInStudio(editingRow)}
                            style={{ marginBottom: 16 }}
                          >
                            在 Dify Studio 中编辑 Prompt / 工作流
                          </Button>
                        )}
                      </>
                    );
                  }
                  return null;
                }}
              </Form.Item>

              <SectionTitle icon={<EyeOutlined />} text="可见范围" color="#52c41a" />
              <Form.Item name="acl_scope" label="可见范围">
                <Select
                  options={[
                    { label: "企业全员可见", value: "all" },
                    { label: "指定用户", value: "specific" },
                  ]}
                />
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(p, c) => p.acl_scope !== c.acl_scope}>
                {({ getFieldValue }) =>
                  getFieldValue("acl_scope") === "specific" ? (
                    <Form.Item
                      name="acl_user_ids"
                      label="选择用户"
                      rules={[{ required: true, message: "请选择至少一位用户" }]}
                    >
                      <Select
                        mode="multiple"
                        showSearch
                        optionFilterProp="label"
                        options={userOptions}
                      />
                    </Form.Item>
                  ) : null
                }
              </Form.Item>
            </Form>
          )}
        </Drawer>
      )}
    </div>
  );
};

export default SkillsList;
