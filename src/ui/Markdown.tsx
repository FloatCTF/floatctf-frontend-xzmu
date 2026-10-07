/**
 * Markdown 渲染与编辑。
 *
 * - 渲染：`react-markdown` + `remark-gfm`。**不启用 `rehype-raw`**，因此原始 HTML
 *   不会被执行（平台内容由选手 / 管理员产生，按不可信内容处理）。
 * - 编辑：自研 textarea + 预览切换 + 图片上传（走 `client.service.uploads.upload_image`，
 *   这是平台的公共上传接口）。
 */

import { useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useClient } from "../api/client.ts";
import { errorText } from "../api/errors.ts";
import { useToast } from "../ui/overlays.tsx";
import { Button, Segmented, TextArea } from "../ui/primitives.tsx";

export function MarkdownView({ children, className }: { children: string; className?: string }) {
	return (
		<div className={["xz-md", className].filter(Boolean).join(" ")}>
			<Markdown
				remarkPlugins={[remarkGfm]}
				components={{
					// 外链一律新窗口 + noopener，避免被页面内容劫持 opener。
					a: ({ href, children: linkChildren }) => {
						const external = Boolean(href && /^https?:\/\//i.test(href));
						return (
							<a
								href={href}
								target={external ? "_blank" : undefined}
								rel={external ? "noopener noreferrer" : undefined}
							>
								{linkChildren}
							</a>
						);
					},
				}}
			>
				{children}
			</Markdown>
		</div>
	);
}

export function MarkdownEditor({
	value,
	onChange,
	placeholder,
	minHeight = 220,
	onUploaded,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	minHeight?: number;
	/** 图片上传成功后回调（返回可插入的 URL）。 */
	onUploaded?: (url: string) => void;
}) {
	const client = useClient();
	const toast = useToast();
	const [mode, setMode] = useState<"write" | "preview">("write");
	const [uploading, setUploading] = useState(false);
	const fileRef = useRef<HTMLInputElement | null>(null);

	const upload = async (file: File) => {
		setUploading(true);
		try {
			const response = await client.service.uploads.upload_image(file);
			const url = response.data;
			if (!url) throw new Error("上传接口未返回图片地址");
			if (onUploaded) onUploaded(url);
			else onChange(`${value}\n\n![${file.name}](${url})\n`);
			toast.success("图片已上传");
		} catch (error) {
			toast.error("图片上传失败", errorText(error));
		} finally {
			setUploading(false);
		}
	};

	return (
		<div className="xz-col" style={{ gap: 8 }}>
			<div className="xz-row-between">
				<Segmented
					ariaLabel="编辑模式"
					value={mode}
					onChange={setMode}
					options={[
						{ value: "write", label: "编写" },
						{ value: "preview", label: "预览" },
					]}
				/>
				<Button size="sm" icon="upload" loading={uploading} onClick={() => fileRef.current?.click()}>
					插入图片
				</Button>
			</div>
			<input
				ref={fileRef}
				type="file"
				accept="image/*"
				className="xz-sr"
				onChange={(event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (file) void upload(file);
				}}
			/>
			{mode === "write" ? (
				<TextArea
					value={value}
					placeholder={placeholder ?? "支持 Markdown（表格 / 代码块 / 图片链接）"}
					style={{ minHeight }}
					onChange={(event) => onChange(event.target.value)}
				/>
			) : (
				<div className="xz-card xz-card--flat">
					<div className="xz-card__body">
						{value.trim() ? <MarkdownView>{value}</MarkdownView> : <p className="xz-muted">还没有内容。</p>}
					</div>
				</div>
			)}
		</div>
	);
}
