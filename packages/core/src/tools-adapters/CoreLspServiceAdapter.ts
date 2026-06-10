/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Diagnostic,
  ILspService,
  LspConfig,
} from '@vybestack/llxprt-code-tools';
import type { Config } from '../config/config.js';

export class CoreLspServiceAdapter implements ILspService {
  constructor(private readonly config: Config) {}

  getDiagnostics(filePath: string): Diagnostic[] {
    const lspClient = this.config.getLspServiceClient();
    if (lspClient === undefined || lspClient.isAlive() !== true) {
      return [];
    }

    void filePath;
    return [];
  }

  async waitForDiagnostics(
    filePath: string,
    timeout: number,
  ): Promise<Diagnostic[]> {
    const lspClient = this.config.getLspServiceClient();
    if (lspClient === undefined || lspClient.isAlive() !== true) {
      return [];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      return await lspClient.checkFile(filePath, controller.signal);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  getLspConfig(): LspConfig | undefined {
    return this.config.getLspConfig();
  }
}
