# Docker 部署说明

本目录提供 DSH 多用户服务（`@ysz-leo/dsh-multi-user-service`）的 Docker 部署方式，**提供两种构建/运行方法，按宿主机平台二选一**：

- **bridge 版**（`Dockerfile` + `start-dsh-web.sh`）：通用方案，靠 `-p` 端口映射 + nginx `18781` 反代访问 bili。**适用 Linux / Windows / macOS（含 Docker Desktop）**。
- **host 版**（`Dockerfile.hostnet` + `start-dsh-web-hostnet.sh`）：容器共享宿主机网络栈，bili 直连无需反代。**适用 Linux 服务器与 Windows**（Windows 需在 Docker Desktop 手动开启 host networking 开关，见「选择建议」）；macOS 不支持。

两者的插件、账号体系、成员入口等完全一致，**唯一差异是网络模式**（详见下文「两种构建方法对比」）。

## 文件说明

| 文件 | 用途 |
| --- | --- |
| `Dockerfile` | **bridge 版**镜像：两阶段构建：① 从上游 `dsh-v0.2.1-rc.2` 构建 DSH（源码树 + tsx）；② 组装运行环境（nginx 反代 + sshd + 本插件）。nginx 含两个 server：主入口 `3080` 与 bili 专用反代口 `18781` |
| `start-dsh-web.sh` | **bridge 版**一键启动脚本：`-p` 端口映射 → 删旧容器 → `docker run` → 等待 dsh 就绪 → 打印访问地址与 token（含 bili 入口） |
| `Dockerfile.hostnet` | **host 版**镜像：与 `Dockerfile` 构建方式/插件完全相同，仅改网络相关部分——去掉 bili 反代口、sshd `22`→`2222`、新增 `SSH_PORT`、`EXPOSE 3080 18787 2222`。**Linux / Windows（需开启开关）** |
| `start-dsh-web-hostnet.sh` | **host 版**一键启动脚本：`--network host`（无 `-p`）→ 启动前预检宿主端口冲突 → 等待就绪 → 打印访问地址与 token |
| `dsh_requirements.txt` | 容器内 Python 依赖（数据/文档处理类工具所需），两种构建方法共用 |

## 1. 选择构建方法

按**宿主机平台**二选一（其余功能完全一致，只差网络模式）：

| 对比项 | bridge 版（默认） | host 版 |
| --- | --- | --- |
| 构建文件 | `Dockerfile` | `Dockerfile.hostnet` |
| 启动脚本 | `start-dsh-web.sh` | `start-dsh-web-hostnet.sh` |
| 镜像 tag | `dsh-multi-user:0.2.1-rc.2` | `dsh-multi-user:0.2.1-rc.2-hostnet` |
| 网络模式 | bridge + `-p` 端口映射 | `--network host`（无 `-p`） |
| 外部访问端口 | `-p 3080:3080` 等映射 | 容器直接占用宿主 `3080` |
| bili 链路 | 宿主 `18787` → nginx `18781` → bili 回环 `18787` | 宿主 `127.0.0.1:18787` == bili 本体（直连，无反代） |
| SSH 端口 | 宿主 `220` → 容器 `22` | 容器 `sshd 2222`（避开宿主默认 22） |
| 适用平台 | **Linux / Windows / macOS**（含 Docker Desktop） | **Linux / Windows**（Windows 需开启开关，见下）；macOS 不支持 |
| 端口冲突 | 由 `-p` 映射处理 | 启动前预检，占用则报错退出 |

> **选择建议**：macOS 或不确定平台 → 用 **bridge 版**（最稳妥）。Linux 服务器、或 Windows 希望省去反代与端口映射 → 可用 **host 版**。
>
> **⚠️ Windows 使用 host 版必须先开启实验开关**：在 Docker Desktop 的 **Settings → Resources → Network** 中，勾选 **"Enable host networking"**，保存后 Docker Desktop 会重启。未开启时 `--network host` 不会真正共享宿主机网络（bili 回环 `18787` 不可达），请改用 bridge 版。实测 Windows 开启该开关后 host 版可正常访问 `3080`、`18787` 等端口。详细开启步骤见下文「Windows：开启 Enable host networking」。

> **平台差异提示**：host 模式下，容器绑 `0.0.0.0` 的端口（如 `3080`）可被远程设备访问，绑 `127.0.0.1` 的端口（如 `18787` bili）仅宿主机本机可达。若端口启动后本机访问不通，先查宿主侧是否有 Docker 转发监听；容器已监听但宿主无监听时，`docker restart dsh-web` 重建转发注册即可。

### Windows：开启 Enable host networking（host 版必做）

Windows 上的 Docker Desktop 默认**不支持真正的 host 网络**——未开启开关时 `--network host` 只共享 Linux VM 的网络栈，容器回环 `18787` 无法从 Windows 本机访问。开启步骤如下（Linux 原生 Docker 无需此节，`--network host` 开箱即用）：

1. 启动 **Docker Desktop**，确认它正在正常运行（托盘图标无异常）。
2. 点击右上角 **齿轮图标** → **Settings（设置）**。
3. 在左侧栏选择 **Resources → Network（资源 → 网络）**。
4. 找到并勾选 **"Enable host networking"（启用 host 网络）** 复选框。
5. 点击右下角 **Apply & restart（应用并重启）** 保存，Docker Desktop 会自动重启（约 1–2 分钟，期间容器短暂停止）。
6. 重启完成后，确认 Docker Engine 版本（host 网络为实验特性，需 ≥ 28.0.0）：

   ```sh
   docker version --format '{{.Server.Version}}'
   ```

7. 之后按 host 版正常构建镜像、启动容器即可（见下文「2. 构建镜像」「3. 启动容器」）。

> **找不到该选项？** 该开关属实验特性，位置/名称可能随 Docker Desktop 版本变化，请先把 Docker Desktop 升级到最新版再试。macOS 版 Docker Desktop 没有此开关，请改用 bridge 版。

## 2. 构建镜像

在**本插件仓库根目录**执行（构建上下文是插件仓库根目录，用 `-f` 指定对应的 Dockerfile）：

```sh
# 获取本插件仓库并进入
git clone https://github.com/ysz-leo/dsh-multi-user-service.git
cd dsh-multi-user-service

# 二选一构建：

# (A) bridge 版（通用，Docker Desktop 也能用）
docker build -t dsh-multi-user:0.2.1-rc.2 -f Docker/Dockerfile .

# (B) host 版（Linux / Windows，Windows 需先开启 Enable host networking）
docker build -t dsh-multi-user:0.2.1-rc.2-hostnet -f Docker/Dockerfile.hostnet .
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

## 3. 启动容器

### 方式 A：用启动脚本（推荐）

**bridge 版**先编辑 `Docker/start-dsh-web.sh` 顶部「配置区」：

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

**host 版**（Linux / Windows，Windows 需先开启 Enable host networking）先编辑 `Docker/start-dsh-web-hostnet.sh` 顶部「配置区」——注意这里没有宿主机映射口，`WEB_PORT` / `SSH_PORT` / `BILI_ZONE_PORT` 就是容器直接占用的宿主端口：

```sh
IMAGE="dsh-multi-user:0.2.1-rc.2-hostnet"  # 与 host 版构建 tag 一致
WEB_PORT=3080          # 占用宿主 3080（dsh web 主入口，绑 0.0.0.0）
SSH_PORT=2222          # 占用宿主 2222（避开默认 22）
BILI_ZONE_PORT=18787   # 占用宿主 18787（bili 本体，绑回环；插件写死 18787，一般不要改）
DSH_PORT=13080         # dsh 本体内部监听口
LAN_HOST=dsh-lan       # 必须与 owner 的 127.0.0.1 不同，否则多用户插件启动校验失败
WORKSPACE="/path/to/your/workspace"
DEEPSEEK_API_KEY="sk-xxxx"
```

然后执行（脚本会先预检宿主端口冲突，占用则报错退出）：

```sh
./Docker/start-dsh-web-hostnet.sh
```

两个脚本都会自动等待 dsh 启动完成，并打印出：

- 管理入口 URL（owner）
- 成员访问 URL（`/lan/`）
- bili 入口 URL（`/__bili/`）
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

**host 版**（Linux / Windows，Windows 需先开启 Enable host networking）手动命令——无 `-p`、无 `--add-host`，改用 `--network host`：

```sh
docker run -d \
  --name dsh-web \
  --restart unless-stopped \
  --network host \
  -e WEB_PORT=3080 \
  -e DSH_PORT=13080 \
  -e DSH_BIND=127.0.0.1 \
  -e SSH_PORT=2222 \
  -e BILI_ZONE_PORT=18787 \
  -e LAN_HOST=dsh-lan \
  -e LAN_PORT=3080 \
  -e DEEPSEEK_API_KEY=sk-xxxx \
  -v /path/to/your/workspace:/workspace \
  --privileged \
  dsh-multi-user:0.2.1-rc.2-hostnet
```

## 4. 端口与入口说明

**bridge 版端口**（`-p` 映射）：

| 端口 | 说明 |
| --- | --- |
| 宿主 `3080` → 容器 `3080` | nginx 主入口，对外 Web 入口（`HOST_WEB_PORT:WEB_PORT`） |
| `13080` | 容器内 dsh 本体监听口（不直接对外，由 nginx 反代） |
| 容器 `18781` | nginx 的 **bili 专用反代口**（宿主 `18787` 映射到此） |
| 容器 `18787` | bili（billion-context）本体监听口，**仅容器内回环 `127.0.0.1`**，不直接对外 |
| 宿主 `220` → 容器 `22` | SSH |

**host 版端口**（容器直占宿主端口，无映射）：

| 端口 | 说明 |
| --- | --- |
| 宿主/容器 `3080` | nginx 主入口，绑 `0.0.0.0`，全网可达 |
| `13080` | 容器内 dsh 本体监听口（不对外） |
| 宿主/容器 `18787` | bili 本体，绑回环 `127.0.0.1`，仅服务器本机可达（远程靠 adminRelay 经 3080 中转） |
| 宿主/容器 `2222` | sshd（避开宿主默认 22） |

| 入口 | 用途 |
| --- | --- |
| `http://<host>:3080/` | owner / 管理入口 |
| `http://<host>:3080/lan/` | 成员入口（多用户服务） |
| `http://<host>:18787/__bili/` | bili（billion-context）**Web UI 入口**，浏览器打开这个 |
| `http://<host>:18787/__bili/plugin/status?conversationId=<会话ID>&fallback=latest` | bili **状态探测接口**（供插件调用，非页面）；必须带 `conversationId`，否则返回 400 |

> 注意：
> - 成员入口走 `/lan/`，需要 `LAN_HOST` + `LAN_PORT` 与浏览器看到的 host:port 一致，否则 origin/trusted-host 校验会失败；且 `LAN_HOST` 必须与 owner 的 `127.0.0.1` **不同**（默认 `dsh-lan`），否则多用户插件启动校验失败、报 `not found`。
> - host 版下 `18787` 绑回环，只能服务器本机访问；镜像已预置 bili 的 `security.adminRelay`，远程设备的面板会经 dsh web 入口（3080）中转访问（见下文说明）。

### bili 链路（重要，两种构建方法不同）

bili（billion-context）是镜像内置的 ACP 插件，负责会话上下文分析/压缩。插件探测与浏览器访问都写死 `http://127.0.0.1:18787/__bili/...`，而 bili 本体监听地址在源码里硬编码为回环 `127.0.0.1:18787`。两种构建方法解决这个问题的方式不同：

**bridge 版——nginx 反代**（Docker 的 `-p` 走容器网卡，无法命中回环，直接映射 `18787:18787` 会得到 `Empty reply from server`；须借同命名空间内的 nginx 反代）：

```
宿主 18787  →[docker -p 18787:18781]→  容器 nginx 18781  →[location /__bili/ proxy_pass]→  容器 bili 127.0.0.1:18787
```

- nginx 专用反代 server 块由 entrypoint 启动时生成；**重建镜像**才生效。
- 启动脚本必须带 `-p 18787:18781`；`BILI_PROXY_PORT`（18781）≠ `BILI_ZONE_PORT`（18787）。

**host 版——直连**（host 网络下容器 `127.0.0.1:18787` 就是宿主 `127.0.0.1:18787`，探测 URL 直接命中 bili，无需 nginx 反代）：

```
宿主 127.0.0.1:18787  ==  容器 bili 127.0.0.1:18787   （无中转）
```

- 镜像里没有 18781 反代口，启动脚本无 `-p`；占用宿主 `18787`（绑回环，仅服务器本机可达）。
- 远程设备的浏览器直连 `127.0.0.1:18787` 会指向它自己；**镜像已预置 bili 配置 `security.adminRelay: true`**（烘进镜像，两版一致），面板会经 dsh web 入口（3080）中转，远程设备访问 `http://dsh-lan:3080/` 即可使用面板。
  - ⚠️ 安全提示：开启 adminRelay 后，任何能访问 dsh web 入口的人都能使用完整 bili 管理面板（含改配置、写凭证），请确保入口已受鉴权或反代保护；如需关闭，删除 Dockerfile 里预置配置块的 `security` 字段并重建镜像。

**两版通用验证**（在服务器本机）：

- UI：浏览器打开 `http://127.0.0.1:18787/__bili/`，应看到 bili 的 Web 界面。
- 状态接口：`curl "http://127.0.0.1:18787/__bili/plugin/status?conversationId=x&fallback=latest"` 应返回 JSON（含 `ok` 字段）。该接口**必须带 `conversationId`**，无参数返回 400 `conversationId query parameter is required`，属正常参数校验，不代表链路不通。

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

## 5. 环境变量

| 变量 | 默认值 | 适用 | 说明 |
| --- | --- | --- | --- |
| `WEB_PORT` | `3080` | 两版 | nginx 主入口监听口（对外 Web 入口）。host 版下即宿主占用端口 |
| `DSH_PORT` | `13080` | 两版 | dsh 本体监听口 |
| `DSH_BIND` | `127.0.0.1` | 两版 | dsh 本体监听地址 |
| `BILI_ZONE_PORT` | `18787` | 两版 | bili 本体监听口（回环）；插件探测写死 18787。bridge 版同时作为宿主对外入口，host 版即宿主回环端口 |
| `BILI_PROXY_PORT` | `18781` | **仅 bridge 版** | nginx bili 专用反代口，宿主 `18787` 映射到此；host 版无此变量 |
| `SSH_PORT` | `2222` | **仅 host 版** | 容器 sshd 端口（避开宿主默认 22）；bridge 版固定 22 并由 `-p 220:22` 映射 |
| `LAN_HOST` | `dsh-lan` | 两版 | 成员入口对外域名，必须 ≠ owner 的 `127.0.0.1` |
| `LAN_PORT` | 跟随 `WEB_PORT` | 两版 | 成员入口对外端口 |
| `DEEPSEEK_API_KEY` | — | 两版 | 模型 API Key（必填） |

## 6. 默认账号

| 账号 | 密码 | 说明 |
| --- | --- | --- |
| `dsh` | `dsh123` | 容器内普通用户（SSH 登录、运行 dsh） |
| `root` | `123456` | 容器内 root（SSH） |

> ⚠️ 生产环境请务必修改默认密码。

## 7. 常用命令

```sh
# 查看日志
docker logs -f dsh-web 2>&1 | grep 'dsh web:'

# 进入容器
docker exec -it dsh-web bash

# 停止 / 删除
docker stop dsh-web
docker rm -f dsh-web
```
