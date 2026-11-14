/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  parseRegExpLiteral,
  visitRegExpAST,
  type AST,
} from '@eslint-community/regexpp';
import type { RedactionConfig } from '@vybestack/llxprt-code-core/config/config.js';

// Unbounded repetitions in logging rules are limited to 4096 repetitions.
// Rules depending on the entire prefix/suffix cannot be streamed and fail fast.
export const REDACTION_REPEAT_LIMIT = 4096;
type Replacement = string | ((match: string) => string);
interface Rule {
  pattern: RegExp;
  original: RegExp;
  replacement: Replacement;
}

function substitute(match: RegExpExecArray, replacement: Replacement): string {
  if (typeof replacement === 'function') return replacement(match[0]);
  return replacement.replace(
    /\$(\$|&|[0-9]{1,2}|<[^>]*>)/g,
    (literal: string, token: string): string => {
      if (token === '$') return '$';
      if (token === '&') return match[0];
      if (token.startsWith('<'))
        return match.groups === undefined
          ? literal
          : (match.groups[token.slice(1, -1)] ?? '');
      const index = Number(token);
      if (index > 0 && index < match.length) return match[index] ?? '';
      const first = Number(token[0]);
      const validFirstCapture = first > 0 && first < match.length;
      if (token.length === 2 && validFirstCapture)
        return (match[first] ?? '') + token[1];
      return literal;
    },
  );
}

function boundedPattern(pattern: RegExp): RegExp {
  const ast = parseRegExpLiteral(pattern);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  visitRegExpAST(ast.pattern, {
    onQuantifierEnter(node) {
      if (node.max === Infinity) {
        edits.push({
          start: node.element.end - ast.pattern.start,
          end: node.end - ast.pattern.start,
          text: `{${node.min},${Math.max(node.min, REDACTION_REPEAT_LIMIT)}}${node.greedy ? '' : '?'}`,
        });
      }
    },
    onBackreferenceEnter() {
      throw new Error(
        'Streaming redaction does not support regex backreferences',
      );
    },
  });
  let source = pattern.source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  }
  return new RegExp(source, pattern.flags);
}

function width(node: AST.Node): number {
  switch (node.type) {
    case 'Pattern':
    case 'Group':
    case 'CapturingGroup':
      return Math.max(0, ...node.alternatives.map(width));
    case 'Alternative':
      return node.elements.reduce((sum, element) => sum + width(element), 0);
    case 'Quantifier':
      return node.max * width(node.element);
    case 'Assertion':
      return 'alternatives' in node
        ? Math.max(0, ...node.alternatives.map(width))
        : 1;
    case 'Character':
      return node.value > 0xffff ? 2 : 1;
    case 'CharacterClass':
    case 'CharacterSet':
      return 2;
    default:
      throw new Error(
        `Unsupported streaming redaction regex node: ${node.type}`,
      );
  }
}

class RuleStream {
  private pending = '';
  private left = '';
  private replaced = false;
  readonly window: number;
  private readonly search: RegExp;
  private readonly original: RegExp;
  constructor(private readonly rule: Rule) {
    if (rule.pattern.sticky || rule.pattern.flags.includes('v')) {
      throw new Error(
        'Streaming redaction does not support sticky or Unicode-set regexes',
      );
    }
    if (
      typeof rule.replacement === 'string' &&
      /\$[`']/.test(rule.replacement)
    ) {
      throw new Error(
        'Streaming redaction cannot replace with the entire prefix or suffix',
      );
    }
    this.window = width(parseRegExpLiteral(rule.pattern).pattern) + 2;
    this.original = new RegExp(
      rule.original.source,
      rule.original.flags.replace(/[gy]/g, '') + 'y',
    );
    this.search = new RegExp(
      rule.pattern.source,
      rule.pattern.flags.replace(/[gy]/g, '') + 'g',
    );
  }
  get retainedChars(): number {
    return this.pending.length + this.left.length;
  }
  private assertWithinBound(input: string, match: RegExpExecArray): void {
    if (this.rule.pattern.source === this.rule.original.source) return;
    this.original.lastIndex = match.index;
    const original = this.original.exec(input);
    if (original !== null && original[0] !== match[0])
      throw new Error(
        'Response redaction match exceeds the bounded repetition limit',
      );
  }
  push(text: string, final = false): string {
    this.pending += text;
    const input = this.left + this.pending;
    const start = this.left.length;
    let safeEnd = final
      ? input.length
      : Math.max(start, input.length - this.window);
    const beforeCut = input.charCodeAt(safeEnd - 1);
    const afterCut = input.charCodeAt(safeEnd);
    if (
      beforeCut >= 0xd800 &&
      beforeCut <= 0xdbff &&
      afterCut >= 0xdc00 &&
      afterCut <= 0xdfff
    )
      safeEnd--;
    let cursor = start;
    let output = '';
    this.search.lastIndex = start;
    let match =
      !this.replaced || this.rule.pattern.global
        ? this.search.exec(input)
        : null;
    while (match !== null && (final || match.index < safeEnd)) {
      this.assertWithinBound(input, match);
      output +=
        input.slice(cursor, match.index) +
        substitute(match, this.rule.replacement);
      cursor = match.index + match[0].length;
      this.replaced = true;
      if (match[0].length === 0) {
        const point = input.codePointAt(cursor) ?? 0;
        const advance = this.search.unicode && point > 0xffff ? 2 : 1;
        output += input.slice(cursor, cursor + advance);
        cursor += advance;
        this.search.lastIndex = cursor;
      }
      match = this.rule.pattern.global ? this.search.exec(input) : null;
    }
    const end = Math.max(cursor, safeEnd);
    output += input.slice(cursor, end);
    // A full rule-width of left context also supports bounded lookbehind.
    this.left = final ? '' : input.slice(Math.max(0, end - this.window), end);
    this.pending = final ? '' : input.slice(end);
    return output;
  }
}

function rules(config: RedactionConfig): Rule[] {
  const result: Rule[] = [];
  const add = (pattern: RegExp, replacement: Replacement): void => {
    result.push({
      pattern: boundedPattern(pattern),
      original: pattern,
      replacement,
    });
  };
  if (config.redactApiKeys) {
    add(/sk-[a-zA-Z0-9]{32,}/g, '[REDACTED-API-KEY]');
    add(/sk-proj-[a-zA-Z0-9]{48}/g, '[REDACTED-OPENAI-PROJECT-KEY]');
    add(/sk-ant-[a-zA-Z0-9_-]{95}/g, '[REDACTED-ANTHROPIC-KEY]');
    add(/AIza[0-9A-Za-z_-]{35}/g, '[REDACTED-GOOGLE-KEY]');
  }
  if (config.redactCredentials) {
    add(
      /(?<![a-zA-Z0-9_-])(?:password|pwd|pass)(?=[=: \n\r\t"'])[ \n\r\t"']*[=:]?[ \n\r\t"']*[^ \n\r\t"']*/gi,
      'password=[REDACTED]',
    );
    add(/bearer [a-zA-Z0-9_.-]{16,}/gi, 'bearer [REDACTED-BEARER-TOKEN]');
  }
  if (config.redactFilePaths) {
    for (const [marker, replacement] of [
      ['.ssh/', '[REDACTED-SSH-PATH]'],
      ['.env', '[REDACTED-ENV-FILE]'],
    ]) {
      add(/\/[^ \n\r\t"]*/g, (match) =>
        match.includes(marker) ? replacement : match,
      );
    }
    add(/\/home\/[^/ \n\r\t"]+/g, '[REDACTED-HOME-DIR]');
    add(/\/Users\/[^/ \n\r\t"]+/g, '[REDACTED-USER-DIR]');
  }
  if (config.redactUrls) add(/https?:\/\/[^\s"']+/g, '[REDACTED-URL]');
  if (config.redactEmails)
    add(/[a-zA-Z0-9._%+@-]+/g, (token) => {
      const at = token.indexOf('@');
      return at > 0 &&
        token.indexOf('@', at + 1) === -1 &&
        token.indexOf('.', at + 2) > at
        ? '[REDACTED-EMAIL]'
        : token;
    });
  if (config.redactPersonalInfo) {
    add(/[^ \n\r\t"']+/g, (token) =>
      /^\d{3}-\d{3}-\d{4}$/.test(token) ? '[REDACTED-PHONE]' : token,
    );
    add(
      /(?<![a-zA-Z0-9_-])\d{4}[- \n\r\t]?\d{4}[- \n\r\t]?\d{4}[- \n\r\t]?\d{4}(?![a-zA-Z0-9_-])/g,
      '[REDACTED-CC-NUMBER]',
    );
  }
  for (const rule of config.customPatterns ?? [])
    if (rule.enabled) add(rule.pattern, rule.replacement);
  return result;
}

export class StreamingRedactor {
  private readonly stages: RuleStream[];
  readonly retentionLimit: number;
  constructor(config: RedactionConfig) {
    this.stages = rules(config).map((rule) => new RuleStream(rule));
    this.retentionLimit = this.stages.reduce(
      (sum, stage) => sum + stage.window * 2 + 2,
      0,
    );
  }
  get retainedChars(): number {
    return this.stages.reduce((sum, stage) => sum + stage.retainedChars, 0);
  }
  push(text: string): string {
    return this.stages.reduce((output, stage) => stage.push(output), text);
  }
  finish(): string {
    return this.stages.reduce((output, stage) => stage.push(output, true), '');
  }
}
