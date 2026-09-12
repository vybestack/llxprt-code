/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EffectiveToolPolicy } from '../ports/profileRuntimeFactoryPort.js';

export type ProfilePolicyIntent = {
  allowedTools?: readonly string[];
  disabledTools?: readonly string[];
  requiredTools?: readonly string[];
  shellMode?: 'allowlist' | 'all' | 'none';
  approvalCeiling?: 'yolo' | 'standard' | 'strict';
};

export type PolicyCeiling = {
  allowedTools?: readonly string[];
  disabledTools?: readonly string[];
  shellMode?: 'allowlist' | 'all' | 'none';
  approvalCeiling?: 'yolo' | 'standard' | 'strict';
};

export type PolicyExplanation = {
  aspect: string;
  requested: string;
  effective: string;
  note?: string;
};

export type PolicyIntersectionOutcome = {
  policy: EffectiveToolPolicy;
  explanations: readonly PolicyExplanation[];
  errors: readonly string[];
  warnings: readonly string[];
};

/**
 * Intersection of an intent with the `EffectiveToolPolicy` built to run it.
 *
 * Tools must be allowed by the intent AND every ceiling layer that explicitly defines
 * an allowlist; a layer without one is unrestricted. Disabled tools are the union of
 * the intent's and every present layer's disabled tools, and they are subtracted from
 * the effective allowed set before availability is considered. Intent-allowed tools
 * that remain but are unavailable are removed with a warning. Required tools that are
 * disabled or that the final effective set dropped produce an error. Shell mode
 * narrows to the most restrictive of the present layers; approval ceiling is the
 * strictest. Every narrowing is explained. Nothing here reads or emits secrets.
 */
export function intersectPolicy(
  intent: ProfilePolicyIntent,
  environment: PolicyCeiling,
  session: PolicyCeiling,
  role?: PolicyCeiling,
  isToolAvailable?: (id: string) => boolean,
): PolicyIntersectionOutcome {
  const ceilings: ReadonlyArray<PolicyCeiling | undefined> = [
    environment,
    session,
    role,
  ];
  const presentLayers = ceilings.filter(
    (layer): layer is PolicyCeiling => layer !== undefined,
  );
  const intended = intent.allowedTools ?? [];
  // A layer without an explicit allowlist is unrestricted: only layers that define
  // allowedTools take part in the intersection. With no restricting layer the intent
  // passes through, because `every` over an empty layer list holds.
  const presentAllowed: ReadonlyArray<readonly string[]> = presentLayers
    .map((layer) => layer.allowedTools)
    .filter((allowed): allowed is readonly string[] => allowed !== undefined);
  const explanations: PolicyExplanation[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const disabledTools = mergeUnique(
    intent.disabledTools ?? [],
    ...presentLayers.map((layer) => layer.disabledTools ?? []),
  );
  const disabledSet = new Set(disabledTools);
  const allowedTools = intersectAllowedTools(intended, presentAllowed).filter(
    (id) => !disabledSet.has(id),
  );
  const unavailableTools =
    isToolAvailable === undefined
      ? []
      : allowedTools.filter((id) => !isToolAvailable(id));
  const unavailableSet = new Set(unavailableTools);
  for (const id of allowedTools) {
    if (unavailableSet.has(id)) {
      warnings.push(
        `tool ${id} requested but unavailable; removed from effective policy`,
      );
    }
  }
  const effectiveAllowedTools = allowedTools.filter(
    (id) => !unavailableSet.has(id),
  );

  const shellMode = narrowShellMode(
    'shell mode',
    intent.shellMode,
    presentLayers,
  );
  if (shellMode.explanation !== undefined) {
    explanations.push(shellMode.explanation);
  }
  const approval = strictApprovalCeiling(
    'approval ceiling',
    intent.approvalCeiling,
    presentLayers,
  );
  if (approval.explanation !== undefined) {
    explanations.push(approval.explanation);
  }

  errors.push(
    ...requiredToolErrors(
      intent.requiredTools ?? [],
      disabledSet,
      effectiveAllowedTools,
    ),
  );

  return {
    policy: {
      allowedTools: effectiveAllowedTools,
      disabledTools,
      shellMode: shellMode.result,
      approvalCeiling: approval.result,
    },
    explanations,
    errors,
    warnings,
  };
}

/**
 * Merges a set of lists into one array with no duplicates, preserving order.
 */
function mergeUnique(
  into: readonly string[],
  ...rest: ReadonlyArray<readonly string[]>
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const list of [into, ...rest]) {
    for (const item of list) {
      if (seen.has(item)) {
        continue;
      }
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

/**
 * Errors for every required tool that policy excludes: first a tool disabled by the
 * intent or any layer, then a tool the effective allowed set dropped.
 */
function requiredToolErrors(
  required: readonly string[],
  disabledSet: ReadonlySet<string>,
  effectiveAllowedTools: readonly string[],
): string[] {
  const errors: string[] = [];
  for (const id of required) {
    const error = requiredToolError(id, disabledSet, effectiveAllowedTools);
    if (error !== undefined) {
      errors.push(error);
    }
  }
  return errors;
}

function requiredToolError(
  id: string,
  disabledSet: ReadonlySet<string>,
  effectiveAllowedTools: readonly string[],
): string | undefined {
  if (disabledSet.has(id)) {
    return `required tool ${id} is disabled by policy`;
  }
  if (effectiveAllowedTools.includes(id)) {
    return undefined;
  }
  return `required tool ${id} is not effectively allowed`;
}

function intersectAllowedTools(
  intended: readonly string[],
  layers: ReadonlyArray<readonly string[]>,
): string[] {
  return intended.filter((id) => layers.every((layer) => layer.includes(id)));
}

function narrowShellMode(
  aspect: string,
  intended: 'allowlist' | 'all' | 'none' | undefined,
  layers: readonly PolicyCeiling[],
): { result: 'allowlist' | 'all' | 'none'; explanation?: PolicyExplanation } {
  if (intended === undefined) {
    const applied: Array<'allowlist' | 'all' | 'none'> = [];
    for (const layer of layers) {
      if (layer.shellMode !== undefined) {
        applied.push(layer.shellMode);
      }
    }
    const result = applied.length === 0 ? 'all' : narrowestShell(applied);
    if (result !== 'all') {
      return {
        result,
        explanation: {
          aspect,
          requested: 'all',
          effective: result,
          note: 'no intent; environment ceiling applies',
        },
      };
    }
    return { result };
  }
  const values: Array<'allowlist' | 'all' | 'none'> = [intended];
  for (const layer of layers) {
    if (layer.shellMode !== undefined) {
      values.push(layer.shellMode);
    }
  }
  const result = narrowestShell(values);
  if (result !== intended) {
    return {
      result,
      explanation: { aspect, requested: intended, effective: result },
    };
  }
  return { result };
}

/**
 * Narrowest (most restrictive) shell mode across the given values: none beats
 * allowlist beats all.
 */
function narrowestShell(
  values: ReadonlyArray<'allowlist' | 'all' | 'none'>,
): 'allowlist' | 'all' | 'none' {
  let result: 'allowlist' | 'all' | 'none' = values[0];
  for (const value of values) {
    if (narrowerShell(value, result)) {
      result = value;
    }
  }
  return result;
}

function narrowerShell(
  left: 'allowlist' | 'all' | 'none',
  right: 'allowlist' | 'all' | 'none',
): boolean {
  if (left === 'none') {
    return right !== 'none';
  }
  if (left === 'allowlist') {
    return right === 'all';
  }
  return false;
}

function strictApprovalCeiling(
  aspect: string,
  intended: 'yolo' | 'standard' | 'strict' | undefined,
  layers: readonly PolicyCeiling[],
): { result: 'yolo' | 'standard' | 'strict'; explanation?: PolicyExplanation } {
  if (intended === undefined) {
    const values: Array<'yolo' | 'standard' | 'strict'> =
      approvalValues(layers);
    if (values.length > 0) {
      const result = strictestOf(values);
      return {
        result,
        explanation: {
          aspect,
          requested: 'yolo',
          effective: result,
          note: 'absent intent; values come from environment and session ceilings',
        },
      };
    }
    return { result: 'yolo' };
  }
  let result: 'yolo' | 'standard' | 'strict' = intended;
  for (const layer of layers) {
    const layerValue = layer.approvalCeiling;
    if (layerValue === undefined) {
      continue;
    }
    if (moreStrict(layerValue, result)) {
      result = layerValue;
    }
  }
  if (result !== intended) {
    return {
      result,
      explanation: { aspect, requested: intended, effective: result },
    };
  }
  return { result };
}

function approvalValues(
  layers: readonly PolicyCeiling[],
): Array<'yolo' | 'standard' | 'strict'> {
  const values: Array<'yolo' | 'standard' | 'strict'> = [];
  for (const layer of layers) {
    if (layer.approvalCeiling !== undefined) {
      values.push(layer.approvalCeiling);
    }
  }
  return values;
}

function strictestOf(
  values: ReadonlyArray<'yolo' | 'standard' | 'strict'>,
): 'yolo' | 'standard' | 'strict' {
  let result: 'yolo' | 'standard' | 'strict' = values[0];
  for (const value of values) {
    if (moreStrict(value, result)) {
      result = value;
    }
  }
  return result;
}

function moreStrict(
  left: 'yolo' | 'standard' | 'strict',
  right: 'yolo' | 'standard' | 'strict',
): boolean {
  if (left === 'strict') {
    return right !== 'strict';
  }
  if (left === 'standard') {
    return right === 'yolo';
  }
  return false;
}
