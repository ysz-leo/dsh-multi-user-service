> ## 📌 本仓库说明（Fork / 修复版）
>
> 本仓库是 [sunbigfly/dsh-multi-user-service](https://github.com/sunbigfly/dsh-multi-user-service)（原作者 **sunbigfly**，MIT License）的派生修复版。
>
> - **原作者**：[@sunbigfly](https://github.com/sunbigfly) —— 上游仓库与原创实现
> - **上游仓库**：<https://github.com/sunbigfly/dsh-multi-user-service>
> - **许可证**：沿用上游 [MIT License](LICENSE)（Copyright © 2026 LAN Workspace contributors）
> - **改动**：针对「DSH 以源码树 + tsx 方式运行」场景的兼容性修复，详见下方「相对上游的改动」与 [`PATCH-NOTES.md`](PATCH-NOTES.md)。
>
> 相对上游的改动（`v0.1.1` → 本版）：
>
> | 文件 | 改动 |
> | --- | --- |
> | `carrier/host-package.mjs` | 新增 `hostSourceCandidates()`：从宿主入口向上反推源码树候选路径，供无法用 CJS 解析命中的场景兜底 |
> | `carrier/tool-origins.mjs` | 把**所有可达的 `ToolRuntime` 副本** patch 进同一张来源表，并额外对宿主 live runtime 的类做权威 patch，解决模块级私有状态不共享导致工具来源表为空的问题 |
> | `member-host.mjs` | `dsh-scope` 改为多候选加载 + 运行时用 `scopeOf(agent.ctx) !== undefined` 实测选定真正共享状态的实例 |
> | `carrier/member-boundary.mjs` | 启动器候选解析 + 本地/包内 `landlock-run` 回退 + **接受 `partial`**（放宽上游 `=== 'full'` 硬门槛），并内置 `@deepseek-ai/node-addon-system` 的最小 CLI 契约 shim |
> | `carrier/member-boot.mjs` | `/lan/` 成员入口过滤 `dsh-better-sidebar` 及其依赖插件，恢复原生 `sidebar-files` 侧边栏（避免 CSRF/403） |
> | `native/landlock-run` | 随包携带的静态编译启动器（去掉 partial 写 stderr 的行为，避免被 `fatalSignatures` 误判） |
> | `tests/member-boundary.test.js` | 按 partial 语义更新，支持注入 launcher 路径 |
> | `package.json` | 包名/仓库地址改为本仓库；`files` 增加 `native/*` |
> | `carrier/member.mjs` | 上传成功后把附件**镜像复制**到成员会话工作区的 `.uploads/` 目录（0644），使受沙箱约束的 read 工具可直接读取 |
> | `carrier/attachments.mjs` | `record()` 新增 `mirror` 参数持久化「附件路径 → 镜像路径」映射；新增 `mirrorOf(hostPath)` 跨用户按全局唯一路径反查镜像 |
> | `carrier/file-mapping.mjs` | 新增：包装 fs 服务的 `processPathFromHostPath`，把附件存储路径翻译为工作区镜像路径，未命中（owner 上传/旧附件）原样回退 |
> | `member-host.mjs` | 通过 `ctx.inject(['fs'], …)` 安装上述路径翻译 hook，带清理还原 |
>
> 这些改动是**向后兼容的增强**：在发布包形态（`npx @deepseek-ai/dsh`）下走第一候选直接命中、行为与上游一致；在源码树 + tsx 形态下补齐了上游缺失的兼容性。详见下文「[与上游仓库的功能对比](#与上游仓库的功能对比)」及 [`PATCH-NOTES.md`](PATCH-NOTES.md)。

---

<p align="center">
  <img src="assets/logo.png" width="112" alt="DSH Multi-User Service Logo">
</p>

<h1 align="center">DSH 多用户服务</h1>
<p align="center">一台服务器，一套 DSH，为整个团队提供服务。</p>
<p align="center">源码 <b>v0.1.1</b> · 已验证 DSH <b>0.2.1-rc.2</b></p>

在公司或团队的服务器上运行一套 DSH，让多人通过浏览器登录使用。成员各自管理会话与文件，管理员统一管理账号、权限和用量。

插件负责多用户管理，模型、Skills、Agent 预设、工具、终端和代码执行复用 DSH 原生能力，并为成员增加目录访问边界。

## 功能

- **账号管理**：创建与邀请成员、分配管理员；支持归档、恢复及归档后删除账号，保留会话和文件。
- **权限分配**：按成员授权模型、工具、Skills、MCP、Agent 预设和目录；工具支持黑名单与白名单两种模式，新账号默认使用黑名单。支持按筛选跨页全选、批量设置及查看生效范围。
- **会话与文件**：两个独立导航入口；成员管理自己的内容，管理员统一管理，右侧文件列表支持右键操作。
- **执行工具**：在共享环境的右侧内容区登记 CLI、扫描已配置的 tool-runner 来源、查看操作与配置授权；指定工具和扫描工具分别分页，使用说明通过信息图标查看。
- **独立浏览器适配**：单独安装 `dsh-browser` 后，可在右侧页签浏览和操作网页，AI 与手动操作共用当前会话页面；多用户服务只负责账号与工具授权。
- **用量控制**：搜索、筛选并分页查看成员用量，设置并发任务数及每日、每月 tokens 额度。
- **统一外观**：设置共享 Logo、名称与标签，登录页直接复用；支持自定义首页标语。

### 兼容性（本版重点）

- **多用户使用插件本身的工作空间**：每个成员拥有独立的工作目录（`…/workspace/<时间戳>`），会话、文件、代码执行都在各自的成员工作空间中隔离进行，互不影响。
- **源码树形态与发布包形态均可正常使用**：
  - 发布包形态（`npx @deepseek-ai/dsh web` / `npm i -g @deepseek-ai/dsh`）—— 开箱即用，与上游行为一致。
  - 源码树形态（`git clone` + `pnpm install` + `pnpm dsh web`，即 tsx 实时运行 `src/*.ts`）—— 本版修复了上游在该形态下「模块被加载成多份实例」导致的问题。
- **不会出现工具无法调用等报错**：修复了成员会话 `request/header` 无 `tools`（模型把工具调用写成正文）、`all tools cannot be deferred`（400）等问题；成员 `write` / `bash` / `glob` 等工具可正常调用执行。
- **成员上传的附件可被 AI 正常读取**：上传文件后，插件会把附件**镜像复制**到该成员会话工作区的 `.uploads/` 目录，并 hook 文件系统的 `processPathFromHostPath`，让 AI 在提示文本里拿到的就是工作区内可读的镜像路径（而非沙箱之外的附件存储路径），read 工具直接可读。映射关系随附件授权一并持久化，容器重启后自动恢复；owner 上传及旧附件无镜像记录，路径翻译原样回退，不受影响。

可用于公司内网或已配置的公网入口；成员使用管理员创建或邀请的账号登录。

## 与上游仓库的功能对比

本修复版基于上游 [sunbigfly/dsh-multi-user-service](https://github.com/sunbigfly/dsh-multi-user-service) 派生，除继承其全部多用户管理能力外，针对实际部署场景补齐了若干上游缺失或不可用的能力。下表按功能维度对比两版差异：

| 功能 | 上游仓库 | 本修复版 |
| --- | --- | --- |
| **源码树 + tsx 方式运行** | 模块被加载成多份实例，工具来源表为空、`dsh-scope` 拿不到真正共享状态，导致成员会话无工具、工具调用报错 | ✅ 多候选解析 + 运行时 `scopeOf` 实测选定共享实例，源码树与发布包两种形态均可正常调用工具 |
| **成员代码执行边界** | 依赖完整 Landlock（`full`），内核/环境不满足时报 "working native directory boundary"，成员执行被拒 | ✅ 接受 `partial` 判定，内置 `landlock-run` 静态启动器与 CLI 契约 shim，WSL2 等 partial 环境成员 bash / 代码执行可用 |
| **成员侧边栏** | `dsh-better-sidebar` 在 `/lan/` 下触发 CSRF/403 | ✅ 成员入口过滤该插件及其依赖，恢复原生 `sidebar-files` 侧边栏 |
| **成员上传文件的读取** | AI 拿到的是附件存储路径（会话工作区之外），read 工具被沙箱拒绝 | ✅ 上传后镜像复制到成员工作区 `.uploads/`，并 hook 路径翻译，AI 直接拿到可读镜像路径（详见上文「兼容性」） |
| **诊断日志** | 默认写 `/home/dsh/lan-tools-debug.log` | ✅ 改为环境变量 `DSH_LAN_DEBUG_LOG` 控制，默认关闭 |
| **发布形态** | `npx @deepseek-ai/dsh` 正常，源码树形态存在兼容问题 | ✅ 两种形态均开箱即用，向后兼容 |

> 以上均为**向后兼容的增强**：在发布包形态下行为与上游一致；源码树 + tsx 形态下补齐了上游缺失的兼容性。完整修复清单与验证记录见 [`PATCH-NOTES.md`](PATCH-NOTES.md)。

## 开始使用

### 1. 安装插件

已有可用的 DSH 服务即可。账号、权限和文件管理使用 DSH 现有运行环境，不要求另装 Python 或 systemd。工作区浏览器需单独安装、启用 `dsh-browser`，并具备 Linux、Chrome / Chromium 和 bubblewrap；未安装或条件不满足时不显示浏览器入口，账号功能仍可使用。成员不需要 sudo 权限。

**推荐：直接使用本仓库代码安装**（在 DSH 服务所在机器上执行）：

```sh
dsh plugin --profile web add -w github:ysz-leo/dsh-multi-user-service
```

安装后重启 `dsh web`，在侧栏 **多用户服务** 中完成首次设置即可。

> 若 DSH 版本较老、`dsh plugin` 不支持直接拉 GitHub 仓库，也可先把本仓库克隆到本地后从本地目录安装：
>
> ```sh
> git clone https://github.com/ysz-leo/dsh-multi-user-service.git
> dsh plugin --profile web add -w ./dsh-multi-user-service
> ```

**说明**：本版已包含相对上游的修复（多形态兼容、Landlock 边界回退、成员侧边栏隔离等），直接安装本仓库即可获得完整修复，无需再叠加任何补丁。安装包同时包含「工具权限归属」「DSH 多用户服务」「执行工具」三个配套组件。

### 使用 Docker 部署（可选）

#### 联网拉取 DSH 源码

Dockerfile 在构建时通过 `git clone` 联网拉取上游 `deepseek-harness` 仓库的固定 tag（默认 `dsh-v0.2.1-rc.2`），这一步需要构建机能够访问 GitHub。整个过程自包含，用户无需手动 clone DSH 源码；若希望手动预先拉取（例如放到内网镜像仓库或离线构建），可在构建机单独执行下面的 clone 命令：

```sh
# 拉取固定 tag（浅克隆，只取该版本，最快）
git clone --depth 1 --branch dsh-v0.2.1-rc.2 https://github.com/deepseek-ai/deepseek-harness.git
```

> 提示：`deepseek-harness` 是 pnpm monorepo，`docker build` 时会执行 `pnpm install --frozen-lockfile && pnpm run build` 编译出 `lib/` 产物，随后以「源码树 + tsx」方式运行。构建环境需能访问 GitHub 与 npm registry（Dockerfile 内已配置清华镜像加速 apt/pip）。

仓库 `Docker/` 目录提供了完整的容器化部署方式，DSH 与插件打包进同一个镜像，开箱即用。构建命令在**本插件仓库目录**下执行（`docker build` 的上下文是插件仓库根目录）：

```sh
# 1. 获取本插件仓库并进入（docker build 在此目录执行）
git clone https://github.com/ysz-leo/dsh-multi-user-service.git
cd dsh-multi-user-service

# 2. 构建镜像（在插件仓库根目录执行）
docker build -t dsh-multi-user:0.2.1-rc.2 -f Docker/Dockerfile .

# 3. 编辑 Docker/start-dsh-web.sh 顶部「配置区」（端口、域名、工作区路径、API Key）

# 4. 一键启动
./Docker/start-dsh-web.sh
```

- Dockerfile 两阶段构建：先从上游 `dsh-v0.2.1-rc.2` 编译 DSH（源码树 + tsx），再组装运行环境（nginx 反代成员入口 + sshd + 本插件）。
- 镜像自包含，不依赖宿主机上的 DSH 源码目录；本插件从本仓库安装（`github:ysz-leo/dsh-multi-user-service`）。
- 启动脚本会自动等待 dsh 就绪并打印管理入口、成员入口与访问 token。

#### 配置 `LAN_HOST` 的 IP 映射（必做）

成员入口走 `/lan/`，其 `memberOrigin` 与 nginx 的 `trusted-host` 校验都依赖 `LAN_HOST` 这个域名。默认 `LAN_HOST=dsh-lan`，**当前方式下服务器（成员入口）地址即为 `http://dsh-lan:${HOST_WEB_PORT}/lan/`**（`HOST_WEB_PORT` 为宿主机映射端口，默认 `3080`）。浏览器是通过这个地址访问的，因此**必须让你（以及所有成员）的电脑能把 `dsh-lan` 解析到服务器的 IP**，否则 origin/trusted-host 校验会失败、成员入口无法正常使用。

做法：在本机 hosts 文件里加一行域名到 IP 的映射。以服务器 IP 为 `<服务器IP>`、端口 `3080` 为例：

- **Windows**：用管理员权限编辑 `C:\Windows\System32\drivers\etc\hosts`，追加一行：
  ```
  <服务器IP>  dsh-lan
  ```
- **macOS / Linux**：编辑 `/etc/hosts`，追加同一行：
  ```
  <服务器IP>  dsh-lan
  ```
- 保存后刷新 DNS 缓存：Windows 执行 `ipconfig /flushdns`，macOS 执行 `sudo dscacheutil -flushcache`，Linux 通常无需刷新。

完成后用 `ping dsh-lan` 验证能解析到服务器 IP，再用 `http://dsh-lan:${HOST_WEB_PORT}/lan/` 访问成员入口。若成员分布在多台电脑，需在**每一台**访问设备上都做同样的 hosts 映射；如果不想改 hosts，也可把 `LAN_HOST` 直接改成服务器的 IP 地址或一个真实可解析的域名。

完整说明（端口、环境变量、默认账号、常用命令）见 [`Docker/README.md`](Docker/README.md)。

### 2. 完成首次设置

1. 在服务器本机已授权的 DSH 页面中配置可用模型。
2. 打开侧栏 **多用户服务**，创建管理员账号。
3. 按向导确认成员数据目录，可选用默认只读的推荐共享目录；推荐目录会在完成设置时创建。
4. 设置服务登录域名或 IP，核对当前服务端口与模型状态，再完成设置。之后管理员和成员都通过同一服务入口登录，角色只认服务端账号授权。

例如 `http://team-server.local:18620/lan/`。主机名解析由部署网络提供，例如 mDNS；插件保存域名入口并保留备用 IP 地址。已有安装沿用现有配置，无需重新初始化。

### 3. 添加成员

1. 打开 **多用户服务 → 成员管理**，选择 **新建账号** 或 **邀请成员**。
2. 先填写账号信息，再配置权限；也可复制现有成员的授权作为起点。
3. 新建账号时分享 **我的账号** 中的成员入口；邀请时直接复制生成的完整链接，成员打开后填写账号信息即可加入。
4. 在成员列表下方的 **邀请记录** 查看使用情况，撤销或重新签发邀请。邀请仅可使用一次，24 小时有效。

成员在 **我的账号 → 修改登录密码** 自助改密。管理员在成员的 **账号状态** 中修改显示名、角色与状态；交接时先提升接任者，再调整原管理员。多人同时编辑时，旧草稿会被拒绝并保留，重新加载后再保存。

| 入口 | 用途 |
| --- | --- |
| `http(s)://服务器地址/` | 转到统一服务入口 |
| `http(s)://服务器地址/lan/` | 所有服务账号登录、接受邀请，按角色使用功能 |
| `http(s)://服务器地址/lan/admin/` | 兼容旧地址，转到同一入口 |

实际协议、地址和端口以部署配置为准。

## 执行边界

成员的业务文件读写限定在本人目录与管理员授权的共享目录，覆盖文件入口、Bash、Node 代码执行、终端及子 Agent；“完全访问”预设也不能越过账号目录边界。共享目录的只读权限同样约束脚本。

执行使用 DSH 随附的原生 Landlock 启动器，不新增系统依赖或独立执行服务。系统运行库与 DSH 程序文件只读，临时文件和配置目录归入成员个人目录，宿主环境中的凭据不传给成员进程。原生隔离校验未通过时，成员执行会被拒绝。

宿主共享 MCP 和无法验证隔离的第三方工具插件暂不对成员开放，授权不能绕过此限制；服务器本机的宿主工具保持原有能力。网络仍沿用 DSH 与服务器配置，本边界不宣称网络或完整虚拟机隔离。

当前已在 DSH `0.2.1-rc.2` 的 Linux/WSL 服务端验证；其他 DSH 版本与服务端平台尚未验证。成员设备通过浏览器访问。

安装包：`@ysz-leo/dsh-multi-user-service`。在同一 profile 更新即可保留账号、会话与文件；更新后刷新已打开的管理页面。从上游旧名称包（`@sunbigfly/dsh-multi-user-service`）迁移时，需先在原 profile 停用、卸载，再安装本包。已有 `dsh-lan` 命令与 `/lan/` 路径继续兼容。

可选运维脚本、备份与恢复见 [配置与运维](docs/operations.md)。这些脚本不是插件运行前提。

## 相关文档

- [`PATCH-NOTES.md`](PATCH-NOTES.md) —— 本版相对上游的修复清单与验证记录
- [`dsh-multi-user-service修复说明.md`](dsh-multi-user-service修复说明.md) —— 成员入口与 owner 入口界面隔离（`/lan/` 与直连）的修复说明

MIT License
