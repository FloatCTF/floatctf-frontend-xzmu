/**
 * `/admin/challenge-sets` + `/admin/challenge-sets/:id` —— 题集管理。
 *
 * SDK：
 * - 列表 `getChallengeSets(params)`、`createChallengeSet(payload)`、`patchChallengeSet({id, …})`、`deleteChallengeSet(id_list)`
 * - 明细 `getChallengeSet(id)(params)`（**柯里化**）
 * - 加题 `addChallengeToSet({set_id, challenge_id_list})`、移题 `removeChallengeFromSet(id)(id_list)`（**柯里化**）
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChallengeSets } from "@floatctf/sdk/entity";

import { call, callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { formatDateTime } from "../../../lib/format.ts";
import { useDebounced } from "../../../lib/hooks.ts";
import { Link } from "../../../router/Link.tsx";
import type { PageProps } from "../../../router/pages.ts";
import { useDocumentTitle } from "../../../router/router.tsx";
import { Icon } from "../../../ui/icons.tsx";
import { Modal, QueryBoundary, useConfirm, useToast } from "../../../ui/overlays.tsx";
import {
	Badge,
	Banner,
	Button,
	Card,
	CardBody,
	CardHead,
	EmptyState,
	Secret,
} from "../../../ui/primitives.tsx";
import { DataTable, Pagination, readMeta } from "../../../ui/Table.tsx";
import { ChallengePickerModal, ROOT, RowActions, TextAreaField, TextField, usePager } from "./shared.tsx";

/* ── 题集列表 ─────────────────────────────────────────────────────── */

interface SetDraft {
	id?: string;
	name: string;
	description: string;
}

export function AdminChallengeSetsPage() {
	useDocumentTitle("题集管理");
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const pager = usePager();
	const [search, setSearch] = useState("");
	const [draft, setDraft] = useState<SetDraft | null>(null);
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	const debounced = useDebounced(search);

	const list = useQuery({
		queryKey: qk.admin.challengeSets(pager.params),
		queryFn: () => callList(client.admin.challenges.getChallengeSets(pager.params)),
	});

	const items = list.data?.items ?? [];
	const meta = readMeta(list.data?.meta, pager.pageSize);

	const filtered = useMemo(() => {
		const needle = debounced.trim().toLowerCase();
		if (!needle) return items;
		return items.filter((set) =>
			[set.name, set.description ?? "", set.id].some((value) => (value ?? "").toLowerCase().includes(needle)),
		);
	}, [items, debounced]);

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: ROOT.adminChallengeSets });
	};

	const save = useMutation({
		mutationFn: (input: SetDraft) => {
			const payload: Partial<ChallengeSets> = { name: input.name.trim(), description: input.description };
			if (input.id) return call(client.admin.challenges.patchChallengeSet({ ...payload, id: input.id }), "题集更新");
			return call(client.admin.challenges.createChallengeSet(payload), "题集创建");
		},
		onSuccess: (_data, input) => {
			toast.success(input.id ? "题集已更新" : "题集已创建");
			setDraft(null);
			invalidate();
		},
		onError: (error) => toast.error(draft?.id ? "更新题集失败" : "创建题集失败", errorText(error)),
	});

	const remove = useMutation({
		mutationFn: (ids: string[]) => call(client.admin.challenges.deleteChallengeSet(ids), "删除结果"),
		onSuccess: () => {
			toast.success("题集已删除");
			setSelected(new Set());
			invalidate();
		},
		onError: (error) => toast.error("删除题集失败", errorText(error)),
	});

	const askRemove = async (targets: ChallengeSets[]) => {
		if (targets.length === 0) return;
		const first = targets[0];
		const ok = await confirm({
			title: targets.length === 1 ? `删除题集「${first?.name ?? ""}」？` : `删除 ${targets.length} 个题集？`,
			description: "只会删除题集本身与它的题目清单，题目不会被删除。",
			consequences: "依赖该题集的训练/赛事入口会失效。此操作不可撤销。",
			tone: "danger",
			confirmText: "删除题集",
		});
		if (ok) remove.mutate(targets.map((set) => set.id));
	};

	return (
		<div className="xz-page xz-page--wide">
			<header className="xz-page__head xz-aev-pagehead">
				<div className="xz-grow">
					<h1 className="xz-page__title">题集管理</h1>
					<p className="xz-page__desc">
						题集是题目的有序集合（训练与赛事都可用）。点开任意题集可以增删其中的题目。
					</p>
				</div>
				<Button variant="primary" icon="plus" onClick={() => setDraft({ name: "", description: "" })}>
					创建题集
				</Button>
			</header>

			<div className="xz-filters">
				<span className="xz-search">
					<span className="xz-search__icon">
						<Icon name="search" size={14} />
					</span>
					<input
						className="xz-input"
						data-page-search
						placeholder="搜索题集名称 / 描述"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
				</span>
				<Button
					variant="danger-ghost"
					icon="trash"
					disabled={selected.size === 0}
					onClick={() => void askRemove(items.filter((set) => selected.has(set.id)))}
				>
					删除选中（{selected.size}）
				</Button>
				<span className="xz-aev-toolbar--end xz-muted xz-xs">共 {meta.total} 个题集</span>
			</div>

			<Card>
				<CardHead title="题集" icon="layers" />
				<CardBody flush>
					<QueryBoundary
						isPending={list.isPending}
						isError={list.isError}
						error={list.error}
						refetch={() => void list.refetch()}
						loadingLabel="正在加载题集…"
					>
						<DataTable
							rows={filtered}
							rowKey={(set) => set.id}
							empty={<div className="xz-aev-emptyline">还没有题集。</div>}
							columns={[
								{
									key: "select",
									header: <span className="xz-sr">选择</span>,
									width: 36,
									render: (set) => (
										<input
											type="checkbox"
											aria-label={`选择 ${set.name}`}
											checked={selected.has(set.id)}
											onChange={(event) =>
												setSelected((current) => {
													const next = new Set(current);
													if (event.target.checked) next.add(set.id);
													else next.delete(set.id);
													return next;
												})
											}
										/>
									),
								},
								{
									key: "name",
									header: "题集",
									render: (set) => (
										<div>
											<Link to={`/admin/challenge-sets/${set.id}`}>{set.name}</Link>
											<div className="xz-muted xz-xs xz-mono">{set.id}</div>
										</div>
									),
								},
								{
									key: "description",
									header: "描述",
									render: (set) => <span className="xz-clamp-2">{set.description || "—"}</span>,
								},
								{ key: "created", header: "创建时间", render: (set) => formatDateTime(set.created_at) },
								{ key: "updated", header: "更新时间", render: (set) => formatDateTime(set.updated_at) },
								{
									key: "actions",
									header: "操作",
									align: "right",
									width: 220,
									render: (set) => (
										<RowActions>
											<Link to={`/admin/challenge-sets/${set.id}`} className="xz-btn xz-btn--sm">
												<Icon name="list" size={14} />
												管理题目
											</Link>
											<Button
												size="sm"
												icon="edit"
												onClick={() =>
													setDraft({ id: set.id, name: set.name, description: set.description ?? "" })
												}
											>
												编辑
											</Button>
											<Button size="sm" variant="danger-ghost" icon="trash" onClick={() => void askRemove([set])}>
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
				persistent={save.isPending}
				title={draft?.id ? "编辑题集" : "创建题集"}
				footer={
					<>
						<Button variant="quiet" onClick={() => setDraft(null)} disabled={save.isPending}>
							取消
						</Button>
						<Button
							variant="primary"
							icon="save"
							loading={save.isPending}
							disabled={!draft || draft.name.trim().length === 0}
							onClick={() => draft && save.mutate(draft)}
						>
							{draft?.id ? "保存" : "创建"}
						</Button>
					</>
				}
			>
				{draft ? (
					<div className="xz-aev-col">
						<TextField
							label="题集名称"
							required
							value={draft.name}
							onChange={(value) => setDraft({ ...draft, name: value })}
						/>
						<TextAreaField
							label="描述"
							rows={4}
							value={draft.description}
							onChange={(value) => setDraft({ ...draft, description: value })}
						/>
					</div>
				) : null}
			</Modal>
		</div>
	);
}

/* ── 题集内题目 ───────────────────────────────────────────────────── */

export function AdminChallengeSetDetailPage({ params }: PageProps) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const setId = params.id ?? "";
	const pager = usePager(50);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [selected, setSelected] = useState<Set<string>>(() => new Set());

	useDocumentTitle("题集题目");

	const sets = useQuery({
		queryKey: qk.admin.challengeSets(),
		queryFn: () => callList(client.admin.challenges.getChallengeSets()),
	});
	const meta = sets.data?.items.find((set) => set.id === setId) ?? null;

	const list = useQuery({
		// 柯里化：`getChallengeSet(id)(params)`
		queryKey: qk.admin.challengeSet(setId, pager.params),
		queryFn: () => callList(client.admin.challenges.getChallengeSet(setId)(pager.params)),
		enabled: setId.length > 0,
	});

	const rows = list.data?.items ?? [];
	const page = readMeta(list.data?.meta, pager.pageSize);
	const excluded = useMemo(() => new Set(rows.map((row) => row.id)), [rows]);
	const selectedIds = useMemo(() => [...selected], [selected]);

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: ROOT.adminChallengeSets });
		void queryClient.invalidateQueries({ queryKey: qk.admin.challengeSet(setId, pager.params) });
	};

	const add = useMutation({
		mutationFn: (ids: string[]) =>
			call(client.admin.challenges.addChallengeToSet({ set_id: setId, challenge_id_list: ids }), "加题结果"),
		onSuccess: (_data, ids) => {
			toast.success("题目已加入题集", `共 ${ids.length} 道`);
			setPickerOpen(false);
			invalidate();
		},
		onError: (error) => toast.error("加入题集失败", errorText(error)),
	});

	const remove = useMutation({
		mutationFn: (ids: string[]) =>
			call(client.admin.challenges.removeChallengeFromSet(setId)(ids), "移出结果"),
		onSuccess: () => {
			toast.success("题目已从题集移出");
			setSelected(new Set());
			invalidate();
		},
		onError: (error) => toast.error("移出题集失败", errorText(error)),
	});

	const askRemove = async (targets: string[]) => {
		if (targets.length === 0) return;
		const ok = await confirm({
			title: `从题集移出 ${targets.length} 道题？`,
			description: "只会解除题集与题目的关联，题目本身不受影响。",
			consequences: "训练入口中该题将不再出现。",
			tone: "danger",
			confirmText: "移出题集",
		});
		if (ok) remove.mutate(targets);
	};

	if (!setId) {
		return (
			<div className="xz-page">
				<EmptyState icon="alert" title="缺少题集 ID" desc="地址里没有题集标识，请从题集列表进入。" />
			</div>
		);
	}

	return (
		<div className="xz-page xz-page--wide">
			<header className="xz-page__head xz-aev-pagehead">
				<div className="xz-grow">
					<div className="xz-aev-inline" style={{ marginBottom: 6 }}>
						<Link to="/admin/challenge-sets" className="xz-muted xz-xs">
							← 题集列表
						</Link>
						<Badge tone="crimson">题集</Badge>
					</div>
					<h1 className="xz-page__title">{meta?.name ?? "题集"}</h1>
					<p className="xz-page__desc">
						{meta?.description || "（无描述）"} · <span className="xz-mono xz-xs">{setId}</span>
					</p>
				</div>
				<div className="xz-aev-inline">
					<Button variant="primary" icon="plus" onClick={() => setPickerOpen(true)}>
						加入题目
					</Button>
					<Button
						variant="danger-ghost"
						icon="trash"
						disabled={selectedIds.length === 0}
						onClick={() => void askRemove(selectedIds)}
					>
						移出选中（{selectedIds.length}）
					</Button>
				</div>
			</header>

			<Banner tone="info" title="调用形态">
				{"`getChallengeSet(id)(params)` 与 `removeChallengeFromSet(id)(id_list)` 都是**柯里化**方法；加题用 `addChallengeToSet({ set_id, challenge_id_list })`。"}
			</Banner>

			<Card>
				<CardHead title="题集内题目" icon="puzzle" sub={`共 ${page.total} 道`} />
				<CardBody flush>
					<QueryBoundary
						isPending={list.isPending}
						isError={list.isError}
						error={list.error}
						refetch={() => void list.refetch()}
						loadingLabel="正在加载题集题目…"
					>
						<DataTable
							rows={rows}
							rowKey={(row) => row.id}
							empty={<div className="xz-aev-emptyline">该题集还没有题目。</div>}
							columns={[
								{
									key: "select",
									header: <span className="xz-sr">选择</span>,
									width: 36,
									render: (row) => (
										<input
											type="checkbox"
											aria-label={`选择 ${row.name}`}
											checked={selected.has(row.id)}
											onChange={(event) =>
												setSelected((current) => {
													const next = new Set(current);
													if (event.target.checked) next.add(row.id);
													else next.delete(row.id);
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
											<div>{row.name}</div>
											<div className="xz-muted xz-xs xz-mono">
												{row.safe_name} · {row.category}
											</div>
										</div>
									),
								},
								{
									key: "flag",
									header: "静态 flag",
									render: (row) =>
										row.static_flag_value ? (
											<Secret value={row.static_flag_value} />
										) : (
											<span className="xz-muted">—</span>
										),
								},
								{
									key: "build",
									header: "构建状态",
									render: (row) =>
										row.build_status ? (
											<Badge tone={row.build_status === "ready" ? "ok" : "danger"}>{row.build_status}</Badge>
										) : (
											<span className="xz-muted">—</span>
										),
								},
								{
									key: "actions",
									header: "操作",
									align: "right",
									render: (row) => (
										<RowActions>
											<Button
												size="sm"
												variant="danger-ghost"
												icon="trash"
												onClick={() => void askRemove([row.id])}
											>
												移出
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
				page={page.page}
				pageSize={page.pageSize}
				total={page.total}
				onPageChange={pager.setPage}
				onPageSizeChange={pager.setPageSize}
			/>

			<ChallengePickerModal
				open={pickerOpen}
				title="把题目加入题集"
				description="已在该题集中的题目会被隐藏，避免重复加入。"
				excludedIds={excluded}
				busy={add.isPending}
				onClose={() => setPickerOpen(false)}
				onConfirm={(ids) => add.mutate(ids)}
			/>
		</div>
	);
}
