#!/bin/bash
set -euo pipefail

# =============================================================================
# DSH 多用户服务 —— 容器启动脚本
# 用法：./Docker/start-dsh-web.sh
# 按需修改下方「配置区」后执行，脚本会自动：删旧容器 → 启动 → 等待 dsh 就绪 → 打印访问地址。
# =============================================================================

# ========================== 配置区（按需修改） ==========================
# 宿主机对外口 与 容器内部口 相互独立，均可按需更改：
#   - 宿主机对外口（HOST_WEB_PORT / SSH_HOST_PORT）：浏览器/SSH 实际连接的宿主机端口，
#     通过 docker run -p 映射到容器内部口；改这里不影响容器内监听口。
#   - 容器内部口（WEB_PORT / DSH_PORT）：容器内 nginx / dsh 的监听口，
#     改这里需同时保证与宿主机映射、以及 entrypoint 内部逻辑一致。
IMAGE="dsh-multi-user:0.2.1-rc.2"   # 镜像名，与 docker build -t 保持一致
CONTAINER="dsh-web"                  # 容器名

# —— 宿主机对外口（按需更改）——
HOST_WEB_PORT=3080     # 浏览器实际访问的宿主机端口
SSH_HOST_PORT=220      # 宿主机 SSH 映射口

# —— 容器内部口（按需更改，与 Dockerfile ENV 一致，可覆盖）——
WEB_PORT=3080          # 容器内 nginx 监听口
DSH_PORT=13080         # 容器内 dsh 本体监听口（不对外，nginx 反代）

# —— bili(billion-context) 反代端口 ——
# 链路：宿主 BILI_ZONE_PORT -> 容器 BILI_PROXY_PORT(nginx) -> 127.0.0.1:BILI_ZONE_PORT(bili 本体回环)
# 插件探测与浏览器访问写死宿主 18787，故 BILI_ZONE_PORT 默认 18787；
# bili 本体 host 硬编码回环，-p 无法直接命中，必须经 nginx 专用口 BILI_PROXY_PORT 中转。
BILI_ZONE_PORT=18787   # 宿主对外入口端口（=bili 本体监听口，插件写死 18787）
BILI_PROXY_PORT=18781  # 容器内 nginx bili 专用反代口（18781 -> bili 18787）

# —— 对外可达地址：LAN_HOST + LAN_PORT 必须等于浏览器看到的 host:port ——
# 建议在 hosts 文件中将域名映射到服务器 IP，例如：
#   C:\Windows\System32\drivers\etc\hosts 或 /etc/hosts
#   <服务器IP>  dsh-lan
LAN_HOST=dsh-lan
LAN_PORT="${HOST_WEB_PORT}"   # 不填则跟随 WEB_PORT（与 Dockerfile 一致）

# —— 工作区挂载（成员会话数据所在目录，务必改成你自己的路径）——
WORKSPACE="/path/to/your/workspace"

# —— 模型 API Key（必填，替换为你自己的 key）——
DEEPSEEK_API_KEY="sk-xxxx"
# ========================================================================

# 一致性校验
if [[ "${LAN_PORT}" != "${HOST_WEB_PORT}" ]]; then
  echo "警告：LAN_PORT(${LAN_PORT}) 与 HOST_WEB_PORT(${HOST_WEB_PORT}) 不一致，" \
       "origin/trusted-host 校验可能失败" >&2
fi
if [[ "${DSH_PORT}" == "${WEB_PORT}" ]]; then
  echo "错误：DSH_PORT 与 WEB_PORT 相同(${WEB_PORT})，nginx 与 dsh 会抢同一监听口" >&2
  exit 1
fi
if [[ "${BILI_PROXY_PORT}" == "${BILI_ZONE_PORT}" ]]; then
  echo "错误：BILI_PROXY_PORT 与 BILI_ZONE_PORT 相同(${BILI_ZONE_PORT})，nginx 反代口会与 bili 本体抢同一监听口" >&2
  exit 1
fi
if [[ "${DEEPSEEK_API_KEY}" == "sk-xxxx" ]]; then
  echo "提示：DEEPSEEK_API_KEY 仍是占位符 sk-xxxx，请修改脚本后重试。" >&2
fi

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p "${HOST_WEB_PORT}:${WEB_PORT}" \
  -p "${SSH_HOST_PORT}:22" \
  -p "${BILI_ZONE_PORT}:${BILI_PROXY_PORT}" \
  -e WEB_PORT="${WEB_PORT}" \
  -e DSH_PORT="${DSH_PORT}" \
  -e DSH_BIND="127.0.0.1" \
  -e BILI_ZONE_PORT="${BILI_ZONE_PORT}" \
  -e BILI_PROXY_PORT="${BILI_PROXY_PORT}" \
  -e LAN_HOST="${LAN_HOST}" \
  -e LAN_PORT="${LAN_PORT}" \
  -e DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY}" \
  -v "${WORKSPACE}:/workspace" \
  --privileged \
  "$IMAGE"

echo "容器已启动：$CONTAINER，等待 dsh web 就绪..."

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

# ---------- 解析 URL / token（按行打印，多条都处理） ----------
echo
echo "============================================================"
echo " dsh-web 访问信息"
echo "============================================================"

while IFS= read -r line; do
  [ -z "$line" ] && continue
  raw_url=$(echo "$line" | grep -oE 'https?://[^[:space:]"'\'']+' | head -n1 || true)
  token=$(echo "$line" | grep -oE 'token=[^&[:space:]"'\'']+' | head -n1 | cut -d= -f2 || true)

  echo " 容器内日志：$line"

  if [ -n "$raw_url" ]; then
    # 从原始 URL 里剥出 path + query，再换 host/port 成外部可达地址
    path_query=$(echo "$raw_url" | sed -E 's#^https?://[^/]+##')
    [ -z "$path_query" ] && path_query="/"

    # 管理/owner 入口（/ 前缀）
    if [[ "$path_query" == /* && "$path_query" != /lan/* ]]; then
      echo " 管理入口  ：http://127.0.0.1:${HOST_WEB_PORT}${path_query}"
    fi
  fi

  if [ -n "$token" ]; then
    echo " Token     ：$token"
    echo " 成员访问  ：http://${LAN_HOST}:${HOST_WEB_PORT}/lan/?token=${token}"
    echo " 管理访问  ：http://${LAN_HOST}:${HOST_WEB_PORT}/?token=${token}"
  else
    echo " Token     ：<未从日志解析到，请手动确认>"
  fi
  echo "------------------------------------------------------------"
done <<< "$DSH_LINES"

echo " SSH       ：ssh -p ${SSH_HOST_PORT} dsh@${LAN_HOST}  (用户 dsh / 密码 dsh123)"
echo " 容器内口  ：WEB_PORT=${WEB_PORT}  DSH_PORT=${DSH_PORT}  DSH_BIND=127.0.0.1  BILI_ZONE_PORT=${BILI_ZONE_PORT}  BILI_PROXY_PORT=${BILI_PROXY_PORT}"
echo " 宿主机映射：${HOST_WEB_PORT} -> ${WEB_PORT}   ${SSH_HOST_PORT} -> 22   ${BILI_ZONE_PORT} -> ${BILI_PROXY_PORT}"
echo " bili UI   ：http://127.0.0.1:${BILI_ZONE_PORT}/__bili/  (浏览器打开这个)"
echo " bili 探测 ：http://127.0.0.1:${BILI_ZONE_PORT}/__bili/plugin/status?conversationId=<会话ID>&fallback=latest  (状态接口，须带 conversationId，否则 400)"
echo " bili 链路 ：宿主 ${BILI_ZONE_PORT} → nginx ${BILI_PROXY_PORT} → bili ${BILI_ZONE_PORT}"
echo " 查看日志  ：docker logs -f $CONTAINER 2>&1 | grep 'dsh web:'"
echo "============================================================"
