/**
 * 管理控制台总览（`/admin`）—— Dashboard 聚合总览。
 *
 * 语义（CAPABILITY-BEHAVIOR-MAP「管理端：总览与内容」）：
 * - **一个聚合接口** `client.admin.dashboard.summary()` 给出统计 / 需关注项 / 赛事 / 动态；
 * - 需关注项**只在有内容时渲染**：`awd_alerts` 逐条、`failed_tasks` 逐条（含
 *   `attempt_count`/`max_attempts`）、`error_logs_24h > 0` 才显示；
 * - 系统监控 `client.admin.system.monitor()` 与版本 `client.admin.system.version()` 是独立接口；
 * - 总览与系统监控都 **轮询 60s**。
 */

import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DashboardSummary, SystemInformation } from "@floatctf/sdk";

import { call } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { qk } from "../../../api/keys.ts";
import {
	formatBytes,
	formatDateTime,
	formatNumber,
	formatRelative,
} from "../../../lib/format.ts";
import { useDocumentTitle, useNavigate } from "../../../router/router.tsx";
import { Icon } from "../../../ui/icons.tsx";
import { QueryBoundary } from "../../../ui/overlays.tsx";
import {
	Badge,
	Banner,
	Button,
	Card,
	CardBody,
	CardHead,
	ErrorState,
	KeyValue,
	ProgressBar,
	Stat,
} from "../../../ui/primitives.tsx";
import { DataTable, type Column } from "../../../ui/Table.tsx";
import {
	AdminPageHead,
	formatTemp,
	formatUptime,
	RefreshButton,
} from "./shared.tsx";

const POLL_MS = 60_000;

type SummaryEvent = DashboardSummary["events"][number];
type FailedTask = DashboardSummary["attention"]["failed_tasks"][number];
type AwdAlert = DashboardSummary["attention"]["awd_alerts"][number];

/* ── 需关注项 ─────────────────────────────────────────────────────── */


/**
 * `DashboardSummary` 是**一个**聚合接口（`packages/sdk/src/api/admin/dashboard.ts:4-61`）。
 * 它的四个区块都是必需字段；一旦缺失，页面必须在渲染前就报错，
 * 而不是在 `data.stats.users` 上抛异常把整棵树卸载掉（那就是白屏）。
 */
function hasSummaryShape(value: unknown): value is DashboardSummary {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.stats === "object" &&
		record.stats !== null &&
		typeof record.attention === "object" &&
		record.attention !== null &&
		Array.isArray(record.events) &&
		typeof record.activity === "object" &&
		record.activity !== null
	);
}

function AttentionRow({
	severity,
	title,
	meta,
	action,
}: {
	severity: "danger" | "warn";
	title: ReactNode;
	meta?: ReactNode;
	action?: ReactNode;
}) {
	return (
		<div className="xz-adm-attention__row" data-severity={severity}>
			<Icon name={severity === "danger" ? "alert" : "warn"} size={17} />
			<div className="xz-adm-attention__main">
				<div className="xz-adm-attention__title">{title}</div>
				{meta ? <div className="xz-adm-attention__meta">{meta}</div> : null}
			</div>
			{action}
		</div>
	);
}

function AttentionSection({ data }: { data: DashboardSummary }) {
	const navigate = useNavigate();
	const { failed_tasks, error_logs_24h, awd_alerts } = data.attention;
	const hasContent = failed_tasks.length > 0 || awd_alerts.length > 0 || error_logs_24h > 0;

	// 需关注项只在有内容时渲染（空则整块不出现，而不是用占位数据填充）。
	if (!hasContent) return null;

	return (
		<Card className="xz-adm-section">
			<CardHead
				icon="alert"
				title="需关注项"
				sub={
					<>
						{awd_alerts.length} 项 AWD 异常 · {failed_tasks.length} 个失败任务 · 24h 错误日志{" "}
						{formatNumber(error_logs_24h)}
					</>
				}
			/>
			<CardBody>
				<div className="xz-adm-attention">
					{awd_alerts.map((alert: AwdAlert) => (
						<AttentionRow
							key={`awd-${alert.event_id}`}
							severity="danger"
							title={
								<>
									<Badge tone="danger">AWD 异常</Badge>
									{alert.title || "（未命名赛事）"}
								</>
							}
							meta={
								<>
									状态 <code className="xz-mono">{alert.status}</code> · 阶段{" "}
									<code className="xz-mono">{alert.phase}</code> · 赛事 {alert.event_id}
								</>
							}
							action={
								<Button
									size="sm"
									variant="danger-ghost"
									icon="external"
									onClick={() => navigate(`/admin/events/${alert.event_id}?tab=awd`)}
								>
									处理
								</Button>
							}
						/>
					))}
					{failed_tasks.map((task: FailedTask) => (
						<AttentionRow
							key={`task-${task.task_key}-${task.updated_at}`}
							severity="warn"
							title={
								<>
									<Badge tone="warn">计划任务失败</Badge>
									{task.task_name || task.task_key}
								</>
							}
							meta={
								<>
									<code className="xz-mono">{task.task_key}</code> · 重试{" "}
									{task.attempt_count}/{task.max_attempts} · 更新于{" "}
									{formatDateTime(task.updated_at)}
									{task.error_msg ? ` · ${task.error_msg}` : ""}
								</>
							}
							action={
								<Button
									size="sm"
									icon="clock"
									onClick={() => navigate("/admin/scheduled-tasks")}
								>
									查看任务
								</Button>
							}
						/>
					))}
					{error_logs_24h > 0 ? (
						<AttentionRow
							severity="warn"
							title={
								<>
									<Badge tone="warn">错误日志</Badge>24 小时内 {formatNumber(error_logs_24h)} 条
								</>
							}
							meta="来自平台审计日志（level=ERROR 及以上）。"
							action={
								<Button size="sm" icon="clipboard" onClick={() => navigate("/admin/logs")}>
									查看日志
								</Button>
							}
						/>
					) : null}
				</div>
			</CardBody>
		</Card>
	);
}

/* ── 赛事 ─────────────────────────────────────────────────────────── */

const EVENT_COLUMNS: readonly Column<SummaryEvent>[] = [
	{
		key: "title",
		header: "赛事",
		render: (row) => (
			<div>
				<div className="xz-adm-attention__title">
					{row.title || "（未命名）"}
					{row.hidden ? <Badge tone="neutral">隐藏</Badge> : null}
				</div>
				<div className="xz-adm-attention__meta">
					<code className="xz-mono">{row.event_id.slice(0, 8)}…</code>
				</div>
			</div>
		),
	},
	{ key: "family", header: "家族", render: (row) => <Badge tone="crimson">{row.family}</Badge> },
	{
		key: "mode",
		header: "赛制",
		render: (row) => (
			<span className="xz-xs">
				{row.purpose} · {row.participant_mode}
			</span>
		),
	},
	{
		key: "time",
		header: "起止时间",
		render: (row) => (
			<span className="xz-xs">
				{formatDateTime(row.start_time)} → {row.end_time ? formatDateTime(row.end_time) : "未设定"}
			</span>
		),
	},
	{
		key: "awd",
		header: "AWD",
		render: (row) =>
			row.awd ? (
				<div className="xz-xs">
					<Badge tone="gold">{row.awd.status}</Badge> <code className="xz-mono">{row.awd.phase}</code>
				</div>
			) : (
				<span className="xz-muted">—</span>
			),
	},
];

function EventsSection({ data }: { data: DashboardSummary }) {
	const navigate = useNavigate();
	return (
		<Card className="xz-adm-section">
			<CardHead
				icon="flag"
				title="赛事"
				sub={`共 ${data.events.length} 场（含隐藏赛事）`}
				actions={
					<Button size="sm" icon="external" onClick={() => navigate("/admin/events")}>
						赛事管理
					</Button>
				}
			/>
			<CardBody flush>
				<DataTable
					compact
					columns={EVENT_COLUMNS}
					rows={data.events}
					rowKey={(row) => row.event_id}
					onRowClick={(row) => navigate(`/admin/events/${row.event_id}`)}
					empty="平台还没有任何赛事。"
				/>
			</CardBody>
		</Card>
	);
}

/* ── 动态 ─────────────────────────────────────────────────────────── */

function ActivitySection({ data }: { data: DashboardSummary }) {
	const { recent_solves, recent_signups } = data.activity;
	return (
		<div className="xz-adm-section">
			<div className="xz-adm-split">
				<Card>
					<CardHead icon="bolt" title="最近解出" sub={`${recent_solves.length} 条`} />
					<CardBody flush>
						{recent_solves.length === 0 ? (
							<div className="xz-adm-inline-empty">暂无解出记录。</div>
						) : (
							<div className="xz-list">
								{recent_solves.map((solve, index) => (
									<div className="xz-list__row" key={`${solve.nickname}-${solve.solved_at}-${index}`}>
										<div className="xz-list__main">
											<div className="xz-list__title">
												{solve.nickname || "（匿名）"} 解出 {solve.challenge_name || "（题目已删除）"}
											</div>
											<div className="xz-list__meta">{formatRelative(solve.solved_at)}</div>
										</div>
									</div>
								))}
							</div>
						)}
					</CardBody>
				</Card>
				<Card>
					<CardHead icon="users" title="最近注册" sub={`${recent_signups.length} 条`} />
					<CardBody flush>
						{recent_signups.length === 0 ? (
							<div className="xz-adm-inline-empty">暂无注册记录。</div>
						) : (
							<div className="xz-list">
								{recent_signups.map((signup, index) => (
									<div className="xz-list__row" key={`${signup.username}-${signup.created_at}-${index}`}>
										<div className="xz-list__main">
											<div className="xz-list__title">{signup.nickname || signup.username}</div>
											<div className="xz-list__meta">
												<code className="xz-mono">{signup.username}</code> ·{" "}
												{formatRelative(signup.created_at)}
											</div>
										</div>
									</div>
								))}
							</div>
						)}
					</CardBody>
				</Card>
			</div>
		</div>
	);
}

/* ── 系统监控 ─────────────────────────────────────────────────────── */

function MonitorSection({ data }: { data: SystemInformation }) {
	const docker = data.docker_info;
	return (
		<Card className="xz-adm-section">
			<CardHead
				icon="server"
				title="系统监控"
				sub={
					<>
						{data.host_name || data.name || "主机"} · 每 60s 刷新
					</>
				}
			/>
			<CardBody>
				<KeyValue
					items={[
						{ k: "主机名", v: data.host_name || "—" },
						{ k: "系统", v: data.os_version || data.name || "—" },
						{ k: "内核", v: data.kernel_version || "—" },
						{ k: "运行时长", v: formatUptime(data.uptime) },
						{ k: "CPU 核心", v: data.nb_cpu ? formatNumber(data.nb_cpu) : "—" },
						{
							k: "温度",
							v: `${formatTemp(data.avg_temp)}（峰值 ${formatTemp(data.max_temp)}）`,
						},
					]}
				/>

				<div className="xz-adm-metrics" style={{ marginTop: "var(--xz-sp-5)" }}>
					<div className="xz-adm-meter">
						<span className="xz-adm-meter__label">
							<span>内存</span>
							<span className="xz-adm-meter__value">
								{formatBytes(data.used_memory)} / {formatBytes(data.total_memory)}
							</span>
						</span>
						<ProgressBar value={data.used_memory} max={Math.max(1, data.total_memory)} />
					</div>
					<div className="xz-adm-meter">
						<span className="xz-adm-meter__label">
							<span>交换分区</span>
							<span className="xz-adm-meter__value">
								{formatBytes(data.used_swap)} / {formatBytes(data.total_swap)}
							</span>
						</span>
						<ProgressBar
							value={data.used_swap}
							max={Math.max(1, data.total_swap)}
							tone="gold"
						/>
					</div>
					<div className="xz-adm-meter">
						<span className="xz-adm-meter__label">
							<span>Docker 容器</span>
							<span className="xz-adm-meter__value">
								{formatNumber(docker?.running_container_count ?? 0)} 运行 /{" "}
								{formatNumber(docker?.image_count ?? 0)} 镜像
							</span>
						</span>
						<span className="xz-adm-note">
							镜像与容器占用磁盘 {formatBytes(docker?.total_disk ?? 0)}
						</span>
					</div>
				</div>

				<div style={{ marginTop: "var(--xz-sp-5)" }}>
					<div className="xz-adm-attention__title" style={{ marginBottom: "var(--xz-sp-2)" }}>
						<Icon name="database" size={15} /> 磁盘
					</div>
					{(data.disks_info ?? []).length === 0 ? (
						<div className="xz-adm-inline-empty">接口未返回磁盘信息。</div>
					) : (
						<div className="xz-adm-disk">
							{(data.disks_info ?? []).map((disk) => (
								<div className="xz-adm-disk__row" key={`${disk.name}-${disk.mount_point}`}>
									<div>
										<div className="xz-adm-attention__title">
											{disk.mount_point || disk.name}
											<span className="xz-adm-disk__meta">
												{disk.file_system} · {formatBytes(disk.used_space)} /{" "}
												{formatBytes(disk.total_space)}
											</span>
										</div>
										<ProgressBar
											value={disk.used_space}
											max={Math.max(1, disk.total_space)}
											tone={
												disk.usage_percent >= 90
													? "danger"
													: disk.usage_percent >= 75
														? "gold"
														: "crimson"
											}
										/>
									</div>
									<span className="xz-adm-disk__meta">
										{Number.isFinite(disk.usage_percent) ? `${disk.usage_percent.toFixed(1)}%` : "—"}{" "}
										· 可用 {formatBytes(disk.available_space)}
									</span>
								</div>
							))}
						</div>
					)}
				</div>

				<div style={{ marginTop: "var(--xz-sp-5)" }}>
					<div className="xz-adm-attention__title" style={{ marginBottom: "var(--xz-sp-2)" }}>
						<Icon name="network" size={15} /> 网卡
					</div>
					{(data.network_interfaces ?? []).length === 0 ? (
						<div className="xz-adm-inline-empty">接口未返回网卡信息。</div>
					) : (
						<DataTable
							compact
							columns={[
								{
									key: "name",
									header: "网卡",
									render: (row) => <code className="xz-mono">{row.name}</code>,
								},
								{
									key: "ip",
									header: "地址",
									render: (row) =>
										row.ip_addresses.length === 0 ? (
											<span className="xz-muted">—</span>
										) : (
											<span className="xz-mono xz-xs">{row.ip_addresses.join(", ")}</span>
										),
								},
								{
									key: "rx",
									header: "接收 / 速率",
									numeric: true,
									render: (row) => (
										<span className="xz-xs">
											{formatBytes(row.received)} · {formatBytes(row.recv_rate)}/s
										</span>
									),
								},
								{
									key: "tx",
									header: "发送 / 速率",
									numeric: true,
									render: (row) => (
										<span className="xz-xs">
											{formatBytes(row.transmitted)} · {formatBytes(row.transmit_rate)}/s
										</span>
									),
								},
							]}
							rows={data.network_interfaces ?? []}
							rowKey={(row) => row.name}
						/>
					)}
				</div>

				{(docker?.images ?? []).length > 0 ? (
					<div style={{ marginTop: "var(--xz-sp-5)" }}>
						<div className="xz-adm-attention__title" style={{ marginBottom: "var(--xz-sp-2)" }}>
							<Icon name="layers" size={15} /> 本地镜像
						</div>
						<DataTable
							compact
							columns={[
								{
									key: "repo_tags",
									header: "标签",
									render: (row) =>
										row.repo_tags.length === 0 ? (
											<code className="xz-mono xz-xs">{row.id.slice(0, 12)}</code>
										) : (
											<span className="xz-mono xz-xs">{row.repo_tags.join(", ")}</span>
										),
								},
								{
									key: "size",
									header: "大小",
									numeric: true,
									render: (row) => formatBytes(row.size),
								},
							]}
							rows={docker?.images ?? []}
							rowKey={(row) => row.id}
						/>
					</div>
				) : null}
			</CardBody>
		</Card>
	);
}

/* ── 页面 ─────────────────────────────────────────────────────────── */

export function AdminDashboardPage() {
	useDocumentTitle("管理总览");
	const client = useClient();

	const summary = useQuery({
		queryKey: qk.admin.dashboard,
		queryFn: () => call(client.admin.dashboard.summary(), "总览聚合"),
		refetchInterval: POLL_MS,
	});

	const monitor = useQuery({
		queryKey: qk.admin.systemMonitor,
		queryFn: () => call(client.admin.system.monitor(), "系统监控"),
		refetchInterval: POLL_MS,
	});

	const version = useQuery({
		queryKey: qk.admin.version,
		queryFn: () => call(client.admin.system.version(), "平台版本"),
		staleTime: 5 * 60_000,
	});

	return (
		<div className="xz-page xz-page--wide">
			<AdminPageHead
				title="控制台总览"
				desc="平台级统计、需关注项与系统监控。总览与监控每 60 秒自动刷新。"
				actions={
					<>
						{version.isSuccess ? (
							<Badge tone="gold" icon="tag">
								平台版本 {version.data}
							</Badge>
						) : version.isError ? (
							<Badge tone="warn" icon="warn" title="版本接口不可用">
								版本未知
							</Badge>
						) : null}
						<RefreshButton
							loading={summary.isFetching || monitor.isFetching}
							onClick={() => {
								void summary.refetch();
								void monitor.refetch();
								void version.refetch();
							}}
						/>
					</>
				}
			/>

			<QueryBoundary
				isPending={summary.isPending}
				isError={summary.isError}
				error={summary.error}
				refetch={summary.refetch}
				loadingLabel="正在加载总览数据…"
			>
				{summary.data && !hasSummaryShape(summary.data) ? (
					// 接口成功但结构不符合预期（版本漂移 / 反向代理返回了非平台响应）：
					// 显式报错，**绝不**让下面的 `data.stats.users` 在渲染期抛异常。
					<ErrorState
						title="总览接口返回了非预期结构"
						message="`GET /api/admin/dashboard/summary` 返回的数据缺少 stats / attention / events / activity 字段，页面无法安全渲染"
						retryable
						onRetry={() => void summary.refetch()}
					/>
				) : summary.data ? (
					<>
						<div className="xz-grid xz-grid--4 xz-adm-section">
							<Stat label="用户" value={formatNumber(summary.data.stats.users)} icon="users" />
							<Stat label="赛事" value={formatNumber(summary.data.stats.events)} icon="flag" />
							<Stat
								label="题目"
								value={formatNumber(summary.data.stats.challenges)}
								icon="puzzle"
							/>
							<Stat label="武器" value={formatNumber(summary.data.stats.weapons)} icon="sword" />
							<Stat
								label="公告"
								value={formatNumber(summary.data.stats.announcements)}
								icon="bell"
							/>
							<Stat
								label="讨论"
								value={formatNumber(summary.data.stats.discussions)}
								icon="chat"
							/>
							<Stat
								label="实例"
								value={formatNumber(summary.data.stats.instances)}
								icon="box"
								gold
							/>
							<Stat
								label="GameBox"
								value={formatNumber(summary.data.stats.gameboxes)}
								icon="box"
								gold
							/>
						</div>

						<AttentionSection data={summary.data} />
						<EventsSection data={summary.data} />
						<ActivitySection data={summary.data} />
					</>
				) : null}
			</QueryBoundary>

			<QueryBoundary
				isPending={monitor.isPending}
				isError={monitor.isError}
				error={monitor.error}
				refetch={monitor.refetch}
				loadingLabel="正在加载系统监控…"
			>
				{monitor.data ? <MonitorSection data={monitor.data} /> : null}
			</QueryBoundary>

			{summary.isError || monitor.isError ? (
				<Banner tone="warn" title="部分数据加载失败">
					上方错误块给出了失败原因；可点击「刷新」重试，其余区块不受影响。
				</Banner>
			) : null}
		</div>
	);
}
