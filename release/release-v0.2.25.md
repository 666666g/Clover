# Kun v0.2.25

这一版是 v0.2.24 之后的一次体验与安全边界更新。重点是让 Composer 的上下文容量、命令菜单和文件引用菜单更顺手，让工作区权限多一个适合日常开发的“信任工作区”模式，同时修复 Codex/ChatGPT OAuth 登录、选中 provider endpoint 同步和工作台顶部操作的一批细节。

### Composer 与工作台

- Composer 的上下文容量指示现在可以直接悬浮/点击查看详情；弹层会根据窗口、滚动位置和界面缩放自动计算位置，避免贴边、遮挡或跑出视口。
- `/` 命令菜单和文件 `@` 引用菜单支持键盘高亮项自动滚入可见区域，连续按方向键选择长列表时不再丢失当前焦点。
- 输入框在运行时正常时不再常驻显示默认 slash hint，保留离线、Connect、worktree 等真正需要提示的状态说明，减少底部噪声。
- 默认编辑器选择和 Terminal 开关从右侧 rail 移到工作台顶部操作区；右侧 rail 更专注于 Todo、Plan、Changes、Preview、Whiteboard、Subagents、Files 等面板入口。
- 顶部操作按钮和侧边 rail 的提示统一改用 `data-tooltip` / `aria-label`，减少原生 `title` 提示带来的延迟和重复读屏问题。
- Timeline jump rail 的布局计算更简单稳定，在窄窗口下会保持在可见区域内，减少和消息内容的错位。

### 权限与安全

- 新增“信任工作区”工具权限模式。它允许 Agent 在工作区内直接修改文件，但仍会阻止主机 shell 命令和工作区外写入，适合已经确认当前 workspace 可信的日常开发任务。
- 原有工作区写入模式文案调整为“询问后写工作区”，更准确地表达“修改工作区文件前仍会询问，命令和工作区外写入会被阻止”的行为。
- Agent SDK 路径会继承 Kun 的 `sandboxMode`，不再因为 approval policy 为 `auto` 就绕过工作区沙箱。
- SDK 内置的 `Bash`、`Write`、`Edit`、`Read`、`Grep`、`Glob` 等工具增加沙箱前置拦截：工作区写入模式下，shell 命令会被拒绝，读写路径会限制在 workspace 内。
- 本地工具执行补齐 `auto + workspace-write` 的测试覆盖，确保“信任工作区”能免确认执行工作区文件变更，同时不扩大到完整主机访问。

### Codex、Provider 与登录

- Codex/ChatGPT 浏览器 OAuth 登录对齐 Codex CLI 的回调配置：优先使用本地 `1455` 端口，忙碌时自动尝试 `1457`，只有两个端口都不可用时才降级到验证码登录。
- OAuth 请求的 scope、originator、User-Agent 和 token exchange 参数与 Codex CLI 兼容配置对齐，降低浏览器授权成功但 token 交换失败的概率。
- Codex token endpoint 返回错误时会展示更具体的状态码和错误摘要，例如 `access_denied` 或 provider 返回的 description，方便定位账号、组织或授权限制。
- GUI 托管的 Kun 配置现在会把当前选中的 provider `baseUrl`、`endpointFormat`、`model` 和代理地址同步到默认模型客户端配置。
- 修复切换到自定义 provider 后，某些 Kun 运行时路径仍可能沿用默认 endpoint 或缺少代理配置的问题。

### 测试与维护

- 补充 Composer 上下文容量弹层定位、缩放下定位、键盘菜单滚动、slash hint 显示条件和“信任工作区”执行选择器的测试。
- 补充工作台顶部操作区、侧边 rail tooltip、Timeline jump rail 布局和权限文案的渲染测试。
- 补充 Agent SDK 沙箱拦截、permission mode 映射、runtime factory sandbox 传递和本地工具免确认执行的测试。
- 补充 Codex OAuth 端口回退、token 错误摘要和 provider endpoint 同步到 Kun config 的测试。
- 更新中英文设置文案，让“询问后写工作区”“信任工作区”“完全访问”的风险边界更容易区分。

### 升级说明

- 从 `v0.2.24` 升级可直接通过 GUI 更新。
- 已有工作区写入权限配置会继续保留为“询问后写工作区”；如果你希望工作区内文件修改不再弹确认，同时仍阻止 shell 命令和工作区外写入，可以手动切换到“信任工作区”。
- Codex/ChatGPT 登录不需要重新配置；如果本地 `1455` 端口被占用，本版会自动尝试 `1457` 后再进入验证码登录 fallback。
- 自定义 provider 不需要迁移；升级后当前选中的 Base URL、Endpoint format、模型和代理会更完整地同步给 Kun runtime。

### 完整变更

https://github.com/KunAgent/Kun/compare/v0.2.24...v0.2.25

### 总结

v0.2.25 是一次把日常使用阻力继续磨低的版本：Composer 的小菜单更跟手，工作台按钮位置更清楚，工作区权限终于有了介于“每次都问”和“完全访问”之间的实用档位，Codex 登录和 provider endpoint 同步也更贴近真实使用路径。它不是一个炫技版本，但会让 Kun 在长时间开发会话里更稳、更安静。
