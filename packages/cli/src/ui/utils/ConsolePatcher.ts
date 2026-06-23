/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import util from 'util';
import type { ConsoleMessageItem } from '../types.js';

interface ConsolePatcherParams {
  onNewMessage?: (message: Omit<ConsoleMessageItem, 'id'>) => void;
  debugMode: boolean;
  stderr?: boolean;
}

export class ConsolePatcher {
  private originalConsoleLog = globalThis.console.log;
  private originalConsoleWarn = globalThis.console.warn;
  private originalConsoleError = globalThis.console.error;
  private originalConsoleDebug = globalThis.console.debug;
  private originalConsoleInfo = globalThis.console.info;

  private params: ConsolePatcherParams;

  constructor(params: ConsolePatcherParams) {
    this.params = params;
  }

  patch() {
    globalThis.console.log = this.patchConsoleMethod('log');
    globalThis.console.warn = this.patchConsoleMethod('warn');
    globalThis.console.error = this.patchConsoleMethod('error');
    globalThis.console.debug = this.patchConsoleMethod('debug');
    globalThis.console.info = this.patchConsoleMethod('info');
  }

  cleanup = () => {
    globalThis.console.log = this.originalConsoleLog;
    globalThis.console.warn = this.originalConsoleWarn;
    globalThis.console.error = this.originalConsoleError;
    globalThis.console.debug = this.originalConsoleDebug;
    globalThis.console.info = this.originalConsoleInfo;
  };

  private formatArgs = (args: unknown[]): string => util.format(...args);

  private patchConsoleMethod =
    (type: 'log' | 'warn' | 'error' | 'debug' | 'info') =>
    (...args: unknown[]) => {
      if (this.params.stderr === true) {
        if (type !== 'debug' || this.params.debugMode) {
          this.originalConsoleError(this.formatArgs(args));
        }
      } else if (type !== 'debug' || this.params.debugMode) {
        this.params.onNewMessage?.({
          type,
          content: this.formatArgs(args),
          count: 1,
        });
      }
    };
}
