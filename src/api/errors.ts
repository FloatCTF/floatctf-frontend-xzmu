/**
 * 错误归一化 —— 所有界面文案都来自**后端真实响应**（AI-FRONTEND-GUIDE §13 硬规则：
 * 错误提示必须来自真实后端消息，不能自造）。
 *
 * 只依赖 `FloatCTFError` 的公开字段，不假设 Axios 内部结构。
 */

import { FloatCTFError } from "@floatctf/sdk";

export interface ErrorView {
	/** 面向用户的一句话标题。 */
	title: string;
	/** 可读的详情（优先使用平台文案）。 */
	message: string;
	/** 是否值得提供「重试」。 */
	retryable: boolean;
	/** 是否为鉴权失效（上层据此引导重新登录）。 */
	unauthorized: boolean;
	/** 是否为网络层失败（断网 / 超时 / CORS）。 */
	offline: boolean;
	/** 诊断用的原始信息，只在开发样式下展示。 */
	detail?: string;
}

function codeLabel(code: number | undefined): string | null {
	if (code === undefined || code === 0) return null;
	return `平台业务码 ${code}`;
}

/** 把任意抛错转成可直接渲染的错误视图。 */
export function toErrorView(error: unknown): ErrorView {
	if (error instanceof FloatCTFError) {
		const { kind, httpStatus, code, unauthorized, displayMessage, platformMessage } = error;

		// 平台业务失败（HTTP 200 + code !== 0）走这里：它不是网络问题，文案用平台原文。
		if (kind === "platform") {
			return {
				title: "操作未成功",
				message: platformMessage || displayMessage || "平台拒绝了该请求。",
				retryable: false,
				unauthorized: false,
				offline: false,
				detail: codeLabel(code) ?? undefined,
			};
		}

		if (kind === "network" || httpStatus === undefined) {
			return {
				title: "网络请求失败",
				message: "无法连接到服务器。请检查网络连接，或稍后重试。",
				retryable: true,
				unauthorized: false,
				offline: true,
				detail: displayMessage,
			};
		}

		if (unauthorized || httpStatus === 401) {
			return {
				title: "登录状态已失效",
				message: platformMessage || "登录凭证已过期，请重新登录。",
				retryable: false,
				unauthorized: true,
				offline: false,
				detail: codeLabel(code) ?? undefined,
			};
		}

		if (httpStatus === 403) {
			return {
				title: "没有权限",
				message: platformMessage || "当前账号无权执行该操作。",
				retryable: false,
				unauthorized: false,
				offline: false,
				detail: codeLabel(code) ?? undefined,
			};
		}

		if (httpStatus === 404) {
			return {
				title: "未找到",
				message: platformMessage || "请求的资源不存在或已被删除。",
				retryable: false,
				unauthorized: false,
				offline: false,
				detail: codeLabel(code) ?? undefined,
			};
		}

		// 没有平台文案时的兜底：**不把 Axios 的英文原文当用户文案**，
		// 英文/技术细节只进 `detail`（诊断用）；平台文案存在时永远优先。
		const fallback =
			httpStatus >= 500
				? `服务器暂时不可用（HTTP ${httpStatus}），请稍后重试。`
				: httpStatus === 429
					? "请求过于频繁，请稍后重试。"
					: `请求未被接受（HTTP ${httpStatus}），请检查输入后重试。`;

		return {
			title: httpStatus >= 500 ? "服务器错误" : "请求未被接受",
			message: platformMessage || fallback,
			retryable: httpStatus >= 500 || httpStatus === 429,
			unauthorized: false,
			offline: false,
			detail: [codeLabel(code), displayMessage && displayMessage !== platformMessage ? displayMessage : null]
				.filter(Boolean)
				.join(" · ") || undefined,
		};
	}

	if (error instanceof Error) {
		return {
			title: "发生未知错误",
			message: error.message || "操作未能完成。",
			retryable: true,
			unauthorized: false,
			offline: false,
			detail: error.stack?.split("\n")[0],
		};
	}

	return {
		title: "发生未知错误",
		message: String(error ?? "操作未能完成。"),
		retryable: true,
		unauthorized: false,
		offline: false,
	};
}

/** 需要给用户看的最短文案（toast / 行内错误都用它）。 */
export function errorText(error: unknown): string {
	const view = toErrorView(error);
	return view.message || view.title;
}
