/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  inkRenderOptions,
  getInteractiveStdio,
  setInteractiveStdoutObserver,
  setInteractiveRenderObserver,
} from './inkRenderOptions.js';
import {
  type StdoutWriteObserver,
  writeToStdout,
} from '@vybestack/llxprt-code-core';

const baseConfig = { getScreenReader: () => false };
const baseSettings = { merged: { ui: {} } };

describe('interactive stdio — lazy cache + stdout observer', () => {
  beforeEach(() => {
    setInteractiveStdoutObserver(null);
    setInteractiveRenderObserver(null);
  });

  it('getInteractiveStdio returns the same cached instance on repeated calls', () => {
    const a = getInteractiveStdio();
    const b = getInteractiveStdio();
    expect(a).toBe(b);
  });

  it('setting a stdout observer before first build carries it into the stdio', () => {
    let count = 0;
    const observer: StdoutWriteObserver = { onWrite: () => count++ };
    setInteractiveStdoutObserver(observer);
    const { stdout } = getInteractiveStdio();
    stdout.write('');
    expect(count).toBe(1);
  });

  it('setting a different stdout observer invalidates the cache', () => {
    let first = 0;
    let second = 0;
    const obs1: StdoutWriteObserver = { onWrite: () => first++ };
    const obs2: StdoutWriteObserver = { onWrite: () => second++ };

    setInteractiveStdoutObserver(obs1);
    const stdioA = getInteractiveStdio();
    stdioA.stdout.write('');
    expect(first).toBe(1);

    setInteractiveStdoutObserver(obs2);
    const stdioB = getInteractiveStdio();
    expect(stdioB).not.toBe(stdioA);

    stdioB.stdout.write('');
    expect(second).toBe(1);
    expect(first).toBe(1);

    stdioA.stdout.write('');
    expect(second).toBe(2);
    expect(first).toBe(1);
  });

  it('clearing the observer detaches an already-built stdout proxy', () => {
    let count = 0;
    setInteractiveStdoutObserver({ onWrite: () => count++ });
    const { stdout } = getInteractiveStdio();

    setInteractiveStdoutObserver(null);
    stdout.write('');

    expect(count).toBe(0);
  });

  it('setting the same stdout observer reuses the cached instance', () => {
    const observer: StdoutWriteObserver = { onWrite: () => {} };
    setInteractiveStdoutObserver(observer);
    const first = getInteractiveStdio();
    setInteractiveStdoutObserver(observer);
    const second = getInteractiveStdio();
    expect(second).toBe(first);
  });

  it('clearing to null when already null reuses the cached instance', () => {
    const first = getInteractiveStdio();
    setInteractiveStdoutObserver(null);
    const second = getInteractiveStdio();
    expect(second).toBe(first);
  });

  it('default-off: no observer set means stdout proxy write is the unobserved writeToStdout', () => {
    const { stdout } = getInteractiveStdio();
    expect(Object.is(stdout.write, writeToStdout)).toBe(true);
  });
});

describe('interactive render observer — onRender wiring', () => {
  beforeEach(() => {
    setInteractiveStdoutObserver(null);
    setInteractiveRenderObserver(null);
  });

  it('no render observer set means onRender is not wired (default-off)', () => {
    const opts = inkRenderOptions(baseConfig, baseSettings);
    expect(opts.onRender).toBeUndefined();
  });

  it('wires onRender to the render observer, forwarding Ink renderTime', () => {
    let captured = -1;
    setInteractiveRenderObserver({ onRender: (ms) => (captured = ms) });
    const opts = inkRenderOptions(baseConfig, baseSettings);
    expect(typeof opts.onRender).toBe('function');
    opts.onRender?.({ renderTime: 7.5 });
    expect(captured).toBe(7.5);
  });

  it('clearing the render observer detaches existing options and new wiring', () => {
    let count = 0;
    setInteractiveRenderObserver({ onRender: () => count++ });
    const activeOptions = inkRenderOptions(baseConfig, baseSettings);

    setInteractiveRenderObserver(null);
    activeOptions.onRender?.({ renderTime: 1 });
    const clearedOptions = inkRenderOptions(baseConfig, baseSettings);

    expect(count).toBe(0);
    expect(clearedOptions.onRender).toBeUndefined();
  });

  it('render passes are counted distinctly from stdout write calls', () => {
    let renderCount = 0;
    let writeCount = 0;
    setInteractiveRenderObserver({ onRender: () => renderCount++ });
    setInteractiveStdoutObserver({ onWrite: () => writeCount++ });

    const { stdout } = getInteractiveStdio();
    const opts = inkRenderOptions(baseConfig, baseSettings);

    stdout.write('');
    stdout.write('');
    stdout.write('');
    opts.onRender?.({ renderTime: 1 });

    expect(writeCount).toBe(3);
    expect(renderCount).toBe(1);
  });
});

describe('inkRenderOptions — existing options preserved with observer seam', () => {
  beforeEach(() => {
    setInteractiveStdoutObserver(null);
    setInteractiveRenderObserver(null);
  });

  it('still returns the base render options (default-off, no onRender)', () => {
    const opts = inkRenderOptions(
      { getScreenReader: () => true },
      { merged: { ui: { useAlternateBuffer: true } } },
    );
    expect(opts).toStrictEqual(
      expect.objectContaining({
        exitOnCtrlC: false,
        patchConsole: false,
        isScreenReaderEnabled: true,
        alternateBuffer: false,
        incrementalRendering: false,
      }),
    );
    expect(opts.onRender).toBeUndefined();
  });
});
