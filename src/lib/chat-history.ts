import type { UIMessage } from "ai";

export function getMessageText(message: UIMessage): string {
	return message.parts
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

export function truncateConversationAt(
	messages: UIMessage[],
	messageId: string,
): UIMessage[] {
	const messageIndex = messages.findIndex((message) => message.id === messageId);
	return messageIndex >= 0 ? messages.slice(0, messageIndex) : messages;
}

export function getRetractedUserMessageIds(
	messages: UIMessage[],
	messageId: string,
): string[] {
	const messageIndex = messages.findIndex((message) => message.id === messageId);
	if (messageIndex < 0) return [];
	return messages
		.slice(messageIndex)
		.filter((message) => message.role === "user")
		.map((message) => message.id);
}
