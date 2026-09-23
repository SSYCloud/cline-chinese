# LoomLoom Batch Agent · 研发交接与 PR 说明

目标分支：`ll`。本 PR 是在研发已有的 LoomLoom Batch MVP 上完成的产品整合，不是重新实现一套 Cline 聊天。

## 相对 `ll` 原版的变化

| 原版 MVP | 本 PR |
| --- | --- |
| Batch 更像独立的工作流/执行/结果页面 | `Plan / Act / Batch` 共用当前 Cline SDK 任务和 Act Agent；Batch 控件与事件进入原聊天时间线 |
| 工作流输入主要由表单承担 | 同一份扩展端 Batch 草稿可由 Cline 对话、Agent 工具和右侧工作表共同读写，按修订版本防冲突 |
| 批量输入缺少完整表格操作与长结果展示 | 单独的 VS Code 深色 Batch 工作表支持动态增删行、单元格/选区、附件、检查、预算、运行进度、结果及历史；不是 `.xlsx` 导入器 |
| SkillBot 选择与聊天上下文脱节 | 已安装 SkillBot 与现有市场入口联动；首次登录引导复用胜算云认证，市场展示公开输入 schema 和服务端模型目录 |
| 缺少创作者闭环 | 工作表内增加私有工作流创作：服务端校验 TemplateSpec v2、保存版本、明确确认私有测试运行、成功后提交市场审核并查询状态/收益 |
| 大量 Batch 数据回灌到侧栏且首屏脚本偏大 | 聊天只接收裁剪后的 Batch 快照，长输出留在工作表；非聊天页面与图表按需加载，并减少 Batch 模式切换的重复状态广播 |

## 产品主流程

1. 在现有对话切换到 Batch；未登录胜算云时显示登录入口，已有 API Key 的用户仍可选择直接使用。
2. 从已安装列表选择 SkillBot，或进入 LoomLoom SkillBot 市场；Cline 在同一会话加载公开输入要求。
3. 选中后先有一条空输入，用户或 Agent 可继续增删行；聊天、引用文件和右侧工作表共享同一份输入。文件名保留在对应行/字段，没有泛用“参考文件”列。
4. 用户先检查可修改的输入表，再取得服务端预算；改动会使旧预算失效。只有用户在最新预算上明确确认后才执行付费批次。
5. 聊天显示关键状态，工作表显示逐任务进度、结果、错误与历史；文本产物按任务原工作区自动保存到 `.cline/loomloom-outputs/`，不覆盖项目源码。
6. 开始下一批默认沿用原 SkillBot；改用别的 SkillBot 是单独选择。

## 架构和安全边界

- Batch 是 Act Agent 的产品模式，不创建第二个 Cline SDK 会话；Agent 每轮推理读取当前 Batch 阶段、公开 schema 与草稿，并使用受限的非付费工具编辑同一份数据。
- 右侧工作表只是绑定原 `taskId` 的 VS Code WebviewPanel，不创建第二个 Controller。会话切换后旧表格只读，切回原会话可恢复。
- 市场 SkillBot 只通过 Listing 和公开输入 schema 调用，不读取或重建隐藏工作流定义。复用现有胜算云 API Key；密钥只留在扩展宿主。
- 报价、执行与创作者的远端创建/版本/发布分别要求用户确认。执行前持久化请求身份；结果不确定时不自动重复付费提交。
- 创作模式的简易生成器当前覆盖单个文本 Step，复杂工作流使用高级 V2 JSON 编辑并由服务端校验。市场发布是审核申请，不保证通过或获得收入。

## 直接安装验收

- VSIX：[`releases/cline-chinese-4.1.31-batch-agent-preview.vsix`](../releases/cline-chinese-4.1.31-batch-agent-preview.vsix)
- SHA-256：`05485A2286652B9E0D17A0F252DB62D36CE68E0D1D2C145C2F4AA5DBA57AC536`。
- VS Code 命令面板选择 **Extensions: Install from VSIX...**，安装后执行 **Developer: Reload Window**。本 PR 不自动安装，也不发起真实付费运行。

建议研发按首次登录、已配置 API Key、选市场 SkillBot、聊天批量整理、工作表增删行与附件、检查/退回修改/重新报价、确认运行、会话切换与历史恢复、Creator 私有测试与审核申请的顺序验收。任何真实运行必须由测试人员先确认费用。

## 已做验证与待验收

- `bun run test:batch-runtime`：9/9（使用本地测试传输，不消耗模型或 LoomLoom 费用）。
- `bun test src/services/loomloom`：195/195。
- `webview-ui` 的 LoomLoom 组件测试：112/112。
- VSIX 包含扩展脚本、侧栏 Webview、独立 Batch 工作表资源和新版 README；版本 4.1.31。
- 真实 VS Code 窗口、胜算云账户、市场报价/执行和创作者审核仍需研发在授权测试环境中做人工端到端验收；这里不把模拟测试当成线上结果。

本机 Windows 标准 `vscode:prepublish` 流程中的 `lint:proto` 依赖缺失的 WSL，类型检查、Webview 构建和普通 Biome lint 已通过。交接 VSIX 使用相同 `vsce` 打包器的 `pack` 接口对已编译产物封装，并检查了版本与资源清单；研发 CI 应继续跑完整发布流水线。
