/**
 * @plan PLAN-20260608-ISSUE1588.P05
 * @requirement REQ-DEP-001
 *
 * Settings package type re-exports.
 *
 * Real settings-owned types live in their respective modules:
 *   - profiles/types.ts  → Profile, StandardProfile, LoadBalancerProfile, ModelParams, etc.
 *   - settings/settingsRegistry.ts → SettingSpec, ValidationResult, SeparatedSettings, etc.
 *
 * This file re-exports them from a single entrypoint so consumers
 * can `import type { … } from '@vybestack/llxprt-code-settings/types'`
 * without knowing internal module layout.
 */

export type {
  Profile,
  StandardProfile,
  LoadBalancerProfile,
  ModelParams,
  EphemeralSettings,
  AuthConfig,
} from './profiles/types.js';

export type {
  SettingSpec,
  ValidationResult,
  SeparatedSettings,
  DirectSettingSpec,
} from './settings/settingsRegistry.js';
