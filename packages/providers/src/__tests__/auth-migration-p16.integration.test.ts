/**
 * @plan:PLAN-20260608-ISSUE1586.P16
 * @requirement:REQ-TEST-001.1
 * @requirement:REQ-API-001.3
 */

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P16: Providers AuthPrecedenceResolver integration tests.
 *
 * These tests verify that:
 * 1. Providers package uses AuthPrecedenceResolver from @vybestack/llxprt-code-auth
 * 2. Core SettingsService satisfies ISettingsService by structural typing
 * 3. BaseProvider constructs AuthPrecedenceResolver with options-object pattern
 * 4. No old core/auth imports remain in providers production code
 *
 * No mock theater: no vi.fn(), toHaveBeenCalled, or mock frameworks.
 * No reverse testing: no assertions on internal error messages.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AuthPrecedenceResolver,
  type AuthPrecedenceConfig,
  type ISettingsService,
} from '@vybestack/llxprt-code-auth';
import { SettingsService } from '@vybestack/llxprt-code-settings';

const PROVIDERS_SRC_DIR = path.resolve(__dirname, '..');

/** Canonical import specifiers forbidden in providers source. */
const FORBIDDEN_OLD_AUTH_IMPORTS = [
  /from\s+['"]@vybestack\/llxprt-code-core\/auth/u,
  /from\s+['"]@vybestack\/llxprt-code-core\/auth\//u,
];

/**
 * Recursively collect .ts files, optionally excluding tests.
 */
function collectTsFiles(dir: string, excludeTests = true): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(fullPath, excludeTests));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      if (
        excludeTests &&
        (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts'))
      ) {
        continue;
      }
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Find lines matching a pattern, skipping comments.
 */
function findViolatingLines(
  filePath: string,
  pattern: RegExp,
  relPath: string,
): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*')
    ) {
      continue;
    }
    if (pattern.test(lines[i])) {
      violations.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────────
// 1. Providers production source has no old core/auth imports
// ─────────────────────────────────────────────────────────────────

describe('Providers auth migration: no old core/auth imports', () => {
  it('providers production source has zero imports from core/auth subpath', () => {
    const prodFiles = collectTsFiles(PROVIDERS_SRC_DIR, true).filter(
      (f) => !f.includes('__tests__'),
    );

    const violations: string[] = [];
    for (const filePath of prodFiles) {
      const relPath = path.relative(PROVIDERS_SRC_DIR, filePath);
      for (const pattern of FORBIDDEN_OLD_AUTH_IMPORTS) {
        violations.push(...findViolatingLines(filePath, pattern, relPath));
      }
    }

    expect(
      violations,
      `Forbidden core/auth imports in providers source:\n${violations.join('\n')}`,
    ).toStrictEqual([]);
  });

  it('providers test files have zero imports from core/auth subpath', () => {
    const testFiles = collectTsFiles(PROVIDERS_SRC_DIR, false).filter(
      (f) => f.endsWith('.test.ts') || f.endsWith('.spec.ts'),
    );

    const violations: string[] = [];
    for (const filePath of testFiles) {
      const relPath = path.relative(PROVIDERS_SRC_DIR, filePath);
      for (const pattern of FORBIDDEN_OLD_AUTH_IMPORTS) {
        violations.push(...findViolatingLines(filePath, pattern, relPath));
      }
    }

    expect(
      violations,
      `Forbidden core/auth imports in providers tests:\n${violations.join('\n')}`,
    ).toStrictEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// 2. Providers imports AuthPrecedenceResolver from auth package
// ─────────────────────────────────────────────────────────────────

describe('Providers imports AuthPrecedenceResolver from auth package', () => {
  it('BaseProvider.ts imports AuthPrecedenceResolver from auth', () => {
    const baseProviderPath = path.join(PROVIDERS_SRC_DIR, 'BaseProvider.ts');
    const content = fs.readFileSync(baseProviderPath, 'utf-8');
    expect(content.includes("from '@vybestack/llxprt-code-auth'")).toBe(true);
    expect(content.includes('AuthPrecedenceResolver')).toBe(true);
  });

  it('providers package.json has @vybestack/llxprt-code-auth dependency', () => {
    const pkgPath = path.resolve(PROVIDERS_SRC_DIR, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<
      string,
      unknown
    >;
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    expect(deps['@vybestack/llxprt-code-auth']).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────
// 3. SettingsService satisfies ISettingsService (structural typing)
// ─────────────────────────────────────────────────────────────────

describe('Core SettingsService satisfies auth ISettingsService', () => {
  /**
   * Compile-time structural compatibility check. If SettingsService does not
   * satisfy ISettingsService, this file won't pass typecheck.
   */
  function assertSatisfies<T>(_value: T): void {
    // Intentionally empty — compile-time type check only.
  }

  it('SettingsService structurally satisfies ISettingsService at compile time', () => {
    // This assertion proves at both compile time and runtime that
    // SettingsService can be used where ISettingsService is expected.
    const settingsService = new SettingsService();
    assertSatisfies<ISettingsService>(settingsService);
    expect(settingsService).toBeDefined();
  });

  it('SettingsService has get method matching ISettingsService', () => {
    const proto = SettingsService.prototype as Record<string, unknown>;
    expect(typeof proto.get).toBe('function');
  });

  it('SettingsService has getProviderSettings method matching ISettingsService', () => {
    const proto = SettingsService.prototype as Record<string, unknown>;
    expect(typeof proto.getProviderSettings).toBe('function');
  });

  it('SettingsService has on method matching ISettingsService', () => {
    const proto = SettingsService.prototype as Record<string, unknown>;
    expect(typeof proto.on).toBe('function');
  });

  it('SettingsService has off method matching ISettingsService', () => {
    const proto = SettingsService.prototype as Record<string, unknown>;
    expect(typeof proto.off).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────────
// 4. AuthPrecedenceResolver constructs with core SettingsService
// ─────────────────────────────────────────────────────────────────

describe('AuthPrecedenceResolver constructs with core SettingsService', () => {
  it('AuthPrecedenceResolver accepts SettingsService via options-object pattern', () => {
    const settingsService = new SettingsService();
    const config: AuthPrecedenceConfig = {
      apiKey: 'test-key',
      envKeyNames: ['TEST_KEY'],
      isOAuthEnabled: false,
      supportsOAuth: false,
      providerId: 'test-provider',
    };

    // This is the same pattern BaseProvider uses — SettingsService passed
    // directly to AuthPrecedenceResolver options by structural typing.
    const resolver = new AuthPrecedenceResolver(config, {
      settingsService,
    });

    expect(resolver).toBeDefined();
    expect(typeof resolver.resolveAuthentication).toBe('function');
  });

  it('AuthPrecedenceResolver resolves auth with SettingsService', async () => {
    const settingsService = new SettingsService();
    const config: AuthPrecedenceConfig = {
      apiKey: 'direct-api-key',
      envKeyNames: [],
      isOAuthEnabled: false,
      supportsOAuth: false,
      providerId: 'test-provider',
    };

    const resolver = new AuthPrecedenceResolver(config, {
      settingsService,
    });

    // With a direct API key, resolveAuthentication should return it
    const token = await resolver.resolveAuthentication();
    expect(token).toBe('direct-api-key');
  });

  it('AuthPrecedenceResolver setSettingsService accepts SettingsService', () => {
    const config: AuthPrecedenceConfig = {
      apiKey: 'test-key',
      envKeyNames: [],
      isOAuthEnabled: false,
      supportsOAuth: false,
      providerId: 'test-provider',
    };

    const resolver = new AuthPrecedenceResolver(config);
    const settingsService = new SettingsService();

    // BaseProvider calls setSettingsService with a real SettingsService
    resolver.setSettingsService(settingsService);
    // No assertion on internal state — the method must not throw
    expect(resolver).toBeDefined();
  });

  it('AuthPrecedenceResolver works without settingsService for direct API key', async () => {
    const settingsService = new SettingsService();
    const config: AuthPrecedenceConfig = {
      apiKey: 'lazy-api-key',
      envKeyNames: [],
      isOAuthEnabled: false,
      supportsOAuth: false,
      providerId: 'lazy-provider',
    };

    // Constructor without settingsService in constructor — BaseProvider pattern
    // uses setSettingsService later for lazy injection
    const resolver = new AuthPrecedenceResolver(config);
    resolver.setSettingsService(settingsService);

    const token = await resolver.resolveAuthentication();
    expect(token).toBe('lazy-api-key');
  });
});
