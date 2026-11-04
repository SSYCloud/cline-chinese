import type { JevAnswer, JevQuestions, JevResponse, JevState } from "./types"

export const TYPESAFE_BASE_URL = "https://router.shengsuanyun.com/api/v1/decisions"
export const DEFAULT_MODEL = "jev-latest"

export interface JevRequest {
	url: string
	method: "POST"
	headers: Record<string, string>
	body: string
}

export function buildJevRequest(
	params: {
		apiKey: string
		model?: string
		baseUrl?: string
	},
	state: JevState,
	questions: JevQuestions,
): JevRequest {
	return {
		url: params.baseUrl ?? TYPESAFE_BASE_URL,
		method: "POST",
		headers: {
			authorization: `Bearer ${params.apiKey}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			model: params.model ?? DEFAULT_MODEL,
			state,
			questions,
		}),
	}
}

export function parseJevResponse(status: number, ok: boolean, text: string): JevResponse {
	if (!ok) {
		throw new Error(`Jev request failed (${status}): ${text.slice(0, 200)}`)
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		throw new Error("Jev returned malformed JSON")
	}
	if (
		parsed === null ||
		typeof parsed !== "object" ||
		!("answers" in parsed) ||
		parsed.answers === null ||
		typeof parsed.answers !== "object"
	) {
		throw new Error("Jev response is missing answers")
	}
	return parsed as JevResponse
}

export function noulAnswer(answers: Record<string, JevAnswer>, name: string): number {
	const answer = answers[name]
	if (!answer || !("noul" in answer) || typeof answer.noul !== "number" || !Number.isFinite(answer.noul)) {
		throw new Error(`Invalid Jev answer for ${name}`)
	}
	return answer.noul
}
