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
  getParseDiagnostics,
} from '../genai-enclave/scanner.ts';

describe('parseSourceFile — invalid syntax produces diagnostics', () => {
  it('produces parse diagnostics for broken syntax', () => {
    const sf = parseSourceFile('broken.ts', 'export const x = ((((;\n');
    expect(getParseDiagnostics(sf).length).toBeGreaterThan(0);
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

  it('flags Object.assign with a non-literal source (F4 fail-closed)', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'Object.assign(exports, someSource);',
    );
    expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([
      {
        kind: 'gemini-export',
        file: 'legacy.cjs',
        line: 1,
        exportName: 'Object.assign with non-literal source',
        exportForm: 'computed export mutation (fail-closed)',
      },
    ]);
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
describe('export-detection — default exports expose only the default name', () => {
  it('flags a Gemini-named default binding without treating its properties as exports', () => {
    const sf = parseSourceFile(
      'test.ts',
      'const GeminiConfig = { GeminiNested: 1 };\nexport default GeminiConfig;\n',
    );
    expect(scanGeminiExports(sf, 'test.ts').map((v) => v.exportName)).toEqual([
      'GeminiConfig',
    ]);
  });

  it('does not flag properties of an object exported through a neutral default binding', () => {
    const sf = parseSourceFile(
      'test.ts',
      'const safeName = { GeminiNested: 1 };\nexport default safeName;\n',
    );
    expect(scanGeminiExports(sf, 'test.ts')).toEqual([]);
  });
});

describe('A2/A3: whole-target module.exports logical assignments inspect RHS', () => {
  it('detects Gemini name via module.exports ||= { ... } object literal', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'module.exports ||= { GeminiLeak: 1 };',
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiLeak');
  });

  it('detects Gemini name via module.exports ??= { ... } object literal', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'module.exports ??= { GeminiLeak: 1 };',
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiLeak');
  });

  it('detects Gemini name via module.exports &&= { ... } object literal', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'module.exports &&= { GeminiLeak: 1 };',
    );
    expect(
      scanGeminiExports(sf, 'legacy.cjs').map((v) => v.exportName),
    ).toContain('GeminiLeak');
  });

  it('does NOT flag safe module.exports ||= with non-Gemini names', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'module.exports ||= { normalName: 1 };',
    );
    expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
  });

  it('does NOT flag safe module.exports ??= with non-Gemini names', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'module.exports ??= { normalName: 1 };',
    );
    expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
  });

  it('fail-closed: module.exports ||= with callExpression RHS', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'module.exports ||= makeExports();',
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toContain('fail-closed');
  });

  it('fail-closed: module.exports ??= with callExpression RHS', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'module.exports ??= makeExports();',
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toContain('fail-closed');
  });

  it('detects Gemini in both branches of module.exports &&= conditional RHS', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'module.exports &&= cond ? { GeminiLeak: 1 } : null;',
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportName).toBe('GeminiLeak');
  });

  it('fail-closed: module.exports = conditional with unresolvable branch', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'module.exports = cond ? makeExports() : null;',
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations).toHaveLength(1);
    expect(violations[0].exportForm).toContain('fail-closed');
  });

  it('fail-closed: module.exports = logical OR with unresolvable branch', () => {
    const sf = parseSourceFile(
      'legacy.cjs',
      'module.exports = fallback || makeExports();',
    );
    const violations = scanGeminiExports(sf, 'legacy.cjs');
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations.some((v) => v.exportForm.includes('fail-closed'))).toBe(
      true,
    );
  });

  describe('A6: unresolved neutral identifier RHS must fail closed', () => {
    it('fail-closed: module.exports = someUnknownVar (unresolved neutral identifier)', () => {
      const sf = parseSourceFile(
        'legacy.cjs',
        'module.exports = someUnknownVar;\n',
      );
      const violations = scanGeminiExports(sf, 'legacy.cjs');
      expect(violations).toHaveLength(1);
      expect(violations[0].exportForm).toContain('fail-closed');
    });

    it('fail-closed: module.exports = a.nonLiteralProperty (unresolvable property access)', () => {
      const sf = parseSourceFile(
        'legacy.cjs',
        'module.exports = a.nonLiteralProperty;\n',
      );
      const violations = scanGeminiExports(sf, 'legacy.cjs');
      expect(violations).toHaveLength(1);
      expect(violations[0].exportForm).toContain('fail-closed');
    });

    it('does NOT fail-closed when module.exports = null', () => {
      const sf = parseSourceFile('legacy.cjs', 'module.exports = null;\n');
      expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
    });

    it('does NOT fail-closed when module.exports = undefined', () => {
      const sf = parseSourceFile('legacy.cjs', 'module.exports = undefined;\n');
      expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
    });

    it('does NOT fail-closed when module.exports = 42 (numeric literal)', () => {
      const sf = parseSourceFile('legacy.cjs', 'module.exports = 42;\n');
      expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
    });

    it('does NOT fail-closed when module.exports = "str" (string literal)', () => {
      const sf = parseSourceFile('legacy.cjs', 'module.exports = "str";\n');
      expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
    });

    it('does NOT fail-closed when module.exports = true (boolean literal)', () => {
      const sf = parseSourceFile('legacy.cjs', 'module.exports = true;\n');
      expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
    });

    it('does NOT fail-closed when module.exports = /regex/ (regex literal)', () => {
      const sf = parseSourceFile('legacy.cjs', 'module.exports = /regex/;\n');
      expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
    });

    it('does NOT fail-closed for module.exports = {} (empty object literal)', () => {
      const sf = parseSourceFile('legacy.cjs', 'module.exports = {};\n');
      expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
    });

    it('does NOT fail-closed for module.exports = function() {} (anonymous function)', () => {
      const sf = parseSourceFile(
        'legacy.cjs',
        'module.exports = function() {};\n',
      );
      expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
    });

    it('does NOT fail-closed for module.exports = class {} (anonymous class)', () => {
      const sf = parseSourceFile('legacy.cjs', 'module.exports = class {};\n');
      expect(scanGeminiExports(sf, 'legacy.cjs')).toEqual([]);
    });

    it('still flags Gemini-named identifier even when fail-closed is suppressed by binding resolution', () => {
      const sf = parseSourceFile(
        'legacy.cjs',
        'const src = { GeminiLeak: 1 };\nmodule.exports = src;\n',
      );
      const violations = scanGeminiExports(sf, 'legacy.cjs');
      expect(violations.some((v) => v.exportName === 'GeminiLeak')).toBe(true);
      expect(violations.some((v) => v.exportForm.includes('fail-closed'))).toBe(
        false,
      );
    });
  });
});

// ── #2: Transparent wrappers preserve ESM default-export semantics ──────────

describe('#2: transparent wrappers do not turn default-object properties into named exports', () => {
  it.each([
    'export default ({ GeminiName: 1 });\n',
    'export default { GeminiName: 1 } as const;\n',
    'type T = {};\nexport default { GeminiName: 1 } satisfies T;\n',
    'const x: { GeminiName: number } | null = { GeminiName: 1 };\nexport default x!;\n',
    'export default { nested: { GeminiDeep: 1 } as Record<string, number> };\n',
  ])('does not flag object properties in %s', (source) => {
    const sf = parseSourceFile('test.ts', source);
    expect(scanGeminiExports(sf, 'test.ts')).toEqual([]);
  });
});

describe('#2: ESM exported const/let/var does NOT inspect object literal properties', () => {
  // ESM `export const x = { GeminiKey: 42 }` does NOT export GeminiKey
  // as a named export — only `x` is exported. Object-literal property
  // names are internal, not part of the module's export surface.
  it('does NOT flag Gemini property in exported const object initializer', () => {
    const sf = parseSourceFile(
      'test.ts',
      'export const config = { GeminiKey: 42 };\n',
    );
    expect(scanGeminiExports(sf, 'test.ts')).toEqual([]);
  });

  it('does NOT flag Gemini property in exported let object initializer', () => {
    const sf = parseSourceFile(
      'test.ts',
      'export let config = { GeminiKey: 42 };\n',
    );
    expect(scanGeminiExports(sf, 'test.ts')).toEqual([]);
  });

  it('does NOT flag Gemini property in exported var object initializer', () => {
    const sf = parseSourceFile(
      'test.ts',
      'export var config = { GeminiKey: 42 };\n',
    );
    expect(scanGeminiExports(sf, 'test.ts')).toEqual([]);
  });

  it('does NOT flag exported const without Gemini in initializer', () => {
    const sf = parseSourceFile(
      'test.ts',
      'export const config = { normalKey: 42 };\n',
    );
    expect(scanGeminiExports(sf, 'test.ts')).toEqual([]);
  });
});

describe('#2: fail-closed for unresolved ESM export-assignment calls', () => {
  it('does NOT fail-closed for export default = factory() (ESM default)', () => {
    // ESM `export default expr` only exports `default`, not named exports.
    // The expression's properties do not become export names.
    const sf = parseSourceFile('test.ts', 'export default makeExports();\n');
    const violations = scanGeminiExports(sf, 'test.ts');
    expect(violations.some((v) => v.exportForm.includes('fail-closed'))).toBe(
      false,
    );
  });

  it('fail-closed for export = factory() (export equals)', () => {
    const sf = parseSourceFile('test.ts', 'export = makeExports();\n');
    const violations = scanGeminiExports(sf, 'test.ts');
    expect(violations.some((v) => v.exportForm.includes('fail-closed'))).toBe(
      true,
    );
  });

  it('does NOT fail-closed for export default identifier', () => {
    const sf = parseSourceFile('test.ts', 'const x = 42;\nexport default x;\n');
    const violations = scanGeminiExports(sf, 'test.ts');
    expect(violations.some((v) => v.exportForm.includes('fail-closed'))).toBe(
      false,
    );
  });
});
