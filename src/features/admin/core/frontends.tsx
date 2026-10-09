/**
 * 已安装前端选择器（`/admin/frontends`）—— specialized 能力。
 *
 * 语义（CAPABILITY-BEHAVIOR-MAP「管理端：基础设施、系统与平台设置」）：
 * 注册表 `registry.json` 描述「装了什么」，平台设置 `FRONTEND_ACTIVE` 描述「用哪个」
 * —— 切换 = 把 `FRONTEND_ACTIVE` 的值 patch 成某个前端 ID。
 *
 * ## 逃生舱声明（AI-FRONTEND-GUIDE §5.4 / CAPABILITY-MATRIX 的 class B）
 *
 * 本页使用**两个文档化的低层逃生舱**，因为公共 SDK 没有对应的高层方法：
 *
 * 1. `fetch(DEFAULT_REGISTRY_URL)`（`@floatctf/frontend-runtime` 导出的同源静态地址）
 *    + `parseRegistry()`：注册表是 Caddy 以只读方式公开提供的静态文件，没有 REST 端点
 *    —— 没有 SDK 方法可替代，这是平台明确记录的 class B 逃生舱。
 * 2. `client.admin.settings.fetch()/patch()`：写入路径本身就是动态设置接口，
 *    这是**公共 SDK 方法**（不是逃生舱），只是没有专用外观方法。
 *
 * 读取失败（注册表不可用 / JSON 非法 / schema 不匹配）一律渲染为**可见错误**并可重试，
 * 不会白屏，也不会静默把注册表当成空列表。
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	DEFAULT_REGISTRY_URL,
	parseRegistry,
	type FloatCTFRegistry,
} from "@floatctf/frontend-runtime";
import type { SettingsDto } from "@floatctf/sdk";

import { call, callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { formatDateTime } from "../../../lib/format.ts";
import { useDocumentTitle } from "../../../router/router.tsx";
import { Icon } from "../../../ui/icons.tsx";
import { QueryBoundary, useConfirm, useToast } from "../../../ui/overlays.tsx";
import { Badge, Banner, Button, Card, CardBody, CardHead, EmptyState } from "../../../ui/primitives.tsx";
import { AdminPageHead, inv, ListToolbar, useInvalidate } from "./shared.tsx";

const FRONTEND_ACTIVE_KEY = "FRONTEND_ACTIVE";

/**
 * 注册表查询键 —— `src/api/keys.ts` 是全应用查询键的唯一归属，但它**不在本域的
 * 可写文件清单内**（任务书禁止修改），因此这里就地声明一个带域的常量。
 */
const REGISTRY_QUERY_KEY = ["admin", "frontends", "registry"] as const;

async function fetchRegistry(signal: AbortSignal): Promise<FloatCTFRegistry> {
	const url = DEFAULT_REGISTRY_URL;
	let response: Response;
	try {
		// 注册表是同源静态文件：不缓存（安装 / 切换后需要立刻看到新状态）。
		response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal });
	} catch (cause) {
		throw new Error(
			`无法读取前端注册表 ${url}：${cause instanceof Error ? cause.message : String(cause)}`,
		);
	}
	if (!response.ok) {
		throw new Error(`前端注册表不可用：HTTP ${response.status} ${response.statusText}（${url}）`);
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch (cause) {
		throw new Error(
			`前端注册表不是合法 JSON：${cause instanceof Error ? cause.message : String(cause)}`,
		);
	}
	const parsed = parseRegistry(payload);
	if (!parsed.ok) {
		throw new Error(`前端注册表校验失败：${parsed.errors.join("；")}`);
	}
	return parsed.registry;
}

export function AdminFrontendsPage() {
	useDocumentTitle("已安装前端");
	const client = useClient();
	const toast = useToast();
	const confirm = useConfirm();
	const invalidate = useInvalidate();

	const settings = useQuery({
		queryKey: qk.admin.settings,
		queryFn: () => callList(client.admin.settings.fetch()),
	});

	const registry = useQuery({
		queryKey: REGISTRY_QUERY_KEY,
		queryFn: ({ signal }) => fetchRegistry(signal),
	});

	const activeSetting: SettingsDto | undefined = useMemo(
		() => (settings.data?.items ?? []).find((row) => row.key === FRONTEND_ACTIVE_KEY),
		[settings.data],
	);

	// `value` 是数据库原值，`resolved_value` 是后端解析（含非法值回落 default）后的生效值。
	const activeId = activeSetting?.resolved_value || activeSetting?.value || "";

	const [switching, setSwitching] = useState<string | null>(null);

	const switchMutation = useMutation({
		mutationFn: ({ id, value }: { id: string; value: string }) =>
			call(client.admin.settings.patch({ id, value }), "切换前端结果"),
		onSuccess: (setting) => {
			toast.success(
				"已切换生效前端",
				`${FRONTEND_ACTIVE_KEY} = ${setting.resolved_value || setting.value}`,
			);
			setSwitching(null);
			invalidate([inv.settings]);
		},
		onError: (error) => {
			setSwitching(null);
			toast.error("切换前端失败", errorText(error));
		},
	});

	const askSwitch = async (frontendId: string) => {
		if (!activeSetting) {
			toast.warn("无法切换", `动态设置里没有 ${FRONTEND_ACTIVE_KEY}，请先在 /admin/settings 创建它。`);
			return;
		}
		const ok = await confirm({
			title: `切换到前端「${frontendId}」？`,
			description: (
				<>
					将把 <code className="xz-mono">{FRONTEND_ACTIVE_KEY}</code> 从{" "}
					<code className="xz-mono">{activeId || "（空）"}</code> 改为{" "}
					<code className="xz-mono">{frontendId}</code>
				</>
			),
			consequences: (
				<>
					这是影响所有用户的操作：所有浏览器下一次加载页面时会挂载新前端。当前已打开的页面不会自动
					切换（需要刷新）；如果新前端构建失败或入口不可用，平台 bootstrap 会回退到{" "}
					<code className="xz-mono">default</code> 前端，但仍应确认新前端已正确安装再切换。
					破窗参数为 <code className="xz-mono">?frontend=default</code>。
				</>
			),
			tone: "danger",
			confirmText: "切换前端",
		});
		if (!ok) return;
		setSwitching(frontendId);
		switchMutation.mutate({ id: activeSetting.id, value: frontendId });
	};

	const [search, setSearch] = useState("");
	const frontends = useMemo(() => {
		const entries = Object.values(registry.data?.frontends ?? {});
		const needle = search.trim().toLowerCase();
		const filtered = needle
			? entries.filter(
					(row) =>
						row.id.toLowerCase().includes(needle) ||
						Object.values(row.versions).some(
							(version) =>
								version.name.toLowerCase().includes(needle) ||
								version.version.toLowerCase().includes(needle),
						),
				)
			: entries;
		return filtered.sort((left, right) => left.id.localeCompare(right.id));
	}, [registry.data, search]);

	return (
		<div className="xz-page xz-page--wide">
			<AdminPageHead
				title="已安装前端"
				desc={
					<>
						平台的可插拔前端切换。注册表来自同源静态文件{" "}
						<code className="xz-mono">{DEFAULT_REGISTRY_URL}</code>，生效开关是动态设置{" "}
						<code className="xz-mono">{FRONTEND_ACTIVE_KEY}</code>。
					</>
				}
				actions={
					<Button
						size="sm"
						icon="refresh"
						loading={registry.isFetching || settings.isFetching}
						onClick={() => {
							void registry.refetch();
							void settings.refetch();
						}}
					>
						刷新
					</Button>
				}
			/>

			<QueryBoundary
				isPending={settings.isPending}
				isError={settings.isError}
				error={settings.error}
				refetch={settings.refetch}
				loadingLabel="正在读取当前生效前端…"
			>
				<Card className="xz-adm-section">
					<CardHead icon="settings" title="当前生效" sub="来自动态设置" />
					<CardBody>
						{activeSetting ? (
							<div className="xz-row" style={{ gap: "var(--xz-sp-4)", flexWrap: "wrap" }}>
								<Badge tone="crimson" icon="layers">
									生效前端 {activeId || "（空）"}
								</Badge>
								<span className="xz-adm-hint">
									数据库原值 <code className="xz-mono">{activeSetting.value || "（空）"}</code>
									{activeSetting.value !== activeSetting.resolved_value ? "（与生效值不同，说明原值非法或含模板，后端已回落）" : ""}
								</span>
								<span className="xz-adm-hint">更新于 {formatDateTime(activeSetting.updated_at)}</span>
							</div>
						) : (
							<Banner tone="warn" title={`动态设置里没有 ${FRONTEND_ACTIVE_KEY}`}>
								平台通常会在启动时自动补种该键。当前无法切换前端（没有可 patch 的目标行），
								请先到动态设置页创建它，键名必须精确为{" "}
								<code className="xz-mono">{FRONTEND_ACTIVE_KEY}</code>。
							</Banner>
						)}
					</CardBody>
				</Card>
			</QueryBoundary>

			<Card>
				<CardHead
					icon="layers"
					title="已安装前端"
					sub={
						registry.data
							? `注册表 schema v${registry.data.schemaVersion} · 更新于 ${formatDateTime(registry.data.updatedAt)}`
							: "读取注册表"
					}
				/>
				<CardBody>
					<div style={{ marginBottom: "var(--xz-sp-4)" }}>
						<ListToolbar
							search={search}
							onSearch={setSearch}
							placeholder="搜索前端 ID / 名称 / 版本"
							hint="对注册表条目做本地过滤"
						/>
					</div>
					<QueryBoundary
						isPending={registry.isPending}
						isError={registry.isError}
						error={registry.error}
						refetch={registry.refetch}
						loadingLabel="正在读取前端注册表…"
					>
						{frontends.length === 0 ? (
							<EmptyState
								icon="layers"
								title={search ? "没有匹配的前端" : "注册表里没有已安装前端"}
								desc={
									search
										? "换一个关键词，或清空搜索框查看全部条目。"
										: "用 frontend.sh install 安装前端后，注册表会出现对应条目。"
								}
							/>
						) : (
							<div>
								{frontends.map((frontend) => {
									const current = frontend.versions[frontend.currentVersion];
									const isActive = frontend.id === activeId;
									return (
										<div
											className="xz-adm-frontend"
											key={frontend.id}
											data-active={isActive}
										>
											<div className="xz-grow">
												<div className="xz-adm-frontend__name">
													<span className="xz-mono">{frontend.id}</span>
													{isActive ? <Badge tone="crimson" icon="check">生效中</Badge> : null}
													{frontend.protected ? (
														<Badge tone="warn" icon="lock">
															受保护
														</Badge>
													) : null}
												</div>
												<div className="xz-adm-frontend__meta">
													<span>
														当前版本 <strong>{frontend.currentVersion}</strong>
														{current ? ` · ${current.name || frontend.id}` : ""}
													</span>
													{current ? (
														<span>
															入口 <code className="xz-mono">{current.entry}</code> · 样式{" "}
															{current.styles.length} 个 · 安装于{" "}
															{formatDateTime(current.installedAt)}
														</span>
													) : (
														<span className="xz-adm-hint">
															注册表里缺少 currentVersion 对应的版本条目
														</span>
													)}
												</div>
												<div className="xz-adm-frontend__versions">
													{Object.keys(frontend.versions)
														.sort()
														.map((version) => (
															<Badge
																key={version}
																tone={version === frontend.currentVersion ? "gold" : "neutral"}
															>
																v{version}
															</Badge>
														))}
												</div>
											</div>
											<div className="xz-col" style={{ alignItems: "flex-end", gap: 6 }}>
												<Button
													size="sm"
													variant={isActive ? "quiet" : "primary"}
													disabled={isActive || !activeSetting}
													loading={switching === frontend.id}
													onClick={() => void askSwitch(frontend.id)}
												>
													{isActive ? "当前生效" : "切换到此前端"}
												</Button>
												<span className="xz-adm-hint xz-nowrap">切换后需刷新页面</span>
											</div>
										</div>
									);
								})}
							</div>
						)}
					</QueryBoundary>

					{settings.isError || registry.isError ? (
						<div style={{ marginTop: "var(--xz-sp-4)" }}>
							<Banner tone="danger" title="前端信息读取失败">
								上方错误块给出了具体原因（注册表地址 / HTTP 状态 / schema 校验错误）。注册表不可用时
								不会显示任何条目，也不会把未知状态当作「空注册表」处理。
							</Banner>
						</div>
					) : null}
				</CardBody>
			</Card>

			<p className="xz-adm-note" style={{ marginTop: "var(--xz-sp-4)" }}>
				<Icon name="info" size={13} /> 本页通过同源{" "}
				<code className="xz-mono">fetch(DEFAULT_REGISTRY_URL)</code> +{" "}
				<code className="xz-mono">parseRegistry</code> 读取注册表（CAPABILITY-MATRIX 记录的 class B
				逃生舱：注册表没有 REST 端点，公共 SDK 无替代方法）；切换写入使用公共 SDK 的{" "}
				<code className="xz-mono">client.admin.settings.patch</code>。
			</p>
		</div>
	);
}
