# Agnes-2.0-Flash


**Agnes-2.0-Flash** 是由 **Sapiens AI** 开发的一款快速、高效的语言模型，面向智能体工作流、工具调用、编程任务、推理、多轮对话、图片理解以及高频生产环境应用场景设计。


Agnes-2.0-Flash 在 **Claw-Eval** 基准测试中取得了强劲表现，在 **General Leaderboard** 中排名第 **9**，**Pass^3 分数为 60.9%**，展现出在主流语言模型中较强的自主智能体能力。


---


## 模型概述


Agnes-2.0-Flash 针对快速、可靠、低成本的语言生成、智能体任务执行和图片理解进行了优化。


该模型支持以下能力：


| 能力              | 说明                                   |
| --------------- | ------------------------------------ |
| Chat Completion | 为对话和应用生成高质量回复                        |
| 多轮对话            | 在多轮交互中保持上下文连续性                       |
| 图片 URL 输入       | 支持通过公网图片 URL 传入图片内容                  |
| 图片理解            | 支持基于图片的内容理解、截图分析和信息提取                |
| 工具调用            | 调用外部工具和函数，支持智能体工作流                   |
| 智能体工作流          | 支持规划、执行和多步骤任务完成                      |
| 编程任务            | 辅助代码生成、调试、解释和重构                      |
| 推理              | 处理结构化推理、任务拆解和决策                      |
| 流式输出            | 实时返回响应，提升用户体验                        |
| OpenAI 兼容 API   | 使用兼容 OpenAI Chat Completions API 的结构 |


---


## 适用场景


Agnes-2.0-Flash 适用于以下场景：


| 场景      | 示例用例                   |
| ------- | ---------------------- |
| AI 助手   | 通用问答、日常助手、效率支持         |
| 自主智能体   | 多步骤任务执行、规划和工具使用        |
| 编程助手    | 代码生成、调试、重构和解释          |
| 工作流自动化  | 任务拆解、流程自动化和执行规划        |
| 客户支持    | FAQ 问答、客服聊天机器人、服务自动化   |
| 搜索与问答   | 基于搜索的回答、摘要生成、信息提取      |
| 内容生成    | 营销文案、文章、产品描述、脚本        |
| 开发者工具   | API 助手、文档助手、编程 Copilot |
| AI 原生应用 | 消费级应用、效率工具、智能体应用       |
| 图片理解    | 图片描述、截图分析、视觉问答、信息提取    |


---


## API 信息


### Endpoint


| 项目                    | 说明                                              |
| --------------------- | ----------------------------------------------- |
| API Endpoint          | https://apihub.agnes-ai.com/v1/chat/completions |
| Request Method        | POST                                            |
| Content-Type          | application/json                                |
| Authentication        | Bearer Token                                    |
| Authentication Header | Authorization: Bearer YOUR_API_KEY              |


---


## 请求参数


| 参数                   | 类型              | 是否必填 | 说明                                       |
| -------------------- | --------------- | ---- | ---------------------------------------- |
| model                | string          | 是    | 模型名称，固定为 agnes-2.0-flash                 |
| messages             | array           | 是    | 对话消息数组，包括 system、user 和 assistant 消息     |
| messages[].content   | string / array  | 是    | 消息内容。可为纯文本字符串，也可为包含 text、image_url 的内容数组 |
| temperature          | number          | 否    | 控制输出随机性。较低值会生成更确定性的结果                    |
| top_p                | number          | 否    | 控制核采样。较低值会使输出更加聚焦                        |
| max_tokens           | number          | 否    | 响应中最多生成的 token 数                         |
| stream               | boolean         | 否    | 是否启用流式响应输出                               |
| tools                | array           | 否    | 用于工具调用工作流的工具定义                           |
| tool_choice          | string / object | 否    | 控制模型是否以及如何使用工具                           |
| chat_template_kwargs | object          | 否    | OpenAI 兼容请求中用于开启 Thinking 等扩展能力          |
| thinking             | object          | 否    | Anthropic 兼容请求中用于开启 Thinking 模式          |


---


## 图片 URL 输入支持


Agnes-2.0-Flash 支持通过图片 URL 输入图片内容。开发者可以在同一个 `messages` 请求中同时传入文本指令和图片 URL，让模型基于图片进行理解、分析、问答或信息提取。


支持的输入类型包括：


| 输入类型   | 支持方式      | 说明               |
| ------ | --------- | ---------------- |
| 文本     | text      | 普通文本指令或问题        |
| 图片 URL | image_url | 通过公网可访问的图片链接传入图片 |


### 图片内容结构


当使用图片 URL 输入时，`messages[].content` 应使用数组结构，每个内容块代表一种输入内容。


```json
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "Describe the content of this image."
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "https://example.com/image.jpg"
      }
    }
  ]
}
```


---


## 调用示例


### 1. 基础 Chat Completion 请求


用于生成普通的聊天补全响应。


```bash
curl https://apihub.agnes-ai.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-2.0-flash",
    "messages": [
      {
        "role": "system",
        "content": "You are a helpful AI assistant."
      },
      {
        "role": "user",
        "content": "Explain how autonomous agents use tools to complete tasks."
      }
    ],
    "temperature": 0.7,
    "max_tokens": 1024
  }'
```


---


### 2. 流式输出请求


用于启用流式输出。


```bash
curl https://apihub.agnes-ai.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-2.0-flash",
    "messages": [
      {
        "role": "user",
        "content": "Write a short product introduction for an AI assistant app."
      }
    ],
    "stream": true
  }'
```


---


### 3. 工具调用请求


用于需要外部工具调用的智能体工作流。


```bash
curl https://apihub.agnes-ai.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-2.0-flash",
    "messages": [
      {
        "role": "user",
        "content": "What is the weather like in Singapore today?"
      }
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_weather",
          "description": "Get the current weather for a location",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {
                "type": "string",
                "description": "The city and country"
              }
            },
            "required": ["location"]
          }
        }
      }
    ]
  }'
```


---


### 4. 图片 URL 输入请求


用于通过图片链接传入图片，并让模型理解或分析图片内容。


```bash
curl https://apihub.agnes-ai.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-2.0-flash",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "Describe the content of this image."
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "https://example.com/image.jpg"
            }
          }
        ]
      }
    ]
  }'
```


---


## 响应格式


```json
{
  "id": "chatcmpl_xxx",
  "object": "chat.completion",
  "created": 1774432125,
  "model": "agnes-2.0-flash",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Autonomous agents use tools by understanding the user's goal, breaking it into steps, selecting the right tools, executing actions, and using the results to complete the task."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 35,
    "completion_tokens": 58,
    "total_tokens": 93
  }
}
```


---


## 响应字段说明


| 字段                        | 类型      | 说明                       |
| ------------------------- | ------- | ------------------------ |
| id                        | string  | 本次补全请求的唯一 ID             |
| object                    | string  | 对象类型，通常为 chat.completion |
| created                   | integer | 请求时间戳                    |
| model                     | string  | 本次请求使用的模型                |
| choices                   | array   | 生成的响应结果列表                |
| choices[].index           | integer | 响应结果的索引                  |
| choices[].message         | object  | Assistant 消息对象           |
| choices[].message.role    | string  | 消息发送者角色                  |
| choices[].message.content | string  | 模型生成的响应内容                |
| choices[].finish_reason   | string  | 生成停止原因                   |
| usage                     | object  | Token 使用信息               |
| usage.prompt_tokens       | integer | 输入 token 数量              |
| usage.completion_tokens   | integer | 输出 token 数量              |
| usage.total_tokens        | integer | 使用的 token 总数             |


---


## 为编码任务启用 Thinking


对于代码编写、调试、推理和 Agent 工作流，建议开启 Thinking 模式，以提升代码质量、任务拆解能力和问题解决效果。


### OpenAI 兼容请求


使用 OpenAI 兼容 API 格式时，在请求体中添加 `chat_template_kwargs.enable_thinking`：


```json
{
  "model": "agnes-2.0-flash",
  "messages": [
    {
      "role": "user",
      "content": "Help me write a Python script to process a CSV file."
    }
  ],
  "chat_template_kwargs": {
    "enable_thinking": true
  }
}
```


### Anthropic 兼容请求


使用 Anthropic 兼容 API 格式时，在请求体中添加 `thinking` 字段：


```json
{
  "model": "agnes-2.0-flash",
  "messages": [
    {
      "role": "user",
      "content": "Help me refactor this TypeScript function and explain the changes."
    }
  ],
  "thinking": {
    "type": "enabled",
    "budget_tokens": 2048
  }
}
```


`budget_tokens` 用于控制最大 Thinking token 预算。对于常见编码任务，建议从 `2048` 开始设置。对于更复杂的调试、重构或多步骤 Agent 任务，可以根据需要适当提高该值。


---


## 功能与兼容性


Agnes-2.0-Flash 支持以下能力：

- Chat Completion
- 多轮对话
- System Prompt
- 图片 URL 输入
- 图片理解
- 流式输出
- 工具调用
- 智能体工作流
- 编程任务
- 推理任务
- JSON 风格输出
- 兼容 OpenAI Chat Completions API 的请求结构

---


## 最佳实践


### Prompt 编写建议


为了获得更好的结果，建议提供清晰的指令、上下文和期望的输出格式。


### 示例：产品文案生成


```plain text
You are a product marketing expert. Write a concise App Store description for an AI assistant app. The tone should be clear, professional, and user-friendly.
```


### 示例：编程任务


对于编程任务，建议提供编程语言、框架、错误信息和期望行为。


```plain text
Help me debug this React component. The issue is that the button state does not update after clicking. Explain the cause and provide the corrected code.
```


### 示例：智能体工作流


对于智能体工作流，建议清晰描述目标、可用工具和任务约束。


```plain text
You are an autonomous research agent. Search for relevant information, summarize the key findings, and return the result in a structured format with source links.
```


### 示例：图片理解任务


对于图片理解任务，建议明确说明希望模型关注的内容，例如整体描述、文字提取、界面分析、物体识别或结构化输出。


```plain text
Analyze this screenshot. Identify the main UI elements, explain the possible issue, and provide suggestions to improve the user experience.
```


---


## 推荐 Prompt 结构


建议使用以下结构组织 Prompt：


```plain text
[Role] + [Task] + [Context] + [Requirements] + [Output Format]
```


### 示例


```plain text
You are a senior product manager. Analyze this feature idea for an AI assistant app. Consider user value, implementation complexity, risks, and return the result in a structured table.
```


### 图片理解 Prompt 示例


```plain text
You are an image analysis assistant. Analyze the provided image URL, summarize the key information, identify potential issues, and return the result in a structured table.
```


---


## 图片 URL 使用建议

- 图片 URL 必须可公网访问。
- 如果图片 URL 需要登录、鉴权或存在防盗链，模型可能无法读取。
- 建议使用标准图片格式，例如 JPG、JPEG、PNG 或 WebP。
- 对于截图、报错图、产品界面图，建议在文本中补充你希望模型重点关注的问题。
- 图片 URL 输入可以与工具调用、流式输出和 Agent 工作流结合使用。

---


## 模型限制


| 项目         | 数值    |
| ---------- | ----- |
| Context    | 256K  |
| Max Output | 65.5K |


---



## 说明

- 使用 `agnes-2.0-flash` 作为模型名称。
- 基础 Chat Completion 请求必须包含 `model` 和 `messages`。
- `messages[].content` 可使用纯文本字符串，也可使用包含文本和图片 URL 的内容数组。
- 如需输入图片，请使用 `image_url` 并提供公网可访问的图片 URL。
- 如需启用流式响应，请将 `stream` 设置为 `true`。
- 对于工具调用工作流，请提供 `tools`，并可按需提供 `tool_choice`。
- `temperature` 用于控制随机性。较低值更适合确定性任务，较高值更适合创意生成。
- Agnes-2.0-Flash 适合需要快速响应、强任务完成能力、图片理解能力和可靠智能体表现的生产级应用。