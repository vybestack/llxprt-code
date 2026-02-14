/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
  CommandKind,
} from './types.js';
import { PromptService } from '@vybestack/llxprt-code-core';

/**
 * Get the init command prompt from the prompt service
 */
async function getInitCommandPrompt(): Promise<string> {
  try {
    const baseDir =
      process.env.LLXPRT_PROMPTS_DIR ||
      path.join(os.homedir(), '.llxprt', 'prompts');
    const promptService = new PromptService({
      baseDir,
      debugMode: process.env.DEBUG === 'true',
    });
    await promptService.initialize();

    try {
      return await promptService.loadPrompt('commands/init-command.md');
    } catch (error) {
      console.warn(
        'Failed to load init command prompt from file, using fallback:',
        error,
      );
    }
  } catch (error) {
    console.warn('Failed to initialize prompt service, using fallback:', error);
  }

  // Fallback to hardcoded prompt
  return getFallbackInitCommandPrompt();
}

/**
 * Fallback prompt if the prompt service is not available
 */
function getFallbackInitCommandPrompt(): string {
  return `You are an AI agent that brings the power of multiple LLM providers directly into the terminal. Your task is to analyze the current directory and generate a comprehensive LLXPRT.md file to be used as instructional context for future interactions.

**Analysis Process:**

1.  **Initial Exploration:**
    *   Start by listing the files and directories to get a high-level overview of the structure.
    *   Read the README file (e.g., \`README.md\`, \`README.txt\`) if it exists. This is often the best place to start.

2.  **Iterative Deep Dive (up to 10 files):**
    *   Based on your initial findings, select a few files that seem most important (e.g., configuration files, main source files, documentation).
    *   Read them. As you learn more, refine your understanding and decide which files to read next. You don't need to decide all 10 files at once. Let your discoveries guide your exploration.

3.  **Identify Project Type:**
    *   **Code Project:** Look for clues like \`package.json\`, \`requirements.txt\`, \`pom.xml\`, \`go.mod\`, \`Cargo.toml\`, \`build.gradle\`, or a \`src\` directory. If you find them, this is likely a software project.
    *   **Non-Code Project:** If you don't find code-related files, this might be a directory for documentation, research papers, notes, or something else.

**LLXPRT.md Content Generation:**

**For a Code Project:**

*   **Project Overview:** Write a clear and concise summary of the project's purpose, main technologies, and architecture.
*   **Building and Running:** Document the key commands for building, running, and testing the project. Infer these from the files you've read (e.g., \`scripts\` in \`package.json\`, \`Makefile\`, etc.). If you can't find explicit commands, provide a placeholder with a TODO.
*   **Development Conventions:** Describe any coding styles, testing practices, or contribution guidelines you can infer from the codebase.

**For a Non-Code Project:**

*   **Directory Overview:** Describe the purpose and contents of the directory. What is it for? What kind of information does it hold?
*   **Key Files:** List the most important files and briefly explain what they contain.
*   **Usage:** Explain how the contents of this directory are intended to be used.

**Final Output:**

Write the complete content to the \`LLXPRT.md\` file. The output must be well-formatted Markdown.`;
}

export const initCommand: SlashCommand = {
  name: 'init',
  description: 'Analyzes the project and creates a tailored LLXPRT.md file.',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (
    context: CommandContext,
    _args: string,
  ): Promise<SlashCommandActionReturn> => {
    if (!context.services.config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Configuration not available.',
      };
    }
    const targetDir = context.services.config.getTargetDir();
    const llxprtMdPath = path.join(targetDir, 'LLXPRT.md');

    if (fs.existsSync(llxprtMdPath)) {
      return {
        type: 'message',
        messageType: 'info',
        content:
          'A LLXPRT.md file already exists in this directory. No changes were made.',
      };
    }

    // Create an empty LLXPRT.md file
    fs.writeFileSync(llxprtMdPath, '', 'utf8');

    context.ui.addItem(
      {
        type: 'info',
        text: 'Empty LLXPRT.md created. Now analyzing the project to populate it.',
      },
      Date.now(),
    );

    const initPrompt = await getInitCommandPrompt();

    return {
      type: 'submit_prompt',
      content: initPrompt,
    };
  },
};
