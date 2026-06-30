/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..');
const require = createRequire(import.meta.url);

// The module under test is a CommonJS lifecycle helper shared by
// preinstall.cjs and postinstall.cjs. Load it through createRequire so the test
// exercises the exact file the lifecycle scripts consume.
const { detectInstaller } = require(
  join(repoRoot, 'scripts', 'detect-installer.cjs'),
) as { detectInstaller: (env?: NodeJS.ProcessEnv) => 'bun' | 'npm' };

describe('detectInstaller', () => {
  it('detects Bun from the bun/ user-agent prefix', () => {
    expect(
      detectInstaller({
        npm_config_user_agent: 'bun/1.3.14 npm/? node/v24.3.0 darwin arm64',
      }),
    ).toBe('bun');
  });

  it('detects npm from the npm/ user-agent prefix', () => {
    expect(
      detectInstaller({
        npm_config_user_agent: 'npm/11.6.2 node/v24.3.0 darwin arm64',
      }),
    ).toBe('npm');
  });

  it('defaults to npm when no user-agent is present', () => {
    // Lifecycle scripts must preserve the pre-existing npm behavior when the
    // signal is absent, so an empty environment resolves to npm. An explicitly
    // empty string is the same "no signal" case and must not be mistaken for a
    // manager prefix.
    expect(detectInstaller({})).toBe('npm');
    expect(detectInstaller({ npm_config_user_agent: '' })).toBe('npm');
  });

  it('treats other managers (pnpm, Yarn) as npm to preserve existing behavior', () => {
    // S1 only special-cases Bun. Every other/unknown manager must fall through
    // to the npm lifecycle path exactly as it did before manager-awareness was
    // introduced, so this is a deliberate, asserted behavior rather than an
    // accident.
    expect(
      detectInstaller({ npm_config_user_agent: 'pnpm/9.0.0 node/v24.3.0' }),
    ).toBe('npm');
    expect(
      detectInstaller({ npm_config_user_agent: 'yarn/1.22.22 node/v24.3.0' }),
    ).toBe('npm');
  });

  it('does not treat a non-prefix "bun" substring as Bun', () => {
    // The check is intentionally anchored to the `bun/` prefix. A user agent
    // that merely contains the word "bun" elsewhere (e.g. a host or proxy
    // identifier) must NOT be misclassified as a Bun install.
    expect(
      detectInstaller({
        npm_config_user_agent: 'npm/11.6.2 node/v24.3.0 host-bun-01',
      }),
    ).toBe('npm');
  });

  it('tolerates incidental leading whitespace or casing in the bun prefix', () => {
    // Defensive hardening: a wrapper that re-cases or space-pads the user agent
    // must still be recognized as Bun rather than silently falling through to
    // the npm lifecycle path. Real Bun emits a clean lowercase `bun/` prefix, so
    // these are belt-and-suspenders inputs, asserted so the normalization is a
    // deliberate, locked-in contract.
    expect(
      detectInstaller({ npm_config_user_agent: '  bun/1.3.14 node/v24.3.0' }),
    ).toBe('bun');
    expect(
      detectInstaller({ npm_config_user_agent: 'BUN/1.3.14 node/v24.3.0' }),
    ).toBe('bun');
    expect(
      detectInstaller({ npm_config_user_agent: '\tBun/1.3.14 darwin arm64' }),
    ).toBe('bun');
  });

  it('reads from process.env by default', () => {
    // The lifecycle scripts call detectInstaller() with no argument and rely on
    // the default reading process.env. Verify that contract using vi.stubEnv so
    // the real environment is restored automatically (see afterEach) instead of
    // hand-rolled try/finally save-and-restore.
    vi.stubEnv('npm_config_user_agent', 'bun/1.3.14 host');
    expect(detectInstaller()).toBe('bun');
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});
