import { EmptyRequest } from "@shared/proto/cline/common"
import { useEffect, useState } from "react"
import { SlashServiceClient } from "@/services/grpc-client"

const PLUGIN_COMMAND_SECTION = "plugin"

/** Names of slash commands that plugins run as code instead of expanding into a prompt. */
export function usePluginFunctionCommands(): string[] {
	const [names, setNames] = useState<string[]>([])
	useEffect(() => {
		let cancelled = false
		SlashServiceClient.getAvailableSlashCommands(EmptyRequest.create({}))
			.then((result) => {
				if (!cancelled) {
					setNames(
						result.commands
							.filter((command) => command.section === PLUGIN_COMMAND_SECTION)
							.map((command) => command.name),
					)
				}
			})
			.catch((error) => console.error("Failed to load plugin function commands:", error))
		return () => {
			cancelled = true
		}
	}, [])
	return names
}
