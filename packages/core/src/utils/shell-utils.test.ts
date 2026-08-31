/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  expect,
  describe,
  it,
  beforeEach,
  beforeAll,
  vi,
  afterEach,
} from 'bun:test';
import {
  checkCommandPermissions,
  getCommandRoots,
  isCommandAllowed,
  stripShellWrapper,
} from './shell-utils.js';
import { isShellInvocationAllowlisted } from './tool-utils.js';
import {
  initializeParser as initializeShellParsers,
  isParserAvailable,
} from './shell-parser.js';
import type { Config } from '../config/config.js';
import type { AnyToolInvocation } from '../index.js';

const bunIt = it;

const mockPlatform = vi.fn();
const mockHomedir = vi.fn();
void vi.mock('os', () => ({
  default: {
    platform: mockPlatform,
    homedir: mockHomedir,
  },
  platform: mockPlatform,
  homedir: mockHomedir,
}));

const mockQuote = vi.fn();
void vi.mock('shell-quote', () => ({
  quote: mockQuote,
}));

let config: Config;
const parserInitialized = await initializeShellParsers();
const pwshAvailable = parserInitialized && isParserAvailable('powershell');
const describePwsh = describe.skipIf(!pwshAvailable);

describe('shell-utils', () => {
  beforeAll(async () => {
    mockPlatform.mockReturnValue('linux');
    await initializeShellParsers();
  });

  beforeEach(() => {
    mockPlatform.mockReturnValue('linux');
    mockQuote.mockImplementation((args: string[]) =>
      args.map((arg) => `'${arg}'`).join(' '),
    );
    config = {
      getCoreTools: () => [],
      getExcludeTools: () => [],
      getAllowedTools: () => [],
      getShellReplacement: () => 'allowlist',
      getEphemeralSetting: () => undefined,
    } as unknown as Config;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // All tests in this file exercise Bash syntax. These wrappers pass 'bash'
  // explicitly to avoid platform-dependent parser selection (#3181).
  function bashAllowed(cmd: string): { allowed: boolean; reason?: string } {
    return isCommandAllowed(cmd, config, 'bash');
  }
  function bashCheck(
    cmd: string,
    allowlist?: Set<string>,
  ): ReturnType<typeof checkCommandPermissions> {
    return checkCommandPermissions(cmd, config, allowlist, 'bash');
  }

  describe('isCommandAllowed', () => {
    it('should allow a command if no restrictions are provided', () => {
      const result = bashAllowed('goodCommand --safe');
      expect(result.allowed).toBe(true);
    });

    it('should allow a command if it is in the global allowlist', () => {
      config.getCoreTools = () => ['ShellTool(goodCommand)'];
      const result = bashAllowed('goodCommand --safe');
      expect(result.allowed).toBe(true);
    });

    it('should block a command if it is not in a strict global allowlist', () => {
      config.getCoreTools = () => ['ShellTool(goodCommand --safe)'];
      const result = bashAllowed('badCommand --danger');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(
        `Command(s) not in the allowed commands list. Disallowed commands: "badCommand --danger"`,
      );
    });

    it('should block a command if it is in the blocked list', () => {
      config.getExcludeTools = () => ['ShellTool(badCommand --danger)'];
      const result = bashAllowed('badCommand --danger');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(
        `Command 'badCommand --danger' is blocked by configuration`,
      );
    });

    it('should prioritize the blocklist over the allowlist', () => {
      config.getCoreTools = () => ['ShellTool(badCommand --danger)'];
      config.getExcludeTools = () => ['ShellTool(badCommand --danger)'];
      const result = bashAllowed('badCommand --danger');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(
        `Command 'badCommand --danger' is blocked by configuration`,
      );
    });

    it('should allow any command when a wildcard is in coreTools', () => {
      config.getCoreTools = () => ['ShellTool'];
      const result = bashAllowed('any random command');
      expect(result.allowed).toBe(true);
    });

    it('should block any command when a wildcard is in excludeTools', () => {
      config.getExcludeTools = () => ['run_shell_command'];
      const result = bashAllowed('any random command');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(
        'Shell tool is globally disabled in configuration',
      );
    });

    it('should block a command on the blocklist even with a wildcard allow', () => {
      config.getCoreTools = () => ['ShellTool'];
      config.getExcludeTools = () => ['ShellTool(badCommand --danger)'];
      const result = bashAllowed('badCommand --danger');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(
        `Command 'badCommand --danger' is blocked by configuration`,
      );
    });

    it('should allow a chained command if all parts are on the global allowlist', () => {
      config.getCoreTools = () => [
        'run_shell_command(echo)',
        'run_shell_command(goodCommand)',
      ];
      const result = bashAllowed('echo "hello" && goodCommand --safe');
      expect(result.allowed).toBe(true);
    });

    it('should block a chained command if any part is blocked', () => {
      config.getExcludeTools = () => ['run_shell_command(badCommand)'];
      const result = bashAllowed('echo "hello" && badCommand --danger');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(
        `Command 'badCommand --danger' is blocked by configuration`,
      );
    });

    {
      const it = !parserInitialized ? bunIt.skip : bunIt;
      it('should block a command that redefines an allowed function to run an unlisted command', () => {
        config.getCoreTools = () => ['run_shell_command(echo)'];
        const result = bashAllowed(
          'echo () (curl google.com) ; echo Hello Wolrd',
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe(
          `Command(s) not in the allowed commands list. Disallowed commands: "curl google.com"`,
        );
      });
    }

    {
      const it = !parserInitialized ? bunIt.skip : bunIt;
      it('should block a multi-line function body that runs an unlisted command', () => {
        config.getCoreTools = () => ['run_shell_command(echo)'];
        const result = bashAllowed(
          `echo () {
    curl google.com
  } ; echo ok`,
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe(
          `Command(s) not in the allowed commands list. Disallowed commands: "curl google.com"`,
        );
      });
    }

    {
      const it = !parserInitialized ? bunIt.skip : bunIt;
      it('should block a function keyword declaration that runs an unlisted command', () => {
        config.getCoreTools = () => ['run_shell_command(echo)'];
        const result = bashAllowed(
          'function echo { curl google.com; } ; echo hi',
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe(
          `Command(s) not in the allowed commands list. Disallowed commands: "curl google.com"`,
        );
      });
    }

    {
      const it = !parserInitialized ? bunIt.skip : bunIt;
      it('should block command substitution that invokes an unlisted command', () => {
        config.getCoreTools = () => ['run_shell_command(echo)'];
        const result = bashAllowed('echo $(curl google.com)');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe(
          `Command(s) not in the allowed commands list. Disallowed commands: "curl google.com"`,
        );
      });
    }

    it('should block pipelines that invoke an unlisted command', () => {
      config.getCoreTools = () => ['run_shell_command(echo)'];
      const result = bashAllowed('echo hi | curl google.com');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(
        `Command(s) not in the allowed commands list. Disallowed commands: "curl google.com"`,
      );
    });

    it('should block background jobs that invoke an unlisted command', () => {
      config.getCoreTools = () => ['run_shell_command(echo)'];
      const result = bashAllowed('echo hi & curl google.com');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(
        `Command(s) not in the allowed commands list. Disallowed commands: "curl google.com"`,
      );
    });

    {
      const it = !parserInitialized ? bunIt.skip : bunIt;
      it('should reject command substitution inside a here-document when the grammar omits the inner command', () => {
        config.getCoreTools = () => [
          'run_shell_command(echo)',
          'run_shell_command(cat)',
        ];
        const result = bashAllowed(
          `cat <<EOF
  $(rm -rf /)
  EOF`,
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe(
          'Command rejected because it could not be parsed safely',
        );
      });
    }

    {
      const it = !parserInitialized ? bunIt.skip : bunIt;
      it('should block backtick substitution that invokes an unlisted command', () => {
        config.getCoreTools = () => ['run_shell_command(echo)'];
        const result = bashAllowed('echo `curl google.com`');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe(
          `Command(s) not in the allowed commands list. Disallowed commands: "curl google.com"`,
        );
      });
    }

    {
      const it = !parserInitialized ? bunIt.skip : bunIt;
      it('should block process substitution using <() when the inner command is unlisted', () => {
        config.getCoreTools = () => [
          'run_shell_command(diff)',
          'run_shell_command(echo)',
        ];
        const result = bashAllowed('diff <(curl google.com) <(echo safe)');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe(
          `Command(s) not in the allowed commands list. Disallowed commands: "curl google.com"`,
        );
      });
    }

    {
      const it = !parserInitialized ? bunIt.skip : bunIt;
      it('should block process substitution using >() when the inner command is unlisted', () => {
        config.getCoreTools = () => ['run_shell_command(echo)'];
        const result = bashAllowed('echo "data" > >(curl google.com)');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe(
          `Command(s) not in the allowed commands list. Disallowed commands: "curl google.com"`,
        );
      });
    }

    {
      const it = !parserInitialized ? bunIt.skip : bunIt;
      it('should block commands containing prompt transformations', () => {
        const result = bashAllowed(
          'echo "${var1=aa\\140 env| ls -l\\140}${var1@P}"',
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe(
          'Command rejected because it could not be parsed safely',
        );
      });
    }

    {
      const it = !parserInitialized ? bunIt.skip : bunIt;
      it('should block simple prompt transformation expansions', () => {
        const result = bashAllowed('echo ${foo@P}');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe(
          'Command rejected because it could not be parsed safely',
        );
      });
    }

    describe('command substitution', () => {
      it('should allow command substitution using `$(...)`', () => {
        const result = bashAllowed('echo $(goodCommand --safe)');
        expect(result.allowed).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it('should allow command substitution using `<(...)`', () => {
        const result = bashAllowed('diff <(ls) <(ls -a)');
        expect(result.allowed).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it('should allow command substitution using `>(...)`', () => {
        const result = bashAllowed('echo "Log message" > >(tee log.txt)');
        expect(result.allowed).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it('should allow command substitution using backticks', () => {
        const result = bashAllowed('echo `goodCommand --safe`');
        expect(result.allowed).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it('should allow substitution-like patterns inside single quotes', () => {
        config.getCoreTools = () => ['ShellTool(echo)'];
        const result = bashAllowed("echo '$(pwd)'");
        expect(result.allowed).toBe(true);
      });

      {
        const it = !parserInitialized ? bunIt.skip : bunIt;
        it('should block a command when parsing fails', () => {
          const result = bashAllowed('ls &&');
          expect(result.allowed).toBe(false);
          expect(result.reason).toBe(
            'Command rejected because it could not be parsed safely',
          );
        });
      }
    });
  });

  describe('checkCommandPermissions', () => {
    describe('in "Default Allow" mode (no sessionAllowlist)', () => {
      it('should return a detailed success object for an allowed command', () => {
        const result = bashCheck('goodCommand --safe');
        expect(result).toStrictEqual({
          allAllowed: true,
          disallowedCommands: [],
        });
      });

      {
        const it = !parserInitialized ? bunIt.skip : bunIt;
        it('should block commands that cannot be parsed safely', () => {
          const result = bashCheck('ls &&');
          expect(result).toStrictEqual({
            allAllowed: false,
            disallowedCommands: ['ls &&'],
            blockReason:
              'Command rejected because it could not be parsed safely',
            isHardDenial: true,
          });
        });
      }

      it('should return a detailed failure object for a blocked command', () => {
        config.getExcludeTools = () => ['ShellTool(badCommand)'];
        const result = bashCheck('badCommand --danger');
        expect(result).toStrictEqual({
          allAllowed: false,
          disallowedCommands: ['badCommand --danger'],
          blockReason: `Command 'badCommand --danger' is blocked by configuration`,
          isHardDenial: true,
        });
      });

      it('should return a detailed failure object for a command not on a strict allowlist', () => {
        config.getCoreTools = () => ['ShellTool(goodCommand)'];
        const result = bashCheck('git status && goodCommand');
        expect(result).toStrictEqual({
          allAllowed: false,
          disallowedCommands: ['git status'],
          blockReason: `Command(s) not in the allowed commands list. Disallowed commands: "git status"`,
          isHardDenial: false,
        });
      });
    });

    describe('in "Default Deny" mode (with sessionAllowlist)', () => {
      it('should allow a command on the sessionAllowlist', () => {
        const result = bashCheck(
          'goodCommand --safe',
          new Set(['goodCommand --safe']),
        );
        expect(result.allAllowed).toBe(true);
      });

      it('should block a command not on the sessionAllowlist or global allowlist', () => {
        const result = bashCheck(
          'badCommand --danger',
          new Set(['goodCommand --safe']),
        );
        expect(result.allAllowed).toBe(false);
        expect(result.blockReason).toContain(
          'not on the global or session allowlist',
        );
        expect(result.disallowedCommands).toStrictEqual([
          'badCommand --danger',
        ]);
      });

      it('should allow a command on the global allowlist even if not on the session allowlist', () => {
        config.getCoreTools = () => ['ShellTool(git status)'];
        const result = bashCheck('git status', new Set(['goodCommand --safe']));
        expect(result.allAllowed).toBe(true);
      });

      it('should allow a chained command if parts are on different allowlists', () => {
        config.getCoreTools = () => ['ShellTool(git status)'];
        const result = bashCheck(
          'git status && git commit',
          new Set(['git commit']),
        );
        expect(result.allAllowed).toBe(true);
      });

      it('should block a command on the sessionAllowlist if it is also globally blocked', () => {
        config.getExcludeTools = () => ['run_shell_command(badCommand)'];
        const result = bashCheck(
          'badCommand --danger',
          new Set(['badCommand --danger']),
        );
        expect(result.allAllowed).toBe(false);
        expect(result.blockReason).toContain('is blocked by configuration');
      });

      it('should block a chained command if one part is not on any allowlist', () => {
        config.getCoreTools = () => ['run_shell_command(echo)'];
        const result = bashCheck(
          'echo "hello" && badCommand --danger',
          new Set(['echo']),
        );
        expect(result.allAllowed).toBe(false);
        expect(result.disallowedCommands).toStrictEqual([
          'badCommand --danger',
        ]);
      });
    });
  });

  describe('getCommandRoots', () => {
    it('should return a single command', () => {
      expect(getCommandRoots('ls -l')).toStrictEqual(['ls']);
    });

    it('should handle paths and return the binary name', () => {
      expect(getCommandRoots('/usr/local/bin/node script.js')).toStrictEqual([
        'node',
      ]);
    });

    it('should return an empty array for an empty string', () => {
      expect(getCommandRoots('')).toStrictEqual([]);
    });

    it('should handle a mix of operators', () => {
      const result = getCommandRoots('a;b|c&&d||e&f');
      expect(result).toStrictEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    });

    it('should correctly parse a chained command with quotes', () => {
      const result = getCommandRoots('echo "hello" && git commit -m "feat"');
      expect(result).toStrictEqual(['echo', 'git']);
    });

    {
      const it = !parserInitialized ? bunIt.skip : bunIt;
      it('should include nested command substitutions', () => {
        const result = getCommandRoots('echo $(badCommand --danger)');
        expect(result).toStrictEqual(['echo', 'badCommand']);
      });
    }

    {
      const it = !parserInitialized ? bunIt.skip : bunIt;
      it('should include process substitutions', () => {
        const result = getCommandRoots('diff <(ls) <(ls -a)');
        expect(result).toStrictEqual(['diff', 'ls', 'ls']);
      });
    }

    {
      const it = !parserInitialized ? bunIt.skip : bunIt;
      it('should include backtick substitutions', () => {
        const result = getCommandRoots('echo `badCommand --danger`');
        expect(result).toStrictEqual(['echo', 'badCommand']);
      });
    }

    {
      const it = !parserInitialized ? bunIt.skip : bunIt;
      it('should treat parameter expansions with prompt transformations as unsafe', () => {
        const roots = getCommandRoots(
          'echo "${var1=aa\\140 env| ls -l\\140}${var1@P}"',
        );
        expect(roots).toStrictEqual([]);
      });
    }

    {
      const it = !parserInitialized ? bunIt.skip : bunIt;
      it('should not return roots for prompt transformation expansions', () => {
        const roots = getCommandRoots('echo ${foo@P}');
        expect(roots).toStrictEqual([]);
      });
    }
  });

  describe.skipIf(!pwshAvailable)('PowerShell parser integration', () => {
    // These tests exercise the real tree-sitter-pwsh grammar by passing the
    // shell type explicitly.  Full PowerShell behavior coverage lives in
    // shell-utils.powershell.test.ts and shell-parser-pwsh.test.ts.
    it('should return command roots using the PowerShell grammar', () => {
      const roots = getCommandRoots(
        'Get-ChildItem | Select-Object Name',
        'powershell',
      );
      expect(roots.length).toBeGreaterThan(0);
      expect(roots).toContain('Get-ChildItem');
      expect(roots).toContain('Select-Object');
    });
    it('should block commands when the PowerShell parser reports errors', () => {
      const { allowed, reason } = isCommandAllowed(
        'Get-ChildItem |',
        config,
        'powershell',
      );
      expect(allowed).toBe(false);
      expect(reason).toContain('tree-sitter-pwsh');
    });
  });

  describe('stripShellWrapper', () => {
    it('should strip sh -c with quotes', () => {
      expect(stripShellWrapper('sh -c "ls -l"')).toStrictEqual('ls -l');
    });

    it('should strip bash -c with extra whitespace', () => {
      expect(stripShellWrapper('  bash  -c  "ls -l"  ')).toStrictEqual('ls -l');
    });

    it('should strip zsh -c without quotes', () => {
      expect(stripShellWrapper('zsh -c ls -l')).toStrictEqual('ls -l');
    });

    it('should strip cmd.exe /c', () => {
      expect(stripShellWrapper('cmd.exe /c "dir"')).toStrictEqual('dir');
    });

    it('should strip powershell.exe -Command with optional -NoProfile', () => {
      expect(
        stripShellWrapper('powershell.exe -NoProfile -Command "Get-ChildItem"'),
      ).toStrictEqual('Get-ChildItem');
      expect(
        stripShellWrapper('powershell.exe -Command "Get-ChildItem"'),
      ).toStrictEqual('Get-ChildItem');
    });

    it('should strip pwsh -Command wrapper', () => {
      expect(
        stripShellWrapper('pwsh -NoProfile -Command "Get-ChildItem"'),
      ).toStrictEqual('Get-ChildItem');
    });

    it('should not strip anything if no wrapper is present', () => {
      expect(stripShellWrapper('ls -l')).toStrictEqual('ls -l');
    });
  });

  function createInvocation(command: string): AnyToolInvocation {
    return { params: { command } } as unknown as AnyToolInvocation;
  }

  describe('isShellInvocationAllowlisted', () => {
    it('should return false when any chained command segment is not allowlisted', () => {
      const invocation = createInvocation(
        'git status && rm -rf /tmp/should-not-run',
      );
      expect(
        isShellInvocationAllowlisted(invocation, ['run_shell_command(git)']),
      ).toBe(false);
    });

    it('should return true when every segment is explicitly allowlisted', () => {
      const invocation = createInvocation(
        'git status && rm -rf /tmp/should-run && git diff',
      );
      expect(
        isShellInvocationAllowlisted(invocation, [
          'run_shell_command(git)',
          'run_shell_command(rm -rf)',
        ]),
      ).toBe(true);
    });

    it('should return true when the allowlist contains a wildcard shell entry', () => {
      const invocation = createInvocation(
        'git status && rm -rf /tmp/should-run',
      );
      expect(
        isShellInvocationAllowlisted(invocation, ['run_shell_command']),
      ).toBe(true);
    });

    it('should fail closed when params are malformed', () => {
      const allowlist = ['run_shell_command(git)'];

      const missingCommand = { params: {} } as unknown as AnyToolInvocation;
      expect(isShellInvocationAllowlisted(missingCommand, allowlist)).toBe(
        false,
      );

      const nonStringCommand = {
        params: { command: 42 },
      } as unknown as AnyToolInvocation;
      expect(isShellInvocationAllowlisted(nonStringCommand, allowlist)).toBe(
        false,
      );

      const objectCommand = {
        params: { command: { nested: 'git' } },
      } as unknown as AnyToolInvocation;
      expect(isShellInvocationAllowlisted(objectCommand, allowlist)).toBe(
        false,
      );

      const whitespaceCommand = {
        params: { command: '   ' },
      } as unknown as AnyToolInvocation;
      expect(isShellInvocationAllowlisted(whitespaceCommand, allowlist)).toBe(
        false,
      );
    });

    it('should treat piped commands as separate segments that must be allowlisted', () => {
      const invocation = createInvocation('git status | tail -n 1');
      expect(
        isShellInvocationAllowlisted(invocation, ['run_shell_command(git)']),
      ).toBe(false);
      expect(
        isShellInvocationAllowlisted(invocation, [
          'run_shell_command(git)',
          'run_shell_command(tail)',
        ]),
      ).toBe(true);
    });
  });

  describePwsh('isShellInvocationAllowlisted: PowerShell shell-aware', () => {
    it('should require all pipeline stages to be allowlisted for PowerShell', () => {
      const invocation = createInvocation(
        'Get-Process | Where-Object { $_.Name -eq "x" }',
      );
      expect(
        isShellInvocationAllowlisted(
          invocation,
          ['run_shell_command(Get-Process)'],
          'powershell',
        ),
      ).toBe(false);
      expect(
        isShellInvocationAllowlisted(
          invocation,
          ['run_shell_command(Get-Process)', 'run_shell_command(Where-Object)'],
          'powershell',
        ),
      ).toBe(true);
    });

    it('should find nested commands inside script blocks for PowerShell', () => {
      const invocation = createInvocation('ForEach-Object { Write-Host $_ }');
      // Only ForEach-Object is allowlisted — Write-Host is nested inside
      expect(
        isShellInvocationAllowlisted(
          invocation,
          ['run_shell_command(ForEach-Object)'],
          'powershell',
        ),
      ).toBe(false);
      // Both must be allowlisted
      expect(
        isShellInvocationAllowlisted(
          invocation,
          [
            'run_shell_command(ForEach-Object)',
            'run_shell_command(Write-Host)',
          ],
          'powershell',
        ),
      ).toBe(true);
    });

    it('should fail closed for dynamic call targets in PowerShell', () => {
      const invocation = createInvocation('& $command');
      expect(
        isShellInvocationAllowlisted(
          invocation,
          ['run_shell_command(git)'],
          'powershell',
        ),
      ).toBe(false);
    });

    it('should fail closed for .NET invocation expressions in PowerShell', () => {
      const invocation = createInvocation(
        '[System.Diagnostics.Process]::Start("cmd.exe")',
      );
      expect(
        isShellInvocationAllowlisted(
          invocation,
          ['run_shell_command(git)'],
          'powershell',
        ),
      ).toBe(false);
    });

    it('should catch blocklisted command nested in Invoke-Expression payload', () => {
      const invocation = createInvocation('Invoke-Expression "rm -rf /tmp"');
      // rm is not in the allowed list, so the whole invocation is not allowed
      expect(
        isShellInvocationAllowlisted(
          invocation,
          ['run_shell_command(Invoke-Expression)'],
          'powershell',
        ),
      ).toBe(false);
    });
  });
});
