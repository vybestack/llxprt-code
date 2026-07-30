/**
 * Pure helper functions extracted from scripts/tmux-harness.ts.
 *
 * These functions (matcher compilation, macro expansion, label sanitization,
 * and tool-confirmation parsing) have no side effects and no tmux/FS
 * dependencies, so they live in their own module. scripts/tmux-harness.ts
 * imports and re-exports them to preserve its public API.
 *
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface MatcherStep {
  contains?: string;
  regex?: string;
  regexFlags?: string;
}

export type CompiledMatcher =
  | { kind: 'contains'; value: string }
  | { kind: 'regex'; value: RegExp };

interface ToolConfirmationOption {
  number: number;
  label: string;
  selected: boolean;
}

export function compileMatcher(step: MatcherStep): CompiledMatcher {
  if (typeof step.contains === 'string') {
    return { kind: 'contains', value: step.contains };
  }
  if (typeof step.regex === 'string') {
    const flags = typeof step.regexFlags === 'string' ? step.regexFlags : '';
    return { kind: 'regex', value: new RegExp(step.regex, flags) };
  }
  throw new Error(
    `Matcher requires "contains" or "regex": ${JSON.stringify(step)}`,
  );
}

export function matchText(text: string, matcher: CompiledMatcher): boolean {
  if (matcher.kind === 'contains') {
    return text.includes(matcher.value);
  }
  const regex = matcher.value;
  regex.lastIndex = 0;
  return regex.test(text);
}

export function formatMatcher(matcher: CompiledMatcher): string {
  if (matcher.kind === 'contains') {
    return `contains "${matcher.value}"`;
  }
  const regex = matcher.value;
  return `regex /${regex.source}/${regex.flags}`;
}

export function countMatches(text: string, matcher: CompiledMatcher): number {
  if (matcher.kind === 'contains') {
    return countSubstringOccurrences(text, matcher.value);
  }

  const src = matcher.value;
  const flags = src.flags.includes('g') ? src.flags : `${src.flags}g`;
  const re = new RegExp(src.source, flags);
  return Array.from(text.matchAll(re)).length;
}

function countSubstringOccurrences(text: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let idx = 0;
  while (idx <= text.length) {
    const found = text.indexOf(needle, idx);
    if (found === -1) break;
    count += 1;
    idx = found + needle.length;
  }
  return count;
}

export function sanitizeLabel(label: string): string {
  const replaced = label.replace(/[^a-z0-9._-]+/gi, '_');
  return trimUnderscores(replaced);
}

function trimUnderscores(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '_') start += 1;
  while (end > start && value[end - 1] === '_') end -= 1;
  return value.slice(start, end);
}

export function deepCloneJson<T>(value: T): T {
  return structuredClone(value);
}

export function applyMacroArgs(
  value: unknown,
  args: Record<string, unknown>,
): unknown {
  if (typeof value === 'string') {
    const exact = value.match(/^\$\{([A-Za-z0-9_]+)\}$/);
    if (exact) {
      const key = exact[1];
      if (Object.prototype.hasOwnProperty.call(args, key)) {
        return args[key];
      }
    }

    return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (match, key) => {
      if (!Object.prototype.hasOwnProperty.call(args, key)) return match;
      return String(args[key]);
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => applyMacroArgs(item, args));
  }

  if (value && typeof value === 'object') {
    const obj = value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = applyMacroArgs(v, args);
    }
    return out;
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isMacroMap(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

export function expandScriptMacros(steps: unknown, macros: unknown): unknown[] {
  if (!Array.isArray(steps)) {
    throw new Error(`script.steps must be an array`);
  }
  if (macros === undefined || macros === null) return steps;
  if (!isMacroMap(macros)) {
    throw new Error(`script.macros must be an object`);
  }
  const macroMap = macros;

  const expand = (inputSteps: unknown[], stack: string[]): unknown[] => {
    const output: unknown[] = [];
    for (const step of inputSteps) {
      if (isRecord(step) && step.type === 'macro') {
        const name = step.name;
        if (typeof name !== 'string' || name.trim().length === 0) {
          throw new Error(`macro step requires non-empty "name"`);
        }
        if (stack.includes(name)) {
          throw new Error(
            `Macro cycle detected: ${[...stack, name].join(' -> ')}`,
          );
        }

        const template = macroMap[name];
        if (!Array.isArray(template)) {
          throw new Error(`Macro "${name}" must be an array of steps`);
        }
        const args: Record<string, unknown> = isRecord(step.args)
          ? step.args
          : {};

        const expandedTemplate = expand(template, [...stack, name]);
        for (const templateStep of expandedTemplate) {
          output.push(applyMacroArgs(deepCloneJson(templateStep), args));
        }
        continue;
      }

      output.push(step);
    }
    return output;
  };

  return expand(steps, []);
}

export function parseToolConfirmationOptions(
  screen: string,
): ToolConfirmationOption[] {
  const options: ToolConfirmationOption[] = [];
  const lines = screen.split('\n');
  for (const rawLine of lines) {
    const option = parseOptionFromLine(rawLine);
    if (option !== null) {
      options.push(option);
    }
  }
  return options;
}

/**
 * Parses a single rendered line into a tool-confirmation option, or returns
 * null when the line is not a yes/no/modify option. Extracted from the
 * parsing loop to keep the loop free of multiple break/continue statements.
 */
function parseOptionFromLine(rawLine: string): ToolConfirmationOption | null {
  const line = rawLine.replace(/^ *│?/, '').replace(/│ *$/, '');
  // Capture everything after "N." up to end-of-line, then trim in code to
  // avoid a backtracking lazy quantifier inside the regex.
  const match = line.match(/^\s*(?:●\s*)?(\d+)\.(.*)$/u);
  if (!match) return null;
  const number = Number(match[1]);
  const label = match[2] ?? '';
  if (!Number.isFinite(number) || number <= 0) return null;

  const labelTrimmed = label.trim();
  const labelLower = labelTrimmed.toLowerCase();
  if (
    !labelLower.startsWith('yes') &&
    !labelLower.startsWith('no') &&
    !labelLower.startsWith('modify')
  ) {
    return null;
  }

  return {
    number,
    label: labelTrimmed,
    selected: line.includes('●'),
  };
}
