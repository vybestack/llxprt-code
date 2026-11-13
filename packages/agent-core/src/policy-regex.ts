/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { DefinitionError } from './errors.js';
import { isPlainData } from './plain-data.js';
import type { PolicyRegex, PolicyRegexInput } from './types.js';

export const MAX_POLICY_REGEX_SOURCE_LENGTH = 1024;

function regexProblem(
  input: PolicyRegexInput,
  message: string,
): DefinitionError {
  return new DefinitionError([
    {
      code: 'invalid-policy-regex',
      path: ['input', 'source'],
      message: `Invalid policy regex at ${input.path}: ${message}`,
    },
  ]);
}

function validateSource(source: string, input: PolicyRegexInput): void {
  if (source.length > MAX_POLICY_REGEX_SOURCE_LENGTH)
    throw regexProblem(
      input,
      `source exceeds ${MAX_POLICY_REGEX_SOURCE_LENGTH} UTF-16 units.`,
    );
  if (/([+*]|\{\d+,\d*\})\??([+*]|\{\d+,\d*\})/.test(source))
    throw regexProblem(input, 'adjacent quantifiers are not supported.');
}

function compile(
  source: string,
  flags: string,
  input: PolicyRegexInput,
): RegExp {
  if (
    new Set(flags).size !== flags.length ||
    /[^dgimsuvy]/.test(flags) ||
    (flags.includes('u') && flags.includes('v'))
  ) {
    throw regexProblem(
      input,
      'flags must be unique ECMAScript flags without both u and v.',
    );
  }
  try {
    return new RegExp(source, flags);
  } catch (error) {
    throw regexProblem(
      input,
      error instanceof Error
        ? error.message
        : 'native RegExp construction failed.',
    );
  }
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function jsonEscaped(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function commandPrefix(source: string): string {
  return String.raw`"command":"${escaped(source)}(?:[\s"]|$)`;
}

export function normalizePolicyRegex(input: PolicyRegexInput): PolicyRegex {
  if (!isPlainData(input)) {
    throw new DefinitionError([
      {
        code: 'invalid-policy-regex',
        path: ['input'],
        message: 'Policy regex input must be plain data.',
      },
    ]);
  }
  let source: string;
  let flags = '';
  let effective: string;
  switch (input.path) {
    case 'direct':
      source = input.source;
      flags = input.flags;
      effective = compile(source, flags, input).source;
      break;
    case 'utils-argsPattern': {
      source = input.source;
      flags = input.flags;
      validateSource(source, input);
      const nativeSource = compile(source, flags, input).source;
      validateSource(nativeSource, input);
      effective = nativeSource.replaceAll('.*', '[^"]*');
      break;
    }
    case 'directory-argsPattern': {
      source = input.text;
      validateSource(source, input);
      const nativeSource = compile(source, '', input).source;
      validateSource(nativeSource, input);
      effective = nativeSource.replaceAll('.*', '[^"]*');
      break;
    }
    case 'single-file-argsPattern':
      source = input.text;
      validateSource(source, input);
      effective = compile(source, '', input).source;
      break;
    case 'directory-commandRegex':
    case 'utils-commandRegex':
      source = input.text;
      validateSource(source, input);
      effective = `"command":"(?:${source})`;
      break;
    case 'single-file-commandRegex':
      source = input.text;
      effective = `"command":"${source}`;
      validateSource(effective, input);
      break;
    case 'directory-commandPrefix':
    case 'utils-commandPrefix':
    case 'dynamic-commandPrefix':
      source = input.text;
      effective = commandPrefix(jsonEscaped(source));
      break;
    case 'single-file-commandPrefix':
      source = input.text;
      effective = commandPrefix(source);
      validateSource(effective, input);
      break;
    default:
      throw new Error('Unsupported policy regex input path.');
  }
  compile(effective, flags, input);
  return { flavor: 'ecmascript', source: effective, flags, input };
}
