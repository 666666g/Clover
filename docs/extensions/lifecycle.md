# 激活与生命周期

> Extension API：v1
> English: [Activation and lifecycle](./lifecycle.en.md)
> 相关：[Manifest 激活事件](./manifest.md#激活事件) · [状态迁移](./versioning-and-migrations.md#状态-schema-迁移)

扩展生命周期由 Kun `ExtensionManager` 管理。安装/启用不等于执行：Kun 先静态发现 Manifest，只有兼容、权限和工作区策略都通过，并出现声明的 activation event 后，才运行入口。

## 状态流程

```text
installed
  -> compatible + enabled + permission admitted
  -> inactive
  -> activating (one joined attempt)
  -> active
  -> deactivating
  -> inactive / disabled / uninstalled

activating or active
  -> failed / crashed
  -> bounded restart backoff
  -> inactive or circuit-open
```

包不兼容、完整性失败、状态迁移失败或缺少必需 capability 时，在任何 Node、Webview 或 content script 代码执行前停止 admission。

## 静态发现

Workbench 从 Manifest 读取标题、图标、贡献位置和 `when` 条件，不激活扩展。因此：

- 不要在模块顶层执行安装、迁移或网络请求；
- 不要依赖“图标可见”表示 Node Host 已启动；
- 每项运行时能力都应有匹配 activation event；
- browser-only View 可在没有 Node Host 的情况下建立 View Session；
- headless 贡献必须有 `main`。

## `activate(context)`

Node 入口导出：

```ts
import type { ExtensionContext } from '@kun/extension-api'

export async function activate(context: ExtensionContext): Promise<void> {
  context.subscriptions.add(
    await context.commands.registerCommand('refresh', refresh),
    await context.tools.registerTool(lookupDefinition, lookupHandler)
  )
}

export async function deactivate(): Promise<void> {
  // Optional final cleanup. Do not start new work here.
}
```

`ExtensionContext` 是协商版本的公开能力集合，包含：

- `commands`、`ui`；
- `storage`、`network`、`workspace` 文件服务，以及只读 `workspaceContext`；
- `agent`、`threads`、`tools`；
- `modelProviders`、`authentication`；
- `subscriptions: DisposableStore`。

某服务存在不代表调用一定获准；每次操作仍检查 connection-bound permission、workspace trust/scope 和当前政策。可选 minor capability 不可用时返回结构化 unsupported-capability，扩展应降级或停止对应功能。

## Disposable 规则

所有命令、事件监听、工具、Provider、计时器、流订阅和 View Session 注册必须加入 `context.subscriptions.add(...)` 或由你明确 dispose。

`DisposableStore` 提供 `add`、`clear`、`dispose` 和 `isDisposed`。dispose 必须幂等：

- dispose 后不再接受新调用；
- 解除 host-side registration 和 listener；
- 取消或终止在途工作；
- 忽略 terminal fence 之后的晚到结果；
- 不删除已持久化的 thread/tool 历史。

不要依靠进程 `exit` handler 做唯一清理；超时、崩溃或强制终止时它不保证运行。

## 激活串行化

同一 Kun runtime、同一扩展版本最多一个 Node Host。多个 View/命令/工具同时触发时：

1. Kun 合并为一次激活；
2. 所有调用者等待同一结果；
3. `activate` 只调用一次；
4. 超过启动限额时整个尝试以 activation-timeout 失败。

默认 activation deadline 为 15 秒，但平台或用户政策可以收紧；不要在 `activate` 阻塞等待长期网络、模型或用户输入。注册 handler 后尽快返回，把实际工作放到被调用的操作中。

## Deactivation 触发

以下情况会停止扩展：

- 全局/当前工作区 disable；
- selected version 切换或 rollback；
- uninstall；
- Kun runtime shutdown；
- 权限/工作区状态使贡献不再合格；
- 连续崩溃触发 circuit open；
- 开发者显式 reload。

Kun 的顺序为：拒绝新调用 → 向 active call 传播 cancellation → 调用一次 `deactivate()`（可行时）→ dispose registrations → 等待 shutdown deadline → 终止 Host。默认 shutdown deadline 为 5 秒、cancel grace 为 2 秒；不要把它们当作保证，可被宿主政策收紧。

## 取消与 terminal outcome

长操作使用 Host 分配的 request ID。收到取消后：

- 尽快停止上游网络/模型/工具工作；
- 不再发非 terminal stream event；
- 每个请求最多一个 terminal outcome；
- 释放队列、ack/backpressure 和 correlation state；
- 不把晚到成功作为 run/tool/provider 成功写入。

工具可能已产生外部副作用却无法确认时，必须返回 unknown outcome。只有声明幂等、复用稳定 invocation key 且 Kun 政策允许时，才可能重试。

## View Session 生命周期

每次打开复杂 View，宿主创建一个独立 View Session。多个实例有不同 session nonce。关闭 View、切换工作区、disable/uninstall、guest crash 会：

- 取消 pending bridge calls；
- dispose message/event subscription；
- 释放 host resources；
- 拒绝 stale guest 后续消息。

browser View 关闭通常不会停止仍有后台贡献的 Node Host。没有后台贡献的扩展可以在最后一个 View 关闭后按 idle policy deactivation。

当前 idle policy 的默认宽限期是 30 秒，并按扩展统计所有并发 View Session。新 Session 会在异步激活前同步增加引用并取消待执行计时器；只有最后一个 Session 释放后才开始计时。如果停机已经开始，重新打开会等待旧 Host 的 registrations 清理完成，再创建新 Host，旧 Host 的迟到清理不会删除新 registrations。runtime shutdown、disable、uninstall 和版本切换会清理待执行计时器。

Kun 使用保守的后台判定。只有带 `main`、所有 activation event 都是 `onView:*`，且没有 command、tool、model Provider、authentication、Agent profile 或 `hostContentScripts` 贡献的扩展，才允许按 View idle policy 停止。`onStartup` 或任何非 View activation event 都视为后台能力。browser-only 扩展没有 Node Host，不参与该策略；Provider、tool 和其他 headless Host 在没有 GUI/View 时仍保持可用。

## Headless 生命周期

`kun serve` 和 `kun exec` 使用相同 ExtensionManager。没有 Electron 时：

- Node 工具、Provider、Agent profile 和 background command 可以激活；
- browser View 和 content script 不存在；
- 已连接账号可使用或刷新；
- 需要登录/consent/approval/user input 时返回 interaction-required 或保持 gated；
- 绝不能自动批准或合成用户答案。

## 崩溃与熔断

Host crash 只失败所属扩展的在途操作。默认连续 3 次不健康启动/崩溃后 circuit open；重启使用有界退避，且不会自动重放可能有副作用的调用。恢复需要显式 retry、reload、version change 或 re-enable。

使用：

```bash
kun extension doctor acme.issue-assistant
kun extension logs acme.issue-assistant
kun extension reload acme.issue-assistant
```

诊断显示激活原因、状态、进程、重启数、circuit、限额错误和脱敏 last error。

## 状态迁移发生在激活前

新 selected version 提高 `stateSchemaVersion` 时，其 Node `main` 必须导出 `migrateState(state, context)`。Kun 先备份完整 committed state，再对 global 和每个 workspace namespace 分别调用该函数；`context` 包含 scope 和 from/to version。只有所有返回值校验并与 package selection 事务化提交后才激活新版本。失败继续选用旧包和旧状态。Kun 不反向调用 upgrade migration。详见[版本与迁移](./versioning-and-migrations.md)。

## 推荐实践

- 让 `activate` 快速、确定、可重复诊断。
- 注册全部静态能力后再启动可取消后台任务。
- 用 `context.subscriptions` 管理每个资源。
- 对重复 cancel/dispose 做幂等处理。
- 不在模块顶层读取秘密或工作区。
- 不缓存超出调用生命周期的 account secret。
- 给 stream 处理 backpressure，不创建无界数组/队列。
- 对 interaction-required、permission-revoked、circuit-open 做可操作错误提示。
