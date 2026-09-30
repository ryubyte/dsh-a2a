# dsh-a2a 版本兼容记录

让 `@ryubyte/dsh-a2a` 同时兼容 DSH `0.1.7-rc.2` 与 `0.2.0-rc.1`。版本确定为 **`0.3.1`**；本地验证通过，尚未在真实 DSH 宿主安装验收。临时冷却期豁免已移除。

| | |
|---|---|
| 版本 | `0.3.0` → `0.3.1` |
| 验证 | typecheck · test · build 全绿 |
| 改动文件 | `package.json` · `pnpm-lock.yaml` · `docs/dsh-compat.md` |
| 验收范围 | **本地构建与测试通过；真实 DSH `0.2.0-rc.1` 宿主安装尚未验收** |

> `.mnemon/` 与 `RELEASE_NOTES_v0.1.4.md` 是改动前就存在的未跟踪文件，与本次无关。

---

## 发布与宿主验收

1. CI 用冻结安装、类型检查、测试与构建验证提交。
2. 发布 `v0.3.1` GitHub Release；仓库的 `release.yml` 校验 tag 与 `package.json` 版本一致，再发布到 npm。
3. 在真实 DSH `0.2.0-rc.1` 宿主中安装并运行已发布的插件，确认设置面板与 A2A 服务正常；本地测试不能代替此项验收。

发布前若需要临时运行，可按 DSH 提供的显式风险接受流程，为具体 profile 放行旧版插件（由使用方自行评估风险）：

```sh
dsh plugin --profile <profile> allow-version @ryubyte/dsh-a2a@0.3.0 --dsh-version 0.2.0-rc.1 --accept-risk
```

---

## 根因

`^0.1.7-rc.2` 展开是 `>=0.1.7-rc.2 <0.2.0-0`。caret 作用在 `0.x` 上会把 minor 锁死，所以 `0.2.0-rc.1` 永远落在区间外。semver 语义里 `0.1 → 0.2` 等价于一次 major 升级。

不涉及代码迁移：两个版本的 tarball 逐文件比对过，a2a 依赖的五个包 **`.d.ts`、`.js`、`.map` 全部逐字节相同**，元数据除版本号外也一致。`0.2.0-rc.1` 是纯版本号 bump。

---

## DSH 的兼容性 gate

那条"可能导致崩溃或数据丢失"的拒绝来自 `@deepseek-ai/dsh-app-boot` 的 `evaluatePluginCompatibility`（打包进 `lib/index.js`，源区段 `lib/types/plugin-compatibility.js`），由 `dsh-plugin-manager` 在*安装前置检查*和*已安装包检查*两处调用。

```js
if (name !== "@deepseek-ai/dsh" && !name.startsWith("@deepseek-ai/dsh-")) continue;
if (requirement.trim() === "" || !semver.satisfies(runtimeVersion, requirement, { includePrerelease: true })) peers[name] = range;
```

- 只有 `@deepseek-ai/dsh` 和 `@deepseek-ai/dsh-*` 的 peer 进 gate。`cordis`、`react`、`react-dom` 直接跳过 —— DSH 升级时不用动。
- 比的是 **DSH runtime 版本**（app-boot 自己 `package.json` 的 version），**不是**该 peer 包实际安装的版本。
- `includePrerelease: true` —— 预发布版参与区间比较。
- `workspace:^` / `~` / `*` 视为"当前 runtime"，恒通过；空区间或非法区间判为不兼容。
- **从不读 `peerDependenciesMeta`** —— 整个 app-boot bundle 里没有这个字符串。所以标 `optional: true` **不能**豁免版本检查，只影响包管理器装不装。

逃生通道：`dsh plugin --profile <p> allow-version <name>@<ver> --dsh-version <runtime> --accept-risk`，按 profile 存在 `compatibility.json`，且与*精确*的（插件版本, runtime 版本）配对绑定。

---

## 改动

```diff
-  "version": "0.3.0",
+  "version": "0.3.1",

   "peerDependencies": {
     "@deepseek-ai/cordis": "^4.0.4",
-    "@deepseek-ai/dsh-client-ui-renderer": "^0.1.7-rc.2",
-    "@deepseek-ai/dsh-client-ui-slots": "^0.1.7-rc.2",
-    "@deepseek-ai/dsh-client-ui-settings": "^0.1.7-rc.2",
-    "@deepseek-ai/dsh-host-webserver": "^0.1.7-rc.2",
-    "@deepseek-ai/dsh-tools": "^0.1.7-rc.2",
+    "@deepseek-ai/dsh-host-webserver": "^0.1.7-rc.2 || ^0.2.0-rc.1",
+    "@deepseek-ai/dsh-tools": "^0.1.7-rc.2 || ^0.2.0-rc.1",
     "react": "^18.2.0",
     "react-dom": "^18.2.0"
   },
   "devDependencies": {
+    "@deepseek-ai/cordis": "^4.0.4",
+    "@deepseek-ai/dsh-client-ui-renderer": "0.2.0-rc.1",
+    "@deepseek-ai/dsh-client-ui-settings": "0.2.0-rc.1",
+    "@deepseek-ai/dsh-client-ui-slots": "0.2.0-rc.1",
+    "@deepseek-ai/dsh-host-webserver": "0.2.0-rc.1",
+    "@deepseek-ai/dsh-tools": "0.2.0-rc.1",
     "@types/node": "^22.0.0",
```

gate 面从 5 个 peer 降到 2 个，以后每次 DSH 升 minor 改 2 行。

**devDeps 钉死解决了一个歧义**：之前只放宽区间时，pnpm 仍然解析到 `0.1.7-rc.2`。现在 lockfile 的 `importers` 段只剩 `devDependencies`、没有 `dependencies` 块了 —— `autoInstallPeers` 只补"未被满足"的 peer，现在全部显式满足，它没东西可补。dev 树 = `0.2.0-rc.1`，确定无疑。

---

## 为什么只留两个 peer

`src/index.ts:99-103` 的注释自己说了：node 那半**从 `dsh-host-webserver` / `dsh-tools` 一个符号都没导入**，服务形状是结构化声明的，*"builds against `@deepseek-ai/cordis` alone"*。真正有类型导入的只有三个 client-ui 包（`src/client/index.ts:20-22`），而且全是 `import type`。

五个包编译期地位并不对等，但运行期耦合强度反过来：

- **留下的两个** → 支撑 `ctx.webServer`、`ctx.tools`，插件核心功能的硬依赖，缺了跑不起来
- **移走的三个** → 只供浏览器那半，而 loader 对缺失的 inject 条目是静默跳过的，最坏情况是设置面板不出现，服务端照常工作

产物也印证：`lib/*.js` 里没有任何 dsh 包被打进去，外部依赖只有 `node:fs/os/path` 和 `require("react")`；唯一的 `@deepseek-ai` 字样是 `lib/index.js:2490` 的一行文档注释。

---

## 验证

| 依赖树 | typecheck | test | build |
|---|---|---|---|
| `0.2.0-rc.1`（仓库 dev 树） | exit 0 | 46/46 | exit 0 |
| `0.1.7-rc.2`（scratch + overrides） | exit 0 | 46/46 | — |

### gate 覆盖面

把 app-boot 里那段 gate 代码抽出来、用真实 `semver@7.8.5` 直接跑改后的 manifest：

| DSH runtime | 判定 | 说明 |
|---|---|---|
| `0.1.7-rc.2` | COMPATIBLE | 原支持线下界 |
| `0.1.7` | COMPATIBLE | |
| `0.1.8` | COMPATIBLE | |
| `0.2.0-rc.1` | COMPATIBLE | 当前环境 |
| `0.2.0` | COMPATIBLE | |
| `0.2.1` | COMPATIBLE | |
| `0.3.0-rc.1` | **REJECTED** | 未验证，刻意拒绝 |

---

## pnpm 24h 冷却期

2026-09-29，`pnpm install` 曾自动向 `pnpm-workspace.yaml` 写入 21 条 `minimumReleaseAgeExclude`（包含传递依赖）。2026-09-30 复查时这些临时豁免已不再需要，已全部移除；该文件恢复原样。

追查过程：`pnpm config get minimumReleaseAge` 返回 `undefined`，npmrc 和环境变量里都没有。然后在 `/tmp` 一个**完全空的目录**里复现 —— 无任何配置，策略照样触发、照样自动创建 `pnpm-workspace.yaml`。

结论：这是 **pnpm 11 内置的新包冷却默认策略**，`config get` 返回 undefined 只表示"没有显式覆盖"。

当时删掉豁免再跑 `pnpm install --frozen-lockfile`（CI 用的正是这条）→ **exit 1**，报 *"lockfile contains entries that the active policies reject"*。2026-09-30 在隔离目录里**不带任何豁免**重跑同一命令，通过供应链检查（exit 0）；仓库内移除豁免后也通过（exit 0）。

| | |
|---|---|
| 窗口 | 滚动 24.0h，对 `now` 计算 |
| 测量时刻 | `2026-09-29T01:45Z` |
| cutoff | `2026-09-28T01:44:03.675Z` |
| 包发布于 | `2026-09-28T12:13–12:16Z` |
| 当时包龄 | 13.5h —— 在窗口内，故被拒 |
| 复查结果 | 2026-09-30：已出冷却期，21 条豁免全部移除；冻结安装通过 |

---

## 另一个插件怎么写的

`@yolk_vat-y/dsh-project-memory@0.5.13` 用的是同一思路 —— 显式 union，而且已经攒了四段：

```
"@deepseek-ai/dsh-tools": ">=0.0.1-rc.1 <0.1.0 || >=0.1.0-rc.1 <0.2.0-0 || >=0.1.1-rc.1 <0.2.0-0 || >=0.2.0-rc.1 <0.3.0-0"
```

- 四段就是四次 DSH minor 的历史堆积，这份区间读起来是一份 DSH minor 的 changelog —— **该项目也在持续更新范围**。
- 其中 `>=0.1.1-rc.1 <0.2.0-0` 是**纯冗余**，`semver.subset` 判定它被第二段完全包含，删掉行为不变。手写展开区间攒久就会这样。
- 该项目只声明 2 个 dsh peer（`dsh-llm` / `dsh-tools`），另外四个客户端包全放 devDependencies —— 和本次改动后的形状一致。
- devDeps 钉死精确版本（`0.2.0-rc.1`，无 caret）。这条是这次抄过来的。
- 所有 peer 都标了 `optional: true`，但那对 gate 无效（见上）。

---

## 这件事会重复到什么时候

只要 DSH 还在 `0.x`，每个 minor 都得往 union 里补一段。等 DSH 到 `1.0`，`^1.2.3` 能覆盖整个 `1.x`，问题基本自动消失。

真正的成本不是改那两行，而是改完要 bump 版本 + 重新发布，用户才装得到 —— 而这次已经证明是个 no-op。可以考虑加一个定时 CI job：解析最新 DSH → 用 `pnpm-workspace.yaml` overrides 装一棵树 → 跑 typecheck/test/build → 绿就自动开 PR 补区间，红就是真实的迁移信号。再加一个更便宜的前置判断：diff 两个版本的 tarball，逐字节相同就是 no-op。

---

## 复现关键验证

```bash
# 1. 确认某次 DSH bump 是不是 no-op（逐字节比对两个版本）
curl -sL "$(npm view @deepseek-ai/dsh-tools@<old> dist.tarball)" | tar xz -C a --strip-components=1
curl -sL "$(npm view @deepseek-ai/dsh-tools@<new> dist.tarball)" | tar xz -C b --strip-components=1
diff -ru a/lib/types b/lib/types
```

```yaml
# 2. 针对另一个 DSH 版本建一棵树验证
#    overrides 必须放 pnpm-workspace.yaml（pnpm 10+ 已忽略 package.json#pnpm）
#    且必须删掉 lockfile，否则 override 静默失效
overrides:
  '@deepseek-ai/dsh-tools': <version>
```

```
# 3. gate 判定逻辑所在位置，需要时把函数抽出来跑
@deepseek-ai/dsh-app-boot → lib/index.js → evaluatePluginCompatibility
```
