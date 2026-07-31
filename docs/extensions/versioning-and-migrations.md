# 版本、兼容与状态迁移

> Extension API：v1
> English: [Versioning, compatibility, and state migration](./versioning-and-migrations.en.md)
> 相关：[Manifest 版本字段](./manifest.md#版本字段) · [打包与 Rollback](./packaging-and-index.md#enabledisablerollback-与-uninstall)

Kun 把包、Manifest、公开 API、Kun engine、Host RPC 和扩展状态分别版本化。每个维度解决不同问题，不能用一个数字替代另一个。

## 六个版本维度

| 维度 | 声明位置 | 类型 | 负责什么 |
| --- | --- | --- | --- |
| Extension package `version` | Manifest | SemVer | 扩展自身 release 与 immutable install directory |
| `manifestVersion` | Manifest | v1 为整数 `1` | Manifest 结构/安全语义 |
| `apiVersion` | Manifest | SemVer | 第三方公开 SDK/Host contract |
| `engines.kun` | Manifest | SemVer range | 可运行的 Kun 产品版本 |
| `stateSchemaVersion` | Manifest | 非负整数（新扩展推荐从 1 开始） | Global/workspace state 数据结构 |
| `rpcVersion` | Kun ↔ bundled Host | 私有协商值 | 同一 Kun release 内部 wire protocol |

改变一个维度不隐式改变其它维度。兼容错误必须指出 declared/supported 的具体维度。

`rpcVersion` 不属于第三方 API：Manifest 不声明，扩展不导入、不直接发送 RPC。Kun 内部可以更改 wire format，只要公开 API adapter 保持承诺。

## 公开 API 的 SemVer

所有 `@kun/extension-api`、`@kun/extension-react`、`@kun/extension-test` 公开符号、Manifest/wire contract 和文档化行为从发布起即稳定：

- Patch：修复缺陷，不破坏公开 type/behavior。
- Minor：只添加向后兼容的 optional capability/field/method/event。
- Major：允许有迁移说明的 breaking change。

Kun 不提供 `experimental` namespace 来绕过该承诺。内部路径未公开，不因被 TypeScript import 到就变成稳定 API。

同一 major 的旧 minor 扩展应继续运行。扩展面对新增 optional field 必须容忍；调用新增 optional capability 前用协商 capability 检查。

## 兼容矩阵

Kun 支持当前 Extension API major `N` 和前一个 `N-1`（`N > 1`）：

| 当前 API major | 必须支持 | 在代码执行前拒绝 |
| --- | --- | --- |
| 1 | 1 | 未来 major、任何非 1 major |
| 2 | 1、2 | 3+、已无其它更旧 major |
| 3 | 2、3 | 1、4+ |
| N | N-1、N | ≤N-2、≥N+1 |

“支持”不仅是接受 Manifest，还包括旧 major 的公开行为和 Host adapter。前一 major 扩展与当前 major 扩展可在同一安装中同时激活，各用协商契约。

Release gate 只把已执行的行为 conformance 记为支持证据。API v1 没有前一 major，因此只执行 current v1 clean-project conformance；当 current 升为 v2 或更高时，声明支持窗口本身不会放行发布。Kun 必须保留 `packages/extension-api-compat/v<N-1>` 的上一 major SDK，并提供 `scripts/fixtures/extension-api-conformance/v<N-1>.mjs`，从打包 SDK 运行旧 View/Agent/tool/Provider 行为并验证当前 Host adapter。缺少任一 artifact 或 runner 都 fail closed。

具体 Kun release ↔ API/Manifest/SDK 坐标由随发行版本化的 compatibility artifact/文档列出；扩展应在 `engines.kun` 精确表达已测试范围，不写无界 `*`。

## Admission 与能力协商

执行顺序为：

1. 验证 archive、identity、package SemVer、Manifest Schema 和入口；
2. 检查 running Kun 是否满足 `engines.kun`；
3. 检查 `manifestVersion`；
4. 检查 `apiVersion` major 是否在支持窗口；
5. 协商该 major 内可用 minor capabilities 和私有 `rpcVersion`；
6. 检查 contribution required capability/permissions/workspace policy；
7. 必要时事务化 state migration；
8. 才加载 Node entry、Webview 或 content script。

Optional capability 缺失时，SDK 暴露 unavailable 或 structured unsupported-capability；required capability 缺失会在贡献注册/代码执行前 fail closed。Payload 不能在连接后提升 negotiated API 或 grants。

`kun extension doctor <id>` 应显示 Manifest/API/engine/RPC/state 每个维度的 declared/negotiated/result，而不泄露秘密。

## Deprecation 政策

移除公开 API 前必须：

1. 标记 deprecated；
2. 文档/type/validator/dev log 指明 replacement；
3. 指明最早 removal major；
4. 保持功能至少一个完整 API-major transition；
5. 只在之后的新 major 删除。

例如在 API v1 标记弃用的能力，v2 支持 v1/v2 时仍必须可用；最早到 v3（此时 v1 离开支持窗口）才能删除。Changelog、migration guide、诊断和类型声明必须一致。

扩展作者应在 warning 出现的同一 release cycle 迁移，不要等旧 major 被移除。

## 状态 Schema 迁移

`stateSchemaVersion` 只描述扩展状态，不随 package/API 自动增加。仅在 persisted state shape 需要迁移时提高。

全新安装且没有保留 state file 时，Kun 直接以 package 声明的 `stateSchemaVersion` 创建空 namespace，不调用 migration。曾卸载但保留了 state 的扩展不属于全新状态；重新安装时仍会按实际 committed Schema 执行兼容检查或 migration。

当 selected package 声明的状态版本高于 committed state：

1. Kun 保留旧 selected package；
2. 为包含 global 和所有 workspace namespace 的 committed state 创建 recoverable backup；
3. 对 global 和每个 workspace namespace 分别调用 Node `main` 导出的 `migrateState(state, context)`；`context` 提供 `scope`、`fromVersion`、`toVersion`，可用时还提供 `workspace`；
4. 校验每个输出 Schema、quota 和 namespace；
5. 全部成功后原子 commit 所有 namespace 和 schema marker；
6. 再原子选择/激活新 package。

概念示例：

```ts
export async function migrateState(state, context) {
  const next = structuredClone(state)
  if (context.scope === 'global' && context.fromVersion === 1 && context.toVersion >= 2) {
    next.filters = {
      status: next.statusFilter ?? 'all'
    }
    delete next.statusFilter
  }
  return next
}
```

准确 state 类型以同版本 lifecycle types 为准。Migration 必须返回完整新状态，应确定、可测试、无网络/模型/用户交互，并能处理所有已发布的 forward path。不要读取其它扩展 namespace。

## 失败与中断恢复

迁移 throw、timeout、invalid state、quota failure 或任一 namespace commit 失败时：

- 不暴露混合状态；
- 保留/恢复旧 committed state；
- 继续选择旧 package；
- 报告 from/to、namespace 和脱敏 stable diagnostic；
- 不运行新 entry。

Backup 和 commit marker 区分 old committed、complete new committed 与 incomplete output。Crash/power loss 后：

- commit 前中断：discard/quarantine incomplete，恢复旧包/状态；
- durable commit/selection 后中断：识别新状态，不能重复跑已完成 migration。

Kun 会在 `extension-data/<extension-id>/state/version-switch.json` 写入单扩展、单事务 journal。Journal 记录旧 registry selection、目标 package/development generation、from/to Schema、精确旧状态 backup 的名称与 digest，以及 `started`、`state-prepared`、`selection-committed` phase。普通 state 写入与整个 version switch 共用同一扩展级串行栅栏，因此不会插入 migration commit 和 package selection 之间。

启动、CLI 操作和 activation admission 都会先恢复 journal：如果 registry 已选择目标版本且 committed state 的 Schema 与目标一致，Kun 完成新事务并清理 marker；否则恢复 journal 指向的精确旧状态和旧 selection。恢复可重复执行；未注册的新 package directory 会先移入 staging quarantine 再删除。即使进程在 state 写入之后、registry 写入之前退出，也不会让旧代码读取新 Schema；如果在 registry 原子写入之后退出，也不会重复执行 migration。

新 archive 在 admission 和 migration 期间仍位于 `.staging/install-*`。Kun 在 commit callback 中再次校验完整性，再移动到 immutable canonical version directory、设为只读并写 registry。启动恢复会清理中断的 install staging，以及没有 registry record 的 canonical orphan；它不会删除任何已注册版本。

## 核心 Provider Credential 迁移事务

Legacy Provider key 迁移与扩展 state migration 使用不同 journal，但采用同一条原则：plaintext settings 是旧 committed 状态，protected credential + account + Provider Binding 是 prepared 状态，secret-free settings 是新 committed 状态。

- `*.pre-extension-credential-migration.json` 是不覆盖的一次性旧设置备份；
- `legacy-credential-migrations.json` 用 `secure-committed` / `settings-committed` 区分 prepared 与 complete，只记录 salted digest 和 opaque reference；
- `provider-bindings.json` 保存 source scope 下的 `providerId/accountId/modelId`，Credential Store 保存 secret；
- 普通 `kun-settings.json` 和 GUI 管理的 Kun `config.json` 在 commit 后不含 Provider/runtime plaintext。

普通设置原子写失败会回滚 pending credential/account/binding；若进程中断，启动恢复根据 settings 是否仍有 legacy plaintext 与 journal phase 决定回滚 prepared 状态或完成 marker。相同 Provider 的相同 secret 可共享 account；不同 runtime override 不会被 profile credential 覆盖。兼容备份支持回滚一个 release cycle，安全 account/binding 则保留且在 Provider 缺失时标为 unavailable。

## Rollback 与 Downgrade

Kun 不会：

- 反向调用 forward migration；
- 根据字段猜 reverse transform；
- 把新 Schema state 交给只声明旧 Schema 的代码。

Manual rollback 只有在存在与旧 package `stateSchemaVersion` 兼容的 retained snapshot，或旧 package 明确声明 forward-compatible state 时才成功。否则原子拒绝并保持当前 package/state。

至少保留 previous selected package 不等于保证可 rollback；状态 compatibility 仍必须通过。发布前实际测试升级 → 状态写入 → rollback。

## 包版本选择不会自动发生

提高 package version、API version 或 Index 上出现新版本不会自动 update。Kun 不轮询/比较/提示；用户显式选择 exact package 后才进行 admission/consent/migration。失败不会静默选另一个已安装版本。

## Raw DOM 排除

Host DOM、selector、CSS class、React structure、layout 和 `hostContentScripts` 的 raw DOM dependency 不在 current+previous major 保证内。Kun patch/minor 可以改变它们而不提供 adapter。

这不影响同一 View/message/command/theme/state 等稳定 SDK 行为：如果扩展只用公开契约，Kun 内部 DOM 变化必须保持其支持窗口内行为。

## 文档和 Artifact 对齐

每个发布的 SDK、Schema、CLI、template、example、API reference、compatibility matrix 和 Changelog 必须声明其 API/Kun 版本。当前和前一 API major 的文档/SDK coordinates/migration guide 在支持期内都可访问。

CI 应拒绝：

- SDK export 变化但 API reference/Changelog 未更新；
- generated Schema 与 runtime source 漂移；
- 示例使用页面范围外的 API/Manifest 版本；
- 中英文 heading/snippet 不一致；
- 当前/前一 major fixture 或 incompatibility rejection 失败；
- migration crash recovery/rollback fixture 失败。

## 扩展升级步骤

1. 更新 dependency 到目标 SDK，并阅读 Changelog/deprecation。
2. 保持或明确提高 `apiVersion`；不要仅改 package version。
3. 设定实际测试过的 `engines.kun`。
4. Manifest/permission 增加时准备 renewed consent 文案。
5. State shape 改变时提高 `stateSchemaVersion`、实现 forward migration 和 rollback fixture。
6. 在当前与前一 API major fixture 中测试（如发布兼容包）。
7. Validate/pack，测试旧版本升级、migration failure、crash recovery 和 manual rollback。
8. 更新双语 docs、compatibility matrix 与 Changelog。
