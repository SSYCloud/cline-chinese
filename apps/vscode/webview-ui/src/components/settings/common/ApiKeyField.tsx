import { VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react"
import styled from "styled-components"
import { useDebounceEffect } from "@/utils/useDebounceEffect"

/**
 * A key that can be picked from the dropdown attached to an ApiKeyField.
 */
export interface ApiKeyFieldOption {
	id: string
	label: string
	/** Value written to the field when the option is picked. */
	value: string
	disabled?: boolean
}

/**
 * Optional dropdown configuration that turns the input into a combobox: the
 * key can still be typed, and saved keys can be picked from the list.
 */
export interface ApiKeyFieldOptionsConfig {
	options: ApiKeyFieldOption[]
	/** Called when an option is picked. Falls back to `onChange` with the option value. */
	onSelect?: (value: string, option: ApiKeyFieldOption) => void
	/** Value of the option to mark as selected. Defaults to the field's current value. */
	value?: string
	/** Disables the picker, e.g. while a key switch is in flight. */
	disabled?: boolean
	loading?: boolean
	loadingText?: string
	error?: string | null
	hint?: string
}

/**
 * Props for the ApiKeyField component
 */
interface ApiKeyFieldProps {
	initialValue: string
	onChange: (value: string) => void
	providerName: string
	signupUrl?: string
	placeholder?: string
	helpText?: string
	label?: string
	loginBtn?: ReactNode
	/** When provided, a dropdown of selectable keys is attached to the input. */
	keyOptions?: ApiKeyFieldOptionsConfig
}

const STATUS_TEXT_STYLE: CSSProperties = {
	fontSize: "12px",
	marginTop: 3,
	color: "var(--vscode-descriptionForeground)",
}

/**
 * A reusable component for API key input fields with standard styling and help text for signing up for key.
 *
 * Pass `keyOptions` to let the user either type a key or pick one of the saved
 * keys from a dropdown attached to the input. Without it the field behaves
 * exactly as before.
 */
export const ApiKeyField = ({
	initialValue,
	onChange,
	providerName,
	signupUrl,
	placeholder = "输入 API 密钥...",
	helpText,
	label = `${providerName} API 密钥`,
	keyOptions,
}: ApiKeyFieldProps) => {
	const [localValue, setLocalValue] = useState(initialValue)
	const [isOptionsOpen, setIsOptionsOpen] = useState(false)
	const isFocusedRef = useRef(false)
	const hasPendingUserEditRef = useRef(false)
	const prevInitialValueRef = useRef(initialValue)
	const pickerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (prevInitialValueRef.current === initialValue) {
			return
		}

		prevInitialValueRef.current = initialValue

		// API key saves can update the masked initial value while the user is still typing.
		// Do not replace their in-progress input with the new mask, or subsequent saves only
		// persist the suffix typed after that rerender.
		if (!isFocusedRef.current) {
			hasPendingUserEditRef.current = false
			setLocalValue(initialValue)
		}
	}, [initialValue])

	useEffect(() => {
		if (!isOptionsOpen) {
			return
		}

		const handleClickOutside = (event: MouseEvent) => {
			if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
				setIsOptionsOpen(false)
			}
		}

		document.addEventListener("mousedown", handleClickOutside)
		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [isOptionsOpen])

	useDebounceEffect(
		() => {
			if (!hasPendingUserEditRef.current) {
				return
			}

			hasPendingUserEditRef.current = false
			onChange(localValue)
		},
		100,
		[localValue],
	)

	const hasSelectableOptions = (keyOptions?.options.length ?? 0) > 0
	const isPickerDisabled = !!(keyOptions?.disabled || keyOptions?.loading)
	const selectedOptionValue = keyOptions?.value ?? localValue

	const handleSelectOption = (option: ApiKeyFieldOption) => {
		if (option.disabled) {
			return
		}

		// Picking a key writes it directly, so drop any pending typed edit instead
		// of also routing the selection through the debounced `onChange`.
		hasPendingUserEditRef.current = false
		setLocalValue(option.value)
		setIsOptionsOpen(false)

		if (keyOptions?.onSelect) {
			keyOptions.onSelect(option.value, option)
		} else {
			onChange(option.value)
		}
	}

	const textField = (
		<VSCodeTextField
			onBlur={() => {
				isFocusedRef.current = false
			}}
			onFocus={() => {
				isFocusedRef.current = true
			}}
			onInput={(e) => {
				hasPendingUserEditRef.current = true
				setLocalValue((e.target as HTMLInputElement | null)?.value ?? "")
			}}
			onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
				if (event.key === "Escape") {
					setIsOptionsOpen(false)
				}
			}}
			placeholder={placeholder}
			required={true}
			style={{ width: "100%" }}
			type="password"
			value={localValue}>
			<span style={{ fontWeight: 500 }}>{label}</span>
			{hasSelectableOptions && (
				<button
					aria-expanded={isOptionsOpen}
					aria-haspopup="listbox"
					aria-label={isOptionsOpen ? "收起可选的 API 密钥" : "展开可选的 API 密钥"}
					className={`input-icon-button codicon ${isOptionsOpen ? "codicon-chevron-up" : "codicon-chevron-down"}`}
					onClick={() => {
						if (!isPickerDisabled) {
							setIsOptionsOpen((open) => !open)
						}
					}}
					slot="end"
					style={{
						display: "flex",
						justifyContent: "center",
						alignItems: "center",
						height: "100%",
						padding: 0,
						border: "none",
						background: "transparent",
						color: "inherit",
					}}
					type="button"
				/>
			)}
		</VSCodeTextField>
	)

	return (
		<div>
			{hasSelectableOptions ? (
				<PickerWrapper ref={pickerRef}>
					{textField}
					{isOptionsOpen && (
						<DropdownList aria-label="可选的 API 密钥" role="listbox">
							{keyOptions?.options.map((option) => {
								const isSelected = option.value === selectedOptionValue
								return (
									<DropdownItem
										$disabled={!!option.disabled}
										$selected={isSelected}
										aria-disabled={option.disabled || undefined}
										aria-selected={isSelected}
										key={option.id}
										onClick={() => handleSelectOption(option)}
										role="option">
										<span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
											{option.label}
										</span>
										{isSelected && <span className="codicon codicon-check" />}
									</DropdownItem>
								)
							})}
						</DropdownList>
					)}
				</PickerWrapper>
			) : (
				textField
			)}
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				{helpText || "此密钥仅存储在本地，仅用于从此扩展发起 API 请求。"}
				{/* {!localValue && signupUrl && ( */}
				<VSCodeLink
					href={signupUrl}
					style={{
						display: "inline",
						fontSize: "inherit",
					}}>
					你可以在此注册获取 {providerName} API 密钥。
				</VSCodeLink>
				{/*  )} */}
			</p>
			{keyOptions?.loading && <p style={STATUS_TEXT_STYLE}>{keyOptions.loadingText ?? "正在加载可选的 API 密钥..."}</p>}
			{keyOptions?.error && (
				<p
					role="alert"
					style={{
						...STATUS_TEXT_STYLE,
						color: "var(--vscode-errorForeground)",
					}}>
					{keyOptions.error}
				</p>
			)}
			{!keyOptions?.loading && !keyOptions?.error && keyOptions?.hint && <p style={STATUS_TEXT_STYLE}>{keyOptions.hint}</p>}
		</div>
	)
}

const PickerWrapper = styled.div`
	position: relative;
	width: 100%;
`

const DropdownList = styled.div`
	position: absolute;
	top: calc(100% - 3px);
	left: 0;
	width: calc(100% - 2px);
	max-height: 200px;
	overflow-y: auto;
	background-color: var(--vscode-dropdown-background);
	border: 1px solid var(--vscode-list-activeSelectionBackground);
	border-bottom-left-radius: 3px;
	border-bottom-right-radius: 3px;
	z-index: 1000;
`

const DropdownItem = styled.div<{ $selected: boolean; $disabled: boolean }>`
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 5px 10px;
	word-break: break-all;
	white-space: normal;
	cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
	opacity: ${({ $disabled }) => ($disabled ? 0.5 : 1)};
	background-color: ${({ $selected }) => ($selected ? "var(--vscode-list-activeSelectionBackground)" : "inherit")};
	color: ${({ $selected }) => ($selected ? "var(--vscode-list-activeSelectionForeground, inherit)" : "inherit")};

	&:hover {
		background-color: ${({ $disabled }) => ($disabled ? "inherit" : "var(--vscode-list-activeSelectionBackground)")};
		color: ${({ $disabled }) => ($disabled ? "inherit" : "var(--vscode-list-activeSelectionForeground, inherit)")};
	}
`
