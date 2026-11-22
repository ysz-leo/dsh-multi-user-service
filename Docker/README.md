# Docker 部署说明

本目录提供 DSH 多用户服务（`@ysz-leo/dsh-multi-user-service`）的 Docker 部署方式。**只需构建一个镜像**（`Dockerfile`），即可用两种网络模式运行，按宿主机平台二选一：

- **bridge 模式**（`start-dsh-web.sh`）：通用方案，靠 `-p` 端口映射 + nginx `18781` 反向代理访问 bili。**适用 Linux / Windows / macOS（含 Docker Desktop）**。
- **host 模式**（`start-dsh-web-hostnet.sh`）：容器共享宿主机网络栈，bili 直连无需反向代理。**适用 Linux / Windows / macOS**（Linux 原生 Docker Engine 开箱即用；用 Docker Desktop 时需 4.34+ 并手动开启 host networking 开关，含 Linux 上的 Docker Desktop，见「选择建议」）。

两种模式的插件、账号体系、成员入口完全一致；sshd 监听端口由镜像的 `SSH_PORT` 环境变量统一驱动（默认三位数 `220`，bridge 用 `220`、host 用 `221` 与宿主 22 及 bridge 错开），因此**同一个镜像**即可覆盖两种模式，无需分别构建。

## 文件说明

| 文件 | 用途 |
| --- | --- |
| `Dockerfile` | **统一镜像**：两阶段构建：① 从上游 `dsh-v0.2.1-rc.2` 构建 DSH（源码树 + tsx）；② 组装运行环境（nginx 反向代理 + sshd + 本插件）。内置 `SSH_PORT` 环境变量，启动 sshd 前动态重写 `sshd_config` 的 `Port`，故 bridge / host 共用此镜像 |
| `start-dsh-web.sh` | **bridge 模式**一键启动脚本：`-p` 端口映射（含 `-p ${SSH_HOST_PORT}:${SSH_PORT}`）→ 删旧容器 → `docker run` → 等待 dsh 就绪 → 打印访问地址与 token（含 bili 入口） |
| `start-dsh-web-hostnet.sh` | **host 模式**一键启动脚本：`--network host` + `-e SSH_PORT=221`（无 `-p`）→ 启动前预检宿主端口冲突 → 等待就绪 → 打印访问地址与 token |
| `dsh_requirements.txt` | 容器内 Python 依赖（数据/文档处理类工具所需），两种模式共用 |

## 1. 选择运行模式

先构建**同一个镜像**，再按宿主机平台选择启动方式（其余功能完全一致，只差网络模式）：

| 对比项 | bridge 模式（默认） | host 模式 |
| --- | --- | --- |
| 镜像 | `Dockerfile` 构建出的 `dsh-multi-user:0.2.1-rc.2` | **同一个镜像** |
| 启动脚本 | `start-dsh-web.sh` | `start-dsh-web-hostnet.sh` |
| 镜像 tag | `dsh-multi-user:0.2.1-rc.2` | `dsh-multi-user:0.2.1-rc.2`（共用） |
| 网络模式 | bridge + `-p` 端口映射 | `--network host`（无 `-p`） |
| 外部访问端口 | `-p 3080:3080` 等映射 | 容器直接占用宿主 `3080` |
| bili 链路 | 宿主 `18787` → nginx `18781` → bili 回环 `18787` | 宿主 `127.0.0.1:18787` == bili 本体（直连，无需反向代理） |
| SSH 端口 | 默认 `SSH_PORT=220`，宿主 `220` → `220` | 用 `SSH_PORT=221`（非 22，避开宿主默认 22 并与 bridge 错开） |
| 适用平台 | **Linux / Windows / macOS**（含 Docker Desktop） | **Linux / Windows / macOS**（Linux 原生 Docker Engine 开箱即用；用 Docker Desktop 需 4.34+ 开启开关，见下） |
| 端口冲突 | 由 `-p` 映射处理 | 启动前预检，占用则报错退出 |

> **选择建议**：不确定平台或 Docker Desktop 版本较旧（< 4.34）→ 用 **bridge 版**（最稳妥）。Linux 原生 Docker Engine，或 Windows / macOS / Linux 上用 Docker Desktop ≥ 4.34 且已开启开关、希望省去反向代理与端口映射 → 可用 **host 版**。
>
> **⚠️ 用 Docker Desktop 时 host 版必须先开启实验开关（Windows / macOS / Linux 通用）**：需 Docker Desktop **4.34 及以上**，在 **Settings → Resources → Network** 中勾选 **"Enable host networking"**，保存后 Docker Desktop 会重启。未开启时 `--network host` 不会真正共享宿主机网络（bili 回环 `18787` 不可达），请改用 bridge 版。实测 Windows 开启该开关后 host 版可正常访问 `3080`、`18787` 等端口；macOS 从 Docker Desktop 4.34 起同样支持。Linux 也有 Docker Desktop（用户较少，多数 Linux 用户用原生 Docker Engine）；**只有 Linux 原生 Docker Engine 无此开关、`--network host` 开箱即用**。详细开启步骤见下文「Docker Desktop：开启 Enable host networking」。

> **平台差异提示**：host 模式下，容器绑 `0.0.0.0` 的端口（如 `3080`）可被远程设备访问，绑 `127.0.0.1` 的端口（如 `18787` bili）仅宿主机本机可达。若端口启动后本机访问不通，先查宿主侧是否有 Docker 转发监听；容器已监听但宿主无监听时，`docker restart dsh-web` 重建转发注册即可。

### Docker Desktop：开启 Enable host networking（用 host 版必做）

Windows / macOS / Linux 上的 Docker Desktop 默认**不支持真正的 host 网络**——未开启开关时 `--network host` 只共享 Linux VM 的网络栈，容器回环 `18787` 无法从宿主机本机访问。该能力自 **Docker Desktop 4.34** 起提供（Windows、macOS、Linux 三个平台的 Docker Desktop 均支持；Linux 也有 Docker Desktop，只是多数 Linux 用户用原生 Docker Engine）。开启步骤如下（**Linux 原生 Docker Engine 无需此节**，`--network host` 开箱即用）：

1. 启动 **Docker Desktop**，确认它正在正常运行（托盘图标无异常）。
2. 点击右上角 **齿轮图标** → **Settings（设置）**。
3. 在左侧栏选择 **Resources → Network（资源 → 网络）**。
4. 找到并勾选 **"Enable host networking"（启用 host 网络）** 复选框。
5. 点击右下角 **Apply & restart（应用并重启）** 保存，Docker Desktop 会自动重启（约 1–2 分钟，期间容器短暂停止）。
6. 重启完成后，确认 Docker Engine 版本（host 网络为实验特性，需 ≥ 28.0.0）：

   ```sh
   docker version --format '{{.Server.Version}}'
   ```

7. 之后按统一镜像正常构建、用 host 模式脚本启动容器即可（见下文「2. 构建镜像」「3. 启动容器」）。

> **找不到该选项？** 该开关自 Docker Desktop 4.34 起提供，位置/名称可能随版本变化，请先把 Docker Desktop 升级到 4.34 或更新版本再试。若版本过旧确实没有该开关，请改用 bridge 版（或改用 Linux 原生 Docker Engine）。

## 2. 构建镜像

在**本插件仓库根目录**执行（构建上下文是插件仓库根目录）。两种模式共用**同一个镜像**，只需构建一次：

```sh
# 获取本插件仓库并进入
git clone https://github.com/ysz-leo/dsh-multi-user-service.git
cd dsh-multi-user-service

# 构建统一镜像（bridge / host 两种模式共用）
docker build -t dsh-multi-user:0.2.1-rc.2 -f Docker/Dockerfile .
```

构建要点：

- DSH 源码通过 `git clone` 从上游固定 tag `dsh-v0.2.1-rc.2` 拉取，镜像构建自包含，**不依赖宿主机上的 DSH 源码目录**。
- 本插件从 GitHub 仓库安装：`dsh plugin --profile web add -w github:ysz-leo/dsh-multi-user-service`。
- 若需更换 DSH 版本，修改 Dockerfile 里的 `ARG DSH_TAG`（如 `dsh-v0.2.1-rc.5`）。
- 镜像内 sshd 端口由 `SSH_PORT` 驱动（默认三位数 `220`）：bridge 启动保持默认 `220`，host 启动用 `-e SSH_PORT=221`；无需为不同网络模式构建不同镜像。

### 镜像内默认安装的插件

镜像构建时，除 DSH 本体外，还通过 `dsh plugin --profile web add -w` **手动安装**了以下插件（对应 Dockerfile 末尾的 `RUN dsh plugin ... add` 指令）。这些插件被烘进镜像的 `web` profile，随容器开箱即用：

| 插件 | 版本 / 来源 | 用途简述 |
| --- | --- | --- |
| `@ysz-leo/dsh-multi-user-service` | `github:ysz-leo/dsh-multi-user-service`（本仓库，单独一条指令） | 本插件：提供 `/lan/` 多用户成员入口及成员/管理员账号与权限体系 |
| `@linxin666/dsh-web-all` | `0.4.2`（npm） | Web 功能增强合集 |
| `dshmarket` | npm（未锁版本） | 插件市场 |
| `dsh-ppt-master` | `github:pn1024/dsh-ppt-master` | PPT 生成 / 处理 |
| `dsh-plugin` | `2.2.7`（npm） | 插件管理辅助 |
| `dsh-context` | npm（未锁版本） | 会话上下文管理 |
| `billion-context` | `0.1.213`（npm） | 即 **bili**：会话上下文分析 / 压缩，提供 `/__bili/` Web UI 与 ACP 探测接口；本镜像已为其配置 nginx 独立反向代理口 `18781`（见「bili 反向代理链路」） |
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

统一镜像构建完成后，可按 **bridge** 或 **host** 两种网络模式之一启动。两者插件、账号体系、成员入口完全一致，**仅网络模式与端口访问方式不同**。启动前先按下表与优缺点选定模式，再选「方式 A（脚本）」或「方式 B（手动命令）」对应操作：

| 对比项 | bridge 模式（默认，推荐） | host 模式 |
| --- | --- | --- |
| 网络 | 容器独立 bridge 网络，靠 `-p` 映射端口对外 | 容器共享宿主网络栈（`--network host`），无 `-p` |
| bili 链路 | 宿主 `18787` → nginx `18781` 反向代理 → 容器回环 `18787` | 容器回环 `18787` 即宿主 `18787`，直连无反向代理 |
| SSH | `-p 220:220` 映射 | 直接占用宿主 `221` |
| 适用平台 | Linux / Windows / macOS 全平台 | Linux / Windows / macOS（用 Docker Desktop 需 4.34+ 开启开关；Linux 原生 Engine 开箱即用） |

**bridge 模式**
- 优点：跨平台通用、最稳妥；端口靠映射隔离，不直接占用宿主端口，冲突少。
- 缺点：多一层端口映射与 nginx 反向代理，配置略多；bili 必须经反向代理才能从宿主访问。

**host 模式**
- 优点：容器直接用宿主端口，无 NAT / 反向代理开销；bili 回环直连，链路更简单；**后续在容器内安装其他插件需要使用新端口时，该端口可直接暴露、即装即用，无需像 bridge 模式那样重建容器再追加 `-p` 端口映射**。
- 缺点：用 Docker Desktop（Windows / macOS / Linux）需 4.34+ 并先开启 "Enable host networking" 开关；端口直接占用宿主，易冲突（脚本会预检）；`18787` 绑回环仅本机可达，远程面板依赖 adminRelay 中转。

> 不确定选哪个、或 Docker Desktop < 4.34 就用 **bridge 模式（默认）**；Linux 原生 Docker Engine，或 Windows / macOS / Linux 上 Docker Desktop 已开启 host networking 开关且希望省去反向代理与映射、或需要 bili 本机直连时，再选 **host 模式**。

### 方式 A：用启动脚本（推荐）

**bridge 模式**先编辑 `Docker/start-dsh-web.sh` 顶部「配置区」：

```sh
IMAGE="dsh-multi-user:0.2.1-rc.2"    # 统一镜像名（与 docker build -t 一致）
HOST_WEB_PORT=3080                    # 浏览器访问端口
SSH_HOST_PORT=220                     # SSH 映射口
SSH_PORT=220                          # 容器内 sshd 端口（默认 220，配合 -p 220:220）
BILI_ZONE_PORT=18787                  # bili 对外入口端口（插件探测写死 18787，一般不要改）
BILI_PROXY_PORT=18781                 # 容器内 nginx bili 专用反向代理口（一般不要改）
LAN_HOST=dsh-lan                      # 对外域名（建议在 hosts 里映射到服务器 IP）
WORKSPACE="/path/to/your/workspace"   # 成员会话数据目录（务必改成你自己的路径）
DEEPSEEK_API_KEY="sk-xxxx"            # 你的模型 API Key（必填）
```

然后执行：

```sh
./Docker/start-dsh-web.sh
```

**host 模式**（Linux 原生 Docker Engine，或用 Docker Desktop 4.34+ 已开启 Enable host networking）先编辑 `Docker/start-dsh-web-hostnet.sh` 顶部「配置区」——注意这里没有宿主机映射口，`WEB_PORT` / `SSH_PORT` / `BILI_ZONE_PORT` 就是容器直接占用的宿主端口，且 `IMAGE` 与 bridge **相同**：

```sh
IMAGE="dsh-multi-user:0.2.1-rc.2"  # 统一镜像（与 bridge 版相同）
WEB_PORT=3080          # 占用宿主 3080（dsh web 主入口，绑 0.0.0.0）
SSH_PORT=221           # 占用宿主 221（避开默认 22，并与 bridge 的 220 错开）
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

**bridge 模式（默认）**——下方第一条命令即默认 bridge 模式启动（`-p` 端口映射 + bili 经 nginx `18781` 反向代理），直接执行即可：

```sh
docker run -d \
  --name dsh-web \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p 3080:3080 \
  -p 220:220 \
  -p 18787:18781 \
  -e WEB_PORT=3080 \
  -e DSH_PORT=13080 \
  -e DSH_BIND=127.0.0.1 \
  -e SSH_PORT=220 \
  -e BILI_ZONE_PORT=18787 \
  -e BILI_PROXY_PORT=18781 \
  -e LAN_HOST=dsh-lan \
  -e LAN_PORT=3080 \
  -e DEEPSEEK_API_KEY=sk-xxxx \
  -v /path/to/your/workspace:/workspace \
  --privileged \
  dsh-multi-user:0.2.1-rc.2
```

**host 模式**（Linux 原生 Docker Engine，或用 Docker Desktop 4.34+ 已开启 Enable host networking）手动命令——无 `-p`，改用 `--network host`，并务必设 `SSH_PORT` 为非 22 端口：

```sh
docker run -d \
  --name dsh-web \
  --restart unless-stopped \
  --network host \
  -e WEB_PORT=3080 \
  -e DSH_PORT=13080 \
  -e DSH_BIND=127.0.0.1 \
  -e SSH_PORT=221 \
  -e BILI_ZONE_PORT=18787 \
  -e LAN_HOST=dsh-lan \
  -e LAN_PORT=3080 \
  -e DEEPSEEK_API_KEY=sk-xxxx \
  -v /path/to/your/workspace:/workspace \
  --privileged \
  dsh-multi-user:0.2.1-rc.2
```

## 4. 端口与入口说明

**bridge 模式端口**（`-p` 映射）：

| 端口 | 说明 |
| --- | --- |
| 宿主 `3080` → 容器 `3080` | nginx 主入口，对外 Web 入口（`HOST_WEB_PORT:WEB_PORT`） |
| `13080` | 容器内 dsh 本体监听口（不直接对外，由 nginx 反向代理） |
| 容器 `18781` | nginx 的 **bili 专用反向代理口**（宿主 `18787` 映射到此） |
| 容器 `18787` | bili（billion-context）本体监听口，**仅容器内回环 `127.0.0.1`**，不直接对外 |
| 宿主 `220` → 容器 `220` | SSH（默认 `SSH_PORT=220`，映射随 `SSH_PORT` 变化） |

**host 模式端口**（容器直占宿主端口，无映射）：

| 端口 | 说明 |
| --- | --- |
| 宿主/容器 `3080` | nginx 主入口，绑 `0.0.0.0`，全网可达 |
| `13080` | 容器内 dsh 本体监听口（不对外） |
| 宿主/容器 `18787` | bili 本体，绑回环 `127.0.0.1`，仅服务器本机可达（远程靠 adminRelay 经 3080 中转） |
| 宿主/容器 `221` | sshd（由 `-e SSH_PORT=221` 驱动，避开宿主默认 22 并与 bridge 错开） |
| 宿主/容器 `18781` | 统一镜像内 nginx 仍会监听此 bili 反向代理口（host 下用不到，但会占用；启动脚本已纳入端口预检） |

| 入口 | 用途 |
| --- | --- |
| `http://<host>:3080/` | owner / 管理入口 |
| `http://<host>:3080/lan/` | 成员入口（多用户服务） |
| `http://<host>:18787/__bili/` | bili（billion-context）**Web UI 入口**，浏览器打开这个 |
| `http://<host>:18787/__bili/plugin/status?conversationId=<会话ID>&fallback=latest` | bili **状态探测接口**（供插件调用，非页面）；必须带 `conversationId`，否则返回 400 |

> 注意：
> - 成员入口走 `/lan/`，需要 `LAN_HOST` + `LAN_PORT` 与浏览器看到的 host:port 一致，否则 origin/trusted-host 校验会失败；且 `LAN_HOST` 必须与 owner 的 `127.0.0.1` **不同**（默认 `dsh-lan`），否则多用户插件启动校验失败、报 `not found`。
> - host 模式下 `18787` 绑回环，只能服务器本机访问；镜像已预置 bili 的 `security.adminRelay`，远程设备的面板会经 dsh web 入口（3080）中转访问（见下文说明）。

### bili 链路（两种模式不同）

bili（billion-context）是镜像内置的 ACP 插件，负责会话上下文分析/压缩。插件探测与浏览器访问都写死 `http://127.0.0.1:18787/__bili/...`，而 bili 本体监听地址在源码里硬编码为回环 `127.0.0.1:18787`。统一镜像内保留了 nginx `18781` 反向代理口（供 bridge 使用），两种模式解决问题的方式不同：

**bridge 模式——nginx 反向代理**（Docker 的 `-p` 走容器网卡，无法命中回环，直接映射 `18787:18787` 会得到 `Empty reply from server`；须借同命名空间内的 nginx 反向代理）：

```
宿主 18787  →[docker -p 18787:18781]→  容器 nginx 18781  →[location /__bili/ proxy_pass]→  容器 bili 127.0.0.1:18787
```

- nginx 专用反向代理 server 块由 entrypoint 启动时生成；**重建镜像**才生效。
- 启动脚本必须带 `-p 18787:18781`；`BILI_PROXY_PORT`（18781）≠ `BILI_ZONE_PORT`（18787）。

**host 模式——直连**（host 网络下容器 `127.0.0.1:18787` 就是宿主 `127.0.0.1:18787`，探测 URL 直接命中 bili，无需 nginx 反向代理）：

```
宿主 127.0.0.1:18787  ==  容器 bili 127.0.0.1:18787   （无中转）
```

- 启动脚本无 `-p`；占用宿主 `18787`（绑回环，仅服务器本机可达）。统一镜像内的 nginx `18781` 反向代理口仍在监听但用不到，启动脚本已把它纳入端口预检以免冲突。
- 远程设备的浏览器直连 `127.0.0.1:18787` 会指向它自己；**镜像已预置 bili 配置 `security.adminRelay: true`**（烘进镜像，两种模式一致），面板会经 dsh web 入口（3080）中转，远程设备访问 `http://dsh-lan:3080/` 即可使用面板。
  - ⚠️ 安全提示：开启 adminRelay 后，任何能访问 dsh web 入口的人都能使用完整 bili 管理面板（含改配置、写凭证），请确保入口已受鉴权或反向代理保护；如需关闭，删除 Dockerfile 里预置配置块的 `security` 字段并重建镜像。

**两种模式通用验证**（在服务器本机）：

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

环境变量分两类，注意区分（与 `Dockerfile` 顶部「环境变量说明」一致）：

- **镜像内环境变量**：Dockerfile `ENV` 定义 / `docker run -e` 注入，进容器后 `env` 可见，两模式共用。
- **启动脚本层的宿主端口变量**：仅在 bridge 启动脚本里定义，用于拼 `docker run -p` 映射，**不进容器**（`env` 里看不到），bridge 模式独有。

### 5.1 镜像内环境变量（两模式共用）

| 变量 | 默认值 | 适用 | 说明 |
| --- | --- | --- | --- |
| `WEB_PORT` | `3080` | 两模式 | nginx 主入口监听口（对外 Web 入口）。bridge 下由 `-p` 映射到宿主 `HOST_WEB_PORT`；host 模式下即容器直接占用的宿主端口 |
| `DSH_PORT` | `13080` | 两模式 | dsh 本体监听口（不对外，由 nginx 反向代理） |
| `DSH_BIND` | `127.0.0.1` | 两模式 | dsh 本体监听地址 |
| `BILI_ZONE_PORT` | `18787` | 两模式 | bili 本体监听口（容器内回环）；插件探测与浏览器访问写死 18787，一般不要改。bridge 模式同时作为宿主对外入口，host 模式即宿主回环端口 |
| `BILI_PROXY_PORT` | `18781` | 两模式 | nginx bili 专用反向代理口。**bridge 模式核心依赖**：宿主 `18787` → 容器 `18781` → bili 回环 `18787`（本体绑回环，`-p` 无法直连）；host 模式下容器回环即宿主回环、bili 直连，此口闲置但仍监听 |
| `SSH_PORT` | `220` | 两模式 | 容器 sshd 端口（默认三位数 `220`，entrypoint 启动时动态写入 sshd_config）。bridge 保持默认 `220` 并用 `-p 220:220` 映射；host 模式用 `221` 以避开宿主默认 22 并与 bridge 错开 |
| `LAN_HOST` | `dsh-lan` | 两模式 | 成员入口对外域名，必须 ≠ owner 的 `127.0.0.1`，且需在 hosts / DNS 解析到服务器 IP |
| `LAN_PORT` | 跟随 `WEB_PORT` | 两模式 | 成员入口对外端口，须等于浏览器实际看到的 host:port |
| `DEEPSEEK_API_KEY` | — | 两模式 | 模型 API Key（必填） |

### 5.2 启动脚本层的宿主端口变量（bridge 模式独有，非 ENV）

下列变量**不是镜像环境变量**，只在 `start-dsh-web.sh` 配置区里定义，用于拼 `docker run -p <宿主口>:<容器口>` 映射；它们不会传进容器，进容器 `env` 看不到：

| 变量 | 默认值 | 适用 | 说明 |
| --- | --- | --- | --- |
| `HOST_WEB_PORT` | `3080` | **仅 bridge** | 浏览器实际访问的宿主机端口，映射到容器 `WEB_PORT`：`-p ${HOST_WEB_PORT}:${WEB_PORT}` |
| `SSH_HOST_PORT` | `220` | **仅 bridge** | SSH 实际连接的宿主机端口，映射到容器 `SSH_PORT`：`-p ${SSH_HOST_PORT}:${SSH_PORT}` |

> host 模式（`--network host`）无 `-p` 映射，`WEB_PORT` / `SSH_PORT` / `BILI_ZONE_PORT` 就是容器直接占用的宿主端口，因此**不需要** `HOST_WEB_PORT` / `SSH_HOST_PORT` 这类映射变量。

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
