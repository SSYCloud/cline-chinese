export type Role = "user" | "assistant"

export interface ToolUse {
	tool_use_id: string
	tool: string
	input: Record<string, unknown>
	text?: string
	isError?: boolean
}

export interface ToolResult {
	tool_use_id: string
	text: string
	isError?: boolean
}

export interface Message {
	role: Role
	text: string
	toolUses: ToolUse[]
	toolResults?: ToolResult[]
}

export interface ToolCall {
	id: string
	tool_use_id: string
	tool: string
	input: Record<string, unknown>
	callIndex: number
	resultIndex: number
	resultChars: number
	isError: boolean
	pinned: boolean
}

export interface CallAnswer {
	keepCall: number
	keepResult: number
}

export type CallAction = "keep" | "drop_result" | "drop_call"

export interface CallDecision extends CallAnswer {
	id: string
	tool: string
	action: CallAction
	reason: "pinned" | "kept" | "result_dropped" | "call_dropped"
}

export interface HistoryToolCall {
	id: string
	tool: string
	input: string
	result: string
}

export interface HistoryEntry {
	i: number
	role: Role
	text: string
	tool_calls?: HistoryToolCall[] | string[]
}

export interface CompactionState {
	context: string
	goal: string
	history: HistoryEntry[]
}

export interface FittedState {
	state: CompactionState
	tokens: number
	stage: string
}

export interface CompactOptions {
	goal?: string
	keepThreshold?: number
	preserveRecentMessages?: number
	maxStateTokens?: number
	maxRequestTokens?: number
	truncateHeadChars?: number
}

export interface ResolvedCompactOptions {
	goal: string
	keepThreshold: number
	preserveRecentMessages: number
	maxStateTokens: number
	maxRequestTokens: number
	truncateHeadChars: number
}

export interface CompactResult {
	messages: Message[]
	decisions: CallDecision[]
	stats: {
		messagesBefore: number
		messagesAfter: number
		charsBefore: number
		charsAfter: number
		calls: number
		kept: number
		resultsDropped: number
		callsDropped: number
		pinned: number
		stateTokens: number
		stateStage: string
		requests: number
		ms: number
	}
}

export type JevState = string | object

export interface NoulQuestion {
	type: "noul"
	instructions: string
	criteria?: {
		true?: string
		false?: string
	}
}

export interface ChoiceQuestion {
	type: "choice"
	instructions: string
	criteria: Record<string, string | null>
}

export interface ScoreQuestion {
	type: "score"
	instructions: string
	criteria: string[]
}

export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion
export type JevQuestions = Record<string, JevQuestion>

export interface NoulAnswer {
	type?: "noul"
	noul: number
}

export interface ChoiceAnswer {
	type?: "choice"
	choice: string
	confidence: number
	probabilities: Record<string, number>
}

export interface ScoreAnswer {
	type?: "score"
	score: number
	confidence: number
	probabilities: Record<string, number>
}

export type JevAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer

export interface JevResponse {
	model?: string
	answers: Record<string, JevAnswer>
	usage?: {
		input_tokens?: number
		output_tokens?: number
	}
	[key: string]: unknown
}

export interface JevAsker {
	ask(state: JevState, questions: JevQuestions): Promise<JevResponse>
}
