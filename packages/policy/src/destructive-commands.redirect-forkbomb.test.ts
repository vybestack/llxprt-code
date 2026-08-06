/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
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

describe('~/.aws/ directory credential scope (prefix match)', () => {
  it.each<[string, boolean]>([
    ['echo x > ~/.aws/config', true],
    ['tee ~/.aws/config', true],
    ['echo x > $HOME/.aws/config', true],
    ['echo x > ~/.aws/credentials', true],
    ['echo x > ~/.aws/cli/cache', true],
    ['cat ~/.aws/config', false],
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

describe('Fix A: function keyword boundary (false positive)', () => {
  it.each<[string, boolean]>([
    // `functionfoo` is a single token — `function` keyword NOT followed by a
    // name boundary (space or `(`), so it is not the keyword form. The POSIX
    // scanner sees name `functionfoo` but the body references `foo` (not the
    // same name), so no self-reference — must be FALSE.
    ['functionfoo(){ foo|foo& }; foo', false],
    ['myfunction(){ x|x& }; x', false],
    // MUST STAY TRUE: real `function NAME` with a name boundary after `function`.
    ['function b { b|b& }; b', true],
    ['function bomb { bomb|bomb& }; bomb', true],
    [':(){ :|:& };:', true],
    ['bomb(){ bomb|bomb& }; bomb', true],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('Fix B: |& pipe operator is not a standalone background & (false positive)', () => {
  it.each<[string, boolean]>([
    // `|&` is shorthand for `2>&1 |` — the `&` is part of the pipe operator,
    // NOT a standalone background `&`. A body whose only `&` is part of `|&`
    // and that does not truly recurse must be FALSE.
    ['myfunc() { myfunc |& cat; }; myfunc', false],
    // MUST STAY TRUE: `:(){ :|:& };:` — the `&` in `:|:&` follows the second
    // `:`, not `|`, so it IS standalone. `bomb(){ bomb|bomb& }; bomb` — `&`
    // follows `bomb`, standalone.
    [':(){ :|:& };:', true],
    ['bomb(){ bomb|bomb& }; bomb', true],
    ['f(){ f|f& }; f', true],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('Fix C: quoted &/| in fork-bomb body do not count (false positive)', () => {
  it.each<[string, boolean]>([
    // Body has a quoted `|` AND a quoted `&` — neither is a real operator, so
    // the bomb requirement (pipe AND background) is not satisfied.
    ['h() { echo "a | b" "a & b"; h; }; h', false],
    // Body has a quoted `|` (not a real pipe) and a real background `&` — the
    // pipe requirement is NOT satisfied because the only `|` is quoted.
    ['h() { echo "a | b" & echo done; h; }; h', false],
    // Only a quoted `&`, no real pipe at all.
    ['h() { echo "a & b"; h; }; h', false],
    // Only a quoted pipe, no real background.
    ['note() { echo "a | b"; note; }; note', false],
    // MUST STAY TRUE: real unquoted pipe+background+self-ref.
    [':(){ :|:& };:', true],
    ['bomb(){ bomb|bomb& }; bomb', true],
    ['f(){ f|f& }; f', true],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('Fix D: /root and /boot sensitive roots (coverage gap)', () => {
  it.each<[string, boolean]>([
    ['rm -rf /root', true],
    ['rm -rf /boot', true],
    ['rm -fr /boot/', true],
    ['rm -rf /root/..', true],
    ['rm$IFS-rf$IFS/boot', true],
    ['rm${IFS}-rf${IFS}/root', true],
    ['rm -rf /usr/local/x', false],
    ['rm -rf /root/mystuff/build', false],
    ['rm -rf /boot/grub', false],
    ['rm -rf ./root', false],
    ['rm -rf boot', false],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('Fix E: ~/.aws directory prefix (coverage gap)', () => {
  it.each<[string, boolean]>([
    ['echo x > ~/.aws/old-config/credentials', true],
    ['echo x > ~/.aws/backup/config', true],
    ['tee ~/.aws/sso/cache/x.json', true],
    ['echo x > ~/.aws/credentials', true],
    ['echo x > ~/.aws/config', true],
    ['echo x > $HOME/.aws/credentials', true],
    ['echo x > ${HOME}/.aws/config', true],
    ['echo x > ~/.awesome/notes', false],
    ['echo x > ~/.config/myapp/settings.json', false],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('credential targets emitted by command substitutions', () => {
  it.each<[string, boolean]>([
    ['echo test > $(echo ~/.ssh/id_rsa)', true],
    ['tee $(echo ~/.aws/credentials)', true],
    ['dd if=/dev/zero of=$(echo ~/.ssh/authorized_keys)', true],
    ['echo $(echo ~/.ssh/id_rsa) > output.txt', false],
    ['echo test > $(echo output.txt)', false],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('Fix F: quote/escape-aware redirect target extraction (robustness)', () => {
  it.each<[string, boolean]>([
    ['echo x > "~/.aws/old config/credentials"', true],
    ['echo x > "~/.ssh/id_rsa backup"', true],
    ['echo x > ~/.ssh/id_rsa\\ backup', true],
    ['echo x > ~/.ssh/authorized_keys', true],
    ['echo x >> ~/.ssh/id_rsa', true],
    ['echo x >&~/.ssh/authorized_keys', true],
    ['echo x > $HOME/.aws/credentials', true],
    ['echo x > "notes with spaces.txt"', false],
    ['echo x > ./build/log', false],
    ['echo x > ~/notes.md', false],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Defect 1 (SECURITY): redirection after the closing brace is not tolerated.
// In POSIX shell a function definition's closing `}` may be immediately
// followed by redirections before the command separator. These are VALID fork
// bombs.
// ═══════════════════════════════════════════════════════════════════════════
describe('Defect 1: redirection after closing brace (false negative)', () => {
  it.each<[string, boolean]>([
    // Redirection immediately after `}` (no space).
    [':(){ :|:& }>/dev/null;:', true],
    // No space at all before `2>&1`.
    [':(){ :|:&} 2>&1;:', true],
    // Space, then a bare-file redirect, then fd-dup.
    [':(){ :|:& } >f 2>&1;:', true],
    // Non-`:` name with a redirect.
    ['x(){ x|x& } >/dev/null; x', true],
    // MUST stay TRUE — no redirect (baseline bombs).
    [':(){ :|:& };:', true],
    ['bomb(){ bomb|bomb& }; bomb', true],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

// A bare digit after `}` that is NOT a redirect is a bash syntax error
// (`:(){ :|:& }5;:` is invalid). Such cases must stay FALSE.
describe('Defect 1 guard: bare digit after brace is syntax error (stay FALSE)', () => {
  it.each<[string, boolean]>([
    [':(){ :|:& }5;:', false],
    ['x(){ x|x& }3; x', false],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Defect 2 (SECURITY): trailing invocation with an argument or whitespace is
// not matched. The invocation after the definition may carry arguments or
// whitespace.
// ═══════════════════════════════════════════════════════════════════════════
describe('Defect 2: trailing invocation with arg/whitespace (false negative)', () => {
  it.each<[string, boolean]>([
    [':(){ :|:& };: foo', true],
    ['bomb(){ bomb|bomb& }; bomb arg', true],
    // Extra whitespace between `;` and the invocation.
    [':(){ :|:& };   :', true],
    ['bomb(){ bomb|bomb& };   bomb', true],
    // MUST stay TRUE — baseline no-arg invocations.
    [':(){ :|:& };:', true],
    ['bomb(){ bomb|bomb& }; bomb', true],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Defect 1+2 combined: redirect after brace AND invocation with arg.
// ═══════════════════════════════════════════════════════════════════════════
describe('Defect 1+2 combined: redirect after brace and invocation with arg', () => {
  it.each<[string, boolean]>([
    [':(){ :|:& } >/dev/null;: foo', true],
    ['bomb(){ bomb|bomb& } >f 2>&1; bomb arg', true],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Defect 3 (false positive): the `--` end-of-options terminator is ignored
// when locating `-c`. After a bare `--`, all further args are operands, so
// `-c` after `--` is NOT the execute flag.
// ═══════════════════════════════════════════════════════════════════════════
describe('Defect 3: -- terminator neutralizes -c (false positive)', () => {
  it.each<[string, boolean]>([
    // `--` before `-c` neutralizes the execute flag → FALSE.
    ['bash -- -c "rm -rf /"', false],
    ['sh -- -c "rm -rf /"', false],
    // MUST stay TRUE — `-c` before any `--`.
    ['bash -c "rm -rf /"', true],
    ['bash -lc "rm -rf /"', true],
    ['sh -c "rm -rf /"', true],
    // A `--` that is INSIDE a quoted script string is NOT a bare `--`.
    ['bash -c "echo hi -- -c"', false],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Defect 4 (precision): double-quote backslash escape set is over-broad.
// In POSIX double quotes, backslash only escapes `$`, backtick, `"`, `\`, and
// newline; before any other char the backslash is literal.
// ═══════════════════════════════════════════════════════════════════════════
describe('Defect 4: POSIX double-quote backslash escape precision', () => {
  it.each<[string, boolean]>([
    // Inside double quotes, backslash before a non-escapable char (e.g. space)
    // is LITERAL in POSIX — the backslash is retained. The quoted token still
    // runs to the closing quote, so these extract the full path correctly.
    ['echo x > "~/.ssh/id_rsa\\ backup"', true],
    ['echo x > "~/.ssh/id_rsa backup"', true],
    // Outside quotes, backslash-space escapes the space (unchanged behavior).
    ['echo x > ~/.ssh/id_rsa\\ backup', true],
    // Backslash before $ (escapable inside double quotes) — literal $.
    ['echo x > "~/.ssh/\\$key"', true],
    // Backslash before a non-escapable char inside double quotes — the
    // backslash is literal, so the path includes it and must NOT match a
    // credential prefix.
    ['echo x > "notes\\.txt"', false],
    // Benign redirect to a non-credential path with backslash inside double
    // quotes before a non-escapable char — stays benign.
    ['echo x > "foo\\bar"', false],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('multiline and nested-substitution fork-bomb parsing', () => {
  it.each<[string, boolean]>([
    [':() {\n:|:&\n}\n:', true],
    ['bomb() {\nbomb|bomb&\n}\nbomb arg', true],
    [':(){ echo $(printf "}"); :|:& };:', true],
    ['bomb(){ echo `printf "}"`; bomb|bomb& }; bomb', true],
    ['safe(){ echo $(printf "}"); }; safe', false],
    [':(){ :|:& } # comment\n:', true],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('top-level substitutions are not function definitions', () => {
  it.each<[string, boolean]>([
    ['echo $(printf ":(){ :|:& };:")', false],
    ['echo `printf ":(){ :|:& };:"`', false],
    ['echo $(printf "function foo { foo|foo& }; foo")', false],
    ['echo `printf "function foo { foo|foo& }; foo"`', false],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('quoted function-name mentions are not recursive calls', () => {
  it('allows a background pipeline that only logs its function name', () => {
    expect(
      isDestructiveCommand(
        'log() { echo "log: $1" | tee -a /var/log/app.log & }; log',
      ),
    ).toBe(false);
  });
});

describe('Fix H: brace matcher ignores unbalanced braces inside substitutions (false negative)', () => {
  it.each<[string, boolean]>([
    // A lone `}` inside $(...) must not be treated as the body-closing brace.
    [':(){ :|:& $(printf }) };:', true],
    // A lone `{` inside $(...) must not inflate brace depth.
    [':(){ :|:& $(echo {) };:', true],
    // Backtick substitution with an unbalanced brace inside.
    ['bomb(){ bomb|bomb& `printf }` }; bomb', true],
    // Balanced braces inside $(...) still detected (regression anchor).
    [':(){ :|:&$(echo { } ) };:', true],
    // Benign function whose substitution contains a stray brace stays benign.
    ['safe(){ echo $(printf }); }; safe', false],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('Fix G: chmod setuid/setgid symbolic S/=/comma forms (false negative)', () => {
  it.each<[string, boolean]>([
    // Uppercase S sets setuid/setgid without execute — still a privilege bit.
    ['chmod u+S /usr/bin/foo', true],
    ['chmod g+S /usr/bin/foo', true],
    // Assignment operator `=` sets the setuid/setgid bit just like `+`.
    ['chmod u=s /usr/bin/foo', true],
    ['chmod g=s /usr/bin/foo', true],
    // Comma-separated clauses: any clause adding s/S is dangerous.
    ['chmod u+s,g+s /usr/bin/foo', true],
    ['chmod u+s,o+x /usr/bin/foo', true],
    ['chmod o+x,g=s /usr/bin/foo', true],
    // Removal of the bit is NOT dangerous.
    ['chmod u-s /usr/bin/foo', false],
    ['chmod g-s /usr/bin/foo', false],
    // Sticky bit (t/T) is benign, consistent with octal 1777 being allowed.
    ['chmod +t /tmp', false],
    ['chmod o+T /shared', false],
    ['chmod a=rwx file', false],
    ['chmod u+x,g+x file', false],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});

describe('escaped quotes and wrapper operands', () => {
  it.each<[string, boolean]>([
    [':(){ :|:& } >"file\\"name";:', true],
    ['safe(){ echo ok; } >"file\\"name"; safe', false],
    ['xargs -I {} rm -rf /', true],
    ['xargs --replace={} rm -rf /', true],
    ['xargs -L 1 rm -rf /', true],
    ['xargs --max-args 2 rm -rf /', true],
    ['xargs -I {} echo /', false],
    ['chmod 644 4777', false],
    ['chmod -- 4777 /usr/bin/tool', true],
    ['chmod -- +s /usr/bin/tool', true],
    ['chmod -R -- 4777 /usr/bin/tool', true],
    ['env -S "-- rm -rf /"', true],
    ['env --split-string="-- rm -rf /"', true],
    [':(){ :|:& };$(:)', true],
    ['bomb(){ bomb|bomb& };`bomb`', true],
    ['echo hi >&2', false],
    ['chmod -R 755 / 777', false],
    ['bash -c "echo \\$HOME/.ssh/authorized_keys"', false],
  ])('"%s" -> %s', (command, expected) => {
    expect(isDestructiveCommand(command)).toBe(expected);
  });
});
