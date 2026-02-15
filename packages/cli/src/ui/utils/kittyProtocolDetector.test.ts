/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disableDetectedTerminalProtocolsSync } from './kittyProtocolDetector.js';

const { writeSyncMock } = vi.hoisted(() => ({
  writeSyncMock: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const actualWithDefault = actual as typeof import('node:fs') & {
    default?: Record<string, unknown>;
  };
  return {
    ...actual,
    default: {
      ...(actualWithDefault.default ?? {}),
      writeSync: writeSyncMock,
    },
    writeSync: writeSyncMock,
  };
});

describe('kittyProtocolDetector.disableDetectedTerminalProtocolsSync', () => {
  const originalIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    vi.restoreAllMocks();
    writeSyncMock.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
    });
    vi.restoreAllMocks();
    writeSyncMock.mockReset();
  });

  it('writes robust kitty disable sequence on TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
    });

    disableDetectedTerminalProtocolsSync();

    expect(writeSyncMock.mock.calls).toEqual([
      [process.stdout.fd, '\x1b[<u'],
      [process.stdout.fd, '\x1b[?1049l'],
      [process.stdout.fd, '\x1b[<u'],
      [process.stdout.fd, '\x1b[=0;1u'],
      [process.stdout.fd, '\x1b[?1006l'],
    ]);
  });

  it('does nothing on non-TTY stdout', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      configurable: true,
    });

    disableDetectedTerminalProtocolsSync();
    expect(writeSyncMock).not.toHaveBeenCalled();
  });
});
