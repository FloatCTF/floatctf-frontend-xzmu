/**
 * `/admin/challenges` —— 挑战管理 CRUD + 导入 / 校验 / 构建 / 扫描。
 *
 * 与后端语义一致：
 * - **题目主入口是包导入**（`importChallenge(File)`，multipart 字段 `package_zip`，接受 `.zip`）；
 *   本前端同时提供手工新建表单，界面上明确「推荐用包导入」。
 * - `build_status === "ready"` 才可构建；`buildChallenges` 只对 ready 生效。
 * - `static_flag_value` **只从 admin 接口返回**，属于 secret：展示用 `<Secret>`（默认模糊），
 *   并且绝不出现在任何选手端页面。
 * - 导入 / 构建 / 扫描是重操作：有忙碌态与逐条结果列表。
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChallengesListItem } from "@floatctf/sdk";

import { call, callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
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
	Secret,
	Select,
	TextInput,
} from "../../../ui/primitives.tsx";
import { DataTable, Pagination, readMeta } from "../../../ui/Table.tsx";
import {
	ImportFileButton,
	OpResultList,
	ROOT,
	RowActions,
	TextAreaField,
	TextField,
	type OpResultRow,
	numberText,
	parseNumberText,
	usePager,
} from "./shared.tsx";

interface ChallengeForm {
	name: string;
	category: string;
	description: string;
	static_flag_value: string;
	container_port: string;
	recommended_cpu_millis: string;
	recommended_memory_bytes: string;
	recommended_pids_limit: string;
	hidden: boolean;
}

const EMPTY_FORM: ChallengeForm = {
	name: "",
	category: "",
	description: "",
	static_flag_value: "",
	container_port: "",
	recommended_cpu_millis: "",
	recommended_memory_bytes: "",
	recommended_pids_limit: "",
	hidden: false,
};

function formFrom(challenge: ChallengesListItem): ChallengeForm {
	return {
		name: challenge.name,
		category: challenge.category,
		description: challenge.description ?? "",
		static_flag_value: challenge.static_flag_value ?? "",
		container_port: numberText(challenge.container_port),
		recommended_cpu_millis: numberText(challenge.recommended_cpu_millis),
		recommended_memory_bytes: numberText(challenge.recommended_memory_bytes),
		recommended_pids_limit: numberText(challenge.recommended_pids_limit),
		hidden: challenge.hidden,
	};
}

export function AdminChallengesPage() {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const pager = usePager();
	const [search, setSearch] = useState("");
	const [category, setCategory] = useState("all");
	const [buildStatus, setBuildStatus] = useState("all");
	const debounced = useDebounced(search);
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	const [editing, setEditing] = useState<ChallengesListItem | null | undefined>(undefined);
	const [checkRows, setCheckRows] = useState<OpResultRow[] | null>(null);
	const [buildRows, setBuildRows] = useState<OpResultRow[] | null>(null);
	const [scanRows, setScanRows] = useState<OpResultRow[] | null>(null);

	const list = useQuery({
		queryKey: qk.admin.challenges(pager.params),
		queryFn: () => callList(client.admin.challenges.fetch(pager.params)),
	});

	const items = list.data?.items ?? [];
	const meta = readMeta(list.data?.meta, pager.pageSize);
	const categories = useMemo(() => [...new Set(items.map((item) => item.category))].sort(), [items]);
	const buildStatuses = useMemo(
		() => [...new Set(items.map((item) => item.build_status ?? "（无）"))].sort(),
		[items],
	);

	const filtered = useMemo(
		() =>
			items.filter((challenge) => {
				if (category !== "all" && challenge.category !== category) return false;
				if (buildStatus !== "all" && (challenge.build_status ?? "（无）") !== buildStatus) return false;
				const needle = debounced.trim().toLowerCase();
				if (!needle) return true;
				return [challenge.name, challenge.safe_name, challenge.category, challenge.id].some((value) =>
					value.toLowerCase().includes(needle),
				);
			}),
		[items, category, buildStatus, debounced],
	);

	const selectedIds = useMemo(() => [...selected], [selected]);
	const allSelected = filtered.length > 0 && filtered.every((challenge) => selected.has(challenge.id));

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: ROOT.adminChallenges });
		void queryClient.invalidateQueries({ queryKey: ROOT.challenges });
	};

	const remove = useMutation({
		mutationFn: (ids: string[]) => call(client.admin.challenges.remove(ids), "删除结果"),
		onSuccess: () => {
			toast.success("题目已删除");
			setSelected(new Set());
			invalidate();
		},
		onError: (error) => toast.error("删除题目失败", errorText(error)),
	});

	const importChallenge = useMutation({
		mutationFn: (file: File) => call(client.admin.challenges.importChallenge(file), "导入结果"),
		onSuccess: (result) => {
			toast.success("题目包已导入", result.challenge?.name ?? "");
			invalidate();
		},
		onError: (error) => toast.error("导入题目包失败", errorText(error)),
	});

	const check = useMutation({
		mutationFn: (ids: string[] | undefined) =>
			call(client.admin.challenges.checkChallenges(ids && ids.length > 0 ? ids : undefined), "校验结果"),
		onSuccess: (results) => {
			setCheckRows(
				results.map((row) => ({
					key: row.id,
					name: row.challenge_name,
					ok: row.is_ok,
					message: (
						<span className="xz-xs">
							镜像 {row.docker_image ? "✓" : "✗"} · 附件 {row.attachment ? "✓" : "✗"} · 静态内容{" "}
							{row.static_content ? "✓" : "✗"}
						</span>
					),
				})),
			);
			toast.success("校验完成", `${results.filter((row) => row.is_ok).length} / ${results.length} 项通过`);
		},
		onError: (error) => toast.error("校验失败", errorText(error)),
	});

	const build = useMutation({
		mutationFn: (ids: string[] | undefined) =>
			call(client.admin.challenges.buildChallenges(ids && ids.length > 0 ? ids : undefined), "构建结果"),
		onSuccess: (results) => {
			setBuildRows(
				results.map((row, index) => ({
					key: `${row.challenge_name}-${index}`,
					name: row.challenge_name,
					ok: row.is_ok,
					message: row.message,
				})),
			);
			toast.success("构建完成", `${results.filter((row) => row.is_ok).length} / ${results.length} 成功`);
			invalidate();
		},
		onError: (error) => toast.error("构建失败", errorText(error)),
	});

	const scan = useMutation({
		mutationFn: () => call(client.admin.challenges.scanChallenges(), "扫描结果"),
		onSuccess: (results) => {
			setScanRows(
				results.map((row, index) => ({
					key: `${row.safe_name}-${index}`,
					name: row.name ?? row.safe_name,
					ok: row.status === "added" ? true : row.status === "skipped" ? null : false,
					message: `[${row.status}] ${row.message}`,
				})),
			);
			toast.success("扫描完成", `新增 ${results.filter((row) => row.status === "added").length} 个题目目录`);
			invalidate();
		},
		onError: (error) => toast.error("扫描失败", errorText(error)),
	});

	const askRemove = async (targets: ChallengesListItem[]) => {
		if (targets.length === 0) return;
		const first = targets[0];
		const ok = await confirm({
			title: targets.length === 1 ? `删除题目「${first?.name ?? ""}」？` : `删除 ${targets.length} 道题目？`,
			description: "题目、附件与已构建镜像的引用都会一并移除。",
			consequences:
				"所有赛事中该题的挂题关系失效，选手端不再可见；已产生的解题记录不会回滚。此操作不可撤销。",
			tone: "danger",
			confirmText: "删除题目",
		});
		if (ok) remove.mutate(targets.map((challenge) => challenge.id));
	};

	const busy =
		importChallenge.isPending || check.isPending || build.isPending || scan.isPending || remove.isPending;

	return (
		<div className="xz-page xz-page--wide">
			<header className="xz-page__head xz-aev-pagehead">
				<div className="xz-grow">
					<h1 className="xz-page__title">挑战管理</h1>
					<p className="xz-page__desc">
						题目默认通过**包导入**（zip：meta.toml + src + attachment）建立；手工新建只用于占位或简单静态题。
						导入 / 校验 / 构建 / 扫描都是重操作，结果会逐条列出。
					</p>
				</div>
				<Button variant="primary" icon="plus" onClick={() => setEditing(null)}>
					手工新建题目
				</Button>
			</header>

			<Banner tone="info" title="推荐用包导入">
				`importChallenge(File)` 使用 multipart 字段 `package_zip`，接受 `.zip`；导入会同步解析 meta.toml 并建立
				`build_status`。构建只对 `build_status = ready` 生效 —— 其它状态的题目会被后端跳过。
			</Banner>

			<div className="xz-aev-toolbar" style={{ marginTop: 12 }}>
				<ImportFileButton
					accept=".zip,application/zip"
					label={importChallenge.isPending ? "导入中…" : "导入题目包（.zip）"}
					loading={importChallenge.isPending}
					onFile={(file) => importChallenge.mutate(file)}
				/>
				<Button
					icon="beaker"
					loading={check.isPending}
					disabled={busy}
					onClick={() => check.mutate(selectedIds.length > 0 ? selectedIds : undefined)}
				>
					{selectedIds.length > 0 ? `校验选中（${selectedIds.length}）` : "校验全部"}
				</Button>
				<Button
					icon="rocket"
					loading={build.isPending}
					disabled={busy}
					onClick={() => build.mutate(selectedIds.length > 0 ? selectedIds : undefined)}
				>
					{selectedIds.length > 0 ? `构建选中（${selectedIds.length}）` : "构建全部 ready"}
				</Button>
				<Button icon="search" loading={scan.isPending} disabled={busy} onClick={() => scan.mutate()}>
					扫描题目目录
				</Button>
				<Button
					variant="danger-ghost"
					icon="trash"
					disabled={selectedIds.length === 0 || busy}
					onClick={() => void askRemove(items.filter((challenge) => selected.has(challenge.id)))}
				>
					删除选中（{selectedIds.length}）
				</Button>
			</div>

			<div className="xz-filters">
				<span className="xz-search">
					<span className="xz-search__icon">
						<Icon name="search" size={14} />
					</span>
					<input
						className="xz-input"
						data-page-search
						placeholder="搜索题目 / safe_name / 分类"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
				</span>
				<Select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="分类">
					<option value="all">全部分类</option>
					{categories.map((entry) => (
						<option key={entry} value={entry}>
							{entry}
						</option>
					))}
				</Select>
				<Select value={buildStatus} onChange={(event) => setBuildStatus(event.target.value)} aria-label="构建状态">
					<option value="all">全部构建状态</option>
					{buildStatuses.map((entry) => (
						<option key={entry} value={entry}>
							{entry}
						</option>
					))}
				</Select>
				<span className="xz-aev-toolbar--end xz-muted xz-xs">
					{list.isSuccess ? `本页 ${filtered.length} / ${items.length} 道` : ""}
				</span>
			</div>

			<Card>
				<CardHead title="题库" icon="puzzle" sub={`共 ${meta.total} 道题`} />
				<CardBody flush>
					<QueryBoundary
						isPending={list.isPending}
						isError={list.isError}
						error={list.error}
						refetch={() => void list.refetch()}
						loadingLabel="正在加载题库…"
					>
						<DataTable
							rows={filtered}
							rowKey={(challenge) => challenge.id}
							empty={<div className="xz-aev-emptyline">没有符合条件的题目。先用包导入。</div>}
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
														for (const challenge of filtered) next.delete(challenge.id);
													} else {
														for (const challenge of filtered) next.add(challenge.id);
													}
													return next;
												})
											}
										/>
									),
									width: 36,
									render: (challenge) => (
										<input
											type="checkbox"
											aria-label={`选择 ${challenge.name}`}
											checked={selected.has(challenge.id)}
											onChange={(event) =>
												setSelected((current) => {
													const next = new Set(current);
													if (event.target.checked) next.add(challenge.id);
													else next.delete(challenge.id);
													return next;
												})
											}
										/>
									),
								},
								{
									key: "name",
									header: "题目",
									render: (challenge) => (
										<div>
											<div>{challenge.name}</div>
											<div className="xz-muted xz-xs xz-mono">
												{challenge.safe_name} · {challenge.category} · {challenge.id}
											</div>
										</div>
									),
								},
								{
									key: "flag",
									header: "静态 flag",
									render: (challenge) =>
										challenge.static_flag_value ? (
											<Secret value={challenge.static_flag_value} />
										) : (
											<span className="xz-muted">—（动态或无）</span>
										),
								},
								{
									key: "version",
									header: "版本",
									render: (challenge) => challenge.version ?? "—",
								},
								{
									key: "build",
									header: "构建状态",
									render: (challenge) =>
										challenge.build_status ? (
											<Badge
												tone={challenge.build_status === "ready" ? "ok" : "danger"}
												title={challenge.build_status === "ready" ? "可构建" : "不可构建"}
											>
												{challenge.build_status === "ready" ? "ready（可构建）" : challenge.build_status}
											</Badge>
										) : (
											<Badge tone="neutral">未构建</Badge>
										),
								},
								{
									key: "image",
									header: "镜像",
									render: (challenge) =>
										challenge.image_ref ? (
											<span className="xz-aev-mono xz-xs">
												{challenge.image_ref}
												{challenge.image_repo_digest ? " 🔒" : ""}
											</span>
										) : (
											<span className="xz-muted">—</span>
										),
								},
								{
									key: "visible",
									header: "可见",
									render: (challenge) =>
										challenge.hidden ? <Badge tone="warn">隐藏</Badge> : <Badge tone="ok">公开</Badge>,
								},
								{
									key: "actions",
									header: "操作",
									align: "right",
									width: 180,
									render: (challenge) => (
										<RowActions>
											<Button size="sm" icon="edit" onClick={() => setEditing(challenge)}>
												编辑
											</Button>
											<Button
												size="sm"
												variant="danger-ghost"
												icon="trash"
												onClick={() => void askRemove([challenge])}
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

			{scanRows ? <OpResultList title="题目目录扫描结果" rows={scanRows} onClear={() => setScanRows(null)} /> : null}
			{checkRows ? <OpResultList title="题目完整性校验结果" rows={checkRows} onClear={() => setCheckRows(null)} /> : null}
			{buildRows ? <OpResultList title="题目构建结果" rows={buildRows} onClear={() => setBuildRows(null)} /> : null}

			{editing !== undefined ? (
				<ChallengeFormModal
					key={editing?.id ?? "new"}
					challenge={editing}
					onClose={() => setEditing(undefined)}
				/>
			) : null}
		</div>
	);
}

/* ── 手工新建 / 编辑 ─────────────────────────────────────────────── */

function ChallengeFormModal({
	challenge,
	onClose,
}: {
	challenge: ChallengesListItem | null;
	onClose: () => void;
}) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const [form, setForm] = useState<ChallengeForm>(() => (challenge ? formFrom(challenge) : EMPTY_FORM));
	const [error, setError] = useState<string | undefined>();

	const patch = (next: Partial<ChallengeForm>) => setForm((current) => ({ ...current, ...next }));

	const save = useMutation({
		mutationFn: () => {
			const containerPort = parseNumberText(form.container_port);
			const cpu = parseNumberText(form.recommended_cpu_millis);
			const memory = parseNumberText(form.recommended_memory_bytes);
			const pids = parseNumberText(form.recommended_pids_limit);
			const payload: Partial<ChallengesListItem> = {
				name: form.name.trim(),
				category: form.category.trim(),
				description: form.description,
				hidden: form.hidden,
				// SDK 的 `ChallengesListItem` 里 `static_flag_value` 被交叉类型收窄为 `string | undefined`，
				// 但后端接受 `null` 表示清空 —— 这里用窄化断言保留清空语义。
				static_flag_value: (form.static_flag_value.trim() || null) as unknown as string | undefined,
				container_port: containerPort.ok ? containerPort.value : null,
				recommended_cpu_millis: cpu.ok && cpu.value !== null ? cpu.value : undefined,
				recommended_memory_bytes: memory.ok && memory.value !== null ? memory.value : undefined,
				recommended_pids_limit: pids.ok && pids.value !== null ? pids.value : undefined,
			};
			if (challenge) return call(client.admin.challenges.patch({ ...payload, id: challenge.id }), "题目更新");
			return call(client.admin.challenges.create(payload), "题目创建");
		},
		onSuccess: () => {
			toast.success(challenge ? "题目已更新" : "题目已创建");
			void queryClient.invalidateQueries({ queryKey: ROOT.adminChallenges });
			void queryClient.invalidateQueries({ queryKey: ROOT.challenges });
			onClose();
		},
		onError: (err) => toast.error(challenge ? "更新题目失败" : "创建题目失败", errorText(err)),
	});

	return (
		<Modal
			open
			onClose={onClose}
			size="wide"
			persistent={save.isPending}
			title={challenge ? `编辑题目 · ${challenge.name}` : "手工新建题目"}
			description="手工新建不会生成容器镜像；动态题请用包导入。"
			footer={
				<>
					<Button variant="quiet" onClick={onClose} disabled={save.isPending}>
						取消
					</Button>
					<Button
						variant="primary"
						icon="save"
						loading={save.isPending}
						onClick={() => {
							if (form.name.trim().length === 0 || form.category.trim().length === 0) {
								setError("题目名称与分类都必填");
								return;
							}
							setError(undefined);
							save.mutate();
						}}
					>
						{challenge ? "保存修改" : "创建题目"}
					</Button>
				</>
			}
		>
			<div className="xz-aev-col">
				{!challenge ? (
					<Banner tone="warn" title="手工新建是次选路径">
						没有 meta.toml / src 的题目无法构建镜像，只能作为静态题使用。正式题目请用包导入。
					</Banner>
				) : null}
				{error ? (
					<Banner tone="danger" title="请检查表单">
						{error}
					</Banner>
				) : null}
				<div className="xz-aev-grid2">
					<TextField label="题目名称" required value={form.name} onChange={(value) => patch({ name: value })} />
					<TextField
						label="分类"
						required
						value={form.category}
						onChange={(value) => patch({ category: value })}
					/>
					<Field
						label="静态 flag（static_flag_value）"
						hint="仅 admin 接口返回；展示时始终模糊。选手端永远不会看到该字段。"
					>
						{(props) => (
							<TextInput
								{...props}
								className="xz-input--mono"
								value={form.static_flag_value}
								placeholder="flag{...}"
								onChange={(event) => patch({ static_flag_value: event.target.value })}
							/>
						)}
					</Field>
					<TextField
						label="容器端口 container_port"
						hint="动态题内部端口；静态题留空"
						value={form.container_port}
						onChange={(value) => patch({ container_port: value })}
					/>
					<TextField
						label="推荐 CPU（millis）"
						value={form.recommended_cpu_millis}
						onChange={(value) => patch({ recommended_cpu_millis: value })}
					/>
					<TextField
						label="推荐内存（bytes）"
						value={form.recommended_memory_bytes}
						onChange={(value) => patch({ recommended_memory_bytes: value })}
					/>
					<TextField
						label="推荐 PID 上限"
						value={form.recommended_pids_limit}
						onChange={(value) => patch({ recommended_pids_limit: value })}
					/>
				</div>
				<TextAreaField
					label="题目描述（description）"
					rows={6}
					value={form.description}
					onChange={(value) => patch({ description: value })}
				/>
				<Checkbox
					label="对选手隐藏（hidden）"
					checked={form.hidden}
					onChange={(checked) => patch({ hidden: checked })}
				/>
			</div>
		</Modal>
	);
}
