/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import inkRender from '../../../node_modules/ink/build/render.js';
import { setActiveStdin } from './ink-stub.js';
import { registerRender, releaseRender } from './ink-render-registry.js';

export { cleanup } from './ink-render-registry.js';

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

type InkInstance = ReturnType<typeof inkRender>;
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

export const render = (
  tree: Parameters<typeof inkRender>[0],
): InkRenderResult => {
  const stdout = new Stdout();
  const stderr = new Stderr();
  const stdin = new Stdin();
  // Publish this render's stdin so the `useStdin` the components resolve to
  // (test-utils/ink-stub.ts) hands back the same stream the test writes to.
  setActiveStdin(stdin as unknown as NodeJS.ReadStream);
  const instance = inkRender(tree, {
    stdout,
    stderr,
    stdin,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  const registeredStdin = stdin as unknown as NodeJS.ReadStream;
  registerRender(instance, registeredStdin);

  const originalUnmount = instance.unmount.bind(instance);
  const originalCleanup = instance.cleanup.bind(instance);

  const removeActiveInstance = () => {
    releaseRender(instance);
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
