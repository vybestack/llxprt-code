/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { ShellPermissionConfig } from './shell-utils.js';

vi.mock('./shell-parser.js', () => ({
  isParserAvailable: () => false,
  parseShellCommand: () => null,
  extractCommandNames: () => [],
  hasCommandSubstitution: () => false,
  splitCommandsWithTree: () => [],
  parseCommandDetails: () => null,
  hasPromptCommandTransform: () => false,
}));

const { checkCommandPermissions } = await import('./shell-utils.js');

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
  const result = checkCommandPermissions(
    command,
    createConfig(mode, coreTools),
  );
  return {
    allAllowed: result.allAllowed,
    isHardDenial: result.isHardDenial === true,
  };
}

const HARD_DENIAL = { allAllowed: false, isHardDenial: true };

describe('permissions without the shell parser', () => {
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
