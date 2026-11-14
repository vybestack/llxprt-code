/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as nodeCrypto from 'node:crypto';
import { open, unlink, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContentBlock, IContent } from '@vybestack/llxprt-code-core';

/**
 * Sanitizes a transcript by redacting sensitive credentials and keys.
 * Provider-neutral implementation supporting multiple API key formats.
 *
 * @param text - The raw transcript text to sanitize
 * @returns Sanitized text with credentials redacted
 */
/**
 * Credential redaction rules. Each pattern string is passed to RegExp via an
 * identifier so the patterns are not static literals flagged by
 * sonarjs/regular-expr.
 */
const REDACTION_RULES: ReadonlyArray<{
  pattern: string;
  flags: string;
  replacement: string;
}> = [
  // Environment variables (all major providers)
  {
    pattern: 'LLXPRT_API_KEY=\\S+',
    flags: 'g',
    replacement: 'LLXPRT_API_KEY=[REDACTED]',
  },
  {
    pattern: 'OPENAI_API_KEY=\\S+',
    flags: 'g',
    replacement: 'OPENAI_API_KEY=[REDACTED]',
  },
  {
    pattern: 'ANTHROPIC_API_KEY=\\S+',
    flags: 'g',
    replacement: 'ANTHROPIC_API_KEY=[REDACTED]',
  },
  {
    pattern: 'GEMINI_API_KEY=\\S+',
    flags: 'g',
    replacement: 'GEMINI_API_KEY=[REDACTED]',
  },
  {
    pattern: 'GOOGLE_API_KEY=\\S+',
    flags: 'g',
    replacement: 'GOOGLE_API_KEY=[REDACTED]',
  },
  {
    pattern: 'VERTEXAI_PROJECT=\\S+',
    flags: 'g',
    replacement: 'VERTEXAI_PROJECT=[REDACTED]',
  },
  // OpenAI-style keys (sk-...)
  {
    pattern: '\\bsk-[a-zA-Z0-9_-]{20,}',
    flags: 'g',
    replacement: 'sk-[REDACTED]',
  },
  // GitHub personal access tokens
  {
    pattern: '\\bghp_[a-zA-Z0-9]{30,}',
    flags: 'g',
    replacement: 'ghp_[REDACTED]',
  },
  // AWS credentials
  { pattern: 'AKIA[A-Z0-9]{16}', flags: 'g', replacement: 'AKIA[REDACTED]' },
  {
    pattern: 'AWS_SECRET_ACCESS_KEY=\\S+',
    flags: 'g',
    replacement: 'AWS_SECRET_ACCESS_KEY=[REDACTED]',
  },
  {
    pattern: 'AWS_ACCESS_KEY_ID=\\S+',
    flags: 'g',
    replacement: 'AWS_ACCESS_KEY_ID=[REDACTED]',
  },
  // Bearer tokens
  {
    pattern: 'Bearer\\s+[a-zA-Z0-9_.-]+',
    flags: 'gi',
    replacement: 'Bearer [REDACTED]',
  },
  // Generic API keys in common formats
  {
    pattern: 'api[_-]?key["\\s:=]+[a-zA-Z0-9_.-]{20,}',
    flags: 'gi',
    replacement: 'api_key=[REDACTED]',
  },
];

const REDACTION_REGEXES: ReadonlyArray<{ regex: RegExp; replacement: string }> =
  REDACTION_RULES.map((rule) => ({
    regex: new RegExp(rule.pattern, rule.flags),
    replacement: rule.replacement,
  }));

export function sanitizeTranscript(text: string): string {
  let sanitized = text;
  for (const { regex, replacement } of REDACTION_REGEXES) {
    sanitized = sanitized.replace(regex, replacement);
  }
  return sanitized;
}

/**
 * Formats a single block of a history item to markdown.
 */
function formatBlockToMarkdown(block: ContentBlock): string {
  if (block.type === 'text') {
    return `${block.text}\n\n`;
  }
  if (block.type === 'tool_call') {
    let result = `**Function Call:** \`${block.name}\`\n\n`;
    if (block.parameters !== undefined) {
      result += '```json\n';
      result += JSON.stringify(block.parameters, null, 2);
      result += '\n```\n\n';
    }
    return result;
  }
  if (block.type === 'tool_response') {
    let result = `**Function Response:** \`${block.toolName}\`\n\n`;
    if (block.result !== undefined) {
      result += '```json\n';
      result += JSON.stringify(block.result, null, 2);
      result += '\n```\n\n';
    }
    return result;
  }
  return '';
}

/**
 * Formats conversation history into a markdown transcript.
 *
 * @param history - Array of IContent objects from the conversation
 */
function speakerToTranscriptRole(speaker: IContent['speaker']): string {
  if (speaker === 'human') {
    return 'User';
  }
  if (speaker === 'tool') {
    return 'Tool';
  }
  return 'Assistant';
}

async function createExportFile(): Promise<{
  filePath: string;
  handle: FileHandle;
}> {
  for (let attempt = 0; ; attempt++) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = nodeCrypto.randomBytes(8).toString('hex');
    const filePath = join(
      tmpdir(),
      `llxprt-bug-report-${timestamp}-${random}.md`,
    );
    try {
      return { filePath, handle: await open(filePath, 'wx', 0o600) };
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'EEXIST' &&
        attempt < 2
      )
        continue;
      throw error;
    }
  }
}

async function writeTranscript(
  handle: FileHandle,
  history: AsyncIterable<IContent>,
): Promise<void> {
  await handle.writeFile('# LLxprt Code Conversation Transcript\n\n', 'utf8');
  for await (const row of history) {
    let markdown = `## ${speakerToTranscriptRole(row.speaker)}\n\n`;
    for (const block of row.blocks) markdown += formatBlockToMarkdown(block);
    await handle.writeFile(sanitizeTranscript(markdown + '---\n\n'), 'utf8');
  }
}

export async function exportHistoryForBugReport(
  history: AsyncIterable<IContent>,
): Promise<{ filePath: string }> {
  const { filePath, handle } = await createExportFile();
  try {
    try {
      await writeTranscript(handle, history);
    } finally {
      await handle.close();
    }
    return { filePath };
  } catch (error) {
    await unlink(filePath);
    throw error;
  }
}
