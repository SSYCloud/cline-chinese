"use client";

import {
	ArrowLeft,
	ChevronDown,
	Copy,
	Eye,
	EyeOff,
	Plus,
	Trash2,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const CAPABILITY_OPTIONS = [
	"streaming",
	"tools",
	"reasoning",
	"vision",
	"prompt-cache",
] as const;

type Capability = (typeof CAPABILITY_OPTIONS)[number];

export interface AddProviderPayload {
	providerId: string;
	name: string;
	baseUrl: string;
	apiKey?: string;
	headers?: Record<string, string>;
	timeoutMs?: number;
	models: string[];
	defaultModelId?: string;
	modelsSourceUrl?: string;
	capabilities?: Capability[];
}

interface NewProviderForm {
	providerId: string;
	name: string;
	models: string[];
	defaultModel: string;
	apiKey: string;
	baseUrl: string;
	modelsSourceUrl: string;
	headers: Record<string, string>;
	timeoutMs: string;
	capabilities: Capability[];
}

export function AddProviderContent({
	onBack,
	onSave,
	existingProviderIds,
}: {
	onBack: () => void;
	onSave: (payload: AddProviderPayload) => Promise<void>;
	existingProviderIds: string[];
}) {
	const [form, setForm] = useState<NewProviderForm>({
		providerId: "",
		name: "",
		models: [],
		defaultModel: "",
		apiKey: "",
		baseUrl: "",
		modelsSourceUrl: "",
		headers: {},
		timeoutMs: "",
		capabilities: ["streaming", "tools"],
	});
	const [modelInput, setModelInput] = useState("");
	const [showApiKey, setShowApiKey] = useState(false);
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const normalizedProviderId = useMemo(
		() => form.providerId.trim().toLowerCase().replace(/\s+/g, "-"),
		[form.providerId],
	);

	const duplicateProviderId =
		existingProviderIds.includes(normalizedProviderId);
	const hasManual模型 = form.models.length > 0;
	const has模型Source = form.modelsSourceUrl.trim().length > 0;
	const canSave =
		normalizedProviderId.length > 0 &&
		form.name.trim().length > 0 &&
		form.baseUrl.trim().length > 0 &&
		(hasManual模型 || has模型Source) &&
		!duplicateProviderId;

	const handleAddModel = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if ((e.key === "Enter" || e.key === ",") && modelInput.trim()) {
			e.preventDefault();
			const value = modelInput.trim().replace(/,/g, "");
			if (value && !form.models.includes(value)) {
				setForm((prev) => ({
					...prev,
					models: [...prev.models, value],
					defaultModel: prev.defaultModel || value,
				}));
			}
			setModelInput("");
		} else if (e.key === "Backspace" && !modelInput && form.models.length > 0) {
			setForm((prev) => ({
				...prev,
				models: prev.models.slice(0, -1),
			}));
		}
	};

	const removeModel = (model: string) => {
		setForm((prev) => {
			const next模型 = prev.models.filter((m) => m !== model);
			return {
				...prev,
				models: next模型,
				defaultModel:
					prev.defaultModel === model ? (next模型[0] ?? "") : prev.defaultModel,
			};
		});
	};

	const toggleCapability = (cap: Capability) => {
		setForm((prev) => ({
			...prev,
			capabilities: prev.capabilities.includes(cap)
				? prev.capabilities.filter((c) => c !== cap)
				: [...prev.capabilities, cap],
		}));
	};

	const addHeader = () => {
		setForm((prev) => ({ ...prev, headers: { ...prev.headers, "": "" } }));
	};

	const updateHeaderKey = (oldKey: string, newKey: string, idx: number) => {
		const entries = Object.entries(form.headers);
		const next: Record<string, string> = {};
		entries.forEach(([key, value], index) => {
			next[index === idx ? newKey : key] = value;
		});
		if (oldKey !== newKey) {
			delete next[oldKey];
		}
		setForm((prev) => ({ ...prev, headers: next }));
	};

	const updateHeaderValue = (key: string, value: string) => {
		setForm((prev) => ({
			...prev,
			headers: { ...prev.headers, [key]: value },
		}));
	};

	const removeHeader = (key: string) => {
		const next = { ...form.headers };
		delete next[key];
		setForm((prev) => ({ ...prev, headers: next }));
	};

	const handleSave = async () => {
		if (!canSave || saving) {
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await onSave({
				providerId: normalizedProviderId,
				name: form.name.trim(),
				baseUrl: form.baseUrl.trim(),
				apiKey: form.apiKey.trim() || undefined,
				headers: Object.fromEntries(
					Object.entries(form.headers)
						.map(([key, value]) => [key.trim(), value])
						.filter(([key]) => key.length > 0),
				),
				timeoutMs:
					form.timeoutMs.trim().length > 0
						? Number.parseInt(form.timeoutMs.trim(), 10)
						: undefined,
				models: form.models,
				defaultModelId: form.defaultModel || form.models[0],
				modelsSourceUrl: form.modelsSourceUrl.trim() || undefined,
				capabilities:
					form.capabilities.length > 0 ? form.capabilities : undefined,
			});
		} catch (saveError) {
			setError(
				saveError instanceof Error ? saveError.message : String(saveError),
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<ScrollArea className="h-full">
			<div className="mx-auto max-w-3xl px-8 py-6">
				<div className="mb-6 flex items-center gap-3">
					<Button
						onClick={onBack}
						variant="secondary"
						className="rounded-md p-1.5 transition-colors"
						aria-label="返回提供商列表"
					>
						<ArrowLeft className="h-4 w-4" />
					</Button>
					<h2 className="text-lg font-semibold text-foreground">添加提供商</h2>
				</div>

				<div className="flex flex-col gap-6">
					<div className="rounded-lg border border-border p-5">
						<h3 className="mb-4 text-sm font-semibold text-foreground">
							OpenAI 兼容提供商
						</h3>
						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<div>
								<Label className="mb-2 block text-xs font-medium text-muted-foreground">
									提供商 ID
								</Label>
								<input
									type="text"
									value={form.providerId}
									onChange={(e) =>
										setForm((prev) => ({ ...prev, providerId: e.target.value }))
									}
									placeholder="my-provider"
									className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
								/>
								<p className="mt-1.5 text-xs text-muted-foreground">
									用于提供商注册的小写 ID。
								</p>
								{duplicateProviderId ? (
									<p className="mt-1 text-xs text-destructive">
										此提供商 ID 已存在。
									</p>
								) : null}
							</div>
							<div>
								<Label className="mb-2 block text-xs font-medium text-muted-foreground">
									提供商名称
								</Label>
								<input
									type="text"
									value={form.name}
									onChange={(e) =>
										setForm((prev) => ({ ...prev, name: e.target.value }))
									}
									placeholder="My Provider"
									className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
								/>
							</div>
						</div>
					</div>

					<div className="rounded-lg border border-border p-5">
						<Label className="mb-2 block text-xs font-medium text-muted-foreground">
							基础 URL
						</Label>
						<input
							type="url"
							value={form.baseUrl}
							onChange={(e) =>
								setForm((prev) => ({ ...prev, baseUrl: e.target.value }))
							}
							placeholder="https://api.example.com/v1"
							className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
						/>
					</div>

					<div className="rounded-lg border border-border p-5">
						<Label className="mb-2 block text-xs font-medium text-muted-foreground">
							模型来源 URL（可选）
						</Label>
						<input
							type="url"
							value={form.modelsSourceUrl}
							onChange={(e) =>
								setForm((prev) => ({
									...prev,
									modelsSourceUrl: e.target.value,
								}))
							}
							placeholder="https://api.example.com/v1/models"
							className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
						/>
						<p className="mt-1.5 text-xs text-muted-foreground">
							支持的 JSON：OpenAI `/models` 格式（包含 `data`
							数组），或直接的模型数组。
						</p>
					</div>

					<div className="rounded-lg border border-border p-5">
						<Label className="mb-2 block text-xs font-medium text-muted-foreground">
							模型
						</Label>
						<div className="flex min-h-11 flex-wrap content-start gap-1.5 rounded-lg border border-border bg-input px-3 py-2 focus-within:ring-1 focus-within:ring-ring">
							{form.models.map((model) => (
								<span
									key={model}
									className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary"
								>
									<span className="font-mono">{model}</span>
									<Button
										onClick={() => removeModel(model)}
										className="text-primary/60 hover:text-primary transition-colors"
										aria-label={`移除 ${model}`}
									>
										<X className="h-3 w-3" />
									</Button>
								</span>
							))}
							<input
								type="text"
								value={modelInput}
								onChange={(e) => setModelInput(e.target.value)}
								onKeyDown={handleAddModel}
								placeholder={
									form.models.length === 0 ? "输入模型 ID 后按回车" : ""
								}
								className="min-w-35 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none"
							/>
						</div>
						<p className="mt-1.5 text-xs text-muted-foreground">
							至少添加一个模型或设置模型来源 URL。
						</p>
					</div>

					{form.models.length > 1 ? (
						<div className="rounded-lg border border-border p-5">
							<Label className="mb-2 block text-xs font-medium text-muted-foreground">
								默认模型
							</Label>
							<select
								value={form.defaultModel}
								onChange={(e) =>
									setForm((prev) => ({ ...prev, defaultModel: e.target.value }))
								}
								className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
							>
								{form.models.map((model) => (
									<option key={model} value={model}>
										{model}
									</option>
								))}
							</select>
						</div>
					) : null}

					<div className="rounded-lg border border-border p-5">
						<Label className="mb-2 block text-xs font-medium text-muted-foreground">
							API 密钥（可选）
						</Label>
						<div className="relative">
							<input
								type={showApiKey ? "text" : "password"}
								value={form.apiKey}
								onChange={(e) =>
									setForm((prev) => ({ ...prev, apiKey: e.target.value }))
								}
								placeholder="sk-..."
								className="w-full rounded-lg border border-border bg-input px-3 py-2 pr-20 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
							/>
							<div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
								<Button
									onClick={() => setShowApiKey(!showApiKey)}
									variant="ghost"
									className="rounded-md p-1 transition-colors"
									aria-label={showApiKey ? "隐藏 API 密钥" : "显示 API 密钥"}
								>
									{showApiKey ? (
										<EyeOff className="h-4 w-4" />
									) : (
										<Eye className="h-4 w-4" />
									)}
								</Button>
								<Button
									onClick={() => navigator.clipboard.writeText(form.apiKey)}
									variant="ghost"
									className="rounded-md p-1 transition-colors"
									aria-label="复制 API 密钥"
								>
									<Copy className="h-4 w-4" />
								</Button>
							</div>
						</div>
					</div>

					<div className="rounded-lg border border-border p-5">
						<Label className="mb-3 block text-xs font-medium text-muted-foreground">
							能力
						</Label>
						<div className="flex flex-wrap gap-2">
							{CAPABILITY_OPTIONS.map((cap) => (
								<Button
									key={cap}
									onClick={() => toggleCapability(cap)}
									className={cn(
										"rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
										form.capabilities.includes(cap)
											? "border-primary/40 bg-primary/10 text-primary"
											: "border-border bg-card text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground",
									)}
								>
									{cap.replace(/-/g, " ")}
								</Button>
							))}
						</div>
					</div>

					<div className="rounded-lg border border-border overflow-hidden">
						<Button
							onClick={() => setShowAdvanced(!showAdvanced)}
							className="flex w-full items-center justify-between px-5 py-4 text-sm font-medium transition-colors text-foreground/40"
							variant="ghost"
						>
							高级设置
							<ChevronDown
								className={cn(
									"h-4 w-4 text-muted-foreground transition-transform",
									showAdvanced && "rotate-180",
								)}
							/>
						</Button>

						{showAdvanced ? (
							<div className="border-t border-border px-5 py-5 flex flex-col gap-5">
								<div>
									<Label className="mb-2 block text-xs font-medium text-muted-foreground">
										超时（毫秒）
									</Label>
									<input
										type="number"
										value={form.timeoutMs}
										onChange={(e) =>
											setForm((prev) => ({
												...prev,
												timeoutMs: e.target.value,
											}))
										}
										placeholder="30000"
										className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
									/>
								</div>

								<div>
									<Label className="mb-2 block text-xs font-medium text-muted-foreground">
										自定义请求头
									</Label>
									<div className="flex flex-col gap-2">
										{Object.entries(form.headers).map(([key, value], idx) => (
											<div key={key} className="flex items-center gap-2">
												<input
													type="text"
													value={key}
													onChange={(e) =>
														updateHeaderKey(key, e.target.value, idx)
													}
													placeholder="请求头名称"
													className="flex-1 rounded-lg border border-border bg-input px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
												/>
												<input
													type="text"
													value={value}
													onChange={(e) =>
														updateHeaderValue(key, e.target.value)
													}
													placeholder="值"
													className="flex-1 rounded-lg border border-border bg-input px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
												/>
												<Button
													onClick={() => removeHeader(key)}
													className="rounded-md p-2 text-muted-foreground hover:text-destructive transition-colors"
													aria-label="移除请求头"
												>
													<Trash2 className="h-4 w-4" />
												</Button>
											</div>
										))}
										<Button
											onClick={addHeader}
											className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-fit"
										>
											<Plus className="h-3 w-3" />
											添加请求头
										</Button>
									</div>
								</div>
							</div>
						) : null}
					</div>

					{error ? <p className="text-sm text-destructive">{error}</p> : null}

					<div className="flex items-center justify-end gap-3 pt-2">
						<Button
							onClick={onBack}
							className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
						>
							取消
						</Button>
						<Button
							onClick={() => void handleSave()}
							disabled={!canSave || saving}
							className={cn(
								"rounded-lg px-4 py-2 text-sm font-medium transition-colors",
								canSave && !saving
									? "bg-primary text-primary-foreground hover:bg-primary/90"
									: "bg-muted text-muted-foreground cursor-not-allowed",
							)}
						>
							{saving ? "保存中..." : "添加提供商"}
						</Button>
					</div>
				</div>
			</div>
		</ScrollArea>
	);
}
