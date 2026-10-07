/**
 * 赛事控制台 · AWD 运维（资产与计分部分）。
 *
 * 覆盖：
 * - 分数调整 `adjustScore(id, {team_id, delta, reason})`（**必须确认 + 必填 reason**）与积分榜 `scores(id)`
 * - 战队封禁 / 解封 `banTeam(id, teamId, {reason})` / `unbanTeam(id, teamId)`（无 body）
 * - 赛事 GameBox 挂载 `listEventGameboxes` / `addEventGamebox` / `updateEventGamebox` / `removeEventGamebox`
 * - GameBox 实例重置（specialized）`resetGamebox(id, instanceId)`
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminInstanceRow, EventGameBoxDto, GameBoxLibraryDto, TeamResult } from "@floatctf/sdk";

import { call, callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { formatDateTime, formatNumber } from "../../../lib/format.ts";
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
	Checkbox,
	Field,
	Select,
	TextInput,
} from "../../../ui/primitives.tsx";
import { DataTable, Pagination, readMeta } from "../../../ui/Table.tsx";
import {
	ROOT,
	RowActions,
	TextField,
	numberText,
	parseNumberText,
	runtimeStateTone,
	usePager,
} from "./shared.tsx";

/* ── 分数调整 + 积分榜 ────────────────────────────────────────────── */

export function AwdScoresSection({ eventId, locked }: { eventId: string; locked: boolean }) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const [teamId, setTeamId] = useState("");
	const [deltaText, setDeltaText] = useState("0");
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | undefined>();

	const scores = useQuery({
		queryKey: qk.awd.adminScores(eventId),
		queryFn: () => callList(client.awd.admin.scores(eventId)),
		enabled: eventId.length > 0,
		refetchInterval: 30_000,
	});

	const rows = scores.data?.items ?? [];

	const adjust = useMutation({
		mutationFn: (input: { team_id: string; delta: number; reason: string }) =>
			call(client.awd.admin.adjustScore(eventId, input), "调整结果"),
		onSuccess: (_data, input) => {
			toast.success("分数已调整", `${input.team_id} ${input.delta >= 0 ? "+" : ""}${input.delta}（记入审计）`);
			setReason("");
			setDeltaText("0");
			void queryClient.invalidateQueries({ queryKey: qk.awd.adminScores(eventId) });
		},
		onError: (error) => toast.error("调整分数失败", errorText(error)),
	});

	const submit = async () => {
		const parsedDelta = parseNumberText(deltaText);
		if (!parsedDelta.ok) {
			setError(parsedDelta.error);
			return;
		}
		if (parsedDelta.value === null || !Number.isInteger(parsedDelta.value) || parsedDelta.value === 0) {
			setError("分差必须是**非 0 整数**（可为负）");
			return;
		}
		if (!teamId) {
			setError("请选择队伍");
			return;
		}
		if (reason.trim().length === 0) {
			setError("必须填写调整原因（用于审计）");
			return;
		}
		setError(undefined);
		const team = rows.find((row) => row.team_id === teamId);
		const ok = await confirm({
			title: `调整「${team?.team_name ?? teamId}」的分数？`,
			description: `分差：${parsedDelta.value > 0 ? "+" : ""}${parsedDelta.value}`,
			consequences:
				"分数调整会写入 AWD 计分流水（ScoreEventType=adjustment）并留痕，属于**审计操作**；榜单立即更新，不可静默撤销。",
			tone: "danger",
			confirmText: "确认调整",
		});
		if (ok) adjust.mutate({ team_id: teamId, delta: parsedDelta.value, reason: reason.trim() });
	};

	return (
		<div className="xz-aev-col">
			<Card>
				<CardHead title="分数调整（记审计）" icon="target" sub="只影响 AWD 计分账本" />
				<CardBody>
					{locked ? (
						<Banner tone="info" title="比赛已结束/归档">
							终局结算后不再接受分数调整（后端会拒绝）。
						</Banner>
					) : null}
					<div className="xz-aev-grid3" style={{ marginBottom: 12 }}>
						<Field label="队伍" required hint="选项来自当前积分榜（真实数据）。">
							{(props) => (
								<Select
									{...props}
									value={teamId}
									disabled={locked}
									onChange={(changeEvent) => setTeamId(changeEvent.target.value)}
								>
									<option value="">请选择队伍</option>
									{rows.map((row) => (
										<option key={row.team_id} value={row.team_id}>
											#{row.rank} {row.team_name}（{row.total_score}）
										</option>
									))}
								</Select>
							)}
						</Field>
						<Field label="分差（delta）" required error={error}>
							{(props) => (
								<TextInput
									{...props}
									type="number"
									value={deltaText}
									disabled={locked}
									onChange={(changeEvent) => setDeltaText(changeEvent.target.value)}
								/>
							)}
						</Field>
						<Field label="原因（reason，必填）" required>
							{(props) => (
								<TextInput
									{...props}
									value={reason}
									disabled={locked}
									placeholder="例如：判题异常补偿"
									onChange={(changeEvent) => setReason(changeEvent.target.value)}
								/>
							)}
						</Field>
					</div>
					<Button
						variant="danger-ghost"
						icon="bolt"
						disabled={locked || adjust.isPending || rows.length === 0}
						loading={adjust.isPending}
						onClick={() => void submit()}
					>
						提交分数调整
					</Button>
				</CardBody>
			</Card>

			<Card>
				<CardHead title="AWD 积分榜" icon="trophy" sub="30s 轮询" />
				<CardBody flush>
					<QueryBoundary
						isPending={scores.isPending}
						isError={scores.isError}
						error={scores.error}
						refetch={() => void scores.refetch()}
						loadingLabel="正在加载积分榜…"
					>
						<DataTable
							rows={rows}
							rowKey={(row) => row.team_id}
							empty={<div className="xz-aev-emptyline">暂无成绩。</div>}
							columns={[
								{
									key: "rank",
									header: "#",
									width: 56,
									render: (row) => <span className="xz-aev-score">{row.rank}</span>,
								},
								{ key: "team", header: "队伍", render: (row) => row.team_name },
								{
									key: "attack",
									header: "攻击分",
									numeric: true,
									render: (row) => formatNumber(row.attack_score),
								},
								{
									key: "defense",
									header: "防守分",
									numeric: true,
									render: (row) => formatNumber(row.defense_score),
								},
								{
									key: "total",
									header: "总分",
									numeric: true,
									render: (row) => <span className="xz-aev-score">{formatNumber(row.total_score)}</span>,
								},
								{
									key: "actions",
									header: "操作",
									align: "right",
									render: (row) => (
										<Button
											size="sm"
											variant="quiet"
											onClick={() => {
												setTeamId(row.team_id);
												setError(undefined);
											}}
										>
											选中调整
										</Button>
									),
								},
							]}
						/>
					</QueryBoundary>
				</CardBody>
			</Card>
		</div>
	);
}

/* ── 战队封禁 / 解封 ──────────────────────────────────────────────── */

export function AwdTeamsSection({ eventId }: { eventId: string }) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const [banTarget, setBanTarget] = useState<TeamResult | null>(null);
	const [reason, setReason] = useState("");

	const teams = useQuery({
		queryKey: qk.admin.eventTeams(eventId),
		queryFn: () => callList(client.admin.event_teams.getTeams(eventId)()),
		enabled: eventId.length > 0,
	});

	const rows = teams.data?.items ?? [];

	const ban = useMutation({
		mutationFn: (input: { teamId: string; reason: string }) =>
			call(client.awd.admin.banTeam(eventId, input.teamId, { reason: input.reason }), "封禁结果"),
		onSuccess: () => {
			toast.success("AWD 已封禁该队伍", "解封后才会恢复 WireGuard peers 与 ban set。");
			setBanTarget(null);
			setReason("");
			void queryClient.invalidateQueries({ queryKey: qk.admin.eventTeams(eventId) });
			void queryClient.invalidateQueries({ queryKey: qk.awd.adminScores(eventId) });
		},
		onError: (error) => toast.error("AWD 封禁失败", errorText(error)),
	});

	const unban = useMutation({
		// `unbanTeam` 没有 body。
		mutationFn: (teamId: string) => call(client.awd.admin.unbanTeam(eventId, teamId), "解封结果"),
		onSuccess: () => {
			toast.success("AWD 已解封该队伍");
			void queryClient.invalidateQueries({ queryKey: qk.admin.eventTeams(eventId) });
			void queryClient.invalidateQueries({ queryKey: qk.awd.adminScores(eventId) });
		},
		onError: (error) => toast.error("AWD 解封失败", errorText(error)),
	});

	const askUnban = async (team: TeamResult) => {
		const ok = await confirm({
			title: `解除 AWD 封禁「${team.team.name}」？`,
			description: "解封会让该队重新可参赛。",
			consequences: "后端会恢复该队的 WireGuard peers 并重算 ban set；封禁期间的成绩不会回滚。",
			tone: "default",
			confirmText: "解封",
		});
		if (ok) unban.mutate(team.team.id);
	};

	return (
		<div className="xz-aev-col">
			<Banner tone="warn" title="这是 AWD 队伍封禁，不是赛事级封禁">
				`banTeam` / `unbanTeam` 写的是 AWD 队伍 ban 记录（选手端 AWD `banned` 由此得出）；
				赛事级封禁在「战队」标签里写 `event_teams.banned`。管理端没有单独的「AWD 封禁列表」接口，
				下表展示的是赛事战队列表与其赛事级封禁位。
			</Banner>

			<Card>
				<CardHead title="AWD 队伍封禁" icon="shield" sub={`${rows.length} 支战队`} />
				<CardBody flush>
					<QueryBoundary
						isPending={teams.isPending}
						isError={teams.isError}
						error={teams.error}
						refetch={() => void teams.refetch()}
						loadingLabel="正在加载战队…"
					>
						<DataTable
							rows={rows}
							rowKey={(team) => team.team.id}
							empty={<div className="xz-aev-emptyline">本赛事还没有战队。</div>}
							columns={[
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
									key: "eventBan",
									header: "赛事级封禁",
									render: (team) =>
										team.team.banned ? <Badge tone="danger">已封禁</Badge> : <Badge tone="ok">正常</Badge>,
								},
								{
									key: "points",
									header: "队内积分",
									numeric: true,
									render: (team) => formatNumber(team.team.points),
								},
								{
									key: "actions",
									header: "AWD 运维",
									align: "right",
									width: 220,
									render: (team) => (
										<RowActions>
											<Button
												size="sm"
												variant="danger-ghost"
												icon="ban"
												onClick={() => {
													setBanTarget(team);
													setReason("");
												}}
											>
												AWD 封禁
											</Button>
											<Button size="sm" icon="undo" onClick={() => void askUnban(team)}>
												AWD 解封
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
				open={banTarget !== null}
				onClose={() => setBanTarget(null)}
				tone="danger"
				persistent={ban.isPending}
				title={`AWD 封禁「${banTarget?.team.name ?? ""}」？`}
				description="封禁需要手动解封（没有自动到期）。"
				footer={
					<>
						<Button variant="quiet" onClick={() => setBanTarget(null)} disabled={ban.isPending}>
							取消
						</Button>
						<Button
							variant="danger"
							icon="ban"
							loading={ban.isPending}
							disabled={reason.trim().length === 0}
							onClick={() => banTarget && ban.mutate({ teamId: banTarget.team.id, reason: reason.trim() })}
						>
							确认封禁
						</Button>
					</>
				}
			>
				<Banner tone="danger" title="封禁后果">
					该队立即无法提交 flag / 参与攻防；防火墙会同步收紧其访问。封禁不会回滚既有得分。
				</Banner>
				<div style={{ marginTop: 12 }}>
					<TextField
						label="封禁原因（写入 AWD ban 记录）"
						required
						value={reason}
						onChange={setReason}
						placeholder="例如：违反比赛规则"
					/>
				</div>
			</Modal>
		</div>
	);
}

/* ── 赛事 GameBox 挂载 ───────────────────────────────────────────── */

interface EventGameBoxDraft {
	gamebox_id: string;
	host_offset: string;
	hidden: boolean;
	attack_score: string;
	judge_down_penalty: string;
	first_bonus: string;
}

const EMPTY_DRAFT: EventGameBoxDraft = {
	gamebox_id: "",
	host_offset: "",
	hidden: false,
	attack_score: "",
	judge_down_penalty: "",
	first_bonus: "",
};

function draftFromDto(dto: EventGameBoxDto): EventGameBoxDraft {
	return {
		gamebox_id: dto.gamebox_id,
		host_offset: numberText(dto.host_offset),
		hidden: dto.hidden,
		attack_score: numberText(dto.attack_score),
		judge_down_penalty: numberText(dto.judge_down_penalty),
		first_bonus: numberText(dto.first_bonus),
	};
}

export function AwdGameboxesSection({ eventId }: { eventId: string }) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const [addOpen, setAddOpen] = useState(false);
	const [draft, setDraft] = useState<EventGameBoxDraft>(EMPTY_DRAFT);
	const [editing, setEditing] = useState<EventGameBoxDto | null>(null);
	const [editDraft, setEditDraft] = useState<EventGameBoxDraft>(EMPTY_DRAFT);
	const [formError, setFormError] = useState<string | undefined>();

	const params = useMemo(() => ({ page: 1, limit: 200 }), []);
	const list = useQuery({
		queryKey: qk.awd.adminEventGameboxes(eventId),
		queryFn: () => callList(client.awd.admin.listEventGameboxes(eventId, params)),
		enabled: eventId.length > 0,
	});
	const library = useQuery({
		queryKey: qk.awd.gameboxLibrary(params),
		queryFn: () => callList(client.awd.admin.listGameboxes(params)),
		enabled: addOpen || editing !== null,
	});

	const rows = list.data?.items ?? [];
	const installed = useMemo(() => new Set(rows.map((row) => row.gamebox_id)), [rows]);

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: qk.awd.adminEventGameboxes(eventId) });
		void queryClient.invalidateQueries({ queryKey: ROOT.awdLibrary });
		void queryClient.invalidateQueries({ queryKey: ROOT.awdAdmin });
	};

	const numField = (text: string): number | undefined => {
		const parsed = parseNumberText(text);
		return parsed.ok && parsed.value !== null ? parsed.value : undefined;
	};

	const add = useMutation({
		mutationFn: () =>
			call(
				client.awd.admin.addEventGamebox(eventId, {
					gamebox_id: draft.gamebox_id,
					host_offset: numField(draft.host_offset),
					hidden: draft.hidden,
					attack_score: numField(draft.attack_score),
					judge_down_penalty: numField(draft.judge_down_penalty),
					first_bonus: numField(draft.first_bonus),
				}),
				"挂载结果",
			),
		onSuccess: (dto) => {
			toast.success("GameBox 已加入赛事", dto.gamebox_name);
			setAddOpen(false);
			setDraft(EMPTY_DRAFT);
			invalidate();
		},
		onError: (error) => toast.error("加入 GameBox 失败", errorText(error)),
	});

	const update = useMutation({
		mutationFn: (input: { id: string; body: Parameters<typeof client.awd.admin.updateEventGamebox>[2] }) =>
			call(client.awd.admin.updateEventGamebox(eventId, input.id, input.body), "更新结果"),
		onSuccess: () => {
			toast.success("赛事 GameBox 配置已更新");
			setEditing(null);
			invalidate();
		},
		onError: (error) => toast.error("更新赛事 GameBox 失败", errorText(error)),
	});

	const remove = useMutation({
		mutationFn: (eventGameboxId: string) => call(client.awd.admin.removeEventGamebox(eventId, eventGameboxId), "移除结果"),
		onSuccess: () => {
			toast.success("GameBox 已从赛事移除");
			invalidate();
		},
		onError: (error) => toast.error("移除赛事 GameBox 失败", errorText(error)),
	});

	const askRemove = async (dto: EventGameBoxDto) => {
		const ok = await confirm({
			title: `从赛事移除「${dto.gamebox_name}」？`,
			description: "只会解除赛事挂载关系，GameBox 库条目仍然保留。",
			consequences: "该题不再参与本赛事；已产生的容器与计分数据由后端按赛事状态处理，此操作不可撤销。",
			tone: "danger",
			confirmText: "移除",
		});
		if (ok) remove.mutate(dto.id);
	};

	const openEdit = (dto: EventGameBoxDto) => {
		setFormError(undefined);
		setEditDraft(draftFromDto(dto));
		setEditing(dto);
	};

	const submitEdit = () => {
		if (!editing) return;
		const host = parseNumberText(editDraft.host_offset);
		if (!host.ok) {
			setFormError(host.error);
			return;
		}
		const attack = parseNumberText(editDraft.attack_score);
		const penalty = parseNumberText(editDraft.judge_down_penalty);
		const bonus = parseNumberText(editDraft.first_bonus);
		const bad = [attack, penalty, bonus].find((entry) => !entry.ok);
		if (bad && !bad.ok) {
			setFormError(bad.error);
			return;
		}
		setFormError(undefined);
		update.mutate({
			id: editing.id,
			body: {
				hidden: editDraft.hidden,
				attack_score: attack.ok && attack.value !== null ? attack.value : undefined,
				judge_down_penalty: penalty.ok && penalty.value !== null ? penalty.value : undefined,
				first_bonus: bonus.ok && bonus.value !== null ? bonus.value : undefined,
			},
		});
	};

	return (
		<div className="xz-aev-col">
			<div className="xz-aev-toolbar">
				<Button
					variant="primary"
					icon="plus"
					onClick={() => {
						setDraft(EMPTY_DRAFT);
						setFormError(undefined);
						setAddOpen(true);
					}}
				>
					从库中加入 GameBox
				</Button>
				<span className="xz-aev-toolbar--end xz-muted xz-xs">赛事内 {rows.length} 个</span>
			</div>

			<Card>
				<CardHead title="赛事 GameBox" icon="box" sub="分值 / 罚分 / 首杀奖励均可在行内调整" />
				<CardBody flush>
					<QueryBoundary
						isPending={list.isPending}
						isError={list.isError}
						error={list.error}
						refetch={() => void list.refetch()}
						loadingLabel="正在加载赛事 GameBox…"
					>
						<DataTable
							rows={rows}
							rowKey={(row) => row.id}
							empty={<div className="xz-aev-emptyline">本赛事还没有挂载 GameBox。</div>}
							columns={[
								{
									key: "name",
									header: "GameBox",
									render: (row) => (
										<div>
											<div>{row.gamebox_name}</div>
											<div className="xz-muted xz-xs xz-mono">
												{row.gamebox_safe_name} · v{row.gamebox_version ?? "—"}
											</div>
										</div>
									),
								},
								{
									key: "flags",
									header: "开关",
									render: (row) => (
										<div className="xz-aev-badges">
											<Badge tone={row.enabled ? "ok" : "neutral"}>{row.enabled ? "已启用" : "已停用"}</Badge>
											{row.hidden ? <Badge tone="warn">隐藏</Badge> : null}
										</div>
									),
								},
								{
									key: "host",
									header: "host_offset",
									numeric: true,
									render: (row) => row.host_offset,
								},
								{
									key: "attack",
									header: "攻击分",
									numeric: true,
									render: (row) => formatNumber(row.attack_score),
								},
								{
									key: "penalty",
									header: "宕机罚分",
									numeric: true,
									render: (row) => formatNumber(row.judge_down_penalty),
								},
								{
									key: "bonus",
									header: "首杀奖励",
									numeric: true,
									render: (row) => formatNumber(row.first_bonus),
								},
								{
									key: "actions",
									header: "操作",
									align: "right",
									width: 260,
									render: (row) => (
										<RowActions>
											<Button
												size="sm"
												icon={row.enabled ? "pause" : "play"}
												onClick={() => update.mutate({ id: row.id, body: { enabled: !row.enabled } })}
											>
												{row.enabled ? "停用" : "启用"}
											</Button>
											<Button size="sm" icon="edit" onClick={() => openEdit(row)}>
												配置
											</Button>
											<Button size="sm" variant="danger-ghost" icon="trash" onClick={() => void askRemove(row)}>
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

			<Modal
				open={addOpen}
				onClose={() => setAddOpen(false)}
				size="wide"
				persistent={add.isPending}
				title="把 GameBox 加入本赛事"
				description="留空的字段由后端默认值决定；host_offset 用于错开宿主端口。"
				footer={
					<>
						<Button variant="quiet" onClick={() => setAddOpen(false)} disabled={add.isPending}>
							取消
						</Button>
						<Button
							variant="primary"
							icon="plus"
							loading={add.isPending}
							disabled={!draft.gamebox_id}
							onClick={() => add.mutate()}
						>
							加入赛事
						</Button>
					</>
				}
			>
				<div className="xz-aev-col">
					<Field label="GameBox（来自库）" required error={formError}>
						{(props) => (
							<Select
								{...props}
								value={draft.gamebox_id}
								onChange={(changeEvent) => setDraft({ ...draft, gamebox_id: changeEvent.target.value })}
							>
								<option value="">请选择</option>
								{(library.data?.items ?? []).map((gamebox: GameBoxLibraryDto) => (
									<option key={gamebox.id} value={gamebox.id} disabled={installed.has(gamebox.id)}>
										{gamebox.name}（{gamebox.safe_name}
										{installed.has(gamebox.id) ? " · 已挂载" : ""}）
									</option>
								))}
							</Select>
						)}
					</Field>
					<div className="xz-aev-grid3">
						<TextField
							label="host_offset"
							hint="留空 = 后端默认"
							value={draft.host_offset}
							onChange={(value) => setDraft({ ...draft, host_offset: value })}
						/>
						<TextField
							label="攻击分 attack_score"
							value={draft.attack_score}
							onChange={(value) => setDraft({ ...draft, attack_score: value })}
						/>
						<TextField
							label="宕机罚分 judge_down_penalty"
							value={draft.judge_down_penalty}
							onChange={(value) => setDraft({ ...draft, judge_down_penalty: value })}
						/>
						<TextField
							label="首杀奖励 first_bonus"
							value={draft.first_bonus}
							onChange={(value) => setDraft({ ...draft, first_bonus: value })}
						/>
					</div>
					<Checkbox
						label="对选手隐藏（hidden）"
						checked={draft.hidden}
						onChange={(checked) => setDraft({ ...draft, hidden: checked })}
					/>
					{library.isError ? (
						<Banner tone="danger" title="GameBox 库加载失败">
							{errorText(library.error)}
						</Banner>
					) : null}
				</div>
			</Modal>

			<Modal
				open={editing !== null}
				onClose={() => setEditing(null)}
				persistent={update.isPending}
				title={`赛事 GameBox 配置 · ${editing?.gamebox_name ?? ""}`}
				description="可空字段留空表示不修改（与 SDK 的「省略 = 不改」语义一致）。"
				footer={
					<>
						<Button variant="quiet" onClick={() => setEditing(null)} disabled={update.isPending}>
							取消
						</Button>
						<Button variant="primary" icon="save" loading={update.isPending} onClick={() => submitEdit()}>
							保存
						</Button>
					</>
				}
			>
				<div className="xz-aev-col">
					<div className="xz-aev-grid3">
						<TextField
							label="攻击分 attack_score"
							value={editDraft.attack_score}
							onChange={(value) => setEditDraft({ ...editDraft, attack_score: value })}
						/>
						<TextField
							label="宕机罚分 judge_down_penalty"
							value={editDraft.judge_down_penalty}
							onChange={(value) => setEditDraft({ ...editDraft, judge_down_penalty: value })}
						/>
						<TextField
							label="首杀奖励 first_bonus"
							value={editDraft.first_bonus}
							onChange={(value) => setEditDraft({ ...editDraft, first_bonus: value })}
						/>
					</div>
					{formError ? (
						<Banner tone="danger" title="输入有误">
							{formError}
						</Banner>
					) : null}
					<Checkbox
						label="对选手隐藏（hidden）"
						checked={editDraft.hidden}
						onChange={(checked) => setEditDraft({ ...editDraft, hidden: checked })}
					/>
					<div className="xz-aev-note">
						当前：启用 {editing?.enabled ? "是" : "否"} · host_offset {editing?.host_offset ?? "—"} · CPU{" "}
						{editing?.cpu_millis ?? "—"} · 内存 {editing?.memory_bytes ?? "—"} · 创建于{" "}
						{formatDateTime(editing?.created_at)}
					</div>
				</div>
			</Modal>
		</div>
	);
}

/* ── GameBox 实例重置（specialized）──────────────────────────────── */

export function AwdInstanceResetSection({ eventId }: { eventId: string }) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const pager = usePager(50);
	const [search, setSearch] = useState("");
	const debounced = useDebounced(search);

	const list = useQuery({
		queryKey: qk.admin.eventInstances(eventId, pager.params),
		queryFn: () => callList(client.admin.instances.listForEvent(eventId, pager.params)),
		enabled: eventId.length > 0,
	});

	const rows = (list.data?.items ?? []).filter((row) => row.instance_type === "gamebox");
	const meta = readMeta(list.data?.meta, pager.pageSize);
	const filtered = useMemo(() => {
		const needle = debounced.trim().toLowerCase();
		if (!needle) return rows;
		return rows.filter((row) =>
			[row.identifier, row.content_title ?? "", row.user_name ?? "", row.team_name ?? ""].some((value) =>
				value.toLowerCase().includes(needle),
			),
		);
	}, [rows, debounced]);

	const reset = useMutation({
		mutationFn: (instanceId: string) => call(client.awd.admin.resetGamebox(eventId, instanceId), "重置结果"),
		onSuccess: () => {
			toast.success("GameBox 已重置");
			void queryClient.invalidateQueries({ queryKey: qk.admin.eventInstances(eventId, pager.params) });
			void queryClient.invalidateQueries({ queryKey: qk.awd.adminEventGameboxes(eventId) });
		},
		onError: (error) => toast.error("重置 GameBox 失败", errorText(error)),
	});

	const askReset = async (row: AdminInstanceRow) => {
		const ok = await confirm({
			title: `重置实例「${row.content_title ?? row.identifier}」？`,
			description: "管理端重置会重建该 GameBox 运行环境（runtime_generation + 1）。",
			consequences:
				"管理员重置不消耗队伍的免费重置次数，但会中断该队当前环境（已获得的攻击/防守分不回滚）。请确认比赛状态允许。",
			tone: "danger",
			confirmText: "重置",
		});
		if (ok) reset.mutate(row.id);
	};

	return (
		<Card>
			<CardHead
				title="GameBox 实例重置"
				icon="refresh"
				sub="specialized 能力：管理员重置任意参赛队伍的 GameBox"
				actions={
					<span className="xz-search">
						<span className="xz-search__icon">
							<Icon name="search" size={14} />
						</span>
						<input
							className="xz-input"
							placeholder="搜索队伍 / 实例"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
						/>
					</span>
				}
			/>
			<CardBody flush>
				<QueryBoundary
					isPending={list.isPending}
					isError={list.isError}
					error={list.error}
					refetch={() => void list.refetch()}
					loadingLabel="正在加载参赛实例…"
				>
					<DataTable
						rows={filtered}
						rowKey={(row) => row.id}
						empty={<div className="xz-aev-emptyline">没有 GameBox 实例（可能尚未部署）。</div>}
						columns={[
							{
								key: "content",
								header: "GameBox",
								render: (row) => (
									<div>
										<div>{row.content_title ?? row.gamebox_id ?? "—"}</div>
										<div className="xz-muted xz-xs xz-mono">{row.identifier}</div>
									</div>
								),
							},
							{
								key: "owner",
								header: "归属",
								render: (row) => (
									<div className="xz-xs">
										{row.team_name ? <div>战队：{row.team_name}</div> : null}
										{row.user_name ? <div>用户：{row.user_name}</div> : null}
										{!row.team_name && !row.user_name ? <span className="xz-muted">—</span> : null}
									</div>
								),
							},
							{
								key: "status",
								header: "状态",
								render: (row) => <Badge tone={runtimeStateTone(row.status)}>{row.status}</Badge>,
							},
							{
								key: "generation",
								header: "运行代",
								numeric: true,
								render: (row) => row.runtime_generation ?? "—",
							},
							{
								key: "actions",
								header: "操作",
								align: "right",
								render: (row) => (
									<Button
										size="sm"
										variant="danger-ghost"
										icon="refresh"
										loading={reset.isPending && reset.variables === row.id}
										onClick={() => void askReset(row)}
									>
										重置
									</Button>
								),
							},
						]}
					/>
				</QueryBoundary>
			</CardBody>
			<Pagination
				page={meta.page}
				pageSize={meta.pageSize}
				total={meta.total}
				onPageChange={pager.setPage}
				onPageSizeChange={pager.setPageSize}
			/>
		</Card>
	);
}
