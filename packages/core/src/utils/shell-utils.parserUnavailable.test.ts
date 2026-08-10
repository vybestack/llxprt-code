/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import type { ShellPermissionConfig } from './shell-utils.js';

/**
 * Tests for permission decisions when the structural shell parser is
 * unavailable, exercising the regex/split fallback path.
 *
 * resetParser/initializeParser are used instead of vi.mock to avoid
 * cross-file mock leakage in bun:test (#3181).
 */

import { checkCommandPermissions } from './shell-utils.js';
import { resetParser, initializeParser } from './shell-parser.js';

function createConfig(
  mode: 'none' | 'allowlist' | 'all',
  coreTools: string[],
): ShellPermissionConfig {
  return {
    getEphemeralSetting: () => mode,
    getShellReplacement: () => mode,
    getExcludeTools: () => [],
    getCoreTools: () => coreTools,
  };
}

function permissionDecision(
  command: string,
  mode: 'none' | 'allowlist' | 'all',
  coreTools: string[],
): { allAllowed: boolean; isHardDenial: boolean } {
  // Pass 'bash' explicitly: these tests exercise Bash fallback behavior (#3181).
  const result = checkCommandPermissions(
    command,
    createConfig(mode, coreTools),
    undefined,
    'bash',
  );
  return {
    allAllowed: result.allAllowed,
    isHardDenial: result.isHardDenial === true,
  };
}

const HARD_DENIAL = { allAllowed: false, isHardDenial: true };

describe('permissions without the shell parser', () => {
  beforeAll(() => {
    resetParser();
  });

  afterAll(async () => {
    await initializeParser();
  });

  it.each(['none', 'allowlist'] as const)(
    'hard-denies LF multiline input in %s mode',
    (mode) => {
      expect(
        permissionDecision('echo safe\necho more', mode, [
          'run_shell_command(echo)',
        ]),
      ).toStrictEqual(HARD_DENIAL);
    },
  );

  it.each(['none', 'allowlist'] as const)(
    'hard-denies CRLF multiline input in %s mode',
    (mode) => {
      expect(
        permissionDecision('echo safe\r\necho more', mode, [
          'run_shell_command(echo)',
        ]),
      ).toStrictEqual(HARD_DENIAL);
    },
  );

  it.each(['none', 'allowlist'] as const)(
    'hard-denies one-line heredoc syntax in %s mode',
    (mode) => {
      expect(
        permissionDecision('cat <<EOF', mode, ['run_shell_command(cat)']),
      ).toStrictEqual(HARD_DENIAL);
    },
  );

  it.each(['none', 'allowlist'] as const)(
    'hard-denies a fully quoted multiline heredoc in %s mode',
    (mode) => {
      expect(
        permissionDecision("cat <<'EOF'\ntext\nEOF", mode, [
          'run_shell_command(cat)',
        ]),
      ).toStrictEqual(HARD_DENIAL);
    },
  );

  it.each(['none', 'allowlist', 'all'] as const)(
    'treats a here-string <<< as ordinary fallback in %s mode',
    (mode) => {
      expect(
        permissionDecision('cat <<<value', mode, ['run_shell_command(cat)']),
      ).toStrictEqual({ allAllowed: true, isHardDenial: false });
    },
  );

  it.each(['none', 'allowlist'] as const)(
    'does not mistake quoted heredoc-like text for syntax in %s mode',
    (mode) => {
      expect(
        permissionDecision("echo '<<EOF'", mode, ['run_shell_command(echo)']),
      ).toStrictEqual({ allAllowed: true, isHardDenial: false });
    },
  );

  it.each(['none', 'allowlist'] as const)(
    'retains ordinary one-line fallback in %s mode',
    (mode) => {
      expect(
        permissionDecision('ls -la /tmp', mode, ['run_shell_command(ls)']),
      ).toStrictEqual({ allAllowed: true, isHardDenial: false });
    },
  );

  it('retains one-line substitution denial in none mode', () => {
    expect(
      permissionDecision('echo $(date)', 'none', ['run_shell_command(echo)']),
    ).toStrictEqual(HARD_DENIAL);
  });

  it.each(['echo safe\necho more', 'cat <<EOF'])(
    'does not change all mode for %j',
    (command) => {
      expect(
        permissionDecision(command, 'all', ['run_shell_command']),
      ).toStrictEqual({ allAllowed: true, isHardDenial: false });
    },
  );
});
