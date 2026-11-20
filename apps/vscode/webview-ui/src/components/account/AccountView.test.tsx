import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ClineAuthProvider, useClineAuth } from "@/context/ClineAuthContext"
import AccountView from "./AccountView"

vi.mock("./CreditBalance", () => ({
	CreditBalance: ({ balance }: { balance: number | null }) => (
		<div data-testid="credit-balance">{balance ?? "unavailable"}</div>
	),
}))

const mocks = vi.hoisted(() => ({
	setUserOrganization: vi.fn(),
	getUserCredits: vi.fn(),
	getOrganizationCredits: vi.fn(),
	getUserOrganizations: vi.fn(),
	subscribeToAuthStatusUpdate: vi.fn(),
	accountLoginClicked: vi.fn(),
	shengSuanYunLoginClicked: vi.fn(),
	shengSuanYunUserData: vi.fn(),
	getPersonalProjects: vi.fn(),
	getEnterpriseAccounts: vi.fn(),
	userInfo: undefined as { uid: string; displayName: string; email: string; balance: number } | undefined,
	setUserInfo: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		remoteConfigSettings: {},
		environment: "production",
		cloudSessionsEnabled: false,
		userInfo: mocks.userInfo,
		setUserInfo: mocks.setUserInfo,
	}),
}))

vi.mock("@/hooks/useClinePassPromo", () => ({
	useClinePassPromo: () => ({ isClinePassEnabled: false }),
}))

vi.mock("@/services/grpc-client", () => ({
	AccountServiceClient: {
		setUserOrganization: mocks.setUserOrganization,
		getUserCredits: mocks.getUserCredits,
		getOrganizationCredits: mocks.getOrganizationCredits,
		getUserOrganizations: mocks.getUserOrganizations,
		subscribeToAuthStatusUpdate: mocks.subscribeToAuthStatusUpdate,
		accountLoginClicked: mocks.accountLoginClicked,
		shengSuanYunLoginClicked: mocks.shengSuanYunLoginClicked,
		shengSuanYunUserData: mocks.shengSuanYunUserData,
		getPersonalProjects: mocks.getPersonalProjects,
		getEnterpriseAccounts: mocks.getEnterpriseAccounts,
	},
	StateServiceClient: { updateSettings: vi.fn() },
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeLink: ({ children, ...props }: any) => <a {...props}>{children}</a>,
	VSCodeButton: ({ children, ...props }: any) => <button {...props}>{children}</button>,
	VSCodeDivider: () => <hr />,
	VSCodeTag: ({ children }: any) => <span>{children}</span>,
	VSCodeDropdown: ({ currentValue, disabled, onChange, children, ...props }: any) => (
		<select aria-label={props["aria-label"]} disabled={disabled} onChange={onChange} value={currentValue}>
			{children}
		</select>
	),
	VSCodeOption: ({ value, children }: any) => <option value={value}>{children}</option>,
}))

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((done, fail) => {
		resolve = done
		reject = fail
	})
	return { promise, resolve, reject }
}

const user = { uid: "user-1", email: "user@example.com", displayName: "User", appBaseUrl: "https://app.cline.bot" }
const organization = { active: true, memberId: "member-1", name: "Organization", organizationId: "org-1", roles: ["member"] }

function ConnectedAccountView({ visible = true }: { visible?: boolean }) {
	const { clineUser, organizations, activeOrganization } = useClineAuth()
	return visible ? (
		<AccountView
			activeOrganization={activeOrganization}
			clineUser={clineUser}
			onDone={vi.fn()}
			organizations={organizations}
		/>
	) : null
}

async function renderAccount() {
	const view = render(
		<ClineAuthProvider>
			<ConnectedAccountView />
		</ClineAuthProvider>,
	)
	await waitFor(() => expect((screen.getByLabelText("Account") as HTMLSelectElement).value).toBe(organization.organizationId))
	return view
}

describe("AccountView organization switch", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.userInfo = undefined
		mocks.getUserCredits.mockResolvedValue({ balance: { currentBalance: 1 }, usageTransactions: [], paymentTransactions: [] })
		mocks.getOrganizationCredits.mockResolvedValue({ balance: { currentBalance: 2 }, usageTransactions: [] })
		mocks.getUserOrganizations.mockResolvedValue({ organizations: [organization] })
		mocks.subscribeToAuthStatusUpdate.mockImplementation((_request, callbacks) => {
			callbacks.onResponse({ user })
			return vi.fn()
		})
	})

	it("disables the dropdown until the server answers, then reverts and reports a refused switch", async () => {
		const switching = deferred<Record<string, never>>()
		mocks.setUserOrganization.mockReturnValue(switching.promise)
		await renderAccount()
		const dropdown = screen.getByLabelText("Account") as HTMLSelectElement
		await waitFor(() => expect(dropdown.disabled).toBe(false))

		fireEvent.change(dropdown, { target: { value: user.uid } })

		expect(mocks.setUserOrganization).toHaveBeenCalledWith({ organizationId: undefined })
		expect(dropdown.value).toBe(user.uid)
		expect(dropdown.disabled).toBe(true)
		expect(screen.getByLabelText("Switching account")).toBeInTheDocument()

		await act(async () => {
			switching.reject(new Error("Cloud session cleanup is still pending."))
		})

		expect(dropdown.value).toBe(organization.organizationId)
		expect(dropdown.disabled).toBe(false)
		expect(screen.getByRole("alert")).toHaveTextContent(
			"Could not confirm account switch: Cloud session cleanup is still pending.",
		)
	})

	it("loads the new account's credits only after the server has switched", async () => {
		const switching = deferred<Record<string, never>>()
		mocks.setUserOrganization.mockReturnValue(switching.promise)
		await renderAccount()
		const dropdown = screen.getByLabelText("Account") as HTMLSelectElement
		await waitFor(() => expect(dropdown.disabled).toBe(false))
		mocks.getUserCredits.mockClear()

		fireEvent.change(dropdown, { target: { value: user.uid } })
		expect(mocks.getUserCredits).not.toHaveBeenCalled()
		expect(screen.getByTestId("credit-balance")).toHaveTextContent("unavailable")

		await act(async () => {
			mocks.getUserOrganizations.mockResolvedValue({ organizations: [{ ...organization, active: false }] })
			switching.resolve({})
		})

		await waitFor(() => expect(mocks.getUserCredits).toHaveBeenCalledOnce())
		expect(dropdown.value).toBe(user.uid)
		expect(dropdown.disabled).toBe(false)
		expect(screen.queryByRole("alert")).toBeNull()
	})

	it("keeps a switch pending across Account navigation and uses confirmed state after a partial failure", async () => {
		const switching = deferred<Record<string, never>>()
		mocks.setUserOrganization.mockReturnValue(switching.promise)
		const view = await renderAccount()
		fireEvent.change(screen.getByLabelText("Account"), { target: { value: user.uid } })
		view.rerender(
			<ClineAuthProvider>
				<ConnectedAccountView visible={false} />
			</ClineAuthProvider>,
		)
		view.rerender(
			<ClineAuthProvider>
				<ConnectedAccountView />
			</ClineAuthProvider>,
		)
		expect(screen.getByLabelText("Account")).toBeDisabled()
		await act(async () => {
			mocks.getUserOrganizations.mockResolvedValue({ organizations: [{ ...organization, active: false }] })
			switching.reject(new Error("Remote config failed after switching"))
		})
		expect(screen.getByLabelText("Account")).toHaveValue(user.uid)
		expect(screen.getByLabelText("Account")).not.toBeDisabled()
		expect(mocks.setUserOrganization).toHaveBeenCalledOnce()
	})

	it("ignores old-account credits that arrive after a switch", async () => {
		const oldCredits = deferred<{ balance: { currentBalance: number }; usageTransactions: [] }>()
		mocks.getOrganizationCredits.mockReturnValue(oldCredits.promise)
		mocks.setUserOrganization.mockImplementation(async () => {
			mocks.getUserOrganizations.mockResolvedValue({ organizations: [{ ...organization, active: false }] })
		})
		await renderAccount()
		fireEvent.change(screen.getByLabelText("Account"), { target: { value: user.uid } })
		await waitFor(() => expect(screen.getByTestId("credit-balance")).toHaveTextContent("1"))
		await act(async () => {
			oldCredits.resolve({ balance: { currentBalance: 999 }, usageTransactions: [] })
		})
		expect(screen.getByTestId("credit-balance")).toHaveTextContent("1")
	})

	it("keeps the last account and reports a failed confirmation read", async () => {
		await renderAccount()
		mocks.setUserOrganization.mockResolvedValue({})
		mocks.getUserOrganizations.mockRejectedValue(new Error("offline"))
		fireEvent.change(screen.getByLabelText("Account"), { target: { value: user.uid } })
		await waitFor(() => expect(screen.getByLabelText("Account")).not.toBeDisabled())
		expect(screen.getByLabelText("Account")).toHaveValue(organization.organizationId)
		expect(screen.getByRole("alert")).toHaveTextContent("Could not confirm the active account")
	})
})

const ssyUser = { uid: "ssy-1", displayName: "胜算用户", email: "ssy@example.com", balance: 12.5 }

function ConnectedAccountSwitcher() {
	const { clineUser, organizations, activeOrganization } = useClineAuth()
	return (
		<AccountView
			activeOrganization={activeOrganization}
			clineUser={clineUser}
			onDone={vi.fn()}
			organizations={organizations}
		/>
	)
}

function renderSwitcher() {
	return render(
		<ClineAuthProvider>
			<ConnectedAccountSwitcher />
		</ClineAuthProvider>,
	)
}

describe("AccountView account type switcher", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.userInfo = undefined
		mocks.getUserCredits.mockResolvedValue({ balance: { currentBalance: 1 }, usageTransactions: [], paymentTransactions: [] })
		mocks.getOrganizationCredits.mockResolvedValue({ balance: { currentBalance: 2 }, usageTransactions: [] })
		mocks.getUserOrganizations.mockResolvedValue({ organizations: [organization] })
		mocks.subscribeToAuthStatusUpdate.mockImplementation((_request, callbacks) => {
			callbacks.onResponse({ user })
			return vi.fn()
		})
		mocks.shengSuanYunUserData.mockResolvedValue({ usageTransactions: [], paymentTransactions: [], user: undefined })
		mocks.getPersonalProjects.mockResolvedValue({ projects: [] })
		mocks.getEnterpriseAccounts.mockResolvedValue({ accounts: [] })
		mocks.accountLoginClicked.mockResolvedValue({ value: "" })
		mocks.shengSuanYunLoginClicked.mockResolvedValue({ value: "" })
	})

	it("shows the Cline account first and switches to a logged-in Shengsuanyun account without signing out", async () => {
		mocks.userInfo = ssyUser
		renderSwitcher()
		await waitFor(() => expect(screen.getByRole("heading", { name: user.displayName })).toBeInTheDocument())
		mocks.shengSuanYunUserData.mockClear()

		fireEvent.change(screen.getByLabelText("Account type"), { target: { value: "ssy" } })

		expect(await screen.findByRole("heading", { name: ssyUser.displayName })).toBeInTheDocument()
		expect(screen.queryByRole("heading", { name: user.displayName })).toBeNull()
		expect(mocks.shengSuanYunUserData).toHaveBeenCalledOnce()
		expect(mocks.shengSuanYunLoginClicked).not.toHaveBeenCalled()
		expect(mocks.accountLoginClicked).not.toHaveBeenCalled()
		expect(mocks.setUserOrganization).not.toHaveBeenCalled()

		fireEvent.change(screen.getByLabelText("Account type"), { target: { value: "cline" } })

		expect(await screen.findByRole("heading", { name: user.displayName })).toBeInTheDocument()
		expect(screen.queryByRole("heading", { name: ssyUser.displayName })).toBeNull()
		expect(mocks.accountLoginClicked).not.toHaveBeenCalled()
	})

	it("starts Shengsuanyun sign-in and shows its login prompt when switching to a logged-out account", async () => {
		renderSwitcher()
		await waitFor(() => expect(screen.getByRole("heading", { name: user.displayName })).toBeInTheDocument())

		fireEvent.change(screen.getByLabelText("Account type"), { target: { value: "ssy" } })

		await waitFor(() => expect(mocks.shengSuanYunLoginClicked).toHaveBeenCalledOnce())
		expect(mocks.accountLoginClicked).not.toHaveBeenCalled()
		expect(screen.getByRole("button", { name: "登录 胜算云" })).toBeInTheDocument()
		expect(screen.queryByRole("heading", { name: user.displayName })).toBeNull()
		expect(screen.getByLabelText("Account type")).toHaveValue("ssy")
	})

	it("starts Cline sign-in and shows its login prompt when switching to a logged-out Cline account", async () => {
		mocks.subscribeToAuthStatusUpdate.mockImplementation((_request, callbacks) => {
			callbacks.onResponse({})
			return vi.fn()
		})
		mocks.userInfo = ssyUser
		renderSwitcher()
		await waitFor(() => expect(screen.getByRole("heading", { name: ssyUser.displayName })).toBeInTheDocument())

		fireEvent.change(screen.getByLabelText("Account type"), { target: { value: "cline" } })

		await waitFor(() => expect(mocks.accountLoginClicked).toHaveBeenCalledOnce())
		expect(mocks.shengSuanYunLoginClicked).not.toHaveBeenCalled()
		expect(screen.getByRole("button", { name: "登录 Cline" })).toBeInTheDocument()
		expect(screen.queryByRole("heading", { name: ssyUser.displayName })).toBeNull()
	})

	it("marks logged-out account types in the switcher options", async () => {
		renderSwitcher()
		await waitFor(() => expect(screen.getByRole("heading", { name: user.displayName })).toBeInTheDocument())

		const options = Array.from(screen.getByLabelText("Account type").querySelectorAll("option")).map((o) => o.textContent)

		expect(options).toEqual(["Cline", "胜算云（未登录）"])
	})
})
