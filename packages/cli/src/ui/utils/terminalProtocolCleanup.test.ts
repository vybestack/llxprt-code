/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as kittyProtocolDetector from './kittyProtocolDetector.js';
import {
  restoreTerminalProtocolsSync,
  TERMINAL_PROTOCOL_RESTORE_SEQUENCES,
} from './terminalProtocolCleanup.js';

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

describe('terminalProtocolCleanup', () => {
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

  it('restores protocols synchronously when stdout is a TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
    });

    const disableKittySpy = vi
      .spyOn(kittyProtocolDetector, 'disableDetectedTerminalProtocolsSync')
      .mockImplementation(() => {});

    restoreTerminalProtocolsSync();

    expect(disableKittySpy).toHaveBeenCalledTimes(1);
    expect(writeSyncMock).toHaveBeenCalledWith(
      process.stdout.fd,
      TERMINAL_PROTOCOL_RESTORE_SEQUENCES,
    );
  });

  it('does nothing when stdout is not a TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      configurable: true,
    });

    const disableKittySpy = vi.spyOn(
      kittyProtocolDetector,
      'disableDetectedTerminalProtocolsSync',
    );

    restoreTerminalProtocolsSync();

    expect(disableKittySpy).not.toHaveBeenCalled();
    expect(writeSyncMock).not.toHaveBeenCalled();
  });
});
