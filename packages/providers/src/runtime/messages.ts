/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P10
 * Runtime guard messaging utilities keep user-facing errors consistent and
 * embed remediation steps so operators know how to unblock stateless runs.
 */

const PLAN_TAG = '@plan:PLAN-20251023-STATELESS-HARDENING.P10';
const MISSING_RUNTIME_REQUIREMENTS = [
  '@requirement:REQ-SP4-001',
  '@requirement:REQ-SP4-004',
  '@requirement:REQ-SP4-005',
] as const;
const NORMALIZATION_REQUIREMENTS = [
  '@requirement:REQ-SP4-002',
  '@requirement:REQ-SP4-005',
] as const;

function formatSteps(steps: readonly string[]): string {
  return steps.map((step) => `- ${step}`).join('\n');
}

function formatTagSuffix(tags: readonly string[]): string {
  return `(${PLAN_TAG} ${tags.join(' ')})`;
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P10
 * @requirement:REQ-SP4-001
 * @requirement:REQ-SP4-004
 */
export function formatMissingRuntimeMessage({
  runtimeId,
  missingFields = [],
  hint,
  extraSteps = [],
}: {
  runtimeId: string;
  missingFields?: string[];
  hint?: string;
  extraSteps?: string[];
}): string {
  const formattedMissing =
    missingFields.length > 0
      ? missingFields.join(', ')
      : 'runtime registration';
  const remediationSteps = [
    'Call activateIsolatedRuntimeContext()/setCliRuntimeContext() before consuming CLI helpers.',
    'Run registerCliProviderInfrastructure() within the activation scope so Config, SettingsService, and ProviderManager are stored.',
    'If running tests, invoke configureCliStatelessHardening("strict") to verify the runtime wiring or temporarily switch to "legacy" only while debugging migrations.',
    ...extraSteps,
  ];

  const hintSuffix = hint ? ` ${hint}` : '';
  return (
    `[cli-runtime] MissingProviderRuntimeError: runtime ${runtimeId} missing ${formattedMissing}.${hintSuffix}`.trim() +
    `\nRemediation:\n${formatSteps(remediationSteps)}\n${formatTagSuffix(
      MISSING_RUNTIME_REQUIREMENTS,
    )}`
  );
}

/**
 * @plan:PLAN-20251023-STATELESS-HARDENING.P10
 * @requirement:REQ-SP4-002
 * @requirement:REQ-SP4-005
 */
export function formatNormalizationFailureMessage({
  runtimeId,
  missingFields = [],
  stage,
  hint,
  extraSteps = [],
}: {
  runtimeId: string;
  missingFields?: string[];
  stage?: string;
  hint?: string;
  extraSteps?: string[];
}): string {
  const formattedMissing =
    missingFields.length > 0 ? missingFields.join(', ') : 'runtime metadata';
  const stageSuffix = stage ? ` (${stage})` : '';
  const remediationSteps = [
    'Invoke ensureStatelessProviderReady() so ProviderManager receives normalized settings/config/metadata.',
    'Re-run profile bootstrap (e.g., llx profile apply <name>) to refresh the runtime Config + SettingsService pair.',
    'Review docs/release-notes/2025-10.md#cli-guard-messaging--diagnostics for the required runtime inputs.',
    ...extraSteps,
  ];
  const hintSuffix = hint ? ` ${hint}` : '';
  return (
    `[cli-runtime] ProviderRuntimeNormalizationError: runtime ${runtimeId} missing ${formattedMissing}${stageSuffix}.${hintSuffix}`.trim() +
    `\nRemediation:\n${formatSteps(remediationSteps)}\n${formatTagSuffix(
      NORMALIZATION_REQUIREMENTS,
    )}`
  );
}
