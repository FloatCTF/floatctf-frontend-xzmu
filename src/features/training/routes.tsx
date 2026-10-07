/**
 * 路由 —— 训练域（AWDP Training Ground）。
 *
 * `/training`        练习目录（GameBox catalog + 开始训练）
 * `/training/:runId` 练习 Run 工作台
 *
 * 静态路径排在参数路径之前（本文件的声明顺序即优先级）。
 * 样式在本文件引入，保证 `registry.ts` 一旦加载该域，样式即随包生效。
 */

import "./styles.css";

export { trainingPages } from "./pages.tsx";
