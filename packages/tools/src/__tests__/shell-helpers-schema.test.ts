/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShellTool } from '../index.js';
import type {
  IShellExecutionService,
  ShellResult,
} from '../interfaces/index.js';
import { buildCommandToExecute } from '../tools/shell-helpers.js';

const { mockPlatform } = vi.hoisted(() => ({
  mockPlatform: vi.fn(() => 'darwin'),
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    default: { platform: mockPlatform, EOL: actual.EOL },
    platform: mockPlatform,
    EOL: actual.EOL,
  };
});

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
    mockPlatform.mockReturnValue('win32');
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
    mockPlatform.mockReturnValue('darwin');

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

describe('buildCommandToExecute foreground wrapping (non-Windows)', () => {
  beforeEach(() => {
    vi.mocked(os.platform).mockReturnValue('darwin');
  });

  it('wraps a foreground command in the expected group wrapper', () => {
    expect(buildCommandToExecute('npm run dev', false, '/tmp/t')).toBe(
      '{ npm run dev; }; __code=$?; pgrep -g 0 >/tmp/t 2>&1; exit $__code;',
    );
  });

  it('normalises a single trailing ; in the command body', () => {
    const built = buildCommandToExecute('echo hi;', false, '/tmp/t');
    expect(built).toContain('{ echo hi; }');
    expect(built).not.toContain(';;');
  });
});

describe('buildCommandToExecute on Windows', () => {
  beforeEach(() => {
    vi.mocked(os.platform).mockReturnValue('win32');
  });

  it('returns the command unchanged', () => {
    const command = 'Write-Output hello';
    expect(buildCommandToExecute(command, true, '/unused')).toBe(command);
  });
});

describe('ShellTool schema is_background property', () => {
  it('exposes is_background as a boolean with the managed job contract on non-Windows', () => {
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
      typeof description === 'string' &&
        description.includes('check_async_tasks'),
    ).toBe(true);
    expect(
      typeof description === 'string' && description.includes('job id'),
    ).toBe(true);
  });

  it('does not expose is_background on Windows', () => {
    vi.mocked(os.platform).mockReturnValue('win32');

    const properties = getObjectProperty(
      createShellTool().schema.parametersJsonSchema,
      'properties',
    );
    expect(getObjectProperty(properties, 'is_background')).toBeUndefined();
  });
});

describe('ShellTool description mentions managed background jobs', () => {
  it('documents the trailing & managed job path on non-Windows', () => {
    vi.mocked(os.platform).mockReturnValue('darwin');

    const description = createShellTool().schema.description ?? '';
    expect(description).toContain('managed background job');
    expect(description).toContain('check_async_tasks');
    expect(description).toContain('daemonizes');
  });
});
