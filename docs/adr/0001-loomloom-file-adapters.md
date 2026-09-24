# ADR-0001：Cline 端 Batch 文件输入适配与文本产物落盘

## 状态

已实现源码与本地测试；用户已确认默认输出目录，并随后授权打包。已交付 Windows x64 的 4.1.24 VSIX；未创建 PR，未进行真实云端上传或付费执行。

## 需求与边界

用户添加的代码/文本文件应能进入 SkillBot 的文本输入，图片、视频等素材走已有上传通道。LoomLoom 返回 HTML 等纯文本时，Cline 自动生成本地文件，不再要求复制粘贴。仍使用原 Cline 会话、BatchService、检查表、报价和执行确认，不创建独立 Agent 或修改云端工作流。

仅处理用户主动选择或已关联到当前输入行的文件。不会扫描整个项目、自动上传全部源码、推断隐藏的工作流绑定，或自动执行生成的脚本。

## API 核实

依据用户提供的 `D:/Documents/Downloads/LoomLoom-API-接口总览-openapi (1).json`：

| 契约 | 已确认内容 | 对实现的影响 |
|---|---|---|
| `POST /loom/v1/inputAssets:upload` | JSON 内 `content` 为 base64，带 `filename/contentType`；返回 `inputAssetId` 等素材元数据 | 不是前端 OSS 直传接口，也没有返回素材 URL；不伪造 OSS 地址 |
| `POST /loom/v1/orchestrationInputs:upload` | flat JSONL 执行输入，返回 `inputFileId` | 与素材 ID 不同；本次 Market `inputRows` 适配不混用这个通道 |
| Market `:quote` / `:execute` | 公共 `inputRows` 和 Listing 版本 | 按公开 schema 的 key/type 构建输入，保留现有预算与确认流程 |
| `POST /loom/v1/templateSpecs:validate` | 校验 TemplateSpec v2 定义，不保存版本 | 不把它当成本批素材/行数据校验，也不在客户端重建私有 Spec |
| Market `:validateWorkbook` | 工作簿的 `valid/fileErrors/rowErrors` | 本地 JSON 行输入不能冒充工作簿调用这个接口；quote 响应也不是此校验响应 |
| `GET .../resultRows` | 可分页取回各行 artifacts；有 `inlineText/mimeType/portName/artifactId/accessUrl`，没有 filename | 文件名和后缀是客户端策略；使用 resultRows 分页保证读取完整性 |

因此，“只能 JSON 文本或图片/视频 OSS 输入”并不准确：API 还有原始素材、JSONL、工作簿等不同入口。当前适配针对 Market 公共输入，不替换这些契约。

本机 CLI 文档也区分 `string → prompt` 与上传文本的 `text_reference → initial_input`。但这份 OpenAPI 没有展开特殊引用字段的值语法；当前不会把普通文本、路径或资产 ID 自动塞进 `text_reference/image_url` 字段。

## 设计

```text
用户选中文本/代码文件 ── 限量读取与解码 ── 公共文本字段
已关联的本地参考文件 ── 按附件 ID 复用 ────┘
用户选中图片/视频等 ─── MIME/字段检查 ── inputAssets:upload ── asset_ref
                                                  ↓
                           同一份输入表 → 本地 schema 检查 → 报价 → 用户确认
                                                  ↓
                                   按行获取 LoomLoom 结果
                                                  ↓
                    inlineText 类型识别 → 安全文件写入 → 本地记录/表格/Agent 同步
```

### 输入适配

- 明确的普通 `string` 文本字段：读取正文，保留 Unicode、换行和空格，按字符串写入该行该字段。JSON 文件也作为正文，不擅自拆成参数或增加任务。
- `asset_ref`：识别素材类型，按该字段的 `accepted_mime_types` 限制上传，绑定服务端返回的 ID。MIME 表包含常见图片、视频、音频与 PDF，但能否用于某个 SkillBot 仍由它的字段要求决定。
- 本地参考：只记录来源，不自动上传。聊天中的 Agent 可以使用已关联的附件 ID，把它明确导入某个兼容输入字段。
- 导入正文与文件来源在同一个 Batch 事务更新，增加 revision 并使旧预算失效。替换已有文本会出现原生确认；异步选择/读取/上传后检查任务、行、版本和来源是否仍一致。
- 取消不修改输入；移除来源时，仅清除尚未被用户改写的导入值。跨字段复用保留原绑定。

### 输出适配

- 优先使用明确 MIME；可识别一个完整、已知语言的代码围栏，以及完整 HTML 文档。格式未知时保存 `.txt`，混合解释和代码不丢弃内容。
- 覆盖 HTML、CSS、JS/TS、JSX/TSX、JSON、Markdown、Python、XML、YAML、CSV/TSV、SQL、SVG 等明确格式。SVG/HTML 均作为源码，不在扩展 Webview 中执行。
- 空白文本与真正的二进制产物不会误存为空 TXT。只有 URL 的图片/视频等仍保留原有查看入口，本轮不自动批量下载远端二进制内容。
- 目录为 `<原会话工作区>/.cline/loomloom-outputs/task-<会话哈希>/run-<批次哈希>/row-<任务序号>/`。名称由受控序号、内容哈希和后缀生成，不采纳云端文本中的任意路径。
- 工作区取自原任务历史，在提交时冻结。会话切换、关闭表格、新批次、历史刷新都不会把旧结果转存到当前活动目录。
- 使用排他、原子发布；重复结果复用文件，用户改过的文件保留，重新导出另建文件。不会覆盖项目源码。
- 本地路径保存在单独的 host-owned `localOutputs` 中；网络入口重建公开 artifact 字段，忽略云端伪造的本地路径。打开文件前再次检查目录和符号链接边界。
- 自动保存失败记录为本地失败，云端状态保持原样。用户可重试保存，无需重新报价或重新执行任务。

## 限制与失败策略

这些是当前客户端的保护上限，不是声称服务端具有相同限制：

- 单个文本导入 512 KiB，批次文本输入 8 MiB；单个素材上传 20 MiB。
- 单个文本产物 10 MiB，单批当前保存记录最多 1000 个、当前产物总量 100 MiB。
- 支持 UTF-8 和带 BOM 的 UTF-16；编码不明确/损坏时提示另存 UTF-8，不静默截断或乱码导入。
- PDF/Office/压缩包不是普通文本，不能硬解码成字符串；是否可作素材上传依据公开字段。
- 私钥和明显敏感配置不会自动导入，提示先脱敏。参考附件不等于已授权云端上传。
- 安全原子保存要求输出文件系统支持硬链接。不支持、权限不足、目录丢失时保持原始结果可查看并报告本地保存失败。
- 已知旧运行没有目录时，仅在用户明确保存/打开产物时根据原任务历史补绑定；找不到原目录则不静默使用另一个工作区。
- 上传完成后若任务已切换，客户端拒绝关联；API 未提供素材删除契约，因此不伪造孤立素材回收能力。

## 备选方案

- 让 Agent 临时用脚本复制粘贴：不可保证完整内容、编码、幂等和路径安全，故采用确定性的本地模块。
- 所有文件先传 OSS、字段统一填 URL：与公开上传响应及字段类型不符，拒绝。
- 把每个文本文件都直接上传成 asset ID：普通 string 字段需要正文，不接受这种替代。
- 云端 Spec 校验器校验本地文件：对象层次不相同，拒绝。

## 验证

新增测试覆盖 BOM/Unicode/换行保持、二进制拒绝、MIME 和大小限制、取消/切换/版本冲突、按引用导入、跨字段关联、预算失效、真实临时文件输出、并发与幂等、用户修改保留、路径穿越/符号链接、原目录绑定、历史更新、本地失败与云端成功分离，以及 API 结果字段净化。测试中的云端数据均使用替身，不等于已经调用真实付费服务。

源码阶段总计 420 项针对性回归通过：185 项 Batch 后端/文件适配、97 项前端、130 项 SDK/原生面板、8 项真实 SDK 运行时本地传输测试。打包时重新通过类型检查、前后端生产构建、110 项文件管道测试及 11 项原生面板测试，并核验 ZIP 内容。

安装包：`D:/Documents/cline两个汉化版本合并工作/cline-chinese-4.1.24-batch-files-preview5-20260922.vsix`（约 8.84 MiB）。SHA256：`B862FB62A253B4B3F047FE3E5B889DBB0882EE58E3A1ED5B485321DD65E82E1D`。
