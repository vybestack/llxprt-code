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
