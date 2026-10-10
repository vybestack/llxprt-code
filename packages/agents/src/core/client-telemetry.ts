/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { uiTelemetryService } from '@vybestack/llxprt-code-core/telemetry/uiTelemetry.js';

export function publishClientPromptTokens(
  tokenCount: number | undefined,
): void {
  if (tokenCount !== undefined)
    uiTelemetryService.setLastPromptTokenCount(tokenCount);
}
