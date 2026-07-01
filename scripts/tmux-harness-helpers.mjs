/**
 * Pure helper functions extracted from scripts/tmux-harness.js.
 *
 * These functions (matcher compilation, macro expansion, label sanitization,
 * and tool-confirmation parsing) have no side effects and no tmux/FS
 * dependencies, so they live in their own module. scripts/tmux-harness.js
 * imports and re-exports them to preserve its public API.
 *
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export function compileMatcher(step) {
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

export function matchText(text, matcher) {
  if (matcher.kind === 'contains') {
    return text.includes(matcher.value);
  }
  matcher.value.lastIndex = 0;

  return matcher.value.test(text);
}

export function formatMatcher(matcher) {
  if (matcher.kind === 'contains') {
    return `contains "${matcher.value}"`;
  }
  return `regex /${matcher.value.source}/${matcher.value.flags}`;
}

export function countMatches(text, matcher) {
  if (matcher.kind === 'contains') {
    return countSubstringOccurrences(text, matcher.value);
  }

  const flags = matcher.value.flags.includes('g')
    ? matcher.value.flags
    : `${matcher.value.flags}g`;
  const re = new RegExp(matcher.value.source, flags);
  return Array.from(text.matchAll(re)).length;
}

function countSubstringOccurrences(text, needle) {
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

export function sanitizeLabel(label) {
  const replaced = label.replace(/[^a-z0-9._-]+/gi, '_');
  return trimUnderscores(replaced);
}

function trimUnderscores(value) {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '_') start += 1;
  while (end > start && value[end - 1] === '_') end -= 1;
  return value.slice(start, end);
}

export function deepCloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function applyMacroArgs(value, args) {
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
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = applyMacroArgs(v, args);
    }
    return out;
  }

  return value;
}

export function expandScriptMacros(steps, macros) {
  if (!Array.isArray(steps)) {
    throw new Error(`script.steps must be an array`);
  }
  if (macros === undefined || macros === null) return steps;
  if (typeof macros !== 'object') {
    throw new Error(`script.macros must be an object`);
  }

  const expand = (inputSteps, stack) => {
    const output = [];
    for (const step of inputSteps) {
      if (step && typeof step === 'object' && step.type === 'macro') {
        const name = step.name;
        if (typeof name !== 'string' || name.trim().length === 0) {
          throw new Error(`macro step requires non-empty "name"`);
        }
        if (stack.includes(name)) {
          throw new Error(
            `Macro cycle detected: ${[...stack, name].join(' -> ')}`,
          );
        }

        const template = macros[name];
        if (!Array.isArray(template)) {
          throw new Error(`Macro "${name}" must be an array of steps`);
        }
        const args =
          step.args &&
          typeof step.args === 'object' &&
          !Array.isArray(step.args)
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

export function parseToolConfirmationOptions(screen) {
  const options = [];
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
function parseOptionFromLine(rawLine) {
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
