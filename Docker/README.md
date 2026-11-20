# Docker 部署说明

本目录提供 DSH 多用户服务（`@ysz-leo/dsh-multi-user-service`）的 Docker 部署方式。

## 文件说明

| 文件 | 用途 |
| --- | --- |
| `Dockerfile` | 两阶段构建：① 从上游 `dsh-v0.2.1-rc.2` 构建 DSH（源码树 + tsx）；② 组装运行环境（nginx 反代 + sshd + 本插件）。nginx 含两个 server：主入口 `3080` 与 bili 专用反代口 `18781` |
| `dsh_requirements.txt` | 容器内 Python 依赖（数据/文档处理类工具所需） |
| `start-dsh-web.sh` | 一键启动脚本：删旧容器 → `docker run` → 等待 dsh 就绪 → 打印访问地址与 token（含 bili 入口） |

## 1. 构建镜像

在**本插件仓库根目录**执行（构建上下文是插件仓库根目录，Dockerfile 用 `Docker/Dockerfile` 指定）：

```sh
# 获取本插件仓库并进入
git clone https://github.com/ysz-leo/dsh-multi-user-service.git
cd dsh-multi-user-service

# 构建镜像
docker build -t dsh-multi-user:0.2.1-rc.2 -f Docker/Dockerfile .
```

构建要点：

- DSH 源码通过 `git clone` 从上游固定 tag `dsh-v0.2.1-rc.2` 拉取，镜像构建自包含，**不依赖宿主机上的 DSH 源码目录**。
- 本插件从 GitHub 仓库安装：`dsh plugin --profile web add -w github:ysz-leo/dsh-multi-user-service`。
- 若需更换 DSH 版本，修改 Dockerfile 里的 `ARG DSH_TAG`（如 `dsh-v0.2.1-rc.5`）。

### 镜像内手动安装的插件

镜像构建时，除 DSH 本体外，还通过 `dsh plugin --profile web add -w` **手动安装**了以下插件（对应 Dockerfile 末尾的 `RUN dsh plugin ... add` 指令）。这些插件被烘进镜像的 `web` profile，随容器开箱即用：

| 插件 | 版本 / 来源 | 用途简述 |
| --- | --- | --- |
| `@ysz-leo/dsh-multi-user-service` | `github:ysz-leo/dsh-multi-user-service`（本仓库，单独一条指令） | 本插件：提供 `/lan/` 多用户成员入口及成员/管理员账号与权限体系 |
| `@linxin666/dsh-web-all` | `0.4.2`（npm） | Web 功能增强合集 |
| `dshmarket` | npm（未锁版本） | 插件市场 |
| `dsh-ppt-master` | `github:pn1024/dsh-ppt-master` | PPT 生成 / 处理 |
| `dsh-plugin` | `2.2.7`（npm） | 插件管理辅助 |
| `dsh-context` | npm（未锁版本） | 会话上下文管理 |
| `billion-context` | `0.1.213`（npm） | 即 **bili**：会话上下文分析 / 压缩，提供 `/__bili/` Web UI 与 ACP 探测接口；本镜像已为其配置 nginx 独立反代口 `18781`（见「bili 反代链路」） |
| `@nnyc/dsh-sql` | `0.7.0`（npm） | SQL 数据库访问 |
| `dsh-better-sidebar` | `0.28.0`（npm） | 第三方增强侧边栏；owner 直连入口（`127.0.0.1:3080`）保留完整功能，`/lan/` 成员入口由本插件过滤以避免 CSRF/403 |
| `dsh-video-preview` | npm（未锁版本） | 视频预览（依赖 better-sidebar） |
| `@huanlin/dsh-plugin-better-sidebar-plugin-audio` | npm（未锁版本） | 侧边栏音频预览（依赖 better-sidebar） |
| `dsh-bilingual-reader` | `github:Johnblur/dsh-bilingual-reader` | 双语阅读器（依赖 better-sidebar） |

> 说明：
> - 用途简述基于插件名称及本仓库内说明整理，具体功能以各插件官方说明为准。
> - 上表仅统计通过 `dsh plugin ... add` **显式安装**的插件；Dockerfile 中 `pnpm-workspace.yaml` 的 `allowBuilds` 列表是构建脚本授权白名单（如 `node-pty`、`ssh2`、`cloudflared` 等），并非安装的插件。
> - 需要增删插件时，直接修改 Dockerfile 中对应的 `RUN dsh plugin --profile web add -w ...` 指令，然后**重建镜像**才生效。

### 联网拉取 DSH 源码

构建时 Dockerfile 会联网 `git clone` 上游 `deepseek-harness` 仓库。整个过程自包含，用户无需手动 clone DSH 源码；若希望手动预先拉取（例如放到内网镜像仓库或离线构建），在构建机单独执行：

```sh
# 拉取固定 tag（浅克隆，只取该版本）
git clone --depth 1 --branch dsh-v0.2.1-rc.2 https://github.com/deepseek-ai/deepseek-harness.git
```

> `deepseek-harness` 是 pnpm monorepo，构建时执行 `pnpm install --frozen-lockfile && pnpm run build` 编译出 `lib/` 产物，再以「源码树 + tsx」方式运行。构建环境需能访问 GitHub 与 npm registry（Dockerfile 已配置清华镜像加速 apt/pip）。

## 2. 启动容器

### 方式 A：用启动脚本（推荐）

先编辑 `Docker/start-dsh-web.sh` 顶部「配置区」：

```sh
IMAGE="dsh-multi-user:0.2.1-rc.2"    # 与构建镜像名一致
HOST_WEB_PORT=3080                    # 浏览器访问端口
SSH_HOST_PORT=220                     # SSH 映射口
BILI_ZONE_PORT=18787                  # bili 对外入口端口（插件探测写死 18787，一般不要改）
BILI_PROXY_PORT=18781                 # 容器内 nginx bili 专用反代口（一般不要改）
LAN_HOST=dsh-lan                      # 对外域名（建议在 hosts 里映射到服务器 IP）
WORKSPACE="/path/to/your/workspace"   # 成员会话数据目录（务必改成你自己的路径）
DEEPSEEK_API_KEY="sk-xxxx"            # 你的模型 API Key（必填）
```

然后执行：

```sh
./Docker/start-dsh-web.sh
```

脚本会自动等待 dsh 启动完成，并打印出：

- 管理入口 URL（owner）
- 成员访问 URL（`/lan/`）
- bili 反代入口 URL（`/__bili/`）
- 访问 token

### 方式 B：手动 docker run

```sh
docker run -d \
  --name dsh-web \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p 3080:3080 \
  -p 220:22 \
  -p 18787:18781 \
  -e WEB_PORT=3080 \
  -e DSH_PORT=13080 \
  -e DSH_BIND=127.0.0.1 \
  -e BILI_ZONE_PORT=18787 \
  -e BILI_PROXY_PORT=18781 \
  -e LAN_HOST=dsh-lan \
  -e LAN_PORT=3080 \
  -e DEEPSEEK_API_KEY=sk-xxxx \
  -v /path/to/your/workspace:/workspace \
  --privileged \
  dsh-multi-user:0.2.1-rc.2
```

## 3. 端口与入口说明

| 端口 | 说明 |
| --- | --- |
| `3080` | 容器内 nginx 主入口，对外 Web 入口（映射到宿主机 `HOST_WEB_PORT`） |
| `13080` | 容器内 dsh 本体监听口（不直接对外，由 nginx 反代） |
| `18781` | 容器内 nginx 的 **bili 专用反代口**（映射到宿主机 `18787`） |
| `18787` | bili（billion-context）本体监听口，**仅容器内回环 `127.0.0.1`**，不直接对外 |
| `22` | 容器内 SSH（映射到宿主机 `SSH_HOST_PORT`） |

| 入口 | 用途 |
| --- | --- |
| `http://<host>:3080/` | owner / 管理入口 |
| `http://<host>:3080/lan/` | 成员入口（多用户服务） |
| `http://<host>:18787/__bili/` | bili（billion-context）**Web UI 入口**，浏览器打开这个 |
| `http://<host>:18787/__bili/plugin/status?conversationId=<会话ID>&fallback=latest` | bili **状态探测接口**（供插件调用，非页面）；必须带 `conversationId`，否则返回 400 |

> 注意：成员入口走 `/lan/`，需要 `LAN_HOST` + `LAN_PORT` 与浏览器看到的 host:port 一致，否则 origin/trusted-host 校验会失败。

### bili 反代链路（重要）

bili（billion-context）是镜像内置的 ACP 插件，负责会话上下文分析/压缩。插件探测与浏览器访问都写死 `http://127.0.0.1:18787/__bili/...`。但 bili 本体的监听地址在源码里硬编码为回环 `127.0.0.1:18787`——**Docker 的 `-p` 端口映射走容器网卡，无法命中回环地址**，直接映射 `18787:18787` 会得到 `Empty reply from server`。

解决办法是借助容器内 nginx 反代（nginx 与 bili 在同一网络命名空间，可用 `127.0.0.1` 访问回环）。完整链路：

```
宿主 18787  →[docker -p 18787:18781]→  容器 nginx 18781  →[location /__bili/ proxy_pass]→  容器 bili 127.0.0.1:18787
```

nginx 的专用反代 server 块由 Dockerfile 的 entrypoint 在容器启动时生成（见 `location /__bili/`）。因此：

- 需要**重建镜像**才能让 bili 反代配置生效（entrypoint 烘进镜像）。
- 启动脚本必须带 `-p 18787:18781`，宿主 `18787` 才会通。
- `BILI_PROXY_PORT`（18781）不能与 `BILI_ZONE_PORT`（18787）相同，否则 nginx 反代口与 bili 本体抢同一监听口。
- 验证 UI：浏览器打开 `http://127.0.0.1:18787/__bili/`，应看到 bili 的 Web 界面。
- 验证状态接口：`curl "http://127.0.0.1:18787/__bili/plugin/status?conversationId=x&fallback=latest"` 应返回 JSON（含 `ok` 字段）。注意该接口**必须带 `conversationId` 参数**，直接访问 `.../__bili/plugin/status`（无参数）会返回 400 `conversationId query parameter is required`，这是正常的参数校验，不代表链路不通。

### bili 状态探测接口与会话 ID

`/__bili/plugin/status` 是**插件自动调用**的状态探测接口（就是最初报错 `Failed to fetch (.../__bili/plugin/status?...)` 里的那个 URL），手工调用一般只为验证链路。它的 `conversationId`（会话 ID）格式为 `session-<uuid>`，例如 `session-92880a04-5063-4a56-a417-fd84598f13dc`。

三种 `conversationId` 填法（实测）：

| 填法 | 结果 | 用途 |
| --- | --- | --- |
| `conversationId=x&fallback=latest` | 200，返回最新会话 | **仅验证链路**：随便填都行，`fallback=latest` 会兜底到最新会话 |
| `conversationId=<真实会话ID>` | 200，返回该会话状态 | 精确查询某个会话 |
| 不带 `conversationId`（即使有 `fallback=latest`） | 400 `conversationId query parameter is required` | 参数是必填的 |

> 关键：带上 `fallback=latest` 后，`conversationId` 填什么都无所谓——这正是插件探测 URL 自带 `fallback=latest` 的原因（会话可能尚未注册，靠它兜底）。

**会话 ID 的三种获取方式：**

1. **会话列表接口（最直接）**：`http://127.0.0.1:18787/__bili/sessions`，返回所有会话的 `id`、`title`、`model`、token 用量等。提取第一个：
   ```sh
   curl -s http://127.0.0.1:18787/__bili/sessions | grep -oE 'session-[0-9a-f-]+' | head -1
   ```
2. **插件报错 URL**：最初报错里的 `?conversationId=session-...` 就是 dsh 当前会话 ID，直接复制。
3. **bili UI 地址栏**：打开 `http://127.0.0.1:18787/__bili/`，会话页 hash 路由 `#/session/session-...` 中那段即会话 ID。

**探测示例：**

```sh
# 只验证 bili 服务是否正常（随便填 + fallback 兜底）
curl "http://127.0.0.1:18787/__bili/plugin/status?conversationId=x&fallback=latest"

# 查询具体会话：先从列表拿真实 ID，再探测
SID=$(curl -s http://127.0.0.1:18787/__bili/sessions | grep -oE 'session-[0-9a-f-]+' | head -1)
curl "http://127.0.0.1:18787/__bili/plugin/status?conversationId=${SID}&fallback=latest"
```

### 配置 `LAN_HOST` 的 IP 映射（必做）

`LAN_HOST` 默认是 `dsh-lan`，**当前方式下服务器（成员入口）地址即为 `http://dsh-lan:${HOST_WEB_PORT}/lan/`**（`HOST_WEB_PORT` 为宿主机映射端口，默认 `3080`）。**必须让访问者的电脑能把 `dsh-lan` 解析到服务器 IP**，否则成员入口的 origin/trusted-host 校验会失败、无法正常使用。

以服务器 IP 为 `<服务器IP>` 为例，在每台需要访问的电脑的 hosts 文件里加一行：

- **Windows**（管理员权限编辑 `C:\Windows\System32\drivers\etc\hosts`）：
  ```
  <服务器IP>  dsh-lan
  ```
- **macOS / Linux**（编辑 `/etc/hosts`）：
  ```
  <服务器IP>  dsh-lan
  ```

保存后刷新 DNS 缓存：

```sh
# Windows
ipconfig /flushdns

# macOS
sudo dscacheutil -flushcache
```

验证：

```sh
ping dsh-lan        # 应解析到 <服务器IP>
```

然后通过 `http://dsh-lan:${HOST_WEB_PORT}/lan/` 访问成员入口。若成员分散在多台电脑，需**每台设备**都做同样的 hosts 映射；不想改 hosts 的话，可把 `LAN_HOST` 直接设为服务器 IP 或一个真实可解析的域名。

## 4. 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WEB_PORT` | `3080` | nginx 主入口监听口（对外 Web 入口） |
| `DSH_PORT` | `13080` | dsh 本体监听口 |
| `DSH_BIND` | `127.0.0.1` | dsh 本体监听地址 |
| `BILI_ZONE_PORT` | `18787` | bili 本体监听口（容器内回环），同时作为宿主对外入口端口；插件探测写死 18787 |
| `BILI_PROXY_PORT` | `18781` | nginx bili 专用反代口，宿主 `BILI_ZONE_PORT` 映射到此口 |
| `LAN_HOST` | `dsh-lan` | 成员入口对外域名 |
| `LAN_PORT` | 跟随 `WEB_PORT` | 成员入口对外端口 |
| `DEEPSEEK_API_KEY` | — | 模型 API Key（必填） |

## 5. 默认账号

| 账号 | 密码 | 说明 |
| --- | --- | --- |
| `dsh` | `dsh123` | 容器内普通用户（SSH 登录、运行 dsh） |
| `root` | `123456` | 容器内 root（SSH） |

> ⚠️ 生产环境请务必修改默认密码。

## 6. 常用命令

```sh
# 查看日志
docker logs -f dsh-web 2>&1 | grep 'dsh web:'

# 进入容器
docker exec -it dsh-web bash

# 停止 / 删除
docker stop dsh-web
docker rm -f dsh-web
```
