/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { AsyncTaskManager } from './asyncTaskManager.js';
import { AsyncTaskReminderService } from './asyncTaskReminderService.js';
import { AsyncTaskAutoTrigger } from './asyncTaskAutoTrigger.js';
import type { ShellNotificationSource } from './shellNotificationSource.js';
import type { ShellJob, ShellJobTailResult } from './shellJobTypes.js';
import { SHELL_NOTIF_TAIL_MAX_BYTES } from './shellJobNotification.js';

/**
 * Minimal fake {@link ShellNotificationSource} for testing. Records events
 * for emit and stores job state for queries — no mocks of internal details,
 * just a real in-memory implementation of the interface contract.
 */
class FakeShellSource implements ShellNotificationSource {
  private readonly jobs: Map<string, ShellJob> = new Map();
  private readonly tails: Map<string, ShellJobTailResult> = new Map();
  private readonly completedHandlers: Array<(job: ShellJob) => void> = [];
  private readonly failedHandlers: Array<(job: ShellJob) => void> = [];
  private readonly cancelledHandlers: Array<(job: ShellJob) => void> = [];
  private readonly notifiedIds: Set<string> = new Set();

  setJob(job: ShellJob, tail?: ShellJobTailResult): void {
    this.jobs.set(job.id, job);
    if (tail) {
      this.tails.set(job.id, tail);
    }
  }

  emitCompleted(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      for (const h of this.completedHandlers) h(job);
    }
  }

  emitFailed(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      for (const h of this.failedHandlers) h(job);
    }
  }

  emitCancelled(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      for (const h of this.cancelledHandlers) h(job);
    }
  }

  getNotifiedIds(): string[] {
    return Array.from(this.notifiedIds);
  }

  getPendingNotifications(): readonly ShellJob[] {
    return Array.from(this.jobs.values()).filter(
      (j) => j.state !== 'running' && !this.notifiedIds.has(j.id),
    );
  }

  getRunningJobs(): readonly ShellJob[] {
    return Array.from(this.jobs.values()).filter((j) => j.state === 'running');
  }

  tailOutput(id: string): ShellJobTailResult {
    return (
      this.tails.get(id) ?? {
        id,
        output: '',
        truncated: false,
      }
    );
  }

  markNotified(ids: readonly string[]): void {
    for (const id of ids) {
      this.notifiedIds.add(id);
    }
  }

  onJobCompleted(handler: (job: ShellJob) => void): () => void {
    this.completedHandlers.push(handler);
    return () => {
      const idx = this.completedHandlers.indexOf(handler);
      if (idx >= 0) this.completedHandlers.splice(idx, 1);
    };
  }

  onJobFailed(handler: (job: ShellJob) => void): () => void {
    this.failedHandlers.push(handler);
    return () => {
      const idx = this.failedHandlers.indexOf(handler);
      if (idx >= 0) this.failedHandlers.splice(idx, 1);
    };
  }

  onJobCancelled(handler: (job: ShellJob) => void): () => void {
    this.cancelledHandlers.push(handler);
    return () => {
      const idx = this.cancelledHandlers.indexOf(handler);
      if (idx >= 0) this.cancelledHandlers.splice(idx, 1);
    };
  }
}

function makeShellJob(overrides: Partial<ShellJob> = {}): ShellJob {
  return {
    id: 'shell_abc123',
    command: 'echo hello',
    cwd: '/tmp',
    state: 'completed',
    startedAt: 1000,
    endedAt: 2000,
    pid: 12345,
    exitCode: 0,
    ...overrides,
  };
}

function makeTaskManager(): AsyncTaskManager {
  return new AsyncTaskManager(5);
}

// ---------------------------------------------------------------------------
// Part A — shell completion formatting in the reminder pipeline
// ---------------------------------------------------------------------------

describe('AsyncTaskReminderService — shell job notifications', () => {
  it('produces a notification containing the job id, command, and exit code', () => {
    const mgr = makeTaskManager();
    const svc = new AsyncTaskReminderService(mgr);
    const shell = new FakeShellSource();
    svc.setShellNotificationSource(shell);

    shell.setJob(
      makeShellJob({
        id: 'shell_deadbeef',
        command: 'npm run build',
        state: 'completed',
        exitCode: 0,
      }),
      { id: 'shell_deadbeef', output: 'Build succeeded\n', truncated: false },
    );

    const result = svc.generateReminder();
    expect(result).not.toBeNull();
    expect(result!.text).toContain('shell_deadbeef');
    expect(result!.text).toContain('npm run build');
    expect(result!.text).toContain('exit_code');
    expect(result!.text).toContain('0');
    expect(result!.text).toContain('Build succeeded');
    expect(result!.text).toContain('1 shell job(s) completed');
    expect(result!.notifiedTaskIds).toContain('shell_deadbeef');
  });

  it('caps the output tail at the line limit', () => {
    const mgr = makeTaskManager();
    const svc = new AsyncTaskReminderService(mgr);
    const shell = new FakeShellSource();
    svc.setShellNotificationSource(shell);

    const manyLines =
      Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n') + '\n';
    shell.setJob(makeShellJob({ id: 'shell_chatty' }), {
      id: 'shell_chatty',
      output: manyLines,
      truncated: false,
    });

    const result = svc.generateReminder();
    expect(result).not.toBeNull();
    // The text should not contain all 100 lines in the tail.
    const tailSection = result!.text.split('output_tail')[1] ?? '';
    expect(tailSection).not.toContain('line 0\n');
    expect(tailSection).toContain('line 99');
    expect(result!.text).toContain('truncated');
  });

  it('caps the output tail at the byte limit', () => {
    const mgr = makeTaskManager();
    const svc = new AsyncTaskReminderService(mgr);
    const shell = new FakeShellSource();
    svc.setShellNotificationSource(shell);

    const huge = 'x'.repeat(SHELL_NOTIF_TAIL_MAX_BYTES * 5);
    shell.setJob(makeShellJob({ id: 'shell_huge' }), {
      id: 'shell_huge',
      output: huge,
      truncated: false,
    });

    const result = svc.generateReminder();
    expect(result).not.toBeNull();
    expect(result!.text.length).toBeLessThan(SHELL_NOTIF_TAIL_MAX_BYTES + 2000);
  });

  it('leaves subagent-only notifications byte-identical when no shell source is attached', () => {
    const mgr = makeTaskManager();
    const svc = new AsyncTaskReminderService(mgr);
    // No shell source — behavior must be unchanged.

    // Register a subagent task the same way the real manager does.
    mgr.registerTask({
      id: 'subagent-xyz',
      subagentName: 'coder',
      goalPrompt: 'fix the bug',
      abortController: new AbortController(),
    });
    mgr.completeTask('subagent-xyz', {
      terminate_reason: 'done',
      emitted_vars: {},
      final_message: 'all fixed',
    });

    const result = svc.generateReminder();
    expect(result).not.toBeNull();
    // The exact text the original (pre-shell) code would have produced.
    const expectedParts = [
      '1 async task(s) completed:',
      JSON.stringify(
        {
          agent_id: 'subagent-xyz',
          terminate_reason: 'done',
          emitted_vars: {},
          final_message: 'all fixed',
        },
        null,
        2,
      ),
    ];
    expect(result!.text).toContain(expectedParts[0]);
    expect(result!.text).toContain(expectedParts[1]);
    expect(result!.notifiedTaskIds).toEqual(['subagent-xyz']);
    // No shell mention at all.
    expect(result!.text).not.toContain('shell');
  });

  it('coalesces subagent + shell completions into a single notification', () => {
    const mgr = makeTaskManager();
    const svc = new AsyncTaskReminderService(mgr);
    const shell = new FakeShellSource();
    svc.setShellNotificationSource(shell);

    mgr.registerTask({
      id: 'subagent-1',
      subagentName: 'coder',
      goalPrompt: 'g',
      abortController: new AbortController(),
    });
    mgr.completeTask('subagent-1', {
      terminate_reason: 'done',
      emitted_vars: {},
    });

    shell.setJob(makeShellJob({ id: 'shell_1', command: 'ls' }), {
      id: 'shell_1',
      output: 'file.txt\n',
      truncated: false,
    });
    shell.setJob(makeShellJob({ id: 'shell_2', command: 'pwd' }), {
      id: 'shell_2',
      output: '/tmp\n',
      truncated: false,
    });

    const result = svc.generateReminder();
    expect(result).not.toBeNull();
    expect(result!.text).toContain(
      '1 async task(s) + 2 shell job(s) completed',
    );
    expect(result!.notifiedTaskIds).toEqual(
      expect.arrayContaining(['subagent-1', 'shell_1', 'shell_2']),
    );
  });
});

// ---------------------------------------------------------------------------
// Part A — auto-trigger coalescing
// ---------------------------------------------------------------------------

describe('AsyncTaskAutoTrigger — shell coalescing', () => {
  it('delivers a single notification when multiple shell jobs complete rapidly', async () => {
    const mgr = makeTaskManager();
    const svc = new AsyncTaskReminderService(mgr);
    const shell = new FakeShellSource();
    svc.setShellNotificationSource(shell);

    let triggerCount = 0;
    const trigger = async (_message: string): Promise<void> => {
      triggerCount++;
    };

    const auto = new AsyncTaskAutoTrigger(
      mgr,
      svc,
      () => false, // agent never busy
      trigger,
    );
    auto.setShellNotificationSource(shell);
    const unsub = auto.subscribe();

    // Seed two terminal shell jobs.
    shell.setJob(makeShellJob({ id: 'shell_c1', command: 'true' }), {
      id: 'shell_c1',
      output: '',
      truncated: false,
    });
    shell.setJob(makeShellJob({ id: 'shell_c2', command: 'true' }), {
      id: 'shell_c2',
      output: '',
      truncated: false,
    });

    // Fire both events in rapid succession.
    shell.emitCompleted('shell_c1');
    shell.emitCompleted('shell_c2');

    // Wait past the debounce window + setImmediate chain.
    await waitMs(600);
    await tickMicrotasks();

    expect(triggerCount).toBe(1);
    unsub();
  });

  it('does not strand events that arrive during an in-flight trigger', async () => {
    const mgr = makeTaskManager();
    const svc = new AsyncTaskReminderService(mgr);
    const shell = new FakeShellSource();
    svc.setShellNotificationSource(shell);

    let triggerCount = 0;
    let resolveTrigger: (() => void) | null = null;
    const trigger = async (_message: string): Promise<void> => {
      triggerCount++;
      // Hold the first trigger open so a second event arrives while busy.
      if (triggerCount === 1) {
        await new Promise<void>((resolve) => {
          resolveTrigger = resolve;
        });
      }
    };

    const auto = new AsyncTaskAutoTrigger(mgr, svc, () => false, trigger);
    auto.setShellNotificationSource(shell);
    const unsub = auto.subscribe();

    // Seed ONLY the first job before the first event.
    shell.setJob(makeShellJob({ id: 'shell_s1', command: 'true' }), {
      id: 'shell_s1',
      output: '',
      truncated: false,
    });

    // First job fires → triggers, hold it open.
    shell.emitCompleted('shell_s1');
    await waitMs(500); // past debounce
    await tickMicrotasks();
    expect(triggerCount).toBe(1);

    // While the first trigger is in flight, seed AND fire the second job.
    // This creates a NEW pending notification that the in-flight trigger
    // could not have consumed.
    shell.setJob(makeShellJob({ id: 'shell_s2', command: 'true' }), {
      id: 'shell_s2',
      output: '',
      truncated: false,
    });
    shell.emitCompleted('shell_s2');
    await waitMs(500); // past debounce
    await tickMicrotasks();
    // Still 1 because the first trigger hasn't resolved yet.
    expect(triggerCount).toBe(1);

    // Release the first trigger — the re-check should fire the second.
    resolveTrigger?.();
    await waitMs(200);
    await tickMicrotasks();

    expect(triggerCount).toBe(2);
    unsub();
  });

  it('subagent notifications still work unchanged with a shell source attached', async () => {
    const mgr = makeTaskManager();
    const svc = new AsyncTaskReminderService(mgr);
    const shell = new FakeShellSource();
    svc.setShellNotificationSource(shell);

    let triggerCount = 0;
    const trigger = async (_message: string): Promise<void> => {
      triggerCount++;
    };

    const auto = new AsyncTaskAutoTrigger(mgr, svc, () => false, trigger);
    auto.setShellNotificationSource(shell);
    const unsub = auto.subscribe();

    mgr.registerTask({
      id: 'sub-trigger-test',
      subagentName: 'coder',
      goalPrompt: 'g',
      abortController: new AbortController(),
    });
    mgr.completeTask('sub-trigger-test', {
      terminate_reason: 'done',
      emitted_vars: {},
    });

    await waitMs(100);
    await tickMicrotasks();

    expect(triggerCount).toBe(1);
    unsub();
  });
});

// --- helpers ---

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tickMicrotasks(): Promise<void> {
  // Flush microtask + setImmediate + setTimeout(0) chains.
  return new Promise((resolve) => setImmediate(resolve));
}
