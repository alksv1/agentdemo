import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
	getMessageText,
	getRetractedUserMessageIds,
	truncateConversationAt,
} from "./chat-history";

const messages: UIMessage[] = [
	{
		id: "user-1",
		role: "user",
		parts: [{ type: "text", text: "第一个问题" }],
	},
	{
		id: "assistant-1",
		role: "assistant",
		parts: [{ type: "text", text: "第一个回答" }],
	},
	{
		id: "user-2",
		role: "user",
		parts: [
			{ type: "text", text: "第二个问题" },
			{ type: "text", text: "补充信息" },
		],
	},
	{
		id: "assistant-2",
		role: "assistant",
		parts: [{ type: "text", text: "第二个回答" }],
	},
];

describe("chat history editing", () => {
	it("extracts editable text from all text parts", () => {
		expect(getMessageText(messages[2])).toBe("第二个问题\n补充信息");
	});

	it("removes the selected turn and every later message", () => {
		expect(truncateConversationAt(messages, "user-2")).toEqual(
			messages.slice(0, 2),
		);
	});

	it("keeps history unchanged when the message no longer exists", () => {
		expect(truncateConversationAt(messages, "missing")).toBe(messages);
	});

	it("collects every user turn whose workspace changes must be reverted", () => {
		expect(getRetractedUserMessageIds(messages, "user-1")).toEqual([
			"user-1",
			"user-2",
		]);
		expect(getRetractedUserMessageIds(messages, "user-2")).toEqual(["user-2"]);
		expect(getRetractedUserMessageIds(messages, "missing")).toEqual([]);
	});
});
