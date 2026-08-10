/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  expect,
  describe,
  it,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from 'bun:test';
import {
  checkCommandPermissions,
  getCommandRoots,
  isCommandAllowed,
} from './shell-utils.js';
import { initializeParser, isParserAvailable } from './shell-parser.js';
import type { Config } from '../config/config.js';

await initializeParser();
const pwshAvailable = isParserAvailable('powershell');
if (!pwshAvailable) {
  throw new Error('PowerShell grammar failed to load under Bun');
}

const mockPlatform = vi.fn();
void vi.mock('os', () => ({
  default: {
    platform: mockPlatform,
    homedir: vi.fn(),
  },
  platform: mockPlatform,
  homedir: vi.fn(),
}));

let config: Config;
let strictConfig: Config;

function makeConfig(
  overrides: Partial<{
    coreTools: string[];
    excludeTools: string[];
    shellReplacement: string;
  }> = {},
): Config {
  return {
    getCoreTools: () => overrides.coreTools ?? [],
    getExcludeTools: () => overrides.excludeTools ?? [],
    getAllowedTools: () => [],
    getShellReplacement: () =>
      (overrides.shellReplacement ?? 'allowlist') as never,
    getEphemeralSetting: () => undefined,
  } as unknown as Config;
}

describe.skipIf(!pwshAvailable)(
  'shell-utils: PowerShell wrapper/evaluator bypass prevention',
  () => {
    beforeAll(() => {
      mockPlatform.mockReturnValue('linux');
    });

    beforeEach(() => {
      mockPlatform.mockReturnValue('linux');
      config = makeConfig();
      strictConfig = makeConfig({
        coreTools: ['ShellTool(git)'],
      });
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    describe('wrapper/evaluator bypass prevention', () => {
      /**
       * Finding 4 (#3181): A specific blocklist or strict allowlist must not
       * be bypassed by an allowed outer launcher. Literal payloads must be
       * recursively parsed; dynamic payloads fail closed.
       */
      const wrapperBlocklist: Config = makeConfig({
        excludeTools: ['ShellTool(rm)'],
      });

      it('blocks blocklisted command inside Invoke-Expression literal payload', () => {
        const { allowed } = isCommandAllowed(
          'Invoke-Expression "rm -rf /tmp"',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('blocks blocklisted command inside iex alias literal payload', () => {
        const { allowed } = isCommandAllowed(
          'iex "rm -rf /tmp"',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('blocks blocklisted command inside bash -c literal payload', () => {
        const { allowed } = isCommandAllowed(
          'bash -c "rm -rf /tmp"',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('blocks blocklisted command inside powershell -Command literal payload', () => {
        const { allowed } = isCommandAllowed(
          'powershell -Command "rm -rf /tmp"',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('fails closed for dynamic Invoke-Expression payload in strict allowlist', () => {
        const result = checkCommandPermissions(
          'Invoke-Expression $cmd',
          strictConfig,
          undefined,
          'powershell',
        );
        expect(result.allAllowed).toBe(false);
        expect(result.isHardDenial).toBe(true);
      });

      // --- OCR remediation: expandable-string payloads with interpolation ---
      // An expandable double-quoted string ("$cmd") has a variable child and
      // must be treated as dynamic — it cannot be statically resolved.
      it('fails closed for expandable-string Invoke-Expression payload in strict allowlist', () => {
        const result = checkCommandPermissions(
          'Invoke-Expression "$cmd"',
          strictConfig,
          undefined,
          'powershell',
        );
        expect(result.allAllowed).toBe(false);
        expect(result.isHardDenial).toBe(true);
      });

      it('fails closed for expandable-string powershell -Command payload in strict allowlist', () => {
        const result = checkCommandPermissions(
          'powershell -Command "$payload"',
          strictConfig,
          undefined,
          'powershell',
        );
        expect(result.allAllowed).toBe(false);
        expect(result.isHardDenial).toBe(true);
      });

      it('fails closed for cmd /c literal payload in strict allowlist (unresolved)', () => {
        const result = checkCommandPermissions(
          'cmd /c "rm -rf /tmp"',
          strictConfig,
          undefined,
          'powershell',
        );
        expect(result.allAllowed).toBe(false);
        expect(result.isHardDenial).toBe(true);
      });

      it('default-allow: Invoke-Expression with valid-looking literal still allowed', () => {
        const { allowed } = isCommandAllowed(
          'Invoke-Expression "Get-Process"',
          config,
          'powershell',
        );
        expect(allowed).toBe(true);
      });

      // --- Finding 4: pwsh/sh wrapper coverage ---
      it('blocks blocklisted command inside pwsh -Command literal payload', () => {
        const { allowed } = isCommandAllowed(
          'pwsh -Command "rm -rf /tmp"',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it.each([
        'powershell -ExecutionPolicy "Bypass" -Command "rm -rf /tmp"',
        'pwsh -WorkingDirectory "C:\\Temp" -Command "rm -rf /tmp"',
        '& powershell -ExecutionPolicy "Bypass" -Command "rm -rf /tmp"',
        'bash --init-file "harmless" -c "rm -rf /tmp"',
      ])(
        'uses the command-flag payload when earlier options are quoted: %s',
        (command) => {
          const { allowed } = isCommandAllowed(
            command,
            wrapperBlocklist,
            'powershell',
          );
          expect(allowed).toBe(false);
        },
      );

      it.each([
        '& powershell -Command "rm -rf /tmp"',
        '& iex "rm -rf /tmp"',
        '& "cmd.exe" /c "rm -rf /tmp"',
        '& bash -c "rm -rf /tmp"',
      ])('blocks call-operator wrapper payload: %s', (command) => {
        const { allowed } = isCommandAllowed(
          command,
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('blocks blocklisted command in a literal here-string evaluator payload', () => {
        const { allowed } = isCommandAllowed(
          "iex @'\nrm -rf /tmp\n'@",
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('blocks blocklisted command in an expandable here-string wrapper payload', () => {
        const { allowed } = isCommandAllowed(
          'powershell -Command @"\nrm -rf /tmp\n"@',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('blocks a bare blocklisted command after pwsh -Command', () => {
        const { allowed } = isCommandAllowed(
          'pwsh -Command rm -rf /tmp',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('blocks blocklisted command inside sh -c literal payload', () => {
        const { allowed } = isCommandAllowed(
          'sh -c "rm -rf /tmp"',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      // --- OCR remediation: .exe executable variants of shell wrappers ---
      // Windows frequently invokes powershell.exe / pwsh.exe / bash.exe /
      // sh.exe.  These variants must be recognized as wrappers so a
      // blocklisted payload nested behind one cannot bypass validation.
      it('blocks blocklisted command inside powershell.exe -Command literal payload', () => {
        const { allowed } = isCommandAllowed(
          'powershell.exe -Command "rm -rf /tmp"',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('blocks blocklisted command inside pwsh.exe -Command literal payload', () => {
        const { allowed } = isCommandAllowed(
          'pwsh.exe -Command "rm -rf /tmp"',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('blocks blocklisted command inside bash.exe -c literal payload', () => {
        const { allowed } = isCommandAllowed(
          'bash.exe -c "rm -rf /tmp"',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('blocks blocklisted command inside sh.exe -c literal payload', () => {
        const { allowed } = isCommandAllowed(
          'sh.exe -c "rm -rf /tmp"',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      // Call-operator literal variants of the .exe wrappers.
      it.each([
        "& 'powershell.exe' -Command 'rm -rf /tmp'",
        "& 'pwsh.exe' -Command 'rm -rf /tmp'",
        "& 'bash.exe' -c 'rm -rf /tmp'",
        "& 'sh.exe' -c 'rm -rf /tmp'",
      ])('blocks call-operator .exe wrapper payload: %s', (command) => {
        const { allowed } = isCommandAllowed(
          command,
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('blocks blocklisted command inside cmd.exe /c literal payload (expression)', () => {
        // cmd.exe /c has no matching grammar; the literal payload is classified
        // as an unresolved expression and fails closed in strict allowlist.
        // In blocklist mode, the unresolved expression detail contains the
        // payload text; blocklist matching checks the full command text.
        const { allowed } = isCommandAllowed(
          'cmd.exe /c "rm -rf /tmp"',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      // --- Finding 4: Start-Process / saps launcher coverage ---
      it('blocks blocklisted target inside Start-Process literal string target', () => {
        const { allowed } = isCommandAllowed(
          'Start-Process "rm"',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('blocks blocklisted target inside Start-Process bare token target', () => {
        const { allowed } = isCommandAllowed(
          'Start-Process rm',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('blocks blocklisted target inside saps alias literal string target', () => {
        const { allowed } = isCommandAllowed(
          'saps "rm"',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('blocks blocklisted target inside start alias literal string target', () => {
        const { allowed } = isCommandAllowed(
          'start "rm"',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('Start-Process -FilePath literal target extracted for blocklist', () => {
        const { allowed } = isCommandAllowed(
          'Start-Process -FilePath "rm"',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      // --- OCR remediation: single-quoted Start-Process target variants ---
      it('blocks blocklisted target in single-quoted Start-Process positional target', () => {
        const { allowed } = isCommandAllowed(
          "Start-Process 'rm'",
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('blocks blocklisted target in single-quoted Start-Process -FilePath target', () => {
        const { allowed } = isCommandAllowed(
          "Start-Process -FilePath 'rm'",
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('extracts single-quoted Start-Process target root', () => {
        expect(
          getCommandRoots("Start-Process 'notepad.exe'", 'powershell'),
        ).toContain('notepad.exe');
      });

      it('ignores preceding named arguments when locating the Start-Process target', () => {
        const { allowed } = isCommandAllowed(
          'Start-Process -ArgumentList "harmless" "rm"',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('resolves an abbreviated Start-Process -FilePath parameter', () => {
        const { allowed } = isCommandAllowed(
          'Start-Process -Fi "rm" -Wait',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('does not consume the positional target after a switch parameter', () => {
        const { allowed } = isCommandAllowed(
          'Start-Process -Confirm "rm"',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('does not consume the positional target after a common switch parameter', () => {
        const command = 'Start-Process -Verbose "rm"';
        expect(getCommandRoots(command, 'powershell')).toContain('rm');
        const { allowed } = isCommandAllowed(
          command,
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('conservatively consumes the value of an unknown named parameter', () => {
        const { allowed } = isCommandAllowed(
          'Start-Process -Unknown "harmless" "rm"',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('fails closed for dynamic Start-Process target in strict allowlist', () => {
        const result = checkCommandPermissions(
          'Start-Process $cmd',
          strictConfig,
          undefined,
          'powershell',
        );
        expect(result.allAllowed).toBe(false);
        expect(result.isHardDenial).toBe(true);
      });

      it('default-allow: Start-Process with valid target still allowed', () => {
        const { allowed } = isCommandAllowed(
          'Start-Process notepad.exe',
          config,
          'powershell',
        );
        expect(allowed).toBe(true);
      });

      // --- Finding 4: nested blocklist across wrappers ---
      it('blocks doubly nested blocklisted command via pwsh -Command iex', () => {
        const { allowed } = isCommandAllowed(
          'pwsh -Command \'iex "rm -rf /tmp"\'',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('does not truncate blocklist validation for deeply nested literal evaluators', () => {
        let command = 'rm -rf /tmp';
        // Exceeds the rejected fixed depth of 16; strict payload shrinkage,
        // rather than a shallow budget, guarantees recursion terminates.
        for (let nesting = 0; nesting < 17; nesting += 1) {
          command = `iex '${command.replace(/'/g, "''")}'`;
        }

        const { allowed } = isCommandAllowed(
          command,
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      // --- OCR remediation: doubled-double-quote decoding in wrapper payloads ---
      // PowerShell escapes a literal " inside a double-quoted string by doubling
      // it: "a""b" decodes to a"b.  If decoding does not collapse "" -> " the
      // nested payload is mis-parsed and a blocklisted command hidden behind
      // the doubled quotes can escape detection.
      it('finds blocklisted command behind doubled-double-quote in evaluator payload', () => {
        // iex "& ""rm"" -rf /tmp"  decodes to: & "rm" -rf /tmp
        const { allowed } = isCommandAllowed(
          'iex "& ""rm"" -rf /tmp"',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('finds blocklisted command behind doubled-double-quote in pwsh -Command payload', () => {
        // powershell -Command "rm ""-rf"" /tmp" decodes to: rm "-rf" /tmp
        const { allowed } = isCommandAllowed(
          'powershell -Command "rm ""-rf"" /tmp"',
          wrapperBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });
    });
  },
);
