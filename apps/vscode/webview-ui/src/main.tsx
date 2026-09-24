import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import "./main.css"
import "./index.css"
import App from "./App.tsx"

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
	state = { failed: false }

	static getDerivedStateFromError() {
		return { failed: true }
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("Cline webview failed to render", error, info.componentStack)
	}

	render() {
		if (this.state.failed) {
			return (
				<div className="p-4 text-sm" role="alert">
					<div>侧栏加载失败，当前任务仍保存在扩展中。</div>
					<button className="mt-3 underline" onClick={() => window.location.reload()} type="button">
						重新加载侧栏
					</button>
				</div>
			)
		}
		return this.props.children
	}
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<AppErrorBoundary>
			<App />
		</AppErrorBoundary>
	</StrictMode>,
)
