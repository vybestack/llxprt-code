/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';

/**
 * The real ink-testing-library imports ink's internal render.js to create
 * test render instances. For the Bun test environment (and Vitest with the
 * ink stub), we provide a stub render that mimics the shape without touching
 * the real Ink runtime. This avoids pulling in the real Ink ESM module
 * graph, which triggers Bun parsing errors during mock validation.
 */
type InkInstance = {
  rerender: (node: unknown) => void;
  unmount: () => void;
  cleanup: () => void;
};

const stubInkRender = (_node: unknown, _options?: unknown): InkInstance => ({
  rerender: () => {},
  unmount: () => {},
  cleanup: () => {},
});

class Stdout extends EventEmitter {
  get columns() {
    return 100;
  }

  frames: string[] = [];
  private lastRenderedFrame?: string;

  write = (frame: string) => {
    this.frames.push(frame);
    this.lastRenderedFrame = frame;
  };

  lastFrame = () => this.lastRenderedFrame;
}

class Stderr extends EventEmitter {
  frames: string[] = [];
  private lastRenderedFrame?: string;

  write = (frame: string) => {
    this.frames.push(frame);
    this.lastRenderedFrame = frame;
  };

  lastFrame = () => this.lastRenderedFrame;
}

class Stdin extends EventEmitter {
  isTTY: boolean;
  private data: string | null = null;

  constructor(options: { isTTY?: boolean } = {}) {
    super();
    this.isTTY = options.isTTY ?? true;
  }

  write = (data: string) => {
    this.data = data;
    this.emit('readable');
    this.emit('data', data);
  };

  setEncoding() {
    // Intentionally empty for test double parity.
  }

  setRawMode() {
    // Intentionally empty for test double parity.
  }

  resume() {
    // Intentionally empty for test double parity.
  }

  pause() {
    // Intentionally empty for test double parity.
  }

  ref() {
    // Intentionally empty for test double parity.
  }

  unref() {
    // Intentionally empty for test double parity.
  }

  read = () => {
    const current = this.data;
    this.data = null;
    return current;
  };
}

export interface InkRenderResult {
  rerender: InkInstance['rerender'];
  unmount: InkInstance['unmount'];
  cleanup: InkInstance['cleanup'];
  stdout: Stdout;
  stderr: Stderr;
  stdin: Stdin;
  frames: string[];
  lastFrame: () => string | undefined;
}

const activeInstances = new Set<InkInstance>();

export const render = (
  tree: Parameters<typeof stubInkRender>[0],
): InkRenderResult => {
  const stdout = new Stdout();
  const stderr = new Stderr();
  const stdin = new Stdin();
  const instance = stubInkRender(tree, {
    stdout,
    stderr,
    stdin,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  activeInstances.add(instance);

  const originalUnmount = instance.unmount.bind(instance);
  const originalCleanup = instance.cleanup.bind(instance);

  const removeActiveInstance = () => {
    activeInstances.delete(instance);
  };

  return {
    rerender: instance.rerender,
    unmount: () => {
      removeActiveInstance();
      originalUnmount();
    },
    cleanup: () => {
      removeActiveInstance();
      originalCleanup();
    },
    stdout,
    stderr,
    stdin,
    frames: stdout.frames,
    lastFrame: stdout.lastFrame,
  };
};

export const cleanup = () => {
  for (const instance of Array.from(activeInstances)) {
    activeInstances.delete(instance);

    try {
      instance.unmount();
    } catch {
      // Ignore teardown failures in test cleanup.
    }

    try {
      instance.cleanup();
    } catch {
      // Ignore teardown failures in test cleanup.
    }
  }
};
