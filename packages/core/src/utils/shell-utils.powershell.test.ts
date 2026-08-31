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
  detectCommandSubstitution,
  shellTypeToParserLanguage,
} from './shell-utils.js';
import { initializeParser, isParserAvailable } from './shell-parser.js';
import { resolvePwshTestPolicyFromEnv } from '../test-utils/pwsh-test-policy.js';
import type { Config } from '../config/config.js';

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
let blocklistConfig: Config;

/** The permission block reason, or an empty string when nothing blocked. */
function blockReasonFor(result: { blockReason?: string }): string {
  return result.blockReason ?? '';
}

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

describe('PowerShell permission behavior', () => {
  describePwsh('shell-utils: PowerShell permission path', () => {
    beforeAll(() => {
      mockPlatform.mockReturnValue('linux');
    });

    beforeEach(() => {
      mockPlatform.mockReturnValue('linux');
      config = makeConfig();
      strictConfig = makeConfig({
        coreTools: ['ShellTool(git)'],
      });
      blocklistConfig = makeConfig({
        excludeTools: ['ShellTool(rm)'],
      });
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    describe('shellTypeToParserLanguage', () => {
      it('maps powershell to powershell', () => {
        expect(shellTypeToParserLanguage('powershell')).toBe('powershell');
      });

      it('maps bash to bash', () => {
        expect(shellTypeToParserLanguage('bash')).toBe('bash');
      });

      it('does NOT map cmd to powershell', () => {
        expect(shellTypeToParserLanguage('cmd')).not.toBe('powershell');
      });

      it('defaults undefined to bash', () => {
        expect(shellTypeToParserLanguage(undefined)).toBe('bash');
      });
    });

    describe('valid PowerShell is accepted in default-allow mode', () => {
      const validSamples: Array<[string, string]> = [
        ['if-exit chain', 'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'],
        ['assignment + cmdlet', '$result = Get-Content path/to/file'],
        ['ForEach-Object', 'ForEach-Object { Write-Host $_ }'],
        ['array pipeline', '@(1,2,3) | ForEach-Object { $_ * 2 }'],
        ['Where-Object', 'Get-Process | Where-Object { $_.Name -eq "x" }'],
        ['call operator', '& "C:\\tool.exe"'],
        ['property access', '$value.Name'],
        ['method call', '$value.Trim()'],
      ];

      for (const [label, cmd] of validSamples) {
        it(`allows ${label}`, () => {
          const { allowed } = isCommandAllowed(cmd, config, 'powershell');
          expect(allowed).toBe(true);
        });
      }

      it('allows static .NET method invocation in default-allow mode', () => {
        const { allowed } = isCommandAllowed(
          '[System.IO.File]::ReadAllText("test.txt")',
          config,
          'powershell',
        );
        expect(allowed).toBe(true);
      });

      it('allows static .NET Process::Start in default-allow mode', () => {
        const { allowed } = isCommandAllowed(
          '[System.Diagnostics.Process]::Start("notepad.exe")',
          config,
          'powershell',
        );
        expect(allowed).toBe(true);
      });

      it('allows dynamic call target in default-allow mode', () => {
        const { allowed } = isCommandAllowed(
          '& $command',
          config,
          'powershell',
        );
        expect(allowed).toBe(true);
      });
    });

    describe('malformed PowerShell fails closed', () => {
      it('rejects incomplete pipeline with PowerShell-specific diagnostic', () => {
        const { allowed, reason } = isCommandAllowed(
          'Get-ChildItem |',
          config,
          'powershell',
        );
        expect(allowed).toBe(false);
        expect(reason).toContain('tree-sitter-pwsh');
      });

      it('does not use the generic Bash parse-safely message', () => {
        const { allowed, reason } = isCommandAllowed(
          'if (',
          config,
          'powershell',
        );
        expect(allowed).toBe(false);
        expect(reason).not.toBe(
          'Command rejected because it could not be parsed safely',
        );
      });
    });

    describe('successful parse with zero command details', () => {
      it('does not produce a parser-unavailable diagnostic for a pure expression', () => {
        // A valid PowerShell expression that parses without errors but yields
        // zero command details must NOT fall through to the "structural parser
        // is unavailable" diagnostic. The parser was available and parsed
        // successfully; the command should be validated as-is.
        const result = checkCommandPermissions(
          '42',
          config,
          undefined,
          'powershell',
        );
        expect(blockReasonFor(result)).not.toContain('unavailable');
        expect(result.allAllowed).toBe(true);
      });
    });

    describe('strict allowlist: dynamic and expression targets fail closed', () => {
      it('fails closed for .NET Process::Start in strict allowlist', () => {
        const result = checkCommandPermissions(
          '[System.Diagnostics.Process]::Start("cmd.exe")',
          strictConfig,
          undefined,
          'powershell',
        );
        expect(result.allAllowed).toBe(false);
        expect(result.isHardDenial).toBe(true);
        expect(result.blockReason).not.toContain('syntax error');
      });

      it('fails closed for dynamic call target in strict allowlist', () => {
        const result = checkCommandPermissions(
          '& $command',
          strictConfig,
          undefined,
          'powershell',
        );
        expect(result.allAllowed).toBe(false);
        expect(result.isHardDenial).toBe(true);
      });

      it('still allows allowed commands in strict allowlist', () => {
        const result = checkCommandPermissions(
          'git status',
          strictConfig,
          undefined,
          'powershell',
        );
        expect(result.allAllowed).toBe(true);
      });
    });

    describe('blocklist still applies to PowerShell', () => {
      it('blocks a blocklisted command', () => {
        const { allowed } = isCommandAllowed(
          'rm -rf /tmp',
          blocklistConfig,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('blocks a blocklisted command nested in script block', () => {
        const { allowed } = isCommandAllowed(
          'ForEach-Object { rm -rf /tmp }',
          blocklistConfig,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      // Finding 3 (#3181): PowerShell is case-insensitive for command names.
      // A blocklist entry ShellTool(rm) must catch RM, Rm, or rm.
      it('blocks uppercase RM matching lowercase blocklist entry', () => {
        const { allowed } = isCommandAllowed(
          'RM -rf /tmp',
          blocklistConfig,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('blocks mixed-case blocklisted command in nested script block', () => {
        const { allowed } = isCommandAllowed(
          'ForEach-Object { Rm -rf /tmp }',
          blocklistConfig,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('blocklist matching does NOT lowercase Bash (case-sensitive)', () => {
        const bashBlocklist: Config = makeConfig({
          excludeTools: ['ShellTool(rm)'],
        });
        // Bash IS case-sensitive: RM != rm.
        const { allowed } = isCommandAllowed(
          'RM -rf /tmp',
          bashBlocklist,
          'bash',
        );
        expect(allowed).toBe(true);
      });
    });

    describe('case-insensitive PowerShell allowlist matching', () => {
      it('uppercase PowerShell command matches lowercase allowlist entry', () => {
        const psAllowlist: Config = makeConfig({
          coreTools: ['ShellTool(get-process)'],
        });
        const { allowed } = isCommandAllowed(
          'GET-PROCESS',
          psAllowlist,
          'powershell',
        );
        expect(allowed).toBe(true);
      });

      it('lowercase PowerShell command matches mixed-case allowlist entry', () => {
        const psAllowlist: Config = makeConfig({
          coreTools: ['ShellTool(Get-Process)'],
        });
        const { allowed } = isCommandAllowed(
          'get-process',
          psAllowlist,
          'powershell',
        );
        expect(allowed).toBe(true);
      });

      it('session allowlist matching is case-insensitive for PowerShell', () => {
        const sessionAllowlist = new Set(['Get-Process']);
        const result = checkCommandPermissions(
          'GET-PROCESS',
          makeConfig({ coreTools: [] }),
          sessionAllowlist,
          'powershell',
        );
        expect(result.allAllowed).toBe(true);
      });
    });

    describe('getCommandRoots with PowerShell', () => {
      it('extracts command roots for PowerShell pipeline', () => {
        const roots = getCommandRoots(
          'Get-Process | Where-Object { $_.Name -eq "x" }',
          'powershell',
        );
        expect(roots).toContain('Get-Process');
        expect(roots).toContain('Where-Object');
      });

      it('extracts literal call-operator root', () => {
        const roots = getCommandRoots(
          '& "C:\\tools\\my-tool.exe"',
          'powershell',
        );
        expect(roots).toContain('my-tool.exe');
      });

      it('does not fabricate roots for pure .NET expressions', () => {
        const roots = getCommandRoots(
          '[System.IO.File]::ReadAllText("x")',
          'powershell',
        );
        // A pure expression has no command root; it must not fabricate one
        // from the regex fallback when the parser is available.
        expect(roots).toStrictEqual([]);
      });
    });

    describe('detectCommandSubstitution with PowerShell', () => {
      it('detects $() as substitution', () => {
        expect(detectCommandSubstitution('$(Get-Date)', 'powershell')).toBe(
          true,
        );
      });

      it('does NOT treat backticks as substitution', () => {
        expect(
          detectCommandSubstitution('Write-Host `n "hi"', 'powershell'),
        ).toBe(false);
      });

      it('does NOT treat $variable as substitution', () => {
        expect(
          detectCommandSubstitution('Write-Host $HOME', 'powershell'),
        ).toBe(false);
      });

      it('fails closed when the PowerShell tree has a parse error', () => {
        // A malformed PowerShell command may have $() that the parser's error
        // recovery dropped or misclassified as a non-sub_expression node.
        // Return true (fail closed) rather than trusting AST detection on a
        // broken tree. Get-ChildItem | has no $() but produces hasError,
        // so detection must still return true.
        expect(detectCommandSubstitution('Get-ChildItem |', 'powershell')).toBe(
          true,
        );
      });

      it('still does NOT treat valid backtick usage as substitution with parse error absent', () => {
        // Confirms the fix does not widen to valid backtick commands.
        expect(
          detectCommandSubstitution('Write-Host `n "hello"', 'powershell'),
        ).toBe(false);
      });
    });

    describe('PowerShell parser available', () => {
      it('accepts valid multiline PowerShell', () => {
        const result = checkCommandPermissions(
          'Get-Process\nWrite-Host done',
          config,
          undefined,
          'powershell',
        );
        expect(result.allAllowed).toBe(true);
        expect(blockReasonFor(result)).not.toContain(
          'could not be parsed safely',
        );
      });
    });

    describe('Bash tests remain unaffected', () => {
      it('still allows basic bash commands', () => {
        const { allowed } = isCommandAllowed('ls -la /tmp', config, 'bash');
        expect(allowed).toBe(true);
      });

      it('still rejects malformed bash', () => {
        const { allowed } = isCommandAllowed('ls &&', config, 'bash');
        expect(allowed).toBe(false);
      });

      it('still detects bash backtick substitution', () => {
        expect(detectCommandSubstitution('echo `date`', 'bash')).toBe(true);
      });
    });

    describe('blocklist recursion across shell-replacement modes', () => {
      it('all mode catches blocklisted command nested in script block', () => {
        const allConfig = makeConfig({
          excludeTools: ['ShellTool(rm)'],
          shellReplacement: 'all',
        });
        const { allowed } = isCommandAllowed(
          'ForEach-Object { rm -rf /tmp }',
          allConfig,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('none mode catches blocklisted command nested in script block', () => {
        const noneConfig = makeConfig({
          excludeTools: ['ShellTool(rm)'],
          shellReplacement: 'none',
        });
        const { allowed } = isCommandAllowed(
          'ForEach-Object { rm -rf /tmp }',
          noneConfig,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('all mode does NOT disable excludeTools', () => {
        const allConfig = makeConfig({
          excludeTools: ['ShellTool(rm)'],
          shellReplacement: 'all',
        });
        const { allowed } = isCommandAllowed(
          'rm -rf /tmp',
          allConfig,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('all mode allows valid commands without blocklist hits', () => {
        const allConfig = makeConfig({
          shellReplacement: 'all',
        });
        const { allowed } = isCommandAllowed(
          'Get-Process | Select-Object Name',
          allConfig,
          'powershell',
        );
        expect(allowed).toBe(true);
      });

      it('none mode blocks $() substitution for PowerShell', () => {
        const noneConfig = makeConfig({
          shellReplacement: 'none',
        });
        const { allowed } = isCommandAllowed(
          '$(Get-Date)',
          noneConfig,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('none mode does NOT block PowerShell backtick line continuation', () => {
        const noneConfig = makeConfig({
          shellReplacement: 'none',
        });
        const { allowed } = isCommandAllowed(
          'Write-Host `n "hello"',
          noneConfig,
          'powershell',
        );
        expect(allowed).toBe(true);
      });
    });

    // Finding 6 (#3181): PowerShell construct-specific substitution and
    // blocklist behavior across none/allowlist/all modes.
    describe('PowerShell construct substitution and blocklist semantics', () => {
      const blocklistConfig6 = makeConfig({
        excludeTools: ['ShellTool(rm)'],
      });

      it('@() array expression is NOT substitution in none mode', () => {
        const noneConfig = makeConfig({ shellReplacement: 'none' });
        const { allowed } = isCommandAllowed(
          '@(1, 2, 3) | ForEach-Object { Write-Host $_ }',
          noneConfig,
          'powershell',
        );
        expect(allowed).toBe(true);
      });

      it('$() subexpression inside none mode is blocked', () => {
        const noneConfig = makeConfig({ shellReplacement: 'none' });
        const { allowed } = isCommandAllowed(
          'Write-Host $(Get-Date)',
          noneConfig,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('backtick line continuation is NOT substitution in none mode', () => {
        const noneConfig = makeConfig({ shellReplacement: 'none' });
        const cmd =
          'Get-Process `' + String.fromCharCode(10) + '  | Select-Object Name';
        const { allowed } = isCommandAllowed(cmd, noneConfig, 'powershell');
        expect(allowed).toBe(true);
      });

      it('& {} script block: nested blocklisted command caught in allowlist mode', () => {
        const { allowed } = isCommandAllowed(
          '& { rm -rf /tmp }',
          blocklistConfig6,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('& {} script block: nested blocklisted command caught in none mode', () => {
        const noneConfig = makeConfig({
          excludeTools: ['ShellTool(rm)'],
          shellReplacement: 'none',
        });
        const { allowed } = isCommandAllowed(
          '& { rm -rf /tmp }',
          noneConfig,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('& {} script block: nested blocklisted command caught in all mode', () => {
        const allConfig = makeConfig({
          excludeTools: ['ShellTool(rm)'],
          shellReplacement: 'all',
        });
        const { allowed } = isCommandAllowed(
          '& { rm -rf /tmp }',
          allConfig,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('dynamic & call target fails closed in strict allowlist', () => {
        const result = checkCommandPermissions(
          '& $cmd',
          strictConfig,
          undefined,
          'powershell',
        );
        expect(result.allAllowed).toBe(false);
        expect(result.isHardDenial).toBe(true);
      });

      it('dot-source literal extracts script name for blocklist matching', () => {
        const dotBlocklist = makeConfig({
          excludeTools: ['ShellTool(evil.ps1)'],
        });
        const { allowed } = isCommandAllowed(
          '. .\\evil.ps1',
          dotBlocklist,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('all mode allows $() subexpression (substitution restriction relaxed)', () => {
        const allConfig = makeConfig({ shellReplacement: 'all' });
        const { allowed } = isCommandAllowed(
          '$(Get-Date)',
          allConfig,
          'powershell',
        );
        expect(allowed).toBe(true);
      });

      it('all mode still blocks blocklisted command nested in $()', () => {
        const allConfig = makeConfig({
          excludeTools: ['ShellTool(rm)'],
          shellReplacement: 'all',
        });
        const { allowed } = isCommandAllowed(
          '$(rm -rf /tmp)',
          allConfig,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('allowlist mode blocks blocklisted command nested in pipeline', () => {
        const { allowed } = isCommandAllowed(
          'Get-Process | rm',
          blocklistConfig6,
          'powershell',
        );
        expect(allowed).toBe(false);
      });

      it('none mode blocks $() nested in ForEach-Object script block', () => {
        const noneConfig = makeConfig({ shellReplacement: 'none' });
        const { allowed } = isCommandAllowed(
          'ForEach-Object { Write-Host $(Get-Date) }',
          noneConfig,
          'powershell',
        );
        expect(allowed).toBe(false);
      });
    });
    describe('session allowlist hard-denies expression/dynamic targets (#3181 Finding 2)', () => {
      const sessionAllowlist = new Set(['git']);

      it('hard-denies static Process::Start under session allowlist', () => {
        const result = checkCommandPermissions(
          '[System.Diagnostics.Process]::Start("cmd.exe")',
          makeConfig({ coreTools: [] }),
          sessionAllowlist,
          'powershell',
        );
        expect(result.allAllowed).toBe(false);
        expect(result.isHardDenial).toBe(true);
        expect(result.blockReason).toContain('dynamic or expression');
      });

      it('hard-denies instance method call under session allowlist', () => {
        const result = checkCommandPermissions(
          '$obj.Start("cmd.exe")',
          makeConfig({ coreTools: [] }),
          sessionAllowlist,
          'powershell',
        );
        expect(result.allAllowed).toBe(false);
        expect(result.isHardDenial).toBe(true);
      });

      it('hard-denies dynamic call target under session allowlist', () => {
        const result = checkCommandPermissions(
          '& $cmd',
          makeConfig({ coreTools: [] }),
          sessionAllowlist,
          'powershell',
        );
        expect(result.allAllowed).toBe(false);
        expect(result.isHardDenial).toBe(true);
      });

      it('hard-denies nested .NET invocation in arguments under session allowlist', () => {
        const result = checkCommandPermissions(
          'Write-Host ([System.Diagnostics.Process]::Start("cmd.exe"))',
          makeConfig({ coreTools: [] }),
          sessionAllowlist,
          'powershell',
        );
        expect(result.allAllowed).toBe(false);
        expect(result.isHardDenial).toBe(true);
      });

      it('allows allowed command under session allowlist', () => {
        const result = checkCommandPermissions(
          'git status',
          makeConfig({ coreTools: [] }),
          sessionAllowlist,
          'powershell',
        );
        expect(result.allAllowed).toBe(true);
      });
    });

    describe('no duplicate or fabricated roots (#3181 Finding 2)', () => {
      it('pipeline produces distinct roots with no duplicates', () => {
        const roots = getCommandRoots(
          'Get-Process | Where-Object { $_.Name -eq "x" }',
          'powershell',
        );
        expect(new Set(roots).size).toBe(roots.length);
      });

      it('wrapper payload does not duplicate the wrapper root', () => {
        const roots = getCommandRoots(
          'Invoke-Expression "Get-Process"',
          'powershell',
        );
        expect(new Set(roots).size).toBe(roots.length);
      });

      it('subexpression does not fabricate a root from $()', () => {
        const roots = getCommandRoots('$(Get-ChildItem)', 'powershell');
        expect(roots.every((r) => r !== '$')).toBe(true);
        expect(roots.every((r) => r !== '')).toBe(true);
      });

      it('expression detail does not produce an empty-name static root in allowlist matching', () => {
        // A .NET expression should fail closed in strict allowlist, not pass
        // by matching an empty root.
        const result = checkCommandPermissions(
          '[System.Diagnostics.Process]::Start("cmd.exe")',
          strictConfig,
          undefined,
          'powershell',
        );
        expect(result.allAllowed).toBe(false);
        expect(result.isHardDenial).toBe(true);
      });
    });
  });
});
