import type { Meta } from "@storybook/react-vite"
import { Switch } from "./switch"

const meta: Meta<typeof Switch> = {
	title: "Ui/Switch",
	component: Switch,
	parameters: {
		docs: {
			description: {
				component:
					"一款用于切换二元“开启/关闭”状态的拨动开关组件。基于 Radix UI 构建，具备流畅的动画效果及键盘无障碍支持。",
			},
		},
	},
}

export default meta

export const Default = () => (
	<div className="w-screen flex justify-center items-center">
		<div className="flex flex-col gap-6 w-full max-w-md px-4">
			<div className="flex items-center justify-between">
				<label className="text-sm font-medium cursor-pointer" htmlFor="switch-1">
					默认开关（未选中）
				</label>
				<Switch id="switch-1" />
			</div>

			<div className="flex items-center justify-between">
				<label className="text-sm font-medium cursor-pointer" htmlFor="switch-2">
					选中开关
				</label>
				<Switch defaultChecked id="switch-2" />
			</div>

			<div className="flex items-center justify-between">
				<label className="text-sm font-medium cursor-not-allowed opacity-50" htmlFor="switch-3">
					禁用开关
				</label>
				<Switch disabled id="switch-3" />
			</div>

			<div className="flex items-center justify-between">
				<label className="text-sm font-medium cursor-not-allowed opacity-50" htmlFor="switch-4">
					禁用选中开关
				</label>
				<Switch defaultChecked disabled id="switch-4" />
			</div>

			<div className="space-y-2 p-4 bg-accent/20 rounded-sm">
				<h4 className="text-sm font-medium">设置示例</h4>
				<div className="flex items-center justify-between">
					<div className="space-y-0.5">
						<label className="text-sm font-medium cursor-pointer" htmlFor="notifications">
							启用通知
						</label>
						<div className="text-xs text-muted-foreground">接收关于您账户活动的更新</div>
					</div>
					<Switch id="notifications" />
				</div>
			</div>
		</div>
	</div>
)
