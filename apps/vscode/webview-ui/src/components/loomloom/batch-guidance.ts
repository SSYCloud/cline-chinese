import { type BatchChatSnapshot, type BatchValue, canonicalRows } from "@shared/loomloom"

export interface BatchGuidance {
	title: string
	message: string
	nextStep: string
}

/** Match the public quote snapshot to the current inputs and the service's ten-minute validity window. */
export function isBatchQuoteCurrent(session: BatchChatSnapshot, now: number): boolean {
	const quote = session.quote
	return !!(
		quote?.valid &&
		quote.revision === session.revision &&
		quote.versionId === session.listing?.versionId &&
		quote.taskCount === session.rows.length &&
		Number.isFinite(quote.at) &&
		Number.isFinite(now) &&
		now - quote.at <= 10 * 60_000
	)
}

function hasValue(value: BatchValue | undefined): boolean {
	return value !== undefined && value !== null && (typeof value !== "string" || value.trim().length > 0)
}

function collectingGuidance(session: BatchChatSnapshot): BatchGuidance {
	const fields = session.listing?.schema?.fields
	if (!fields) {
		return {
			title: "准备输入",
			message: "还没有加载这个工作流的输入要求。",
			nextStep: "请重新选择工作流，加载输入要求后再整理材料。",
		}
	}
	if (!session.rows.length) {
		return {
			title: "新增输入行",
			message: `「${session.listing?.name ?? "当前工作流"}」已加载，工作表里还没有任务行。`,
			nextStep: "点击「新增一行」，或告诉 Cline 需要整理几条；可以随时继续增删行。",
		}
	}
	if (!fields.length) {
		return {
			title: "核对任务数量",
			message: `当前有 ${session.rows.length} 行任务，这个工作流没有公开的输入字段。`,
			nextStep: "可以继续增删行；核对无误后点击「检查输入」。",
		}
	}
	const hasInputs = session.rows.some((row) => fields.some((field) => hasValue(row.values[field.key])))
	const hasAttachments = session.rows.some((row) => row.attachments.length > 0)
	const required = fields.filter((field) => field.required)
	if (!hasInputs && !required.length) {
		return {
			title: "准备输入",
			message: hasAttachments
				? "参考文件已添加，输入字段尚未填写。公开输入项均为可选，请确认是否需要把文件内容整理到输入中。"
				: `当前有 ${session.rows.length} 行任务，尚未填写输入。公开输入项均为可选，可使用工作流默认设置。`,
			nextStep: "需要定制就补充要求；确认使用默认设置后，点击「检查输入」。",
		}
	}
	try {
		canonicalRows(session)
	} catch (error) {
		const issue = error instanceof Error ? error.message : "请核对必填项和输入格式。"
		return {
			title: "补充输入",
			message:
				!hasInputs && !hasAttachments
					? `当前有 ${session.rows.length} 行任务，输入还没有填写。`
					: !hasInputs && hasAttachments
						? "参考文件已添加，还需要把材料整理到对应的输入字段。"
						: "已收到部分输入，还有内容需要补全或调整。",
			nextStep: `${issue.slice(0, 120)} 可以在聊天里补充要求，或到工作表中填写。`,
		}
	}
	return {
		title: "检查输入",
		message: required.length
			? `${session.rows.length} 行输入均通过了必填项和格式检查，接下来请逐行核对内容。`
			: "当前输入已通过格式检查，未填写的可选项将使用工作流默认设置。",
		nextStep: "点击「检查输入」，核对每条任务的材料与要求；之后再查看预算。",
	}
}

/** Read-only guidance. Pass the current time explicitly so quote expiry is deterministic. */
export function getBatchGuidance(session: BatchChatSnapshot, now: number): BatchGuidance {
	if (!session.enabled) {
		return {
			title: "继续批量任务",
			message: "这批任务的输入与运行状态已保留。",
			nextStep: "切换到 Batch 后可继续查看和操作。",
		}
	}
	switch (session.phase) {
		case "selecting":
			return {
				title: "选择工作流",
				message: "先选一个工作流，我会按它的输入要求帮你整理材料。",
				nextStep: "可以告诉我想完成什么，或从已安装的 SkillBot 中选择。",
			}
		case "quantity":
			return {
				title: "输入准备",
				message: session.listing ? `已选择「${session.listing.name}」，可以开始填写输入。` : "请先选择一个 SkillBot。",
				nextStep: "在工作表或聊天中按需新增、删除任务行，无须事先确定总数。",
			}
		case "collecting":
			return collectingGuidance(session)
		case "reviewing":
			return {
				title: "核对输入",
				message: "现在请检查每条任务的输入，尤其是材料、要求和附件是否对应。",
				nextStep: "需要调整可以继续告诉我；核对后点击「确认输入并查看预算」。",
			}
		case "quoting":
			return {
				title: "获取预算",
				message: "正在按当前输入获取预算。",
				nextStep: "请等待预算返回，再核对任务数量和预计费用。",
			}
		case "quoted": {
			return isBatchQuoteCurrent(session, now)
				? {
						title: "确认预算",
						message: "预算已返回，请核对任务数量和预计费用。",
						nextStep: "确认费用可接受后，由你点击「确认并运行」；需要调整则先返回修改。",
					}
				: {
						title: "重新获取预算",
						message: "当前预算已失效、已过期或尚未取得，需要重新核对输入。",
						nextStep: "返回修改并检查输入，再获取最新预算后确认运行。",
					}
		}
		case "submitting":
			return {
				title: "提交任务",
				message: "运行请求正在提交，提交结果还未返回。",
				nextStep: "请等待提交结果，避免重复确认运行。",
			}
		case "execution-unknown":
			return {
				title: "核对提交结果",
				message: "暂时无法确认是否已创建云端任务，需要先核对调用记录。",
				nextStep: "在 LoomLoom 调用记录中核对本次运行，再填写运行 ID 并关联；核对前请勿重复提交。",
			}
		case "running":
			return {
				title: "查看运行进度",
				message: session.progress
					? `云端正在处理这批任务，当前成功 ${session.progress.completed}/${session.progress.total} 条、失败 ${session.progress.failed} 条、取消 ${session.progress.cancelled ?? 0} 条。`
					: "任务已提交，正在同步云端运行进度。",
				nextStep: "可以在工作表中查看逐条状态和已返回的结果，也可以点击「刷新状态」。",
			}
		case "completed":
			return {
				title: "查看结果",
				message: "这批任务已完成，可以查看逐条结果。",
				nextStep: "在右侧工作表中查看产物；继续使用同一 SkillBot 可直接开始下一批，也可以改用其他工作流。",
			}
		case "partial-failure":
			return {
				title: "检查未成功的任务",
				message: "这批任务已结束，部分任务未成功。",
				nextStep: "在工作表中查看成功结果和失败原因；需要重做时，先核对未成功的行，再开始新一批。",
			}
		case "failed":
			return {
				title: "检查运行问题",
				message: "这批任务未成功完成，请先查看错误信息。",
				nextStep: "在工作表中核对逐条状态与原因，确认处理方案后再开始新一批。",
			}
	}
}
