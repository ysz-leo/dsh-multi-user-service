# Docker 部署说明

本目录提供 DSH 多用户服务（`@ysz-leo/dsh-multi-user-service`）的 Docker 部署方式。

## 文件说明

| 文件 | 用途 |
| --- | --- |
| `Dockerfile` | 两阶段构建：① 从上游 `dsh-v0.2.1-rc.2` 构建 DSH（源码树 + tsx）；② 组装运行环境（nginx 反代 + sshd + 本插件） |
| `dsh_requirements.txt` | 容器内 Python 依赖（数据/文档处理类工具所需） |
| `start-dsh-web.sh` | 一键启动脚本：删旧容器 → `docker run` → 等待 dsh 就绪 → 打印访问地址与 token |

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
- 访问 token

### 方式 B：手动 docker run

```sh
docker run -d \
  --name dsh-web \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p 3080:3080 \
  -p 220:22 \
  -e WEB_PORT=3080 \
  -e DSH_PORT=13080 \
  -e DSH_BIND=127.0.0.1 \
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
| `3080` | 容器内 nginx 监听口，也是对外 Web 入口（映射到宿主机 `HOST_WEB_PORT`） |
| `13080` | 容器内 dsh 本体监听口（不直接对外，由 nginx 反代） |
| `22` | 容器内 SSH（映射到宿主机 `SSH_HOST_PORT`） |

| 入口 | 用途 |
| --- | --- |
| `http://<host>:3080/` | owner / 管理入口 |
| `http://<host>:3080/lan/` | 成员入口（多用户服务） |

> 注意：成员入口走 `/lan/`，需要 `LAN_HOST` + `LAN_PORT` 与浏览器看到的 host:port 一致，否则 origin/trusted-host 校验会失败。

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
| `WEB_PORT` | `3080` | nginx 监听口（对外入口） |
| `DSH_PORT` | `13080` | dsh 本体监听口 |
| `DSH_BIND` | `127.0.0.1` | dsh 本体监听地址 |
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
