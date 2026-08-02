/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Operation registry for the GitHub broker.
 *
 * This module assembles the OP_REGISTRY from per-family op modules and
 * re-exports the shared validation and shaping functions that tests and
 * the dispatcher import.
 *
 * Per-family modules:
 * - github-broker-issue-ops.ts: issue.view, issue.list
 * - github-broker-pr-ops.ts: pr.list, pr.view, pr.diff, pr.checks, pr.reviews
 * - github-broker-search-ops.ts: search.issues, search.prs
 * - github-broker-run-ops.ts: run.list
 * - github-broker-label-ops.ts: label.list
 *
 * @plan PLAN-20260731-GHBROKER.P08, PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-004, REQ-013
 * @pseudocode 003-github-broker.md lines 38-55, 101-126
 */

import type { OpDescriptor } from './github-broker-types.js';

// Re-export validation and shaping for test and dispatch consumers.
export {
  validateParams,
  resolveLimit,
  MAX_LIMIT,
  DEFAULT_LIMIT,
} from './github-broker-validation.js';
export {
  assertNotPartialSuccess,
  extractAuthor,
  extractComments,
  extractLabels,
  extractNumber,
  extractString,
  truncateWithMarker,
  TRUNCATION_LIMIT_BYTES,
  TRUNCATION_MARKER,
  type ShapedComment,
} from './github-broker-shaping.js';

// Re-export issue ops.
export {
  issueViewDescriptor,
  buildIssueViewArgv,
  shapeIssueView,
  validateIssueViewParams,
  issueListDescriptor,
  buildIssueListArgv,
  shapeIssueList,
  validateIssueListParams,
  type ShapedIssueView,
  type ShapedIssueListItem,
} from './github-broker-issue-ops.js';

// Re-export PR ops.
export {
  prListDescriptor,
  buildPrListArgv,
  shapePrList,
  validatePrListParams,
  prViewDescriptor,
  buildPrViewArgv,
  shapePrView,
  validatePrViewParams,
  prDiffDescriptor,
  buildPrDiffArgv,
  shapePrDiff,
  validatePrDiffParams,
  prChecksDescriptor,
  buildPrChecksArgv,
  shapePrChecks,
  validatePrChecksParams,
  prReviewsDescriptor,
  buildPrReviewsArgv,
  shapePrReviews,
  validatePrReviewsParams,
  type ShapedPrListItem,
  type ShapedPrView,
  type ShapedPrDiff,
  type ShapedPrChecks,
  type ShapedCheck,
  type ShapedPrReviews,
  type ShapedReviewThread,
  type ShapedReviewComment,
} from './github-broker-pr-ops.js';

// Re-export search ops.
export {
  searchIssuesDescriptor,
  buildSearchIssuesArgv,
  shapeSearchResults,
  validateSearchIssuesParams,
  searchPrsDescriptor,
  buildSearchPrsArgv,
  validateSearchPrsParams,
  type ShapedSearchItem,
} from './github-broker-search-ops.js';

// Re-export run ops.
export {
  runListDescriptor,
  buildRunListArgv,
  shapeRunList,
  validateRunListParams,
  type ShapedRunListItem,
} from './github-broker-run-ops.js';

// Re-export label ops.
export {
  labelListDescriptor,
  buildLabelListArgv,
  shapeLabelList,
  validateLabelListParams,
  type ShapedLabelListItem,
} from './github-broker-label-ops.js';

// Import descriptors for registry assembly.
import { issueViewDescriptor } from './github-broker-issue-ops.js';
import { issueListDescriptor } from './github-broker-issue-ops.js';
import {
  prListDescriptor,
  prViewDescriptor,
  prDiffDescriptor,
  prChecksDescriptor,
  prReviewsDescriptor,
} from './github-broker-pr-ops.js';
import {
  searchIssuesDescriptor,
  searchPrsDescriptor,
} from './github-broker-search-ops.js';
import { runListDescriptor } from './github-broker-run-ops.js';
import { labelListDescriptor } from './github-broker-label-ops.js';
import {
  issueCreateDescriptor,
  issueCommentDescriptor,
  issueCloseDescriptor,
} from './github-broker-issue-write-ops.js';
import {
  prCreateDescriptor,
  prCommentDescriptor,
  prEditDescriptor,
  prReadyDescriptor,
  labelCreateDescriptor,
} from './github-broker-pr-write-ops.js';
import {
  issueEditDescriptor,
  prResolveThreadDescriptor,
} from './github-broker-multistep-ops.js';

/**
 * The registry of all operation descriptors. Unknown ops yield UNKNOWN_OP.
 *
 * @plan PLAN-20260731-GHBROKER.P08, PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 46-47
 */
export const OP_REGISTRY: Readonly<Record<string, OpDescriptor>> = {
  'issue.view': issueViewDescriptor,
  'issue.list': issueListDescriptor,
  'pr.list': prListDescriptor,
  'pr.view': prViewDescriptor,
  'pr.diff': prDiffDescriptor,
  'pr.checks': prChecksDescriptor,
  'pr.reviews': prReviewsDescriptor,
  'search.issues': searchIssuesDescriptor,
  'search.prs': searchPrsDescriptor,
  'run.list': runListDescriptor,
  'label.list': labelListDescriptor,
  'issue.create': issueCreateDescriptor,
  'issue.comment': issueCommentDescriptor,
  'issue.close': issueCloseDescriptor,
  'pr.create': prCreateDescriptor,
  'pr.comment': prCommentDescriptor,
  'pr.edit': prEditDescriptor,
  'pr.ready': prReadyDescriptor,
  'label.create': labelCreateDescriptor,
  'issue.edit': issueEditDescriptor,
  'pr.resolve-thread': prResolveThreadDescriptor,
};
