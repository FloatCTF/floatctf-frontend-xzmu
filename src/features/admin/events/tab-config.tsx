/**
 * 赛事控制台 · `config` 标签 —— 赛事详情读写。
 *
 * `client.admin.events.get(id)` / `patch({ id, ... })`。
 * family / purpose / participant_mode 三者受后端 `events_mode_combination_check` 约束，
 * 下拉只提供合法组合；改动会同时影响选手端的报名通道与工作台。
 */

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EventFamily, EventPurpose, ParticipantMode, type Events } from "@floatctf/sdk/entity";

import { call } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { useToast } from "../../../ui/overlays.tsx";
import { Badge, Banner, Button, Card, CardBody, CardHead, Checkbox, Field, Select, TextInput } from "../../../ui/primitives.tsx";
import {
	ROOT,
	TextAreaField,
	TextField,
	fromLocalInput,
	modesFor,
	normalizeMode,
	purposesFor,
	toLocalInput,
} from "./shared.tsx";

interface ConfigForm {
	title: string;
	description: string;
	rules: string;
	flag_prefix: string;
	start_time: string;
	end_time: string;
	family: EventFamily;
	purpose: EventPurpose;
	participant_mode: ParticipantMode;
	allow_join: boolean;
	hidden: boolean;
}

function formFrom(event: Events): ConfigForm {
	return {
		title: event.title,
		description: event.description ?? "",
		rules: event.rules ?? "",
		flag_prefix: event.flag_prefix ?? "",
		start_time: toLocalInput(event.start_time),
		end_time: toLocalInput(event.end_time),
		family: event.family,
		purpose: event.purpose,
		participant_mode: event.participant_mode,
		allow_join: event.allow_join,
		hidden: event.hidden,
	};
}

export function ConfigTab({ event }: { event: Events }) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const [form, setForm] = useState<ConfigForm>(() => formFrom(event));
	const [touched, setTouched] = useState(false);
	/** 表单是基于哪个版本的赛事构建的（用于提示远端已变更）。 */
	const baseVersion = useRef(event.updated_at);

	const remoteChanged = event.updated_at !== baseVersion.current;

	const patch = (next: Partial<ConfigForm>) => setForm((current) => ({ ...current, ...next }));

	const save = useMutation({
		mutationFn: () =>
			call(
				client.admin.events.patch({
					id: event.id,
					title: form.title.trim(),
					description: form.description,
					rules: form.rules,
					flag_prefix: form.flag_prefix.trim() || undefined,
					start_time: fromLocalInput(form.start_time) ?? event.start_time,
					end_time: fromLocalInput(form.end_time) ?? undefined,
					family: form.family,
					purpose: form.purpose,
					participant_mode: form.participant_mode,
					allow_join: form.allow_join,
					hidden: form.hidden,
				}),
				"赛事更新",
			),
		onSuccess: (saved) => {
			baseVersion.current = saved.updated_at;
			setForm(formFrom(saved));
			toast.success("赛事配置已保存");
			void queryClient.invalidateQueries({ queryKey: qk.admin.event(event.id) });
			void queryClient.invalidateQueries({ queryKey: ROOT.adminEvents });
			void queryClient.invalidateQueries({ queryKey: ROOT.events });
		},
		onError: (error) => toast.error("保存赛事配置失败", errorText(error)),
	});

	const titleError = touched && form.title.trim().length === 0 ? "请填写赛事标题" : undefined;
	const startError = touched && !fromLocalInput(form.start_time) ? "请填写合法的开始时间" : undefined;
	const modeChanged =
		form.family !== event.family ||
		form.purpose !== event.purpose ||
		form.participant_mode !== event.participant_mode;

	return (
		<div className="xz-aev-col">
			{remoteChanged ? (
				<Banner
					tone="warn"
					title="该赛事在别处已被修改"
					actions={
						<Button
							size="sm"
							icon="refresh"
							onClick={() => {
								baseVersion.current = event.updated_at;
								setForm(formFrom(event));
							}}
						>
							放弃本地改动并载入最新
						</Button>
					}
				>
					当前表单基于较早的版本（updated_at 已变化）。继续保存会覆盖远端刚写入的字段。
				</Banner>
			) : null}

			{event.is_virtual ? (
				<Banner tone="info" title="平台自有赛事">
					`is_virtual` 赛事由平台自身维护（例如内置练习），一般不需要修改；改动可能影响平台内建流程。
				</Banner>
			) : null}

			<Card>
				<CardHead
					title="基础信息"
					icon="info"
					sub={
						<span className="xz-aev-badges">
							<Badge tone="crimson">{String(event.family)}</Badge>
							<Badge>{String(event.participant_mode)}</Badge>
							<Badge tone={String(event.purpose) === "practice" ? "info" : "gold"}>
								{String(event.purpose)}
							</Badge>
						</span>
					}
				/>
				<CardBody>
					<form
						className="xz-aev-col"
						onSubmit={(submitEvent) => {
							submitEvent.preventDefault();
							setTouched(true);
							if (form.title.trim().length === 0 || !fromLocalInput(form.start_time)) return;
							save.mutate();
						}}
					>
						<TextField
							label="赛事标题"
							required
							error={titleError}
							value={form.title}
							onChange={(value) => patch({ title: value })}
						/>
						<div className="xz-aev-grid2">
							<Field label="赛制（family）" required hint="决定进入哪个管理/选手工作台。">
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
							<Field label="用途（purpose）" required hint="只有 competition 允许选手报名。">
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
							<Field label="参赛方式（participant_mode）" required>
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
								hint="留空使用平台默认。"
								mono
								value={form.flag_prefix}
								onChange={(value) => patch({ flag_prefix: value })}
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
							<Field label="结束时间" hint="留空 = 长期开放（无结束时间）。">
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
						{modeChanged ? (
							<Banner tone="warn" title="赛制组合将被改变">
								保存后 family / purpose / participant_mode 会立即生效：选手端工作台、报名通道与
								AWD/AWDP 运维入口都会随之变化。
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
							rows={6}
							value={form.rules}
							onChange={(value) => patch({ rules: value })}
						/>
						<div className="xz-aev-inline--end xz-aev-inline">
							<Button type="submit" variant="primary" icon="save" loading={save.isPending}>
								保存配置
							</Button>
						</div>
					</form>
				</CardBody>
			</Card>

			<Card flat>
				<CardHead title="只读标识" icon="tag" />
				<CardBody>
					<div className="xz-aev-grid2">
						<TextField label="赛事 ID" value={event.id} onChange={() => undefined} disabled mono />
						<TextField label="system_key" value={event.system_key ?? "—"} onChange={() => undefined} disabled mono />
						<TextField
							label="is_virtual"
							value={event.is_virtual ? "true（平台自有赛事）" : "false"}
							onChange={() => undefined}
							disabled
						/>
						<TextField label="updated_at" value={event.updated_at} onChange={() => undefined} disabled mono />
					</div>
				</CardBody>
			</Card>
		</div>
	);
}
