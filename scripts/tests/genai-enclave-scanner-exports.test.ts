/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral unit tests for the genai-enclave scanner export edge cases
 * (#2352).
 *
 * Split from genai-enclave-scanner.test.ts to keep each test file under the
 * lint max-lines limit. These tests cover CommonJS bracket-access forms,
 * Object.defineProperty/Object.assign edge cases, the #2352 exact export
 * forms (spread, logical-assignment, bracket-access Object), and parse
 * diagnostics.
 *
 * Per RULES.md: tests assert behavior (does the scanner flag this source?),
 * not implementation details.
 */

import { describe, it, expect } from 'vitest';
import {
  scanGeminiExports,
  parseSourceFile,
} from '../genai-enclave/scanner.ts';

describe('parseSourceFile — invalid syntax produces diagnostics', () => {
  it('produces parse diagnostics for broken syntax', () => {
    const sf = parseSourceFile('broken.ts', 'export const x = ((((;\n');
    expect(sf.parseDiagnostics.length).toBeGreaterThan(0);
  });
});

describe('scanGeminiExports — CommonJS module[exports] bracket-access forms', () => {
  it('detects module[exports].GeminiName property assignment', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "module['exports'].GeminiBracketProp = function() {};",
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiBracketProp');
  });

  it('detects module[exports][GeminiName] computed property assignment', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "module['exports']['GeminiBracketComputed'] = 42;",
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiBracketComputed');
  });

  it('detects Gemini-named property in module[exports] = { ... } object literal', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "module['exports'] = { GeminiObjectLit: 1 };",
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiObjectLit');
  });

  it('does NOT flag module[exports] of a non-Gemini name', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "module['exports'].NormalThing = 1;",
    );
    expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
  });
});

describe('scanGeminiExports — Object.defineProperty and Object.assign edge cases', () => {
  it('does NOT flag Object.defineProperty with fewer than 3 arguments', () => {
    const sf = parseSourceFile('legacy.cjs', 'Object.defineProperty(exports);');
    expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
  });

  it('flags Object.defineProperty with a computed (non-string) key (F4 fail-closed)', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'Object.defineProperty(exports, someVar, { value: 42 });',
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toContain('fail-closed');
  });

  it('does NOT flag Object.defineProperty on module[something_else]', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "Object.defineProperty(module['notExports'], 'GeminiBad', { value: 1 });",
    );
    expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
  });

  it('flags Object.assign with no object-literal source (F4 fail-closed)', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'Object.assign(exports, someSource);',
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toContain('fail-closed');
  });

  it('detects Gemini names across multiple Object.assign source objects', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'Object.assign(exports, { normal: 1 }, { GeminiMulti: 2 });',
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiMulti');
  });

  it('does NOT flag Object.<otherMethod> calls', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "Object.freeze(exports, 'GeminiFrozen');",
    );
    expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
  });
});

describe('scanGeminiExports — #2352 exact export forms (spread, logical-assignment, bracket-access Object)', () => {
  it('detects Gemini name inside inline spread in module.exports object literal', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'module.exports = { ...{ GeminiLeak: 1 } };',
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiLeak');
  });

  it('detects Gemini name inside inline spread in TS export-equals object literal', () => {
    const sf = parseSourceFile(
      'legacy.ts',
      'export = { ...{ GeminiLeak: 1 } };',
    );
    expect(
      scanGeminiExports(sf, 'legacy.ts').map((v) => v.exportName),
    ).toContain('GeminiLeak');
  });

  it('detects Gemini name via exports.X ||= assignment', () => {
    const sf = parseSourceFile('legacy.cjs', 'exports.GeminiLeak ||= 1;');
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiLeak');
  });

  it('detects Gemini name via exports.X ??= assignment', () => {
    const sf = parseSourceFile('legacy.cjs', 'exports.GeminiLeak ??= 1;');
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiLeak');
  });

  it('detects Gemini name via exports.X &&= assignment', () => {
    const sf = parseSourceFile('legacy.cjs', 'exports.GeminiLeak &&= 1;');
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiLeak');
  });

  it('detects Gemini name via module.exports.X ||= assignment', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'module.exports.GeminiLeak ||= 1;',
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiLeak');
  });

  it('detects Gemini name via Object[defineProperty] bracket-access on exports', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "Object['defineProperty'](exports, 'GeminiLeak', { value: 1 });",
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiLeak');
  });

  it('detects Gemini name via Object[defineProperty] bracket-access on module.exports', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "Object['defineProperty'](module.exports, 'GeminiLeak', { value: 1 });",
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiLeak');
  });

  it('detects Gemini name via Object[assign] bracket-access on exports', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "Object['assign'](exports, { GeminiStatic: 1 });",
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiStatic');
  });

  it('detects Gemini name via Object[defineProperties] bracket-access', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "Object['defineProperties'](exports, { GeminiDef: { value: 1 } });",
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiDef');
  });

  it('does NOT flag Object[otherMethod] bracket-access', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      "Object['freeze'](exports, 'GeminiFrozen');",
    );
    expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
  });

  it('does NOT flag non-Gemini names in logical-assignment', () => {
    const sf = parseSourceFile('legacy.cjs', 'exports.NormalName ||= 1;');
    expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
  });

  it('F2: flags spread of a non-literal source as fail-closed', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      `const src = { GeminiLeak: 1 }; module.exports = { ...src };`,
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toContain('fail-closed');
  });

  it('F2: flags Object.assign with spread source as fail-closed', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      `const src = { GeminiLeak: 1 };\nObject.assign(exports, { ...src });`,
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toContain('fail-closed');
  });

  it('F2: flags Object.defineProperties with spread descriptor keys as fail-closed', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      `const desc = { GeminiProp: { value: 1 } };\nObject.defineProperties(exports, { ...desc });`,
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toContain('fail-closed');
  });

  it('F2: flags export-equals with spread of non-literal source as fail-closed', () => {
    const sf = parseSourceFile(
      'legacy.ts',
      `const src = { GeminiLeak: 1 };\nexport = { ...src };`,
    );
    const violations = scanGeminiExports(sf, 'legacy.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toContain('fail-closed');
  });

  it('F2: resolves module.exports = <identifier> to a static object-literal binding and detects Gemini names', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      `const src = { GeminiLeak: 1 };\nmodule.exports = src;`,
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    // F2: the identifier "src" resolves to its static object-literal binding,
    // so GeminiLeak is detected directly (not via fail-closed).
    expect(violations).toHaveLength(1);
    expect(violations[0].exportName).toBe('GeminiLeak');
  });

  it('F2: does NOT flag a safe non-Gemini identifier assignment that resolves to a clean object', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      `const src = { normalName: 1 };\nmodule.exports = src;`,
    );
    // F2: "src" resolves to { normalName: 1 } — no Gemini names present,
    // so no violation is produced.
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations).toHaveLength(0);
  });
});
describe('export-detection — identifier export must both flag identifier and inspect bound object literal (#2)', () => {
  it('flags both the Gemini-named identifier and its bound object literal Gemini names', () => {
    const sf = parseSourceFile(
      'test.ts',
      'const GeminiConfig = { GeminiNested: 1 };\nexport default GeminiConfig;\n',
    );
    const violations = scanGeminiExports(sf, 'test.ts');
    expect(violations).toHaveLength(2);
    expect(violations.some((v) => v.exportName === 'GeminiConfig')).toBe(true);
    expect(violations.some((v) => v.exportName === 'GeminiNested')).toBe(true);
  });

  it('flags a non-Gemini identifier whose bound object contains a Gemini name', () => {
    const sf = parseSourceFile(
      'test.ts',
      'const safeName = { GeminiNested: 1 };\nexport default safeName;\n',
    );
    const violations = scanGeminiExports(sf, 'test.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportName).toBe('GeminiNested');
  });
});
