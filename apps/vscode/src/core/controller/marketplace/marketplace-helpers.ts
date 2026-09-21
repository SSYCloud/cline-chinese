import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import fs, { existsSync } from "node:fs"
import fsp from "node:fs/promises"
import os, { homedir, platform } from "node:os"
import path, { isAbsolute, join, relative, resolve } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import {
	disablePluginMcpServersInSettings,
	discoverPluginModulePaths,
	getPluginDisplayName,
	installMcpServer,
	installPlugin,
	isMarketplaceSkillInstalled,
	type MarketplaceActionResult,
	type MarketplaceEntryInput,
	type MarketplacePrimitiveType,
	parseMcpInstallArgs,
	readGlobalSettings,
	resolvePluginConfigSearchPaths,
	setDisabledPlugin,
	syncPluginMcpServersToSettings,
	uninstallMarketplaceEntry as uninstallCoreMarketplaceEntry,
	uninstallPlugin,
} from "@cline/core"
import { deleteSkillFile } from "@core/controller/file/deleteSkillFile"
import { refreshSkills } from "@core/controller/file/refreshSkills"
import { toggleSkill } from "@core/controller/file/toggleSkill"
import { resolveActiveModelIdFromApiConfiguration } from "@core/controller/models/taskApiModel"
import { DeleteSkillRequest, ToggleSkillRequest } from "@shared/proto/cline/file"
import {
	MarketplaceCatalog,
	MarketplaceEntry,
	MarketplaceEntryDetail,
	MarketplaceEntryExecuteResult,
	MarketplaceEntryQuoteResult,
	MarketplaceInstalledEntries,
	MarketplaceInstallResult,
	MarketplaceLocalInstalledEntries,
	MarketplaceLocalInstalledEntry,
	MarketplaceLocalInstalledEntryRequest,
	MarketplaceRunResultArtifacts,
	ToggleMarketplaceLocalInstalledEntryRequest,
} from "@shared/proto/cline/marketplace"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

type MarketplaceType = "mcp" | "skill" | "plugin"

type SpawnResult = {
	exitCode: number
	stdout: string
	stderr: string
}

const MARKETPLACE_CATALOG_URL = "https://cline.github.io/marketplace/catalog.json"
const SHENG_SUAN_YUN = "https://loomloom.shengsuanyun.com/loom/v1"
const SHENG_SUAN_YUN_SKILL_URL_PREFIX = "https://loomloom.shengsuanyun.com"
const OFFICIAL_PLUGINS_REPO = "https://github.com/cline/plugins.git"
const INSTALL_COMMAND_TIMEOUT_MS = 120_000
const MAX_OUTPUT_CHARS = 12_000
const SECRET_PATTERN =
	/(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|auth(?:orization)?[_ -]?token|token|secret|password|authorization|credential)/i
const SECRET_KEY_VALUE_PATTERN =
	/((?:^|[^\w])(?:[a-z0-9_]*?(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|auth(?:orization)?[_ -]?token|token|secret|password|credential)[a-z0-9_]*)\s*[:=]\s*)(.+)$/gi
const SECRET_BEARER_VALUE_PATTERN = /((?:^|[^\w])authorization\s*[:=]\s*)bearer\s+([^\s,"'}\]]+)/gi
const SECRET_AUTHORIZATION_VALUE_PATTERN = /((?:^|[^\w])authorization\s*[:=])(?!\s*bearer\b)\s*(.+)$/gi

function isMarketplaceType(value: string): value is MarketplaceType {
	return value === "mcp" || value === "skill" || value === "plugin"
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function sanitizeEntry(raw: unknown): MarketplaceEntry | undefined {
	if (!raw || typeof raw !== "object") return undefined
	const record = raw as Record<string, unknown>
	const id = typeof record.id === "string" ? record.id.trim() : ""
	const type = typeof record.type === "string" ? record.type.trim() : ""
	const name = typeof record.name === "string" ? record.name.trim() : id
	if (!id || !isMarketplaceType(type) || !name) return undefined
	const install = record.install && typeof record.install === "object" ? (record.install as Record<string, unknown>) : undefined
	return MarketplaceEntry.create({
		id,
		type,
		name,
		tagline: typeof record.tagline === "string" ? record.tagline : undefined,
		description: typeof record.description === "string" ? record.description : undefined,
		tags: asStringArray(record.tags),
		author: typeof record.author === "string" ? record.author : undefined,
		// The published catalog uses "repo"/"homepage"; older entries may use
		// "sourceUrl"/"homepageUrl". Accept both so URL-based enterprise
		// allowlist ids can be matched against the entry.
		sourceUrl:
			typeof record.sourceUrl === "string" ? record.sourceUrl : typeof record.repo === "string" ? record.repo : undefined,
		homepageUrl:
			typeof record.homepageUrl === "string"
				? record.homepageUrl
				: typeof record.homepage === "string"
					? record.homepage
					: undefined,
		install: install
			? {
					args: asStringArray(install.args),
					env: Array.isArray(install.env)
						? install.env
								.map((item) => {
									if (!item || typeof item !== "object") return undefined
									const env = item as Record<string, unknown>
									if (typeof env.name !== "string") return undefined
									return {
										name: env.name,
										required: env.required === true,
										description: typeof env.description === "string" ? env.description : undefined,
										url: typeof env.url === "string" ? env.url : undefined,
									}
								})
								.filter((item): item is NonNullable<typeof item> => item !== undefined)
						: [],
					command: typeof install.command === "string" ? install.command : undefined,
					notes: typeof install.notes === "string" ? install.notes : undefined,
				}
			: undefined,
	})
}

export async function fetchMarketplaceCatalog(): Promise<MarketplaceCatalog> {
	const catalogPromise = fetch(MARKETPLACE_CATALOG_URL, {
		headers: { Accept: "application/json" },
	}).catch(() => null)

	const ssyPromise = fetch(`${SHENG_SUAN_YUN}/marketListings`, {
		headers: loomLoomHeaders(),
	}).catch(() => null)
	const [response, ssyResponse] = await Promise.all([catalogPromise, ssyPromise])
	let entries: MarketplaceEntry[] = []
	if (response?.ok) {
		try {
			const json = (await response.json()) as { entries?: unknown[] }
			if (Array.isArray(json.entries)) {
				entries = json.entries.map(sanitizeEntry).filter((entry): entry is MarketplaceEntry => entry !== undefined)
			}
		} catch (e) {
			Logger.warn("Failed to parse marketplace catalog json:", e)
		}
	} else if (response) {
		Logger.warn(`Marketplace catalog request failed: ${response.status}`)
	}
	let ssyEntries: MarketplaceEntry[] = []
	if (ssyResponse?.ok) {
		try {
			const skls = (await ssyResponse.json()) as { items?: any[] }
			const base = SHENG_SUAN_YUN_SKILL_URL_PREFIX
			if (Array.isArray(skls.items)) {
				ssyEntries = skls.items
					.map((it) =>
						MarketplaceEntry.create({
							id: String(it.id),
							type: "skill",
							name: typeof it.displayName === "string" ? it.displayName : String(it.id),
							tagline: "联系胜算云 LoomLoom 团队获取支持。",
							description: typeof it.description === "string" ? it.description : undefined,
							tags: ["creative", "LoomLoom"],
							author: it.creator?.nickname || undefined,
							sourceUrl: `${base}${it.skillPackage?.archiveUrl}`,
							homepageUrl: `${base}/zh/loomloom/market`,
							install: {
								args: ["cline/skills", "--skill", String(it.id)],
								env: [],
								command: `cline skill install cline/skills --skill ${base}${it.skillPackage?.archiveUrl}`,
							},
							fee: it.taskFixedFee?.amount || undefined,
						}),
					)
					.filter((entry): entry is MarketplaceEntry => entry !== undefined)
			}
		} catch (e) {
			Logger.warn("fetchMarketplaceCatalog() Failed to parse ShengSuanYun json:", e)
		}
	} else if (ssyResponse) {
		Logger.warn(`fetchMarketplaceCatalog() ShengSuanYun request failed: ${ssyResponse.status}`)
	}
	return MarketplaceCatalog.create({ entries: [...ssyEntries, ...entries] })
}

function normalizeMatchValue(value: string | undefined): string {
	return (value ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
}

function marketplaceKey(entry: MarketplaceEntry): string {
	return `${entry.type}:${entry.id}`
}

/** Normalizes an allowlist id or entry identifier; legacy allowlist ids may be GitHub repo URLs. */
function normalizePolicyValue(value: string | undefined): string {
	return normalizeMatchValue((value ?? "").replace(/^https?:\/\//i, "").replace(/\/+$/, ""))
}

/**
 * Enterprise remote config can disable the MCP marketplace (`mcpMarketplaceEnabled: false`)
 * or restrict it to an allowlist (`allowedMCPServers`). Non-MCP entries are not governed
 * by these controls. Allowlist ids match the entry id, display name, installed server
 * name, or source/homepage URL.
 */
export function isMcpEntryAllowedByPolicy(
	entry: MarketplaceEntry,
	policy: { mcpMarketplaceEnabled?: boolean; allowedMCPServers?: Array<{ id: string }> },
): boolean {
	if (entry.type !== "mcp") return true
	if (policy.mcpMarketplaceEnabled === false) return false
	if (!policy.allowedMCPServers?.length) return true
	const candidates = new Set(
		[entry.id, entry.name, getEntryArgs(entry)[0], entry.sourceUrl, entry.homepageUrl].map(normalizePolicyValue),
	)
	candidates.delete("")
	return policy.allowedMCPServers.some((server) => candidates.has(normalizePolicyValue(server.id)))
}

function getEntryArgs(entry: MarketplaceEntry): string[] {
	return entry.install?.args ?? []
}

function isMcpInstalled(controller: Controller, entry: MarketplaceEntry): boolean {
	if (entry.type !== "mcp") return false
	const [name] = getEntryArgs(entry)
	const candidates = new Set([normalizeMatchValue(name), normalizeMatchValue(entry.id), normalizeMatchValue(entry.name)])
	candidates.delete("")
	return (controller.mcpHub?.getServers() ?? []).some((server) => candidates.has(normalizeMatchValue(server.name)))
}

function hashSource(source: string): string {
	return createHash("sha256").update(source).digest("hex").slice(0, 12)
}

function resolveClineHome(): string {
	return process.env.CLINE_DIR?.trim() || join(homedir(), ".cline")
}

function sanitizeSegment(value: string): string {
	const sanitized = value
		.replace(/^@/, "")
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80)
	return sanitized || "plugin"
}

function isOfficialPluginInstalled(entry: MarketplaceEntry): boolean {
	if (entry.type !== "plugin") return false
	const [source] = getEntryArgs(entry)
	if (!source || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.trim())) return false
	const sourceKey = `official:${OFFICIAL_PLUGINS_REPO}#plugins/${source.trim()}`
	const installPath = join(
		resolveClineHome(),
		"plugins",
		"_installed",
		"official",
		`${sanitizeSegment(source)}-${hashSource(sourceKey)}`,
	)
	return existsSync(installPath)
}

type InstalledLoomLoomSkill = { name: string; skillMdPath: string; listingId: string }

/**
 * LoomLoom 技能通过 ZIP 解压到 ~/.agents/skills，目录名形如 loomloom-market-<hash>，
 * 与目录条目的 id（LoomLoom listing UUID）并不一致，核心的 isMarketplaceSkillInstalled
 * 无法按 skill 名称定位。这里改为扫描 SKILL.md 正文中的 "Listing ID" 字段进行匹配。
 */
function listInstalledLoomLoomSkills(): InstalledLoomLoomSkill[] {
	const skillsDir = join(homedir(), ".agents", "skills")
	const skills: InstalledLoomLoomSkill[] = []
	let entries: string[] = []
	try {
		entries = fs
			.readdirSync(skillsDir, { withFileTypes: true })
			.filter((dirent) => dirent.isDirectory())
			.map((dirent) => dirent.name)
	} catch {
		return skills
	}
	for (const name of entries) {
		const skillMdPath = join(skillsDir, name, "SKILL.md")
		try {
			const content = fs.readFileSync(skillMdPath, "utf-8")
			const match = content.match(/^-\s*Listing ID:\s*["']?([0-9a-fA-F-]{36})["']?/m)
			if (match?.[1]) {
				skills.push({ name, skillMdPath, listingId: match[1] })
			}
		} catch {
			// 忽略无法读取的 SKILL.md
		}
	}
	return skills
}

function isSkillInstalled(entry: MarketplaceEntry, loomLoomListingIds: Set<string>): boolean {
	if (entry.type !== "skill") return false
	if (isMarketplaceSkillInstalled(toCoreMarketplaceEntry(entry))) return true
	return loomLoomListingIds.has(entry.id)
}

export function listInstalledMarketplaceEntries(
	controller: Controller,
	entries: MarketplaceEntry[],
): MarketplaceInstalledEntries {
	const loomLoomListingIds = new Set(listInstalledLoomLoomSkills().map((skill) => skill.listingId))
	return MarketplaceInstalledEntries.create({
		installedKeys: entries
			.filter(
				(entry) =>
					isMcpInstalled(controller, entry) ||
					isSkillInstalled(entry, loomLoomListingIds) ||
					isOfficialPluginInstalled(entry),
			)
			.map(marketplaceKey),
	})
}

function redactOutput(value: string): string {
	return value
		.split(/\r?\n/)
		.map((line) => {
			if (!SECRET_PATTERN.test(line)) return line
			return line
				.replace(SECRET_KEY_VALUE_PATTERN, "$1[redacted]")
				.replace(SECRET_BEARER_VALUE_PATTERN, "$1Bearer [redacted]")
				.replace(/\b(Bearer)\s+(?!\[redacted\])([^\s,"'}\]]+)/gi, "$1 [redacted]")
				.replace(SECRET_AUTHORIZATION_VALUE_PATTERN, "$1 [redacted]")
				.replace(
					/((?:^|[^\w])(?:api\s+key|access\s+token|refresh\s+token|auth(?:orization)?\s+token|secret|password|credential)\s+(?:is\s+)?)(\S+)/gi,
					"$1[redacted]",
				)
		})
		.join("\n")
		.slice(-MAX_OUTPUT_CHARS)
}

function quoteCommandPart(value: string): string {
	if (value === "") return '""'
	if (/^[a-zA-Z0-9_./:=@%+,-]+$/.test(value)) return value
	return JSON.stringify(value)
}

function formatCommand(command: string, args: string[]): string {
	return [command, ...args].map((part) => quoteCommandPart(redactOutput(part).trim())).join(" ")
}

function extractJsonErrorMessage(value: unknown): string | undefined {
	if (typeof value === "string") return value.trim() || undefined
	if (!value || typeof value !== "object") return undefined
	if (Array.isArray(value)) {
		return value.map(extractJsonErrorMessage).filter(Boolean).join("\n") || undefined
	}
	const record = value as Record<string, unknown>
	for (const key of ["message", "error", "details", "detail", "reason", "stderr", "stdout"]) {
		const message = extractJsonErrorMessage(record[key])
		if (message) return message
	}
	return undefined
}

function parseJsonErrorMessage(output: string): string | undefined {
	const trimmed = output.trim()
	if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return undefined
	try {
		return extractJsonErrorMessage(JSON.parse(trimmed))
	} catch {
		return undefined
	}
}

function commandOutput(result: SpawnResult): string | undefined {
	const stdout = redactOutput(result.stdout).trim()
	const stderr = redactOutput(result.stderr).trim()
	const parsedMessages = [stdout, stderr].map(parseJsonErrorMessage).filter((message): message is string => Boolean(message))
	if (parsedMessages.length > 0) return parsedMessages.join("\n")
	const parts = [stderr ? `stderr:\n${stderr}` : undefined, stdout ? `stdout:\n${stdout}` : undefined].filter(
		(part): part is string => Boolean(part),
	)
	return parts.join("\n\n") || undefined
}

async function runCommand(command: string, args: string[]): Promise<SpawnResult> {
	return new Promise((resolveResult, reject) => {
		let settled = false
		let timedOut = false
		const child = spawn(command, args, {
			env: process.env,
			shell: platform() === "win32",
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		})
		let stdout = ""
		let stderr = ""
		const forceKillTimeout = setTimeout(() => {
			if (!settled) child.kill("SIGKILL")
		}, INSTALL_COMMAND_TIMEOUT_MS + 5_000)
		const timeout = setTimeout(() => {
			timedOut = true
			stderr += `\nTimed out after ${INSTALL_COMMAND_TIMEOUT_MS / 1000}s.`
			child.kill("SIGTERM")
		}, INSTALL_COMMAND_TIMEOUT_MS)
		forceKillTimeout.unref?.()
		timeout.unref?.()
		child.stdout?.on("data", (chunk) => {
			stdout += String(chunk)
			if (stdout.length > MAX_OUTPUT_CHARS * 2) stdout = stdout.slice(-MAX_OUTPUT_CHARS)
		})
		child.stderr?.on("data", (chunk) => {
			stderr += String(chunk)
			if (stderr.length > MAX_OUTPUT_CHARS * 2) stderr = stderr.slice(-MAX_OUTPUT_CHARS)
		})
		child.once("error", reject)
		child.once("close", (code, signal) => {
			settled = true
			clearTimeout(timeout)
			clearTimeout(forceKillTimeout)
			resolveResult({
				exitCode: timedOut ? 124 : (code ?? (signal === "SIGINT" ? 130 : 1)),
				stdout,
				stderr,
			})
		})
	})
}

function installMcpMarketplaceEntry(entry: MarketplaceEntry, args: string[]): MarketplaceInstallResult {
	const parsed = parseMcpInstallArgs(args)
	const result = installMcpServer(parsed)
	return MarketplaceInstallResult.create({
		id: entry.id,
		type: entry.type,
		status: "installed",
		message: `Installed ${entry.name || entry.id}.`,
		output: result.warnings.join("\n") || undefined,
	})
}

async function installPluginMarketplaceEntry(entry: MarketplaceEntry, args: string[]): Promise<MarketplaceInstallResult> {
	const [source] = args
	if (!source) throw new Error("Marketplace plugin install args must start with a plugin source.")
	const result = await installPlugin({ source })
	const warnings = result.mcpSyncFailures.map(
		(failure) => `Failed to sync plugin MCP servers for ${failure.pluginName ?? failure.pluginPath}: ${failure.message}`,
	)
	return MarketplaceInstallResult.create({
		id: entry.id,
		type: entry.type,
		status: "installed",
		message: `Installed ${entry.name || entry.id}.`,
		output: [`Path: ${result.installPath}`, ...warnings].join("\n"),
	})
}

async function installSkillMarketplaceEntry(entry: MarketplaceEntry, args: string[]): Promise<MarketplaceInstallResult> {
	if (entry.sourceUrl?.startsWith(SHENG_SUAN_YUN_SKILL_URL_PREFIX)) {
		return await downloadAndExtractSkillZeroDep(entry)
	}
	const command = "npx"
	const commandArgs = ["-y", "skills@latest", "add", ...args, "-g", "-a", "cline", "-y"]
	const displayCommand = formatCommand(command, commandArgs)
	let result: SpawnResult
	try {
		result = await runCommand(command, commandArgs)
	} catch (error) {
		throw new Error(
			`Failed to start ${entry.name || entry.id} install command:\n${displayCommand}\n${
				error instanceof Error ? error.message : String(error)
			}`,
		)
	}
	const output = commandOutput(result)
	if (result.exitCode !== 0) {
		throw new Error(
			`${entry.name || entry.id} install failed with exit code ${result.exitCode}.\nCommand:\n${displayCommand}${
				output ? `\n\n${output}` : ""
			}`,
		)
	}
	return MarketplaceInstallResult.create({
		id: entry.id,
		type: entry.type,
		status: "installed",
		message: `Installed ${entry.name || entry.id}.`,
		output,
	})
}

export async function installMarketplaceEntryFromCatalog(entry: MarketplaceEntry): Promise<MarketplaceInstallResult> {
	const args = getEntryArgs(entry)
	if (args.length === 0) throw new Error("Marketplace install args are required.")
	if (entry.type === "mcp") return installMcpMarketplaceEntry(entry, args)
	if (entry.type === "plugin") return installPluginMarketplaceEntry(entry, args)
	return installSkillMarketplaceEntry(entry, args)
}

function toCoreMarketplaceEntry(entry: MarketplaceEntry): MarketplaceEntryInput {
	if (entry.type !== "mcp" && entry.type !== "skill" && entry.type !== "plugin") {
		throw new Error(`Unsupported marketplace entry type: ${entry.type}`)
	}
	return {
		id: entry.id,
		type: entry.type as MarketplacePrimitiveType,
		name: entry.name,
		install: {
			args: getEntryArgs(entry),
		},
	}
}

function toProtoMarketplaceInstallResult(result: MarketplaceActionResult): MarketplaceInstallResult {
	return MarketplaceInstallResult.create({
		id: result.id,
		type: result.type,
		status: result.status,
		message: result.message,
		output: result.output,
	})
}

export async function uninstallMarketplaceEntryFromCatalog(
	controller: Controller,
	entry: MarketplaceEntry,
): Promise<MarketplaceInstallResult> {
	// LoomLoom 技能通过 ZIP 解压到 ~/.agents/skills，目录名是 loomloom-market-<hash>，
	// 核心 uninstall 无法按 skill 名称定位；这里按 SKILL.md 中的 Listing ID 定位并删除。
	if (entry.type === "skill" && entry.sourceUrl?.startsWith(SHENG_SUAN_YUN_SKILL_URL_PREFIX)) {
		const installed = listInstalledLoomLoomSkills().find((skill) => skill.listingId === entry.id)
		if (!installed) {
			return MarketplaceInstallResult.create({
				id: entry.id,
				type: entry.type,
				status: "uninstalled",
				message: `${entry.name || entry.id} 未安装。`,
			})
		}
		await deleteSkillFile(controller, DeleteSkillRequest.create({ skillPath: installed.skillMdPath, isGlobal: true }))
		return MarketplaceInstallResult.create({
			id: entry.id,
			type: entry.type,
			status: "uninstalled",
			message: `已卸载 ${entry.name || entry.id}。`,
		})
	}
	const workspaceRoot = await getWorkspacePath()
	const result = await uninstallCoreMarketplaceEntry(toCoreMarketplaceEntry(entry), {
		deleteMcpServer: async (name) => {
			await controller.mcpHub?.deleteServerRPC(name)
		},
		workspaceRoot,
	})
	return toProtoMarketplaceInstallResult(result)
}

function isPathWithin(parentPath: string, childPath: string): boolean {
	const relativePath = relative(resolve(parentPath), resolve(childPath))
	return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

function isGlobalClinePath(filePath: string | undefined): boolean {
	if (!filePath || filePath.startsWith("remote:")) return false
	return [resolveClineHome(), join(homedir(), ".agents", "skills")].some((root) => isPathWithin(root, filePath))
}

async function listPluginLocalEntries(): Promise<MarketplaceLocalInstalledEntry[]> {
	const workspacePath = HostProvider.isInitialized() ? (await HostProvider.workspace.getWorkspacePaths({})).paths[0] : undefined
	const roots = resolvePluginConfigSearchPaths(workspacePath).filter((directory) => existsSync(directory))
	const disabledPlugins = new Set(readGlobalSettings().disabledPlugins ?? [])
	const entries: MarketplaceLocalInstalledEntry[] = []
	for (const root of roots) {
		for (const pluginPath of discoverPluginModulePaths(root)) {
			entries.push(
				MarketplaceLocalInstalledEntry.create({
					id: pluginPath,
					type: "plugin",
					name: getPluginDisplayName(pluginPath, root),
					path: pluginPath,
					source: isGlobalClinePath(pluginPath) ? "global" : "workspace",
					enabled: !disabledPlugins.has(pluginPath),
				}),
			)
		}
	}
	return entries
}

export async function listLocalMarketplaceInstalledEntries(controller: Controller): Promise<MarketplaceLocalInstalledEntries> {
	const mcpEntries = (controller.mcpHub?.getServers() ?? []).map((server) =>
		MarketplaceLocalInstalledEntry.create({
			id: server.name,
			type: "mcp",
			name: server.name,
			description: server.status,
			enabled: server.disabled !== true,
		}),
	)
	const refreshedSkills = await refreshSkills(controller)
	const skillEntries = [
		...refreshedSkills.globalSkills.map((skill) =>
			MarketplaceLocalInstalledEntry.create({
				id: skill.name,
				type: "skill",
				name: skill.name,
				description: skill.description,
				path: skill.path,
				source: skill.path.startsWith("remote:") ? "remote" : "global",
				enabled: skill.enabled,
			}),
		),
		...refreshedSkills.localSkills.map((skill) =>
			MarketplaceLocalInstalledEntry.create({
				id: skill.name,
				type: "skill",
				name: skill.name,
				description: skill.description,
				path: skill.path,
				source: isGlobalClinePath(skill.path) ? "global" : "workspace",
				enabled: skill.enabled,
			}),
		),
	]
	const pluginEntries = await listPluginLocalEntries()
	return MarketplaceLocalInstalledEntries.create({ entries: [...mcpEntries, ...skillEntries, ...pluginEntries] })
}

async function getWorkspacePath(): Promise<string | undefined> {
	return HostProvider.isInitialized() ? (await HostProvider.workspace.getWorkspacePaths({})).paths[0] : undefined
}

function getActiveProviderAndModel(controller: Controller): { providerId?: string; modelId?: string } {
	const mode = controller.stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
	const apiConfiguration = controller.stateManager.getApiConfiguration()
	const providerId = mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider
	const modelId = resolveActiveModelIdFromApiConfiguration(apiConfiguration, mode)
	return { providerId, modelId }
}

async function togglePluginLocalEntry(
	controller: Controller,
	entry: MarketplaceLocalInstalledEntry,
	enabled: boolean,
): Promise<void> {
	if (!entry.path) throw new Error("Plugin path is required.")
	if (!enabled) {
		disablePluginMcpServersInSettings({ pluginPaths: [entry.path] })
		setDisabledPlugin(entry.path, true)
		return
	}

	const workspacePath = await getWorkspacePath()
	const { providerId, modelId } = getActiveProviderAndModel(controller)
	const ownedMcpMutations = disablePluginMcpServersInSettings({ pluginPaths: [entry.path] })
	const result = await syncPluginMcpServersToSettings({
		pluginPaths: [entry.path],
		cwd: workspacePath,
		workspacePath,
		providerId,
		modelId,
	})
	if (ownedMcpMutations.length > 0 && result.failures.length > 0) {
		throw new Error(
			`Failed to sync plugin MCP servers: ${result.failures
				.map((failure) => `${failure.pluginName ?? failure.pluginPath}: ${failure.message}`)
				.join("; ")}`,
		)
	}
	setDisabledPlugin(entry.path, false)
}

export async function toggleLocalMarketplaceInstalledEntry(
	controller: Controller,
	request: ToggleMarketplaceLocalInstalledEntryRequest,
): Promise<MarketplaceLocalInstalledEntries> {
	const { entry, enabled } = request
	if (!entry) throw new Error("Installed marketplace entry is required.")
	if (entry.type === "mcp") {
		const name = entry.name || entry.id
		if (!name) throw new Error("MCP server name is required.")
		await controller.mcpHub?.toggleServerDisabledRPC(name, !enabled)
		return listLocalMarketplaceInstalledEntries(controller)
	}
	if (entry.type === "skill") {
		await toggleSkill(
			controller,
			ToggleSkillRequest.create({
				skillPath: entry.path || entry.id,
				isGlobal: entry.source === "global",
				enabled,
			}),
		)
		return listLocalMarketplaceInstalledEntries(controller)
	}
	if (entry.type === "plugin") {
		await togglePluginLocalEntry(controller, entry, enabled)
		await controller.invalidateUserInstructionService()
		return listLocalMarketplaceInstalledEntries(controller)
	}
	throw new Error(`Marketplace toggle is not supported for ${entry.type}.`)
}

export async function uninstallLocalMarketplaceInstalledEntry(
	controller: Controller,
	request: MarketplaceLocalInstalledEntryRequest,
): Promise<MarketplaceInstallResult> {
	const { entry } = request
	if (!entry) throw new Error("Installed marketplace entry is required.")
	const name = entry.name || entry.id
	if (entry.type === "mcp") {
		if (!name) throw new Error("MCP server name is required.")
		await controller.mcpHub?.deleteServerRPC(name)
		return MarketplaceInstallResult.create({
			id: entry.id,
			type: entry.type,
			status: "uninstalled",
			message: `Uninstalled ${name}.`,
		})
	}
	if (entry.type === "skill") {
		if (entry.path?.startsWith("remote:")) {
			throw new Error("Remote-managed skills cannot be uninstalled from Customize.")
		}
		if (!entry.path) throw new Error("Skill path is required for uninstall.")
		await deleteSkillFile(
			controller,
			DeleteSkillRequest.create({
				skillPath: entry.path,
				isGlobal: entry.source === "global",
			}),
		)
		await controller.invalidateUserInstructionService()
		return MarketplaceInstallResult.create({
			id: entry.id,
			type: entry.type,
			status: "uninstalled",
			message: `Uninstalled ${name || entry.id}.`,
		})
	}
	if (entry.type === "plugin") {
		const workspaceRoot = await getWorkspacePath()
		const result = await uninstallPlugin({
			name: entry.path ? undefined : name,
			path: entry.path,
			workspaceRoot,
		})
		await controller.invalidateUserInstructionService()
		return MarketplaceInstallResult.create({
			id: entry.id,
			type: entry.type,
			status: "uninstalled",
			message: `Uninstalled ${result.name}.`,
			output: [`Path: ${result.installPath}`, ...result.removedPaths.map((path) => `Removed: ${path}`)].join("\n"),
		})
	}
	throw new Error(`Marketplace uninstall is not supported for ${entry.type}.`)
}
export async function downloadAndExtractSkillZeroDep(entry: MarketplaceEntry): Promise<MarketplaceInstallResult> {
	const targetDir = path.join(os.homedir(), ".agents", "skills")
	await fsp.mkdir(targetDir, { recursive: true })
	const tempZipPath = path.join(targetDir, `_temp_${Date.now()}.zip`)
	try {
		if (!entry.sourceUrl) {
			throw new Error(`No source URL available for ${entry.name || entry.id}.`)
		}
		const response = await fetch(entry.sourceUrl, { headers: loomLoomHeaders() })

		if (!response.ok || !response.body) {
			throw new Error(`下载失败 [${response.status}]: ${response.statusText}`)
		}

		const fileStream = fs.createWriteStream(tempZipPath)
		// @ts-expect-error Node 18+ 原生 fetch body 转换为 Node 流
		await pipeline(Readable.fromWeb(response.body), fileStream)

		// 2. 校验文件 Magic Bytes (PK\x03\x04)
		const handle = await fsp.open(tempZipPath, "r")
		const headerBuffer = Buffer.alloc(4)
		await handle.read(headerBuffer, 0, 4, 0)
		await handle.close()

		const isZip = headerBuffer[0] === 0x50 && headerBuffer[1] === 0x4b && headerBuffer[2] === 0x03 && headerBuffer[3] === 0x04
		if (!isZip) {
			const preview = (await fsp.readFile(tempZipPath, "utf-8")).slice(0, 30000)
			throw new Error(`下载失败:\n${preview}`)
		}

		const command = "tar"
		const commandArgs = ["-xvf", tempZipPath, "-C", targetDir]
		const result = await runCommand(command, commandArgs)
		const output = commandOutput(result)
		if (result.exitCode !== 0) {
			throw new Error(
				`${entry.name || entry.id} extract failed with exit code ${result.exitCode}.${output ? `\n\n${output}` : ""}`,
			)
		}

		return MarketplaceInstallResult.create({
			id: entry.id,
			type: entry.type,
			status: "installed",
			message: `Installed ${entry.name || entry.id}.`,
			output,
		})
	} finally {
		if (fs.existsSync(tempZipPath)) {
			await fsp.unlink(tempZipPath).catch(() => {})
		}
	}
}

export async function fetchMarketplaceEntryDetail(id: string): Promise<MarketplaceEntryDetail> {
	const response = await fetch(`${SHENG_SUAN_YUN}/marketListings/${encodeURIComponent(id)}`, { headers: loomLoomHeaders() })
	if (!response.ok) {
		throw new Error(`获取 Skill 详情失败 [${response.status}]: ${response.statusText}`)
	}
	const json = (await response.json()) as Record<string, unknown>
	return MarketplaceEntryDetail.create({
		id: typeof json.id === "string" ? json.id : id,
		name: typeof json.displayName === "string" ? json.displayName : undefined,
		inputSchemaSnapshot: typeof json.inputSchemaSnapshot === "string" ? json.inputSchemaSnapshot : undefined,
	})
}

function loomLoomHeaders(): Record<string, string> {
	const shengSuanYunApiKey = StateManager.get().getSecretKey("shengSuanYunApiKey")
	const headers: Record<string, string> = {
		Accept: "application/json",
		"Content-Type": "application/json",
	}
	if (shengSuanYunApiKey) {
		headers.Authorization = `Bearer ${shengSuanYunApiKey}`
	}
	return headers
}

function parseJson(text: string): Record<string, unknown> | null {
	const trimmed = text.trim()
	if (!trimmed) return null
	try {
		const parsed = JSON.parse(trimmed)
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
	} catch {
		return null
	}
}

function formatExecuteOutput(text: string): string {
	const trimmed = text.trim()
	if (!trimmed) return ""
	const json = parseJson(trimmed)
	if (json) return JSON.stringify(json, null, 2)
	return trimmed
}

/** 将接口返回的任意值安全地转为字符串。 */
function asString(value: unknown): string {
	if (value === null || value === undefined) return ""
	if (typeof value === "string") return value
	if (typeof value === "number" || typeof value === "boolean") return String(value)
	return JSON.stringify(value)
}

/** 防御式地格式化 server.moneyResponse，兼容字符串/数字/对象等多种返回形态。 */
function formatMoney(value: unknown): string {
	if (value === null || value === undefined) return ""
	if (typeof value === "string" || typeof value === "number") return String(value)
	if (typeof value === "object") {
		const record = value as Record<string, unknown>
		const amount = record.amount ?? record.value ?? record.total ?? record.estimatedBuyerPayable
		const currency = record.currency ?? record.currencyCode
		if (amount !== undefined && amount !== null) {
			const amountText = String(amount)
			return currency ? `${amountText} ${currency}` : amountText
		}
		return JSON.stringify(value)
	}
	return String(value)
}

/** 从胜算云接口返回的错误响应中提取可读的错误信息，剥离 gRPC / batchjob 等外层包装。 */
function extractLoomError(text: string): string {
	const trimmed = text.trim()
	if (!trimmed) return ""
	let message = trimmed
	const parsed = parseJson(trimmed)
	if (parsed && typeof parsed.error === "string" && parsed.error.trim()) {
		message = parsed.error
	}
	// 剥离 gRPC 包装：rpc error: code = X desc = ...
	message = message.replace(/^rpc error: code = \S+ desc = /, "")
	// 剥离 batchjob 包装：batchjob endpoint returned NNN: ...
	message = message.replace(/batchjob endpoint returned \d+: /, "")
	// 剥离后若仍为 JSON（形如 {"error":"..."}），再取内层 error。
	const nested = parseJson(message)
	if (nested && typeof nested.error === "string" && nested.error.trim()) {
		message = nested.error
	}
	return message.trim() || trimmed
}

/** 将常见的胜算云接口错误映射为更可读、可操作的中文提示。 */
function humanizeLoomError(status: number, text: string): string {
	const message = extractLoomError(text) || text
	if (status === 403 && /verified API Token identity/i.test(message)) {
		return "该 Skill 需要已验证的 API Token 身份才能执行，请前往胜算云 LoomLoom 平台完成 API Token 身份验证后再试。"
	}
	return message
}

const RUN_PENDING_STATUSES = new Set(["pending", "running", "processing", "queued", "submitted", "in_progress", "in-progress"])

/** 判断单个运行结果是否已经进入终态（成功或失败）。 */
function isTerminalRunStatus(status: string | undefined): boolean {
	if (!status) return false
	return !RUN_PENDING_STATUSES.has(status.trim().toLowerCase())
}

/** 判断一次 run 是否已完成：优先看顶层 status，其次看所有 resultRows item 是否都进入终态。 */
function isRunDone(json: Record<string, unknown> | null, items: Array<Record<string, unknown>>): boolean {
	const topStatus = asString(json?.status).trim().toLowerCase()
	if (topStatus && isTerminalRunStatus(topStatus)) return true
	return items.length > 0 && items.every((item) => isTerminalRunStatus(asString(item.status)))
}

/**
 * 调用胜算云 LoomLoom 接口预估任务执行价格：
 * POST https://loomloom.shengsuanyun.com/loom/v1/marketListings/{marketListing}:quote
 * 请求体中的每个 inputRow 对应用户填写的一个任务；listingVersionId 可选。
 */
export async function quoteMarketplaceEntryFromCatalog(
	id: string,
	inputRows: Array<Record<string, string>>,
	listingVersionId?: string,
): Promise<MarketplaceEntryQuoteResult> {
	const body: Record<string, unknown> = { inputRows }
	if (listingVersionId) {
		body.listingVersionId = listingVersionId
	}
	const response = await fetch(`${SHENG_SUAN_YUN}/marketListings/${encodeURIComponent(id)}:quote`, {
		method: "POST",
		headers: loomLoomHeaders(),
		body: JSON.stringify(body),
	})
	const text = await response.text()
	if (!response.ok) {
		throw new Error(`预估价格失败 [${response.status}]: ${humanizeLoomError(response.status, text) || response.statusText}`)
	}
	const json = parseJson(text)
	return MarketplaceEntryQuoteResult.create({
		status: "success",
		message: "已获取报价。",
		output: formatExecuteOutput(text),
		currency: asString(json?.currency),
		estimatedBuyerPayable: formatMoney(json?.estimatedBuyerPayable),
		estimatedExecutionCost: formatMoney(json?.estimatedExecutionCost),
		taskFixedFee: formatMoney(json?.taskFixedFee),
		taskCount: Number(json?.taskCount ?? 0),
		quoteId: asString(json?.quoteId),
		listingVersionId: asString(json?.listingVersionId),
	})
}

/**
 * 调用胜算云 LoomLoom 接口执行一个 marketplace listing：
 * POST https://loomloom.shengsuanyun.com/loom/v1/marketListings/{marketListing}:execute
 * 请求体中的每个 inputRow 对应用户填写的一个任务。
 */
export async function executeMarketplaceEntryFromCatalog(
	id: string,
	inputRows: Array<Record<string, string>>,
	confirm: boolean,
	clientRequestId?: string,
): Promise<MarketplaceEntryExecuteResult> {
	const body = JSON.stringify({
		inputRows,
		confirm,
		clientRequestId: clientRequestId || randomUUID(),
	})
	const response = await fetch(`${SHENG_SUAN_YUN}/marketListings/${encodeURIComponent(id)}:execute`, {
		method: "POST",
		headers: loomLoomHeaders(),
		body,
	})
	const text = await response.text()
	if (!response.ok) {
		throw new Error(
			`执行 Skill 失败 [${response.status}]: ${humanizeLoomError(response.status, text) || response.statusText}`,
		)
	}
	const json = parseJson(text)
	return MarketplaceEntryExecuteResult.create({
		status: "success",
		message: "已提交执行。",
		output: formatExecuteOutput(text),
		runId: asString(json?.runId),
		runTransactionId: asString(json?.runTransactionId),
		transactionStatus: asString(json?.transactionStatus),
		skillName: asString(json?.skillName),
		currency: asString(json?.currency),
		finalBuyerPayable: formatMoney(json?.finalBuyerPayable),
		listingId: asString(json?.listingId),
		listingVersionId: asString(json?.listingVersionId),
	})
}

/**
 * 轮询执行结果：
 * 1. GET https://loomloom.shengsuanyun.com/loom/v1/users/me/runs/{runId}/resultRows —— 判断 run 是否已结束；
 * 2. 结束（status 为 done）后，再 GET .../users/me/runs/{runId}/artifacts 拉取产物返回。
 */
export async function getMarketplaceRunResultArtifacts(runId: string): Promise<MarketplaceRunResultArtifacts> {
	const rowsResponse = await fetch(`${SHENG_SUAN_YUN}/users/me/runs/${encodeURIComponent(runId)}/resultRows`, {
		headers: loomLoomHeaders(),
	})
	const rowsText = await rowsResponse.text()
	if (!rowsResponse.ok) {
		throw new Error(
			`获取执行结果失败 [${rowsResponse.status}]: ${humanizeLoomError(rowsResponse.status, rowsText) || rowsResponse.statusText}`,
		)
	}
	const rowsJson = parseJson(rowsText)
	const rowItems = Array.isArray(rowsJson?.items) ? (rowsJson.items as Array<Record<string, unknown>>) : []
	if (!isRunDone(rowsJson, rowItems)) {
		return MarketplaceRunResultArtifacts.create({
			status: "success",
			message: "执行进行中。",
			output: "",
			done: false,
			totalCount: Number(rowsJson?.totalCount ?? rowItems.length),
		})
	}

	const artifactsResponse = await fetch(`${SHENG_SUAN_YUN}/users/me/runs/${encodeURIComponent(runId)}/artifacts`, {
		headers: loomLoomHeaders(),
	})
	const artifactsText = await artifactsResponse.text()
	if (!artifactsResponse.ok) {
		throw new Error(
			`获取执行结果失败 [${artifactsResponse.status}]: ${humanizeLoomError(artifactsResponse.status, artifactsText) || artifactsResponse.statusText}`,
		)
	}
	const artifactsJson = parseJson(artifactsText)
	const artifacts = Array.isArray(artifactsJson)
		? (artifactsJson as Array<Record<string, unknown>>)
		: Array.isArray(artifactsJson?.items)
			? (artifactsJson.items as Array<Record<string, unknown>>)
			: []
	return MarketplaceRunResultArtifacts.create({
		status: "success",
		message: "执行已完成。",
		output: artifacts.length > 0 ? JSON.stringify(artifacts, null, 2) : "",
		done: true,
		totalCount: artifacts.length,
	})
}
