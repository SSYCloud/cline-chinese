import { ActionMetadata } from "./types"

export const ACTION_METADATA: ActionMetadata[] = [
	{
		id: "readFiles",
		label: "读取文件",
		shortName: "Read",
		icon: "codicon-search",
	},
	{
		id: "editFiles",
		label: "编辑文件",
		shortName: "Edit",
		icon: "codicon-edit",
	},
	{
		id: "executeSafeCommands",
		label: "执行命令",
		shortName: "Commands",
		icon: "codicon-terminal",
	},
	{
		id: "useBrowser",
		label: "获取网页内容",
		shortName: "Web Fetch",
		icon: "codicon-globe",
	},
	{
		id: "useMcp",
		label: "使用 MCP 服务器",
		shortName: "MCP",
		icon: "codicon-server",
	},
]
