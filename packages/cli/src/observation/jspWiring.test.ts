/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import {
  captureBootstrapEnvPath,
  resolveBootstrapSelection,
  loadBootstrap,
  createObservationProducer,
  createTodoObservationSubscription,
  initializeObservationProducer,
  observeTurnStarted,
  observeTurnFailed,
  shouldSuppressContent,
  stopObservationProducer,
  __setBootstrapWarningStderrWriterForTesting,
  type ObservationSessionContext,
  type BootstrapSelection,
} from './jspWiring.js';
import type { JspPostResult } from './jspPublisher.js';
import type { JspSnapshotDocument, JspBoundDocument } from './jspDocuments.js';
import {
  todoEvents,
  FatalConfigError,
  patchStdio,
  coreEvents,
  CoreEvent,
  type OutputPayload,
} from '@vybestack/llxprt-code-core';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';

const OK: JspPostResult = { kind: 'ok' };

const validBootstrapJson = {
  schema: 1,
  protocol: 'jsp/1',
  endpoint: 'http://127.0.0.1:9123/jsp/1',
  registration_id: 'reg-abc',
  publisher_credential: 'pub-secret-xyz',
  agent_id: 'agent-alex',
  lifecycle_generation: 7,
};

const sessionContext: ObservationSessionContext = {
  repository: 'vybestack/llxprt-code',
  path: '/Users/dev/src/llxprt-code',
  agentKind: 'llxprt',
  displayName: 'main-worker',
};

const tempDirs: string[] = [];

async function writeTempFile(name: string, content: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `jsp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const filePath = join(dir, name);
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

async function cleanupTempDirs(): Promise<void> {
  const dirs = tempDirs.splice(0);
  await Promise.all(
    dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
}

/**
 * Run a load attempt and capture the thrown error, asserting it is a
 * FatalConfigError with exit code 52. Returns the error so the caller can
 * make message assertions without re-deriving the throw.
 */
function expectFatalBootstrap(fn: () => unknown): FatalConfigError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(FatalConfigError);
    expect((error as FatalConfigError).exitCode).toBe(52);
    return error as FatalConfigError;
  }
  throw new Error('expected loadBootstrap to throw');
}

describe('captureBootstrapEnvPath (process-start capture + scrub, AC13)', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.LLXPRT_JSP_BOOTSTRAP_FILE;
  });

  afterEach(async () => {
    process.env = { ...origEnv };
    await cleanupTempDirs();
  });

  it('captures and scrubs a non-empty value', () => {
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = '/session/per-process.json';
    expect(captureBootstrapEnvPath()).toBe('/session/per-process.json');
    expect(process.env.LLXPRT_JSP_BOOTSTRAP_FILE).toBeUndefined();
  });

  it('returns undefined and still scrubs an empty value', () => {
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = '';
    expect(captureBootstrapEnvPath()).toBeUndefined();
    expect(process.env.LLXPRT_JSP_BOOTSTRAP_FILE).toBeUndefined();
  });

  it('returns undefined when absent (no-op scrub)', () => {
    expect(captureBootstrapEnvPath()).toBeUndefined();
    expect(process.env.LLXPRT_JSP_BOOTSTRAP_FILE).toBeUndefined();
  });
});

describe('resolveBootstrapSelection (post-parse resolution, AC10–AC14)', () => {
  afterEach(async () => {
    await cleanupTempDirs();
  });

  it('returns null when all sources absent (AC12)', () => {
    expect(
      resolveBootstrapSelection(undefined, undefined, undefined),
    ).toBeNull();
  });

  it('AC10: flag path wins over captured env path', () => {
    const sel = resolveBootstrapSelection(
      '/flag/path.json',
      undefined,
      '/env/named.json',
    );
    expect(sel?.path).toBe('/flag/path.json');
    expect(sel?.source).toBe('--jsp-bootstrap');
  });

  it('AC11: captured env path used when flag absent', () => {
    const sel = resolveBootstrapSelection(
      undefined,
      undefined,
      '/env/path.json',
    );
    expect(sel?.path).toBe('/env/path.json');
    expect(sel?.source).toBe('LLXPRT_JSP_BOOTSTRAP_FILE');
  });

  it('transported internal env path wins over captured env path', () => {
    const sel = resolveBootstrapSelection(
      undefined,
      '/transported.json',
      '/captured.json',
    );
    expect(sel?.path).toBe('/transported.json');
    expect(sel?.source).toBe('LLXPRT_JSP_BOOTSTRAP_FILE');
  });

  it('empty strings treated as absent', () => {
    expect(resolveBootstrapSelection('', '', '')).toBeNull();
  });
});

describe('loadBootstrap (validation, source-labeled diagnostics, missing-file degrades)', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.LLXPRT_JSP_BOOTSTRAP_FILE;
  });

  afterEach(async () => {
    process.env = { ...origEnv };
    await cleanupTempDirs();
    __setBootstrapWarningStderrWriterForTesting(null);
  });

  it('returns null for a null selection (observation disabled)', () => {
    expect(loadBootstrap(null)).toBeNull();
  });

  it('returns parsed bootstrap for a valid env-origin selection', async () => {
    const file = await writeTempFile(
      'bootstrap.json',
      JSON.stringify(validBootstrapJson),
    );
    const selection = resolveBootstrapSelection(undefined, undefined, file);
    const result = loadBootstrap(selection);
    expect(result).not.toBeNull();
    expect(result?.agentId).toBe('agent-alex');
  });

  it('A1: returns null and warns nothing when the selection is null or resolves from empty sources', () => {
    const warnings: string[] = [];
    const warn = (message: string) => {
      warnings.push(message);
    };
    expect(loadBootstrap(null, warn)).toBeNull();
    // Empty-string sources resolve to a null selection, which is disabled, not
    // a read failure, so no warning fires.
    expect(
      loadBootstrap(resolveBootstrapSelection('', '', ''), warn),
    ).toBeNull();
    expect(warnings).toHaveLength(0);
  });

  it('A2: a missing file returns null and emits one warning naming the source, the escaped path, and disabled observation', () => {
    const warnings: string[] = [];
    const warn = (message: string) => {
      warnings.push(message);
    };
    const missingPath =
      join(
        tmpdir(),
        'jsp-no-such-file-' + Math.random().toString(36).slice(2),
      ) + '.json';
    const result = loadBootstrap(
      { path: missingPath, source: 'LLXPRT_JSP_BOOTSTRAP_FILE' },
      warn,
    );
    expect(result).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('LLXPRT_JSP_BOOTSTRAP_FILE');
    // The path is rendered in a control-character-safe escaped form.
    expect(warnings[0]).toContain(JSON.stringify(missingPath));
    expect(warnings[0]).toContain('observation is disabled');
  });

  it('A3: an existing directory (a read failure that is not ENOENT) returns null with the same warning shape', () => {
    const warnings: string[] = [];
    const warn = (message: string) => {
      warnings.push(message);
    };
    const dirPath = tmpdir();
    const result = loadBootstrap(
      { path: dirPath, source: 'LLXPRT_JSP_BOOTSTRAP_FILE' },
      warn,
    );
    expect(result).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('LLXPRT_JSP_BOOTSTRAP_FILE');
    expect(warnings[0]).toContain(JSON.stringify(dirPath));
    expect(warnings[0]).toContain('observation is disabled');
  });

  it('A4: with stdio patched (real startup ordering), the default-sink warning bypasses the patched stream to physical stderr and leaves stdout clean', () => {
    // Reproduce the cli.tsx startup ordering: patchStdio() (line 134) runs
    // before setupObservation -> loadBootstrap (line 210). patchStdio
    // redirects process.stderr/stdout.write to the coreEvents Output bus, so
    // a warning routed to physical stderr via writeToStderr (a pre-patch bound
    // original) must NOT appear on that bus — proving it bypassed the patched
    // stream rather than being silently swallowed or buffered.
    const emitted: OutputPayload[] = [];
    const onOutput = (payload: OutputPayload) => {
      emitted.push(payload);
    };
    coreEvents.on(CoreEvent.Output, onOutput);
    const physicalWarnings: string[] = [];
    __setBootstrapWarningStderrWriterForTesting((message) => {
      physicalWarnings.push(message);
    });
    const missingPath =
      join(
        tmpdir(),
        'jsp-no-such-file-' + Math.random().toString(36).slice(2),
      ) + '.json';
    let restorePatched: (() => void) | undefined;
    try {
      restorePatched = patchStdio();
      // Production default sink — no injected sink.
      loadBootstrap({ path: missingPath, source: 'LLXPRT_JSP_BOOTSTRAP_FILE' });
    } finally {
      restorePatched?.();
      coreEvents.off(CoreEvent.Output, onOutput);
      __setBootstrapWarningStderrWriterForTesting(null);
    }
    // The warning bypassed the patched stream: nothing was forwarded to the
    // bus on either fd, so stdout stayed clean and the warning was neither
    // redirected nor buffered.
    expect(emitted).toHaveLength(0);
    expect(physicalWarnings).toHaveLength(1);
    expect(physicalWarnings[0]).toContain(JSON.stringify(missingPath));
    expect(physicalWarnings[0]).toContain('observation is disabled');

    // Control: the patch WAS active during the call, so the empty result is a
    // genuine bypass rather than a no-op patch. A direct write through the
    // patched stream surfaces on the bus.
    const control: OutputPayload[] = [];
    const onControl = (payload: OutputPayload) => {
      control.push(payload);
    };
    coreEvents.on(CoreEvent.Output, onControl);
    let restoreControl: (() => void) | undefined;
    try {
      restoreControl = patchStdio();
      process.stdout.write('control-stdout\n');
    } finally {
      restoreControl?.();
      coreEvents.off(CoreEvent.Output, onControl);
    }
    expect(
      control.some((p) => String(p.chunk).includes('control-stdout')),
    ).toBe(true);
  });

  it('A5: malformed JSON still throws FatalConfigError with the source, the escaped path, and the category', async () => {
    const file = await writeTempFile('bad.json', '{ not json');
    const error = expectFatalBootstrap(() =>
      loadBootstrap({ path: file, source: 'LLXPRT_JSP_BOOTSTRAP_FILE' }),
    );
    expect(error.message).toContain('LLXPRT_JSP_BOOTSTRAP_FILE');
    expect(error.message).toContain(JSON.stringify(file));
    expect(error.message).toContain('malformed JSON');
  });

  it('A6a: a non-loopback endpoint still throws with the path and without secrets', async () => {
    const file = await writeTempFile(
      'insecure.json',
      JSON.stringify({
        ...validBootstrapJson,
        endpoint: 'http://10.0.0.5:9123',
      }),
    );
    const error = expectFatalBootstrap(() =>
      loadBootstrap({ path: file, source: 'LLXPRT_JSP_BOOTSTRAP_FILE' }),
    );
    expect(error.message).toContain('LLXPRT_JSP_BOOTSTRAP_FILE');
    expect(error.message).toContain(JSON.stringify(file));
    expect(error.message).toContain('rejected (JSP-E004)');
    // A credential-bearing file's secrets must not leak into the diagnostic.
    expect(error.message).not.toContain('pub-secret-xyz');
    expect(error.message).not.toContain('reg-abc');
  });

  it('A6b: a wrong protocol version still throws with the path and without secrets', async () => {
    const file = await writeTempFile(
      'wrong.json',
      JSON.stringify({ ...validBootstrapJson, protocol: 'jsp/2' }),
    );
    const error = expectFatalBootstrap(() =>
      loadBootstrap({ path: file, source: 'LLXPRT_JSP_BOOTSTRAP_FILE' }),
    );
    expect(error.message).toContain('LLXPRT_JSP_BOOTSTRAP_FILE');
    expect(error.message).toContain(JSON.stringify(file));
    expect(error.message).toContain('rejected (JSP-E003)');
    expect(error.message).not.toContain('pub-secret-xyz');
    expect(error.message).not.toContain('reg-abc');
  });

  it('A7: a valid bootstrap file returns the parsed document and emits no warning', async () => {
    const warnings: string[] = [];
    const warn = (message: string) => {
      warnings.push(message);
    };
    const file = await writeTempFile(
      'bootstrap.json',
      JSON.stringify(validBootstrapJson),
    );
    const result = loadBootstrap(
      { path: file, source: 'LLXPRT_JSP_BOOTSTRAP_FILE' },
      warn,
    );
    expect(result).not.toBeNull();
    expect(result?.agentId).toBe('agent-alex');
    expect(warnings).toHaveLength(0);
  });

  it('AC14: a missing flag-origin selection disables observation and names --jsp-bootstrap (not the env var)', () => {
    const warnings: string[] = [];
    const warn = (message: string) => {
      warnings.push(message);
    };
    const selection: BootstrapSelection = {
      path: '/flag/also-missing.json',
      source: '--jsp-bootstrap',
    };
    expect(loadBootstrap(selection, warn)).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('--jsp-bootstrap');
    expect(warnings[0]).not.toContain('LLXPRT_JSP_BOOTSTRAP_FILE');
  });

  it('AC14: a rejected flag-origin file throws and names --jsp-bootstrap', async () => {
    const flagFile = await writeTempFile(
      'flag-bad.json',
      JSON.stringify({ ...validBootstrapJson, protocol: 'jsp/2' }),
    );
    const selection = resolveBootstrapSelection(flagFile, undefined, undefined);
    const error = expectFatalBootstrap(() => loadBootstrap(selection));
    expect(error.message).toContain('--jsp-bootstrap');
    expect(error.message).toContain('rejected (JSP-E003)');
  });

  it('AC14: a missing env-origin transport selection disables observation and names LLXPRT_JSP_BOOTSTRAP_FILE (not the flag)', () => {
    const warnings: string[] = [];
    const warn = (message: string) => {
      warnings.push(message);
    };
    // Simulate a memory/sandbox-hopped env-origin path: arrived via the hidden
    // internal env-path option, so the resolver marks its source as env.
    const selection = resolveBootstrapSelection(
      undefined,
      '/transported/missing.json',
      undefined,
    );
    expect(selection?.source).toBe('LLXPRT_JSP_BOOTSTRAP_FILE');
    expect(loadBootstrap(selection, warn)).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('LLXPRT_JSP_BOOTSTRAP_FILE');
    expect(warnings[0]).not.toContain('--jsp-bootstrap');
  });

  it('AC13: scrubbed env stays absent after loadBootstrap disables on a missing file', () => {
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE =
      join(tmpdir(), 'jsp-missing-' + Math.random().toString(36).slice(2)) +
      '.json';
    const capturedEnvPath = captureBootstrapEnvPath();
    const selection = resolveBootstrapSelection(
      undefined,
      undefined,
      capturedEnvPath,
    );
    expect(loadBootstrap(selection, () => {})).toBeNull();
    expect(process.env.LLXPRT_JSP_BOOTSTRAP_FILE).toBeUndefined();
  });

  it('loadBootstrap never touches process.env (pure function)', () => {
    const selection: BootstrapSelection = {
      path: '/does-not-exist.json',
      source: 'LLXPRT_JSP_BOOTSTRAP_FILE',
    };
    // A missing file disables observation rather than throwing, but the loader
    // is still pure: it neither reads nor restores process.env.
    expect(loadBootstrap(selection, () => {})).toBeNull();
    expect(process.env.LLXPRT_JSP_BOOTSTRAP_FILE).toBeUndefined();
  });
});

describe('bootstrap warning sink hardening (default best-effort, injected strict)', () => {
  const missingPath =
    join(tmpdir(), 'jsp-hardening-' + Math.random().toString(36).slice(2)) +
    '.json';
  const selection: BootstrapSelection = {
    path: missingPath,
    source: 'LLXPRT_JSP_BOOTSTRAP_FILE',
  };

  it('B1: the default sink swallows a throwing physical stderr writer so a missing-file warning never becomes fatal startup', () => {
    // A destroyed/throwing stderr must not propagate and turn a missing-file
    // warning back into a fatal startup error. fd-2 destruction is not
    // reliably throwable in-process, so swap the physical writer the default
    // sink delegates to (then guards) via the test seam.
    __setBootstrapWarningStderrWriterForTesting(() => {
      throw new Error('stderr destroyed');
    });
    try {
      // No injected warningSink — the production default sink is exercised.
      expect(loadBootstrap(selection)).toBeNull();
    } finally {
      __setBootstrapWarningStderrWriterForTesting(null);
    }
  });

  it('B2: an explicitly injected throwing sink propagates and is not swallowed', () => {
    // Injected sinks bypass the default's guard and stay strict by contract.
    const throwingSink = (): never => {
      throw new Error('injected sink failure');
    };
    expect(() => loadBootstrap(selection, throwingSink)).toThrow(
      'injected sink failure',
    );
  });
});

describe('bootstrap diagnostic path sanitization (no log injection)', () => {
  it('C1: a warning path with newlines and ANSI escapes is escaped so it cannot inject log lines', () => {
    const warnings: string[] = [];
    const warn = (message: string) => {
      warnings.push(message);
    };
    // A path carrying raw newlines and an ANSI color escape. The read fails
    // (the path does not exist), so the warning branch is exercised.
    const maliciousPath = '/tmp/no-such\ndanger\n\x1b[31mred\x1b[0m.json';
    const result = loadBootstrap(
      { path: maliciousPath, source: 'LLXPRT_JSP_BOOTSTRAP_FILE' },
      warn,
    );
    expect(result).toBeNull();
    expect(warnings).toHaveLength(1);
    const message = warnings[0];
    // The escaped representation names the actual path safely.
    expect(message).toContain(JSON.stringify(maliciousPath));
    // The path's newlines are escaped to backslash-n, so the message is a
    // single logical line (only the message's own trailing newline remains).
    expect(message.split('\n')).toHaveLength(2);
    // The raw ESC control byte never reaches the warning.
    expect(message).not.toContain('\x1b');
  });

  it('C2: a fatal malformed-JSON diagnostic uses the escaped path without exposing the body', async () => {
    const file = await writeTempFile('bad-control.json', '{ not json');
    const error = expectFatalBootstrap(() =>
      loadBootstrap({ path: file, source: 'LLXPRT_JSP_BOOTSTRAP_FILE' }),
    );
    expect(error.message).toContain('LLXPRT_JSP_BOOTSTRAP_FILE');
    // The escaped representation names the path safely.
    expect(error.message).toContain(JSON.stringify(file));
    // The credential-bearing file body must never appear in the diagnostic.
    expect(error.message).not.toContain('not json');
  });
});

describe('initializeObservationProducer (startup survives a stale pointer)', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.LLXPRT_JSP_BOOTSTRAP_FILE;
  });

  afterEach(async () => {
    process.env = { ...origEnv };
    __setBootstrapWarningStderrWriterForTesting(null);
    // Reset module-level producer/tap state so no observation subscription
    // leaks into sibling describe blocks.
    await stopObservationProducer();
  });

  it('A8: a missing bootstrap file disables observation without aborting startup', () => {
    const missingPath =
      join(
        tmpdir(),
        'jsp-no-such-file-' + Math.random().toString(36).slice(2),
      ) + '.json';
    process.env.LLXPRT_JSP_BOOTSTRAP_FILE = missingPath;
    const capturedEnvPath = captureBootstrapEnvPath();
    const selection = resolveBootstrapSelection(
      undefined,
      undefined,
      capturedEnvPath,
    );
    // Capture the warning via the test seam rather than a patched-stream spy:
    // the production default sink routes to physical stderr through the
    // pre-patch-bound writeToStderr, which a process.stderr.write spy cannot
    // intercept. This also keeps the runner output clean.
    const warnings: string[] = [];
    __setBootstrapWarningStderrWriterForTesting((message) => {
      warnings.push(message);
    });
    try {
      // This is the reported bug: a stale inherited pointer must not abort the
      // CLI before the TUI loads. initializeObservationProducer must return
      // normally, leaving observation inert.
      expect(() =>
        initializeObservationProducer(sessionContext, selection),
      ).not.toThrow();

      // The warning fired once through the full startup path, naming the path.
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(JSON.stringify(missingPath));

      // With no producer created, observation calls are inert and must not
      // throw or reach any transport.
      expect(() => observeTurnStarted()).not.toThrow();
      expect(() => observeTurnFailed()).not.toThrow();
    } finally {
      __setBootstrapWarningStderrWriterForTesting(null);
    }
  });
});

describe('createTodoObservationSubscription', () => {
  it('observes canonical todo replacements before UI providers mount', () => {
    const observer = vi.fn();
    const unsubscribe = createTodoObservationSubscription(observer);
    const todos = [
      {
        id: 'todo-1',
        content: 'Native todo',
        status: 'completed' as const,
      },
    ];

    todoEvents.emitTodoUpdated({
      sessionId: 'session-1',
      agentId: 'default',
      todos,
      timestamp: new Date(1000),
    });
    unsubscribe();

    expect(observer).toHaveBeenCalledWith('default', todos);

    // A stale listener on the global emitter would keep publishing after the
    // session is gone, so prove the unsubscribe actually detaches it.
    observer.mockClear();
    todoEvents.emitTodoUpdated({
      sessionId: 'session-1',
      agentId: 'default',
      todos,
      timestamp: new Date(2000),
    });
    expect(observer).not.toHaveBeenCalled();
  });
});

describe('createObservationProducer', () => {
  it('returns null when bootstrap is null (disabled)', () => {
    const producer = createObservationProducer(null, sessionContext, {
      now: () => 1,
      createIdentity: vi.fn(),
      register: vi.fn(() => Promise.resolve(OK)),
      publish: vi.fn(() => Promise.resolve(OK)),
      heartbeat: vi.fn(() => Promise.resolve(OK)),
    });
    expect(producer).toBeNull();
  });

  it('returns a started producer when bootstrap is valid', async () => {
    const register = vi.fn(
      (_snapshot: JspSnapshotDocument): Promise<JspPostResult> =>
        Promise.resolve(OK),
    );
    const producer = createObservationProducer(
      {
        schema: 1,
        protocol: 'jsp/1',
        endpoint: 'http://127.0.0.1:9123/jsp/1',
        registrationId: 'reg-abc',
        publisherCredential: 'pub-secret-xyz',
        agentId: 'agent-alex',
        lifecycleGeneration: 7,
      },
      sessionContext,
      {
        now: () => 1,
        createIdentity: vi.fn(() => ({
          agentId: 'agent-alex',
          lifecycleGeneration: 7,
          sourceEpoch: 'ep-x',
          startedAtMs: 1,
          pid: 1,
        })),
        register,
        publish: vi.fn(
          (_doc: JspBoundDocument): Promise<JspPostResult> =>
            Promise.resolve(OK),
        ),
        heartbeat: vi.fn((): Promise<JspPostResult> => Promise.resolve(OK)),
      },
    );
    expect(producer).not.toBeNull();
    // Settle the pending registration so no dangling promise remains.
    await producer?.flush();
    expect(register).toHaveBeenCalledTimes(1);
    // The register call must carry a snapshot document, not an inert stub.
    const snapshotArg = register.mock.calls[0][0];
    expect(snapshotArg.kind).toBe('snapshot');
    expect(snapshotArg.agent_id).toBe('agent-alex');
    producer?.stop();
  });

  function assistantMessageContent(
    document: JspBoundDocument | undefined,
  ): string | undefined {
    if (
      document?.kind !== 'event' ||
      document.event.type !== 'assistant_message.displayed'
    ) {
      return undefined;
    }
    return document.event.content;
  }

  function assistantMessageCommittedMs(
    document: JspBoundDocument | undefined,
  ): number | undefined {
    if (
      document?.kind !== 'event' ||
      document.event.type !== 'assistant_message.displayed'
    ) {
      return undefined;
    }
    return document.event.committed_ms;
  }

  async function verifySuppressesAssistantMessageTextWhenNoContentIsEnabledViaEnv() {
    process.env.LLXPRT_JSP_NO_CONTENT = 'true';
    const published: JspBoundDocument[] = [];
    const producer = createObservationProducer(
      {
        schema: 1,
        protocol: 'jsp/1',
        endpoint: 'http://127.0.0.1:9123/jsp/1',
        registrationId: 'reg-abc',
        publisherCredential: 'pub-secret-xyz',
        agentId: 'agent-alex',
        lifecycleGeneration: 7,
      },
      sessionContext,
      {
        now: () => 1,
        createIdentity: vi.fn(() => ({
          agentId: 'agent-alex',
          lifecycleGeneration: 7,
          sourceEpoch: 'ep-x',
          startedAtMs: 1,
          pid: 1,
        })),
        register: vi.fn(() => Promise.resolve(OK)),
        publish: vi.fn((doc) => {
          published.push(doc);
          return Promise.resolve(OK);
        }),
        heartbeat: vi.fn(() => Promise.resolve(OK)),
      },
    );

    return {
      producer,
      async publishAssistantMessage() {
        await producer?.flush();
        producer?.observeAssistantMessageDisplayed('Secret reply', 9999);
        await producer?.flush();
        // With noContent on, the published assistant message event must carry an
        // empty content while the committed_ms timestamp still publishes.
        return published.find(
          (document) =>
            document.kind === 'event' &&
            document.event.type === 'assistant_message.displayed',
        );
      },
      stop() {
        producer?.stop();
        delete process.env.LLXPRT_JSP_NO_CONTENT;
      },
    };
  }

  it('suppresses assistant message text when noContent is enabled via env', async () => {
    const scenario =
      await verifySuppressesAssistantMessageTextWhenNoContentIsEnabledViaEnv();

    expect(scenario.producer).not.toBeNull();

    const messageDoc = await scenario.publishAssistantMessage();
    expect(messageDoc).toBeDefined();

    const content = assistantMessageContent(messageDoc);
    expect(content).toBe('');

    const committedMs = assistantMessageCommittedMs(messageDoc);
    expect(committedMs).toBe(9999);
    scenario.stop();
  });
});

describe('initializeObservationProducer (AC15)', () => {
  const origEnv = { ...process.env };
  let captureServer: http.Server | null = null;
  let losingTimeout: ReturnType<typeof setTimeout> | null = null;

  beforeEach(() => {
    delete process.env.LLXPRT_JSP_BOOTSTRAP_FILE;
    delete process.env.LLXPRT_JSP_NO_CONTENT;
  });

  afterEach(async () => {
    try {
      await stopObservationProducer();
    } finally {
      if (losingTimeout !== null) {
        clearTimeout(losingTimeout);
        losingTimeout = null;
      }
      await new Promise<void>((resolve) => {
        if (captureServer === null) {
          resolve();
          return;
        }
        captureServer.close(() => resolve());
        captureServer = null;
      });
      process.env = { ...origEnv };
      await cleanupTempDirs();
    }
  });

  async function verifyHonoursAnExplicitFlagPathWithNoEnvVarSetRealProducer() {
    // Spin up a real loopback HTTP capture server. The only way to observe
    // that initializeObservationProducer actually constructed a producer from
    // the flag path — without spying on internal module state — is to see the
    // real registration POST land on the broker endpoint named by the file.
    let resolveRequest!: (req: http.IncomingMessage) => void;
    const firstRequest = new Promise<http.IncomingMessage>((resolve) => {
      resolveRequest = resolve;
    });
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      resolveRequest(req);
    });
    captureServer = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    const address = server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;

    const file = await writeTempFile(
      'explicit.json',
      JSON.stringify({
        ...validBootstrapJson,
        endpoint: `http://127.0.0.1:${port}`,
      }),
    );

    const selection = resolveBootstrapSelection(file, undefined, undefined);
    initializeObservationProducer(sessionContext, selection);
    // No env var was ever set, and the loader must not introduce one.

    return {
      async waitForRegistration() {
        const timeoutPromise = new Promise<never>((_, reject) => {
          losingTimeout = setTimeout(
            () => reject(new Error('registration POST did not arrive')),
            5_000,
          );
        });
        const received = await Promise.race([firstRequest, timeoutPromise]);
        return { method: received.method, url: received.url };
      },
    };
  }

  it('honours an explicit flag path with no env var set (real producer)', async () => {
    const scenario =
      await verifyHonoursAnExplicitFlagPathWithNoEnvVarSetRealProducer();

    expect(process.env.LLXPRT_JSP_BOOTSTRAP_FILE).toBeUndefined();

    const registration = await scenario.waitForRegistration();
    expect(registration.method).toBe('POST');
    expect(registration.url).toContain('/register');
  });
});

describe('shouldSuppressContent', () => {
  it('returns false when the env var is absent', () => {
    delete process.env.LLXPRT_JSP_NO_CONTENT;
    expect(shouldSuppressContent()).toBe(false);
  });

  it('returns true when the env var is "true" or "1"', () => {
    expect(shouldSuppressContent({ LLXPRT_JSP_NO_CONTENT: 'true' })).toBe(true);
    expect(shouldSuppressContent({ LLXPRT_JSP_NO_CONTENT: '1' })).toBe(true);
  });

  it('returns false for any other value', () => {
    expect(shouldSuppressContent({ LLXPRT_JSP_NO_CONTENT: 'false' })).toBe(
      false,
    );
    expect(shouldSuppressContent({ LLXPRT_JSP_NO_CONTENT: '0' })).toBe(false);
    expect(shouldSuppressContent({ LLXPRT_JSP_NO_CONTENT: 'yes' })).toBe(false);
  });
});
