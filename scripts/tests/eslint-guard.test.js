/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  checkDiff,
  checkCliSourcePolicy,
  checkCoreCentralBypassesInConfig,
  checkCoreDirectiveScopesInConfig,
  checkModuleCentralBypassesInConfig,
  checkModuleDirectiveScopesInConfig,
  extractRuleKey,
  extractScopeArray,
  formatViolations,
  hasInlineEslintDirective,
  hasTypeScriptSuppression,
  scanCliProductionTypeEscapes,
  scanCoreDirectives,
  scanModuleDirectives,
  scanPackageDirectives,
  scanPackageTypeScriptSuppressions,
  scanRootTypeScriptSuppressions,
} from '../check-eslint-guard.js';

const repoRoot = resolve(__dirname, '..', '..');

function diffFor(file, addedLine) {
  return [
    'diff --git a/' + file + ' b/' + file,
    'index 0000000..1111111 100644',
    '--- a/' + file,
    '+++ b/' + file,
    '@@ -1,0 +1,1 @@',
    '+' + addedLine,
  ].join('\n');
}

describe('check-eslint-guard', () => {
  it('rejects newly added inline ESLint disable directives', () => {
    const violations = checkDiff(
      diffFor(
        'packages/core/src/example.ts',
        '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
      ),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain(
      'Inline ESLint disable/enable directives are forbidden',
    );
  });

  describe('TypeScript suppression directives (#2189)', () => {
    it('rejects newly added @ts-ignore in a line comment', () => {
      const violations = checkDiff(
        diffFor(
          'packages/core/src/example.ts',
          'const x = value as any; // @ts-ignore broken overload',
        ),
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('TypeScript suppression');
      expect(violations[0].content).toContain('@ts-ignore');
    });

    it('rejects newly added @ts-expect-error in a block comment', () => {
      const violations = checkDiff(
        diffFor(
          'packages/core/src/example.ts',
          '/* @ts-expect-error legacy overload */',
        ),
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('TypeScript suppression');
      expect(violations[0].content).toContain('@ts-expect-error');
    });

    it('rejects newly added @ts-nocheck directive', () => {
      const violations = checkDiff(
        diffFor('packages/core/src/example.ts', '// @ts-nocheck'),
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('TypeScript suppression');
      expect(violations[0].content).toContain('@ts-nocheck');
    });

    it('does not flag @ts-ignore inside string literals', () => {
      const violations = checkDiff(
        diffFor(
          'packages/core/src/example.ts',
          "const msg = 'use @ts-ignore to silence errors';",
        ),
      );

      expect(violations).toEqual([]);
    });

    it('does not flag @ts-nocheck inside template literals', () => {
      const violations = checkDiff(
        diffFor(
          'packages/core/src/example.ts',
          'const msg = `@ts-nocheck directive`;',
        ),
      );

      expect(violations).toEqual([]);
    });

    it('does not flag @ts-ignore inside regex literals', () => {
      const violations = checkDiff(
        diffFor('packages/core/src/example.ts', 'const re = /@ts-ignore/;'),
      );

      expect(violations).toEqual([]);
    });

    it('does not flag @ts-nocheck inside a block comment string content', () => {
      const violations = checkDiff(
        diffFor(
          'packages/core/src/example.ts',
          'const doc = "/* @ts-nocheck */";',
        ),
      );

      expect(violations).toEqual([]);
    });

    it('flags suppressions in JavaScript files too', () => {
      const violations = checkDiff(
        diffFor('scripts/example.js', '// @ts-ignore'),
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('TypeScript suppression');
    });

    it('rejects a real @ts-ignore added to the guard implementation file', () => {
      // The guard implementation file is an ESLint-directive fixture
      // exemption (shouldCheckInlineDirective returns false for it), but TS
      // suppression scanning must NOT inherit that exemption. hasTypeScript
      // Suppression skips string/template/regex literals, so fixture data is
      // safe, but a real // @ts-ignore comment added to the file must be
      // rejected.
      const violations = checkDiff(
        diffFor('scripts/check-eslint-guard.js', '// @ts-ignore real bug'),
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].file).toBe('scripts/check-eslint-guard.js');
      expect(violations[0].message).toContain('TypeScript suppression');
    });

    it('rejects a real @ts-nocheck added to the guard test fixture file', () => {
      const violations = checkDiff(
        diffFor('scripts/tests/eslint-guard.test.js', '// @ts-nocheck'),
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].file).toBe('scripts/tests/eslint-guard.test.js');
      expect(violations[0].message).toContain('TypeScript suppression');
    });

    it('does not flag TS suppression text inside strings in the guard test fixture', () => {
      // Directive text used as fixture data (inside a string literal) must not
      // trigger a false positive. This proves the literal-skipping in
      // hasTypeScriptSuppression keeps the fixture data safe even though TS
      // suppression scanning is no longer exempted for the guard test file.
      const violations = checkDiff(
        diffFor(
          'scripts/tests/eslint-guard.test.js',
          "const fixture = 'use // @ts-ignore here';",
        ),
      );

      expect(violations).toEqual([]);
    });

    it('does not flag TS suppression text inside template literals in the guard implementation file', () => {
      const violations = checkDiff(
        diffFor(
          'scripts/check-eslint-guard.js',
          'const msg = `@ts-expect-error directive`;',
        ),
      );

      expect(violations).toEqual([]);
    });

    it('does not flag TS suppression text inside regex literals in the guard test fixture', () => {
      const violations = checkDiff(
        diffFor(
          'scripts/tests/eslint-guard.test.js',
          'const re = /@ts-ignore/;',
        ),
      );

      expect(violations).toEqual([]);
    });

    it('does not flag TS suppression text inside a multiline template literal body', () => {
      // Directive text on a continuation line of a multiline template literal
      // must not be flagged. The template opener (backtick) is on the
      // preceding added line; the guard tracks the template state across
      // lines so the @ts-ignore text in the template body is skipped.
      const diff = [
        'diff --git a/packages/core/src/example.ts b/packages/core/src/example.ts',
        'index 0000000..1111111 100644',
        '--- a/packages/core/src/example.ts',
        '+++ b/packages/core/src/example.ts',
        '@@ -1,0 +1,3 @@',
        '+const msg = `',
        '+  This describes @ts-ignore usage in docs',
        '+`;',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('TypeScript suppression'),
      );

      expect(violations).toEqual([]);
    });

    it('does not flag TS suppression text in a template opened on a context line', () => {
      // The template literal opens on a context line (unchanged) and the
      // added line is inside the template body. The guard must track the
      // template state from context lines so the added directive text is
      // skipped.
      const diff = [
        'diff --git a/packages/core/src/example.ts b/packages/core/src/example.ts',
        'index 0000000..1111111 100644',
        '--- a/packages/core/src/example.ts',
        '+++ b/packages/core/src/example.ts',
        '@@ -1,1 +1,2 @@',
        '  const msg = `',
        '+  More text with @ts-ignore inside template',
        '  `;',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('TypeScript suppression'),
      );

      expect(violations).toEqual([]);
    });

    it('does not flag TS suppression text in a template with ${} expression', () => {
      // Template literal with a ${} expression that contains the directive
      // text in its body. The ${} tracking ensures we correctly identify the
      // literal text vs expression context.
      const diff = [
        'diff --git a/packages/core/src/example.ts b/packages/core/src/example.ts',
        'index 0000000..1111111 100644',
        '--- a/packages/core/src/example.ts',
        '+++ b/packages/core/src/example.ts',
        '@@ -1,0 +1,4 @@',
        '+const msg = `',
        '+  prefix ${value} suffix',
        '+  @ts-expect-error in template body',
        '+`;',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('TypeScript suppression'),
      );

      expect(violations).toEqual([]);
    });

    it('still flags a real TS suppression after a closed template literal', () => {
      // A template literal opens and closes, then a real // @ts-ignore
      // comment appears on a later added line. The template state must be
      // cleared after the closing backtick so the real directive is caught.
      const diff = [
        'diff --git a/packages/core/src/example.ts b/packages/core/src/example.ts',
        'index 0000000..1111111 100644',
        '--- a/packages/core/src/example.ts',
        '+++ b/packages/core/src/example.ts',
        '@@ -1,0 +1,4 @@',
        '+const msg = `text`;',
        '+const x = 1;',
        '+// @ts-ignore real suppression',
        '+const y = x as any;',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('TypeScript suppression'),
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].content).toContain('@ts-ignore');
    });

    describe('template expression context (#2189 review finding)', () => {
      // A line can start inside a template literal while ALSO being inside
      // executable ${ ... } expression code, where an at-ts-ignore line
      // comment is a real/effective suppression. The guard tracks full
      // template state (inTemplate + exprDepth) so it distinguishes template
      // literal TEXT (inert directive text) from template ${ ... } EXPRESSION
      // code (real directive comments). These are the end-to-end checkDiff
      // cases for that distinction.

      it('does not flag directive text in a multiline template body', () => {
        // Directive text on a continuation line of a multiline template
        // literal body (literal text, exprDepth === 0) is inert and must not
        // be flagged.
        const diff = [
          'diff --git a/packages/core/src/example.ts b/packages/core/src/example.ts',
          'index 0000000..1111111 100644',
          '--- a/packages/core/src/example.ts',
          '+++ b/packages/core/src/example.ts',
          '@@ -1,0 +1,3 @@',
          '+const msg = `',
          '+  docs mention @ts-ignore here',
          '+`;',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('TypeScript suppression'),
        );

        expect(violations).toEqual([]);
      });

      it('flags a real at-ts-ignore inside a multiline template expression', () => {
        // The template opens on line 1. Line 2 starts in template text but
        // opens a ${ ... } expression and ends inside it (unclosed on the
        // line), with a real at-ts-ignore line comment AFTER the ${ on the
        // same line. Because the comment is in executable expression code it
        // is a real, effective suppression and must be flagged. The directive
        // text appears only as fixture diff data (string content of the test),
        // not as a real source directive.
        const diff = [
          'diff --git a/packages/core/src/example.ts b/packages/core/src/example.ts',
          'index 0000000..1111111 100644',
          '--- a/packages/core/src/example.ts',
          '+++ b/packages/core/src/example.ts',
          '@@ -1,0 +1,3 @@',
          '+const msg = `',
          '+  prefix ${(() => { // @ts-ignore',
          '+    return 1',
          '+  })()} suffix',
          '+`;',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('TypeScript suppression'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].content).toContain('@ts-ignore');
      });

      it('flags a real at-ts-expect-error inside a template expression', () => {
        // The expression is opened by ${ on a prior line, so the added line
        // starts inside the expression (exprDepth > 0). An
        // at-ts-expect-error comment there is executable code and must be
        // flagged.
        const diff = [
          'diff --git a/packages/core/src/example.ts b/packages/core/src/example.ts',
          'index 0000000..1111111 100644',
          '--- a/packages/core/src/example.ts',
          '+++ b/packages/core/src/example.ts',
          '@@ -1,0 +1,4 @@',
          '+const msg = `${',
          '+  // @ts-expect-error real suppression',
          '+  value',
          '+}`;',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('TypeScript suppression'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].content).toContain('@ts-expect-error');
      });

      it('flags a real at-ts-nocheck inside a template expression', () => {
        // Same as above but for at-ts-nocheck, which is also a real
        // suppression when it appears in executable expression code.
        const diff = [
          'diff --git a/packages/core/src/example.ts b/packages/core/src/example.ts',
          'index 0000000..1111111 100644',
          '--- a/packages/core/src/example.ts',
          '+++ b/packages/core/src/example.ts',
          '@@ -1,0 +1,4 @@',
          '+const msg = `${',
          '+  // @ts-nocheck real suppression',
          '+  value',
          '+}`;',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('TypeScript suppression'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].content).toContain('@ts-nocheck');
      });

      it('does not flag template body text after transitioning back from an expression', () => {
        // The template opens, a ${ ... } expression opens and closes on the
        // same line, then a later line is back in template literal text
        // (exprDepth === 0). Directive text on that later line is inert and
        // must not be flagged. This proves the guard correctly tracks the
        // transition back to template text after an expression closes.
        const diff = [
          'diff --git a/packages/core/src/example.ts b/packages/core/src/example.ts',
          'index 0000000..1111111 100644',
          '--- a/packages/core/src/example.ts',
          '+++ b/packages/core/src/example.ts',
          '@@ -1,0 +1,4 @@',
          '+const msg = `',
          '+  prefix ${value} suffix',
          '+  docs mention @ts-ignore here',
          '+`;',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('TypeScript suppression'),
        );

        expect(violations).toEqual([]);
      });
    });

    describe('TypeScript directive comment-start semantics (#2189 review finding)', () => {
      // TypeScript only recognizes @ts-ignore / @ts-expect-error / @ts-nocheck
      // as effective suppressions when the directive appears at the START of
      // the comment text (after optional whitespace). This was verified against
      // TypeScript 5.8.3 (the repo's version) via focused compiler tests in
      // /tmp: a directive preceded by leading prose in a // or /* */ comment
      // is NOT an effective suppression (the compiler reports the error as
      // usual). The guard's TS_SUPPRESSION_START_PATTERN is anchored to the
      // start of the comment, so it matches exactly the directives the
      // TypeScript compiler would treat as effective suppressions — no false
      // negatives for effective suppressions, no false positives for inert
      // prose that merely mentions the directive.

      it('does not flag @ts-ignore after leading prose in a line comment (compiler-inert)', () => {
        const violations = checkDiff(
          diffFor(
            'packages/core/src/example.ts',
            '// see notes @ts-ignore is mentioned here',
          ),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag @ts-expect-error after leading prose in a block comment (compiler-inert)', () => {
        const violations = checkDiff(
          diffFor(
            'packages/core/src/example.ts',
            '/* prose @ts-expect-error inert */',
          ),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag @ts-nocheck after leading prose in a line comment (compiler-inert)', () => {
        const violations = checkDiff(
          diffFor(
            'packages/core/src/example.ts',
            '// note: @ts-nocheck appears later in this comment',
          ),
        );

        expect(violations).toEqual([]);
      });

      it('still flags @ts-ignore at the start of a line comment (compiler-effective)', () => {
        const violations = checkDiff(
          diffFor('packages/core/src/example.ts', '// @ts-ignore real'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('TypeScript suppression');
      });

      it('still flags @ts-expect-error at the start of a block comment (compiler-effective)', () => {
        const violations = checkDiff(
          diffFor(
            'packages/core/src/example.ts',
            '/* @ts-expect-error real */',
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('TypeScript suppression');
      });
    });
  });

  it('rejects new eslint config off entries without explicit policy marker', () => {
    const violations = checkDiff(
      diffFor('eslint.config.js', "      'complexity': 'off',"),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('eslint-policy-allow-off');
  });

  it('allows explicitly documented eslint config off entries', () => {
    const violations = checkDiff(
      diffFor(
        'eslint.config.js',
        "      'sonarjs/os-command': 'off', // eslint-policy-allow-off: #2079",
      ),
    );

    expect(violations).toEqual([]);
  });

  it('rejects new numeric array-form off rule entries like [0]', () => {
    const violations = checkDiff(
      diffFor('eslint.config.js', "      'no-console': [0],"),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('eslint-policy-allow-off');
  });

  it('rejects new numeric array-form off rule entries like [0, ...]', () => {
    const violations = checkDiff(
      diffFor('eslint.config.js', "      'no-console': [0, { allow: [] }],"),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('eslint-policy-allow-off');
  });

  describe('keyed multiline opener off/0 detection (#2189 review finding)', () => {
    // A newly added keyed multiline opener where the rule key and the off/0
    // severity are on the same opener line (e.g. "'no-console': ['off',")
    // must be rejected. Previously, updateStructuralContext ran before the
    // off/0 gate and set insideRuleEntry = true for the unclosed opener,
    // causing isRuleOffEntry to return false (treating the opener as a nested
    // option field) and missing the off/0 severity. The fix captures the
    // pre-update insideRuleEntry state so the keyed opener is evaluated as a
    // rule entry.

    function rulesBlockOpenerDiff(addedLine) {
      return [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,0 +1,2 @@',
        '  rules: {',
        '+' + addedLine,
      ].join(String.fromCharCode(10));
    }

    it('rejects newly added keyed multiline opener with string off', () => {
      const violations = checkDiff(
        rulesBlockOpenerDiff("      'no-console': ['off',"),
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('off/0');
      expect(violations[0].message).toContain('eslint-policy-allow-off');
    });

    it('rejects newly added keyed multiline opener with numeric 0', () => {
      const violations = checkDiff(
        rulesBlockOpenerDiff("      'no-console': [0,"),
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('off/0');
      expect(violations[0].message).toContain('eslint-policy-allow-off');
    });

    it('rejects keyed multiline opener off with double-quoted severity', () => {
      const violations = checkDiff(
        rulesBlockOpenerDiff('      "no-console": ["off",'),
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('off/0');
    });

    it('rejects keyed multiline opener with ceiling rule and numeric 0', () => {
      const violations = checkDiff(
        rulesBlockOpenerDiff('      complexity: [0,'),
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('off/0');
    });

    it('allows keyed multiline opener off with eslint-policy-allow-off', () => {
      const violations = checkDiff(
        rulesBlockOpenerDiff(
          "      'no-console': ['off', // eslint-policy-allow-off: #2199",
        ),
      );

      expect(violations).toEqual([]);
    });

    it('allows keyed multiline opener numeric 0 with eslint-policy-allow-off', () => {
      const violations = checkDiff(
        rulesBlockOpenerDiff(
          "      'no-console': [0, // eslint-policy-allow-off: #2199",
        ),
      );

      expect(violations).toEqual([]);
    });

    it('does not flag unrelated option fields inside existing multiline rule configs', () => {
      // An option field (customOption: 0) inside an already-opened multiline
      // rule config must NOT be flagged as an off/0 entry. The pre-update
      // insideRuleEntry state is true (we are inside the rule config opened
      // by "'no-console': ['error', {"), so isRuleOffEntry returns false and
      // only standalone severity detection applies, which customOption: 0 is
      // not.
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,0 +1,4 @@',
        '  rules: {',
        "        'no-console': ['error', {",
        '+          customOption: 0,',
        '        }],',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });

    it('does not flag unrelated string off field inside existing multiline rule config', () => {
      // A string-valued option field (mode: "off") inside an already-opened
      // multiline rule config must NOT be flagged. Same gating as the numeric
      // case: pre-update insideRuleEntry is true.
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,0 +1,4 @@',
        '  rules: {',
        "        'no-console': ['error', {",
        '+          mode: "off",',
        '        }],',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });

    it('still detects standalone multiline off after a separate keyed opener', () => {
      // Regression guard: the pre-update-state fix must not break standalone
      // multiline off detection. A rule opens with 'error' (not off), then a
      // standalone 'off', is added on a later line. The standalone detection
      // (gated to rulesBraceDepth) must still fire.
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,0 +1,3 @@',
        '  rules: {',
        "        'no-console': [",
        "+          'off',",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toHaveLength(1);
    });
  });
  describe('nested option array off/0 values (#2189 review finding)', () => {
    // A standalone 'off' or 0 line inside a rule option array (e.g.
    // modes: ['off'] inside ['error', { ... }]) is an option VALUE, not a rule
    // severity. The off/0 policy gate must only apply to the FIRST element of a
    // rule's [severity, options...] array. Once the first element (severity)
    // is seen, subsequent standalone 'off'/0 lines must not be flagged. These
    // tests verify the expectingFirstSeverityElement tracking prevents false
    // positives while still detecting actual standalone severity off/0 lines.

    it('does not flag off inside a nested array option when severity is on the opener line', () => {
      // The opener "'no-console': ['error', {" has the severity 'error' on the
      // same line, so expectingFirstSeverityElement is false. The nested
      // 'off', inside modes: ['off', is an option value and must not be
      // flagged.
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,0 +1,6 @@',
        '  rules: {',
        "        'no-console': ['error', {",
        '          modes: [',
        "+            'off',",
        '+          ],',
        '+        }],',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });

    it('does not flag numeric 0 inside a nested array option when severity is on the opener line', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,0 +1,6 @@',
        '  rules: {',
        "        'no-console': ['error', {",
        '          levels: [',
        '+            0,',
        '+          ],',
        '+        }],',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });

    it('does not flag off inside a nested array option when severity is a separate first line', () => {
      // The opener "'no-console': [" opens the array without severity, so
      // expectingFirstSeverityElement starts true. The first standalone
      // 'error', line is the severity — it clears the expectation. The
      // subsequent 'off', inside modes: ['off'] is an option value and must
      // not be flagged.
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,0 +1,7 @@',
        '  rules: {',
        "        'no-console': [",
        "+          'error',",
        '+          {',
        '            modes: [',
        "+              'off',",
        '+            ],',
        '+          },',
        '+        ],',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });

    it('still detects an actual standalone severity off as the first element', () => {
      // The opener "'no-console': [" opens the array without severity.
      // expectingFirstSeverityElement is true, so the first standalone 'off',
      // IS the severity and must be flagged.
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,0 +1,3 @@',
        '  rules: {',
        "        'no-console': [",
        "+          'off',",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toHaveLength(1);
    });

    it('still detects an actual standalone numeric 0 as the first element', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,0 +1,3 @@',
        '  rules: {',
        "        'no-console': [",
        '+          0,',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toHaveLength(1);
    });

    it('does not flag a second standalone off after the severity was already seen', () => {
      // After the severity 'error' is seen as the first element, a second
      // standalone 'off', is not a severity (it's a stray option-like value)
      // and must not be flagged.
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,0 +1,5 @@',
        '  rules: {',
        "        'no-console': [",
        "          'error',",
        "+          'off',",
        '+        ],',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });

    it('does not flag off inside a nested array with context-line severity', () => {
      // The severity 'error' is on a context line (unchanged), so
      // expectingFirstSeverityElement is cleared before the added 'off', line.
      // The added 'off', inside a nested option array is an option value and
      // must not be flagged.
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,4 +1,5 @@',
        '  rules: {',
        "        'no-console': ['error', {",
        '          modes: [',
        "+            'off',",
        '          ],',
        '        }],',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });
  });

  it('rejects removing the inline-disable ban', () => {
    const diff = [
      'diff --git a/eslint.config.js b/eslint.config.js',
      'index 0000000..1111111 100644',
      '--- a/eslint.config.js',
      '+++ b/eslint.config.js',
      '@@ -1,1 +0,0 @@',
      "-      'eslint-comments/no-use': 'error',",
    ].join('\n');

    const violations = checkDiff(diff);

    expect(violations).toHaveLength(1);
    expect(formatViolations(violations)).toContain('inline-disable ban');
  });

  it('rejects removing max-warnings zero from lint ci', () => {
    const diff = [
      'diff --git a/package.json b/package.json',
      'index 0000000..1111111 100644',
      '--- a/package.json',
      '+++ b/package.json',
      '@@ -1,1 +0,0 @@',
      '-    "lint:ci": "eslint . --max-warnings 0",',
    ].join('\n');

    const violations = checkDiff(diff);

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('--max-warnings 0');
  });

  it('allows moving the inline-disable ban without weakening it', () => {
    const diff = [
      'diff --git a/eslint.config.js b/eslint.config.js',
      'index 0000000..1111111 100644',
      '--- a/eslint.config.js',
      '+++ b/eslint.config.js',
      '@@ -1,1 +1,1 @@',
      "-      'eslint-comments/no-use': ['error'],",
      "+      'eslint-comments/no-use': ['error'],",
    ].join('\n');

    expect(checkDiff(diff)).toEqual([]);
  });

  it('allows moving max-warnings zero without removing it', () => {
    const diff = [
      'diff --git a/package.json b/package.json',
      'index 0000000..1111111 100644',
      '--- a/package.json',
      '+++ b/package.json',
      '@@ -1,1 +1,1 @@',
      '-    "lint:ci": "eslint . --max-warnings 0",',
      '+    "lint:ci": "cross-env eslint . --max-warnings 0",',
    ].join('\n');

    expect(checkDiff(diff)).toEqual([]);
  });

  it('rejects inline ESLint disables in scripts', () => {
    const violations = checkDiff(
      diffFor('scripts/example.js', '// eslint-disable-line no-console'),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe('scripts/example.js');
  });

  it('rejects newly added inline ESLint enable directives', () => {
    const violations = checkDiff(
      diffFor('packages/core/src/example.ts', '/* eslint-enable no-console */'),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain(
      'Inline ESLint disable/enable directives are forbidden',
    );
  });

  it('allows directive text in strings and regular expressions', () => {
    const stringViolations = checkDiff(
      diffFor(
        'packages/core/src/example.ts',
        'const msg = "https://example.test// eslint-disable-next-line";',
      ),
    );
    const regexViolations = checkDiff(
      diffFor(
        'packages/core/src/example.ts',
        'const re = /eslint-disable(?:-next-line|-line)?/;',
      ),
    );

    expect(stringViolations).toEqual([]);
    expect(regexViolations).toEqual([]);
  });

  it('rejects regex-related inline ESLint disables instead of allowing policy bypasses', () => {
    const violations = checkDiff(
      diffFor(
        'packages/core/src/example.ts',
        '// eslint-disable-next-line sonarjs/regular-expr, sonarjs/slow-regex',
      ),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain(
      'Inline ESLint disable/enable directives are forbidden',
    );
  });

  it('rejects packages/cli entries added to eslint config', () => {
    const violations = checkDiff(
      diffFor('eslint.config.js', "  'packages/cli/src/**/*.{ts,tsx}',"),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain(
      'packages/cli directive cleanup scopes',
    );
  });

  it('allows packages/cli/src references inside config comments', () => {
    const violations = checkDiff(
      diffFor(
        'eslint.config.js',
        '      // Project-level assertion wrappers (see packages/cli/src/test-utils)',
      ),
    );

    expect(violations).toHaveLength(0);
  });

  describe('ESLint config loosening (#2189)', () => {
    function configDiff(file, removedLine, addedLine) {
      return [
        'diff --git a/' + file + ' b/' + file,
        'index 0000000..1111111 100644',
        '--- a/' + file,
        '+++ b/' + file,
        '@@ -1,1 +1,1 @@',
        '  rules: {',
        '-' + removedLine,
        '+' + addedLine,
        '  },',
      ].join(String.fromCharCode(10));
    }

    describe('severity downgrades', () => {
      it('catches string severity downgrade from error to warn', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      'no-console': 'error',",
            "      'no-console': 'warn',",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('severity downgrade');
      });

      it('catches string severity downgrade from error to off', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      'no-console': 'error',",
            "      'no-console': 'off',",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('severity downgrade');
      });

      it('catches numeric severity downgrade from 2 to 1', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      'no-console': 2,",
            "      'no-console': 1,",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('severity downgrade');
      });

      it('catches numeric severity downgrade from 2 to 0', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      'no-console': 2,",
            "      'no-console': 0,",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('severity downgrade');
      });

      it('catches array-form severity downgrade error to warn', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      'no-console': ['error', { max: 5 }],",
            "      'no-console': ['warn', { max: 5 }],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('severity downgrade');
      });

      it('catches numeric array-form severity downgrade 2 to 1', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      'no-console': [2, { max: 5 }],",
            "      'no-console': [1, { max: 5 }],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('severity downgrade');
      });

      it('catches multiline array severity downgrade', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,1 @@',
          '      rules: {',
          "      'no-console': [",
          '-        "error",',
          '+        "warn",',
          '        { max: 5 },',
          '      ],',
          '      },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff);

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('severity downgrade');
      });

      it('does not flag severity upgrades', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      'no-console': 'warn',",
            "      'no-console': 'error',",
          ),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag unchanged severity', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      'no-console': 'error',",
            "      'no-console': 'error',",
          ),
        );

        expect(violations).toEqual([]);
      });
    });

    describe('ceiling threshold increases', () => {
      it('catches numeric array threshold increase for complexity', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      complexity: ['error', 25],",
            "      complexity: ['error', 26],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('threshold increase');
        expect(violations[0].message).toContain('complexity');
      });

      it('catches max object threshold increase for max-lines', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "        'max-lines': ['error', { max: 800 }],",
            "        'max-lines': ['error', { max: 900 }],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('threshold increase');
        expect(violations[0].message).toContain('max-lines');
      });

      it('catches max object threshold increase for max-lines-per-function', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "        'max-lines-per-function': ['error', { max: 80 }],",
            "        'max-lines-per-function': ['error', { max: 120 }],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('threshold increase');
        expect(violations[0].message).toContain('max-lines-per-function');
      });

      it('catches numeric array threshold increase for sonarjs/cognitive-complexity', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      'sonarjs/cognitive-complexity': ['error', 30],",
            "      'sonarjs/cognitive-complexity': ['error', 40],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('threshold increase');
      });

      it('catches numeric array threshold increase for max-statements', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      'max-statements': ['error', 10],",
            "      'max-statements': ['error', 15],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('threshold increase');
      });

      it('catches numeric array threshold increase for max-params', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      'max-params': ['error', 3],",
            "      'max-params': ['error', 5],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('threshold increase');
      });

      it('catches numeric array threshold increase for max-depth', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      'max-depth': ['error', 4],",
            "      'max-depth': ['error', 6],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('threshold increase');
      });

      it('does not flag non-threshold option changes in multiline ceiling rule configs', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,1 @@',
          '      rules: {',
          "        'max-lines': ['error', {",
          '          max: 800,',
          '-          skipBlankLines: true,',
          '+          skipBlankLines: false,',
          '        }],',
          '      },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff);

        expect(violations).toEqual([]);
      });

      it('catches multiline max threshold increase for max-lines', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,1 @@',
          '      rules: {',
          "        'max-lines': ['error', {",
          '-          max: 800,',
          '+          max: 900,',
          '          skipBlankLines: true,',
          '        }],',
          '      },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff);

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('threshold increase');
        expect(violations[0].message).toContain('max-lines');
      });

      it('does not flag threshold decreases', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "        'max-lines': ['error', { max: 800 }],",
            "        'max-lines': ['error', { max: 700 }],",
          ),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag threshold decreases for complexity', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      complexity: ['error', 25],",
            "      complexity: ['error', 20],",
          ),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag unchanged thresholds', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      complexity: ['error', 25],",
            "      complexity: ['error', 25],",
          ),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag unrelated max field increases', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "        'no-restricted-syntax': ['error', { max: 5 }],",
            "        'no-restricted-syntax': ['error', { max: 10 }],",
          ),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag unrelated max field increases under non-ceiling rules', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      'import/no-internal-modules': ['error', { max: 10 }],",
            "      'import/no-internal-modules': ['error', { max: 20 }],",
          ),
        );

        expect(violations).toEqual([]);
      });
    });

    describe('cross-form ceiling threshold increases (#2189 review)', () => {
      // Both the numeric array form (complexity: ['error', 25]) and the object
      // max form ('max-lines': ['error', { max: 800 }]) are supported ceiling
      // forms. A rule can be loosened by switching forms while increasing the
      // effective ceiling. The guard compares values across forms so these
      // cross-form increases are caught.

      it('catches object max -> numeric array cross-form increase', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "        'max-lines': ['error', { max: 800 }],",
            "        'max-lines': ['error', 900],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('threshold increase');
        expect(violations[0].message).toContain('max-lines');
        expect(violations[0].message).toContain('800');
        expect(violations[0].message).toContain('900');
      });

      it('catches numeric array -> object max cross-form increase', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      complexity: ['error', 25],",
            "      complexity: ['error', { max: 30 }],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('threshold increase');
        expect(violations[0].message).toContain('complexity');
        expect(violations[0].message).toContain('25');
        expect(violations[0].message).toContain('30');
      });

      it('catches object max -> numeric cross-form increase for max-statements', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "        'max-statements': ['error', { max: 10 }],",
            "        'max-statements': ['error', 20],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('threshold increase');
        expect(violations[0].message).toContain('max-statements');
      });

      it('catches numeric -> object max cross-form increase for max-params', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      'max-params': ['error', 3],",
            "      'max-params': ['error', { max: 5 }],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('threshold increase');
        expect(violations[0].message).toContain('max-params');
      });

      it('does not flag cross-form decreases (object max -> numeric)', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "        'max-lines': ['error', { max: 800 }],",
            "        'max-lines': ['error', 700],",
          ),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag cross-form decreases (numeric -> object max)', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      complexity: ['error', 25],",
            "      complexity: ['error', { max: 20 }],",
          ),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag cross-form equal values (object max -> numeric)', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "        'max-lines': ['error', { max: 800 }],",
            "        'max-lines': ['error', 800],",
          ),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag cross-form equal values (numeric -> object max)', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      complexity: ['error', 25],",
            "      complexity: ['error', { max: 25 }],",
          ),
        );

        expect(violations).toEqual([]);
      });
    });

    describe('representation-changing diffs (#2189 review finding)', () => {
      // When a rule's representation changes between removed and added forms
      // (e.g. multiline removed severity -> same-line added, or same-line
      // removed -> multiline added), the form-specific buffers do not match
      // up. The normalized rule-state comparison handles these cross-form
      // representation changes by keying on the rule name rather than the line
      // shape.

      it('catches multiline removed severity -> same-line added downgrade', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,1 @@',
          '      rules: {',
          "        'no-console': [",
          '-        "error",',
          "+        'no-console': 'warn',",
          '        { allow: [] },',
          '      ],',
          '  },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff);

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('severity downgrade');
        expect(violations[0].message).toContain('no-console');
        expect(violations[0].message).toContain('error');
        expect(violations[0].message).toContain('warn');
      });

      it('catches same-line removed severity -> multiline added downgrade', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,1 @@',
          '      rules: {',
          "-        'no-console': 'error',",
          "+        'no-console': [",
          "+          'warn',",
          '+          { allow: [] },',
          '+        ],',
          '  },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff);

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('severity downgrade');
        expect(violations[0].message).toContain('no-console');
      });

      it('catches multiline removed numeric threshold -> same-line added threshold increase', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,1 @@',
          '      rules: {',
          '        complexity: [',
          "          'error',",
          '-          25,',
          "+        complexity: ['error', 30],",
          '      ],',
          '  },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff);

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('threshold increase');
        expect(violations[0].message).toContain('complexity');
        expect(violations[0].message).toContain('25');
        expect(violations[0].message).toContain('30');
      });

      it('catches same-line removed threshold -> multiline added threshold increase (object max form)', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,1 @@',
          '      rules: {',
          "-        'max-lines': ['error', { max: 800 }],",
          "+        'max-lines': ['error', {",
          '+          max: 900,',
          '+          skipBlankLines: true,',
          '+        }],',
          '  },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff);

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('threshold increase');
        expect(violations[0].message).toContain('max-lines');
        expect(violations[0].message).toContain('800');
        expect(violations[0].message).toContain('900');
      });

      it('catches same-line removed threshold -> multiline added threshold increase (numeric-array form)', () => {
        // complexity: ['error', 25] (single-line numeric-array) changed to a
        // multiline numeric-array form with the threshold increased to 30.
        // The keyed-removed entry carries both severity ('error') and
        // threshold (25); the standalone added severity line must only
        // consume the severity so the standalone added threshold line can
        // still compare against the removed threshold of 25 (#2189 review
        // finding). End-to-end behavior: exactly one threshold-increase
        // violation containing both 25 and 30.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,1 @@',
          '      rules: {',
          "-      complexity: ['error', 25],",
          '+      complexity: [',
          "+        'error',",
          '+        30,',
          '+      ],',
          '  },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff);

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('threshold increase');
        expect(violations[0].message).toContain('complexity');
        expect(violations[0].message).toContain('25');
        expect(violations[0].message).toContain('30');
      });

      it('catches multiline removed max -> same-line added max increase', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,1 @@',
          '      rules: {',
          "        'max-lines': ['error', {",
          '-          max: 800,',
          "+        'max-lines': ['error', { max: 900 }],",
          '          skipBlankLines: true,',
          '        }],',
          '  },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff);

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('threshold increase');
        expect(violations[0].message).toContain('max-lines');
      });

      it('does not flag representation-changing threshold decreases', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,1 @@',
          '      rules: {',
          '        complexity: [',
          "          'error',",
          '-          30,',
          "+        complexity: ['error', 25],",
          '      ],',
          '  },',
        ].join(String.fromCharCode(10));

        expect(checkDiff(diff)).toEqual([]);
      });

      it('does not flag representation-changing threshold no-ops', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,1 @@',
          '      rules: {',
          '        complexity: [',
          "          'error',",
          '-          25,',
          "+        complexity: ['error', 25],",
          '      ],',
          '  },',
        ].join(String.fromCharCode(10));

        expect(checkDiff(diff)).toEqual([]);
      });

      it('does not flag representation-changing severity upgrades', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,1 @@',
          '      rules: {',
          "        'no-console': [",
          "-        'warn',",
          "+        'no-console': 'error',",
          '        { allow: [] },',
          '      ],',
          '  },',
        ].join(String.fromCharCode(10));

        expect(checkDiff(diff)).toEqual([]);
      });

      it('does not flag representation-changing severity no-ops', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,1 @@',
          '      rules: {',
          "        'no-console': [",
          "-        'error',",
          "+        'no-console': 'error',",
          '        { allow: [] },',
          '      ],',
          '  },',
        ].join(String.fromCharCode(10));

        expect(checkDiff(diff)).toEqual([]);
      });
    });

    describe('nested option objects inside multiline rule configs (#2189 review finding)', () => {
      // A bare } or }, line that closes a NESTED option object inside a
      // multiline ceiling rule config must NOT clear the rule-entry context
      // (currentCeilingRuleKey/currentRuleKey/insideRuleEntry). The per-rule-
      // entry bracket+brace depth tracking ensures the rule entry only closes
      // when the depth returns to zero, so later max/severity lines in the same
      // rule remain correctly attributed.

      it('attributes later max increase to ceiling rule after a nested object closes', () => {
        // The inner { filter: true } object closes with a bare }, line BEFORE
        // the max: 800 -> max: 900 change. The rule entry must NOT be closed
        // by the inner }, so the max increase is still attributed to max-lines.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,1 @@',
          '      rules: {',
          "        'max-lines': ['error', {",
          '          options: {',
          '            filter: true,',
          '          },',
          '-          max: 800,',
          '+          max: 900,',
          '          skipBlankLines: true,',
          '        }],',
          '  },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff);

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('threshold increase');
        expect(violations[0].message).toContain('max-lines');
        expect(violations[0].message).toContain('800');
        expect(violations[0].message).toContain('900');
      });

      it('does not flag unrelated nested max field increases in non-ceiling rules', () => {
        // A nested max field inside a non-ceiling rule (no-restricted-syntax)
        // must NOT be flagged even though it sits inside a multiline rule config
        // with a nested option object.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,1 @@',
          '      rules: {',
          "        'no-restricted-syntax': ['error', {",
          '          options: {',
          '            filter: true,',
          '          },',
          '-          max: 5,',
          '+          max: 10,',
          '          skipBlankLines: true,',
          '        }],',
          '  },',
        ].join(String.fromCharCode(10));

        expect(checkDiff(diff)).toEqual([]);
      });

      it('detects severity downgrade after a nested object closes within the rule', () => {
        // The rule entry for 'no-console' has a nested options object that
        // closes before a standalone severity change. The rule entry must
        // remain open so the severity change is correctly attributed.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,1 @@',
          '      rules: {',
          "        'no-console': [",
          "          'error',",
          '          {',
          '            options: {',
          '              allow: true,',
          '            },',
          "            mode: 'verbose',",
          '-          warnExtra: true',
          '+          warnExtra: false',
          '          }',
          '        ],',
          '  },',
        ].join(String.fromCharCode(10));

        // This is an option change (not a severity/threshold change), so no
        // violation is expected. The test confirms the nested object tracking
        // does not crash or misattribute.
        expect(checkDiff(diff)).toEqual([]);
      });
    });

    describe('scalar-to-threshold addition for ceiling rules (#2189 review)', () => {
      // A known ceiling rule that previously had only a scalar severity (e.g.
      // 'complexity': 'error') must not gain an explicit ceiling threshold.
      // extractThresholdValue returns null for scalar severity forms, so
      // without this guard the rule could move from 'complexity': 'error' to
      // 'complexity': ['error', 999] without a violation. Preferred behavior:
      // reject ALL threshold additions for known ceiling rules because they
      // introduce explicit loose ceilings.

      it('rejects scalar severity -> numeric threshold addition for complexity', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      complexity: 'error',",
            "      complexity: ['error', 999],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('Adding a ceiling threshold');
        expect(violations[0].message).toContain('complexity');
      });

      it('rejects scalar severity -> object max threshold addition for max-lines', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "        'max-lines': 'error',",
            "        'max-lines': ['error', { max: 999 }],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('Adding a ceiling threshold');
        expect(violations[0].message).toContain('max-lines');
      });

      it('rejects scalar numeric severity -> threshold addition for max-statements', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "        'max-statements': 2,",
            "        'max-statements': ['error', 50],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('Adding a ceiling threshold');
        expect(violations[0].message).toContain('max-statements');
      });

      it('rejects scalar severity -> object max threshold for sonarjs/cognitive-complexity', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      'sonarjs/cognitive-complexity': 'error',",
            "      'sonarjs/cognitive-complexity': ['error', { max: 100 }],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('Adding a ceiling threshold');
      });

      it('does not flag scalar severity additions for non-ceiling rules', () => {
        // Adding a threshold-like option to a non-ceiling rule (e.g.
        // no-console) must NOT be treated as a ceiling threshold addition.
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      'no-console': 'error',",
            "      'no-console': ['error', { allow: [] }],",
          ),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag removing a threshold from a ceiling rule', () => {
        // Transitioning from a threshold form to a scalar severity removes the
        // ceiling threshold, which is not a loosening. This must NOT be
        // flagged as an addition.
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      complexity: ['error', 999],",
            "      complexity: 'error',",
          ),
        );

        expect(violations).toEqual([]);
      });

      it('does not double-report scalar->small threshold as both addition and increase', () => {
        // A scalar -> threshold transition only reports the "Adding a ceiling
        // threshold" violation, not a threshold increase, because the removed
        // side has no threshold value to compare against.
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      complexity: 'error',",
            "      complexity: ['error', 5],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('Adding a ceiling threshold');
      });

      it('rejects scalar severity -> multiline numeric threshold for complexity', () => {
        // A scalar severity form (complexity: 'error') changed to a multiline
        // numeric-array form that introduces an explicit ceiling threshold.
        // The removed keyed entry has threshold === null; the added standalone
        // numeric threshold line (999) must be caught by the keyed-removed ->
        // standalone-added cross-form block (#2189 review finding).
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,5 @@',
          '  rules: {',
          "-    complexity: 'error',",
          '+    complexity: [',
          "+      'error',",
          '+      999,',
          '    ],',
          '  },',
        ].join('\n');

        const violations = checkDiff(diff);

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('Adding a ceiling threshold');
        expect(violations[0].message).toContain('complexity');
      });

      it('rejects scalar severity -> multiline object max threshold for max-lines', () => {
        // A scalar severity form ('max-lines': 'error') changed to a multiline
        // object-max form that introduces an explicit ceiling threshold. The
        // removed keyed entry has threshold === null; the added standalone max
        // line must be caught by the keyed-removed -> standalone-added
        // cross-form block (#2189 review finding).
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,6 @@',
          '  rules: {',
          "-    'max-lines': 'error',",
          "+    'max-lines': ['error', {",
          '+      max: 999,',
          '+    }],',
          '  },',
        ].join('\n');

        const violations = checkDiff(diff);

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('Adding a ceiling threshold');
        expect(violations[0].message).toContain('max-lines');
      });

      it('rejects numeric scalar severity -> multiline threshold for complexity', () => {
        // A numeric scalar severity (complexity: 2) changed to a multiline
        // numeric-array form that introduces an explicit ceiling threshold.
        // The removed keyed entry has threshold === null; the added standalone
        // numeric threshold line must be caught by the keyed-removed ->
        // standalone-added cross-form block (#2189 review finding).
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,5 @@',
          '  rules: {',
          '-    complexity: 2,',
          '+    complexity: [',
          "+      'error',",
          '+      999,',
          '    ],',
          '  },',
        ].join('\n');

        const violations = checkDiff(diff);

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('Adding a ceiling threshold');
        expect(violations[0].message).toContain('complexity');
      });
    });

    describe('end-to-end checkDiff behavior', () => {
      it('detects multiple violations across rules in a single diff', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,2 +1,2 @@',
          '  rules: {',
          "-      'no-console': 'error',",
          "-      complexity: ['error', 25],",
          "+      'no-console': 'warn',",
          "+      complexity: ['error', 26],",
          '  },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff);

        expect(violations).toHaveLength(2);
        const messages = violations.map((v) => v.message);
        expect(messages.some((m) => m.includes('severity downgrade'))).toBe(
          true,
        );
        expect(messages.some((m) => m.includes('threshold increase'))).toBe(
          true,
        );
      });

      it('reports each real loosening exactly once with reordered unchanged, downgraded, and threshold-increased rules', () => {
        // A hunk mixes a no-op same-key pair (no-console stays 'warn'), a real
        // severity downgrade (no-unused error -> warn), and a real ceiling
        // threshold increase (complexity 25 -> 26), with removed/added lines
        // interleaved in a different order. Each real loosening must be
        // reported exactly once, and the no-op must not cause a stale removed
        // entry to produce an extra or spurious violation.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,5 +1,5 @@',
          '  rules: {',
          "-    'no-unused': 'error',",
          "-    'no-console': 'warn',",
          "-    complexity: ['error', 25],",
          "+    'no-unused': 'warn',",
          "+    'no-console': 'warn',",
          "+    complexity: ['error', 26],",
          '  },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff);

        expect(violations).toHaveLength(2);
        const downgrades = violations.filter((v) =>
          v.message.includes('severity downgrade'),
        );
        const thresholds = violations.filter((v) =>
          v.message.includes('threshold increase'),
        );
        expect(downgrades).toHaveLength(1);
        expect(downgrades[0].message).toContain('no-unused');
        expect(thresholds).toHaveLength(1);
        expect(thresholds[0].message).toContain('complexity');
      });

      it('does not produce spurious violations from unconsumed no-op removed entries', () => {
        // Removed lines include a no-op same-key pair (no-console warn) before
        // a removed downgrade (no-console error in a duplicate scenario). The
        // added line matches the no-op first; consuming it prevents the stale
        // error entry from producing a false downgrade on the same added line.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,4 +1,3 @@',
          '  rules: {',
          "-    'no-console': 'warn',",
          "-    'no-console': 'error',",
          "+    'no-console': 'warn',",
          '  },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag off entries that already have allow markers in the diff', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,1 @@',
          "-      'sonarjs/os-command': 'off', // eslint-policy-allow-off: #2079",
          "+      'sonarjs/os-command': 'off', // eslint-policy-allow-off: #2079",
        ].join(String.fromCharCode(10));

        expect(checkDiff(diff)).toEqual([]);
      });

      it('does not flag severity changes in unrelated config arrays outside rules blocks', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,3 +1,3 @@',
          '  const severityMap = {',
          '    fatal: [',
          '-     "error",',
          '+     "warn",',
          '    ],',
          '  };',
        ].join(String.fromCharCode(10));

        expect(checkDiff(diff)).toEqual([]);
      });

      it('does not flag severity-like values in unrelated config object fields', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      message: 'error something went wrong',",
            "      message: 'warn something went wrong',",
          ),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag numeric severity-like fields outside rules blocks', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,1 @@',
          '  const logConfig = {',
          '-   level: 2,',
          '+   level: 1,',
          '  };',
        ].join(String.fromCharCode(10));

        expect(checkDiff(diff)).toEqual([]);
      });

      it('does not flag non-rule object keys with error-like values outside rules blocks', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -1,1 +1,1 @@',
          '  const messages = {',
          "-    description: 'error threshold reached',",
          "+    description: 'warn threshold reached',",
          '  };',
        ].join(String.fromCharCode(10));

        expect(checkDiff(diff)).toEqual([]);
      });

      describe('zero-context diffs (edge case for minimal-context hunks)', () => {
        // Production uses git diff --unified=5 (DIFF_CONTEXT_LINES in
        // check-eslint-guard.js), which normally includes enough context for
        // the rules: { block and rule key lines. These tests exercise the
        // minimal-context edge case (hunks with no surrounding context lines)
        // so the same-rule-key fallback heuristic stays correct even when a
        // hunk happens to omit the enclosing rules: { line.
        function zeroContextDiff(removedLine, addedLine) {
          return [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -10 +10 @@',
            '-' + removedLine,
            '+' + addedLine,
          ].join(String.fromCharCode(10));
        }

        it('catches string severity downgrade error to warn in zero-context diff', () => {
          const violations = checkDiff(
            zeroContextDiff(
              "      'no-console': 'error',",
              "      'no-console': 'warn',",
            ),
          );

          expect(violations).toHaveLength(1);
          expect(violations[0].message).toContain('severity downgrade');
        });

        it('catches numeric severity downgrade 2 to 1 in zero-context diff', () => {
          const violations = checkDiff(
            zeroContextDiff("      'no-console': 2,", "      'no-console': 1,"),
          );

          expect(violations).toHaveLength(1);
          expect(violations[0].message).toContain('severity downgrade');
        });

        it('catches array-form severity downgrade error to warn in zero-context diff', () => {
          const violations = checkDiff(
            zeroContextDiff(
              "      'no-console': ['error', { max: 5 }],",
              "      'no-console': ['warn', { max: 5 }],",
            ),
          );

          expect(violations).toHaveLength(1);
          expect(violations[0].message).toContain('severity downgrade');
        });

        it('catches complexity threshold increase in zero-context diff', () => {
          const violations = checkDiff(
            zeroContextDiff(
              "      complexity: ['error', 25],",
              "      complexity: ['error', 26],",
            ),
          );

          expect(violations).toHaveLength(1);
          expect(violations[0].message).toContain('threshold increase');
          expect(violations[0].message).toContain('complexity');
        });

        it('catches max-lines max object threshold increase in zero-context diff', () => {
          const violations = checkDiff(
            zeroContextDiff(
              "        'max-lines': ['error', { max: 800 }],",
              "        'max-lines': ['error', { max: 900 }],",
            ),
          );

          expect(violations).toHaveLength(1);
          expect(violations[0].message).toContain('threshold increase');
          expect(violations[0].message).toContain('max-lines');
        });
      });

      describe('off/0 detection gating to rule entries', () => {
        it('does not flag mode: off in unrelated config fields', () => {
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -5 +5 @@',
            '-  mode: "production",',
            '+  mode: "off",',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('off/0'),
          );
          expect(violations).toEqual([]);
        });

        it('does not flag bare off string outside rule contexts', () => {
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -5 +5 @@',
            "-  const value = 'on',",
            "+  const value = 'off',",
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('off/0'),
          );
          expect(violations).toEqual([]);
        });

        it('does not flag bare 0 number outside rule contexts', () => {
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -5 +5 @@',
            '-  const count = 1,',
            '+  const count = 0,',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('off/0'),
          );
          expect(violations).toEqual([]);
        });

        it('does not flag [0] array outside rule contexts', () => {
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -5 +5 @@',
            '-  const arr = [1],',
            '+  const arr = [0],',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('off/0'),
          );
          expect(violations).toEqual([]);
        });

        it('does not flag { mode: off } object literal outside rule contexts', () => {
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -5 +5 @@',
            '+  const config = { mode: "off" };',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('off/0'),
          );
          expect(violations).toEqual([]);
        });

        it('still flags new off rule entries in zero-context diffs', () => {
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -10 +10 @@',
            "+      'complexity': 'off',",
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('off/0'),
          );
          expect(violations).toHaveLength(1);
        });

        describe('quoted rule-like keys in unrelated objects (#2189 review finding 1)', () => {
          // A quoted rule-like key (e.g. 'no-console') inside an unrelated
          // object literal (const docs = { 'no-console': 'off' }) must NOT be
          // flagged as a new off/0 rule entry. The zero-context fallback now
          // requires isRuleSeverityAssignmentShape, which rejects JS
          // declarations (const/let/var) and ordinary assignments (=).

          it('does not flag quoted off value in a const docs object literal', () => {
            const diff = [
              'diff --git a/eslint.config.js b/eslint.config.js',
              'index 0000000..1111111 100644',
              '--- a/eslint.config.js',
              '+++ b/eslint.config.js',
              '@@ -10 +10 @@',
              "+const docs = { 'no-console': 'off' };",
            ].join(String.fromCharCode(10));

            const violations = checkDiff(diff).filter((v) =>
              v.message.includes('off/0'),
            );
            expect(violations).toEqual([]);
          });

          it('does not flag quoted numeric 0 value in a const docs object literal', () => {
            const diff = [
              'diff --git a/eslint.config.js b/eslint.config.js',
              'index 0000000..1111111 100644',
              '--- a/eslint.config.js',
              '+++ b/eslint.config.js',
              '@@ -10 +10 @@',
              "+const docs = { 'no-console': 0 };",
            ].join(String.fromCharCode(10));

            const violations = checkDiff(diff).filter((v) =>
              v.message.includes('off/0'),
            );
            expect(violations).toEqual([]);
          });

          it('does not flag quoted [0] array value in a const docs object literal', () => {
            const diff = [
              'diff --git a/eslint.config.js b/eslint.config.js',
              'index 0000000..1111111 100644',
              '--- a/eslint.config.js',
              '+++ b/eslint.config.js',
              '@@ -10 +10 @@',
              "+const docs = { 'no-console': [0] };",
            ].join(String.fromCharCode(10));

            const violations = checkDiff(diff).filter((v) =>
              v.message.includes('off/0'),
            );
            expect(violations).toEqual([]);
          });

          it('does not flag comment-only line with rule-like key and off value', () => {
            const diff = [
              'diff --git a/eslint.config.js b/eslint.config.js',
              'index 0000000..1111111 100644',
              '--- a/eslint.config.js',
              '+++ b/eslint.config.js',
              '@@ -10 +10 @@',
              "+// docs: 'no-console': 'off'",
            ].join(String.fromCharCode(10));

            const violations = checkDiff(diff).filter((v) =>
              v.message.includes('off/0'),
            );
            expect(violations).toEqual([]);
          });

          it('does not flag unrelated single-line object with quoted off rule key', () => {
            const diff = [
              'diff --git a/eslint.config.js b/eslint.config.js',
              'index 0000000..1111111 100644',
              '--- a/eslint.config.js',
              '+++ b/eslint.config.js',
              '@@ -10 +10 @@',
              "+const ref = { 'no-console': 'off', depth: 2 };",
            ].join(String.fromCharCode(10));

            const violations = checkDiff(diff).filter((v) =>
              v.message.includes('off/0'),
            );
            expect(violations).toEqual([]);
          });

          it('does not flag assignment to docs object with quoted off rule key', () => {
            const diff = [
              'diff --git a/eslint.config.js b/eslint.config.js',
              'index 0000000..1111111 100644',
              '--- a/eslint.config.js',
              '+++ b/eslint.config.js',
              '@@ -10 +10 @@',
              "+docs = { 'no-console': 'off' };",
            ].join(String.fromCharCode(10));

            const violations = checkDiff(diff).filter((v) =>
              v.message.includes('off/0'),
            );
            expect(violations).toEqual([]);
          });

          it('does not flag quoted off rule key in a multiline unrelated object with context', () => {
            const diff = [
              'diff --git a/eslint.config.js b/eslint.config.js',
              'index 0000000..1111111 100644',
              '--- a/eslint.config.js',
              '+++ b/eslint.config.js',
              '@@ -10,3 +10,3 @@',
              '  const docs = {',
              "+    'no-console': 'off',",
              '  };',
            ].join(String.fromCharCode(10));

            const violations = checkDiff(diff).filter((v) =>
              v.message.includes('off/0'),
            );
            expect(violations).toEqual([]);
          });

          it('still flags a bare quoted off rule entry in a zero-context diff', () => {
            // A bare rule entry (no const/let/var/=) with a quoted rule key
            // must still be flagged in a zero-context diff. This proves the
            // zero-context gating does not over-suppress real rule entries.
            const diff = [
              'diff --git a/eslint.config.js b/eslint.config.js',
              'index 0000000..1111111 100644',
              '--- a/eslint.config.js',
              '+++ b/eslint.config.js',
              '@@ -10 +10 @@',
              "+      'no-unused': 'off',",
            ].join(String.fromCharCode(10));

            const violations = checkDiff(diff).filter((v) =>
              v.message.includes('off/0'),
            );
            expect(violations).toHaveLength(1);
          });
        });
      });

      describe('multiline ceiling threshold attribution', () => {
        it('does not attribute non-ceiling multiline max to a prior ceiling rule', () => {
          // A ceiling rule (max-lines) is followed by a non-ceiling rule
          // (some-other-rule). The max change on some-other-rule must NOT be
          // attributed to max-lines.
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -10,8 +10,8 @@',
            '      rules: {',
            "        'max-lines': ['error', {",
            '          max: 800,',
            '        }],',
            "        'some-other-rule': ['error', {",
            '-          max: 100,',
            '+          max: 500,',
            '        }],',
            '      },',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('threshold increase'),
          );
          expect(violations).toEqual([]);
        });

        it('still catches ceiling rule multiline max threshold increase', () => {
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -10,6 +10,6 @@',
            '      rules: {',
            "        'max-lines': ['error', {",
            '-          max: 800,',
            '+          max: 900,',
            '        }],',
            '      },',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('threshold increase'),
          );
          expect(violations).toHaveLength(1);
          expect(violations[0].message).toContain('max-lines');
        });
      });

      describe('multiline severity cross-rule attribution (#2189 review)', () => {
        // Standalone multiline severity values (e.g. 'error',) carry no rule
        // key, so they must be attributed to their enclosing rule. When two
        // different multiline rules change severity in the same hunk, a
        // removed severity from one rule must NOT be paired with an added
        // severity from the other rule.

        it('does not pair removed/added multiline severities across two different rules', () => {
          // Rule A ('no-console') removes 'error' (a real downgrade target),
          // and rule B ('no-unused') adds 'warn'. Without per-rule attribution
          // the removed 'error' from no-console would pair with the added
          // 'warn' under no-unused and falsely report a downgrade.
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -10,12 +10,12 @@',
            '      rules: {',
            "        'no-console': [",
            '-        "error",',
            '+        "off",',
            '          { allow: [] },',
            '        ],',
            "        'no-unused': [",
            '          "warn",',
            '+        "warn",',
            '        ],',
            '      },',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('severity downgrade'),
          );

          // Only the real downgrade (no-console error -> off) is reported; the
          // cross-rule pairing (no-console 'error' vs no-unused 'warn') must
          // NOT produce a spurious second violation.
          expect(violations).toHaveLength(1);
          expect(violations[0].message).toContain('no-console');
        });

        it('still reports a same-rule multiline severity downgrade with two rules present', () => {
          // Two rules in one hunk; only one of them is actually downgraded.
          // The real downgrade must still be reported exactly once, and the
          // other rule (unchanged severity) must not interfere.
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -10,12 +10,12 @@',
            '      rules: {',
            "        'no-console': [",
            '-        "error",',
            '+        "warn",',
            '          { allow: [] },',
            '        ],',
            "        'no-unused': [",
            '          "error",',
            '        ],',
            '      },',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('severity downgrade'),
          );

          expect(violations).toHaveLength(1);
          expect(violations[0].message).toContain('no-console');
        });
      });

      describe('multiline max threshold cross-rule attribution (#2189 review)', () => {
        // Standalone multiline max: N lines carry no rule key and must be
        // attributed to their enclosing ceiling rule. When two different
        // ceiling rules change max in the same hunk, a removed max from one
        // rule must NOT be paired with an added max from the other rule.

        it('does not pair removed/added multiline max across two different ceiling rules', () => {
          // max-lines removes max: 800; max-statements adds max: 900.
          // Without per-rule attribution, the removed 800 from max-lines would
          // pair with the added 900 under max-statements and falsely report a
          // threshold increase.
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -10,14 +10,14 @@',
            '      rules: {',
            "        'max-lines': ['error', {",
            '-          max: 800,',
            '          skipBlankLines: true,',
            '        }],',
            "        'max-statements': ['error', {",
            '+          max: 900,',
            '          skipBlankLines: true,',
            '        }],',
            '      },',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('threshold increase'),
          );

          expect(violations).toEqual([]);
        });

        it('still reports a same-rule multiline max increase with two ceiling rules present', () => {
          // Two ceiling rules in one hunk; only max-lines is actually
          // increased. The real increase must still be reported exactly once.
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -10,14 +10,14 @@',
            '      rules: {',
            "        'max-lines': ['error', {",
            '-          max: 800,',
            '+          max: 900,',
            '          skipBlankLines: true,',
            '        }],',
            "        'max-statements': ['error', {",
            '          max: 10,',
            '        }],',
            '      },',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('threshold increase'),
          );

          expect(violations).toHaveLength(1);
          expect(violations[0].message).toContain('max-lines');
        });

        it('uses the stored rule key in the violation message for multiline max changes', () => {
          // Removed max-lines 800 -> added max-lines 900. The stored removed
          // rule key must label the violation correctly.
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -10,8 +10,8 @@',
            '      rules: {',
            "        'max-lines': ['error', {",
            '-          max: 800,',
            '          skipBlankLines: true,',
            '+          max: 900,',
            '        }],',
            '      },',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('threshold increase'),
          );

          expect(violations).toHaveLength(1);
          expect(violations[0].message).toContain('max-lines');
          expect(violations[0].message).toContain('800');
          expect(violations[0].message).toContain('900');
        });
      });

      describe('multiline max threshold with reordered max-lines/max-statements in one hunk', () => {
        // Exercises the stored-key comparison for two ceiling rules whose
        // removed/added max lines are interleaved in the same hunk.

        it('attributes each max increase to its own rule even when interleaved', () => {
          // Two ceiling rules, each properly closed. The removed max-statements
          // line appears before the added max-lines line, so naive (FIFO)
          // pairing would misattribute. Per-rule key matching ensures each
          // rule's own removed/added pair is compared.
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -10,14 +10,14 @@',
            '      rules: {',
            "        'max-statements': ['error', {",
            '-          max: 10,',
            '        }],',
            "        'max-lines': ['error', {",
            '-          max: 800,',
            '+          max: 900,',
            '        }],',
            "        'max-statements-2': ['error', {",
            '+          max: 20,',
            '        }],',
            '      },',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('threshold increase'),
          );

          // max-lines 800 -> 900 is a real increase and must be reported with
          // the correct rule key. max-statements' removed 10 and the separate
          // added 20 (under a different key) must NOT cross-pair.
          const maxLinesIncreases = violations.filter((v) =>
            v.message.includes("'max-lines'"),
          );
          expect(maxLinesIncreases).toHaveLength(1);
          expect(maxLinesIncreases[0].message).toContain('800');
          expect(maxLinesIncreases[0].message).toContain('900');
        });

        describe('project-common multiline max object threshold (#2189 review)', () => {
          // The project's eslint.config.js uses the object-line shape
          // "{ max: 800, skipBlankLines: true, skipComments: true }" inside
          // ceiling rule arrays. These lines have no rule key on the same line,
          // so they must be detected via currentCeilingRuleKey context, not the
          // bare "max: N," standalone form.

          it('catches a project-style multiline max object threshold increase', () => {
            const diff = [
              'diff --git a/eslint.config.js b/eslint.config.js',
              'index 0000000..1111111 100644',
              '--- a/eslint.config.js',
              '+++ b/eslint.config.js',
              '@@ -10,6 +10,6 @@',
              '      rules: {',
              "        'max-lines': ['error', {",
              '-          { max: 800, skipBlankLines: true, skipComments: true },',
              '+          { max: 900, skipBlankLines: true, skipComments: true },',
              '        }],',
              '      },',
            ].join(String.fromCharCode(10));

            const violations = checkDiff(diff).filter((v) =>
              v.message.includes('threshold increase'),
            );

            expect(violations).toHaveLength(1);
            expect(violations[0].message).toContain('max-lines');
            expect(violations[0].message).toContain('800');
            expect(violations[0].message).toContain('900');
          });

          it('does not flag a project-style multiline max object threshold decrease', () => {
            const diff = [
              'diff --git a/eslint.config.js b/eslint.config.js',
              'index 0000000..1111111 100644',
              '--- a/eslint.config.js',
              '+++ b/eslint.config.js',
              '@@ -10,6 +10,6 @@',
              '      rules: {',
              "        'max-lines': ['error', {",
              '-          { max: 800, skipBlankLines: true, skipComments: true },',
              '+          { max: 700, skipBlankLines: true, skipComments: true },',
              '        }],',
              '      },',
            ].join(String.fromCharCode(10));

            const violations = checkDiff(diff).filter((v) =>
              v.message.includes('threshold increase'),
            );

            expect(violations).toEqual([]);
          });

          it('does not flag project-style max object changes under non-ceiling rules', () => {
            const diff = [
              'diff --git a/eslint.config.js b/eslint.config.js',
              'index 0000000..1111111 100644',
              '--- a/eslint.config.js',
              '+++ b/eslint.config.js',
              '@@ -10,6 +10,6 @@',
              '      rules: {',
              "        'no-restricted-syntax': ['error', {",
              '-          { max: 5, allow: [] },',
              '+          { max: 10, allow: [] },',
              '        }],',
              '      },',
            ].join(String.fromCharCode(10));

            const violations = checkDiff(diff).filter((v) =>
              v.message.includes('threshold increase'),
            );

            expect(violations).toEqual([]);
          });
        });

        describe('newly added multiline standalone off/0 entries (#2189 review)', () => {
          it('rejects a newly added multiline standalone off string entry', () => {
            const diff = [
              'diff --git a/eslint.config.js b/eslint.config.js',
              'index 0000000..1111111 100644',
              '--- a/eslint.config.js',
              '+++ b/eslint.config.js',
              '@@ -10,5 +10,6 @@',
              '      rules: {',
              "        'no-console': [",
              "+        'off',",
              '          { allow: [] },',
              '      ],',
            ].join(String.fromCharCode(10));

            const violations = checkDiff(diff).filter((v) =>
              v.message.includes('off/0'),
            );

            expect(violations).toHaveLength(1);
          });

          it('rejects a newly added multiline standalone numeric 0 entry', () => {
            const diff = [
              'diff --git a/eslint.config.js b/eslint.config.js',
              'index 0000000..1111111 100644',
              '--- a/eslint.config.js',
              '+++ b/eslint.config.js',
              '@@ -10,5 +10,6 @@',
              '      rules: {',
              "        'no-console': [",
              '+        0,',
              '          { allow: [] },',
              '      ],',
            ].join(String.fromCharCode(10));

            const violations = checkDiff(diff).filter((v) =>
              v.message.includes('off/0'),
            );

            expect(violations).toHaveLength(1);
          });

          it('rejects a newly added multiline standalone off entry with trailing comment', () => {
            const diff = [
              'diff --git a/eslint.config.js b/eslint.config.js',
              'index 0000000..1111111 100644',
              '--- a/eslint.config.js',
              '+++ b/eslint.config.js',
              '@@ -10,5 +10,6 @@',
              '      rules: {',
              "        'no-console': [",
              "+        'off', // eslint-policy-allow-off NOT present",
              '          { allow: [] },',
              '      ],',
            ].join(String.fromCharCode(10));

            const violations = checkDiff(diff).filter((v) =>
              v.message.includes('off/0'),
            );

            expect(violations).toHaveLength(1);
          });

          it('does not flag standalone off entries outside a rules block', () => {
            const diff = [
              'diff --git a/eslint.config.js b/eslint.config.js',
              'index 0000000..1111111 100644',
              '--- a/eslint.config.js',
              '+++ b/eslint.config.js',
              '@@ -10,3 +10,4 @@',
              '  const flags = [',
              "+    'off',",
              '  ];',
            ].join(String.fromCharCode(10));

            const violations = checkDiff(diff).filter((v) =>
              v.message.includes('off/0'),
            );

            expect(violations).toEqual([]);
          });
        });

        describe('multiline severity downgrades with trailing comments (#2189 review)', () => {
          it('catches a commented multiline string severity downgrade', () => {
            const diff = [
              'diff --git a/eslint.config.js b/eslint.config.js',
              'index 0000000..1111111 100644',
              '--- a/eslint.config.js',
              '+++ b/eslint.config.js',
              '@@ -50,5 +50,5 @@',
              '    rules: {',
              "      'no-console': [",
              '-        "error", // keep as error',
              '+        "warn", // downgraded',
              '        { allow: [] },',
              '      ],',
            ].join(String.fromCharCode(10));

            const violations = checkDiff(diff).filter((v) =>
              v.message.includes('severity downgrade'),
            );

            expect(violations).toHaveLength(1);
          });

          it('catches a commented multiline numeric severity downgrade', () => {
            const diff = [
              'diff --git a/eslint.config.js b/eslint.config.js',
              'index 0000000..1111111 100644',
              '--- a/eslint.config.js',
              '+++ b/eslint.config.js',
              '@@ -50,5 +50,5 @@',
              '    rules: {',
              "      'no-console': [",
              '-        2, // severity two',
              '+        1, // severity one',
              '        { allow: [] },',
              '      ],',
            ].join(String.fromCharCode(10));

            const violations = checkDiff(diff).filter((v) =>
              v.message.includes('severity downgrade'),
            );

            expect(violations).toHaveLength(1);
          });

          it('catches a commented multiline numeric severity downgrade 2 to 0', () => {
            const diff = [
              'diff --git a/eslint.config.js b/eslint.config.js',
              'index 0000000..1111111 100644',
              '--- a/eslint.config.js',
              '+++ b/eslint.config.js',
              '@@ -50,5 +50,5 @@',
              '    rules: {',
              "      'no-console': [",
              '-        2, // was error',
              '+        0, // now off',
              '        { allow: [] },',
              '      ],',
            ].join(String.fromCharCode(10));

            const violations = checkDiff(diff).filter((v) =>
              v.message.includes('severity downgrade'),
            );

            expect(violations).toHaveLength(1);
          });
        });
      });

      describe('wide multiline rule config context (DIFF_CONTEXT_LINES)', () => {
        // Production uses git diff --unified=20 (DIFF_CONTEXT_LINES) so that a
        // ceiling rule whose max field is more than 5 lines below the rule key
        // still includes the rule key within the hunk. These tests lock that
        // behavior with a config object that has >5 lines between the rule key
        // and the changed max field. Option lines use real structural option
        // keys (skipBlankLines, skipComments, etc.) so they do not reset the
        // ceiling rule context.

        it('catches a max increase when the rule key is more than 5 lines above the max field', () => {
          // 8 option lines sit between the rule key opener and the max field,
          // which would exceed a 5-line context window but is within 20.
          const optionLines = [
            '          skipBlankLines: true,',
            '          skipComments: false,',
            '          ignorePattern: [],',
            '          ignorePatterns: [],',
            '          maxDepth: 4,',
            '          maxLen: 120,',
            '          IIFEs: true,',
            '          ignoreTopLevelFunctions: false,',
          ];
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -10,' +
              (optionLines.length + 6) +
              ' +' +
              (optionLines.length + 6) +
              ' @@',
            '      rules: {',
            "        'max-lines': ['error', {",
            ...optionLines,
            '-          max: 800,',
            '+          max: 900,',
            '        }],',
            '      },',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('threshold increase'),
          );

          expect(violations).toHaveLength(1);
          expect(violations[0].message).toContain('max-lines');
        });

        it('catches a max increase with many option lines for max-statements', () => {
          // Exercises the same wide-context behavior for a different ceiling
          // rule with >5 lines between the rule key and the max field.
          const optionLines = [
            '          skipBlankLines: true,',
            '          skipComments: false,',
            '          ignorePattern: [],',
            '          ignorePatterns: [],',
            '          maxDepth: 4,',
            '          maxLen: 120,',
            '          IIFEs: true,',
            '          ignoreTopLevelFunctions: false,',
            '          options: [],',
            '          properties: [],',
          ];
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -10,' +
              (optionLines.length + 6) +
              ' +' +
              (optionLines.length + 6) +
              ' @@',
            '      rules: {',
            "        'max-statements': ['error', {",
            ...optionLines,
            '-          max: 30,',
            '+          max: 40,',
            '        }],',
            '      },',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('threshold increase'),
          );

          expect(violations).toHaveLength(1);
          expect(violations[0].message).toContain('max-statements');
        });
      });

      describe('multiline rule loosening with production diff context (#2189 review)', () => {
        // Production uses git diff --unified=20 (DIFF_CONTEXT_LINES) which
        // includes enough context for the rules: { block and rule key lines,
        // even for wide multiline rule config objects. These tests use
        // realistic context lines matching that output shape.

        it('catches multiline string severity downgrade error to warn', () => {
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -50,5 +50,5 @@',
            '    rules: {',
            "      'no-console': [",
            '-        "error",',
            '+        "warn",',
            '        { allow: [] },',
            '      ],',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('severity downgrade'),
          );

          expect(violations).toHaveLength(1);
        });

        it('catches multiline numeric severity downgrade 2 to 1', () => {
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -50,5 +50,5 @@',
            '    rules: {',
            "      'no-console': [",
            '-        2,',
            '+        1,',
            '        { allow: [] },',
            '      ],',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('severity downgrade'),
          );

          expect(violations).toHaveLength(1);
        });

        it('catches standalone max threshold increase in multiline config', () => {
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -50,6 +50,6 @@',
            '    rules: {',
            "        'max-lines': ['error', {",
            '-          max: 800,',
            '+          max: 900,',
            '          skipBlankLines: true,',
            '        }],',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('threshold increase'),
          );

          expect(violations).toHaveLength(1);
          expect(violations[0].message).toContain('max-lines');
        });

        it('catches multiline numeric severity downgrade 2 to 0', () => {
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -50,5 +50,5 @@',
            '    rules: {',
            "      'no-console': [",
            '-        2,',
            '+        0,',
            '        { allow: [] },',
            '      ],',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('severity downgrade'),
          );

          expect(violations).toHaveLength(1);
        });
      });

      describe('off/0 detection false-positive gating on option fields (#2189 review)', () => {
        it('does not flag mode: off option field inside a rule config object', () => {
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -50,6 +50,6 @@',
            '    rules: {',
            "      'no-restricted-syntax': ['error', {",
            '-        mode: "strict",',
            '+        mode: "off",',
            '      }],',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('off/0'),
          );

          expect(violations).toEqual([]);
        });

        it('does not flag limit: 0 option field inside a rule config object', () => {
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -50,6 +50,6 @@',
            '    rules: {',
            "      'import/no-default-export': ['error', {",
            '-        limit: 5,',
            '+        limit: 0,',
            '      }],',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('off/0'),
          );

          expect(violations).toEqual([]);
        });

        it('does not flag severity-like option field in a non-ceiling rule config', () => {
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -50,6 +50,6 @@',
            '    rules: {',
            "      'no-restricted-syntax': ['error', {",
            '-        level: "error",',
            '+        level: "off",',
            '      }],',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('off/0'),
          );

          expect(violations).toEqual([]);
        });

        it('does not flag customOption: "off" inside a rule config object', () => {
          // customOption is not in STRUCTURAL_KEYS, so before the fix
          // isRuleOffEntry treated it as a rule assignment while
          // insideRulesBlock was true. With insideRuleEntry tracking, keyed
          // off/0 detection is suppressed inside a rule config object.
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -50,6 +50,6 @@',
            '    rules: {',
            "      'no-restricted-syntax': ['error', {",
            '-        customOption: "strict",',
            '+        customOption: "off",',
            '      }],',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('off/0'),
          );

          expect(violations).toEqual([]);
        });

        it('does not flag customOption: 0 inside a rule config object', () => {
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -50,6 +50,6 @@',
            '    rules: {',
            "      'no-restricted-syntax': ['error', {",
            '-        customOption: 5,',
            '+        customOption: 0,',
            '      }],',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('off/0'),
          );

          expect(violations).toEqual([]);
        });

        it('does not flag a quoted custom option key with off value inside a rule config', () => {
          // Even a quoted custom option key must not be mistaken for a rule
          // off entry when inside a multiline rule config object.
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -50,6 +50,6 @@',
            '    rules: {',
            "      'no-restricted-syntax': ['error', {",
            "-        'customOption': 'strict',",
            "+        'customOption': 'off',",
            '      }],',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('off/0'),
          );

          expect(violations).toEqual([]);
        });

        it('still flags an actual rule-level off entry inside a rules block', () => {
          // A newly added rule off entry at the rules-object entry level (not
          // inside a rule config object) must still be flagged. This uses a
          // pure addition (no removed severity pair) so the off/0 gate is
          // exercised directly, proving the insideRuleEntry suppression does
          // not over-suppress real rule off entries.
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -50,3 +50,4 @@',
            '    rules: {',
            "      'no-console': 'error',",
            "+      'no-unused': 'off',",
            '    },',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('off/0'),
          );

          expect(violations).toHaveLength(1);
        });

        it('still flags an actual rule-level numeric off entry inside a rules block', () => {
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -50,3 +50,4 @@',
            '    rules: {',
            "      'no-console': 'error',",
            "+      'no-unused': 0,",
            '    },',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('off/0'),
          );

          expect(violations).toHaveLength(1);
        });

        it('still flags a new rule off entry with a rule key in production context diff', () => {
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -50,2 +50,3 @@',
            '    rules: {',
            "+      'complexity': 'off',",
            '    },',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('off/0'),
          );

          expect(violations).toHaveLength(1);
        });

        it('still flags standalone off severity inside a rules block', () => {
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -50,5 +50,5 @@',
            '    rules: {',
            "      'no-console': [",
            '-        "error",',
            "+        'off',",
            '        { allow: [] },',
            '      ],',
          ].join(String.fromCharCode(10));

          // This is both a severity downgrade (error -> off) and a new off
          // entry. The severity downgrade should be reported.
          const downgradeViolations = checkDiff(diff).filter((v) =>
            v.message.includes('severity downgrade'),
          );
          expect(downgradeViolations).toHaveLength(1);
        });

        it('does not flag a comment-only line mentioning a quoted off rule inside a rules block', () => {
          // A comment-only line inside a tracked rules: { ... } block (with
          // context lines so rulesBraceDepth is non-null) that happens to
          // mention a quoted off rule must NOT be rejected as a new off/0
          // entry. The directive detectors (isNewOffRule / isRuleOffEntry)
          // use regex/extractRuleKey which do not distinguish comments from
          // code, so the comment text satisfies their predicates. The
          // !isCommentOnlyLine guard in the off/0 policy gate applies to all
          // contexts (rules block and zero-context) so this comment is not
          // falsely flagged (#2189 review finding).
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -50,3 +50,4 @@',
            '    rules: {',
            "+      // docs: 'no-console': 'off' remains disabled elsewhere",
            "      'no-console': 'error',",
            '    },',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('off/0'),
          );

          expect(violations).toEqual([]);
        });

        it('does not flag a comment-only line mentioning a numeric 0 rule inside a rules block', () => {
          // Same gating as the quoted-off case but for the numeric 0 form
          // (e.g. a comment mentioning 'no-console': [0]).
          const diff = [
            'diff --git a/eslint.config.js b/eslint.config.js',
            'index 0000000..1111111 100644',
            '--- a/eslint.config.js',
            '+++ b/eslint.config.js',
            '@@ -50,3 +50,4 @@',
            '    rules: {',
            "+      // note: 'no-console': [0] is intentionally avoided here",
            "      'no-console': 'error',",
            '    },',
          ].join(String.fromCharCode(10));

          const violations = checkDiff(diff).filter((v) =>
            v.message.includes('off/0'),
          );

          expect(violations).toEqual([]);
        });
      });
    });
  });

  describe('review remediation regressions (#2189)', () => {
    describe('rulesBraceDepth reset on rules block close', () => {
      it('does not flag unrelated standalone severity values after a closed rules block', () => {
        // A rules block opens and closes within the hunk, then an unrelated
        // array below it changes a severity-like value. The closed rules block
        // must reset rulesBraceDepth so the standalone severity is not treated
        // as a multiline rule severity.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,10 +10,10 @@',
          '    rules: {',
          "      'no-console': 'error',",
          '    },',
          '    const severityMap = {',
          '      fatal: [',
          '-       "error",',
          '+       "warn",',
          '    ],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag unrelated standalone max values after a closed rules block', () => {
        // A rules block with a ceiling rule closes, then an unrelated object
        // below changes a standalone max field. The closed rules block must
        // reset currentCeilingRuleKey so the max change is not attributed to
        // the prior ceiling rule.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,12 +10,12 @@',
          '    rules: {',
          "      'max-lines': ['error', { max: 800 }],",
          '    },',
          '    const limits = {',
          '      budget: {',
          '-        max: 100,',
          '+        max: 500,',
          '      },',
          '    };',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag new off entries in unrelated objects after a closed rules block', () => {
        // After a rules block closes, an unrelated object with an off-like
        // value must not be treated as a new rule off entry.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,8 +10,8 @@',
          '    rules: {',
          "      'no-console': 'error',",
          '    },',
          '    const featureFlags = {',
          '+      experimental: "off",',
          '    };',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('off/0'),
        );

        expect(violations).toEqual([]);
      });
    });

    describe('currentCeilingRuleKey reset on common rule-entry closures', () => {
      it('does not attribute a later max change to a max-lines rule ending with }],', () => {
        // A max-lines rule ends with "}],". Then an unrelated object below
        // changes a max field. The }], closure must clear ceiling context.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,10 +10,10 @@',
          '    rules: {',
          "      'max-lines': ['error', {",
          '        max: 800,',
          '      }],',
          '    },',
          '    const other = {',
          '-      max: 5,',
          '+      max: 50,',
          '    };',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toEqual([]);
      });

      it('does not attribute a later max change to a max-lines rule ending with } ],', () => {
        // Same as above but with a space before the bracket: "} ],".
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,10 +10,10 @@',
          '    rules: {',
          "      'max-lines': ['error', {",
          '        max: 800,',
          '      } ],',
          '    },',
          '    const other = {',
          '-      max: 5,',
          '+      max: 50,',
          '    };',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toEqual([]);
      });

      it('still catches a real max-lines threshold increase ending with }],', () => {
        // Ensure the }], closure recognition does not suppress a legitimate
        // threshold increase within the same ceiling rule.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,6 +10,6 @@',
          '    rules: {',
          "      'max-lines': ['error', {",
          '-        max: 800,',
          '+        max: 900,',
          '      }],',
          '    },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('max-lines');
      });
    });

    describe('stricter rule-shaped heuristic for no-context fallback', () => {
      it('does not flag rule-like keys inside const declarations', () => {
        // const docs = { 'no-console': 'error' } changed to 'warn' must NOT be
        // treated as a severity downgrade because it is not inside a rules
        // block and is a const declaration, not a rule assignment.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,3 +10,3 @@',
          "-const docs = { 'no-console': 'error' };",
          "+const docs = { 'no-console': 'warn' };",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag rule-like keys inside object assignments', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,3 +10,3 @@',
          "-  const cfg = { 'no-console': 2 };",
          "+  const cfg = { 'no-console': 1 };",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag ordinary assignment docs = {...} with rule-like keys', () => {
        // docs = { 'no-console': 'error' } changed to 'warn' must NOT be
        // treated as a severity downgrade because an ordinary assignment (=)
        // is not a bare rule entry inside a rules object.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,3 +10,3 @@',
          "-docs = { 'no-console': 'error' };",
          "+docs = { 'no-console': 'warn' };",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag settings.rules assignment with rule-like keys', () => {
        // settings.rules = { 'no-console': 2 } changed to 1 must NOT be
        // treated as a severity downgrade because a dotted assignment (=) is
        // not a bare rule entry inside a rules object.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,3 +10,3 @@',
          "-settings.rules = { 'no-console': 2 };",
          "+settings.rules = { 'no-console': 1 };",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag multiline unrelated docs object with rule-like key and severity', () => {
        // A multiline unrelated const object whose entries look like rule
        // entries (e.g. const docs = { 'no-console': 'error' -> 'warn' }) must
        // NOT be treated as a severity downgrade. The hunk HAS context lines
        // (const docs = { and };) but no rules: { context line, so
        // hasHunkContext is true and the zero-context fallback does NOT fire.
        // Since rulesBraceDepth is null (no rules: { context), the comparison
        // is gated to require rules-block context, preventing the false
        // positive.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,4 +10,4 @@',
          '  const docs = {',
          "-    'no-console': 'error',",
          "+    'no-console': 'warn',",
          '  };',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag multiline unrelated thresholds object with ceiling-rule-like key', () => {
        // A multiline unrelated const object whose entries look like ceiling
        // threshold entries (e.g. const thresholds = { complexity: ['error',
        // 25] -> ['error', 26] }) must NOT be treated as a ceiling threshold
        // increase. The hunk HAS context lines (const thresholds = { and };)
        // but no rules: { context line, so hasHunkContext is true and the
        // zero-context fallback does NOT fire. Since rulesBraceDepth is null,
        // the comparison is gated to require rules-block context, preventing
        // the false positive.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,4 +10,4 @@',
          '  const thresholds = {',
          "-    complexity: ['error', 25],",
          "+    complexity: ['error', 26],",
          '  };',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toEqual([]);
      });

      it('still preserves valid rule entries like quoted warn and array complexity', () => {
        // Bare rule entries (no const/let/var/=) must still be detected so
        // valid rule configs are not silently allowed to loosen.
        const downgradeDiff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "-      'no-console': 'warn',",
          "+      'no-console': 'off',",
        ].join(String.fromCharCode(10));
        const thresholdDiff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "-      complexity: ['error', 25],",
          "+      complexity: ['error', 26],",
        ].join(String.fromCharCode(10));

        expect(
          checkDiff(downgradeDiff).filter((v) =>
            v.message.includes('severity downgrade'),
          ),
        ).toHaveLength(1);
        expect(
          checkDiff(thresholdDiff).filter((v) =>
            v.message.includes('threshold increase'),
          ),
        ).toHaveLength(1);
      });

      it('still catches a real rule severity downgrade in a zero-context hunk', () => {
        // A real rule assignment line (bare, no const/=) must still be caught.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "-      'no-console': 'error',",
          "+      'no-console': 'warn',",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toHaveLength(1);
      });

      it('still catches a real ceiling threshold increase in a zero-context hunk', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "-      complexity: ['error', 25],",
          "+      complexity: ['error', 30],",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toHaveLength(1);
      });
    });

    describe('single-line nested rules objects', () => {
      it('catches a new off entry in a single-line nested rules object', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "+    rules: { 'no-console': 'off' },",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('off/0'),
        );

        expect(violations).toHaveLength(1);
      });

      it('catches a new numeric off entry in a single-line nested rules object', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "+    rules: { 'no-console': 0 },",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('off/0'),
        );

        expect(violations).toHaveLength(1);
      });

      it('catches a severity downgrade in a single-line nested rules object', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "-    rules: { 'no-console': 'error' },",
          "+    rules: { 'no-console': 'warn' },",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toHaveLength(1);
      });

      it('catches a ceiling threshold increase in a single-line nested rules object', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "-    rules: { complexity: ['error', 25] },",
          "+    rules: { complexity: ['error', 50] },",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toHaveLength(1);
      });

      it('catches a max object threshold increase in a single-line nested rules object', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "-    rules: { 'max-lines': ['error', { max: 800 }] },",
          "+    rules: { 'max-lines': ['error', { max: 900 }] },",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toHaveLength(1);
      });

      it('does not flag a severity upgrade in a single-line nested rules object', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "-    rules: { 'no-console': 'warn' },",
          "+    rules: { 'no-console': 'error' },",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag an allowed-off single-line nested rules object', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "+    rules: { 'no-console': 'off' }, // eslint-policy-allow-off: #2079",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('off/0'),
        );

        expect(violations).toEqual([]);
      });

      it('catches a cross-form threshold increase in a single-line nested rules object', () => {
        // object max -> numeric cross-form increase within a single-line
        // nested rules: { ... } object.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "-    rules: { 'max-lines': ['error', { max: 800 }] },",
          "+    rules: { 'max-lines': ['error', 900] },",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('max-lines');
      });

      it('catches a scalar-to-threshold addition in a single-line nested rules object', () => {
        // Scalar severity -> explicit threshold for a ceiling rule within a
        // single-line nested rules: { ... } object must be rejected.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "-    rules: { complexity: 'error' },",
          "+    rules: { complexity: ['error', 999] },",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('Adding a ceiling threshold'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('complexity');
      });
    });

    describe('TypeScript multiline block-comment suppression directives', () => {
      // TypeScript 5.8.x only recognizes @ts-ignore/@ts-expect-error/@ts-nocheck
      // when the directive appears on a single comment line (either a // line
      // comment or a single-line /* ... */ block comment). A directive inside a
      // multiline block comment (on a line other than the opener that also
      // closes) is NOT an effective suppression, so the guard must not flag it
      // (avoiding false positives on prose that merely mentions the directive).
      //
      // Verified against TypeScript 5.8.3:
      //   - // @ts-ignore             → effective suppression (flagged)
      //   - /* @ts-ignore */          → effective suppression (flagged)
      //   - /* leading @ts-ignore */  → NOT effective (not flagged)
      //   - /*\n * @ts-ignore\n */    → NOT effective (not flagged)
      //   - /* @ts-ignore\n */        → NOT effective (opener flagged conservatively)
      //   - reason @ts-ignore */      → NOT effective (not flagged)
      it('does not flag @ts-ignore mentioned inside a multiline block comment body', () => {
        const violations = checkDiff(
          diffFor(
            'packages/core/src/example.ts',
            '   /* leading prose mentioning @ts-ignore here',
          ),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag @ts-expect-error at the end of a multiline block comment', () => {
        const violations = checkDiff(
          diffFor(
            'packages/core/src/example.ts',
            '   reason text @ts-expect-error */',
          ),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag @ts-nocheck in a continuation line of a multiline block comment', () => {
        // In a multiline block comment, the directive on a continuation line
        // (after a leading *) is NOT an effective TS suppression.
        const violations = checkDiff(
          diffFor(
            'packages/core/src/example.ts',
            ' * @ts-nocheck some note about the directive',
          ),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag @ts-ignore not at the start of a single-line block comment', () => {
        // TypeScript does not recognize the directive when it is not at the
        // start of the comment text (after optional whitespace), even in a
        // single-line block comment.
        const violations = checkDiff(
          diffFor(
            'packages/core/src/example.ts',
            '/* leading text @ts-ignore */',
          ),
        );

        expect(violations).toEqual([]);
      });

      it('still flags @ts-ignore in a single-line block comment', () => {
        const violations = checkDiff(
          diffFor(
            'packages/core/src/example.ts',
            '/* @ts-ignore single-line reason */',
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('TypeScript suppression');
      });

      it('still flags @ts-ignore in a line comment', () => {
        const violations = checkDiff(
          diffFor('packages/core/src/example.ts', '// @ts-ignore reason'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('TypeScript suppression');
      });
    });

    describe('structural context: removed lines do not mutate brace context', () => {
      // Finding 1 (#2189 review): removed lines must not update
      // rulesBraceDepth/currentRuleKey/currentCeilingRuleKey. Only context
      // and added lines update structural context (the post-change view). A
      // changed multiline rule opener containing { is both removed and added;
      // if both sides mutated brace depth, the depth would be double-counted
      // and the guard would stay falsely inside a rules block after it
      // closes, flagging unrelated severity-like arrays/objects below.

      it('does not flag a severity-like array after a changed multiline rule opener', () => {
        // The rule opener "'no-console': [" is changed (removed and added).
        // After the rules block closes, an unrelated array changes an
        // error-like value. Without the fix, the double-counted brace delta
        // keeps rulesBraceDepth non-null after the block closes and the
        // standalone "warn" is falsely flagged as a multiline downgrade.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,12 +10,12 @@',
          '    rules: {',
          "-      'no-console': [",
          "+      'no-console': [",
          '        "error",',
          '      ],',
          '    },',
          '    const severityMap = {',
          '      fatal: [',
          '-       "error",',
          '+       "warn",',
          '    ],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag a standalone max after a changed multiline ceiling rule opener', () => {
        // A ceiling rule opener "'max-lines': ['error', {" is changed (removed
        // and added). After the rules block closes, an unrelated object below
        // changes a standalone max field. Without the fix, the double-counted
        // brace depth keeps currentCeilingRuleKey alive and the unrelated max
        // increase is falsely attributed to max-lines.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,14 +10,14 @@',
          '    rules: {',
          "        'max-lines': ['error', {",
          '-          max: 800,',
          '+          max: 900,',
          '        }],',
          '    },',
          '    const other = {',
          '      budget: {',
          '-        max: 100,',
          '+        max: 500,',
          '      },',
          '    };',
        ].join(String.fromCharCode(10));

        // Only the real max-lines increase (800 -> 900) should be reported.
        // The unrelated budget max change must NOT be attributed to max-lines.
        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('max-lines');
        expect(violations[0].message).toContain('800');
        expect(violations[0].message).toContain('900');
      });

      it('still detects a real multiline severity downgrade with a changed opener', () => {
        // Ensure the removed-line fix does not suppress a legitimate
        // multiline severity downgrade when the rule opener is also changed.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,8 +10,8 @@',
          '    rules: {',
          "-      'no-console': [",
          "+      'no-console': [",
          '-        "error",',
          '+        "warn",',
          '        { allow: [] },',
          '      ],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toHaveLength(1);
      });
    });

    describe('structural context: nested option keys do not reset rule key', () => {
      // Finding 2 (#2189 review): a custom option key not in STRUCTURAL_KEYS
      // (e.g. "customHint") inside a ceiling rule config must NOT replace
      // currentRuleKey/currentCeilingRuleKey. Without rule-entry depth
      // tracking, extractRuleKey would treat the option key as a rule key and
      // reset the ceiling context, causing later multiline max changes to be
      // missed (false negative).

      it('still attributes a later max change to the ceiling rule with a custom option key', () => {
        // The ceiling rule max-lines has a custom option key "customHint"
        // between the rule opener and the max field. The max increase must
        // still be attributed to max-lines.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,8 +10,8 @@',
          '      rules: {',
          "        'max-lines': ['error', {",
          '          customHint: "enforce",',
          '-          max: 800,',
          '+          max: 900,',
          '          skipBlankLines: true,',
          '        }],',
          '      },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('max-lines');
      });

      it('still attributes a later multiline severity change with a custom option key', () => {
        // A non-ceiling rule 'no-console' has a custom option key before the
        // standalone severity line. The severity downgrade must still be
        // attributed to no-console.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,8 +10,8 @@',
          '      rules: {',
          "        'no-console': [",
          '          customLabel: true,',
          '-        "error",',
          '+        "warn",',
          '        ],',
          '      },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('no-console');
      });

      it('recognizes a new sibling rule entry after a prior rule with custom options closes', () => {
        // After a ceiling rule with a custom option key closes, a second
        // ceiling rule (max-statements) must still be tracked as the current
        // ceiling rule for its own max increase.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,14 +10,14 @@',
          '      rules: {',
          "        'max-lines': ['error', {",
          '          customHint: "x",',
          '          max: 800,',
          '        }],',
          "        'max-statements': ['error', {",
          '          customHint: "y",',
          '-          max: 30,',
          '+          max: 40,',
          '        }],',
          '      },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('max-statements');
      });
    });

    describe('scalar rule preceding multiline rule (insideRuleEntry pin fix)', () => {
      // Finding (#2189 review): a single-line scalar rule entry like
      // "'no-console': 'error'," must NOT pin insideRuleEntry, because it
      // opens and closes on the same line. Previously, insideRuleEntry was
      // set for any rule key and only cleared on a closure line or rules-block
      // close. A single-line scalar entry has no subsequent closure line, so
      // the flag stayed pinned and the next multiline rule opener (e.g.
      // "'max-lines': ['error', {") was ignored — its max/severity changes were
      // missed (false negative). These end-to-end tests exercise the mixed
      // scalar/multiline scenario.

      it('catches a multiline ceiling threshold increase after a scalar rule', () => {
        // 'no-console': 'error', is a complete single-line scalar entry.
        // 'max-lines': ['error', { opens a multiline ceiling rule. Without the
        // fix, insideRuleEntry stays pinned from no-console and max-lines is
        // never tracked as the current ceiling rule, so the 800 -> 900 max
        // increase is missed.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,8 +10,8 @@',
          '      rules: {',
          "      'no-console': 'error',",
          "        'max-lines': ['error', {",
          '-          max: 800,',
          '+          max: 900,',
          '        }],',
          '      },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('max-lines');
        expect(violations[0].message).toContain('800');
        expect(violations[0].message).toContain('900');
      });

      it('catches a multiline severity downgrade after a scalar rule', () => {
        // 'no-console': 'error', is a complete single-line scalar entry.
        // 'no-unused': [ opens a multiline rule whose standalone severity
        // changes from error to warn. Without the fix, insideRuleEntry stays
        // pinned from no-console and no-unused is never tracked as the current
        // rule key, so the severity downgrade is missed.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,8 +10,8 @@',
          '      rules: {',
          "      'no-console': 'error',",
          "        'no-unused': [",
          '-        "error",',
          '+        "warn",',
          '          { args: "none" },',
          '        ],',
          '      },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('no-unused');
      });

      it('does not create a broad max false positive from a scalar ceiling rule followed by an unrelated max field', () => {
        // 'max-lines': ['error', { max: 800 }], is a complete single-line
        // ceiling rule entry. It must NOT pin insideRuleEntry or leave
        // currentCeilingRuleKey set, so a subsequent unrelated max field in a
        // non-ceiling context is NOT falsely attributed to max-lines.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,6 +10,6 @@',
          '      rules: {',
          "        'max-lines': ['error', { max: 800 }],",
          "        'no-restricted-syntax': ['error', {",
          '-          max: 5,',
          '+          max: 15,',
          '        }],',
          '      },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        // The max field under no-restricted-syntax is NOT a ceiling rule, so
        // the max 5 -> 15 increase must NOT be attributed to max-lines or
        // reported as a ceiling threshold increase.
        expect(violations).toEqual([]);
      });
    });

    describe('inline rules: consume removed entry on key match regardless of violation', () => {
      // Finding 3 (#2189 review): once an added inline entry matches a removed
      // inline entry by key, the removed entry must be consumed whether or not
      // compareRuleConfigChanges returns messages. Otherwise a no-op match
      // (same severity) leaves the removed entry stale and can cause false
      // positives or mis-attribution later.

      it('consumes a no-op inline match so a later separate downgrade is not double-counted', () => {
        // Two inline rules objects in one hunk. The first is a no-op
        // (no-console stays 'warn'); the second is a real downgrade
        // (no-unused error -> warn). The no-op must be consumed so its stale
        // removed entry does not interfere.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,3 +10,3 @@',
          "-    rules: { 'no-console': 'warn' },",
          "-    rules: { 'no-unused': 'error' },",
          "+    rules: { 'no-console': 'warn' },",
          "+    rules: { 'no-unused': 'warn' },",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('no-unused');
      });

      it('consumes a no-op inline match so a later downgrade is attributed to the right rule', () => {
        // Two removed inline entries for 'no-console': a no-op warn entry
        // followed by a real error entry. Two added inline entries: a no-op
        // warn entry followed by a warn entry. The first added (warn) must
        // consume the first removed (warn) no-op entry, so the second added
        // (warn) pairs with the second removed (error) and the real downgrade
        // is detected exactly once.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,3 +10,3 @@',
          "-    rules: { 'no-console': 'warn' },",
          "-    rules: { 'no-console': 'error' },",
          "+    rules: { 'no-console': 'warn' },",
          "+    rules: { 'no-console': 'warn' },",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        // The stale warn entry is consumed by the no-op add, so it does not
        // mask the real error->warn downgrade.
        expect(violations).toHaveLength(1);
      });
    });

    describe('removed-side rule context for realistic Git ordering (#2189 review)', () => {
      // In realistic Git unified-diff ordering, adjacent changed opener and
      // value lines are emitted as removed-then-added:
      //   - 'no-console': [
      //   -   'error',
      //   + 'no-console': [
      //   +   'warn',
      // The removed severity is processed BEFORE the added opener sets the
      // post-change currentRuleKey/currentCeilingRuleKey. Without a separate
      // removed-side rule context, bufferRemovedConfig would see a null key
      // and skip buffering the removed severity/max — causing a false negative
      // for realistic severity downgrades and max threshold increases.
      //
      // The fix maintains parallel removed-side rule context
      // (removedCurrentRuleKey/removedCurrentCeilingRuleKey) that tracks the
      // pre-change file view from removed lines, so removed multiline
      // severity/max values are correctly attributed to their enclosing rule
      // regardless of Git ordering.

      it('catches a multiline severity downgrade with realistic Git ordering (removed opener+value before added opener+value)', () => {
        // The removed opener and removed 'error' precede the added opener and
        // added 'warn'. The removed-side context must attribute the removed
        // 'error' to no-console before the post-change side sees the opener.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,8 +10,8 @@',
          '    rules: {',
          "-      'no-console': [",
          '-        "error",',
          "+      'no-console': [",
          '+        "warn",',
          '        { allow: [] },',
          '      ],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('no-console');
      });

      it('catches a multiline max threshold increase with realistic Git ordering (removed opener+max before added opener+max)', () => {
        // The removed opener and removed max: 800 precede the added opener and
        // added max: 900. The removed-side ceiling context must attribute the
        // removed max to max-lines before the post-change side sees the opener.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,8 +10,8 @@',
          '    rules: {',
          "        'max-lines': ['error', {",
          '-          max: 800,',
          "        'max-lines': ['error', {",
          '+          max: 900,',
          '          skipBlankLines: true,',
          '        }],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('max-lines');
        expect(violations[0].message).toContain('800');
        expect(violations[0].message).toContain('900');
      });

      it('catches a multiline numeric severity downgrade with realistic Git ordering', () => {
        // Same realistic ordering but with numeric severities (2 -> 1).
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,8 +10,8 @@',
          '    rules: {',
          "-      'no-console': [",
          '-        2,',
          "+      'no-console': [",
          '+        1,',
          '        { allow: [] },',
          '      ],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('no-console');
      });

      it('catches a multiline ceiling max increase for max-statements with realistic Git ordering', () => {
        // Different ceiling rule with numeric array form and realistic
        // removed-before-added ordering.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,8 +10,8 @@',
          '    rules: {',
          "        'max-statements': ['error', {",
          '-          max: 10,',
          "        'max-statements': ['error', {",
          '+          max: 20,',
          '          skipBlankLines: true,',
          '        }],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('max-statements');
      });

      it('does not double-count brace depth when opener is changed (removed+added)', () => {
        // The changed opener ('no-console': [) is both removed and added. The
        // post-change rulesBraceDepth must NOT be double-counted (removed
        // lines never mutate post-change context). After the rules block
        // closes, an unrelated array below must NOT be flagged.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,12 +10,12 @@',
          '    rules: {',
          "-      'no-console': [",
          '-        "error",',
          "+      'no-console': [",
          '+        "warn",',
          '        { allow: [] },',
          '      ],',
          '    },',
          '    const severityMap = {',
          '      fatal: [',
          '-       "error",',
          '+       "warn",',
          '    ],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        // Only the real no-console downgrade (error -> warn) should be
        // reported. The unrelated severityMap array must NOT produce a second
        // downgrade after the rules block closes.
        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('no-console');
      });

      it('does not cross-pair removed/added multiline severities across two rules with realistic ordering', () => {
        // Two multiline rules, each with realistic removed-before-added
        // ordering. Only no-console is actually downgraded; the removed
        // 'error' from no-console must NOT pair with an added severity from
        // another rule.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,14 +10,14 @@',
          '    rules: {',
          "        'no-console': [",
          '-        "error",',
          "+        'no-console': [",
          '+        "warn",',
          '          { allow: [] },',
          '        ],',
          "        'no-unused': [",
          '-        "error",',
          "+        'no-unused': [",
          '+        "error",',
          '        ],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        // Only the real downgrade (no-console error -> warn) is reported.
        // no-unused is unchanged (error -> error) and must not be flagged.
        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('no-console');
      });

      it('does not attribute a removed max to a non-matching ceiling rule with realistic ordering', () => {
        // A removed max-lines opener+max precedes an added max-statements
        // opener+max. The removed max from max-lines must NOT be attributed
        // to max-statements (different ceiling rule key).
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,14 +10,14 @@',
          '    rules: {',
          "        'max-lines': ['error', {",
          '-          max: 800,',
          "        'max-lines': ['error', {",
          '+          max: 800,',
          '          skipBlankLines: true,',
          '        }],',
          "        'max-statements': ['error', {",
          '-          max: 10,',
          "        'max-statements': ['error', {",
          '+          max: 20,',
          '          skipBlankLines: true,',
          '        }],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        // Only max-statements (10 -> 20) is a real increase. max-lines is
        // unchanged (800 -> 800) and must not be flagged.
        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('max-statements');
      });

      it('does not flag a removed max under a non-ceiling rule with realistic ordering', () => {
        // A removed max under a non-ceiling rule (no-restricted-syntax) with
        // realistic ordering must NOT be buffered as a ceiling threshold, so
        // the added max under the same non-ceiling rule is not flagged.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,8 +10,8 @@',
          '    rules: {',
          "        'no-restricted-syntax': ['error', {",
          '-          max: 5,',
          "        'no-restricted-syntax': ['error', {",
          '+          max: 15,',
          '          allow: [],',
          '        }],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toEqual([]);
      });

      it('still catches a standalone max threshold increase with unchanged opener (regression)', () => {
        // Regression: the realistic-ordering fix must not break the existing
        // case where the opener is unchanged (only the max line changes).
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,6 +10,6 @@',
          '    rules: {',
          "        'max-lines': ['error', {",
          '-          max: 800,',
          '+          max: 900,',
          '          skipBlankLines: true,',
          '        }],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('max-lines');
      });

      it('still catches a standalone multiline severity downgrade with unchanged opener (regression)', () => {
        // Regression: the realistic-ordering fix must not break the existing
        // case where the opener is unchanged (only the severity line changes).
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,6 +10,6 @@',
          '    rules: {',
          "      'no-console': [",
          '-        "error",',
          '+        "warn",',
          '        { allow: [] },',
          '      ],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('no-console');
      });
    });

    describe('insideRuleEntry gating for same-rule comparison and buffering (#2189 review finding 1)', () => {
      // Finding 1: The off/0 gate suppresses keyed option fields while
      // insideRuleEntry is true, but the same-rule severity/threshold
      // comparison path (pendingRemovedConfigs buffering +
      // compareRuleConfigChanges) did not. A multiline rule option such as
      // customOption: 'error' changed to customOption: 'warn' inside
      // no-restricted-syntax was buffered and compared as if customOption
      // were an ESLint rule key, producing a false severity-downgrade
      // violation. The fix applies the same insideRuleEntry gating to
      // pendingRemovedConfigs (bufferRemovedConfig) and the added-side
      // same-rule-key comparison, so keyed entries are not buffered or
      // compared while inside an existing rule-entry config object (unless
      // the key is the actual rule-entry opener at the rules-object level).

      it('does not flag customOption severity downgrade inside a multiline rule config object (no-restricted-syntax)', () => {
        // no-restricted-syntax has a customOption field that changes from
        // 'error' to 'warn'. customOption is not in STRUCTURAL_KEYS, so
        // before the fix it was treated as a rule key and the severity
        // comparison produced a false positive.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,8 +10,8 @@',
          '    rules: {',
          "      'no-restricted-syntax': ['error', {",
          "-        customOption: 'error',",
          "+        customOption: 'warn',",
          '        selector: ' + "'Literal'" + ',',
          '      }],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag a quoted customOption severity downgrade inside a multiline rule config object', () => {
        // A quoted custom option key must also not be treated as a rule key
        // while inside a rule-entry config object.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,8 +10,8 @@',
          '    rules: {',
          "      'no-restricted-syntax': ['error', {",
          "-        'customOption': 'error',",
          "+        'customOption': 'warn',",
          '        selector: ' + "'Literal'" + ',',
          '      }],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toEqual([]);
      });

      it('still catches a real severity downgrade on a neighboring rule (detection still works)', () => {
        // A neighboring real rule (no-unused) is downgraded from 'error' to
        // 'warn' at the rules-object entry level, while a customOption inside
        // no-restricted-syntax also changes. The real downgrade (removed
        // 'no-unused': 'error' paired with added 'no-unused': 'warn') must
        // still be detected, proving the insideRuleEntry gating does not
        // over-suppress legitimate rule-entry-level downgrades.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,10 +10,10 @@',
          '    rules: {',
          "-      'no-unused': 'error',",
          "      'no-restricted-syntax': ['error', {",
          "-        customOption: 'error',",
          "+        customOption: 'warn',",
          '      }],',
          "+      'no-unused': 'warn',",
          '    },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('no-unused');
      });

      it('still catches a real threshold increase on a neighboring ceiling rule', () => {
        // A real ceiling threshold increase (max-lines 800 -> 900) must still
        // be detected when a customOption inside no-restricted-syntax changes
        // in the same hunk. The insideRuleEntry gating must not suppress real
        // ceiling rule detection.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,10 +10,10 @@',
          '    rules: {',
          "        'max-lines': ['error', {",
          '-          max: 800,',
          '+          max: 900,',
          '        }],',
          "      'no-restricted-syntax': ['error', {",
          "-        customOption: 'error',",
          "+        customOption: 'warn',",
          '      }],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('max-lines');
      });

      it('still catches a real rule-entry-level severity downgrade in the same hunk', () => {
        // A rule at the rules-object entry level (not inside a config object)
        // is downgraded. insideRuleEntry must be false at that point so the
        // real downgrade is caught.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,4 +10,4 @@',
          '    rules: {',
          "-      'no-console': 'error',",
          "+      'no-console': 'warn',",
          '    },',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('no-console');
      });
    });

    describe('quoted multiline max threshold detection (#2189 review finding 2)', () => {
      // Finding 2: The multiline max threshold helpers
      // (isStandaloneMaxLine, isObjectFormMaxLine,
      // extractMaxValueFromStandaloneLine) handled only unquoted max keys.
      // ESLint config object keys may be quoted, e.g. { 'max': 800 }. The
      // helpers now accept an optional quote around the key while retaining
      // currentCeilingRuleKey gating so broad max false positives remain
      // avoided.

      it('catches a quoted standalone max threshold increase for max-lines', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,6 +10,6 @@',
          '    rules: {',
          "        'max-lines': ['error', {",
          "-          'max': 800,",
          "+          'max': 900,",
          '          skipBlankLines: true,',
          '        }],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('max-lines');
        expect(violations[0].message).toContain('800');
        expect(violations[0].message).toContain('900');
      });

      it('does not flag a quoted standalone max threshold decrease for max-lines', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,6 +10,6 @@',
          '    rules: {',
          "        'max-lines': ['error', {",
          "-          'max': 800,",
          "+          'max': 700,",
          '          skipBlankLines: true,',
          '        }],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toEqual([]);
      });

      it('catches a quoted object-form max threshold increase for max-statements', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,6 +10,6 @@',
          '    rules: {',
          "        'max-statements': ['error', {",
          "-          { 'max': 30, skipBlankLines: true },",
          "+          { 'max': 40, skipBlankLines: true },",
          '        }],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('max-statements');
        expect(violations[0].message).toContain('30');
        expect(violations[0].message).toContain('40');
      });

      it('does not flag a quoted object-form max threshold decrease for max-lines', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,6 +10,6 @@',
          '    rules: {',
          "        'max-lines': ['error', {",
          "-          { 'max': 800, skipBlankLines: true },",
          "+          { 'max': 700, skipBlankLines: true },",
          '        }],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag a quoted standalone max increase under a non-ceiling rule', () => {
        // A quoted max field under a non-ceiling rule (no-restricted-syntax)
        // must NOT be attributed to a ceiling rule. This exercises the
        // currentCeilingRuleKey gating with quoted keys.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,6 +10,6 @@',
          '    rules: {',
          "      'no-restricted-syntax': ['error', {",
          "-          'max': 5,",
          "+          'max': 50,",
          '        allow: [],',
          '      }],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toEqual([]);
      });

      it('does not flag a quoted object-form max increase under a non-ceiling rule', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,6 +10,6 @@',
          '    rules: {',
          "      'no-restricted-syntax': ['error', {",
          "-          { 'max': 5, allow: [] },",
          "+          { 'max': 50, allow: [] },",
          '      }],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toEqual([]);
      });

      it('catches a double-quoted standalone max threshold increase for max-lines', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 100644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10,6 +10,6 @@',
          '    rules: {',
          '        "max-lines": ["error", {',
          '-          "max": 800,',
          '+          "max": 900,',
          '          skipBlankLines: true,',
          '        }],',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('max-lines');
      });
    });
  });

  it('keeps the checked-in cli source policy clean', () => {
    expect(checkCliSourcePolicy()).toEqual([]);
  });

  it('keeps checked-in CLI production type escape policy clean except tracked shared seams', () => {
    expect(scanCliProductionTypeEscapes()).toEqual([]);
  });

  it('rejects production CLI TypeScript escape hatches in cleaned scopes', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-cli-types-'));
    const sourceDir = join(tmpDir, 'packages', 'cli', 'src', 'ui');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(
      join(sourceDir, 'example.ts'),
      [
        'export function unsafe(value: unknown): string {',
        '  return value as unknown as string;',
        '}',
      ].join('\n'),
    );

    const violations = scanCliProductionTypeEscapes(tmpDir);

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('#2174');
  });

  it('ignores CLI test files when checking production type escape policy', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-cli-test-types-'));
    const sourceDir = join(tmpDir, 'packages', 'cli', 'src', 'ui');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(
      join(sourceDir, 'example.test.ts'),
      [
        'export function testOnly(value: unknown): string {',
        '  return value as unknown as string;',
        '}',
      ].join('\n'),
    );

    expect(scanCliProductionTypeEscapes(tmpDir)).toEqual([]);
  });

  describe('unrelated rules config fields (#2189 review finding 1)', () => {
    // A `rules: { ... }` property inside an unrelated object (e.g.
    // const meta = { rules: { 'no-console': 'off' } }) must NOT be treated
    // as an ESLint config rules block. Both single-line and multiline forms
    // must be rejected, while actual ESLint config rules blocks still flag
    // downgrades (#2189 review finding 1).

    it('does not flag single-line const meta object with rules property', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10 +10 @@',
        "+const meta = { rules: { 'no-console': 'off' } };",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });

    it('does not flag assignment object with rules property (single line)', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10 +10 @@',
        "+meta = { rules: { 'no-console': 'off' } };",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });

    it('does not flag multiline const meta object with rules property on context line', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10,3 +10,3 @@',
        '  const meta = {',
        "    rules: { 'no-console': 'off' },",
        '  };',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });

    it('does not flag multiline const meta object with rules property as added line', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10,3 +10,4 @@',
        '  const meta = {',
        "+    rules: { 'no-console': 'off' },",
        '  };',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });

    it('does not flag multiline const meta with multiline rules object', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10,3 +10,6 @@',
        '  const meta = {',
        '+    rules: {',
        "+      'no-console': 'off',",
        '+    },',
        '  };',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });

    it('still flags severity downgrade in actual ESLint config rules block', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,3 +1,3 @@',
        '  rules: {',
        "-    'no-console': 'error',",
        "+    'no-console': 'warn',",
        '  },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('severity downgrade');
    });

    it('still flags off/0 entry in actual ESLint config rules block', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,2 +1,3 @@',
        '  rules: {',
        "+    'no-console': 'off',",
        '  },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toHaveLength(1);
    });

    it('still flags threshold increase in actual ESLint config rules block', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,3 +1,3 @@',
        '  rules: {',
        "-    complexity: ['error', 25],",
        "+    complexity: ['error', 30],",
        '  },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('threshold increase');
    });

    it('still flags inline rules downgrade in actual config context', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,2 +1,2 @@',
        "-    rules: { 'no-console': 'error' },",
        "+    rules: { 'no-console': 'warn' },",
        '  },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('severity downgrade');
    });
  });

  describe('nested non-rule container properties (#2189 review finding 2)', () => {
    // A `rules:` property nested inside a known non-rule container
    // (settings, languageOptions, plugins, etc.) is NOT the ESLint policy
    // rules object — it is application data consumed by plugins/shared
    // configs. Both single-line and multiline forms must be rejected, while
    // actual top-level ESLint config rules blocks still flag downgrades and
    // off/0 entries (#2189 review finding 2).

    it('does not flag single-line settings.rules off entry', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10 +10 @@',
        "+  settings: { rules: { 'no-console': 'off' } },",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });

    it('does not flag single-line settings.rules severity downgrade', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10 +10 @@',
        "-  settings: { rules: { 'no-console': 'error' } },",
        "+  settings: { rules: { 'no-console': 'warn' } },",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('severity downgrade'),
      );
      expect(violations).toEqual([]);
    });

    it('does not flag single-line languageOptions.rules off entry', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10 +10 @@',
        "+  languageOptions: { rules: { complexity: 'off' } },",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });

    it('does not flag multiline settings.rules off entry', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10,1 +10,4 @@',
        '  settings: {',
        '+    rules: {',
        "+      'no-console': 'off',",
        '+    },',
        '  },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });

    it('does not flag multiline settings.rules severity downgrade', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10,4 +10,4 @@',
        '  settings: {',
        '    rules: {',
        "-      'no-console': 'error',",
        "+      'no-console': 'warn',",
        '    },',
        '  },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('severity downgrade'),
      );
      expect(violations).toEqual([]);
    });

    it('does not flag multiline languageOptions.rules threshold increase', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10,4 +10,4 @@',
        '  languageOptions: {',
        '    rules: {',
        "-      complexity: ['error', 25],",
        "+      complexity: ['error', 50],",
        '    },',
        '  },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('threshold increase'),
      );
      expect(violations).toEqual([]);
    });

    it('does not flag single-line plugins.rules off entry', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10 +10 @@',
        "+  plugins: { rules: { 'no-console': 'off' } },",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });

    it('does not flag a sibling top-level rules block after settings closes', () => {
      // settings: { ... } closes, then a sibling top-level rules: { ... }
      // block opens. The sibling rules block IS the ESLint policy rules
      // object and must still be checked. This proves the non-rule container
      // tracking correctly closes when settings closes and does not suppress
      // a legitimate sibling rules block.
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10,4 +10,5 @@',
        '  settings: { shared: true },',
        '  rules: {',
        "+    'no-console': 'off',",
        '  },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toHaveLength(1);
    });

    it('still flags a real top-level rules block severity downgrade', () => {
      // Regression guard: tightening the rules-block context must not break
      // detection of real top-level rules blocks.
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,3 +1,3 @@',
        '  rules: {',
        "-    'no-console': 'error',",
        "+    'no-console': 'warn',",
        '  },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('severity downgrade');
    });

    it('still flags a real top-level rules block threshold increase', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,3 +1,3 @@',
        '  rules: {',
        "-    complexity: ['error', 25],",
        "+    complexity: ['error', 30],",
        '  },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('threshold increase');
    });
  });

  describe('quoted non-rule container keys (#2189 review finding)', () => {
    // Quoted container keys ('settings': { ... }, "languageOptions": { ... })
    // must be recognized just like unquoted ones, so a nested rules: property
    // inside a quoted container is NOT treated as the ESLint policy rules
    // block. This covers the same-line container check in
    // isRulesInArbitraryContext and isNonRuleContainerOpen, which previously
    // built patterns like \bsettings\s*:\s*\{ missing quoted config keys
    // (#2189 review finding).

    it('does not flag quoted single-line settings.rules off entry', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10 +10 @@',
        "+  'settings': { rules: { 'no-console': 'off' } },",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });

    it('does not flag double-quoted single-line languageOptions.rules off entry', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10 +10 @@',
        '+  "languageOptions": { rules: { complexity: 0 } },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });

    it('does not flag quoted single-line settings.rules severity downgrade', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10 +10 @@',
        "-  'settings': { rules: { 'no-console': 'error' } },",
        "+  'settings': { rules: { 'no-console': 'warn' } },",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('severity downgrade'),
      );
      expect(violations).toEqual([]);
    });

    it('does not flag double-quoted single-line languageOptions.rules threshold increase', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10 +10 @@',
        '-  "languageOptions": { rules: { complexity: [2, 25] } },',
        '+  "languageOptions": { rules: { complexity: [2, 50] } },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('threshold increase'),
      );
      expect(violations).toEqual([]);
    });

    it('does not flag multiline quoted settings.rules off entry', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10,1 +10,4 @@',
        "  'settings': {",
        '+    rules: {',
        "+      'no-console': 'off',",
        '+    },',
        '  },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });

    it('still flags a real top-level rules block with quoted container sibling', () => {
      // A quoted settings: { ... } closes, then a sibling top-level rules:
      // { ... } block opens. The sibling rules block IS the ESLint policy
      // rules object and must still be checked even though the preceding
      // container was quoted.
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10,4 +10,5 @@',
        "  'settings': { shared: true },",
        '  rules: {',
        "+    'no-console': 'off',",
        '  },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toHaveLength(1);
    });
  });

  describe('single-line sibling rules after a closed non-rule container (#2189 review finding)', () => {
    // A `rules:` property that is a SIBLING after a closed non-rule container
    // on the same line (e.g. `{ languageOptions: {}, rules: { ... } }` or
    // `export default [{ settings: {}, rules: { ... } }]`) is the ESLint policy
    // rules block and MUST be checked. The previous logic in
    // isRulesInArbitraryContext treated any known non-rule container key
    // appearing before `rules:` on the same line as proof of nesting, even
    // when the container's braces had already closed. This caused a false
    // negative that suppressed real severity downgrades, threshold increases,
    // and new off/0 entries in valid flat-config rule blocks. The fix performs
    // a structural scan from each container opener to the `rules:` match and
    // only suppresses detection when the container object remains open (brace
    // depth > 0) at `rules:` (#2189 review finding).

    it('flags a severity downgrade in a sibling rules block after closed languageOptions', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1 +1 @@',
        "-  { languageOptions: {}, rules: { 'no-console': 'error' } },",
        "+  { languageOptions: {}, rules: { 'no-console': 'warn' } },",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('severity downgrade'),
      );
      expect(violations).toHaveLength(1);
    });

    it('flags a threshold increase in a sibling rules block after closed languageOptions', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1 +1 @@',
        "-  { languageOptions: {}, rules: { complexity: ['error', 20] } },",
        "+  { languageOptions: {}, rules: { complexity: ['error', 25] } },",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('threshold increase'),
      );
      expect(violations).toHaveLength(1);
    });

    it('flags a new off/0 entry in a sibling rules block after closed languageOptions', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1 +1 @@',
        "-  { languageOptions: {}, rules: { 'no-console': 'error' } },",
        "+  { languageOptions: {}, rules: { 'no-console': 'off' } },",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toHaveLength(1);
    });

    it('flags a severity downgrade in a sibling rules block after closed settings', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1 +1 @@',
        "-  { settings: {}, rules: { 'no-console': 'error' } },",
        "+  { settings: {}, rules: { 'no-console': 'warn' } },",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('severity downgrade'),
      );
      expect(violations).toHaveLength(1);
    });

    it('flags a new off/0 entry in export default sibling rules after closed settings', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1 +1 @@',
        "-export default [{ settings: {}, rules: { 'no-console': 'error' } }]",
        "+export default [{ settings: {}, rules: { 'no-console': 'off' } }]",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toHaveLength(1);
    });

    it('flags a threshold increase in export default sibling rules after closed settings', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1 +1 @@',
        "-export default [{ settings: {}, rules: { complexity: ['error', 10] } }]",
        "+export default [{ settings: {}, rules: { complexity: ['error', 30] } }]",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('threshold increase'),
      );
      expect(violations).toHaveLength(1);
    });

    it('still suppresses detection for truly nested settings.rules on one line', () => {
      // settings: { rules: { ... } } — rules IS nested inside settings and is
      // application data, NOT the policy rules block. This must NOT be flagged.
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1 +1 @@',
        "-  settings: { rules: { 'no-console': 'error' } },",
        "+  settings: { rules: { 'no-console': 'warn' } },",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff);
      expect(violations).toEqual([]);
    });

    it('still suppresses detection for truly nested languageOptions.rules on one line', () => {
      // languageOptions: { rules: { ... } } — rules IS nested inside
      // languageOptions and is application data, NOT the policy rules block.
      // This must NOT be flagged.
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1 +1 @@',
        "-  languageOptions: { rules: { complexity: ['error', 25] } },",
        "+  languageOptions: { rules: { complexity: ['error', 50] } },",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff);
      expect(violations).toEqual([]);
    });

    it('still suppresses detection for truly nested quoted settings.rules on one line', () => {
      // Quoted nested form: 'settings': { rules: { ... } }. rules IS nested.
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10 +10 @@',
        "-  'settings': { rules: { 'no-console': 'error' } },",
        "+  'settings': { rules: { 'no-console': 'off' } },",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });

    it('treats a closed nested-array container value as a sibling rules block', () => {
      // The container value contains a closed array before rules:, so rules is
      // a sibling: settings: { a: [1], rules: { ... } } is actually nested,
      // BUT here we test that a fully-closed settings object followed by a
      // sibling rules (with an intervening array literal) is detected.
      // settings: { data: [1, 2] } closes, then rules: { ... } is a sibling.
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1 +1 @@',
        "-  { settings: { data: [1, 2] }, rules: { 'no-console': 'error' } },",
        "+  { settings: { data: [1, 2] }, rules: { 'no-console': 'warn' } },",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('severity downgrade'),
      );
      expect(violations).toHaveLength(1);
    });
  });

  describe('extractRuleKey table-driven parser tests (#2189 review finding)', () => {
    // Table-driven tests covering the full syntax of ESLint rule IDs that
    // extractRuleKey must parse: core rules, plugin rules (slash-separated),
    // and scoped plugin rules (@scope/plugin/rule). The centralized rule-id
    // regex must accept the leading @ so scoped rules like
    // @typescript-eslint/no-explicit-any are recognized.
    const CASES = [
      {
        label: 'core rule (unquoted)',
        input: "no-console: 'error',",
        expected: 'no-console',
      },
      {
        label: 'core rule (single-quoted)',
        input: "'no-console': 'error',",
        expected: 'no-console',
      },
      {
        label: 'core rule (double-quoted)',
        input: '"no-console": "error",',
        expected: 'no-console',
      },
      {
        label: 'core rule with hyphen',
        input: "'no-unused-vars': 2,",
        expected: 'no-unused-vars',
      },
      {
        label: 'plugin rule (slash-separated, single-quoted)',
        input: "'sonarjs/cognitive-complexity': ['error', 30],",
        expected: 'sonarjs/cognitive-complexity',
      },
      {
        label: 'plugin rule (slash-separated, unquoted)',
        input: 'sonarjs/cognitive-complexity: 2,',
        expected: 'sonarjs/cognitive-complexity',
      },
      {
        label: 'scoped plugin rule (@scope/plugin/rule, single-quoted)',
        input: "'@typescript-eslint/no-explicit-any': 'error',",
        expected: '@typescript-eslint/no-explicit-any',
      },
      {
        label: 'scoped plugin rule (@scope/plugin/rule, double-quoted)',
        input: '"@typescript-eslint/no-explicit-any": "warn",',
        expected: '@typescript-eslint/no-explicit-any',
      },
      {
        label: 'scoped plugin rule (unquoted)',
        input: '@typescript-eslint/no-explicit-any: 2,',
        expected: '@typescript-eslint/no-explicit-any',
      },
      {
        label: 'scoped rule with underscore',
        input: "'@typescript-eslint/ban_ts_comment': 'off',",
        expected: '@typescript-eslint/ban_ts_comment',
      },
      {
        label: 'custom scoped plugin',
        input: "'@my-scope/custom-rule': 'error',",
        expected: '@my-scope/custom-rule',
      },
      {
        label: 'array-form scoped rule',
        input: "'@typescript-eslint/no-explicit-any': ['error'],",
        expected: '@typescript-eslint/no-explicit-any',
      },
      {
        label: 'object-form scoped rule opener',
        input: "'@typescript-eslint/no-explicit-any': {",
        expected: '@typescript-eslint/no-explicit-any',
      },
    ];

    for (const testCase of CASES) {
      it('parses ' + testCase.label, () => {
        expect(extractRuleKey(testCase.input)).toBe(testCase.expected);
      });
    }

    it('returns null for structural keys', () => {
      expect(extractRuleKey('rules: {')).toBeNull();
      expect(extractRuleKey('files: [')).toBeNull();
      expect(extractRuleKey('settings: {')).toBeNull();
      expect(extractRuleKey('plugins: {}')).toBeNull();
    });

    it('returns null for option property keys', () => {
      expect(extractRuleKey('max: 800,')).toBeNull();
      expect(extractRuleKey('allow: [],')).toBeNull();
      expect(extractRuleKey('skipBlankLines: true,')).toBeNull();
    });

    it('returns null for non-key lines', () => {
      expect(extractRuleKey("'error',")).toBeNull();
      expect(extractRuleKey('800,')).toBeNull();
      expect(extractRuleKey('// comment')).toBeNull();
    });

    it('anchors to the first key (does not extract nested keys)', () => {
      expect(
        extractRuleKey("'custom-rules': { complexity: ['error', 50] }"),
      ).toBe('custom-rules');
    });
  });

  describe('scoped ESLint rule IDs (#2189 review finding)', () => {
    // Scoped ESLint rule IDs beginning with @ (e.g.
    // @typescript-eslint/no-explicit-any) must be parsed by the rule-key
    // regex. Previously the character class [a-zA-Z0-9/_-] excluded @,
    // causing extractRuleKey to return null for scoped rules and bypassing
    // same-line severity downgrade detection, new off/0 detection, multiline
    // context attribution, and inline rules extraction. These end-to-end
    // checkDiff tests prove scoped rules are now handled consistently across
    // all detection paths.

    function configDiff(file, removedLine, addedLine) {
      return [
        'diff --git a/' + file + ' b/' + file,
        'index 0000000..1111111 100644',
        '--- a/' + file,
        '+++ b/' + file,
        '@@ -1,1 +1,1 @@',
        '  rules: {',
        '-' + removedLine,
        '+' + addedLine,
        '  },',
      ].join(String.fromCharCode(10));
    }

    function rulesBlockOpenerDiff(addedLine) {
      return [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,0 +1,2 @@',
        '  rules: {',
        '+' + addedLine,
      ].join(String.fromCharCode(10));
    }

    describe('severity downgrades for scoped rules', () => {
      it('catches string severity downgrade for @typescript-eslint/no-explicit-any', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      '@typescript-eslint/no-explicit-any': 'error',",
            "      '@typescript-eslint/no-explicit-any': 'warn',",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('severity downgrade');
        expect(violations[0].message).toContain(
          '@typescript-eslint/no-explicit-any',
        );
      });

      it('catches numeric severity downgrade (2 -> 1) for a scoped rule', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      '@typescript-eslint/no-explicit-any': 2,",
            "      '@typescript-eslint/no-explicit-any': 1,",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('severity downgrade');
      });

      it('catches array-form severity downgrade for a scoped rule', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      '@typescript-eslint/no-explicit-any': ['error', { ignoreArgs: [] }],",
            "      '@typescript-eslint/no-explicit-any': ['warn', { ignoreArgs: [] }],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('severity downgrade');
      });

      it('catches numeric array-form severity downgrade (2 -> 1) for a scoped rule', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      '@typescript-eslint/no-explicit-any': [2],",
            "      '@typescript-eslint/no-explicit-any': [1],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('severity downgrade');
      });

      it('catches double-quoted scoped rule severity downgrade', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            '      "@typescript-eslint/no-explicit-any": "error",',
            '      "@typescript-eslint/no-explicit-any": "warn",',
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('severity downgrade');
      });

      it('does not flag severity upgrade for a scoped rule', () => {
        const violations = checkDiff(
          configDiff(
            'eslint.config.js',
            "      '@typescript-eslint/no-explicit-any': 'warn',",
            "      '@typescript-eslint/no-explicit-any': 'error',",
          ),
        );

        expect(violations).toEqual([]);
      });
    });

    describe('new off/0 entries for scoped rules', () => {
      it('rejects new string off entry for a scoped rule', () => {
        const violations = checkDiff(
          diffFor(
            'eslint.config.js',
            "      '@typescript-eslint/no-explicit-any': 'off',",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('off/0');
      });

      it('rejects new numeric 0 entry for a scoped rule', () => {
        const violations = checkDiff(
          diffFor(
            'eslint.config.js',
            "      '@typescript-eslint/no-explicit-any': 0,",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('off/0');
      });

      it('rejects new array-form [0] entry for a scoped rule', () => {
        const violations = checkDiff(
          diffFor(
            'eslint.config.js',
            "      '@typescript-eslint/no-explicit-any': [0],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('off/0');
      });

      it('rejects new array-form [0, ...] entry for a scoped rule', () => {
        const violations = checkDiff(
          diffFor(
            'eslint.config.js',
            "      '@typescript-eslint/no-explicit-any': [0, { ignoreArgs: [] }],",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('off/0');
      });

      it('rejects new string off entry for a scoped rule inside a rules block', () => {
        const violations = checkDiff(
          rulesBlockOpenerDiff(
            "      '@typescript-eslint/no-explicit-any': 'off',",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('off/0');
      });

      it('rejects keyed multiline opener off for a scoped rule', () => {
        const violations = checkDiff(
          rulesBlockOpenerDiff(
            "      '@typescript-eslint/no-explicit-any': ['off',",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('off/0');
      });

      it('allows scoped rule off with eslint-policy-allow-off marker', () => {
        const violations = checkDiff(
          diffFor(
            'eslint.config.js',
            "      '@typescript-eslint/no-explicit-any': 'off', // eslint-policy-allow-off: #2199",
          ),
        );

        expect(violations).toEqual([]);
      });
    });

    describe('scoped rules inside single-line nested rules objects', () => {
      it('catches a new off entry for a scoped rule in a nested rules object', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "+    rules: { '@typescript-eslint/no-explicit-any': 'off' },",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('off/0'),
        );

        expect(violations).toHaveLength(1);
      });

      it('catches a severity downgrade for a scoped rule in a nested rules object', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "-    rules: { '@typescript-eslint/no-explicit-any': 'error' },",
          "+    rules: { '@typescript-eslint/no-explicit-any': 'warn' },",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );

        expect(violations).toHaveLength(1);
      });

      it('catches a numeric off entry for a scoped rule in a nested rules object', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "+    rules: { '@typescript-eslint/no-explicit-any': 0 },",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('off/0'),
        );

        expect(violations).toHaveLength(1);
      });
    });

    describe('scoped rules in zero-context diffs', () => {
      function scopedZeroContextDiff(removedLine, addedLine) {
        return [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          '-' + removedLine,
          '+' + addedLine,
        ].join(String.fromCharCode(10));
      }

      it('catches scoped rule severity downgrade in zero-context diff', () => {
        const violations = checkDiff(
          scopedZeroContextDiff(
            "      '@typescript-eslint/no-explicit-any': 'error',",
            "      '@typescript-eslint/no-explicit-any': 'warn',",
          ),
        );

        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('severity downgrade');
      });

      it('catches scoped rule new off entry in zero-context diff', () => {
        const violations = checkDiff(
          scopedZeroContextDiff(
            "      '@typescript-eslint/no-explicit-any': 'error',",
            "      '@typescript-eslint/no-explicit-any': 'off',",
          ),
        );

        expect(violations).toHaveLength(1);
      });
    });
  });

  describe('export default flat-config rules objects (#2189 review finding)', () => {
    // The `export default [{ rules: { ... } }]` (and the object form
    // `export default { rules: { ... } }`) is a valid ESLint flat-config
    // export form. Single-line severity downgrades and new off/0 entries in
    // this export form must be detected. The guard must distinguish the valid
    // export-default config context from arbitrary object data (const/let/var
    // declarations and assignments) without reintroducing false positives
    // (#2189 review finding).

    it('catches a new off entry in an export default array config', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10 +10 @@',
        "+export default [{ rules: { 'no-console': 'off' } }];",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toHaveLength(1);
    });

    it('catches a severity downgrade in an export default array config', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10 +10 @@',
        "-export default [{ rules: { 'no-console': 'error' } }];",
        "+export default [{ rules: { 'no-console': 'warn' } }];",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('severity downgrade'),
      );
      expect(violations).toHaveLength(1);
    });

    it('catches a ceiling threshold increase in an export default array config', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10 +10 @@',
        '-export default [{ rules: { complexity: [2, 25] } }];',
        '+export default [{ rules: { complexity: [2, 50] } }];',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('threshold increase'),
      );
      expect(violations).toHaveLength(1);
    });

    it('catches a new off entry in an export default object config', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10 +10 @@',
        "+export default { rules: { 'no-console': 'off' } };",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toHaveLength(1);
    });

    it('catches a severity downgrade in an export default object config', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10 +10 @@',
        '-export default { rules: { "no-console": "error" } };',
        '+export default { rules: { "no-console": "warn" } };',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('severity downgrade'),
      );
      expect(violations).toHaveLength(1);
    });

    it('catches a ceiling threshold increase in an export default object config', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10 +10 @@',
        '-export default { rules: { complexity: ["error", 25] } };',
        '+export default { rules: { complexity: ["error", 30] } };',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('threshold increase'),
      );
      expect(violations).toHaveLength(1);
    });

    it('still rejects const declaration with rules property as arbitrary data', () => {
      // export const config = { rules: { ... } } must NOT be treated as a
      // valid flat-config export form because it has an identifier (config)
      // and assignment between export and rules. Only `export default`
      // followed by structural object/array syntax is a valid config export.
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10 +10 @@',
        "+export const config = { rules: { 'no-console': 'off' } };",
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toEqual([]);
    });

    it('still rejects export default with an identifier before rules as arbitrary data', () => {
      // `export default someConfig` followed by a rules property on another
      // line or via an identifier is NOT a direct flat-config export. The
      // text between `export default` and `rules:` must be only structural
      // object/array syntax.
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -10 +10 @@',
        "+export default [{ otherKey: true, rules: { 'no-console': 'off' } }];",
      ].join(String.fromCharCode(10));

      // This SHOULD still be detected because the identifier `otherKey` is
      // a property key inside the config object, not before the config export.
      // The structural-syntax check only applies to the text between
      // `export default` and the first object/array opener.
      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('off/0'),
      );
      expect(violations).toHaveLength(1);
    });
  });

  describe('multiline numeric-array threshold detection (#2189 review finding 2)', () => {
    // The common multiline numeric-array shape where severity and threshold
    // are separate array elements on separate lines (e.g.

    describe('export default tseslint.config function-call wrapper (#2189 review finding)', () => {
      // This project uses `export default tseslint.config(...)` as its flat
      // config export form (see eslint.config.js). A single-line config entry
      // such as `export default tseslint.config({ rules: { complexity: ['error',
      // 25] } })` changed to 50 must be detected. The function-call wrapper
      // form must be recognized as a valid config context so inline rules inside
      // it are checked, while severity downgrades, threshold increases, and new
      // off/0 entries are all caught.

      it('catches a new off entry in an export default tseslint.config call', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "+export default tseslint.config({ rules: { 'no-console': 'off' } });",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('off/0'),
        );
        expect(violations).toHaveLength(1);
      });

      it('catches a severity downgrade in an export default tseslint.config call', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "-export default tseslint.config({ rules: { 'no-console': 'error' } });",
          "+export default tseslint.config({ rules: { 'no-console': 'warn' } });",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('severity downgrade'),
        );
        expect(violations).toHaveLength(1);
      });

      it('catches a ceiling threshold increase in an export default tseslint.config call', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          '-export default tseslint.config({ rules: { complexity: ["error", 25] } });',
          '+export default tseslint.config({ rules: { complexity: ["error", 50] } });',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );
        expect(violations).toHaveLength(1);
      });

      it('catches a new off entry in an export default eslint.config call', () => {
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          '+export default eslint.config({ rules: { "no-console": "off" } });',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('off/0'),
        );
        expect(violations).toHaveLength(1);
      });

      it('still rejects export default with an unrecognized wrapper as arbitrary data', () => {
        // An arbitrary function call like `export default foo({ rules: ... })`
        // is NOT a recognized flat-config wrapper (only `.config(` is). The
        // `export` keyword before `rules:` marks it as arbitrary context, so
        // inline rules inside it are NOT extracted.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "+export default foo({ rules: { 'no-console': 'off' } });",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('off/0'),
        );
        expect(violations).toEqual([]);
      });
    });

    describe('anchored inline rule-key extraction (#2189 review finding)', () => {
      // extractRuleKey and extractInlineRulesEntries must be anchored so that
      // nested properties inside an unrelated container value are NOT mistaken
      // for top-level rule entries. A segment like
      // `'custom-rules': { complexity: ['error', 50] }` has a top-level key
      // `custom-rules` whose direct value is a plain object `{ ... }`. The
      // nested `complexity` property inside it must NOT be extracted as a rule
      // key, and the nested severity-like value must NOT be treated as the
      // container's severity.

      it('does not flag nested complexity inside a custom-rules container object', () => {
        // The `'custom-rules': { complexity: ['error', 50] }` segment is a
        // container with a nested rule-like property. The direct value is a
        // plain object `{ ... }`, so it is NOT a rule entry. The nested
        // complexity threshold must NOT be flagged as a ceiling threshold.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "+export default { rules: { 'custom-rules': { complexity: ['error', 50] } } };",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff);
        expect(violations).toEqual([]);
      });

      it('does not flag nested no-console off inside a custom-rules container object', () => {
        // The `'custom-rules': { 'no-console': 'off' }` segment is a container
        // with a nested off entry. The direct value is a plain object, so the
        // nested 'off' must NOT be treated as a new off/0 rule entry.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "+export default { rules: { 'custom-rules': { 'no-console': 'off' } } };",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('off/0'),
        );
        expect(violations).toEqual([]);
      });

      it('does not flag nested complexity inside a custom-rules container in a config call', () => {
        // Same false-positive guard but inside `export default tseslint.config(
        // { rules: { 'custom-rules': { complexity: ['error', 50] } } })`.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          '+export default tseslint.config({ rules: { "custom-rules": { complexity: ["error", 50] } } });',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff);
        expect(violations).toEqual([]);
      });

      it('still detects a real top-level complexity threshold increase alongside a container', () => {
        // A real top-level complexity entry AND a custom-rules container in the
        // same inline rules object. The real complexity increase must be
        // detected; the nested one inside custom-rules must NOT.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          '-export default { rules: { complexity: ["error", 25], "custom-rules": { complexity: ["error", 50] } } };',
          '+export default { rules: { complexity: ["error", 30], "custom-rules": { complexity: ["error", 50] } } };',
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('threshold increase'),
        );
        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain('complexity');
        expect(violations[0].message).toContain('25');
        expect(violations[0].message).toContain('30');
      });

      it('still detects a real top-level off entry alongside a container', () => {
        // A real top-level 'no-console': 'off' entry AND a custom-rules
        // container with a nested off in the same inline rules object. The real
        // top-level off must be detected; the nested one must NOT.
        const diff = [
          'diff --git a/eslint.config.js b/eslint.config.js',
          'index 0000000..1111111 644',
          '--- a/eslint.config.js',
          '+++ b/eslint.config.js',
          '@@ -10 +10 @@',
          "+export default { rules: { 'no-console': 'off', 'custom-rules': { 'no-console': 'off' } } };",
        ].join(String.fromCharCode(10));

        const violations = checkDiff(diff).filter((v) =>
          v.message.includes('off/0'),
        );
        expect(violations).toHaveLength(1);
      });
    });
    //   complexity: [
    //     'error',
    //     25,
    //   ]
    // changed to 30) must be detected. Threshold increases are rejected,
    // decreases/equality are allowed, and unrelated standalone numeric
    // values are not false-positive flagged (#2189 review finding 2).

    it('rejects multiline numeric threshold increase for complexity', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,5 +1,5 @@',
        '  rules: {',
        "    complexity: ['error',",
        '-    25,',
        '+    30,',
        '    ],',
        '  },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('threshold increase');
      expect(violations[0].message).toContain('complexity');
    });

    it('rejects multiline numeric threshold increase for max-lines', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,5 +1,5 @@',
        '  rules: {',
        "    'max-lines': ['error',",
        '-    800,',
        '+    900,',
        '    ],',
        '  },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('threshold increase');
      expect(violations[0].message).toContain('max-lines');
    });

    it('rejects multiline numeric threshold increase for sonarjs/cognitive-complexity', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,5 +1,5 @@',
        '  rules: {',
        "    'sonarjs/cognitive-complexity': ['error',",
        '-    30,',
        '+    40,',
        '    ],',
        '  },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('threshold increase');
    });

    it('allows multiline numeric threshold decrease', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,5 +1,5 @@',
        '  rules: {',
        "    complexity: ['error',",
        '-    30,',
        '+    25,',
        '    ],',
        '  },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff);
      expect(violations).toEqual([]);
    });

    it('allows multiline numeric threshold equality (unchanged value)', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,5 +1,5 @@',
        '  rules: {',
        "    complexity: ['error',",
        '-    25,',
        '+    25,',
        '    ],',
        '  },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff);
      expect(violations).toEqual([]);
    });

    it('does not flag unrelated standalone numeric option values outside rules blocks', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,5 +1,5 @@',
        '  const thresholds = {',
        "    count: ['init',",
        '-    25,',
        '+    30,',
        '    ],',
        '  };',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff);
      expect(violations).toEqual([]);
    });

    it('does not flag standalone numeric values inside non-ceiling rule configs', () => {
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,5 +1,5 @@',
        '  rules: {',
        "    'no-console': ['error',",
        '-    25,',
        '+    30,',
        '    ],',
        '  },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff);
      expect(violations).toEqual([]);
    });

    it('does not false-positive flag a second numeric value after the threshold', () => {
      // After the threshold (25) is seen, a second standalone numeric line
      // (an option value like maxWarnings) must not be treated as a second
      // threshold for comparison (#2189 review finding).
      const diff = [
        'diff --git a/eslint.config.js b/eslint.config.js',
        'index 0000000..1111111 100644',
        '--- a/eslint.config.js',
        '+++ b/eslint.config.js',
        '@@ -1,6 +1,6 @@',
        '  rules: {',
        "    complexity: ['error',",
        '      25,',
        '-      { maxWarnings: 10 },',
        '+      { maxWarnings: 20 },',
        '    ],',
        '  },',
      ].join(String.fromCharCode(10));

      const violations = checkDiff(diff).filter((v) =>
        v.message.includes('threshold increase'),
      );
      expect(violations).toEqual([]);
    });
  });

  describe('#2115 packages/core directive ban', () => {
    it('reports violations when packages/core files contain directives', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-core-'));
      const subDir = join(tmpDir, 'src', 'utils');
      mkdirSync(subDir, { recursive: true });
      writeFileSync(
        join(subDir, 'example.ts'),
        [
          'export const x = 1;',
          '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
          'export const y: any = 2;',
        ].join('\n'),
      );

      const violations = scanCoreDirectives(tmpDir);

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('#2115');
      expect(violations[0].lineNumber).toBe(2);
    });

    it('reports violations in non-JS text files under packages/core', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-core-text-'));
      writeFileSync(
        join(tmpDir, 'fixture.md'),
        '// eslint-disable-line no-console\n',
      );

      const violations = scanCoreDirectives(tmpDir);

      expect(violations).toHaveLength(1);
      expect(violations[0].lineNumber).toBe(1);
    });

    it('passes when packages/core files contain no directives', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-core-clean-'));
      writeFileSync(
        join(tmpDir, 'clean.ts'),
        ['export const x = 1;', 'export const y = 2;'].join('\n'),
      );

      expect(scanCoreDirectives(tmpDir)).toEqual([]);
    });

    it('flags packages/core entries left in legacyDirectiveCleanupScopes', () => {
      const config = [
        'const legacyDirectiveCleanupScopes = [',
        "  'packages/core/src/utils/example.ts', // remaining core cleanup",
        "  'packages/cli/src/foo.ts',",
        '];',
      ].join('\n');

      const violations = checkCoreDirectiveScopesInConfig(config);

      expect(violations).toHaveLength(1);
      expect(violations[0].file).toBe('eslint.config.js');
      expect(violations[0].message).toContain('#2115');
    });

    it('flags packages/core entries left in completedDirectiveCleanupScopes', () => {
      const config = [
        'const completedDirectiveCleanupScopes = [',
        "  'packages/core/src/utils/example.ts', // completed core cleanup",
        "  'packages/cli/src/foo.ts',",
        '];',
      ].join('\n');

      const violations = checkCoreDirectiveScopesInConfig(config);

      expect(violations).toHaveLength(1);
      expect(violations[0].file).toBe('eslint.config.js');
      expect(violations[0].message).toContain(
        'completedDirectiveCleanupScopes',
      );
    });

    it('flags single-line packages/core cleanup scope entries', () => {
      const config =
        "const legacyDirectiveCleanupScopes = ['packages/core/src/example.ts'];";

      const violations = checkCoreDirectiveScopesInConfig(config);

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('legacyDirectiveCleanupScopes');
    });

    it('passes when directive cleanup scopes have no packages/core entries', () => {
      const config = [
        'const legacyDirectiveCleanupScopes = [',
        "  'packages/cli/src/foo.ts',",
        '];',
        'const completedDirectiveCleanupScopes = [',
        "  'packages/providers/src/foo.ts',",
        '];',
      ].join('\n');

      expect(checkCoreDirectiveScopesInConfig(config)).toEqual([]);
    });

    it('flags packages/core central rule-off blocks', () => {
      const config = [
        '{',
        "  files: ['packages/core/src/example.ts'],",
        '  rules: {',
        "    'sonarjs/regular-expr': 'off',",
        '  },',
        '}',
      ].join('\n');

      const violations = checkCoreCentralBypassesInConfig(config);

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('rule-off');
    });

    it('flags packages/core multiline rule-off values', () => {
      const config = [
        '{',
        "  files: ['packages/core/src/example.ts'],",
        '  rules: {',
        "    'sonarjs/regular-expr': [",
        "      'off',",
        '    ],',
        "    'no-console': [",
        '      0,',
        '    ],',
        "    'no-unused-vars': [",
        "      'off', // inline comment",
        '    ],',
        "    'no-magic-numbers': [",
        '      0, // inline comment',
        '    ],',
        '  },',
        '}',
      ].join('\n');

      const violations = checkCoreCentralBypassesInConfig(config);

      expect(violations).toHaveLength(4);
      expect(formatViolations(violations)).toContain('rule-off');
    });

    it('flags packages/core central rule-off values in long blocks', () => {
      const config = [
        '{',
        "  files: ['packages/core/src/example.ts'],",
        ...Array.from(
          { length: 90 },
          (_, index) => `  settings${index}: { value: ${index} },`,
        ),
        '  rules: {',
        "    'sonarjs/regular-expr': [",
        "      'off',",
        '    ],',
        '  },',
        '}',
      ].join('\n');

      const violations = checkCoreCentralBypassesInConfig(config);

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('rule-off');
    });

    it('flags packages/core scoped ignores', () => {
      const config = [
        '{',
        "  files: ['packages/core/src/**/*.ts'],",
        "  ignores: ['**/*.test.ts'],",
        '  rules: {},',
        '}',
      ].join('\n');

      const violations = checkCoreCentralBypassesInConfig(config);

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('scoped ignore');
    });

    it('flags single-line packages/core scoped rule-off and ignores', () => {
      const config = [
        "{ files: ['packages/core/src/example.ts'], rules: { 'no-console': 'off' } },",
        "{ files: ['packages/core/src/example.ts'], ignores: ['**/*.test.ts'] },",
      ].join('\n');

      const violations = checkCoreCentralBypassesInConfig(config);

      expect(violations).toHaveLength(2);
      expect(formatViolations(violations)).toContain('rule-off');
      expect(formatViolations(violations)).toContain('scoped ignore');
    });

    it('flags packages/core global ignores and allow-list entries', () => {
      const config = [
        'export default [',
        '  {',
        '    ignores: [',
        "      'packages/core/src/prompts/*.d.ts',",
        '    ],',
        '  },',
        '  {',
        '    rules: {',
        "      'import/no-internal-modules': ['error', { allow: [",
        "        '**/packages/core/src/prompts/*.js',",
        '      ] }],',
        '    },',
        '  },',
        '];',
      ].join('\n');

      const violations = checkCoreCentralBypassesInConfig(config);

      expect(violations).toHaveLength(2);
      expect(formatViolations(violations)).toContain('allow-list');
      expect(formatViolations(violations)).toContain('ignore');
    });

    it('allows packages/core positive enforcement blocks', () => {
      const config = [
        '{',
        "  files: ['packages/core/src/example.ts'],",
        '  rules: {',
        "    'max-lines': ['error', { max: 800 }],",
        "    'no-restricted-imports': ['error', { name: 'x' }],",
        '  },',
        '}',
      ].join('\n');

      expect(checkCoreCentralBypassesInConfig(config)).toEqual([]);
    });
  });
});

describe('hasInlineEslintDirective', () => {
  it('detects directives in line comments', () => {
    expect(
      hasInlineEslintDirective(
        '  // eslint-disable-next-line @typescript-eslint/no-explicit-any',
      ),
    ).toBe(true);
    expect(
      hasInlineEslintDirective('code(); // eslint-disable-line no-console'),
    ).toBe(true);
    expect(hasInlineEslintDirective('// eslint-disable no-console')).toBe(true);
    expect(hasInlineEslintDirective('// eslint-enable')).toBe(true);
  });

  it('detects directives in block comments', () => {
    expect(hasInlineEslintDirective('/* eslint-disable no-console */')).toBe(
      true,
    );
    expect(
      hasInlineEslintDirective(
        'const x = 1; /* eslint-disable-next-line no-console */',
      ),
    ).toBe(true);
  });

  it('does not match directive text inside string literals', () => {
    expect(
      hasInlineEslintDirective(
        "const msg = 'eslint-disable-next-line is banned';",
      ),
    ).toBe(false);
    expect(
      hasInlineEslintDirective(
        'const url = "https://example.test// eslint-disable-line";',
      ),
    ).toBe(false);
    expect(
      hasInlineEslintDirective(
        'const blockText = "/* eslint-disable no-console */";',
      ),
    ).toBe(false);
    expect(
      hasInlineEslintDirective(
        'const template = `eslint-enable and // eslint-disable`;',
      ),
    ).toBe(false);
  });

  it('does not match directive text inside regular expressions', () => {
    expect(
      hasInlineEslintDirective(
        'const re = /eslint-disable(?:-next-line|-line)?/;',
      ),
    ).toBe(false);
  });

  it('does not match unrelated lines', () => {
    expect(hasInlineEslintDirective('const x = 1;')).toBe(false);
    expect(hasInlineEslintDirective('')).toBe(false);
  });
});

describe('hasTypeScriptSuppression', () => {
  it('detects @ts-ignore in line comments', () => {
    expect(hasTypeScriptSuppression('// @ts-ignore broken overload')).toBe(
      true,
    );
    expect(
      hasTypeScriptSuppression('const x = 1; // @ts-ignore bad type'),
    ).toBe(true);
  });

  it('detects @ts-expect-error in block comments', () => {
    expect(hasTypeScriptSuppression('/* @ts-expect-error legacy */')).toBe(
      true,
    );
    expect(
      hasTypeScriptSuppression('code(); /* @ts-expect-error reason */'),
    ).toBe(true);
  });

  it('detects @ts-nocheck', () => {
    expect(hasTypeScriptSuppression('// @ts-nocheck')).toBe(true);
    expect(hasTypeScriptSuppression('/* @ts-nocheck */')).toBe(true);
  });

  it('does not match suppression text inside string literals', () => {
    expect(
      hasTypeScriptSuppression("const msg = '@ts-ignore is banned';"),
    ).toBe(false);
    expect(
      hasTypeScriptSuppression('const msg = "use @ts-nocheck here";'),
    ).toBe(false);
    expect(hasTypeScriptSuppression('const msg = `@ts-expect-error`);')).toBe(
      false,
    );
  });

  it('does not match suppression text inside regex literals', () => {
    expect(hasTypeScriptSuppression('const re = /@ts-ignore/;')).toBe(false);
  });

  it('does not match unrelated lines', () => {
    expect(hasTypeScriptSuppression('const x = 1;')).toBe(false);
    expect(hasTypeScriptSuppression('')).toBe(false);
    expect(
      hasTypeScriptSuppression('// regular comment with no suppression'),
    ).toBe(false);
  });

  it('does not match @ts-expect-error mentioned in the middle of a comment', () => {
    expect(
      hasTypeScriptSuppression(
        '// Backward-compat shim: accessed via @ts-expect-error in test.ts',
      ),
    ).toBe(false);
    expect(
      hasTypeScriptSuppression(
        '/* This test uses @ts-ignore to verify behavior */',
      ),
    ).toBe(false);
  });

  it('does not match directives in non-effective multiline block-comment forms', () => {
    // TypeScript 5.8.3 does NOT treat directives as effective suppressions
    // when they appear on a continuation line of a multiline block comment or
    // when they are not at the start of a single-line block comment. The guard
    // must not flag these non-effective forms (verified against tsc 5.8.3).
    // Continuation line of a multiline block comment:
    expect(hasTypeScriptSuppression(' * @ts-ignore some reason')).toBe(false);
    expect(
      hasTypeScriptSuppression('   leading text @ts-nocheck here */'),
    ).toBe(false);
    // Not at the start of a single-line block comment:
    expect(hasTypeScriptSuppression('/* leading @ts-ignore */')).toBe(false);
  });

  it('conservatively flags the opener line of a multiline block comment with a directive', () => {
    // TypeScript 5.8.3 does NOT treat "/* @ts-ignore\n   reason */" as an
    // effective suppression, but the guard flags the opener line
    // conservatively to avoid any risk of a real suppression slipping through.
    expect(hasTypeScriptSuppression('/* @ts-ignore multiline reason')).toBe(
      true,
    );
  });
});

describe('scanPackageTypeScriptSuppressions (#2189)', () => {
  it('reports violations when package files contain TS suppressions', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-ts-suppress-'));
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, 'example.ts'),
      [
        'export const x = 1;',
        '// @ts-ignore broken overload',
        'export const y = x as any;',
      ].join('\n'),
    );

    const violations = scanPackageTypeScriptSuppressions(tmpDir, '2189');

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('#2189');
    expect(violations[0].message).toContain('TypeScript suppression');
    expect(violations[0].lineNumber).toBe(2);
  });

  it('passes when package files contain no TS suppressions', () => {
    const tmpDir = mkdtempSync(
      join(tmpdir(), 'eslint-guard-ts-suppress-clean-'),
    );
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, 'clean.ts'),
      ['export const x = 1;', 'export const y = 2;'].join('\n'),
    );

    expect(scanPackageTypeScriptSuppressions(tmpDir, '2189')).toEqual([]);
  });

  it('ignores test files (production-only scan)', () => {
    const tmpDir = mkdtempSync(
      join(tmpdir(), 'eslint-guard-ts-suppress-test-'),
    );
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, 'example.test.ts'),
      [
        'export function testOnly() {',
        '  // @ts-expect-error testing invalid input',
        '  const x: number = "string";',
        '}',
      ].join('\n'),
    );

    expect(scanPackageTypeScriptSuppressions(tmpDir, '2189')).toEqual([]);
  });

  it('returns empty for non-existent directories', () => {
    expect(
      scanPackageTypeScriptSuppressions(
        join(repoRoot, 'nonexistent-package', 'src'),
        '2189',
      ),
    ).toEqual([]);
  });

  it('reports violations in JavaScript source files (.js)', () => {
    // The full-tree scan must cover the same checked source extensions as the
    // diff-based checkDiff detection (.js/.jsx/.ts/.tsx/.mjs/.cjs), not just
    // .ts/.tsx. A .js file with a real @ts-ignore comment must be caught.
    const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-ts-suppress-js-'));
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, 'example.js'),
      [
        'export const x = 1;',
        '// @ts-ignore missing types',
        'export const y = x.untypedMethod();',
      ].join(String.fromCharCode(10)),
    );

    const violations = scanPackageTypeScriptSuppressions(tmpDir, '2189');

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('#2189');
    expect(violations[0].message).toContain('TypeScript suppression');
    expect(violations[0].lineNumber).toBe(2);
  });

  it('reports violations in JSX source files (.jsx)', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-ts-suppress-jsx-'));
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, 'example.jsx'),
      [
        'export const Component = () => null;',
        '// @ts-nocheck legacy jsx file',
        'export const x = 1;',
      ].join(String.fromCharCode(10)),
    );

    const violations = scanPackageTypeScriptSuppressions(tmpDir, '2189');

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('#2189');
  });

  it('reports violations in MJS source files (.mjs)', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-ts-suppress-mjs-'));
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, 'example.mjs'),
      [
        'export const x = 1;',
        '// @ts-expect-error intentional for mjs',
        'export const y = x.bad;',
      ].join(String.fromCharCode(10)),
    );

    const violations = scanPackageTypeScriptSuppressions(tmpDir, '2189');

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('#2189');
  });

  it('reports violations in CJS source files (.cjs)', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-ts-suppress-cjs-'));
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, 'example.cjs'),
      [
        'module.exports = { x: 1 };',
        '// @ts-ignore cjs untyped',
        'module.exports.y = 2;',
      ].join(String.fromCharCode(10)),
    );

    const violations = scanPackageTypeScriptSuppressions(tmpDir, '2189');

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('#2189');
  });

  it('excludes JavaScript test files from production-only scan', () => {
    // .test.js files must be excluded just like .test.ts files are, because
    // TS suppression directives are legitimate testing patterns.
    const tmpDir = mkdtempSync(
      join(tmpdir(), 'eslint-guard-ts-suppress-jstest-'),
    );
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, 'example.test.js'),
      [
        'export function testOnly() {',
        '  // @ts-expect-error testing invalid input',
        '  const x = "string";',
        '}',
      ].join(String.fromCharCode(10)),
    );

    expect(scanPackageTypeScriptSuppressions(tmpDir, '2189')).toEqual([]);
  });

  it('still reports violations in TypeScript source files (.ts)', () => {
    // Regression: extending coverage to JS must not break existing .ts
    // detection.
    const tmpDir = mkdtempSync(
      join(tmpdir(), 'eslint-guard-ts-suppress-ts-regression-'),
    );
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, 'example.ts'),
      [
        'export const x = 1;',
        '// @ts-ignore regression test',
        'export const y = x as any;',
      ].join(String.fromCharCode(10)),
    );

    const violations = scanPackageTypeScriptSuppressions(tmpDir, '2189');

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('#2189');
  });

  describe('multiline template literal state (#2189 review finding)', () => {
    // The full-tree scanner must carry template literal state across lines
    // within a file (mirroring the diff-based checkDiff detection) so that
    // inert documentation text inside a multiline template literal body is
    // not flagged, while real suppression comments in executable code are
    // still caught.

    it('does not flag inert // @ts-ignore text inside a multiline template body', () => {
      // A // @ts-ignore line inside template literal TEXT (exprDepth === 0)
      // is just template content, not a real comment. The stateful scanner
      // must skip it.
      const tmpDir = mkdtempSync(
        join(tmpdir(), 'eslint-guard-ts-templ-inert-'),
      );
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        join(tmpDir, 'example.ts'),
        [
          'export const docs = `',
          '  // @ts-ignore is mentioned here in docs',
          '  but this is inert template literal text',
          '`;',
        ].join(String.fromCharCode(10)),
      );

      expect(scanPackageTypeScriptSuppressions(tmpDir, '2189')).toEqual([]);
    });

    it('does not flag inert @ts-nocheck text inside a multiline template body', () => {
      const tmpDir = mkdtempSync(
        join(tmpdir(), 'eslint-guard-ts-templ-nocheck-'),
      );
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        join(tmpDir, 'example.ts'),
        [
          'export const docs = `',
          '  /* @ts-nocheck described in prose */',
          '  more inert template text',
          '`;',
        ].join(String.fromCharCode(10)),
      );

      expect(scanPackageTypeScriptSuppressions(tmpDir, '2189')).toEqual([]);
    });

    it('still flags a real suppression after a closed template literal', () => {
      // A template literal opens and closes on one line, then a real
      // // @ts-ignore comment appears on a later line. The template state
      // must be cleared after the closing backtick so the real directive is
      // caught.
      const tmpDir = mkdtempSync(
        join(tmpdir(), 'eslint-guard-ts-templ-after-'),
      );
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        join(tmpDir, 'example.ts'),
        [
          'export const docs = `closed template`;',
          '// @ts-ignore real suppression',
          'export const y = docs.bad;',
        ].join(String.fromCharCode(10)),
      );

      const violations = scanPackageTypeScriptSuppressions(tmpDir, '2189');

      expect(violations).toHaveLength(1);
      expect(violations[0].lineNumber).toBe(2);
      expect(violations[0].content).toContain('@ts-ignore');
    });

    it('still flags a real suppression inside a template ${} expression', () => {
      // The template opens and a ${ ... } expression opens (unclosed on the
      // opener line), then a real // @ts-expect-error comment appears inside
      // the expression on the next line. Because the comment is in executable
      // expression code it is a real, effective suppression and must be
      // flagged.
      const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-ts-templ-expr-'));
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        join(tmpDir, 'example.ts'),
        [
          'export const docs = `${',
          '  // @ts-expect-error real in expression',
          '  value',
          '}`;',
        ].join(String.fromCharCode(10)),
      );

      const violations = scanPackageTypeScriptSuppressions(tmpDir, '2189');

      expect(violations).toHaveLength(1);
      expect(violations[0].lineNumber).toBe(2);
      expect(violations[0].content).toContain('@ts-expect-error');
    });

    it('resets template state between files', () => {
      // Two files in the same scan: one ends inside an unclosed template
      // (malformed), the next file starts with a real suppression. The
      // scanner must reset template state per file so the real suppression in
      // the second file is caught and not mistaken for template text.
      const tmpDir = mkdtempSync(
        join(tmpdir(), 'eslint-guard-ts-templ-reset-'),
      );
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        join(tmpDir, 'unclosed.ts'),
        [
          'export const docs = `',
          '  // @ts-ignore inert text in an unclosed template',
        ].join(String.fromCharCode(10)),
      );
      writeFileSync(
        join(tmpDir, 'real.ts'),
        [
          '// @ts-ignore real suppression in a new file',
          'export const y = 1;',
        ].join(String.fromCharCode(10)),
      );

      const violations = scanPackageTypeScriptSuppressions(tmpDir, '2189');

      // Only the real suppression in real.ts is flagged; the inert text in
      // the unclosed template of unclosed.ts is skipped.
      expect(violations).toHaveLength(1);
      expect(violations[0].file).toContain('real.ts');
      expect(violations[0].lineNumber).toBe(1);
    });
  });

  const tsGuardedPackages = [
    'packages/cli/src',
    'packages/core/src',
    'packages/policy/src',
    'packages/agents/src',
    'packages/storage/src',
    'packages/auth/src',
    'packages/settings/src',
    'packages/a2a-server/src',
  ];

  for (const pkg of tsGuardedPackages) {
    it(`has zero TypeScript suppression directives in ${pkg}`, () => {
      const offenders = scanPackageTypeScriptSuppressions(
        join(repoRoot, ...pkg.split('/')),
        '2189',
      ).map((v) => `${v.file}:${v.lineNumber}`);
      expect(
        offenders,
        'Found TS suppressions: ' + offenders.join(', '),
      ).toEqual([]);
    });
  }
});

describe('scanRootTypeScriptSuppressions (#2189 review finding)', () => {
  // The durable root scan mirrors the diff-based checkDiff coverage universe
  // (the whole repo, excluding generated directories). It must catch real TS
  // suppression directives anywhere in checked source — including root-level
  // scripts and config files that the per-package scans did not cover — while
  // ignoring directive text inside strings, templates, and regexes.

  it('reports violations for TS suppressions in nested package source', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-root-pkg-'));
    mkdirSync(join(tmpDir, 'packages', 'core', 'src'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'packages', 'core', 'src', 'example.ts'),
      [
        'export const x = 1;',
        '// @ts-ignore broken overload',
        'export const y = x as any;',
      ].join('\n'),
    );

    const violations = scanRootTypeScriptSuppressions(tmpDir, '2189');

    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe('packages/core/src/example.ts');
    expect(violations[0].lineNumber).toBe(2);
    expect(violations[0].message).toContain('#2189');
  });

  it('reports violations for TS suppressions in root-level scripts', () => {
    // Root-level scripts (outside packages src) were NOT covered by the
    // per-package scanPackageTypeScriptSuppressions loop. The root scan must
    // catch real suppressions here too.
    const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-root-scripts-'));
    mkdirSync(join(tmpDir, 'scripts'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'scripts', 'helper.js'),
      [
        'export const x = 1;',
        '// @ts-expect-error missing types in script',
        'export const y = x.bad;',
      ].join('\n'),
    );

    const violations = scanRootTypeScriptSuppressions(tmpDir, '2189');

    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe('scripts/helper.js');
    expect(violations[0].lineNumber).toBe(2);
  });

  it('reports violations for TS suppressions in the guard implementation file', () => {
    // The guard implementation file is an ESLint-directive fixture exemption
    // (shouldCheckInlineDirective returns false), but TS suppression scanning
    // must NOT inherit that exemption. hasTypeScriptSuppressionInState skips
    // string/template/regex literals, so fixture data is safe, but a real
    // at-ts-ignore comment added to the file must be caught.
    const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-root-guard-'));
    mkdirSync(join(tmpDir, 'scripts'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'scripts', 'check-eslint-guard.js'),
      [
        'export function check() {',
        '  // @ts-ignore real suppression in guard file',
        '  return 1;',
        '}',
      ].join('\n'),
    );

    const violations = scanRootTypeScriptSuppressions(tmpDir, '2189');

    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe('scripts/check-eslint-guard.js');
    expect(violations[0].message).toContain('TypeScript suppression');
  });

  it('reports violations for TS suppressions in a non-test file under scripts/tests/', () => {
    // A non-test-named file under scripts/tests/ (e.g. a helper module) must
    // be scanned by the root scan. Note: files ending in .test.js are excluded
    // by isProductionCheckedSourceFile because @ts-expect-error is a legitimate
    // testing pattern; this test uses a non-test-named file to prove the
    // scripts/tests/ path is covered for production source.
    const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-root-testfix-'));
    mkdirSync(join(tmpDir, 'scripts', 'tests'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'scripts', 'tests', 'helper.js'),
      [
        'export const x = 1;',
        '// @ts-nocheck real suppression in scripts/tests helper',
        'export const y = x.bad;',
      ].join('\n'),
    );

    const violations = scanRootTypeScriptSuppressions(tmpDir, '2189');

    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe('scripts/tests/helper.js');
    expect(violations[0].message).toContain('TypeScript suppression');
  });

  it('does not flag TS suppression text inside strings in a root-level file', () => {
    // Directive text used as fixture data (inside a string literal) must not
    // trigger a false positive. This proves the literal-skipping in
    // hasTypeScriptSuppressionInState keeps fixture data safe even in root-
    // level files covered by the root scan.
    const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-root-string-'));
    mkdirSync(join(tmpDir, 'scripts'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'scripts', 'helper.js'),
      [
        'export const fixture = "use // @ts-ignore here as docs";',
        'export const x = 1;',
      ].join('\n'),
    );

    expect(scanRootTypeScriptSuppressions(tmpDir, '2189')).toEqual([]);
  });

  it('does not flag TS suppression text inside template literals in a root-level file', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-root-template-'));
    mkdirSync(join(tmpDir, 'scripts'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'scripts', 'helper.js'),
      [
        'export const msg = `@ts-expect-error directive in docs`;',
        'export const x = 1;',
      ].join('\n'),
    );

    expect(scanRootTypeScriptSuppressions(tmpDir, '2189')).toEqual([]);
  });

  it('does not flag TS suppression text inside regex literals in a root-level file', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-root-regex-'));
    mkdirSync(join(tmpDir, 'scripts'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'scripts', 'helper.js'),
      ['export const re = /@ts-ignore/;', 'export const x = 1;'].join('\n'),
    );

    expect(scanRootTypeScriptSuppressions(tmpDir, '2189')).toEqual([]);
  });

  it('does not flag inert TS suppression text inside a multiline template body', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-root-tmplbody-'));
    mkdirSync(join(tmpDir, 'scripts'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'scripts', 'helper.js'),
      [
        'export const docs = `',
        '  // @ts-ignore is mentioned here in docs',
        '  but this is inert template literal text',
        '`;',
      ].join('\n'),
    );

    expect(scanRootTypeScriptSuppressions(tmpDir, '2189')).toEqual([]);
  });

  it('still flags a real suppression after a closed template literal in root scan', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-root-tmplafter-'));
    mkdirSync(join(tmpDir, 'scripts'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'scripts', 'helper.js'),
      [
        'export const docs = `closed template`;',
        '// @ts-ignore real suppression',
        'export const y = docs.bad;',
      ].join('\n'),
    );

    const violations = scanRootTypeScriptSuppressions(tmpDir, '2189');

    expect(violations).toHaveLength(1);
    expect(violations[0].lineNumber).toBe(2);
  });

  it('excludes generated directories from the root scan', () => {
    // Files inside node_modules, dist, coverage, and .git must be skipped.
    const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-root-gen-'));
    mkdirSync(join(tmpDir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'node_modules', 'pkg', 'bad.js'),
      ['// @ts-ignore from a dependency', 'export const x = 1;'].join('\n'),
    );

    expect(scanRootTypeScriptSuppressions(tmpDir, '2189')).toEqual([]);
  });

  it('excludes test files from the root scan', () => {
    // .test.js files must be excluded because @ts-expect-error is a legitimate
    // testing pattern, matching the per-package scan semantics.
    const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-root-testfile-'));
    mkdirSync(join(tmpDir, 'packages', 'core', 'src'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'packages', 'core', 'src', 'example.test.js'),
      [
        'export function testOnly() {',
        '  // @ts-expect-error testing invalid input',
        '  const x: number = "string";',
        '}',
      ].join('\n'),
    );

    expect(scanRootTypeScriptSuppressions(tmpDir, '2189')).toEqual([]);
  });

  it('returns empty for non-existent directories', () => {
    expect(
      scanRootTypeScriptSuppressions(
        join(repoRoot, 'nonexistent-root-dir'),
        '2189',
      ),
    ).toEqual([]);
  });

  it('covers the same checked-in repo with zero suppressions', () => {
    // The real checked-in repo must have zero TS suppression directives in
    // production checked source. This is the durable guarantee.
    const offenders = scanRootTypeScriptSuppressions(repoRoot, '2189').map(
      (v) => `${v.file}:${v.lineNumber}`,
    );
    expect(offenders, 'Found TS suppressions: ' + offenders.join(', ')).toEqual(
      [],
    );
  });
});

describe('packages/agents directive cleanup (#2117)', () => {
  const agentsSrcDir = join(repoRoot, 'packages', 'agents', 'src');

  it('has zero inline ESLint disable/enable directives', () => {
    const offenders = scanPackageDirectives(agentsSrcDir, '2117').map(
      (v) => `${v.file}:${v.lineNumber}`,
    );
    expect(offenders, 'Found directives: ' + offenders.join(', ')).toEqual([]);
  });

  it('is locked in completedDirectiveCleanupScopes with a broad glob', () => {
    const completed = extractScopeArray('completedDirectiveCleanupScopes');
    expect(completed).toContain('packages/agents/src/**/*.{ts,tsx}');
  });

  it('is no longer in legacyDirectiveCleanupScopes', () => {
    const legacy = extractScopeArray('legacyDirectiveCleanupScopes');
    const agentsEntries = legacy.filter((e) => e.startsWith('packages/agents'));
    expect(
      agentsEntries,
      'Legacy agents entries: ' + agentsEntries.join(', '),
    ).toEqual([]);
  });
});

describe('packages/storage directive cleanup (#2119)', () => {
  const storageSrcDir = join(repoRoot, 'packages', 'storage', 'src');

  it('has zero inline ESLint disable/enable directives', () => {
    const offenders = scanPackageDirectives(storageSrcDir, '2119').map(
      (v) => `${v.file}:${v.lineNumber}`,
    );
    expect(offenders, 'Found directives: ' + offenders.join(', ')).toEqual([]);
  });

  it('is locked in completedDirectiveCleanupScopes with a broad glob', () => {
    const completed = extractScopeArray('completedDirectiveCleanupScopes');
    expect(completed).toContain('packages/storage/src/**/*.{ts,tsx}');
  });

  it('is no longer in legacyDirectiveCleanupScopes', () => {
    const legacy = extractScopeArray('legacyDirectiveCleanupScopes');
    const storageEntries = legacy.filter((e) =>
      e.startsWith('packages/storage'),
    );
    expect(
      storageEntries,
      'Legacy storage entries: ' + storageEntries.join(', '),
    ).toEqual([]);
  });
});

describe('packages/auth directive cleanup (#2121)', () => {
  const authSrcDir = join(repoRoot, 'packages', 'auth', 'src');

  it('has zero inline ESLint disable/enable directives', () => {
    const offenders = scanPackageDirectives(authSrcDir, '2121').map(
      (v) => `${v.file}:${v.lineNumber}`,
    );
    expect(offenders, 'Found directives: ' + offenders.join(', ')).toEqual([]);
  });

  it('is locked in completedDirectiveCleanupScopes with a broad glob', () => {
    const completed = extractScopeArray('completedDirectiveCleanupScopes');
    expect(completed).toContain('packages/auth/src/**/*.{ts,tsx}');
  });

  it('is no longer in legacyDirectiveCleanupScopes', () => {
    const legacy = extractScopeArray('legacyDirectiveCleanupScopes');
    const authEntries = legacy.filter((e) => e.startsWith('packages/auth'));
    expect(
      authEntries,
      'Legacy auth entries: ' + authEntries.join(', '),
    ).toEqual([]);
  });
});

describe('packages/settings directive cleanup (#2120)', () => {
  const settingsSrcDir = join(repoRoot, 'packages', 'settings', 'src');

  it('has zero inline ESLint disable/enable directives', () => {
    const offenders = scanPackageDirectives(settingsSrcDir, '2120').map(
      (v) => `${v.file}:${v.lineNumber}`,
    );
    expect(offenders, 'Found directives: ' + offenders.join(', ')).toEqual([]);
  });

  it('is locked in completedDirectiveCleanupScopes with a broad glob', () => {
    const completed = extractScopeArray('completedDirectiveCleanupScopes');
    expect(completed).toContain('packages/settings/src/**/*.{ts,tsx}');
  });

  it('is no longer in legacyDirectiveCleanupScopes', () => {
    const legacy = extractScopeArray('legacyDirectiveCleanupScopes');
    const settingsEntries = legacy.filter((e) =>
      e.startsWith('packages/settings'),
    );
    expect(
      settingsEntries,
      'Legacy settings entries: ' + settingsEntries.join(', '),
    ).toEqual([]);
  });
});

describe('packages/policy directive cleanup (#2122)', () => {
  const policySrcDir = join(repoRoot, 'packages', 'policy', 'src');

  describe('scanModuleDirectives', () => {
    it('reports violations when packages/policy files contain directives', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-policy-'));
      const subDir = join(tmpDir, 'src');
      mkdirSync(subDir, { recursive: true });
      writeFileSync(
        join(subDir, 'example.ts'),
        [
          'export const x = 1;',
          '// eslint-disable-next-line sonarjs/expression-complexity',
          'export const y = (a && b) || (c && d) ? e : f;',
        ].join('\n'),
      );

      const violations = scanModuleDirectives(
        'packages/policy',
        '2122',
        tmpDir,
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('#2122');
      expect(violations[0].message).toContain('packages/policy');
      expect(violations[0].lineNumber).toBe(2);
    });

    it('passes when packages/policy files contain no directives', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'eslint-guard-policy-clean-'));
      writeFileSync(
        join(tmpDir, 'clean.ts'),
        ['export const x = 1;', 'export const y = 2;'].join('\n'),
      );

      expect(scanModuleDirectives('packages/policy', '2122', tmpDir)).toEqual(
        [],
      );
    });
  });

  describe('checkModuleDirectiveScopesInConfig', () => {
    it('flags packages/policy entries left in legacyDirectiveCleanupScopes', () => {
      const config = [
        'const legacyDirectiveCleanupScopes = [',
        "  'packages/policy/src/**/*.{ts,tsx}', // remaining policy cleanup",
        "  'packages/cli/src/foo.ts',",
        '];',
      ].join('\n');

      const violations = checkModuleDirectiveScopesInConfig(
        config,
        'packages/policy',
        '2122',
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].file).toBe('eslint.config.js');
      expect(violations[0].message).toContain('#2122');
      expect(violations[0].message).toContain('legacyDirectiveCleanupScopes');
    });

    it('allows packages/policy in completedDirectiveCleanupScopes (lock)', () => {
      const config = [
        'const legacyDirectiveCleanupScopes = [',
        "  'packages/cli/src/foo.ts',",
        '];',
        'const completedDirectiveCleanupScopes = [',
        "  'packages/policy/src/**/*.{ts,tsx}', // #2122",
        '];',
      ].join('\n');

      expect(
        checkModuleDirectiveScopesInConfig(
          config,
          'packages/policy',
          '2122',
          false,
        ),
      ).toEqual([]);
    });
  });

  describe('checkModuleCentralBypassesInConfig', () => {
    it('flags packages/policy central rule-off blocks', () => {
      const config = [
        '{',
        "  files: ['packages/policy/src/example.ts'],",
        '  rules: {',
        "    'sonarjs/expression-complexity': 'off',",
        '  },',
        '}',
      ].join('\n');

      const violations = checkModuleCentralBypassesInConfig(
        config,
        'packages/policy',
        '2122',
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('rule-off');
      expect(violations[0].message).toContain('#2122');
    });

    it('flags packages/policy scoped ignores', () => {
      const config = [
        '{',
        "  files: ['packages/policy/src/**/*.ts'],",
        "  ignores: ['**/*.test.ts'],",
        '  rules: {},',
        '}',
      ].join('\n');

      const violations = checkModuleCentralBypassesInConfig(
        config,
        'packages/policy',
        '2122',
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('scoped ignore');
    });

    it('allows packages/policy positive enforcement blocks', () => {
      const config = [
        '{',
        "  files: ['packages/policy/src/example.ts'],",
        '  rules: {',
        "    'max-lines': ['error', { max: 800 }],",
        '  },',
        '}',
      ].join('\n');

      expect(
        checkModuleCentralBypassesInConfig(config, 'packages/policy', '2122'),
      ).toEqual([]);
    });

    it('flags packages/policy multi-line files arrays with rule-off', () => {
      const config = [
        '{',
        '  files: [',
        "    'packages/policy/src/**/*.ts',",
        '  ],',
        '  rules: {',
        "    'sonarjs/expression-complexity': 'off',",
        '  },',
        '}',
      ].join('\n');

      const violations = checkModuleCentralBypassesInConfig(
        config,
        'packages/policy',
        '2122',
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('rule-off');
      expect(violations[0].message).toContain('#2122');
    });

    it('flags packages/policy multi-line files arrays with scoped ignores', () => {
      const config = [
        '{',
        '  files: [',
        "    'packages/policy/src/**/*.ts',",
        '  ],',
        "  ignores: ['**/*.test.ts'],",
        '  rules: {},',
        '}',
      ].join('\n');

      const violations = checkModuleCentralBypassesInConfig(
        config,
        'packages/policy',
        '2122',
      );

      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('scoped ignore');
    });

    it('ignores packages/policy references in trailing comments', () => {
      const config = [
        '{',
        "  files: ['packages/cli/src/example.ts'], // not packages/policy",
        '  rules: {',
        "    'sonarjs/expression-complexity': 'off',",
        '  },',
        '}',
      ].join('\n');

      expect(
        checkModuleCentralBypassesInConfig(config, 'packages/policy', '2122'),
      ).toEqual([]);
    });
    it('does not flag completedDirectiveCleanupScopes entries as central bypasses', () => {
      const config = [
        'const completedDirectiveCleanupScopes = [',
        "  'packages/policy/src/**/*.{ts,tsx}', // #2122",
        '];',
      ].join('\n');

      expect(
        checkModuleCentralBypassesInConfig(config, 'packages/policy', '2122'),
      ).toEqual([]);
    });

    it('does not flag legacyDirectiveCleanupScopes entries as central bypasses', () => {
      const config = [
        'const legacyDirectiveCleanupScopes = [',
        "  'packages/policy/src/**/*.ts',",
        '];',
      ].join('\n');

      expect(
        checkModuleCentralBypassesInConfig(config, 'packages/policy', '2122'),
      ).toEqual([]);
    });
  });

  it('has zero inline ESLint disable/enable directives in source', () => {
    const offenders = scanPackageDirectives(policySrcDir, '2122').map(
      (v) => `${v.file}:${v.lineNumber}`,
    );
    expect(offenders, 'Found directives: ' + offenders.join(', ')).toEqual([]);
  });

  it('is locked in completedDirectiveCleanupScopes with a broad glob', () => {
    const completed = extractScopeArray('completedDirectiveCleanupScopes');
    expect(completed).toContain('packages/policy/src/**/*.{ts,tsx}');
  });

  it('is no longer in legacyDirectiveCleanupScopes', () => {
    const legacy = extractScopeArray('legacyDirectiveCleanupScopes');
    const policyEntries = legacy.filter((e) => e.startsWith('packages/policy'));
    expect(
      policyEntries,
      'Legacy policy entries: ' + policyEntries.join(', '),
    ).toEqual([]);
  });
});

describe('packages/a2a-server directive cleanup (#2123)', () => {
  const a2aSrcDir = join(repoRoot, 'packages', 'a2a-server', 'src');

  it('has zero inline ESLint disable/enable directives', () => {
    const offenders = scanPackageDirectives(a2aSrcDir, '2123').map(
      (v) => `${v.file}:${v.lineNumber}`,
    );
    expect(offenders, 'Found directives: ' + offenders.join(', ')).toEqual([]);
  });

  it('is locked in completedDirectiveCleanupScopes with a broad glob', () => {
    const completed = extractScopeArray('completedDirectiveCleanupScopes');
    expect(completed).toContain('packages/a2a-server/src/**/*.{ts,tsx}');
  });

  it('is no longer in legacyDirectiveCleanupScopes', () => {
    const legacy = extractScopeArray('legacyDirectiveCleanupScopes');
    const a2aEntries = legacy.filter((e) =>
      e.startsWith('packages/a2a-server'),
    );
    expect(
      a2aEntries,
      'Legacy a2a-server entries: ' + a2aEntries.join(', '),
    ).toEqual([]);
  });
});
