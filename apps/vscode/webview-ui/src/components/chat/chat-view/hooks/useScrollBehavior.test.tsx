import type { ClineMessage } from "@shared/ExtensionMessage"
import { act, fireEvent, render, renderHook } from "@testing-library/react"
import type { MutableRefObject } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useScrollBehavior } from "./useScrollBehavior"

const commandMessage = {
	ts: 1,
	type: "ask",
	ask: "command",
	text: "echo hi",
}

describe("useScrollBehavior", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	it("keeps the latest virtualized user message pinned with one bounded DOM scan per frame", () => {
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
		vi.stubGlobal("cancelAnimationFrame", (timer: number) => clearTimeout(timer))
		const messages = [
			{ ts: 1, type: "say", say: "user_feedback", text: "Earlier user" },
			{ ts: 2, type: "say", say: "text", text: "Reply" },
			{ ts: 3, type: "say", say: "user_feedback", text: "Recent user" },
			{ ts: 4, type: "say", say: "text", text: "Reply" },
		] as ClineMessage[]
		let behavior!: ReturnType<typeof useScrollBehavior>
		function Harness() {
			behavior = useScrollBehavior(messages, messages, messages, {}, vi.fn())
			return (
				<div data-testid="container" ref={behavior.scrollContainerRef}>
					<div data-testid="scroller" data-virtuoso-scroller="true">
						<div data-testid="virtuoso-item-list">
							<div data-index="2" data-testid="user-row" />
							<div data-index="3" data-testid="last-row" />
						</div>
					</div>
				</div>
			)
		}
		const view = render(<Harness />)
		const container = view.getByTestId("container")
		const scroller = view.getByTestId("scroller")
		const userRow = view.getByTestId("user-row")
		const lastRow = view.getByTestId("last-row")
		vi.spyOn(container, "getBoundingClientRect").mockReturnValue({ top: 100 } as DOMRect)
		let userBottom = 150
		vi.spyOn(userRow, "getBoundingClientRect").mockImplementation(() => ({ bottom: userBottom }) as DOMRect)
		vi.spyOn(lastRow, "getBoundingClientRect").mockReturnValue({ bottom: 200 } as DOMRect)
		const scan = vi.spyOn(container, "querySelectorAll")
		act(() => {
			fireEvent.scroll(scroller)
			fireEvent.scroll(scroller)
			vi.advanceTimersByTime(1)
		})
		expect(scan).toHaveBeenCalledTimes(1)
		expect(behavior.scrolledPastUserMessage?.ts).toBe(1)
		userBottom = 90
		act(() => {
			fireEvent.scroll(scroller)
			vi.advanceTimersByTime(1)
		})
		expect(behavior.scrolledPastUserMessage?.ts).toBe(3)
	})

	it("scrolls to bottom after command output layout has been quiet for 500ms", () => {
		const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
		const scrollTo = vi.fn()
		act(() => {
			vi.runOnlyPendingTimers()
		})
		;(result.current.virtuosoRef as MutableRefObject<{ scrollTo: typeof scrollTo } | null>).current = { scrollTo }

		act(() => {
			result.current.handleLastRowContentChange()
		})

		expect(scrollTo).not.toHaveBeenCalled()

		act(() => {
			vi.advanceTimersByTime(499)
		})
		expect(scrollTo).not.toHaveBeenCalled()

		act(() => {
			vi.advanceTimersByTime(1)
		})
		expect(scrollTo).toHaveBeenCalledWith({
			top: Number.MAX_SAFE_INTEGER,
			behavior: "smooth",
		})
	})

	it("resets the 500ms wait when another command output change arrives", () => {
		const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
		const scrollTo = vi.fn()
		act(() => {
			vi.runOnlyPendingTimers()
		})
		;(result.current.virtuosoRef as MutableRefObject<{ scrollTo: typeof scrollTo } | null>).current = { scrollTo }

		act(() => {
			result.current.handleLastRowContentChange()
			scrollTo.mockClear()
			vi.advanceTimersByTime(400)
			result.current.handleLastRowContentChange()
			scrollTo.mockClear()
			vi.advanceTimersByTime(499)
		})
		expect(scrollTo).not.toHaveBeenCalled()

		act(() => {
			vi.advanceTimersByTime(1)
		})
		expect(scrollTo).toHaveBeenCalledWith({
			top: Number.MAX_SAFE_INTEGER,
			behavior: "smooth",
		})
	})

	it("does not re-pin command output changes after auto-scroll is disabled", () => {
		const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
		const scrollTo = vi.fn()
		;(result.current.virtuosoRef as MutableRefObject<{ scrollTo: typeof scrollTo } | null>).current = { scrollTo }

		act(() => {
			result.current.disableAutoScrollRef.current = true
			result.current.handleLastRowContentChange()
			vi.runAllTimers()
		})

		expect(scrollTo).not.toHaveBeenCalled()
	})

	it("disables auto-scroll when a user expands a row", () => {
		const { result } = renderHook(() => useScrollBehavior([], [], [commandMessage as any], {}, vi.fn()))

		act(() => {
			result.current.toggleRowExpansion(commandMessage.ts)
		})

		expect(result.current.disableAutoScrollRef.current).toBe(true)
	})

	it("keeps auto-scroll enabled when command output expands programmatically", () => {
		const { result } = renderHook(() => useScrollBehavior([], [], [commandMessage as any], {}, vi.fn()))

		act(() => {
			result.current.toggleRowExpansion(commandMessage.ts, { preserveAutoScroll: true })
		})

		expect(result.current.disableAutoScrollRef.current).toBe(false)
	})
})
