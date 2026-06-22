/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  extractNamedArgs,
  parsePositionalTokens,
  assignArgsToPrompt,
  parsePromptArgs,
} from './mcpPromptArgParser.js';
import type { PromptArgument } from '@modelcontextprotocol/sdk/types.js';
import { describe, it, expect } from 'vitest';

describe('extractNamedArgs', () => {
  it('extracts a quoted named argument value', () => {
    const { argValues, positionalTokens } = extractNamedArgs(
      '--name="hello world"',
    );
    expect(argValues.get('name')).toBe('hello world');
    expect(positionalTokens).toStrictEqual([]);
  });

  it('extracts a bare named argument value', () => {
    const { argValues } = extractNamedArgs('--name=value');
    expect(argValues.get('name')).toBe('value');
  });

  it('captures positional text before a named argument', () => {
    const { argValues, positionalTokens } = extractNamedArgs(
      'positional --name=value',
    );
    expect(argValues.get('name')).toBe('value');
    expect(positionalTokens).toStrictEqual(['positional ']);
  });

  it('processes escape sequences in quoted values', () => {
    const { argValues } = extractNamedArgs('--name="hello \\"world\\""');
    expect(argValues.get('name')).toBe('hello "world"');
  });

  it('returns no named args for plain positional input', () => {
    const { argValues, positionalTokens } = extractNamedArgs('hello world');
    expect(argValues.size).toBe(0);
    expect(positionalTokens).toStrictEqual(['hello world']);
  });
});

describe('parsePositionalTokens', () => {
  it('splits bare tokens on whitespace', () => {
    expect(parsePositionalTokens('hello world')).toStrictEqual([
      'hello',
      'world',
    ]);
  });

  it('keeps quoted tokens intact', () => {
    expect(parsePositionalTokens('"hello world" foo')).toStrictEqual([
      'hello world',
      'foo',
    ]);
  });

  it('processes escapes in quoted tokens', () => {
    expect(parsePositionalTokens('"hello \\"world\\""')).toStrictEqual([
      'hello "world"',
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(parsePositionalTokens('')).toStrictEqual([]);
  });
});

describe('assignArgsToPrompt', () => {
  const promptArgs: PromptArgument[] = [
    { name: 'a', required: true },
    { name: 'b', required: true },
  ];

  it('fills from named arg values', () => {
    const argValues = new Map([
      ['a', '1'],
      ['b', '2'],
    ]);
    expect(assignArgsToPrompt(argValues, [], promptArgs)).toStrictEqual({
      a: '1',
      b: '2',
    });
  });

  it('joins all positional tokens into a single unfilled required arg', () => {
    const argValues = new Map([['a', '1']]);
    expect(
      assignArgsToPrompt(argValues, ['hello', 'world'], promptArgs),
    ).toStrictEqual({ a: '1', b: 'hello world' });
  });

  it('assigns positional tokens positionally when multiple args unfilled', () => {
    const argValues = new Map<string, string>();
    expect(
      assignArgsToPrompt(argValues, ['hello', 'world'], promptArgs),
    ).toStrictEqual({ a: 'hello', b: 'world' });
  });

  it('returns an error when required args are missing', () => {
    const argValues = new Map<string, string>();
    const result = assignArgsToPrompt(argValues, ['hello'], promptArgs);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('Missing required argument(s): --b');
  });

  it('ignores empty-string named values', () => {
    const argValues = new Map([['a', '']]);
    const result = assignArgsToPrompt(
      argValues,
      ['filled'],
      [{ name: 'a', required: true }],
    );
    expect(result).toStrictEqual({ a: 'filled' });
  });

  it('returns an error when a single required arg is missing and no positional tokens', () => {
    const argValues = new Map<string, string>();
    const result = assignArgsToPrompt(
      argValues,
      [],
      [{ name: 'only', required: true }],
    );
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe(
      'Missing required argument(s): --only',
    );
  });
});

describe('parsePromptArgs', () => {
  it('returns empty record when no prompt args declared', () => {
    expect(parsePromptArgs('anything', undefined)).toStrictEqual({});
  });

  it('parses a full mixed invocation', () => {
    const args: PromptArgument[] = [
      { name: 'pos1', required: true },
      { name: 'named1', required: true },
      { name: 'pos2', required: true },
    ];
    const result = parsePromptArgs(
      'p1 --named1="value 1" "p2 has spaces"',
      args,
    );
    expect(result).toStrictEqual({
      pos1: 'p1',
      named1: 'value 1',
      pos2: 'p2 has spaces',
    });
  });
});
