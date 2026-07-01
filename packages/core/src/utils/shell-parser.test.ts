/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
import {
  initializeParser,
  isParserAvailable,
  parseShellCommand,
  parseCommandDetails,
  extractCommandNames,
  hasCommandSubstitution,
  splitCommandsWithTree,
  resetParser,
  getInitializationError,
  collectCommandDetails,
} from './shell-parser.js';
import { DebugLogger } from '../debug/DebugLogger.js';

let parserInitialized = await initializeParser();

/**
 * Tree-sitter parser tests.
 *
 * The parser initializes by loading the bash WASM grammar via
 * web-tree-sitter@0.25.x's top-level `Language.load()`, reading the grammar
 * bytes from disk via `require.resolve` so initialization is identical under
 * vitest (Node) and Bun. Either way, a successful initialization should make
 * the parser available so these tests exercise real parsing behavior.
 */
describe('shell-parser', () => {
  beforeAll(async () => {
    // Refresh initialization state in case another test reset the parser.
    parserInitialized = await initializeParser();
  });

  afterAll(() => {
    // Reset for other test suites
    resetParser();
  });

  describe('initializeParser', () => {
    it.skipIf(!parserInitialized)(
      'should successfully initialize the parser under the current runtime',
      async () => {
        resetParser();
        const result = await initializeParser();
        expect(result).toBe(true);
        expect(isParserAvailable()).toBe(true);
        expect(getInitializationError()).toBeNull();
      },
    );

    it('should attempt initialization and return consistent result', async () => {
      const result = await initializeParser();
      // Result should match whether parser is available
      expect(result).toBe(isParserAvailable());
    });

    it('should return cached result on subsequent calls', async () => {
      const result1 = await initializeParser();
      const result2 = await initializeParser();
      expect(result1).toBe(result2);
    });

    it.skipIf(!parserInitialized)(
      'should have no initialization error when parser is available',
      async () => {
        await initializeParser();
        const error = getInitializationError();
        // After successful initialization there should be no error
        expect(error).toBeNull();
      },
    );

    it('should record initialization errors when tree-sitter exports are missing', async () => {
      vi.resetModules();
      vi.doMock('web-tree-sitter', () => ({
        Parser: class MockParser {
          static init(): Promise<void> {
            return Promise.resolve();
          }

          setLanguage(): void {}
        },
        default: undefined,
        Language: undefined,
      }));

      try {
        const parserModule = await import('./shell-parser.js');
        parserModule.resetParser();

        const result = await parserModule.initializeParser();

        expect(result).toBe(false);
        expect(parserModule.isParserAvailable()).toBe(false);
        expect(parserModule.getInitializationError()?.message).toContain(
          'Language export not found',
        );
      } finally {
        vi.doUnmock('web-tree-sitter');
        vi.resetModules();
      }
    });
  });

  describe('parseShellCommand', () => {
    it.skipIf(!parserInitialized)(
      'should parse a simple command when parser is available',
      () => {
        const tree = parseShellCommand('ls -la');
        expect(tree).not.toBeNull();
        expect(tree?.rootNode.type).toBe('program');
      },
    );

    it.skipIf(!parserInitialized)(
      'should parse complex pipelines when parser is available',
      () => {
        const tree = parseShellCommand('cat file.txt | grep pattern | wc -l');
        expect(tree).not.toBeNull();
      },
    );

    it('should return null if parser not available', () => {
      resetParser();
      const tree = parseShellCommand('ls');
      expect(tree).toBeNull();
      // Re-initialize for remaining tests
      return initializeParser();
    });
  });

  describe('timeout handling', () => {
    const TIMEOUT_COMMAND =
      'a=$(b); c=$(d); e=$(f); g=$(h); i=$(j); k=$(l); ls -la';

    function setupTimeoutMock(): void {
      vi.spyOn(performance, 'now')
        .mockReturnValueOnce(0)
        .mockReturnValue(Number.MAX_SAFE_INTEGER);
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it.skipIf(!isParserAvailable())(
      'should handle bash parser timeouts in parseShellCommand',
      async () => {
        await initializeParser();

        const errorSpy = vi
          .spyOn(DebugLogger.prototype, 'error')
          .mockImplementation(() => {});
        setupTimeoutMock();

        const result = parseShellCommand(TIMEOUT_COMMAND);
        expect(result).toBeNull();
        expect(errorSpy).toHaveBeenCalledWith(
          'Bash command parsing timed out for command:',
          TIMEOUT_COMMAND,
        );
      },
    );

    it.skipIf(!isParserAvailable())(
      'should handle bash parser timeouts in parseCommandDetails',
      async () => {
        await initializeParser();

        vi.spyOn(DebugLogger.prototype, 'error').mockImplementation(() => {});
        setupTimeoutMock();

        const result = parseCommandDetails(TIMEOUT_COMMAND);
        // When parseShellCommand times out, parseCommandDetails returns hasError: true
        expect(result).toStrictEqual({ details: [], hasError: true });
      },
    );
  });

  describe('extractCommandNames', () => {
    beforeAll(async () => {
      await initializeParser();
    });

    it.skipIf(!parserInitialized)(
      'should extract simple command when parser available',
      () => {
        const tree = parseShellCommand('ls -la');
        expect(tree).not.toBeNull();
        const names = extractCommandNames(tree!);
        expect(names).toContain('ls');
      },
    );

    it.skipIf(!parserInitialized)(
      'should extract commands from pipeline when parser available',
      () => {
        const tree = parseShellCommand('cat file.txt | grep pattern | wc -l');
        expect(tree).not.toBeNull();
        const names = extractCommandNames(tree!);
        expect(names).toStrictEqual(['cat', 'grep', 'wc']);
      },
    );

    it.skipIf(!parserInitialized)(
      'should extract commands from && chain when parser available',
      () => {
        const tree = parseShellCommand('npm install && npm test && npm build');
        expect(tree).not.toBeNull();
        const names = extractCommandNames(tree!);
        expect(names).toStrictEqual(['npm', 'npm', 'npm']);
      },
    );

    it.skipIf(!parserInitialized)(
      'should extract commands from || chain when parser available',
      () => {
        const tree = parseShellCommand('test -f file || touch file');
        expect(tree).not.toBeNull();
        const names = extractCommandNames(tree!);
        expect(names).toStrictEqual(['test', 'touch']);
      },
    );

    it.skipIf(!parserInitialized)(
      'should handle commands with paths when parser available',
      () => {
        const tree = parseShellCommand('/usr/bin/python script.py');
        expect(tree).not.toBeNull();
        const names = extractCommandNames(tree!);
        expect(names).toContain('python');
      },
    );

    it.skipIf(!parserInitialized)(
      'should handle quoted commands when parser available',
      () => {
        const tree = parseShellCommand('"my command" arg1 arg2');
        expect(tree).not.toBeNull();
        const names = extractCommandNames(tree!);
        expect(names.length).toBeGreaterThan(0);
      },
    );
  });

  describe('hasCommandSubstitution', () => {
    beforeAll(async () => {
      await initializeParser();
    });

    it.skipIf(!parserInitialized)(
      'should detect $() substitution when parser available',
      () => {
        const tree = parseShellCommand('echo $(whoami)');
        expect(tree).not.toBeNull();
        expect(hasCommandSubstitution(tree!)).toBe(true);
      },
    );

    it.skipIf(!parserInitialized)(
      'should detect backtick substitution when parser available',
      () => {
        const tree = parseShellCommand('echo `date`');
        expect(tree).not.toBeNull();
        expect(hasCommandSubstitution(tree!)).toBe(true);
      },
    );

    it.skipIf(!parserInitialized)(
      'should detect process substitution <() when parser available',
      () => {
        const tree = parseShellCommand('diff <(ls dir1) <(ls dir2)');
        expect(tree).not.toBeNull();
        expect(hasCommandSubstitution(tree!)).toBe(true);
      },
    );

    it.skipIf(!parserInitialized)(
      'should detect process substitution >() when parser available',
      () => {
        const tree = parseShellCommand('tee >(cat > file.txt)');
        expect(tree).not.toBeNull();
        expect(hasCommandSubstitution(tree!)).toBe(true);
      },
    );

    it.skipIf(!parserInitialized)(
      'should not detect substitution in single quotes when parser available',
      () => {
        const tree = parseShellCommand("echo 'hello $(world)'");
        expect(tree).not.toBeNull();
        // Single quotes prevent substitution in bash - tree-sitter sees string literal
        expect(hasCommandSubstitution(tree!)).toBe(false);
      },
    );

    it.skipIf(!parserInitialized)(
      'should return false for simple commands when parser available',
      () => {
        const tree = parseShellCommand('ls -la /tmp');
        expect(tree).not.toBeNull();
        expect(hasCommandSubstitution(tree!)).toBe(false);
      },
    );

    it.skipIf(!parserInitialized)(
      'should return false for pipes (not substitution) when parser available',
      () => {
        const tree = parseShellCommand('cat file | grep pattern');
        expect(tree).not.toBeNull();
        expect(hasCommandSubstitution(tree!)).toBe(false);
      },
    );

    it.skipIf(!parserInitialized)(
      'should detect nested substitution when parser available',
      () => {
        const tree = parseShellCommand('echo $(cat $(ls))');
        expect(tree).not.toBeNull();
        expect(hasCommandSubstitution(tree!)).toBe(true);
      },
    );
  });

  describe('splitCommandsWithTree', () => {
    beforeAll(async () => {
      await initializeParser();
    });

    it.skipIf(!parserInitialized)(
      'should split && commands when parser available',
      () => {
        const tree = parseShellCommand('cd /tmp && ls');
        expect(tree).not.toBeNull();
        const commands = splitCommandsWithTree(tree!);
        expect(commands.length).toBe(2);
        expect(commands[0]).toContain('cd');
        expect(commands[1]).toContain('ls');
      },
    );

    it.skipIf(!parserInitialized)(
      'should split || commands when parser available',
      () => {
        const tree = parseShellCommand('test -f file || touch file');
        expect(tree).not.toBeNull();
        const commands = splitCommandsWithTree(tree!);
        expect(commands.length).toBe(2);
      },
    );

    it.skipIf(!parserInitialized)(
      'should handle semicolon separation when parser available',
      () => {
        const tree = parseShellCommand('echo a; echo b; echo c');
        expect(tree).not.toBeNull();
        const commands = splitCommandsWithTree(tree!);
        expect(commands.length).toBe(3);
      },
    );

    it.skipIf(!parserInitialized)(
      'should handle pipeline as single command unit when parser available',
      () => {
        const tree = parseShellCommand('cat file | grep pattern');
        expect(tree).not.toBeNull();
        const commands = splitCommandsWithTree(tree!);
        // Pipeline is treated as one logical unit
        expect(commands.length).toBeGreaterThanOrEqual(1);
      },
    );

    it.skipIf(!parserInitialized)(
      'should handle mixed operators when parser available',
      () => {
        const tree = parseShellCommand('cmd1 && cmd2 || cmd3; cmd4');
        expect(tree).not.toBeNull();
        const commands = splitCommandsWithTree(tree!);
        expect(commands.length).toBe(4);
      },
    );

    it.skipIf(!parserInitialized)(
      'should handle empty input gracefully',
      () => {
        const tree = parseShellCommand('');
        expect(tree).toBeNull();
      },
    );

    it.skipIf(!parserInitialized)(
      'should handle subshells when parser available',
      () => {
        const tree = parseShellCommand('(cd /tmp && ls)');
        expect(tree).not.toBeNull();
        const commands = splitCommandsWithTree(tree!);
        expect(commands.length).toBeGreaterThanOrEqual(1);
      },
    );
  });

  describe('collectCommandDetails', () => {
    beforeAll(async () => {
      await initializeParser();
    });

    it.skipIf(!isParserAvailable())(
      'should extract commands from simple command',
      () => {
        const tree = parseShellCommand('echo hello');
        expect(tree).not.toBeNull();
        const details = collectCommandDetails(tree!, 'echo hello');
        expect(details).toHaveLength(1);
        expect(details[0].name).toBe('echo');
      },
    );

    it.skipIf(!isParserAvailable())(
      'should extract commands from command substitution $()',
      () => {
        const tree = parseShellCommand('echo $(curl google.com)');
        expect(tree).not.toBeNull();
        const details = collectCommandDetails(tree!, 'echo $(curl google.com)');
        expect(details.map((d) => d.name)).toContain('echo');
        expect(details.map((d) => d.name)).toContain('curl');
      },
    );

    it.skipIf(!isParserAvailable())(
      'should extract commands from backtick substitution',
      () => {
        const tree = parseShellCommand('echo `rm -rf /`');
        expect(tree).not.toBeNull();
        const details = collectCommandDetails(tree!, 'echo `rm -rf /`');
        expect(details.map((d) => d.name)).toContain('echo');
        expect(details.map((d) => d.name)).toContain('rm');
      },
    );

    it.skipIf(!isParserAvailable())(
      'should extract commands from process substitution <()',
      () => {
        const tree = parseShellCommand('diff <(curl a) <(echo b)');
        expect(tree).not.toBeNull();
        const details = collectCommandDetails(
          tree!,
          'diff <(curl a) <(echo b)',
        );
        expect(details.map((d) => d.name)).toContain('diff');
        expect(details.map((d) => d.name)).toContain('curl');
        expect(details.map((d) => d.name)).toContain('echo');
      },
    );

    it.skipIf(!isParserAvailable())(
      'should extract commands from function definitions',
      () => {
        const tree = parseShellCommand(
          'echo () (curl google.com) ; echo Hello',
        );
        expect(tree).not.toBeNull();
        const details = collectCommandDetails(
          tree!,
          'echo () (curl google.com) ; echo Hello',
        );
        expect(details.map((d) => d.name)).toContain('curl');
        expect(details.map((d) => d.name)).toContain('echo');
      },
    );
  });
  describe('resetParser', () => {
    it.skipIf(!parserInitialized)('should reset parser state', async () => {
      resetParser();
      expect(isParserAvailable()).toBe(false);

      const reinitialized = await initializeParser();
      expect(isParserAvailable()).toBe(reinitialized);
    });
  });
});
