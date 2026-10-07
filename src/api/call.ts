/**
 * 调用工具 —— 把 SDK 的 `UniResponse<T>` 信封变成「要么拿到数据、要么抛错」。
 *
 * 背景（SDK-API-REFERENCE §5 陷阱 3）：平台业务失败是 **HTTP 200 + `code !== 0`**，
 * 传输层不会自动 reject。本前端的处理方式是**集中**的：
 *
 * 1. `installEnvelopeGuard()` 在两个 transport 的 axios 实例上挂响应拦截器，
 *    把非成功 `code` 的响应转成 `FloatCTFError`（使用 SDK 公开的
 *    `floatCTFErrorFromEnvelope`，这是文档化的低层公共接口，见 AI-FRONTEND-GUIDE §5.4）；
 * 2. 页面里仍然统一用 `call()` 取值，读不到 `.data` 时给出明确错误，而不是静默 `undefined`。
 *
 * 任何一条路径都不会出现「请求失败但界面显示成功」。
 */

import {
	type FloatCTFClient,
	floatCTFErrorFromEnvelope,
	FloatCTFError,
	type UniResponse,
} from "@floatctf/sdk";

/**
 * 安装信封守卫。必须在任何请求发出前调用（`createRuntime` 里紧接客户端创建之后）。
 * 用 `client.transport.{service,admin}.instance`（文档化的逃生舱），
 * 而不是臆造 SDK 方法。
 */
export function installEnvelopeGuard(client: FloatCTFClient): void {
	for (const instance of [client.transport.service, client.transport.admin]) {
		instance.interceptors.response.use((response) => {
			const platformError = floatCTFErrorFromEnvelope(response.data);
			if (platformError) return Promise.reject(platformError);
			return response;
		});
	}
}

/** 取出 `UniResponse.data`；缺失时抛出带上下文的错误（而不是返回 `undefined`）。 */
export function unwrap<T>(response: UniResponse<T>, what = "数据"): T {
	const platformError = floatCTFErrorFromEnvelope(response);
	if (platformError) throw platformError;
	if (response.data === undefined || response.data === null) {
		throw new FloatCTFError({
			message: `接口未返回${what}`,
			kind: "platform",
			code: response.code,
			platformMessage: response.message || `接口未返回${what}`,
		});
	}
	return response.data;
}

/** 与 `unwrap` 相同，但允许 `null`（例如「我的实例」查询在无实例时返回 null）。 */
export function unwrapNullable<T>(response: UniResponse<T | null>): T | null {
	const platformError = floatCTFErrorFromEnvelope(response);
	if (platformError) throw platformError;
	if (response.data === undefined || response.data === null) return null;
	return response.data;
}

/** 直接 await 一个领域方法并取出数据。 */
export async function call<T>(
	promise: Promise<UniResponse<T>>,
	what = "数据",
): Promise<T> {
	return unwrap(await promise, what);
}

/** 列表类接口：同时拿到数据与分页 `meta`。 */
export async function callList<T>(
	promise: Promise<UniResponse<T[]>>,
): Promise<{ items: T[]; meta: UniResponse<T[]>["meta"] }> {
	const response = await promise;
	const platformError = floatCTFErrorFromEnvelope(response);
	if (platformError) throw platformError;
	return { items: response.data ?? [], meta: response.meta };
}
