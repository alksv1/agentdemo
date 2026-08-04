const DEFAULT_MAX_HEIGHT = 160;

export function resizeTextarea(
	textarea: HTMLTextAreaElement | null,
	maxHeight = DEFAULT_MAX_HEIGHT,
): void {
	if (!textarea) return;

	textarea.style.height = "auto";
	const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
	textarea.style.height = `${nextHeight}px`;
	textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}
