import "opentui-spinner/react";
import type { ReactNode } from "react";
import {
	CODEX_CLI_INSTALL_URL,
	type CodexCliStatus,
} from "../../../utils/codex-cli";
import {
	ClineModelPicker,
	type ClineModelPickerEntry,
} from "../../components/model-selector/cline-model-picker";
import {
	type SearchableItem,
	SearchableList,
	type SearchableListState,
} from "../../components/searchable-list";
import {
	TrackedRobot,
	type useMouseTracker,
} from "../../components/tracked-robot";
import { useTerminalBackground } from "../../hooks/use-terminal-background";
import { getDefaultForeground, palette } from "../../palette";
import { FIELD_ORDER } from "./fields";
import { MAIN_MENU, THINKING_LEVELS } from "./model";

type MouseTrackerState = ReturnType<typeof useMouseTracker>;

function useDefaultFg(): string | undefined {
	const terminalBg = useTerminalBackground();
	return getDefaultForeground(terminalBg);
}

interface OnboardingFrameProps {
	children: ReactNode;
	compact: boolean;
	contentWidth: number;
	mouse: MouseTrackerState;
}

function OnboardingFrame({
	children,
	compact,
	contentWidth,
	mouse,
}: OnboardingFrameProps) {
	return (
		<box
			flexDirection="column"
			width="100%"
			height="100%"
			justifyContent="center"
			alignItems="center"
			onMouseMove={mouse.onMouseMove}
		>
			{!compact && (
				<TrackedRobot cursorX={mouse.cursor.x} cursorY={mouse.cursor.y} />
			)}
			<box
				flexDirection="column"
				width={contentWidth}
				marginTop={compact ? 0 : 1}
				gap={1}
			>
				{children}
			</box>
		</box>
	);
}

export function OnboardingDoneScreen(props: { mouse: MouseTrackerState }) {
	return (
		<box
			flexDirection="column"
			width="100%"
			height="100%"
			justifyContent="center"
			alignItems="center"
			onMouseMove={props.mouse.onMouseMove}
		>
			<text fg={palette.success}>{"\u2714"} 设置完毕!</text>
		</box>
	);
}

export function OnboardingOAuthPendingScreen(props: {
	authError: string;
	authStatus: string;
	authUrl: string;
	compact: boolean;
	contentWidth: number;
	label: string;
	mouse: MouseTrackerState;
	oauthProvider: string;
}) {
	const defaultFg = useDefaultFg();
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<box flexDirection="column" alignItems="center" gap={1}>
				<text fg={defaultFg}>登录 {props.label}</text>

				{!props.authError && (
					<box flexDirection="row" gap={1} justifyContent="center">
						<spinner name="dots" color={palette.act} />
						<text fg="gray">{props.authStatus}</text>
					</box>
				)}

				{props.authError && (
					<box flexDirection="column" alignItems="center" gap={1}>
						<text fg="red">{props.authError}</text>
						<text fg="gray">Esc 返回</text>
					</box>
				)}

				{props.authUrl && !props.authError && (
					<box
						flexDirection="column"
						border
						borderStyle="rounded"
						borderColor="#333333"
						paddingX={2}
						paddingY={1}
						width={props.contentWidth}
					>
						<text fg="gray">如果浏览器未打开:</text>
						<text fg={palette.act} marginTop={1} selectable>
							<a href={props.authUrl}>{props.authUrl}</a>
						</text>
					</box>
				)}

				<text fg="gray">
					<em>Esc 取消, Ctrl+C 退出</em>
				</text>
			</box>
		</OnboardingFrame>
	);
}

export function OnboardingDeviceCodeScreen(props: {
	compact: boolean;
	contentWidth: number;
	deviceError: string;
	deviceStatus: string;
	deviceUserCode: string;
	deviceVerifyUrl: string;
	label: string;
	mouse: MouseTrackerState;
}) {
	const defaultFg = useDefaultFg();
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<box flexDirection="column" alignItems="center" gap={1}>
				<text fg={defaultFg}>登录 {props.label}</text>

				{!props.deviceUserCode && !props.deviceError && (
					<box flexDirection="row" gap={1} justifyContent="center">
						<spinner name="dots" color={palette.act} />
						<text fg="gray">{props.deviceStatus}</text>
					</box>
				)}

				{props.deviceError && (
					<box flexDirection="column" alignItems="center" gap={1}>
						<text fg="red">{props.deviceError}</text>
						<text fg="gray">Esc 返回</text>
					</box>
				)}

				{props.deviceUserCode && !props.deviceError && (
					<box
						flexDirection="column"
						border
						borderStyle="rounded"
						borderColor={palette.act}
						paddingX={2}
						paddingY={1}
						width={props.contentWidth}
						alignItems="center"
						gap={1}
					>
						<text fg="gray">登录码:</text>
						<text fg={defaultFg} selectable>
							<strong>{props.deviceUserCode}</strong>
						</text>
						<text fg="gray" marginTop={1}>
							访问此链接并输入上方的代码。:
						</text>
						<text fg={palette.act} selectable>
							<a href={props.deviceVerifyUrl}>{props.deviceVerifyUrl}</a>
						</text>
					</box>
				)}

				{props.deviceUserCode && !props.deviceError && (
					<box flexDirection="row" gap={1} justifyContent="center">
						<spinner name="dots" color={palette.act} />
						<text fg="gray">等待认证...</text>
					</box>
				)}

				<text fg="gray">
					<em>Esc 取消, Ctrl+C 退出</em>
				</text>
			</box>
		</OnboardingFrame>
	);
}

import type {
	ProviderConfigFieldKey,
	ProviderConfigFieldRequirement,
} from "@coohu/core";

const DEFAULT_FIELD_LABELS: Partial<Record<ProviderConfigFieldKey, string>> = {
	apiKey: "API key",
	baseUrl: "Base URL",
	awsRegion: "AWS Region",
	awsProfile: "AWS Profile Name",
	sapClientId: "Client ID",
	sapClientSecret: "Client Secret",
	sapTokenUrl: "Token URL",
	sapResourceGroup: "Resource Group",
	sapDeploymentId: "Deployment ID",
};

const DEFAULT_FIELD_PLACEHOLDERS: Partial<
	Record<ProviderConfigFieldKey, string>
> = {
	apiKey: "在此粘贴您的 API key...",
	baseUrl: "",
	awsRegion: "us-east-1",
	awsProfile: "default",
	sapClientId: "sb-...|xsuaa_std!b...",
	sapClientSecret: "SAP AI Core client secret",
	sapTokenUrl: "https://<subdomain>.authentication.sap.hana.ondemand.com",
	sapResourceGroup: "default",
	sapDeploymentId: "",
};

export function OnboardingProviderConfigScreen(props: {
	activeProviderName: string;
	compact: boolean;
	contentWidth: number;
	description?: string;
	fields: Partial<
		Record<ProviderConfigFieldKey, ProviderConfigFieldRequirement>
	>;
	focusedField: ProviderConfigFieldKey;
	mouse: MouseTrackerState;
	values: Partial<Record<ProviderConfigFieldKey, string>>;
	onFieldInput: (field: ProviderConfigFieldKey, value: string) => void;
	onSubmit: () => void;
}) {
	const defaultFg = useDefaultFg();
	const visibleFields = FIELD_ORDER.filter(
		(key) => props.fields[key] !== undefined,
	);

	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<box flexDirection="column" gap={1} alignItems="center">
				<text fg={defaultFg}>{props.activeProviderName}</text>

				{props.description && <text fg="gray">{props.description}</text>}

				{visibleFields.map((key) => {
					const requirement = props.fields[key];
					if (!requirement) return null;
					const label = requirement.label ?? DEFAULT_FIELD_LABELS[key] ?? key;
					const placeholder =
						requirement.placeholder ??
						(key === "baseUrl" && requirement.defaultValue
							? requirement.defaultValue
							: (DEFAULT_FIELD_PLACEHOLDERS[key] ?? ""));
					const value = props.values[key] ?? "";
					const isFocused = props.focusedField === key;
					return (
						<box
							key={key}
							flexDirection="column"
							gap={0}
							width={props.contentWidth}
						>
							<text fg="gray">{label}</text>
							{requirement.note && <text fg="gray">{requirement.note}</text>}
							<box
								border
								borderStyle="rounded"
								borderColor={isFocused ? palette.act : "gray"}
								paddingX={1}
							>
								<input
									value={value}
									onInput={(v: string) => props.onFieldInput(key, v)}
									onSubmit={props.onSubmit}
									placeholder={placeholder}
									textColor={defaultFg}
									focusedTextColor={defaultFg}
									cursorColor={defaultFg}
									focused={isFocused}
									flexGrow={1}
								/>
							</box>
						</box>
					);
				})}

				<text fg="gray">
					<em>
						{visibleFields.length > 1
							? "按 T​​ab 切换字段，按 Enter 保存，按 Esc 返回，按 Ctrl+C 退出。"
							: "按 Enter 保存，按 Esc 返回，按 Ctrl+C 退出"}
					</em>
				</text>
			</box>
		</OnboardingFrame>
	);
}

export function OnboardingCodexCliScreen(props: {
	activeProviderName: string;
	checking: boolean;
	compact: boolean;
	contentWidth: number;
	mouse: MouseTrackerState;
	status?: CodexCliStatus;
}) {
	const defaultFg = useDefaultFg();
	const installedStatus =
		props.status?.installed === true ? props.status : undefined;
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<box flexDirection="column" gap={1} alignItems="center">
				<text fg={defaultFg}>{props.activeProviderName}</text>

				{props.checking && (
					<box flexDirection="row" gap={1}>
						<spinner name="dots" color="gray" />
						<text fg="gray">检查 Codex CLI...</text>
					</box>
				)}

				{installedStatus && (
					<box flexDirection="column" gap={1} alignItems="center">
						<text fg={palette.success}>{"\u25cf"} Codex CLI 已安装</text>
						<text fg="gray">{installedStatus.version}</text>
					</box>
				)}

				{props.status && !props.status.installed && (
					<box flexDirection="column" gap={1} width={props.contentWidth}>
						<text fg="yellow">未找到 Codex CLI</text>
						<text fg="gray">{props.status.reason}</text>
						<text fg="gray">从以下位置安装 Codex CLI:</text>
						<text fg="cyan" selectable>
							{CODEX_CLI_INSTALL_URL}
						</text>
					</box>
				)}

				<text fg="gray">
					<em>
						{installedStatus
							? "按 Enter 继续, R 重新检查, Esc 返回, Ctrl+C 退出"
							: "R 重新检查, Esc 返回, Ctrl+C 退出"}
					</em>
				</text>
			</box>
		</OnboardingFrame>
	);
}

export function OnboardingProviderPickerScreen(props: {
	compact: boolean;
	contentWidth: number;
	mouse: MouseTrackerState;
	providerList: SearchableListState;
	providersLoading: boolean;
}) {
	const defaultFg = useDefaultFg();
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<text fg={defaultFg} paddingX={1}>
				选择供应商
			</text>

			{props.providersLoading ? (
				<box flexDirection="row" gap={1} paddingX={1}>
					<spinner name="dots" color="gray" />
					<text fg="gray">加载供应商...</text>
				</box>
			) : (
				<SearchableList
					items={props.providerList.filtered}
					selected={props.providerList.safeSelected}
					onSearchChange={props.providerList.setSearch}
					placeholder="Search providers..."
					emptyText="No providers match"
				/>
			)}

			<text fg="gray" paddingX={1}>
				<em>输入以搜索, ↑/↓ 导航, Enter 选择, Esc 返回, Ctrl+C 退出</em>
			</text>
		</OnboardingFrame>
	);
}

export function OnboardingClineModelScreen(props: {
	clineEntries: ClineModelPickerEntry[];
	clineKnownModels: Record<string, unknown> | undefined;
	clineModelSelected: number;
	compact: boolean;
	contentWidth: number;
	mouse: MouseTrackerState;
	recommendedLoading: boolean;
}) {
	const defaultFg = useDefaultFg();
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<text fg={defaultFg} paddingX={1}>
				<strong>选择一个模型</strong>
			</text>
			<text fg="gray" paddingX={1}>
				你可以随时更改
			</text>

			<ClineModelPicker
				entries={props.clineEntries}
				selected={props.clineModelSelected}
				loading={props.recommendedLoading}
				knownModels={props.clineKnownModels}
			/>

			<text fg="gray" paddingX={1}>
				<em>↑/↓ 导航, Enter 选择, Esc 返回, Ctrl+C 退出</em>
			</text>
		</OnboardingFrame>
	);
}

export function OnboardingModelPickerScreen(props: {
	activeProviderName: string;
	compact: boolean;
	contentWidth: number;
	modelList: SearchableListState;
	modelsLoading: boolean;
	mouse: MouseTrackerState;
	onModelItemSelect: (item: SearchableItem) => void;
}) {
	const defaultFg = useDefaultFg();
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<text fg={defaultFg} paddingX={1}>
				<strong>为 {props.activeProviderName} 选择一个模型</strong>
			</text>
			<text fg="gray" paddingX={1}>
				你可以随时更改
			</text>

			{props.modelsLoading ? (
				<box flexDirection="row" gap={1} paddingX={1}>
					<spinner name="dots" color="gray" />
					<text fg="gray">加载模型...</text>
				</box>
			) : (
				<SearchableList
					items={props.modelList.filtered}
					selected={props.modelList.safeSelected}
					onSearchChange={props.modelList.setSearch}
					onItemSelect={props.onModelItemSelect}
					placeholder="选择模型..."
					emptyText="创建自定义模型 ID 以手动输入"
				/>
			)}

			<text fg="gray" paddingX={1}>
				<em>输入以搜索, ↑/↓ 导航, Enter 选择, Esc 返回, Ctrl+C 退出</em>
			</text>
		</OnboardingFrame>
	);
}

export function OnboardingCustomModelIdScreen(props: {
	activeProviderName: string;
	compact: boolean;
	contentWidth: number;
	error: string;
	mouse: MouseTrackerState;
	onInput: (value: string) => void;
	onSubmit: () => void;
	title: string;
	value: string;
}) {
	const defaultFg = useDefaultFg();
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<text fg={defaultFg} paddingX={1}>
				{props.title}
			</text>
			<text fg="gray" paddingX={1}>
				{props.activeProviderName}
			</text>

			<box flexDirection="column" gap={0} paddingX={1}>
				<text fg="gray">模型 ID</text>
				<box
					border
					borderStyle="rounded"
					borderColor={props.error ? "red" : "gray"}
					paddingX={1}
				>
					<input
						value={props.value}
						onInput={props.onInput}
						onSubmit={props.onSubmit}
						placeholder=""
						textColor={defaultFg}
						focusedTextColor={defaultFg}
						cursorColor={defaultFg}
						flexGrow={1}
						focused
					/>
				</box>
				{props.error && <text fg="red">{props.error}</text>}
			</box>

			<text fg="gray" paddingX={1}>
				<em>Enter 创建, Esc 返回模型选择, Ctrl+C 退出</em>
			</text>
		</OnboardingFrame>
	);
}

export function OnboardingThinkingLevelScreen(props: {
	compact: boolean;
	contentWidth: number;
	mouse: MouseTrackerState;
	selectedModelName: string;
	thinkingSelected: number;
}) {
	const defaultFg = useDefaultFg();
	return (
		<OnboardingFrame
			compact={props.compact}
			contentWidth={props.contentWidth}
			mouse={props.mouse}
		>
			<text fg={defaultFg} paddingX={1}>
				{props.selectedModelName} 思考级别
			</text>
			<text fg="gray" paddingX={1}>
				扩展思考让模型能够推理复杂问题
			</text>

			<box flexDirection="column">
				{THINKING_LEVELS.map((level, i) => {
					const isSel = i === props.thinkingSelected;
					return (
						<box
							key={level.value}
							paddingX={1}
							flexDirection="row"
							gap={1}
							backgroundColor={isSel ? palette.selection : undefined}
							height={1}
						>
							<text
								fg={isSel ? palette.textOnSelection : "gray"}
								flexShrink={0}
							>
								{isSel ? "\u276f" : " "}
							</text>
							<text fg={isSel ? palette.textOnSelection : defaultFg}>
								{level.label}
							</text>
							<text fg={isSel ? palette.textOnSelection : "gray"}>
								{level.desc}
							</text>
						</box>
					);
				})}
			</box>

			<text fg="gray" paddingX={1}>
				<em>↑/↓ 导航, Enter 选择, Esc 返回, Ctrl+C 退出</em>
			</text>
		</OnboardingFrame>
	);
}

export function OnboardingMainMenuScreen(props: {
	contentWidth: number;
	menuSelected: number;
	mouse: MouseTrackerState;
}) {
	const defaultFg = useDefaultFg();
	return (
		<box
			flexDirection="column"
			width="100%"
			height="100%"
			justifyContent="center"
			alignItems="center"
			onMouseMove={props.mouse.onMouseMove}
		>
			<TrackedRobot
				cursorX={props.mouse.cursor.x}
				cursorY={props.mouse.cursor.y}
			/>

			<box
				flexDirection="column"
				width={props.contentWidth}
				alignItems="center"
				marginTop={1}
			>
				<text fg={defaultFg}>
					<strong>欢迎使用 Cline</strong>
				</text>
				<text fg="gray" marginTop={1}>
					连接模型提供商即可开始使用。
				</text>
			</box>

			<box
				flexDirection="column"
				width={props.contentWidth}
				marginTop={1}
				gap={0}
			>
				{MAIN_MENU.map((option, i) => {
					const isSel = i === props.menuSelected;
					return (
						<box
							key={option.value}
							flexDirection="row"
							border
							borderStyle="rounded"
							borderColor={isSel ? palette.act : "#333333"}
							paddingX={1}
							gap={1}
							alignItems="center"
						>
							<text fg={isSel ? palette.act : "#555555"} flexShrink={0}>
								{option.icon}
							</text>
							<box flexDirection="column" flexGrow={1}>
								<text fg={isSel ? defaultFg : "gray"}>{option.label}</text>
								<text fg={isSel ? "gray" : "#555555"}>{option.detail}</text>
							</box>
							{isSel && (
								<text fg={palette.act} flexShrink={0}>
									{"\u2192"}
								</text>
							)}
						</box>
					);
				})}
			</box>

			<text fg="gray" marginTop={1}>
				<em>↑/↓ 导航, Enter 选择, Ctrl+C 退出</em>
			</text>
		</box>
	);
}
