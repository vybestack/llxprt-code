/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useState } from 'react';
import { Box, Text } from 'ink';
import {
  PolicyDecision,
  MAX_USER_PRIORITY,
  type PolicyRule,
  type EditablePolicyRule,
} from '@vybestack/llxprt-code-core';
import { Colors } from '../colors.js';
import { theme } from '../semantic-colors.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import type { RadioSelectItem } from './shared/RadioButtonSelect.js';
import { TextInput } from './ProfileCreateWizard/TextInput.js';
import { useKeypress } from '../hooks/useKeypress.js';

const DECISION_LABELS: Record<PolicyDecision, string> = {
  [PolicyDecision.ALLOW]: 'allow',
  [PolicyDecision.DENY]: 'deny',
  [PolicyDecision.ASK_USER]: 'ask_user',
};

const DECISION_VALUES = [
  PolicyDecision.ALLOW,
  PolicyDecision.DENY,
  PolicyDecision.ASK_USER,
] as const;

const TIER_ORDER = [
  { min: 3.0, label: 'Tier 3 (System / Admin) — read-only' },
  { min: 2.0, label: 'Tier 2 (User-defined) — editable' },
  { min: 1.0, label: 'Tier 1 (Defaults) — read-only' },
  { min: 0.0, label: 'Tier 0 (Base)' },
];

export function tierLabel(priority: number): string {
  for (const tier of TIER_ORDER) {
    if (priority >= tier.min) {
      return tier.label;
    }
  }
  return TIER_ORDER[TIER_ORDER.length - 1].label;
}

export function formatToolName(rule: { toolName?: string }): string {
  return rule.toolName !== undefined && rule.toolName.length > 0
    ? rule.toolName
    : '*';
}

export function formatDecision(decision: PolicyDecision): string {
  return DECISION_LABELS[decision];
}

export function ruleSummary(rule: EditablePolicyRule): string {
  const pattern = rule.argsPattern ? ` (pattern: ${rule.argsPattern})` : '';
  return `${formatToolName(rule)} \u2192 ${formatDecision(rule.decision)}${pattern} [priority ${rule.priority}]`;
}

export function engineRuleSummary(rule: PolicyRule): string {
  const priority = rule.priority ?? 0;
  const pattern = rule.argsPattern
    ? ` (pattern: ${rule.argsPattern.source})`
    : '';
  const source = rule.source ? ` [${rule.source}]` : '';
  return `${formatToolName(rule)} \u2192 ${formatDecision(rule.decision)}${pattern} [${priority.toFixed(3)}]${source}`;
}

export function parsePriority(value: string): number | null {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n) || n < 0 || n > MAX_USER_PRIORITY) {
    return null;
  }
  return n;
}

function groupByTier(rules: readonly PolicyRule[]): Map<string, PolicyRule[]> {
  const groups = new Map<string, PolicyRule[]>();
  for (const rule of rules) {
    const label = tierLabel(rule.priority ?? 0);
    const arr = groups.get(label) ?? [];
    arr.push(rule);
    groups.set(label, arr);
  }
  return groups;
}

export interface PolicyFormProps {
  initial: EditablePolicyRule;
  title: string;
  onSubmit: (rule: EditablePolicyRule) => void;
  onCancel: () => void;
}

function ToolNameStep({
  toolName,
  setToolName,
  onContinue,
}: {
  toolName: string;
  setToolName: (v: string) => void;
  onContinue: () => void;
}) {
  return (
    <Box flexDirection="column">
      <Text color={Colors.Comment}>Tool name (or empty for wildcard *):</Text>
      <TextInput
        value={toolName}
        onChange={setToolName}
        onSubmit={onContinue}
        isFocused={true}
        placeholder="e.g. edit, run_shell_command, or *"
      />
      <Text color={Colors.Gray}>(Enter to continue)</Text>
    </Box>
  );
}

function ArgsPatternStep({
  argsPattern,
  setArgsPattern,
  onContinue,
}: {
  argsPattern: string;
  setArgsPattern: (v: string) => void;
  onContinue: () => void;
}) {
  return (
    <Box flexDirection="column">
      <Text color={Colors.Comment}>
        Args regex (optional, matches the JSON tool args):
      </Text>
      <TextInput
        value={argsPattern}
        onChange={setArgsPattern}
        onSubmit={onContinue}
        isFocused={true}
        placeholder="e.g. git status (leave empty for none)"
      />
      <Text color={Colors.Gray}>(Enter to continue)</Text>
    </Box>
  );
}

function PriorityStep({
  priorityStr,
  setPriorityStr,
  error,
  onSubmit,
}: {
  priorityStr: string;
  setPriorityStr: (v: string) => void;
  error: string | null;
  onSubmit: () => void;
}) {
  return (
    <Box flexDirection="column">
      <Text color={Colors.Comment}>
        Priority (0-{MAX_USER_PRIORITY}, higher wins within the tier):
      </Text>
      <TextInput
        value={priorityStr}
        onChange={(v) => {
          setPriorityStr(v);
        }}
        onSubmit={onSubmit}
        isFocused={true}
      />
      {error !== null && <Text color={theme.status.error}>{error}</Text>}
      <Text color={Colors.Gray}>(Enter to save, Esc to go back)</Text>
    </Box>
  );
}

interface PolicyFormState {
  step: number;
  toolName: string;
  decision: PolicyDecision;
  argsPattern: string;
  priorityStr: string;
  error: string | null;
}

function useFormState(
  initial: EditablePolicyRule,
  onSubmit: (rule: EditablePolicyRule) => void,
): PolicyFormState & {
  setStep: (n: number) => void;
  setToolName: (v: string) => void;
  setArgsPattern: (v: string) => void;
  setPriorityStr: (v: string) => void;
  setDecision: (d: PolicyDecision) => void;
  handleDecisionSelect: (d: PolicyDecision) => void;
  handleSubmit: () => void;
} {
  const [step, setStep] = useState(0);
  const [toolName, setToolName] = useState(initial.toolName);
  const [decision, setDecision] = useState(initial.decision);
  const [argsPattern, setArgsPattern] = useState(initial.argsPattern ?? '');
  const [priorityStr, setPriorityStr] = useState(String(initial.priority));
  const [error, setError] = useState<string | null>(null);

  const handleDecisionSelect = useCallback(
    (value: PolicyDecision) => {
      setDecision(value);
      setStep(2);
    },
    [setDecision, setStep],
  );

  const handleSubmit = useCallback(() => {
    const priority = parsePriority(priorityStr);
    if (priority === null) {
      setError(
        `Priority must be an integer between 0 and ${MAX_USER_PRIORITY}.`,
      );
      setStep(3);
      return;
    }
    const trimmedPattern = argsPattern.trim();
    if (trimmedPattern) {
      try {
        new RegExp(trimmedPattern);
      } catch {
        setError('Invalid regular expression pattern.');
        setStep(2);
        return;
      }
    }
    onSubmit({
      toolName: toolName.trim(),
      decision,
      priority,
      ...(trimmedPattern ? { argsPattern: trimmedPattern } : {}),
    });
  }, [argsPattern, decision, onSubmit, priorityStr, toolName]);

  return {
    step,
    toolName,
    decision,
    argsPattern,
    priorityStr,
    error,
    setStep,
    setToolName,
    setArgsPattern,
    setPriorityStr: (v: string) => {
      setPriorityStr(v);
      setError(null);
    },
    setDecision,
    handleDecisionSelect,
    handleSubmit,
  };
}

export const PolicyForm: React.FC<PolicyFormProps> = ({
  initial,
  title,
  onSubmit,
  onCancel,
}) => {
  const s = useFormState(initial, onSubmit);
  const decisionItems: Array<RadioSelectItem<PolicyDecision>> =
    DECISION_VALUES.map((d) => ({
      key: d,
      label: formatDecision(d),
      value: d,
    }));

  useKeypress(
    (key) => {
      if (key.name === 'escape' && s.step !== 1) onCancel();
    },
    { isActive: true },
  );

  return (
    <Box flexDirection="column" marginLeft={1}>
      <Text color={Colors.Foreground} bold>
        {title}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {s.step === 0 && (
          <ToolNameStep
            toolName={s.toolName}
            setToolName={s.setToolName}
            onContinue={() => s.setStep(1)}
          />
        )}
        {s.step === 1 && (
          <Box flexDirection="column">
            <Text color={Colors.Comment}>Decision:</Text>
            <RadioButtonSelect
              items={decisionItems}
              initialIndex={Math.max(0, DECISION_VALUES.indexOf(s.decision))}
              onSelect={s.handleDecisionSelect}
              isFocused={true}
            />
          </Box>
        )}
        {s.step === 2 && (
          <ArgsPatternStep
            argsPattern={s.argsPattern}
            setArgsPattern={s.setArgsPattern}
            onContinue={() => s.setStep(3)}
          />
        )}
        {s.step === 3 && (
          <PriorityStep
            priorityStr={s.priorityStr}
            setPriorityStr={s.setPriorityStr}
            error={s.error}
            onSubmit={s.handleSubmit}
          />
        )}
      </Box>
      {s.step > 0 && (
        <Box marginTop={1}>
          <Text color={Colors.Gray}>(Esc to go back)</Text>
        </Box>
      )}
    </Box>
  );
};

export const PolicyStackView: React.FC<{ rules: readonly PolicyRule[] }> = ({
  rules,
}) => {
  const groups = groupByTier(rules);
  return (
    <Box flexDirection="column" marginLeft={1}>
      {TIER_ORDER.map((tier) => {
        const tierRules = groups.get(tier.label);
        if (tierRules === undefined || tierRules.length === 0) {
          return null;
        }
        return (
          <Box key={tier.label} flexDirection="column" marginBottom={1}>
            <Text color={Colors.AccentYellow} bold>
              {tier.label}
            </Text>
            {tierRules.map((rule, i) => (
              <Text key={i} color={Colors.Comment}>
                {'  '}
                {engineRuleSummary(rule)}
              </Text>
            ))}
          </Box>
        );
      })}
    </Box>
  );
};

export interface MenuItem {
  key: string;
  label: string;
  value: string;
}

export function buildMenuItems(
  rules: readonly EditablePolicyRule[],
): MenuItem[] {
  return [
    { key: 'add', label: '[+] Add new rule', value: '__add__' },
    ...rules.map((r, i) => ({
      key: `rule-${i}`,
      label: ruleSummary(r),
      value: String(i),
    })),
    { key: 'stack', label: '[i] View active stack', value: '__stack__' },
    { key: 'close', label: '[x] Close', value: '__close__' },
  ];
}

export const ACTION_ITEMS: MenuItem[] = [
  { key: 'edit', label: 'Edit', value: 'edit' },
  { key: 'delete', label: 'Delete', value: 'delete' },
  { key: 'duplicate', label: 'Duplicate', value: 'duplicate' },
  { key: 'back', label: 'Back', value: 'back' },
];
