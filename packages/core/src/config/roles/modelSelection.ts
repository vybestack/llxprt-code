/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContentGeneratorConfig } from '../../core/contentGenerator.js';
import type { ComplexityAnalyzerSettings } from '../configTypes.js';

/**
 * Role interface for model and provider selection concerns.
 *
 * Transcribed from the checker-based census in
 * `project-plans/issue2615/analysis/role-assignment.json` (P01).
 * Every member signature matches the concrete Config declaration exactly.
 */
export interface ModelSelection {
  getModel(): string;
  getProvider(): string | undefined;
  refreshAuth(authMethod?: string): Promise<void>;
  setModel(newModel: string): void;
  getContentGeneratorConfig(): ContentGeneratorConfig | undefined;
  initializeContentGeneratorConfig: () => Promise<void>;
  getProxy(): string | undefined;
  setProvider(provider: string): void;
  getEmbeddingModel(): string | undefined;
  getComplexityAnalyzerSettings(): ComplexityAnalyzerSettings;
}
