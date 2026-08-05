/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Workflow-run-family operation descriptors for the GitHub broker:
 * run.list.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 38-55
 */

import type { OpDescriptor, ValidationError } from './github-broker-types.js';
import { resolveLimit, validateParams } from './github-broker-validation.js';
import {
  GITHUB_OP_SPECS,
  type GithubOpSpec,
} from '@vybestack/llxprt-code-tools/tools/github-ops.js';
import {
  assertNotPartialSuccess,
  extractNumber,
  extractString,
  assertListShape,
} from './github-broker-shaping.js';

const RUN_LIST_SPEC: GithubOpSpec = GITHUB_OP_SPECS['run.list'];

/**
 * Validates parameters for run.list.
 *
 * @plan PLAN-20260731-GHBROKER.P10, PLAN-20260731-GHBROKER.P15
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 13-31
 */
export function validateRunListParams(
  params: Record<string, unknown>,
): ValidationError | null {
  return validateParams(RUN_LIST_SPEC.params, params);
}

/**
 * Builds the `gh` argv array for run.list. Pure; no I/O.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 46-55
 */
export function buildRunListArgv(params: Record<string, unknown>): string[] {
  const argv: string[] = [
    'run',
    'list',
    '--json',
    'databaseId,name,status,conclusion,headBranch,createdAt',
  ];
  argv.push('--limit', String(resolveLimit(params)));
  if (typeof params.branch === 'string' && params.branch.length > 0) {
    argv.push('--branch', params.branch);
  }
  if (typeof params.repo === 'string' && params.repo.length > 0) {
    argv.push('--repo', params.repo);
  }
  return argv;
}

/**
 * A single shaped workflow run in the run.list contract.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 */
export interface ShapedRunListItem {
  readonly databaseId: number;
  readonly name: string;
  readonly status: string;
  readonly conclusion: string;
  readonly headBranch: string;
  readonly createdAt: string;
}

/**
 * Shapes raw gh JSON for run.list into an array of items.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 */
export function shapeRunList(rawJson: unknown): readonly ShapedRunListItem[] {
  assertNotPartialSuccess(rawJson);
  assertListShape(rawJson, 'run.list');
  return rawJson.map((item): ShapedRunListItem => {
    const obj = (item ?? {}) as Record<string, unknown>;
    return {
      databaseId: extractNumber(obj.databaseId),
      name: extractString(obj.name, ''),
      status: extractString(obj.status, ''),
      conclusion: extractString(obj.conclusion, ''),
      headBranch: extractString(obj.headBranch, ''),
      createdAt: extractString(obj.createdAt, ''),
    };
  });
}

/**
 * The run.list operation descriptor.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 38-44
 */
export const runListDescriptor: OpDescriptor = {
  name: 'run.list',
  requiredParams: RUN_LIST_SPEC.required,
  mutating: RUN_LIST_SPEC.mutating,
  params: RUN_LIST_SPEC.params,
  buildArgv: (params) => buildRunListArgv(params),
  shape: (rawJson) => ({ runs: shapeRunList(rawJson) }),
};
