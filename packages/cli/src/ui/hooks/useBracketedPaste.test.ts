/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { renderHook } from '../../test-utils/render.js';
import { useBracketedPaste } from './useBracketedPaste.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

const realCore = { ...(await import('@vybestack/llxprt-code-core')) };
let terminalOutput = '';

void vi.mock('@vybestack/llxprt-code-core', () => ({
  ...realCore,
  writeToStdout: (chunk: string | Uint8Array): boolean => {
    terminalOutput +=
      typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  },
}));

const ENABLE_BRACKETED_PASTE = '\x1b[?2004h';
const DISABLE_BRACKETED_PASTE = '\x1b[?2004l';

describe('useBracketedPaste', () => {
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    terminalOutput = '';
    unmount = undefined;
  });

  afterEach(() => {
    unmount?.();
  });

  it('enables bracketed paste on mount and disables it on unmount', () => {
    const hook = renderHook(() => useBracketedPaste());
    unmount = hook.unmount;

    expect(terminalOutput).toBe(ENABLE_BRACKETED_PASTE);

    hook.unmount();
    unmount = undefined;

    expect(terminalOutput).toBe(
      ENABLE_BRACKETED_PASTE + DISABLE_BRACKETED_PASTE,
    );
  });

  it('registers cleanup for process termination signals', () => {
    const priorSigintListeners = new Set(process.listeners('SIGINT'));
    const priorSigtermListeners = new Set(process.listeners('SIGTERM'));
    const hook = renderHook(() => useBracketedPaste());
    unmount = hook.unmount;

    const sigintCleanup = process
      .listeners('SIGINT')
      .find((listener) => !priorSigintListeners.has(listener));
    const sigtermCleanup = process
      .listeners('SIGTERM')
      .find((listener) => !priorSigtermListeners.has(listener));

    expect(sigintCleanup).toBeDefined();
    expect(sigtermCleanup).toBeDefined();
  });

  it('removes process listeners on unmount', () => {
    const priorExitListeners = new Set(process.listeners('exit'));
    const priorSigintListeners = new Set(process.listeners('SIGINT'));
    const priorSigtermListeners = new Set(process.listeners('SIGTERM'));
    const hook = renderHook(() => useBracketedPaste());
    unmount = hook.unmount;

    const exitCleanup = process
      .listeners('exit')
      .find((listener) => !priorExitListeners.has(listener));
    const sigintCleanup = process
      .listeners('SIGINT')
      .find((listener) => !priorSigintListeners.has(listener));
    const sigtermCleanup = process
      .listeners('SIGTERM')
      .find((listener) => !priorSigtermListeners.has(listener));
    if (
      exitCleanup === undefined ||
      sigintCleanup === undefined ||
      sigtermCleanup === undefined
    ) {
      throw new Error(
        'Expected useBracketedPaste to register cleanup listeners',
      );
    }

    hook.unmount();
    unmount = undefined;

    expect(process.listeners('exit')).not.toContain(exitCleanup);
    expect(process.listeners('SIGINT')).not.toContain(sigintCleanup);
    expect(process.listeners('SIGTERM')).not.toContain(sigtermCleanup);
    expect(terminalOutput).toBe(
      ENABLE_BRACKETED_PASTE + DISABLE_BRACKETED_PASTE,
    );
  });
});
