import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BatchWorksheet } from "./components/loomloom/BatchWorksheet"
import "./batch-base.css"

const panel = (window as Window & { __CLINE_BATCH_PANEL__?: { taskId: string; panelId: string } }).__CLINE_BATCH_PANEL__
if (panel?.taskId) {
	createRoot(document.getElementById("root")!).render(
		<StrictMode>
			<BatchWorksheet panelId={panel.panelId} taskId={panel.taskId} />
		</StrictMode>,
	)
}
