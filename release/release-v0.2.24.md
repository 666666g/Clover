# Kun v0.2.24

这一版是 v0.2.23 之后的一次体验与运行时稳定性更新。重点是让 Composer 更会处理提示词和文件引用，让远程 IM 会话可以管理线程、模型、目标和附件，同时补上模型请求重试、上下文压缩、后台子代理、Write 自动保存和 Design 标注等一批日常会碰到的细节。

### Composer 与模型请求

- 新增 Composer 提示词优化能力。开启后，输入框会出现优化按钮，可以把口语化或零散的需求整理成更清楚的 Agent prompt。
- 提示词优化可单独配置 provider、model、自定义优化 prompt 和超时时间；未指定时会继承 Kun 当前的小模型或主模型。
- 提示词优化请求支持 OpenAI Chat Completions、Anthropic Messages 和 OpenAI Responses 兼容端点，并沿用现有代理配置。
- 文件 `@` 引用补强了路径式补全、目录/文件去重、Enter/Tab 提交、带空格路径引用和删除引用后的同步移除。
- 模型选择器不再把线程里的旧模型硬塞回候选列表，减少 stale model 混入；推理强度选项收进二级菜单，工具栏在窄宽度下也更稳。
- 模型请求新增可配置 HTTP 重试策略，可针对 429、503 等临时失败设置重试次数、初始延迟和状态码范围。

### 远程 IM 与 Connect

- 远程 IM 命令大幅补强，新增 `/stop`、`/pwd`、`/usage`、`/list-skills`、`/list-mcp`、`/list-goal`、`/goal`、`/list-threads`、`/current`、`/switch`、`/list-model` 等命令。
- IM 会话可以列出最近 Kun 线程并切换到指定线程，适合从微信、飞书或 Telegram 继续已有工作。
- IM 模型切换改为先 `/list-model` 查看所有可用文本模型，再用 `/model <序号>` 选择；每个 IM conversation 会记录自己的 provider/model。
- IM 侧会明确告诉 Agent 当前没有 GUI 输入工具可用，减少远程聊天里等待弹窗确认或结构化输入的情况。
- 新增 `send_im_attachment` 工具，Agent 可以把工作区内生成的文件排队作为 IM 附件发送；路径会限制在 workspace 内，并限制数量和大小。
- 飞书与 Telegram 的流式回复、错误提示、生成文件回传和定时任务创建路径做了稳定性修复，失败信息会统一带 Kun 前缀。

### Runtime、子代理与上下文

- 上下文压缩默认使用模型摘要，摘要上限提高到 2048 tokens；失败、超时或空结果时仍会自动降级到本地摘要骨架。
- 压缩摘要会更努力保留用户请求、任务列表、错误、文件路径、命令结果和未完成事项，减少长任务续跑时丢关键中间项。
- 子代理委派会继承父回合当前 provider，避免子任务意外回落到默认供应商。
- detached/background 子代理完成后会把结果通知回父线程；中断父任务时也会更可靠地中断相关子任务。
- 子代理卡片补充后台标识、稳定排序、耗时、队列、token 和工具调用信息，多个子代理的时间显示也更一致。
- 删除线程时会清理对应记忆引用；repo map cache 和 Write 检索索引 cache 增加边界，降低长时间使用后的内存增长风险。
- 后台 shell 在生成摘要前会先 flush 输出，避免长命令最后一段输出没有进入结果说明。

### Workbench、Write 与 Design

- Loop 入口移动到顶部模式 tabs，工作区线程可以从侧栏上下文菜单归档。
- 侧栏导航、timeline rail、右侧 rail tooltip、pin 高亮和聊天跳转 rail 做了对齐与紧凑化处理。
- Write 新增自动保存开关和保存间隔设置；默认仍开启自动保存，用户也可以完全关闭。
- Write 初始化后会刷新工作区文件树，避免新建/切换工作区后目录状态不及时。
- Design 多页面生成现在必须显式开启多页面模式，不再因为空画布或从零开始就自动走多页面路线。
- Design system 读取更严格，遇到格式异常时会尽量恢复可用 token/component，避免坏数据拖垮整个设计工作区。
- 图片标注文字工具支持多行输入、自动调整输入框、IME 组合输入和应用前自动提交草稿；标注文本也会进入设计说明。
- 更新后 release note 提示不会在开发环境或非升级版本中误弹。

### 测试与维护

- 补充提示词优化、IM 附件、IM 命令、子代理委派、上下文压缩、设计系统恢复、图片标注、Write 自动保存、Composer 文件引用和 provider retry 相关测试。
- Windows 测试稳定性继续收紧，减少 Vitest worker 竞争、junction/symlink fixture、后台 shell 生命周期和 LSP URI 差异带来的偶发失败。
- IPC schema 覆盖新增 prompt optimization、provider retry、Write 自动保存和 IM conversation provider/model 字段。

### 升级说明

- 从 `v0.2.23` 升级可直接通过 GUI 更新。
- Composer 提示词优化默认关闭；需要在 Kun/Agent 设置中启用并选择对应模型后才会显示优化按钮。
- 模型请求重试是可配置能力，默认不会额外增加请求次数；如果你的 provider 偶发 429/503，可以在供应商配置中开启。
- Write 自动保存默认保持开启，默认间隔为 180 秒；如果你更偏好手动保存，可以在 Write 设置中关闭。
- 远程 IM 旧会话会继续可用；新的模型切换方式建议先发送 `/list-model` 再用 `/model <序号>`。

### 完整变更

https://github.com/KunAgent/Kun/compare/v0.2.23...v0.2.24

### 总结

v0.2.24 不追求一个巨大的新模式，而是把 Kun 的日常工作流往前推了一段：输入前能整理 prompt，聊天中能更稳地引用文件，远程 IM 能真正管理线程和附件，长上下文和后台子代理也更不容易丢状态。它是一版让 v0.2.22 以来的新能力更适合长期使用的打磨版本。
