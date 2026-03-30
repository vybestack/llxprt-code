/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CoderAgentEvent, type AgentSettings } from '../types.js';
import type {
  Command,
  CommandContext,
  CommandExecutionResponse,
} from './types.js';
import type { CoderAgentExecutor } from '../agent/executor.js';
import type {
  ExecutionEventBus,
  RequestContext,
  AgentExecutionEvent,
} from '@a2a-js/sdk/server';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

type CommandActionReturn =
  | { type: 'message'; messageType: 'info' | 'error'; content: string }
  | { type: 'submit_prompt'; content: string };

export class InitCommand implements Command {
  name = 'init';
  description = 'Analyzes the project and creates a tailored LLXPRT.md file';
  requiresWorkspace = true;
  streaming = true;

  private performInitLogic(llxprtMdExists: boolean): CommandActionReturn {
    if (llxprtMdExists) {
      return {
        type: 'message',
        messageType: 'info',
        content:
          'A LLXPRT.md file already exists in this directory. No changes were made.',
      };
    }

    return {
      type: 'submit_prompt',
      content: `
You are an AI agent that brings the power of LLxprt directly into the terminal. Your task is to analyze the current directory and generate a comprehensive LLXPRT.md file to be used as instructional context for future interactions.

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

Write the complete content to the \`LLXPRT.md\` file. The output must be well-formatted Markdown.
`,
    };
  }

  private handleMessageResult(
    result: { content: string; messageType: 'info' | 'error' },
    context: CommandContext,
    eventBus: ExecutionEventBus,
    taskId: string,
    contextId: string,
  ): CommandExecutionResponse {
    const statusState = result.messageType === 'error' ? 'failed' : 'completed';
    const eventType =
      result.messageType === 'error'
        ? CoderAgentEvent.StateChangeEvent
        : CoderAgentEvent.TextContentEvent;

    const event: AgentExecutionEvent = {
      kind: 'status-update',
      status: {
        state: statusState,
        message: {
          kind: 'message',
          role: 'agent',
          parts: [{ kind: 'text', text: result.content }],
          messageId: uuidv4(),
          taskId,
          contextId,
        },
        timestamp: new Date().toISOString(),
      },
      final: true,
      metadata: {
        coderAgent: { kind: eventType },
        model: context.config.getModel(),
      },
      taskId,
      contextId,
    };

    logger.info('[EventBus event]: ', event);
    eventBus.publish(event);
    return {
      name: this.name,
      data: result,
    };
  }

  private async handleSubmitPromptResult(
    result: { content: unknown },
    context: CommandContext,
    llxprtMdPath: string,
    eventBus: ExecutionEventBus,
    taskId: string,
    contextId: string,
  ): Promise<CommandExecutionResponse> {
    fs.writeFileSync(llxprtMdPath, '', 'utf8');

    if (context.agentExecutor == null) {
      throw new Error('Agent executor not found in context.');
    }
    const agentExecutor = context.agentExecutor as CoderAgentExecutor;

    const workspacePath = process.env['CODER_AGENT_WORKSPACE_PATH'];
    if (!workspacePath) {
      throw new Error(
        'CODER_AGENT_WORKSPACE_PATH environment variable is required',
      );
    }

    const agentSettings: AgentSettings = {
      kind: CoderAgentEvent.StateAgentSettingsEvent,
      autoExecute: true,
      workspacePath,
    };

    if (typeof result.content !== 'string') {
      throw new Error('Init command content must be a string.');
    }
    const promptText = result.content;

    const requestContext: RequestContext = {
      userMessage: {
        kind: 'message',
        role: 'user',
        parts: [{ kind: 'text', text: promptText }],
        messageId: uuidv4(),
        metadata: {
          coderAgent: agentSettings,
        },
        taskId,
        contextId,
      },
      taskId,
      contextId,
    };

    await agentExecutor.execute(requestContext, eventBus);
    return {
      name: this.name,
      data: llxprtMdPath,
    };
  }

  async execute(
    context: CommandContext,
    _args: string[] = [],
  ): Promise<CommandExecutionResponse> {
    if (context.eventBus == null) {
      return {
        name: this.name,
        data: 'Use executeStream to get streaming results.',
      };
    }

    const llxprtMdPath = path.join(
      process.env['CODER_AGENT_WORKSPACE_PATH']!,
      'LLXPRT.md',
    );
    const result = this.performInitLogic(fs.existsSync(llxprtMdPath));

    const taskId = uuidv4();
    const contextId = uuidv4();

    switch (result.type) {
      case 'message':
        return this.handleMessageResult(
          result,
          context,
          context.eventBus,
          taskId,
          contextId,
        );
      case 'submit_prompt':
        return this.handleSubmitPromptResult(
          result,
          context,
          llxprtMdPath,
          context.eventBus,
          taskId,
          contextId,
        );
      default:
        throw new Error('Unknown result type from performInitLogic');
    }
  }
}
