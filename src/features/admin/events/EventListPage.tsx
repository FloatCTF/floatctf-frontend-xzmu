/**
 * `/admin/events` —— 赛事列表 / 创建 / 编辑 / 删除。
 *
 * 语义与后端一致：
 * - admin 列表返回**全部**赛事（含 `hidden` 与 `is_virtual`）；
 * - `is_virtual` 是平台自有赛事（内置练习等），不提供编辑/删除入口；
 * - `family × purpose × participant_mode` 的合法组合由后端
 *   `events_mode_combination_check` 校验，前端下拉只提供合法选项。
 */

import { type FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EventFamily, EventPurpose, ParticipantMode, type Events } from "@floatctf/sdk/entity";

import { call, callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { formatDateTime } from "../../../lib/format.ts";
import { useDebounced } from "../../../lib/hooks.ts";
import { Link } from "../../../router/Link.tsx";
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
	Checkbox,
	Field,
	Select,
	TextInput,
} from "../../../ui/primitives.tsx";
import { DataTable, Pagination, readMeta } from "../../../ui/Table.tsx";
import { familyLabel, participantLabel } from "../../events/status.ts";
import { ROOT, TextAreaField, TextField, fromLocalInput, modesFor, normalizeMode, purposesFor, toLocalInput, usePager } from "./shared.tsx";

/* ── 创建 / 编辑表单 ─────────────────────────────────────────────── */

interface EventFormState {
	title: string;
	description: string;
	rules: string;
	flag_prefix: string;
	family: EventFamily;
	purpose: EventPurpose;
	participant_mode: ParticipantMode;
	hidden: boolean;
	allow_join: boolean;
	start_time: string;
	end_time: string;
}

function stateFrom(event: Events | null): EventFormState {
	if (!event) {
		return {
			title: "",
			description: "",
			rules: "",
			flag_prefix: "",
			family: EventFamily.Jeopardy,
			purpose: EventPurpose.Competition,
			participant_mode: ParticipantMode.Individual,
			hidden: false,
			allow_join: false,
			start_time: toLocalInput(new Date().toISOString()),
			end_time: "",
		};
	}
	return {
		title: event.title,
		description: event.description ?? "",
		rules: event.rules ?? "",
		flag_prefix: event.flag_prefix ?? "",
		family: event.family,
		purpose: event.purpose,
		participant_mode: event.participant_mode,
		hidden: event.hidden,
		allow_join: event.allow_join,
		start_time: toLocalInput(event.start_time),
		end_time: toLocalInput(event.end_time),
	};
}

function EventFormModal({ event, onClose }: { event: Events | null; onClose: () => void }) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const [form, setForm] = useState<EventFormState>(() => stateFrom(event));
	const [touched, setTouched] = useState(false);

	const patch = (next: Partial<EventFormState>) => setForm((current) => ({ ...current, ...next }));

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: ROOT.adminEvents });
		void queryClient.invalidateQueries({ queryKey: ROOT.events });
	};

	const save = useMutation({
		mutationFn: (): Promise<Events> => {
			const payload: Partial<Events> = {
				title: form.title.trim(),
				description: form.description,
				rules: form.rules,
				flag_prefix: form.flag_prefix.trim() || undefined,
				family: form.family,
				purpose: form.purpose,
				participant_mode: form.participant_mode,
				hidden: form.hidden,
				allow_join: form.allow_join,
				start_time: fromLocalInput(form.start_time) ?? new Date().toISOString(),
				end_time: fromLocalInput(form.end_time) ?? undefined,
			};
			if (event) return call(client.admin.events.patch({ ...payload, id: event.id }), "赛事更新");
			return call(client.admin.events.create(payload), "赛事创建");
		},
		onSuccess: (saved) => {
			toast.success(event ? "赛事已更新" : "赛事已创建", `「${saved.title}」`);
			invalidate();
			onClose();
		},
		onError: (error) => toast.error(event ? "更新赛事失败" : "创建赛事失败", errorText(error)),
	});

	const titleError = touched && form.title.trim().length === 0 ? "请填写赛事标题" : undefined;
	const startError = touched && !fromLocalInput(form.start_time) ? "请填写合法的开始时间" : undefined;

	return (
		<Modal
			open
			onClose={onClose}
			size="wide"
			persistent={save.isPending}
			title={event ? `编辑赛事 · ${event.title}` : "创建赛事"}
			description="family × purpose × participant_mode 的合法组合由后端校验，这里只提供合法选项"
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
							setTouched(true);
							if (form.title.trim().length === 0 || !fromLocalInput(form.start_time)) return;
							save.mutate();
						}}
					>
						{event ? "保存修改" : "创建赛事"}
					</Button>
				</>
			}
		>
			<form className="xz-aev-col" onSubmit={(submit: FormEvent) => submit.preventDefault()}>
				<TextField
					label="赛事标题"
					required
					error={titleError}
					value={form.title}
					onChange={(value) => patch({ title: value })}
					placeholder="例如：2026 春季新生赛"
				/>
				<div className="xz-aev-grid2">
					<Field label="赛制（family）" required>
						{(props) => (
							<Select
								{...props}
								value={form.family}
								onChange={(changeEvent) => {
									const family = changeEvent.target.value as EventFamily;
									const purpose = purposesFor(family)[0] ?? EventPurpose.Competition;
									patch({
										family,
										purpose,
										participant_mode: normalizeMode(family, purpose, form.participant_mode),
									});
								}}
							>
								<option value={EventFamily.Jeopardy}>解题赛（jeopardy）</option>
								<option value={EventFamily.Awd}>攻防对抗（awd）</option>
								<option value={EventFamily.Awdp}>攻防演练（awdp）</option>
							</Select>
						)}
					</Field>
					<Field label="用途（purpose）" required hint="只有 competition 才支持选手报名。">
						{(props) => (
							<Select
								{...props}
								value={form.purpose}
								onChange={(changeEvent) => {
									const purpose = changeEvent.target.value as EventPurpose;
									patch({
										purpose,
										participant_mode: normalizeMode(form.family, purpose, form.participant_mode),
									});
								}}
							>
								{purposesFor(form.family).map((purpose) => (
									<option key={purpose} value={purpose}>
										{purpose === EventPurpose.Practice ? "练习（practice）" : "正式比赛（competition）"}
									</option>
								))}
							</Select>
						)}
					</Field>
					<Field label="参赛方式（participant_mode）" required hint="AWD 只能是团队赛。">
						{(props) => (
							<Select
								{...props}
								value={form.participant_mode}
								onChange={(changeEvent) =>
									patch({ participant_mode: changeEvent.target.value as ParticipantMode })
								}
							>
								{modesFor(form.family, form.purpose).map((mode) => (
									<option key={mode} value={mode}>
										{mode === ParticipantMode.Individual ? "个人（individual）" : "团队（team）"}
									</option>
								))}
							</Select>
						)}
					</Field>
					<TextField
						label="flag 前缀"
						hint="留空则使用平台默认前缀。"
						value={form.flag_prefix}
						onChange={(value) => patch({ flag_prefix: value })}
						placeholder="例如：flag{"
						mono
					/>
					<Field label="开始时间" required error={startError}>
						{(props) => (
							<TextInput
								{...props}
								type="datetime-local"
								value={form.start_time}
								onChange={(changeEvent) => patch({ start_time: changeEvent.target.value })}
							/>
						)}
					</Field>
					<Field label="结束时间" hint="留空表示长期开放。">
						{(props) => (
							<TextInput
								{...props}
								type="datetime-local"
								value={form.end_time}
								onChange={(changeEvent) => patch({ end_time: changeEvent.target.value })}
							/>
						)}
					</Field>
				</div>
				{event &&
				(event.family !== form.family ||
					event.purpose !== form.purpose ||
					event.participant_mode !== form.participant_mode) ? (
					<Banner tone="warn" title="赛制组合变更会影响参赛通道">
						改动 family / purpose / participant_mode 后，选手端的报名通道与工作台都会随之变化；已报名的选手可能无法继续参赛。
					</Banner>
				) : null}
				<TextAreaField
					label="赛事简介（description）"
					rows={3}
					value={form.description}
					onChange={(value) => patch({ description: value })}
				/>
				<TextAreaField
					label="赛事规则（rules）"
					rows={5}
					value={form.rules}
					onChange={(value) => patch({ rules: value })}
				/>
				<div className="xz-aev-inline">
					<Checkbox
						label="对选手隐藏（hidden）"
						checked={form.hidden}
						onChange={(checked) => patch({ hidden: checked })}
					/>
					<Checkbox
						label="允许报名（allow_join）"
						checked={form.allow_join}
						onChange={(checked) => patch({ allow_join: checked })}
					/>
				</div>
			</form>
		</Modal>
	);
}

/* ── 列表页 ───────────────────────────────────────────────────────── */

export function AdminEventListPage() {
	useDocumentTitle("赛事管理");
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const pager = usePager();
	const [search, setSearch] = useState("");
	const [family, setFamily] = useState("all");
	const debounced = useDebounced(search);
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	const [editing, setEditing] = useState<Events | null | undefined>(undefined);

	const list = useQuery({
		queryKey: qk.admin.events(pager.params),
		queryFn: () => callList(client.admin.events.fetch(pager.params)),
	});

	const items = list.data?.items ?? [];
	const meta = readMeta(list.data?.meta, pager.pageSize);

	const filtered = useMemo(
		() =>
			items.filter((event) => {
				if (family !== "all" && String(event.family) !== family) return false;
				const needle = debounced.trim().toLowerCase();
				if (!needle) return true;
				return [event.title, event.description ?? "", event.id].some((value) =>
					value.toLowerCase().includes(needle),
				);
			}),
		[items, family, debounced],
	);

	const selectable = filtered.filter((event) => !event.is_virtual);
	const allSelected = selectable.length > 0 && selectable.every((event) => selected.has(event.id));

	const toggleAll = () => {
		setSelected((current) => {
			const next = new Set(current);
			if (allSelected) for (const event of selectable) next.delete(event.id);
			else for (const event of selectable) next.add(event.id);
			return next;
		});
	};

	const remove = useMutation({
		mutationFn: (idList: string[]) => call(client.admin.events.remove(idList), "删除结果"),
		onSuccess: () => {
			toast.success("赛事已删除", "相关容器与实例会由平台回收。");
			setSelected(new Set());
			void queryClient.invalidateQueries({ queryKey: ROOT.adminEvents });
			void queryClient.invalidateQueries({ queryKey: ROOT.events });
		},
		onError: (error) => toast.error("删除赛事失败", errorText(error)),
	});

	const askRemove = async (targets: Events[]) => {
		if (targets.length === 0) return;
		if (targets.some((event) => event.is_virtual)) {
			toast.warn("包含平台自有赛事", "is_virtual 的赛事由平台维护，不能删除。");
			return;
		}
		const first = targets[0];
		const ok = await confirm({
			title: targets.length === 1 ? `删除赛事「${first?.title ?? ""}」？` : `删除 ${targets.length} 场赛事？`,
			description: "赛事、挂题关系、报名名单与操作日志都会一并移除。",
			consequences:
				"该赛事下的运行实例与 GameBox 容器会被回收；选手的解题记录不再可见。此操作不可撤销。",
			tone: "danger",
			confirmText: "删除赛事",
		});
		if (ok) remove.mutate(targets.map((event) => event.id));
	};

	return (
		<div className="xz-page xz-page--wide">
			<header className="xz-page__head xz-aev-pagehead">
				<div className="xz-grow">
					<h1 className="xz-page__title">赛事管理</h1>
					<p className="xz-page__desc">
						管理端可以看到全部赛事（含隐藏与平台自有赛事）。打开任意赛事进入**赛事控制台**，
						配置 / 题目 / 用户 / 战队 / 公告 / 日志 / 实例 / Writeup / 数据大屏 / AWD / AWDP / 网络
						都在控制台的标签页里（`?tab=` 可深链）。
					</p>
				</div>
				<Button variant="primary" icon="plus" onClick={() => setEditing(null)}>
					创建赛事
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
						placeholder="搜索标题 / 简介 / ID"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
				</span>
				<Select value={family} onChange={(event) => setFamily(event.target.value)} aria-label="筛选赛制">
					<option value="all">全部赛制</option>
					<option value="jeopardy">解题赛</option>
					<option value="awd">AWD</option>
					<option value="awdp">AWDP</option>
				</Select>
				<Button
					variant="danger-ghost"
					icon="trash"
					disabled={selected.size === 0}
					loading={remove.isPending}
					onClick={() => void askRemove(items.filter((event) => selected.has(event.id)))}
				>
					删除选中（{selected.size}）
				</Button>
				<span className="xz-aev-toolbar--end xz-muted xz-xs">
					{list.isSuccess ? `本页 ${filtered.length} / ${items.length} 场` : ""}
				</span>
			</div>

			<Card>
				<CardHead title="全部赛事" icon="flag" sub={`共 ${meta.total} 场`} />
				<CardBody flush>
					<QueryBoundary
						isPending={list.isPending}
						isError={list.isError}
						error={list.error}
						refetch={() => void list.refetch()}
						loadingLabel="正在加载赛事列表…"
					>
						<DataTable
							rows={filtered}
							rowKey={(event) => event.id}
							columns={[
								{
									key: "select",
									header: (
										<input
											type="checkbox"
											aria-label="全选本页可删除赛事"
											checked={allSelected}
											onChange={toggleAll}
										/>
									),
									width: 36,
									render: (event) => (
										<input
											type="checkbox"
											aria-label={`选择 ${event.title}`}
											disabled={event.is_virtual}
											checked={selected.has(event.id)}
											onChange={(changeEvent) =>
												setSelected((current) => {
													const next = new Set(current);
													if (changeEvent.target.checked) next.add(event.id);
													else next.delete(event.id);
													return next;
												})
											}
										/>
									),
								},
								{
									key: "title",
									header: "赛事",
									render: (event) => (
										<div>
											<Link to={`/admin/events/${event.id}`}>{event.title}</Link>
											<div className="xz-muted xz-xs xz-mono">{event.id}</div>
										</div>
									),
								},
								{
									key: "family",
									header: "赛制",
									render: (event) => (
										<div className="xz-aev-inline">
											<Badge tone="crimson">{familyLabel(String(event.family))}</Badge>
											<Badge>{participantLabel(String(event.participant_mode))}</Badge>
											<Badge tone={String(event.purpose) === "practice" ? "info" : "gold"}>
												{String(event.purpose) === "practice" ? "练习" : "比赛"}
											</Badge>
										</div>
									),
								},
								{
									key: "visibility",
									header: "可见性",
									render: (event) => (
										<div className="xz-aev-badges">
											{event.hidden ? <Badge tone="warn">隐藏</Badge> : <Badge tone="ok">公开</Badge>}
											{event.allow_join ? <Badge tone="info">可报名</Badge> : <Badge>报名锁定</Badge>}
											{event.is_virtual ? <Badge tone="solid">平台自有</Badge> : null}
										</div>
									),
								},
								{ key: "start", header: "开始", render: (event) => formatDateTime(event.start_time) },
								{
									key: "end",
									header: "结束",
									render: (event) =>
										event.end_time ? (
											formatDateTime(event.end_time)
										) : (
											<span className="xz-muted">长期开放</span>
										),
								},
								{
									key: "actions",
									header: "操作",
									align: "right",
									width: 250,
									render: (event) => (
										<div className="xz-aev-rowactions">
											<Link to={`/admin/events/${event.id}`} className="xz-btn xz-btn--sm">
												<Icon name="settings" size={14} />
												控制台
											</Link>
											<Button
												size="sm"
												icon="edit"
												disabled={event.is_virtual}
												onClick={() => setEditing(event)}
											>
												编辑
											</Button>
											<Button
												size="sm"
												variant="danger-ghost"
												icon="trash"
												disabled={event.is_virtual}
												onClick={() => void askRemove([event])}
											>
												删除
											</Button>
										</div>
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

			{editing !== undefined ? (
				<EventFormModal
					key={editing?.id ?? "new"}
					event={editing}
					onClose={() => setEditing(undefined)}
				/>
			) : null}
		</div>
	);
}
