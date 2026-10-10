/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { usePhysicalHook } from '../hooks/__tests__/physical-hook-fixture.js';
import {
  triggerSessionStartHook,
  triggerSessionEndHook,
  triggerBeforeAgentHook,
  triggerAfterAgentHook,
  triggerPreCompressHook,
} from './lifecycleHookTriggers.js';
import {
  HookEventName,
  SessionStartSource,
  SessionEndReason,
  PreCompressTrigger,
  SessionStartHookOutput,
  SessionEndHookOutput,
  BeforeAgentHookOutput,
  AfterAgentHookOutput,
  DefaultHookOutput,
} from '../hooks/types.js';
import type { HookExecutionOwner } from '../hooks/hookEventHandler.js';
import type { AggregatedHookResult } from '../hooks/hookAggregator.js';

function aggregated(finalOutput?: DefaultHookOutput): AggregatedHookResult {
  return {
    success: true,
    finalOutput,
    allOutputs: finalOutput ? [finalOutput] : [],
    errors: [],
    totalDuration: 0,
  };
}

function ownerWith(handlers: Partial<HookExecutionOwner>): HookExecutionOwner {
  return {
    sessionId: () => 'explicit-session',
    transcriptPath: () => 'transcript.jsonl',
    ...handlers,
  };
}

const feedback = {
  continue: true,
  systemMessage: 'hook feedback',
  hookSpecificOutput: { additionalContext: 'workspace context' },
};

describe('Lifecycle Hook Triggers through an in-process execution owner (all platforms)', () => {
  it('returns SessionStartHookOutput and forwards the source', async () => {
    const sources: SessionStartSource[] = [];
    const owner = ownerWith({
      sessionStart: async (source) => {
        sources.push(source);
        return aggregated(new DefaultHookOutput(feedback));
      },
    });
    const result = await triggerSessionStartHook(
      SessionStartSource.Startup,
      owner,
    );
    expect(result).toBeInstanceOf(SessionStartHookOutput);
    expect(result?.getAdditionalContext()).toContain('workspace context');
    expect(sources).toStrictEqual([SessionStartSource.Startup]);
  });

  it('returns SessionEndHookOutput and forwards the reason', async () => {
    const reasons: SessionEndReason[] = [];
    const owner = ownerWith({
      sessionEnd: async (reason) => {
        reasons.push(reason);
        return aggregated(new DefaultHookOutput(feedback));
      },
    });
    const result = await triggerSessionEndHook(SessionEndReason.Exit, owner);
    expect(result).toBeInstanceOf(SessionEndHookOutput);
    expect(reasons).toStrictEqual([SessionEndReason.Exit]);
  });

  it('returns BeforeAgentHookOutput, forwards the prompt and exposes blocking and stop contracts', async () => {
    const prompts: string[] = [];
    const outputs = [
      new DefaultHookOutput(feedback),
      new DefaultHookOutput({ decision: 'block', reason: 'denial' }),
      new DefaultHookOutput({ continue: false, stopReason: 'stopped' }),
    ];
    const owner = ownerWith({
      beforeAgent: async (prompt) => {
        prompts.push(prompt);
        return aggregated(outputs.shift());
      },
    });
    const context = await triggerBeforeAgentHook('User prompt', owner);
    const blocked = await triggerBeforeAgentHook('User prompt', owner);
    const stopped = await triggerBeforeAgentHook('User prompt', owner);
    expect(context).toBeInstanceOf(BeforeAgentHookOutput);
    expect(context?.getAdditionalContext()).toContain('workspace context');
    expect(blocked?.isBlockingDecision()).toBe(true);
    expect(blocked?.getEffectiveReason()).toContain('denial');
    expect(stopped?.shouldStopExecution()).toBe(true);
    expect(stopped?.getEffectiveReason()).toContain('stopped');
    expect(prompts).toStrictEqual([
      'User prompt',
      'User prompt',
      'User prompt',
    ]);
  });

  it('returns AfterAgentHookOutput and forwards prompt, response and stop flag', async () => {
    const calls: Array<{ prompt: string; response: string; stop: boolean }> =
      [];
    const owner = ownerWith({
      afterAgent: async (prompt, response, stop) => {
        calls.push({ prompt, response, stop });
        return aggregated(new DefaultHookOutput(feedback));
      },
    });
    const result = await triggerAfterAgentHook(
      'User prompt',
      'Agent response',
      false,
      owner,
    );
    expect(result).toBeInstanceOf(AfterAgentHookOutput);
    expect(calls).toStrictEqual([
      { prompt: 'User prompt', response: 'Agent response', stop: false },
    ]);
  });

  it('returns the PreCompress output and forwards the trigger', async () => {
    const triggers: PreCompressTrigger[] = [];
    const owner = ownerWith({
      preCompress: async (trigger) => {
        triggers.push(trigger);
        return aggregated(new DefaultHookOutput(feedback));
      },
    });
    const result = await triggerPreCompressHook(
      PreCompressTrigger.Manual,
      owner,
    );
    expect(result?.systemMessage).toBe('hook feedback');
    expect(triggers).toStrictEqual([PreCompressTrigger.Manual]);
  });

  it('returns undefined when no execution owner is available', async () => {
    expect(
      await triggerSessionStartHook(SessionStartSource.Startup, undefined),
    ).toBeUndefined();
    expect(
      await triggerSessionEndHook(SessionEndReason.Exit, undefined),
    ).toBeUndefined();
    expect(await triggerBeforeAgentHook('p', undefined)).toBeUndefined();
    expect(
      await triggerAfterAgentHook('p', 'r', false, undefined),
    ).toBeUndefined();
    expect(
      await triggerPreCompressHook(PreCompressTrigger.Manual, undefined),
    ).toBeUndefined();
  });

  it('returns undefined without failing when the owner has no handler or produces no output', async () => {
    const bare = ownerWith({});
    const empty = ownerWith({
      sessionStart: async () => aggregated(),
      preCompress: async () => aggregated(),
    });
    expect(
      await triggerSessionStartHook(SessionStartSource.Startup, bare),
    ).toBeUndefined();
    expect(
      await triggerSessionStartHook(SessionStartSource.Startup, empty),
    ).toBeUndefined();
    expect(
      await triggerPreCompressHook(PreCompressTrigger.Manual, empty),
    ).toBeUndefined();
  });

  it('fails open when a handler throws', async () => {
    const failure = async (): Promise<never> => {
      throw new Error('hook crashed');
    };
    const owner = ownerWith({
      sessionStart: failure,
      sessionEnd: failure,
      beforeAgent: failure,
      afterAgent: failure,
      preCompress: failure,
    });
    expect(
      await triggerSessionStartHook(SessionStartSource.Startup, owner),
    ).toBeUndefined();
    expect(
      await triggerSessionEndHook(SessionEndReason.Exit, owner),
    ).toBeUndefined();
    expect(await triggerBeforeAgentHook('p', owner)).toBeUndefined();
    expect(await triggerAfterAgentHook('p', 'r', false, owner)).toBeUndefined();
    expect(
      await triggerPreCompressHook(PreCompressTrigger.Manual, owner),
    ).toBeUndefined();
  });
});

describe('lifecycle physical execution', () => {
  describe.skipIf(process.platform === 'win32')(
    'Lifecycle Hook Triggers with explicit subprocess ownership (POSIX shell command fixture)',
    () => {
      const physical = usePhysicalHook();
      it('should return SessionStartHookOutput when hook executes successfully', async () => {
        const fixture = await physical(
          HookEventName.SessionStart,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          true,
          0,
        );
        const authority = fixture.execution;
        const result = await triggerSessionStartHook(
          SessionStartSource.Startup,
          authority,
        );
        const input = await fixture.input();
        expect(input.hook_event_name).toBe(HookEventName.SessionStart);
        expect(input.session_id).toBe('explicit-session');
        expect(input.transcript_path).toBe(input.cwd + '/transcript.jsonl');
        expect(result).toBeInstanceOf(SessionStartHookOutput);
        expect(result?.getAdditionalContext()?.split(' ')).toHaveLength(2);
        expect(input.source).toBe(SessionStartSource.Startup);
      });

      it('should return undefined when hooks are disabled', async () => {
        const fixture = await physical(
          HookEventName.SessionStart,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          false,
          0,
        );
        const authority = fixture.execution;
        const result = await triggerSessionStartHook(
          SessionStartSource.Startup,
          authority,
        );
        expect(result).toBeUndefined();
        expect(fixture.ran()).toBe(false);
      });

      it('should return undefined when hook system is not available', async () => {
        const fixture = await physical(
          HookEventName.SessionStart,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          true,
          0,
        );
        const authority = undefined;
        const result = await triggerSessionStartHook(
          SessionStartSource.Startup,
          authority,
        );
        expect(result).toBeUndefined();
        expect(fixture.ran()).toBe(false);
      });

      it('should return undefined and not throw on hook error', async () => {
        const fixture = await physical(
          HookEventName.SessionStart,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          true,
          1,
        );
        const authority = fixture.execution;
        const result = await triggerSessionStartHook(
          SessionStartSource.Startup,
          authority,
        );
        const input = await fixture.input();
        expect(input.hook_event_name).toBe(HookEventName.SessionStart);
        expect(input.session_id).toBe('explicit-session');
        expect(input.transcript_path).toBe(input.cwd + '/transcript.jsonl');
        expect(result).toBeUndefined();
      });

      it('should return SessionEndHookOutput when hook executes successfully', async () => {
        const fixture = await physical(
          HookEventName.SessionEnd,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          true,
          0,
        );
        const authority = fixture.execution;
        const result = await triggerSessionEndHook(
          SessionEndReason.Exit,
          authority,
        );
        const input = await fixture.input();
        expect(input.hook_event_name).toBe(HookEventName.SessionEnd);
        expect(input.session_id).toBe('explicit-session');
        expect(input.transcript_path).toBe(input.cwd + '/transcript.jsonl');
        expect(result).toBeInstanceOf(SessionEndHookOutput);
        expect(result?.getAdditionalContext()?.split(' ')).toHaveLength(2);
        expect(input.reason).toBe(SessionEndReason.Exit);
      });

      it('should return undefined when hooks are disabled for SessionEnd 2', async () => {
        const fixture = await physical(
          HookEventName.SessionEnd,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          false,
          0,
        );
        const authority = fixture.execution;
        const result = await triggerSessionEndHook(
          SessionEndReason.Exit,
          authority,
        );
        expect(result).toBeUndefined();
        expect(fixture.ran()).toBe(false);
      });

      it('should return undefined when hook system is not available for SessionEnd 2', async () => {
        const fixture = await physical(
          HookEventName.SessionEnd,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          true,
          0,
        );
        const authority = undefined;
        const result = await triggerSessionEndHook(
          SessionEndReason.Exit,
          authority,
        );
        expect(result).toBeUndefined();
        expect(fixture.ran()).toBe(false);
      });

      it('should return undefined and not throw on hook error for SessionEnd 2', async () => {
        const fixture = await physical(
          HookEventName.SessionEnd,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          true,
          1,
        );
        const authority = fixture.execution;
        const result = await triggerSessionEndHook(
          SessionEndReason.Exit,
          authority,
        );
        const input = await fixture.input();
        expect(input.hook_event_name).toBe(HookEventName.SessionEnd);
        expect(input.session_id).toBe('explicit-session');
        expect(input.transcript_path).toBe(input.cwd + '/transcript.jsonl');
        expect(result).toBeUndefined();
      });

      it('should return BeforeAgentHookOutput when hook executes successfully', async () => {
        const fixture = await physical(
          HookEventName.BeforeAgent,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          true,
          0,
        );
        const authority = fixture.execution;
        const result = await triggerBeforeAgentHook('User prompt', authority);
        const input = await fixture.input();
        expect(input.hook_event_name).toBe(HookEventName.BeforeAgent);
        expect(input.session_id).toBe('explicit-session');
        expect(input.transcript_path).toBe(input.cwd + '/transcript.jsonl');
        expect(result).toBeInstanceOf(BeforeAgentHookOutput);
        expect(result?.getAdditionalContext()?.split(' ')).toHaveLength(2);
        expect(input.prompt).toBe('User prompt');
      });

      it('should return undefined when hooks are disabled for BeforeAgent 3', async () => {
        const fixture = await physical(
          HookEventName.BeforeAgent,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          false,
          0,
        );
        const authority = fixture.execution;
        const result = await triggerBeforeAgentHook('User prompt', authority);
        expect(result).toBeUndefined();
        expect(fixture.ran()).toBe(false);
      });

      it('should return undefined when hook system is not available for BeforeAgent 3', async () => {
        const fixture = await physical(
          HookEventName.BeforeAgent,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          true,
          0,
        );
        const authority = undefined;
        const result = await triggerBeforeAgentHook('User prompt', authority);
        expect(result).toBeUndefined();
        expect(fixture.ran()).toBe(false);
      });

      it('should return undefined and not throw on hook error for BeforeAgent 3', async () => {
        const fixture = await physical(
          HookEventName.BeforeAgent,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          true,
          1,
        );
        const authority = fixture.execution;
        const result = await triggerBeforeAgentHook('User prompt', authority);
        const input = await fixture.input();
        expect(input.hook_event_name).toBe(HookEventName.BeforeAgent);
        expect(input.session_id).toBe('explicit-session');
        expect(input.transcript_path).toBe(input.cwd + '/transcript.jsonl');
        expect(result).toBeUndefined();
      });

      it('should return AfterAgentHookOutput when hook executes successfully', async () => {
        const fixture = await physical(
          HookEventName.AfterAgent,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          true,
          0,
        );
        const authority = fixture.execution;
        const result = await triggerAfterAgentHook(
          'User prompt',
          'Agent response',
          false,
          authority,
        );
        const input = await fixture.input();
        expect(input.hook_event_name).toBe(HookEventName.AfterAgent);
        expect(input.session_id).toBe('explicit-session');
        expect(input.transcript_path).toBe(input.cwd + '/transcript.jsonl');
        expect(result).toBeInstanceOf(AfterAgentHookOutput);
        expect(result?.getAdditionalContext()?.split(' ')).toHaveLength(2);
        expect({
          prompt: input.prompt,
          response: input.prompt_response,
          active: input.stop_hook_active,
        }).toStrictEqual({
          prompt: 'User prompt',
          response: 'Agent response',
          active: false,
        });
      });

      it('should return undefined when hooks are disabled for AfterAgent 4', async () => {
        const fixture = await physical(
          HookEventName.AfterAgent,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          false,
          0,
        );
        const authority = fixture.execution;
        const result = await triggerAfterAgentHook(
          'User prompt',
          'Agent response',
          false,
          authority,
        );
        expect(result).toBeUndefined();
        expect(fixture.ran()).toBe(false);
      });

      it('should return undefined when hook system is not available for AfterAgent 4', async () => {
        const fixture = await physical(
          HookEventName.AfterAgent,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          true,
          0,
        );
        const authority = undefined;
        const result = await triggerAfterAgentHook(
          'User prompt',
          'Agent response',
          false,
          authority,
        );
        expect(result).toBeUndefined();
        expect(fixture.ran()).toBe(false);
      });

      it('should return undefined and not throw on hook error for AfterAgent 4', async () => {
        const fixture = await physical(
          HookEventName.AfterAgent,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          true,
          1,
        );
        const authority = fixture.execution;
        const result = await triggerAfterAgentHook(
          'User prompt',
          'Agent response',
          false,
          authority,
        );
        const input = await fixture.input();
        expect(input.hook_event_name).toBe(HookEventName.AfterAgent);
        expect(input.session_id).toBe('explicit-session');
        expect(input.transcript_path).toBe(input.cwd + '/transcript.jsonl');
        expect(result).toBeUndefined();
      });

      it('should support blocking decisions via shared hook output contract', async () => {
        const fixture = await physical(
          HookEventName.BeforeAgent,
          { decision: 'block', reason: 'physical hook denial' },
          true,
          0,
        );
        const authority = fixture.execution;
        const result = await triggerBeforeAgentHook('User prompt', authority);
        const input = await fixture.input();
        expect(input.hook_event_name).toBe(HookEventName.BeforeAgent);
        expect(input.session_id).toBe('explicit-session');
        expect(input.transcript_path).toBe(input.cwd + '/transcript.jsonl');
        expect(result?.isBlockingDecision()).toBe(true);
        expect(result?.getEffectiveReason()).toContain('denial');
      });

      it('should support stop execution via shared hook output contract', async () => {
        const fixture = await physical(
          HookEventName.BeforeAgent,
          { continue: false, stopReason: 'physical hook stopped' },
          true,
          0,
        );
        const authority = fixture.execution;
        const result = await triggerBeforeAgentHook('User prompt', authority);
        const input = await fixture.input();
        expect(input.hook_event_name).toBe(HookEventName.BeforeAgent);
        expect(input.session_id).toBe('explicit-session');
        expect(input.transcript_path).toBe(input.cwd + '/transcript.jsonl');
        expect(result?.shouldStopExecution()).toBe(true);
        expect(result?.getEffectiveReason()).toContain('stopped');
      });

      it('should support additional context via shared hook output contract', async () => {
        const fixture = await physical(
          HookEventName.BeforeAgent,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          true,
          0,
        );
        const authority = fixture.execution;
        const result = await triggerBeforeAgentHook('User prompt', authority);
        const input = await fixture.input();
        expect(input.hook_event_name).toBe(HookEventName.BeforeAgent);
        expect(input.session_id).toBe('explicit-session');
        expect(input.transcript_path).toBe(input.cwd + '/transcript.jsonl');
        expect(result).toBeInstanceOf(BeforeAgentHookOutput);
        expect(result?.getAdditionalContext()?.split(' ')).toHaveLength(2);
        expect(input.prompt).toBe('User prompt');
      });

      it('should support blocking decisions via shared hook output contract for AfterAgent 2', async () => {
        const fixture = await physical(
          HookEventName.AfterAgent,
          { decision: 'block', reason: 'physical hook denial' },
          true,
          0,
        );
        const authority = fixture.execution;
        const result = await triggerAfterAgentHook(
          'User prompt',
          'Agent response',
          false,
          authority,
        );
        const input = await fixture.input();
        expect(input.hook_event_name).toBe(HookEventName.AfterAgent);
        expect(input.session_id).toBe('explicit-session');
        expect(input.transcript_path).toBe(input.cwd + '/transcript.jsonl');
        expect(result?.isBlockingDecision()).toBe(true);
        expect(result?.getEffectiveReason()).toContain('denial');
      });

      it('should support stop execution via shared hook output contract for AfterAgent 2', async () => {
        const fixture = await physical(
          HookEventName.AfterAgent,
          { continue: false, stopReason: 'physical hook stopped' },
          true,
          0,
        );
        const authority = fixture.execution;
        const result = await triggerAfterAgentHook(
          'User prompt',
          'Agent response',
          false,
          authority,
        );
        const input = await fixture.input();
        expect(input.hook_event_name).toBe(HookEventName.AfterAgent);
        expect(input.session_id).toBe('explicit-session');
        expect(input.transcript_path).toBe(input.cwd + '/transcript.jsonl');
        expect(result?.shouldStopExecution()).toBe(true);
        expect(result?.getEffectiveReason()).toContain('stopped');
      });

      it('should support additional context via shared hook output contract for AfterAgent 2', async () => {
        const fixture = await physical(
          HookEventName.AfterAgent,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          true,
          0,
        );
        const authority = fixture.execution;
        const result = await triggerAfterAgentHook(
          'User prompt',
          'Agent response',
          false,
          authority,
        );
        const input = await fixture.input();
        expect(input.hook_event_name).toBe(HookEventName.AfterAgent);
        expect(input.session_id).toBe('explicit-session');
        expect(input.transcript_path).toBe(input.cwd + '/transcript.jsonl');
        expect(result).toBeInstanceOf(AfterAgentHookOutput);
        expect(result?.getAdditionalContext()?.split(' ')).toHaveLength(2);
        expect({
          prompt: input.prompt,
          response: input.prompt_response,
          active: input.stop_hook_active,
        }).toStrictEqual({
          prompt: 'User prompt',
          response: 'Agent response',
          active: false,
        });
      });

      it('forwards an explicit execution owner to the shared hook system', async () => {
        const fixture = await physical(
          HookEventName.PreCompress,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          true,
          0,
        );
        const authority = fixture.execution;
        const result = await triggerPreCompressHook(
          PreCompressTrigger.Manual,
          authority,
        );
        const input = await fixture.input();
        expect(input.hook_event_name).toBe(HookEventName.PreCompress);
        expect(input.session_id).toBe('explicit-session');
        expect(input.transcript_path).toBe(input.cwd + '/transcript.jsonl');
        expect(input.trigger).toBe(PreCompressTrigger.Manual);
        expect(result?.systemMessage?.split(' ')).toHaveLength(3);
      });

      it('should return undefined when hooks are disabled for PreCompress 5', async () => {
        const fixture = await physical(
          HookEventName.PreCompress,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          false,
          0,
        );
        const authority = fixture.execution;
        const result = await triggerPreCompressHook(
          PreCompressTrigger.Manual,
          authority,
        );
        expect(result).toBeUndefined();
        expect(fixture.ran()).toBe(false);
      });

      it('should return undefined when hook system is not available for PreCompress 5', async () => {
        const fixture = await physical(
          HookEventName.PreCompress,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          true,
          0,
        );
        const authority = undefined;
        const result = await triggerPreCompressHook(
          PreCompressTrigger.Manual,
          authority,
        );
        expect(result).toBeUndefined();
        expect(fixture.ran()).toBe(false);
      });

      it('should pass trigger value through to firePreCompressEvent', async () => {
        const fixture = await physical(
          HookEventName.PreCompress,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          true,
          0,
        );
        const authority = fixture.execution;
        const result = await triggerPreCompressHook(
          PreCompressTrigger.Manual,
          authority,
        );
        const input = await fixture.input();
        expect(input.hook_event_name).toBe(HookEventName.PreCompress);
        expect(input.session_id).toBe('explicit-session');
        expect(input.transcript_path).toBe(input.cwd + '/transcript.jsonl');
        expect(input.trigger).toBe(PreCompressTrigger.Manual);
        expect(result?.systemMessage?.split(' ')).toHaveLength(3);
      });

      it('should return undefined and not throw on hook error (fail-open)', async () => {
        const fixture = await physical(
          HookEventName.PreCompress,
          {
            continue: true,
            systemMessage: 'physical hook feedback',
            hookSpecificOutput: { additionalContext: 'workspace context' },
          },
          true,
          1,
        );
        const authority = fixture.execution;
        const result = await triggerPreCompressHook(
          PreCompressTrigger.Manual,
          authority,
        );
        const input = await fixture.input();
        expect(input.hook_event_name).toBe(HookEventName.PreCompress);
        expect(input.session_id).toBe('explicit-session');
        expect(input.transcript_path).toBe(input.cwd + '/transcript.jsonl');
        expect(result).toBeUndefined();
      });
    },
  );
});
