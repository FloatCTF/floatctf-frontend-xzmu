/**
 * 管理控制台 · Docker 运维（`/admin/docker`）。
 *
 * 侧栏只挂了一个入口，因此容器 / 镜像 / 网络是**同一个路由下的三个视图**，
 * 用 `<Segmented>` 切换（不拆成三个路由）。
 *
 * 三个视图的破坏性操作（启停 / 删除）都走各自的 `useConfirm()`，
 * 见 `DockerContainers.tsx` / `DockerImages.tsx` / `DockerNetworks.tsx`。
 */

import { useState } from "react";

import { useDocumentTitle } from "../../../router/router.tsx";
import { Segmented } from "../../../ui/primitives.tsx";
import { DockerContainersView } from "./DockerContainers.tsx";
import { DockerImagesView } from "./DockerImages.tsx";
import { DockerNetworksView } from "./DockerNetworks.tsx";

type DockerView = "containers" | "images" | "networks";

export function AdminDockerPage() {
	useDocumentTitle("容器运维");
	const [view, setView] = useState<DockerView>("containers");

	return (
		<div className="xz-page xz-page--wide">
			<header className="xz-page__head">
				<div>
					<h1 className="xz-page__title">容器运维</h1>
					<p className="xz-page__desc">
						直接操作宿主 Docker：容器的启动 / 停止 / 删除，镜像删除，网络创建 / 删除。
						这些操作会影响正在运行的靶场环境，每一项都会先弹出确认框并写明真实后果，
						删除容器与网络还需要逐字输入对象名或 ID 前缀。
					</p>
				</div>
			</header>

			<div className="xz-inf-switch">
				<Segmented
					ariaLabel="Docker 资源视图"
					value={view}
					onChange={setView}
					options={[
						{ value: "containers", label: "容器" },
						{ value: "images", label: "镜像" },
						{ value: "networks", label: "网络" },
					]}
				/>
				<span className="xz-inf-switch__hint">
					数据直接来自宿主 Docker，不做任何本地缓存或伪造
				</span>
			</div>

			{view === "containers" ? <DockerContainersView /> : null}
			{view === "images" ? <DockerImagesView /> : null}
			{view === "networks" ? <DockerNetworksView /> : null}
		</div>
	);
}
