/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'node:os';
import { ShellTool } from '../index.js';
import type {
  IShellExecutionService,
  ShellResult,
} from '../interfaces/index.js';
import { buildCommandToExecute } from '../tools/shell-helpers.js';

vi.mock('node:os');

function createFakeShellService(): IShellExecutionService {
  return {
    execute: async (): Promise<ShellResult> => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      aborted: false,
    }),
    isCommandAllowed: () => true,
  };
}

function createShellTool(): ShellTool {
  return new ShellTool(createFakeShellService());
}

function getObjectProperty(value: unknown, property: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  return Reflect.get(value, property);
}

function getCommandDescription(tool: ShellTool): string {
  const properties = getObjectProperty(
    tool.schema.parametersJsonSchema,
    'properties',
  );
  const command = getObjectProperty(properties, 'command');
  const description = getObjectProperty(command, 'description');
  return typeof description === 'string' ? description : '';
}

describe('ShellTool schema guidance on Windows', () => {
  beforeEach(() => {
    vi.mocked(os.platform).mockReturnValue('win32');
  });

  it('describes the PowerShell runtime invocation', () => {
    const description = createShellTool().schema.description ?? '';

    expect({
      PowerShell: description.includes('PowerShell'),
      powershellExecutable: description.includes('powershell.exe'),
      pwshExecutable: description.includes('pwsh'),
      invocationFlags: description.includes('-NoProfile -Command'),
    }).toStrictEqual({
      PowerShell: true,
      powershellExecutable: true,
      pwshExecutable: true,
      invocationFlags: true,
    });
  });

  it('describes the command parameter as PowerShell input', () => {
    const description = getCommandDescription(createShellTool());

    expect({
      PowerShell: description.includes('PowerShell'),
      powershellExecutable: description.includes('powershell.exe'),
      pwshExecutable: description.includes('pwsh'),
      invocationFlags: description.includes('-NoProfile -Command'),
    }).toStrictEqual({
      PowerShell: true,
      powershellExecutable: true,
      pwshExecutable: true,
      invocationFlags: true,
    });
  });

  it('guides the model to quote literal paths using PowerShell syntax', () => {
    expect(createShellTool().schema.description).toContain(
      'represent an apostrophe inside a single-quoted path with two single quotes',
    );
  });

  it('does not advertise cmd.exe syntax', () => {
    expect(JSON.stringify(createShellTool().schema)).not.toMatch(
      /cmd\.exe \/c|start \/b/,
    );
  });
});

describe('Windows command preparation', () => {
  it.each([
    [
      'directory creation',
      "New-Item -ItemType Directory -Force -Path 'C:\\Users\\UlknAries\\Desktop\\My Games'",
    ],
    [
      'file move with apostrophes and non-ASCII characters',
      "Move-Item -LiteralPath 'C:\\Users\\UlknAries\\Desktop\\Assassin''s Creed Shadows.url' -Destination 'C:\\Users\\UlknAries\\Desktop\\игры\\Assassin''s Creed Shadows.url'",
    ],
  ])('passes through a quoted %s command unchanged', (_behavior, command) => {
    expect(buildCommandToExecute(command, true, '/unused')).toBe(command);
  });
});

describe('ShellTool schema guidance on non-Windows platforms', () => {
  it('preserves bash guidance', () => {
    vi.mocked(os.platform).mockReturnValue('darwin');

    expect(createShellTool().schema).toMatchObject({
      description: expect.stringContaining('bash -c'),
      parametersJsonSchema: {
        properties: {
          command: {
            description: expect.stringContaining('bash -c'),
          },
        },
      },
    });
  });
});

describe('buildCommandToExecute background wrapping (non-Windows)', () => {
  beforeEach(() => {
    vi.mocked(os.platform).mockReturnValue('darwin');
  });

  it('wraps the command in a backgrounded group with trap and redirects when a log path is given (T1 / AC-2)', () => {
    expect(
      buildCommandToExecute('npm run dev', false, '/tmp/t', '/tmp/bg.log'),
    ).toBe(
      "{ { trap '' HUP; npm run dev; } >'/tmp/bg.log' 2>&1 </dev/null & }; __code=$?; pgrep -g 0 >/tmp/t 2>&1; exit $__code;",
    );
  });

  it('produces today foreground string and no log path when backgroundLogPath is absent (T2 / AC-6)', () => {
    expect(buildCommandToExecute('npm run dev', false, '/tmp/t')).toBe(
      '{ npm run dev; }; __code=$?; pgrep -g 0 >/tmp/t 2>&1; exit $__code;',
    );
  });

  it('does not double-background a command already ending with & (T3 / AC-4)', () => {
    const background = buildCommandToExecute(
      'long-running-job &',
      false,
      '/tmp/t',
      '/tmp/bg.log',
    );
    expect(background).toBe(
      "{ { trap '' HUP; long-running-job & } >'/tmp/bg.log' 2>&1 </dev/null & }; __code=$?; pgrep -g 0 >/tmp/t 2>&1; exit $__code;",
    );
    expect(background).not.toContain('&&');
    expect(background).not.toContain('& } &');
  });

  it('a command already ending with & in foreground mode is unchanged from today (T4 / AC-4/6)', () => {
    const foreground = buildCommandToExecute(
      'long-running-job &',
      false,
      '/tmp/t',
    );
    expect(foreground).toBe(
      '{ long-running-job & }; __code=$?; pgrep -g 0 >/tmp/t 2>&1; exit $__code;',
    );
  });

  it('normalises a single trailing ; in the non-background path (T5 / AC-5)', () => {
    const built = buildCommandToExecute('echo hi;', false, '/tmp/t');
    expect(built).toContain('{ echo hi; }');
    expect(built).not.toContain(';;');
  });

  it('normalises a single trailing ; in the background path (T6 / AC-5)', () => {
    const built = buildCommandToExecute(
      'echo hi;',
      false,
      '/tmp/t',
      '/tmp/bg.log',
    );
    expect(built).toContain("{ trap '' HUP; echo hi; } >'/tmp/bg.log'");
    expect(built).not.toContain(';;');
  });

  it('default backgroundLogPath argument keeps existing behaviour (AC-6)', () => {
    expect(buildCommandToExecute('echo hi', false, '/tmp/t')).toBe(
      '{ echo hi; }; __code=$?; pgrep -g 0 >/tmp/t 2>&1; exit $__code;',
    );
  });
});

describe('buildCommandToExecute on Windows', () => {
  beforeEach(() => {
    vi.mocked(os.platform).mockReturnValue('win32');
  });

  it('returns the command unchanged for both flag values (T7 / AC-7)', () => {
    const command = 'Write-Output hello';
    expect(buildCommandToExecute(command, true, '/unused')).toBe(command);
    expect(buildCommandToExecute(command, true, '/unused', '/unused.log')).toBe(
      command,
    );
  });
});

describe('ShellTool schema is_background property', () => {
  it('exposes is_background as a boolean with a description mentioning the log file on non-Windows (T8 / AC-1)', () => {
    vi.mocked(os.platform).mockReturnValue('darwin');

    const properties = getObjectProperty(
      createShellTool().schema.parametersJsonSchema,
      'properties',
    );
    const isBackground = getObjectProperty(properties, 'is_background');
    expect(getObjectProperty(isBackground, 'type')).toBe('boolean');
    const description = getObjectProperty(isBackground, 'description');
    expect(typeof description).toBe('string');
    expect(
      typeof description === 'string' && description.includes('log file'),
    ).toBe(true);
    // The log lives in os.tmpdir(), outside the workspace, so the schema
    // must tell the model to read it with a shell command rather than a
    // file-reading tool.
    expect(
      typeof description === 'string' && description.includes('shell command'),
    ).toBe(true);
  });

  it('does not expose is_background on Windows (T9 / AC-7)', () => {
    vi.mocked(os.platform).mockReturnValue('win32');

    const properties = getObjectProperty(
      createShellTool().schema.parametersJsonSchema,
      'properties',
    );
    expect(getObjectProperty(properties, 'is_background')).toBeUndefined();
  });
});
