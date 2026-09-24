import type { BatchEvent } from "@shared/loomloom"

export function BatchEventRows({ events }: { events?: BatchEvent[] }) {
	return (
		<>
			{events?.map((event) => (
				<div className="batch-timeline-event" data-batch-event={event.id} key={event.id}>
					{event.text}
				</div>
			))}
		</>
	)
}
