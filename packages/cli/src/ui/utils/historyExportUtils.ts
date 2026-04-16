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
export function sanitizeTranscript(text: string): string {
  let sanitized = text;

  // Redact environment variables (all major providers)
  sanitized = sanitized.replace(
    /LLXPRT_API_KEY=\S+/g,
    'LLXPRT_API_KEY=[REDACTED]',
  );
  sanitized = sanitized.replace(
    /OPENAI_API_KEY=\S+/g,
    'OPENAI_API_KEY=[REDACTED]',
  );
  sanitized = sanitized.replace(
    /ANTHROPIC_API_KEY=\S+/g,
    'ANTHROPIC_API_KEY=[REDACTED]',
  );
  sanitized = sanitized.replace(
    /GEMINI_API_KEY=\S+/g,
    'GEMINI_API_KEY=[REDACTED]',
  );
  sanitized = sanitized.replace(
    /GOOGLE_API_KEY=\S+/g,
    'GOOGLE_API_KEY=[REDACTED]',
  );
  sanitized = sanitized.replace(
    /VERTEXAI_PROJECT=\S+/g,
    'VERTEXAI_PROJECT=[REDACTED]',
  );

  // Redact OpenAI-style keys (sk-...)
  sanitized = sanitized.replace(/\bsk-[a-zA-Z0-9_-]{20,}/g, 'sk-[REDACTED]');

  // Redact GitHub personal access tokens
  sanitized = sanitized.replace(/\bghp_[a-zA-Z0-9]{30,}/g, 'ghp_[REDACTED]');

  // Redact AWS credentials
  sanitized = sanitized.replace(/AKIA[A-Z0-9]{16}/g, 'AKIA[REDACTED]');
  sanitized = sanitized.replace(
    /AWS_SECRET_ACCESS_KEY=\S+/g,
    'AWS_SECRET_ACCESS_KEY=[REDACTED]',
  );
  sanitized = sanitized.replace(
    /AWS_ACCESS_KEY_ID=\S+/g,
    'AWS_ACCESS_KEY_ID=[REDACTED]',
  );

  // Redact Bearer tokens
  sanitized = sanitized.replace(
    /Bearer\s+[a-zA-Z0-9_.-]+/gi,
    'Bearer [REDACTED]',
  );

  // Redact generic API keys in common formats
  sanitized = sanitized.replace(
    /api[_-]?key["\s:=]+[a-zA-Z0-9_.-]{20,}/gi,
    'api_key=[REDACTED]',
  );

  return sanitized;
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
        if (part.text) {
          transcript += `${part.text}\n\n`;
        } else if (part.functionCall) {
          transcript += `**Function Call:** \`${part.functionCall.name}\`\n\n`;
          if (part.functionCall.args) {
            transcript += '```json\n';
            transcript += JSON.stringify(part.functionCall.args, null, 2);
            transcript += '\n```\n\n';
          }
        } else if (part.functionResponse) {
          transcript += `**Function Response:** \`${part.functionResponse.name}\`\n\n`;
          if (part.functionResponse.response) {
            transcript += '```json\n';
            transcript += JSON.stringify(
              part.functionResponse.response,
              null,
              2,
            );
            transcript += '\n```\n\n';
          }
        }
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
