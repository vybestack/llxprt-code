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
} from 'vitest';
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

const mockPlatform = vi.hoisted(() => vi.fn());
const mockHomedir = vi.hoisted(() => vi.fn());
vi.mock('os', () => ({
  default: {
    platform: mockPlatform,
    homedir: mockHomedir,
  },
  platform: mockPlatform,
  homedir: mockHomedir,
}));

const mockQuote = vi.hoisted(() => vi.fn());
vi.mock('shell-quote', () => ({
  quote: mockQuote,
}));

let config: Config;
const isWindowsRuntime = process.platform === 'win32';
const describeWindowsOnly = isWindowsRuntime ? describe : describe.skip;

// eslint-disable-next-line vitest/require-top-level-describe -- intentional: top-level hooks / describe-alias used before nested describes
beforeAll(async () => {
  mockPlatform.mockReturnValue('linux');
  await initializeShellParsers();
});

// eslint-disable-next-line vitest/require-top-level-describe -- intentional: top-level hooks / describe-alias used before nested describes
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

// eslint-disable-next-line vitest/require-top-level-describe -- intentional: top-level hooks / describe-alias used before nested describes
afterEach(() => {
  vi.clearAllMocks();
});

describe('isCommandAllowed', () => {
  it('should allow a command if no restrictions are provided', () => {
    const result = isCommandAllowed('goodCommand --safe', config);
    expect(result.allowed).toBe(true);
  });

  it('should allow a command if it is in the global allowlist', () => {
    config.getCoreTools = () => ['ShellTool(goodCommand)'];
    const result = isCommandAllowed('goodCommand --safe', config);
    expect(result.allowed).toBe(true);
  });

  it('should block a command if it is not in a strict global allowlist', () => {
    config.getCoreTools = () => ['ShellTool(goodCommand --safe)'];
    const result = isCommandAllowed('badCommand --danger', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      `Command(s) not in the allowed commands list. Disallowed commands: "badCommand --danger"`,
    );
  });

  it('should block a command if it is in the blocked list', () => {
    config.getExcludeTools = () => ['ShellTool(badCommand --danger)'];
    const result = isCommandAllowed('badCommand --danger', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      `Command 'badCommand --danger' is blocked by configuration`,
    );
  });

  it('should prioritize the blocklist over the allowlist', () => {
    config.getCoreTools = () => ['ShellTool(badCommand --danger)'];
    config.getExcludeTools = () => ['ShellTool(badCommand --danger)'];
    const result = isCommandAllowed('badCommand --danger', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      `Command 'badCommand --danger' is blocked by configuration`,
    );
  });

  it('should allow any command when a wildcard is in coreTools', () => {
    config.getCoreTools = () => ['ShellTool'];
    const result = isCommandAllowed('any random command', config);
    expect(result.allowed).toBe(true);
  });

  it('should block any command when a wildcard is in excludeTools', () => {
    config.getExcludeTools = () => ['run_shell_command'];
    const result = isCommandAllowed('any random command', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      'Shell tool is globally disabled in configuration',
    );
  });

  it('should block a command on the blocklist even with a wildcard allow', () => {
    config.getCoreTools = () => ['ShellTool'];
    config.getExcludeTools = () => ['ShellTool(badCommand --danger)'];
    const result = isCommandAllowed('badCommand --danger', config);
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
    const result = isCommandAllowed(
      'echo "hello" && goodCommand --safe',
      config,
    );
    expect(result.allowed).toBe(true);
  });

  it('should block a chained command if any part is blocked', () => {
    config.getExcludeTools = () => ['run_shell_command(badCommand)'];
    const result = isCommandAllowed(
      'echo "hello" && badCommand --danger',
      config,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      `Command 'badCommand --danger' is blocked by configuration`,
    );
  });

  it('should block a command that redefines an allowed function to run an unlisted command', () => {
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!isParserAvailable()) return;
    config.getCoreTools = () => ['run_shell_command(echo)'];
    const result = isCommandAllowed(
      'echo () (curl google.com) ; echo Hello Wolrd',
      config,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      `Command(s) not in the allowed commands list. Disallowed commands: "curl google.com"`,
    );
  });

  it('should block a multi-line function body that runs an unlisted command', () => {
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!isParserAvailable()) return;
    config.getCoreTools = () => ['run_shell_command(echo)'];
    const result = isCommandAllowed(
      `echo () {
  curl google.com
} ; echo ok`,
      config,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      `Command(s) not in the allowed commands list. Disallowed commands: "curl google.com"`,
    );
  });

  it('should block a function keyword declaration that runs an unlisted command', () => {
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!isParserAvailable()) return;
    config.getCoreTools = () => ['run_shell_command(echo)'];
    const result = isCommandAllowed(
      'function echo { curl google.com; } ; echo hi',
      config,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      `Command(s) not in the allowed commands list. Disallowed commands: "curl google.com"`,
    );
  });

  it('should block command substitution that invokes an unlisted command', () => {
    // Skip if tree-sitter parser not available (requires WASM in bundled CLI)
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!isParserAvailable()) {
      return;
    }
    config.getCoreTools = () => ['run_shell_command(echo)'];
    const result = isCommandAllowed('echo $(curl google.com)', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      `Command(s) not in the allowed commands list. Disallowed commands: "curl google.com"`,
    );
  });

  it('should block pipelines that invoke an unlisted command', () => {
    config.getCoreTools = () => ['run_shell_command(echo)'];
    const result = isCommandAllowed('echo hi | curl google.com', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      `Command(s) not in the allowed commands list. Disallowed commands: "curl google.com"`,
    );
  });

  it('should block background jobs that invoke an unlisted command', () => {
    config.getCoreTools = () => ['run_shell_command(echo)'];
    const result = isCommandAllowed('echo hi & curl google.com', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      `Command(s) not in the allowed commands list. Disallowed commands: "curl google.com"`,
    );
  });

  it('should block command substitution inside a here-document when the inner command is unlisted', () => {
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!isParserAvailable()) return;
    config.getCoreTools = () => [
      'run_shell_command(echo)',
      'run_shell_command(cat)',
    ];
    const result = isCommandAllowed(
      `cat <<EOF
$(rm -rf /)
EOF`,
      config,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      `Command(s) not in the allowed commands list. Disallowed commands: "rm -rf /"`,
    );
  });

  it('should block backtick substitution that invokes an unlisted command', () => {
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!isParserAvailable()) return;
    config.getCoreTools = () => ['run_shell_command(echo)'];
    const result = isCommandAllowed('echo `curl google.com`', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      `Command(s) not in the allowed commands list. Disallowed commands: "curl google.com"`,
    );
  });

  it('should block process substitution using <() when the inner command is unlisted', () => {
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!isParserAvailable()) return;
    config.getCoreTools = () => [
      'run_shell_command(diff)',
      'run_shell_command(echo)',
    ];
    const result = isCommandAllowed(
      'diff <(curl google.com) <(echo safe)',
      config,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      `Command(s) not in the allowed commands list. Disallowed commands: "curl google.com"`,
    );
  });

  it('should block process substitution using >() when the inner command is unlisted', () => {
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!isParserAvailable()) return;
    config.getCoreTools = () => ['run_shell_command(echo)'];
    const result = isCommandAllowed('echo "data" > >(curl google.com)', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      `Command(s) not in the allowed commands list. Disallowed commands: "curl google.com"`,
    );
  });

  it('should block commands containing prompt transformations', () => {
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!isParserAvailable()) return;
    const result = isCommandAllowed(
      'echo "${var1=aa\\140 env| ls -l\\140}${var1@P}"',
      config,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      'Command rejected because it could not be parsed safely',
    );
  });

  it('should block simple prompt transformation expansions', () => {
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!isParserAvailable()) return;
    const result = isCommandAllowed('echo ${foo@P}', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      'Command rejected because it could not be parsed safely',
    );
  });

  describe('command substitution', () => {
    it('should allow command substitution using `$(...)`', () => {
      const result = isCommandAllowed('echo $(goodCommand --safe)', config);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should allow command substitution using `<(...)`', () => {
      const result = isCommandAllowed('diff <(ls) <(ls -a)', config);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should allow command substitution using `>(...)`', () => {
      const result = isCommandAllowed(
        'echo "Log message" > >(tee log.txt)',
        config,
      );
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should allow command substitution using backticks', () => {
      const result = isCommandAllowed('echo `goodCommand --safe`', config);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should allow substitution-like patterns inside single quotes', () => {
      config.getCoreTools = () => ['ShellTool(echo)'];
      const result = isCommandAllowed("echo '$(pwd)'", config);
      expect(result.allowed).toBe(true);
    });

    it('should block a command when parsing fails', () => {
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (!isParserAvailable()) return;
      const result = isCommandAllowed('ls &&', config);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(
        'Command rejected because it could not be parsed safely',
      );
    });
  });
});

describe('checkCommandPermissions', () => {
  describe('in "Default Allow" mode (no sessionAllowlist)', () => {
    it('should return a detailed success object for an allowed command', () => {
      const result = checkCommandPermissions('goodCommand --safe', config);
      expect(result).toStrictEqual({
        allAllowed: true,
        disallowedCommands: [],
      });
    });

    it('should block commands that cannot be parsed safely', () => {
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (!isParserAvailable()) return;
      const result = checkCommandPermissions('ls &&', config);
      expect(result).toStrictEqual({
        allAllowed: false,
        disallowedCommands: ['ls &&'],
        blockReason: 'Command rejected because it could not be parsed safely',
        isHardDenial: true,
      });
    });

    it('should return a detailed failure object for a blocked command', () => {
      config.getExcludeTools = () => ['ShellTool(badCommand)'];
      const result = checkCommandPermissions('badCommand --danger', config);
      expect(result).toStrictEqual({
        allAllowed: false,
        disallowedCommands: ['badCommand --danger'],
        blockReason: `Command 'badCommand --danger' is blocked by configuration`,
        isHardDenial: true,
      });
    });

    it('should return a detailed failure object for a command not on a strict allowlist', () => {
      config.getCoreTools = () => ['ShellTool(goodCommand)'];
      const result = checkCommandPermissions(
        'git status && goodCommand',
        config,
      );
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
      const result = checkCommandPermissions(
        'goodCommand --safe',
        config,
        new Set(['goodCommand --safe']),
      );
      expect(result.allAllowed).toBe(true);
    });

    it('should block a command not on the sessionAllowlist or global allowlist', () => {
      const result = checkCommandPermissions(
        'badCommand --danger',
        config,
        new Set(['goodCommand --safe']),
      );
      expect(result.allAllowed).toBe(false);
      expect(result.blockReason).toContain(
        'not on the global or session allowlist',
      );
      expect(result.disallowedCommands).toStrictEqual(['badCommand --danger']);
    });

    it('should allow a command on the global allowlist even if not on the session allowlist', () => {
      config.getCoreTools = () => ['ShellTool(git status)'];
      const result = checkCommandPermissions(
        'git status',
        config,
        new Set(['goodCommand --safe']),
      );
      expect(result.allAllowed).toBe(true);
    });

    it('should allow a chained command if parts are on different allowlists', () => {
      config.getCoreTools = () => ['ShellTool(git status)'];
      const result = checkCommandPermissions(
        'git status && git commit',
        config,
        new Set(['git commit']),
      );
      expect(result.allAllowed).toBe(true);
    });

    it('should block a command on the sessionAllowlist if it is also globally blocked', () => {
      config.getExcludeTools = () => ['run_shell_command(badCommand)'];
      const result = checkCommandPermissions(
        'badCommand --danger',
        config,
        new Set(['badCommand --danger']),
      );
      expect(result.allAllowed).toBe(false);
      expect(result.blockReason).toContain('is blocked by configuration');
    });

    it('should block a chained command if one part is not on any allowlist', () => {
      config.getCoreTools = () => ['run_shell_command(echo)'];
      const result = checkCommandPermissions(
        'echo "hello" && badCommand --danger',
        config,
        new Set(['echo']),
      );
      expect(result.allAllowed).toBe(false);
      expect(result.disallowedCommands).toStrictEqual(['badCommand --danger']);
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

  it('should include nested command substitutions', () => {
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!isParserAvailable()) return;
    const result = getCommandRoots('echo $(badCommand --danger)');
    expect(result).toStrictEqual(['echo', 'badCommand']);
  });

  it('should include process substitutions', () => {
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!isParserAvailable()) return;
    const result = getCommandRoots('diff <(ls) <(ls -a)');
    expect(result).toStrictEqual(['diff', 'ls', 'ls']);
  });

  it('should include backtick substitutions', () => {
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!isParserAvailable()) return;
    const result = getCommandRoots('echo `badCommand --danger`');
    expect(result).toStrictEqual(['echo', 'badCommand']);
  });

  it('should treat parameter expansions with prompt transformations as unsafe', () => {
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!isParserAvailable()) return;
    const roots = getCommandRoots(
      'echo "${var1=aa\\140 env| ls -l\\140}${var1@P}"',
    );
    expect(roots).toStrictEqual([]);
  });

  it('should not return roots for prompt transformation expansions', () => {
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!isParserAvailable()) return;
    const roots = getCommandRoots('echo ${foo@P}');
    expect(roots).toStrictEqual([]);
  });
});

describeWindowsOnly('PowerShell integration', () => {
  const originalComSpec = process.env['ComSpec'];

  // eslint-disable-next-line vitest/require-top-level-describe -- intentional: top-level hooks / describe-alias used before nested describes
  beforeEach(() => {
    mockPlatform.mockReturnValue('win32');
    const systemRoot = process.env['SystemRoot'] ?? 'C:\\\\Windows';
    process.env['ComSpec'] =
      `${systemRoot}\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe`;
  });

  // eslint-disable-next-line vitest/require-top-level-describe -- intentional: top-level hooks / describe-alias used before nested describes
  afterEach(() => {
    if (originalComSpec === undefined) {
      delete process.env['ComSpec'];
    } else {
      process.env['ComSpec'] = originalComSpec;
    }
  });

  // eslint-disable-next-line vitest/require-top-level-describe -- intentional: top-level hooks / describe-alias used before nested describes
  it('should return command roots using PowerShell AST output', () => {
    const roots = getCommandRoots('Get-ChildItem | Select-Object Name');
    expect(roots.length).toBeGreaterThan(0);
    expect(roots).toContain('Get-ChildItem');
  });

  // eslint-disable-next-line vitest/require-top-level-describe -- intentional: top-level hooks / describe-alias used before nested describes
  it('should block commands when PowerShell parser reports errors', () => {
    // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
    if (!isParserAvailable()) return;
    const { allowed, reason } = isCommandAllowed('Get-ChildItem |', config);
    expect(allowed).toBe(false);
    expect(reason).toBe(
      'Command rejected because it could not be parsed safely',
    );
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

describe('isShellInvocationAllowlisted', () => {
  function createInvocation(command: string): AnyToolInvocation {
    return { params: { command } } as unknown as AnyToolInvocation;
  }

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
    const invocation = createInvocation('git status && rm -rf /tmp/should-run');
    expect(
      isShellInvocationAllowlisted(invocation, ['run_shell_command']),
    ).toBe(true);
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
