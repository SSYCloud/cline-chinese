import { posthogConfig } from "@shared/services/config/posthog-config"
import { type ReactNode, useEffect, useState } from "react"
import { useExtensionState } from "./context/ExtensionStateContext"

type PostHogClient = typeof import("posthog-js").default

export function CustomPostHogProvider({ children }: { children: ReactNode }) {
	const { distinctId, version, userInfo, environment, telemetrySetting } = useExtensionState()

	// Skip PostHog entirely in self-hosted mode or when environment is unknown (safety fallback)
	const isSelfHostedOrUnknown = !environment || environment === "selfHosted"

	const isTelemetryEnabled = telemetrySetting !== "disabled"
	const [client, setClient] = useState<PostHogClient | null>(null)

	useEffect(() => {
		if (isSelfHostedOrUnknown || client || !posthogConfig.apiKey) return
		let cancelled = false
		// Analytics is optional and must never block the first VS Code chat paint.
		void import("posthog-js")
			.then(({ default: posthog }) => {
				if (cancelled) return
				posthog.init(posthogConfig.apiKey as string, {
					api_host: posthogConfig.host,
					ui_host: posthogConfig.uiHost,
					disable_session_recording: true,
					capture_pageview: false,
					capture_dead_clicks: false,
					advanced_disable_decide: false,
					autocapture: false,
				})
				setClient(posthog)
			})
			.catch((error) => console.error("Failed to initialize webview analytics:", error))
		return () => {
			cancelled = true
		}
	}, [isSelfHostedOrUnknown, client])

	useEffect(() => {
		if (!client || !distinctId || !version) {
			return
		}

		client.set_config({
			before_send: (payload) => {
				// Only filter out events if telemetry is disabled, but allow feature flag requests
				if (!isTelemetryEnabled && payload?.event !== "$feature_flag_called") {
					return null
				}

				if (payload?.properties) {
					payload.properties.extension_version = version
					payload.properties.distinct_id = distinctId
				}
				return payload
			},
		})

		const optedIn = client.has_opted_in_capturing()
		const optedOut = client.has_opted_out_capturing()
		const args = {
			email: userInfo?.email,
			name: userInfo?.displayName,
		}
		client.identify(distinctId, args)

		if (isTelemetryEnabled && !optedIn) {
			client.opt_in_capturing()
		} else if (!isTelemetryEnabled && !optedOut) {
			// Then opt out of capturing other events
			client.opt_out_capturing()
		}
	}, [client, isTelemetryEnabled, distinctId, version, userInfo?.email, userInfo?.displayName])

	return children
}
