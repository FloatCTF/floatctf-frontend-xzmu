/**
 * 赛事卡片（列表与总览共用）。
 */

import type { EventInfo } from "@floatctf/sdk";

import { Link } from "../../router/Link.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { Badge } from "../../ui/primitives.tsx";
import { Icon } from "../../ui/icons.tsx";
import {
	EVENT_PHASE_LABEL,
	EVENT_PHASE_TONE,
	eventPhase,
	familyLabel,
	participantLabel,
} from "./status.ts";

export function EventCard({ info }: { info: EventInfo }) {
	const event = info.event;
	const phase = eventPhase(event);

	return (
		<Link to={`/events/${event.id}`} className="xz-eventcard" data-mode={event.family}>
			<div className="xz-row-between" style={{ alignItems: "flex-start" }}>
				<span className="xz-eventcard__title xz-clamp-2">{event.title}</span>
				<Badge tone={EVENT_PHASE_TONE[phase]}>{EVENT_PHASE_LABEL[phase]}</Badge>
			</div>

			{event.description ? (
				<p className="xz-muted xz-clamp-2" style={{ fontSize: 13 }}>
					{event.description}
				</p>
			) : null}

			<div className="xz-eventcard__meta">
				<span className="xz-row" style={{ gap: 5 }}>
					<Icon name="flag" size={13} />
					{familyLabel(event.family)}
				</span>
				<span className="xz-row" style={{ gap: 5 }}>
					<Icon name="users" size={13} />
					{participantLabel(event.participant_mode)}
				</span>
				{event.purpose === "practice" ? (
					<span className="xz-row" style={{ gap: 5 }}>
						<Icon name="target" size={13} />
						练习
					</span>
				) : null}
			</div>

			<div className="xz-eventcard__meta">
				<span className="xz-row" style={{ gap: 5 }}>
					<Icon name="clock" size={13} />
					{formatDateTime(event.start_time)}
					{event.end_time ? ` → ${formatDateTime(event.end_time)}` : " 起长期开放"}
				</span>
			</div>

			<div className="xz-eventcard__foot">
				{info.joined ? (
					<Badge tone="ok" icon="check">
						已报名
					</Badge>
				) : (
					<Badge tone="crimson">未报名</Badge>
				)}
				{event.hidden ? <Badge tone="warn">隐藏</Badge> : null}
				{!event.allow_join ? <Badge>已锁定报名</Badge> : null}
				{info.team_result ? (
					<Badge tone="gold" icon="users">
						{info.team_result.team.name}
					</Badge>
				) : null}
				<span className="xz-row xz-muted xz-xs" style={{ marginLeft: "auto", gap: 4 }}>
					进入驾驶舱
					<Icon name="chevronRight" size={13} />
				</span>
			</div>
		</Link>
	);
}
