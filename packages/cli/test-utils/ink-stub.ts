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

export const useApp = () => ({
  exit: () => {},
});
