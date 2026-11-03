# DSH 兼容性与验证

插件版本：`0.3.2`。开发基线升级至 DSH `0.2.1-rc.5`，保留原有 `0.1.7-rc.2`、`0.2.0-rc.1`，覆盖到目标版本之间所有已发布的版本。

## 版本范围

2026-11-03 查询 npm 官方 registry：`@deepseek-ai/dsh` 的 `latest` / `next` 均为 `0.2.1-rc.5`。完整验证清单维护在 [`scripts/dsh-versions.json`](../scripts/dsh-versions.json)，CI 和发布流程共用：

| 系列 | 验证版本 |
|---|---|
| 原有版本 | `0.1.7-rc.2` |
| 0.2.0 | `0.2.0-rc.1`、`0.2.0-rc.2` |
| 0.2.1 alpha | `0.2.1-alpha.1`～`0.2.1-alpha.5` |
| 0.2.1 rc | `0.2.1-rc.1`～`0.2.1-rc.5` |

共 **13 个版本**。Registry 中还有更靠后的 `0.2.2-alpha.2`（`alpha` tag），它不是上述范围内的中间版本，本次不声明支持。未扩大到早于原有支持下界的版本。

两个 DSH peer 使用同一区间：

```text
^0.1.7-rc.2 || >=0.2.0-rc.1 <0.2.1-0 || >=0.2.1-alpha.1 <0.2.2-0
```

普通 npm semver 不会因为有 `^0.2.0-rc.1` 就接受 `0.2.1-rc.5`：预发布版本需要匹配相同 major/minor/patch 的预发布 comparator。因此必须显式补上 `0.2.1-alpha.1` 这一段。DSH 自己的 gate 使用 `{ includePrerelease: true }`，旧范围在该 gate 中原本就可能通过；不能把本次问题简单归因于 DSH gate 拒绝。

上界 `<0.2.2-0` 同时阻止普通 semver 与 DSH gate 接受尚未验证的 `0.2.2` 系列（包含 alpha），`0.3.0-rc.1` 同样被拒绝。区间接受 `0.2.0`、`0.2.1` 正式版，但本次 registry 清单中没有这些正式版，不能声称实测过。

## 源码核对与适配

从 npm 下载并对比了这 13 个版本的五个直接 DSH 开发依赖：`dsh-host-webserver`、`dsh-tools`、`dsh-client-ui-renderer`、`dsh-client-ui-settings`、`dsh-client-ui-slots`。新版本存在实际代码变化，不再是之前 `0.1.7-rc.2` → `0.2.0-rc.1` 的纯版本号变化。

- 新 WebServer 支持 TLS、具体接口地址及 IPv6，提供 `protocol` / `getOrigin()`；`port` 在监听完成前可以是 `undefined`。插件优先使用宿主的 `getOrigin()`，保留 HTTPS 与宿主规范化后的地址；清空 UI 中固定的 `baseUrl` 时走同一路径。
- 旧宿主没有 `getOrigin()` 时保留 HTTP / LAN 推导，并正确为 IPv6 添加方括号；未绑定端口时报错，避免公布 `:undefined`。
- 面板信任检查通过 URL 解析 Host，允许 `[::1]:port` 的回环同源访问，继续拒绝跨源访问。
- 工具注册、输出 schema/render、设置插槽的现有调用可继续使用；用真实 `ToolRuntime`、`WebServer`、`SlotCore` 验证这些契约。
- 新 DSH 包要求 Cordis `~4.0.5`，开发依赖升级到 `^4.0.5` 并更新锁文件；运行时 peer 保留 `^4.0.4`，兼容旧宿主。

浏览器的三个 DSH 包仍是开发依赖及 `dsh.client.inject` 项，产物沿用宿主 ModuleLoader，不把它们打进插件。Node 侧仍按结构读取宿主服务。

## CI 与发布

- `ci.yml`：冻结安装当前基线，跑类型检查与 `pnpm test`；同时调用可复用的 `dsh-compat.yml`。
- `dsh-compat.yml`：从版本清单生成 13 项矩阵；每项在独立 checkout 中改写五个精确开发依赖，使用 `pnpm install --no-frozen-lockfile` 解析该版本的依赖树，再跑 peer 检查、类型检查与完整测试。测试断言实际安装版本，避免只换了标签却仍测旧依赖。
- `release.yml`：发布 job 必须等待相同矩阵全部通过；原有 tag/version 校验及 OIDC provenance 发布保留。
- `pnpm test` 已含完整 build，删除 CI / release 中紧接着重复的 build 步骤；`prepublishOnly` 仍会在打包发布时构建。
- 没有加入冷却期豁免，也没有写入 DSH 的风险接受配置。

本地验证覆盖上述 13 棵独立依赖树，每个版本跑 peer 检查、类型检查、51 项测试及客户端 bundle smoke。真实 WebServer 验证 AgentCard、JSON-RPC、面板 IPv6 Host 同源/跨源判断及路由卸载；真实 ToolRuntime 验证出站工具注册、远程调用、输出投影及卸载；真实 SlotCore 验证设置项注册及随 owner 卸载。

这些测试不包含带真实模型的完整 DSH profile、实际浏览器渲染或真实 TLS 握手。HTTPS/IPv6 公布地址有契约回归测试；模型鉴权、会话恢复和 UI 实际交互仍需宿主安装验收。会话恢复的独立 PR #14 不并入本次改动。

## 本地复现

默认基线：

```sh
pnpm install --frozen-lockfile
pnpm peers check
pnpm typecheck
pnpm test
```

验证其他版本（在一次性 checkout 中运行，会修改 manifest 和 lock）：

```sh
node scripts/select-dsh-version.mjs 0.2.1-alpha.3
pnpm install --no-frozen-lockfile
pnpm peers check
pnpm typecheck
DSH_VERSION=0.2.1-alpha.3 pnpm test
```

## 上游来源

- [DSH registry](https://registry.npmjs.org/@deepseek-ai%2fdsh)：发布版本、dist-tags 及各包 tarball 元数据。
- [DeepSeek Harness 源码](https://github.com/deepseek-ai/deepseek-harness)：`packages/host/webserver`、`packages/core/tools`、客户端 renderer/settings/slots，以及 app-boot 的兼容性 gate；以 registry 中对应版本的发布产物为本次核对依据。
