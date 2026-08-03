/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared quote-aware tokenizer and parser for the `/image` slash command and
 * the CLI image-mode argument grammar.
 *
 * Grammar: `/image <output-path> [<input-path> ...] "<prompt>"`
 *
 * The tokenizer supports single- and double-quoted strings, backslash-escaped
 * quote characters inside quoted strings, and quoted paths containing spaces.
 * It is reused by the slash command and by tests so there is no brittle ad hoc
 * split that could disagree with the parser.
 */

export const IMAGE_MAX_INPUTS = 5;

export const IMAGE_USAGE = [
  'Usage: /image <output-path> [<input-path> ...] "<prompt>"',
  '',
  'Examples:',
  '  /image output.png "Create a black-and-white line-art cat"',
  '  /image fixed.png original.png "Correct the lettering"',
  '  /image composite.png subject.png background.png "Place the subject into the background"',
  '',
  'Rules:',
  '  - The output path is required and must end with .png.',
  '  - Zero input paths performs generation; one to five performs editing.',
  '  - The prompt must be the final argument and must be quoted if it contains spaces.',
  '  - Existing output files are NOT overwritten (remove the file first to replace it).',
].join('\n');

/**
 * Error thrown when the `/image` command line cannot be tokenized or parsed.
 */
export class ImageCommandParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageCommandParseError';
  }
}

/**
 * A token produced by the tokenizer, tracking whether it was quoted.
 */
export interface ImageToken {
  readonly value: string;
  readonly quoted: boolean;
}

/**
 * Result of parsing an `/image` command line.
 */
export interface ParsedImageCommand {
  readonly operation: 'generate' | 'edit';
  readonly outputPath: string;
  readonly inputPaths: readonly string[];
  readonly prompt: string;
}

interface QuotedSegmentResult {
  readonly text: string;
  readonly nextIndex: number;
}

/**
 * Read a quoted segment starting just after the opening quote at position
 * `start`. Returns the decoded text and the index just past the closing quote.
 * Throws on unterminated quotes.
 */
function readQuotedSegment(
  input: string,
  quote: string,
  start: number,
): QuotedSegmentResult {
  const len = input.length;
  let i = start;
  let text = '';
  let escaped = false;

  while (i < len) {
    const c = input[i];
    if (escaped) {
      text += c === quote || c === '\\' ? c : `\\${c}`;
      escaped = false;
    } else if (c === '\\') {
      escaped = true;
    } else if (c === quote) {
      return { text, nextIndex: i + 1 };
    } else {
      text += c;
    }
    i++;
  }

  throw new ImageCommandParseError(
    `Unterminated ${quote === '"' ? 'double' : 'single'} quote in /image command.`,
  );
}

/**
 * Tokenize a raw command-line string into ordered tokens with quote metadata.
 *
 * Supports double and single quotes with backslash escape of the enclosing
 * quote character and of backslash itself. Unquoted tokens are split on
 * whitespace. Throws {@link ImageCommandParseError} for unterminated quotes.
 */
export function tokenizeImageCommandRaw(input: string): ImageToken[] {
  const tokens: ImageToken[] = [];
  let current = '';
  let inToken = false;
  let wasQuoted = false;
  let i = 0;
  const len = input.length;

  const flush = () => {
    if (inToken) {
      tokens.push({ value: current, quoted: wasQuoted });
      current = '';
      inToken = false;
      wasQuoted = false;
    }
  };

  while (i < len) {
    const ch = input[i];

    if (ch === '"' || ch === "'") {
      if (!inToken) {
        inToken = true;
        wasQuoted = true;
      } else if (!wasQuoted) {
        wasQuoted = true;
      }
      const segment = readQuotedSegment(input, ch, i + 1);
      current += segment.text;
      i = segment.nextIndex;
    } else if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      flush();
      i++;
    } else {
      inToken = true;
      current += ch;
      i++;
    }
  }

  flush();
  return tokens;
}

/**
 * Tokenize and return just the string values (back-compat convenience).
 */
export function tokenizeImageCommand(input: string): string[] {
  return tokenizeImageCommandRaw(input).map((t) => t.value);
}

/**
 * Parse a raw `/image` command line into a structured command.
 *
 * Grammar: `<output-path> [<input-path> ...] "<prompt>"`
 * - Rejects `--` separator usage.
 * - First token is the output path (required).
 * - Final token is the prompt (required). If it contains spaces it must be
 *   quoted; an unquoted multiword prompt is rejected.
 * - Tokens between them are input paths (zero to five).
 * - Rejects unexpected trailing arguments after the prompt.
 */
export function parseImageCommand(rawInput: string): ParsedImageCommand {
  const trimmed = rawInput.trim();
  if (trimmed === '') {
    throw new ImageCommandParseError(
      `Missing output path and prompt.\n${IMAGE_USAGE}`,
    );
  }

  if (trimmed.startsWith('--')) {
    throw new ImageCommandParseError(
      `The "/image" command does not accept a "--" separator.\n${IMAGE_USAGE}`,
    );
  }

  const tokens = tokenizeImageCommandRaw(trimmed);
  if (tokens.length < 2) {
    throw new ImageCommandParseError(
      tokens.length === 0
        ? `Missing output path and prompt.\n${IMAGE_USAGE}`
        : `Missing prompt. The prompt is required and must be the final quoted argument.\n${IMAGE_USAGE}`,
    );
  }

  const outputPath = tokens[0].value;
  const promptToken = tokens[tokens.length - 1];
  const middleTokens = tokens.slice(1, tokens.length - 1);
  const hasQuotedMiddle = middleTokens.some((t) => t.quoted);

  // Detect unexpected trailing arguments first: a quoted token in the middle
  // followed by an unquoted final token means the quoted segment was the
  // prompt and extra tokens trailed it.
  if (hasQuotedMiddle && !promptToken.quoted) {
    throw new ImageCommandParseError(
      `Unexpected trailing arguments after the prompt.\n${IMAGE_USAGE}`,
    );
  }

  if (promptToken.value.includes(' ') && !promptToken.quoted) {
    throw new ImageCommandParseError(
      `The prompt must be quoted if it contains spaces.\n${IMAGE_USAGE}`,
    );
  }

  if (!promptToken.quoted && middleTokens.length > 0) {
    throw new ImageCommandParseError(
      `The prompt must be quoted. An unquoted multiword prompt is not allowed.\n${IMAGE_USAGE}`,
    );
  }

  const inputPaths = middleTokens.map((t) => t.value);
  if (inputPaths.length > IMAGE_MAX_INPUTS) {
    throw new ImageCommandParseError(
      `At most ${IMAGE_MAX_INPUTS} input images are supported.\n${IMAGE_USAGE}`,
    );
  }

  return {
    operation: inputPaths.length === 0 ? 'generate' : 'edit',
    outputPath,
    inputPaths,
    prompt: promptToken.value,
  };
}
