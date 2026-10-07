import { createRoot } from "react-dom/client";
import type { FloatCTFMountContext } from "@floatctf/frontend-runtime";

import { createRuntime } from "../api/client.ts";
import { App } from "./App.tsx";

/**
 * 把 React 应用挂到 `context.root`，并返回清理函数。
 *
 * 每个 mount 周期创建**独立的**运行时（客户端 + QueryClient + React 绑定），
 * 卸载时销毁 React 树并清空缓存，避免切换前端后残留上一个实例的状态。
 */
export function mountApp(context: FloatCTFMountContext): () => void {
	const runtime = createRuntime(context);
	const root = createRoot(context.root);
	root.render(<App runtime={runtime} />);

	return () => {
		root.unmount();
		runtime.queryClient.clear();
	};
}
