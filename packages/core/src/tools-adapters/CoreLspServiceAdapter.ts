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

export class CoreLspServiceAdapter implements ILspService {
  constructor(private readonly diagnostics: ILspService) {}
  getDiagnostics(filePath: string): Diagnostic[] {
    return this.diagnostics.getDiagnostics(filePath);
  }
  waitForDiagnostics(filePath: string, timeout: number): Promise<Diagnostic[]> {
    return this.diagnostics.waitForDiagnostics(filePath, timeout);
  }
  getLspConfig(): LspConfig | undefined {
    return this.diagnostics.getLspConfig();
  }
}
