/**
 * 顶层错误边界 —— 平台硬规则：**错误必须可见，禁止白屏**
 * （AI-FRONTEND-GUIDE §13、AGENTS.md 铁律 10）。
 *
 * 没有边界的后果是实测过的：任何一个渲染期异常都会让 React 卸载整棵树，
 * 用户看到的是一张**完全空白的页面**，连导航都没有，无法自救。
 *
 * 这里把异常限制在**内容区**内：外壳（左栏 / 顶栏）继续可用，用户可以切到别的页面，
 * 也可以就地重试。技术细节折叠展示，便于反馈，但不作为主文案。
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button, ErrorState } from "../ui/primitives.tsx";

interface Props {
	children: ReactNode;
	/** 路由变化时用于重置错误状态（同一个 key 变化会重新挂载边界内部）。 */
	resetKey?: string;
}

interface State {
	error: Error | null;
	info: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
	state: State = { error: null, info: null };

	static getDerivedStateFromError(error: Error): Partial<State> {
		return { error };
	}

	componentDidUpdate(previous: Props): void {
		// 切换路由后自动恢复，避免用户在整站范围内被一次错误卡死。
		if (previous.resetKey !== this.props.resetKey && this.state.error) {
			this.setState({ error: null, info: null });
		}
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		// 保留可复制的诊断信息；不上报到任何外部服务。
		this.setState({ info: info.componentStack?.split("\n").slice(0, 6).join("\n") ?? null });
		console.error("[xzmu] 页面渲染异常", error, info.componentStack);
	}

	render(): ReactNode {
		const { error, info } = this.state;
		if (!error) return this.props.children;

		return (
			<div className="xz-page">
				<ErrorState
					title="这个页面出错了"
					message="页面在渲染时遇到异常，已被安全拦截。左侧导航仍可正常使用，你也可以重试或返回总览"
					detail={error.message}
				/>
				<div className="xz-row" style={{ justifyContent: "center", marginTop: -8, gap: 8 }}>
					<Button variant="primary" icon="refresh" onClick={() => this.setState({ error: null, info: null })}>
						重试
					</Button>
					<Button icon="home" onClick={() => window.location.assign("/")}>
						回到总览
					</Button>
					<Button icon="rotate" onClick={() => window.location.reload()}>
						重新加载
					</Button>
				</div>
				{info ? (
					<details style={{ marginTop: 16 }}>
						<summary className="xz-muted xz-xs" style={{ cursor: "pointer" }}>
							技术细节（反馈问题时请附上）
						</summary>
						<pre className="xz-codeblock" style={{ marginTop: 8 }}>
							{`${error.name}: ${error.message}\n${info}`}
						</pre>
					</details>
				) : null}
			</div>
		);
	}
}
