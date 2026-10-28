/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Agent } from '@vybestack/llxprt-code-agents';

export async function generateAutoPrompt(
  description: string,
  generateText: Agent['generate'],
): Promise<string> {
  const autoModePrompt = `Generate a detailed system prompt for a subagent with the following purpose:\n\n${description}\n\nRequirements:\n- Create a comprehensive system prompt that defines the subagent's role, capabilities, and behavior\n- Be specific and actionable\n- Use clear, professional language\n- Output ONLY the system prompt text, no explanations or metadata`;

  const text = await generateText(autoModePrompt, {
    config: {
      toolConfig: {
        functionCallingConfig: {
          mode: 'NONE',
        },
      },
    },
    promptId: 'subagent-auto-prompt',
    readHistory: false,
    writeHistory: false,
  });
  if (text.trim() === '') {
    throw new Error(
      'Model returned empty response. Try manual mode or rephrase your description.',
    );
  }
  return text;
}
