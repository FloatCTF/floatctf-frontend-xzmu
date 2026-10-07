/**
 * 赛事控制台 · `users` / `teams` 标签 —— 赛事参与者与战队管理。
 *
 * 柯里化调用（必须二次调用）：
 * - `client.admin.event_users.fetch(eventId)(params)` / `.delete(eventId)(id_list)`
 * - `client.admin.event_teams.getTeams(eventId)()`（**第二层无参数**） / `.remove(eventId)(id_list)`
 *
 * ⚠ `client.admin.event_users.add` 的 SDK **声明与运行时不符**：源码里
 * `return http.post(...)` 没有取 `.data`，运行时拿到的是 AxiosResponse，envelope 在 `.data`
 * （`packages/sdk/src/api/admin/event_users.ts:26-30`，SDK-API-REFERENCE §5.1 陷阱 2）。
 * 这里显式按 `(await …).data` 取信封，并用 `floatCTFErrorFromEnvelope` 兜底判定。
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { floatCTFErrorFromEnvelope, type UniResponse } from "@floatctf/sdk";
import type { TeamResult } from "@floatctf/sdk";

import { call, callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { formatDateTime, displayName } from "../../../lib/format.ts";
import { Icon } from "../../../ui/icons.tsx";
import { Modal, QueryBoundary, useConfirm, useToast } from "../../../ui/overlays.tsx";
import { Badge, Banner, Button, Card, CardBody, CardHead, EmptyState, TextInput } from "../../../ui/primitives.tsx";
import { DataTable, Pagination, readMeta } from "../../../ui/Table.tsx";
import { ROOT, RowActions, usePager } from "./shared.tsx";

/* ── 赛事用户 ─────────────────────────────────────────────────────── */

export function EventUsersTab({ eventId }: { eventId: string }) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const pager = usePager(50);
	const [addOpen, setAddOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [chosen, setChosen] = useState<Set<string>>(() => new Set());
	const [manualId, setManualId] = useState("");
	const [selectedRows, setSelectedRows] = useState<Set<string>>(() => new Set());

	const list = useQuery({
		queryKey: qk.admin.eventUsers(eventId, pager.params),
		queryFn: () => callList(client.admin.event_users.fetch(eventId)(pager.params)),
		enabled: eventId.length > 0,
	});

	const users = useQuery({
		queryKey: qk.admin.users({ page: 1, limit: 200 }),
		queryFn: () => callList(client.admin.users.fetch({ page: 1, limit: 200 })),
		enabled: addOpen,
	});

	const rows = list.data?.items ?? [];
	const meta = readMeta(list.data?.meta, pager.pageSize);

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: qk.admin.eventUsers(eventId, pager.params) });
		void queryClient.invalidateQueries({ queryKey: ROOT.adminEvents });
	};

	const add = useMutation({
		mutationFn: async (ids: string[]) => {
			const input =
				ids.length === 1
					? { event_id: eventId, user_id: ids[0] }
					: { event_id: eventId, user_id_list: ids };
			// ⚠ 见文件头注释：这里运行时是 AxiosResponse，信封在 `.data`。
			const raw = (await client.admin.event_users.add(input)) as unknown as { data: UniResponse<null> };
			const platformError = floatCTFErrorFromEnvelope(raw.data);
			if (platformError) throw platformError;
		},
		onSuccess: (_data, ids) => {
			toast.success("已加入赛事", `共 ${ids.length} 人`);
			setAddOpen(false);
			setChosen(new Set());
			setManualId("");
			invalidate();
		},
		onError: (error) => toast.error("加入赛事失败", errorText(error)),
	});

	const remove = useMutation({
		mutationFn: (ids: string[]) => call(client.admin.event_users.delete(eventId)(ids), "移除结果"),
		onSuccess: () => {
			toast.success("已从赛事移除参与者");
			setSelectedRows(new Set());
			invalidate();
		},
		onError: (error) => toast.error("移除参与者失败", errorText(error)),
	});

	const setBanned = useMutation({
		mutationFn: (input: { userId: string; banned: boolean }) =>
			call(
				input.banned
					? client.admin.event_users.banned({ event_id: eventId, user_id: input.userId })
					: client.admin.event_users.unbanned({ event_id: eventId, user_id: input.userId }),
				"封禁结果",
			),
		onSuccess: (_data, input) => {
			toast.success(input.banned ? "已封禁该用户" : "已解封该用户");
			invalidate();
		},
		onError: (error) => toast.error("封禁/解封失败", errorText(error)),
	});

	const askBan = async (userId: string, name: string, banned: boolean) => {
		if (!banned) {
			setBanned.mutate({ userId, banned: false });
			return;
		}
		const ok = await confirm({
			title: `封禁「${name}」？`,
			description: "赛事级封禁（`event_users.banned`）会立即生效。",
			consequences:
				"被封禁用户无法继续参赛/提交；如果这是 AWD 赛事，这**不等于** AWD 队伍封禁（AWD ban 是独立记录，需在 AWD 标签里操作）。",
			tone: "danger",
			confirmText: "封禁",
		});
		if (ok) setBanned.mutate({ userId, banned: true });
	};

	const askRemove = async (ids: string[], label: string) => {
		if (ids.length === 0) return;
		const ok = await confirm({
			title: `从赛事移除${label}？`,
			description: "只会移除赛事的参与关系，账号本身不受影响。",
			consequences: "被移除者将失去该赛事的参赛资格；其已产生的解题记录仍保留在数据库中。",
			tone: "danger",
			confirmText: "移除",
		});
		if (ok) remove.mutate(ids);
	};

	const candidateUsers = useMemo(() => {
		const needle = search.trim().toLowerCase();
		const items = users.data?.items ?? [];
		if (!needle) return items;
		return items.filter((user) =>
			[user.username, user.nickname, user.email, user.id].some((value) =>
				(value ?? "").toLowerCase().includes(needle),
			),
		);
	}, [users.data, search]);

	const alreadyIn = useMemo(() => new Set(rows.map((row) => row.user.id)), [rows]);

	return (
		<div className="xz-aev-col">
			<Banner tone="info" title="赛事级封禁与 AWD 队伍封禁是两套记录">
				这里改的是 `event_users.banned`；AWD 选手端的 `banned` 由 AWD 队伍 ban 记录算出，
				要在本控制台的 **AWD 标签**里用 `banTeam` / `unbanTeam`。
			</Banner>

			<div className="xz-aev-toolbar">
				<Button variant="primary" icon="plus" onClick={() => setAddOpen(true)}>
					加入参与者
				</Button>
				<Button
					variant="danger-ghost"
					icon="trash"
					disabled={selectedRows.size === 0}
					onClick={() => void askRemove([...selectedRows], ` ${selectedRows.size} 名参与者`)}
				>
					移除选中（{selectedRows.size}）
				</Button>
				<span className="xz-aev-toolbar--end xz-muted xz-xs">共 {meta.total} 人</span>
			</div>

			<Card>
				<CardHead title="赛事参与者" icon="users" />
				<CardBody flush>
					<QueryBoundary
						isPending={list.isPending}
						isError={list.isError}
						error={list.error}
						refetch={() => void list.refetch()}
						loadingLabel="正在加载赛事参与者…"
					>
						<DataTable
							rows={rows}
							rowKey={(row) => row.id}
							empty={<div className="xz-aev-emptyline">本赛事还没有参与者。</div>}
							columns={[
								{
									key: "select",
									header: <span className="xz-sr">选择</span>,
									width: 36,
									render: (row) => (
										<input
											type="checkbox"
											aria-label={`选择 ${row.user.nickname || row.user.username}`}
											checked={selectedRows.has(row.user.id)}
											onChange={(event) =>
												setSelectedRows((current) => {
													const next = new Set(current);
													if (event.target.checked) next.add(row.user.id);
													else next.delete(row.user.id);
													return next;
												})
											}
										/>
									),
								},
								{
									key: "user",
									header: "用户",
									render: (row) => (
										<div>
											<div>{displayName(row.user)}</div>
											<div className="xz-muted xz-xs xz-mono">
												{row.user.username} · {row.user.id}
											</div>
										</div>
									),
								},
								{
									key: "points",
									header: "赛事积分",
									numeric: true,
									render: (row) => <span className="xz-aev-score">{row.event_user.points}</span>,
								},
								{
									key: "banned",
									header: "状态",
									render: (row) =>
										row.event_user.banned ? (
											<Badge tone="danger" icon="ban">
												已封禁
											</Badge>
										) : (
											<Badge tone="ok">正常</Badge>
										),
								},
								{ key: "joined", header: "加入时间", render: (row) => formatDateTime(row.event_user.joined_at) },
								{
									key: "actions",
									header: "操作",
									align: "right",
									width: 220,
									render: (row) => (
										<RowActions>
											<Button
												size="sm"
												icon={row.event_user.banned ? "undo" : "ban"}
												variant={row.event_user.banned ? "ghost" : "danger-ghost"}
												onClick={() =>
													void askBan(row.user.id, displayName(row.user), !row.event_user.banned)
												}
											>
												{row.event_user.banned ? "解封" : "封禁"}
											</Button>
											<Button
												size="sm"
												variant="danger-ghost"
												icon="trash"
												onClick={() => void askRemove([row.user.id], displayName(row.user))}
											>
												移除
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
				open={addOpen}
				onClose={() => setAddOpen(false)}
				size="wide"
				persistent={add.isPending}
				title="把用户加入赛事"
				description="支持勾选已有用户或直接粘贴用户 ID。批量提交时后端走 `user_id_list`。"
				footer={
					<>
						<Button variant="quiet" onClick={() => setAddOpen(false)} disabled={add.isPending}>
							取消
						</Button>
						<Button
							variant="primary"
							icon="plus"
							loading={add.isPending}
							disabled={chosen.size === 0}
							onClick={() => add.mutate([...chosen])}
						>
							加入选中（{chosen.size}）
						</Button>
					</>
				}
			>
				<div className="xz-aev-col">
					<div className="xz-aev-inline">
						<TextInput
							className="xz-input--mono"
							placeholder="直接输入用户 ID 后回车或点添加"
							value={manualId}
							onChange={(event) => setManualId(event.target.value)}
						/>
						<Button
							icon="plus"
							disabled={manualId.trim().length === 0}
							onClick={() => {
								const id = manualId.trim();
								if (!id) return;
								setChosen((current) => new Set(current).add(id));
								setManualId("");
							}}
						>
							添加 ID
						</Button>
					</div>

					{chosen.size > 0 ? (
						<div className="xz-aev-inline">
							<span className="xz-muted xz-xs">已选：</span>
							{[...chosen].map((id) => (
								<button
									key={id}
									type="button"
									className="xz-aev-chip"
									onClick={() =>
										setChosen((current) => {
											const next = new Set(current);
											next.delete(id);
											return next;
										})
									}
								>
									{id.slice(0, 12)}
									<span aria-hidden="true">×</span>
								</button>
							))}
						</div>
					) : null}

					<span className="xz-search">
						<span className="xz-search__icon">
							<Icon name="search" size={14} />
						</span>
						<input
							className="xz-input"
							placeholder="搜索用户名 / 昵称 / 邮箱"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
						/>
					</span>

					<QueryBoundary
						isPending={users.isPending}
						isError={users.isError}
						error={users.error}
						refetch={() => void users.refetch()}
						loadingLabel="正在加载用户列表…"
					>
						{candidateUsers.length === 0 ? (
							<EmptyState icon="users" title="没有匹配的用户" desc="可以直接在上方粘贴用户 ID。" />
						) : (
							<div className="xz-aev-pick">
								{candidateUsers.map((user) => (
									<label key={user.id} className="xz-aev-pick__row">
										<input
											type="checkbox"
											checked={chosen.has(user.id)}
											onChange={(event) =>
												setChosen((current) => {
													const next = new Set(current);
													if (event.target.checked) next.add(user.id);
													else next.delete(user.id);
													return next;
												})
											}
										/>
										<span className="xz-aev-pick__main">
											<div>{displayName(user)}</div>
											<div className="xz-aev-pick__meta xz-mono">{user.username}</div>
										</span>
										<span className="xz-aev-pick__aside">
											{alreadyIn.has(user.id) ? <Badge tone="ok">已在赛事</Badge> : null}
										</span>
									</label>
								))}
							</div>
						)}
					</QueryBoundary>
				</div>
			</Modal>
		</div>
	);
}

/* ── 赛事战队 ─────────────────────────────────────────────────────── */

export function EventTeamsTab({ eventId }: { eventId: string }) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const [membersOf, setMembersOf] = useState<TeamResult | null>(null);
	const [selected, setSelected] = useState<Set<string>>(() => new Set());

	const list = useQuery({
		// 第二层无参数：`getTeams(id)()`
		queryKey: qk.admin.eventTeams(eventId),
		queryFn: () => callList(client.admin.event_teams.getTeams(eventId)()),
		enabled: eventId.length > 0,
	});

	const rows = list.data?.items ?? [];

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: qk.admin.eventTeams(eventId) });
		void queryClient.invalidateQueries({ queryKey: ROOT.adminEvents });
	};

	const remove = useMutation({
		mutationFn: (ids: string[]) => call(client.admin.event_teams.remove(eventId)(ids), "删除结果"),
		onSuccess: () => {
			toast.success("战队已解散并移出赛事");
			setSelected(new Set());
			invalidate();
		},
		onError: (error) => toast.error("删除战队失败", errorText(error)),
	});

	const setBanned = useMutation({
		mutationFn: async (input: { teamId: string; banned: boolean }) => {
			// `banned` / `unbanned` 返回类型未标注（any）——只等待请求完成，
			// 平台业务失败已由信封守卫转成 rejection。
			if (input.banned) await client.admin.event_teams.banned({ event_id: eventId, team_id: input.teamId });
			else await client.admin.event_teams.unbanned({ event_id: eventId, team_id: input.teamId });
		},
		onSuccess: (_data, input) => {
			toast.success(input.banned ? "战队已封禁" : "战队已解封");
			invalidate();
		},
		onError: (error) => toast.error("封禁/解封失败", errorText(error)),
	});

	const askBan = async (team: TeamResult, banned: boolean) => {
		if (!banned) {
			setBanned.mutate({ teamId: team.team.id, banned: false });
			return;
		}
		const ok = await confirm({
			title: `封禁战队「${team.team.name}」？`,
			description: "赛事级封禁（`event_teams.banned`）会让整队失去参赛资格。",
			consequences:
				"全队无法继续参赛/提交。注意：AWD 选手端的 `banned` 由 AWD 队伍 ban 记录决定，需要在 AWD 标签里另行封禁。",
			tone: "danger",
			confirmText: "封禁战队",
		});
		if (ok) setBanned.mutate({ teamId: team.team.id, banned: true });
	};

	const askRemove = async (teams: TeamResult[]) => {
		if (teams.length === 0) return;
		const first = teams[0];
		const ok = await confirm({
			title: teams.length === 1 ? `删除战队「${first?.team.name ?? ""}」？` : `删除 ${teams.length} 支战队？`,
			description: "管理端删队是解散队伍的唯一方式（队长不能自行退队）。",
			consequences: "队伍与其成员关系会被移除；成员需要重新建队/入队才能继续参赛。此操作不可撤销。",
			tone: "danger",
			confirmText: "删除战队",
		});
		if (ok) remove.mutate(teams.map((team) => team.team.id));
	};

	return (
		<div className="xz-aev-col">
			<Banner tone="info" title="AWD 队伍封禁是另一套记录">
				这里的封禁写 `event_teams.banned`；AWD 选手端判定用的 `banned` 来自 AWD 队伍 ban 记录
				（`client.awd.admin.banTeam`），本控制台 AWD 标签里可操作。
			</Banner>

			<div className="xz-aev-toolbar">
				<Button
					variant="danger-ghost"
					icon="trash"
					disabled={selected.size === 0}
					onClick={() => void askRemove(rows.filter((team) => selected.has(team.team.id)))}
				>
					删除选中（{selected.size}）
				</Button>
				<span className="xz-aev-toolbar--end xz-muted xz-xs">共 {rows.length} 支战队</span>
			</div>

			<Card>
				<CardHead title="赛事战队" icon="users" />
				<CardBody flush>
					<QueryBoundary
						isPending={list.isPending}
						isError={list.isError}
						error={list.error}
						refetch={() => void list.refetch()}
						loadingLabel="正在加载战队列表…"
					>
						<DataTable
							rows={rows}
							rowKey={(team) => team.team.id}
							empty={<div className="xz-aev-emptyline">本赛事还没有战队。</div>}
							columns={[
								{
									key: "select",
									header: <span className="xz-sr">选择</span>,
									width: 36,
									render: (team) => (
										<input
											type="checkbox"
											aria-label={`选择 ${team.team.name}`}
											checked={selected.has(team.team.id)}
											onChange={(event) =>
												setSelected((current) => {
													const next = new Set(current);
													if (event.target.checked) next.add(team.team.id);
													else next.delete(team.team.id);
													return next;
												})
											}
										/>
									),
								},
								{
									key: "name",
									header: "战队",
									render: (team) => (
										<div>
											<div>{team.team.name}</div>
											<div className="xz-muted xz-xs xz-mono">{team.team.id}</div>
										</div>
									),
								},
								{
									key: "captain",
									header: "队长",
									render: (team) => team.captain || <span className="xz-muted">—</span>,
								},
								{
									key: "members",
									header: "成员",
									numeric: true,
									render: (team) => (
										<Button size="sm" variant="quiet" onClick={() => setMembersOf(team)}>
											{team.members.length} 人
										</Button>
									),
								},
								{
									key: "points",
									header: "队内积分",
									numeric: true,
									render: (team) => <span className="xz-aev-score">{team.team.points}</span>,
								},
								{
									key: "banned",
									header: "状态",
									render: (team) =>
										team.team.banned ? (
											<Badge tone="danger" icon="ban">
												已封禁
											</Badge>
										) : (
											<Badge tone="ok">正常</Badge>
										),
								},
								{ key: "created", header: "创建时间", render: (team) => formatDateTime(team.team.created_at) },
								{
									key: "actions",
									header: "操作",
									align: "right",
									width: 220,
									render: (team) => (
										<RowActions>
											<Button
												size="sm"
												icon={team.team.banned ? "undo" : "ban"}
												variant={team.team.banned ? "ghost" : "danger-ghost"}
												onClick={() => void askBan(team, !team.team.banned)}
											>
												{team.team.banned ? "解封" : "封禁"}
											</Button>
											<Button size="sm" variant="danger-ghost" icon="trash" onClick={() => void askRemove([team])}>
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

			<Modal
				open={membersOf !== null}
				onClose={() => setMembersOf(null)}
				size="wide"
				title={`战队成员 · ${membersOf?.team.name ?? ""}`}
				description={`队长：${membersOf?.captain || "—"}`}
			>
				<DataTable
					compact
					rows={membersOf?.members ?? []}
					rowKey={(member, index) => `${member.username}-${index}`}
					empty={<div className="xz-aev-emptyline">该战队暂无成员记录。</div>}
					columns={[
						{ key: "nickname", header: "成员", render: (member) => member.nickname || member.username },
						{ key: "username", header: "用户名", render: (member) => <span className="xz-mono">{member.username}</span> },
						{
							key: "role",
							header: "角色",
							render: (member) =>
								String(member.role) === "captain" ? (
									<Badge tone="gold">队长</Badge>
								) : (
									<Badge>成员</Badge>
								),
						},
						{
							key: "points",
							header: "队内积分",
							numeric: true,
							render: (member) => <span className="xz-aev-score">{member.points}</span>,
						},
					]}
				/>
			</Modal>
		</div>
	);
}
