import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRuntime } from "@cline/agents";
import {
	type AgentConfig,
	type AgentEvent,
	type AgentExtension,
	type AgentModel,
	type AgentTool,
	createContributionRegistry,
	type Message,
} from "@cline/shared";
import { setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserInstructionConfigService } from "../../extensions/config";
import type { CoreSessionConfig } from "../../types/config";
import { createAgentRuntimeConfig } from "../config/agent-runtime-config-builder";

const runMock = vi.fn();
const agentConstructorSpy = vi.fn();
let eventListeners: Array<(event: AgentEvent) => void> = [];

vi.mock("./session-runtime-orchestrator", () => {
	return {
		SessionRuntime: class MockSessionRuntime {
			constructor(config: unknown) {
				agentConstructorSpy(config);
			}

			getAgentId(): string {
				return "configured-sub-agent";
			}

			getConversationId(): string {
				return "configured-sub-conversation";
			}

			subscribeEvents(listener: (event: AgentEvent) => void): () => void {
				eventListeners.push(listener);
				return () => {
					eventListeners = eventListeners.filter((entry) => entry !== listener);
				};
			}

			async run(input: string): Promise<unknown> {
				for (const listener of eventListeners) {
					listener({
						type: "notice",
						noticeType: "status",
						message: "configured agent running",
					});
				}
				return runMock(input);
			}
		},
	};
});

function makeBaseConfig(
	overrides: Partial<CoreSessionConfig> = {},
): CoreSessionConfig {
	return {
		providerId: "anthropic",
		modelId: "claude-sonnet-4-6",
		apiKey: "key",
		systemPrompt: "test",
		cwd: process.cwd(),
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: false,
		...overrides,
	};
}

async function collectExtensionTools(
	extensions?: AgentExtension[],
): Promise<AgentTool[]> {
	const registry = createContributionRegistry<
		AgentExtension,
		AgentTool,
		Message[]
	>({
		extensions: extensions ?? [],
	});
	await registry.initialize();
	return registry.getRegisteredTools();
}

describe("DefaultRuntimeBuilder configured agent execution", () => {
	const previousHome = process.env.HOME;
	const tempDirs: string[] = [];

	beforeEach(() => {
		vi.clearAllMocks();
		eventListeners = [];
		runMock.mockResolvedValue({
			text: "configured result",
			iterations: 2,
			finishReason: "completed",
			usage: { inputTokens: 13, outputTokens: 8 },
		});
	});

	afterEach(() => {
		process.env.HOME = previousHome;
		setHomeDir(previousHome ?? "~");
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not require custom user instruction services to implement createSkillsExecutor", async () => {
		const { DefaultRuntimeBuilder } = await import("./runtime-builder");
		const workspaceRoot = mkdtempSync(join(tmpdir(), "cline-agent-compat-"));
		tempDirs.push(workspaceRoot);
		const agentsDir = join(workspaceRoot, ".cline", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "reviewer.yml"),
			`---
name: reviewer
description: Reviews code
skills: commit
---
You are a reviewer.`,
			"utf8",
		);

		const legacyService = {
			start: vi.fn(async () => {}),
			stop: vi.fn(),
			refreshType: vi.fn(async () => {}),
			listRecords: vi.fn(() => []),
			listRuntimeCommands: vi.fn(() => []),
			resolveRuntimeSlashCommand: vi.fn((input: string) => input),
			hasConfiguredSkills: vi.fn(() => false),
			createExtension: vi.fn(() => ({
				name: "legacy-service",
				manifest: { capabilities: [] },
			})),
		} as unknown as UserInstructionConfigService;

		const runtime = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({ cwd: workspaceRoot, workspaceRoot }),
			configExtensions: [],
			userInstructionService: legacyService,
		});
		const reviewer = runtime.tools.find(
			(tool) => tool.name === "subagent_reviewer",
		);
		expect(reviewer).toBeDefined();
		if (!reviewer) {
			throw new Error("Expected configured reviewer tool.");
		}

		await expect(
			reviewer.execute(
				{ prompt: "review this change" },
				{ agentId: "parent-agent", iteration: 1 },
			),
		).resolves.toEqual({
			text: "configured result",
			iterations: 2,
			finishReason: "completed",
			usage: { inputTokens: 13, outputTokens: 8 },
		});
		const delegatedConfig = agentConstructorSpy.mock.calls.at(-1)?.[0] as
			| AgentConfig
			| undefined;
		expect(delegatedConfig?.tools.map((tool) => tool.name)).not.toContain(
			"skills",
		);

		await runtime.shutdown("test");
	});

	it("exposes Claude plugin agents as subagent tools and lets a same-named workspace agent take precedence", async () => {
		const { DefaultRuntimeBuilder } = await import("./runtime-builder");
		const tempHome = mkdtempSync(join(tmpdir(), "cline-plugin-agent-home-"));
		const workspaceRoot = mkdtempSync(
			join(tmpdir(), "cline-plugin-agent-root-"),
		);
		tempDirs.push(tempHome, workspaceRoot);
		process.env.HOME = tempHome;
		setHomeDir(tempHome);

		const agentsDir = join(workspaceRoot, ".cline", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "planner.yml"),
			`---
name: demo:planner
description: Workspace planner
---
Plan from the workspace.`,
			"utf8",
		);

		const runtime = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({ cwd: workspaceRoot, workspaceRoot }),
			configExtensions: [],
			claudePluginAgents: [
				{
					name: "demo:planner",
					description: "Plugin planner",
					systemPrompt: "Plan from the plugin.",
				},
				{
					name: "demo:review:audit",
					description: "Finds auth gaps",
					systemPrompt: "Audit auth.",
				},
			],
		});

		const plannerTools = runtime.tools.filter(
			(tool) => tool.name === "subagent_demo_planner",
		);
		expect(plannerTools).toHaveLength(1);
		expect(plannerTools[0]?.description).toContain("Workspace planner");

		const auditTool = runtime.tools.find(
			(tool) => tool.name === "subagent_demo_review_audit",
		);
		expect(auditTool?.description).toContain("Finds auth gaps");

		await runtime.shutdown("test");
	});
});
