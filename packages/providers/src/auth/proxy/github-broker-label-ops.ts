/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Label-family operation descriptors for the GitHub broker: label.list.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 38-55
 */

import type { OpDescriptor, ValidationError } from './github-broker-types.js';
import { resolveLimit, validateParams } from './github-broker-validation.js';
import { GITHUB_OP_SPECS } from '@vybestack/llxprt-code-tools/tools/github-ops.js';
import {
  assertNotPartialSuccess,
  extractString,
  assertListShape,
} from './github-broker-shaping.js';

/**
 * Validates parameters for label.list.
 *
 * @plan PLAN-20260731-GHBROKER.P10, PLAN-20260731-GHBROKER.P15
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31
 */
export function validateLabelListParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(GITHUB_OP_SPECS['label.list'].params, params);
}

/**
 * Builds the `gh` argv array for label.list. Pure; no I/O.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 46-55
 */
export function buildLabelListArgv(params: Record<string, unknown>): string[] {
  const argv: string[] = ['label', 'list', '--json', 'name,color,description'];
  argv.push('--limit', String(resolveLimit(params)));
  if (typeof params.repo === 'string' && params.repo.length > 0) {
    argv.push('--repo', params.repo);
  }
  return argv;
}

/**
 * A single shaped label in the label.list contract.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 */
export interface ShapedLabelListItem {
  readonly name: string;
  readonly color: string;
  readonly description: string;
}

/**
 * Shapes raw gh JSON for label.list into an array of items.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 */
export function shapeLabelList(
  rawJson: unknown,
): readonly ShapedLabelListItem[] {
  assertNotPartialSuccess(rawJson);
  assertListShape(rawJson, 'label.list');
  return rawJson.map((item): ShapedLabelListItem => {
    const obj = (item ?? {}) as Record<string, unknown>;
    return {
      name: extractString(obj.name, ''),
      color: extractString(obj.color, ''),
      description: extractString(obj.description, ''),
    };
  });
}

/**
 * The label.list operation descriptor.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 38-44
 */
export const labelListDescriptor: OpDescriptor = {
  name: 'label.list',
  requiredParams: GITHUB_OP_SPECS['label.list'].required,
  mutating: GITHUB_OP_SPECS['label.list'].mutating,
  params: GITHUB_OP_SPECS['label.list'].params,
  buildArgv: (params) => buildLabelListArgv(params),
  shape: (rawJson) => ({ labels: shapeLabelList(rawJson) }),
};
