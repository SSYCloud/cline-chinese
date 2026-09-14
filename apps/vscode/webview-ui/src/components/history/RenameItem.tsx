import { HistoryItem } from "@shared/HistoryItem"
import { TaskTitleRequest } from "@shared/proto/cline/task"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { PencilIcon } from "lucide-react"
import { type ReactNode, useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"

interface Props {
	item: HistoryItem
	onRename?: (taskId: string, title: string) => void | Promise<void>
	className?: string
	renderTrigger?: (openRenameDialog: () => void) => ReactNode
}

export const RenameItem = ({ item, onRename, className, renderTrigger }: Props) => {
	const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false)
	const [renameTitle, setRenameTitle] = useState("")

	const handleRenameTask = useCallback(
		async (taskId: string, title: string) => {
			try {
				if (onRename) {
					await onRename(taskId, title)
				} else {
					await TaskServiceClient.updateTaskTitle(TaskTitleRequest.create({ taskId, title }))
				}
			} catch (err) {
				console.error(`[RENAME_TASK_UI] Error for task ${taskId}:`, err)
			}
		},
		[onRename],
	)

	const openRenameDialog = useCallback(() => {
		setRenameTitle(item.task)
		setIsRenameDialogOpen(true)
	}, [item.task])

	const label = item.task ? "编辑标题" : "添加标题"

	return (
		<Dialog onOpenChange={setIsRenameDialogOpen} open={isRenameDialogOpen}>
			{renderTrigger ? (
				renderTrigger(openRenameDialog)
			) : (
				<Tooltip>
					<TooltipContent>{label}</TooltipContent>
					<TooltipTrigger className={cn("flex items-center", className)}>
						<Button
							aria-label={label}
							onClick={(e) => {
								e.preventDefault()
								e.stopPropagation()
								openRenameDialog()
							}}
							size="icon"
							variant="icon">
							<PencilIcon />
						</Button>
					</TooltipTrigger>
				</Tooltip>
			)}
			<DialogContent
				onClick={(e) => e.stopPropagation()}
				onInteractOutside={(e) => e.preventDefault()}
				onKeyDown={(e) => e.stopPropagation()}
				onPointerDown={(e) => e.stopPropagation()}>
				<DialogHeader>
					<DialogTitle>{label}</DialogTitle>
				</DialogHeader>
				<VSCodeTextField
					className="w-full"
					onInput={(e) => setRenameTitle((e.target as HTMLInputElement).value)}
					placeholder="输入历史记录标题..."
					value={renameTitle}>
					<div className="codicon codicon-edit opacity-80 mt-0.5 text-sm!" slot="start" />
				</VSCodeTextField>
				<DialogFooter>
					<Button
						onClick={(e) => {
							e.stopPropagation()
							setIsRenameDialogOpen(false)
						}}
						variant="secondary">
						取消
					</Button>
					<Button
						disabled={!renameTitle.trim()}
						onClick={(e) => {
							e.stopPropagation()
							handleRenameTask(item.id, renameTitle.trim())
							setIsRenameDialogOpen(false)
						}}>
						保存
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
