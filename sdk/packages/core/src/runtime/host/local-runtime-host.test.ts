import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { MessageWithMetadata } from "@cline/llms";
import {
	type AgentConfig,
	type AgentEvent,
	type AgentExtensionAutomationContext,
	type AgentResult,
	type AgentRuntimeEvent,
	type BasicLogger,
	isChatWorkspacePath,
	TeamMessageType,
	type TeamRunRecord,
} from "@cline/shared";
import {
	resolveChatWorkspacePath,
	setClineDir,
	setHomeDir,
} from "@cline/shared/storage";
import simpleGit from "simple-git";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamEvent } from "../../extensions/tools/team";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
import { CORE_TELEMETRY_EVENTS } from "../../services/telemetry/core-events";
import { TelemetryService } from "../../services/telemetry/TelemetryService";
import {
	createSessionCompactionState,
	type SessionCompactionState,
} from "../../session/models/session-compaction";
import type { SessionManifest } from "../../session/models/session-manifest";
import { FileSessionService } from "../../session/services/file-session-service";
import { SessionSource } from "../../types/common";
import type { CoreSessionConfig } from "../../types/config";
import { LocalRuntimeHost as RuntimeHostUnderTest } from "./local-runtime-host";
import { type StartSessionInput, splitCoreSessionConfig } from "./runtime-host";

const distinctId = "test-machine-id";

function createResult(overrides: Partial<AgentResult> = {}): AgentResult {
	return {
		text: "ok",
		iterations: 1,
		finishReason: "completed",
		usage: {
			inputTokens: 1,
			outputTokens: 2,
			totalCost: 0,
		},
		messages: [],
		toolCalls: [],
		durationMs: 1,
		model: {
			id: "mock-model",
			provider: "mock-provider",
		},
		startedAt: new Date("2026-01-01T00:00:00.000Z"),
		endedAt: new Date("2026-01-01T00:00:01.000Z"),
		...overrides,
	};
}

function createManifest(sessionId: string): SessionManifest {
	return {
		version: 1,
		session_id: sessionId,
		source: SessionSource.CLI,
		pid: process.pid,
		started_at: "2026-01-01T00:00:00.000Z",
		status: "running",
		interactive: false,
		provider: "mock-provider",
		model: "mock-model",
		cwd: "/tmp/project",
		workspace_root: "/tmp/project",
		enable_tools: true,
		enable_spawn: true,
		enable_teams: true,
		prompt: "hello",
		messages_path: "/tmp/messages.json",
	};
}

type PluginEventTestHarness = {
	handlePluginEvent: (
		rootSessionId: string,
		event: { name: string; payload?: unknown },
		fallbackAutomation?: AgentExtensionAutomationContext,
	) => Promise<void>;
	getPendingPrompts: (
		sessionId: string,
	) => Array<{ prompt: string; delivery: "queue" | "steer" }>;
};

function createPluginEventHarness(
	manager: RuntimeHostUnderTest,
): PluginEventTestHarness {
	const target = manager as object;
	return {
		handlePluginEvent: async (rootSessionId, event, fallbackAutomation) => {
			const handler = Reflect.get(target, "handlePluginEvent");
			if (typeof handler !== "function") {
				throw new Error("handlePluginEvent test hook unavailable");
			}
			await Reflect.apply(
				handler as (
					rootSessionId: string,
					event: { name: string; payload?: unknown },
					fallbackAutomation?: AgentExtensionAutomationContext,
				) => Promise<void>,
				target,
				[rootSessionId, event, fallbackAutomation],
			);
		},
		getPendingPrompts: (sessionId) => {
			const getter = Reflect.get(target, "getSessionOrThrow");
			if (typeof getter !== "function") {
				throw new Error("getSessionOrThrow test hook unavailable");
			}
			const session = Reflect.apply(
				getter as (sessionId: string) => {
					pendingPrompts: Array<{
						id: string;
						prompt: string;
						delivery: "queue" | "steer";
						userFiles?: unknown;
						userImages?: unknown;
					}>;
				},
				target,
				[sessionId],
			);
			return session.pendingPrompts.map(({ prompt, delivery }) => ({
				prompt,
				delivery,
			}));
		},
	};
}

function createConfig(
	overrides: Partial<CoreSessionConfig> = {},
): CoreSessionConfig {
	return {
		providerId: "mock-provider",
		modelId: "mock-model",
		cwd: "/tmp/project",
		systemPrompt: "You are a test agent",
		mode: "act",
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
		...overrides,
	};
}

function normalizeStartInput(
	input: Omit<StartSessionInput, "config" | "localRuntime"> & {
		config: CoreSessionConfig;
	},
): StartSessionInput {
	const split = splitCoreSessionConfig(input.config);
	return {
		...input,
		...split,
	};
}

describe("LocalRuntimeHost", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
	};
	let isolatedHomeDir = "";

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "core-session-home-"));
		process.env.HOME = isolatedHomeDir;
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline");
		delete process.env.CLINE_DATA_DIR;
		setHomeDir(isolatedHomeDir);
		setClineDir(process.env.CLINE_DIR);
	});

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME;
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR;
		if (envSnapshot.CLINE_DATA_DIR === undefined) {
			delete process.env.CLINE_DATA_DIR;
		} else {
			process.env.CLINE_DATA_DIR = envSnapshot.CLINE_DATA_DIR;
		}
		setHomeDir(envSnapshot.HOME ?? "~");
		setClineDir(envSnapshot.CLINE_DIR ?? join("~", ".cline"));
		rmSync(isolatedHomeDir, { recursive: true, force: true });
	});

	it("uses host connector authentication on startup and resume", async () => {
		const settings = vi
			.spyOn(ProviderSettingsManager.prototype, "getProviderSettings")
			.mockReturnValue(undefined);
		const request = vi.fn(async () =>
			Response.json({
				data: {
					sessionId: "meta-session",
					tools: [
						"COMPOSIO_SEARCH_TOOLS",
						"COMPOSIO_MANAGE_CONNECTIONS",
						"COMPOSIO_WAIT_FOR_CONNECTIONS",
						"COMPOSIO_MULTI_EXECUTE_TOOL",
					].map((slug) => ({
						slug,
						input_parameters: { type: "object", properties: {} },
					})),
				},
			}),
		);
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: new FileSessionService(join(isolatedHomeDir, "sessions")),
			connectorsRequest: request,
		});
		const start: StartSessionInput = {
			config: createConfig({
				providerId: "openai",
				modelId: "gpt-4.1",
				apiKey: "test-key",
				cwd: isolatedHomeDir,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			}),
			localRuntime: { configExtensions: [] },
			interactive: true,
			initialMessages: [{ role: "user", content: "saved conversation" }],
		};
		try {
			const first = await manager.startSession(start);
			expect(request).toHaveBeenCalledTimes(1);
			await manager.stopSession(first.sessionId);
			await manager.startSession({
				...start,
				config: { ...start.config, sessionId: first.sessionId },
			});
			expect(request).toHaveBeenCalledTimes(2);
			expect(
				settings.mock.calls.every(([provider]) => provider !== "cline"),
			).toBe(true);
		} finally {
			await manager.dispose();
			settings.mockRestore();
		}
	});

	it.each([
		{ source: "generated", requestedSessionId: undefined },
		{ source: "requested", requestedSessionId: "session-explicit" },
	] as const)("resolves an omitted workspace with the $source session ID", async ({
		requestedSessionId,
	}) => {
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn().mockResolvedValue(undefined),
			}),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-temp-workspace"),
			getConversationId: vi.fn().mockReturnValue("conv-temp-workspace"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const sessionsDir = join(isolatedHomeDir, "sessions");
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: new FileSessionService(sessionsDir),
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});
		let chatWorkspace = "";

		try {
			const result = await manager.startSession({
				config: {
					...(requestedSessionId ? { sessionId: requestedSessionId } : {}),
					providerId: "mock-provider",
					modelId: "mock-model",
					systemPrompt: "You are a test agent",
					enableTools: false,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				},
			});

			chatWorkspace = result.manifest.cwd;
			if (requestedSessionId) {
				expect(result.sessionId).toBe(requestedSessionId);
			}
			expect(chatWorkspace).toBe(resolveChatWorkspacePath());
			expect(isChatWorkspacePath(chatWorkspace)).toBe(true);
			expect(result.manifest.workspace_root).toBe(chatWorkspace);
			expect(existsSync(join(sessionsDir, result.sessionId))).toBe(false);
			expect(runtimeBuilder.build).toHaveBeenCalledWith(
				expect.objectContaining({
					config: expect.objectContaining({
						cwd: chatWorkspace,
						workspaceRoot: chatWorkspace,
					}),
				}),
			);
		} finally {
			await manager.dispose();
			if (chatWorkspace) {
				rmSync(dirname(chatWorkspace), { recursive: true, force: true });
			}
		}
	});

	it("resolves OAuth credentials before creating the agent", async () => {
		const sessionId = "sess-oauth-bootstrap";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
				messagesPath: "/tmp/messages.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({ tools: [], shutdown: vi.fn() }),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const createAgent = vi.fn(() => agent as never);
		const oauthTokenManager = {
			resolveProviderApiKey: vi.fn().mockResolvedValue({
				apiKey: "workos:resolved-token",
				refreshed: false,
			}),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent,
			oauthTokenManager: oauthTokenManager as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({
					sessionId,
					providerId: "cline-pass",
					modelId: "cline-pass/glm-5.2",
					apiKey: undefined,
				}),
				prompt: "hello",
			}),
		);

		expect(oauthTokenManager.resolveProviderApiKey).toHaveBeenCalledWith({
			providerId: "cline-pass",
		});
		expect(createAgent).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "cline-pass",
				apiKey: "workos:resolved-token",
			}),
		);
	});

	it("captures active session lookup misses as handled telemetry", async () => {
		const adapter = {
			name: "test",
			emit: vi.fn(),
			emitRequired: vi.fn(),
			recordCounter: vi.fn(),
			recordHistogram: vi.fn(),
			recordGauge: vi.fn(),
			isEnabled: vi.fn(() => true),
			flush: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
		};
		const telemetry = new TelemetryService({ adapters: [adapter] });
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: {} as never,
			telemetry,
		});

		await expect(
			manager.runTurn({ sessionId: "missing-session", prompt: "hi" }),
		).rejects.toThrow("session not found: missing-session");

		expect(adapter.emit).toHaveBeenCalledWith(
			"sdk.error",
			expect.objectContaining({
				component: "core",
				operation: "session.active_lookup",
				severity: "warn",
				handled: true,
				sessionId: "missing-session",
				activeSessionCount: 0,
				error_message: "session not found: missing-session",
			}),
		);
	});

	it("passes app runtime capabilities into the local execution path", async () => {
		const sessionId = "sess-local-capabilities";
		const manifest = createManifest(sessionId);
		const askQuestion = vi.fn(async () => "Use shared handler");
		const requestToolApproval = vi.fn(async () => ({ approved: true }));
		const appCapabilities = {
			toolExecutors: { askQuestion },
			requestToolApproval,
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: {
				ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
				createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
					manifestPath: "/tmp/manifest.json",
					messagesPath: "/tmp/messages.json",
					manifest,
				}),
				persistSessionMessages: vi.fn(),
				updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
				writeSessionManifest: vi.fn(),
				listSessions: vi.fn().mockResolvedValue([]),
				deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
			} as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: (config) => {
				expect(typeof config.requestToolApproval).toBe("function");
				return agent as never;
			},
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				prompt: "hello",
				capabilities: appCapabilities,
			}),
		);

		expect(runtimeBuilder.build).toHaveBeenCalledWith(
			expect.objectContaining({
				toolExecutors: expect.objectContaining({ askQuestion }),
			}),
		);
		expect(
			vi.mocked(runtimeBuilder.build).mock.calls[0]?.[0].toolExecutors
				?.askQuestion,
		).toBe(askQuestion);
		expect(agent.run).toHaveBeenCalledWith(
			expect.stringContaining("hello"),
			undefined,
			undefined,
		);
	});

	it("ingests automation events emitted by sandbox plugins during setup", async () => {
		const sessionId = "sess-plugin-automation-setup";
		const ingestEvent = vi.fn().mockResolvedValue(undefined);
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: {
				ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
				listSessions: vi.fn().mockResolvedValue([]),
			} as never,
		});
		const harness = createPluginEventHarness(manager);

		await harness.handlePluginEvent(
			sessionId,
			{
				name: "automation_event",
				payload: {
					eventId: "evt_setup_1",
					eventType: "local.plugin_event",
					source: "local-plugin",
					occurredAt: "2026-04-24T10:00:00.000Z",
				},
			},
			{ ingestEvent },
		);

		expect(ingestEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				eventId: "evt_setup_1",
				eventType: "local.plugin_event",
			}),
		);
	});

	it("persists custom session sources without coercing them to builtin values", async () => {
		const sessionId = "sess-kanban";
		const manifest = {
			...createManifest(sessionId),
			source: "kanban",
		};
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
				messagesPath: "/tmp/messages.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({
				updated: true,
				endedAt: "2026-01-01T00:00:05.000Z",
			}),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				teamRuntime: undefined,
				teamRestoredFromPersistence: false,
				shutdown: vi.fn(),
			}),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});

		const started = await manager.startSession(
			normalizeStartInput({
				source: "kanban",
				config: createConfig({ sessionId }),
				prompt: "hello",
			}),
		);

		expect(sessionService.createRootSessionWithArtifacts).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId,
				source: "kanban",
			}),
		);
		expect(started.manifest.source).toBe("kanban");
	});

	it("keeps brand-new empty sessions lazy until the first user turn", async () => {
		const sessionId = "sess-lazy-empty";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
				messagesPath: "/tmp/messages.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({
				updated: true,
				endedAt: "2026-01-01T00:00:05.000Z",
			}),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				teamRuntime: undefined,
				teamRestoredFromPersistence: false,
				shutdown: vi.fn(),
			}),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);

		// No seeded history to protect: closing the runtime before any user
		// turn must still leave no empty history entry behind.
		expect(
			sessionService.createRootSessionWithArtifacts,
		).not.toHaveBeenCalled();
		expect(sessionService.persistSessionMessages).not.toHaveBeenCalled();
	});

	it("reads manifest-only session records and messages", async () => {
		const sessionId = "manifest-only-session";
		const messagesPath = join(isolatedHomeDir, "messages.json");
		const messages = [
			{ role: "user" as const, content: "from manifest" },
			{ role: "assistant" as const, content: "loaded" },
		];
		writeFileSync(
			messagesPath,
			`${JSON.stringify({ version: 1, messages })}\n`,
			"utf8",
		);
		const manifest: SessionManifest = {
			...createManifest(sessionId),
			messages_path: messagesPath,
		};
		const sessionService = {
			listSessions: vi.fn().mockResolvedValue([]),
			readSessionManifest: vi.fn().mockReturnValue(manifest),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
		});

		await expect(manager.getSession(sessionId)).resolves.toMatchObject({
			sessionId,
			source: manifest.source,
			messagesPath,
		});
		await expect(manager.readSessionMessages(sessionId)).resolves.toEqual(
			messages,
		);
		expect(sessionService.readSessionManifest).toHaveBeenCalledWith(sessionId);
	});

	it("marks interactive sessions idle after a completed turn", async () => {
		const sessionId = "sess-interactive-turn-status";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
				messagesPath: "/tmp/messages.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi
				.fn()
				.mockImplementation(async (_sessionId: string, status: string) => ({
					updated: true,
					...(status === "running" || status === "idle" || status === "pending"
						? {}
						: { endedAt: "2026-01-01T00:00:05.000Z" }),
				})),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtime = { tools: [], shutdown: vi.fn() };
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue(runtime),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				prompt: "hello",
				interactive: true,
			}),
		);

		expect(sessionService.updateSessionStatus).toHaveBeenCalledWith(
			sessionId,
			"idle",
			null,
		);
		await expect(manager.getSession(sessionId)).resolves.toMatchObject({
			sessionId,
			status: "idle",
		});
		expect(agent.shutdown).not.toHaveBeenCalled();
		expect(runtime.shutdown).not.toHaveBeenCalled();
	});

	it("disposes idle interactive sessions without changing status", async () => {
		const sessionId = "sess-interactive-dispose";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
				messagesPath: "/tmp/messages.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({
				updated: true,
				endedAt: "2026-01-01T00:00:05.000Z",
			}),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtime = { tools: [], shutdown: vi.fn() };
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue(runtime),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});

		// No seeded history: the session never materializes artifacts, so
		// disposing it must not write a status row.
		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);
		sessionService.updateSessionStatus.mockClear();

		await manager.dispose("test_dispose");

		expect(sessionService.updateSessionStatus).not.toHaveBeenCalled();
		expect(agent.shutdown).toHaveBeenCalledWith("test_dispose");
		expect(runtime.shutdown).toHaveBeenCalledWith("test_dispose");
	});

	it("reuses the persisted team name when resuming a session", async () => {
		const sessionId = "sess-team-resume";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
				messagesPath: "/tmp/messages.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({
				updated: true,
				endedAt: "2026-01-01T00:00:05.000Z",
			}),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([
				{
					sessionId,
					source: SessionSource.CLI,
					pid: process.pid,
					startedAt: "2026-01-01T00:00:00.000Z",
					endedAt: null,
					exitCode: null,
					status: "running",
					statusLock: 0,
					interactive: true,
					provider: "mock-provider",
					model: "mock-model",
					cwd: "/tmp/project",
					workspaceRoot: "/tmp/project",
					teamName: "persisted-team",
					enableTools: true,
					enableSpawn: true,
					enableTeams: true,
					parentSessionId: null,
					parentAgentId: null,
					agentId: null,
					conversationId: null,
					isSubagent: false,
					prompt: null,
					metadata: null,
					messagesPath: "/tmp/messages.json",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
			]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				teamRuntime: {
					getTeamId: vi.fn().mockReturnValue("team_persisted-team"),
					getTeamName: vi.fn().mockReturnValue("persisted-team"),
				},
				teamRestoredFromPersistence: true,
				shutdown: vi.fn(),
			}),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId, teamName: undefined }),
			}),
		);

		expect(runtimeBuilder.build).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					sessionId,
					teamName: "persisted-team",
				}),
			}),
		);
		expect(
			sessionService.createRootSessionWithArtifacts,
		).not.toHaveBeenCalled();
	});

	it("does not fail the run when assistant-response disk flush fails", async () => {
		const sessionId = "sess-assistant-flush";
		const manifest = createManifest(sessionId);
		const createRootSessionWithArtifacts = vi.fn().mockResolvedValue({
			manifestPath: "/tmp/manifest-assistant-flush.json",
			messagesPath: "/tmp/messages-assistant-flush.json",
			manifest,
		});
		const order: string[] = [];
		const persistError = new Error("disk full");
		let persistCallCount = 0;
		const persistSessionMessages = vi.fn().mockImplementation(() => {
			order.push("persist");
			persistCallCount += 1;
			if (persistCallCount === 1) {
				return Promise.reject(persistError);
			}
			return Promise.resolve();
		});
		const logger: BasicLogger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		};
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts,
			persistSessionMessages,
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		const messages = [
			{
				role: "user" as const,
				content: [{ type: "text" as const, text: "hello" }],
			},
			{
				role: "assistant" as const,
				content: [{ type: "text" as const, text: "ready on disk" }],
			},
		];
		const run = vi.fn(
			async (
				_prompt: string,
				_userImages?: string[],
				_userFiles?: string[],
			) => {
				const assistantEvent: AgentRuntimeEvent = {
					type: "assistant-message",
					iteration: 1,
					finishReason: "stop",
					message: {
						id: "msg_assistant",
						role: "assistant",
						content: [{ type: "text", text: "ready on disk" }],
						createdAt: Date.now(),
					},
					snapshot: {
						agentId: "agent-root-1",
						runId: "run-1",
						status: "running",
						iteration: 1,
						messages: [],
						pendingToolCalls: [],
						usage: {
							inputTokens: 0,
							outputTokens: 0,
							cacheReadTokens: 0,
							cacheWriteTokens: 0,
							totalCost: 0,
						},
					},
				};
				await capturedConfig?.hooks?.onEvent?.(assistantEvent);
				order.push("run-return");
				return createResult({ messages });
			},
		);
		let capturedConfig:
			| {
					hooks?: {
						onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>;
					};
			  }
			| undefined;
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: (config) => {
				capturedConfig = config;
				return {
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi
						.fn()
						.mockReturnValueOnce([])
						.mockReturnValue(messages),
					messages: [],
				} as never;
			},
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId, logger }),
				prompt: "hello",
				interactive: false,
			}),
		);

		expect(persistSessionMessages).toHaveBeenCalledTimes(2);
		expect(persistSessionMessages).toHaveBeenNthCalledWith(
			1,
			sessionId,
			messages,
			"You are a test agent",
		);
		expect(order).toEqual(["persist", "run-return", "persist"]);
		expect(logger.error).toHaveBeenCalledWith(
			"Failed to persist session messages after assistant response",
			{ sessionId, error: persistError },
		);
	});

	it("observes iteration-end persist failures instead of leaking an unhandled rejection", async () => {
		const sessionId = "sess-iteration-end-persist";
		const manifest = createManifest(sessionId);
		const persistError = new Error("row missing");
		const persistSessionMessages = vi
			.fn()
			.mockRejectedValueOnce(persistError)
			.mockResolvedValue(undefined);
		const logger: BasicLogger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		};
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-iteration-end.json",
				messagesPath: "/tmp/messages-iteration-end.json",
				manifest,
			}),
			persistSessionMessages,
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		let subscribedHandler: ((event: AgentRuntimeEvent) => void) | undefined;
		const run = vi.fn(async () => {
			subscribedHandler?.({ type: "iteration_end", iteration: 1 } as never);
			// Let the fire-and-forget persist settle before the run returns.
			await new Promise((resolve) => setImmediate(resolve));
			return createResult();
		});
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockImplementation((handler) => {
						subscribedHandler = handler as (event: AgentRuntimeEvent) => void;
						return () => {};
					}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		const started = await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId, logger }),
				prompt: "hello",
				interactive: false,
			}),
		);

		expect(started.result?.finishReason).toBe("completed");
		expect(logger.error).toHaveBeenCalledWith(
			"Failed to persist session messages from agent event",
			{ sessionId, error: persistError },
		);
	});

	it("does not fail a completed run when shutdown cleanup throws", async () => {
		const sessionId = "sess-cleanup-errors";
		const manifest = createManifest(sessionId);
		const createRootSessionWithArtifacts = vi.fn().mockResolvedValue({
			manifestPath: "/tmp/manifest-cleanup-errors.json",
			messagesPath: "/tmp/messages-cleanup-errors.json",
			manifest,
		});
		const persistSessionMessages = vi.fn();
		const updateSessionStatus = vi
			.fn()
			.mockRejectedValue(new Error("status write failed"));
		const writeSessionManifest = vi.fn();
		const listSessions = vi.fn().mockResolvedValue([]);
		const deleteSession = vi.fn().mockResolvedValue({ deleted: true });
		const logger: BasicLogger = { debug: vi.fn(), log: vi.fn() };
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts,
			persistSessionMessages,
			updateSessionStatus,
			writeSessionManifest,
			listSessions,
			deleteSession,
		};

		const shutdown = vi
			.fn()
			.mockRejectedValue(new Error("runtime shutdown failed"));
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown,
				logger,
			}),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn(),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			shutdown: vi.fn().mockRejectedValue(new Error("agent shutdown failed")),
			getMessages: vi.fn().mockReturnValue([]),
			messages: [],
		};

		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () => agent as never,
		});

		const started = await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId, logger }),
				prompt: "hello",
				interactive: false,
			}),
		);

		expect(started.result?.finishReason).toBe("completed");
		expect(updateSessionStatus).toHaveBeenCalledWith(sessionId, "completed", 0);
		// `SessionRuntime.shutdown(reason?, timeoutMs?)` forwards the
		// reason string into the `session_shutdown` hook payload, so
		// host-level hook-file handlers can route on it (e.g.
		// `isAbortReason(ctx.reason)` in `hook-file-hooks.ts`).
		// The transport-level `session.runtime.shutdown(reason)` on
		// the next line also receives the same reason.
		expect(agent.shutdown).toHaveBeenCalledWith("session_complete");
		expect(shutdown).toHaveBeenCalledWith("session_complete");
		expect(logger.log).toHaveBeenCalledWith(
			"Session shutdown cleanup failed",
			expect.objectContaining({
				sessionId,
				stage: "update_status",
				severity: "warn",
			}),
		);
		expect(logger.log).toHaveBeenCalledWith(
			"Session shutdown cleanup failed",
			expect.objectContaining({
				sessionId,
				stage: "agent_shutdown",
				severity: "warn",
			}),
		);
		expect(logger.log).toHaveBeenCalledWith(
			"Session shutdown cleanup failed",
			expect.objectContaining({
				sessionId,
				stage: "runtime_shutdown",
				severity: "warn",
			}),
		);
	});

	it("preserves manifest metadata updates and persists total cost", async () => {
		const sessionId = "sess-history-meta";
		let storedManifest: SessionManifest = {
			...createManifest(sessionId),
			metadata: {
				checkpoint: {
					latest: {
						ref: "abc123",
						createdAt: 1,
						runCount: 1,
					},
					history: [
						{
							ref: "abc123",
							createdAt: 1,
							runCount: 1,
						},
					],
				},
			},
		};
		const createRootSessionWithArtifacts = vi.fn().mockResolvedValue({
			manifestPath: "/tmp/manifest-history-meta.json",
			messagesPath: "/tmp/messages-history-meta.json",
			manifest: { ...storedManifest },
		});
		const persistSessionMessages = vi.fn();
		const updateSession = vi.fn().mockImplementation(async (input) => {
			storedManifest = {
				...storedManifest,
				metadata: input.metadata,
			};
			return { updated: true };
		});
		const updateSessionStatus = vi.fn().mockResolvedValue({
			updated: true,
			endedAt: "2026-01-01T00:00:05.000Z",
		});
		const readSessionManifest = vi
			.fn()
			.mockImplementation(() => storedManifest);
		const writeSessionManifest = vi
			.fn()
			.mockImplementation((_path, manifest) => {
				storedManifest = manifest;
			});
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts,
			persistSessionMessages,
			updateSession,
			updateSessionStatus,
			readSessionManifest,
			writeSessionManifest,
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};

		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(
				createResult({
					usage: {
						inputTokens: 3,
						outputTokens: 4,
						totalCost: 0.42,
					},
					messages: [
						{ role: "user", content: [{ type: "text", text: "hello" }] },
					],
				}),
			),
			continue: vi.fn(),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			messages: [],
		};

		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				prompt: "hello",
				interactive: false,
			}),
		);

		expect(updateSession).toHaveBeenCalledWith({
			sessionId,
			metadata: {
				checkpoint: {
					latest: {
						ref: "abc123",
						createdAt: 1,
						runCount: 1,
					},
					history: [
						{
							ref: "abc123",
							createdAt: 1,
							runCount: 1,
						},
					],
				},
				totalCost: 0.42,
				aggregatedAgentsCost: 0.42,
				usage: {
					inputTokens: 3,
					outputTokens: 4,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0.42,
				},
				aggregateUsage: {
					inputTokens: 3,
					outputTokens: 4,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0.42,
				},
			},
		});
		expect(writeSessionManifest).toHaveBeenCalledWith(
			"/tmp/manifest-history-meta.json",
			expect.objectContaining({
				metadata: {
					checkpoint: {
						latest: {
							ref: "abc123",
							createdAt: 1,
							runCount: 1,
						},
						history: [
							{
								ref: "abc123",
								createdAt: 1,
								runCount: 1,
							},
						],
					},
					totalCost: 0.42,
					aggregatedAgentsCost: 0.42,
					usage: {
						inputTokens: 3,
						outputTokens: 4,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						totalCost: 0.42,
					},
					aggregateUsage: {
						inputTokens: 3,
						outputTokens: 4,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						totalCost: 0.42,
					},
				},
				status: "completed",
			}),
		);
	});

	it("persists assistant message metadata for usage and model identity", async () => {
		const sessionId = "sess-meta";
		const manifest = createManifest(sessionId);
		const persistSessionMessages = vi.fn();
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-meta.json",
				messagesPath: "/tmp/messages-meta.json",
				manifest,
			}),
			persistSessionMessages,
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const updateConnectionDefaults = vi.fn();
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				delegatedAgentConfigProvider: {
					getRuntimeConfig: vi.fn(),
					getConnectionConfig: vi.fn(),
					updateConnectionDefaults,
				},
				shutdown: vi.fn(),
			}),
		};
		const run = vi.fn().mockResolvedValue(
			createResult({
				usage: {
					inputTokens: 33,
					outputTokens: 12,
					cacheReadTokens: 4,
					cacheWriteTokens: 1,
					totalCost: 0.42,
				},
				model: {
					id: "claude-sonnet-4-6",
					provider: "anthropic",
					info: {
						id: "claude-sonnet-4-6",
						family: "claude-sonnet-4",
					},
				},
				endedAt: new Date("2026-01-01T00:00:02.000Z"),
				messages: [
					{ role: "user", content: [{ type: "text", text: "hello" }] },
					{ role: "assistant", content: [{ type: "text", text: "world" }] },
				],
			}),
		);
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({
					sessionId,
					providerId: "anthropic",
					modelId: "claude-sonnet-4-6",
				}),
				prompt: "hello",
				interactive: false,
			}),
		);

		expect(persistSessionMessages).toHaveBeenCalledTimes(1);
		const persisted = persistSessionMessages.mock.calls[0]?.[1];
		expect(Array.isArray(persisted)).toBe(true);
		expect(persisted?.[1]).toMatchObject({
			role: "assistant",
			modelInfo: {
				id: "claude-sonnet-4-6",
				provider: "anthropic",
				family: "claude-sonnet-4",
			},
			metrics: {
				inputTokens: 33,
				outputTokens: 12,
				cacheReadTokens: 4,
				cacheWriteTokens: 1,
				cost: 0.42,
			},
			ts: new Date("2026-01-01T00:00:02.000Z").getTime(),
		});
	});

	it("drains queued prompts after a turn that self-aborts (loop detector / mistake limit)", async () => {
		const sessionId = "sess-self-abort-drains-prompts";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
				messagesPath: "/tmp/messages.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({
				updated: true,
				endedAt: "2026-01-01T00:00:05.000Z",
			}),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		let activeRun = false;
		let finishRun: (() => void) | undefined;
		let markRunStarted: (() => void) | undefined;
		const runStarted = new Promise<void>((resolve) => {
			markRunStarted = resolve;
		});
		const sentPrompts: string[] = [];
		const run = vi.fn().mockImplementation((prompt: string) => {
			sentPrompts.push(prompt);
			activeRun = true;
			markRunStarted?.();
			return new Promise<AgentResult>((resolve) => {
				// The run resolves with finishReason "aborted" without
				// manager.abort() ever being called — this is how an internal
				// safety stop (loop detector / mistake limit) ends a run.
				finishRun = () => {
					activeRun = false;
					resolve(createResult({ finishReason: "aborted" }));
				};
			});
		});
		const continueTurn = vi.fn().mockImplementation((prompt: string) => {
			sentPrompts.push(prompt);
			return Promise.resolve(createResult({ text: "drained result" }));
		});
		const agent = {
			run,
			continue: continueTurn,
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			canStartRun: vi.fn(() => !activeRun),
		};

		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);

		const firstTurn = manager.runTurn({ sessionId, prompt: "slow" });
		await runStarted;
		await manager.runTurn({
			sessionId,
			prompt: "queued prompt",
			delivery: "queue",
		});
		expect(
			(await manager.pendingPrompts.list({ sessionId })).map((prompt) => ({
				prompt: prompt.prompt,
				delivery: prompt.delivery,
			})),
		).toEqual([{ prompt: "queued prompt", delivery: "queue" }]);

		finishRun?.();
		await expect(firstTurn).resolves.toMatchObject({
			finishReason: "aborted",
		});

		await vi.waitFor(async () => {
			expect(sentPrompts.slice(1)).toEqual([
				'<user_input mode="act">queued prompt</user_input>',
			]);
			expect(await manager.pendingPrompts.list({ sessionId })).toEqual([]);
		});
	});

	it("stops draining when a drained prompt's turn finishes with error", async () => {
		const sessionId = "sess-drain-stops-on-error";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
				messagesPath: "/tmp/messages.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({
				updated: true,
				endedAt: "2026-01-01T00:00:05.000Z",
			}),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		let activeRun = false;
		let finishRun: (() => void) | undefined;
		let markRunStarted: (() => void) | undefined;
		const runStarted = new Promise<void>((resolve) => {
			markRunStarted = resolve;
		});
		const sentPrompts: string[] = [];
		const run = vi.fn().mockImplementation((prompt: string) => {
			sentPrompts.push(prompt);
			activeRun = true;
			markRunStarted?.();
			return new Promise<AgentResult>((resolve) => {
				finishRun = () => {
					activeRun = false;
					resolve(createResult());
				};
			});
		});
		// The drained prompt's turn resolves with an error finish; the
		// remaining queued prompt must be held instead of drained next.
		const continueTurn = vi.fn().mockImplementation((prompt: string) => {
			sentPrompts.push(prompt);
			return Promise.resolve(createResult({ finishReason: "error" }));
		});
		const agent = {
			run,
			continue: continueTurn,
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			canStartRun: vi.fn(() => !activeRun),
		};

		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);

		const firstTurn = manager.runTurn({ sessionId, prompt: "slow" });
		await runStarted;
		await manager.runTurn({
			sessionId,
			prompt: "first queued",
			delivery: "queue",
		});
		await manager.runTurn({
			sessionId,
			prompt: "second queued",
			delivery: "queue",
		});

		finishRun?.();
		await expect(firstTurn).resolves.toMatchObject({
			finishReason: "completed",
		});

		// The first queued prompt drains and errors; the second must be held.
		await vi.waitFor(() => {
			expect(sentPrompts).toHaveLength(2);
			expect(sentPrompts[1]).toContain("first queued");
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(sentPrompts).toHaveLength(2);
		expect(
			(await manager.pendingPrompts.list({ sessionId })).map((prompt) => ({
				prompt: prompt.prompt,
				delivery: prompt.delivery,
			})),
		).toEqual([{ prompt: "second queued", delivery: "queue" }]);
	});

	it("starts interactive sessions without a prompt as idle until their first turn", async () => {
		const sessionId = "sess-idle-until-first-turn";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
				messagesPath: "/tmp/messages.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({ tools: [], shutdown: vi.fn() }),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-idle-1"),
			getConversationId: vi.fn().mockReturnValue("conv-idle-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});
		const events: unknown[] = [];
		manager.subscribe((event) => events.push(event));

		// The desktop host starts interactive sessions without a prompt and
		// dispatches turns through separate send calls. Reporting such a
		// session as "running" wedged clients that gate workspace operations
		// (e.g. checkpoint restores) on active turns.
		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);

		await expect(manager.getSession(sessionId)).resolves.toMatchObject({
			sessionId,
			status: "idle",
		});
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "status",
				payload: { sessionId, status: "idle" },
			}),
		);
		expect(events).not.toContainEqual(
			expect.objectContaining({
				type: "status",
				payload: { sessionId, status: "running" },
			}),
		);

		// The first turn still transitions through running and back to idle.
		await manager.runTurn({ sessionId, prompt: "first turn" });
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "status",
				payload: { sessionId, status: "running" },
			}),
		);
		await expect(manager.getSession(sessionId)).resolves.toMatchObject({
			sessionId,
			status: "idle",
		});
	});

	it.each([
		{
			name: "replacement",
			updates: { metadata: { custom: { status: "complete" } } },
			updated: true,
		},
		{ name: "clear", updates: { metadata: null }, updated: true },
		{
			name: "clear all",
			updates: { metadata: null, title: null },
			updated: true,
		},
		{ name: "missing manifest", updates: { metadata: null }, updated: true },
		{ name: "invalid manifest", updates: { metadata: null }, updated: true },
		{ name: "failed save", updates: { metadata: null }, updated: false },
		{ name: "rename", updates: { title: "Renamed session" }, updated: true },
		{ name: "derived title", updates: { prompt: "New prompt" }, updated: true },
	])("keeps active metadata consistent with persistence after $name", async ({
		name,
		updates,
		updated,
	}) => {
		const sessionId = "sess-active-metadata-update";
		const sessionService = new FileSessionService(
			join(isolatedHomeDir, "sessions"),
		);
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService,
			runtimeBuilder: {
				build: () => ({ tools: [], shutdown: () => {} }),
			} as never,
			createAgent: () =>
				({
					run: async () => createResult(),
					getMessages: () => [],
					getAgentId: () => "agent-active-metadata",
					getConversationId: () => "conv-active-metadata",
					subscribeEvents: () => () => {},
					canStartRun: () => true,
					shutdown: async () => {},
				}) as never,
		});
		try {
			const { manifestPath } = await manager.startSession(
				normalizeStartInput({
					config: createConfig({
						sessionId,
						cwd: isolatedHomeDir,
						workspaceRoot: isolatedHomeDir,
					}),
					prompt: "Named session",
					interactive: true,
					sessionMetadata: { title: "Named session", before: true },
				}),
			);
			if (updates.prompt) {
				await manager.updateSession(sessionId, {
					metadata: { before: true },
					title: null,
				});
				expect(
					(await manager.getSession(sessionId))?.metadata?.title,
				).toBeUndefined();
			}
			const before = (await manager.getSession(sessionId))?.metadata;
			const missingManifest =
				name === "missing manifest" || name === "invalid manifest";
			if (name === "missing manifest") rmSync(manifestPath);
			if (name === "invalid manifest")
				writeFileSync(manifestPath, "invalid JSON");
			if (!updated)
				vi.spyOn(sessionService, "updateSession").mockResolvedValueOnce({
					updated: false,
				});
			const readManifest = vi.spyOn(sessionService, "readSessionManifest");
			await expect(manager.updateSession(sessionId, updates)).resolves.toEqual({
				updated,
			});
			expect(readManifest).not.toHaveBeenCalled();
			const expected =
				name === "clear all"
					? undefined
					: updated && !missingManifest
						? {
								...(updates.metadata !== undefined ? updates.metadata : before),
								title: updates.title ?? updates.prompt ?? "Named session",
							}
						: before;
			expect(sessionService.readSessionManifest(sessionId)?.metadata).toEqual(
				missingManifest ? undefined : expected,
			);
			expect((await manager.getSession(sessionId))?.metadata).toEqual(expected);
			if (updates.metadata?.custom) {
				updates.metadata.custom.status = "mutated after save";
				expect((await manager.getSession(sessionId))?.metadata?.custom).toEqual(
					{ status: "complete" },
				);
			}
		} finally {
			await manager.dispose();
		}
	});

	it("aborts a turn whose Stop arrived while the turn was still being prepared", async () => {
		const sessionId = "sess-abort-during-prep";
		const manifest = createManifest(sessionId);
		let releaseStatusUpdate: (() => void) | undefined;
		const statusUpdateStarted = new Promise<void>((resolve) => {
			releaseStatusUpdate = resolve;
		});
		let finishStatusUpdate: (() => void) | undefined;
		const statusUpdateGate = new Promise<void>((resolve) => {
			finishStatusUpdate = resolve;
		});
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
				messagesPath: "/tmp/messages.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			// markTurnRunning is the last preparation step before the agent run;
			// hold it open so the abort lands while no run exists yet.
			updateSessionStatus: vi.fn(async (_id: string, status: string) => {
				if (status === "running") {
					releaseStatusUpdate?.();
					await statusUpdateGate;
				}
				return { updated: true };
			}),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({ tools: [], shutdown: vi.fn() }),
		};
		let activeRun = false;
		let abortedAfterRunStarted = false;
		const run = vi.fn(async () => {
			activeRun = true;
			// Mirrors SessionRuntime: an abort requested once the run exists ends
			// it as "aborted" before any model call.
			await Promise.resolve();
			activeRun = false;
			return createResult({
				text: "",
				finishReason: abortedAfterRunStarted ? "aborted" : "completed",
				messages: [{ role: "user", content: "stop me" }],
			});
		});
		const agent = {
			run,
			continue: run,
			abort: vi.fn(() => {
				if (activeRun) abortedAfterRunStarted = true;
			}),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn(() => []),
			canStartRun: vi.fn(() => !activeRun),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});

		try {
			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ sessionId }),
					interactive: true,
				}),
			);
			// A Stop between turns targets a run that already ended and must not
			// leak into the next turn.
			await manager.abort(sessionId, new Error("stale abort"));

			const turn = manager.runTurn({ sessionId, prompt: "stop me" });
			await statusUpdateStarted;
			expect(run).not.toHaveBeenCalled();
			await manager.abort(sessionId, new Error("user cancelled"));
			finishStatusUpdate?.();

			await expect(turn).resolves.toMatchObject({ finishReason: "aborted" });
			expect(run).toHaveBeenCalledTimes(1);
			// The first abort had no run to cancel; the host re-issued it once
			// the run existed.
			expect(agent.abort).toHaveBeenCalledTimes(3);
			expect(agent.abort.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
				run.mock.invocationCallOrder[0] ?? 0,
			);
			await expect(manager.getSession(sessionId)).resolves.toMatchObject({
				status: "idle",
			});

			// The stale abort alone must not abort a later turn.
			abortedAfterRunStarted = false;
			await expect(
				manager.runTurn({ sessionId, prompt: "next" }),
			).resolves.toMatchObject({ finishReason: "completed" });
			expect(run).toHaveBeenCalledTimes(2);
			expect(agent.abort).toHaveBeenCalledTimes(3);
		} finally {
			await manager.dispose();
		}
	});

	it("persists rendered messages when a turn fails", async () => {
		const sessionId = "sess-failed-turn";
		const manifest = createManifest(sessionId);
		const persistSessionMessages = vi.fn();
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-failed-turn.json",
				messagesPath: "/tmp/messages-failed-turn.json",
				manifest,
			}),
			persistSessionMessages,
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		const renderedMessages = [
			{ role: "user", content: [{ type: "text", text: "hello" }] },
			{ role: "assistant", content: [{ type: "text", text: "partial" }] },
		];
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run: vi.fn().mockRejectedValue(new Error("boom")),
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					restore: vi.fn(),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi
						.fn()
						.mockReturnValueOnce([])
						.mockReturnValue(renderedMessages),
					messages: [],
				}) as never,
		});

		await expect(
			manager.startSession(
				normalizeStartInput({
					config: createConfig({ sessionId }),
					prompt: "hello",
					interactive: false,
				}),
			),
		).rejects.toThrow("boom");

		expect(persistSessionMessages).toHaveBeenCalledTimes(1);
		expect(persistSessionMessages).toHaveBeenCalledWith(
			sessionId,
			renderedMessages,
			"You are a test agent",
		);
		expect(sessionService.updateSessionStatus).toHaveBeenCalledWith(
			sessionId,
			"failed",
			1,
		);
	});

	it("does not synthesize assistant usage metadata when a turn fails before assistant output", async () => {
		const sessionId = "sess-failed-before-assistant";
		const manifest = createManifest(sessionId);
		const persistSessionMessages = vi.fn();
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-failed-before-assistant.json",
				messagesPath: "/tmp/messages-failed-before-assistant.json",
				manifest,
			}),
			persistSessionMessages,
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		const userOnlyMessages = [
			{ role: "user", content: [{ type: "text", text: "hello" }] },
		];
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run: vi.fn().mockRejectedValue(new Error("boom")),
					continue: vi.fn(),
					abort: vi.fn(),
					restore: vi.fn(),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi
						.fn()
						.mockReturnValueOnce([])
						.mockReturnValue(userOnlyMessages),
					subscribeEvents: vi.fn(),
					getAgentId: vi.fn().mockReturnValue("agent-test"),
					getConversationId: vi.fn().mockReturnValue("conv-test"),
					messages: [],
				}) as never,
		});

		await expect(
			manager.startSession(
				normalizeStartInput({
					config: createConfig({ sessionId }),
					prompt: "hello",
					interactive: false,
				}),
			),
		).rejects.toThrow("boom");

		expect(persistSessionMessages).toHaveBeenCalledTimes(1);
		expect(persistSessionMessages).toHaveBeenCalledWith(
			sessionId,
			userOnlyMessages,
			"You are a test agent",
		);
		const persisted = persistSessionMessages.mock.calls[0]?.[1] as Array<{
			role?: string;
			metrics?: unknown;
			modelInfo?: unknown;
		}>;
		expect(persisted).toHaveLength(1);
		expect(persisted[0]?.role).toBe("user");
		expect(persisted[0]).not.toHaveProperty("metrics");
		expect(persisted[0]).not.toHaveProperty("modelInfo");
	});

	it("uses run for first send then continue for subsequent sends", async () => {
		const sessionId = "sess-2";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-2.json",
				messagesPath: "/tmp/messages-2.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			updateSession: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		const run = vi.fn().mockResolvedValue(createResult({ text: "first" }));
		const continueFn = vi
			.fn()
			.mockResolvedValue(createResult({ text: "second" }));
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: continueFn,
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);
		const first = await manager.runTurn({ sessionId, prompt: "first" });
		const second = await manager.runTurn({
			sessionId,
			prompt: "second",
			mode: "plan",
		});

		expect(first?.text).toBe("first");
		expect(second?.text).toBe("second");
		expect(run).toHaveBeenCalledTimes(1);
		expect(continueFn).toHaveBeenCalledTimes(1);
		expect(run).toHaveBeenCalledWith(
			'<user_input mode="act">first</user_input>',
			undefined,
			undefined,
		);
		expect(continueFn).toHaveBeenCalledWith(
			'<user_input mode="plan">second</user_input>',
			undefined,
			undefined,
		);
		expect(sessionService.persistSessionMessages).toHaveBeenCalledTimes(2);
	});

	it("tracks accumulated usage per session across turns", async () => {
		const sessionId = "sess-usage";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-usage.json",
				messagesPath: "/tmp/messages-usage.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			updateSession: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		const run = vi.fn().mockResolvedValue(
			createResult({
				text: "first",
				usage: {
					inputTokens: 10,
					outputTokens: 3,
					cacheReadTokens: 1,
					cacheWriteTokens: 2,
					totalCost: 0.11,
				},
			}),
		);
		const continueFn = vi.fn().mockResolvedValue(
			createResult({
				text: "second",
				usage: {
					inputTokens: 8,
					outputTokens: 4,
					cacheReadTokens: 2,
					cacheWriteTokens: 0,
					totalCost: 0.09,
				},
			}),
		);
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: continueFn,
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);

		await manager.runTurn({ sessionId, prompt: "first" });
		expect((await manager.getAccumulatedUsage(sessionId))?.usage).toEqual({
			inputTokens: 10,
			outputTokens: 3,
			cacheReadTokens: 1,
			cacheWriteTokens: 2,
			totalCost: 0.11,
		});

		await manager.runTurn({ sessionId, prompt: "second" });
		expect((await manager.getAccumulatedUsage(sessionId))?.usage).toEqual({
			inputTokens: 18,
			outputTokens: 7,
			cacheReadTokens: 3,
			cacheWriteTokens: 2,
			totalCost: 0.2,
		});
	});

	it("auto-queues sends to a running interactive session", async () => {
		const sessionId = "sess-auto-queue";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-auto-queue.json",
				messagesPath: "/tmp/messages-auto-queue.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		let canStartRun = false;
		const run = vi.fn().mockResolvedValue(createResult({ text: "first" }));
		const continueFn = vi
			.fn()
			.mockResolvedValue(createResult({ text: "next" }));
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: continueFn,
					canStartRun: vi.fn(() => canStartRun),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});
		const events: Array<unknown> = [];
		manager.subscribe((event) => {
			events.push(event);
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);

		await expect(
			manager.runTurn({ sessionId, prompt: "queued implicitly" }),
		).resolves.toBeUndefined();

		expect(run).not.toHaveBeenCalled();
		expect(continueFn).not.toHaveBeenCalled();
		const promptSnapshots = events
			.filter((event) => {
				return (
					typeof event === "object" &&
					event !== null &&
					"type" in event &&
					event.type === "pending_prompts"
				);
			})
			.map((event) => (event as { payload: { prompts: unknown[] } }).payload);
		expect(promptSnapshots.at(-1)).toEqual({
			prompts: [
				expect.objectContaining({
					prompt: "queued implicitly",
					delivery: "queue",
					attachmentCount: 0,
				}),
			],
			sessionId,
		});

		canStartRun = true;
		await manager.runTurn({ sessionId, prompt: "run now" });

		expect(run).toHaveBeenCalledTimes(1);
		expect(
			events.some((event) => {
				return (
					typeof event === "object" &&
					event !== null &&
					"type" in event &&
					event.type === "pending_prompt_submitted" &&
					"payload" in event &&
					(event.payload as { prompt?: string; delivery?: string }).prompt ===
						"queued implicitly" &&
					(event.payload as { delivery?: string }).delivery === "queue"
				);
			}),
		).toBe(true);
	});

	it("returns undefined accumulated usage for unknown sessions", async () => {
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: {
				ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
				listSessions: vi.fn().mockResolvedValue([]),
				deleteSession: vi.fn().mockResolvedValue({ deleted: false }),
			} as never,
			runtimeBuilder: {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			},
			createAgent: () =>
				({
					run: vi.fn(),
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		expect(
			await manager.getAccumulatedUsage("missing-session"),
		).toBeUndefined();
	});

	it("marks a failed single-run session as failed when run throws", async () => {
		const sessionId = "sess-fail";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-fail.json",
				messagesPath: "/tmp/messages-fail.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeShutdown = vi.fn();
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: runtimeShutdown,
			}),
		};
		const run = vi.fn().mockRejectedValue(new Error("run failed"));
		const agentShutdown = vi.fn().mockResolvedValue(undefined);
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: agentShutdown,
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await expect(
			manager.startSession(
				normalizeStartInput({
					config: createConfig({ sessionId }),
					prompt: "hello",
					interactive: false,
				}),
			),
		).rejects.toThrow("run failed");
		expect(sessionService.updateSessionStatus).toHaveBeenCalledWith(
			sessionId,
			"failed",
			1,
		);
		expect(agentShutdown).toHaveBeenCalledTimes(1);
		expect(runtimeShutdown).toHaveBeenCalledTimes(1);
	});

	it("does not mask the run error when the failure-path transcript flush also fails", async () => {
		const sessionId = "sess-fail-persist";
		const manifest = createManifest(sessionId);
		const persistError = new Error("persist failed");
		const persistSessionMessages = vi.fn().mockRejectedValue(persistError);
		const logger: BasicLogger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		};
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-fail-persist.json",
				messagesPath: "/tmp/messages-fail-persist.json",
				manifest,
			}),
			persistSessionMessages,
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		const run = vi.fn().mockRejectedValue(new Error("run failed"));
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await expect(
			manager.startSession(
				normalizeStartInput({
					config: createConfig({ sessionId, logger }),
					prompt: "hello",
					interactive: false,
				}),
			),
		).rejects.toThrow("run failed");
		expect(persistSessionMessages).toHaveBeenCalled();
		expect(logger.error).toHaveBeenCalledWith(
			"Failed to persist session messages after turn error",
			{ sessionId, error: persistError },
		);
	});

	it("marks a single-run error result as failed", async () => {
		const sessionId = "sess-error-result";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-error-result.json",
				messagesPath: "/tmp/messages-error-result.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const run = vi.fn().mockResolvedValue(
			createResult({
				finishReason: "error",
				text: "",
			}),
		);
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			},
			createAgent: () =>
				({
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		const started = await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				prompt: "hello",
				interactive: false,
			}),
		);

		expect(started.result?.finishReason).toBe("error");
		expect(sessionService.updateSessionStatus).toHaveBeenCalledWith(
			sessionId,
			"failed",
			1,
		);
	});

	it("does not persist or emit shutdown hooks when no prompt was submitted", async () => {
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn(),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn(),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeShutdown = vi.fn();
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: runtimeShutdown,
			}),
		};
		const agentShutdown = vi.fn().mockResolvedValue(undefined);
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run: vi.fn(),
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: agentShutdown,
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		const started = await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId: "sess-no-prompt" }),
				interactive: true,
			}),
		);
		await manager.stopSession(started.sessionId);

		expect(
			sessionService.createRootSessionWithArtifacts,
		).not.toHaveBeenCalled();
		expect(sessionService.updateSessionStatus).not.toHaveBeenCalled();
		expect(agentShutdown).toHaveBeenCalledWith("session_stop");
		expect(runtimeShutdown).toHaveBeenCalledTimes(1);
	});

	it("forwards loopDetection config to the agent constructor", async () => {
		const sessionId = "sess-loop-detection";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-loop.json",
				messagesPath: "/tmp/messages-loop.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const run = vi.fn().mockResolvedValue(createResult());
		const createAgent = vi.fn().mockReturnValue({
			run,
			continue: vi.fn(),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			restore: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			messages: [],
		});
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			},
			createAgent: createAgent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({
					sessionId,
					execution: {
						loopDetection: { softThreshold: 4, hardThreshold: 8 },
					},
				}),
				interactive: true,
			}),
		);
		await manager.runTurn({ sessionId, prompt: "test" });

		expect(createAgent).toHaveBeenCalledWith(
			expect.objectContaining({
				execution: {
					loopDetection: { softThreshold: 4, hardThreshold: 8 },
				},
			}),
		);
	});

	it("injects a core-owned compaction prepareTurn callback into the agent constructor", async () => {
		const sessionId = "sess-compaction";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-compaction.json",
				messagesPath: "/tmp/messages-compaction.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const run = vi.fn().mockResolvedValue(createResult());
		const createAgent = vi.fn().mockReturnValue({
			run,
			continue: vi.fn(),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			restore: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			messages: [],
		});
		const compact = vi.fn();
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			},
			createAgent: createAgent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({
					sessionId,
					compaction: {
						enabled: true,
						strategy: "basic",
						compact,
					},
				}),
				interactive: true,
			}),
		);
		await manager.runTurn({ sessionId, prompt: "test" });

		expect(createAgent).toHaveBeenCalledWith(
			expect.objectContaining({
				prepareTurn: expect.any(Function),
			}),
		);
	});

	// Manual /compact persists a sidecar regardless of the auto-compaction
	// setting, so the projection must stay wired even when compaction is
	// disabled — otherwise a manual compaction would silently never reach the
	// model. Without a sidecar the prepareTurn is a no-op.

	// An imported transcript carries another agent's tool calls, so the first
	// resumed turn summarizes it into the compaction sidecar even with
	// auto-compaction off. It runs once; later turns project the sidecar.

	it("orders equal-length compaction updates by parsed timestamp", async () => {
		const sessionId = "inactive-session";
		const tempCwd = mkdtempSync(join(tmpdir(), "compaction-stale-"));
		try {
			const messagesPath = join(tempCwd, "messages.json");
			const sourceMessages: MessageWithMetadata[] = [
				{ role: "user", content: "source" },
			];
			writeFileSync(messagesPath, JSON.stringify(sourceMessages), "utf8");
			const current = createSessionCompactionState({
				sourceMessages,
				compactedMessages: [{ role: "user", content: "current" }],
				conversationId: sessionId,
				updatedAt: "2026-01-01T00:00:00.500Z",
			});
			const incoming = createSessionCompactionState({
				sourceMessages,
				compactedMessages: [{ role: "user", content: "incoming" }],
				conversationId: sessionId,
				updatedAt: "2026-01-01T00:00:00Z",
			});
			const sessionService = {
				ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
				listSessions: vi.fn().mockResolvedValue([
					{
						sessionId,
						provider: "mock-provider",
						model: "mock-model",
						cwd: "/tmp/project",
						workspaceRoot: "/tmp/project",
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-01T00:00:00.000Z",
						status: "running",
						messagesPath,
					},
				]),
				readSessionCompactionState: vi.fn().mockResolvedValue(current),
				persistSessionCompactionState: vi.fn(),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
			});

			await expect(
				manager.updateSessionCompactionState(sessionId, incoming),
			).resolves.toEqual({ updated: false });
			expect(
				sessionService.persistSessionCompactionState,
			).not.toHaveBeenCalled();
		} finally {
			rmSync(tempCwd, { recursive: true, force: true });
		}
	});

	it("force refreshes and retries once when turn fails with auth error", async () => {
		const sessionId = "sess-oauth-retry";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-oauth-retry.json",
				messagesPath: "/tmp/messages-oauth-retry.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const updateConnectionDefaults = vi.fn();
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				delegatedAgentConfigProvider: {
					getRuntimeConfig: vi.fn(),
					getConnectionConfig: vi.fn(),
					updateConnectionDefaults,
				},
				shutdown: vi.fn(),
			}),
		};
		const run = vi
			.fn()
			.mockRejectedValueOnce(new Error("401 Unauthorized"))
			.mockResolvedValueOnce(
				createResult({
					text: "retried",
					usage: {
						inputTokens: 9,
						outputTokens: 4,
						cacheReadTokens: 2,
						cacheWriteTokens: 1,
						totalCost: 0.11,
					},
					model: {
						id: "claude-sonnet-4-6",
						provider: "anthropic",
						info: {
							id: "claude-sonnet-4-6",
							family: "claude-sonnet-4",
						},
					},
					messages: [
						{ role: "user", content: [{ type: "text", text: "hello" }] },
						{ role: "assistant", content: [{ type: "text", text: "retried" }] },
					],
				}),
			);
		const restore = vi.fn();
		const updateConnection = vi.fn();
		const resolveProviderApiKey = vi
			.fn()
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({
				apiKey: "oauth-access-new",
				refreshed: true,
			});
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			oauthTokenManager: {
				resolveProviderApiKey,
			} as never,
			createAgent: () =>
				({
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					restore,
					updateConnection,
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({
					sessionId,
					providerId: "openai-codex",
					apiKey: "oauth-access-old",
				}),
				interactive: true,
			}),
		);
		const result = await manager.runTurn({ sessionId, prompt: "hello" });

		expect(result?.text).toBe("retried");
		expect(run).toHaveBeenCalledTimes(2);
		expect(restore).toHaveBeenCalledTimes(1);
		expect(resolveProviderApiKey).toHaveBeenNthCalledWith(1, {
			providerId: "openai-codex",
			forceRefresh: undefined,
		});
		expect(resolveProviderApiKey).toHaveBeenNthCalledWith(2, {
			providerId: "openai-codex",
			forceRefresh: true,
		});
		expect(updateConnection).toHaveBeenCalledWith({
			apiKey: "oauth-access-new",
		});
		expect(updateConnectionDefaults).toHaveBeenCalledWith({
			apiKey: "oauth-access-new",
		});
		expect(sessionService.persistSessionMessages).toHaveBeenCalledTimes(1);
		const persisted = (
			sessionService.persistSessionMessages as ReturnType<typeof vi.fn>
		).mock.calls[0]?.[1] as Array<Record<string, unknown>> | undefined;
		expect(persisted?.[1]).toMatchObject({
			role: "assistant",
			modelInfo: {
				id: "claude-sonnet-4-6",
				provider: "anthropic",
				family: "claude-sonnet-4",
			},
			metrics: {
				inputTokens: 9,
				outputTokens: 4,
				cacheReadTokens: 2,
				cacheWriteTokens: 1,
				cost: 0.11,
			},
		});
	});

	describe("task.completed telemetry anchoring", () => {
		function createTaskCompletedAdapter() {
			return {
				name: "task-completed-test",
				emit: vi.fn(),
				emitRequired: vi.fn(),
				recordCounter: vi.fn(),
				recordHistogram: vi.fn(),
				recordGauge: vi.fn(),
				isEnabled: vi.fn(() => true),
				flush: vi.fn().mockResolvedValue(undefined),
				dispose: vi.fn().mockResolvedValue(undefined),
			};
		}

		function createSubmitAndExitToolCall(): NonNullable<
			AgentResult["toolCalls"]
		>[number] {
			return {
				id: "call-submit-1",
				name: "submit_and_exit",
				input: { result: "done" },
				output: { ok: true },
				durationMs: 1,
				startedAt: new Date("2026-01-01T00:00:00.500Z"),
				endedAt: new Date("2026-01-01T00:00:00.600Z"),
			};
		}

		function createMockSessionService(manifest: SessionManifest) {
			return {
				ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
				createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
					manifestPath: "/tmp/manifest.json",
					messagesPath: "/tmp/messages.json",
					manifest,
				}),
				persistSessionMessages: vi.fn(),
				updateSessionStatus: vi.fn().mockResolvedValue({
					updated: true,
					endedAt: "2026-01-01T00:00:05.000Z",
				}),
				writeSessionManifest: vi.fn(),
				listSessions: vi.fn().mockResolvedValue([]),
				deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
			};
		}

		function countTaskCompletedEmissions(
			adapter: ReturnType<typeof createTaskCompletedAdapter>,
		): Array<Record<string, unknown>> {
			return adapter.emit.mock.calls
				.filter(([event]) => event === "task.completed")
				.map(([, payload]) => payload as Record<string, unknown>);
		}

		function getActiveSession(
			manager: RuntimeHostUnderTest,
			sessionId: string,
		): { status: string } {
			const sessions = (
				manager as unknown as { sessions: Map<string, { status: string }> }
			).sessions;
			const session = sessions.get(sessionId);
			if (!session) throw new Error("session was not registered");
			return session;
		}

		it("emits task.completed once with source=submit_and_exit when the assistant calls the completion tool in a non-interactive run", async () => {
			const sessionId = "sess-task-completed-submit-non-interactive";
			const manifest = createManifest(sessionId);
			const adapter = createTaskCompletedAdapter();
			const telemetry = new TelemetryService({
				adapters: [adapter],
				distinctId,
			});
			const sessionService = createMockSessionService(manifest);
			const runtimeBuilder = {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			};
			const agent = {
				run: vi.fn().mockResolvedValue(
					createResult({
						toolCalls: [createSubmitAndExitToolCall()],
					}),
				),
				continue: vi.fn(),
				getMessages: vi.fn().mockReturnValue([]),
				getAgentId: vi.fn().mockReturnValue("agent-root-1"),
				getConversationId: vi.fn().mockReturnValue("conv-root-1"),
				abort: vi.fn(),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				canStartRun: vi.fn().mockReturnValue(true),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: runtimeBuilder as never,
				createAgent: () => agent as never,
				telemetry,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ telemetry, sessionId }),
					prompt: "do a thing then submit_and_exit",
					interactive: false,
				}),
			);

			const emissions = countTaskCompletedEmissions(adapter);
			expect(emissions).toHaveLength(1);
			expect(emissions[0]).toMatchObject({
				ulid: sessionId,
				source: "submit_and_exit",
				provider: "mock-provider",
				model: "mock-model",
			});
		});

		it("falls back to source=shutdown when a non-interactive run completes without submit_and_exit", async () => {
			const sessionId = "sess-task-completed-shutdown-fallback";
			const manifest = createManifest(sessionId);
			const adapter = createTaskCompletedAdapter();
			const telemetry = new TelemetryService({
				adapters: [adapter],
				distinctId,
			});
			const sessionService = createMockSessionService(manifest);
			const runtimeBuilder = {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			};
			const agent = {
				// No `submit_and_exit` in toolCalls — represents a non-interactive
				// run that finished cleanly without invoking the completion tool.
				run: vi.fn().mockResolvedValue(createResult({ toolCalls: [] })),
				continue: vi.fn(),
				getMessages: vi.fn().mockReturnValue([]),
				getAgentId: vi.fn().mockReturnValue("agent-root-1"),
				getConversationId: vi.fn().mockReturnValue("conv-root-1"),
				abort: vi.fn(),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				canStartRun: vi.fn().mockReturnValue(true),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: runtimeBuilder as never,
				createAgent: () => agent as never,
				telemetry,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ telemetry, sessionId }),
					prompt: "just finish",
					interactive: false,
				}),
			);

			const emissions = countTaskCompletedEmissions(adapter);
			expect(emissions).toHaveLength(1);
			expect(emissions[0]).toMatchObject({
				ulid: sessionId,
				source: "shutdown",
			});
		});

		it("emits task.completed exactly once when an interactive turn invokes submit_and_exit and is later cancelled", async () => {
			const sessionId = "sess-task-completed-interactive-then-cancel";
			const manifest = createManifest(sessionId);
			const adapter = createTaskCompletedAdapter();
			const telemetry = new TelemetryService({
				adapters: [adapter],
				distinctId,
			});
			const sessionService = createMockSessionService(manifest);
			const runtimeBuilder = {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			};
			const agent = {
				run: vi.fn().mockResolvedValue(
					createResult({
						toolCalls: [createSubmitAndExitToolCall()],
					}),
				),
				continue: vi.fn(),
				getMessages: vi.fn().mockReturnValue([]),
				getAgentId: vi.fn().mockReturnValue("agent-root-1"),
				getConversationId: vi.fn().mockReturnValue("conv-root-1"),
				abort: vi.fn(),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				canStartRun: vi.fn().mockReturnValue(true),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: runtimeBuilder as never,
				createAgent: () => agent as never,
				telemetry,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ telemetry, sessionId }),
					prompt: "complete and remain attached",
					interactive: true,
				}),
			);

			// Simulate the user later closing the interactive session via stop.
			await manager.stopSession(sessionId);

			const emissions = countTaskCompletedEmissions(adapter);
			expect(emissions).toHaveLength(1);
			expect(emissions[0]).toMatchObject({
				ulid: sessionId,
				source: "submit_and_exit",
			});
		});

		it("does not emit a duplicate task.completed when shutdownSession runs after a successful submit_and_exit observation", async () => {
			const sessionId = "sess-task-completed-no-double-fire";
			const manifest = createManifest(sessionId);
			const adapter = createTaskCompletedAdapter();
			const telemetry = new TelemetryService({
				adapters: [adapter],
				distinctId,
			});
			const sessionService = createMockSessionService(manifest);
			const runtimeBuilder = {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			};
			// Non-interactive: executeAgentTurn → finalizeSingleRun → shutdownSession,
			// all in the same `startSession(...)` call. We must see exactly one emission.
			const agent = {
				run: vi.fn().mockResolvedValue(
					createResult({
						toolCalls: [createSubmitAndExitToolCall()],
					}),
				),
				continue: vi.fn(),
				getMessages: vi.fn().mockReturnValue([]),
				getAgentId: vi.fn().mockReturnValue("agent-root-1"),
				getConversationId: vi.fn().mockReturnValue("conv-root-1"),
				abort: vi.fn(),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				canStartRun: vi.fn().mockReturnValue(true),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: runtimeBuilder as never,
				createAgent: () => agent as never,
				telemetry,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ telemetry, sessionId }),
					prompt: "do then submit_and_exit",
					interactive: false,
				}),
			);

			const emissions = countTaskCompletedEmissions(adapter);
			expect(emissions).toHaveLength(1);
			expect(emissions[0]).toMatchObject({ source: "submit_and_exit" });
		});

		it("ignores failed submit_and_exit tool calls so the shutdown fallback still fires", async () => {
			const sessionId = "sess-task-completed-failed-submit";
			const manifest = createManifest(sessionId);
			const adapter = createTaskCompletedAdapter();
			const telemetry = new TelemetryService({
				adapters: [adapter],
				distinctId,
			});
			const sessionService = createMockSessionService(manifest);
			const runtimeBuilder = {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			};
			const failedSubmitCall: NonNullable<AgentResult["toolCalls"]>[number] = {
				...createSubmitAndExitToolCall(),
				error: "missing required field",
			};
			const agent = {
				run: vi.fn().mockResolvedValue(
					createResult({
						toolCalls: [failedSubmitCall],
					}),
				),
				continue: vi.fn(),
				getMessages: vi.fn().mockReturnValue([]),
				getAgentId: vi.fn().mockReturnValue("agent-root-1"),
				getConversationId: vi.fn().mockReturnValue("conv-root-1"),
				abort: vi.fn(),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				canStartRun: vi.fn().mockReturnValue(true),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: runtimeBuilder as never,
				createAgent: () => agent as never,
				telemetry,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ telemetry, sessionId }),
					prompt: "attempt submit but fail",
					interactive: false,
				}),
			);

			const emissions = countTaskCompletedEmissions(adapter);
			expect(emissions).toHaveLength(1);
			expect(emissions[0]).toMatchObject({ source: "shutdown" });
		});

		it("emits nothing when a released interactive session's final turn aborted", async () => {
			const sessionId = "sess-task-completed-release-aborted";
			const manifest = createManifest(sessionId);
			const adapter = createTaskCompletedAdapter();
			const telemetry = new TelemetryService({
				adapters: [adapter],
				distinctId,
			});
			const sessionService = createMockSessionService(manifest);
			const runtimeBuilder = {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			};
			const agent = {
				run: vi
					.fn()
					.mockResolvedValue(
						createResult({ finishReason: "aborted", toolCalls: [] }),
					),
				continue: vi.fn(),
				getMessages: vi.fn().mockReturnValue([]),
				getAgentId: vi.fn().mockReturnValue("agent-root-1"),
				getConversationId: vi.fn().mockReturnValue("conv-root-1"),
				abort: vi.fn(),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				canStartRun: vi.fn().mockReturnValue(true),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: runtimeBuilder as never,
				createAgent: () => agent as never,
				telemetry,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ telemetry, sessionId }),
					prompt: "turn that gets aborted",
					interactive: true,
				}),
			);

			getActiveSession(manager, sessionId).status = "cancelled";
			await manager.stopSession(sessionId);

			expect(countTaskCompletedEmissions(adapter)).toHaveLength(0);
		});

		it("emits nothing when a session's final turn errors after an earlier clean turn", async () => {
			const sessionId = "sess-task-completed-late-error";
			const manifest = createManifest(sessionId);
			const adapter = createTaskCompletedAdapter();
			const telemetry = new TelemetryService({
				adapters: [adapter],
				distinctId,
			});
			const sessionService = createMockSessionService(manifest);
			const runtimeBuilder = {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			};
			const agent = {
				// First turn completes cleanly, second turn throws — the errored
				// turn is the session's final turn, so no task.completed may be
				// emitted from the stale "completed" of the first turn.
				run: vi.fn().mockResolvedValue(createResult({ toolCalls: [] })),
				continue: vi.fn().mockRejectedValue(new Error("provider exploded")),
				getMessages: vi.fn().mockReturnValue([]),
				getAgentId: vi.fn().mockReturnValue("agent-root-1"),
				getConversationId: vi.fn().mockReturnValue("conv-root-1"),
				abort: vi.fn(),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				canStartRun: vi.fn().mockReturnValue(true),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: runtimeBuilder as never,
				createAgent: () => agent as never,
				telemetry,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ telemetry, sessionId }),
					prompt: "first turn finishes cleanly",
					interactive: true,
				}),
			);
			await expect(
				manager.runTurn({ sessionId, prompt: "second turn blows up" }),
			).rejects.toThrow("provider exploded");

			expect(countTaskCompletedEmissions(adapter)).toHaveLength(0);
		});

		it("does not double-fire from the release path after submit_and_exit already emitted", async () => {
			const sessionId = "sess-task-completed-release-no-double-fire";
			const manifest = createManifest(sessionId);
			const adapter = createTaskCompletedAdapter();
			const telemetry = new TelemetryService({
				adapters: [adapter],
				distinctId,
			});
			const sessionService = createMockSessionService(manifest);
			const runtimeBuilder = {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			};
			const agent = {
				run: vi.fn().mockResolvedValue(
					createResult({
						toolCalls: [createSubmitAndExitToolCall()],
					}),
				),
				continue: vi.fn(),
				getMessages: vi.fn().mockReturnValue([]),
				getAgentId: vi.fn().mockReturnValue("agent-root-1"),
				getConversationId: vi.fn().mockReturnValue("conv-root-1"),
				abort: vi.fn(),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				canStartRun: vi.fn().mockReturnValue(true),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: runtimeBuilder as never,
				createAgent: () => agent as never,
				telemetry,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ telemetry, sessionId }),
					prompt: "complete via submit_and_exit",
					interactive: true,
				}),
			);

			getActiveSession(manager, sessionId).status = "completed";
			await manager.stopSession(sessionId);

			const emissions = countTaskCompletedEmissions(adapter);
			expect(emissions).toHaveLength(1);
			expect(emissions[0]).toMatchObject({
				ulid: sessionId,
				source: "submit_and_exit",
			});
		});

		it("emits task.completed exactly once when dispose() releases a cleanly finished interactive session", async () => {
			const sessionId = "sess-task-completed-dispose-release";
			const manifest = createManifest(sessionId);
			const adapter = createTaskCompletedAdapter();
			const telemetry = new TelemetryService({
				adapters: [adapter],
				distinctId,
			});
			const sessionService = createMockSessionService(manifest);
			const runtimeBuilder = {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			};
			const agent = {
				run: vi.fn().mockResolvedValue(createResult({ toolCalls: [] })),
				continue: vi.fn(),
				getMessages: vi.fn().mockReturnValue([]),
				getAgentId: vi.fn().mockReturnValue("agent-root-1"),
				getConversationId: vi.fn().mockReturnValue("conv-root-1"),
				abort: vi.fn(),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				canStartRun: vi.fn().mockReturnValue(true),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: runtimeBuilder as never,
				createAgent: () => agent as never,
				telemetry,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ telemetry, sessionId }),
					prompt: "finish then get disposed",
					interactive: true,
				}),
			);

			getActiveSession(manager, sessionId).status = "completed";
			await manager.dispose("hub_restart");

			const emissions = countTaskCompletedEmissions(adapter);
			expect(emissions).toHaveLength(1);
			expect(emissions[0]).toMatchObject({
				ulid: sessionId,
				source: "shutdown",
			});
		});
	});
});
