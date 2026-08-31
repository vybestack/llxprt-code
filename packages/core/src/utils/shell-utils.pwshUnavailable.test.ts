/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import type { ShellPermissionConfig } from './shell-utils.js';

/**
 * Finding 8 (#3181): PowerShell permission behavior when the structural
 * parser is unavailable.
 *
 * Under Node (or if the PowerShell WASM fails to load), `isParserAvailable
 * ('powershell')` returns false. These tests reset the parser to simulate
 * that state and verify:
 * - allowlist mode hard-denies with a truthful PowerShell diagnostic;
 * - none mode fails closed for substitution;
 * - multiline input is hard-denied with a PowerShell-specific reason;
 * - all mode does not hard-deny solely due to parser absence;
 * - a concurrent reset/init lifecycle does not corrupt parser state.
 *
 * resetParser/initializeParser are used instead of vi.mock to avoid
 * cross-file mock leakage in bun:test.
 */

import { checkCommandPermissions } from './shell-utils.js';
import {
  resetParser,
  initializeParser,
  isParserAvailable,
} from './shell-parser.js';
import { resolvePwshTestPolicyFromEnv } from '../test-utils/pwsh-test-policy.js';

await initializeParser();
const pwshPolicy = resolvePwshTestPolicyFromEnv(
  isParserAvailable('powershell'),
);
if (pwshPolicy.failureMessage !== null) {
  throw new Error(pwshPolicy.failureMessage);
}
if (pwshPolicy.skipReason !== null) {
  process.stderr.write(`${pwshPolicy.skipReason}\n`);
}
const describePwsh = describe.skipIf(pwshPolicy.skip);

async function restoreParsers(context: string): Promise<void> {
  const initialized = await initializeParser();
  if (!initialized || !isParserAvailable('powershell')) {
    throw new Error(
      `PowerShell parser re-initialization failed after ${context}`,
    );
  }
}

function createConfig(
  mode: 'none' | 'allowlist' | 'all',
  coreTools: string[],
  excludeTools: string[] = [],
): ShellPermissionConfig {
  return {
    getEphemeralSetting: () => mode,
    getShellReplacement: () => mode,
    getExcludeTools: () => excludeTools,
    getCoreTools: () => coreTools,
  };
}

function decide(
  command: string,
  mode: 'none' | 'allowlist' | 'all',
  coreTools: string[] = [],
  excludeTools: string[] = [],
): { allAllowed: boolean; isHardDenial: boolean; blockReason?: string } {
  const result = checkCommandPermissions(
    command,
    createConfig(mode, coreTools, excludeTools),
    undefined,
    'powershell',
  );
  return {
    allAllowed: result.allAllowed,
    isHardDenial: result.isHardDenial === true,
    blockReason: result.blockReason,
  };
}

const HARD_DENIAL = { allAllowed: false, isHardDenial: true };

describe('PowerShell unavailable-parser behavior', () => {
  describePwsh('PowerShell permission behavior when parser unavailable', () => {
    beforeAll(() => {
      resetParser();
    });

    afterAll(() => restoreParsers('unavailable-state tests'));

    it('allowlist mode hard-denies one-line PowerShell with truthful diagnostic', () => {
      const result = decide('Get-Process', 'allowlist', [
        'run_shell_command(Get-Process)',
      ]);
      expect(result).toMatchObject(HARD_DENIAL);
      expect(result.blockReason).toContain('PowerShell');
      expect(result.blockReason).toContain('structural parser');
      expect(result.blockReason).not.toContain('could not be parsed safely');
    });

    it('allowlist mode hard-denies multiline PowerShell with parser-required diagnostic', () => {
      const result = decide('Get-Process\nWrite-Host done', 'allowlist');
      expect(result).toMatchObject(HARD_DENIAL);
      expect(result.blockReason).toContain('PowerShell');
      expect(result.blockReason).toContain('parser');
    });

    it('none mode hard-denies one-line PowerShell with $() substitution', () => {
      const result = decide('$(Get-Date)', 'none');
      expect(result).toMatchObject(HARD_DENIAL);
      expect(result.blockReason).toContain('substitution');
    });

    it('none mode hard-denies one-line PowerShell even without substitution (parser unavailable fail-closed)', () => {
      // Without the parser, detectCommandSubstitution returns true for PowerShell
      // (fail closed). So even a plain command is denied in none mode.
      const result = decide('Get-Process', 'none');
      expect(result).toMatchObject(HARD_DENIAL);
    });

    it('all mode does NOT hard-deny solely because the parser is unavailable', () => {
      const result = decide('Get-Process', 'all');
      expect(result.isHardDenial).toBe(false);
    });

    it('all mode still enforces blocklist when parser unavailable', () => {
      const result = decide('rm -rf /tmp', 'all', [], ['ShellTool(rm)']);
      expect(result).toMatchObject(HARD_DENIAL);
    });

    it('none mode blocks multiline input with PowerShell-specific reason', () => {
      const result = decide('Get-Process\nWrite-Host', 'none');
      expect(result).toMatchObject(HARD_DENIAL);
      expect(result.blockReason).toContain('PowerShell');
    });
  });
});

/**
 * Concurrent reset/init lifecycle: verify that resetParser during or after
 * initialization produces a consistent state, and that concurrent
 * initializeParser calls are de-duplicated.
 */
describe('parser reset/init lifecycle consistency', () => {
  describePwsh(
    'parser reset/init lifecycle consistency (unconditional wrapper)',
    () => {
      afterAll(() => restoreParsers('lifecycle tests'));

      it('concurrent initializeParser calls return the same promise', async () => {
        resetParser();
        const p1 = initializeParser();
        const p2 = initializeParser();
        expect(p1).toBe(p2);
        const result = await p1;
        expect(result).toBe(true);
        expect(isParserAvailable('powershell')).toBe(true);
      });

      it('resetParser after init clears both parsers', async () => {
        await initializeParser();
        expect(isParserAvailable('powershell')).toBe(true);
        expect(isParserAvailable('bash')).toBe(true);
        resetParser();
        expect(isParserAvailable('powershell')).toBe(false);
        expect(isParserAvailable('bash')).toBe(false);
      });

      it('re-initialize after reset restores parser availability', async () => {
        resetParser();
        expect(isParserAvailable('powershell')).toBe(false);
        const ok = await initializeParser();
        expect(ok).toBe(true);
        expect(isParserAvailable('powershell')).toBe(true);
        expect(isParserAvailable('bash')).toBe(true);
      });
    },
  );
});
