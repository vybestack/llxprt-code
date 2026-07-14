/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the shared manifest-enforcement module (#2352 F1, F6,
 * F9, F10).
 *
 * These tests exercise the real enforcement functions directly (no mocks):
 *
 * - F1: reject unauthorized npm aliases targeting @google/genai.
 * - F6: reject malformed dependency sections (non-object shapes).
 * - F9: reject duplicate dependency sections (SDK declared in both
 *   dependencies AND devDependencies, etc.).
 * - F10: production guard requires exact configured root/core/providers
 *   dependencies.
 *
 * Per RULES.md: tests assert behavior (does the enforcement report a
 * violation?), not implementation details.
 */

import { describe, it, expect } from 'vitest';
import {
  validateManifestDependencies,
  type ManifestValidationInput,
} from '../genai-enclave/manifest-enforcement.ts';
import { SANCTIONED_GENAI_VERSION } from '../genai-enclave/config.ts';

const SANCTIONED_VERSION = SANCTIONED_GENAI_VERSION;

function input(
  workspaceDir: string,
  manifest: Record<string, unknown>,
): ManifestValidationInput {
  return { workspaceDir, manifest };
}

const SANCTIONED = 'packages/core';

const ALL_DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

describe('validateManifestDependencies — F1: reject unauthorized npm aliases targeting GenAI', () => {
  it.each(ALL_DEPENDENCY_SECTIONS)(
    'rejects an npm alias targeting @google/genai in %s',
    (section) => {
      const manifest: Record<string, unknown> = {};
      manifest[section] = {
        'fake-name': `npm:@google/genai@${SANCTIONED_VERSION}`,
      };
      const result = validateManifestDependencies(
        input('packages/cli', manifest),
      );
      expect(
        result.violations.some((v) => v.message.includes('npm alias')),
      ).toBe(true);
    },
  );

  it('rejects an npm alias whose target is @google/genai', () => {
    const result = validateManifestDependencies(
      input('packages/cli', {
        dependencies: {
          'fake-name': `npm:@google/genai@${SANCTIONED_VERSION}`,
        },
      }),
    );
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    expect(result.violations.some((v) => v.message.includes('npm alias'))).toBe(
      true,
    );
  });

  it('rejects a scoped npm alias whose target is @google/genai', () => {
    const result = validateManifestDependencies(
      input('packages/cli', {
        dependencies: {
          '@evil/sdk': 'npm:@google/genai@^1.30.0',
        },
      }),
    );
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    expect(result.violations.some((v) => v.message.includes('npm alias'))).toBe(
      true,
    );
  });

  it('rejects an npm alias targeting a @google/genai subpath', () => {
    const result = validateManifestDependencies(
      input('packages/agents', {
        dependencies: { sdk: 'npm:@google/genai/dist@1.30.0' },
      }),
    );
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a versionless npm:@google/genai alias', () => {
    // An alias with no version (`npm:@google/genai` with no `@version`)
    // is malformed but must still be rejected as a genai-targeting alias.
    const result = validateManifestDependencies(
      input('packages/cli', {
        dependencies: { 'fake-name': 'npm:@google/genai' },
      }),
    );
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    expect(result.violations.some((v) => v.message.includes('npm alias'))).toBe(
      true,
    );
  });

  it('rejects a versionless npm:@google/genai/subpath alias', () => {
    const result = validateManifestDependencies(
      input('packages/cli', {
        dependencies: { 'fake-name': 'npm:@google/genai/dist' },
      }),
    );
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    expect(result.violations.some((v) => v.message.includes('npm alias'))).toBe(
      true,
    );
  });

  it('does NOT reject an npm alias whose target is a different package', () => {
    const result = validateManifestDependencies(
      input('packages/cli', {
        dependencies: { 'mime-types': 'npm:mime-types@^3.0.1' },
      }),
    );
    expect(
      result.violations.filter((v) => v.message.includes('npm alias')),
    ).toEqual([]);
  });

  it('does NOT reject a sanctioned workspace with a normal alias', () => {
    const result = validateManifestDependencies(
      input(SANCTIONED, {
        dependencies: {
          '@google/genai': SANCTIONED_VERSION,
          'mime-types': 'npm:mime-types@^3.0.1',
        },
      }),
    );
    expect(result.violations).toEqual([]);
  });
});

describe('validateManifestDependencies — F9: reject duplicate dependency sections', () => {
  it('rejects SDK declared in both dependencies and devDependencies', () => {
    const result = validateManifestDependencies(
      input(SANCTIONED, {
        dependencies: { '@google/genai': SANCTIONED_VERSION },
        devDependencies: { '@google/genai': SANCTIONED_VERSION },
      }),
    );
    expect(result.violations.some((v) => v.message.includes('duplicate'))).toBe(
      true,
    );
  });

  it('rejects SDK declared in both dependencies and peerDependencies', () => {
    const result = validateManifestDependencies(
      input(SANCTIONED, {
        dependencies: { '@google/genai': SANCTIONED_VERSION },
        peerDependencies: { '@google/genai': SANCTIONED_VERSION },
      }),
    );
    expect(result.violations.some((v) => v.message.includes('duplicate'))).toBe(
      true,
    );
  });

  it('rejects SDK in both dependencies and optionalDependencies (duplicate + wrong-section)', () => {
    const result = validateManifestDependencies(
      input(SANCTIONED, {
        dependencies: { '@google/genai': SANCTIONED_VERSION },
        optionalDependencies: { '@google/genai': SANCTIONED_VERSION },
      }),
    );
    expect(result.violations).toHaveLength(2);
    const hasDuplicate = result.violations.some((v) =>
      v.message.includes('multiple dependency sections'),
    );
    const hasWrongSection = result.violations.some((v) =>
      v.message.includes('found in "optionalDependencies"'),
    );
    expect(hasDuplicate).toBe(true);
    expect(hasWrongSection).toBe(true);
  });

  it('rejects SDK declared in three sections simultaneously', () => {
    const result = validateManifestDependencies(
      input(SANCTIONED, {
        dependencies: { '@google/genai': SANCTIONED_VERSION },
        devDependencies: { '@google/genai': SANCTIONED_VERSION },
        optionalDependencies: { '@google/genai': SANCTIONED_VERSION },
      }),
    );
    const duplicateViolations = result.violations.filter((v) =>
      v.message.includes('duplicate'),
    );
    expect(duplicateViolations.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT reject a single declaration in dependencies', () => {
    const result = validateManifestDependencies(
      input(SANCTIONED, {
        dependencies: { '@google/genai': SANCTIONED_VERSION },
      }),
    );
    expect(result.violations).toEqual([]);
  });

  it('rejects SDK ONLY in devDependencies (wrong section for sanctioned workspace)', () => {
    const result = validateManifestDependencies(
      input(SANCTIONED, {
        devDependencies: { '@google/genai': SANCTIONED_VERSION },
      }),
    );
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    expect(
      result.violations.some((v) => v.message.includes('dependencies')),
    ).toBe(true);
  });
});

describe('validateManifestDependencies — F10: exact configured root/core/providers dependencies', () => {
  it('requires root workspace (.) to declare SDK at exact version', () => {
    const result = validateManifestDependencies(
      input('.', {
        dependencies: { '@google/genai': SANCTIONED_VERSION },
      }),
    );
    expect(result.violations).toEqual([]);
  });

  it('rejects root with wrong SDK version', () => {
    const result = validateManifestDependencies(
      input('.', {
        dependencies: { '@google/genai': '1.29.0' },
      }),
    );
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    expect(
      result.violations.some((v) => v.message.includes(SANCTIONED_VERSION)),
    ).toBe(true);
  });

  it('rejects root without SDK declaration', () => {
    const result = validateManifestDependencies(
      input('.', {
        dependencies: { chalk: '^4.0.0' },
      }),
    );
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
  });

  it('requires packages/core to declare SDK at exact version', () => {
    const result = validateManifestDependencies(
      input('packages/core', {
        dependencies: { '@google/genai': SANCTIONED_VERSION },
      }),
    );
    expect(result.violations).toEqual([]);
  });

  it('rejects packages/core with wrong version', () => {
    const result = validateManifestDependencies(
      input('packages/core', {
        dependencies: { '@google/genai': '2.0.0' },
      }),
    );
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
  });

  it('requires packages/providers to declare SDK at exact version', () => {
    const result = validateManifestDependencies(
      input('packages/providers', {
        dependencies: { '@google/genai': SANCTIONED_VERSION },
      }),
    );
    expect(result.violations).toEqual([]);
  });

  it('rejects packages/providers without SDK declaration', () => {
    const result = validateManifestDependencies(
      input('packages/providers', {
        dependencies: { chalk: '^4.0.0' },
      }),
    );
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a non-sanctioned workspace declaring SDK', () => {
    const result = validateManifestDependencies(
      input('packages/cli', {
        dependencies: { '@google/genai': SANCTIONED_VERSION },
      }),
    );
    expect(result.violations.length).toBeGreaterThanOrEqual(1);
    expect(result.violations.some((v) => v.message.includes('allowlist'))).toBe(
      true,
    );
  });
});

describe('validateManifestDependencies — F6: malformed dependency sections', () => {
  it('rejects a dependency section that is an array instead of an object', () => {
    const result = validateManifestDependencies(
      input('packages/cli', {
        dependencies: ['@google/genai'],
      }),
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe(
      'package.json "dependencies" must be an object when present ' +
        '(got array) — fail-closed.',
    );
  });

  it('rejects a dependency section that is a string', () => {
    const result = validateManifestDependencies(
      input('packages/cli', {
        devDependencies: '@google/genai',
      }),
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe(
      'package.json "devDependencies" must be an object when present ' +
        '(got string) — fail-closed.',
    );
  });

  it('rejects a dependency section that is null', () => {
    const result = validateManifestDependencies(
      input('packages/cli', {
        optionalDependencies: null,
      }),
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe(
      'package.json "optionalDependencies" must be an object when present ' +
        '(got null) — fail-closed.',
    );
  });

  it('rejects a dependency section that is a number', () => {
    const result = validateManifestDependencies(
      input('packages/cli', {
        peerDependencies: 42,
      }),
    );
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(
      result.errors.some((e) => e.message.includes('peerDependencies')),
    ).toBe(true);
  });

  it('rejects a dependency version that is not a string', () => {
    const result = validateManifestDependencies(
      input('packages/cli', {
        dependencies: { '@google/genai': 1.3 },
      }),
    );
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some((e) => e.message.includes('dependencies'))).toBe(
      true,
    );
  });

  it('does NOT error on a valid object dependency section', () => {
    const result = validateManifestDependencies(
      input(SANCTIONED, {
        dependencies: { '@google/genai': SANCTIONED_VERSION },
      }),
    );
    expect(result.errors).toEqual([]);
  });

  it('does NOT error on an absent dependency section', () => {
    const result = validateManifestDependencies(
      input('packages/cli', {
        name: 'test',
      }),
    );
    expect(result.errors).toEqual([]);
  });
});
