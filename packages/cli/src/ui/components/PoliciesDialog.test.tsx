/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { act } from 'react';
import { renderWithProviders, waitFor } from '../../test-utils/render.js';
import { vi, describe, it, expect, beforeEach } from 'bun:test';

const realRealInkModule = {
  ...(await import('../../../test-utils/real-ink.js')),
};

void vi.mock('ink', () => realRealInkModule);

import {
  PoliciesDialog,
  type PoliciesDialogRuntime,
} from './PoliciesDialog.js';
import { MessageType } from '../types.js';

const PolicyDecision = {
  ALLOW: 'allow',
  DENY: 'deny',
  ASK_USER: 'ask_user',
} as unknown as typeof import('@vybestack/llxprt-code-core').PolicyDecision;

const mockListEditableRules = vi.fn();
const mockAddEditableRule = vi.fn();
const mockUpdateEditableRule = vi.fn();
const mockDeleteEditableRule = vi.fn();
const mockDuplicateEditableRule = vi.fn();
const mockReloadUserPolicyRules = vi.fn();

const actual = { ...(await import('@vybestack/llxprt-code-core')) };
void vi.mock('@vybestack/llxprt-code-core', () => {
  return {
    ...actual,
    PolicyDecision,
    MAX_USER_PRIORITY: 999,
    listEditableRules: mockListEditableRules,
    addEditableRule: mockAddEditableRule,
    updateEditableRule: mockUpdateEditableRule,
    deleteEditableRule: mockDeleteEditableRule,
    duplicateEditableRule: mockDuplicateEditableRule,
    reloadUserPolicyRules: mockReloadUserPolicyRules,
  };
});

const mockAddItem = vi.fn();

type MockEngineRule = {
  toolName?: string;
  decision: string;
  priority?: number;
  source?: string;
  argsPattern?: { source: string };
};

function createMockConfig(
  engineRules: MockEngineRule[] = [],
): PoliciesDialogRuntime {
  const engine = {
    getRules: () => engineRules,
    evaluate: () => PolicyDecision.ASK_USER,
    getDefaultDecision: () => PolicyDecision.ASK_USER,
    isNonInteractive: () => false,
    replaceRules: vi.fn(),
  };
  return {
    getPolicyEngine: () => engine,
    getApprovalMode: () => 'default',
  } as unknown as PoliciesDialogRuntime;
}

describe('PoliciesDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListEditableRules.mockResolvedValue([]);
    mockAddEditableRule.mockImplementation(async (rule) => rule);
    mockUpdateEditableRule.mockImplementation(async (_i, rule) => rule);
    mockDeleteEditableRule.mockResolvedValue(undefined);
    mockDuplicateEditableRule.mockResolvedValue({
      toolName: 'edit',
      decision: PolicyDecision.ALLOW,
      priority: 100,
    });
    mockReloadUserPolicyRules.mockImplementation(async (engine) =>
      engine.getRules(),
    );
  });

  async function renderDialog(config: ReturnType<typeof createMockConfig>) {
    const result = renderWithProviders(
      <PoliciesDialog
        config={config}
        addItem={mockAddItem as never}
        onExit={vi.fn()}
      />,
    );
    // The dialog loads policies asynchronously; settling that here keeps the
    // resulting state update inside act() instead of letting it land after
    // the test has returned.
    await act(async () => {});
    return result;
  }

  it('renders the Policy Manager title', async () => {
    const { lastFrame } = await renderDialog(createMockConfig());
    await waitFor(() => {
      expect(lastFrame()).toContain('Policy Manager');
    });
  });

  it('shows a message when no user overrides exist', async () => {
    const { lastFrame } = await renderDialog(createMockConfig());
    await waitFor(() => {
      expect(lastFrame()).toContain('No user overrides yet');
    });
  });

  it('lists existing editable rules in the menu', async () => {
    mockListEditableRules.mockResolvedValue([
      {
        toolName: 'edit',
        decision: PolicyDecision.ALLOW,
        priority: 100,
      },
      {
        toolName: '',
        decision: PolicyDecision.DENY,
        priority: 50,
      },
    ]);
    const { lastFrame } = await renderDialog(createMockConfig());
    await waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('edit');
      expect(frame).toContain('allow');
      expect(frame).toContain('*');
      expect(frame).toContain('deny');
    });
  });

  it('shows the active stack when View active stack is selected', async () => {
    const engineRules = [
      {
        toolName: 'read_file',
        decision: PolicyDecision.ALLOW,
        priority: 1.05,
        source: 'Default: defaults.toml',
      },
      {
        toolName: 'edit',
        decision: PolicyDecision.ASK_USER,
        priority: 1.015,
        source: 'Default: defaults.toml',
      },
    ];
    const { lastFrame, stdin } = await renderDialog(
      createMockConfig(engineRules),
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Add new rule');
    });

    // Navigate to "View active stack" — it's after "Add new rule" and any rules
    // Menu: [0] Add new rule, [1] View active stack, [2] Close
    stdin.write('\u001B[B'); // down to View active stack
    await waitFor(() => {
      expect(lastFrame()).toContain('View active stack');
    });
    stdin.write('\r'); // Enter
    await waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Tier 1 (Defaults)');
      expect(frame).toContain('read-only');
    });
  });

  it('shows an error when policy engine is not available', async () => {
    const { lastFrame } = renderWithProviders(
      <PoliciesDialog
        config={undefined}
        addItem={mockAddItem as never}
        onExit={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(lastFrame()).toContain('Policy engine not available');
    });
  });

  it('warns that default and system tiers are read-only', async () => {
    const { lastFrame } = await renderDialog(createMockConfig());
    await waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('read-only');
    });
  });

  it('navigates the Add Rule form and saves with defaults', async () => {
    const { lastFrame, stdin } = await renderDialog(createMockConfig());

    await waitFor(() => {
      expect(lastFrame()).toContain('Add new rule');
    });

    // [0] is already "Add new rule", press Enter
    await act(async () => {
      stdin.write('\r');
    });
    // Step 0: tool name — type a single char then Enter
    // (ink-testing-library batches multi-char writes; full keyboard typing
    // is validated via the tmux integration harness for UI changes)
    await waitFor(() => {
      expect(lastFrame()).toContain('Tool name');
    });
    await act(async () => {
      stdin.write('g');
    });
    await act(async () => {
      stdin.write('\r');
    });
    // Step 1: decision — press Enter for default (allow)
    await waitFor(() => {
      expect(lastFrame()).toContain('Decision');
    });
    await act(async () => {
      stdin.write('\r');
    });
    // Step 2: args pattern — leave empty, press Enter
    await waitFor(() => {
      expect(lastFrame()).toContain('Args regex');
    });
    await act(async () => {
      stdin.write('\r');
    });
    // Step 3: priority — press Enter for default (100)
    await waitFor(() => {
      expect(lastFrame()).toContain('Priority');
    });
    await act(async () => {
      stdin.write('\r');
    });
    await waitFor(() => {
      expect(mockAddEditableRule).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'g',
          decision: PolicyDecision.ALLOW,
          priority: 100,
        }),
      );
    });
  });

  it('records a history item after adding a rule', async () => {
    const { lastFrame, stdin } = await renderDialog(createMockConfig());

    await waitFor(() => {
      expect(lastFrame()).toContain('Add new rule');
    });

    stdin.write('\r'); // Add new rule
    await waitFor(() => expect(lastFrame()).toContain('Tool name'));
    await act(async () => {
      stdin.write('g');
    });
    await act(async () => {
      stdin.write('\r');
    });
    await waitFor(() => expect(lastFrame()).toContain('Decision'));
    await act(async () => {
      stdin.write('\r');
    });
    await waitFor(() => expect(lastFrame()).toContain('Args regex'));
    await act(async () => {
      stdin.write('\r');
    });
    await waitFor(() => expect(lastFrame()).toContain('Priority'));
    await act(async () => {
      stdin.write('\r');
    });
    await waitFor(() => {
      expect(mockAddItem).toHaveBeenCalledWith(
        expect.objectContaining({ type: MessageType.INFO }),
        expect.any(Number),
      );
    });
  });
});
