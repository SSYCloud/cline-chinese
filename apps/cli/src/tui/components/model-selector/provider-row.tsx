// @jsxImportSource @opentui/react
import { useDialogPalette } from "../../hooks/use-theme";

export function ProviderRow({
	providerName,
	focused,
}: {
	providerName: string;
	focused: boolean;
}) {
	const palette = useDialogPalette();
	return (
		<box flexDirection="row" paddingX={1} gap={1}>
			<text fg={focused ? palette.selection : "gray"} flexShrink={0}>
				{focused ? "❯" : " "}
			</text>
			<text fg={focused ? palette.selection : palette.act} flexShrink={0}>
				提供商：
			</text>
			<text fg="white">{providerName}</text>
			{!focused && (
				<text fg="gray" flexShrink={0}>
					（按 Tab 切换提供商）
				</text>
			)}
			{focused && (
				<text fg="gray" flexShrink={0}>
					<em>按 Enter 切换</em>
				</text>
			)}
		</box>
	);
}
