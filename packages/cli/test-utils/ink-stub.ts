/**
 * Lightweight Ink stub used for Vitest environments.
 *
 * Provides the minimal surface the CLI components and ink-testing-library
 * expect without bringing in the real Ink runtime.
 */
import { EventEmitter } from 'events';
import React from 'react';

type InkComponentProps = {
  readonly children?: React.ReactNode;
  readonly [key: string]: unknown;
};

const passthrough = (role: string): React.FC<InkComponentProps> => {
  const Component: React.FC<InkComponentProps> = ({ children }) =>
    React.createElement(React.Fragment, { key: role }, children);
  Component.displayName = role;
  return Component;
};

export const Box = passthrough('Box');
export const Text = passthrough('Text');

export const render = () => ({
  clear: () => {},
  rerender: () => {},
  unmount: () => {},
  waitUntilExit: async () => {},
});

/**
 * The stdin the active test render is writing to.
 *
 * Components import `useStdin` from 'ink', which the test setup redirects to
 * this stub. Without a registry each call returned a fresh EventEmitter, so
 * anything a test wrote to the render's `stdin` reached nothing and every
 * keyboard-driven assertion failed with zero interactions. `render()` in
 * test-utils/ink-testing-library.ts registers its stdin here.
 */
let activeStdin: NodeJS.ReadStream | null = null;

export const setActiveStdin = (stdin: NodeJS.ReadStream | null): void => {
  activeStdin = stdin;
};

export const useStdin = () => ({
  stdin: activeStdin ?? (new EventEmitter() as unknown as NodeJS.ReadStream),
  setRawMode: () => {},
  isRawModeSupported: true,
});

export const useStdout = () => ({
  stdout: new EventEmitter(),
  write: () => {},
});

export const useApp = () => ({
  exit: () => {},
});
