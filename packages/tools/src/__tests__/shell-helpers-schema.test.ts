/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { ShellTool } from '../index.js';
import type {
  IShellExecutionService,
  ShellResult,
} from '../interfaces/index.js';
import {
  buildCommandToExecute,
  singleQuoteForShell,
} from '../tools/shell-helpers.js';

const { mockPlatform } = {
  mockPlatform: vi.fn(() => 'darwin'),
};

const actual = { ...(await import('node:os')) };
void vi.mock('node:os', () => ({
  default: { platform: mockPlatform, EOL: actual.EOL },
  platform: mockPlatform,
  EOL: actual.EOL,
}));

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

  it('describes managed background jobs with Start-Process and taskkill guidance', () => {
    const description = createShellTool().schema.description ?? '';

    expect({
      managedJob: description.includes('managed background job'),
      checkAsyncTasks: description.includes('check_async_tasks'),
      startProcess: description.includes('Start-Process'),
      taskkill: description.includes('taskkill /T /F /PID'),
    }).toStrictEqual({
      managedJob: true,
      checkAsyncTasks: true,
      startProcess: true,
      taskkill: true,
    });
  });

  it('does not advertise POSIX kill -- -PGID in the Windows description', () => {
    const description = createShellTool().schema.description ?? '';
    expect(description).not.toContain('kill -- -PGID');
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
    mockPlatform.mockReturnValue('darwin');
  });

  it('wraps a foreground command in an EXIT trap followed by the trimmed body', () => {
    const built = buildCommandToExecute('npm run dev', false, '/tmp/t');
    const action = `__code=$?; pgrep -g 0 >${singleQuoteForShell('/tmp/t')} 2>&1; exit $__code`;
    expect(built).toBe(`trap ${singleQuoteForShell(action)} EXIT
npm run dev`);
  });

  it('keeps a caller-supplied trailing ; in the body verbatim', () => {
    const built = buildCommandToExecute('echo hi;', false, '/tmp/t');
    const newline = String.fromCharCode(10);
    expect(built.endsWith(`${newline}echo hi;`)).toBe(true);
    expect(built).not.toContain('{ echo hi');
  });
});

describe('buildCommandToExecute on Windows', () => {
  beforeEach(() => {
    mockPlatform.mockReturnValue('win32');
  });

  it('returns the command unchanged', () => {
    const command = 'Write-Output hello';
    expect(buildCommandToExecute(command, true, '/unused')).toBe(command);
  });
});

describe('ShellTool schema is_background property', () => {
  it('exposes is_background as a boolean with the managed job contract on non-Windows', () => {
    mockPlatform.mockReturnValue('darwin');

    const properties = getObjectProperty(
      createShellTool().schema.parametersJsonSchema,
      'properties',
    );
    const isBackground = getObjectProperty(properties, 'is_background');
    expect(isBackground).toBeDefined();
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

  it('exposes is_background on Windows with the managed job contract', () => {
    mockPlatform.mockReturnValue('win32');

    const properties = getObjectProperty(
      createShellTool().schema.parametersJsonSchema,
      'properties',
    );
    const isBackground = getObjectProperty(properties, 'is_background');
    expect(isBackground).toBeDefined();
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
});

describe('ShellTool description mentions managed background jobs', () => {
  it('documents the trailing & managed job path on non-Windows', () => {
    mockPlatform.mockReturnValue('darwin');

    const description = createShellTool().schema.description ?? '';
    expect(description).toContain('managed background job');
    expect(description).toContain('check_async_tasks');
    expect(description).toContain('daemonizes');
  });
});

describe('ShellTool timeout_seconds description (Issue #3031)', () => {
  function getTimeoutDescription(): string {
    const properties = getObjectProperty(
      createShellTool().schema.parametersJsonSchema,
      'properties',
    );
    const property = getObjectProperty(properties, 'timeout_seconds');
    const description = getObjectProperty(property, 'description');
    return typeof description === 'string' ? description : '';
  }

  it('names the configured default setting', () => {
    mockPlatform.mockReturnValue('darwin');
    expect(getTimeoutDescription()).toContain('shell-default-timeout-seconds');
  });

  it('names the configured maximum setting', () => {
    mockPlatform.mockReturnValue('darwin');
    expect(getTimeoutDescription()).toContain('shell-max-timeout-seconds');
  });

  it('documents the -1 semantics', () => {
    mockPlatform.mockReturnValue('darwin');
    const description = getTimeoutDescription();
    expect(description).toContain('-1');
    expect(description.toLowerCase()).toContain('maximum');
  });

  it('states the accepted domain: -1 or a finite number greater than zero', () => {
    mockPlatform.mockReturnValue('darwin');
    const description = getTimeoutDescription();
    expect(description.toLowerCase()).toContain('greater than zero');
    expect(description).toContain('-1');
  });

  it('states that 0 and other non-positive values are rejected', () => {
    mockPlatform.mockReturnValue('darwin');
    const description = getTimeoutDescription();
    expect(description.toLowerCase()).toContain('non-positive');
    expect(description.toLowerCase()).toContain('reject');
  });

  it('states that a short positive request is honoured exactly', () => {
    mockPlatform.mockReturnValue('darwin');
    const description = getTimeoutDescription();
    expect(description.toLowerCase()).toContain('honoured exactly');
  });

  it('states that a request above the maximum is clamped', () => {
    mockPlatform.mockReturnValue('darwin');
    expect(getTimeoutDescription().toLowerCase()).toContain('clamp');
  });

  it('gives the model a cue to set an explicit timeout', () => {
    mockPlatform.mockReturnValue('darwin');
    expect(getTimeoutDescription().toLowerCase()).toContain('explicit timeout');
  });

  it('does not bake in the current numeric default (300)', () => {
    mockPlatform.mockReturnValue('darwin');
    expect(getTimeoutDescription()).not.toContain('300');
  });

  it('does not bake in the current numeric maximum (900)', () => {
    mockPlatform.mockReturnValue('darwin');
    expect(getTimeoutDescription()).not.toContain('900');
  });
});
