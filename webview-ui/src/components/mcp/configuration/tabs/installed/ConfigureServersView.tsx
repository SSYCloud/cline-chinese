import { EmptyRequest } from "@shared/proto/cline/common"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"
import ServersToggleList from "./ServersToggleList"

const ConfigureServersView = () => {
	const { mcpServers: servers, navigateToSettings, remoteConfigSettings } = useExtensionState()

	// Check if there are remote MCP servers configured
	const hasRemoteMCPServers = remoteConfigSettings?.remoteMCPServers && remoteConfigSettings.remoteMCPServers.length > 0

	return (
		<div style={{ padding: "16px 20px" }}>
			<div
				style={{
					color: "var(--vscode-foreground)",
					fontSize: "13px",
					marginBottom: "16px",
					marginTop: "5px",
				}}>
				<VSCodeLink href="https://github.com/modelcontextprotocol" style={{ display: "inline" }}>
					模型上下文协议
				</VSCodeLink>{" "}
				支持与本地运行的 MCP 服务器通信，这些服务器提供额外的工具和资源来扩展 Cline 的能力。您可以使用
				<VSCodeLink href="https://github.com/modelcontextprotocol/servers" style={{ display: "inline" }}>
					社区版服务器
				</VSCodeLink>{" "}
				或要求 Cline 创建特定于您的工作流程的新工具（例如，“添加获取最新 npm 文档的工具”）.{" "}
				<VSCodeLink href="https://x.com/sdrzn/status/1867271665086074969" style={{ display: "inline" }}>
					查看 demo.
				</VSCodeLink>
			</div>

			{/* Remote config banner */}
			{hasRemoteMCPServers && (
				<div className="flex items-center gap-2 px-5 py-3 mb-4 bg-vscode-textBlockQuote-background border-l-[3px] border-vscode-textLink-foreground">
					<i className="codicon codicon-lock text-sm" />
					<span className="text-base">Your organization manages some MCP servers</span>
				</div>
			)}

			<ServersToggleList hasTrashIcon={false} isExpandable={true} servers={servers} />

			{/* Settings Section */}
			<div style={{ marginBottom: "20px", marginTop: 10 }}>
				<VSCodeButton
					appearance="secondary"
					onClick={() => {
						McpServiceClient.openMcpSettings(EmptyRequest.create({})).catch((error) => {
							console.error("Error opening MCP settings:", error)
						})
					}}
					style={{ width: "100%", marginBottom: "5px" }}>
					<span className="codicon codicon-server" style={{ marginRight: "6px" }} />
					配置 MCP 服务
				</VSCodeButton>

				<div style={{ textAlign: "center" }}>
					<VSCodeLink onClick={() => navigateToSettings("features")} style={{ fontSize: "12px" }}>
						MCP 高级设置
					</VSCodeLink>
				</div>
			</div>
		</div>
	)
}

export default ConfigureServersView
