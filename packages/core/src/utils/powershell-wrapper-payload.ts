/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PowerShell wrapper/encoded-command payload extraction (#3181).
 *
 * Extracted from powershell-ast.ts to keep that module within line limits.
 * This module classifies wrapper/launcher command names, extracts literal
 * payloads from -Command/-c/-EncodedCommand invocations, decodes base64
 * (UTF-16LE) payloads, and recursively parses them with the target grammar.
 * It relies on powershell-ast.ts for shared tree-walking, name resolution,
 * and string-content helpers, and holds no parser lifecycle state.
 */

import type { Node } from 'web-tree-sitter';
import { Buffer } from 'node:buffer';
import type { ParsedCommandDetail, ParserLanguage } from './shell-parser.js';
import type { ParsePayloadFn } from './powershell-ast.js';
import {
  findNamedChild,
  expressionDetail,
  extractPwshStaticStringDescendant,
  getPwshCommandName,
  extractPwshLauncherTarget,
} from './powershell-ast.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Classification of a PowerShell wrapper/launcher command name.
 */
type PwshWrapperCategory =
  | 'evaluator'
  | 'pwsh'
  | 'bash'
  | 'cmd'
  | 'launcher'
  | 'none';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PWSH_EVALUATORS = new Set(['invoke-expression', 'iex']);
const PWSH_SHELL_WRAPPERS_PWSH = new Set([
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
]);
const PWSH_SHELL_WRAPPERS_BASH = new Set(['bash', 'bash.exe', 'sh', 'sh.exe']);
const PWSH_SHELL_WRAPPERS_CMD = new Set(['cmd', 'cmd.exe']);
// Start-Process and its default aliases launch an external process; the target
// executable must be extracted as a static command name for blocklist /
// allowlist validation (Finding 4, #3181).
const PWSH_PROCESS_LAUNCHERS = new Set(['start-process', 'saps', 'start']);

// ---------------------------------------------------------------------------
// Wrapper-specific string argument extraction
// ---------------------------------------------------------------------------

function extractPwshStringArgument(commandNode: Node): string | null {
  const commandElements = findNamedChild(commandNode, 'command_elements');
  return commandElements
    ? extractPwshStaticStringDescendant(commandElements)
    : null;
}

function extractPwshStringArgumentAfterFlag(
  commandNode: Node,
  flags: ReadonlySet<string>,
  category: PwshWrapperCategory = 'none',
): string | null {
  const commandElements = findNamedChild(commandNode, 'command_elements');
  if (!commandElements) {
    return null;
  }

  const flagIndex = findFlagElementIndex(commandElements, flags, category);
  return flagIndex >= 0
    ? extractFirstStringAfterFlag(commandElements, flagIndex + 1)
    : null;
}

function extractPwshCommandPayloadAfterFlag(
  commandNode: Node,
  flags: ReadonlySet<string>,
): string | null {
  const commandElements = findNamedChild(commandNode, 'command_elements');
  if (!commandElements) {
    return null;
  }

  const flagIndex = findFlagElementIndex(commandElements, flags, 'pwsh');
  if (flagIndex < 0) {
    return null;
  }

  const parts: string[] = [];
  for (
    let index = flagIndex + 1;
    index < commandElements.namedChildCount;
    index += 1
  ) {
    const child = commandElements.namedChild(index);
    if (!child || child.type === 'command_argument_sep') {
      continue;
    }
    parts.push(extractPwshStaticStringDescendant(child) ?? child.text);
  }

  const payload = parts.join(' ').trim();
  return payload || null;
}

function findFlagElementIndex(
  commandElements: Node,
  flags: ReadonlySet<string>,
  category: PwshWrapperCategory = 'none',
): number {
  for (let index = 0; index < commandElements.namedChildCount; index += 1) {
    const child = commandElements.namedChild(index);
    if (child && isWrapperFlagMatch(child.text, flags, category)) {
      return index;
    }
  }
  return -1;
}

/**
 * Match a command_element token against the expected wrapper flag set.
 * PowerShell parameter binding accepts unambiguous abbreviations; powershell.exe
 * resolves -co through -command (and -c) to -Command, so prefix matching down
 * to two characters is required. Bash (-c) and cmd (/c) require exact matching
 * (#3181 review).
 */
function isWrapperFlagMatch(
  text: string,
  flags: ReadonlySet<string>,
  category: PwshWrapperCategory,
): boolean {
  const lowered = text.toLowerCase();
  if (flags.has(lowered)) {
    return true;
  }
  if (category === 'pwsh') {
    if (!lowered.startsWith('-')) {
      return false;
    }
    const param = lowered.slice(1);
    return param.length >= 2 && 'command'.startsWith(param);
  }
  return false;
}

function extractFirstStringAfterFlag(
  commandElements: Node,
  startIndex: number,
): string | null {
  for (
    let index = startIndex;
    index < commandElements.namedChildCount;
    index += 1
  ) {
    const child = commandElements.namedChild(index);
    if (child && child.type !== 'command_argument_sep') {
      return extractPwshStaticStringDescendant(child);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Wrapper / launcher classification
// ---------------------------------------------------------------------------

function classifyPwshWrapperName(name: string): PwshWrapperCategory {
  if (PWSH_EVALUATORS.has(name)) {
    return 'evaluator';
  }
  if (PWSH_SHELL_WRAPPERS_PWSH.has(name)) {
    return 'pwsh';
  }
  if (PWSH_SHELL_WRAPPERS_BASH.has(name)) {
    return 'bash';
  }
  if (PWSH_SHELL_WRAPPERS_CMD.has(name)) {
    return 'cmd';
  }
  if (PWSH_PROCESS_LAUNCHERS.has(name)) {
    return 'launcher';
  }
  return 'none';
}

function isShellWrapperCategory(category: PwshWrapperCategory): boolean {
  return category === 'pwsh' || category === 'bash' || category === 'cmd';
}

function resolveBareWrapperFlags(
  category: PwshWrapperCategory,
): ReadonlySet<string> {
  if (category === 'cmd') {
    return new Set(['/c']);
  }
  if (category === 'bash') {
    return new Set(['-c']);
  }
  return new Set(['-command', '-c']);
}

function extractPwshBareWrapperPayload(
  commandNode: Node,
  source: string,
  flags: ReadonlySet<string>,
  category: PwshWrapperCategory = 'none',
): string | null {
  const commandElements = findNamedChild(commandNode, 'command_elements');
  if (!commandElements) {
    return null;
  }

  for (let index = 0; index < commandElements.namedChildCount; index += 1) {
    const child = commandElements.namedChild(index);
    if (!child || !isWrapperFlagMatch(child.text, flags, category)) {
      continue;
    }
    const payload = source.slice(child.endIndex, commandNode.endIndex).trim();
    return payload || null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Wrapper payload extraction and recursive parsing
// ---------------------------------------------------------------------------

/**
 * Extract and recursively parse wrapper/evaluator payloads from a
 * PowerShell `command` node (Finding 4, #3181).
 *
 * - Invoke-Expression/iex: parse literal payload with PowerShell grammar;
 *   dynamic payload -> expression.
 * - powershell/pwsh -Command: parse literal payload with PowerShell grammar;
 *   dynamic payload -> expression.
 * - bash/sh -c: parse literal payload with Bash grammar;
 *   dynamic payload -> expression.
 * - cmd/cmd.exe /c: no dedicated parser; literal -> expression (unresolved);
 *   dynamic -> expression.
 */
export function extractPwshWrapperPayloadDetails(
  commandNode: Node,
  source: string,
  parsePayload: ParsePayloadFn,
): ParsedCommandDetail[] {
  const name = getPwshCommandName(commandNode);
  const category = name !== null ? classifyPwshWrapperName(name) : 'none';
  if (category === 'none') {
    return [];
  }

  const fullText = source
    .slice(commandNode.startIndex, commandNode.endIndex)
    .trim();

  if (category === 'launcher') {
    return extractLauncherPayload(commandNode);
  }

  // -EncodedCommand delivers an opaque base64 (UTF-16LE) payload that
  // bypasses structural validation. Decode and recurse so nested
  // blocklisted commands are caught; invalid/missing payloads fail closed
  // (#3181 review).
  if (category === 'pwsh') {
    const encodedResult = extractPwshEncodedCommandDetails(
      commandNode,
      fullText,
      parsePayload,
    );
    if (encodedResult !== null) {
      return encodedResult;
    }
  }

  return extractWrapperPayload(
    commandNode,
    source,
    category,
    fullText,
    parsePayload,
  );
}

function extractLauncherPayload(commandNode: Node): ParsedCommandDetail[] {
  const target = extractPwshLauncherTarget(commandNode);
  if (target === null) {
    return [];
  }
  return [target];
}

/**
 * Resolve the literal payload from a wrapper/evaluator command. PowerShell
 * -Command reconstructs all trailing arguments; bash/sh -c and cmd /c take a
 * single string argument; bare evaluators (Invoke-Expression) take a single
 * string argument.
 */
function resolveWrapperPayload(
  commandNode: Node,
  category: PwshWrapperCategory,
  wrapperFlags: ReadonlySet<string> | null,
): string | null {
  if (wrapperFlags === null) {
    return extractPwshStringArgument(commandNode);
  }
  if (category === 'pwsh') {
    return extractPwshCommandPayloadAfterFlag(commandNode, wrapperFlags);
  }
  return extractPwshStringArgumentAfterFlag(
    commandNode,
    wrapperFlags,
    category,
  );
}

function extractWrapperPayload(
  commandNode: Node,
  source: string,
  category: PwshWrapperCategory,
  fullText: string,
  parsePayload: ParsePayloadFn,
): ParsedCommandDetail[] {
  const wrapperFlags = isShellWrapperCategory(category)
    ? resolveBareWrapperFlags(category)
    : null;
  let payload = resolveWrapperPayload(commandNode, category, wrapperFlags);
  if (payload === null && wrapperFlags) {
    payload = extractPwshBareWrapperPayload(
      commandNode,
      source,
      wrapperFlags,
      category,
    );
  }

  if (payload === null) {
    return [expressionDetail(fullText)];
  }

  if (category === 'cmd') {
    return [expressionDetail(payload)];
  }

  // Recursive expansion terminates because every payload must be a strict
  // substring of its wrapper command. Treat any grammar anomaly that violates
  // that invariant as unresolved instead of silently skipping validation.
  if (payload.length >= fullText.length) {
    return [expressionDetail(fullText)];
  }

  return parseWrapperPayload(payload, category, parsePayload);
}

function parseWrapperPayload(
  payload: string,
  category: PwshWrapperCategory,
  parsePayload: ParsePayloadFn,
): ParsedCommandDetail[] {
  const payloadLanguage: ParserLanguage =
    category === 'bash' ? 'bash' : 'powershell';
  const nestedResult = parsePayload(payload, payloadLanguage);

  if (nestedResult?.hasError === false && nestedResult.details.length > 0) {
    return nestedResult.details;
  }

  return [expressionDetail(payload)];
}

// ---------------------------------------------------------------------------
// Encoded-command detection and decoding
// ---------------------------------------------------------------------------

/**
 * Detect -EncodedCommand (and its unambiguous abbreviations) on a powershell
 * / pwsh command node. Returns decoded details when the flag is present, or
 * null when it is absent (caller should continue with regular extraction).
 */
function extractPwshEncodedCommandDetails(
  commandNode: Node,
  fullText: string,
  parsePayload: ParsePayloadFn,
): ParsedCommandDetail[] | null {
  const commandElements = findNamedChild(commandNode, 'command_elements');
  if (!commandElements) {
    return null;
  }

  for (let index = 0; index < commandElements.namedChildCount; index += 1) {
    const child = commandElements.namedChild(index);
    if (
      !child ||
      child.type !== 'command_parameter' ||
      !isPwshEncodedCommandFlag(child.text)
    ) {
      continue;
    }

    const encoded = extractEncodedPayloadToken(commandElements, index + 1);
    if (encoded === null) {
      // Flag present but payload is dynamic or absent — fail closed.
      return [expressionDetail(fullText)];
    }
    const decoded = decodePwshEncodedPayload(encoded);
    if (decoded === null || decoded.trim() === '') {
      return [expressionDetail(fullText)];
    }
    return parseWrapperPayload(decoded, 'pwsh', parsePayload);
  }
  return null;
}

function isPwshEncodedCommandFlag(text: string): boolean {
  // powershell.exe resolves every prefix of -EncodedCommand down to -e as
  // -EncodedCommand, so match any non-empty prefix (#3181 review).
  const param = text.toLowerCase().replace(/^-/, '');
  return param.length > 0 && 'encodedcommand'.startsWith(param);
}

function extractEncodedPayloadToken(
  commandElements: Node,
  startIndex: number,
): string | null {
  for (
    let index = startIndex;
    index < commandElements.namedChildCount;
    index += 1
  ) {
    const child = commandElements.namedChild(index);
    if (!child || child.type === 'command_argument_sep') {
      continue;
    }
    if (child.type === 'generic_token') {
      return child.text;
    }
    return extractPwshStaticStringDescendant(child);
  }
  return null;
}

function decodePwshEncodedPayload(base64: string): string | null {
  const normalized = base64.replace(/\s+/gu, '');
  if (
    normalized.length === 0 ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)
  ) {
    return null;
  }

  try {
    const bytes = Buffer.from(normalized, 'base64');
    if (bytes.length % 2 !== 0 || bytes.toString('base64') !== normalized) {
      return null;
    }
    return bytes.toString('utf16le');
  } catch {
    return null;
  }
}
