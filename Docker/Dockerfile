# =============================================================================
# DSH 多用户服务 —— Docker 镜像（统一版：bridge / host 两种网络模式共用）
# 基于 DSH v0.2.1-rc.2（源码树 + tsx 方式运行）+ 本插件（@ysz-leo/dsh-multi-user-service）
#
# 构建上下文：仓库根目录（含本 Dockerfile 所在位置）
#   docker build -t dsh-multi-user:0.2.1-rc.2 -f Docker/Dockerfile .
#
# 一个镜像同时支持两种网络模式，由启动脚本决定如何跑：
#   - bridge 版：docker run 时用 -p 映射端口，sshd 默认 220（SSH_PORT 保持默认即可，
#                如 -p 220:220）；bili 走 nginx 18781 反向代理。适用 Linux/Windows/macOS。
#   - host 版：docker run 用 --network host，用 -e SSH_PORT=221（三位数、非 22）
#              避开 Linux 宿主默认 22；bili 直接通过宿主 18787 回环可达。
#              Linux 原生 Docker Engine 开箱即用；用 Docker Desktop（Windows / macOS / Linux）
#              需 4.34+ 开启 "Enable host networking"。
#
# 关键机制：sshd 监听端口默认 220（三位数），由 SSH_PORT 环境变量驱动——entrypoint 启动
# sshd 前先删除构建期写入的 Port 行，再按 SSH_PORT 重写 sshd_config，故同一镜像既能
# bridge（220）又能 host（221），不会因抢占宿主 22 导致容器起不来。
#
# 说明：
#   - DSH 源码通过 git clone 从上游固定 tag 拉取，镜像构建自包含，不依赖宿主机源码目录。
#   - 本插件通过 dsh plugin 从 GitHub 仓库安装（github:ysz-leo/dsh-multi-user-service）。
#   - 成员入口 /lan/ 由 nginx 反向代理到 dsh 本体，owner 入口直连，详情见 Docker/README.md。
#   - bili(billion-context) 由 nginx 独立端口 18781 反向代理到容器内回环 18787；bridge 模式
#     宿主 18787 映射到此口，host 模式容器回环即宿主回环、反向代理口闲置不影响直连。
# =============================================================================

# ================= 第一阶段：构建环境 =================
FROM node:22-slim AS builder

# 使用清华镜像源加速 apt
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

WORKDIR /app

# 从上游固定 tag 拉取 DSH 源码（自包含，不依赖宿主机源码目录）
ARG DSH_TAG=dsh-v0.2.1-rc.2
RUN git clone --depth 1 --branch "${DSH_TAG}" https://github.com/deepseek-ai/deepseek-harness.git /app && \
    pnpm install --frozen-lockfile && \
    pnpm run build

# 断言：必须能通过根目录的 pnpm dsh 脚本调用源码 CLI
RUN cd /app && pnpm dsh --version

# ================= 第二阶段：运行环境 =================
FROM node:22-slim

# ================= 环境变量说明 =================
# 【一】镜像内环境变量（下方 ENV 定义，docker run -e 可覆盖，进容器后 env 可见）
#   两模式共有（内部监听口/地址）：
#   - WEB_PORT         容器内 nginx 主入口监听口（默认 3080）。bridge 下由 -p 映射到宿主
#                      HOST_WEB_PORT；host 下即容器直接占用的宿主端口。
#   - DSH_PORT         容器内 dsh 本体监听口（默认 13080），不对外暴露，由 nginx 反向代理。
#   - DSH_BIND         dsh 本体监听地址（默认 127.0.0.1）。
#   - LAN_HOST         成员入口对外 hostname（默认 dsh-lan），必须与 owner UI 的 127.0.0.1
#                      不同，否则多用户插件启动校验失败；需在 hosts / DNS 解析到服务器 IP。
#   - LAN_PORT         成员入口对外端口（默认跟随 WEB_PORT），须等于浏览器实际看到的 host:port。
#   - SSH_PORT         容器内 sshd 监听口（默认 220，三位数）；entrypoint 启动时动态写入
#                      sshd_config。bridge 保持 220 并用 -p 映射；host 下即占用的宿主端口，
#                      必须非 22（否则与宿主 sshd 抢 22 导致容器起不来）。
#   - BILI_ZONE_PORT   bili(billion-context) 本体监听口（默认 18787，容器内回环 127.0.0.1）；
#                      插件探测与浏览器访问写死 18787，一般不要改。
#   模式相关（两模式语义不同）：
#   - BILI_PROXY_PORT  nginx 的 bili 专用反向代理口（默认 18781）。★bridge 模式核心依赖：
#                      宿主 18787 → 容器 18781 → bili 回环 18787（本体绑回环，-p 无法直连）；
#                      host 模式下容器回环即宿主回环、bili 直连，此口闲置但仍会监听。
#
# 【二】启动脚本层的宿主端口变量（★非镜像 ENV，不进容器，env 里看不到；仅 bridge 模式有）
#   这些变量在 start-dsh-web.sh 里定义，只用于拼 docker run 的 -p 映射，不会传进容器：
#   - HOST_WEB_PORT    浏览器实际访问的宿主机端口（bridge 默认 3080）
#                      → docker run -p ${HOST_WEB_PORT}:${WEB_PORT}
#   - SSH_HOST_PORT    SSH 实际连接的宿主机端口（bridge 默认 220）
#                      → docker run -p ${SSH_HOST_PORT}:${SSH_PORT}
#   host 模式（--network host）无 -p 映射，WEB_PORT / SSH_PORT / BILI_ZONE_PORT 就是宿主实际
#   占用端口，因此不需要 HOST_WEB_PORT / SSH_HOST_PORT 这类映射变量。
# ==================================================
ENV WEB_PORT=3080 \
    DSH_PORT=13080 \
    DSH_BIND=127.0.0.1 \
    LAN_HOST=dsh-lan \
    LAN_PORT="${LAN_PORT:-$WEB_PORT}" \
    BILI_ZONE_PORT=18787 \
    BILI_PROXY_PORT=18781 \
    SSH_PORT=220

RUN useradd -m -s /bin/bash dsh

RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources && \
    sed -i 's/^Components: main$/Components: main contrib non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        openssh-server sudo curl vim git unzip p7zip-full tar unrar bubblewrap \
        python3 python3-pip build-essential \
        nginx && \
    mkdir -p /run/sshd && \
    echo 'dsh:dsh123' | chpasswd && \
    echo 'root:123456' | chpasswd && \
    echo 'dsh ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers && \
    echo 'Defaults:dsh !tty_tickets' >> /etc/sudoers && \
    sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app /app

RUN npm install -g pnpm@11.7.0

RUN mkdir -p /home/dsh/.local/share/pnpm /home/dsh/.dsh && \
    chown -R dsh:dsh /home/dsh

# Python 依赖（数据/文档处理类工具所需）
COPY Docker/dsh_requirements.txt /tmp/dsh_requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages \
        -i https://pypi.tuna.tsinghua.edu.cn/simple \
        --trusted-host pypi.tuna.tsinghua.edu.cn \
        -r /tmp/dsh_requirements.txt && \
    rm -f /tmp/dsh_requirements.txt

RUN mkdir -p /workspace && \
    chown dsh:dsh /app /workspace

# ===== 让 dsh 在任意位置可用 =====
RUN printf '#!/bin/sh\nexec pnpm --dir /app dsh "$@"\n' > /usr/local/bin/dsh && \
    chmod +x /usr/local/bin/dsh

RUN printf 'export PATH="/usr/local/bin:$PATH"\n' > /etc/profile.d/dsh.sh && \
    chmod 0644 /etc/profile.d/dsh.sh

RUN printf '\n# dsh cli\nexport PATH="/usr/local/bin:$PATH"\n' >> /home/dsh/.bashrc && \
    chown dsh:dsh /home/dsh/.bashrc

# 移除默认站点（/etc/nginx/conf.d/dsh.conf 改由 entrypoint 运行时生成）
RUN rm -f /etc/nginx/sites-enabled/default

# ===== 入口脚本：直接内嵌到镜像中 =====
# 外层 heredoc 用 'ENTRYPOINT_EOF' 引号包裹，防止 Dockerfile 的 shell 展开脚本里的 $ 变量；
# 脚本内部生成 nginx 配置的 heredoc 用 <<EOF（无引号），并对 \$http_upgrade 等做转义，
# 从而既完成运行时 ${WEB_PORT} 等变量替换，又保留 nginx 自身需要的 $ 变量。
RUN cat > /usr/local/bin/docker-entrypoint.sh <<'ENTRYPOINT_EOF'
#!/bin/bash
set -euo pipefail

# ---------- 读取并规范化运行时参数 ----------
WEB_PORT="${WEB_PORT:-3080}"
DSH_PORT="${DSH_PORT:-13080}"
DSH_BIND="${DSH_BIND:-127.0.0.1}"
LAN_HOST="${LAN_HOST:-dsh-lan}"
LAN_PORT="${LAN_PORT:-$WEB_PORT}"     # 不填则跟随 WEB_PORT
BILI_ZONE_PORT="${BILI_ZONE_PORT:-18787}"   # bili(billion-context) 本体监听口（容器内回环）
BILI_PROXY_PORT="${BILI_PROXY_PORT:-18781}" # nginx bili 专用反向代理口（映射到宿主机 18787）
SSH_PORT="${SSH_PORT:-220}"                 # sshd 监听端口：默认 220

if [ "${DSH_PORT}" = "${WEB_PORT}" ]; then
  echo "[entrypoint] ERROR: DSH_PORT(${DSH_PORT}) 与 WEB_PORT(${WEB_PORT}) 相同，nginx 与 dsh 会抢同一监听口" >&2
  exit 1
fi
if [ "${BILI_PROXY_PORT}" = "${BILI_ZONE_PORT}" ]; then
  echo "[entrypoint] ERROR: BILI_PROXY_PORT(${BILI_PROXY_PORT}) 与 BILI_ZONE_PORT(${BILI_ZONE_PORT}) 相同，nginx 反向代理口会与 bili 本体抢同一监听口" >&2
  exit 1
fi

echo "[entrypoint] WEB_PORT=${WEB_PORT}  DSH_PORT=${DSH_PORT}  DSH_BIND=${DSH_BIND}  LAN_HOST=${LAN_HOST}  LAN_PORT=${LAN_PORT}  BILI_ZONE_PORT=${BILI_ZONE_PORT}  BILI_PROXY_PORT=${BILI_PROXY_PORT}  SSH_PORT=${SSH_PORT}"

# ---------- 1. 生成 nginx 配置 ----------
sudo mkdir -p /etc/nginx/conf.d
sudo tee /etc/nginx/conf.d/dsh.conf > /dev/null <<EOF
map \$http_upgrade \$connection_upgrade { default upgrade; '' close; }

# bili(billion-context) 专用反向代理 server：监听独立端口，专供宿主机 bili 入口映射。
# 链路：宿主 18787 -> 容器 ${BILI_PROXY_PORT}(nginx) -> 127.0.0.1:${BILI_ZONE_PORT}(bili 本体回环)。
# bili 本体 host 硬编码 127.0.0.1，bridge 模式下 Docker 的 -p 无法直接命中回环，必须借 nginx 同命名空间反向代理。
server {
    listen ${BILI_PROXY_PORT};
    server_name _;

    location /__bili/ {
        proxy_pass http://127.0.0.1:${BILI_ZONE_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}

server {
    listen ${WEB_PORT};
    server_name _;

    # 成员入口：透传真实来源
    location /lan/ {
        proxy_pass http://${DSH_BIND}:${DSH_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$http_host;
        proxy_set_header Origin \$http_origin;
        proxy_set_header Sec-Fetch-Site same-origin;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # 管理/owner 入口 + API
    location / {
        proxy_pass http://${DSH_BIND}:${DSH_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host 127.0.0.1:${DSH_PORT};
        proxy_set_header Origin http://127.0.0.1:${DSH_PORT};
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
EOF

# ---------- 2. 生成 docker-patch.yml ----------
cat > /app/docker-patch.yml <<EOF
- id: webserver
  config:
    host: '${DSH_BIND}'
    port: ${DSH_PORT}
    trustedHosts:
      - 127.0.0.1:${WEB_PORT}
      - localhost:${WEB_PORT}
      - ${LAN_HOST}:${LAN_PORT}

- id: multi-user-service
  name: '@ysz-leo/dsh-multi-user-service'
  config:
    memberOrigin: 'http://${LAN_HOST}:${LAN_PORT}'
    memberAliases: []
EOF

# ---------- 3. 启动 sshd / nginx ----------
# sshd 端口由 SSH_PORT 真正驱动：先去掉所有 Port 指令，再按 SSH_PORT 重写，
# 保证环境变量生效且容器重启不累积多条 Port。默认 220，host 模式用 221。
sudo sed -i -E '/^[[:space:]]*#?[[:space:]]*Port[[:space:]]+[0-9]+/d' /etc/ssh/sshd_config
echo "Port ${SSH_PORT}" | sudo tee -a /etc/ssh/sshd_config >/dev/null
echo "[entrypoint] sshd 监听端口 = ${SSH_PORT}（由 SSH_PORT 环境变量驱动）"
sudo mkdir -p /run/sshd
sudo /usr/sbin/sshd
sudo nginx -t
sudo nginx

# ---------- 4. 前台启动 dsh ----------
cd /app
exec pnpm dsh web \
  --patch /app/docker-patch.yml \
  --no-open \
  --public-url "http://127.0.0.1:${WEB_PORT}" \
  --trusted-host "127.0.0.1:${WEB_PORT}" \
  --trusted-host "localhost:${WEB_PORT}" \
  --trusted-host "127.0.0.1:${DSH_PORT}" \
  --trusted-host "localhost:${DSH_PORT}" \
  --trusted-host "${LAN_HOST}:${LAN_PORT}"
ENTRYPOINT_EOF

RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh

# ===== 以下步骤以 dsh 身份执行 =====
ENV PNPM_HOME=/home/dsh/.local/share/pnpm
ENV PATH="/usr/local/bin:$PNPM_HOME/bin:/home/dsh/.local/bin:$PATH"
ENV HOME=/home/dsh

USER dsh

RUN command -v dsh && dsh --version
RUN cd /app && pnpm dsh --version

# ===== 终端 UTF-8 支持 =====
RUN echo 'export LANG=C.UTF-8 LC_ALL=C.UTF-8' >> ~/.bashrc && \
    echo 'export LANG=C.UTF-8 LC_ALL=C.UTF-8' | sudo tee /etc/profile.d/lang.sh && \
    sudo chmod 0644 /etc/profile.d/lang.sh

RUN pnpm approve-builds --all

# 预置 allowBuilds 授权，供插件构建脚本使用
RUN mkdir -p /home/dsh/.dsh/profiles/web && \
    cat > /home/dsh/.dsh/profiles/web/pnpm-workspace.yaml <<'EOF'
overrides:
  "@deepseek-ai/dsh": "0.2.1-rc.2"

allowBuilds:
  '@deepseek-ai/dsh-subprocess-local': true
  '@google/genai': true
  cloudflared: true
  cpu-features: true
  koffi: true
  node-pty: true
  protobufjs: true
  ssh2: true
EOF

# 安装本插件（从本仓库 GitHub 源）+ 常用配套插件
RUN dsh plugin --profile web add -w github:ysz-leo/dsh-multi-user-service

RUN dsh plugin --profile web add -w \
        @linxin666/dsh-web-all@0.4.2 \
        dshmarket \
        github:pn1024/dsh-ppt-master \
        dsh-plugin@2.2.7 \
        dsh-context \
        billion-context@0.1.213 \
        @nnyc/dsh-sql@0.7.0 \
        dsh-better-sidebar@0.28.0 \
        dsh-video-preview \
        @huanlin/dsh-plugin-better-sidebar-plugin-audio \
        github:Johnblur/dsh-bilingual-reader

# ===== 预置 bili(billion-context) 配置：开启 adminRelay 支持远程访问面板 =====
# 远程设备的浏览器无法直连容器内回环 127.0.0.1:18787（会指向设备自身），
# 开启 security.adminRelay 后，bili 面板经 dsh web 入口(3080)中转，远程设备可访问。
# ⚠️ 安全提示：adminRelay 允许任何能访问 dsh web 入口的人使用完整 bili 管理面板
#    （含配置修改与凭证写入）。请确保该入口已受登录鉴权或反向代理保护；
#    如需关闭，删除下面的 security 字段即可。
# 放在插件安装之后，覆盖 billion-context 首次运行可能生成的默认配置。
RUN mkdir -p /home/dsh/.config/billion-context && \
    cat > /home/dsh/.config/billion-context/billion-context.json <<'EOF'
{
  "providers": {},
  "security": {
    "adminRelay": true
  }
}
EOF

# 仅作为文档性默认值：web/bili 口由 WEB_PORT/BILI_* 决定，sshd 口由 SSH_PORT 决定（默认 220）
# 18781 为 bili 专用 nginx 反向代理口（bridge 模式下宿主 18787 映射到此），bili 本体 18787 仅容器内回环
EXPOSE 3080 18781 220

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# 构建示例（一个镜像，两种启动方式）：
#   docker build -t dsh-multi-user:0.2.1-rc.2 -f Docker/Dockerfile .
#   bridge: -p 3080:3080 -p 220:220 -p 18787:18781
#   host:   --network host -e SSH_PORT=221
