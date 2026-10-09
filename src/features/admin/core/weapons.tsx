/**
 * 武器库管理（`/admin/weapons`）—— 工具/脚本条目 CRUD + 文件上传。
 *
 * 后端语义（SDK-API-REFERENCE §2.2.17 + §5 陷阱 22）：
 * - `fetch(params)` / `create(weapon)` / `patch(weapon)`（payload 必须带 `id`）/ `remove(id_list)`；
 * - **`upload(weapon_id, File)` 是位置参数**，multipart 字段名 `weapon`（SDK 内部已固定）；
 * - 创建接口的请求体要求 `has_file` / `file_url` / `download_count` 三个字段同时存在，
 *   因此新建时显式提交 `has_file: false` / `file_url: ""` / `download_count: 0`，
 *   随后由上传接口把 `has_file` / `file_url` 写成真实值。
 */

import { type FormEvent, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import type { Weapons } from "@floatctf/sdk/entity";

import { call, callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { formatDateTime, formatNumber } from "../../../lib/format.ts";
import { useDocumentTitle } from "../../../router/router.tsx";
import { QueryBoundary, useConfirm, useToast } from "../../../ui/overlays.tsx";
import {
	Badge,
	Banner,
	Button,
	Card,
	CardBody,
	CardHead,
	Field,
	IconButton,
	TextArea,
	TextInput,
} from "../../../ui/primitives.tsx";
import { DataTable, Pagination, readMeta, type Column } from "../../../ui/Table.tsx";
import {
	AdminPageHead,
	FormModal,
	IdCell,
	inv,
	ListToolbar,
	pageParams,
	RowActions,
	TextCell,
	useFilteredPage,
	useInvalidate,
	useTableState,
} from "./shared.tsx";

const searchFields = (row: Weapons) => [
	row.name,
	row.category,
	row.description,
	row.file_url,
	row.id,
];

function WeaponForm({
	weapon,
	pending,
	onClose,
	onSubmit,
}: {
	weapon: Weapons | null;
	pending: boolean;
	onClose: () => void;
	onSubmit: (draft: { name: string; category: string; description: string }) => void;
}) {
	const [name, setName] = useState(weapon?.name ?? "");
	const [category, setCategory] = useState(weapon?.category ?? "");
	const [description, setDescription] = useState(weapon?.description ?? "");
	const [error, setError] = useState<string | null>(null);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!name.trim()) {
			setError("武器名称不能为空。");
			return;
		}
		if (!category.trim()) {
			setError("分类不能为空（例如 pwn / web / misc）。");
			return;
		}
		setError(null);
		onSubmit({ name: name.trim(), category: category.trim(), description });
	};

	return (
		<form className="xz-col" onSubmit={submit}>
			<div className="xz-formgrid">
				<Field label="名称" required>
					{(props) => (
						<TextInput
							{...props}
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					)}
				</Field>
				<Field label="分类" required hint="选手端按分类分组展示">
					{(props) => (
						<TextInput
							{...props}
							value={category}
							placeholder="pwn / web / misc …"
							onChange={(event) => setCategory(event.target.value)}
						/>
					)}
				</Field>
			</div>
			<Field label="说明">
				{(props) => (
					<TextArea
						{...props}
						rows={5}
						value={description}
						onChange={(event) => setDescription(event.target.value)}
					/>
				)}
			</Field>
			{error ? (
				<div className="xz-field__error" role="alert">
					{error}
				</div>
			) : null}
			<div className="xz-adm-form-actions">
				<Button variant="quiet" onClick={onClose} disabled={pending}>
					取消
				</Button>
				<Button variant="primary" type="submit" loading={pending} icon="save">
					{weapon ? "保存修改" : "创建武器"}
				</Button>
			</div>
		</form>
	);
}

function WeaponUploadForm({
	weapon,
	pending,
	onClose,
	onSubmit,
}: {
	weapon: Weapons;
	pending: boolean;
	onClose: () => void;
	onSubmit: (file: File) => void;
}) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [error, setError] = useState<string | null>(null);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		const file = inputRef.current?.files?.[0];
		if (!file) {
			setError("请先选择要上传的文件。");
			return;
		}
		setError(null);
		onSubmit(file);
	};

	return (
		<form className="xz-col" onSubmit={submit}>
			<Banner tone="warn" title="上传会覆盖该武器已有的文件">
				上传成功后后端把 <code className="xz-mono">has_file</code> 置为 true、
				<code className="xz-mono">file_url</code> 写为对象存储 key；同一武器重复上传会替换旧文件。
			</Banner>
			<Field
				label="武器文件"
				required
				hint={
					weapon.has_file
						? `当前文件：${weapon.file_url || "（无 key）"}`
						: "该武器还没有文件"
				}
			>
				{(props) => (
					<input
						{...props}
						ref={inputRef}
						className="xz-adm-file"
						type="file"
						aria-label="武器文件"
					/>
				)}
			</Field>
			{error ? (
				<div className="xz-field__error" role="alert">
					{error}
				</div>
			) : null}
			<div className="xz-adm-form-actions">
				<Button variant="quiet" onClick={onClose} disabled={pending}>
					取消
				</Button>
				<Button variant="primary" type="submit" loading={pending} icon="upload">
					上传文件
				</Button>
			</div>
		</form>
	);
}

export function AdminWeaponsPage() {
	useDocumentTitle("武器库管理");
	const client = useClient();
	const toast = useToast();
	const confirm = useConfirm();
	const invalidate = useInvalidate();
	const state = useTableState(20);

	const params = useMemo(
		() => pageParams(state.page, state.pageSize),
		[state.page, state.pageSize],
	);

	const query = useQuery({
		queryKey: qk.admin.weapons(params),
		queryFn: () => callList(client.admin.weapons.fetch(params)),
		placeholderData: keepPreviousData,
	});

	const meta = readMeta(query.data?.meta, state.pageSize);
	const page = useFilteredPage(query.data?.items ?? [], state.search, searchFields);

	const [form, setForm] = useState<{ key: string; weapon: Weapons | null } | null>(null);
	const [uploadTarget, setUploadTarget] = useState<Weapons | null>(null);

	const createMutation = useMutation({
		mutationFn: (draft: { name: string; category: string; description: string }) =>
			call(
				client.admin.weapons.create({
					...draft,
					// 创建接口的请求体要求这三个字段存在；文件随后由 upload 写入。
					has_file: false,
					file_url: "",
					download_count: 0,
				}),
				"创建武器结果",
			),
		onSuccess: (weapon) => {
			toast.success("武器已创建", `${weapon.name}（可继续上传文件）`);
			setForm(null);
			invalidate([inv.weapons, inv.dashboard]);
		},
		onError: (error) => toast.error("创建武器失败", errorText(error)),
	});

	const patchMutation = useMutation({
		mutationFn: ({ id, draft }: { id: string; draft: { name: string; category: string; description: string } }) =>
			call(client.admin.weapons.patch({ id, ...draft }), "修改武器结果"),
		onSuccess: (weapon) => {
			toast.success("武器已更新", weapon.name);
			setForm(null);
			invalidate([inv.weapons]);
		},
		onError: (error) => toast.error("更新武器失败", errorText(error)),
	});

	const uploadMutation = useMutation({
		mutationFn: ({ weaponId, file }: { weaponId: string; file: File }) =>
			// 位置参数 (weapon_id, File)。
			call(client.admin.weapons.upload(weaponId, file), "上传武器文件结果"),
		onSuccess: (_result, variables) => {
			toast.success("文件已上传", variables.file.name);
			setUploadTarget(null);
			invalidate([inv.weapons]);
		},
		onError: (error) => toast.error("上传文件失败", errorText(error)),
	});

	const removeMutation = useMutation({
		mutationFn: (id: string) => call(client.admin.weapons.remove([id]), "删除武器结果"),
		onSuccess: (_count, id) => {
			toast.success("武器已删除", `ID ${id}`);
			invalidate([inv.weapons, inv.dashboard]);
		},
		onError: (error) => toast.error("删除武器失败", errorText(error)),
	});

	const askRemove = async (row: Weapons) => {
		const ok = await confirm({
			title: `删除武器「${row.name}」？`,
			description: <>分类 {row.category} · 下载次数 {formatNumber(row.download_count)}</>,
			consequences: (
				<>
					该条目将从武器库永久删除，选手端不再能看到或下载
					{row.has_file ? "，其已上传的文件也一并不可用" : ""}；此操作不可恢复。
				</>
			),
			tone: "danger",
			confirmText: "删除武器",
		});
		if (ok) removeMutation.mutate(row.id);
	};

	const columns: readonly Column<Weapons>[] = [
		{ key: "name", header: "名称", render: (row) => <strong>{row.name}</strong> },
		{ key: "category", header: "分类", render: (row) => <Badge tone="crimson">{row.category}</Badge> },
		{
			key: "description",
			header: "说明",
			render: (row) => <TextCell value={row.description} max={64} />,
		},
		{
			key: "has_file",
			header: "文件",
			render: (row) =>
				row.has_file ? (
					<Badge tone="ok" icon="check">
						已上传
					</Badge>
				) : (
					<Badge tone="warn" icon="warn">
						未上传
					</Badge>
				),
		},
		{
			key: "file_url",
			header: "存储 key",
			render: (row) => <TextCell value={row.file_url} max={36} />,
		},
		{
			key: "download_count",
			header: "下载次数",
			numeric: true,
			render: (row) => formatNumber(row.download_count),
		},
		{ key: "updated_at", header: "更新时间", render: (row) => formatDateTime(row.updated_at) },
		{ key: "id", header: "ID", render: (row) => <IdCell id={row.id} /> },
		{
			key: "actions",
			header: "操作",
			align: "right",
			width: 150,
			render: (row) => (
				<RowActions>
					<IconButton
						icon="edit"
						label={`编辑 ${row.name}`}
						onClick={() => setForm({ key: `edit-${row.id}`, weapon: row })}
					/>
					<IconButton
						icon="upload"
						label={`上传文件到 ${row.name}`}
						onClick={() => setUploadTarget(row)}
					/>
					<IconButton
						icon="trash"
						label={`删除 ${row.name}`}
						onClick={() => void askRemove(row)}
					/>
				</RowActions>
			),
		},
	];

	return (
		<div className="xz-page xz-page--wide">
			<AdminPageHead
				title="武器库管理"
				desc="选手端「武器库」的工具与脚本条目"
				actions={
					<Button
						variant="primary"
						icon="plus"
						onClick={() => setForm({ key: "create", weapon: null })}
					>
						新建武器
					</Button>
				}
			/>

			<Card>
				<CardHead icon="sword" title="武器列表" sub={`共 ${meta.total} 个条目`} />
				<CardBody flush>
					<div style={{ padding: "var(--xz-sp-4) var(--xz-sp-5) 0" }}>
						<ListToolbar
							search={state.search}
							onSearch={state.setSearch}
							placeholder="搜索名称 / 分类 / 说明 / 存储 key"
							hint={
								state.search
									? `本页匹配 ${page.matched} / ${page.loaded} 条（本地过滤）`
									: "搜索在已加载的当前页内过滤"
							}
							actions={
								<Button
									size="sm"
									icon="refresh"
									loading={query.isFetching}
									onClick={() => void query.refetch()}
								>
									刷新
								</Button>
							}
						/>
					</div>
					<QueryBoundary
						isPending={query.isPending}
						isError={query.isError}
						error={query.error}
						refetch={query.refetch}
						loadingLabel="正在加载武器库…"
					>
						<DataTable
							columns={columns}
							rows={page.rows}
							rowKey={(row) => row.id}
							empty={state.search ? "当前页没有匹配的武器。" : "武器库还没有条目。"}
						/>
						<div style={{ padding: "0 var(--xz-sp-5) var(--xz-sp-4)" }}>
							<Pagination
								page={meta.page}
								pageSize={meta.pageSize}
								total={meta.total}
								onPageChange={state.setPage}
								onPageSizeChange={state.setPageSize}
							/>
						</div>
					</QueryBoundary>
				</CardBody>
			</Card>

			<FormModal
				open={form !== null}
				title={form?.weapon ? "编辑武器" : "新建武器"}
				description="新建后请用行内「上传」按钮附上文件。"
				onClose={() => setForm(null)}
			>
				{form ? (
					<WeaponForm
						key={form.key}
						weapon={form.weapon}
						pending={createMutation.isPending || patchMutation.isPending}
						onClose={() => setForm(null)}
						onSubmit={(draft) => {
							if (form.weapon) patchMutation.mutate({ id: form.weapon.id, draft });
							else createMutation.mutate(draft);
						}}
					/>
				) : null}
			</FormModal>

			<FormModal
				open={uploadTarget !== null}
				title={`上传文件 · ${uploadTarget?.name ?? ""}`}
				onClose={() => setUploadTarget(null)}
			>
				{uploadTarget ? (
					<WeaponUploadForm
						weapon={uploadTarget}
						pending={uploadMutation.isPending}
						onClose={() => setUploadTarget(null)}
						onSubmit={(file) => uploadMutation.mutate({ weaponId: uploadTarget.id, file })}
					/>
				) : null}
			</FormModal>
		</div>
	);
}
