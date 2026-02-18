/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  getDecisionFromOutcome,
  ToolCallDecision,
} from './tool-call-decision.js';
import { ToolConfirmationOutcome } from '../tools/tools.js';

describe('getDecisionFromOutcome', () => {
  it('maps ProceedOnce to ACCEPT', () => {
    expect(getDecisionFromOutcome(ToolConfirmationOutcome.ProceedOnce)).toBe(
      ToolCallDecision.ACCEPT,
    );
  });

  it('maps ProceedAlways to AUTO_ACCEPT', () => {
    expect(getDecisionFromOutcome(ToolConfirmationOutcome.ProceedAlways)).toBe(
      ToolCallDecision.AUTO_ACCEPT,
    );
  });

  it('maps ProceedAlwaysServer to AUTO_ACCEPT', () => {
    expect(
      getDecisionFromOutcome(ToolConfirmationOutcome.ProceedAlwaysServer),
    ).toBe(ToolCallDecision.AUTO_ACCEPT);
  });

  it('maps ProceedAlwaysTool to AUTO_ACCEPT', () => {
    expect(
      getDecisionFromOutcome(ToolConfirmationOutcome.ProceedAlwaysTool),
    ).toBe(ToolCallDecision.AUTO_ACCEPT);
  });

  it('maps ModifyWithEditor to MODIFY', () => {
    expect(
      getDecisionFromOutcome(ToolConfirmationOutcome.ModifyWithEditor),
    ).toBe(ToolCallDecision.MODIFY);
  });

  it('maps SuggestEdit to MODIFY', () => {
    expect(getDecisionFromOutcome(ToolConfirmationOutcome.SuggestEdit)).toBe(
      ToolCallDecision.MODIFY,
    );
  });

  it('maps Cancel to REJECT', () => {
    expect(getDecisionFromOutcome(ToolConfirmationOutcome.Cancel)).toBe(
      ToolCallDecision.REJECT,
    );
  });
});
