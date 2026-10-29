/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P01
 *
 * BEHAVIORAL RED suite for createAgent production-safety hardening.
 *
 * createAgent historically forces three harness seams that are unsafe for
 * production callers: interactive=true (overwrites caller intent), forced
 * confirmation-forcing policy injection, and unconditional process.cwd()
 * workspace mutation. The `harness` AgentConfig field lets a caller disable
 * each unsafe seam explicitly.
 *
 * These tests drive the PUBLIC ROOT via the buildAgent harness over a real
 * FakeProvider. They assert PUBLIC BEHAVIORAL EFFECTS (approval mode, policy
 * non-interactivity, workspace directories) rather than internal implementation
 * details.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'bun:test';
import {
  ApprovalMode,
  PolicyDecision,
  type Agent,
  type AgentConfig,
} from '@vybestack/llxprt-code-agents';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { CONFIRMATION_FORCING_SOURCE } from '../confirmationForcing.js';
import {
  buildAgent,
  buildAgentFromContent,
  drain,
  isDoneEvent,
  isToolConfirmationEvent,
  isToolResultEvent,
  respondToFirstConfirmation,
  tempRoot,
} from './helpers/agentHarness.js';

/** One write_file call followed by a closing text turn. */
function writeFileScript(outputPath: string): string {
  return `${JSON.stringify({
    chunks: [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-write-1',
            name: 'write_file',
            parameters: { file_path: outputPath, content: 'unsafe' },
          },
        ],
      },
    ],
  })}\n${JSON.stringify({
    chunks: [
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'write attempted' }],
      },
    ],
  })}\n`;
}

/**
 * Streams a write_file turn on an agent whose policy asks the user. A
 * non-interactive runtime cannot prompt, so the tool is refused without a
 * confirmation event and without writing; an interactive one raises the
 * confirmation (see the 'keeps real tool confirmations' scenario).
 */
async function streamWriteFileTurn(
  overrides: Readonly<Partial<AgentConfig>>,
): Promise<{
  readonly events: Awaited<ReturnType<typeof drain>>;
  readonly written: boolean;
  readonly rules: ReturnType<Agent['policy']['getRules']>;
}> {
  const dir = mkdtempSync(join(tempRoot, 'non-interactive-write-'));
  const outputPath = join(dir, 'output.txt');
  try {
    const built = await buildAgentFromContent(writeFileScript(outputPath), {
      workingDir: dir,
      policy: { defaultDecision: PolicyDecision.ASK_USER },
      ...overrides,
    });
    try {
      const events = await drain(built.agent.stream('run write tool'));
      return {
        events,
        written: existsSync(outputPath),
        rules: built.agent.policy.getRules(),
      };
    } finally {
      await built.cleanup();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('agent Config ownership', () => {
  it('has no production Config side-channel module', () => {
    expect(
      existsSync(new URL('../internalConfigAccess.ts', import.meta.url)),
    ).toBe(false);
  });
});

describe('createAgent harness hardening @plan:PLAN-20260626-RUNTIMEBOUNDARY.P01', () => {
  it('respects caller interactive:false when harness.forceInteractive is false @scenario:no-force-interactive @given:an agent config with interactive:false and harness:{forceInteractive:false} @when:createAgent builds the agent @then:the runtime is non-interactive (caller value preserved, not overwritten to true): a confirmation-requiring write_file is refused as non-interactive without a confirmation event', async () => {
    const turn = await streamWriteFileTurn({
      interactive: false,
      harness: { forceInteractive: false },
    });
    expect(turn.events.filter(isToolConfirmationEvent)).toHaveLength(0);
    expect(JSON.stringify(turn.events.filter(isToolResultEvent))).toContain(
      'non-interactive mode',
    );
    expect(turn.written).toBe(false);
  });

  it('respects caller approvalMode when harness.forceInteractive is false @scenario:approval-mode-preserved @given:an agent config with approvalMode:DEFAULT and interactive:false and harness:{forceInteractive:false} @when:createAgent builds the agent @then:getApprovalMode() === ApprovalMode.DEFAULT (caller value preserved, not overwritten)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      interactive: false,
      approvalMode: ApprovalMode.DEFAULT,
      harness: { forceInteractive: false },
    });
    try {
      expect(agent.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
    } finally {
      await cleanup();
    }
  });

  it('does NOT force confirmations when forceInteractive is false and interactive is omitted @scenario:no-confirmations-with-implicit-noninteractive @given:harness:{forceInteractive:false} and no interactive field @when:createAgent builds the agent @then:confirmation forcing is disabled because the runtime was not positively forced interactive', async () => {
    const turn = await streamWriteFileTurn({
      harness: { forceInteractive: false },
    });
    const forcingRules = turn.rules.filter(
      (r) => r.source === CONFIRMATION_FORCING_SOURCE,
    );
    expect(forcingRules).toHaveLength(0);
    expect(turn.events.filter(isToolConfirmationEvent)).toHaveLength(0);
    expect(JSON.stringify(turn.events.filter(isToolResultEvent))).toContain(
      'non-interactive mode',
    );
    expect(turn.written).toBe(false);
  });

  it('does NOT inject the confirmation-forcing policy rule when harness.forceConfirmations is false @scenario:no-force-confirmations @given:an agent config with harness:{forceConfirmations:false} @when:createAgent builds the agent @then:no policy rule has source containing "confirmation-forcing"', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      harness: { forceConfirmations: false },
    });
    try {
      const rules = agent.policy.getRules();
      const forcingRules = rules.filter(
        (r) => r.source === CONFIRMATION_FORCING_SOURCE,
      );
      expect(forcingRules).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });

  it('does NOT force registry confirmation details when harness.forceConfirmations is false @scenario:no-registry-forcing @given:a policy ASK path and a read-only tool call with harness:{forceConfirmations:false} @when:the agent streams the turn @then:no artificial tool-confirmation event is surfaced and read-only execution can complete', async () => {
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl', {
      policy: { defaultDecision: PolicyDecision.ASK_USER },
      harness: { forceConfirmations: false },
    });
    try {
      const events = await drain(agent.stream('run the tool'));
      expect(events.filter(isToolConfirmationEvent)).toHaveLength(0);
      expect(events.filter(isToolResultEvent).length).toBeGreaterThanOrEqual(1);
      const done = events.filter(isDoneEvent);
      expect(done).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it('keeps real tool confirmations when harness.forceConfirmations is false @scenario:real-confirmation-preserved @given:a policy ASK path and a write_file tool call with harness:{forceConfirmations:false} @when:the agent streams the turn @then:the real write_file confirmation is surfaced and can be cancelled by the caller without writing', async () => {
    const dir = mkdtempSync(join(tempRoot, 'force-confirmations-'));
    const outputPath = join(dir, 'output.txt');
    const fixture = `${JSON.stringify({
      chunks: [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call-write-1',
              name: 'write_file',
              parameters: { file_path: outputPath, content: 'unsafe' },
            },
          ],
        },
      ],
    })}\n${JSON.stringify({
      chunks: [
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'write attempted' }],
        },
      ],
    })}\n`;
    rmSync(outputPath, { force: true });
    let built: Awaited<ReturnType<typeof buildAgentFromContent>>;
    try {
      built = await buildAgentFromContent(fixture, {
        workingDir: dir,
        policy: { defaultDecision: PolicyDecision.ASK_USER },
        harness: { forceConfirmations: false },
      });
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      throw error;
    }

    try {
      const responder = respondToFirstConfirmation(
        built.agent,
        ToolConfirmationOutcome.Cancel,
      );
      try {
        const events = await drain(built.agent.stream('run write tool'));
        expect(
          events.filter(isToolConfirmationEvent).length,
        ).toBeGreaterThanOrEqual(1);
        expect(events.filter(isToolResultEvent).length).toBeGreaterThanOrEqual(
          1,
        );
        await expect(responder.captured).resolves.toMatchObject({
          name: 'write_file',
        });
        expect(existsSync(outputPath)).toBe(false);
      } finally {
        responder.unsubscribe();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await built.cleanup();
    }
  });

  it('default behavior still wraps the registry so ASK reaches a forced tool confirmation @scenario:default-registry-forcing @given:a default createAgent harness and tool call @when:the agent streams the turn @then:a tool-confirmation event is surfaced and can be answered', async () => {
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl');
    try {
      const responder = respondToFirstConfirmation(
        agent,
        ToolConfirmationOutcome.ProceedOnce,
      );
      try {
        const events = await drain(agent.stream('run the tool'));
        expect(
          events.filter(isToolConfirmationEvent).length,
        ).toBeGreaterThanOrEqual(1);
        expect(events.filter(isToolResultEvent).length).toBeGreaterThanOrEqual(
          1,
        );
        await expect(responder.captured).resolves.toMatchObject({
          name: 'read_file',
        });
      } finally {
        responder.unsubscribe();
      }
    } finally {
      await cleanup();
    }
  });

  it('does NOT add process.cwd() to the workspace when harness.includeProcessCwd is false @scenario:no-process-cwd @given:an agent config with harness:{includeProcessCwd:false} @when:createAgent builds the agent @then:agent.workspace.getDirectories() does NOT contain process.cwd()', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      harness: { includeProcessCwd: false },
    });
    try {
      const dirs = agent.workspace.getDirectories();
      // process.cwd() should NOT be among the workspace directories.
      expect(dirs).not.toContain(process.cwd());
    } finally {
      await cleanup();
    }
  });

  it('default behavior (no harness field) preserves the current harness seams for backward compatibility @scenario:default-harness @given:an agent config with NO harness field @when:createAgent builds the agent @then:the confirmation-forcing rule IS present (backward compatible default)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const rules = agent.policy.getRules();
      const forcingRules = rules.filter(
        (r) => r.source === CONFIRMATION_FORCING_SOURCE,
      );
      // The default harness injects the confirmation-forcing rule.
      expect(forcingRules.length).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanup();
    }
  });
});
