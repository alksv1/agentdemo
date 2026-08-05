import type { Metadata } from "next";
import "./globals.css";

const themeBootstrapScript = `(()=>{try{const theme=localStorage.getItem("northstar-theme");if(theme==="light"||theme==="dark"){document.documentElement.dataset.theme=theme}}catch{}})();`;

export const metadata: Metadata = {
	title: "Northstar · AI 目标执行教练",
	description: "把模糊目标变成清晰、可执行、会持续进化的行动计划。",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="zh-CN" suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
			</head>
			<body>{children}</body>
		</html>
	);
}
