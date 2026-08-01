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

import type {
  OpDescriptor,
  ParamKind,
  ValidationError,
} from './github-broker-types.js';
import { resolveLimit, validateParams } from './github-broker-validation.js';
import {
  assertNotPartialSuccess,
  extractString,
  assertListShape,
} from './github-broker-shaping.js';

/**
 * The accepted parameters for label.list.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-009, REQ-013
 */
const LABEL_LIST_PARAMS: Readonly<Record<string, ParamKind>> = {
  limit: 'limit',
  repo: 'repo',
};

/**
 * Validates parameters for label.list.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31
 */
export function validateLabelListParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(LABEL_LIST_PARAMS, params);
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
  if (typeof params.repo === 'string') {
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
  mutating: false,
  params: LABEL_LIST_PARAMS,
  buildArgv: (params) => buildLabelListArgv(params),
  shape: (rawJson) => ({ labels: shapeLabelList(rawJson) }),
};
