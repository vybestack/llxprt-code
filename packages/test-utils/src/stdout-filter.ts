/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

interface ObjectRange {
  readonly start: number;
  readonly end: number;
}

const EVENT_NAME_ATTRIBUTE = 'event.name';
const LLXPRT_EVENT_PREFIX = 'llxprt_code.';
const TOOL_CALL_BODY_PREFIX = 'Tool call:';
const FUNCTION_NAME_ATTRIBUTE = 'function_name';
const FUNCTION_ARGS_ATTRIBUTE = 'function_args';
const LLXPRT_SERVICE_NAME_PATTERN =
  /['"]service\.name['"]:\s*['"]llxprt-code['"]/;
const INSTRUMENTATION_SCOPE_FIELD = 'instrumentationScope:';
const METRIC_DESCRIPTOR_FIELD = 'descriptor:';
const METRIC_NAME_FIELD = 'name:';
const DATA_POINT_TYPE_FIELD = 'dataPointType:';
const DATA_POINTS_FIELD = 'dataPoints:';

/**
 * Strip OpenTelemetry console-exporter objects from Podman stdout while
 * preserving regular CLI output, including `--output-format json` payloads.
 */
export function stripTelemetryFromStdout(stdout: string): string {
  const output: string[] = [];
  let cursor = 0;

  while (cursor < stdout.length) {
    const objectStart = findObjectStart(stdout, cursor);
    if (objectStart === null) {
      output.push(stdout.slice(cursor));
      cursor = stdout.length;
    } else {
      const objectEnd = findObjectEnd(stdout, objectStart);
      if (objectEnd === null) {
        const nextLineStart = findNextLineStart(stdout, objectStart);
        output.push(stdout.slice(cursor, nextLineStart));
        cursor = nextLineStart;
      } else if (isTelemetryObject(stdout.slice(objectStart, objectEnd + 1))) {
        const range = expandStandaloneLine(stdout, objectStart, objectEnd);
        output.push(stdout.slice(cursor, range.start));
        cursor = range.end;
      } else {
        output.push(stdout.slice(cursor, objectEnd + 1));
        cursor = objectEnd + 1;
      }
    }
  }

  return output.join('');
}

function findNextLineStart(text: string, fromIndex: number): number {
  const newline = text.indexOf('\n', fromIndex);
  return newline === -1 ? text.length : newline + 1;
}

function findObjectStart(text: string, fromIndex: number): number | null {
  let lineStart = fromIndex;

  while (lineStart < text.length) {
    const lineEnd = text.indexOf('\n', lineStart);
    const contentEnd = lineEnd === -1 ? text.length : lineEnd;
    let contentStart = lineStart;
    while (
      contentStart < contentEnd &&
      (text[contentStart] === ' ' ||
        text[contentStart] === '\t' ||
        text[contentStart] === '\r')
    ) {
      contentStart++;
    }
    if (text[contentStart] === '{') {
      return contentStart;
    }
    if (lineEnd === -1) {
      return null;
    }
    lineStart = lineEnd + 1;
  }

  return null;
}

function findObjectEnd(text: string, startIndex: number): number | null {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;

  for (let index = startIndex; index < text.length; index++) {
    const char = text[index];
    if (escaped) {
      escaped = false;
    } else if (quote !== null && char === '\\') {
      escaped = true;
    } else if (char === '"' || char === "'" || char === '`') {
      if (quote === null) {
        quote = char;
      } else if (quote === char) {
        quote = null;
      }
    } else if (quote === null) {
      depth = updateBraceDepth(char, depth);
      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
}

function updateBraceDepth(char: string, depth: number): number {
  if (char === '{') {
    return depth + 1;
  }
  if (char === '}') {
    return depth - 1;
  }
  return depth;
}

function isTelemetryObject(objectText: string): boolean {
  const parsed = parseJsonRecord(objectText);
  if (parsed !== null) {
    if (typeof parsed['response'] === 'string') {
      return false;
    }
    return isJsonTelemetryObject(parsed);
  }
  return isInspectedTelemetryObject(objectText);
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Recognize OpenTelemetry JSON LogRecord objects emitted to stdout. */
function isJsonTelemetryObject(value: Record<string, unknown>): boolean {
  const attributes = value['attributes'];
  if (isRecord(attributes)) {
    const eventName = attributes[EVENT_NAME_ATTRIBUTE];
    if (
      typeof eventName === 'string' &&
      eventName.startsWith(LLXPRT_EVENT_PREFIX) &&
      typeof value['timestamp'] === 'number' &&
      typeof value['body'] === 'string'
    ) {
      return true;
    }
  }

  if (
    typeof value['timestamp'] !== 'number' ||
    typeof value['body'] !== 'string' ||
    !value['body'].trimStart().startsWith(TOOL_CALL_BODY_PREFIX) ||
    !isRecord(attributes)
  ) {
    return false;
  }

  return (
    typeof attributes[FUNCTION_NAME_ATTRIBUTE] === 'string' ||
    typeof attributes[FUNCTION_ARGS_ATTRIBUTE] === 'string'
  );
}

/** Recognize Node util.inspect output from OpenTelemetry console exporters. */
function isInspectedTelemetryObject(objectText: string): boolean {
  const hasServiceIdentity = LLXPRT_SERVICE_NAME_PATTERN.test(objectText);
  const hasInstrumentationScope = hasInspectedField(
    objectText,
    INSTRUMENTATION_SCOPE_FIELD,
  );
  if (hasServiceIdentity && hasInstrumentationScope) {
    return true;
  }

  return (
    hasInspectedField(objectText, METRIC_DESCRIPTOR_FIELD) &&
    hasLlxprtMetricName(objectText) &&
    hasInspectedField(objectText, DATA_POINT_TYPE_FIELD) &&
    hasInspectedField(objectText, DATA_POINTS_FIELD)
  );
}

function hasInspectedField(objectText: string, field: string): boolean {
  return objectText
    .split(/\r?\n/)
    .some((line) => line.trimStart().startsWith(field));
}

function hasLlxprtMetricName(objectText: string): boolean {
  return objectText.split(/\r?\n/).some((line) => {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith(METRIC_DESCRIPTOR_FIELD)) {
      return false;
    }
    const nameIndex = trimmed.indexOf(METRIC_NAME_FIELD);
    if (nameIndex === -1) {
      return false;
    }
    const value = trimmed
      .slice(nameIndex + METRIC_NAME_FIELD.length)
      .trimStart();
    return (
      (value.startsWith("'llxprt") || value.startsWith('"llxprt')) &&
      ['.', '_', '-'].includes(value[7])
    );
  });
}

function expandStandaloneLine(
  text: string,
  objectStart: number,
  objectEnd: number,
): ObjectRange {
  const lineStart = text.lastIndexOf('\n', objectStart - 1) + 1;
  const lineEnd = text.indexOf('\n', objectEnd + 1);
  const contentEnd = lineEnd === -1 ? text.length : lineEnd;
  const before = text.slice(lineStart, objectStart);
  const after = text.slice(objectEnd + 1, contentEnd);

  if (before.trim().length > 0 || after.trim().length > 0) {
    return { start: objectStart, end: objectEnd + 1 };
  }

  return {
    start: lineStart,
    end: lineEnd === -1 ? text.length : lineEnd + 1,
  };
}
