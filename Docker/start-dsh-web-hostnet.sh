#!/bin/bash
set -euo pipefail

# =============================================================================
# DSH 多用户服务 —— 容器启动脚本（host 模式）
# 用法：./Docker/start-dsh-web-hostnet.sh
# 配合统一镜像 Docker/Dockerfile（一个镜像支持 bridge / host 两种模式）。
#
# ⚠️ 适用：Linux 原生 Docker Engine 开箱即用；用 Docker Desktop（Windows / macOS / Linux）
#    需 4.34+，先在 Settings → Resources → Network 勾选 "Enable host networking"（保存后重启）。
#    Docker Desktop 版本过旧、无法开启该开关时，请改用 bridge 版脚本 start-dsh-web.sh。
#
# host 模式：--network host，容器直接占用宿主机端口，无 -p 映射。
# 关键点：必须 -e SSH_PORT=<非 22 端口>（默认 220），否则 sshd 抢宿主默认 22 导致容器起不来；
# bili 通过容器回环 18787 直连（host 下 == 宿主回环），无需 18781 反向代理中转。
# =============================================================================

# ========================== 配置区（按需修改） ==========================
# host 网络下：WEB_PORT / SSH_PORT / BILI_ZONE_PORT 即容器直接占用的宿主机端口，无 -p 映射。
IMAGE="dsh-multi-user:0.2.1-rc.2"   # 统一镜像名（与 bridge 版相同），与 docker build -t 保持一致
CONTAINER="dsh-web"                  # 容器名

# —— 宿主机实际占用端口（host 网络下 == 容器内监听口）——
WEB_PORT=3080          # dsh web 主入口 / nginx（占用宿主 3080，绑 0.0.0.0，全网可达）
SSH_PORT=220           # 容器 sshd 端口（占用宿主 220，避开默认 22，并与 bridge 的 220 错开）
BILI_ZONE_PORT=18787   # bili 本体端口（占用宿主 18787，绑回环；插件探测写死 18787，一般不要改）
DSH_PORT=13080         # dsh 本体监听口（不对外，nginx 反向代理）
BILI_PROXY_PORT=18781  # 镜像 nginx 默认反向代理口（host 下用不到，但镜像仍会监听，保留以匹配默认值/预检）

# —— 对外可达地址：LAN_HOST + LAN_PORT 必须等于浏览器看到的 host:port ——
# LAN_HOST 必须是与 owner UI(127.0.0.1) 不同的 hostname，否则多用户插件启动校验失败。
# dsh-lan 需在 hosts 里解析到服务器 IP（Linux 服务器 / 每台远程客户端均需能解析）。
LAN_HOST=dsh-lan
LAN_PORT="${WEB_PORT}"   # 跟随 WEB_PORT

# —— 工作区挂载（成员会话数据所在目录，务必改成你自己的路径）——
WORKSPACE="/path/to/your/workspace"

# —— 模型 API Key（必填，替换为你自己的 key）——
DEEPSEEK_API_KEY="sk-xxxx"
# ========================================================================

# 一致性校验
if [[ "${DSH_PORT}" == "${WEB_PORT}" ]]; then
  echo "错误：DSH_PORT 与 WEB_PORT 相同(${WEB_PORT})，nginx 与 dsh 会抢同一监听口" >&2
  exit 1
fi
if [[ "${SSH_PORT}" == "22" ]]; then
  echo "警告：SSH_PORT=22，host 网络下会与 Linux 宿主 sshd 抢占 22 端口，建议改成 220" >&2
fi
if [[ "${DEEPSEEK_API_KEY}" == "sk-xxxx" ]]; then
  echo "提示：DEEPSEEK_API_KEY 仍是占位符 sk-xxxx，请修改脚本后重试。" >&2
fi

# host 网络直接占用宿主端口，先检查冲突（含镜像 nginx 会监听的 BILI_PROXY_PORT）
for p in "${WEB_PORT}" "${SSH_PORT}" "${BILI_ZONE_PORT}" "${BILI_PROXY_PORT}"; do
  if command -v ss >/dev/null 2>&1; then
    if ss -tln 2>/dev/null | grep -qE ":${p}[[:space:]]"; then
      echo "错误：宿主端口 ${p} 已被占用，host 网络下容器将直接抢占该端口导致启动失败" >&2
      ss -tlnp 2>/dev/null | grep -E ":${p}[[:space:]]" >&2 || true
      exit 1
    fi
  fi
done

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --network host \
  --add-host=host.docker.internal:host-gateway \
  -e WEB_PORT="${WEB_PORT}" \
  -e DSH_PORT="${DSH_PORT}" \
  -e DSH_BIND="127.0.0.1" \
  -e SSH_PORT="${SSH_PORT}" \
  -e BILI_ZONE_PORT="${BILI_ZONE_PORT}" \
  -e BILI_PROXY_PORT="${BILI_PROXY_PORT}" \
  -e LAN_HOST="${LAN_HOST}" \
  -e LAN_PORT="${LAN_PORT}" \
  -e DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY}" \
  -v "${WORKSPACE}:/workspace" \
  --privileged \
  "$IMAGE"

echo "容器已启动：$CONTAINER（host 模式），等待 dsh web 就绪..."

# ---------- 等待并抓取 "dsh web:" 日志（最多 180 秒） ----------
DSH_LINES=""
for i in $(seq 1 180); do
  if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    echo "错误：容器已退出，日志如下：" >&2
    docker logs --tail 50 "$CONTAINER" 2>&1 >&2 || true
    exit 1
  fi
  DSH_LINES=$(docker logs "$CONTAINER" 2>&1 | grep -E "dsh web:" || true)
  [ -n "$DSH_LINES" ] && break
  sleep 1
done

if [ -z "$DSH_LINES" ]; then
  echo "警告：180s 内未看到 'dsh web:' 日志，请手动执行：" >&2
  echo "  docker logs -f $CONTAINER 2>&1 | grep 'dsh web:'" >&2
  exit 1
fi

# ---------- 解析 URL / token（host 网络下端口即宿主端口） ----------
echo
echo "============================================================"
echo " dsh-web 访问信息（host 模式）"
echo "============================================================"

while IFS= read -r line; do
  [ -z "$line" ] && continue
  raw_url=$(echo "$line" | grep -oE 'https?://[^[:space:]"'\'']+' | head -n1 || true)
  token=$(echo "$line" | grep -oE 'token=[^&[:space:]"'\'']+' | head -n1 | cut -d= -f2 || true)

  echo " 容器内日志：$line"

  if [ -n "$raw_url" ]; then
    path_query=$(echo "$raw_url" | sed -E 's#^https?://[^/]+##')
    [ -z "$path_query" ] && path_query="/"

    if [[ "$path_query" == /* && "$path_query" != /lan/* ]]; then
      echo " 管理入口  ：http://127.0.0.1:${WEB_PORT}${path_query}"
    fi
  fi

  if [ -n "$token" ]; then
    echo " Token     ：$token"
    echo " 成员访问  ：http://${LAN_HOST}:${LAN_PORT}/lan/?token=${token}"
    echo " 管理访问  ：http://${LAN_HOST}:${LAN_PORT}/?token=${token}"
  else
    echo " Token     ：<未从日志解析到，请手动确认>"
  fi
  echo "------------------------------------------------------------"
done <<< "$DSH_LINES"

echo " 网络模式  ：host（无 -p 映射，容器直接占用宿主端口）"
echo " SSH       ：ssh -p ${SSH_PORT} dsh@<服务器IP 或 dsh-lan>  (用户 dsh / 密码 dsh123)"
echo " 宿主端口  ：WEB=${WEB_PORT}  SSH=${SSH_PORT}  BILI=${BILI_ZONE_PORT}  (dsh内部=${DSH_PORT})"
echo " bili UI   ：http://127.0.0.1:${BILI_ZONE_PORT}/__bili/  (服务器本机浏览器打开这个)"
echo " bili 探测 ：http://127.0.0.1:${BILI_ZONE_PORT}/__bili/plugin/status?conversationId=<会话ID>&fallback=latest"
echo " bili 链路 ：宿主 ${BILI_ZONE_PORT} == 容器 bili 本体（host 直连，无 nginx 中转）"
echo " 查看日志  ：docker logs -f $CONTAINER 2>&1 | grep 'dsh web:'"
echo "============================================================"
