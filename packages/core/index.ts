/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export * from './src/index.js';
export {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
} from './src/config/models.js';
export { QwenDeviceFlow } from './src/auth/qwen-device-flow.js';
export type { DeviceFlowConfig } from './src/auth/qwen-device-flow.js';
export { KeyringTokenStore } from './src/auth/keyring-token-store.js';
export {
  openBrowserSecurely,
  shouldLaunchBrowser,
} from './src/utils/secure-browser-launcher.js';
export { IDE_DEFINITIONS, detectIdeFromEnv } from './src/ide/detect-ide.js';

// Re-export settings system for explicit access
export { SettingsService } from './src/settings/SettingsService.js';
export type {
  ISettingsService,
  GlobalSettings,
  SettingsChangeEvent,
  ProviderSettings,
  UISettings,
  AdvancedSettings,
  EventListener,
  EventUnsubscribe,
} from './src/settings/types.js';
export type { TelemetrySettings as SettingsTelemetrySettings } from './src/settings/types.js';
// IDE connection telemetry exports removed - telemetry disabled in llxprt
export {
  IdeConnectionEvent,
  IdeConnectionType,
} from './src/telemetry/types.js';
export { getIdeTrust } from './src/utils/ide-trust.js';
export * from './src/utils/pathReader.js';
