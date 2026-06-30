/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HookLogEntry, ParsedLog, ToolLogEntry } from './types.js';

const BODY_MARKER = "body: 'Tool call:";
const TOOL_PREFIX = 'Tool call:';
const SUCCESS_LABEL = 'Success:';
const DURATION_LABEL = 'Duration:';
const LINE_BREAK_PATTERN = /\r?\n/;

/**
 * Parse a single Podman stdout line containing a "Tool call:" body marker.
 * Returns null when the line does not yield a usable tool entry.
 */
function parseToolCallLine(line: string): {
  extractedToolName: string;
  success: boolean;
  duration: number;
} | null {
  const bodyStartIndex = line.indexOf(BODY_MARKER);
  if (bodyStartIndex < 0) {
    return null;
  }

  const bodyEndIndex = line.lastIndexOf("'");
  if (bodyEndIndex <= bodyStartIndex + BODY_MARKER.length) {
    return null;
  }

  const bodyText = line
    .slice(bodyStartIndex + "body: '".length, bodyEndIndex)
    .trim();
  if (!bodyText.startsWith(TOOL_PREFIX)) {
    return null;
  }

  const dotAfterToolName = bodyText.indexOf('.', TOOL_PREFIX.length);
  if (dotAfterToolName < 0) {
    return null;
  }

  const extractedToolName = bodyText
    .slice(TOOL_PREFIX.length, dotAfterToolName)
    .trim();
  if (extractedToolName.length === 0) {
    return null;
  }

  const successLabelIndex = bodyText.indexOf(SUCCESS_LABEL, dotAfterToolName);
  const durationLabelIndex = bodyText.indexOf(DURATION_LABEL, dotAfterToolName);
  if (successLabelIndex < 0 || durationLabelIndex < 0) {
    return null;
  }

  const successText = bodyText
    .slice(successLabelIndex + SUCCESS_LABEL.length, durationLabelIndex)
    .replace(/\./g, '')
    .trim()
    .toLowerCase();
  const success = successText === 'true';

  const durationValueStart = durationLabelIndex + DURATION_LABEL.length;
  const durationMsSuffix = bodyText.indexOf('ms', durationValueStart);
  if (durationMsSuffix < 0) {
    return null;
  }
  const durationText = bodyText
    .slice(durationValueStart, durationMsSuffix)
    .replace(/\./g, '')
    .trim();
  const duration = Number.parseInt(durationText, 10);
  if (Number.isNaN(duration)) {
    return null;
  }

  return { extractedToolName, success, duration };
}

/**
 * Parse the "body-marker" format from Podman stdout into tool entries.
 */
function parseBodyMarkerFormat(stdout: string): ToolLogEntry[] {
  const logs: ToolLogEntry[] = [];
  const lines = stdout.split(LINE_BREAK_PATTERN);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const parsed = parseToolCallLine(line);
    if (parsed === null) {
      continue;
    }

    const contextStart = Math.max(0, lineIndex - 10);
    const contextEnd = Math.min(lines.length, lineIndex + 10);
    const context = lines.slice(contextStart, contextEnd).join('\n');

    const argsMatch = context.match(/function_args:\s*'([^']+)'/);
    const args = argsMatch !== null ? argsMatch[1] : '{}';

    const nameMatch = context.match(/function_name:\s*'([\w-]+)'/);
    const actualToolName =
      nameMatch !== null ? nameMatch[1] : parsed.extractedToolName;

    logs.push({
      timestamp: Date.now(),
      toolRequest: {
        name: actualToolName,
        args,
        success: parsed.success,
        duration_ms: parsed.duration,
      },
    });
  }

  return logs;
}

/**
 * A parsed fallback JSON object containing a tool call.
 */
interface FallbackObject {
  readonly timestamp?: number;
  readonly body?: string;
  readonly attributes?: Record<string, unknown>;
}

/**
 * Convert a fallback JSON object into a tool entry when applicable.
 */
function fallbackObjectToEntry(obj: FallbackObject): ToolLogEntry | null {
  const attributes = obj.attributes;
  if (
    obj.body !== undefined &&
    obj.body.includes('Tool call:') &&
    attributes !== undefined
  ) {
    const bodyMatch = obj.body.match(/Tool call: (\w+)\./);
    if (bodyMatch !== null) {
      return {
        timestamp: obj.timestamp ?? Date.now(),
        toolRequest: {
          name: bodyMatch[1],
          args: readStringAttr(attributes, 'function_args') ?? '{}',
          success: readBooleanAttr(attributes, 'success', true),
          duration_ms: readNumberAttr(attributes, 'duration_ms') ?? 0,
        },
      };
    }
  }

  if (
    attributes !== undefined &&
    readStringAttr(attributes, 'event.name') === 'llxprt_code.tool_call'
  ) {
    return {
      timestamp: readNumberAttr(attributes, 'event.timestamp') ?? Date.now(),
      toolRequest: {
        name: readStringAttr(attributes, 'function_name') ?? '',
        args: readStringAttr(attributes, 'function_args') ?? '{}',
        success: readBooleanAttr(attributes, 'success', false),
        duration_ms: readNumberAttr(attributes, 'duration_ms') ?? 0,
      },
    };
  }

  return null;
}

function readStringAttr(
  attributes: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = attributes[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumberAttr(
  attributes: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = attributes[key];
  return typeof value === 'number' ? value : undefined;
}

function readBooleanAttr(
  attributes: Record<string, unknown>,
  key: string,
  defaultValue: boolean,
): boolean {
  const value = attributes[key];
  return typeof value === 'boolean' ? value : defaultValue;
}

/**
 * Parse the JSON-object-array fallback format from Podman stdout.
 */
function parseFallbackJsonFormat(stdout: string): ToolLogEntry[] {
  const logs: ToolLogEntry[] = [];
  const lines = stdout.split(LINE_BREAK_PATTERN);
  let currentObject = '';
  let inObject = false;
  let braceDepth = 0;

  for (const line of lines) {
    const startNewObject = !inObject && line.trim() === '{';
    if (startNewObject) {
      inObject = true;
      braceDepth = 1;
      currentObject = line + '\n';
    } else if (inObject) {
      currentObject += line + '\n';
      braceDepth += countBraceDelta(line);
      if (braceDepth === 0) {
        inObject = false;
        finalizeFallbackObject(currentObject, logs);
        currentObject = '';
      }
    }
  }

  return logs;
}

/**
 * Count the net change in brace depth for a line.
 */
function countBraceDelta(line: string): number {
  let delta = 0;
  let inString = false;
  let escaped = false;

  for (const char of line) {
    const state = readBraceParserState(char, inString, escaped);
    inString = state.inString;
    escaped = state.escaped;
    delta += state.delta;
  }
  return delta;
}

function readBraceParserState(
  char: string,
  inString: boolean,
  escaped: boolean,
): { inString: boolean; escaped: boolean; delta: number } {
  if (escaped) {
    return { inString, escaped: false, delta: 0 };
  }

  if (char === '\\') {
    return { inString, escaped: inString, delta: 0 };
  }

  if (char === '"') {
    return { inString: !inString, escaped: false, delta: 0 };
  }

  if (inString) {
    return { inString, escaped: false, delta: 0 };
  }

  if (char === '{') {
    return { inString, escaped: false, delta: 1 };
  }

  if (char === '}') {
    return { inString, escaped: false, delta: -1 };
  }

  return { inString, escaped: false, delta: 0 };
}

/**
 * Parse an accumulated JSON object string and append any tool entry it yields.
 */
function finalizeFallbackObject(
  currentObject: string,
  logs: ToolLogEntry[],
): void {
  try {
    const obj = JSON.parse(currentObject) as FallbackObject;
    const entry = fallbackObjectToEntry(obj);
    if (entry !== null) {
      logs.push(entry);
    }
  } catch {
    // Not valid JSON.
  }
}

/**
 * Parse tool-call logs from Podman stdout. Tries the body-marker format first,
 * then falls back to a JSON-object-array format.
 */
export function parseToolLogsFromStdout(stdout: string): ToolLogEntry[] {
  const bodyMarkerLogs = parseBodyMarkerFormat(stdout);
  if (bodyMarkerLogs.length > 0) {
    return bodyMarkerLogs;
  }
  return parseFallbackJsonFormat(stdout);
}

/**
 * Extract hook-call entries from parsed telemetry logs.
 */
export function extractHookLogs(
  parsedLogs: readonly ParsedLog[],
): HookLogEntry[] {
  const logs: HookLogEntry[] = [];

  for (const logData of parsedLogs) {
    const attributes = logData.attributes;
    if (
      attributes !== undefined &&
      attributes['event.name'] === 'llxprt_code.hook_call'
    ) {
      logs.push({
        hookCall: {
          hook_event_name: attributes.hook_event_name ?? '',
          hook_name: attributes.hook_name ?? '',
          hook_input: attributes.hook_input ?? {},
          hook_output: attributes.hook_output ?? {},
          exit_code: attributes.exit_code ?? 0,
          stdout: attributes.stdout ?? '',
          stderr: attributes.stderr ?? '',
          duration_ms: attributes.duration_ms ?? 0,
          success: attributes.success ?? false,
          error: attributes.error ?? '',
        },
      });
    }
  }

  return logs;
}
