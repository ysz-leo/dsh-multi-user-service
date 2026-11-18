# =============================================================================
# DSH 多用户服务 —— Docker 镜像
# 基于 DSH v0.2.1-rc.2（源码树 + tsx 方式运行）+ 本插件（@ysz-leo/dsh-multi-user-service）
#
# 构建上下文：仓库根目录（含本 Dockerfile 所在位置）
#   docker build -t dsh-multi-user:0.2.1-rc.2 -f Docker/Dockerfile .
#
# 说明：
#   - DSH 源码通过 git clone 从上游固定 tag 拉取，镜像构建自包含，不依赖宿主机源码目录。
#   - 本插件通过 dsh plugin 从 GitHub 仓库安装（github:ysz-leo/dsh-multi-user-service）。
#   - 成员入口 /lan/ 由 nginx 反代到 dsh 本体，owner 入口直连，详情见 Docker/README.md。
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

# —— 运行时参数默认值（docker run -e 可覆盖）——
ENV WEB_PORT=3080 \
    DSH_PORT=13080 \
    DSH_BIND=127.0.0.1 \
    LAN_HOST=dsh-lan \
    LAN_PORT="${LAN_PORT:-$WEB_PORT}"   # 不填则跟随 WEB_PORT

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

if [ "${DSH_PORT}" = "${WEB_PORT}" ]; then
  echo "[entrypoint] ERROR: DSH_PORT(${DSH_PORT}) 与 WEB_PORT(${WEB_PORT}) 相同，nginx 与 dsh 会抢同一监听口" >&2
  exit 1
fi

echo "[entrypoint] WEB_PORT=${WEB_PORT}  DSH_PORT=${DSH_PORT}  DSH_BIND=${DSH_BIND}  LAN_HOST=${LAN_HOST}  LAN_PORT=${LAN_PORT}"

# ---------- 1. 生成 nginx 配置 ----------
sudo mkdir -p /etc/nginx/conf.d
sudo tee /etc/nginx/conf.d/dsh.conf > /dev/null <<EOF
map \$http_upgrade \$connection_upgrade { default upgrade; '' close; }

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

# 仅作为文档性默认值，实际端口由 WEB_PORT / -p 决定
EXPOSE 3080 22

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# 构建示例：
#   docker build -t dsh-multi-user:0.2.1-rc.2 -f Docker/Dockerfile .
