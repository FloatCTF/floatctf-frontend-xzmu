/**
 * 赛事控制台 · `announcements` / `logs` / `writeups` 标签。
 *
 * 三个模块的 SDK 全部是**柯里化**：
 * - `event_announcements.fetch/create/patch/remove(eventId)(…)`
 * - `event_logs.fetch(eventId)(params)`
 * - `event_writeups.fetch(eventId)(params)`
 *
 * Writeup 导出：`events.exportWriteUps(id)` 与 `events.getReport(id)` 打在**同一个 URL**
 * （`GET /admin/events/{id}/report`），返回 S3 对象键；随后用
 * `client.admin.download.download(key)` 触发浏览器下载（返回 `Promise<void>`，不是 envelope）。
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { call, callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { formatDateTime } from "../../../lib/format.ts";
import { useDebounced } from "../../../lib/hooks.ts";
import { Icon } from "../../../ui/icons.tsx";
import { Modal, QueryBoundary, useConfirm, useToast } from "../../../ui/overlays.tsx";
import {
	Badge,
	Banner,
	Button,
	Card,
	CardBody,
	CardHead,
	CodeBlock,
	Select,
} from "../../../ui/primitives.tsx";
import { DataTable, Pagination, readMeta } from "../../../ui/Table.tsx";
import { ROOT, RowActions, TextAreaField, TextField, logLevelTone, usePager } from "./shared.tsx";

/* ── 赛事公告 ─────────────────────────────────────────────────────── */

interface AnnouncementDraft {
	id?: string;
	title: string;
	content: string;
}

export function EventAnnouncementsTab({ eventId }: { eventId: string }) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const pager = usePager(20);
	const [draft, setDraft] = useState<AnnouncementDraft | null>(null);

	const list = useQuery({
		queryKey: qk.admin.eventAnnouncements(eventId, pager.params),
		queryFn: () => callList(client.admin.event_announcements.fetch(eventId)(pager.params)),
		enabled: eventId.length > 0,
	});

	const rows = list.data?.items ?? [];
	const meta = readMeta(list.data?.meta, pager.pageSize);

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: qk.admin.eventAnnouncements(eventId, pager.params) });
		void queryClient.invalidateQueries({ queryKey: ROOT.adminEvents });
		void queryClient.invalidateQueries({ queryKey: ROOT.events });
	};

	const save = useMutation({
		mutationFn: async (input: AnnouncementDraft) => {
			const payload = { title: input.title.trim(), content: input.content };
			if (input.id) {
				// `patch(eventId)(announcement)` 要求 payload 自带 id（URL 用它拼接）。
				await client.admin.event_announcements.patch(eventId)({ id: input.id, ...payload });
			} else {
				await client.admin.event_announcements.create(eventId)(payload);
			}
		},
		onSuccess: (_data, input) => {
			toast.success(input.id ? "公告已更新" : "公告已发布");
			setDraft(null);
			invalidate();
		},
		onError: (error) => toast.error(draft?.id ? "更新公告失败" : "发布公告失败", errorText(error)),
	});

	const remove = useMutation({
		mutationFn: async (ids: string[]) => {
			await client.admin.event_announcements.remove(eventId)(ids);
		},
		onSuccess: () => {
			toast.success("公告已删除");
			invalidate();
		},
		onError: (error) => toast.error("删除公告失败", errorText(error)),
	});

	const askRemove = async (id: string, title: string) => {
		const ok = await confirm({
			title: `删除公告「${title}」？`,
			description: "删除后选手端立即不再显示该公告。",
			consequences: "公告内容不可恢复。",
			tone: "danger",
			confirmText: "删除公告",
		});
		if (ok) remove.mutate([id]);
	};

	return (
		<div className="xz-aev-col">
			<div className="xz-aev-toolbar">
				<Button variant="primary" icon="plus" onClick={() => setDraft({ title: "", content: "" })}>
					发布公告
				</Button>
				<span className="xz-aev-toolbar--end xz-muted xz-xs">共 {meta.total} 条</span>
			</div>

			<Card>
				<CardHead title="赛事公告" icon="bell" sub="选手端 60s 轮询该列表" />
				<CardBody flush>
					<QueryBoundary
						isPending={list.isPending}
						isError={list.isError}
						error={list.error}
						refetch={() => void list.refetch()}
						loadingLabel="正在加载赛事公告…"
					>
						<DataTable
							rows={rows}
							rowKey={(row) => row.id}
							empty={<div className="xz-aev-emptyline">本赛事还没有公告。</div>}
							columns={[
								{ key: "title", header: "标题", render: (row) => row.title },
								{
									key: "content",
									header: "内容",
									render: (row) => (
										<span className="xz-clamp-2 xz-muted">{row.content}</span>
									),
								},
								{ key: "created", header: "发布时间", render: (row) => formatDateTime(row.created_at) },
								{
									key: "actions",
									header: "操作",
									align: "right",
									width: 180,
									render: (row) => (
										<RowActions>
											<Button
												size="sm"
												icon="edit"
												onClick={() => setDraft({ id: row.id, title: row.title, content: row.content })}
											>
												编辑
											</Button>
											<Button
												size="sm"
												variant="danger-ghost"
												icon="trash"
												onClick={() => void askRemove(row.id, row.title)}
											>
												删除
											</Button>
										</RowActions>
									),
								},
							]}
						/>
					</QueryBoundary>
				</CardBody>
			</Card>

			<Pagination
				page={meta.page}
				pageSize={meta.pageSize}
				total={meta.total}
				onPageChange={pager.setPage}
				onPageSizeChange={pager.setPageSize}
			/>

			<Modal
				open={draft !== null}
				onClose={() => setDraft(null)}
				size="wide"
				persistent={save.isPending}
				title={draft?.id ? "编辑赛事公告" : "发布赛事公告"}
				footer={
					<>
						<Button variant="quiet" onClick={() => setDraft(null)} disabled={save.isPending}>
							取消
						</Button>
						<Button
							variant="primary"
							icon="send"
							loading={save.isPending}
							disabled={!draft || draft.title.trim().length === 0}
							onClick={() => draft && save.mutate(draft)}
						>
							{draft?.id ? "保存" : "发布"}
						</Button>
					</>
				}
			>
				{draft ? (
					<div className="xz-aev-col">
						<TextField
							label="标题"
							required
							value={draft.title}
							onChange={(value) => setDraft({ ...draft, title: value })}
						/>
						<TextAreaField
							label="内容"
							rows={8}
							value={draft.content}
							onChange={(value) => setDraft({ ...draft, content: value })}
						/>
					</div>
				) : null}
			</Modal>
		</div>
	);
}

/* ── 赛事日志 ─────────────────────────────────────────────────────── */

export function EventLogsTab({ eventId }: { eventId: string }) {
	const client = useClient();
	const pager = usePager(50);
	const [level, setLevel] = useState("all");
	const [search, setSearch] = useState("");
	const [detail, setDetail] = useState<string | null>(null);
	const debounced = useDebounced(search);

	const list = useQuery({
		queryKey: qk.admin.eventLogs(eventId, pager.params),
		queryFn: () => callList(client.admin.event_logs.fetch(eventId)(pager.params)),
		enabled: eventId.length > 0,
	});

	const rows = list.data?.items ?? [];
	const meta = readMeta(list.data?.meta, pager.pageSize);

	const filtered = useMemo(
		() =>
			rows.filter((row) => {
				if (level !== "all" && String(row.level) !== level) return false;
				const needle = debounced.trim().toLowerCase();
				if (!needle) return true;
				return [row.action, row.details, row.user_id ?? "", row.team_id ?? "", row.ip_address ?? ""].some((value) =>
					String(value).toLowerCase().includes(needle),
				);
			}),
		[rows, level, debounced],
	);

	return (
		<div className="xz-aev-col">
			<div className="xz-filters">
				<span className="xz-search">
					<span className="xz-search__icon">
						<Icon name="search" size={14} />
					</span>
					<input
						className="xz-input"
						placeholder="搜索动作 / 详情 / 用户 ID"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
				</span>
				<Select value={level} onChange={(event) => setLevel(event.target.value)} aria-label="日志级别">
					<option value="all">全部级别</option>
					<option value="info">info</option>
					<option value="warn">warn</option>
					<option value="error">error</option>
					<option value="debug">debug</option>
				</Select>
				<span className="xz-aev-toolbar--end xz-muted xz-xs">
					{list.isSuccess ? `本页 ${filtered.length} / ${rows.length} 条` : ""}
				</span>
			</div>

			<Card>
				<CardHead title="赛事操作日志" icon="clipboard" sub={`共 ${meta.total} 条`} />
				<CardBody flush>
					<QueryBoundary
						isPending={list.isPending}
						isError={list.isError}
						error={list.error}
						refetch={() => void list.refetch()}
						loadingLabel="正在加载赛事日志…"
					>
						<DataTable
							rows={filtered}
							rowKey={(row) => row.id}
							compact
							empty={<div className="xz-aev-emptyline">没有符合条件的日志。</div>}
							columns={[
								{ key: "time", header: "时间", render: (row) => formatDateTime(row.created_at) },
								{
									key: "level",
									header: "级别",
									render: (row) => <Badge tone={logLevelTone(row.level)}>{row.level}</Badge>,
								},
								{ key: "action", header: "动作", render: (row) => row.action },
								{
									key: "subject",
									header: "主体",
									render: (row) => (
										<div className="xz-muted xz-xs xz-mono">
											{row.user_id ? `user:${row.user_id.slice(0, 8)}` : ""}
											{row.team_id ? ` team:${row.team_id.slice(0, 8)}` : ""}
											{!row.user_id && !row.team_id ? "—" : ""}
										</div>
									),
								},
								{
									key: "mode",
									header: "赛制维度",
									render: (row) => (
										<span className="xz-muted xz-xs">
											{String(row.family)} / {String(row.purpose)} / {String(row.participant_mode)}
										</span>
									),
								},
								{ key: "ip", header: "IP", render: (row) => <span className="xz-mono xz-xs">{row.ip_address ?? "—"}</span> },
								{
									key: "details",
									header: "详情",
									align: "right",
									render: (row) => (
										<Button size="sm" variant="quiet" icon="list" onClick={() => setDetail(row.details)}>
											查看
										</Button>
									),
								},
							]}
						/>
					</QueryBoundary>
				</CardBody>
			</Card>

			<Pagination
				page={meta.page}
				pageSize={meta.pageSize}
				total={meta.total}
				onPageChange={pager.setPage}
				onPageSizeChange={pager.setPageSize}
			/>

			<Modal open={detail !== null} onClose={() => setDetail(null)} size="wide" title="日志详情">
				<CodeBlock>{detail ?? ""}</CodeBlock>
			</Modal>
		</div>
	);
}

/* ── 赛事 Writeup ─────────────────────────────────────────────────── */

export function EventWriteupsTab({ eventId }: { eventId: string }) {
	const client = useClient();
	const toast = useToast();
	const pager = usePager(50);

	const list = useQuery({
		queryKey: qk.admin.eventWriteups(eventId, pager.params),
		queryFn: () => callList(client.admin.event_writeups.fetch(eventId)(pager.params)),
		enabled: eventId.length > 0,
	});

	const rows = list.data?.items ?? [];
	const meta = readMeta(list.data?.meta, pager.pageSize);

	const download = useMutation({
		mutationFn: (key: string) => client.admin.download.download(key),
		onSuccess: () => toast.success("下载已开始", "浏览器会另存为文件。"),
		onError: (error) => toast.error("下载失败", errorText(error)),
	});

	const exportZip = useMutation({
		mutationFn: async (source: "export" | "report") => {
			const key = await call(
				source === "export" ? client.admin.events.exportWriteUps(eventId) : client.admin.events.getReport(eventId),
				"导出对象键",
			);
			if (!key) throw new Error("后端未返回导出对象键");
			await client.admin.download.download(key);
			return key;
		},
		onSuccess: (key, source) => {
			toast.success(source === "export" ? "Writeup 导出已开始" : "报表导出已开始", `对象键：${key}`);
		},
		onError: (error) => toast.error("导出失败", errorText(error)),
	});

	return (
		<div className="xz-aev-col">
			<Banner tone="info" title="导出说明">
				{"`events.exportWriteUps(id)` 与 `events.getReport(id)` 在 SDK 里打在**同一个 URL**（`GET /admin/events/{id}/report`）；两者都返回 S3 对象键，再交给 `client.admin.download.download(key)` 取预签名地址并触发浏览器下载。"}
			</Banner>

			<div className="xz-aev-toolbar">
				<Button
					variant="primary"
					icon="download"
					loading={exportZip.isPending && exportZip.variables === "export"}
					onClick={() => exportZip.mutate("export")}
				>
					导出 Writeup 包（exportWriteUps）
				</Button>
				<Button
					icon="download"
					loading={exportZip.isPending && exportZip.variables === "report"}
					onClick={() => exportZip.mutate("report")}
				>
					导出报表（getReport）
				</Button>
				<span className="xz-aev-toolbar--end xz-muted xz-xs">共 {meta.total} 条</span>
			</div>

			<Card>
				<CardHead title="赛事 Writeup 提交" icon="book" />
				<CardBody flush>
					<QueryBoundary
						isPending={list.isPending}
						isError={list.isError}
						error={list.error}
						refetch={() => void list.refetch()}
						loadingLabel="正在加载 Writeup 列表…"
					>
						<DataTable
							rows={rows}
							rowKey={(row, index) => `${row.event_id}-${row.user_id}-${index}`}
							empty={<div className="xz-aev-emptyline">本赛事还没有 Writeup 提交。</div>}
							columns={[
								{
									key: "user",
									header: "用户 / 队伍",
									render: (row) => (
										<div className="xz-mono xz-xs">
											<div>user: {row.user_id}</div>
											<div className="xz-muted">team: {row.team_id ?? "—"}</div>
										</div>
									),
								},
								{
									key: "file",
									header: "文件",
									render: (row) => (
										<Button
											size="sm"
											variant="quiet"
											icon="download"
											onClick={() => download.mutate(row.file_url)}
										>
											{row.file_url.split("/").pop() || "下载"}
										</Button>
									),
								},
								{ key: "created", header: "提交时间", render: (row) => formatDateTime(row.created_at) },
							]}
						/>
					</QueryBoundary>
				</CardBody>
			</Card>

			<Pagination
				page={meta.page}
				pageSize={meta.pageSize}
				total={meta.total}
				onPageChange={pager.setPage}
				onPageSizeChange={pager.setPageSize}
			/>
		</div>
	);
}
