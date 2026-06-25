# 全链路本地调试 Runbook（sudohub 除外）

**日期:** 2026-06-20
**状态:** 已跑通 dify 与 sudowork-server，客户端待 review 后启动
**关联设计:** `docs/plans/2026-06-17-dify-integration-design.md`

本文档记录如何把 Dify + sudowork-server + sudowork 客户端三个应用全部切到本地进行联调，sudohub 仍走远程（`https://sudoworkhub.sudoprivacy.com`）。

> **回滚提示**：临时改动用一节列出，调试完成后按那一节回滚即可。

---

## 1. 拓扑

```
                   sudohub (远程)
                   sudoworkhub.sudoprivacy.com
                          ▲
                          │ sudowork-server 调
                          │
┌─────────────┐    ┌──────┴──────────┐    ┌──────────────────┐
│  客户端      │───▶│ sudowork-server │───▶│  Dify (Docker)   │
│  (Electron)  │    │ 127.0.0.1:3000  │    │  api 127.0.0.1:5001
│  fix-sudowork│    │ bun run         │    │  web/nginx :80   │
└─────────────┘    └─────────────────┘    └──────────────────┘
       │                    │                       │
       │                    └─ SQLite (./data)     │
       │                       Postgres :15432      │
       │                       Redis    :16380      │
       │                                            │
       │                                       sudowork-patches/
       │                                       file-level overlay
       └──── localStorage token + IPC bind ─────┘
```

---

## 2. 三套密钥（跨进程必须一致）

`/Users/zhangdongdong/sudo/projects/ai-sudo/dify/docker/.env` 与 `/Users/zhangdongdong/sudo/projects/ai-sudo/sudowork-server/.env` 已配同一组。如需重新生成：

```bash
openssl rand -base64 48   # SSO_SECRET
openssl rand -base64 48   # SYSTEM_SECRET
openssl rand -base64 64   # SYSTEM_TOKEN
```

| 用途 | Dify 侧变量 | sudowork-server 侧变量 |
|---|---|---|
| SSO JWT 签名 | `SUDOWORK_SSO_SECRET` | `DIFY_SSO_SECRET` |
| Provisioning HMAC | `SUDOWORK_SYSTEM_SECRET` | `DIFY_SYSTEM_SECRET` |
| 长效 Bearer | `SUDOWORK_SYSTEM_TOKEN` | `DIFY_SYSTEM_TOKEN` |

---

## 3. Dify (Docker Compose)

### 3.1 已落地的本地调试改动

1. **`docker-compose.yaml`**
   - api 服务加 `ports: ["5001:5001"]`（暴露给宿主机的 sudowork-server）
   - api / worker / worker_beat 三处 `volumes:` 加 4 行 sudowork 文件级 overlay（见 §3.2）
2. **`.env`** — 新增 SUDOWORK_INTEGRATION_ENABLED=true 与 3 把密钥
3. **`sudowork-patches/`**（新目录）
   - `feature_init.py` ← 上游 1.14.2 `configs/feature/__init__.py` + `SudoworkConfig` 类
   - `ext_blueprints.py` ← 上游 1.14.2 + sudowork 蓝图注册
4. **`ssrf_proxy/` 与 `nginx/`** — 之前残留为空目录，已从上游 1.14.2 拉回真实配置文件

### 3.2 sudowork-only 文件级 overlay（关键）

宿主源码树（`dify/api/*`）已比 1.14.2 镜像新，**直接挂目录会导致 ImportError**。所以我们只挂改动过的具体文件，其他文件保持镜像内的 1.14.2 版本：

```yaml
volumes:
  - ./sudowork-patches/feature_init.py:/app/api/configs/feature/__init__.py:ro
  - ./sudowork-patches/ext_blueprints.py:/app/api/extensions/ext_blueprints.py:ro
  - ../api/controllers/sudowork:/app/api/controllers/sudowork:ro
  - ../api/services/sudowork:/app/api/services/sudowork:ro
```

> 改完两个 patch 文件 + 改完 `controllers/sudowork/**` 与 `services/sudowork/**` 后，重启对应容器即可（`docker compose restart api worker worker_beat`），无需重建镜像。

### 3.3 启动

```bash
cd /Users/zhangdongdong/sudo/projects/ai-sudo/dify/docker
docker compose up -d
docker compose ps
```

期望全部 12 个容器都 Up：`api / worker / worker_beat / web / nginx / plugin_daemon / db_postgres / redis / weaviate / sandbox / ssrf_proxy / init_permissions(已退出)`。

### 3.4 冒烟

```bash
# /sudowork 命名空间已注册（未启用时会返回 404）
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5001/sudowork/sso/exchange         # 400
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:5001/sudowork/system/tenants -d '{}' -H 'Content-Type: application/json'  # 401
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5001/sudowork/system/apps            # 401
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5001/sudowork/system/datasets        # 401

# /v1 正常
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5001/v1/parameters                   # 401
```

400/401 都是预期（未提供 token/sig），关键是不要 404。

---

## 4. sudowork-server (bun)

### 4.1 已落地的本地调试改动

- `.env`：
  - `JWT_SECRET` 填了一段（之前是空，会导致登录失败）
  - 新增 4 个 DIFY_* 变量与 SUDOHUB_*（sudohub 仍指向远程）
- 数据库走宿主已运行的 docker postgres :15432 + redis :16380（与 .env 一致）

### 4.2 启动

```bash
cd /Users/zhangdongdong/sudo/projects/ai-sudo/sudowork-server
bun run src/index.ts
```

期望日志末尾打印 `Started development server: http://localhost:3000`。

### 4.3 冒烟

```bash
# super admin 登录（默认 sudo / Sudodata-123 来自 .env）
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/admin/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"sudo","password":"Sudodata-123"}' | jq -r .data.access_token)

# /agents/visible 走 auth
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/agents/visible
# super admin 没有 enterprise_id 时会返回空数组，HTTP 200
```

完整 e2e 测试需要：先创建一个企业 → 创建一个 ENTERPRISE_ADMIN → 用该 admin 调 `/admin/dify/enterprise-assistants` 触发 Dify provisioning。这一步可以在 admin SPA 里点几下完成。

---

## 5. 客户端 (Electron + Vite)

### 5.1 已落地的本地调试改动

- `src/common/sudoworkServer.ts` 常量改为 `http://localhost:3000`，注释里保留了生产 URL 作一行回滚。

### 5.2 启动（**需要 reviewer 先停掉当前在跑的旧 Electron**）

当前 ps aux 看到的 `Electron .` 进程 cwd 在 `/Users/zhangdongdong/sudo/projects/ai-sudo/sudowork`（**旧目录**，不含本次改动）。需要：

```bash
# 1. 停掉旧的（按需选择，最稳的是手工 cmd+Q 或 dock 右键 quit）
pkill -f 'sudowork/node_modules/electron/dist/Electron'

# 2. 从新目录启
cd /Users/zhangdongdong/sudo/projects/ai-sudo/fix-sudowork/sudowork
bun run start
```

成功后控制台应看到 electron-vite dev server 启动，主窗口弹出。

### 5.3 客户端冒烟流程

- 启动后登录企业用户 → 进入首页助手选择器
- 调试时打开 devtools → Network 看到所有 `/api/v1/*` 都指向 `http://localhost:3000`
- 选一个 sudohub 助手发消息 → 主进程日志（终端）应看到 `bound conversation … → assistant …`（来自 enhancementOrchestrator）
- 若所选助手是「企业专属助手 + Dify 增强」，sudowork-server 日志应看到 `/agents/<id>/enhancement/invoke` 请求；本地 ACP backend 输入区会包含 `<knowledge_context>` 块（在 devtools 主进程 stdout 里能看到）

---

## 6. 端到端验收脚本

完整链路（管理员建助手 → 用户对话）：

1. 浏览器打开 `http://localhost:3000/`，super admin 登录
2. 「企业管理 → 企业列表」新建企业（code=`sudo-dev`）
3. 「用户管理」新建一个 ENTERPRISE_ADMIN（绑到 `sudo-dev`）
4. 退出，用新 admin 登录
5. 「企业助手 (Dify 增强)」→「新建助手」
   - 名称 / 职业 / 提示词文件 / 头像
   - 启用 Dify 增强 → mode=agent-chat
   - 可见范围 → 选指定用户（先建一个 USER 角色再来）
   - 保存
6. 退出，用上一步的 USER 登录 → 看到该助手 → 安装 → 进入对话
7. 对话过程中 sudowork-server 日志应看到 `/agents/.../enhancement/invoke`；Dify 日志应看到 `/v1/chat-messages` blocking 调用

---

## 7. 临时改动汇总（调试结束后回滚清单）

| 文件 | 改动 | 回滚方式 |
|---|---|---|
| `dify/docker/docker-compose.yaml` | api 加 ports；三处 volumes 加 sudowork overlay | 删除 ports 与 4 行 volumes 即可（compose 文件本来就是临时调试用，可整体不留） |
| `dify/docker/.env` | 新增 SUDOWORK_* 三把密钥与 enabled=true | 调试完后直接删 `.env`（这是新增的，本来不存在） |
| `dify/docker/sudowork-patches/` | 两个 patched 文件 | 直接删目录 |
| `dify/docker/ssrf_proxy/`、`dify/docker/nginx/` | 拉回了上游 1.14.2 配置文件 | 保留（这是 dify 跑起来本就需要的） |
| `sudowork-server/.env` | JWT_SECRET 填值 + DIFY_* + SUDOHUB_* | 重置 JWT_SECRET 为空、删除新增的 7 行 DIFY_/SUDOHUB_ |
| `fix-sudowork/sudowork/src/common/sudoworkServer.ts` | 常量改 `http://localhost:3000` | 把 export 行换回 https://sudowork-server.sudoprivacy.com（同文件注释里有现成的一行） |

代码侧的"功能"改动（admin SPA / Dify 蓝图 / sudowork-server 路由 / 客户端 sessionBinding 等）都不属于"临时调试改动"，按方案设计本就要走入主线。

---

## 8. 故障速查

| 现象 | 原因 | 处置 |
|---|---|---|
| `/sudowork/*` 全 404 | `SUDOWORK_INTEGRATION_ENABLED` 没生效 | 检查 dify `.env` 是否有该变量；`docker compose up -d --force-recreate api` |
| `ImportError: cannot import name '...' from 'libs.token'` | 误挂了整目录 `extensions/` 或 `configs/` | 确保 compose 用文件级 overlay（见 §3.2） |
| api 起来但 web 报 mixed content / CORS | `CONSOLE_WEB_URL` / `CONSOLE_API_URL` 与浏览器实际访问 URL 不一致 | 都改成 `http://localhost`（已配） |
| sudowork-server 登录 401 「Token 无效」 | `JWT_SECRET` 在两次重启之间变了 | 保持 .env 中 JWT_SECRET 不变 |
| 客户端 `Network Error` 调 /api/v1/* | 客户端跑的是旧目录 `/sudowork/`，没切到 localhost:3000 | 按 §5.2 用新目录起 |
| 创建企业助手 502 | sudowork-server → Dify provisioning 失败 | 看 sudowork-server 日志；常见是密钥不一致或 5001 没暴露 |
