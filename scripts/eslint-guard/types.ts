/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

type Severity = 'off' | 'warn' | 'error';
type ThresholdForm = 'max' | 'numeric';

export interface Violation {
  file: string;
  lineNumber: number;
  message: string;
  content: string;
}

interface PolicyRecord {
  file: string;
  lineNumber: number;
  content: string;
}

interface PolicyState {
  removedInlineDisableBan: PolicyRecord | null;
  addedInlineDisableBan: boolean;
  removedMaxWarnings: PolicyRecord | null;
  addedMaxWarnings: boolean;
}

export interface RuleState {
  ruleKey: string | null;
  severity: Severity | null;
  threshold: number | null;
  thresholdForm: ThresholdForm | null;
}

export interface RemovedRuleState extends RuleState {
  ruleKey: string;
  content: string;
  lineNumber: number;
  consumed: boolean;
  severityConsumed: boolean;
  thresholdConsumed: boolean;
}

interface RemovedConfig {
  content: string;
  lineNumber: number;
}

interface MultilineEntry {
  content: string;
  lineNumber: number;
  ruleKey: string;
}

interface InlineRuleEntry {
  key: string;
  content: string;
  lineNumber: number;
}

interface TemplateLiteralState {
  inTemplate: boolean;
  exprDepth: number;
}

export interface DiffState {
  violations: Violation[];
  policyState: PolicyState;
  file: string;
  newLine: number;
  oldLine: number;
  pendingRemovedConfigs: RemovedConfig[];
  pendingRemovedRuleState: RemovedRuleState[];
  pendingRemovedMultilineSeverity: MultilineEntry[];
  pendingRemovedMultilineMax: MultilineEntry[];
  pendingRemovedMultilineNumericThreshold: MultilineEntry[];
  pendingRemovedInlineRules: InlineRuleEntry[];
  rulesBraceDepth: number | null;
  currentCeilingRuleKey: string | null;
  currentRuleKey: string | null;
  insideRuleEntry: boolean;
  ruleEntryDepth: number | null;
  expectingFirstSeverityElement: boolean;
  expectingCeilingThreshold: boolean;
  removedRulesBraceDepth: number | null;
  removedCurrentRuleKey: string | null;
  removedCurrentCeilingRuleKey: string | null;
  removedInsideRuleEntry: boolean;
  removedRuleEntryDepth: number | null;
  removedExpectingFirstSeverityElement: boolean;
  removedExpectingCeilingThreshold: boolean;
  arbitraryObjectDepth: number | null;
  removedArbitraryObjectDepth: number | null;
  nonRuleContainerDepth: number | null;
  removedNonRuleContainerDepth: number | null;
  hasHunkContext: boolean;
  removedCompletedDirectiveCleanupBlockDepth: number | null;
  removedCompletedDirectiveCleanupBlockInComment: boolean;
  templateLiteralState: TemplateLiteralState;
}

export interface CrossFormFlags {
  isSeverity: boolean;
  isNumeric: boolean;
  isMax: boolean;
}
