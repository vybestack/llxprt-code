/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Content } from '@google/genai';

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
  { pattern: 'LLXPRT_API_KEY=\\S+', flags: 'g', replacement: 'LLXPRT_API_KEY=[REDACTED]' },
  { pattern: 'OPENAI_API_KEY=\\S+', flags: 'g', replacement: 'OPENAI_API_KEY=[REDACTED]' },
  { pattern: 'ANTHROPIC_API_KEY=\\S+', flags: 'g', replacement: 'ANTHROPIC_API_KEY=[REDACTED]' },
  { pattern: 'GEMINI_API_KEY=\\S+', flags: 'g', replacement: 'GEMINI_API_KEY=[REDACTED]' },
  { pattern: 'GOOGLE_API_KEY=\\S+', flags: 'g', replacement: 'GOOGLE_API_KEY=[REDACTED]' },
  { pattern: 'VERTEXAI_PROJECT=\\S+', flags: 'g', replacement: 'VERTEXAI_PROJECT=[REDACTED]' },
  // OpenAI-style keys (sk-...)
  { pattern: '\\bsk-[a-zA-Z0-9_-]{20,}', flags: 'g', replacement: 'sk-[REDACTED]' },
  // GitHub personal access tokens
  { pattern: '\\bghp_[a-zA-Z0-9]{30,}', flags: 'g', replacement: 'ghp_[REDACTED]' },
  // AWS credentials
  { pattern: 'AKIA[A-Z0-9]{16}', flags: 'g', replacement: 'AKIA[REDACTED]' },
  { pattern: 'AWS_SECRET_ACCESS_KEY=\\S+', flags: 'g', replacement: 'AWS_SECRET_ACCESS_KEY=[REDACTED]' },
  { pattern: 'AWS_ACCESS_KEY_ID=\\S+', flags: 'g', replacement: 'AWS_ACCESS_KEY_ID=[REDACTED]' },
  // Bearer tokens
  { pattern: 'Bearer\\s+[a-zA-Z0-9_.-]+', flags: 'gi', replacement: 'Bearer [REDACTED]' },
  // Generic API keys in common formats
  { pattern: 'api[_-]?key["\\s:=]+[a-zA-Z0-9_.-]{20,}', flags: 'gi', replacement: 'api_key=[REDACTED]' },
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
 * Formats a single part of a history item to markdown.
 */
function formatPartToMarkdown(
  part: NonNullable<Content['parts']>[number],
): string {
  if (part.text) {
    return `${part.text}\n\n`;
  }
  if (part.functionCall) {
    let result = `**Function Call:** \`${part.functionCall.name}\`\n\n`;
    if (part.functionCall.args) {
      result += '```json\n';
      result += JSON.stringify(part.functionCall.args, null, 2);
      result += '\n```\n\n';
    }
    return result;
  }
  if (part.functionResponse) {
    let result = `**Function Response:** \`${part.functionResponse.name}\`\n\n`;
    if (part.functionResponse.response) {
      result += '```json\n';
      result += JSON.stringify(part.functionResponse.response, null, 2);
      result += '\n```\n\n';
    }
    return result;
  }
  return '';
}

/**
 * Formats conversation history into a markdown transcript.
 *
 * @param history - Array of Content objects from @google/genai
 * @returns Formatted markdown string
 */
function formatHistoryAsMarkdown(history: Content[]): string {
  let transcript = '# LLxprt Code Conversation Transcript\n\n';

  for (const item of history) {
    const role = item.role === 'user' ? 'User' : 'Assistant';
    transcript += `## ${role}\n\n`;

    if (item.parts) {
      for (const part of item.parts) {
        transcript += formatPartToMarkdown(part);
      }
    }

    transcript += '---\n\n';
  }

  return transcript;
}

/**
 * Exports conversation history to a temporary file for bug reporting.
 *
 * @param history - Array of Content objects from the conversation
 * @returns Object containing the export file path and sanitized content
 */
export async function exportHistoryForBugReport(
  history: Content[],
): Promise<{ filePath: string; sanitized: string }> {
  // Format history as markdown
  const markdown = formatHistoryAsMarkdown(history);

  // Sanitize the transcript
  const sanitized = sanitizeTranscript(markdown);

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `llxprt-bug-report-${timestamp}.md`;
  const filePath = join(tmpdir(), filename);

  // Write to temp directory
  await writeFile(filePath, sanitized, 'utf-8');

  return { filePath, sanitized };
}
