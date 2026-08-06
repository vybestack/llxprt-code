/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadBootstrapFromEnv,
  createObservationProducer,
  createTodoObservationSubscription,
  initializeObservationProducer,
  observeTurnStarted,
  observeTurnFailed,
  shouldSuppressContent,
  stopObservationProducer,
  __setBootstrapWarningStderrWriterForTesting,
  type ObservationSessionContext,
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
  throw new Error('expected loadBootstrapFromEnv to throw');
}

describe('loadBootstrapFromEnv', () => {
  afterEach(async () => {
    // Each helper call creates a directory; without this they accumulate in
    // the system temp directory on every run. Use allSettled so a single
    // rejection does not abandon cleanup of the remaining directories.
    const dirs = tempDirs.splice(0);
    await Promise.allSettled(
      dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    vi.restoreAllMocks();
  });

  it('A1: returns null and warns nothing when env is absent or empty', () => {
    const warnings: string[] = [];
    const warn = (message: string) => {
      warnings.push(message);
    };
    expect(loadBootstrapFromEnv({}, warn)).toBeNull();
    expect(
      loadBootstrapFromEnv({ LLXPRT_JSP_BOOTSTRAP_FILE: '' }, warn),
    ).toBeNull();
    expect(warnings).toHaveLength(0);
  });

  it('A2: a missing file returns null and emits one warning naming the variable, the escaped path, and disabled observation', () => {
    const warnings: string[] = [];
    const warn = (message: string) => {
      warnings.push(message);
    };
    const missingPath =
      join(
        tmpdir(),
        'jsp-no-such-file-' + Math.random().toString(36).slice(2),
      ) + '.json';
    const result = loadBootstrapFromEnv(
      { LLXPRT_JSP_BOOTSTRAP_FILE: missingPath },
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
    const result = loadBootstrapFromEnv(
      { LLXPRT_JSP_BOOTSTRAP_FILE: dirPath },
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
    // before setupObservation -> loadBootstrapFromEnv (line 210). patchStdio
    // redirects process.stderr/stdout.write to the coreEvents Output bus, so
    // a warning routed to physical stderr via writeToStderr (a pre-patch bound
    // original) must NOT appear on that bus — proving it bypassed the patched
    // stream rather than being silently swallowed or buffered.
    const emitted: OutputPayload[] = [];
    const onOutput = (payload: OutputPayload) => {
      emitted.push(payload);
    };
    coreEvents.on(CoreEvent.Output, onOutput);
    const missingPath =
      join(
        tmpdir(),
        'jsp-no-such-file-' + Math.random().toString(36).slice(2),
      ) + '.json';
    let restorePatched: (() => void) | undefined;
    try {
      restorePatched = patchStdio();
      // Production default sink — no injected sink.
      loadBootstrapFromEnv({ LLXPRT_JSP_BOOTSTRAP_FILE: missingPath });
    } finally {
      restorePatched?.();
      coreEvents.off(CoreEvent.Output, onOutput);
    }
    // The warning bypassed the patched stream: nothing was forwarded to the
    // bus on either fd, so stdout stayed clean and the warning was neither
    // redirected nor buffered.
    expect(emitted).toHaveLength(0);

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

  it('A5: malformed JSON still throws FatalConfigError with the variable, the escaped path, and the category', async () => {
    const file = await writeTempFile('bad.json', '{ not json');
    const error = expectFatalBootstrap(() =>
      loadBootstrapFromEnv({ LLXPRT_JSP_BOOTSTRAP_FILE: file }),
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
      loadBootstrapFromEnv({ LLXPRT_JSP_BOOTSTRAP_FILE: file }),
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
      loadBootstrapFromEnv({ LLXPRT_JSP_BOOTSTRAP_FILE: file }),
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
    const result = loadBootstrapFromEnv(
      { LLXPRT_JSP_BOOTSTRAP_FILE: file },
      warn,
    );
    expect(result).not.toBeNull();
    expect(result?.agentId).toBe('agent-alex');
    expect(warnings).toHaveLength(0);
  });
});

describe('bootstrap warning sink hardening (default best-effort, injected strict)', () => {
  const missingPath =
    join(tmpdir(), 'jsp-hardening-' + Math.random().toString(36).slice(2)) +
    '.json';

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
      expect(
        loadBootstrapFromEnv({ LLXPRT_JSP_BOOTSTRAP_FILE: missingPath }),
      ).toBeNull();
    } finally {
      __setBootstrapWarningStderrWriterForTesting(null);
    }
  });

  it('B2: an explicitly injected throwing sink propagates and is not swallowed', () => {
    // Injected sinks bypass the default's guard and stay strict by contract.
    const throwingSink = (): never => {
      throw new Error('injected sink failure');
    };
    expect(() =>
      loadBootstrapFromEnv(
        { LLXPRT_JSP_BOOTSTRAP_FILE: missingPath },
        throwingSink,
      ),
    ).toThrow('injected sink failure');
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
    const result = loadBootstrapFromEnv(
      { LLXPRT_JSP_BOOTSTRAP_FILE: maliciousPath },
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

  it('C2: a fatal (malformed-JSON) diagnostic escapes a quote-bearing path so it cannot break out of the message', async () => {
    // Newlines are not creatable in a real filename, so use a filesystem-legal
    // double-quote (JSON.stringify escapes it to \"). The file reads but is
    // malformed, so the fatal branch is exercised with an escaped path.
    const file = await writeTempFile('bad"quote.json', '{ not json');
    const error = expectFatalBootstrap(() =>
      loadBootstrapFromEnv({ LLXPRT_JSP_BOOTSTRAP_FILE: file }),
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
    vi.restoreAllMocks();
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
      expect(() => initializeObservationProducer(sessionContext)).not.toThrow();

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

  it('suppresses assistant message text when noContent is enabled via env', async () => {
    process.env.LLXPRT_JSP_NO_CONTENT = 'true';
    const published: unknown[] = [];
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
    expect(producer).not.toBeNull();
    await producer?.flush();
    producer?.observeAssistantMessageDisplayed('Secret reply', 9999);
    await producer?.flush();
    // With noContent on, the published assistant message event must carry an
    // empty content while the committed_ms timestamp still publishes.
    const messageDoc = published.find(
      (doc) =>
        typeof doc === 'object' &&
        doc !== null &&
        'event' in doc &&
        (doc as { event: { type: string } }).event.type ===
          'assistant_message.displayed',
    );
    expect(messageDoc).toBeDefined();
    expect((messageDoc as { event: { content: string } }).event.content).toBe(
      '',
    );
    expect(
      (messageDoc as { event: { committed_ms: number } }).event.committed_ms,
    ).toBe(9999);
    producer?.stop();
    delete process.env.LLXPRT_JSP_NO_CONTENT;
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
