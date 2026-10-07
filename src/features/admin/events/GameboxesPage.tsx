/**
 * `/admin/gameboxes` —— AWD GameBox 库管理（导入 / 扫描 / 校验 / 构建 / 隐藏 / 删除 / 更新）。
 *
 * 要点：
 * - `importGamebox(File | Blob)` 是**同步构建**的重操作：用 pending 态挡住重复提交。
 * - `updateGamebox` 的 `healthchecks_json` / `judge_args_json` 是 **JSON 文本**，
 *   `null` 表示**清空**（与「省略 = 不改」不同）——提交前用 `JsonPatchField` 校验并给出可见错误。
 * - `buildGameboxes` 是批量构建重操作 → 高风险，必须输入确认词。
 * - `removeGamebox` 只允许删除未被赛事 / AWDP Run 引用的条目（后端校验）。
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GameBoxLibraryDto } from "@floatctf/sdk";

import { call, callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { formatBytes } from "../../../lib/format.ts";
import { useDebounced } from "../../../lib/hooks.ts";
import { Icon } from "../../../ui/icons.tsx";
import { Modal, QueryBoundary, useConfirm, useToast } from "../../../ui/overlays.tsx";
import { Badge, Banner, Button, Card, CardBody, CardHead, Checkbox } from "../../../ui/primitives.tsx";
import { DataTable, Pagination, readMeta } from "../../../ui/Table.tsx";
import {
	ImportFileButton,
	JsonDump,
	JsonPatchField,
	OpResultList,
	ROOT,
	RowActions,
	TextField,
	draftFromJson,
	numberText,
	parseNumberText,
	resolveJsonDraft,
	usePager,
	type JsonDraft,
	type OpResultRow,
} from "./shared.tsx";

interface GameboxDraft {
	name: string;
	category: string;
	description: string;
	username: string;
	cpu: string;
	memory: string;
	pids: string;
	judge_timeout: string;
	judge_retry: string;
	judge_script_name: string;
	judge_script_content: string;
	hidden: boolean;
	healthchecks: JsonDraft;
	judge_args: JsonDraft;
}

function draftFrom(dto: GameBoxLibraryDto): GameboxDraft {
	return {
		name: dto.name,
		category: dto.category,
		description: dto.description,
		username: dto.username ?? "",
		cpu: numberText(dto.cpu_millis),
		memory: numberText(dto.memory_bytes),
		pids: numberText(dto.pids_limit),
		judge_timeout: numberText(dto.judge_timeout_secs),
		judge_retry: numberText(dto.judge_retry_interval_secs),
		judge_script_name: dto.judge_script_name ?? "",
		judge_script_content: dto.judge_script_content ?? "",
		hidden: dto.hidden,
		healthchecks: draftFromJson(dto.healthchecks_json),
		judge_args: draftFromJson(dto.judge_args_json),
	};
}

export function AdminGameboxesPage() {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const pager = usePager();
	const [search, setSearch] = useState("");
	const [hiddenFilter, setHiddenFilter] = useState("all");
	const debounced = useDebounced(search);
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	const [editing, setEditing] = useState<GameBoxLibraryDto | null>(null);
	const [scanRows, setScanRows] = useState<OpResultRow[] | null>(null);
	const [checkRows, setCheckRows] = useState<OpResultRow[] | null>(null);
	const [buildRows, setBuildRows] = useState<OpResultRow[] | null>(null);

	const list = useQuery({
		queryKey: qk.awd.gameboxLibrary(pager.params),
		queryFn: () => callList(client.awd.admin.listGameboxes(pager.params)),
	});

	const items = list.data?.items ?? [];
	const meta = readMeta(list.data?.meta, pager.pageSize);
	const selectedIds = useMemo(() => [...selected], [selected]);

	const filtered = useMemo(
		() =>
			items.filter((gamebox) => {
				if (hiddenFilter === "hidden" && !gamebox.hidden) return false;
				if (hiddenFilter === "visible" && gamebox.hidden) return false;
				const needle = debounced.trim().toLowerCase();
				if (!needle) return true;
				return [gamebox.name, gamebox.safe_name, gamebox.category, gamebox.image_ref ?? ""].some((value) =>
					value.toLowerCase().includes(needle),
				);
			}),
		[items, hiddenFilter, debounced],
	);

	const allSelected = filtered.length > 0 && filtered.every((gamebox) => selected.has(gamebox.id));

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: ROOT.awdLibrary });
	};

	const importGamebox = useMutation({
		mutationFn: (file: File) => call(client.awd.admin.importGamebox(file), "导入结果"),
		onSuccess: (result) => {
			toast.success("GameBox 包已导入并构建", result.gamebox?.name ?? "");
			invalidate();
		},
		onError: (error) => toast.error("导入 GameBox 失败", errorText(error)),
	});

	const update = useMutation({
		mutationFn: (input: { id: string; body: Parameters<typeof client.awd.admin.updateGamebox>[1] }) =>
			call(client.awd.admin.updateGamebox(input.id, input.body), "更新结果"),
		onSuccess: () => {
			toast.success("GameBox 库条目已更新");
			setEditing(null);
			invalidate();
		},
		onError: (error) => toast.error("更新 GameBox 失败", errorText(error)),
	});

	const hide = useMutation({
		mutationFn: (id: string) => call(client.awd.admin.hideGamebox(id), "隐藏结果"),
		onSuccess: () => {
			toast.success("GameBox 已隐藏");
			invalidate();
		},
		onError: (error) => toast.error("隐藏 GameBox 失败", errorText(error)),
	});

	const remove = useMutation({
		mutationFn: (ids: string[]) => call(client.awd.admin.removeGamebox(ids), "删除结果"),
		onSuccess: () => {
			toast.success("GameBox 已删除");
			setSelected(new Set());
			invalidate();
		},
		onError: (error) => toast.error("删除 GameBox 失败", errorText(error)),
	});

	const scan = useMutation({
		mutationFn: () => call(client.awd.admin.scanGameboxes(), "扫描结果"),
		onSuccess: (results) => {
			setScanRows(
				results.map((row, index) => ({
					key: `${row.safe_name}-${index}`,
					name: row.name ?? row.safe_name,
					ok: row.status === "added" ? true : row.status === "skipped" ? null : false,
					message: `[${row.status}] ${row.message}`,
				})),
			);
			toast.success("扫描完成", `新增 ${results.filter((row) => row.status === "added").length} 个目录`);
			invalidate();
		},
		onError: (error) => toast.error("扫描 GameBox 目录失败", errorText(error)),
	});

	const check = useMutation({
		mutationFn: (ids: string[] | undefined) =>
			call(client.awd.admin.checkGameboxes(ids && ids.length > 0 ? ids : undefined), "校验结果"),
		onSuccess: (results) => {
			setCheckRows(
				results.map((row) => ({
					key: row.id,
					name: row.gamebox_name,
					ok: row.is_ok,
					message: (
						<span className="xz-xs">
							镜像 {row.docker_image ? "✓" : "✗"} · 包目录 {row.package_dir ? "✓" : "✗"}
						</span>
					),
				})),
			);
			toast.success("校验完成", `${results.filter((row) => row.is_ok).length} / ${results.length} 项通过`);
		},
		onError: (error) => toast.error("校验 GameBox 失败", errorText(error)),
	});

	const build = useMutation({
		mutationFn: (ids: string[] | undefined) =>
			call(client.awd.admin.buildGameboxes(ids && ids.length > 0 ? ids : undefined), "构建结果"),
		onSuccess: (results) => {
			setBuildRows(
				results.map((row, index) => ({
					key: `${row.gamebox_name}-${index}`,
					name: row.gamebox_name,
					ok: row.is_ok,
					message: row.message,
				})),
			);
			toast.success("构建完成", `${results.filter((row) => row.is_ok).length} / ${results.length} 成功`);
			invalidate();
		},
		onError: (error) => toast.error("构建 GameBox 失败", errorText(error)),
	});

	const askBuild = async () => {
		const targets = selectedIds.length > 0 ? selectedIds : undefined;
		const ok = await confirm({
			title: targets ? `构建选中的 ${targets.length} 个 GameBox？` : "构建全部 GameBox？",
			description: "会重新构建 Docker 镜像（同步阻塞，可能持续数分钟）。",
			consequences:
				"构建期间 GameBox 库不可用；构建失败会把 build_status 置为非 ready，已部署到赛事的旧镜像不受影响但新部署会失败。",
			tone: "danger",
			confirmText: "开始构建",
			confirmPhrase: "BUILD-IMAGES",
		});
		if (ok) build.mutate(targets);
	};

	const askRemove = async (targets: GameBoxLibraryDto[]) => {
		if (targets.length === 0) return;
		const first = targets[0];
		const ok = await confirm({
			title: targets.length === 1 ? `删除 GameBox「${first?.name ?? ""}」？` : `删除 ${targets.length} 个 GameBox？`,
			description: "只有**未被任何赛事或 AWDP Run 引用**的条目可以删除（后端校验）。",
			consequences: "被引用的条目会被后端拒绝；删除后需要重新导入包才能恢复。此操作不可撤销。",
			tone: "danger",
			confirmText: "删除 GameBox",
		});
		if (ok) remove.mutate(targets.map((gamebox) => gamebox.id));
	};

	const toggleHidden = (gamebox: GameBoxLibraryDto) => {
		if (gamebox.hidden) {
			// 没有 un-hide 接口：隐藏位通过 updateGamebox 写回。
			update.mutate({ id: gamebox.id, body: { hidden: false } });
		} else {
			hide.mutate(gamebox.id);
		}
	};

	const busy = importGamebox.isPending || scan.isPending || check.isPending || build.isPending || remove.isPending;

	return (
		<div className="xz-page xz-page--wide">
			<header className="xz-page__head xz-aev-pagehead">
				<div className="xz-grow">
					<h1 className="xz-page__title">GameBox 库</h1>
					<p className="xz-page__desc">
						AWD / AWDP 靶机包的管理面：导入（同步构建）、扫描目录、完整性校验、批量构建、隐藏与删除。
						赛事挂载在「赛事控制台 → AWD/AWDP 运维」里完成。
					</p>
				</div>
				<ImportFileButton
					accept=".zip,application/zip"
					label={importGamebox.isPending ? "导入并构建中…" : "导入 GameBox 包（.zip）"}
					loading={importGamebox.isPending}
					onFile={(file) => importGamebox.mutate(file)}
				/>
			</header>

			<Banner tone="info" title="导入是同步构建">
				`importGamebox(File | Blob)` 使用 multipart 字段 `package_zip`，导入过程中会立刻构建镜像；
				请等到完成再重复提交（按钮在请求期间会进入 loading 并禁用）。
			</Banner>

			<div className="xz-aev-toolbar" style={{ marginTop: 12 }}>
				<Button icon="search" loading={scan.isPending} disabled={busy} onClick={() => scan.mutate()}>
					扫描 GameBox 目录
				</Button>
				<Button
					icon="beaker"
					loading={check.isPending}
					disabled={busy}
					onClick={() => check.mutate(selectedIds.length > 0 ? selectedIds : undefined)}
				>
					{selectedIds.length > 0 ? `校验选中（${selectedIds.length}）` : "校验全部"}
				</Button>
				<Button icon="rocket" disabled={busy} loading={build.isPending} onClick={() => void askBuild()}>
					{selectedIds.length > 0 ? `构建选中（${selectedIds.length}）` : "构建全部"}
				</Button>
				<Button
					variant="danger-ghost"
					icon="trash"
					disabled={selectedIds.length === 0 || busy}
					onClick={() => void askRemove(items.filter((gamebox) => selected.has(gamebox.id)))}
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
						placeholder="搜索名称 / safe_name / 分类 / 镜像"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
				</span>
				<select
					className="xz-select"
					aria-label="隐藏状态"
					value={hiddenFilter}
					onChange={(event) => setHiddenFilter(event.target.value)}
				>
					<option value="all">全部可见性</option>
					<option value="visible">仅可见</option>
					<option value="hidden">仅隐藏</option>
				</select>
				<span className="xz-aev-toolbar--end xz-muted xz-xs">
					{list.isSuccess ? `本页 ${filtered.length} / ${items.length} 个` : ""}
				</span>
			</div>

			<Card>
				<CardHead title="GameBox 库" icon="box" sub={`共 ${meta.total} 个`} />
				<CardBody flush>
					<QueryBoundary
						isPending={list.isPending}
						isError={list.isError}
						error={list.error}
						refetch={() => void list.refetch()}
						loadingLabel="正在加载 GameBox 库…"
					>
						<DataTable
							rows={filtered}
							rowKey={(gamebox) => gamebox.id}
							empty={<div className="xz-aev-emptyline">库里还没有 GameBox。先导入包。</div>}
							columns={[
								{
									key: "select",
									header: (
										<input
											type="checkbox"
											aria-label="全选本页 GameBox"
											checked={allSelected}
											onChange={() =>
												setSelected((current) => {
													const next = new Set(current);
													if (allSelected) {
														for (const gamebox of filtered) next.delete(gamebox.id);
													} else {
														for (const gamebox of filtered) next.add(gamebox.id);
													}
													return next;
												})
											}
										/>
									),
									width: 36,
									render: (gamebox) => (
										<input
											type="checkbox"
											aria-label={`选择 ${gamebox.name}`}
											checked={selected.has(gamebox.id)}
											onChange={(event) =>
												setSelected((current) => {
													const next = new Set(current);
													if (event.target.checked) next.add(gamebox.id);
													else next.delete(gamebox.id);
													return next;
												})
											}
										/>
									),
								},
								{
									key: "name",
									header: "GameBox",
									render: (gamebox) => (
										<div>
											<div>{gamebox.name}</div>
											<div className="xz-muted xz-xs xz-mono">
												{gamebox.safe_name} · {gamebox.category} · v{gamebox.version ?? "—"}
											</div>
										</div>
									),
								},
								{
									key: "build",
									header: "构建状态",
									render: (gamebox) =>
										gamebox.build_status ? (
											<Badge tone={gamebox.build_status === "ready" ? "ok" : "danger"}>
												{gamebox.build_status}
											</Badge>
										) : (
											<Badge tone="neutral">未构建</Badge>
										),
								},
								{
									key: "image",
									header: "镜像",
									render: (gamebox) =>
										gamebox.image_ref ? (
											<div className="xz-aev-mono xz-xs">
												<div>{gamebox.image_ref}</div>
												{gamebox.image_repo_digest ? (
													<div className="xz-muted">digest {gamebox.image_repo_digest.slice(0, 24)}…</div>
												) : null}
											</div>
										) : (
											<span className="xz-muted">—</span>
										),
								},
								{
									key: "resources",
									header: "推荐资源",
									render: (gamebox) => (
										<span className="xz-xs xz-mono">
											{gamebox.cpu_millis ?? "—"}m / {formatBytes(gamebox.memory_bytes)} /{" "}
											{gamebox.pids_limit ?? "—"} pids
										</span>
									),
								},
								{
									key: "visibility",
									header: "可见性",
									render: (gamebox) =>
										gamebox.hidden ? <Badge tone="warn">已隐藏</Badge> : <Badge tone="ok">可见</Badge>,
								},
								{
									key: "json",
									header: "healthcheck / judge",
									render: (gamebox) => (
										<div className="xz-aev-col" style={{ gap: 4 }}>
											<div>
												<span className="xz-muted xz-xs">healthchecks</span>
												<JsonDump value={gamebox.healthchecks_json} />
											</div>
											<div>
												<span className="xz-muted xz-xs">judge args</span>
												<JsonDump value={gamebox.judge_args_json} />
											</div>
										</div>
									),
								},
								{
									key: "judge",
									header: "judge 超时 / 重试",
									render: (gamebox) => (
										<span className="xz-xs xz-mono">
											{gamebox.judge_timeout_secs ?? "—"}s / {gamebox.judge_retry_interval_secs ?? "—"}s
										</span>
									),
								},
								{
									key: "actions",
									header: "操作",
									align: "right",
									width: 260,
									render: (gamebox) => (
										<RowActions>
											<Button size="sm" icon="edit" onClick={() => setEditing(gamebox)}>
												编辑
											</Button>
											<Button
												size="sm"
												icon={gamebox.hidden ? "eye" : "eyeOff"}
												onClick={() => toggleHidden(gamebox)}
											>
												{gamebox.hidden ? "取消隐藏" : "隐藏"}
											</Button>
											<Button
												size="sm"
												variant="danger-ghost"
												icon="trash"
												onClick={() => void askRemove([gamebox])}
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

			{scanRows ? <OpResultList title="GameBox 目录扫描结果" rows={scanRows} onClear={() => setScanRows(null)} /> : null}
			{checkRows ? <OpResultList title="GameBox 完整性校验" rows={checkRows} onClear={() => setCheckRows(null)} /> : null}
			{buildRows ? <OpResultList title="GameBox 构建结果" rows={buildRows} onClear={() => setBuildRows(null)} /> : null}

			{editing ? <GameboxEditModal gamebox={editing} onClose={() => setEditing(null)} /> : null}
		</div>
	);
}

/* ── 编辑弹窗（含 JSON 校验）──────────────────────────────────────── */

function GameboxEditModal({ gamebox, onClose }: { gamebox: GameBoxLibraryDto; onClose: () => void }) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const [draft, setDraft] = useState<GameboxDraft>(() => draftFrom(gamebox));
	const [error, setError] = useState<string | undefined>();

	const patch = (next: Partial<GameboxDraft>) => setDraft((current) => ({ ...current, ...next }));

	const save = useMutation({
		mutationFn: () => {
			const healthchecks = resolveJsonDraft(draft.healthchecks);
			if (healthchecks.kind === "error") throw new Error(`healthchecks_json：${healthchecks.message}`);
			const judgeArgs = resolveJsonDraft(draft.judge_args);
			if (judgeArgs.kind === "error") throw new Error(`judge_args_json：${judgeArgs.message}`);

			const num = (text: string, label: string): number | null => {
				const parsed = parseNumberText(text);
				if (!parsed.ok) throw new Error(`${label}：${parsed.error}`);
				return parsed.value;
			};

			const body: Parameters<typeof client.awd.admin.updateGamebox>[1] = {
				name: draft.name.trim(),
				category: draft.category.trim(),
				description: draft.description,
				hidden: draft.hidden,
				username: draft.username.trim() || null,
				recommended_cpu_millis: num(draft.cpu, "推荐 CPU"),
				recommended_memory_bytes: num(draft.memory, "推荐内存"),
				recommended_pids_limit: num(draft.pids, "推荐 PID 上限"),
				judge_timeout_secs: num(draft.judge_timeout, "评测超时"),
				judge_retry_interval_secs: num(draft.judge_retry, "评测重试间隔"),
				judge_script_name: draft.judge_script_name.trim() || null,
				judge_script_content: draft.judge_script_content.trim() || null,
			};
			if (healthchecks.kind === "clear") body.healthchecks_json = null;
			else if (healthchecks.kind === "set") body.healthchecks_json = healthchecks.text;
			if (judgeArgs.kind === "clear") body.judge_args_json = null;
			else if (judgeArgs.kind === "set") body.judge_args_json = judgeArgs.text;

			return call(client.awd.admin.updateGamebox(gamebox.id, body), "更新结果");
		},
		onSuccess: () => {
			toast.success("GameBox 已更新");
			void queryClient.invalidateQueries({ queryKey: ROOT.awdLibrary });
			onClose();
		},
		onError: (err) => {
			const message = errorText(err);
			setError(message);
			toast.error("更新 GameBox 失败", message);
		},
	});

	return (
		<Modal
			open
			onClose={onClose}
			size="wide"
			persistent={save.isPending}
			title={`编辑 GameBox · ${gamebox.name}`}
			description="`healthchecks_json` / `judge_args_json` 是 JSON 文本；勾选清空才会提交 null（否则留空 = 不修改）。"
			footer={
				<>
					<Button variant="quiet" onClick={onClose} disabled={save.isPending}>
						取消
					</Button>
					<Button variant="primary" icon="save" loading={save.isPending} onClick={() => save.mutate()}>
						保存
					</Button>
				</>
			}
		>
			<div className="xz-aev-col">
				{error ? (
					<Banner tone="danger" title="保存失败">
						{error}
					</Banner>
				) : null}
				<div className="xz-aev-grid2">
					<TextField label="名称" required value={draft.name} onChange={(value) => patch({ name: value })} />
					<TextField label="分类" required value={draft.category} onChange={(value) => patch({ category: value })} />
					<TextField
						label="容器用户名 username"
						hint="留空 = 清空"
						value={draft.username}
						onChange={(value) => patch({ username: value })}
					/>
					<TextField label="推荐 CPU（millis）" value={draft.cpu} onChange={(value) => patch({ cpu: value })} />
					<TextField label="推荐内存（bytes）" value={draft.memory} onChange={(value) => patch({ memory: value })} />
					<TextField label="推荐 PID 上限" value={draft.pids} onChange={(value) => patch({ pids: value })} />
					<TextField
						label="评测超时（秒）"
						value={draft.judge_timeout}
						onChange={(value) => patch({ judge_timeout: value })}
					/>
					<TextField
						label="评测重试间隔（秒）"
						value={draft.judge_retry}
						onChange={(value) => patch({ judge_retry: value })}
					/>
					<TextField
						label="judge_script_name"
						value={draft.judge_script_name}
						onChange={(value) => patch({ judge_script_name: value })}
					/>
				</div>

				<JsonPatchField
					label="healthchecks_json"
					hint="JSON 文本；勾选「清空」提交 null。"
					initial={gamebox.healthchecks_json}
					draft={draft.healthchecks}
					onChange={(next) => patch({ healthchecks: next })}
				/>
				<JsonPatchField
					label="judge_args_json"
					hint="JSON 文本；勾选「清空」提交 null。"
					initial={gamebox.judge_args_json}
					draft={draft.judge_args}
					onChange={(next) => patch({ judge_args: next })}
				/>

				<TextField
					label="judge 脚本内容"
					value={draft.judge_script_content}
					onChange={(value) => patch({ judge_script_content: value })}
				/>
				<Checkbox label="隐藏（hidden）" checked={draft.hidden} onChange={(checked) => patch({ hidden: checked })} />

				<div className="xz-aev-note">
					包摘要：<code className="xz-code">{gamebox.package_digest?.slice(0, 32) ?? "—"}</code>
					{gamebox.image_repo_digest ? ` · 镜像 digest ${gamebox.image_repo_digest.slice(0, 24)}…` : ""}
				</div>
			</div>
		</Modal>
	);
}
