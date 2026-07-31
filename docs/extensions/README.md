# Kun 扩展开发者文档

> Extension API：v1（稳定）
> 适用 Kun：以 [`engines.kun`](./manifest.md#版本字段) 和[兼容矩阵](./versioning-and-migrations.md#兼容矩阵)为准
> English: [Extension developer documentation](./README.en.md)

Kun 扩展（Extension）可以把工作台 UI、后台 Node 逻辑、Kun Agent 工作流、工具、账号认证和自定义模型 Provider 组合成一个可安装的 `.kunx` 应用。扩展通过公开 SDK 和能力 Broker 工作，不会获得 Kun 内部 `AgentLoop`、运行时令牌、Electron 私有 IPC 或完整的 `window.kunGui`。

Kun 始终只有一个 Agent runtime：`kun serve`。扩展调用 Agent，或 Kun 调用扩展工具/Provider，都经过同一个 runtime 的线程、审批、工具、事件和用量体系。Node 扩展可以在没有桌面 GUI 时由 `kun serve` 或受支持的 CLI 路径激活。

## 先选择正确的扩展机制

| 需求 | 应使用 | 是否执行代码 | 生命周期 |
| --- | --- | --- | --- |
| 工作台应用、后台服务、Agent 流程、完整模型 Provider | Kun Extension（本套文档） | 可以，按入口和权限披露 | Extension Host / Webview |
| 只改变形象、图标或视觉资源 | UI 外观包 | 否 | 现有 UI Plugin 流程 |
| 向 Agent 暴露外部工具服务 | MCP Server | 由 MCP 服务执行 | 现有 MCP 流程 |
| 提供提示、说明和可复用工作方法 | Skill | 通常不执行插件代码 | 现有 Skill 流程 |

这些系统彼此独立。安装 `.kunx` 不会迁移 UI 外观包、MCP 配置或 Skill；扩展也不应把它们复制进自己的私有格式。

## 推荐学习路径

1. 阅读[架构与边界](./architecture.md)，理解 Node Host、Webview、Broker 和单 Kun runtime。
2. 按[五分钟快速开始](./quick-start.md)创建、测试、打包并侧载一个右侧栏扩展。
3. 用 [Manifest 参考](./manifest.md)声明入口、贡献点、激活事件、权限和版本，并从 [API 参考](./api-reference.md)选择稳定 SDK 导出。
4. 用[激活与生命周期](./lifecycle.md)正确注册和释放资源。
5. 根据用途选择工作台、Agent/工具、Provider/账号或资源 API 指南。
6. 发布前完成[发布检查表](./release-troubleshooting-changelog.md#发布检查表)。

## 指南索引

### 基础

- [架构与边界](./architecture.md)
- [五分钟快速开始](./quick-start.md)
- [Manifest 参考](./manifest.md)
- [Extension API 参考](./api-reference.md)
- [激活与生命周期](./lifecycle.md)

### UI 与工作台

- [工作台贡献点、命令、设置与 UX](./workbench.md)
- [Webview 与 Direct DOM](./webview-and-dom.md)

### Kun 能力

- [Agent Runs 与工具](./agent-and-tools.md)
- [模型 Provider、账号与认证](./providers-and-accounts.md)
- [权限、信任、存储、网络、日志与配额](./security-and-resources.md)

### 分发与维护

- [打包、侧载与自定义 Index](./packaging-and-index.md)
- [CLI、测试与调试](./cli-testing-debugging.md)
- [版本、兼容与状态迁移](./versioning-and-migrations.md)
- [发布、故障排查与 API Changelog](./release-troubleshooting-changelog.md)

## 稳定性边界

稳定范围仅包括：

- `@kun/extension-api` 的公开导出；
- `@kun/extension-react` 和 `@kun/extension-test` 的公开导出；
- 已发布的 Manifest/贡献点 JSON Schema；
- Host Context、Webview bridge、命令、上下文键、主题、locale 和状态 API；
- Agent、工具、Provider、账号、认证、存储和网络的公开契约；
- 文档明确列出的 CLI 命令、结构化输出和诊断代码。

不稳定且不受 SemVer 保护的范围包括：宿主 DOM、CSS 类、React 结构、renderer store、Electron IPC 名称、Kun 内部 HTTP/RPC、`window.kunGui` 和未导出的源码路径。尤其是 `hostContentScripts` 使用的选择器可能在 Kun 的补丁或次版本中变化；可行时应使用稳定贡献点和 Webview。

## 重要信任提示

- Node `main` 入口以当前操作系统用户权限运行。独立子进程提供故障和资源隔离，不是恶意代码安全沙箱。
- Webview 默认关闭 Node、启用 context isolation 和 Chromium sandbox，且禁止直接联网；网络应通过 Broker。
- Direct DOM 能读取和修改可见工作台内容，属于高风险、不稳定能力。
- 模型 Provider 会收到完整的模型可见请求，包括对话、指令、附件和工具 Schema。
- Webview 和 content script 永远不能取得原始账号秘密；Node 扩展只有在声明并获批专用 secret-read 权限后才能请求最小范围秘密。

只安装你信任来源的 Node 或 Direct DOM 扩展。签名是来源证据，不等于安全审计；未签名包可以侧载，但 Kun 会保留来源、摘要和权限确认记录。

## 文档与 Schema 的权威性

中文文件是行为规范主源，对应 `.en.md` 是英文版本。Manifest 和公开 wire payload 的字段、必填性与格式以同版本生成的 JSON Schema/TypeScript 类型为机器可执行真源；如果文档示例与 Schema 不一致，先使用 `kun extension validate` 确认，并把漂移报告为文档缺陷。

## 机器可读参考

- [Manifest JSON Schema](../../packages/extension-api/schema/kun-extension.schema.json)
- [生成的 Extension API 参考与导出快照](./api-reference.md)
- [`@kun/extension-api` 导出入口](../../packages/extension-api/src/index.ts)
- [`@kun/extension-react` 导出入口](../../packages/extension-react/src/index.tsx)
- [`@kun/extension-test` 导出入口](../../packages/extension-test/src/index.ts)
- [六个可运行示例](../../examples/extensions/README.md)

发布构建生成的 `.d.ts` 是类型真源；本目录的独立 API 参考从公共 module symbols 和内存生成的声明快照派生。CI 会校验 Schema、双语 heading/代码块结构、JSON/TypeScript snippets、链接/anchors、SDK exports/type fingerprint 与 Changelog 未漂移，并对示例执行 typecheck、build、浏览器产物检查、Manifest 校验与 headless smoke test。
