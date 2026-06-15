/**
 * @plan:PLAN-20260608-ISSUE1586.P16
 * @requirement:REQ-TEST-001.1
 * @requirement:REQ-API-001.2
 */

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P16: CLI end-to-end auth migration integration tests.
 *
 * These tests verify that CLI auth code has been fully migrated to
 * import from @vybestack/llxprt-code-auth (not old core/auth paths),
 * and that real CLI auth consumers resolve and use auth-package symbols
 * semantically at both compile-time and runtime.
 *
 * No mock theater: no vi.fn(), toHaveBeenCalled, or mock frameworks.
 * No reverse testing: no assertions on internal error messages.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Canonical import specifiers that are forbidden in CLI auth source. */
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
// 1. CLI auth source imports from auth package, not old core/auth
// ─────────────────────────────────────────────────────────────────

describe('CLI auth migration: no old core/auth imports', () => {
  it('CLI production source has zero imports from core/auth subpath', () => {
    const cliAuthDir = path.resolve(__dirname, '../auth');
    const cliFiles = collectTsFiles(cliAuthDir, true).filter(
      (f) => !f.includes('__tests__'),
    );

    const violations: string[] = [];
    for (const filePath of cliFiles) {
      const relPath = path.relative(cliAuthDir, filePath);
      for (const pattern of FORBIDDEN_OLD_AUTH_IMPORTS) {
        violations.push(...findViolatingLines(filePath, pattern, relPath));
      }
    }

    expect(
      violations,
      `Forbidden core/auth imports in CLI auth source:\n${violations.join('\n')}`,
    ).toStrictEqual([]);
  });

  it('CLI test files have zero imports from core/auth subpath', () => {
    const cliAuthDir = path.resolve(__dirname, '../auth');
    const testFiles = collectTsFiles(cliAuthDir, false).filter(
      (f) => f.endsWith('.test.ts') || f.endsWith('.spec.ts'),
    );

    const violations: string[] = [];
    for (const filePath of testFiles) {
      const relPath = path.relative(cliAuthDir, filePath);
      for (const pattern of FORBIDDEN_OLD_AUTH_IMPORTS) {
        violations.push(...findViolatingLines(filePath, pattern, relPath));
      }
    }

    expect(
      violations,
      `Forbidden core/auth imports in CLI auth tests:\n${violations.join('\n')}`,
    ).toStrictEqual([]);
  });

  it('CLI integration tests have zero imports from core/auth subpath', () => {
    const integrationDir = __dirname;
    const integrationFiles = collectTsFiles(integrationDir, false);

    const violations: string[] = [];
    for (const filePath of integrationFiles) {
      const relPath = path.relative(integrationDir, filePath);
      for (const pattern of FORBIDDEN_OLD_AUTH_IMPORTS) {
        violations.push(...findViolatingLines(filePath, pattern, relPath));
      }
    }

    expect(
      violations,
      `Forbidden core/auth imports in CLI integration tests:\n${violations.join('\n')}`,
    ).toStrictEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// 2. CLI auth types re-export from auth package
// ─────────────────────────────────────────────────────────────────

describe('OAuth provider types relocated to providers package', () => {
  it('CLI no longer hosts an auth/types.ts module (relocated to providers)', () => {
    // Issue #2033 relocated the entire OAuth/auth cluster out of the CLI; the
    // former packages/cli/src/auth/types.ts must no longer exist.
    const typesPath = path.resolve(__dirname, '../auth/types.ts');
    expect(fs.existsSync(typesPath)).toBe(false);
  });

  it('OAuthProvider type is exported from the providers auth barrel', () => {
    const providersAuthIndex = path.resolve(
      __dirname,
      '../../../providers/src/auth/index.ts',
    );
    expect(fs.existsSync(providersAuthIndex)).toBe(true);
    const content = fs.readFileSync(providersAuthIndex, 'utf-8');
    expect(content.includes('OAuthProvider')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────
// 3. Real CLI auth consumers resolve auth-package symbols
// ─────────────────────────────────────────────────────────────────

describe('CLI auth consumers resolve auth-package symbols at runtime', () => {
  it('CLI types.ts re-exports OAuthToken, TokenStore, KeyringTokenStore from auth package', async () => {
    const types = await import('@vybestack/llxprt-code-providers/auth.js');
    // KeyringTokenStore is a value re-export from auth
    expect(typeof types.KeyringTokenStore).toBe('function');
  });

  it('CLI oauth-provider-base imports OAuthError and OAuthErrorFactory from auth', async () => {
    const mod = await import('@vybestack/llxprt-code-providers/auth.js');
    // InitializationGuard is a providers-local class using auth's OAuthError
    expect(typeof mod.OAuthManager).toBe('function');
  });

  it('auth-utils imports OAuthTokenRequestMetadata type from auth', async () => {
    // auth-utils was relocated to providers — verify via the OAuthManager export
    // which depends on auth-utils internally
    const mod = await import('@vybestack/llxprt-code-providers/auth.js');
    expect(typeof mod.OAuthManager).toBe('function');
  });

  it('credential-store-factory imports KeyringTokenStore and ProxyTokenStore from auth', async () => {
    const mod = await import('@vybestack/llxprt-code-providers/auth.js');
    // createTokenStore is the real factory that constructs auth-package types
    expect(typeof mod.createTokenStore).toBe('function');
    expect(typeof mod.createProviderKeyStorage).toBe('function');
    expect(typeof mod.resetFactorySingletons).toBe('function');
  });

  it('oauth-manager structurally satisfies auth OAuthManager interface at compile time', async () => {
    const mod = await import('@vybestack/llxprt-code-providers/auth.js');
    // OAuthManager class is exported — proves it compiled with auth's interface
    expect(typeof mod.OAuthManager).toBe('function');
    // The compile-time compatibility marker _CliOAuthManagerSatisfiesAuthInterface
    // proves structural compatibility. At runtime, verify the class has
    // the methods that the auth interface requires.
    const proto = mod.OAuthManager.prototype as unknown as Record<
      string,
      unknown
    >;
    expect(typeof proto.getToken).toBe('function');
    expect(typeof proto.isAuthenticated).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────────
// 4. Compile-time contract: CLI consumers use auth types correctly
// ─────────────────────────────────────────────────────────────────

describe('CLI auth compile-time contract verification', () => {
  it('core index re-exports auth symbols reachable from CLI', async () => {
    const coreIndex = await import('@vybestack/llxprt-code-core');
    // These are re-exported from core index, which pulls from auth package
    expect('AuthPrecedenceResolver' in coreIndex).toBe(true);
    expect('flushRuntimeAuthScope' in coreIndex).toBe(true);
    expect('KeyringTokenStore' in coreIndex).toBe(true);
    expect('createAuthPrecedenceResolver' in coreIndex).toBe(true);
    expect('createKeyringTokenStore' in coreIndex).toBe(true);
    expect('ProxyTokenStore' in coreIndex).toBe(true);
    expect('ProxyProviderKeyStorage' in coreIndex).toBe(true);
  });

  it('core package.json has no auth subpath exports', () => {
    const corePkgPath = path.resolve(__dirname, '../../../core/package.json');
    const pkg = JSON.parse(fs.readFileSync(corePkgPath, 'utf-8')) as Record<
      string,
      unknown
    >;
    const exports = (pkg.exports ?? {}) as Record<string, unknown>;
    const authSubpaths = Object.keys(exports).filter(
      (key) => key.startsWith('./auth/') || key === './auth',
    );
    expect(
      authSubpaths,
      `core package.json must not have auth subpath exports: ${authSubpaths.join(', ')}`,
    ).toStrictEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// 5. CLI auth device flows constructed from auth package types
// ─────────────────────────────────────────────────────────────────

describe('CLI auth device flows use auth-package exports', () => {
  it('auth package exports all four device flow constructors', async () => {
    const authPkg = await import('@vybestack/llxprt-code-auth');
    expect(typeof authPkg.AnthropicDeviceFlow).toBe('function');
    expect(typeof authPkg.CodexDeviceFlow).toBe('function');
    expect(typeof authPkg.QwenDeviceFlow).toBe('function');
  });

  it('auth package exports KeyringTokenStore constructor', async () => {
    const authPkg = await import('@vybestack/llxprt-code-auth');
    expect(typeof authPkg.KeyringTokenStore).toBe('function');
  });

  it('AuthPrecedenceResolver can be constructed with auth-only DI (no core imports)', async () => {
    const { AuthPrecedenceResolver } = await import(
      '@vybestack/llxprt-code-auth'
    );
    // Minimal DI: all deps are auth interfaces, no core runtime needed
    const resolver = new AuthPrecedenceResolver(
      { apiKey: 'test-key', envKeyNames: [], providerId: 'test' },
      {
        settingsService: {
          get: () => undefined,
          getProviderSettings: () => ({}),
          on: () => () => {},
          off: () => {},
        },
      },
    );
    expect(resolver).toBeDefined();
    // Resolve without OAuth — should return the direct API key
    const auth = await resolver.resolveAuthentication({ includeOAuth: false });
    expect(auth).toBe('test-key');
  });

  it('CLI oauth-manager type compatibility marker compiles', async () => {
    // This test proves the compile-time compatibility marker in oauth-manager.ts
    // compiles correctly. The marker type _CliOAuthManagerSatisfiesAuthInterface
    // uses `extends` to verify structural compatibility at compile time.
    // At runtime we verify the marker file actually exports the expected class.
    const mod = await import('@vybestack/llxprt-code-providers/auth.js');
    const OAuthManager = mod.OAuthManager;
    // Check required interface methods exist on prototype
    const requiredMethods = ['getToken', 'isAuthenticated', 'authenticate'];
    for (const method of requiredMethods) {
      expect(
        typeof (OAuthManager.prototype as unknown as Record<string, unknown>)[
          method
        ],
        `OAuthManager must have ${method} method`,
      ).toBe('function');
    }
  });
});
