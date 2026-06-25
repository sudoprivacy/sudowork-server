# Dify 接入 SudoWork 产品体系设计

**日期:** 2026-06-17
**状态:** 待评审
**涉及仓库:** sudowork-server / dify(fork) / sudowork(client) / sudohub

---

## 背景

客户需求包含两块：
1. RAG 引擎（选型、部署、ingest、嵌入模型、与 sudorouter/智能体平台集成、样本数据、管理后台/权限/用量）；
2. 智能体快速开发平台（选型、与 sudorouter/RAG/sudocode 接入、示例可运行、与 sudowork 接入可行性）。

Dify 在功能上同时覆盖这两块。本设计目标是把定制后的 Dify 完整收纳进 SudoWork 产品体系，使其成为 SudoWork 的 RAG 与 Agent 编排子系统。

## 范围与目标

**目标**
- SudoWork 企业管理员在 sudowork-server 管理端可创建/配置助手（Dify App）；
- 终端用户在 sudowork 客户端无感调用助手，不感知 Dify；
- 助手可见范围由 SudoWork 控制；用户能看到助手即拥有其挂载知识库的查询权限；
- 编辑权限仅对企业租户管理员开放；
- 身份、权限、审计三层在 SudoWork 与 Dify 之间一致；
- 不破坏 sudowork-server 现有用户/企业模型。

**非目标**
- 不重写 Dify 内部权限模型；
- 不为 Dify 增加通用 OIDC/SAML；
- 第一阶段不把 Dify Web Console 完全克隆进 SudoWork（保留独立 Dify UI，做单点跳转 + 必要 chrome 隐藏）。

## 总体原则（最终态）

**Dify 是 SudoWork 的 RAG/Agent 增强层，不替代本地 ACP，而是以"预注入"形式增强 sudohub 助手的能力。**

- 客户端与 Dify **零直接交互**，全部走 sudowork-server 转发；
- sudohub schema **完全不动**，所有 Dify 关联只在 sudowork-server 维护；
- 企业专属助手由企业管理员在 sudowork-server 管理端创建，同时落地到 sudohub 助手库；
- 用户安装该助手后，本地 ACP（持 .md + skills）是主脑，Dify 通过预注入提供知识/工作流增强。

**Dify 是 SudoWork 的 RAG/Agent 编排子系统，被 SudoWork 体系完整收纳，但内部保留自治。**

| 决策点 | 默认归属 | 例外 |
|---|---|---|
| 用户身份、企业、计费、配额 | SudoWork | 无 |
| 助手元数据（名字、可见范围、挂载关系） | SudoWork | 无 |
| 助手 Prompt、工作流图、模型参数 | Dify | 无 |
| 知识库（文件、向量、检索配置） | Dify | 无 |
| 运行时调用入口 | SudoWork 闸门 → Dify 执行 | 无 |
| 管理 UI 容器 | SudoWork 壳 + Dify 编排页跳转 | 稳定后可仅保 SudoWork 壳 |
| 审计 | 双侧都留 | 无 |

## 现状速览

### sudowork-server（Bun + Hono + SQLite）
- 用户与企业：`users(enterprise_id, role)` + `enterprises(code)`，code 即 tenant id；
- 角色：`USER` / `ENTERPRISE_ADMIN` / `SUPER_ADMIN`；
- 认证：`hono/jwt` HS256，`src/middleware/auth.ts`；
- 助手/技能不本地存储，由 `src/routes/external-proxy.ts` 代理 sudohub；
- 无 RAG。

### sudowork 客户端（Electron + React + IPC）
- 助手为本地预设（`hub/` `system/` `custom/` `tenant/`），元数据 `_sudowork_meta.json`；
- 鉴权 JWT 存 localStorage，租户 token 不暴露 renderer，统一走主进程 IPC；
- 无 RAG 概念。

### Dify（Flask + Next.js）
- 多租户：`Tenant` + `TenantAccountJoin(role)`，App/Dataset 带 `tenant_id`；
- Dataset ACL：`DatasetPermission` + `dataset.permission`；
- 认证：`libs/passport.py` `PassportService.issue/verify`（HS256 + `SECRET_KEY`）；
- `EndUser.external_user_id` —— 端用户 ID 天然锚点；
- 内置 GitHub/Google OAuth，无通用 OIDC/SAML hook。

## 概念映射

| SudoWork | Dify | 备注 |
|---|---|---|
| `enterprises.code` | `Tenant.id` | 1:1，按需创建；映射存 sudowork-server |
| `users` (admin) | `Account` + `TenantAccountJoin(ADMIN)` | 首次 SSO 自动开通 |
| `users` (USER) | `EndUser(external_user_id=user_id)` | 不占 Account 席位 |
| 助手（sudohub assistant） | Dify `App`（mode=agent/chat/workflow） | 1:1 绑定 |
| 助手挂载的知识库 | Dify `Dataset` | 1:N |
| 可见用户/部门 | sudowork-server 的 ACL 表 | Dify 内不表达 |

## 整体架构

```
                                       ┌──────────────────────────┐
                                       │     sudohub (现有)        │
                                       │  assistant / skill 元数据  │
                                       └──────────────┬───────────┘
                                                      │ HTTPS
                                                      │（沿用 external-proxy）
┌──────────────────┐      ┌────────────────────────┐  │
│  sudowork 客户端  │ JWT  │   sudowork-server      │──┘
│  (Electron)      ├─────▶│   - 用户/企业/权限       │      ┌──────────────────────┐
│  - 列表/对话 UI   │      │   - 助手 ACL (新增)     │ HMAC │   Dify api (后端)     │
│  - 主进程代调用    │      │   - Dify 绑定表 (新增)  ├─────▶│   Console API (管理)  │
└──────────────────┘      │   - SSO 签名 (新增)     │      │   Service API (运行) │
        ▲                 │   - Dify 代理 (新增)    │APIKey│   - Apps / Datasets  │
        │ chat (流式)      └────────────┬───────────┘      │   - EndUser by ext_id │
        │                              │                  └──────────┬───────────┘
        │                              │ 浏览器跳转 (SSO)              │
        │                       ┌──────▼──────────┐                  │
        │                       │  Dify Web 控制台 ◀──────────────────┘
        │                       │  (新窗口 / chrome 隐藏)              │
        │                       └─────────────────┘
        └── SSE/WebSocket 由 sudowork-server 中继（不直连 Dify）
```

**关键边界**
- 客户端从不直连 Dify；
- Dify Console UI 仅在管理员浏览器加载；
- sudohub 仍是助手元数据真理源，新增 `dify_app_id`/`dify_tenant_id` 字段串联 Dify 资源。

## 身份与 SSO

### 租户开通（首次按需）

1. sudowork-server 检查 `dify_tenant_binding(enterprise_id, dify_tenant_id, api_key, created_at)`；
2. 若无 → 调 Dify「provisioning 接口」（HMAC 鉴权），传入 `enterprise.code` + `enterprise.name`，返回 `tenant_id` + Service API key；
3. sudowork-server 把 `api_key` 直接落 SQLite（与现有 `users.api_key` 等敏感字段同等待遇，不做应用层加密）；
4. 永远只在 sudowork-server 进程内使用；不经 IPC 传给客户端。

### 管理员 SSO（替代「固定 admin token」方案）

```
sudowork-server              浏览器                Dify
     │                          │                   │
[打开 Dify]                      │                   │
     │ HMAC-sign 5min JWT       │                   │
     │ { sub, email, name,      │                   │
     │   enterprise_code,       │                   │
     │   role:'admin',          │                   │
     │   jti, exp, iat }        │                   │
     │ ─302 → /sso?token=…──▶  │                   │
     │                          │ ─GET /sso/exchange▶
     │                          │       verify HMAC + jti nonce(Redis)
     │                          │       upsert Account + TenantAccountJoin
     │                          │ ◀Set-Cookie console_token
     │                          │ ─302 → next ─────▶│
```

**要点**
- JWT 寿命 ≤ 5 分钟，单次有效（jti 写 Redis `dify:sso:used:{jti}` TTL 10 分钟）；
- HS256，密钥 `DIFY_SSO_SECRET`（与 Dify `SECRET_KEY` 分离）；
- `enterprise_code` 必带；
- `ENTERPRISE_ADMIN` → Dify `ADMIN`；`SUPER_ADMIN` → `ADMIN`（不给 OWNER）；
- 邮箱缺失时合成 `sudowork-{user_id}@local.sudowork`，标 `status=active`，密码空（只能 SSO 进入）。

### 终端用户运行时身份

- 不 SSO，不在 Dify 创建 Account；
- sudowork-server 调 Service API（`/v1/chat-messages` 等），`user="sudowork:{enterprise_code}:{user_id}"` → Dify 用此做 `EndUser.external_user_id` upsert；
- conversation / message / token 用量都关联到该 EndUser。

## 权限模型

### 权威源

sudowork-server 是助手可见性唯一权威。Dify 内 Dataset 一律建为 `permission=ONLY_ME`，归 Dify Tenant 内的「系统操作员账户」持有，所有 Dataset 查询经 sudowork-server 鉴权后用系统 API key 调用，封死「绕过 SudoWork 直连 Dify」路径。

### 新增表（sudowork-server SQLite）

```sql
-- 租户绑定（api_key 为 Dify Service API key 明文，不出 sudowork-server 进程）
CREATE TABLE dify_tenant_binding (
  enterprise_id INTEGER PRIMARY KEY,
  dify_tenant_id TEXT NOT NULL UNIQUE,
  dify_system_account_id TEXT,
  api_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 助手 ↔ Dify App 绑定（仅 Dify 增强模式时存在）
-- dify_app_mode 值域: 'agent-chat' | 'workflow'
-- 2026-06-22 P2.5.1 调整：废除 'rag-only'，纯 RAG 场景改走 assistant_dataset_binding
CREATE TABLE dify_app_binding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enterprise_id INTEGER NOT NULL,
  assistant_id TEXT NOT NULL,
  dify_tenant_id TEXT NOT NULL,
  dify_app_id   TEXT NOT NULL,
  dify_app_mode TEXT NOT NULL,
  app_api_key TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(enterprise_id, assistant_id)
);

-- 助手可见性 ACL
CREATE TABLE assistant_acl (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enterprise_id INTEGER NOT NULL,
  assistant_id TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('user','department','role','all')),
  subject_id   TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(enterprise_id, assistant_id, subject_type, subject_id)
);

-- 助手 → Dify Dataset 关联（仅纯知识库模式时存在）
-- 2026-06-22 P2.5.1：表名沿用历史的 dify_dataset_binding（schema.ts 已存在但之前未启用），
-- 作为"纯 RAG"路径的唯一关联存储。Dataset 物理位置永远在 Dify，本表只存
-- "哪个助手关联了哪些 dataset_id"。
CREATE TABLE dify_dataset_binding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enterprise_id INTEGER NOT NULL,
  assistant_id  TEXT    NOT NULL,
  dify_tenant_id TEXT NOT NULL,
  dify_dataset_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(enterprise_id, assistant_id, dify_dataset_id)
);
```

**互斥约束**（service 层保证，DB 不加 CHECK）：同一个 `(enterprise_id, assistant_id)` 在 `dify_app_binding` 和 `dify_dataset_binding` 里最多只能出现在一处。

### 派生规则

- **助手对用户可见** ⇔ `assistant_acl` 存在命中条目（直接 user / 所属 department / role / `all`）；
- **知识库对用户可见** ⇔ 存在至少一个对该用户可见的助手关联该 dataset（隐式继承）；
- **编辑权**：所有 `assistant_acl` / `dify_app_binding` / `dify_dataset_binding` 写路由强制 `adminMiddleware()`。

### 运行时鉴权（sudowork-server 内）

```
POST /api/v1/agents/:assistantId/chat
  1. 校验 JWT → user_id, enterprise_id
  2. 查 assistant_acl 判可见性 → 否则 403
  3. 查 dify_app_binding → 拿 dify_app_id 与 API key
  4. SSE 透传 Dify /v1/chat-messages
     注入 user=sudowork:{ent}:{uid}
  5. 响应 metadata.usage 回写 ledger 计费
```

## 管理端集成

### 新增页面

| 页面 | 功能 | 后端路由 |
|---|---|---|
| 助手管理 | 列表/新建/编辑/删除/可见范围/挂载数据集 | `/api/v1/admin/agents/*` |
| 知识库管理 | **仅 SSO 跳转入口**（实际 CRUD 在 Dify Studio） | `/api/v1/admin/dify/sso?next=/datasets` |
| 编辑助手编排 | SSO 跳转 Dify Studio 对应 App 配置页 | `/api/v1/admin/dify/sso?next=/app/{dify_app_id}/configuration` |

### 「轻量元数据」vs「重型编排」分工

- 助手的「名字、描述、图标、可见范围、挂载知识库、关联 sudohub 技能」在 sudowork-server 管理端编辑；
- Prompt、模型参数、工具调用图、节点连线 → 跳转 Dify Studio。

### 新建助手端到端流程

```
admin → POST /admin/agents {name, description, mode, ...}
  ├─ 校验 admin 同企业
  ├─ 确保 dify_tenant_binding 存在（按需 provisioning）
  ├─ Dify Console API（System token）POST /console/api/apps
  │     {name, description, mode, icon, ...} → {app_id, ...}
  ├─ 写 dify_app_binding
  ├─ sudohub POST /api/assistants（含 dify_app_id 引用）
  └─ 返回 assistantId

admin 设置可见范围 → PUT /admin/agents/:id/acl
admin 挂载知识库   → PUT /admin/agents/:id/datasets
admin 改编排       → 跳转 Dify Studio
```

### Dify Console System Token

- Dify 启动注入 `DIFY_SYSTEM_TOKEN`；
- 新增 wraps `system_token_required`，校验 `Authorization: Bearer <DIFY_SYSTEM_TOKEN>`，绑定 `X-Sudowork-Tenant: {enterprise_code}`；
- 仅 sudowork-server 持有；IP allowlist + 速率限制；
- `created_by` 由 `X-Sudowork-Actor: {dify_account_id}` 注入真实管理员账户。

## 客户端集成

**绝对边界**：客户端与 Dify **零直接交互** —— 所有与 Dify 相关的请求统一发到 `sudowork-server.sudoprivacy.com/api/v1/agents/*`，由 sudowork-server 做可见性鉴权后转发。客户端代码不引用任何 Dify URL、不持有任何 Dify token，主进程 `difyBridge.ts` 也只面向 sudowork-server。

**最小入侵原则**：复用现有 `ipcBridge.assistantHub`，新增「dify 类」助手适配器。

### 助手列表

- `assistantHub.getInstalledAssistants` 内部新增对 `sudowork-server /api/v1/agents/visible` 的合并调用；
- 返回的 Dify 助手项 `meta.runtime='dify'`，UI 无差别。

### 对话运行时

- 主进程根据 `meta.runtime` 分发：
  - `local`：原路径；
  - `dify`：调 `POST sudowork-server /api/v1/agents/:id/chat`，SSE 流式；
- 文件上传：客户端 → sudowork-server → Dify `/v1/files/upload`。

### 客户端可调用的 sudowork-server 路由全集（零直接交互）

按 RESTful 形状给出，全部都加 `Authorization: Bearer <SudoWork JWT>`：

| 用途 | 方法 + 路径 | 主进程 IPC provider |
|---|---|---|
| 列可见助手 | `GET /api/v1/agents/visible` | `dify.getVisibleAgents` |
| 发起对话（SSE 流式） | `POST /api/v1/agents/:id/chat` | `dify.startChat` + emitter `chunk/end` |
| 服务端中断生成 | `POST /api/v1/agents/:id/chat/:taskId/stop` | `dify.stopChatTask` |
| 列会话 | `GET /api/v1/agents/:id/conversations` | `dify.listConversations` |
| 重命名会话 | `PATCH /api/v1/agents/:id/conversations/:cid` | `dify.renameConversation` |
| 删除会话 | `DELETE /api/v1/agents/:id/conversations/:cid` | `dify.deleteConversation` |
| 列消息 | `GET /api/v1/agents/:id/conversations/:cid/messages` | `dify.listMessages` |
| 点赞/点踩 | `POST /api/v1/agents/:id/messages/:mid/feedback` | `dify.sendFeedback` |
| 推荐下一句 | `GET /api/v1/agents/:id/messages/:mid/suggested` | `dify.getSuggested` |
| 输入表单 schema | `GET /api/v1/agents/:id/parameters` | `dify.getParameters` |
| 助手元信息 | `GET /api/v1/agents/:id/meta` | `dify.getMeta` |
| 上传文件（multipart） | `POST /api/v1/agents/:id/files` | `dify.uploadFile` / `dify.uploadFileFromPath` |
| 语音转文字（multipart） | `POST /api/v1/agents/:id/audio-to-text` | `dify.audioToText` |
| 文字转语音（流式 binary） | `POST /api/v1/agents/:id/text-to-audio` | `dify.textToAudio`（落临时文件）|

每个路由内部 4 步：(1) authMiddleware 拿 user → (2) 查 `assistant_acl` 判可见性 → (3) `loadServiceApiKey(enterprise_id)` → (4) 调 Dify Service API 并把响应包成 `{success, data}`。流式接口直接转发 upstream Response.body。

### 不嵌入 Dify Web Console

- 终端用户场景无需看到 Dify UI；
- 管理员场景：**浏览器新标签页**打开 Dify Studio（SSO 跳转），不在 Electron 内嵌 webview。

## RAG 集成

**修订原则**：Dify 数据自治，sudowork-server 不复制 / 不中转 / 不存原始文档。

### 知识库 CRUD（2026-06-23 P3 完成：admin 端管理 + Dify 端自治）

> 2026-06-23 更新：原"全在 Dify Studio"的设计已被 P3 RAG 挂载替换。dataset 的物理存储仍 100% 在 Dify，但 CRUD 操作管理员可以**完全在 sudowork-server admin 内完成**，不再需要跳转 Dify Studio 做日常运维。

**架构**：admin 端「知识库」菜单 → sudowork-server `/api/v1/admin/datasets/*` → 透传到 Dify **Service API** `/v1/datasets/*`（用 tenant-scoped `dataset` api_key）。**未新增任何 Dify Inner API**，因为 Service API 已完整覆盖需求。

```
admin 在管理端「知识库」菜单
  ├─ 列表 / 搜索 / 分页
  ├─ 新建知识库（名称、描述、索引方式：economy / high_quality）
  ├─ 编辑（rename / re-describe）
  ├─ 删除（连带向量与文档）
  ├─ 文档管理 Drawer：
  │    ├─ 粘贴文本上传（name + Markdown 内容）
  │    ├─ 文件上传（.txt/.md/.pdf/.docx/.csv/.json/.html 等）
  │    └─ 已有文档列表 + 单条删除（含 indexing_status / word_count / hit_count）
  └─ 测试查询 Drawer（hit-testing）：query + retrieval_model 选择
```

进阶配置（嵌入模型切换、召回阈值微调、索引重建调度）仍需 SSO 跳 Dify Studio——这些属于"半年改一次"的低频操作，不值得在 admin 内重做。日常运维 95% 操作都在 admin 内完成。

sudowork-server 唯一「写」入口是助手挂载/解绑：

```
admin 助手详情页 → "挂载知识库"
  → GET /admin/dify/datasets （Inner API 列表代理，仅 UI 下拉用，不落库）
  → PUT /admin/agents/:id/datasets [dataset_ids]
  → 写 dify_dataset_binding
```

### 运行时召回

1. 助手对话内自动召回：Dify 内部 retriever 走，sudowork-server 不介入；
2. 独立检索 API（可选）：`POST /api/v1/search` → 按可见性过滤 dataset_ids → 并发调 Dify `/v1/datasets/{id}/queries` → 合并返回（不缓存命中内容）。

### 权限

**核心原则**：知识库的**终端用户访问权限完全派生自专属助手 ACL**，不在 dataset 层面单独配置。

```
普通用户 → sudowork 客户端 → 看见某个专属助手 → 该助手关联的知识库自动可用
                ↑
        assistant_acl 决定（admin 在专属助手编辑里配的可见范围）
```

实现细节：
- Dataset 在 Dify 内 `permission=all_team_members`（2026-06-23 P3 默认）：让所有 SSO'd 企业管理员能在 **Dify Studio 管理界面**看到 dataset，便于日常运维。这跟终端用户权限**无关**。
- 历史遗留的 `only_me` dataset 已通过 PATCH 批量升级。
- admin SPA 「知识库管理」**不暴露 permission 字段**：暴露会让管理员误以为是终端用户权限开关；实际上：
  - 改 `only_me` 只是把 dataset 从其他 admin 在 Studio 的视野里藏起来（运行时 retrieve 不受影响）
  - 终端用户根本接触不到 Dify Studio
- 管理员 SSO 进 Dify 时 `TenantAccountJoin.role=ADMIN`，对所有 dataset 有可见+编辑权。
- 普通用户始终走 sudowork-server 闸门：调 retrieve 用 tenant-scoped api_key，命中的内容作为 `<knowledge_context>` 注入到该助手的对话——只要 ACL 不让用户看到这个助手，就拿不到知识。
- 客户「数据主权」通过把 Dify 部署在客户内网解决，而非双写。

**给后端的 API 契约**：`PATCH /admin/datasets/:id` 仍然**支持** `permission` 字段（脚本/迁移用），只是 UI 不暴露——避免有人想用脚本修旧数据时被卡住。

### 特殊格式（UE 文档 / 代码仓）

做成 Dify 自定义数据源插件（`api/core/datasource` + `dify-plugin-daemon`），不在 sudowork-server 维护 IngestAdapter。

### 嵌入模型选型

- 中文 + 长文：`bge-m3`；
- 代码：`jina-embeddings-v2-base-code`；
- 通过 Dify「模型供应商」统一配置。

## 企业专属助手（P2.5 最终态）

> 这一节是 P2.5 落地后的真实形态，覆盖 §229「管理端集成」与 §268「客户端集成」中的"创建/安装/运行"全流程。

### 角色定位

| 子系统 | 在此架构中的职责 |
|---|---|
| **sudohub** | 助手元数据真理源（name / .md / skills / avatar / tenant_id）。schema 与接口**完全不动**。 |
| **sudowork-server** | 助手 ↔ Dify App 绑定、可见性 ACL、运行时增强调用入口；持有 Dify Service API key |
| **Dify** | App / Dataset / Workflow 自治；通过 `/sudowork/system/*` 接受 sudowork-server 的系统调用 |
| **客户端** | 安装 sudohub 助手到本地；每轮 chat 前调 sudowork-server 拿增强文本预注入；运行时本地 ACP 是主脑 |

### 管理员创建流程

助手的"能力增强"是**两个互斥维度的三选一**（2026-06-22 P2.5.1 调整，详见后文「知识增强：两个维度」）：

```
admin 在 sudowork-server 管理端"专属助手" → 新建
   ├─ 基础信息（一个表单跨两侧）
   │    name / profession / description / categories / skills / prompt.md / avatar
   │    可见范围（acl_entries）
   │
   ├─ 知识增强（三选一）
   │    ○ 不启用
   │    ○ 启用知识库（纯检索）   → 多选 dataset_ids（来自 Dify）
   │    ○ 启用 Dify 增强         → 选择类型 Agent | Workflow
   │                              知识库在 Dify Studio 内自行关联
   │
   ▼
POST /api/v1/admin/dify/enterprise-assistants (multipart)
   │
   ├─ 1. sudohub POST /api/assistants
   │     → assistant_id
   ├─ 2a. (启用知识库分支) INSERT assistant_dataset_binding × N
   ├─ 2b. (启用 Dify 增强分支) Dify /sudowork/system/apps → dify_app_id
   │       INSERT dify_app_binding
   ├─ 3. INSERT/UPSERT assistant_acl
   │
   ▼
返回 {
  assistant_id,
  dataset_ids?: string[],              // 纯知识库分支
  dify_app_id?, enhancement: { mode }?  // Dify 增强分支
}
管理员选了 Dify 增强 → 可点"在 Dify Studio 编辑" SSO 跳转
```

任意一步失败按反向顺序补偿（删 Dify App、删 dataset_binding、删 sudohub assistant），保证不留半张影。

### 用户端发现 / 安装

- `assistantHub.fetchAssistants`（旧的 hub 浏览）：保持不变，从 sudohub 直接拉
- 安装：`downloadAndInstallAssistant` 保持不变（zip / .md / skills 全套）
- **新增过滤层**：`AssistantManager.getInstalledAssistantsWithVisibility(accessToken)` —— 调 `/agents/visible`，对 hub/tenant 类助手做"是否在可见集合中"的反向校验，超权的助手即使本地已安装也不展示

`/agents/visible` 返回值长这样：

```json
{
  "success": true,
  "data": [
    {
      "assistant_id": "30ae1f95-...",
      "name": "recruitment_expert",
      "avatar": "...",
      "categories": ["运营人力"],
      "enhancement": { "enabled": false },
      "dataset_ids": []
    },
    {
      "assistant_id": "law-...",
      "name": "法律法规助手",
      "avatar": "...",
      "categories": ["法务安全"],
      "enhancement": { "enabled": false },
      "dataset_ids": ["ds-abc-...", "ds-def-..."]
    },
    {
      "assistant_id": "abc-...",
      "name": "招聘助手-增强版",
      "avatar": "...",
      "categories": ["运营人力"],
      "enhancement": {
        "enabled": true,
        "mode": "agent-chat",
        "dify_app_id": "d1f-9870-..."
      },
      "dataset_ids": []
    }
  ]
}
```

`enhancement.enabled` 与 `dataset_ids.length > 0` **二者最多有其一为真**（互斥语义，详见后文「知识增强：两个维度」）。

服务端逻辑：sudohub 列表（tenant 过滤）∩ `assistant_acl`（admin 设置的可见范围）∪ 标注 `enhancement` 与 `dataset_ids`。

### 用户端运行时（预注入）

```
用户输入消息 m
   │
   ├─ 主进程读 meta（enhancement + dataset_ids）
   │
   ├─ enhancement.enabled === false && dataset_ids.length === 0
   │   → 直接发给本地 ACP（旧路径不变）
   │
   ├─ enhancement.enabled === false && dataset_ids.length > 0   ← 纯知识库
   │   POST /api/v1/agents/:id/enhancement/invoke
   │     → sudowork-server 调 Dify /v1/datasets/{id}/retrieve（并发，按 dataset_id 列表）
   │     → 拼接命中段落作为 text 返回
   │
   ├─ enhancement.enabled === true                              ← Dify 增强
   │
   │   ├─ mode === 'agent-chat':
   │   │   POST /api/v1/agents/:id/enhancement/invoke
   │   │     → Dify /v1/chat-messages (blocking-via-stream)
   │   │     → Dify App 自己使用其 Studio 内配置的知识库 + 工具 + 推理
   │   │
   │   ├─ mode === 'workflow':
   │   │   POST /api/v1/agents/:id/enhancement/invoke-stream (SSE)
   │   │     → sudowork-server 透传 Dify /v1/workflows/run streaming
   │   │     → 客户端逐帧接 enhancement_progress (node_started 转译)
   │   │     → 最后一帧 enhancement_result 携带最终 text
   │   │
   │   ▼
   │   组装注入：
   │     <knowledge_context source="enterprise_knowledge_agent" mode="{mode|dataset}">
   │       {Dify 返回的 text}
   │     </knowledge_context>
   │
   │     {原 m}
   │
   ▼
本地 ACP 启动：
  system prompt = .md + ENHANCEMENT_PRELUDE[mode]（本地优先 + 引用规范）
  tools         = .md 关联的 sudohub skills
  user message  = 注入后的 m
   │
   ▼
本地 ACP 流式回复用户
```

注：判断逻辑改为"两个维度的或"而非"单一 mode 分支"。`mode = 'dataset'` 是注入块上的标记字符串（不是 Dify App 模式），用于让本地 ACP 知道这段上下文是检索原文还是子智能体输出。

### 知识增强：两个维度（互斥）

> 2026-06-22 P2.5.1 调整。之前的 `rag-only` 模式被废弃，替换为"知识库关联"独立维度。

#### 为什么拆开

Dify 原生只有两种 App 类型与"知识库"相关：**Agent (chat / agent-chat)** 和 **Workflow**。两者都可以在 Dify Studio 里关联 Dataset，让 Dify App 内部自己做 RAG。

但企业用户的**原始 RAG 需求**——"我只想往用户消息里塞知识库片段，不让 LLM 二次加工"——和"Dify Agent / Workflow 增强"是不同维度的功能：

| 需求 | LLM 介入次数 | token 成本 | 控制粒度 |
|---|---|---|---|
| 纯检索（旧 rag-only） | 0（只检索） | 极低 | sudowork-server 完全掌控 |
| Dify Agent | 1（Dify 端） | 中 | Dify Studio 配置 |
| Dify Workflow | N（按节点） | 高 | Dify Studio 配置 |

把它们混在同一个"Dify 增强 mode"枚举里，导致：
- Dify Studio 看 `rag-only` 助手和 `agent-chat` 助手长一样（都建成 agent-chat 占位 App），管理员困惑
- "在 Dify Studio 关联知识库" vs "在 admin 端关联知识库"两个入口都存在 → **同一个 dataset 可能被检索两次**（admin 端调 retrieve API 一次、Dify App 内部自己再查一次）→ 翻倍 token、结果不一致、信息冲突

#### 新模型：两条互斥的路径

```
助手 = 基础身份(prompt.md) + 知识增强(三选一)
                                 │
                  ┌──────────────┼──────────────┐
                  ▼              ▼              ▼
              ① 不启用      ② 纯知识库    ③ Dify 增强
                            (sudo 侧关联)  (mode: agent-chat | workflow)
```

#### 数据归属（关键澄清）

**物理 Dataset 永远只有一份，存在 Dify 这边。** 区别只在"谁来触发检索 / 关联关系存哪"：

| 路径 | Dataset 物理位置 | 关联关系存哪 | 谁触发检索 |
|---|---|---|---|
| ① 不启用 | -（不涉及） | - | - |
| ② 纯知识库 | Dify | sudowork-server SQLite (`assistant_dataset_binding`) | sudowork-server 调 Dify `/v1/datasets/{id}/retrieve` |
| ③ Dify 增强 | Dify | Dify PG（Studio 里的 App ↔ Dataset 配置） | Dify App 自己执行时检索 |

**②③ 永远不会同时存在**：admin 端选了 Dify 增强 → 不允许填 dataset_ids；选了纯知识库 → 不允许配 Dify App。前端表单做成 Radio 三选一，后端 schema 也保证 `dify_app_binding` 和 `assistant_dataset_binding` 互斥（DB 不加 CHECK 约束，由 service 层保证）。

#### 模式对照（新版）

| 模式 | sudowork-server 内部路径 | dify_app_binding | dataset_binding | 适用场景 |
|---|---|---|---|---|
| **不启用** | 直通本地 ACP | ❌ | ❌ | 普通助手 |
| **纯知识库** | Dify `/v1/datasets/{id}/retrieve` 并发 + 合并 | ❌ | N 条 | 只需要原文片段，零 LLM 成本 |
| **Dify 增强 - Agent** | Dify `/v1/chat-messages` (blocking via stream) | 1 条 | ❌ | RAG + 工具 + 推理子智能体 |
| **Dify 增强 - Workflow** | Dify `/v1/workflows/run` (streaming) → SSE 透传 | 1 条 | ❌ | 多节点固化流程 |

之前文档版本里的 `rag-only` 这个 EnhancementMode 枚举值被移除；TypeScript 类型从 `'agent-chat' \| 'workflow' \| 'rag-only'` 收窄为 `'agent-chat' \| 'workflow'`。注入块上的 `mode` 属性额外多了一个 `'dataset'` 值表示纯知识库分支。

### 本地能力 + Dify 能力的融合

在本地 ACP 主脑视角里：

```
system prompt:
  <admin 写的 .md 人格 + 业务知识>

  <ENHANCEMENT_PRELUDE[mode]>: "本地技能优先；不能覆盖时再吸收 knowledge_context；
                                不要逐字复述上下文"

tools:
  <.md 关联的 sudohub skills>

user message:
  <knowledge_context mode="workflow">
    {Dify 工作流产出}
  </knowledge_context>

  {用户原话}
```

主脑根据 .md 人格 + 用户输入 + （可选）knowledge_context，自主决策：
1. 先尝试本地 skill 解决
2. 不够时吸收 knowledge_context
3. 仍不够时直接基于人格作答

三层能力（.md / skills / Dify）就此**真正融合**，而不是任一被替代。

## sudohub 接口契约（终态：零改动）

P2.5 架构调整后，sudohub 现有 API **完全够用**，无需新增字段或接口。sudowork-server 全部用现有 multipart `POST /api/assistants` / `GET /cursor` / `GET/PUT/DELETE /:id` / `POST /:id/approve` 完成对接。

Dify 关联信息（`dify_app_id` / `dify_tenant_id` / `dify_app_mode`）100% 维护在 sudowork-server 的 `dify_app_binding` 表内，**不外溢到 sudohub**。

可选优化（非阻塞）：

- `POST /api/assistants/by-ids` —— 批量元数据查询，可显著提升 `/agents/visible` 路由性能。当前 `SudohubClient.listAssistantsByIds` 用 cursor 分页扫描兜底（最多 20 页 × 100 条），可接受。
- spec 完善 —— 把 description 字符串改成正经 OpenAPI schema 定义，方便客户端自动生成 TS 类型。

## Dify 侧补丁清单（最小集）

1. **`api/controllers/console/auth/sso_exchange.py`**（新）：`POST /console/api/auth/sso-exchange`，HMAC JWT → upsert Account + TenantAccountJoin → Set-Cookie + 302；配置 `SUDOWORK_SSO_SECRET`、`SUDOWORK_SSO_ALLOWED_ISSUER`。
2. **`api/controllers/system/tenant_provisioning.py`**（新）：`POST /system/api/tenants`，HMAC + IP allowlist；按 `enterprise_code` 创建 Tenant + 系统操作员 Account + Service API key，返回三件套。
3. **`api/libs/wraps.py`**（扩展）：`system_token_required` 装饰器，校验 `Authorization: Bearer DIFY_SYSTEM_TOKEN`，从 `X-Sudowork-Tenant`/`X-Sudowork-Actor` 设上下文。
4. **`web/`**（建议小改）：`?embedded=1` + `?return_to=` 显示「← 返回 SudoWork 管理端」面包屑。

所有 Dify 改动集中在 `api/controllers/sudowork/` 与 `api/services/sudowork/` 命名空间，与上游隔离，方便升级合并。

## 安全设计

| 风险 | 缓解 |
|---|---|
| SSO token 重放 | jti 一次性 + 5min exp + Redis 反重放 + HTTPS |
| Dify System Token 泄漏 | 仅服务端 + IP allowlist + 双 token 轮换 + 全调用入审计 |
| 跨企业越权 | sudowork-server 强校验 `req.user.enterprise_id == resource.enterprise_id`；Dify 侧 `X-Sudowork-Tenant` 双校验 |
| 用户绕过 SudoWork 调 Dify | API key 只存 sudowork-server SQLite，不出进程；Dataset `permission=only_me`；Dify 网络层只允许 sudowork-server 出口 IP / mTLS |
| 客户端窃取 token | 客户端只持 SudoWork JWT；从不接触 Dify token 与 API key |
| 文档泄漏 | Dify 部署客户内网 + KMS 加密向量库；sudowork-server 操作审计 |
| HMAC 密钥保管 | `DIFY_SSO_SECRET`、`DIFY_SYSTEM_SECRET`、`DIFY_SYSTEM_TOKEN` 三把分开，最小权限，不入 git |
| 审计 | sudowork-server `operation_logs` 追加 `dify_action / dify_app_id / dify_dataset_id`；Dify 侧 audit log 保留 |

## 部署拓扑

```
- sudowork-server   (现有 Docker / Bun)
- dify-api          (新增子网)
- dify-worker       (Celery)
- dify-plugin       (插件守护)
- dify-web          (Next.js，内网 + 仅管理员浏览器访问)
- postgres          (与 sudowork-server pg 复用 schema=dify 或独立实例)
- redis             (复用，namespace prefix 'dify:')
- weaviate / qdrant (按数据量定)
- nginx             (sudowork.example.com → server；dify.sudowork.example.com → dify-web)
```

环境变量（节选）：

```
# sudowork-server
DIFY_BASE_URL=https://dify-api.internal
DIFY_SSO_SECRET=...
DIFY_SYSTEM_SECRET=...
DIFY_SYSTEM_TOKEN=...

# dify
SUDOWORK_SSO_SECRET=...
SUDOWORK_SYSTEM_SECRET=...
SUDOWORK_SYSTEM_TOKEN=...
SUDOWORK_ALLOWED_IPS=10.0.0.0/8
```

## 分阶段路线图

| 阶段 | 周期 | 范围 |
|---|---|---|
| **P0 基线** | 1–2 周 | Dify 单租户 PoC + 手工建知识库 + Service API 跑通；sudowork-server 加 chat 透传接口；客户端能调一个固定 Dify Agent 验证端到端 |
| **P1 SSO + 多租户** | 2–3 周 | tenant_provisioning、sso_exchange、system_token；sudowork-server 管理端「跳转 Dify Studio」；DB 表落库；管理员能创建 App |
| **P2 助手与 ACL + 代理 API 全集** | 2 周 | assistant_acl、dify_app_binding、客户端按可见性拉助手；运行时鉴权；用量回写 ledger；客户端可调用的全套代理 API（chat/conversations/messages/files/feedback/suggested/parameters/meta/audio）|
| **P2.5 企业专属助手 + 预注入** | 1 周 | `SudohubClient` 封装；`EnterpriseAssistantService` 组合创建（sudohub + Dify + binding + ACL）；`/agents/visible` 改 sudohub-driven；`/enhancement/invoke` 与 `/enhancement/invoke-stream` 端点（agent-chat blocking / workflow streaming / rag-only dataset queries）；客户端 `enhancement.ts` 预注入工具；`getInstalledAssistantsWithVisibility` |
| **P2.5.1 知识增强双维度拆分** | 0.5 天 | **2026-06-22 完成**。废弃 `rag-only` 模式枚举，新增 `assistant_dataset_binding` 表；admin 表单改三选一（不启用 / 纯知识库 / Dify 增强）；运行时按"Dify 增强 mode + dataset_ids"两个维度独立判断；存量 rag-only 助手迁移到纯知识库分支并删除占位 Dify App。详见本文「知识增强：两个维度」一节 |
| **P2.6 admin SPA：企业助手管理页** | 0.5 周 | `EnterpriseAssistantList.tsx` 列表/创建/编辑/删除；multipart 表单（prompt.md + avatar 上传 + 分类 + 技能 + ACL + Dify 增强开关与模式）；详情 Drawer 含数据集多选 + 跳转 Dify Studio 按钮（**已于 2026-06-20 合并入「专属助手」菜单，详见 `2026-06-20-enterprise-assistants-merge-into-skillslist.md`**） |
| **P2.7 客户端 ACP 接入预注入** | 0.5 周 | `enhancementOrchestrator` per-session 缓存；`ipcBridge.dify.bindSession` / `unbindSession`；`AcpAgent.sendMessage` 两个无侵入钩子（preset 后追加 prelude + sendToConnection 前 augment user content） |
| **P2.7+ renderer 接入** | 0.5 周 | `sessionBinding.ts` helper（读 token / 解析 sudohub UUID / bind / unbind）；`useGuidSend` 两个创建分支注入 bind；`useGuidAgentSelection` 用 visibility 变体加载助手列表；`conversation/index.tsx` mount 时 rebind；`useConversationActions` 删除时 unbind；`assistantAdapter.fetchVisibleAssistantsAsConfigs` |
| **P3 RAG 挂载** | 1 周 | **2026-06-23 完成**。admin 新增「知识库」菜单（列表 / 新建 / 编辑 / 删除 / 文档管理 Drawer / 测试查询 Drawer）；后端 `routes/admin-datasets.ts` 9 个端点透传 Dify Service API（**未新增 Inner API**，Service API 完整覆盖）；`DifyClient` 扩展 `createDataset` / `updateDataset` / `deleteDataset` / `getDataset` / `listDatasetsServiceApi` / `listDocuments` / `createDocumentByText` / `createDocumentByFile` / `deleteDocument` / `retrieveDataset` 10 个方法；admin SPA 加 `DatasetsList.tsx` + 「知识库」侧栏菜单（DatabaseOutlined） |
| **P3.5 数据源插件** | 2 周（与 P4 并行） | UE / 代码 等格式做 Dify datasource plugin |
| **P3.5b 默认模型 provider 预装** | 1 天 | **2026-06-23 完成**。`dify/docker/sudowork-patches/default-plugins.json` 列 44 个主流 LLM provider；`seed-plugins.sh` 一次性下载 `.difypkg` 到 `volumes/plugin_daemon/plugin_packages/langgenius/` 并产出 `default-plugins.lock.json`；`tenant_provisioning_service.py` 创建 tenant 之后自动 install_from_local_pkg。新企业 provision 即装好 44 个 provider，admin SSO 进 Dify Studio 不需要再点"安装"。详见后文「P3.5b：模型 provider 预装」一节 |
| **P4 sudorouter 接入** | 1 周 | Dify Model Provider 接 sudorouter 统一计费/限流 |
| **P5 强化** | 1–2 周 | 审计、报表、token 轮换、备份、灰度开关、文档 |

## 待定与风险

1. SudoWork 是否有「部门」/「角色」概念？目前 ACL 预留 `department`，若无先支持 `user`/`all`；
2. sudorouter 与 Dify Model Provider 兼容性需 P0 验证；
3. Dify 升级合并冲突点：所有补丁限定在 `api/controllers/sudowork/`、`api/services/sudowork/`；
4. UE 文档具体格式（`.uasset` 或 markdown 镜像）待确认；
5. 个人模式无企业概念：分配伪企业 `personal-{user_id}`，Tenant 1:1；
6. sudohub schema 扩展可行性：取决于团队协作意愿，否则走二级映射表回退。

## P3.5b：模型 provider 预装（2026-06-23 完成）

### 背景

Dify 1.x 把模型 provider 拆成独立插件，部署完后管理员必须**手动**点「安装」才能配置（Anthropic / OpenAI / Gemini / 通义 …），每个 tenant 各装一遍。两个痛点：

1. **安装时联网**：Dify 默认调 marketplace.dify.ai 拉 `.difypkg`，离线环境跑不通
2. **管理员体验**：每开一个新企业租户都要把 20+ 个 provider 重新点一遍

### 方案：A（本地预缓存）+ B（自动批量装）

**方案 A — 本地缓存 .difypkg**

部署前在出口能联网的机器上跑一次：
```bash
dify/docker/sudowork-patches/seed-plugins.sh
```

脚本读 `default-plugins.json` 里的 47 个 provider spec，去 marketplace 解析每个 `<org>/<id>:<version>` → 完整 `unique_identifier`（含 sha256），下载 `.difypkg` 到 `dify/docker/volumes/plugin_daemon/plugin_packages/langgenius/`，并生成 `default-plugins.lock.json`（spec → unique_identifier 映射）。

之后离线环境只要把 `plugin_packages/` 目录和 lockfile 一起带上就够了。

**方案 B — tenant provisioning 自动批量装**

`dify/api/services/sudowork/tenant_provisioning_service.py` 在 Tenant + Account + ApiToken 创建完之后，**自动**调 `PluginService.install_from_local_pkg`，给新 tenant 装上 lockfile 里的所有 provider。

设计点：
- **逐个安装**：批量调一次 install_from_local_pkg([uid₁, uid₂, …]) 时，任何一个 plugin manifest enum 不兼容（如 `feature: polling` 这种 1.14.2 不认的值）整批就 abort。改成 `for uid in identifiers: install([uid])`，单个失败 log + skip，其他继续
- **本地包安装（关键）**：必须用 `install_from_local_pkg`，不要用同名近邻的 `install_from_marketplace_pkg`。后者会去 `marketplace.dify.ai` 现下载，离线环境必败；前者从 `volumes/plugin_daemon/plugin_packages/langgenius/<id>@<sha>/` 直接读 P3.5b 缓存，air-gapped 也能跑
- **best-effort**：plugin install 失败不阻塞 tenant 创建——一个没装好 plugin 的 tenant 可以让 admin 后续手动补，但一个半成品 tenant 极难清理
- **lazy import**：`from core.plugin.plugin_service import PluginService` 写在函数体内而不是模块顶端，避免 provisioning 模块加载时被某个 plugin_service 的 transitive failure 拖死。注意 PluginService 类在 `core.plugin.plugin_service`，不是 `services.plugin.plugin_service`（后者在历史版本曾存在，已被移除）

### 默认套餐（44 个，2026-06-23）

清单维护在 `dify/docker/sudowork-patches/default-plugins.json`，分四类：

- **海外闭源**：OpenAI / Anthropic / Gemini / Azure OpenAI / Azure AI Studio / Bedrock / Vertex AI / Cohere / Mistral / Groq / Fireworks / OpenRouter / TogetherAI / Replicate / xAI (Grok) / NVIDIA NIM / SageMaker
- **国内闭源**：DeepSeek / 通义 / 智谱 / Kimi (Moonshot) / 文心 (Wenxin) / 讯飞 (Spark) / MiniMax / Stepfun / SiliconFlow / Baichuan / 混元 / 零一万物 / 腾讯 / Novita / Gitee AI / PerfXCloud / Lepton AI
- **本地部署**：Ollama / Xinference / GPUStack / LocalAI
- **OpenAI 兼容 + Embedding**：OpenAI API Compatible / Jina / Voyage / Nomic / Hugging Face Hub / Hugging Face TEI

不在默认套餐里的（不兼容 Dify 1.14.2）：`volcengine:0.0.8`、`openllm:0.0.9`、`triton_inference_server:0.0.8` —— 它们 manifest 里有 `feature: polling` 之类的新 enum 值，1.14.2 客户端解析失败。等 Dify 升级再补。

### 运维流程

```
首次部署：
  ① bash dify/docker/sudowork-patches/seed-plugins.sh   # 出口机执行一次
  ② docker compose up -d                                 # 起服务
  ③ 用 sudowork-server 建第一个企业 → admin 自动装好 44 个 provider

新增 provider：
  ① 编辑 default-plugins.json 加一行
  ② bash seed-plugins.sh    # 重跑：已存在 .difypkg 跳过，新加项下载
  ③ docker compose restart api plugin_daemon  # 重载 lockfile 和 plugin daemon 索引

已有企业补装：
  docker exec docker-api-1 python -c "
  from app_factory import create_app
  _, app = create_app()
  with app.app_context():
      from services.sudowork.tenant_provisioning_service import _install_default_plugins
      _install_default_plugins('<dify_tenant_id>')
  "
```

### 容器挂载（关键）

`dify/docker/docker-compose.yaml` 的 `api` 和 `worker` service 各自加了：
```yaml
- ./sudowork-patches/default-plugins.json:/app/api/sudowork_patches/default-plugins.json:ro
- ./sudowork-patches/default-plugins.lock.json:/app/api/sudowork_patches/default-plugins.lock.json:ro
```

注意：Dify docker-compose 的 service 使用 `<<: *shared-api-worker-config` anchor，**但 anchor 里的 `volumes:` 会被 service 自己定义的 `volumes:` 整体覆盖**（YAML merge-key 对同名 map key 不会合并 list）。改 yaml 加新挂载时必须**同时改 anchor 和每个 service block**，不然 `docker compose up -d` 不会生效。

## TODO（待用户反馈后处理）

### TODO-1: Dify Studio 系统提示词与 prompt.md 的职责分工不直观

**背景**：在 admin 端创建 agent-chat 模式的专属助手时，管理员先填写 prompt.md（本地 ACP 主大脑指令），点击「Dify Studio」跳转后又看到一个空白的「提示词」输入框。这两段提示词分别约束不同进程里的不同 LLM 调用，**架构上不冲突**：

- `prompt.md` → 本地 ACP 主大脑（人格、对话风格、技能使用、消化 `<knowledge_context>`、给最终答案）
- Dify Studio 提示词 → Dify Agent 子大脑（被 ACP 调用的检索代理：用哪些知识库、用什么工具、返回什么格式的事实）

执行链路上两者永远不会拼到同一个 LLM context 里。但 UX 层面：
- 看起来像"同一个东西被清空"
- 普通管理员分不清"主助手"和"子智能体检索代理"的差别
- 子大脑提示词空着时，Dify Agent 会用默认人格回答，质量不可控

**当前临时方案（已实施）**：方案 3 —— 在 admin 端「Dify Studio」按钮 / 增强模式选择处加一段说明文字，告知管理员两段提示词的职责分工。
（实现位置预留：`admin/src/pages/SkillsList.tsx` 增强模式 Select 下方加 helper text，或 Dify Studio 跳转按钮 hover 提示）

**后续方向（等用户反馈再决策）**：

- **方案 1（推荐）：服务端自动派生 Dify 子大脑提示词**
  - 创建 agent-chat 助手时，server 端用 admin 填的 `name / profession / description` 自动合成子智能体提示词，通过 Dify Inner API（`/sudowork/system/apps/{app_id}/prompt`，待新增）推到 App 的 system prompt
  - 模板示例：
    ```
    你是「{{name}}」助手的知识检索代理。
    主助手角色：{{profession}}。
    {{description}}

    任务：
    - 给定用户问题，使用绑定的知识库与工具检索相关事实
    - 输出简洁、可引用，标注来源
    - 不要替主助手回答最终问题，专注于"提供事实和检索结果"
    ```
  - **同步语义**：只在 create 时写一次（"种子模式"），后续 admin 端修改 prompt.md 或 name 不会回推到 Dify Studio，避免覆盖管理员手改
  - 触点：`EnterpriseAssistantService.createEnterpriseAssistant` 在 `difySystem.createApp` 之后追加一次 Inner API 调用；Dify 侧补丁 `api/controllers/sudowork/system_apps.py` 加 `PATCH /apps/{app_id}/prompt`

- **方案 2（可叠加）：admin 创建表单加可选「Dify 子智能体提示词」字段**
  - agent-chat 模式下显示额外 TextArea，默认填方案 1 的派生模板，admin 可改后随提交同步到 Dify
  - 适用场景：实际跑起来后发现 admin 经常需要微调子大脑指令

**触发条件**：当用户反馈"小学历史助手"这类案例频繁出现 / 配置成本高 / 子大脑回答质量不稳定时，启动方案 1。

**相关讨论**：见 2026-06-22 与 zdd 的调试会话记录（`test 小学历史助手` 案例）。

### TODO-2: admin 创建的"老版本"助手没有 source_url（已修复，但存量需迁移）

**背景**：早期版本 admin 创建助手时只上传 `prompt.md`，未生成 source_zip → sudohub 记录 `source_url=null` → 客户端「专属助手」tab 无安装按钮。

**当前修复**：`EnterpriseAssistantService.ensureSourceZip()` 在 admin 未上传 zip 时自动用 `{name}.md` + 可选 avatar 拼一个最小 zip 传给 sudohub。**仅对新创建生效**。

**TODO**：写一个一次性迁移脚本扫所有 `dify_app_binding`（或直接遍历当前企业的 sudohub assistants），对 `source_url=null` 的记录用其 `prompt_file` 重新生成 source_zip 并通过 sudohub PATCH 接口回填。
（**触发条件**：当现存"无安装按钮"助手数量影响管理员/用户体验时启动）

### TODO-3: 存量 rag-only 助手迁移（生产环境若有需要再补脚本）

**背景**：2026-06-22 P2.5.1 双维度拆分后，DB 里可能还存在 `dify_app_binding.dify_app_mode = 'rag-only'` 的记录（带占位 Dify App）。新代码：
- `EnhancementInvocationService` 已不识别 `rag-only` → 落回"无增强"
- admin 表单已不再渲染 `rag-only` → 管理员无法回到旧状态修改

**开发环境处理**：直接 `DELETE FROM dify_app_binding WHERE dify_app_mode = 'rag-only';` 即可，Dify 侧的占位 App 任其残留（无任何运行时影响）。这是 2026-06-22 在本开发环境实际采取的处理方式。

**生产环境迁移（待用户反馈后再做）**：当生产环境出现存量时，再写一次性脚本：
1. 遍历 `dify_app_binding WHERE dify_app_mode = 'rag-only'`
2. 对每条记录：
   - 调 Dify `DELETE /sudowork/system/apps/{app_id}` 删占位 App（best-effort，失败可忽略）
   - DELETE FROM `dify_app_binding` 该行
3. 受影响助手在 admin 列表回归"未启用"状态；管理员需手动选「启用知识库（纯检索）」+ 重新关联 dataset
4. **不**自动恢复 dataset 关联：旧占位 App 当年压根没在 Dify Studio 配 dataset，无来源可恢复

## 验收

- 端到端：管理员在 sudowork-server 管理端创建一个 RAG 助手，挂载一个知识库，设可见用户 A；普通用户 A 在客户端能看到并对话，普通用户 B 看不到；
- 安全：直接调用 Dify Console / Service / Web API 三个接口（无 SudoWork token）均 401/403；
- 审计：每次助手对话在 sudowork-server `operation_logs` 与 Dify 内 message 表都能找到对应记录；
- 升级：拉一次 Dify 上游主分支，补丁文件无冲突或冲突可定位在 `api/controllers/sudowork/` 内。
