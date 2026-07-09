/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { isDestructiveCommand } from '@vybestack/llxprt-code-policy';

/**
 * Canonical fork-bomb regression anchors asserted across multiple describe
 * blocks to guard against regressions in any detection path. Spread into any
 * block that needs cross-cutting bomb/guard coverage.
 */
const FORK_BOMB_REGRESSIONS: ReadonlyArray<[string, boolean]> = [
  [':(){ :|:& };:', true],
  [':(){ { :|:& }; };:', true],
  ['bomb(){ bomb|bomb & }; bomb', true],
  ['f(){ f|f& }; f', true],
  ['function b { b|b& }; b', true],
  ['function f() { f|f& }; f', true],
  ['foo(){ echo bar | baz & }; foo', false],
  ['echo ":(){ :|:& };:"', false],
];

/**
 * Canonical env --split-string / -S regression anchors shared across the env
 * describe blocks.
 */
const ENV_REGRESSIONS: ReadonlyArray<[string, boolean]> = [
  ['env --split-string="rm -rf /"', true],
  ['env -Srm -rf /', true],
  ['env --split-string="ls -la"', false],
  ['env -S "echo hi"', false],
];

describe('>&FILE credential redirect (false negative)', () => {
  it.each<[string, boolean]>([
    ['echo x >&~/.ssh/authorized_keys', true],
    ['echo x > ~/.ssh/authorized_keys', true],
    ['echo x >~/.ssh/authorized_keys', true],
    ['echo x >> ~/.ssh/authorized_keys', true],
    ['echo x 2> ~/.ssh/authorized_keys', true],
    ['echo x &> ~/.ssh/authorized_keys', true],
    ['echo x &>> ~/.ssh/authorized_keys', true],
    ['echo x >&2', false],
    ['echo x 2>&1', false],
    ['ls >&/dev/null', false],
    ['echo hi > out.txt', false],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('nested-brace fork bombs (false negative)', () => {
  it.each<[string, boolean]>([
    ['function b { { b|b& }; }; b', true],
    ['function log { echo hi | cat & }; log', false],
    ['function deploy { build && push; }; deploy', false],
    ...FORK_BOMB_REGRESSIONS,
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('fork-bomb self-reference whole-token matching (false positive)', () => {
  it.each<[string, boolean]>([
    ['log(){ catalog|catalog & }; log', false],
    ['check(){ checkbox | checklist & }; check', false],
    ['f(){f|f&};foo', false],
    ['check(){ checkbox|checklist & }; checkout', false],
    ...FORK_BOMB_REGRESSIONS,
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('hybrid function NAME() { ... } fork bomb (false negative)', () => {
  it.each<[string, boolean]>([
    ['function f() { f|f& }; f', true],
    ['function bomb() { bomb|bomb & }; bomb', true],
    ['function deploy() { build && push; }; deploy', false],
    ['function f() { g|g& }; f', false],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('redirect target quoting variants', () => {
  it.each<[string, boolean]>([
    ['echo x >& ~/.ssh/authorized_keys', true],
    ['echo x > "~/.ssh/authorized_keys"', true],
    ["echo x > '~/.ssh/authorized_keys'", true],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('$HOME prefix word boundary (false positive)', () => {
  it.each<[string, boolean]>([
    ['rm -rf $HOMEDIR/..', false],
    ['rm -rf $HOMELAND', false],
    ['rm -rf ${HOMEDIR}/..', false],
    ['rm -rf $HOME', true],
    ['rm -rf $HOME/..', true],
    ['rm -rf ${HOME}/..', true],
    ['rm -rf ~/..', true],
    ['rm -rf $HOME/.cache', false],
    ['rm -rf $HOME/build', false],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('env split-string re-evaluates embedded command (false negative)', () => {
  it.each<[string, boolean]>([
    ["env --split-string='rm -rf /'", true],
    ['env -S "rm -rf /"', true],
    ['env -u PATH rm -rf /', true],
    ['env --unset=PATH rm -rf /', true],
    ['env -C /tmp rm -rf /', true],
    ['env rm -rf /', true],
    ['env -u PATH ls', false],
    ...ENV_REGRESSIONS,
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('~/.aws/config credential scope extension', () => {
  it.each<[string, boolean]>([
    ['echo x > ~/.aws/config', true],
    ['tee ~/.aws/config', true],
    ['echo x > $HOME/.aws/config', true],
    ['echo x > ~/.aws/credentials', true],
    ['cat ~/.aws/config', false],
    ['echo x > ~/.aws/cli/cache', false],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('fork bomb preceded by another command (false negative)', () => {
  it.each<[string, boolean]>([
    ['echo hi; :(){ :|:& }; :', true],
    ['ls && :(){ :|:& };:', true],
    ['true; bomb(){ bomb|bomb & }; bomb', true],
    ['echo hi; ls', false],
    ['git commit -m ":(){ :|:& };:"', false],
    ...FORK_BOMB_REGRESSIONS,
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('logical && in body is not a background & (false positive)', () => {
  it.each<[string, boolean]>([
    ['f(){ f | cat && echo done }; f', false],
    ['deploy(){ deploy | log && ok }; deploy', false],
    ...FORK_BOMB_REGRESSIONS.filter(
      ([cmd]) =>
        cmd === ':(){ :|:& };:' ||
        cmd === 'f(){ f|f& }; f' ||
        cmd === 'bomb(){ bomb|bomb & }; bomb' ||
        cmd === 'function b { b|b& }; b',
    ),
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('Fix 3: wrapper-aware env --split-string (false negative)', () => {
  it.each<[string, boolean]>([
    ['sudo env --split-string="rm -rf /"', true],
    ['doas env --split-string="rm -rf /"', true],
    ['sudo env -Srm -rf /', true],
    ['env -S "rm -rf /"', true],
    ['sudo env -S rm -rf /', true],
    ['sudo env --split-string="ls -la"', false],
    ['sudo ls', false],
    ...ENV_REGRESSIONS.filter(
      ([cmd]) =>
        cmd === 'env --split-string="rm -rf /"' ||
        cmd === 'env -Srm -rf /' ||
        cmd === 'env --split-string="ls -la"',
    ),
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('Pattern C4: env -S / --split-string payload', () => {
  it.each<[string, boolean]>([
    ["env -S 'rm -rf /'", true],
    ["env --split-string 'rm -rf /'", true],
    ["env --split-string='rm -rf /'", true],
    ["sudo env --split-string='rm -rf /'", true],
    ["env -S 'echo hi'", false],
    ["env --split-string='ls -la'", false],
    ['env -u PATH ls', false],
    ...ENV_REGRESSIONS.filter(([cmd]) => cmd === 'env -Srm -rf /'),
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('Fix 1: fork-bomb brace matcher ignores quotes (false negative)', () => {
  const braceMatcherAnchors = new Set([
    ':(){ { :|:& }; };:',
    ':(){ :|:& };:',
    'function f() { f|f& }; f',
    'foo(){ echo bar | baz & }; foo',
    'echo ":(){ :|:& };:"',
  ]);
  it.each<[string, boolean]>([
    ['f(){ echo "}" | f & }; f', true],
    ["f(){ echo '}' | f & }; f", true],
    ...FORK_BOMB_REGRESSIONS.filter(([cmd]) => braceMatcherAnchors.has(cmd)),
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('Fix 2: double-semicolon tail after closing brace (false negative)', () => {
  it.each<[string, boolean]>([
    ['f(){ f|f& };;f', true],
    [':(){ :|:& };;:', true],
    ['f(){ f|f& };f', true],
    ['foo(){ echo bar|baz & };;foo', false],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('standalone background operator excludes &&, >&, <&, &>', () => {
  it.each<[string, boolean]>([
    // `<&` fd-duplication input is not a standalone background `&`.
    ['f(){ f<&0|f }; f', false],
    // `&>` / `&>>` redirect (stdout+stderr) is not a standalone background `&`.
    ['f(){ f|f&>logfile }; f', false],
    ['f(){ f|f&>>logfile }; f', false],
    // Real bombs must still be detected.
    ...FORK_BOMB_REGRESSIONS.filter(
      ([cmd]) =>
        cmd === ':(){ :|:& };:' ||
        cmd === 'f(){ f|f& }; f' ||
        cmd === 'bomb(){ bomb|bomb & }; bomb',
    ),
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('scanner finds a later bomb after an earlier definition', () => {
  it.each<[string, boolean]>([
    // Benign def FIRST, real bomb SECOND — scanner must still find the bomb
    // after skipping the first definition's body.
    ['helper(){ echo hi; }; :(){ :|:& };:', true],
    // Bomb FIRST, benign def second — still detected.
    [':(){ :|:& };:; helper(){ echo ok; }; helper', true],
    // Regression guards from the issue spec.
    ['echo hi; :(){ :|:& }; :', true],
    ['ls && :(){ :|:& };:', true],
    ['true; bomb(){ bomb|bomb & }; bomb', true],
    // Shared regression anchors (must-stay-TRUE bombs and must-stay-FALSE
    // guards) — spread for cross-cutting coverage of the scanner path.
    ...FORK_BOMB_REGRESSIONS,
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('Fix 1 separator: fork-bomb invocation separated by &&, ||, &, newline (false negative)', () => {
  it.each<[string, boolean]>([
    // The function-definition `}` is followed by a separator other than `;`.
    [':(){ :|:& } && :', true],
    [':(){ :|:& } || :', true],
    [':(){ :|:& } & :', true],
    [':(){ :|:& }\n:', true],
    ['bomb(){ bomb|bomb & } && bomb', true],
    ['function b { b|b& } && b', true],
    // MUST STAY TRUE (regressions across all separator forms).
    [':(){ :|:& };;:', true],
    ['f(){ echo "}" | f & }; f', true],
    // MUST STAY FALSE (guards).
    ['function deploy { build && push; }; deploy', false],
    ['f(){ f | cat && echo done }; f', false],
    ...FORK_BOMB_REGRESSIONS.filter(
      ([cmd]) =>
        cmd === ':(){ :|:& };:' ||
        cmd === ':(){ { :|:& }; };:' ||
        cmd === 'foo(){ echo bar | baz & }; foo' ||
        cmd === 'echo ":(){ :|:& };:"',
    ),
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('Fix 2: scanner advances via bodyEnd without redundant re-scan', () => {
  it.each<[string, boolean]>([
    // A benign def before a real bomb must still let the scanner find the
    // bomb after skipping the first definition's body.
    ['helper(){ echo hi; }; :(){ :|:& };:', true],
    ['a(){ echo 1; }; b(){ echo 2; }; :(){ :|:& };:', true],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('Fix 3: functionfoo is not mistaken for a keyword definition', () => {
  it.each<[string, boolean]>([
    // `functionfoo` is a single command name, NOT `function foo`. After
    // whitespace collapse `function b {...}` becomes `functionb{...}`, so a
    // naive post-keyword name-char check is unsafe; this documents that the
    // FP does not occur because the body does not self-recurse.
    ['functionfoo(){ echo hi; }; foo', false],
    ['function b { b|b& }; b', true],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('escaped quote does not desync quote tracker (false negative)', () => {
  it.each<[string, boolean]>([
    // A backslash-escaped `\"` is a literal quote, NOT a quote toggle. The
    // bomb after the `;` must still be detected.
    ['echo \\"; :(){ :|:& }; :', true],
    // Quoted bomb text must stay FALSE (real quotes, not escaped).
    ['echo ":(){ :|:& };:"', false],
    // Regression anchors.
    ...FORK_BOMB_REGRESSIONS.filter(([cmd]) =>
      [':(){ :|:& };:', 'foo(){ echo bar | baz & }; foo'].includes(cmd),
    ),
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});
