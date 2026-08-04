import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownMessage } from "./markdown-message";

describe("MarkdownMessage", () => {
	it("renders common and GitHub-flavored Markdown", () => {
		const { container } = render(
			<MarkdownMessage
				markdown={[
					"## 本周计划",
					"",
					"- [x] 完成访谈",
					"- [ ] 整理结论",
					"",
					"| 项目 | 状态 |",
					"| --- | --- |",
					"| MVP | 进行中 |",
				].join("\n")}
			/>,
		);

		expect(
			screen.getByRole("heading", { name: "本周计划" }),
		).toBeInTheDocument();
		expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
		expect(container.querySelector("table")).toBeInTheDocument();
	});

	it("opens links safely and does not execute raw HTML", () => {
		const { container } = render(
			<MarkdownMessage
				markdown={
					"[查看资料](https://example.com)\n\n<script>window.bad = true</script>"
				}
			/>,
		);

		expect(screen.getByRole("link", { name: "查看资料" })).toHaveAttribute(
			"target",
			"_blank",
		);
		expect(screen.getByRole("link", { name: "查看资料" })).toHaveAttribute(
			"rel",
			"noopener noreferrer",
		);
		expect(container.querySelector("script")).not.toBeInTheDocument();
		expect(screen.getByText(/window\.bad = true/)).toBeInTheDocument();
	});
});
