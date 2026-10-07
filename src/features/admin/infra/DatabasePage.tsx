/**
 * 管理控制台 · SQL 控制台（`/admin/database`）。
 *
 * ## 这是高权限逃生工具
 * 语句**直接作用于生产数据库**：没有事务包装、没有 dry-run、没有回滚。
 * 因此执行前一律 `useConfirm()`；脚本中出现 DROP / TRUNCATE / DELETE / UPDATE / ALTER
 * 时还必须逐字输入 `EXECUTE`。
 *
 * ## 后端真实契约（`apps/api/src/modules/platform/operations/database.rs`）
 * - `POST /api/admin/database/exec_sql`（SDK：`client.admin.database.exec_sql({ sql })`）；
 * - **只接受单条语句**：去掉结尾分号后正文里再出现 `;` 会被直接拒绝
 *   （`Multi-statement SQL is not allowed`）。所以本页面在前端把脚本**逐条切分**后顺序提交，
 *   这也就是能力表里「多语句执行」的真实实现方式；
 * - **非只读语句必须带后端要求的 `ADMIN_CONFIRMED` 注释前缀**，否则后端拒绝。
 *   本页面在管理员完成确认之后自动补上该前缀（不确认就不会有请求发出）；
 * - 单条语句上限 10,000 字符、执行超时 5 秒；
 * - 需要 TOML `[features].unsafe_sql_admin = true`，否则返回「功能已禁用」的明确提示
 *   （本页面原样展示该提示，不吞错）。
 *
 * ## 切分的诚实说明
 * 切分器是一个词法状态机（行注释 / 块注释 / 单引号 / 双引号 / dollar-quoted 都能正确跳过），
 * 但它不做语法分析：依赖动态拼接 SQL 文本、或非标准写法的脚本可能被切错。
 * 遇到这类脚本请逐条粘贴执行。
 */

import type { SqlResult } from "@floatctf/sdk";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { call } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { useDocumentTitle } from "../../../router/router.tsx";
import { Icon } from "../../../ui/icons.tsx";
import { useConfirm, useToast } from "../../../ui/overlays.tsx";
import { Badge, Banner, Button, Card, CardBody, CardHead, TextArea } from "../../../ui/primitives.tsx";
import { type Column, DataTable } from "../../../ui/Table.tsx";

/** 后端认可为只读的前导关键字（与 Rust handler 的 `is_read_only` 一一对应）。 */
const READ_ONLY_KEYWORDS = new Set(["select", "show", "describe", "explain", "with"]);

/** 高风险语句：需要逐字输入 `EXECUTE`。 */
const HIGH_RISK_KEYWORDS = ["drop", "truncate", "delete", "update", "alter"] as const;

/** 结果表格最多渲染的行数（后端可能返回大量行）。 */
const ROW_LIMIT = 200;

/**
 * 去掉注释、并把字符串 / 标识符字面量的**内容**替换为空格。
 * 用于判断语句类型与扫描高风险关键字，避免把 `WHERE action = 'DELETE'` 误判为删除。
 */
function normalizeSql(sql: string): string {
	let output = "";
	let index = 0;
	while (index < sql.length) {
		const char = sql[index];
		const next = sql[index + 1];

		if (char === "-" && next === "-") {
			const end = sql.indexOf("\n", index);
			index = end === -1 ? sql.length : end + 1;
			output += " ";
			continue;
		}

		if (char === "/" && next === "*") {
			let depth = 1;
			let cursor = index + 2;
			while (cursor < sql.length && depth > 0) {
				if (sql[cursor] === "/" && sql[cursor + 1] === "*") {
					depth += 1;
					cursor += 2;
					continue;
				}
				if (sql[cursor] === "*" && sql[cursor + 1] === "/") {
					depth -= 1;
					cursor += 2;
					continue;
				}
				cursor += 1;
			}
			index = cursor;
			output += " ";
			continue;
		}

		if (char === "'" || char === '"') {
			const quote = char;
			let cursor = index + 1;
			while (cursor < sql.length) {
				if (sql[cursor] === quote && sql[cursor + 1] === quote) {
					cursor += 2;
					continue;
				}
				if (sql[cursor] === quote) {
					cursor += 1;
					break;
				}
				cursor += 1;
			}
			index = cursor;
			output += "''";
			continue;
		}

		if (char === "$") {
			const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index));
			if (tag) {
				const end = sql.indexOf(tag[0], index + tag[0].length);
				index = end === -1 ? sql.length : end + tag[0].length;
				output += "''";
				continue;
			}
		}

		output += char;
		index += 1;
	}
	return output;
}

/** 按 PostgreSQL 词法切分脚本，并过滤掉「只有注释」的片段。 */
/** 导出仅为可验证性：切分是「多语句执行」的核心逻辑，独立可测。 */
export function splitStatements(script: string): string[] {
	const statements: string[] = [];
	let current = "";
	let index = 0;

	const flush = () => {
		const text = current.trim();
		current = "";
		if (text && normalizeSql(text).trim().length > 0) statements.push(text);
	};

	while (index < script.length) {
		const char = script[index];
		const next = script[index + 1];

		if (char === "-" && next === "-") {
			const end = script.indexOf("\n", index);
			const stop = end === -1 ? script.length : end + 1;
			current += script.slice(index, stop);
			index = stop;
			continue;
		}

		if (char === "/" && next === "*") {
			let depth = 1;
			let cursor = index + 2;
			while (cursor < script.length && depth > 0) {
				if (script[cursor] === "/" && script[cursor + 1] === "*") {
					depth += 1;
					cursor += 2;
					continue;
				}
				if (script[cursor] === "*" && script[cursor + 1] === "/") {
					depth -= 1;
					cursor += 2;
					continue;
				}
				cursor += 1;
			}
			current += script.slice(index, cursor);
			index = cursor;
			continue;
		}

		if (char === "'" || char === '"') {
			const quote = char;
			let cursor = index + 1;
			while (cursor < script.length) {
				if (script[cursor] === quote && script[cursor + 1] === quote) {
					cursor += 2;
					continue;
				}
				if (script[cursor] === quote) {
					cursor += 1;
					break;
				}
				cursor += 1;
			}
			current += script.slice(index, cursor);
			index = cursor;
			continue;
		}

		if (char === "$") {
			const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(script.slice(index));
			if (tag) {
				const end = script.indexOf(tag[0], index + tag[0].length);
				const stop = end === -1 ? script.length : end + tag[0].length;
				current += script.slice(index, stop);
				index = stop;
				continue;
			}
		}

		if (char === ";") {
			flush();
			index += 1;
			continue;
		}

		current += char;
		index += 1;
	}

	flush();
	return statements;
}

export interface PlannedStatement {
	/** 原始语句文本（不含确认前缀）。 */
	sql: string;
	/** 前导关键字（大写），用于标注语句类型。 */
	keyword: string;
	readOnly: boolean;
	highRisk: boolean;
	/** 提交给后端时是否补后端的 ADMIN_CONFIRMED 注释前缀。 */
	needsPrefix: boolean;
}

export function planStatements(script: string): PlannedStatement[] {
	return splitStatements(script).map((sql) => {
		const normalized = normalizeSql(sql).toUpperCase();
		const match = /^[A-Za-z_]+/.exec(normalized.trim());
		const keyword = match ? match[0] : "(无法识别)";
		const highRisk = HIGH_RISK_KEYWORDS.some((word) =>
			new RegExp(`\\b${word.toUpperCase()}\\b`).test(normalized),
		);
		const readOnly = READ_ONLY_KEYWORDS.has(keyword.toLowerCase());
		return { sql, keyword, readOnly, highRisk, needsPrefix: !readOnly || highRisk };
	});
}

interface StatementOutcome {
	index: number;
	sql: string;
	highRisk: boolean;
	result?: SqlResult;
	error?: string;
}

function SqlCell({ value }: { value: unknown }) {
	if (value === null || value === undefined) {
		return (
			<span className="xz-inf-cell" data-null="true">
				NULL
			</span>
		);
	}
	if (typeof value === "object") {
		return <span className="xz-inf-cell">{JSON.stringify(value)}</span>;
	}
	return <span className="xz-inf-cell">{String(value)}</span>;
}

function ResultTable({ rows }: { rows: Record<string, unknown>[] }) {
	const columns = useMemo<readonly Column<Record<string, unknown>>[]>(() => {
		const keys = new Set<string>();
		for (const row of rows.slice(0, ROW_LIMIT)) {
			for (const key of Object.keys(row)) keys.add(key);
		}
		return [...keys].map((key) => ({
			key,
			header: key,
			render: (row) => <SqlCell value={row[key]} />,
		}));
	}, [rows]);

	return (
		<DataTable
			columns={columns}
			rows={rows.slice(0, ROW_LIMIT)}
			rowKey={(_row, index) => `row-${index}`}
			compact
			empty={<div className="xz-state xz-state--sm">该语句没有返回任何行。</div>}
		/>
	);
}

function StatementResult({ outcome }: { outcome: StatementOutcome }) {
	return (
		<div className="xz-inf-stmt" data-tone={outcome.error ? "error" : outcome.highRisk ? "danger" : "ok"}>
			<div className="xz-inf-stmt__head">
				<Badge tone={outcome.error ? "danger" : "neutral"}>第 {outcome.index + 1} 条</Badge>
				{outcome.highRisk ? <Badge tone="danger" icon="warn">高风险</Badge> : null}
				{outcome.result ? <Badge tone="info">{outcome.result.sql_type}</Badge> : null}
			</div>
			<pre className="xz-inf-stmt__sql">{outcome.sql}</pre>

			{outcome.error ? (
				<div className="xz-inf-result">
					<Banner tone="danger" title="该语句未成功">
						{outcome.error}
					</Banner>
				</div>
			) : null}

			{outcome.result ? (
				<div className="xz-inf-result">
					<div className="xz-inf-result__meta">
						<Badge tone="ok" icon="check">
							执行成功
						</Badge>
						<span>
							返回行数 <strong>{outcome.result.count}</strong>
						</span>
						<span>
							影响行数 <strong>{outcome.result.rows_affected}</strong>
						</span>
						<span>
							耗时 <strong>{outcome.result.elapsed_ms}</strong> ms
						</span>
						<span className="xz-muted">列：{Object.keys(outcome.result.rows[0] ?? {}).length || "—"}</span>
					</div>
					{outcome.result.rows.length > 0 ? (
						<ResultTable rows={outcome.result.rows} />
					) : (
						<p className="xz-muted xz-xs" style={{ margin: 0 }}>
							该语句不返回结果集（写语句只报告影响行数）。
						</p>
					)}
					{outcome.result.rows.length > ROW_LIMIT ? (
						<p className="xz-muted xz-xs" style={{ marginTop: 6 }}>
							结果共 {outcome.result.rows.length} 行，界面只渲染前 {ROW_LIMIT} 行。
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}

const SNIPPETS: readonly { label: string; sql: string }[] = [
	{ label: "当前连接", sql: "SELECT current_database() AS db, current_user AS role, version() AS server;" },
	{
		label: "public 表清单",
		sql: "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;",
	},
	{
		label: "某张表的列",
		sql: "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' ORDER BY ordinal_position;",
	},
	{
		label: "表大小 Top10",
		sql: "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;",
	},
];

export function AdminDatabasePage() {
	useDocumentTitle("SQL 控制台");
	const client = useClient();
	const toast = useToast();
	const confirm = useConfirm();

	const [script, setScript] = useState("");
	const [outcomes, setOutcomes] = useState<StatementOutcome[]>([]);
	const [stopped, setStopped] = useState(false);

	const planned = useMemo(() => planStatements(script), [script]);
	const highRiskCount = planned.filter((statement) => statement.highRisk).length;

	const run = useMutation({
		mutationFn: async (statements: PlannedStatement[]) => {
			const collected: StatementOutcome[] = [];
			for (let index = 0; index < statements.length; index += 1) {
				const statement = statements[index];
				if (!statement) continue;
				// 非只读语句必须带后端要求的 `/* ADMIN_CONFIRMED */` 前缀；
				// 能走到这里说明管理员已经在确认框里明确确认过（高风险还要输入 EXECUTE）。
				const payload = statement.needsPrefix
					? `/* ADMIN_CONFIRMED */ ${statement.sql}`
					: statement.sql;
				try {
					const result = await call(client.admin.database.exec_sql({ sql: payload }), "执行结果");
					collected.push({
						index,
						sql: statement.sql,
						highRisk: statement.highRisk,
						result,
					});
				} catch (error) {
					collected.push({
						index,
						sql: statement.sql,
						highRisk: statement.highRisk,
						error: errorText(error),
					});
					// 顺序脚本在第一条失败处停下：不继续执行剩余语句，避免半途状态更难收拾。
					return { collected, stopped: true };
				}
			}
			return { collected, stopped: false };
		},
		onSuccess: (data, statements) => {
			setOutcomes(data.collected);
			setStopped(data.stopped);
			const failed = data.collected.find((entry) => entry.error);
			if (failed) {
				toast.error(`第 ${failed.index + 1} 条语句执行失败`, failed.error);
				return;
			}
			toast.success(
				`已执行 ${data.collected.length} 条语句`,
				data.collected.length < statements.length ? "剩余语句未执行" : undefined,
			);
		},
		onError: (error) => toast.error("SQL 执行请求失败", errorText(error)),
	});

	const onExecute = async () => {
		if (planned.length === 0) {
			toast.warn("没有可执行的语句", "请先输入 SQL；只包含注释的内容不会被执行。");
			return;
		}

		const risky = planned.filter((statement) => statement.highRisk);
		const ok = await confirm({
			title: `在生产数据库上执行 ${planned.length} 条语句`,
			description:
				"SQL 控制台是高权限逃生工具：语句直接作用于生产数据库，没有事务包装、没有回滚。",
			consequences: (
				<>
					<div>
						将按顺序逐条提交（后端只接受单语句）。任何一条失败都会立即停止，
						剩余语句不会提交，请自行承担「前半段已生效」的中间状态。
					</div>
					{risky.length > 0 ? (
						<div style={{ marginTop: 6 }}>
							其中 <strong>{risky.length}</strong> 条属于高风险语句（
							{HIGH_RISK_KEYWORDS.map((word) => word.toUpperCase()).join(" / ")}），
							需要输入 <code className="xz-code">EXECUTE</code> 才能提交。
						</div>
					) : null}
					<div style={{ marginTop: 6 }}>
						写语句会补上后端强制要求的 <code className="xz-code">/* ADMIN_CONFIRMED */</code> 前缀。
					</div>
				</>
			),
			confirmText: risky.length > 0 ? "确认执行" : "执行",
			confirmPhrase: risky.length > 0 ? "EXECUTE" : undefined,
			tone: "danger",
		});
		if (ok) run.mutate(planned);
	};

	return (
		<div className="xz-page xz-page--wide">
			<header className="xz-page__head">
				<div>
					<h1 className="xz-page__title">SQL 控制台</h1>
					<p className="xz-page__desc">
						直接在生产 PostgreSQL 上执行语句。没有事务包装与回滚，执行前会二次确认；
						含 DROP / TRUNCATE / DELETE / UPDATE / ALTER 的脚本还要求输入 EXECUTE。
					</p>
				</div>
			</header>

			<Banner tone="danger" title="语句直接作用于生产数据库">
				这里的每一条语句都会立即作用于平台正在使用的生产数据库。请先确认已在别处备份、
				并确认 WHERE 条件；本页面不提供回滚。后端限制：单条语句、10,000 字符、5 秒超时，
				并且需要 <code className="xz-code">[features].unsafe_sql_admin = true</code>；
				若功能被禁用，接口返回的提示会原样显示在结果区。
			</Banner>

			<div className="xz-inf-sql" style={{ marginTop: "var(--xz-sp-5)" }}>
				<Card>
					<CardHead
						title="语句"
						icon="database"
						sub={`${planned.length} 条${highRiskCount > 0 ? ` · ${highRiskCount} 条高风险` : ""}`}
					/>
					<CardBody>
						<TextArea
							className="xz-inf-sql__editor"
							value={script}
							spellCheck={false}
							placeholder={"SELECT * FROM users LIMIT 10;\n-- 多条语句用分号分隔，会按顺序逐条执行"}
							onChange={(event) => setScript(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
									event.preventDefault();
									void onExecute();
								}
							}}
						/>

						<div className="xz-inf-sql__snippets">
							{SNIPPETS.map((snippet) => (
								<Button
									key={snippet.label}
									size="sm"
									icon="plus"
									onClick={() =>
										setScript((current) => (current.trim() ? `${current.trimEnd()}\n${snippet.sql}` : snippet.sql))
									}
								>
									{snippet.label}
								</Button>
							))}
						</div>

						<div className="xz-danger-zone" style={{ marginTop: "var(--xz-sp-4)" }}>
							<div className="xz-danger-zone__title">
								<Icon name="warn" size={16} />
								危险操作区 · 直接写入生产数据库
							</div>
							<div className="xz-inf-sql__run">
								<Button
									variant="danger"
									icon="play"
									loading={run.isPending}
									disabled={planned.length === 0}
									onClick={() => void onExecute()}
								>
									执行 {planned.length > 0 ? `（${planned.length} 条）` : ""}
								</Button>
								<Button
									variant="quiet"
									disabled={run.isPending}
									onClick={() => {
										setScript("");
										setOutcomes([]);
										setStopped(false);
									}}
								>
									清空
								</Button>
								<span className="xz-muted xz-xs">Ctrl / ⌘ + Enter 也可以执行</span>
							</div>

							{planned.length > 0 ? (
								<div className="xz-inf-sql__plan">
									{planned.map((statement, index) => (
										<div
											key={`plan-${index}`}
											className="xz-inf-stmt"
											data-tone={statement.highRisk ? "danger" : "ok"}
										>
											<div className="xz-inf-stmt__head">
												<Badge tone="neutral">第 {index + 1} 条</Badge>
												<Badge tone="info">{statement.keyword}</Badge>
												{statement.readOnly && !statement.highRisk ? (
													<Badge tone="ok">只读</Badge>
												) : (
													<Badge tone="warn">写语句 · 需 ADMIN_CONFIRMED 前缀</Badge>
												)}
												{statement.highRisk ? (
													<Badge tone="danger" icon="warn">
														高风险
													</Badge>
												) : null}
											</div>
											<pre className="xz-inf-stmt__sql">{statement.sql}</pre>
										</div>
									))}
								</div>
							) : null}
						</div>
					</CardBody>
				</Card>

				<Card>
					<CardHead
						title="执行结果"
						icon="clipboard"
						sub={outcomes.length > 0 ? `${outcomes.length} 条已提交` : undefined}
						actions={
							outcomes.length > 0 ? (
								<Button size="sm" variant="quiet" onClick={() => setOutcomes([])}>
									清空结果
								</Button>
							) : undefined
						}
					/>
					<CardBody>
						{outcomes.length === 0 ? (
							<div className="xz-state">
								<span className="xz-state__icon">
									<Badge tone="neutral">SqlResult</Badge>
								</span>
								<div className="xz-state__title">还没有执行结果</div>
								<p className="xz-state__desc">
									执行后这里会逐条显示后端返回的 <code className="xz-code">SqlResult</code>：
									语句类型 <code className="xz-code">sql_type</code>、
									结果集 <code className="xz-code">rows</code> / <code className="xz-code">count</code>、
									影响行数 <code className="xz-code">rows_affected</code> 与
									耗时 <code className="xz-code">elapsed_ms</code>。
								</p>
							</div>
						) : (
							<>
								{stopped ? (
									<Banner tone="warn" title="执行已在失败的语句处停止">
										后续语句没有被提交，因此数据库可能处于「前半段已生效」的中间状态。
									</Banner>
								) : null}
								<div className="xz-inf-log" style={{ marginTop: stopped ? "var(--xz-sp-4)" : 0 }}>
									{outcomes.map((outcome) => (
										<StatementResult key={`${outcome.index}-${outcome.sql.slice(0, 24)}`} outcome={outcome} />
									))}
								</div>
							</>
						)}
					</CardBody>
				</Card>
			</div>
		</div>
	);
}
