import type { BatchSession } from "@shared/loomloom"
import { listSheets } from "@shared/loomloom-sheet"
import type { BatchPresentationIntent, BatchService } from "./batch-service"

interface BatchPresentationHost {
	currentTask(): string | undefined
	open(taskId: string, preserveFocus: boolean): Promise<void>
	onError(error: unknown): void
}

/** Presents the existing shared worksheet at workflow transitions, never on polls or edits. */
export class BatchPresentationCoordinator {
	private disposed = false
	private pending: Promise<void> = Promise.resolve()
	private activationGeneration = 0
	private readonly unsubscribe: () => void

	constructor(
		private readonly batch: BatchService,
		private readonly host: BatchPresentationHost,
	) {
		this.unsubscribe = batch.subscribePresentation((intent) => this.enqueue(() => this.present(intent)))
	}

	private enqueue(present: () => Promise<void>) {
		this.pending = this.pending.then(present).catch((error) => {
			try {
				this.host.onError(error)
			} catch {
				/* A failed logger must not reject the presentation queue. */
			}
		})
	}

	/** Restore an already-enabled task when its conversation is selected, retaining its saved view. */
	activateTask(taskId: string | undefined): void {
		const generation = ++this.activationGeneration
		if (this.disposed || !taskId) return
		this.enqueue(async () => {
			const active = () =>
				!this.disposed && generation === this.activationGeneration && this.host.currentTask() === taskId
			if (!active()) return
			const session = await this.batch.snapshot(taskId)
			if (!active() || !session?.enabled || (!session.rows.length && !session.pastRuns?.length)) return
			const accepts = (current: BatchSession) =>
				active() &&
				current.enabled &&
				current.id === session.id &&
				current.rows[0]?.id === session.rows[0]?.id &&
				current.attempt?.runId === session.attempt?.runId
			const validView = (current: BatchSession) => listSheets(current).some((sheet) => sheet.id === current.worksheet?.sheet)
			if (!validView(session)) {
				const progress = !!session.attempt
				await this.batch.updateWorksheet(
					taskId,
					{ ...session.worksheet, sheet: progress ? "progress" : "current", range: progress ? "B2" : "C2" },
					(current) => accepts(current) && !validView(current),
				)
			}
			const current = await this.batch.snapshot(taskId)
			if (current && accepts(current)) await this.host.open(taskId, true)
		})
	}

	private accepts(intent: BatchPresentationIntent, session: BatchSession | undefined): session is BatchSession {
		return (
			!this.disposed &&
			this.host.currentTask() === intent.taskId &&
			!!session?.enabled &&
			session.id === intent.batchId &&
			// A session survives newBatch; the first row identifies its current draft.
			session.rows[0]?.id === intent.firstRowId &&
			session.attempt?.runId === intent.runId &&
			(["run", "resume"].includes(intent.reason) || !session.attempt)
		)
	}

	private async present(intent: BatchPresentationIntent) {
		if (this.disposed || this.host.currentTask() !== intent.taskId) return
		const session = await this.batch.snapshot(intent.taskId)
		if (!this.accepts(intent, session)) return
		const progress = intent.reason === "run" || (intent.reason === "resume" && !!session.attempt)
		const updated = await this.batch.updateWorksheet(
			intent.taskId,
			{ ...session.worksheet, sheet: progress ? "progress" : "current", range: progress ? "B2" : "C2" },
			(current) => this.accepts(intent, current),
		)
		if (!updated || !this.accepts(intent, await this.batch.snapshot(intent.taskId))) return
		await this.host.open(intent.taskId, true)
	}

	/** Await queued presentation without making domain commands wait for the native host. */
	whenIdle(): Promise<void> {
		return this.pending
	}

	dispose() {
		this.disposed = true
		this.unsubscribe()
	}
}
