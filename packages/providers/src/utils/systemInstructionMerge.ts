/**
 * Merges a caller-supplied system instruction (e.g. subagent persona/task
 * prompt) into the core system prompt built from getCoreSystemPromptAsync.
 *
 * The instruction is appended after the core prompt, separated by a blank
 * line, so the model sees both the base behavior directives and the
 * agent-specific task. Returns:
 *  - the trimmed core prompt when the instruction is absent or empty;
 *  - the instruction alone when the core prompt is empty;
 *  - both joined by a blank line when both are present.
 *
 * Issue #2410: Without this merge, subagent task directives set on
 * options.systemInstruction never reach the model for several providers.
 */
export function mergeSystemInstruction(
  corePrompt: string | undefined,
  systemInstruction: string | undefined,
): string {
  const coreText = typeof corePrompt === 'string' ? corePrompt.trim() : '';
  const instructionText =
    typeof systemInstruction === 'string' ? systemInstruction.trim() : '';

  if (instructionText.length === 0) {
    return coreText;
  }
  if (coreText.length === 0) {
    return instructionText;
  }
  return `${coreText}\n\n${instructionText}`;
}
