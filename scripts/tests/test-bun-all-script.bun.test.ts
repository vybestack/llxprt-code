/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral contract test for the canonical `test:bun:all` root package
 * script (issue #2578). `test:bun:all` is the one command that runs every
 * Bun-native test root in the repository — the uncredentialed workspace-plus-
 * script suite (test:bun), the credentialed integration-tests root
 * (sandbox:none mode), and all credentialed evals (RUN_EVALS=1) — in fail-fast
 * order. Every test file still executes directly under Bun.
 *
 * This test reads the real root package.json and verifies the script's shape
 * rather than executing it (which would require credentials/quota).
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..', '..');

interface PackageJson {
  readonly scripts?: Readonly<Record<string, string>>;
}

function readRootPackageJson(): PackageJson {
  return JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf8'),
  ) as PackageJson;
}

function commandExecutable(command: string): string | undefined {
  const tokens = command.trim().split(/\s+/);
  if (tokens[0] !== 'cross-env') {
    return tokens[0];
  }
  return tokens.slice(1).find((token) => !token.includes('='));
}

/** The three scripts test:bun:all must chain, in fail-fast order. */
const EXPECTED_CHAIN: readonly string[] = [
  'test:bun',
  'test:integration:sandbox:none',
  'test:all_evals',
];

describe('test:bun:all canonical aggregate script', () => {
  const rootPackage = readRootPackageJson();

  it('exists as a root package script', () => {
    const script = rootPackage.scripts?.['test:bun:all'];
    expect(script).toBeDefined();
    expect(typeof script).toBe('string');
  });

  it('contains no vitest invocation', () => {
    const script = rootPackage.scripts?.['test:bun:all'] ?? '';
    // The aggregate must be Bun-native only — no vitest binary anywhere.
    expect(script.toLowerCase()).not.toContain('vitest');
  });

  it('chains exactly three commands in fail-fast order', () => {
    const script = rootPackage.scripts?.['test:bun:all'] ?? '';
    expect(script).toBeDefined();
    // Fail-fast: three segments joined by &&, never ; or ||.
    const segments = script.split('&&');
    expect(segments.length).toBe(EXPECTED_CHAIN.length);
    expect(script).not.toContain('||');
    expect(script).not.toContain(';');
  });

  it('invokes the three existing scripts in the correct order', () => {
    const script = rootPackage.scripts?.['test:bun:all'] ?? '';
    let lastPos = -1;
    for (const name of EXPECTED_CHAIN) {
      const pos = script.indexOf(name);
      expect(pos).toBeGreaterThanOrEqual(0);
      expect(pos).toBeGreaterThan(lastPos);
      lastPos = pos;
    }
  });

  it('each underlying chained script exists and runs under Bun', () => {
    for (const name of EXPECTED_CHAIN) {
      const underlying = rootPackage.scripts?.[name];
      expect(underlying).toBeDefined();
      expect(commandExecutable(underlying ?? '')).toBe('bun');
    }
  });

  it('references the sandbox:none mode for integration-tests', () => {
    const script = rootPackage.scripts?.['test:bun:all'] ?? '';
    // The integration command must use sandbox:none (LLXPRT_SANDBOX=false),
    // not docker/podman, so it runs the credentialed root without containers.
    const integrationScript =
      rootPackage.scripts?.['test:integration:sandbox:none'] ?? '';
    expect(integrationScript).toContain('LLXPRT_SANDBOX=false');
    expect(integrationScript).toContain('integration-tests');
    expect(script).toContain('test:integration:sandbox:none');
  });

  it('references RUN_EVALS=1 for all evals', () => {
    const evalsScript = rootPackage.scripts?.['test:all_evals'] ?? '';
    expect(evalsScript).toContain('RUN_EVALS=1');
    expect(evalsScript).toContain('evals');
    const script = rootPackage.scripts?.['test:bun:all'] ?? '';
    expect(script).toContain('test:all_evals');
  });
});
