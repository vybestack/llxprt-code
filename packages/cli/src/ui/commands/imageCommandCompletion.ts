/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  tokenizeImageCommandRaw,
  IMAGE_MAX_INPUTS,
} from './imageCommandTokenizer.js';

const SUPPORTED_INPUT_EXTENSIONS = ['.png'];

/**
 * A value must be double-quoted when it is empty or contains any character the
 * tokenizer treats specially: whitespace (a token separator), a quote character
 * (would open a quoted run), or a backslash (an escape introducer).
 */
function needsQuoting(value: string): boolean {
  return value === '' || /[\s"'\\]/.test(value);
}

/**
 * Render a path as a token the shared tokenizer decodes back to the exact input.
 *
 * Inside a double-quoted run the tokenizer treats a backslash as an escape
 * introducer, so the backslash must be escaped BEFORE the quote character.
 * Escaping only the quote leaves a trailing backslash able to consume the
 * escape marker and terminate the string early.
 */
function quotePath(value: string): string {
  if (!needsQuoting(value)) {
    return value;
  }
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Determine the completion phase from a partial `/image` argument string using
 * the shared quote-aware tokenizer.
 *
 * - `output`: the user is typing the output path (first token).
 * - `input`: the user is typing an input path (after output, before prompt).
 * - `prompt`: the user has started a quoted prompt; filesystem completion
 *   stops.
 * - `none`: no completions (e.g. already at five inputs).
 */
export type ImageCompletionPhase = 'output' | 'input' | 'prompt' | 'none';

export interface ImageCompletionState {
  readonly phase: ImageCompletionPhase;
  readonly tokens: ReadonlyArray<{
    readonly value: string;
    readonly quoted: boolean;
  }>;
  /**
   * The partial word being typed (may be empty), used to filter suggestions.
   */
  readonly partial: string;
  /**
   * Whether the current token is being actively typed (no trailing space) vs.
   * the cursor is in a fresh position after a space.
   */
  readonly inProgress: boolean;
}

/**
 * Analyze a partial `/image` argument string to determine the completion phase.
 *
 * The tokenizer is quote-aware; a trailing unterminated quote means the prompt
 * has begun (filesystem completion stops). A trailing space means the previous
 * token is complete and the cursor is in a new position.
 */
export function analyzeImageCompletion(
  partialArg: string,
): ImageCompletionState {
  const trimmedEnd = partialArg;
  const endsWithSpace = trimmedEnd.length > 0 && /\s$/.test(trimmedEnd);

  // Tokenize. An unterminated trailing quote is treated as "prompt started".
  let tokens: ReturnType<typeof tokenizeImageCommandRaw>;
  let hasUnterminatedQuote = false;
  try {
    tokens = tokenizeImageCommandRaw(trimmedEnd);
  } catch {
    hasUnterminatedQuote = true;
    // Best-effort: tokenize everything before the last quote char.
    const lastQuoteMatch = trimmedEnd.match(/["'][^"']*$/);
    if (lastQuoteMatch !== null) {
      const cutoff = trimmedEnd.length - lastQuoteMatch[0].length;
      tokens = tokenizeImageCommandRaw(trimmedEnd.slice(0, cutoff));
    } else {
      tokens = [];
    }
  }

  // If the last character opened a quote that never closed, prompt has begun.
  if (hasUnterminatedQuote) {
    return {
      phase: 'prompt',
      tokens,
      partial: '',
      inProgress: true,
    };
  }

  const completedTokens = endsWithSpace ? tokens : tokens.slice(0, -1);
  const partial = endsWithSpace ? '' : (tokens[tokens.length - 1]?.value ?? '');

  // Phase determination based on completed token count.
  // Token layout: [output] [input...] "prompt"
  if (completedTokens.length === 0) {
    return {
      phase: 'output',
      tokens: completedTokens,
      partial,
      inProgress: !endsWithSpace,
    };
  }

  // After output: could be input or prompt start.
  // If there are 1 + up to 5 input tokens completed, next is input (or prompt).
  const inputCount = completedTokens.length - 1;
  if (inputCount >= IMAGE_MAX_INPUTS) {
    return {
      phase: 'prompt',
      tokens: completedTokens,
      partial,
      inProgress: !endsWithSpace,
    };
  }

  // If the in-progress token is quoted, the prompt has begun.
  if (!endsWithSpace && tokens.length > 0) {
    const lastToken = tokens[tokens.length - 1];
    if (lastToken.quoted) {
      return {
        phase: 'prompt',
        tokens: completedTokens,
        partial,
        inProgress: true,
      };
    }
  }

  return {
    phase: 'input',
    tokens: completedTokens,
    partial,
    inProgress: !endsWithSpace,
  };
}

async function listWorkspaceEntries(
  workspaceRoot: string,
  prefix: string,
): Promise<{ dirs: string[]; images: string[] }> {
  const dir = path.isAbsolute(prefix)
    ? path.dirname(prefix)
    : path.resolve(workspaceRoot, path.dirname(prefix) || '.');

  // Contain the resolved directory to the canonical workspace root: an
  // absolute prefix like `/etc/` or a relative `../` resolves outside the
  // workspace and must return no suggestions (no directory enumeration, no
  // `../…` suggestions emitted).
  const canonicalWorkspace = path.resolve(workspaceRoot);
  if (escapesRoot(canonicalWorkspace, dir)) {
    return { dirs: [], images: [] };
  }

  const base = path.basename(prefix);

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { dirs: [], images: [] };
  }

  const dirs: string[] = [];
  const images: string[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(base)) continue;
    const fullPath = path.join(dir, entry);
    try {
      const stat = await fs.stat(fullPath);
      const relFromWorkspace = path.relative(workspaceRoot, fullPath);
      if (stat.isDirectory()) {
        dirs.push(relFromWorkspace);
      } else if (
        SUPPORTED_INPUT_EXTENSIONS.includes(path.extname(entry).toLowerCase())
      ) {
        images.push(relFromWorkspace);
      }
    } catch {
      // skip inaccessible entries
    }
  }
  return { dirs, images };
}

/**
 * True when `candidate` lies outside `root`.
 *
 * An absolute relative-result means the two paths share no common base — on
 * Windows `path.relative('C:\ws', 'D:\secrets')` returns `D:\secrets`, which
 * does not start with `..` — so the absolute check is required in addition to
 * the traversal check.
 */
function escapesRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.startsWith('..') || path.isAbsolute(relative);
}

/**
 * Determine whether a partial prefix resolves outside the canonical workspace
 * root. An absolute prefix pointing elsewhere or a relative `../` traversal
 * escapes and must produce zero suggestions.
 */
function prefixEscapesWorkspace(
  prefix: string,
  workspaceRoot: string,
): boolean {
  const canonicalWorkspace = path.resolve(workspaceRoot);
  const resolvedDir = path.isAbsolute(prefix)
    ? path.dirname(prefix)
    : path.resolve(canonicalWorkspace, path.dirname(prefix) || '.');
  if (escapesRoot(canonicalWorkspace, resolvedDir)) {
    return true;
  }
  // Also check the full prefix path (handles `../` where dirname is `.` but
  // the basename `..` still resolves outside the workspace).
  const resolvedFull = path.isAbsolute(prefix)
    ? prefix
    : path.resolve(canonicalWorkspace, prefix);
  return escapesRoot(canonicalWorkspace, resolvedFull);
}

/**
 * Produce completion suggestions for a partial `/image` argument against a real
 * workspace filesystem.
 *
 * - Output phase: suggest workspace directories and allow a new `.png`.
 * - Input phase: suggest existing supported input images and directories; stop
 *   after five inputs.
 * - Prompt phase: return no filesystem completions (the prompt is not altered).
 */
export async function completeImageCommand(
  partialArg: string,
  workspaceRoot: string,
): Promise<string[]> {
  const state = analyzeImageCompletion(partialArg);

  if (state.phase === 'prompt') {
    // Once a quoted prompt is actively being typed (inProgress), no FS
    // completions. But at the five-input boundary with a trailing space the
    // user is positioned to START the prompt — offer the prompt hint so the
    // continuation is discoverable.
    if (state.inProgress) {
      return [];
    }
    return ['"describe the image to generate or the edit to apply"'];
  }

  if (state.phase === 'none') {
    return [];
  }

  // Containment: if the partial prefix resolves outside the workspace root
  // (absolute path elsewhere or relative `../` traversal), return NO
  // suggestions — not even the prompt hint — so the completion never
  // acknowledges or enumerates directories outside the workspace.
  if (prefixEscapesWorkspace(state.partial, workspaceRoot)) {
    return [];
  }

  const { dirs, images } = await listWorkspaceEntries(
    workspaceRoot,
    state.partial,
  );

  if (state.phase === 'output') {
    // Output path: suggest directories and a hint for a new .png filename.
    const suggestions = dirs.map(quotePath);
    if (state.partial === '') {
      suggestions.push('output.png');
    } else if (
      !state.partial.endsWith('.png') &&
      !state.partial.endsWith(path.sep)
    ) {
      suggestions.push(`${state.partial}.png`);
    }
    return suggestions;
  }

  // Input phase: suggest existing images and directories, PLUS a quoted prompt
  // hint so BOTH continuations (more inputs or starting the prompt) are
  // discoverable after the output path.
  const inputCount = state.tokens.length - 1;
  if (inputCount >= IMAGE_MAX_INPUTS) {
    // At the five-input limit, only the prompt continuation remains.
    return ['"describe the image to generate or the edit to apply"'];
  }
  const suggestions: string[] = [];
  for (const img of images) {
    suggestions.push(quotePath(img));
  }
  for (const dir of dirs) {
    suggestions.push(quotePath(`${dir}${path.sep}`));
  }
  suggestions.push('"describe the image to generate or the edit to apply"');
  return suggestions;
}
