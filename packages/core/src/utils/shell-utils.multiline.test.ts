/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  checkCommandPermissions,
  detectCommandSubstitution,
  type ShellPermissionConfig,
} from './shell-utils.js';
import {
  initializeParser,
  isParserAvailable,
  parseCommandDetails,
} from './shell-parser.js';

await initializeParser();

const UNQUOTED_BACKTICK_HEREDOC =
  'cat <<EOF\nInside heredoc `unterminated\nEOF';
const QUOTED_BACKTICK_HEREDOC = "cat <<'EOF'\n`not_executed`\nEOF";
const UNQUOTED_DOLLAR_HEREDOC = 'cat <<EOF\n$(date)\nEOF';
const QUOTED_DOLLAR_HEREDOC = "cat <<'EOF'\n$(date)\nEOF";
const UNQUOTED_PAIRED_BACKTICK_HEREDOC = 'cat <<EOF\n`date`\nEOF';
const UNQUOTED_ESCAPED_BACKTICK_HEREDOC = 'cat <<EOF\n\\`date\\`\nEOF';

const QUOTED_DELIMITER_HEREDOCS = [
  QUOTED_DOLLAR_HEREDOC,
  'cat <<"EOF"\n$(date)\nEOF',
  'cat <<\\EOF\n$(date)\nEOF',
] as const;

const MALFORMED_SUBSTITUTIONS = [
  'echo safe\necho `date',
  'ls -la\n`evil_cmd',
  '(echo `subshell_cmd',
  'if true; then `bad_cmd; fi',
  'echo `; rm -rf /',
  'cat <(echo `unterminated',
  'echo $(echo `inner',
] as const;

function createConfig(
  mode: 'none' | 'allowlist',
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
  mode: 'none' | 'allowlist',
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

describe.skipIf(!isParserAvailable())(
  'multiline command substitution detection',
  () => {
    it.each([
      UNQUOTED_BACKTICK_HEREDOC,
      UNQUOTED_DOLLAR_HEREDOC,
      ...MALFORMED_SUBSTITUTIONS,
    ])('detects executable substitution syntax in %j', (command) => {
      expect(detectCommandSubstitution(command)).toBe(true);
    });

    it.each([QUOTED_BACKTICK_HEREDOC, ...QUOTED_DELIMITER_HEREDOCS])(
      'treats quoted heredoc contents as literal in %j',
      (command) => {
        expect(detectCommandSubstitution(command)).toBe(false);
      },
    );

    it('detects paired backticks in an unquoted heredoc body', () => {
      expect(detectCommandSubstitution(UNQUOTED_PAIRED_BACKTICK_HEREDOC)).toBe(
        true,
      );
    });

    it('treats escaped backticks in an unquoted heredoc body as literal', () => {
      expect(detectCommandSubstitution(UNQUOTED_ESCAPED_BACKTICK_HEREDOC)).toBe(
        false,
      );
    });
  },
);

describe.skipIf(!isParserAvailable())('heredoc command parsing', () => {
  it.each(MALFORMED_SUBSTITUTIONS)(
    'reports a parse error for malformed substitution %j',
    (command) => {
      const result = parseCommandDetails(command);
      expect(result).not.toBeNull();
      expect(result?.hasError).toBe(true);
    },
  );

  it.each([QUOTED_BACKTICK_HEREDOC, ...QUOTED_DELIMITER_HEREDOCS])(
    'extracts only cat from quoted heredoc %j',
    (command) => {
      expect(parseCommandDetails(command)).toStrictEqual({
        details: [{ name: 'cat', text: 'cat' }],
        hasError: false,
      });
    },
  );

  it('rejects an unrepresented backtick substitution in an unquoted heredoc', () => {
    expect(parseCommandDetails(UNQUOTED_BACKTICK_HEREDOC)).toStrictEqual({
      details: [{ name: 'cat', text: 'cat' }],
      hasError: true,
    });
  });

  it('extracts a represented nested command from an unquoted heredoc', () => {
    expect(parseCommandDetails(UNQUOTED_DOLLAR_HEREDOC)).toStrictEqual({
      details: [
        { name: 'cat', text: 'cat' },
        { name: 'date', text: 'date' },
      ],
      hasError: false,
    });
  });
});

describe.skipIf(!isParserAvailable())(
  'multiline shell replacement permissions',
  () => {
    it.each([UNQUOTED_BACKTICK_HEREDOC, ...MALFORMED_SUBSTITUTIONS])(
      'hard-denies executable substitution syntax in none mode for %j',
      (command) => {
        expect(
          permissionDecision(command, 'none', [
            'run_shell_command(cat)',
            'run_shell_command(echo)',
            'run_shell_command(ls)',
          ]),
        ).toStrictEqual(HARD_DENIAL);
      },
    );

    it.each([QUOTED_BACKTICK_HEREDOC, QUOTED_DOLLAR_HEREDOC])(
      'allows literal quoted heredoc contents in none mode for %j',
      (command) => {
        expect(
          permissionDecision(command, 'none', ['run_shell_command(cat)']),
        ).toStrictEqual({ allAllowed: true, isHardDenial: false });
      },
    );

    it.each([UNQUOTED_BACKTICK_HEREDOC, ...MALFORMED_SUBSTITUTIONS])(
      'hard-denies unsafe parsing in allowlist mode for %j',
      (command) => {
        expect(
          permissionDecision(command, 'allowlist', [
            'run_shell_command(cat)',
            'run_shell_command(echo)',
            'run_shell_command(ls)',
          ]),
        ).toStrictEqual(HARD_DENIAL);
      },
    );

    it.each([QUOTED_BACKTICK_HEREDOC, QUOTED_DOLLAR_HEREDOC])(
      'allows literal quoted heredoc contents when cat is allowlisted for %j',
      (command) => {
        expect(
          permissionDecision(command, 'allowlist', ['run_shell_command(cat)']),
        ).toStrictEqual({ allAllowed: true, isHardDenial: false });
      },
    );

    it('requires represented nested heredoc commands to be allowlisted', () => {
      expect(
        permissionDecision(UNQUOTED_DOLLAR_HEREDOC, 'allowlist', [
          'run_shell_command(cat)',
        ]),
      ).toStrictEqual({ allAllowed: false, isHardDenial: false });
    });

    it('allows represented nested heredoc commands when each is allowlisted', () => {
      expect(
        permissionDecision(UNQUOTED_DOLLAR_HEREDOC, 'allowlist', [
          'run_shell_command(cat)',
          'run_shell_command(date)',
        ]),
      ).toStrictEqual({ allAllowed: true, isHardDenial: false });
    });
  },
);
