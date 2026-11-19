# 本地修复说明

本目录是 `@sunbigfly/dsh-multi-user-service` 0.1.1 的修复版，对应
`multi-user-service-fixes.md` 的落地结果；`../multi-user-service-landlock-scope.patch`
是对上游原版的 unified diff（`patch -p1` 可用）。

## 修复内容

1. **成员会话没有工具**（`member-host.mjs`、`carrier/tool-origins.mjs`、`carrier/host-package.mjs`）
   - `dsh-scope` 按多个候选加载（`resolveHostPackage`、tools 目录反推源码/构建产物、裸包名），
     并在 `agent/created` 用 `scopeOf(agent.ctx) !== undefined` 实测选定真正共享状态的模块实例。
   - 所有可达的 `ToolRuntime` 副本都被 patch 进同一个 `WeakMap`，live runtime 最后 patch，
     解决 tsx 源码树与 CJS 解析各加载一份、模块级私有状态不共享导致 origins 表为空的问题。
   - `host-package.mjs` 通过 package.json / main 字段反推真实安装路径，不再依赖裸包名解析。

2. **成员执行报 "Member execution requires a working native directory boundary"**
   （`carrier/member-boundary.mjs`）
   - launcher 候选顺序：调用方注入（测试用）→ 包内 `native/landlock-run` →
     `/home/dsh/native/landlock-run` → Host 平台包 `launcherPath()`。
   - verdict 接受 `full` 与 `partial`：Landlock ABI 4 已覆盖文件系统授权/拒绝，只缺较新的设备隔离，
     成员目录契约仍然成立。
   - 未安装 `@deepseek-ai/node-addon-system` 时，使用内置的最小 CLI 契约 shim
     （`--probe`、`--ro`/`--rw`、失败退出码 125），只依赖随包携带的 launcher。
   - 包内 launcher 若因拷贝丢失执行位，probe 前会尝试补 `0755`。

3. **成员上传的附件读不到（"位于会话工作区之外"）**
   （`carrier/member.mjs`、`carrier/attachments.mjs`、`carrier/file-mapping.mjs`、`member-host.mjs`）
   - 根因：DSH 上传后 AI 拿到的路径是附件存储路径（`/home/dsh/.dsh/attachments/…`），
     在成员会话工作区之外，被沙箱 `memberPathDenial` 拒绝；而 fs 的 `processPathFromHostPath`
     是「原样返回」的空翻译，未把该路径映射到成员可读的工作区。
   - 方案：上传成功后把附件镜像复制到成员会话工作区的 `.uploads/` 目录（0644），
     并把「附件路径 → 镜像路径」映射随 `attachment_access` 授权一并持久化（重启自动恢复）。
   - hook fs 服务的 `processPathFromHostPath`：命中映射即返回 `.uploads/` 镜像路径，
     AI 提示文本里的 `saved at "…"` 即变为可读路径；未命中（owner 上传/旧附件）原样回退。
   - 按附件存储路径（sha256 内容寻址、全局唯一）查表，无需 userId 上下文。

4. **其他**
   - 诊断日志改为环境变量 `DSH_LAN_DEBUG_LOG` 控制（不设置即完全关闭，不再写
     `/home/dsh/lan-tools-debug.log`）。
   - `package.json` 的 `files` 增加 `native/*`，安装/打包时携带 launcher。
   - `tests/member-boundary.test.js` 按 partial 语义更新，并支持注入 launcher 路径，
     测试不再依赖宿主机是否恰好装了 launcher。

## 文件

| 文件 | md5 |
| --- | --- |
| `member-host.mjs` | `869a4ec2518b3a5349aec0797dcc8f1e` |
| `carrier/tool-origins.mjs` | `9816b8b1466c07a91113727f5c329fa0` |
| `carrier/member-boundary.mjs` | `b00ae43566d6d419b58b080db3c0eb0c` |
| `carrier/host-package.mjs` | `98a5cc46cf598ff6675f28269164cf2d` |
| `tests/member-boundary.test.js` | `0983ad142ec658ba35c0fb11de25a6ef` |

`native/landlock-run`：686792 字节，sha256
`22acb3b7a2781957b3ff11474d608fab9221f9717b230ede65ad36259cdf8656`，
由 `native/system/packages/entry/src/main.c` 静态编译（去掉了 partial 行写 stderr 的行为，
因为该行会被 `fatalSignatures: ['landlock-run:']` 误判为沙箱故障）。

## 使用

- **当前容器**：同样的代码已同步到
  `/home/dsh/.dsh/profiles/web/node_modules/@sunbigfly/dsh-multi-user-service`
  （含 `native/landlock-run`）。重启 `dsh web` 后加载；成员需要新建会话
  （旧会话的工具列表全被标了 `defer_loading`，会 400）。
- **重新安装**：把本目录作为插件源安装，或直接安装本仓库：
  `dsh plugin --profile web add -w github:ysz-leo/dsh-multi-user-service`。
- **重建 Docker 镜像**：Dockerfile 里应改为 `dsh plugin --profile web add -w github:ysz-leo/dsh-multi-user-service`
  以拉取本修复版；若仍写 `github:sunbigfly/dsh-multi-user-service` 则拉的是上游原版，故障会回来。

## 验证

- `npm run check` 通过。
- `DSH_LAN_CONTRACT_MODULES=/app/node_modules/.pnpm/node_modules node --test tests/*.test.js`：
  495 项，486 通过，9 项失败全部来自本容器环境，与补丁无关：
  - 2 项（严格边界集成）：`/app` 源码树的 `node_modules` 是软链，Landlock 只授权了 modules
    根目录；额外授予 `/app/packages`、`/app/vendor` 后该文件 11/11 通过，正常安装布局无此问题。
  - 6 项：镜像缺 `@deepseek-ai/node-addon-system` 平台包，DSH 自身 sandbox 回退到 bwrap，
    其读策略比上游测试假设的 Landlock 后端更严（fixture 为 `strict: false`，不经过本插件边界）。
  - 1 项：`systemd-analyze` 未安装。
- 本机 `native/landlock-run --probe` 输出 `landlock: partially enforced (older ABI)`；
  partial 下成员 bash / PTC / glob 实测可用。

## 限制

- WSL2 内核 6.6（Landlock ABI 4）只能 partial，缺 ioctl 设备隔离；内核 ≥ 6.10 才是 full。
- 文件系统访问仍受 Landlock 强制，成员目录/共享目录契约不受影响。
