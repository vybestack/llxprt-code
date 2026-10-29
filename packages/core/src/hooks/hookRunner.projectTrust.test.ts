/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { escapeShellArg, getShellConfiguration } from '../utils/shell-utils.js';
import { HookRunner } from './hookRunner.js';
import { ConfigSource } from './hookRegistry.js';
import type { HookModelRowsInput } from './hookModelInputStream.js';
import type { HookSnapshotResult } from './hookOutputSnapshot.js';
import { HookEventName, HookType, type HookConfig } from './types.js';

type ModelEvent = HookEventName.BeforeModel | HookEventName.AfterModel;

const LATE_WRITE_MS = 600;

interface Harness {
  readonly dir: string;
  readonly trust: AbortController;
  readonly runner: HookRunner;
  readonly runnerWith: (isTrusted: () => boolean) => HookRunner;
}

function modelInput(event: ModelEvent, cwd: string): HookModelRowsInput {
  const common = {
    session_id: 'project-trust',
    transcript_path: '',
    cwd,
    timestamp: '2026-10-14T00:00:00.000Z',
  };
  const llm_request = {
    version: 2 as const,
    model: 'test-model',
    contents: { count: 0, async *openReader() {} },
  };
  if (event === HookEventName.BeforeModel)
    return { ...common, hook_event_name: event, llm_request };
  return {
    ...common,
    hook_event_name: event,
    llm_request,
    llm_response: { version: 2, content: { speaker: 'ai', blocks: [] } },
  };
}

async function hookConfig(
  dir: string,
  source: ConfigSource,
): Promise<HookConfig> {
  // The hook announces readiness, then writes a marker after a delay. A hook
  // that is still alive after trust is withdrawn leaves the marker behind.
  await writeFile(
    join(dir, 'hook.cjs'),
    `const fs = require('node:fs');
process.stdin.resume();
fs.writeFileSync('ready', 'ready');
setTimeout(() => { fs.writeFileSync('continued', 'ran'); process.exit(0); }, ${LATE_WRITE_MS});
`,
  );
  const shell = getShellConfiguration().shell;
  return {
    type: HookType.Command,
    command: `exec ${escapeShellArg(process.execPath, shell)} hook.cjs`,
    source,
    timeout: 10000,
  };
}

async function waitFor(path: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`Hook did not create ${path}`);
    await sleep(10);
  }
}

function createHarness(): Harness {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'hook-trust-'));
  const trust = new AbortController();
  const runnerWith = (isTrusted: () => boolean): HookRunner =>
    new HookRunner(
      {
        environment: { ...process.env },
        sanitization: {
          enableEnvironmentVariableRedaction: false,
          allowedEnvironmentVariables: [],
          blockedEnvironmentVariables: [],
        },
      },
      isTrusted,
      () => trust.signal,
    );
  return {
    dir,
    trust,
    runner: runnerWith(() => !trust.signal.aborted),
    runnerWith,
  };
}

const withdrawn = (): Error => new Error('Workspace hook trust withdrawn');

describe('HookRunner disk model hooks and project trust withdrawal', () => {
  let current: Harness | undefined;
  beforeEach(() => {
    current = createHarness();
  });
  afterEach(() => {
    if (current !== undefined)
      rmSync(current.dir, { recursive: true, force: true });
    current = undefined;
  });
  const harness = (): Harness => {
    if (current === undefined) throw new Error('Harness not initialized');
    return current;
  };

  for (const event of [
    HookEventName.BeforeModel,
    HookEventName.AfterModel,
  ] as const) {
    it(`stops a running project ${event} hook when trust is withdrawn`, async () => {
      const { dir, trust, runner } = harness();
      const config = await hookConfig(dir, ConfigSource.Project);

      const pending = runner.executeHookWithRequestRows(
        config,
        event,
        modelInput(event, dir),
      );
      await waitFor(join(dir, 'ready'));
      trust.abort(withdrawn());
      const result: HookSnapshotResult = await pending;
      result.dispose();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Workspace hook trust withdrawn');
      await sleep(LATE_WRITE_MS + 200);
      expect(existsSync(join(dir, 'continued'))).toBe(false);
    });
  }

  it('stops a running project hook when a caller signal is also supplied', async () => {
    const { dir, trust, runner } = harness();
    const config = await hookConfig(dir, ConfigSource.Project);
    const caller = new AbortController();

    const pending = runner.executeHookWithRequestRows(
      config,
      HookEventName.BeforeModel,
      modelInput(HookEventName.BeforeModel, dir),
      caller.signal,
    );
    await waitFor(join(dir, 'ready'));
    trust.abort(withdrawn());
    const result = await pending;
    result.dispose();

    expect(result.success).toBe(false);
    await sleep(LATE_WRITE_MS + 200);
    expect(existsSync(join(dir, 'continued'))).toBe(false);
  });

  it('does not spawn a project hook whose trust signal is already aborted', async () => {
    const { dir, trust, runnerWith } = harness();
    const config = await hookConfig(dir, ConfigSource.Project);
    // isTrustedFolder() still answers true here: only the signal reports the
    // withdrawal, so the pre-spawn signal check is what must refuse the hook.
    const signalOnly = runnerWith(() => true);
    trust.abort(withdrawn());

    const result = await signalOnly.executeHookWithRequestRows(
      config,
      HookEventName.AfterModel,
      modelInput(HookEventName.AfterModel, dir),
    );
    result.dispose();

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Workspace hook trust withdrawn');
    await sleep(LATE_WRITE_MS + 200);
    expect(existsSync(join(dir, 'ready'))).toBe(false);
  });

  it('keeps blocking a project hook when the folder is untrusted', async () => {
    const { dir, trust, runner } = harness();
    const config = await hookConfig(dir, ConfigSource.Project);
    trust.abort(withdrawn());

    const result = await runner.executeHookWithRequestRows(
      config,
      HookEventName.BeforeModel,
      modelInput(HookEventName.BeforeModel, dir),
    );
    result.dispose();

    expect(result.success).toBe(false);
    expect(existsSync(join(dir, 'ready'))).toBe(false);
  });

  for (const source of [ConfigSource.User, ConfigSource.System] as const) {
    it(`lets a running ${source} hook finish after project trust is withdrawn`, async () => {
      const { dir, trust, runner } = harness();
      const config = await hookConfig(dir, source);

      const pending = runner.executeHookWithRequestRows(
        config,
        HookEventName.BeforeModel,
        modelInput(HookEventName.BeforeModel, dir),
      );
      await waitFor(join(dir, 'ready'));
      trust.abort(withdrawn());
      const result = await pending;
      result.dispose();

      expect(result.success).toBe(true);
      expect(existsSync(join(dir, 'continued'))).toBe(true);
    });
  }
});
