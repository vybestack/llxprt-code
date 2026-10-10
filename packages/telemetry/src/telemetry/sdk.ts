/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RootTelemetry } from './root-telemetry.js';

export function isTelemetrySdkInitialized(root: RootTelemetry): boolean {
  return root.isEnabled();
}

export function initializeTelemetry(root: RootTelemetry): Promise<void> {
  return root.setEnabled(true);
}

export function flushTelemetry(root: RootTelemetry): Promise<void> {
  return root.flush();
}

export function shutdownTelemetry(root: RootTelemetry): Promise<void> {
  return root.close();
}
