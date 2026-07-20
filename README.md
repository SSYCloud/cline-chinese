# Cline-Chinese (Cline中文汉化版) 🌏

> 🎉 截止到2026.7.14，Cline Chinese在VS Code插件市场的下载量突破266k啦！感谢大家的支持！

<p align="center">


</p>

## 项目地址
https://github.com/SSYCloud/cline-chinese
欢迎大家star，fork，提出issue，贡献代码，一起完善这个项目。

## 文档（感谢[@flyfreee](https://github.com/flyfreee)的翻译工作）
https://hybridtalentcomputing.gitbook.io/cline-chinese-doc/




## 赞助商


> 胜算云是AI自动生产超级工厂，长三角国家技术创新中心重大扶持项目，打造工业级 AI 任务执行矩阵。依托完整的全球API算力供应链与弹性算力容器，实现云端快速并发执行 AI 任务，持久化工作流编排，矩阵式执行，共享知识库，高效低成本获得可靠计算结果。点击此处查看[网关实时稳定性监控](https://watch.shengsuanyun.com/status/shengsuanyun), 点击此处进入模型网关超市获取API算力：[胜算云](https://www.shengsuanyun.com)，注册新用户可获10元模力及首充10%赠送。


## 功能展示

<video width="100%" controls src="https://github.com/user-attachments/assets/a6db47a9-08d7-4d20-afa0-110d23b71a81"></video>


## 安装使用
Cline-Chinese已发布到VSCode插件市场，欢迎感兴趣的小伙伴们下载体验。

## 简介

这个项目是基于 [Cline](https://github.com/cline/cline) 的汉化版本。旨在优化由于英文 prompt 导致 Cline 在中文输入下+国产大模型（如：deepseek）表现不佳的问题, 并提供更符合中文用户习惯的UI界面和功能。目前已测试[DeepSeek-V4-Pro/DeepSeek-V4-Flash](https://github.com/deepseek-ai/)工作良好。

日常使用cline等编程助手时发现使用某些模型推理速度较慢（如deepseek-R1, Claude-3.5-Sonnet），这个项目优先尝试在中文输入下，对轻量化LLM进行实验（如Deepseek-R1-Distill-Qwen-7B/14B），优化中文prompt, 以提升推理速度，大大减少等待的时间。



## 背景

本人是一名AI从业者+爱好者，在使用Cline时，发现Cline的UI界面和提示词均为英文，使用中文输入时，有时会出现奇奇怪怪的输出，影响体验。因此，决定自己动手，汉化Cline。
另外，秉着学习的态度，未来将着手修改Cline的核心代码，增加新的功能，以提升体验。


## 版本更新说明
## 2026.06.29 （ver .3.86.5）
1. 修复和原版cline参数配置共享的问题，可能会导致需要重新配置，给您带来的不便，还请见谅。
2. 修复deepseek-v4修改上下文长度为1m不生效的问题。

## 2026.06.16 （ver .3.86.3）
基于 v3.86.1，修复以下问题：
1. 修复 VSCode 1.122+ 下 @ 添加上下文（文件/文件夹）显示"未找到结果"的问题（ripgrep 二进制路径迁移）
2. 修复终端执行大量输出命令后卡在"等待中"无法完成的问题（shell integration 完成检测超时兜底）
3. 修复 Linux 中文系统下钩子文件存错目录的问题（~/Documents → ~/文档，遵循 XDG 本地化）
4. 修复取消任务后发送消息无响应、需要重载窗口的问题（cancel 后消息路由死区兜底）

## 2026.06.02 （ver .3.86.1）
同步官方 v3.86.1 版本


<div align="center">

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=shengsuan-cloud.cline-shengsuan" target="_blank"><strong>在 VS Marketplace 下载</strong></a>
</td>
<td align="center">
<a href="https://discord.gg/frBHkRKB4x" target="_blank"><strong>Discord</strong></a>
</td>
<td align="center">
<a href="https://www.reddit.com/r/cline/" target="_blank"><strong>r/cline</strong></a>
</td>
<td align="center">
<a href="https://github.com/SSYCloud/cline-chinese-ssy/issues?utm_source=vsmp&utm_medium=ms%20web&utm_campaign=mpdetails" target="_blank"><strong>功能请求</strong></a>
</td>
<td align="center">
<a href="https://modelmesh.gitbook.io/cline-zhong-wen-ban-docs" target="_blank"><strong>新手上路</strong></a>
</td>
</tbody>
</table>
</div>

</div>

<br>

<div align="center">
<table>
<tr>
<td align="center" width="50%">

### CLI

在终端中运行 Cline。
支持交互式聊天，或在 CI/CD 和脚本场景下以完全无头（headless）模式运行。

```
npm i -g @coohu/cline
```

<a href="./apps/cli/README.md">了解更多</a>
<br><br>

</td>
<td align="center" width="50%">

### Kanban

通过基于 Web 的任务看板并行运行多个代理。每个任务卡都拥有独立的工作树、自动提交功能及依赖链。

```
npm i -g @coohu/kanban
```

<a href="https://github.com/cline/kanban">了解更多</a>
<br><br>

</td>
</tr>
<tr>
<td align="center" width="50%">

### VS Code Extension

集成于编辑器中的 AI 编程助手。
创建文件、运行命令、浏览网页，
并在“人在回路”的审批机制下使用各种工具。

<a href="https://marketplace.visualstudio.com/items?itemName=shengsuan-cloud.cline-shengsuan">从 VSCode 插件市场安装</a>
<br><br>

</td>
<td align="center" width="50%">

### JetBrains Plugin

在 IntelliJ IDEA、PyCharm、WebStorm、GoLand 及其他 JetBrains 系列 IDE 中，都能获得同样的 Cline 体验。

<a href="https://plugins.jetbrains.com/plugin/28247-cline">Install from JetBrains Marketplace</a>
<br><br>

</td>
</tr>
</table>
</div>

<div align="center">
<table>
<tr>
<td align="center">

### SDK

构建您自己的 AI 智能体与集成应用，所依托的核心引擎与 CLI、看板（Kanban）、VS Code 扩展及 JetBrains 插件完全相同。支持自定义工具、多智能体协作团队、连接器、定时自动化任务等丰富功能。

```
npm install @coohu/sdk
```

<a href="https://docs.cline.bot/cline-sdk/overview">Documentation</a>
<br><br>

</td>
</tr>
</table>
</div>


## 免责声明

| Product | Description | Location | CHANGELOG |
|---------|------------|--------------|--------------|
| **SDK** | Node.js programmatic agent API and extension exports. | [`sdk/`](https://github.com/cline/cline/tree/main/sdk) | [CHANGELOG.md](https://github.com/cline/cline/blob/main/sdk/CHANGELOG.md) |
| **CLI** | Terminal UI, headless mode, shell commands, and CLI-specific flows. | [`apps/cli/`](https://github.com/cline/cline/tree/main/apps/cli) | [CHANGELOG.md](https://github.com/cline/cline/blob/main/apps/cli/CHANGELOG.md) |
| **VS Code Extension** | The Marketplace extension and extension host integration. | [`/`](https://github.com/cline/cline/tree/main) (WIP migrating) | [CHANGELOG.md](https://github.com/cline/cline/blob/main/CHANGELOG.md) |
| **JetBrains Plugin** | JetBrains-hosted client that talks to the shared agent core. | Currently we are not open-sourcing JetBrains plugins | - |
| **Kanban** | Web-based multi-agent task board. | [`cline/kanban`](https://github.com/cline/kanban) | [CHANGELOG.md](https://github.com/cline/kanban/blob/main/CHANGELOG.md) |
| **Docs site** | Public documentation pages. | [`docs/`](https://docs.cline.bot/) | - |

2. **数据安全**：本插件不会收集或存储任何用户数据。但在使用过程中，用户应注意保护自己的敏感信息和代码安全。

3. **知识产权**：
   - 本项目是基于Cline的汉化版本，原版权归属于Cline团队。
   - 汉化部分的内容采用与原版Cline相同的Apache-2.0许可证。
   - 用户在使用过程中应遵守相关的开源协议。

4. **免责声明**：
   - 本项目不提供任何明示或暗示的保证，包括但不限于适销性和特定用途适用性的保证。
   - 开发者不对任何直接或间接损失负责，包括但不限于利润损失、数据丢失等。
   - 用户使用本插件即表示同意承担使用过程中的所有风险。

5. **更新和维护**：
   - 开发者将努力维护本项目，但不保证及时更新或修复所有问题。
   - 本项目可能随时变更或终止，会及时同步到本项目中。

6. **合规使用**：
   - 用户在使用本插件时，必须遵守当地法律法规。
   - **严禁将本插件用于任何违法违规行为**（包括但不限于网络攻击、非法侵入、数据窃取、传播非法信息等）。
   - 开发者对用户利用本插件进行的任何违法行为及其产生的后果不承担任何法律责任。
---

## 计划和执行模式

在“计划模式”（Plan mode）和“执行模式”（Act mode）之间切换。在规划模式下，Cline 会分析你的代码库，提出澄清问题，并制定行动策略。双方达成一致后，切换到执行模式，Cline 便会按计划进行操作。每一次文件修改和终端命令执行都需要你批准，确保你始终掌控实际的变更内容；或者，你也可以开启自动批准功能，让 Cline 自主运行。

## 规则 and Skills

在 `.clinerules` 文件中定义项目专属规则，以指导 Cline 在代码库中的运作方式，例如编码规范、架构约定、部署流程及测试要求等。CLI、VS Code 扩展和 JetBrains 插件会自动读取这些规则。此外，您还可以利用“技能”（skills）功能，让模型在需要时加载特定的规则。

## 适用于所有型号

Cline 不绑定于单一 AI 提供商。您可以根据工作流程选择合适的模型：

| Provider | Models |
|----------|--------|
| Anthropic | Claude Opus, Sonnet, Haiku |
| OpenAI | GPT series model |
| Google | Gemini series model |
| OpenRouter | 200+ models from any provider |
| Vercel AI Gateway | Models through Vercel AI Gateway |
| AWS Bedrock | Claude, Llama, and more |
| Azure / GCP Vertex | All hosted models |
| Cerebras / Groq | Fast inference models |
| Ollama / LM Studio | Run local models on your machine |
| Any OpenAI-compatible API | Self-hosted or third-party endpoints |

## 使用插件或 MCP 服务器进行扩展

利用插件扩展 Cline 的功能。您可以使用 SDK，通过插件系统以编程方式注册工具和生命周期钩子，从而实现日志记录、审计、策略执行或添加特定领域的各项功能。下方提供了一个简单的插件示例。

```typescript
import { Agent, createTool } from "@coohu/sdk"

const deployTool = createTool({
  name: "deploy",
  description: "Deploy the current branch to staging.",
  inputSchema: { type: "object", properties: { env: { type: "string" } }, required: ["env"] },
  execute: async (input) => {
    // your deployment logic
  },
})

const agent = new Agent({ tools: [deployTool], /* ... */ })
```
……或者使用 [MCP 服务器](https://github.com/modelcontextprotocol)来连接数据库、查询 API、管理云基础设施以及与外部系统交互。你可以使用[社区构建的服务器](https://github.com/modelcontextprotocol/servers)，也可以让 Cline 实时创建自定义工具。在 CLI 中，可以使用 `cline mcp` 命令来管理这些服务器。

## 多 Agent 合作

协调多个智能体协同完成复杂任务。协调型智能体将工作拆解为子任务，并将其分配给各自拥有专属工具与上下文信息的专业智能体。团队状态会在会话间持久保存，确保您可以随时从上次中断的地方继续工作。

```bash
cline --team-name auth-sprint "规划并实施包含测试的用户身份验证功能"
```

## 任务计划 Agents

按 Cron 计划运行代理，以执行周期性自动化任务，例如每日 PR 摘要、每周依赖项检查及代码库健康状况报告。这些计划在重启后依然有效，且独立于任何终端会话运行。

```bash
cline schedule create "PR summary" \
  --cron "0 9 * * MON-FRI" \
  --prompt "List all open PRs and their review status" \
  --workspace /path/to/repo
```

## 连接到 Slack, Telegram, Discord, 等

您可以通过 Telegram、Slack、Discord、Google Chat、WhatsApp 和 Linear 等各类即时通讯平台与您的智能体（Agent）进行对话。每个对话会话都对应一个包含完整上下文信息的智能体交互会话。您还可以设置访问控制，以限定哪些用户能够与您的智能体进行交互。

```bash
# Connect to Telegram
cline connect telegram -k $BOT_TOKEN
# Connect to Slack through webhook
cline connect slack --bot-token $SLACK_TOKEN --signing-secret $SECRET --base-url $URL
# Connect to Slack using socket mode
cline connect slack --bot-token $SLACK_TOKEN --app-token $SLACK_APP_TOKEN
```

## 无头 CLI for CI/CD

在无需人工交互的情况下运行 Cline，以实现脚本化与自动化。支持输入重定向、获取 JSON 输出、命令链式调用以及集成到 CI/CD 流水线中。

```bash
cline "Run tests and fix any failures"
git diff origin/main | cline  "Review these changes for issues"
cline --json "List all TODO comments" | jq -r 'select(.type == "agent_event" and .event.text) | .event.text'
```

## Contributing

Start with the [Contributing Guide](CONTRIBUTING.md). Join our [Discord](https://discord.gg/cline) and head to the `#contributors` channel to connect with other contributors. Check our [careers page](https://cline.bot/join-us) for full-time roles.

## License

[Apache 2.0 © 2026 Cline Bot Inc.](./LICENSE)
