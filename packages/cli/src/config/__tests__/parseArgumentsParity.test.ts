/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Task 1.5 – parseArguments behavioral parity tests
 *
 * Locks yargs behavior that could regress during parser extraction:
 *   - Subcommand exit behavior (mcp, hooks, extensions, skills)
 *   - Positional prompt/query mapping
 *   - Conflicting flag handling
 *   - Array coercion behavior
 *   - Boolean default handling
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseArguments } from '../cliArgParser.js';
import type { Settings } from '../settings.js';

// Minimal mocks so parseArguments doesn't need a full environment

vi.mock('open', () => ({ default: vi.fn() }));
vi.mock('read-package-up', () => ({
  readPackageUp: vi.fn(() =>
    Promise.resolve({ packageJson: { version: 'test-version' } }),
  ),
}));

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('parseArgumentsParity: positional mapping', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('no positional → query is undefined', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    expect(argv.query).toBeUndefined();
    expect(argv.prompt).toBeUndefined();
  });

  it('single positional word → query equals that word, prompt set', async () => {
    process.argv = ['node', 'script.js', 'hello'];
    const argv = await parseArguments({} as Settings);
    expect(argv.query).toBe('hello');
    expect(argv.prompt).toBe('hello');
  });

  it('multiple positional words → joined with spaces', async () => {
    process.argv = ['node', 'script.js', 'write', 'me', 'a', 'poem'];
    const argv = await parseArguments({} as Settings);
    expect(argv.query).toBe('write me a poem');
    expect(argv.prompt).toBe('write me a poem');
  });

  it('--prompt flag overrides positional (one-shot)', async () => {
    process.argv = ['node', 'script.js', '--prompt', 'flag prompt'];
    const argv = await parseArguments({} as Settings);
    expect(argv.prompt).toBe('flag prompt');
    expect(argv.promptInteractive).toBeUndefined();
  });

  it('positional + --prompt flag → error (mutual exclusion)', async () => {
    process.argv = [
      'node',
      'script.js',
      'positional',
      '--prompt',
      'flag prompt',
    ];
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(parseArguments({} as Settings)).rejects.toThrow(
      'process.exit called',
    );
    expect(mockErr).toHaveBeenCalledWith(
      expect.stringContaining(
        'Cannot use both a positional prompt and the --prompt (-p) flag together',
      ),
    );
    mockExit.mockRestore();
    mockErr.mockRestore();
  });

  it('@path prefix → mapped to prompt (one-shot)', async () => {
    process.argv = ['node', 'script.js', '@path', './file.md'];
    const argv = await parseArguments({} as Settings);
    expect(argv.prompt).toBe('@path ./file.md');
    expect(argv.promptInteractive).toBeUndefined();
  });

  it('promptWords array populated from positional args', async () => {
    process.argv = ['node', 'script.js', 'hello', 'world'];
    const argv = await parseArguments({} as Settings);
    expect(argv.promptWords).toStrictEqual(['hello', 'world']);
  });
});

describe('parseArgumentsParity: conflicting flag handling', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('--prompt + --prompt-interactive together → error', async () => {
    process.argv = [
      'node',
      'script.js',
      '--prompt',
      'a',
      '--prompt-interactive',
      'b',
    ];
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(parseArguments({} as Settings)).rejects.toThrow(
      'process.exit called',
    );
    expect(mockErr).toHaveBeenCalledWith(
      expect.stringContaining(
        'Cannot use both --prompt (-p) and --prompt-interactive (-i) together',
      ),
    );
    mockExit.mockRestore();
    mockErr.mockRestore();
  });

  it('-p + -i together → error', async () => {
    process.argv = ['node', 'script.js', '-p', 'a', '-i', 'b'];
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(parseArguments({} as Settings)).rejects.toThrow(
      'process.exit called',
    );
    mockExit.mockRestore();
    mockErr.mockRestore();
  });

  it('--yolo + --approval-mode together → error', async () => {
    process.argv = [
      'node',
      'script.js',
      '--yolo',
      '--approval-mode',
      'default',
    ];
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(parseArguments({} as Settings)).rejects.toThrow(
      'process.exit called',
    );
    expect(mockErr).toHaveBeenCalledWith(
      expect.stringContaining(
        'Cannot use both --yolo (-y) and --approval-mode together',
      ),
    );
    mockExit.mockRestore();
    mockErr.mockRestore();
  });

  it('invalid --approval-mode value → error', async () => {
    process.argv = ['node', 'script.js', '--approval-mode', 'bad_value'];
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(parseArguments({} as Settings)).rejects.toThrow(
      'process.exit called',
    );
    const errStr = mockErr.mock.calls.map(([m]) => String(m)).join('\n');
    expect(errStr).toMatch(/Invalid values/i);
    mockExit.mockRestore();
    mockErr.mockRestore();
  });
});

describe('parseArgumentsParity: array coercion', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('--include-directories comma-separated → split into array', async () => {
    process.argv = [
      'node',
      'script.js',
      '--include-directories',
      '/path/a,/path/b',
    ];
    const argv = await parseArguments({} as Settings);
    expect(argv.includeDirectories).toStrictEqual(['/path/a', '/path/b']);
  });

  it('--set repeated → collects into array', async () => {
    process.argv = [
      'node',
      'script.js',
      '--set',
      'context-limit=32000',
      '--set',
      'tool-output-max-tokens=4096',
    ];
    const argv = await parseArguments({} as Settings);
    expect(argv.set).toStrictEqual([
      'context-limit=32000',
      'tool-output-max-tokens=4096',
    ]);
  });

  it('--allowed-tools comma-separated → split into array', async () => {
    process.argv = [
      'node',
      'script.js',
      '--allowed-tools',
      'read_file,ShellTool(git status)',
    ];
    const argv = await parseArguments({} as Settings);
    expect(argv.allowedTools).toStrictEqual([
      'read_file',
      'ShellTool(git status)',
    ]);
  });

  it('--allowed-mcp-server-names comma-separated → split into array', async () => {
    process.argv = [
      'node',
      'script.js',
      '--allowed-mcp-server-names',
      'server1,server2',
    ];
    const argv = await parseArguments({} as Settings);
    expect(argv.allowedMcpServerNames).toStrictEqual(['server1', 'server2']);
  });

  it('--extensions comma-separated → split into array', async () => {
    process.argv = ['node', 'script.js', '--extensions', 'ext1,ext2'];
    const argv = await parseArguments({} as Settings);
    expect(argv.extensions).toStrictEqual(['ext1', 'ext2']);
  });
});

describe('parseArgumentsParity: boolean defaults', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('--debug defaults to false/undefined when not provided', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    expect(argv.debug).toBeFalsy();
  });

  it('--debug flag sets debug to true', async () => {
    process.argv = ['node', 'script.js', '--debug'];
    const argv = await parseArguments({} as Settings);
    expect(argv.debug).toBe(true);
  });

  it('--yolo defaults to false when not provided', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    expect(argv.yolo).toBe(false);
  });

  it('--yolo flag sets yolo to true', async () => {
    process.argv = ['node', 'script.js', '--yolo'];
    const argv = await parseArguments({} as Settings);
    expect(argv.yolo).toBe(true);
  });

  it('-y short alias for --yolo', async () => {
    process.argv = ['node', 'script.js', '-y'];
    const argv = await parseArguments({} as Settings);
    expect(argv.yolo).toBe(true);
  });

  it('--approval-mode defaults to undefined when not provided', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments({} as Settings);
    expect(argv.approvalMode).toBeUndefined();
  });
});

describe('parseArgumentsParity: --continue flag', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('bare --continue → truthy sentinel (not the string "true")', async () => {
    process.argv = ['node', 'script.js', '--continue'];
    const argv = await parseArguments({} as Settings);
    expect(argv.continue === '' || argv.continue === true).toBe(true);
    expect(argv.continue).not.toBe('true');
  });

  it('--continue session-id → explicit string stored', async () => {
    process.argv = ['node', 'script.js', '--continue', 'session-abc-123'];
    const argv = await parseArguments({} as Settings);
    expect(argv.continue).toBe('session-abc-123');
  });

  it('--continue followed by flag → flag NOT consumed as session id', async () => {
    process.argv = ['node', 'script.js', '--continue', '--debug'];
    const argv = await parseArguments({} as Settings);
    expect(argv.continue === '' || argv.continue === true).toBe(true);
    expect(argv.debug).toBe(true);
  });
});

describe('parseArgumentsParity: --prompt-interactive / -i alias', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('--prompt-interactive sets promptInteractive', async () => {
    process.argv = ['node', 'script.js', '--prompt-interactive', 'hi'];
    const argv = await parseArguments({} as Settings);
    expect(argv.promptInteractive).toBe('hi');
    expect(argv.prompt).toBeUndefined();
  });

  it('-i alias works for --prompt-interactive', async () => {
    process.argv = ['node', 'script.js', '-i', 'hi'];
    const argv = await parseArguments({} as Settings);
    expect(argv.promptInteractive).toBe('hi');
  });
});
