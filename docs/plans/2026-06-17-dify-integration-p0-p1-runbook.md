# Dify 接入 P0+P1+P2 联调 Runbook

**日期:** 2026-06-17
**状态:** 待联调
**配套设计:** `docs/plans/2026-06-17-dify-integration-design.md`

本文档覆盖 P0（最小直链）+ P1（SSO + 多租户）+ P2（助手 + ACL + 客户端全套代理 API）的联调步骤。已落地的代码变更摘要附在文末。

> **客户端 ↔ Dify 边界（必读）**：客户端代码不存在任何 Dify URL、token 或 API key。所有运行时操作（包括聊天、会话管理、文件上传、语音转录等）通过 sudowork-server 中转，sudowork-server 是唯一与 Dify 通信的实体。Dify Studio 仅在管理员浏览器中通过 SSO 跳转访问，与 Electron 客户端没有任何直接连接。

---

## 1. 三方密钥准备

在本机 / 联调环境生成三组随机串，记到一个临时文档里（联调结束后销毁）：

```bash
# DIFY_SSO_SECRET / SUDOWORK_SSO_SECRET（两侧必须一致）
openssl rand -base64 48

# DIFY_SYSTEM_SECRET / SUDOWORK_SYSTEM_SECRET（两侧必须一致）
openssl rand -base64 48

# DIFY_SYSTEM_TOKEN / SUDOWORK_SYSTEM_TOKEN（两侧必须一致）
openssl rand -base64 64
```

---

## 2. Dify 侧

**新增/修改文件**

- `api/configs/feature/__init__.py` — 新增 `SudoworkConfig`，并加入 `FeatureConfig` 组合
- `api/extensions/ext_blueprints.py` — 条件注册 sudowork 蓝图
- `api/controllers/sudowork/` — 新蓝图（`__init__.py` / `wraps.py` / `sso_exchange.py` / `tenant_provisioning.py` / `system_apps.py`）
- `api/services/sudowork/` — 新服务（`sso_service.py` / `tenant_provisioning_service.py`）
- `docker/envs/sudowork.env.example` — 配置示例

**启用步骤**

```bash
cd dify/docker
cp envs/sudowork.env.example envs/sudowork.env
# 把第 1 节生成的三对密钥粘贴进去，并把 SUDOWORK_INTEGRATION_ENABLED 置为 true
docker compose down
docker compose up -d
```

**冒烟自检**

```bash
# 关闭时（INTEGRATION_ENABLED=false）应该 404
curl -i http://localhost/sudowork/sso/exchange?token=x

# 打开后（INTEGRATION_ENABLED=true）应该 400（缺少 token）
curl -i http://localhost/sudowork/sso/exchange?token=

# system 端点：缺 bearer 应该 401，缺 X-Sudowork-Tenant 应该 400
curl -i -H "Authorization: Bearer $DIFY_SYSTEM_TOKEN" http://localhost/sudowork/system/apps
```

---

## 3. sudowork-server 侧

**新增/修改文件**

- `src/db/schema.ts` — 4 张新表
- `src/utils/aesCrypto.ts` — AES-256-GCM 工具
- `src/services/DifyClient.ts` — Dify 客户端（system / chat 透传 / dataset query）
- `src/services/DifySsoService.ts` — SSO JWT 签发
- `src/services/DifyTenantService.ts` — 按需 provision + 绑定
- `src/services/DifyAgentService.ts` — 助手 CRUD / ACL / 可见性派生
- `src/routes/admin-dify.ts` — 管理端路由
- `src/routes/agents.ts` — 用户端路由（含 SSE 透传）
- `src/index.ts` — 挂载
- `.env.example` — 新增 5 个 `DIFY_*` 变量

**启用步骤**

```bash
cd sudowork-server
# 在 .env 中补齐第 1 节生成的密钥；以及
#   DIFY_BASE_URL=http://localhost:5001   （联调时直连 Dify api 容器）
#   或 http://dify-api:5001   （容器内）
bun run src/index.ts
```

第一次启动会自动 `CREATE TABLE IF NOT EXISTS` 4 张新表，无需迁移脚本。

---

## 4. 端到端 smoke 流程

### 4.1 管理员 SSO（P1）

1. 拿一个 ENTERPRISE_ADMIN 用户登录 sudowork-server，得到 JWT；
2. 浏览器访问 `http://localhost:3000/api/v1/admin/dify/sso?next=/apps`；
3. 期望：sudowork-server 302 到 `http://localhost/sudowork/sso/exchange?token=…`，Dify 验通过后 Set-Cookie 并继续 302 到 `/apps`，最终落在 Dify Studio 已登录状态。

如果是首次访问，sudowork-server 内部会先调 Dify 的 provisioning（`POST /sudowork/system/tenants`），创建 Tenant + 系统操作员 Account + Service API key，并把加密 key 落进 `dify_tenant_binding`。

### 4.2 管理员创建一个助手（P1）

```bash
TOKEN=<sudowork admin JWT>
curl -X POST http://localhost:3000/api/v1/admin/dify/agents \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"调研助手","description":"试用","mode":"agent-chat"}'
```

返回 `data.assistant_id` 与 `data.dify_app_id`。同时可在 Dify Studio 看到新建的 App。

设置可见范围（让用户 id=42 能看到）：

```bash
curl -X PUT http://localhost:3000/api/v1/admin/dify/agents/<assistantId>/acl \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"entries":[{"subject_type":"user","subject_id":"42"}]}'
```

### 4.3 用户端调用（P0 + P2）

```bash
USER_TOKEN=<sudowork user JWT, user id=42>
BASE=http://localhost:3000/api/v1/agents

# 列可见助手
curl $BASE/visible -H "Authorization: Bearer $USER_TOKEN"

# 发起 SSE 对话
curl -N $BASE/<assistantId>/chat \
  -H "Authorization: Bearer $USER_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"hello"}'

# 中断（task_id 来自上一步 SSE 的某一帧）
curl -X POST $BASE/<assistantId>/chat/<taskId>/stop \
  -H "Authorization: Bearer $USER_TOKEN"

# 列会话
curl "$BASE/<assistantId>/conversations?limit=10" \
  -H "Authorization: Bearer $USER_TOKEN"

# 列消息
curl "$BASE/<assistantId>/conversations/<cid>/messages?limit=20" \
  -H "Authorization: Bearer $USER_TOKEN"

# 重命名 / 删除
curl -X PATCH $BASE/<assistantId>/conversations/<cid> \
  -H "Authorization: Bearer $USER_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"我的会话"}'
curl -X DELETE $BASE/<assistantId>/conversations/<cid> \
  -H "Authorization: Bearer $USER_TOKEN"

# 反馈
curl -X POST $BASE/<assistantId>/messages/<mid>/feedback \
  -H "Authorization: Bearer $USER_TOKEN" -H "Content-Type: application/json" \
  -d '{"rating":"like"}'

# 推荐下一句
curl $BASE/<assistantId>/messages/<mid>/suggested \
  -H "Authorization: Bearer $USER_TOKEN"

# 参数 schema / meta
curl $BASE/<assistantId>/parameters -H "Authorization: Bearer $USER_TOKEN"
curl $BASE/<assistantId>/meta -H "Authorization: Bearer $USER_TOKEN"

# 文件上传 (multipart)
curl -X POST $BASE/<assistantId>/files \
  -H "Authorization: Bearer $USER_TOKEN" \
  -F "file=@/path/to/sample.pdf"

# 语音转文字
curl -X POST $BASE/<assistantId>/audio-to-text \
  -H "Authorization: Bearer $USER_TOKEN" \
  -F "file=@/path/to/sample.wav"

# 文字转语音（返回 audio/mpeg）
curl -X POST $BASE/<assistantId>/text-to-audio --output /tmp/out.mp3 \
  -H "Authorization: Bearer $USER_TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"hello world"}'
```

期望：
- `chat` 看到 Dify 标准 SSE 流（`data: {"event":"message", ...}` 帧），结束时收到 `message_end`；
- 其余 JSON 接口返回 `{"success":true,"data":...}`，失败返回 `{"success":false,"msg":...}` 与对应 HTTP 状态码；
- 未授权用户对任意 `/agents/<assistantId>/*` 路径均得到 403。

### 4.4 客户端集成（P2 已落地的全部 IPC）

`ipcBridge.dify` 现在暴露三类调用，全部默认走 `sudowork-server.sudoprivacy.com`：

**Discovery + 流式聊天**
| Provider / Emitter | 说明 |
|---|---|
| `dify.getVisibleAgents({ accessToken })` | 返回当前用户可见助手列表 |
| `dify.startChat({ accessToken, assistantId, query, conversationId?, inputs?, files? })` | 启动 SSE，返回 `{ streamId }` |
| `dify.chunk` (emitter) | 每个 Dify 事件帧 `{ streamId, event, data }` |
| `dify.end` (emitter) | 流结束 `{ streamId, ok, error? }` |
| `dify.cancelChat({ streamId })` | 渲染进程主动中止 SSE |
| `dify.stopChatTask({ accessToken, assistantId, taskId })` | 告知 Dify 中止该任务（task_id 来自 chunk） |

**会话与消息**
| Provider | 说明 |
|---|---|
| `dify.listConversations({ accessToken, assistantId, lastId?, limit?, sortBy? })` | 列会话 |
| `dify.renameConversation({ accessToken, assistantId, conversationId, name?, autoGenerate? })` | 重命名（autoGenerate=true 让 Dify 自动起名） |
| `dify.deleteConversation({ accessToken, assistantId, conversationId })` | 删除 |
| `dify.listMessages({ accessToken, assistantId, conversationId, firstId?, limit? })` | 列消息（无限滚动） |
| `dify.sendFeedback({ accessToken, assistantId, messageId, rating, content? })` | 点赞/点踩，`rating` ∈ `'like' \| 'dislike' \| null` |
| `dify.getSuggested({ accessToken, assistantId, messageId })` | 推荐下一句 |

**元数据 + 多模态**
| Provider | 说明 |
|---|---|
| `dify.getParameters({ accessToken, assistantId })` | 助手输入表单 schema（首屏渲染） |
| `dify.getMeta({ accessToken, assistantId })` | 工具图标等 |
| `dify.uploadFile({ accessToken, assistantId, name, mimeType, bytes })` | 从 ArrayBuffer/Uint8Array 上传 |
| `dify.uploadFileFromPath({ accessToken, assistantId, filePath, mimeType? })` | 从磁盘上传（避免 IPC 大体积复制） |
| `dify.audioToText({ accessToken, assistantId, name, mimeType, bytes })` | 语音转文字 |
| `dify.textToAudio({ accessToken, assistantId, messageId? \| text?, voice?, streaming? })` | 文字转语音，**返回主进程临时文件路径**（渲染端 `<audio src=…>`） |

最小可运行示例：

```ts
// 1) 列出助手
const { data: agents = [] } = await ipcBridge.dify.getVisibleAgents.invoke({ accessToken });
const assistantId = agents[0]?.assistant_id;

// 2) 拉首屏 schema（如果助手需要 inputs）
const { data: schema } = await ipcBridge.dify.getParameters.invoke({ accessToken, assistantId });

// 3) 流式聊天
const { data } = await ipcBridge.dify.startChat.invoke({
  accessToken, assistantId, query: 'hello',
});
const streamId = data?.streamId;
let taskId = '';
ipcBridge.dify.chunk.on((c) => {
  if (c.streamId !== streamId) return;
  if (typeof c.data['task_id'] === 'string') taskId = c.data['task_id'] as string;
  // 渲染 c.event + c.data.answer / c.data.message 等
});
ipcBridge.dify.end.on((e) => { if (e.streamId === streamId) { /* finalize */ } });

// 4) 中断
await ipcBridge.dify.stopChatTask.invoke({ accessToken, assistantId, taskId });

// 5) 文件上传
await ipcBridge.dify.uploadFileFromPath.invoke({
  accessToken, assistantId, filePath: '/path/to/x.pdf', mimeType: 'application/pdf',
});

// 6) 点赞
await ipcBridge.dify.sendFeedback.invoke({
  accessToken, assistantId, messageId, rating: 'like',
});
```

> **不要**在渲染进程里去拼任何 `https://dify*` 或 `/v1/*` 的 URL —— 客户端代码已经不需要也不应该知道 Dify 的存在。

P0+P1 不动现有的 `assistantHub.getInstalledAssistants` 合并逻辑；P2 仅扩展 IPC 入口（不做 UI 合并），UI 端的合并/选择器调整放到 P2+UI（独立的前端任务）。

---

## 5. 验收 checklist

| 项 | 预期 |
|---|---|
| Dify `SUDOWORK_INTEGRATION_ENABLED=false` 时所有 `/sudowork/*` 路径 404 | ✅ |
| 管理员 SSO 跳转能落地到 Dify Studio 已登录态 | ✅ |
| 同一管理员重复 SSO 不重复建 Tenant | ✅（sudowork-server 的 binding 表幂等） |
| sudowork-server 重启后 `dify_tenant_binding.api_key` 仍可用 | ✅ |
| 普通用户 `GET /agents/visible` 只看到自己被 ACL 命中的助手 | ✅ |
| 普通用户对未授权助手任一 `/agents/:id/*` 子路径返回 403 | ✅ |
| 客户端可执行 chat/会话/消息/反馈/推荐/参数/meta/文件/语音 全套操作，全部经 sudowork-server | ✅ |
| 客户端代码 grep `dify-api` / `/v1/chat-messages` / Dify token 均无匹配 | ✅ |
| 直连 Dify Service API（不经 sudowork-server）需要 API key —— key 不在客户端 | ✅ |
| 同一 SSO token 在 5 分钟内重复使用第二次返回 401 | ✅（Dify 侧 jti nonce） |

---

## 7. P2.5 联调（企业专属助手 + 预注入）

### 7.1 创建一个 Dify 增强的企业专属助手

```bash
TOKEN=<sudowork admin JWT>
BASE=http://localhost:3000/api/v1/admin/dify

curl -X POST $BASE/enterprise-assistants \
  -H "Authorization: Bearer $TOKEN" \
  -F "name=招聘助手-增强版" \
  -F "profession=招聘专家" \
  -F "description=企业内招聘智囊，结合公司薪酬制度与简历库" \
  -F "categories=[\"运营人力\"]" \
  -F "prompt_file=@./prompts/recruitment.md" \
  -F "avatar=@./avatars/recruitment.png" \
  -F "enable_enhancement=true" \
  -F "enhancement_mode=agent-chat" \
  -F "acl_entries=[{\"subjectType\":\"user\",\"subjectId\":\"42\"}]"
```

期望响应：
```json
{
  "success": true,
  "data": {
    "assistantId": "30ae1f95-...",
    "difyAppId": "d1f-9870-...",
    "difyAppMode": "agent-chat",
    "enhancement": { "mode": "agent-chat" }
  }
}
```

### 7.2 用户端可见性

```bash
USER_TOKEN=<sudowork user JWT, user id=42>
curl http://localhost:3000/api/v1/agents/visible \
  -H "Authorization: Bearer $USER_TOKEN" | jq '.data[] | {assistant_id, name, enhancement}'
```

应该看到刚创建的助手，`enhancement.enabled = true`、`mode = agent-chat`。

把用户换成 id=43（不在 ACL 内）再请求一次，列表里不应出现这个助手。

### 7.3 调一次增强（agent-chat / rag-only blocking）

```bash
curl -X POST http://localhost:3000/api/v1/agents/<assistantId>/enhancement/invoke \
  -H "Authorization: Bearer $USER_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"我们公司对于初级岗位预算超支怎么处理?"}' | jq
```

期望：
```json
{
  "success": true,
  "data": {
    "text": "根据公司薪酬制度...",
    "mode": "agent-chat",
    "elapsedMs": 2143
  }
}
```

### 7.4 调一次 workflow streaming

```bash
curl -N -X POST http://localhost:3000/api/v1/agents/<workflowAssistantId>/enhancement/invoke-stream \
  -H "Authorization: Bearer $USER_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"请评估这位候选人"}'
```

应当看到 SSE 流：
```
event: progress
data: {"kind":"progress","step":"提取简历字段"}

event: progress
data: {"kind":"progress","step":"匹配岗位要求"}

event: progress
data: {"kind":"progress","step":"综合打分"}

event: result
data: {"kind":"result","text":"候选人评分 ...","mode":"workflow","elapsedMs":8421}
```

### 7.5 客户端 IPC 示例（renderer 侧）

```ts
// session 启动时
const enh = await ipcBridge.dify.getEnhancement.invoke({ accessToken, assistantId });

// 用户提交一轮消息
async function sendMessage(userInput: string) {
  let augmented = userInput;
  if (enh.data?.enabled && enh.data.mode === 'workflow') {
    // streaming + progress
    const start = await ipcBridge.dify.startEnhancement.invoke({
      accessToken, assistantId, query: userInput,
    });
    const { streamId } = start.data!;
    const result = await new Promise<string>((resolve) => {
      ipcBridge.dify.enhancementProgress.on((p) => {
        if (p.streamId === streamId) showProgressRow(`🟢 ${p.step}`);
      });
      ipcBridge.dify.enhancementResult.on((r) => {
        if (r.streamId === streamId) resolve(r.text);
      });
    });
    augmented = `<knowledge_context source="enterprise_knowledge_agent" mode="workflow">\n${result}\n</knowledge_context>\n\n${userInput}`;
  } else if (enh.data?.enabled) {
    // agent-chat / rag-only — blocking
    const r = await ipcBridge.dify.invokeEnhancement.invoke({
      accessToken, assistantId, query: userInput,
    });
    if (r.success && r.data?.text) {
      augmented = `<knowledge_context source="enterprise_knowledge_agent" mode="${r.data.mode}">\n${r.data.text}\n</knowledge_context>\n\n${userInput}`;
    }
  }
  // 把 augmented 发给本地 ACP（原路径不动）
  await sendToLocalAcp(augmented);
}
```

或者直接使用打包好的 helper：

```ts
// process/services/dify/enhancement.ts 已提供
import { augmentMessage, probeEnhancement, getEnhancementPromptSuffix } from '@process/services/dify/enhancement';

const meta = await probeEnhancement(accessToken, assistantId);
const systemSuffix = getEnhancementPromptSuffix(meta);  // 加到 .md 末尾

// 每轮：
const result = await augmentMessage({
  accessToken, assistantId, meta, query: userInput,
  onProgress: (step) => showProgressRow(step),
});
const messageToSend = result?.augmentedMessage ?? userInput;
```

### 7.6 P2.5 验收

| 项 | 预期 |
|---|---|
| 管理员能在一个表单里完成 sudohub assistant 创建 + Dify App 创建 + ACL 设置 | ✅ |
| 任一步失败时反向补偿（无僵尸 Dify App / 无僵尸 sudohub assistant） | ✅ |
| `/agents/visible` 同时返回普通 sudohub 助手与企业专属助手，且按 ACL 过滤 | ✅ |
| 普通用户对未授权助手的 `/enhancement/invoke` 返回 404（无 binding） | ✅ |
| `agent-chat` 模式的 blocking 调用返回完整 text | ✅ |
| `workflow` 模式的 streaming 调用，客户端能看到 node-by-node 的 progress 事件 | ✅ |
| `rag-only` 模式调用走 dataset queries，无 LLM 消耗，返回拼接 passages | ✅ |
| 本地 ACP 接到 `<knowledge_context>` 包裹的 user message 后正常处理，`.md` 人格、本地 skills 仍生效 | ✅ |
| 客户端 grep `dify-api` / `/v1/chat-messages` / Dify API key 均无匹配 | ✅ |

---

## 8. P2.6 + P2.7 + P3 联调（管理 UI 与客户端无侵入接入）

### 8.1 admin SPA 跑通

```bash
cd sudowork-server/admin
bun install
bun run build         # 输出到 ../admin-dist
cd ..
bun run src/index.ts
```

访问 `http://localhost:3000`，管理员登录后侧栏多了「企业助手 (Dify 增强)」入口。

操作：
- 点"新建助手" → 填基础信息 → 上传 .md → 选可见范围 → 勾选 Dify 增强并选模式 → 保存
- 创建成功后列表新出现一条；行尾有"编辑 / Dify Studio / 删除"三个操作
- 点"编辑" → Drawer 打开 → 可改增强模式 / 数据集挂载 / 可见范围
- 点"Dify Studio" → 新标签页打开 SSO 跳转到 Dify App 配置页

### 8.2 客户端无侵入接入（P2.7）

客户端代码改动只有"挂钩点"，不需要 renderer 立刻改：

| 改动 | 触发时机 |
|---|---|
| `AcpAgent.sendMessage` 中 `enhancePresetContext()` | 每轮 user 发送前；session 未 bind 时短路 |
| `AcpAgent.sendMessage` 中 `augmentUserContent()` | 同上 |
| `ipcBridge.dify.bindSession({ conversationId, accessToken, assistantId })` | 新接口，renderer 在创建会话后调一次 |
| `ipcBridge.dify.unbindSession({ conversationId })` | renderer 在关闭会话后调一次（可选；过期 session 不调用也无害） |

renderer 最小集成示例：

```ts
// 创建会话后立刻绑定：
async function startChatSession(assistantMeta: IAssistantInfo) {
  const conversationId = await createConversation(assistantMeta);
  const accessToken = localStorage.getItem('access_token');
  const assistantId = assistantMeta.meta.id; // sudohub 助手 UUID
  if (accessToken && assistantId) {
    await ipcBridge.dify.bindSession.invoke({
      conversationId, accessToken, assistantId,
    });
  }
  return conversationId;
}

// 关闭会话时解绑（可选）：
ipcBridge.dify.unbindSession.invoke({ conversationId });
```

绑定后：
- 用户输入 → AcpAgent 自动调用 `augmentUserContent` 拼 `<knowledge_context>` 块
- system prompt 末尾自动追加 ENHANCEMENT_PRELUDE
- workflow 模式的 node-by-node 进度通过 `dify.enhancementProgress` emitter 透出（如想展示，listener 自行接入）

**没有绑定的会话**（包括所有 local-only sudohub 助手）：一切如旧，零开销。

### 8.3 验收对照表

| 项 | 预期 |
|---|---|
| admin SPA 能从一个表单创建出 sudohub 助手 + Dify App + 绑定 + ACL | ✅ |
| admin Drawer 能调整可见范围、增强模式、数据集挂载 | ✅ |
| admin 点"Dify Studio"按钮，新标签页落地到 Dify App 配置页（已登录） | ✅ |
| 普通用户重新登录后客户端能看到 admin 创建的助手（前提：在 ACL 内） | ✅ |
| 客户端给一个 Dify 增强助手发消息时，本地 ACP 收到的 prompt 含 `<knowledge_context>` 块 | ✅ |
| 不绑定的 plain sudohub 助手 / local 助手聊天行为不变 | ✅ |
| workflow 模式聊天时主进程能拉到 node-level progress 事件 | ✅ |
| sudowork-server 重启后客户端 next message 自动重新 bindSession 并恢复增强 | ✅ renderer 在 conversation/index.tsx mount 时自动 rebind |

---

## 9. renderer 接入（P2.7 续：已落地）

### 9.1 落地内容总览

| 文件 | 改动 |
|---|---|
| `src/common/ipcBridge.ts` | 新增 `assistantHub.getInstalledAssistantsWithVisibility` provider |
| `src/process/bridge/assistantHubBridge.ts` | 实现 visibility provider，调用 `assistantManager.getInstalledAssistantsWithVisibility(accessToken)` |
| `src/renderer/shared/dify/sessionBinding.ts` （新） | `readAccessToken` / `resolveSudohubAssistantId` / `bindAssistantSession` / `unbindAssistantSession` |
| `src/renderer/shared/agents/assistantAdapter.ts` | 新增 `fetchVisibleAssistantsAsConfigs(accessToken)` |
| `src/renderer/pages/guid/hooks/useGuidSend.ts` | 在 `remote-agent` 与 `acp` 两个 conversation 创建分支后注入 `bindAssistantSession` |
| `src/renderer/pages/guid/hooks/useGuidAgentSelection.ts` | 助手列表加载切换到 `fetchVisibleAssistantsAsConfigs` |
| `src/renderer/pages/conversation/index.tsx` | 会话页 mount 时调用 `bindAssistantSession` 做 rebind（覆盖应用重启 / 切换会话场景） |
| `src/renderer/pages/conversation/grouped-history/hooks/useConversationActions.ts` | 删除会话时 `unbindAssistantSession` 清理主进程缓存 |

### 9.2 token 读取规则

```
优先 'eeclaw_auth_v1'（企业模式）→ access_token
回退 'sudowork_auth_v2'（个人模式）→ access_token
两者都没有 → null（不发起 bind，所有功能降级为旧行为）
```

读 token 集中在 `sessionBinding.readAccessToken`，未来若改 storage key 只需要改这一处。

### 9.3 端到端验证

**Case A**：管理员创建一个 agent-chat 增强助手 → 设可见用户为 A → 用户 A 在客户端
1. 列表加载：`useGuidAgentSelection` → `fetchVisibleAssistantsAsConfigs` → 主进程 `getInstalledAssistantsWithVisibility(token)` → 看到该助手；用户 B 同样路径看不到。
2. 用户 A 点击助手 → `useGuidSend` 创建 conversation → 立即 `bindAssistantSession({ conversationId, presetAssistantIdOrName })` 把（accessToken, assistantUUID）灌进 orchestrator。
3. 用户 A 发消息 → AcpAgent.sendMessage → `enhancePresetContext` 给 .md 追加 prelude → `augmentUserContent` 包 `<knowledge_context>` → 本地 ACP 看到融合后的 user message。
4. 用户 A 关闭客户端再打开 → 会话页 mount → 重新 `bindAssistantSession` → 后续消息继续增强。
5. 用户 A 删除会话 → `unbindAssistantSession` 释放主进程的 binding。

**Case B**：助手未启用增强（plain sudohub 助手）→ bindAssistantSession 走完一遍，主进程 probe 后 `meta.enabled=false`，augmentUserContent 直接返回原文。零开销。

**Case C**：网络断开 → probeEnhancement 失败 → 主进程视为 disabled，发消息无任何 Dify 注入，本地 ACP 正常运行。降级稳定。

### 9.4 注意事项

- `bindAssistantSession` 故意做成幂等：renderer 可以反复调用（mount / 切换 / 重新登录）；主进程后写入覆盖前一次。
- 删除会话后 `unbindAssistantSession` 是 best-effort —— 即使没调，主进程那条记录也只占很小内存，下次重启时清空。
- `fetchVisibleAssistantsAsConfigs` 在无 token 时降级到老的 `fetchAssistantsAsConfigs`，保证未登录态 / 个人模式列表行为不变。
- 注入位点是动态 `import('@/renderer/shared/dify/sessionBinding')` —— 避免影响首屏 bundle 体积，且让 dify 模块对非聊天页面完全透明。

---

## 6. 已知待补

- 客户端 UI 合并 Dify 助手到现有助手列表（属 P2）。
- sudohub schema 是否扩展 `dify_app_id` 字段尚未确认；目前 `createAgent` 会本地生成 assistant_id，等 sudohub 接入后再切换。
- Dify 内 `Tenant.custom_config` 仅记录 `sudowork_enterprise_code` 作 debug 用，没建索引；规模大时（>1万 tenant）再考虑。
- 部门 / 角色级 ACL：表已预留 `subject_type='department'`、`subject_type='role'`，但 `userCanSeeAgent` 查询尚未派生这两种主体（等 SudoWork 增加对应字段后再补）。
