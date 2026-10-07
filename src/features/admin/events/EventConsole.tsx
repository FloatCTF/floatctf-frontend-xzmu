/**
 * `/admin/events/:id` —— **赛事控制台**。
 *
 * 我方交互模型（FRONTEND-PLAN §4）：赛事级的全部管理能力不拆成一堆页面，
 * 而是收在这一页的标签里，用 `?tab=` 深链与刷新。
 *
 * 标签可见性由赛事 `family` 决定：
 * - `awd` 只在 `family === "awd"`；
 * - `awdp` 只在 `family === "awdp"`；
 * - `data`（Jeopardy 数据大屏）只在 `family === "jeopardy"`；
 * - 其余（config / challenges / users / teams / announcements / logs / instances / writeups / network）为通用。
 */

import { type ReactNode, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Events } from "@floatctf/sdk/entity";

import { call } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { qk } from "../../../api/keys.ts";
import { formatDateTime } from "../../../lib/format.ts";
import { Link } from "../../../router/Link.tsx";
import type { PageProps } from "../../../router/pages.ts";
import { useDocumentTitle, useSearchParam } from "../../../router/router.tsx";
import { Icon } from "../../../ui/icons.tsx";
import { QueryBoundary } from "../../../ui/overlays.tsx";
import { Badge, Card, CardBody, CardHead, EmptyState } from "../../../ui/primitives.tsx";
import { familyLabel, participantLabel } from "../../events/status.ts";
import { ConfigTab } from "./tab-config.tsx";
import { EventChallengesTab } from "./tab-challenges.tsx";
import { EventAnnouncementsTab, EventLogsTab, EventWriteupsTab } from "./tab-content.tsx";
import { EventDataTab } from "./tab-data.tsx";
import { EventInstancesTab } from "./tab-instances.tsx";
import { EventUsersTab, EventTeamsTab } from "./tab-members.tsx";
import { AwdOpsTab } from "./tab-awd.tsx";
import { AwdpOpsTab } from "./tab-awdp.tsx";
import { EventNetworkTab } from "./tab-network.tsx";

interface ConsoleTab {
	key: string;
	label: string;
	icon: string;
	render: (event: Events) => ReactNode;
}

function tabsFor(family: string, eventId: string): ConsoleTab[] {
	const tabs: ConsoleTab[] = [
		{ key: "config", label: "配置", icon: "settings", render: (event) => <ConfigTab event={event} /> },
		{ key: "challenges", label: "题目", icon: "puzzle", render: () => <EventChallengesTab eventId={eventId} /> },
		{ key: "users", label: "用户", icon: "users", render: () => <EventUsersTab eventId={eventId} /> },
		{ key: "teams", label: "战队", icon: "shield", render: () => <EventTeamsTab eventId={eventId} /> },
		{
			key: "announcements",
			label: "公告",
			icon: "bell",
			render: () => <EventAnnouncementsTab eventId={eventId} />,
		},
		{ key: "logs", label: "日志", icon: "clipboard", render: () => <EventLogsTab eventId={eventId} /> },
		{ key: "instances", label: "实例", icon: "box", render: () => <EventInstancesTab eventId={eventId} /> },
		{ key: "writeups", label: "Writeup", icon: "book", render: () => <EventWriteupsTab eventId={eventId} /> },
	];

	if (family === "jeopardy") {
		tabs.push({ key: "data", label: "数据大屏", icon: "chart", render: () => <EventDataTab eventId={eventId} /> });
	}
	if (family === "awd") {
		tabs.push({
			key: "awd",
			label: "AWD 运维",
			icon: "sword",
			render: (event) => <AwdOpsTab eventId={eventId} eventTitle={event.title} />,
		});
	}
	if (family === "awdp") {
		tabs.push({
			key: "awdp",
			label: "AWDP 运维",
			icon: "wrench",
			render: (event) => <AwdpOpsTab eventId={eventId} event={event} />,
		});
	}
	tabs.push({ key: "network", label: "网络", icon: "network", render: () => <EventNetworkTab eventId={eventId} /> });
	return tabs;
}

export function AdminEventConsolePage({ params }: PageProps) {
	const client = useClient();
	const eventId = params.id ?? "";
	const [tab, setTab] = useSearchParam("tab");

	const detail = useQuery({
		queryKey: qk.admin.event(eventId),
		queryFn: () => call(client.admin.events.get(eventId), "赛事详情"),
		enabled: eventId.length > 0,
	});

	const event = detail.data;
	const family = event ? String(event.family) : "jeopardy";
	const tabs = useMemo(() => tabsFor(family, eventId), [family, eventId]);
	const activeKey = tabs.some((entry) => entry.key === tab) ? (tab ?? "config") : "config";
	const activeTab = tabs.find((entry) => entry.key === activeKey);

	useDocumentTitle(event ? `控制台 · ${event.title}` : "赛事控制台");

	if (!eventId) {
		return (
			<div className="xz-page">
				<EmptyState icon="alert" title="缺少赛事 ID" desc="地址里没有赛事标识，请从赛事列表进入。" />
			</div>
		);
	}

	return (
		<div className="xz-page xz-page--wide">
			<QueryBoundary
				isPending={detail.isPending}
				isError={detail.isError}
				error={detail.error}
				refetch={() => void detail.refetch()}
				loadingLabel="正在加载赛事…"
			>
				{event ? (
					<>
						<header className="xz-page__head xz-aev-pagehead">
							<div className="xz-grow">
								<div className="xz-aev-inline" style={{ marginBottom: 6 }}>
									<Link to="/admin/events" className="xz-muted xz-xs">
										← 赛事列表
									</Link>
									<Badge tone="crimson">{familyLabel(String(event.family))}</Badge>
									<Badge>{participantLabel(String(event.participant_mode))}</Badge>
									<Badge tone={String(event.purpose) === "practice" ? "info" : "gold"}>
										{String(event.purpose) === "practice" ? "练习" : "正式比赛"}
									</Badge>
									{event.hidden ? <Badge tone="warn">隐藏</Badge> : <Badge tone="ok">公开</Badge>}
									{event.allow_join ? <Badge tone="info">可报名</Badge> : <Badge>报名锁定</Badge>}
									{event.is_virtual ? <Badge tone="solid">平台自有</Badge> : null}
								</div>
								<h1 className="xz-page__title">{event.title}</h1>
								<p className="xz-page__desc">
									{formatDateTime(event.start_time)}
									{event.end_time ? ` → ${formatDateTime(event.end_time)}` : " 起长期开放"}
									{" · "}
									<span className="xz-mono xz-xs">{event.id}</span>
								</p>
							</div>
							<div className="xz-page__actions xz-aev-inline">
								<Link to={`/events/${event.id}`} className="xz-btn xz-btn--sm xz-btn--quiet">
									<Icon name="external" size={14} />
									选手端视图
								</Link>
							</div>
						</header>

						{event.is_virtual ? (
							<Card flat>
								<CardHead title="平台自有赛事" icon="info" />
								<CardBody>
									<span className="xz-aev-note">
										`is_virtual = true`：该赛事由平台维护（例如内置练习），修改配置前请确认影响面。
									</span>
								</CardBody>
							</Card>
						) : null}

						<div className="xz-tabs" role="tablist" aria-label="赛事管理能力">
							{tabs.map((entry) => (
								<button
									key={entry.key}
									type="button"
									role="tab"
									className="xz-tab"
									aria-selected={entry.key === activeKey}
									onClick={() => setTab(entry.key)}
								>
									<Icon name={entry.icon} size={15} />
									{entry.label}
								</button>
							))}
						</div>

						<div role="tabpanel" aria-label={activeTab?.label}>
							{activeTab ? activeTab.render(event) : null}
						</div>
					</>
				) : null}
			</QueryBoundary>
		</div>
	);
}
