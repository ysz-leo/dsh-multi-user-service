# DSH 多用户服务修复说明：成员入口与 owner 入口的界面隔离

> 适用版本：`@ysz-leo/dsh-multi-user-service`（DSH 镜像 `deepseek-harness:v0.2.1-rc.2`）
> 修改文件：仅 `carrier/member-boot.mjs`（一处）
> 修复目标：让 `/lan/` 成员入口用**原生侧边栏**（`sidebar-files`），`127.0.0.1` 直连仍用 `dsh-better-sidebar` 完整功能。这是本仓库若干修复之一（其余见 [PATCH-NOTES.md](PATCH-NOTES.md)）。

---

## 一、问题背景

多用户服务插件（`@ysz-leo/dsh-multi-user-service`）为 DSH 提供了 `/lan/` 成员入口，成员/管理员通过 `/lan/` 登录后访问。系统同时安装了第三方侧边栏插件 `dsh-better-sidebar`，以及依赖它的两个插件：

- `dsh-bilingual-reader`（双语阅读器）
- `dsh-video-preview`（视频预览）
- `@huanlin/dsh-plugin-better-sidebar-plugin-audio`（音频预览）

预期行为：

| 入口 | 侧边栏 |
|---|---|
| `/lan/`（成员，`dsh-lan:3080`） | 原生 `sidebar-files` 文件树 |
| `127.0.0.1:3080` 直连（owner） | `dsh-better-sidebar` 完整功能 |

**症状**：成员通过 `/lan/` 打开文件时，报 `Member CSRF verification failed` / `403 forbidden` / `Failed to load plugins: pending (waiting for service: betterSidebar)`。

---

## 二、根因（三层）

1. **better-sidebar 不是 graph 顶层 entry**：它通过 `dsh-bilingual-reader` 的 `inject: ["betterSidebar"]`，被 DSH 的 client-modules 系统**内联进 combo bundle 的 url**（`plugins/??...dsh-better-sidebar/client.js,...&rev=xxx`）。所以单纯过滤 `graph.entries` **无法触及它**——它在 batch 的 `url` 里，不在 `entries` 数组里。

2. **better-sidebar 的文件操作走 `/sidebar/api/*`**（不是 `/lan/api/*`），用的是 DSH 原生 fence（要求 owner 的 `dsh-auth-*` cookie），而 `/lan/` 登录只有 `dsh_lan_member` cookie，两者不互通 → 一打开文件就 CSRF/403 失败。

3. **依赖插件会连带报错**：`dsh-bilingual-reader`、`dsh-video-preview` 都声明/硬编码了 `inject: ["betterSidebar"]`。若只移除 better-sidebar 而不移除它们，它们会在启动时 `pending (waiting for service: betterSidebar)`，导致 `1 entry did not activate`。

> ⚠️ 关键排查经验：判断某插件是否依赖 better-sidebar，**不能只看 `package.json` 的 `inject` 字段**。
> `dsh-video-preview` 的 package.json 里 `inject` 只有 `@deepseek-ai/dsh-client-runtime`，但它的
> `client.js` 第 190 行硬编码了 `inject: ["betterSidebar"]`。必须 grep 插件源码确认。

---

## 三、正确改动（只改 member-boot.mjs）

### 改动点 1：`OWNER_CLIENT_MODULES` 加入 better-sidebar

```js
const OWNER_CLIENT_MODULES = new Set([
  '@deepseek-ai/dsh-client-ui-open-in-app',
  'dsh-better-sidebar',      // 新增
]);
```

### 改动点 2：新增依赖集合 `BETTER_SIDEBAR_DEPENDENTS`

```js
/** 只在 owner 的 better-sidebar 旁边才有意义的插件；/lan/ 下必须与 better-sidebar 一起移除，
 *  因为它们的 client bundle 声明了 `inject: ["betterSidebar"]`，会把 better-sidebar 的
 *  client.js 拉进 combo url（尽管 better-sidebar 本身不是顶层 graph entry）。 */
const BETTER_SIDEBAR_DEPENDENTS = new Set([
  'dsh-bilingual-reader',
  'dsh-video-preview',
  '@huanlin/dsh-plugin-better-sidebar-plugin-audio',
]);
```

**今后若新增依赖 better-sidebar 的插件**（启动时报 `pending (waiting for service: betterSidebar)`），把插件名加进这个集合即可。

### 改动点 3：新增 `stripComboModules()` 函数

用于清洗 combo url 中被打包进来的 better-sidebar / 依赖插件的 `/client.js` 片段：

```js
function stripComboModules(url, ids) {
  if (typeof url !== 'string' || url === '' || ids.size === 0) return url;
  // combo url 形如 `plugins/??<模块>/client.js,<模块>/client.js,...&rev=<hash>`
  // 注意：`??` 是 loader 前缀的一部分（不是 query），`&rev=` 用 `&` 连接（没有独立的 `?`）
  // 所以必须用 lastIndexOf('&') 分割，绝不能用 split('?')（会误拆 `??`）
  const amp = url.lastIndexOf('&');
  const path = amp === -1 ? url : url.slice(0, amp);
  const query = amp === -1 ? '' : url.slice(amp);
  if (!path.includes(',')) return url;
  const segments = path.split(',');
  const kept = segments.filter(segment => {
    const module = segment.split('/').pop();                                   // "xxx/client.js" -> "client.js"
    const id = segment.slice(0, segment.length - module.length - 1);           // 去掉末尾 "/client.js"
    return !ids.has(id);
  });
  return kept.length === segments.length ? url : `${kept.join(',')}${query}`;
}
```

### 改动点 4：改写 `memberClientGraph()`

```js
export function memberClientGraph(graph, administrator = false) {
  const omitted = id => id === 'dsh-better-sidebar'
    || BETTER_SIDEBAR_DEPENDENTS.has(id)
    || (!administrator && OWNER_CLIENT_MODULES.has(id));
  const stripped = new Set([...OWNER_CLIENT_MODULES, ...BETTER_SIDEBAR_DEPENDENTS]);
  return {
    ...graph,
    entries: graph.entries.filter(entry => !omitted(entry.id)),
    batches: graph.batches.map(batch => ({
      ...batch,
      entries: batch.entries.filter(id => !omitted(id)),
      ...(batch.url ? { url: stripComboModules(batch.url, stripped) } : {}),
    })).filter(batch => batch.entries.length > 0),
  };
}
```

**语义**：
- `dsh-better-sidebar` 与 `BETTER_SIDEBAR_DEPENDENTS`：**无论 admin 还是普通成员，在 `/lan/` 下都过滤**。
- 其他 `OWNER_CLIENT_MODULES`（如 `open-in-app` 桌面应用入口）：**仅普通成员过滤，admin 保留**（Host 管理需要）。

---

## 四、三处同步（重要！）

改完必须同步到**三处**，否则可能不生效：

1. **宿主机源码**（固化，重建镜像用）：`D:/BackUp/Docker/dsh-multi-user-service/carrier/member-boot.mjs`
2. **容器 `/opt` 源码**（Dockerfile `COPY` 源）：`/opt/dsh-plugins/dsh-multi-user-service/carrier/member-boot.mjs`
3. **运行时 hash 副本**（**真正被加载的那个**）：`.pnpm` 里带 hash 后缀的副本

> ⚠️ **最关键的坑**：运行时真正加载的是 `node_modules/@ysz-leo/dsh-multi-user-service` 符号链接
> 指向的 `.pnpm/@ysz-leo+dsh-multi-user-service@..._<hash>/node_modules/.../carrier/`。
> 该目录名会随 `dsh plugin add` 变化。**只改 `/opt` 或非 hash 副本都不会生效**，必须确认符号链接
> 指向哪个 hash 副本，改那个。定位方式：
>
> ```sh
> readlink /home/dsh/.dsh/profiles/web/node_modules/@ysz-leo/dsh-multi-user-service
> ```

### 同步命令（在宿主机执行）

```sh
# 1. 复制到容器临时目录
docker cp /d/BackUp/Docker/dsh-multi-user-service/carrier/member-boot.mjs dsh-web:/tmp/member-boot.mjs

# 2. 容器内分发到三处（HASH 路径用 readlink 确认后的真实值）
docker exec dsh-web sh -c '
HASH=/home/dsh/.dsh/profiles/web/node_modules/.pnpm/@ysz-leo+dsh-multi-user-service@file+..+..+..+..+..+opt+dsh-plugins+dsh-multi-user-se_<hash>/node_modules/@ysz-leo/dsh-multi-user-service/carrier
NOHASH=/home/dsh/.dsh/profiles/web/node_modules/.pnpm/@ysz-leo+dsh-multi-user-service@file+..+..+..+..+..+opt+dsh-plugins+dsh-multi-user-service/node_modules/@ysz-leo/dsh-multi-user-service/carrier
cp /tmp/member-boot.mjs $HASH/member-boot.mjs
cp /tmp/member-boot.mjs $NOHASH/member-boot.mjs
sudo cp /tmp/member-boot.mjs /opt/dsh-plugins/dsh-multi-user-service/carrier/member-boot.mjs
chown dsh:dsh $HASH/member-boot.mjs $NOHASH/member-boot.mjs
node --check $HASH/member-boot.mjs && echo "syntax OK"
'

# 3. 重启容器
docker restart dsh-web
```

> 注意：`/opt` 是 root 属主，容器内普通用户需 `sudo cp`。

---

## 五、验证方法

重启后（DSH 启动较慢，约 1~2 分钟，需等 13080 端口监听）：

```sh
# 登录拿 cookie
docker exec dsh-web sh -c 'curl -s -i -X POST http://127.0.0.1:13080/lan/admin/auth \
  -H "Host: dsh-lan:3080" -H "Origin: http://dsh-lan:3080" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"login\",\"username\":\"admin\",\"password\":\"<密码>\",\"remember\":true}" \
  | grep -i set-cookie'

# 请求 /lan/ 页面，检查模块计数（应为 better-sidebar=0、bilingual-reader=0、video-preview=0、sidebar-files≥1）
docker exec dsh-web sh -c 'curl -s "http://127.0.0.1:13080/lan/" \
  -H "Host: dsh-lan:3080" -H "Origin: http://dsh-lan:3080" -H "Cookie: dsh_lan_member=<cookie>" \
  > /tmp/lp.html; \
  echo "better-sidebar: $(grep -c better-sidebar /tmp/lp.html)"; \
  echo "bilingual-reader: $(grep -c bilingual-reader /tmp/lp.html)"; \
  echo "video-preview: $(grep -c video-preview /tmp/lp.html)"; \
  echo "sidebar-files: $(grep -c sidebar-files /tmp/lp.html)"'
```

**通过标准**：
- `better-sidebar` / `bilingual-reader` / `video-preview` 计数都为 **0**
- `sidebar-files` 计数 **≥ 1**（原生侧边栏保留）

owner 直连入口（`127.0.0.1:3080`）走 DSH 原生渲染，**不经过 `memberClientGraph`**，better-sidebar 完整保留、不受影响。

---

## 六、曾走过的弯路（避免重蹈）

| 错误尝试 | 后果 | 结论 |
|---|---|---|
| nginx 改写 `/lan/sidebar/` 转发 | 绕过认证，直接 403 forbidden | 已撤销，不动 nginx/Dockerfile |
| `member.mjs` 加 `sidebarMutation` 跳过 CSRF | 无效残留，还掩盖真实根因 | 已还原到原始状态 |
| `desktop.mjs` 加 `matchPrefix` 前缀路由 | 无效 | 已还原到原始状态 |
| 只改 `/opt` 或非 hash 副本 | 运行时加载 hash 副本，改动全不生效 | 必须改 hash 副本 |
| 只过滤 `graph.entries`，不清 combo url | better-sidebar 仍在 batch url 里 | 需 `stripComboModules` 清 url |
| `stripComboModules` 用 `split('?')` | 误拆 `plugins/??` 前缀，过滤失效 | 用 `lastIndexOf('&')` |
| 只看 package.json 的 inject 判断依赖 | 漏掉 video-preview（源码硬编码 inject） | 必须 grep 插件源码 |

---

## 七、维护要点

1. **新增依赖 better-sidebar 的插件**：把插件名加入 `BETTER_SIDEBAR_DEPENDENTS` 集合即可，逻辑自动生效。
2. **改完必须同步三处 + 重启容器**，且确认 hash 副本路径（`dsh plugin add` 后目录名会变）。
3. **重建镜像**：宿主机源码 `D:/BackUp/Docker/dsh-multi-user-service/carrier/` 会被 Dockerfile 的 `COPY ./dsh-multi-user-service` 打进去，无需额外操作。
4. **admin 密码**：本次排查曾用 scrypt 将 admin 密码重置为 `admin123456` 用于复现，请自行改回；原数据备份在容器内 `/home/dsh/.dsh/storages/lan_workspace.json.bak-before-csrftest`。
