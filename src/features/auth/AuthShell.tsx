/**
 * 认证页外壳 —— 视觉母题取自 CAS 统一身份认证页：
 * 深红渐变底 + 半透明毛玻璃卡片 + 校徽水印。
 */

import type { ReactNode } from "react";

import logo from "../../assets/xzmu-logo.png";

export function AuthShell({ children }: { children: ReactNode }) {
	return (
		<div className="xz-root">
			<div className="xz-auth">
				<img className="xz-auth__watermark" src={logo} alt="" aria-hidden="true" />
				<img
					className="xz-auth__watermark xz-auth__watermark--left"
					src={logo}
					alt=""
					aria-hidden="true"
				/>
				<div className="xz-auth__card">
					<div className="xz-auth__brand">
						<img src={logo} alt="西藏民族大学" />
					</div>
					{children}
					<p className="xz-auth__note">
						本平台用于西藏民族大学网络安全教学与竞赛训练。请使用学校统一账号登录；如遇账号问题请联系网络信息技术中心。
					</p>
				</div>
			</div>
		</div>
	);
}
