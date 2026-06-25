# 「企业助手 (Dify 增强)」合并入「专属助手」菜单 — 设计

**日期:** 2026-06-20
**状态:** 待评审
**关联:** `docs/plans/2026-06-17-dify-integration-design.md`、`docs/plans/2026-06-17-dify-integration-p0-p1-runbook.md`

---

## 1. 背景

P2.6 落地的「企业助手 (Dify 增强)」（`EnterpriseAssistantList.tsx`）是一个**独立菜单 + 独立页面**。但本质上：

- 在 sudohub 那侧，它**就是一条普通 assistant**（`POST /api/assistants` 创建，`tenantId=企业 code`，跟「专属助手」页面里看到的 `jiansheku` 是同一张表）。
- 在 sudowork-server 侧多两张**侧车记录**：
  - `dify_app_binding` 关联 Dify App
  - `assistant_acl` 控制可见范围
- 这两条记录**都可以为空**（即"无 Dify 增强 + 全员可见"，就是一条 plain sudohub 助手）。

因此「企业助手 (Dify 增强)」**应该与「专属助手」合并为同一个菜单**：合并后既保留对老 plain 助手的浏览/审批/删除能力，又承担新建 Dify 增强助手 / 调可见性 / 跳 Dify Studio 的入口。

同时，本次也修复一个不一致点：所有 `/admin/dify/*` 路由都强制读 `user.enterprise_id`，super admin 直接 400。这与现有 SkillsList 的「超管下拉选企业」模式不对齐，需要改为**`enterprise_id` 入参化**。

## 2. 目标

- 删掉左侧菜单的「企业助手 (Dify 增强)」入口，所有功能合并入「专属助手」(`/assistants`) 页面。
- 服务端 `/admin/dify/*` 系列路由全部支持 super admin 通过查询参数 / 请求体显式指定 `enterprise_id`；企业管理员维持原有自动绑定企业的语义。
- 「专属助手」页面对所有用户视觉一致；操作按钮按角色 / 增强状态条件渲染。
- 不动 sudohub。

## 3. 概念约定（合并后）

| 名词 | 含义 | 在新「专属助手」页里如何识别 |
|---|---|---|
| **plain 专属助手** | 仅在 sudohub 存在（无 binding 无 ACL）。可能是历史 zip 上传，也可能是别人在 sudohub 后台直接建的。 | "Dify 增强"列 → 灰色 "未启用"；"可见范围"列 → "企业全员" |
| **Dify 增强专属助手** | sudohub + 本地 `dify_app_binding` + 可选 `assistant_acl` 都有 | "Dify 增强"列 → 蓝色 tag（mode）；"可见范围"列 → 全员 / N 位用户 |

两类助手**在同一个表格里混合展示**，超管视角下默认按 sudohub `tenant_id` 过滤；企业管理员永远只看本企业。

## 4. 服务端改动

### 4.1 路由列表（按改动类型分组）

#### 4.1.1 现有不动

```
GET    /api/v1/assistants/cursor                  代理 sudohub 列表 (super admin / enterprise admin 都用; 已支持 tenant_id query)
POST   /api/v1/assistants/{id}/approve            代理 sudohub
DELETE /api/v1/assistants/{id}                    代理 sudohub
```

> 这些是 SkillsList 当前已经在调的。维持不动。

#### 4.1.2 现有强化（关键改动）

> 当前实现：`user.enterprise_id` 强制取 JWT 里的；super admin = null → 400。
>
> 新规则：**super admin** 可通过查询参数 / 请求体显式传 `enterprise_id`；**enterprise admin** 必须用自己 JWT 的 enterprise_id，传任何别的值都返回 403。

涉及的路由（全部在 `src/routes/admin-dify.ts`）：

| 路由 | 改动 |
|---|---|
| `GET  /admin/dify/enterprise-assistants` | 支持 `?enterprise_id=X` |
| `GET  /admin/dify/datasets` | 同上 |
| `GET  /admin/dify/agents/:id/datasets` | 同上 |
| `PUT  /admin/dify/agents/:id/datasets` | body 加可选 `enterprise_id` |
| `PUT  /admin/dify/agents/:id/acl` | 同上 |
| `POST /admin/dify/enterprise-assistants` | multipart 加可选 `enterprise_id` field |
| `PUT  /admin/dify/enterprise-assistants/:id/enhancement` | body 加可选 `enterprise_id` |
| `GET  /admin/dify/enterprise-assistants/:id/enhancement` | 同上 |
| `GET  /admin/dify/sso` | query 加可选 `enterprise_id`（用于超管直接以某企业身份打开 Dify Studio） |
| `GET  /admin/dify/binding` / `POST /admin/dify/binding/provision` | query / body 加可选 `enterprise_id` |
| `GET  /admin/dify/agents` / `GET  /admin/dify/agents/:id` / `DELETE /admin/dify/agents/:id` | query 加可选 `enterprise_id` |

#### 4.1.3 抽取的 helper

新增一个共用 helper：

```ts
// src/services/AdminEnterpriseResolver.ts
export function resolveAdminEnterpriseId(
  c: Context,
  source: { query?: string; body?: { enterprise_id?: number | string } },
): { ok: true; enterpriseId: number } | { ok: false; status: 400 | 403; msg: string } {
  const user = c.get('user');
  const requested = source.query
    ? Number(c.req.query(source.query))
    : source.body?.enterprise_id != null
      ? Number(source.body.enterprise_id)
      : null;

  if (user.role === 'SUPER_ADMIN') {
    if (requested == null || Number.isNaN(requested)) {
      return { ok: false, status: 400, msg: 'super admin must specify enterprise_id' };
    }
    // 校验企业存在
    const row = db.prepare('SELECT id FROM enterprises WHERE id = ?').get(requested);
    if (!row) return { ok: false, status: 400, msg: `enterprise ${requested} not found` };
    return { ok: true, enterpriseId: requested };
  }

  // 企业管理员
  if (user.enterprise_id == null) {
    return { ok: false, status: 400, msg: 'user has no enterprise' };
  }
  if (requested != null && requested !== user.enterprise_id) {
    return { ok: false, status: 403, msg: 'cannot operate on another enterprise' };
  }
  return { ok: true, enterpriseId: user.enterprise_id };
}
```

每个路由起手都调一次这个 helper，把当前的 `user.enterprise_id` 全部替换为 `resolveAdminEnterpriseId(...).enterpriseId`。

> 这一个 helper 既保留了"企业管理员只能操作自己企业"的安全语义，又让超管能跨企业操作；且 super admin 漏传 `enterprise_id` 直接 400 提示，避免误操作落到错企业。

### 4.2 SQL 层语义

所有针对 `dify_app_binding` / `dify_dataset_binding` / `assistant_acl` 的查询，`WHERE enterprise_id = ?` 用 helper 返回的 `enterpriseId` 即可。原有 SQL 不需要重写。

## 5. 前端改动

### 5.1 删除 / 改回的页面

- **删菜单项**：`App.tsx` 中 `{ key: "/enterprise-assistants", ... }` 这一行删掉
- **删路由**：`<Route path="enterprise-assistants" element={<EnterpriseAssistantList />} />` 删掉
- **`EnterpriseAssistantList.tsx`**：暂时不删（保留作 reference），新代码迁完后再删
- **菜单文案保留**：「专属助手」继续叫这个名

### 5.2 重构 `SkillsList.tsx`（仅 assistants 分支）

`SkillsList.tsx` 现在用 `assetType="skills" | "assistants"` 两种模式复用。skills 分支零改动；以下只动 **assistants 分支**。

#### 5.2.1 新增 state

```ts
// 当前选中的 enterprise_id（数值），由 selectedEnterprise (code) 派生，
// 给本次 Dify-相关接口当查询参数用。skills 分支无视它。
const selectedEnterpriseId = useMemo(() => {
  if (!isSuperAdmin) return undefined;
  const e = enterprises.find(e => e.code === selectedEnterprise);
  return e?.id;
}, [selectedEnterprise, enterprises, isSuperAdmin]);

// 当前页面所有助手的 ACL/binding 信息一次性带回，避免一行一请求
const [enhancementMap, setEnhancementMap] = useState<Record<string, {
  enabled: boolean;
  mode?: 'agent-chat' | 'workflow' | 'rag-only';
  dify_app_id?: string;
}>>({});
const [aclMap, setAclMap] = useState<Record<string, {
  scope: 'all' | 'specific';
  user_ids: string[];
}>>({});

// 创建/编辑面板状态
const [createOpen, setCreateOpen] = useState(false);
const [editingRow, setEditingRow] = useState<Assistant | null>(null);
const [drawerOpen, setDrawerOpen] = useState(false);
```

#### 5.2.2 数据加载

`loadAssistants` 末尾**并发**调用一次新端点拿增强 + ACL 概要：

```ts
const meta = await adminApi.getEnterpriseAssistants({ enterprise_id: selectedEnterpriseId });
// meta.data 是 [{assistant_id, enhancement, acl_summary}] —— sudowork-server 已实现
const nextEnh: typeof enhancementMap = {};
const nextAcl: typeof aclMap = {};
for (const row of meta.data || []) {
  nextEnh[row.assistant_id] = row.enhancement;
  nextAcl[row.assistant_id] = row.acl_summary;
}
setEnhancementMap(prev => ({ ...prev, ...nextEnh }));
setAclMap(prev => ({ ...prev, ...nextAcl }));
```

> sudohub cursor 与 enterprise-assistants 这一次性 join 二选一不冲突：前者拿到的列表里**包含**那些没有 binding 的 plain 助手，后者只给有 binding/ACL 的助手附属信息。两者用 `assistant_id` 关联起来即可。

#### 5.2.3 表格列扩展

`assistantColumns` 在原有"名称 / 版本 / 分类 / 状态 / 更新时间 / 操作"基础上插入两列：

```tsx
{
  title: 'Dify 增强',
  key: 'enhancement',
  width: 160,
  render: (_: any, row: Assistant) => {
    const e = enhancementMap[row.id];
    if (!e?.enabled) return <Tag>未启用</Tag>;
    return <Tag color="blue">{ENH_MODE_LABEL[e.mode || 'agent-chat']}</Tag>;
  },
},
{
  title: '可见范围',
  key: 'acl',
  width: 130,
  render: (_: any, row: Assistant) => {
    const a = aclMap[row.id];
    if (!a || a.scope === 'all') return <Tag color="green">企业全员</Tag>;
    return <Tag color="orange">{a.user_ids.length} 位用户</Tag>;
  },
},
```

#### 5.2.4 操作列扩展

原有 actions：「查看详情 / 下载 / 删除」；保留，**前面新增**：

```tsx
<Button size="small" type="link" icon={<SettingOutlined />}
  onClick={() => openEditDrawer(row)}>
  编辑
</Button>
<Button size="small" type="link" icon={<LinkOutlined />}
  disabled={!enhancementMap[row.id]?.enabled}
  onClick={() => openInStudio(row)}>
  Dify Studio
</Button>
```

「编辑」打开抽屉：与原 `EnterpriseAssistantList.tsx` 里的 Drawer 完全一致（增强开关 + mode + 挂数据集 + 可见范围）。

#### 5.2.5 标题栏右上角加按钮

```tsx
<div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
  <Title level={2}>专属助手</Title>
  {!isSkillsPage && (
    <Button type="primary" icon={<PlusOutlined />}
      disabled={isSuperAdmin && !selectedEnterprise}
      onClick={() => setCreateOpen(true)}>
      新建助手
    </Button>
  )}
</div>
```

> 超管必须先选企业；企业管理员永远可用。

#### 5.2.6 创建 Modal

完全移植 `EnterpriseAssistantList.tsx` 里 `<Modal title="新建企业助手">` 部分，只在提交时多带一个 `enterprise_id`（超管时取 `selectedEnterpriseId`，企业管理员可省略）。

### 5.3 admin API client 调整

```ts
// admin/src/api/index.ts —— 全部 dify 系列 endpoint 增加 enterprise_id 可选参数

getEnterpriseAssistants: (params?: { enterprise_id?: number }) =>
  api.get('/v1/admin/dify/enterprise-assistants', { params }),

getDifyDatasets: (params?: { enterprise_id?: number }) =>
  api.get('/v1/admin/dify/datasets', { params }),

createEnterpriseAssistant: (form: FormData) =>
  api.post('/v1/admin/dify/enterprise-assistants', form, { headers: ... }),
  // 超管时, form 里 append('enterprise_id', String(selectedEnterpriseId))

setEnterpriseAssistantEnhancement: (assistantId: string, data: {
  enable: boolean;
  mode?: 'agent-chat' | 'workflow' | 'rag-only';
  app_name?: string;
  enterprise_id?: number;  // 超管必传
}) => api.put(`/v1/admin/dify/enterprise-assistants/${assistantId}/enhancement`, data),

setAgentAcl: (assistantId: string, entries: AclEntry[], enterprise_id?: number) =>
  api.put(`/v1/admin/dify/agents/${assistantId}/acl`, { entries, enterprise_id }),

setAgentDatasets: (assistantId: string, datasetIds: string[], enterprise_id?: number) =>
  api.put(`/v1/admin/dify/agents/${assistantId}/datasets`, { dataset_ids: datasetIds, enterprise_id }),

getAgentDatasets: (assistantId: string, enterprise_id?: number) =>
  api.get(`/v1/admin/dify/agents/${assistantId}/datasets`, { params: { enterprise_id } }),

getDifyStudioLink: (next?: string, enterprise_id?: number) =>
  api.get('/v1/admin/dify/sso', { params: { next, enterprise_id } }),
```

## 6. 数据权限矩阵（合并后）

| 操作 | super admin | enterprise admin | 普通用户 |
|---|---|---|---|
| 列出某企业助手 | ✅ 选企业后可看任意企业 | ✅ 仅本企业 | ❌ |
| 新建助手 | ✅ 必须选企业 | ✅ 自动落本企业 | ❌ |
| 编辑增强 / ACL / 数据集 | ✅ 跨企业 | ✅ 仅本企业 | ❌ |
| 删除 | ✅ 跨企业 | ✅ 仅本企业 | ❌ |
| 审批上线 (sudohub) | ✅ | ✅ | ❌ |
| 跳 Dify Studio | ✅ 以选定企业身份 SSO | ✅ 以本企业身份 SSO | ❌ |

> 在服务端层面，企业管理员请求里如果带了别人的 `enterprise_id` → 直接 403，不依赖前端把守。

## 7. 实施步骤（按可独立验收的小步切分）

### Phase 1：服务端入参化（先行；前端旧路由也照常工作）

1. 新增 `AdminEnterpriseResolver.ts` helper
2. 把 `admin-dify.ts` 中**所有**直接用 `user.enterprise_id` 的位点改为 helper 调用
3. 冒烟：
   - super admin 不传 `enterprise_id` → 400
   - super admin 带合法 `enterprise_id=1` → 200
   - enterprise admin 不传 → 200（沿用 JWT）
   - enterprise admin 带自己企业 → 200
   - enterprise admin 带别人企业 → 403

### Phase 2：前端 SkillsList.assistants 分支扩列 + actions

1. `admin/src/api/index.ts` 加 `enterprise_id` 可选参数
2. `SkillsList.tsx` 加 `enhancementMap` / `aclMap` 加载逻辑
3. 表格新增「Dify 增强」「可见范围」两列
4. 操作列加「编辑」「Dify Studio」两按钮（编辑暂时弹一个 placeholder 抽屉，下阶段填充）
5. 验收：
   - 老 plain 助手两列分别显示「未启用」「企业全员」
   - 新建的 Dify 增强助手两列正确

### Phase 3：把创建 Modal + 编辑 Drawer 移植过来

1. 从 `EnterpriseAssistantList.tsx` 复制 Modal/Drawer JSX 进入 SkillsList
2. 复用 admin API client 已有方法
3. 表单提交时根据角色自动拼 `enterprise_id`
4. 验收：
   - 创建（plain）：勾选不启用增强 + 全员可见 → 与之前在 sudohub 后台直接建效果一致
   - 创建（Dify 增强）：与 `EnterpriseAssistantList` 行为一致
   - 编辑可见范围 / 切换增强模式 / 挂数据集 → 行为一致

### Phase 4：清理

1. `App.tsx` 删菜单项 `/enterprise-assistants` 与对应 Route
2. `EnterpriseAssistantList.tsx` 删除文件
3. admin API client 删掉不再使用的方法（如有重复）
4. 文档更新：在 `2026-06-17-dify-integration-design.md` 第 P2.6 段加一句"已合并到专属助手菜单"

## 8. 兼容与回滚

- Phase 1（后端入参化）**完全向后兼容**：原路由不传 enterprise_id 时行为不变；前端旧版本不需要任何改动也能继续跑。
- Phase 2/3 前端改动**只对 assistants 分支**生效，skills 分支零影响。
- 回滚：把改动按 phase 倒序回退即可；服务端 helper 即使保留也不影响老前端。

## 9. 后续优化（不阻塞本次合并）

- 列表筛选加「仅看 Dify 增强 / 仅看 plain」开关
- 助手详情页（Descriptions）补充 `dify_app_id` / `acl 详情`
- super admin 切换企业时 Dify Studio 跳转链接里携带对应 tenant 的 SSO 参数（当前已经是 SSO，因此天然支持，只要 `/admin/dify/sso?enterprise_id=X` 落地 Phase 1 即可）
- audit log 里 `dify_action` 记录是哪个 admin 操作了哪个企业的哪个助手

## 10. 验收 checklist

| 项 | 通过条件 |
|---|---|
| super admin 不选企业 | 表格 Empty，「新建助手」按钮 disabled |
| super admin 选企业后 | 看到该企业所有助手 + 两列正确显示 |
| enterprise admin 登录 | 看不到企业下拉，直接看本企业全部助手 |
| 创建普通助手（不勾增强） | sudohub 新增一条；本地无 binding / 无 ACL |
| 创建 Dify 增强助手 | sudohub 新增一条；本地 binding/ACL 落地；Dify 新建对应 App |
| 编辑 ACL 改成"指定用户" | `/agents/visible` 对该用户外的人不再返回该助手 |
| Dify Studio 按钮 | 新标签页落到对应 App 配置页 |
| 删除助手 | sudohub + 本地 binding/ACL/dataset_binding + Dify App 全部级联清理 |
| 企业管理员越权请求 | 后端 403，UI 阻挡 |

---

## 11. 落地状态（2026-06-20 已合）

四个 phase 全部落盘：

| Phase | 文件 | 状态 |
|---|---|---|
| 1 服务端入参化 | `src/services/AdminEnterpriseResolver.ts` 新；`src/routes/admin-dify.ts` 12 处全替换 | ✅ |
| 2 SkillsList 扩列 + actions | `src/pages/SkillsList.tsx` 扩展（assistants 分支两列 + 两按钮） | ✅ |
| 3 移植 Modal + Drawer | 同上文件追加 createOpen/drawerOpen 状态 + 表单 JSX | ✅ |
| 4 清理 | 删 `EnterpriseAssistantList.tsx`；`App.tsx` 删菜单 + 路由；admin SPA rebuild | ✅ |

**冒烟通过**：
- super admin 不传 enterprise_id → 400 + 业务信息明确
- super admin 带不存在的 id → 400 + 校验生效
- super admin 带合法 id → 200 + 返回数据

**后续手动验收**（在浏览器中跑一遍）：
1. 强刷 admin SPA（Cmd+Shift+R）
2. 「企业助手 (Dify 增强)」菜单应已消失
3. 「专属助手」页面顶部多了「新建助手」按钮
4. 表格新增「Dify 增强」「可见范围」两列
5. 操作列前两个按钮「编辑」「Dify Studio」按预期工作
6. 超管必须先在顶部下拉选企业才能新建；企业管理员直接可用
7. 越权场景（企业管理员手改 URL 想跨企业）→ 后端 403
