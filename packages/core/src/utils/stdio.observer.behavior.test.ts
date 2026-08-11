/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  createInkStdio,
  createObservedStdoutWrite,
  writeToStdout,
  type StdoutWriteObserver,
} from './stdio.js';

type StdoutWriteCallback = (err?: NodeJS.ErrnoException | null) => void;
type StdoutWriteArgs =
  | [chunk: Uint8Array | string, callback?: StdoutWriteCallback]
  | [
      chunk: Uint8Array | string,
      encoding?: BufferEncoding,
      callback?: StdoutWriteCallback,
    ];

const noopUnderlying = (..._args: StdoutWriteArgs): boolean => true;

const capturingObserver = (): {
  observer: StdoutWriteObserver;
  bytes: () => number;
  duration: () => number;
  count: () => number;
} => {
  let b = -1;
  let d = -1;
  let c = 0;
  return {
    observer: {
      onWrite: (encodedBytes, syncDurationMs) => {
        b = encodedBytes;
        d = syncDurationMs;
        c++;
      },
    },
    bytes: () => b,
    duration: () => d,
    count: () => c,
  };
};

describe('createObservedStdoutWrite — encoded byte counting', () => {
  it('counts Uint8Array bytes by byteLength, not character count', () => {
    const { observer, bytes } = capturingObserver();
    const observed = createObservedStdoutWrite(noopUnderlying, observer);
    // "你好" encoded as UTF-8 = 6 bytes
    const data = new Uint8Array([0xe4, 0xbd, 0xa0, 0xe5, 0xa5, 0xbd]);
    observed(data);
    expect(bytes()).toBe(6);
  });

  it('counts a multibyte UTF-8 string by encoded byte length', () => {
    const { observer, bytes } = capturingObserver();
    const observed = createObservedStdoutWrite(noopUnderlying, observer);
    observed('你好');
    expect(bytes()).toBe(6);
  });

  it('uses the supplied BufferEncoding for string byte counting', () => {
    const { observer, bytes } = capturingObserver();
    const observed = createObservedStdoutWrite(noopUnderlying, observer);
    // "café" is 4 bytes in latin1 but 5 bytes in UTF-8
    observed('café', 'latin1');
    expect(bytes()).toBe(4);
  });

  it('counts 0 bytes for an empty string', () => {
    const { observer, bytes } = capturingObserver();
    const observed = createObservedStdoutWrite(noopUnderlying, observer);
    observed('');
    expect(bytes()).toBe(0);
  });
});

describe('createObservedStdoutWrite — backpressure + callback passthrough', () => {
  it('passes through true backpressure from the underlying write', () => {
    const underlying = (..._args: StdoutWriteArgs): boolean => true;
    const observed = createObservedStdoutWrite(underlying, {
      onWrite: () => {},
    });
    expect(observed('x')).toBe(true);
  });

  it('passes through false backpressure from the underlying write', () => {
    const underlying = (..._args: StdoutWriteArgs): boolean => false;
    const observed = createObservedStdoutWrite(underlying, {
      onWrite: () => {},
    });
    expect(observed('x')).toBe(false);
  });

  it('preserves the (chunk, callback) overload by forwarding to underlying', () => {
    let cbInvoked = false;
    const underlying = (...args: StdoutWriteArgs): boolean => {
      const maybeCb = args[args.length - 1];
      if (typeof maybeCb === 'function') {
        maybeCb();
      }
      return true;
    };
    const observed = createObservedStdoutWrite(underlying, {
      onWrite: () => {},
    });
    observed('x', () => {
      cbInvoked = true;
    });
    expect(cbInvoked).toBe(true);
  });

  it('preserves the (chunk, encoding, callback) overload', () => {
    let receivedEncoding: string | undefined;
    let cbInvoked = false;
    const underlying = (...args: StdoutWriteArgs): boolean => {
      const maybeEnc = args[1];
      if (typeof maybeEnc === 'string') {
        receivedEncoding = maybeEnc;
      }
      const maybeCb = args[args.length - 1];
      if (typeof maybeCb === 'function') {
        maybeCb();
      }
      return true;
    };
    const observed = createObservedStdoutWrite(underlying, {
      onWrite: () => {},
    });
    observed('x', 'utf8', () => {
      cbInvoked = true;
    });
    expect(receivedEncoding).toBe('utf8');
    expect(cbInvoked).toBe(true);
  });
});

describe('createObservedStdoutWrite — duration + call count', () => {
  it('measures a finite, non-negative synchronous duration', () => {
    const { observer, duration } = capturingObserver();
    const observed = createObservedStdoutWrite(noopUnderlying, observer);
    observed('x');
    expect(Number.isFinite(duration())).toBe(true);
    expect(duration()).toBeGreaterThanOrEqual(0);
  });

  it('invokes onWrite exactly once per write call', () => {
    const { observer, count } = capturingObserver();
    const observed = createObservedStdoutWrite(noopUnderlying, observer);
    observed('a');
    observed('b');
    observed('c');
    expect(count()).toBe(3);
  });
});

describe('createObservedStdoutWrite — error propagation (D8 fail-fast)', () => {
  it('propagates an observer error without swallowing it', () => {
    const observer: StdoutWriteObserver = {
      onWrite: () => {
        throw new Error('observer boom');
      },
    };
    const observed = createObservedStdoutWrite(noopUnderlying, observer);
    expect(() => observed('x')).toThrow('observer boom');
  });

  it('does not invoke the observer when the underlying write throws', () => {
    const { observer, count } = capturingObserver();
    const throwingUnderlying = (..._args: StdoutWriteArgs): boolean => {
      throw new Error('underlying boom');
    };
    const observed = createObservedStdoutWrite(throwingUnderlying, observer);
    expect(() => observed('x')).toThrow('underlying boom');
    expect(count()).toBe(0);
  });
});

describe('createInkStdio — observer wiring + default-off', () => {
  it('without an observer, stdout proxy write is writeToStdout (identity preserved)', () => {
    const { stdout } = createInkStdio();
    expect(stdout.write).toBe(writeToStdout);
  });

  it('with an observer, stdout writes invoke the observer', () => {
    const { observer, count } = capturingObserver();
    const { stdout } = createInkStdio(observer);
    stdout.write('');
    expect(count()).toBe(1);
  });

  it('stderr writes are never observed even when a stdout observer is set', () => {
    const { observer, count } = capturingObserver();
    const { stderr } = createInkStdio(observer);
    stderr.write('');
    expect(count()).toBe(0);
  });

  it('Zed path characterization: createInkStdio() with no observer is uncounted', () => {
    // Zed calls createInkStdio() directly with no observer — its writes must
    // never be counted. This characterizes that contract.
    const { stdout } = createInkStdio();
    expect(stdout.write).toBe(writeToStdout);
  });
});
