/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, spyOn } from 'bun:test';
import createDebug from 'debug';
import { debugLogger } from '@vybestack/llxprt-code-core/utils/debugLogger.js';

export function useOperationalOutput(): () => string {
  let previousNamespaces = '';
  const output: string[] = [];
  let restore = (): void => {};
  beforeEach(() => {
    output.length = 0;
    previousNamespaces = createDebug.disable();
    const consoleOutput = spyOn(console, 'log').mockImplementation(
      (...args: unknown[]) => {
        output.push(args.map(String).join(' '));
      },
    );
    restore = () => consoleOutput.mockRestore();
    debugLogger.configManager.setEphemeralConfig({
      enabled: true,
      namespaces: ['llxprt:*'],
      output: { target: 'stderr' },
    });
    createDebug.enable('llxprt:*');
  });
  afterEach(() => {
    restore();
    createDebug.enable(previousNamespaces);
    debugLogger.configManager.clearEphemeralConfig();
  });
  return () => output.join('\n');
}
