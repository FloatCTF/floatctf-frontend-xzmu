/**
 * 赛事控制台 · `challenges` 标签 —— 赛事题目管理。
 *
 * SDK 形态（注意**柯里化**）：
 * - `client.admin.event_challenges.fetch(eventId)(params)` → `AdminEventChallengeResult[]`
 * - `client.admin.event_challenges.remove(eventId)(id_list)`
 * - `add` / `setPoints` / `open` / `hidden` 是普通对象参数（`add` 支持单题或批量）。
 *
 * 语义：`hidden = false` 是选手端能看到该题的唯一条件；`open` / `hidden` 会**立即**改变选手可见性。
 * `challenge.static_flag_value` 是 admin 专属 secret，展示一律走 `<Secret>`（默认模糊）。
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminEventChallengeResult } from "@floatctf/sdk";

import { call, callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { Link } from "../../../router/Link.tsx";
import { QueryBoundary, Modal, useConfirm, useToast } from "../../../ui/overlays.tsx";
import {
	Badge,
	Banner,
	Button,
	Card,
	CardBody,
	CardHead,
	Field,
	Secret,
	TextInput,
} from "../../../ui/primitives.tsx";
import { DataTable, Pagination, readMeta } from "../../../ui/Table.tsx";
import { ChallengePickerModal, ROOT, RowActions, parseNumberText, usePager } from "./shared.tsx";

export function EventChallengesTab({ eventId }: { eventId: string }) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const pager = usePager(50);
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	const [pickerOpen, setPickerOpen] = useState(false);
	const [pointsTarget, setPointsTarget] = useState<string[] | null>(null);
	const [pointsText, setPointsText] = useState("100");
	const [pointsError, setPointsError] = useState<string | undefined>();

	const list = useQuery({
		queryKey: qk.admin.eventChallenges(eventId, pager.params),
		queryFn: () => callList(client.admin.event_challenges.fetch(eventId)(pager.params)),
		enabled: eventId.length > 0,
	});

	const rows = list.data?.items ?? [];
	const meta = readMeta(list.data?.meta, pager.pageSize);
	const excluded = useMemo(() => new Set(rows.map((row) => row.event_challenge.challenge_id)), [rows]);
	const selectedIds = useMemo(() => [...selected], [selected]);

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: qk.admin.eventChallenges(eventId, pager.params) });
		void queryClient.invalidateQueries({ queryKey: ROOT.adminEvents });
		void queryClient.invalidateQueries({ queryKey: ROOT.events });
	};

	const add = useMutation({
		mutationFn: (ids: string[]) =>
			call(client.admin.event_challenges.add({ event_id: eventId, challenge_id_list: ids }), "挂题结果"),
		onSuccess: () => {
			toast.success("题目已加入赛事", "分值使用后端默认值，可在列表里单独调整。");
			setPickerOpen(false);
			invalidate();
		},
		onError: (error) => toast.error("加入题目失败", errorText(error)),
	});

	const setPoints = useMutation({
		mutationFn: (input: { ids: string[]; points: number }) =>
			call(
				client.admin.event_challenges.setPoints({
					event_id: eventId,
					challenge_id_list: input.ids,
					points: input.points,
				}),
				"改分结果",
			),
		onSuccess: () => {
			toast.success("分值已更新", "改动会立即影响计分。");
			setPointsTarget(null);
			setSelected(new Set());
			invalidate();
		},
		onError: (error) => toast.error("设置分值失败", errorText(error)),
	});

	const setHidden = useMutation({
		mutationFn: (input: { ids: string[]; hidden: boolean }) =>
			call(
				input.hidden
					? client.admin.event_challenges.hidden({ event_id: eventId, challenge_id_list: input.ids })
					: client.admin.event_challenges.open({ event_id: eventId, challenge_id_list: input.ids }),
				"可见性结果",
			),
		onSuccess: (_data, input) => {
			toast.success(input.hidden ? "题目已对选手隐藏" : "题目已对选手开放");
			setSelected(new Set());
			invalidate();
		},
		onError: (error) => toast.error("修改可见性失败", errorText(error)),
	});

	const remove = useMutation({
		mutationFn: (ids: string[]) => call(client.admin.event_challenges.remove(eventId)(ids), "移除结果"),
		onSuccess: () => {
			toast.success("题目已从赛事移除");
			setSelected(new Set());
			invalidate();
		},
		onError: (error) => toast.error("移除题目失败", errorText(error)),
	});

	const askRemove = async (targets: AdminEventChallengeResult[]) => {
		if (targets.length === 0) return;
		const first = targets[0];
		const ok = await confirm({
			title:
				targets.length === 1
					? `从赛事移除「${first?.challenge.name ?? ""}」？`
					: `从赛事移除 ${targets.length} 道题？`,
			description: "只取消挂题关系，题库里的题目本身不会被删除。",
			consequences: "选手端立即看不到这些题；已有的解题记录不会回滚，但不会再计入赛事的可见题目列表。",
			tone: "danger",
			confirmText: "移除",
		});
		if (ok) remove.mutate(targets.map((row) => row.event_challenge.challenge_id));
	};

	const openPoints = (ids: string[]) => {
		setPointsText("100");
		setPointsError(undefined);
		setPointsTarget(ids);
	};

	const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.event_challenge.challenge_id));

	return (
		<div className="xz-aev-col">
			<Banner tone="info" title="开放 / 隐藏是选手可见性的唯一开关">
				`hidden = false` 的题目才会出现在选手端赛事题目列表里；隐藏语义是**不可见**，而不是「可见但不可提交」。
			</Banner>

			<div className="xz-aev-toolbar">
				<Button variant="primary" icon="plus" onClick={() => setPickerOpen(true)}>
					添加题目
				</Button>
				<Button
					icon="eye"
					disabled={selectedIds.length === 0}
					onClick={() => setHidden.mutate({ ids: selectedIds, hidden: false })}
				>
					批量开放
				</Button>
				<Button
					icon="eyeOff"
					disabled={selectedIds.length === 0}
					onClick={() => setHidden.mutate({ ids: selectedIds, hidden: true })}
				>
					批量隐藏
				</Button>
				<Button icon="target" disabled={selectedIds.length === 0} onClick={() => openPoints(selectedIds)}>
					批量改分
				</Button>
				<Button
					variant="danger-ghost"
					icon="trash"
					disabled={selectedIds.length === 0}
					onClick={() => void askRemove(rows.filter((row) => selected.has(row.event_challenge.challenge_id)))}
				>
					批量移除（{selectedIds.length}）
				</Button>
				<span className="xz-aev-toolbar--end xz-muted xz-xs">共 {meta.total} 道题</span>
			</div>

			<Card>
				<CardHead title="赛事题目" icon="puzzle" sub="分值与可见性均为后端真值" />
				<CardBody flush>
					<QueryBoundary
						isPending={list.isPending}
						isError={list.isError}
						error={list.error}
						refetch={() => void list.refetch()}
						loadingLabel="正在加载赛事题目…"
					>
						<DataTable
							rows={rows}
							rowKey={(row) => row.event_challenge.challenge_id}
							empty={<div className="xz-aev-emptyline">本赛事还没有挂任何题目，点「添加题目」开始。</div>}
							columns={[
								{
									key: "select",
									header: (
										<input
											type="checkbox"
											aria-label="全选本页题目"
											checked={allSelected}
											onChange={() =>
												setSelected((current) => {
													const next = new Set(current);
													if (allSelected) {
														for (const row of rows) next.delete(row.event_challenge.challenge_id);
													} else {
														for (const row of rows) next.add(row.event_challenge.challenge_id);
													}
													return next;
												})
											}
										/>
									),
									width: 36,
									render: (row) => (
										<input
											type="checkbox"
											aria-label={`选择 ${row.challenge.name}`}
											checked={selected.has(row.event_challenge.challenge_id)}
											onChange={(event) =>
												setSelected((current) => {
													const next = new Set(current);
													if (event.target.checked) next.add(row.event_challenge.challenge_id);
													else next.delete(row.event_challenge.challenge_id);
													return next;
												})
											}
										/>
									),
								},
								{
									key: "name",
									header: "题目",
									render: (row) => (
										<div>
											<div>{row.challenge.name}</div>
											<div className="xz-muted xz-xs">
												{row.challenge.category} · <code className="xz-code">{row.challenge.safe_name}</code>
											</div>
										</div>
									),
								},
								{
									key: "flag",
									header: "静态 flag",
									render: (row) =>
										row.challenge.static_flag_value ? (
											<Secret value={row.challenge.static_flag_value} />
										) : (
											<span className="xz-muted">—（动态或无）</span>
										),
								},
								{
									key: "points",
									header: "分值",
									numeric: true,
									render: (row) => <span className="xz-aev-score">{row.event_challenge.points}</span>,
								},
								{
									key: "hidden",
									header: "选手可见",
									render: (row) =>
										row.event_challenge.hidden ? (
											<Badge tone="warn" icon="eyeOff">
												已隐藏
											</Badge>
										) : (
											<Badge tone="ok" icon="eye">
												可见
											</Badge>
										),
								},
								{
									key: "build",
									header: "构建状态",
									render: (row) =>
										row.challenge.build_status ? (
											<Badge tone={row.challenge.build_status === "ready" ? "ok" : "danger"}>
												{row.challenge.build_status}
											</Badge>
										) : (
											<span className="xz-muted">—</span>
										),
								},
								{
									key: "actions",
									header: "操作",
									align: "right",
									width: 280,
									render: (row) => (
										<RowActions>
											<Link to="/admin/challenges" className="xz-btn xz-btn--sm xz-btn--quiet">
												题库
											</Link>
											<Button
												size="sm"
												icon={row.event_challenge.hidden ? "eye" : "eyeOff"}
												onClick={() =>
													setHidden.mutate({
														ids: [row.event_challenge.challenge_id],
														hidden: !row.event_challenge.hidden,
													})
												}
											>
												{row.event_challenge.hidden ? "开放" : "隐藏"}
											</Button>
											<Button size="sm" icon="target" onClick={() => openPoints([row.event_challenge.challenge_id])}>
												改分
											</Button>
											<Button size="sm" variant="danger-ghost" icon="trash" onClick={() => void askRemove([row])}>
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

			<ChallengePickerModal
				open={pickerOpen}
				title="把题目加入本赛事"
				description="只提交题目 ID；分值使用后端默认值，加入后可单独调整。"
				excludedIds={excluded}
				busy={add.isPending}
				onClose={() => setPickerOpen(false)}
				onConfirm={(ids) => add.mutate(ids)}
			/>

			<Modal
				open={pointsTarget !== null}
				onClose={() => setPointsTarget(null)}
				title="设置题目分值"
				description={`将对 ${pointsTarget?.length ?? 0} 道题生效；分值必须为正数。`}
				persistent={setPoints.isPending}
				footer={
					<>
						<Button variant="quiet" onClick={() => setPointsTarget(null)} disabled={setPoints.isPending}>
							取消
						</Button>
						<Button
							variant="primary"
							icon="save"
							loading={setPoints.isPending}
							onClick={() => {
								const parsed = parseNumberText(pointsText);
								if (!parsed.ok) {
									setPointsError(parsed.error);
									return;
								}
								if (parsed.value === null || parsed.value <= 0) {
									setPointsError("分值必须大于 0");
									return;
								}
								setPointsError(undefined);
								if (pointsTarget) setPoints.mutate({ ids: pointsTarget, points: parsed.value });
							}}
						>
							保存分值
						</Button>
					</>
				}
			>
				<Banner tone="warn" title="改分会立即影响计分">
					已解出该题的选手按原分值记账；新分值只影响之后的解出与榜单展示。
				</Banner>
				<div style={{ marginTop: 12 }}>
					<Field label="分值" required error={pointsError}>
						{(props) => (
							<TextInput
								{...props}
								type="number"
								min={1}
								value={pointsText}
								onChange={(event) => setPointsText(event.target.value)}
							/>
						)}
					</Field>
				</div>
			</Modal>
		</div>
	);
}
