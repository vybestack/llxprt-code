/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P27
 * @requirement:REQ-021
 *
 * Durable diagnostics/about metadata (REQ-021). Wraps the real
 * `SettingsService.getDiagnosticsData()` which returns provider/model/profile/
 * providerSettings/ephemeralSettings/modelParams. The configured sandbox
 * preference is surfaced from settings when present (never fabricated); if it
 * is not durably reachable here the value is `null`. No live `Agent` required.
 */

import type {
  DiagnosticsInput,
  DiagnosticsResult,
  AboutInput,
  AboutResult,
} from './types.js';

const SANDBOX_KEY = 'sandbox';

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asProfile(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readSandboxPreference(
  ephemeralSettings: Record<string, unknown>,
): string | null {
  const raw = ephemeralSettings[SANDBOX_KEY];
  if (typeof raw === 'string') {
    return raw;
  }
  if (typeof raw === 'boolean') {
    return raw ? 'on' : 'off';
  }
  return null;
}

/**
 * Return the durable diagnostics snapshot.
 */
export async function getDiagnostics(
  input: DiagnosticsInput,
): Promise<DiagnosticsResult> {
  const data = await input.settingsService.getDiagnosticsData();
  const ephemeralSettings = asRecord(data.ephemeralSettings);
  return {
    provider: asString(data.provider),
    model: asString(data.model),
    profile: asProfile(data.profile),
    providerSettings: asRecord(data.providerSettings),
    ephemeralSettings,
    modelParams: asRecord(data.modelParams),
    sandbox: readSandboxPreference(ephemeralSettings),
  };
}

/**
 * Return the durable about metadata (provider/model/profile + sandbox source).
 */
export async function getAbout(input: AboutInput): Promise<AboutResult> {
  const data = await input.settingsService.getDiagnosticsData();
  const ephemeralSettings = asRecord(data.ephemeralSettings);
  return {
    provider: asString(data.provider),
    model: asString(data.model),
    profile: asProfile(data.profile),
    sandbox: readSandboxPreference(ephemeralSettings),
  };
}
