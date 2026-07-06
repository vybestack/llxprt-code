/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const cliPackageRoot = resolve(__dirname, '..', '..');
const loadCommonJsModule = createRequire(import.meta.url);

interface ProxyHostTestExports {
  isModuleNotFound: (error: unknown) => boolean;
  isProviderAuthModuleNotFound: (error: unknown) => boolean;
  PROVIDER_AUTH_SPECIFIER: string;
  PROVIDER_AUTH_PACKAGE: string;
}

function loadProxyHost(): ProxyHostTestExports {
  const mod = loadCommonJsModule(
    resolve(cliPackageRoot, 'bin', 'credential-proxy-host.cjs'),
  ) as Record<string, unknown>;
  // Fail loudly at setup if the CJS module's exports drift from this test's
  // expectations, rather than letting the unsafe cast mask a mismatch.
  if (
    typeof mod.isModuleNotFound !== 'function' ||
    typeof mod.isProviderAuthModuleNotFound !== 'function' ||
    typeof mod.PROVIDER_AUTH_SPECIFIER !== 'string' ||
    typeof mod.PROVIDER_AUTH_PACKAGE !== 'string'
  ) {
    throw new Error(
      'credential-proxy-host.cjs exports do not match ProxyHostTestExports',
    );
  }
  return mod as unknown as ProxyHostTestExports;
}

function moduleNotFoundError(message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = 'MODULE_NOT_FOUND';
  return error;
}

function esmModuleNotFoundError(message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = 'ERR_MODULE_NOT_FOUND';
  return error;
}

describe('credential-proxy-host module-not-found matching', () => {
  let host: ProxyHostTestExports;

  beforeAll(() => {
    host = loadProxyHost();
  });

  it('derives the package root from the full specifier', () => {
    expect(host.PROVIDER_AUTH_SPECIFIER).toBe(
      '@vybestack/llxprt-code-providers/auth.js',
    );
    expect(host.PROVIDER_AUTH_PACKAGE).toBe('@vybestack/llxprt-code-providers');
  });

  it.each(["'", '"'])(
    'matches when the provider auth module itself is missing (quote=%s)',
    (quote) => {
      expect(
        host.isProviderAuthModuleNotFound(
          moduleNotFoundError(
            `Cannot find module ${quote}${host.PROVIDER_AUTH_SPECIFIER}${quote}`,
          ),
        ),
      ).toBe(true);
    },
  );

  it.each(["'", '"'])(
    'matches the ESM missing-package error format with bare package name (quote=%s)',
    (quote) => {
      expect(
        host.isProviderAuthModuleNotFound(
          esmModuleNotFoundError(
            `Cannot find package ${quote}${host.PROVIDER_AUTH_PACKAGE}${quote} imported from /somewhere`,
          ),
        ),
      ).toBe(true);
    },
  );

  it.each(["'", '"'])(
    'matches the resolved-absolute-path error format when a subpath export target is missing (quote=%s)',
    (quote) => {
      // A consumer install resolves the "./auth.js" export to an absolute
      // dist/.../index.js path; when that built file is absent, ESM quotes the
      // resolved path (which contains the package name), not the specifier.
      expect(
        host.isProviderAuthModuleNotFound(
          esmModuleNotFoundError(
            `Cannot find module ${quote}/root/node_modules/${host.PROVIDER_AUTH_PACKAGE}/dist/src/auth/index.js${quote} imported from /root/packages/cli/bin/credential-proxy-host.cjs`,
          ),
        ),
      ).toBe(true);
    },
  );

  it('does NOT match when a transitive dependency inside the module is missing', () => {
    // The importer path (in the require stack) names the provider auth module,
    // but the first quoted token is the missing transitive dependency's own
    // specifier — this must propagate, not fall back.
    expect(
      host.isProviderAuthModuleNotFound(
        moduleNotFoundError(
          `Cannot find module 'some-transitive-dep'\nRequire stack:\n- /path/to/${host.PROVIDER_AUTH_SPECIFIER}`,
        ),
      ),
    ).toBe(false);
  });

  it('does NOT match a sibling package whose name merely starts with the provider auth package', () => {
    // A missing transitive dependency named "<package>-utils" must not be
    // misclassified as the provider auth module itself being missing.
    expect(
      host.isProviderAuthModuleNotFound(
        esmModuleNotFoundError(
          `Cannot find package '${host.PROVIDER_AUTH_PACKAGE}-utils' imported from /somewhere`,
        ),
      ),
    ).toBe(false);
  });

  it('does not treat non-module-not-found errors as such', () => {
    const syntaxError = new Error('Unexpected token');
    expect(host.isModuleNotFound(syntaxError)).toBe(false);
    expect(host.isProviderAuthModuleNotFound(syntaxError)).toBe(false);
  });

  it('recognizes both MODULE_NOT_FOUND and ERR_MODULE_NOT_FOUND codes', () => {
    expect(host.isModuleNotFound(moduleNotFoundError('x'))).toBe(true);
    expect(host.isModuleNotFound(esmModuleNotFoundError('x'))).toBe(true);
  });
});
