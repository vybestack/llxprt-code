/**
 * Lightweight Ink stub used for Vitest and Bun test environments.
 *
 * Provides the minimal surface the CLI components and ink-testing-library
 * expect without bringing in the real Ink runtime. Exports every named
 * import the CLI source uses from 'ink' so that Bun's mock.module does not
 * fall through to the real Ink CJS/ESM build for export validation.
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
export const Newline = passthrough('Newline');
export const Static = passthrough('Static');

export type DOMElement = unknown;
export type BoxProps = Record<string, unknown>;
export type RenderOptions = Record<string, unknown>;

export const render = (): {
  waitUntilExit: () => Promise<void>;
  clear: () => void;
  unmount: () => void;
} => ({
  waitUntilExit: async () => {},
  clear: () => {},
  unmount: () => {},
});

export const measureElement = (): {
  x: number;
  y: number;
  width: number;
  height: number;
} => ({ x: 0, y: 0, width: 0, height: 0 });

export const getBoundingBox = (): {
  x: number;
  y: number;
  width: number;
  height: number;
} => ({ x: 0, y: 0, width: 0, height: 0 });

export const useStdin = () => {
  const emitter = new EventEmitter() as unknown as NodeJS.ReadStream;
  return {
    stdin: emitter,
    setRawMode: () => {},
    isRawModeSupported: true,
  };
};

export const useStdout = () => ({
  stdout: new EventEmitter(),
  write: () => {},
});

export const useInput = (_callback: (_input: string) => void) => {};

export const useIsScreenReaderEnabled = () => false;

export const useApp = () => ({
  exit: () => {},
});
