/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import { TerminalCapabilityManager } from './terminalCapabilityManager.js';
import { EventEmitter } from 'node:events';

// Mock fs
void vi.mock('node:fs', () => ({
  writeSync: vi.fn(),
}));

// Mock core
void vi.mock('@vybestack/llxprt-code-core', () => ({
  enableKittyKeyboardProtocol: vi.fn(),
  disableKittyKeyboardProtocol: vi.fn(),
  enableModifyOtherKeys: vi.fn(),
  disableModifyOtherKeys: vi.fn(),
  enableBracketedPasteMode: vi.fn(),
  disableBracketedPasteMode: vi.fn(),
  DebugLogger: vi.fn(() => ({
    log: vi.fn(),
    warn: vi.fn(),
  })),
}));

describe('TerminalCapabilityManager', () => {
  let stdin: EventEmitter & {
    isTTY?: boolean;
    isRaw?: boolean;
    setRawMode?: (mode: boolean) => void;
    removeListener?: (
      event: string,
      listener: (...args: unknown[]) => void,
    ) => void;
  };
  let stdout: { isTTY?: boolean; fd?: number };
  // Save original process properties
  const originalStdin = process.stdin;
  const originalStdout = process.stdout;

  beforeEach(() => {
    vi.resetAllMocks();

    // Reset singleton
    TerminalCapabilityManager.resetInstanceForTesting();

    // Setup process mocks
    stdin = new EventEmitter();
    stdin.isTTY = true;
    stdin.isRaw = false;
    stdin.setRawMode = vi.fn();
    stdin.removeListener = vi.fn();

    stdout = { isTTY: true, fd: 1 };

    // Use defineProperty to mock process.stdin/stdout
    Object.defineProperty(process, 'stdin', {
      value: stdin,
      configurable: true,
    });
    Object.defineProperty(process, 'stdout', {
      value: stdout,
      configurable: true,
    });

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Restore original process properties
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      configurable: true,
    });
    Object.defineProperty(process, 'stdout', {
      value: originalStdout,
      configurable: true,
    });
  });

  it('should detect Kitty support when u response is received', async () => {
    const manager = TerminalCapabilityManager.getInstance();
    const promise = manager.detectCapabilities();

    // Simulate Kitty response: \x1b[?1u
    stdin.emit('data', Buffer.from('\x1b[?1u'));
    // Complete detection with DA1
    stdin.emit('data', Buffer.from('\x1b[?62c'));

    await promise;
    expect(manager.isKittyProtocolEnabled()).toBe(true);
  });

  it('should detect Background Color', async () => {
    const manager = TerminalCapabilityManager.getInstance();
    const promise = manager.detectCapabilities();

    // Simulate OSC 11 response
    // \x1b]11;rgb:0000/ff00/0000\x1b\
    // RGB: 0, 255, 0 -> #00ff00
    stdin.emit('data', Buffer.from('\x1b]11;rgb:0000/ffff/0000\x1b\\'));
    // Complete detection with DA1
    stdin.emit('data', Buffer.from('\x1b[?62c'));

    await promise;
    expect(manager.getTerminalBackgroundColor()).toBe('#00ff00');
  });

  it('should detect Terminal Name', async () => {
    const manager = TerminalCapabilityManager.getInstance();
    const promise = manager.detectCapabilities();

    // Simulate Terminal Name response
    stdin.emit('data', Buffer.from('\x1bP>|WezTerm 20240203\x1b\\'));
    // Complete detection with DA1
    stdin.emit('data', Buffer.from('\x1b[?62c'));

    await promise;
    expect(manager.getTerminalName()).toBe('WezTerm 20240203');
  });

  it('should complete early if sentinel (DA1) is found', async () => {
    const manager = TerminalCapabilityManager.getInstance();
    const promise = manager.detectCapabilities();

    stdin.emit('data', Buffer.from('\x1b[?1u'));
    stdin.emit('data', Buffer.from('\x1b]11;rgb:0000/0000/0000\x1b\\'));
    // Sentinel
    stdin.emit('data', Buffer.from('\x1b[?62c'));

    // Should resolve without waiting for timeout
    await promise;

    expect(manager.isKittyProtocolEnabled()).toBe(true);
    expect(manager.getTerminalBackgroundColor()).toBe('#000000');
  });

  it('should timeout if no DA1 (c) is received', async () => {
    const manager = TerminalCapabilityManager.getInstance();
    const promise = manager.detectCapabilities();

    // Simulate only Kitty response
    stdin.emit('data', Buffer.from('\x1b[?1u'));

    // Advance to timeout
    vi.advanceTimersByTime(1000);

    await promise;
    expect(manager.isKittyProtocolEnabled()).toBe(true);
  });

  it('should not detect Kitty if only DA1 (c) is received', async () => {
    const manager = TerminalCapabilityManager.getInstance();
    const promise = manager.detectCapabilities();

    // Simulate DA1 response only: \x1b[?62;c
    stdin.emit('data', Buffer.from('\x1b[?62c'));

    await promise;
    expect(manager.isKittyProtocolEnabled()).toBe(false);
  });

  it('should handle split chunks', async () => {
    const manager = TerminalCapabilityManager.getInstance();
    const promise = manager.detectCapabilities();

    // Split response: \x1b[? 1u
    stdin.emit('data', Buffer.from('\x1b[?'));
    stdin.emit('data', Buffer.from('1u'));
    // Complete with DA1
    stdin.emit('data', Buffer.from('\x1b[?62c'));

    await promise;
    expect(manager.isKittyProtocolEnabled()).toBe(true);
  });

  it('should not attempt detection in non-TTY mode', async () => {
    stdin.isTTY = false;
    const manager = TerminalCapabilityManager.getInstance();

    await manager.detectCapabilities();

    expect(manager.isKittyProtocolEnabled()).toBe(false);
    expect(manager.getTerminalBackgroundColor()).toBeUndefined();
    expect(manager.getTerminalName()).toBeUndefined();
  });

  it('should detect modifyOtherKeys support level 2', async () => {
    const { enableModifyOtherKeys } = await import(
      '@vybestack/llxprt-code-core'
    );
    const manager = TerminalCapabilityManager.getInstance();
    const promise = manager.detectCapabilities();

    // Simulate modifyOtherKeys response: CSI > 4 ; 2 m
    stdin.emit('data', Buffer.from('\x1b[>4;2m'));
    // Complete detection with DA1
    stdin.emit('data', Buffer.from('\x1b[?62c'));

    await promise;

    expect(enableModifyOtherKeys).toHaveBeenCalled();
  });

  it('should not enable modifyOtherKeys for level 1', async () => {
    const { enableModifyOtherKeys } = await import(
      '@vybestack/llxprt-code-core'
    );
    const manager = TerminalCapabilityManager.getInstance();
    const promise = manager.detectCapabilities();

    // Simulate modifyOtherKeys response: CSI > 4 ; 1 m
    stdin.emit('data', Buffer.from('\x1b[>4;1m'));
    // Complete detection with DA1
    stdin.emit('data', Buffer.from('\x1b[?62c'));

    await promise;

    expect(enableModifyOtherKeys).not.toHaveBeenCalled();
  });

  it('should handle OSC 11 response with BEL terminator', async () => {
    const manager = TerminalCapabilityManager.getInstance();
    const promise = manager.detectCapabilities();

    // Simulate OSC 11 response with BEL terminator
    // \x1b]11;rgb:ffff/0000/0000\x07
    // RGB: 255, 0, 0 -> #ff0000
    stdin.emit('data', Buffer.from('\x1b]11;rgb:ffff/0000/0000\x07'));
    // Complete detection with DA1
    stdin.emit('data', Buffer.from('\x1b[?62c'));

    await promise;
    expect(manager.getTerminalBackgroundColor()).toBe('#ff0000');
  });

  it('should enable Kitty protocol when supported', async () => {
    const { enableKittyKeyboardProtocol, enableModifyOtherKeys } = await import(
      '@vybestack/llxprt-code-core'
    );
    const manager = TerminalCapabilityManager.getInstance();
    const promise = manager.detectCapabilities();

    stdin.emit('data', Buffer.from('\x1b[?1u'));
    stdin.emit('data', Buffer.from('\x1b[?62c'));

    await promise;
    expect(manager.isKittyProtocolEnabled()).toBe(true);

    expect(enableKittyKeyboardProtocol).toHaveBeenCalled();
    expect(enableModifyOtherKeys).not.toHaveBeenCalled();
  });

  it('should disable Kitty protocol (simple)', async () => {
    const { disableKittyKeyboardProtocol } = await import(
      '@vybestack/llxprt-code-core'
    );
    const manager = TerminalCapabilityManager.getInstance();
    const promise = manager.detectCapabilities();

    stdin.emit('data', Buffer.from('\x1b[?1u'));
    stdin.emit('data', Buffer.from('\x1b[?62c'));

    await promise;
    expect(manager.isKittyProtocolEnabled()).toBe(true);

    manager.disableKittyProtocol();
    expect(manager.isKittyProtocolEnabled()).toBe(false);

    expect(disableKittyKeyboardProtocol).toHaveBeenCalled();
  });

  it('should enable modifyOtherKeys when Kitty is not supported', async () => {
    const { enableModifyOtherKeys } = await import(
      '@vybestack/llxprt-code-core'
    );
    const manager = TerminalCapabilityManager.getInstance();
    const promise = manager.detectCapabilities();

    // Simulate only modifyOtherKeys level 2 response (no Kitty)
    stdin.emit('data', Buffer.from('\x1b[>4;2m'));
    // Complete detection with DA1
    stdin.emit('data', Buffer.from('\x1b[?62c'));

    await promise;

    expect(manager.isKittyProtocolEnabled()).toBe(false);
    expect(enableModifyOtherKeys).toHaveBeenCalled();
  });

  it('should enable modifyOtherKeys when only DA1 is received', async () => {
    const { enableModifyOtherKeys } = await import(
      '@vybestack/llxprt-code-core'
    );
    const manager = TerminalCapabilityManager.getInstance();
    const promise = manager.detectCapabilities();

    // Simulate only DA1 response (no Kitty, no explicit MOK response)
    stdin.emit('data', Buffer.from('\x1b[?62c'));

    await promise;

    expect(enableModifyOtherKeys).toHaveBeenCalled();
  });

  it('should disable Kitty protocol on exit synchronously on TTY', async () => {
    const { writeSync } = await import('node:fs');
    const manager = TerminalCapabilityManager.getInstance();
    const promise = manager.detectCapabilities();

    stdin.emit('data', Buffer.from('\x1b[?1u'));
    stdin.emit('data', Buffer.from('\x1b[?62c'));

    await promise;
    expect(manager.isKittyProtocolEnabled()).toBe(true);

    (writeSync as unknown as Mock<typeof writeSync>).mockClear();
    manager.disableKittyProtocolOnExit();
    expect(manager.isKittyProtocolEnabled()).toBe(false);

    expect(
      (writeSync as unknown as Mock<typeof writeSync>).mock.calls,
    ).toStrictEqual([
      [stdout.fd as number, '\x1b[<u'],
      [stdout.fd as number, '\x1b[?1049l'],
      [stdout.fd as number, '\x1b[<u'],
      [stdout.fd as number, '\x1b[=0;1u'],
      [stdout.fd as number, '\x1b[?1006l'],
    ]);
  });

  it('should skip synchronous writes on non-TTY when disabling on exit', async () => {
    const { writeSync } = await import('node:fs');
    const manager = TerminalCapabilityManager.getInstance();
    const promise = manager.detectCapabilities();

    stdin.emit('data', Buffer.from('\x1b[?1u'));
    stdin.emit('data', Buffer.from('\x1b[?62c'));

    await promise;
    expect(manager.isKittyProtocolEnabled()).toBe(true);

    (writeSync as unknown as Mock<typeof writeSync>).mockClear();
    stdout.isTTY = false;
    manager.disableKittyProtocolOnExit();
    expect(manager.isKittyProtocolEnabled()).toBe(false);

    expect(
      writeSync as unknown as Mock<typeof writeSync>,
    ).not.toHaveBeenCalled();
  });

  it('should re-enable Kitty protocol after disable', async () => {
    const { enableKittyKeyboardProtocol } = await import(
      '@vybestack/llxprt-code-core'
    );
    const manager = TerminalCapabilityManager.getInstance();
    const promise = manager.detectCapabilities();

    stdin.emit('data', Buffer.from('\x1b[?1u'));
    stdin.emit('data', Buffer.from('\x1b[?62c'));

    await promise;

    (
      enableKittyKeyboardProtocol as Mock<typeof enableKittyKeyboardProtocol>
    ).mockClear();

    manager.disableKittyProtocol();
    manager.enableKittyProtocol();

    expect(manager.isKittyProtocolEnabled()).toBe(true);
    expect(enableKittyKeyboardProtocol).toHaveBeenCalled();
  });

  it('should handle detection already complete', async () => {
    const manager = TerminalCapabilityManager.getInstance();

    // First detection
    const promise1 = manager.detectCapabilities();
    stdin.emit('data', Buffer.from('\x1b[?62c'));
    await promise1;

    // Second detection should return immediately
    const promise2 = manager.detectCapabilities();
    await promise2;

    expect(manager.isKittyProtocolEnabled()).toBe(false);
  });

  it('should detect terminal with background color, name, and enable modifyOtherKeys', async () => {
    const { enableModifyOtherKeys } = await import(
      '@vybestack/llxprt-code-core'
    );
    const manager = TerminalCapabilityManager.getInstance();
    const promise = manager.detectCapabilities();

    // Simulate tmux terminal with background color
    stdin.emit('data', Buffer.from('\x1b]11;rgb:1a1a/1a1a/1a1a\x1b\\'));
    stdin.emit('data', Buffer.from('\x1bP>|tmux\x1b\\'));
    stdin.emit('data', Buffer.from('\x1b[?62c'));

    await promise;

    expect(manager.getTerminalBackgroundColor()).toBe('#1a1a1a');
    expect(manager.getTerminalName()).toBe('tmux');

    expect(enableModifyOtherKeys).toHaveBeenCalled();
  });

  it('should infer modifyOtherKeys support from Device Attributes (DA1) alone', async () => {
    const { enableModifyOtherKeys } = await import(
      '@vybestack/llxprt-code-core'
    );
    const manager = TerminalCapabilityManager.getInstance();
    const promise = manager.detectCapabilities();

    // Simulate only DA1 response (no specific MOK or Kitty response)
    stdin.emit('data', Buffer.from('\x1b[?62c'));

    await promise;

    expect(manager.isKittyProtocolEnabled()).toBe(false);
    // It should fall back to modifyOtherKeys because DA1 proves it's an ANSI terminal

    expect(enableModifyOtherKeys).toHaveBeenCalled();
  });

  describe('bracketed paste state', () => {
    it('state is true after enableBracketedPasteMode', async () => {
      const manager = TerminalCapabilityManager.getInstance();
      const promise = manager.detectCapabilities();

      // Complete detection with DA1 (enables bracketed paste)
      stdin.emit('data', Buffer.from('\x1b[?62c'));

      await promise;
      expect(manager.isBracketedPasteEnabled()).toBe(true);
    });

    it('state is false after disableBracketedPasteMode', async () => {
      const manager = TerminalCapabilityManager.getInstance();
      const promise = manager.detectCapabilities();

      stdin.emit('data', Buffer.from('\x1b[?62c'));

      await promise;
      expect(manager.isBracketedPasteEnabled()).toBe(true);

      manager.disableBracketedPasteMode();
      expect(manager.isBracketedPasteEnabled()).toBe(false);
    });

    it('state remains true on repeated enable calls', async () => {
      const manager = TerminalCapabilityManager.getInstance();
      const promise = manager.detectCapabilities();

      stdin.emit('data', Buffer.from('\x1b[?62c'));

      await promise;
      expect(manager.isBracketedPasteEnabled()).toBe(true);

      // Call enable again - should remain true
      manager.enableBracketedPasteMode();
      expect(manager.isBracketedPasteEnabled()).toBe(true);
    });
  });

  describe('AC5 kitty protocol enable and cleanup', () => {
    it('registers an exit listener that tears the protocol down after kitty detection (AC5.2)', async () => {
      const manager = TerminalCapabilityManager.getInstance();
      const before = new Set<unknown>(process.listeners('exit'));

      const promise = manager.detectCapabilities();
      stdin.emit('data', Buffer.from('\x1b[?1u'));
      stdin.emit('data', Buffer.from('\x1b[?62c'));
      await promise;

      expect(manager.isKittyProtocolEnabled()).toBe(true);

      // Counting listeners would not prove anything: run each newly added
      // handler and require that the protocol actually ends up disabled.
      const added = process
        .listeners('exit')
        .filter((listener) => !before.has(listener));
      expect(added.length).toBeGreaterThan(0);
      for (const listener of added) {
        listener(0);
      }

      expect(manager.isKittyProtocolEnabled()).toBe(false);
    });

    it('does not accumulate exit/SIGTERM/SIGINT listeners after resetInstanceForTesting (AC5.3)', async () => {
      const manager = TerminalCapabilityManager.getInstance();
      const preexisting = {
        exit: new Set<unknown>(process.listeners('exit')),
        SIGTERM: new Set<unknown>(process.listeners('SIGTERM')),
        SIGINT: new Set<unknown>(process.listeners('SIGINT')),
      };
      const currentListeners = (
        signal: 'exit' | 'SIGTERM' | 'SIGINT',
      ): unknown[] => {
        if (signal === 'exit') return process.listeners('exit');
        if (signal === 'SIGTERM') return process.listeners('SIGTERM');
        return process.listeners('SIGINT');
      };
      const survivors = (signal: 'exit' | 'SIGTERM' | 'SIGINT'): unknown[] =>
        currentListeners(signal).filter(
          (listener) => !preexisting[signal].has(listener),
        );

      const promise = manager.detectCapabilities();
      stdin.emit('data', Buffer.from('\x1b[?1u'));
      stdin.emit('data', Buffer.from('\x1b[?62c'));
      await promise;
      expect(survivors('exit').length).toBeGreaterThan(0);

      TerminalCapabilityManager.resetInstanceForTesting();

      // Nothing detection registered outlives the reset.
      expect(survivors('exit')).toStrictEqual([]);
      expect(survivors('SIGTERM')).toStrictEqual([]);
      expect(survivors('SIGINT')).toStrictEqual([]);
    });

    it('disableKittyProtocol emits the disable sequence only while enabled (AC5.4)', async () => {
      const { disableKittyKeyboardProtocol } = await import(
        '@vybestack/llxprt-code-core'
      );
      const disableMock = disableKittyKeyboardProtocol as Mock<() => void>;
      const manager = TerminalCapabilityManager.getInstance();

      // Never enabled: nothing is written to the terminal.
      manager.disableKittyProtocol();
      expect(manager.isKittyProtocolEnabled()).toBe(false);
      expect(disableMock.mock.calls).toHaveLength(0);

      const promise = manager.detectCapabilities();
      stdin.emit('data', Buffer.from('\x1b[?1u'));
      stdin.emit('data', Buffer.from('\x1b[?62c'));
      await promise;
      expect(manager.isKittyProtocolEnabled()).toBe(true);

      // Enabled: the first disable writes, the second is suppressed by the
      // enabled guard rather than emitting a redundant sequence.
      manager.disableKittyProtocol();
      expect(manager.isKittyProtocolEnabled()).toBe(false);
      expect(disableMock.mock.calls).toHaveLength(1);

      manager.disableKittyProtocol();
      expect(disableMock.mock.calls).toHaveLength(1);
    });
  });

  describe('AC7 detection timeout and skip env', () => {
    /**
     * Mirrors the detection timeout in TerminalCapabilityManager, which is a
     * module-private literal. If the production value ever grows past this,
     * the timeout-path tests below stop reaching cleanup and hang until the
     * per-test budget instead of failing with a useful message.
     */
    const DETECTION_TIMEOUT_MS = 1000;

    const createRealTTYStdin = (
      isRawValue: boolean,
    ): EventEmitter & {
      isTTY?: boolean;
      isRaw?: boolean;
      setRawMode?: (mode: boolean) => void;
    } => {
      const stream: EventEmitter & {
        isTTY?: boolean;
        isRaw?: boolean;
        setRawMode?: (mode: boolean) => void;
      } = new EventEmitter();
      stream.isTTY = true;
      stream.isRaw = isRawValue;
      stream.setRawMode = vi.fn();
      return stream;
    };

    it('timeout with no DA1 reply completes and still applies bracketed paste (AC7.1)', async () => {
      const manager = TerminalCapabilityManager.getInstance();
      const promise = manager.detectCapabilities();

      // The terminal never answers any query.
      vi.advanceTimersByTime(DETECTION_TIMEOUT_MS);
      await promise;

      // Timeout is a completion path, not a failure path: supported modes
      // are still applied even though nothing was detected.
      expect(manager.isBracketedPasteEnabled()).toBe(true);
      expect(manager.isKittyProtocolEnabled()).toBe(false);
    });

    it('restores raw mode when it turned it on (AC7.2, started raw false)', async () => {
      const rawStream = createRealTTYStdin(false);
      Object.defineProperty(process, 'stdin', {
        value: rawStream,
        configurable: true,
      });

      const manager = TerminalCapabilityManager.getInstance();
      const promise = manager.detectCapabilities();
      rawStream.emit('data', Buffer.from('\x1b[?62c'));
      await promise;

      const setRawCalls = (
        rawStream.setRawMode as Mock<(mode: boolean) => void>
      ).mock.calls.map((call) => call[0]);
      expect(setRawCalls).toStrictEqual([true, false]);
    });

    it('leaves raw mode alone when something else already set it (AC7.2, started raw true)', async () => {
      const rawStream = createRealTTYStdin(true);
      Object.defineProperty(process, 'stdin', {
        value: rawStream,
        configurable: true,
      });

      const manager = TerminalCapabilityManager.getInstance();
      const promise = manager.detectCapabilities();
      rawStream.emit('data', Buffer.from('\x1b[?62c'));
      await promise;

      expect(
        rawStream.setRawMode as Mock<(mode: boolean) => void>,
      ).not.toHaveBeenCalled();
    });

    it('removes the stdin data listener on the DA1-sentinel path (AC7.3)', async () => {
      const rawStream = createRealTTYStdin(false);
      Object.defineProperty(process, 'stdin', {
        value: rawStream,
        configurable: true,
      });

      const manager = TerminalCapabilityManager.getInstance();
      const promise = manager.detectCapabilities();
      expect(rawStream.listenerCount('data')).toBe(1);

      rawStream.emit('data', Buffer.from('\x1b[?62c'));
      await promise;

      expect(rawStream.listenerCount('data')).toBe(0);
    });

    it('removes the stdin data listener on the timeout path (AC7.3)', async () => {
      const rawStream = createRealTTYStdin(false);
      Object.defineProperty(process, 'stdin', {
        value: rawStream,
        configurable: true,
      });

      const manager = TerminalCapabilityManager.getInstance();
      const promise = manager.detectCapabilities();
      expect(rawStream.listenerCount('data')).toBe(1);

      vi.advanceTimersByTime(DETECTION_TIMEOUT_MS);
      await promise;

      expect(rawStream.listenerCount('data')).toBe(0);
    });

    it('resolves, marks detection complete, and restores raw mode when the query write throws (AC7.4)', async () => {
      const { writeSync } = await import('node:fs');
      (writeSync as unknown as Mock<typeof writeSync>).mockImplementation(
        () => {
          throw new Error('write failed');
        },
      );

      const rawStream = createRealTTYStdin(false);
      Object.defineProperty(process, 'stdin', {
        value: rawStream,
        configurable: true,
      });

      const manager = TerminalCapabilityManager.getInstance();
      await manager.detectCapabilities();

      // Completion still ran: cleanup happened instead of hanging.
      expect(manager.isBracketedPasteEnabled()).toBe(true);
      expect(rawStream.listenerCount('data')).toBe(0);
      const setRawCalls = (
        rawStream.setRawMode as Mock<(mode: boolean) => void>
      ).mock.calls.map((call) => call[0]);
      expect(setRawCalls).toStrictEqual([true, false]);

      // Detection is marked complete: a second call is a no-op and does not
      // touch the (still throwing) writeSync again.
      (writeSync as unknown as Mock<typeof writeSync>).mockClear();
      await manager.detectCapabilities();
      expect(
        writeSync as unknown as Mock<typeof writeSync>,
      ).not.toHaveBeenCalled();
    });

    it('skips detection when stdout is not a TTY (AC7.5)', async () => {
      const { writeSync } = await import('node:fs');
      stdin.isTTY = true;
      stdout.isTTY = false;

      const manager = TerminalCapabilityManager.getInstance();
      await manager.detectCapabilities();

      expect(
        writeSync as unknown as Mock<typeof writeSync>,
      ).not.toHaveBeenCalled();
      expect(manager.isKittyProtocolEnabled()).toBe(false);
      expect(
        stdin.setRawMode as Mock<(mode: boolean) => void>,
      ).not.toHaveBeenCalled();
    });
  });
});
