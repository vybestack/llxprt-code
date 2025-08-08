/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
  CommandKind,
} from './types.js';

/**
 * Get the prompt for the /init command.
 */
function getAgentMdPrompt(): string {
  return `You are an AI agent designed to create a universal configuration file for AI-powered coding tools, as specified by the AGENT.md standard (RFC 9999). Your task is to analyze the current directory and generate a comprehensive AGENT.md file. This file will serve as the "universal voice" for the codebase, providing a single, consistent interface for various AI agents to interact with this project.

**Analysis Process:**

1.  **Initial Exploration:**
    *   Start by listing the files and directories to get a high-level overview of the structure.
    *   Read the README file (e.g., \`README.md\`, \`README.txt\`) if it exists. This is often the best place to start.

2.  **Iterative Deep Dive:**
    *   Based on your initial findings, select and read the most important files (e.g., configuration files like \`package.json\`, main source files, documentation) to understand the project.

3.  **Identify Project Type:**
    *   Determine if this is a software project (e.g., contains \`package.json\`, \`requirements.txt\`, \`pom.xml\`, \`src\` directory) or a different kind of project (e.g., documentation, research).

**AGENT.md Content Generation:**

Generate a complete \`AGENT.md\` file in the root of the project. The file MUST use Markdown formatting. It should contain the following sections, providing structured and comprehensive information about the project:

*   **Project Overview:** A clear and concise summary of the project's purpose, main technologies, and architecture.
*   **Project Structure and Organization:** Defines the overall layout of the codebase, module dependencies, and key directories.
*   **Build, Test, and Development Commands:** Specifies commands for compiling, running tests, and executing development workflows (e.g., from \`package.json\` scripts, \`Makefile\`, etc.).
*   **Code Style and Conventions:** Outlines coding standards, formatting rules, and stylistic preferences (e.g., ESLint rules, Prettier, PEP 8).
*   **Architecture and Design Patterns:** Describes the architectural approach, key components, and design principles (e.g., Microservices, MVC, Observer pattern).
*   **Testing Guidelines:** Provides instructions for testing frameworks, conventions, and execution (e.g., Jest setup, unit test structure).
*   **Security Considerations:** Highlights security best practices, known vulnerabilities to watch for, and data protection guidelines.
*   **Git Workflow:** Describe the branching strategy, commit message conventions, and pull request process.

**Final Output:**

Write the complete content to the \`AGENT.md\` file. The output must be well-formatted Markdown and serve as a comprehensive guide for both human developers and AI agents.`;
}

export const initCommand: SlashCommand = {
  name: 'init',
  description:
    'Analyzes the project and creates a tailored AGENT.md file based on the AGENT.md standard.',
  kind: CommandKind.BUILT_IN,
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
    const agentMdPath = path.join(targetDir, 'AGENT.md');

    if (fs.existsSync(agentMdPath)) {
      return {
        type: 'message',
        messageType: 'info',
        content:
          'An AGENT.md file already exists in this directory. No changes were made.',
      };
    }

    // Create an empty AGENT.md file
    fs.writeFileSync(agentMdPath, '', 'utf8');

    context.ui.addItem(
      {
        type: 'info',
        text: 'Empty AGENT.md created. Now analyzing the project to populate it.',
      },
      Date.now(),
    );

    const initPrompt = getAgentMdPrompt();

    return {
      type: 'submit_prompt',
      content: initPrompt,
    };
  },
};
