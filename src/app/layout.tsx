import type { Metadata } from "next";
import "./globals.css";

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
		<html lang="zh-CN">
			<body>{children}</body>
		</html>
	);
}
