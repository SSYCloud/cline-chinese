import { ClineMessage } from "@shared/ExtensionMessage"
import debounce from "debounce"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useEvent } from "react-use"
import { ListRange, VirtuosoHandle } from "react-virtuoso"
import { ScrollBehavior } from "../types/chatTypes"

// Height of the sticky user message header (padding + content)
const STICKY_HEADER_HEIGHT = 32

/**
 * Custom hook for managing scroll behavior
 * Handles auto-scrolling, manual scrolling, and scroll-to-message functionality
 */
export function useScrollBehavior(
	messages: ClineMessage[],
	visibleMessages: ClineMessage[],
	groupedMessages: (ClineMessage | ClineMessage[])[],
	expandedRows: Record<number, boolean>,
	setExpandedRows: React.Dispatch<React.SetStateAction<Record<number, boolean>>>,
): ScrollBehavior & {
	isAtBottom: boolean
	setIsAtBottom: React.Dispatch<React.SetStateAction<boolean>>
	pendingScrollToMessage: number | null
	setPendingScrollToMessage: React.Dispatch<React.SetStateAction<number | null>>
	scrolledPastUserMessage: ClineMessage | null
	handleRangeChanged: (range: ListRange) => void
} {
	// Refs
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const scrollContainerRef = useRef<HTMLDivElement>(null)
	const disableAutoScrollRef = useRef(false)
	const layoutSettleScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	// State
	const [isAtBottom, setIsAtBottom] = useState(false)
	const [pendingScrollToMessage, setPendingScrollToMessage] = useState<number | null>(null)
	const [scrolledPastUserMessage, setScrolledPastUserMessage] = useState<ClineMessage | null>(null)

	// Index user messages by virtual row when the transcript changes. Scroll
	// events then use a binary search instead of one DOM query per old message.
	const feedbackRows = useMemo(() => {
		const rows: { rowIndex: number; message: ClineMessage }[] = []
		groupedMessages.forEach((row, rowIndex) => {
			for (const message of Array.isArray(row) ? row : [row]) {
				if (message.say === "user_feedback") rows.push({ rowIndex, message })
			}
		})
		return rows
	}, [groupedMessages])
	const feedbackRowsRef = useRef(feedbackRows)
	feedbackRowsRef.current = feedbackRows
	const messageCountRef = useRef(groupedMessages.length)
	messageCountRef.current = groupedMessages.length
	const stickyCheckFrameRef = useRef<number | null>(null)

	const checkScrolledPastUserMessage = useCallback(() => {
		const scrollContainer = scrollContainerRef.current
		const userMessages = feedbackRowsRef.current
		if (!scrollContainer || userMessages.length === 0) {
			setScrolledPastUserMessage(null)
			return
		}
		const top = scrollContainer.getBoundingClientRect().top + 10
		const renderedRows = scrollContainer.querySelectorAll<HTMLElement>('[data-testid="virtuoso-item-list"] > [data-index]')
		if (!renderedRows.length) return
		let firstVisibleIndex = messageCountRef.current
		let firstVisibleRow: HTMLElement | undefined
		for (const row of renderedRows) {
			if (row.getBoundingClientRect().bottom >= top) {
				firstVisibleIndex = Number(row.dataset.index)
				firstVisibleRow = row
				break
			}
		}
		let low = 0
		let high = userMessages.length
		while (low < high) {
			const mid = (low + high) >>> 1
			if (userMessages[mid].rowIndex < firstVisibleIndex) low = mid + 1
			else high = mid
		}
		let pinned = userMessages[low - 1]?.message ?? null
		// A grouped row can stay partly visible after its user message is gone.
		if (firstVisibleRow) {
			for (let index = low; index < userMessages.length && userMessages[index].rowIndex === firstVisibleIndex; index++) {
				const message = userMessages[index].message
				const element = firstVisibleRow.querySelector<HTMLElement>(`[data-message-ts="${message.ts}"]`)
				if (element && element.getBoundingClientRect().bottom < top) pinned = message
			}
		}
		setScrolledPastUserMessage((current) => (current?.ts === pinned?.ts ? current : pinned))
	}, [])
	const scheduleStickyCheck = useCallback(() => {
		if (stickyCheckFrameRef.current !== null) return
		stickyCheckFrameRef.current = requestAnimationFrame(() => {
			stickyCheckFrameRef.current = null
			checkScrolledPastUserMessage()
		})
	}, [checkScrolledPastUserMessage])

	// Use scroll event listener - attach to the scrollable element inside the container
	useEffect(() => {
		const scrollContainer = scrollContainerRef.current
		if (!scrollContainer) {
			return
		}

		// The scrollable element is the Virtuoso scroller or a child with overflow
		const findScrollableElement = () => {
			// Try finding the Virtuoso scroller
			const virtuosoScroller = scrollContainer.querySelector('[data-virtuoso-scroller="true"]') as HTMLElement
			if (virtuosoScroller) {
				return virtuosoScroller
			}
			// Fallback to the first child with scrollable class
			const scrollable = scrollContainer.querySelector(".scrollable") as HTMLElement
			return scrollable || scrollContainer
		}

		const scrollableElement = findScrollableElement()

		scrollableElement.addEventListener("scroll", scheduleStickyCheck, { passive: true })

		// Also check on mount and when dependencies change
		scheduleStickyCheck()

		return () => {
			scrollableElement.removeEventListener("scroll", scheduleStickyCheck)
			if (stickyCheckFrameRef.current !== null) cancelAnimationFrame(stickyCheckFrameRef.current)
			stickyCheckFrameRef.current = null
		}
	}, [scheduleStickyCheck])
	useEffect(() => scheduleStickyCheck(), [feedbackRows, scheduleStickyCheck])

	// Recheck after Virtuoso updates the mounted range following a scroll.
	const handleRangeChanged = useCallback((_range: ListRange) => scheduleStickyCheck(), [scheduleStickyCheck])
	const scrollToBottomSmooth = useMemo(
		() =>
			debounce(
				() => {
					virtuosoRef.current?.scrollTo({
						top: Number.MAX_SAFE_INTEGER,
						behavior: "smooth",
					})
				},
				10,
				{ immediate: true },
			),
		[],
	)

	// Smooth scroll to bottom with debounce
	const scrollToBottomAuto = useCallback(() => {
		virtuosoRef.current?.scrollTo({
			top: Number.MAX_SAFE_INTEGER,
			behavior: "auto", // instant causes crash
		})
	}, [])

	const scrollToMessage = useCallback(
		(messageIndex: number) => {
			setPendingScrollToMessage(messageIndex)

			const targetMessage = messages[messageIndex]
			if (!targetMessage) {
				setPendingScrollToMessage(null)
				return
			}

			const visibleIndex = visibleMessages.findIndex((msg) => msg.ts === targetMessage.ts)
			if (visibleIndex === -1) {
				setPendingScrollToMessage(null)
				return
			}

			let groupIndex = -1

			for (let i = 0; i < groupedMessages.length; i++) {
				const group = groupedMessages[i]
				if (Array.isArray(group)) {
					const messageInGroup = group.some((msg) => msg.ts === targetMessage.ts)
					if (messageInGroup) {
						groupIndex = i
						break
					}
				} else {
					if (group.ts === targetMessage.ts) {
						groupIndex = i
						break
					}
				}
			}

			if (groupIndex !== -1) {
				setPendingScrollToMessage(null)
				disableAutoScrollRef.current = true

				// Check if this is the first user feedback message (no sticky header would show when scrolling to it)
				const isFirstUserMessage =
					groupIndex === 0 || !visibleMessages.slice(0, visibleIndex).some((msg) => msg.say === "user_feedback")

				const stickyHeaderOffset = isFirstUserMessage ? 0 : STICKY_HEADER_HEIGHT

				// Use scrollToIndex with offset - Virtuoso handles this more reliably than manual scrollTo
				requestAnimationFrame(() => {
					virtuosoRef.current?.scrollToIndex({
						index: groupIndex,
						align: "start",
						behavior: "smooth",
						offset: -stickyHeaderOffset,
					})
				})
			}
		},
		[messages, visibleMessages, groupedMessages],
	)

	// scroll when user toggles certain rows
	const toggleRowExpansion = useCallback(
		(ts: number, options?: { preserveAutoScroll?: boolean }) => {
			const isCollapsing = expandedRows[ts] ?? false
			const lastGroup = groupedMessages.at(-1)
			const isLast = Array.isArray(lastGroup) ? lastGroup[0].ts === ts : lastGroup?.ts === ts
			const secondToLastGroup = groupedMessages.at(-2)
			const isSecondToLast = Array.isArray(secondToLastGroup)
				? secondToLastGroup[0].ts === ts
				: secondToLastGroup?.ts === ts

			const isLastCollapsedApiReq =
				isLast &&
				!Array.isArray(lastGroup) && // Make sure it's not a browser session group
				lastGroup?.say === "api_req_started" &&
				!expandedRows[lastGroup.ts]

			setExpandedRows((prev) => ({
				...prev,
				[ts]: !prev[ts],
			}))

			// Disable auto-scroll when the user expands a row. Programmatic expansions
			// for active command output should keep bottom pinning engaged.
			if (!isCollapsing && !options?.preserveAutoScroll) {
				disableAutoScrollRef.current = true
			}
			// Only scroll on collapse, never on expand - expanding should stay in place
			if (isCollapsing && isAtBottom) {
				const timer = setTimeout(() => {
					scrollToBottomAuto()
				}, 0)
				return () => clearTimeout(timer)
			}
			if (isCollapsing && (isLast || isSecondToLast)) {
				if (isSecondToLast && !isLastCollapsedApiReq) {
					return
				}
				const timer = setTimeout(() => {
					scrollToBottomAuto()
				}, 0)
				return () => clearTimeout(timer)
			}
			// When expanding, don't scroll - let the element expand in place
		},
		[groupedMessages, expandedRows, scrollToBottomAuto, isAtBottom],
	)

	const clearLayoutSettleScrollTimers = useCallback(() => {
		if (layoutSettleScrollTimerRef.current !== null) {
			clearTimeout(layoutSettleScrollTimerRef.current)
			layoutSettleScrollTimerRef.current = null
		}
	}, [])

	const keepPinnedToBottomAfterLayout = useCallback(() => {
		if (disableAutoScrollRef.current) {
			return
		}

		if (layoutSettleScrollTimerRef.current !== null) {
			clearTimeout(layoutSettleScrollTimerRef.current)
		}
		layoutSettleScrollTimerRef.current = setTimeout(() => {
			if (!disableAutoScrollRef.current) {
				scrollToBottomSmooth()
			}
			layoutSettleScrollTimerRef.current = null
		}, 500)
	}, [scrollToBottomSmooth])

	const handleRowHeightChange = useCallback(
		(_isTaller: boolean) => {
			keepPinnedToBottomAfterLayout()
		},
		[keepPinnedToBottomAfterLayout],
	)

	const handleLastRowContentChange = useCallback(() => {
		keepPinnedToBottomAfterLayout()
	}, [keepPinnedToBottomAfterLayout])

	useEffect(() => clearLayoutSettleScrollTimers, [clearLayoutSettleScrollTimers])

	useEffect(() => {
		if (!disableAutoScrollRef.current) {
			scrollToBottomSmooth()
			setTimeout(() => {
				if (!disableAutoScrollRef.current) {
					scrollToBottomAuto()
				}
			}, 40)
			setTimeout(() => {
				if (!disableAutoScrollRef.current) {
					scrollToBottomAuto()
				}
			}, 70)
			// return () => clearTimeout(timer) // dont cleanup since if visibleMessages.length changes it cancels.
		}
	}, [groupedMessages.length, scrollToBottomSmooth, scrollToBottomAuto])

	useEffect(() => {
		if (pendingScrollToMessage !== null) {
			scrollToMessage(pendingScrollToMessage)
		}
	}, [pendingScrollToMessage, groupedMessages, scrollToMessage])

	const handleWheel = useCallback((event: Event) => {
		const wheelEvent = event as WheelEvent
		if (wheelEvent.deltaY && wheelEvent.deltaY < 0) {
			if (scrollContainerRef.current?.contains(wheelEvent.target as Node)) {
				// user scrolled up
				disableAutoScrollRef.current = true
			}
		}
	}, [])
	useEvent("wheel", handleWheel, window, { passive: true }) // passive improves scrolling performance

	return {
		virtuosoRef,
		scrollContainerRef,
		disableAutoScrollRef,
		scrollToBottomSmooth,
		scrollToBottomAuto,
		scrollToMessage,
		toggleRowExpansion,
		handleRowHeightChange,
		handleLastRowContentChange,
		isAtBottom,
		setIsAtBottom,
		pendingScrollToMessage,
		setPendingScrollToMessage,
		scrolledPastUserMessage,
		handleRangeChanged,
	}
}
