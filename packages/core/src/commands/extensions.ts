/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LlxprtExtension } from '../config/configTypes.js';

export interface ExtensionListSource {
  getExtensions(): LlxprtExtension[];
}

export function listExtensions(config: ExtensionListSource): LlxprtExtension[] {
  return config.getExtensions();
}
