/**
 * 选手工作区 · 题库（Jeopardy）。
 *
 * - `/challenges`：全站题目目录（服务端分页 + 本地搜索 / 分类筛选）
 * - `/challenges/:id`：题目详情（附件、实例生命周期、flag 提交、我的题解）
 * - `/instances`：我的全部实例（题目实例 + AWDP 练习实例），单个销毁 + 批量销毁
 * - `/sets`、`/sets/:id`：训练题集与题集内解题
 *
 * 后端语义（docs/CAPABILITY-BEHAVIOR-MAP「Jeopardy」）：
 * - 题目详情接口**不返回赛事分值**：`current_points` 只在 `events.fetchChallenges` 里，
 *   所以详情页只提示「赛事分值请看赛事驾驶舱」，绝不编造分值；
 * - `container_port == null` ⇒ 静态题（无容器，但启动后才有 `instance_id` 可提交）；
 * - `challenges.getInstance` 只查系统练习赛事，无实例时 `data = null`，对非动态题可能整体失败
 *   ⇒ 一律当「没有实例」，不是页面错误（但会在界面上如实说明「无法确认实例状态」）；
 * - `static_flag_value` 只在 admin 接口返回，选手端**禁止展示**（本文件从不读取它）；
 * - `QueryParams` 只有 `offset/limit/page/total/filter`，没有 search/sort ⇒ 搜索与筛选在本地做。
 */

import { type ChangeEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChallengesListItem, Instances, QueryParams } from "@floatctf/sdk";
import type { ChallengeSets } from "@floatctf/sdk/entity";

import { call, callList, unwrapNullable } from "../../api/call.ts";
import { useClient } from "../../api/client.ts";
import { errorText } from "../../api/errors.ts";
import { qk } from "../../api/keys.ts";
import { formatDateTime, matches } from "../../lib/format.ts";
import { useDebounced } from "../../lib/hooks.ts";
import { Link } from "../../router/Link.tsx";
import type { PageProps } from "../../router/pages.ts";
import { useDocumentTitle } from "../../router/router.tsx";
import { Icon } from "../../ui/icons.tsx";
import { MarkdownEditor, MarkdownView } from "../../ui/Markdown.tsx";
import { Modal, QueryBoundary, useConfirm, useToast } from "../../ui/overlays.tsx";
import {
	Badge,
	Banner,
	Button,
	Card,
	CardBody,
	CardHead,
	Checkbox,
	EmptyState,
	KeyValue,
	Segmented,
	Select,
} from "../../ui/primitives.tsx";
import { type Column, DataTable, Pagination, readMeta } from "../../ui/Table.tsx";
import {
	AttachmentLink,
	ChallengeRunner,
	type ChallengeRunnerAdapter,
	ChallengeTile,
	InstanceCountdown,
	isStaticChallenge,
} from "./components.tsx";

/* ── 独立题目（练习维度）的实例适配器 ─────────────────────────────── */

/**
 * `/challenges/:id` 与题集内题目的实例入口：`challenges.getInstance` / `instances.launch` /
 * `submit.submit`。`lookupFailed` 用于把「接口不适用」如实告诉用户，而不是静默。
 */
function useStandaloneAdapter(challengeId: string) {
	const client = useClient();
	const [lookupFailed, setLookupFailed] = useState(false);

	const adapter = useMemo<ChallengeRunnerAdapter>(
		() => ({
			instanceKey: qk.challenges.instance(challengeId),
			getInstance: async () => {
				try {
					const value = unwrapNullable(await client.service.challenges.getInstance(challengeId));
					setLookupFailed(false);
					return value;
				} catch {
					// 该接口只在系统练习赛事里查实例；对非动态题 / 非练习题目可能失败。
					// 平台语义是「没有实例」（见 docs/CAPABILITY-BEHAVIOR-MAP 与 task 说明），
					// 所以这里不把它升级成页面级错误，只用 notice 如实说明。
					setLookupFailed(true);
					return null;
				}
			},
			launch: () => call(client.service.instances.launch(challengeId), "实例"),
			submit: (instanceId, flag) =>
				call(client.service.submit.submit({ instance_id: instanceId, flag }), "提交结果"),
			invalidate: [qk.challenges.all, qk.instances.all],
		}),
		[challengeId, client],
	);

	return { adapter, lookupFailed };
}

function standaloneNotice(lookupFailed: boolean) {
	if (!lookupFailed) return null;
	return (
		<Banner tone="warn" title="无法确认这道题的实例状态">
			独立题目接口只覆盖平台的练习赛事，非动态题 / 未加入练习时可能直接失败。若你确认自己已有运行中实例，
			请到「我的实例」页面查看与销毁。
		</Banner>
	);
}

/* ── `/challenges` 题目目录 ───────────────────────────────────────── */

const CATALOG_PAGE_SIZE = 24;

export function ChallengeCatalogPage() {
	useDocumentTitle("题库");
	const client = useClient();
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(CATALOG_PAGE_SIZE);
	const [search, setSearch] = useState("");
	const [category, setCategory] = useState("all");
	const [unsolvedOnly, setUnsolvedOnly] = useState(false);
	const debounced = useDebounced(search);

	const params = useMemo<QueryParams>(() => ({ page, limit: pageSize }), [page, pageSize]);
	const list = useQuery({
		queryKey: qk.challenges.list(params),
		queryFn: () => callList(client.service.challenges.fetch(params)),
	});

	const items = list.data?.items ?? [];
	const meta = readMeta(list.data?.meta, pageSize);

	const categories = useMemo(() => {
		const set = new Set<string>();
		for (const item of items) set.add(item.category || "");
		return [...set].sort((a, b) => a.localeCompare(b, "zh-CN"));
	}, [items]);

	const filtered = useMemo(
		() =>
			items.filter((item) => {
				if (!matches([item.name, item.category, item.description], debounced)) return false;
				if (category !== "all" && (item.category || "") !== category) return false;
				if (unsolvedOnly && item.solved) return false;
				return true;
			}),
		[items, debounced, category, unsolvedOnly],
	);

	return (
		<div className="xz-page">
			<header className="xz-page__head">
				<div>
					<h1 className="xz-page__title">题库</h1>
					<p className="xz-page__desc">
						全站题目目录。容器题需要先启动实例，静态题（附件题）没有容器但同样要先开始答题才会生成提交凭据。
						赛事内的动态分值只在赛事驾驶舱里显示。
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
						placeholder="搜索题目名称 / 分类 / 描述（当前页）"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
				</span>
				<Select value={category} aria-label="分类" onChange={(event) => setCategory(event.target.value)}>
					<option value="all">全部分类</option>
					{categories.map((entry) => (
						<option key={entry || "__empty"} value={entry}>
							{entry || "未分类"}
						</option>
					))}
				</Select>
				<Checkbox label="只看未解出" checked={unsolvedOnly} onChange={setUnsolvedOnly} />
				<span className="xz-muted xz-xs" style={{ marginLeft: "auto" }}>
					{list.isSuccess ? `本页 ${filtered.length} / ${items.length} 道` : ""}
				</span>
			</div>

			<QueryBoundary
				isPending={list.isPending}
				isError={list.isError}
				error={list.error}
				refetch={() => void list.refetch()}
				loadingLabel="正在加载题目目录…"
			>
				{filtered.length === 0 ? (
					<Card flat>
						<EmptyState
							icon="puzzle"
							title={items.length === 0 ? "目录里还没有题目" : "没有符合条件的题目"}
							desc={
								items.length === 0
									? "管理员导入并公开题目后会显示在这里。"
									: "搜索与分类筛选作用于当前页，试试翻页或放宽条件。"
							}
						/>
					</Card>
				) : (
					<div className="xz-chgrid">
						{filtered.map((item) => (
							<ChallengeTile
								key={item.id}
								challenge={item}
								solved={item.solved}
								to={`/challenges/${item.id}`}
								meta={
									<span className="xz-muted xz-xs">
										{item.attachment ? "含附件" : "无附件"}
										{item.version ? ` · v${item.version}` : ""}
										{item.author ? ` · ${item.author}` : ""}
									</span>
								}
							/>
						))}
					</div>
				)}
				{meta.total > 0 ? (
					<Pagination
						page={meta.page}
						pageSize={meta.pageSize}
						total={meta.total}
						onPageChange={setPage}
						onPageSizeChange={(size) => {
							setPageSize(size);
							setPage(1);
						}}
					/>
				) : null}
			</QueryBoundary>
		</div>
	);
}

/* ── `/challenges/:id` 题目详情 ───────────────────────────────────── */

export function ChallengeDetailPage({ params }: PageProps) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const challengeId = params.id ?? "";

	const detail = useQuery({
		queryKey: qk.challenges.detail(challengeId),
		queryFn: () => call(client.service.challenges.get(challengeId), "题目详情"),
		enabled: challengeId.length > 0,
	});

	const { adapter, lookupFailed } = useStandaloneAdapter(challengeId);

	const writeup = useQuery({
		queryKey: qk.challenges.myWriteup(challengeId),
		queryFn: async () => unwrapNullable(await client.service.challenges.getMyWriteup(challengeId)),
		enabled: challengeId.length > 0,
	});

	const [draft, setDraft] = useState<string | null>(null);
	const savedContent = writeup.data?.content ?? "";
	const editorValue = draft ?? savedContent;

	const saveWriteup = useMutation({
		mutationFn: (content: string) =>
			call(client.service.challenges.createMyWriteup({ challenge_id: challengeId, content }), "题解保存结果"),
		onSuccess: () => {
			setDraft(null);
			toast.success("题解已保存", "只有你自己能编辑这份题解。");
			void queryClient.invalidateQueries({ queryKey: qk.challenges.myWriteup(challengeId) });
		},
		onError: (error) => toast.error("题解保存失败", errorText(error)),
	});

	useDocumentTitle(detail.data?.name ?? "题目详情");

	if (!challengeId) {
		return (
			<div className="xz-page">
				<EmptyState icon="alert" title="缺少题目 ID" desc="地址中没有题目标识，请从题库进入。" />
			</div>
		);
	}

	return (
		<div className="xz-page">
			<QueryBoundary
				isPending={detail.isPending}
				isError={detail.isError}
				error={detail.error}
				refetch={() => void detail.refetch()}
				loadingLabel="正在加载题目…"
			>
				{detail.data ? (
					<>
						<header className="xz-page__head">
							<div className="xz-grow">
								<div className="xz-row" style={{ gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
									<Link to="/challenges" className="xz-muted xz-xs">
										← 题库
									</Link>
									<Badge>{detail.data.category || "未分类"}</Badge>
									{isStaticChallenge(detail.data) ? (
										<Badge tone="neutral" icon="file">
											静态题
										</Badge>
									) : (
										<Badge tone="info" icon="box">
											容器题
										</Badge>
									)}
									{detail.data.solved ? (
										<Badge tone="ok" icon="check">
											已解出
										</Badge>
									) : null}
									{detail.data.version ? <Badge tone="neutral">v{detail.data.version}</Badge> : null}
								</div>
								<h1 className="xz-page__title">{detail.data.name}</h1>
								<p className="xz-page__desc">
									题目详情接口不返回赛事分值；在赛事里的动态分值（随解出人数下降）请到该赛事的驾驶舱「题目」标签查看。
								</p>
							</div>
						</header>

						<div className="xz-grid xz-grid--2 xz-jeo-detail">
							<div className="xz-col" style={{ gap: 16 }}>
								<Card>
									<CardHead title="题目描述" icon="file" />
									<CardBody>
										{detail.data.description ? (
											<MarkdownView>{detail.data.description}</MarkdownView>
										) : (
											<p className="xz-muted">这道题没有文字描述。</p>
										)}
									</CardBody>
								</Card>

								<Card>
									<CardHead title="附件" icon="download" />
									<CardBody>
										{detail.data.attachment ? (
											<AttachmentLink challenge={detail.data} />
										) : (
											<p className="xz-muted">这道题没有附件。</p>
										)}
									</CardBody>
								</Card>

								<Card>
									<CardHead title="题目信息" icon="info" />
									<CardBody>
										<KeyValue
											items={[
												{ k: "分类", v: detail.data.category || "未分类" },
												{
													k: "形态",
													v: isStaticChallenge(detail.data) ? "静态题（无容器）" : "容器题（需启动实例）",
												},
												{
													k: "容器端口",
													v: detail.data.container_port != null ? detail.data.container_port : "—",
												},
												{ k: "版本", v: detail.data.version ?? "—" },
												{ k: "作者", v: detail.data.author ?? "—" },
												{ k: "构建状态", v: detail.data.build_status ?? "—" },
												{ k: "更新时间", v: formatDateTime(detail.data.updated_at) },
											]}
										/>
									</CardBody>
								</Card>
							</div>

							<div className="xz-col" style={{ gap: 16 }}>
								<Card>
									<CardHead title="实例与提交" icon="flag" sub="启动实例后提交 flag" />
									<CardBody>
										<ChallengeRunner
											challenge={detail.data}
											adapter={adapter}
											solved={detail.data.solved}
											notice={standaloneNotice(lookupFailed)}
											onSolved={() => void queryClient.invalidateQueries({ queryKey: qk.challenges.all })}
										/>
									</CardBody>
								</Card>

								<Card>
									<CardHead
										title="我的题解"
										icon="book"
										sub="只有自己可见"
										actions={
											<div className="xz-row" style={{ gap: 8 }}>
												<Button
													variant="danger-ghost"
													size="sm"
													icon="trash"
													disabled={!savedContent.trim() || saveWriteup.isPending}
													onClick={async () => {
														const ok = await confirm({
															title: "清空我的题解？",
															description: `将把「${detail.data?.name ?? "该题"}」的题解内容保存为空。`,
															consequences:
																"平台没有删除题解的接口（只有新建/覆盖），因此这里是以空内容覆盖已保存的题解；原内容无法恢复，建议先复制备份。",
															tone: "danger",
															confirmText: "清空题解",
														});
														if (ok) saveWriteup.mutate("");
													}}
												>
													清空
												</Button>
												<Button
													variant="primary"
													size="sm"
													icon="save"
													loading={saveWriteup.isPending}
													disabled={editorValue.trim().length === 0 || editorValue === savedContent}
													onClick={() => saveWriteup.mutate(editorValue)}
												>
													保存题解
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
											loadingLabel="正在加载我的题解…"
										>
											<MarkdownEditor
												value={editorValue}
												onChange={setDraft}
												minHeight={200}
												placeholder="写下你的解题思路（支持 Markdown）。内容为空时请用右上角「清空」。"
											/>
										</QueryBoundary>
									</CardBody>
								</Card>
							</div>
						</div>
					</>
				) : null}
			</QueryBoundary>
		</div>
	);
}

/* ── `/instances` 我的实例 ────────────────────────────────────────── */

export function InstancesPage() {
	useDocumentTitle("我的实例");
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(20);
	const [search, setSearch] = useState("");
	const [kind, setKind] = useState<"all" | "challenge" | "gamebox">("all");
	const [selected, setSelected] = useState<string[]>([]);
	const debounced = useDebounced(search);

	const params = useMemo<QueryParams>(() => ({ page, limit: pageSize }), [page, pageSize]);
	const list = useQuery({
		queryKey: qk.instances.list(params),
		queryFn: () => callList(client.service.instances.fetch(params)),
		// 实例状态变化快：每次进入页面都重新取（沿用 Default 对实例页的 staleTime = 0）。
		staleTime: 0,
	});

	const items = list.data?.items ?? [];
	const meta = readMeta(list.data?.meta, pageSize);

	const isGamebox = (row: Instances) => Boolean(row.run_id);
	const filtered = useMemo(
		() =>
			items.filter((row) => {
				if (kind === "challenge" && isGamebox(row)) return false;
				if (kind === "gamebox" && !isGamebox(row)) return false;
				return matches(
					[row.identifier, row.challenge_title, row.gamebox_title, row.event_title, row.user_name, row.id],
					debounced,
				);
			}),
		[items, kind, debounced],
	);

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: qk.instances.all });
		void queryClient.invalidateQueries({ queryKey: qk.events.all });
		void queryClient.invalidateQueries({ queryKey: qk.challenges.all });
	};

	const destroyOne = useMutation({
		mutationFn: (instanceId: string) => call(client.service.instances.destroy(instanceId), "销毁结果"),
		onSuccess: () => {
			toast.success("实例已销毁");
			invalidate();
		},
		onError: (error) => toast.error("销毁实例失败", errorText(error)),
	});

	const destroyMany = useMutation({
		mutationFn: (ids: string[]) => call(client.service.instances.bulkDelete(ids), "批量销毁结果"),
		onSuccess: () => {
			toast.success("批量销毁完成");
			setSelected([]);
			invalidate();
		},
		onError: (error) => toast.error("批量销毁失败", errorText(error)),
	});

	const allSelected = filtered.length > 0 && filtered.every((row) => selected.includes(row.id));
	const toggleAll = (event: ChangeEvent<HTMLInputElement>) => {
		setSelected(event.target.checked ? filtered.map((row) => row.id) : []);
	};
	const toggleOne = (id: string, checked: boolean) => {
		setSelected((current) => (checked ? [...current, id] : current.filter((entry) => entry !== id)));
	};

	const columns: Column<Instances>[] = [
		{
			key: "select",
			header: (
				<input
					type="checkbox"
					aria-label="选择本页全部实例"
					checked={allSelected}
					onChange={toggleAll}
				/>
			),
			width: 40,
			render: (row) => (
				<input
					type="checkbox"
					aria-label={`选择实例 ${row.identifier}`}
					checked={selected.includes(row.id)}
					onChange={(event) => toggleOne(row.id, event.target.checked)}
				/>
			),
		},
		{
			key: "identifier",
			header: "实例标识",
			render: (row) => <code className="xz-code xz-mono xz-xs">{row.identifier}</code>,
		},
		{
			key: "kind",
			header: "类型",
			render: (row) =>
				isGamebox(row) ? <Badge tone="gold">AWDP 练习</Badge> : <Badge tone="crimson">题目实例</Badge>,
		},
		{
			key: "content",
			header: "内容",
			render: (row) => row.challenge_title ?? row.gamebox_title ?? <span className="xz-muted">—</span>,
		},
		{
			key: "event",
			header: "赛事",
			render: (row) => row.event_title ?? <span className="xz-muted">—</span>,
		},
		{
			key: "status",
			header: "状态",
			render: (row) => (
				<Badge tone={row.status === "running" ? "ok" : "neutral"}>{row.status}</Badge>
			),
		},
		{
			key: "destroy_at",
			header: "自动销毁",
			render: (row) => <InstanceCountdown destroyAt={row.destroy_at} />,
		},
		{
			key: "created_at",
			header: "创建时间",
			render: (row) => <span className="xz-muted xz-xs">{formatDateTime(row.created_at)}</span>,
		},
		{
			key: "actions",
			header: "操作",
			align: "right",
			render: (row) => (
				<div className="xz-row" style={{ gap: 6, justifyContent: "flex-end" }}>
					{isGamebox(row) && row.run_id ? (
						<Link to={`/training/${row.run_id}`} className="xz-btn xz-btn--ghost xz-btn--sm">
							<Icon name="target" size={14} />
							打开演练
						</Link>
					) : row.challenge_id ? (
						<Link to={`/challenges/${row.challenge_id}`} className="xz-btn xz-btn--ghost xz-btn--sm">
							<Icon name="puzzle" size={14} />
							打开题目
						</Link>
					) : null}
					<Button
						variant="danger-ghost"
						size="sm"
						icon="trash"
						loading={destroyOne.isPending && destroyOne.variables === row.id}
						onClick={async () => {
							const ok = await confirm({
								title: "销毁该实例？",
								description: `将销毁实例 ${row.identifier}。`,
								consequences:
									"容器会被停止并移除，实例内的临时文件与进程状态全部丢失且无法恢复；如需继续解题必须重新启动实例。",
								tone: "danger",
								confirmText: "销毁实例",
							});
							if (ok) destroyOne.mutate(row.id);
						}}
					>
						销毁
					</Button>
				</div>
			),
		},
	];

	return (
		<div className="xz-page xz-page--wide">
			<header className="xz-page__head">
				<div>
					<h1 className="xz-page__title">我的实例</h1>
					<p className="xz-page__desc">
						这里合并显示你的题目实例与 AWDP 练习实例。销毁是不可恢复的：容器与其中的临时数据都会被回收。
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
						placeholder="搜索实例标识 / 题目 / 赛事（当前页）"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
				</span>
				<Segmented
					ariaLabel="实例类型"
					value={kind}
					onChange={setKind}
					options={[
						{ value: "all", label: "全部" },
						{ value: "challenge", label: "题目实例" },
						{ value: "gamebox", label: "练习实例" },
					]}
				/>
				<Button
					variant="danger"
					size="sm"
					icon="trash"
					disabled={selected.length === 0}
					loading={destroyMany.isPending}
					onClick={async () => {
						const ok = await confirm({
							title: `批量销毁 ${selected.length} 个实例？`,
							description: "将一次性销毁所有已勾选的实例（题目实例与练习实例都包括）。",
							consequences:
								"每个实例的容器都会被停止并移除，其中的临时文件、进程与已获取的线索全部丢失且无法恢复。批量操作不能撤销。",
							tone: "danger",
							confirmText: `销毁 ${selected.length} 个实例`,
						});
						if (ok) destroyMany.mutate(selected);
					}}
				>
					批量销毁{selected.length > 0 ? `（${selected.length}）` : ""}
				</Button>
				<span className="xz-muted xz-xs" style={{ marginLeft: "auto" }}>
					{list.isSuccess ? `本页 ${filtered.length} / ${items.length} 个` : ""}
				</span>
			</div>

			<QueryBoundary
				isPending={list.isPending}
				isError={list.isError}
				error={list.error}
				refetch={() => void list.refetch()}
				loadingLabel="正在加载我的实例…"
			>
				<Card flat>
					<CardBody flush>
						<DataTable
							columns={columns}
							rows={filtered}
							rowKey={(row) => row.id}
							compact
							empty={
								<EmptyState
									icon="box"
									title={items.length === 0 ? "你还没有任何实例" : "没有符合条件的实例"}
									desc={
										items.length === 0
											? "在题目详情或赛事驾驶舱里启动实例后，它会出现在这里。"
											: "搜索与类型筛选作用于当前页。"
									}
								/>
							}
						/>
					</CardBody>
				</Card>
				{meta.total > 0 ? (
					<Pagination
						page={meta.page}
						pageSize={meta.pageSize}
						total={meta.total}
						onPageChange={setPage}
						onPageSizeChange={(size) => {
							setPageSize(size);
							setPage(1);
						}}
					/>
				) : null}
			</QueryBoundary>
		</div>
	);
}

/* ── `/sets` 题集列表 ─────────────────────────────────────────────── */

export function ChallengeSetsPage() {
	useDocumentTitle("题集");
	const client = useClient();
	const sets = useQuery({
		queryKey: qk.challenges.sets,
		// 注意：`getChallengeSets()` **没有参数**（不是 QueryParams 列表接口）。
		queryFn: () => call(client.service.challenges.getChallengeSets(), "题集列表"),
	});

	return (
		<div className="xz-page">
			<header className="xz-page__head">
				<div>
					<h1 className="xz-page__title">题集</h1>
					<p className="xz-page__desc">题集把一组题目打包成训练路径，可以逐题启动实例并提交 flag。</p>
				</div>
			</header>

			<QueryBoundary
				isPending={sets.isPending}
				isError={sets.isError}
				error={sets.error}
				refetch={() => void sets.refetch()}
				loadingLabel="正在加载题集…"
			>
				{(sets.data ?? []).length === 0 ? (
					<Card flat>
						<EmptyState icon="layers" title="还没有题集" desc="管理员创建题集后会显示在这里。" />
					</Card>
				) : (
					<div className="xz-grid xz-grid--3">
						{(sets.data ?? []).map((entry: ChallengeSets) => (
							<Card key={entry.id}>
								<CardHead title={entry.name} icon="layers" sub={formatDateTime(entry.created_at)} />
								<CardBody>
									<p className="xz-muted xz-clamp-3" style={{ marginTop: 0 }}>
										{entry.description || "这个题集没有描述。"}
									</p>
									<Link to={`/sets/${entry.id}`} className="xz-btn xz-btn--ghost xz-btn--sm">
										<Icon name="chevronRight" size={14} />
										进入题集
									</Link>
								</CardBody>
							</Card>
						))}
					</div>
				)}
			</QueryBoundary>
		</div>
	);
}

/* ── `/sets/:id` 题集详情 ─────────────────────────────────────────── */

export function ChallengeSetDetailPage({ params }: PageProps) {
	const client = useClient();
	const queryClient = useQueryClient();
	const setId = params.id ?? "";
	const [active, setActive] = useState<ChallengesListItem | null>(null);

	const setDetails = useQuery({
		queryKey: qk.challenges.set(setId),
		queryFn: () => call(client.service.challenges.getChallengeSet(setId), "题集题目"),
		enabled: setId.length > 0,
	});

	const { adapter, lookupFailed } = useStandaloneAdapter(active?.id ?? "");

	useDocumentTitle("题集详情");

	if (!setId) {
		return (
			<div className="xz-page">
				<EmptyState icon="alert" title="缺少题集 ID" desc="地址中没有题集标识，请从题集列表进入。" />
			</div>
		);
	}

	const challenges = setDetails.data ?? [];
	const solvedCount = challenges.filter((entry) => entry.solved).length;

	return (
		<div className="xz-page xz-page--wide">
			<header className="xz-page__head">
				<div className="xz-grow">
					<div className="xz-row" style={{ gap: 8, marginBottom: 6 }}>
						<Link to="/sets" className="xz-muted xz-xs">
							← 题集列表
						</Link>
						<Badge tone="gold" icon="layers">
							训练题集
						</Badge>
						{setDetails.isSuccess ? (
							<Badge tone="neutral">
								已解出 {solvedCount} / {challenges.length}
							</Badge>
						) : null}
					</div>
					<h1 className="xz-page__title">题集内容</h1>
					<p className="xz-page__desc">
						点开任意题目即可就地启动实例并提交 flag；提交成功后列表会自动刷新「已解出」标记。
					</p>
				</div>
			</header>

			<QueryBoundary
				isPending={setDetails.isPending}
				isError={setDetails.isError}
				error={setDetails.error}
				refetch={() => void setDetails.refetch()}
				loadingLabel="正在加载题集内容…"
			>
				{challenges.length === 0 ? (
					<Card flat>
						<EmptyState icon="layers" title="这个题集还没有题目" desc="管理员向题集里添加题目后会显示在这里。" />
					</Card>
				) : (
					<div className="xz-chgrid">
						{challenges.map((entry) => (
							<ChallengeTile
								key={entry.id}
								challenge={entry}
								solved={entry.solved}
								onOpen={() => setActive(entry)}
								openLabel={`在题集内解「${entry.name}」`}
								meta={
									<span className="xz-muted xz-xs">
										{entry.attachment ? "含附件 · " : ""}
										{isStaticChallenge(entry) ? "静态题" : "容器题"}
									</span>
								}
								actions={
									<Link to={`/challenges/${entry.id}`} className="xz-btn xz-btn--quiet xz-btn--sm">
										<Icon name="external" size={13} />
										题目详情
									</Link>
								}
							/>
						))}
					</div>
				)}
			</QueryBoundary>

			<Modal
				open={active !== null}
				onClose={() => setActive(null)}
				size="wide"
				title={active?.name ?? "题目"}
				description={active ? `${active.category || "未分类"} · 题集内解题` : undefined}
			>
				{active ? (
					<div className="xz-col" style={{ gap: 16 }}>
						{/* 题集内题目是练习维度：实例入口与 `/challenges/:id` 完全一致。 */}
						<ChallengeRunner
							challenge={active}
							adapter={adapter}
							solved={active.solved}
							notice={standaloneNotice(lookupFailed)}
							onSolved={() => {
								void queryClient.invalidateQueries({ queryKey: qk.challenges.set(setId) });
								void queryClient.invalidateQueries({ queryKey: qk.challenges.myWriteup(active.id) });
								void setDetails.refetch();
							}}
						/>
						{active.description ? (
							<div className="xz-card xz-card--flat">
								<div className="xz-card__body">
									<MarkdownView>{active.description}</MarkdownView>
								</div>
							</div>
						) : (
							<p className="xz-muted" style={{ margin: 0 }}>
								这道题没有文字描述。
							</p>
						)}
						<AttachmentLink challenge={active} />
						<div className="xz-row" style={{ gap: 8 }}>
							<Link to={`/challenges/${active.id}`} className="xz-btn xz-btn--ghost xz-btn--sm">
								<Icon name="external" size={14} />
								打开题目详情
							</Link>
						</div>
					</div>
				) : null}
			</Modal>
		</div>
	);
}

