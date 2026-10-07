/**
 * 面板契约 —— 赛事驾驶舱（`/events/:id`）通过标签页组合各功能域的面板。
 *
 * 驾驶舱只负责：解析赛事、判定赛制与阶段、切换标签、承载实时状态条。
 * 每个面板自己负责取数、三态、权限与破坏性操作确认。
 */

export interface EventPanelProps {
	/** 赛事 ID（来自路由参数）。 */
	eventId: string;
	/**
	 * 驾驶舱已知的赛制（`jeopardy` / `awd` / `awdp` / 其它字符串）。
	 * 来自后端赛事配置，面板不得自行猜测。
	 */
	mode: string;
}
