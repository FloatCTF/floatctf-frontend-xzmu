/**
 * 选手工作区 · AWDP Training Ground（练习）。
 *
 * - `/training`：练习 GameBox 目录（`client.awdp.runs.gameboxCatalog`，
 *   目录不含 exploit / source 字段，这是后端的**安全白名单**口径）；
 * - `/training/:runId`：练习 Run 工作台（**run 中心化**契约 `client.awdp.runs.*`）。
 *
 * 语义要点（见 CAPABILITY-BEHAVIOR-MAP「选手端：AWDP Training Ground」）：
 * - `active_training` 存在时**不要**重复创建 run，直接跳到已有 run；
 * - `restartTraining` 返回**新的 `run_id`**，必须用它跳转；
 * - 练习的「开始」是 `startRun`（Pending→Break + 启动实例），不是 `startInstance`；
 * - `allCheck` 成功（patched）会结算剩余回合并**直接结束 run** → 必须二次确认。
 */

import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GameBoxCatalogDto } from "@floatctf/sdk";

import { call, callList, unwrapNullable } from "../../api/call.ts";
import { useBindings, useClient } from "../../api/client.ts";
import { errorText } from "../../api/errors.ts";
import { qk } from "../../api/keys.ts";
import { formatBytes, formatDateTime } from "../../lib/format.ts";
import { useDebounced } from "../../lib/hooks.ts";
import { Link } from "../../router/Link.tsx";
import type { PageDef, PageProps } from "../../router/pages.ts";
import { useDocumentTitle, useNavigate } from "../../router/router.tsx";
import { Icon } from "../../ui/icons.tsx";
import { MarkdownEditor } from "../../ui/Markdown.tsx";
import { QueryBoundary, useConfirm, useToast } from "../../ui/overlays.tsx";
import {
	Badge,
	Button,
	Card,
	CardBody,
	CardFoot,
	CardHead,
	EmptyState,
	Segmented,
	SectionTitle,
	Select,
} from "../../ui/primitives.tsx";
import { DataTable, Pagination } from "../../ui/Table.tsx";
import {
	AWDP_PHASE_LABEL,
	AwdpBoxCard,
	AwdpEvaluationsCard,
	AwdpLiveNotice,
	AwdpPhaseNotice,
	AwdpPhasePill,
	AwdpRoundsCard,
	AwdpScoresCard,
	AwdpTimingPanel,
	awdpPhasePolicy,
	awdpPollMs,
	boxViewFromRun,
	useAwdpLiveStrip,
	useAwdpSseBridge,
	type AwdpBoxActions,
} from "../awdp/components.tsx";

/* ══════════════════════════════════════════════════════════════════════════
 * 1. 练习目录 `/training`
 * ════════════════════════════════════════════════════════════════════════ */

type SolvedFilter = "all" | "yes" | "no";

/**
 * 目录的**服务端**筛选串。
 *
 * 后端过滤是 `key:value` 记号流（`api/sea_orm_utils.rs:23-92`），
 * `key:value` 相邻即 AND，`|` 分隔 OR 组，因此「关键词命中任意字段」
 * 必须写成三个 OR 组；再与 `solved` 做 AND 时，每组都要重复该条件
 * （`solved:true name:x | solved:true description:x | …`），否则 `&` 只会
 * 作用在最后一组上。可用的键见 `awdp/api/training.rs:155-180`：
 * `name` / `category` / `description` / `solved`。
 */
function catalogFilter(keyword: string, solved: SolvedFilter): string | undefined {
	const kw = keyword.replace(/[&|:]/g, " ").trim();
	const solvedTerm = solved === "yes" ? "solved:true" : solved === "no" ? "solved:false" : "";
	const groups: string[] = [];
	if (kw) {
		for (const key of ["name", "description", "category"]) {
			groups.push(solvedTerm ? `${solvedTerm} ${key}:${kw}` : `${key}:${kw}`);
		}
	} else if (solvedTerm) {
		groups.push(solvedTerm);
	}
	return groups.length > 0 ? groups.join(" | ") : undefined;
}

export function TrainingCatalogPage() {
	useDocumentTitle("训练场");
	const client = useClient();
	const navigate = useNavigate();
	const toast = useToast();
	const queryClient = useQueryClient();

	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(20);
	const [search, setSearch] = useState("");
	const [solved, setSolved] = useState<SolvedFilter>("all");
	const debounced = useDebounced(search);

	const filter = useMemo(() => catalogFilter(debounced, solved), [debounced, solved]);

	const catalog = useQuery({
		queryKey: qk.training.catalog({ page, limit: pageSize, filter }),
		// 注意：SDK 会强制覆盖 capability 为 "awdp"（awdpRuns.ts:163-169），调用方传同名参数无效。
		queryFn: () => callList(client.awdp.runs.gameboxCatalog({ page, limit: pageSize, filter })),
	});

	const startTraining = useMutation({
		mutationFn: (gameboxId: string) => call(client.awdp.runs.startTraining(gameboxId), "练习 Run"),
		onSuccess: (run) => {
			toast.success("练习已创建", `${run.gamebox_name} · 阶段 ${run.phase}`);
			void queryClient.invalidateQueries({ queryKey: qk.training.all });
			navigate(`/training/${run.run_id}`);
		},
		onError: (error) => toast.error("开始训练失败", errorText(error)),
	});

	// 服务端已分页：搜索 / 筛选变化时回到第 1 页。
	const onSearch = (value: string) => {
		setSearch(value);
		setPage(1);
	};
	const onSolved = (value: SolvedFilter) => {
		setSolved(value);
		setPage(1);
	};

	const items = catalog.data?.items ?? [];
	const total = catalog.data?.meta?.total ?? items.length;

	return (
		<div className="xz-page">
			<header className="xz-page__head">
				<div>
					<h1 className="xz-page__title">训练场</h1>
					<p className="xz-page__desc">
						这里是可以自主练习的 AWDP GameBox。开始训练会创建一个练习 Run：先在 Break 阶段攻破，
						再切到 Fix 阶段上传补丁并接受官方评测。练习环境与赛事环境相互独立。
					</p>
				</div>
			</header>

			<div className="xz-filters">
				<span className="xz-search">
					<span className="xz-search__icon">
						<Icon name="search" size={14} />
					</span>
					<input
						className="xz-input"
						data-page-search
						placeholder="按名称 / 分类 / 简介搜索"
						value={search}
						onChange={(event) => onSearch(event.target.value)}
					/>
				</span>
				<Select value={solved} aria-label="训练状态" onChange={(event) => onSolved(event.target.value as SolvedFilter)}>
					<option value="all">全部状态</option>
					<option value="yes">已训练过</option>
					<option value="no">未训练过</option>
				</Select>
			</div>

			<QueryBoundary
				isPending={catalog.isPending}
				isError={catalog.isError}
				error={catalog.error}
				refetch={() => void catalog.refetch()}
				loadingLabel="正在加载练习目录…"
			>
				<Card>
					<CardHead
						title="可练习的 GameBox"
						icon="beaker"
						sub={`共 ${total} 个`}
						actions={
							<Button size="sm" variant="quiet" icon="refresh" loading={catalog.isFetching} onClick={() => void catalog.refetch()}>
								刷新
							</Button>
						}
					/>
					<CardBody flush>
						<DataTable
							columns={[
								{
									key: "name",
									header: "GameBox",
									render: (row: GameBoxCatalogDto) => (
										<div className="xz-tr-name">
											<div className="xz-list__title">{row.name}</div>
											<div className="xz-list__meta xz-clamp-2">{row.description || "（无简介）"}</div>
										</div>
									),
								},
								{
									key: "category",
									header: "分类",
									render: (row: GameBoxCatalogDto) => <Badge tone="crimson">{row.category}</Badge>,
								},
								{
									key: "version",
									header: "版本",
									render: (row: GameBoxCatalogDto) => (
										<span className="xz-mono xz-xs">
											{row.version ?? "—"}
											{row.author ? ` · ${row.author}` : ""}
										</span>
									),
								},
								{
									key: "resources",
									header: "建议资源",
									render: (row: GameBoxCatalogDto) => (
										<span className="xz-tr-res xz-mono xz-xs">
											{row.recommended_cpu_millis} mCPU · {formatBytes(row.recommended_memory_bytes)} · {row.recommended_pids_limit} pids
										</span>
									),
								},
								{
									key: "status",
									header: "状态",
									render: (row: GameBoxCatalogDto) => (
										<div className="xz-row" style={{ gap: 6, flexWrap: "wrap" }}>
											{row.solved ? <Badge tone="ok" icon="check">练过</Badge> : <Badge>未练过</Badge>}
											{row.active_training ? (
												<Badge tone="gold" icon="bolt">
													进行中 · {AWDP_PHASE_LABEL[row.active_training.phase]} · {row.active_training.score} 分
												</Badge>
											) : null}
											{!row.awdp_capable ? <Badge tone="warn">缺少 AWDP 产物</Badge> : null}
										</div>
									),
								},
								{
									key: "actions",
									header: "操作",
									align: "right",
									render: (row: GameBoxCatalogDto) => {
										// 已有 active run：跳到它，绝不重复创建（目录语义）。
										if (row.active_training) {
											return (
												<Link to={`/training/${row.active_training.run_id}`}>
													<Button size="sm" variant="primary" icon="play">
														继续训练
													</Button>
												</Link>
											);
										}
										return (
											<Button
												size="sm"
												variant="gold"
												icon="rocket"
												loading={startTraining.isPending && startTraining.variables === row.id}
												disabled={!row.awdp_capable || startTraining.isPending}
												title={row.awdp_capable ? "创建练习 Run" : "该 GameBox 缺少 AWDP 源码产物"}
												onClick={() => startTraining.mutate(row.id)}
											>
												开始训练
											</Button>
										);
									},
								},
							]}
							rows={items}
							rowKey={(row) => row.id}
							empty={
								<EmptyState
									icon="beaker"
									title="没有可练习的 GameBox"
									desc="目录只包含已构建完成、且声明了 AWDP capability 的非隐藏 GameBox。可以清空搜索条件后重试。"
								/>
							}
						/>
					</CardBody>
					{total > pageSize ? (
						<CardFoot>
							<Pagination
								page={page}
								pageSize={pageSize}
								total={total}
								onPageChange={setPage}
								onPageSizeChange={(size) => {
									setPageSize(size);
									setPage(1);
								}}
							/>
						</CardFoot>
					) : null}
				</Card>
			</QueryBoundary>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2. 练习 Run 工作台 `/training/:runId`
 * ════════════════════════════════════════════════════════════════════════ */

type RunSection = "rounds" | "evaluations" | "scores" | "writeup";

export function TrainingRunPage({ params }: PageProps) {
	const runId = params.runId ?? "";
	const client = useClient();
	const toast = useToast();
	const confirm = useConfirm();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { useAwdpRunStream } = useBindings();

	useDocumentTitle("练习 Run");

	const stream = useAwdpRunStream({ runId, enabled: runId.length > 0 });
	useAwdpLiveStrip("AWDP 练习实时", stream);
	// 见 useAwdpSseBridge 注释：绑定层硬编码的失效键与 qk 前缀不一致，这里做补偿。
	useAwdpSseBridge("run", runId, qk.training.all);

	const run = useQuery({
		queryKey: qk.training.run(runId),
		queryFn: () => call(client.awdp.runs.getRun(runId), "练习 Run"),
		enabled: runId.length > 0,
	});

	const phase = run.data?.phase;
	const policy = awdpPhasePolicy(phase ?? "pending");
	const poll = awdpPollMs(phase);

	const rounds = useQuery({
		queryKey: qk.training.rounds(runId),
		queryFn: () => call(client.awdp.runs.rounds(runId), "回合列表"),
		enabled: runId.length > 0,
		refetchInterval: poll,
	});

	const evaluations = useQuery({
		queryKey: qk.training.evaluations(runId),
		queryFn: () => call(client.awdp.runs.evaluations(runId), "评测记录"),
		enabled: runId.length > 0,
		refetchInterval: poll,
	});

	const scores = useQuery({
		queryKey: qk.training.scores(runId),
		queryFn: () => call(client.awdp.runs.scores(runId), "计分明细"),
		enabled: runId.length > 0,
		refetchInterval: poll,
	});

	const writeup = useQuery({
		queryKey: qk.training.writeup(runId),
		queryFn: () => call(client.awdp.runs.getWriteup(runId), "Writeup"),
		enabled: runId.length > 0,
	});

	const [section, setSection] = useState<RunSection>("rounds");
	const [writeupDraft, setWriteupDraft] = useState<string | null>(null);

	const invalidateRun = () => queryClient.invalidateQueries({ queryKey: qk.training.all });

	const onRunResult = (label: string) => (updated: { phase: string; my_score: number }) => {
		toast.success(label, `当前阶段 ${updated.phase} · 我的积分 ${updated.my_score}`);
		void invalidateRun();
	};

	const startRun = useMutation({
		mutationFn: () => call(client.awdp.runs.startRun(runId), "练习 Run"),
		// Pending→Break（创建时间线）或 Break/Fix 中途仅补启实例，两者都不清空历史。
		onSuccess: onRunResult("已开始训练"),
		onError: (error) => toast.error("开始训练失败", errorText(error)),
	});

	const stopRun = useMutation({
		mutationFn: async () => {
			unwrapNullable(await client.awdp.runs.stopRun(runId));
		},
		onSuccess: () => {
			toast.success("已停止全部实例", "run 与计分历史保留，可随时再次启动。");
			void invalidateRun();
		},
		onError: (error) => toast.error("停止实例失败", errorText(error)),
	});

	const resetRun = useMutation({
		mutationFn: () => call(client.awdp.runs.resetRun(runId), "练习 Run"),
		onSuccess: onRunResult("已重置全部实例"),
		onError: (error) => toast.error("重置实例失败", errorText(error)),
	});

	const endRun = useMutation({
		mutationFn: () => call(client.awdp.runs.endRun(runId), "练习 Run"),
		onSuccess: onRunResult("本次训练已结束"),
		onError: (error) => toast.error("结束训练失败", errorText(error)),
	});

	const setPhase = useMutation({
		mutationFn: (target: "break" | "fix") => call(client.awdp.runs.setPhase(runId, target), "练习 Run"),
		onSuccess: onRunResult("阶段已切换"),
		onError: (error) => toast.error("切换阶段失败", errorText(error)),
	});

	const restart = useMutation({
		mutationFn: () => call(client.awdp.runs.restartTraining(runId), "练习 Run"),
		onSuccess: (created) => {
			toast.success("已创建新的练习 Run", `${created.gamebox_name} · ${created.run_id.slice(0, 8)}…`);
			void invalidateRun();
			// restartTraining 返回**新的 run_id**，必须用它跳转，否则会停在已结束的 run 上。
			navigate(`/training/${created.run_id}`);
		},
		onError: (error) => toast.error("重新训练失败", errorText(error)),
	});

	const saveWriteup = useMutation({
		mutationFn: (content: string) => call(client.awdp.runs.saveWriteup(runId, content), "Writeup"),
		onSuccess: (saved) => {
			toast.success("Writeup 已保存", saved.updated_at ? `更新于 ${formatDateTime(saved.updated_at)}` : undefined);
			setWriteupDraft(null);
			void queryClient.invalidateQueries({ queryKey: qk.training.writeup(runId) });
		},
		onError: (error) => toast.error("Writeup 保存失败", errorText(error)),
	});

	/** 练习侧动作：全部打在 `client.awdp.runs.*`，参数为 `(runId, gameboxId)`。 */
	const gameboxId = run.data?.gamebox_id ?? "";
	const actions = useMemo<AwdpBoxActions>(
		() => ({
			submitBreak: (boxId, flag) => call(client.awdp.runs.submitBreak(runId, boxId, flag), "Break 提交结果"),
			uploadPatch: (boxId, file) => call(client.awdp.runs.uploadPatch(runId, boxId, file), "补丁提交结果"),
			testCheck: (boxId) => call(client.awdp.runs.testCheck(runId, boxId), "Test Check 结果"),
			startInstance: (boxId) => call(client.awdp.runs.startInstance(runId, boxId), "实例"),
			// stopInstance 返回 UniResponse<null>：不能用 call()（它把 null 当失败）。
			stopInstance: async (boxId) => {
				unwrapNullable(await client.awdp.runs.stopInstance(runId, boxId));
				return null;
			},
			resetInstance: (boxId) => call(client.awdp.runs.resetInstance(runId, boxId), "实例"),
			sourceUrl: (boxId) => call(client.awdp.runs.sourceUrl(runId, boxId), "源码下载地址"),
			allCheck: (boxId) => call(client.awdp.runs.allCheck(runId, boxId), "ALL Check 结果"),
		}),
		[client, runId],
	);

	if (!runId) {
		return (
			<div className="xz-page">
				<EmptyState icon="alert" title="缺少 run ID" desc="地址中没有练习 Run 标识，请从训练目录进入。" />
			</div>
		);
	}

	const data = run.data;
	const running = (data?.instances ?? []).some((instance) => instance.runtime_state === "running");
	const canSwitchPhase = phase === "break" || phase === "fix";

	const onStopAll = async () => {
		const ok = await confirm({
			title: "停止本次训练的全部实例？",
			description: "所有实例会立即停止，对外端点失效。",
			consequences:
				"run 本身不会结束：回合、评测与计分历史都保留，之后可以再次「启动实例并继续」。" +
				"Fix 阶段的官方评测依赖实例运行，停止期间不会有新的评测结果。",
			tone: "danger",
			confirmText: "停止实例",
		});
		if (ok) stopRun.mutate();
	};

	const onResetAll = async () => {
		const ok = await confirm({
			title: "重置本次训练的全部实例？",
			description: "所有实例会被销毁并重建为 pristine 状态。",
			consequences:
				"容器内的一切改动都会丢失，包括已上传的补丁、正在运行的进程与临时文件；" +
				"逻辑实例与对外端口保留，计分历史不受影响。练习模式的重置不计次数、不罚分。",
			tone: "danger",
			confirmText: "重置实例",
		});
		if (ok) resetRun.mutate();
	};

	const onEndRun = async () => {
		const ok = await confirm({
			title: "结束本次训练？",
			description: "会停止全部实例并把 run 置为 Ended。",
			consequences:
				"结束后本 run 只能查看：不能再提交 Break flag、上传补丁或执行 Test Check。" +
				"本 run 的回合、评测与计分流水都会保留为历史；要继续练需要新建一个 run（「重新训练」）。",
			tone: "danger",
			confirmText: "结束训练",
		});
		if (ok) endRun.mutate();
	};

	const onRestart = async () => {
		const ok = await confirm({
			title: "重新训练（新建 run）？",
			description: "会为同一个 GameBox 创建一个全新的练习 run，并跳转到它。",
			consequences:
				"新 run 拥有全新的实例与时间线，从 Pending 开始；当前 run 会被保留为历史记录（不影响已有计分数据）。" +
				"后端只允许 Ended 的 run 重新训练，所以进行中的 run 需要先「结束训练」。",
			tone: "danger",
			confirmText: "重新训练",
		});
		if (ok) restart.mutate();
	};

	const onSwitchPhase = async (target: "break" | "fix") => {
		if (target === phase) return;
		if (target === "fix") {
			const ok = await confirm({
				title: "进入 Fix 修复阶段？",
				description: "进入 Fix 前，系统会先把所有实例重置到 pristine 状态（会经过 preparing_fix 过渡态）。",
				consequences:
					"容器内的改动（含已上传补丁、运行中的进程）全部丢失；随后可以上传补丁并执行 Test Check，" +
					"官方评测按回合自动运行。Break flag 从此刻起被后端拒绝。",
				tone: "danger",
				confirmText: "进入 Fix",
			});
			if (ok) setPhase.mutate("fix");
			return;
		}
		const ok = await confirm({
			title: "回到 Break 阶段？这会撤销整个 Fix 会话",
			description: "fix → break 会重新物化全新的 Break 时间线。",
			consequences:
				"本会话产生的**回合、评测记录与 Fix 计分全部清零**（Break 阶段已获得的攻破计分同样会被重新计算）；" +
				"已上传的补丁不再被应用。此操作不可撤销。",
			tone: "danger",
			confirmText: "撤销并回到 Break",
		});
		if (ok) setPhase.mutate("break");
	};

	return (
		<div className="xz-page xz-page--wide">
			<header className="xz-page__head">
				<div>
					<div className="xz-row" style={{ gap: 8, marginBottom: 6 }}>
						<Link to="/training" className="xz-muted xz-xs">
							← 训练目录
						</Link>
					</div>
					<h1 className="xz-page__title">{data?.gamebox_name ?? "练习 Run"}</h1>
					<p className="xz-page__desc">
						<span className="xz-mono xz-xs">{runId}</span>
						{data ? ` · ${data.gamebox_category}` : ""}
					</p>
				</div>
			</header>

			<div className="xz-tr-stack">
				<AwdpLiveNotice stream={stream} />

				<QueryBoundary
					isPending={run.isPending}
					isError={run.isError}
					error={run.error}
					refetch={() => void run.refetch()}
					loadingLabel="正在加载练习 Run…"
				>
					{data ? (
						<>
							<Card>
								<CardHead
									title="Run 控制台"
									icon="beaker"
									sub={data.gamebox_description || undefined}
									actions={
										<div className="xz-awdp-toolbar">
											<AwdpPhasePill phase={data.phase} />
											<Badge tone="gold" icon="trophy">
												我的积分 {data.my_score}
											</Badge>
											<Button
												size="sm"
												variant="quiet"
												icon="refresh"
												loading={run.isFetching}
												onClick={() => void run.refetch()}
											>
												刷新
											</Button>
										</div>
									}
								/>
								<CardBody>
									<div style={{ marginBottom: 16 }}>
										<AwdpPhaseNotice phase={data.phase} isPractice />
									</div>
									<AwdpTimingPanel timing={data} />
									{data.judge_endpoint ? (
										<p className="xz-mono xz-xs" style={{ marginTop: 12 }}>
											练习 Judge 端点（仅 GameBox 内网可达）：{data.judge_endpoint.base_url}
											{data.judge_endpoint.flag_url}
										</p>
									) : null}
									<p className="xz-awdp-note" style={{ marginTop: 8 }}>
										每轮评测失败会按规则扣分：本 run 的每轮扣分 = {data.fix_round_penalty} 分
										（历史记录中已体现）。
									</p>
								</CardBody>
								<CardFoot>
									<div className="xz-awdp-toolbar">
										{!running ? (
											<Button
												variant="primary"
												icon="rocket"
												loading={startRun.isPending}
												// 后端门禁：Ended 拒绝 Launch；preparing_fix 也不允许启动实例
												// （runtime.rs:121 只放行 Break|Fix）。
												disabled={data.phase === "ended" || data.phase === "preparing_fix"}
												title={
													data.phase === "ended"
														? "已结束的 run 不能再次开始，请用「重新训练」新建 run"
														: data.phase === "preparing_fix"
															? "正在准备 Fix 阶段，实例重置完成后才能启动"
															: undefined
												}
												onClick={() => startRun.mutate()}
											>
												{data.phase === "pending" ? "开始训练" : "启动实例并继续"}
											</Button>
										) : (
											<Button
												variant="danger-ghost"
												icon="stop"
												loading={stopRun.isPending}
												disabled={data.phase === "ended"}
												onClick={() => void onStopAll()}
											>
												停止全部实例
											</Button>
										)}
										<Button
											icon="refresh"
											loading={resetRun.isPending}
											disabled={data.phase === "ended" || data.phase === "pending"}
											title={
												data.phase === "ended"
													? "已结束的 run 没有需要重置的会话"
													: data.phase === "pending"
														? "尚未开始训练，没有实例可重置"
														: undefined
											}
											onClick={() => void onResetAll()}
										>
											重置全部实例
										</Button>
										<Button
											variant="danger"
											icon="ban"
											loading={endRun.isPending}
											disabled={data.phase === "ended" || data.phase === "pending"}
											title={
												data.phase === "ended"
													? "本次训练已经结束"
													: data.phase === "pending"
														? "尚未开始训练，无需结束"
														: undefined
											}
											onClick={() => void onEndRun()}
										>
											结束训练
										</Button>
										<Button
											variant="gold"
											icon="undo"
											loading={restart.isPending}
											// 后端门禁：只有 Ended 的 run 可以 train_again（practice_service.rs:75）。
											disabled={data.phase !== "ended"}
											title={
												data.phase === "ended"
													? "为同一个 GameBox 新建一个练习 run"
													: "只有已结束（Ended）的 run 可以重新训练；进行中的 run 请先用「结束训练」"
											}
											onClick={() => void onRestart()}
										>
											重新训练（新 run）
										</Button>
										{canSwitchPhase ? (
											<>
												<span className="xz-awdp-note">手动切换阶段：</span>
												<Segmented
													ariaLabel="手动切换 AWDP 阶段"
													value={phase === "fix" ? "fix" : "break"}
													onChange={(next) => void onSwitchPhase(next)}
													options={[
														{ value: "break" as const, label: "Break" },
														{ value: "fix" as const, label: "Fix" },
													]}
												/>
											</>
										) : (
											<span className="xz-awdp-note">
												只有 Break / Fix 阶段可以手动切换（当前 {AWDP_PHASE_LABEL[data.phase]}）。
											</span>
										)}
									</div>
								</CardFoot>
							</Card>

							<div>
								<SectionHeading title="GameBox" hint="实例生命周期、Break flag、补丁与自检" />
								<div className="xz-gbgrid">
									<AwdpBoxCard
										box={boxViewFromRun(data)}
										policy={policy}
										actions={actions}
										invalidateKey={qk.training.all}
										instanceQueryKey={qk.training.instance(runId, gameboxId)}
										probeInstance={async () => unwrapNullable(await client.awdp.runs.getInstance(runId, gameboxId))}
										isPractice
										fixRoundScore={data.fix_round_score}
									/>
								</div>
							</div>

							<div>
								<SectionHeading
									title="明细"
									hint="回合 / 评测 / 计分流水 / Writeup"
									actions={
										<Segmented
											ariaLabel="练习 Run 明细视图"
											value={section}
											onChange={setSection}
											options={[
												{ value: "rounds" as const, label: "回合" },
												{ value: "evaluations" as const, label: "评测" },
												{ value: "scores" as const, label: "计分" },
												{ value: "writeup" as const, label: "Writeup" },
											]}
										/>
									}
								/>
								{section === "rounds" ? (
									<QueryBoundary
										isPending={rounds.isPending}
										isError={rounds.isError}
										error={rounds.error}
										refetch={() => void rounds.refetch()}
										loadingLabel="正在加载回合…"
									>
										<AwdpRoundsCard rounds={rounds.data ?? []} />
									</QueryBoundary>
								) : null}
								{section === "evaluations" ? (
									<QueryBoundary
										isPending={evaluations.isPending}
										isError={evaluations.isError}
										error={evaluations.error}
										refetch={() => void evaluations.refetch()}
										loadingLabel="正在加载评测记录…"
									>
										<AwdpEvaluationsCard evaluations={evaluations.data ?? []} />
									</QueryBoundary>
								) : null}
								{section === "scores" ? (
									<QueryBoundary
										isPending={scores.isPending}
										isError={scores.isError}
										error={scores.error}
										refetch={() => void scores.refetch()}
										loadingLabel="正在加载计分流水…"
									>
										<AwdpScoresCard
											scores={scores.data ?? { total: 0, history: [] }}
											gameboxName={data.gamebox_name}
										/>
									</QueryBoundary>
								) : null}
								{section === "writeup" ? (
									<Card>
										<CardHead
											title="我的 Writeup"
											icon="edit"
											sub={
												writeup.data?.updated_at ? `上次保存 ${formatDateTime(writeup.data.updated_at)}` : "尚未保存"
											}
											actions={
												<div className="xz-awdp-toolbar">
													{writeupDraft !== null && writeupDraft !== (writeup.data?.content ?? "") ? (
														<Badge tone="warn">有未保存改动</Badge>
													) : null}
													<Button
														variant="primary"
														icon="save"
														loading={saveWriteup.isPending}
														disabled={writeupDraft === null}
														onClick={() => {
															if (writeupDraft !== null) saveWriteup.mutate(writeupDraft);
														}}
													>
														保存
													</Button>
												</div>
											}
										/>
										<CardBody>
											<QueryBoundary
												isPending={writeup.isPending}
												isError={writeup.isError}
												error={writeup.error}
												refetch={() => void writeup.refetch()}
												loadingLabel="正在加载 Writeup…"
											>
												<MarkdownEditor
													value={writeupDraft ?? writeup.data?.content ?? ""}
													onChange={setWriteupDraft}
													placeholder="记录你的利用链、补丁思路与验证过程（支持 Markdown）"
												/>
											</QueryBoundary>
										</CardBody>
										<CardFoot>
											<p className="xz-awdp-note">
												每个练习 Run 保存一份 Writeup；它是可选能力，不影响计分。
											</p>
										</CardFoot>
									</Card>
								) : null}
							</div>
						</>
					) : null}
				</QueryBoundary>
			</div>
		</div>
	);
}

/** 区块标题（复用设计系统 `SectionTitle`，保证与其它页面同形）。 */
function SectionHeading({ title, hint, actions }: { title: string; hint?: string; actions?: ReactNode }) {
	return (
		<SectionTitle actions={actions}>
			<Icon name="grid" size={15} /> {title}
			{hint ? <span className="xz-tr-hint">{hint}</span> : null}
		</SectionTitle>
	);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3. 路由
 * ════════════════════════════════════════════════════════════════════════ */

export const trainingPages: PageDef[] = [
	{ path: "/training", auth: "user", title: "训练场", render: () => <TrainingCatalogPage /> },
	{
		path: "/training/:runId",
		auth: "user",
		title: "练习 Run",
		wide: true,
		render: (props) => <TrainingRunPage {...props} />,
	},
];
