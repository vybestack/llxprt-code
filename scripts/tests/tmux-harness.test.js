/**
 * Unit tests for pure functions in scripts/tmux-harness.js.
 *
 * These functions are imported via dynamic import since the source is ESM.
 * The refactoring goal (issue #1914) is to reduce cyclomatic complexity
 * without changing behavior, so these tests guard against regressions.
 */

import { describe, it, expect } from 'vitest';

async function importHarness() {
  return import('../tmux-harness.js');
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------
describe('parseArgs', () => {
  it('returns defaults with empty argv', async () => {
    const { parseArgs } = await importHarness();
    const opts = parseArgs([]);
    expect(opts.scenario).toBeUndefined();
    expect(opts.scriptPath).toBeUndefined();
    expect(opts.outDir).toBeUndefined();
    expect(opts.cols).toBeUndefined();
    expect(opts.rows).toBeUndefined();
    expect(opts.initialWaitMs).toBeUndefined();
    expect(opts.historyLimit).toBeUndefined();
    expect(opts.scrollbackLines).toBeUndefined();
    expect(opts.yolo).toBe(false);
    expect(opts.keepSession).toBe(false);
    expect(opts.assert).toBe(false);
  });

  it('parses --scenario haiku', async () => {
    const { parseArgs } = await importHarness();
    const opts = parseArgs(['--scenario', 'haiku']);
    expect(opts.scenario).toBe('haiku');
  });

  it('parses --scenario scrollback', async () => {
    const { parseArgs } = await importHarness();
    const opts = parseArgs(['--scenario', 'scrollback']);
    expect(opts.scenario).toBe('scrollback');
  });

  it('rejects invalid --scenario', async () => {
    const { parseArgs } = await importHarness();
    expect(() => parseArgs(['--scenario', 'bogus'])).toThrow(
      'Invalid --scenario: bogus',
    );
  });

  it('parses --script path', async () => {
    const { parseArgs } = await importHarness();
    const opts = parseArgs(['--script', '/tmp/test.json']);
    expect(opts.scriptPath).toBe('/tmp/test.json');
  });

  it('parses --out-dir path', async () => {
    const { parseArgs } = await importHarness();
    const opts = parseArgs(['--out-dir', '/tmp/out']);
    expect(opts.outDir).toBe('/tmp/out');
  });

  it('parses numeric flags: --cols --rows --initial-wait-ms --history-limit --scrollback-lines', async () => {
    const { parseArgs } = await importHarness();
    const opts = parseArgs([
      '--cols',
      '160',
      '--rows',
      '50',
      '--initial-wait-ms',
      '3000',
      '--history-limit',
      '99999',
      '--scrollback-lines',
      '5000',
    ]);
    expect(opts.cols).toBe(160);
    expect(opts.rows).toBe(50);
    expect(opts.initialWaitMs).toBe(3000);
    expect(opts.historyLimit).toBe(99999);
    expect(opts.scrollbackLines).toBe(5000);
  });

  it('rejects invalid --cols (zero)', async () => {
    const { parseArgs } = await importHarness();
    expect(() => parseArgs(['--cols', '0'])).toThrow(/Invalid --cols/);
  });

  it('rejects invalid --cols (negative)', async () => {
    const { parseArgs } = await importHarness();
    expect(() => parseArgs(['--cols', '-5'])).toThrow(
      /Missing value for --cols/,
    );
  });

  it('rejects invalid --rows (NaN)', async () => {
    const { parseArgs } = await importHarness();
    expect(() => parseArgs(['--rows', 'abc'])).toThrow(/Invalid --rows/);
  });

  it('rejects negative --initial-wait-ms', async () => {
    const { parseArgs } = await importHarness();
    expect(() => parseArgs(['--initial-wait-ms', '-1'])).toThrow(
      /Missing value for --initial-wait-ms/,
    );
  });

  it('rejects zero --history-limit', async () => {
    const { parseArgs } = await importHarness();
    expect(() => parseArgs(['--history-limit', '0'])).toThrow(
      /Invalid --history-limit/,
    );
  });

  it('rejects zero --scrollback-lines', async () => {
    const { parseArgs } = await importHarness();
    expect(() => parseArgs(['--scrollback-lines', '0'])).toThrow(
      /Invalid --scrollback-lines/,
    );
  });

  it('parses boolean flags: --yolo --keep-session --assert', async () => {
    const { parseArgs } = await importHarness();
    const opts = parseArgs(['--yolo', '--keep-session', '--assert']);
    expect(opts.yolo).toBe(true);
    expect(opts.keepSession).toBe(true);
    expect(opts.assert).toBe(true);
  });

  it('rejects unknown args', async () => {
    const { parseArgs } = await importHarness();
    expect(() => parseArgs(['--bogus'])).toThrow('Unknown args');
  });

  it('rejects missing value for --script', async () => {
    const { parseArgs } = await importHarness();
    expect(() => parseArgs(['--script'])).toThrow('Missing value for --script');
  });

  it('rejects flag-like value for --script', async () => {
    const { parseArgs } = await importHarness();
    expect(() => parseArgs(['--script', '--yolo'])).toThrow(
      'Missing value for --script',
    );
  });
});

// ---------------------------------------------------------------------------
// buildStartArgs
// ---------------------------------------------------------------------------
describe('buildStartArgs', () => {
  it('returns the default command when no script command is provided', async () => {
    const { buildStartArgs } = await importHarness();
    expect(buildStartArgs(null, false)).toEqual(['node', 'scripts/start.js']);
  });

  it('appends --yolo to a copied script start command without mutating the script', async () => {
    const { buildStartArgs } = await importHarness();
    const script = { startCommand: ['node', 'scripts/start.js'] };

    expect(buildStartArgs(script, true)).toEqual([
      'node',
      'scripts/start.js',
      '--yolo',
    ]);
    expect(script.startCommand).toEqual(['node', 'scripts/start.js']);
  });

  it('does not duplicate --yolo when already present', async () => {
    const { buildStartArgs } = await importHarness();
    const script = { startCommand: ['node', 'scripts/start.js', '--yolo'] };

    expect(buildStartArgs(script, true)).toEqual([
      'node',
      'scripts/start.js',
      '--yolo',
    ]);
  });

  it('rejects invalid script start commands', async () => {
    const { buildStartArgs } = await importHarness();
    const message =
      'Invalid script.startCommand: expected non-empty array of strings';

    expect(() => buildStartArgs({ startCommand: [] }, false)).toThrow(message);
    expect(() => buildStartArgs({ startCommand: 'node' }, false)).toThrow(
      message,
    );
    expect(() => buildStartArgs({ startCommand: ['node', 42] }, false)).toThrow(
      message,
    );
  });
});

// ---------------------------------------------------------------------------
// compileMatcher / matchText / formatMatcher
// ---------------------------------------------------------------------------
describe('compileMatcher', () => {
  it('creates contains matcher', async () => {
    const { compileMatcher } = await importHarness();
    const m = compileMatcher({ contains: 'hello' });
    expect(m.kind).toBe('contains');
    expect(m.value).toBe('hello');
  });

  it('creates regex matcher', async () => {
    const { compileMatcher } = await importHarness();
    const m = compileMatcher({ regex: 'h.llo', regexFlags: 'i' });
    expect(m.kind).toBe('regex');
    expect(m.value.test('HELLO')).toBe(true);
  });

  it('creates regex matcher without flags', async () => {
    const { compileMatcher } = await importHarness();
    const m = compileMatcher({ regex: 'hello' });
    expect(m.kind).toBe('regex');
    expect(m.value.flags).toBe('');
  });

  it('throws on missing both contains and regex', async () => {
    const { compileMatcher } = await importHarness();
    expect(() => compileMatcher({})).toThrow('Matcher requires');
  });
});

describe('matchText', () => {
  it('matches contains', async () => {
    const { matchText } = await importHarness();
    expect(matchText('hello world', { kind: 'contains', value: 'world' })).toBe(
      true,
    );
    expect(matchText('hello world', { kind: 'contains', value: 'xyz' })).toBe(
      false,
    );
  });

  it('resets stateful regex matchers before each test', async () => {
    const { matchText } = await importHarness();
    const matcher = { kind: 'regex', value: /hello/g };

    expect(matchText('hello', matcher)).toBe(true);
    expect(matchText('hello', matcher)).toBe(true);
  });

  it('matches regex', async () => {
    const { matchText } = await importHarness();
    expect(
      matchText('hello', {
        kind: 'regex',
        value: /^hel/,
      }),
    ).toBe(true);
    expect(
      matchText('hello', {
        kind: 'regex',
        value: /^xyz/,
      }),
    ).toBe(false);
  });
});

describe('formatMatcher', () => {
  it('formats contains matcher', async () => {
    const { formatMatcher } = await importHarness();
    expect(formatMatcher({ kind: 'contains', value: 'foo' })).toBe(
      'contains "foo"',
    );
  });

  it('formats regex matcher', async () => {
    const { formatMatcher } = await importHarness();
    const re = /test/gi;
    expect(formatMatcher({ kind: 'regex', value: re })).toBe(
      `regex /${re.source}/${re.flags}`,
    );
  });
});

// ---------------------------------------------------------------------------
// countMatches
// ---------------------------------------------------------------------------
describe('countMatches', () => {
  it('counts substring occurrences', async () => {
    const { countMatches } = await importHarness();
    expect(countMatches('abcabcabc', { kind: 'contains', value: 'abc' })).toBe(
      3,
    );
  });

  it('counts overlapping substrings (non-overlapping)', async () => {
    const { countMatches } = await importHarness();
    expect(countMatches('aaa', { kind: 'contains', value: 'aa' })).toBe(1);
  });

  it('returns 0 for empty needle', async () => {
    const { countMatches } = await importHarness();
    expect(countMatches('abc', { kind: 'contains', value: '' })).toBe(0);
  });

  it('counts regex matches (adds g flag if missing)', async () => {
    const { countMatches } = await importHarness();
    expect(
      countMatches('a1b2c3', {
        kind: 'regex',
        value: /\d/,
      }),
    ).toBe(3);
  });

  it('counts regex matches with existing g flag', async () => {
    const { countMatches } = await importHarness();
    expect(
      countMatches('a1b2c3', {
        kind: 'regex',
        value: /\d/g,
      }),
    ).toBe(3);
  });

  it('returns 0 for no regex matches', async () => {
    const { countMatches } = await importHarness();
    expect(
      countMatches('abc', {
        kind: 'regex',
        value: /\d/,
      }),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// sanitizeLabel
// ---------------------------------------------------------------------------
describe('sanitizeLabel', () => {
  it('replaces non-alphanumeric chars with underscore', async () => {
    const { sanitizeLabel } = await importHarness();
    expect(sanitizeLabel('hello world!')).toBe('hello_world');
  });

  it('strips leading/trailing underscores', async () => {
    const { sanitizeLabel } = await importHarness();
    expect(sanitizeLabel('_foo_')).toBe('foo');
  });

  it('keeps dots, dashes, underscores', async () => {
    const { sanitizeLabel } = await importHarness();
    expect(sanitizeLabel('my-label_v1.0')).toBe('my-label_v1.0');
  });
});

// ---------------------------------------------------------------------------
// deepCloneJson / applyMacroArgs
// ---------------------------------------------------------------------------
describe('deepCloneJson', () => {
  it('deep clones a value', async () => {
    const { deepCloneJson } = await importHarness();
    const obj = { a: [1, 2], b: 'c' };
    const clone = deepCloneJson(obj);
    expect(clone).toEqual(obj);
    expect(clone).not.toBe(obj);
    clone.a.push(3);
    expect(obj.a).toEqual([1, 2]);
  });
});

describe('applyMacroArgs', () => {
  it('replaces exact variable reference', async () => {
    const { applyMacroArgs } = await importHarness();
    expect(applyMacroArgs('${NAME}', { NAME: 'hello' })).toBe('hello');
  });

  it('interpolates within a string', async () => {
    const { applyMacroArgs } = await importHarness();
    expect(applyMacroArgs('prefix-${NAME}-suffix', { NAME: 'val' })).toBe(
      'prefix-val-suffix',
    );
  });

  it('leaves unknown variables untouched', async () => {
    const { applyMacroArgs } = await importHarness();
    expect(applyMacroArgs('${MISSING}', { NAME: 'hello' })).toBe('${MISSING}');
  });

  it('applies recursively to arrays', async () => {
    const { applyMacroArgs } = await importHarness();
    expect(applyMacroArgs(['${A}', '${B}'], { A: '1', B: '2' })).toEqual([
      '1',
      '2',
    ]);
  });

  it('applies recursively to objects', async () => {
    const { applyMacroArgs } = await importHarness();
    expect(applyMacroArgs({ key: '${A}' }, { A: '1' })).toEqual({ key: '1' });
  });

  it('returns non-string primitives unchanged', async () => {
    const { applyMacroArgs } = await importHarness();
    expect(applyMacroArgs(42, {})).toBe(42);
    expect(applyMacroArgs(null, {})).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// expandScriptMacros
// ---------------------------------------------------------------------------
describe('expandScriptMacros', () => {
  it('returns steps unchanged when macros is null', async () => {
    const { expandScriptMacros } = await importHarness();
    const steps = [{ type: 'wait', ms: 100 }];
    expect(expandScriptMacros(steps, null)).toEqual(steps);
  });

  it('returns steps unchanged when macros is undefined', async () => {
    const { expandScriptMacros } = await importHarness();
    const steps = [{ type: 'wait', ms: 100 }];
    expect(expandScriptMacros(steps, undefined)).toEqual(steps);
  });

  it('expands a macro step', async () => {
    const { expandScriptMacros } = await importHarness();
    const steps = [
      { type: 'macro', name: 'greet', args: { NAME: 'world' } },
      { type: 'wait', ms: 100 },
    ];
    const macros = {
      greet: [{ type: 'line', text: 'Hello ${NAME}' }],
    };
    const result = expandScriptMacros(steps, macros);
    expect(result).toEqual([
      { type: 'line', text: 'Hello world' },
      { type: 'wait', ms: 100 },
    ]);
  });

  it('detects macro cycles', async () => {
    const { expandScriptMacros } = await importHarness();
    const steps = [{ type: 'macro', name: 'a' }];
    const macros = {
      a: [{ type: 'macro', name: 'b' }],
      b: [{ type: 'macro', name: 'a' }],
    };
    expect(() => expandScriptMacros(steps, macros)).toThrow('Macro cycle');
  });

  it('rejects non-array steps', async () => {
    const { expandScriptMacros } = await importHarness();
    expect(() => expandScriptMacros('bad', {})).toThrow('must be an array');
  });

  it('rejects non-object macros', async () => {
    const { expandScriptMacros } = await importHarness();
    expect(() => expandScriptMacros([], 42)).toThrow('must be an object');
  });

  it('rejects empty-named macro', async () => {
    const { expandScriptMacros } = await importHarness();
    const steps = [{ type: 'macro', name: '  ' }];
    expect(() => expandScriptMacros(steps, {})).toThrow('non-empty');
  });

  it('rejects non-array macro template', async () => {
    const { expandScriptMacros } = await importHarness();
    const steps = [{ type: 'macro', name: 'bad' }];
    const macros = { bad: 'not-array' };
    expect(() => expandScriptMacros(steps, macros)).toThrow('must be an array');
  });
});

// ---------------------------------------------------------------------------
// parseToolConfirmationOptions
// ---------------------------------------------------------------------------
describe('parseToolConfirmationOptions', () => {
  it('parses numbered options with Yes/No/Modify labels', async () => {
    const { parseToolConfirmationOptions } = await importHarness();
    const screen = [
      '1. Yes, allow once',
      '2. Yes, allow always',
      '3. No, deny',
    ].join('\n');
    const options = parseToolConfirmationOptions(screen);
    expect(options).toHaveLength(3);
    expect(options[0]).toEqual({
      number: 1,
      label: 'Yes, allow once',
      selected: false,
    });
  });

  it('detects selected option with bullet', async () => {
    const { parseToolConfirmationOptions } = await importHarness();
    const screen = '  ●1. Yes, allow once\n  2. No, deny';
    const options = parseToolConfirmationOptions(screen);
    expect(options[0].selected).toBe(true);
    expect(options[1].selected).toBe(false);
  });

  it('ignores options that do not start with yes/no/modify', async () => {
    const { parseToolConfirmationOptions } = await importHarness();
    const screen = '1. Maybe later\n2. Yes, allow once';
    const options = parseToolConfirmationOptions(screen);
    expect(options).toHaveLength(1);
    expect(options[0].label).toBe('Yes, allow once');
  });

  it('returns empty array for no matches', async () => {
    const { parseToolConfirmationOptions } = await importHarness();
    const options = parseToolConfirmationOptions('nothing here');
    expect(options).toEqual([]);
  });

  it('handles box-drawing characters in line', async () => {
    const { parseToolConfirmationOptions } = await importHarness();
    const screen = '│ 1. Yes, allow once │\n│ 2. No, deny         │';
    const options = parseToolConfirmationOptions(screen);
    expect(options).toHaveLength(2);
  });
});
