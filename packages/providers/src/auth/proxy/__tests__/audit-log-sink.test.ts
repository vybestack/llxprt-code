/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the credential-proxy audit sink and TUI terminal
 * ownership (#3490).
 *
 * The proxy runs in the host process that then hands its terminal to the
 * sandbox Ink TUI, so stderr bytes at that point corrupt the interface. These
 * tests pin where each record lands in both modes: the durable sink file is
 * always written, stderr receives bytes only when no TUI owns the terminal,
 * and WARN/ERROR reach the user through the feedback event surface instead.
 *
 * The log dir is redirected through LLXPRT_LOG_HOME to a real temp dir (no fs
 * mocking); Storage.getGlobalLogDir() reads the env at call time, which is
 * what makes the override a seam.
 *
 * @plan PLAN-20260901-PROXYAUDIT
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  coreEvents,
  CoreEvent,
  type UserFeedbackPayload,
} from '@vybestack/llxprt-code-core';
import { auditLog, setTuiOwnsTerminal, tuiOwnsTerminal } from '../audit-log.js';

const SINK_FILE_NAME = 'credential-proxy-audit.log';
/** A realistically shaped GitHub token; must never survive into any sink. */
const SECRET = 'ghp_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

/**
 * Points LLXPRT_LOG_HOME at a fresh temp dir for each test and restores plus
 * removes it afterwards, so every auditLog call resolves a real sink dir and
 * no test reads another test's file. One shared lifecycle helper instead of
 * per-describe boilerplate.
 */
function useIsolatedLogHome(): () => string {
  let logHome = '';
  const previous = process.env.LLXPRT_LOG_HOME;
  beforeEach(() => {
    logHome = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-sink-'));
    process.env.LLXPRT_LOG_HOME = logHome;
  });
  afterEach(() => {
    if (previous === undefined) {
      delete process.env.LLXPRT_LOG_HOME;
    } else {
      process.env.LLXPRT_LOG_HOME = previous;
    }
    fs.rmSync(logHome, { recursive: true, force: true });
  });
  return () => logHome;
}

/**
 * Subscribes to the user-feedback surface for each test and returns a lazy
 * accessor for what it saw. A real listener is used rather than a spy
 * because emitFeedback buffers while nobody listens; the subscription is
 * what turns the publish into observable behavior.
 */
function captureUserFeedback(): () => UserFeedbackPayload[] {
  const payloads: UserFeedbackPayload[] = [];
  const listener = (payload: UserFeedbackPayload): void => {
    payloads.push(payload);
  };
  beforeEach(() => {
    coreEvents.on(CoreEvent.UserFeedback, listener);
  });
  afterEach(() => {
    coreEvents.removeListener(CoreEvent.UserFeedback, listener);
    payloads.length = 0;
  });
  return () => payloads;
}

/**
 * Captures everything written to process.stderr while `emit` runs. The
 * stream is an external sink being observed, not the unit under test; the
 * spy also keeps the bytes off the runner's own output.
 */
function captureStderrDuring(emit: () => void): string {
  const chunks: string[] = [];
  const writeSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    });
  try {
    emit();
  } finally {
    writeSpy.mockRestore();
  }
  return chunks.join('');
}

/** Reads the sink file back and returns its individual JSON lines. */
function readSinkLines(logHome: string): string[] {
  return fs
    .readFileSync(path.join(logHome, SINK_FILE_NAME), 'utf8')
    .trimEnd()
    .split('\n');
}

/**
 * The host topology these tests pin: the credential proxy runs in the host
 * process, whose coreEvents singleton has NO UserFeedback subscriber — the
 * Ink UI that subscribes lives in the spawned sandbox child, and per-process
 * events cannot cross that boundary. No feedback listener is installed here,
 * so operator visibility must come from the deferred stderr flush alone.
 */
describe('deferred stderr flush on ownership release, no feedback subscriber (#3490)', () => {
  const logHome = useIsolatedLogHome();

  // No test may leak ownership into another suite: the flag is process state.
  afterEach(() => {
    setTuiOwnsTerminal(false);
  });

  it('holds WARN and ERROR stderr bytes while owned, then flushes exactly those lines in order on release', () => {
    setTuiOwnsTerminal(true);
    const duringOwnership = captureStderrDuring(() => {
      auditLog('WARN', 10, 'deferred_warn');
      auditLog('ERROR', 10, 'deferred_error');
    });
    const onRelease = captureStderrDuring(() => {
      setTuiOwnsTerminal(false);
    });

    const lines = readSinkLines(logHome());
    expect(duringOwnership).toBe('');
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('"op":"deferred_warn"');
    expect(lines[1]).toContain('"op":"deferred_error"');
    // Byte for byte the same lines the sink holds, in order, exactly once.
    expect(onRelease).toBe(`${lines.join('\n')}\n`);
  });

  it('keeps an INFO recorded under ownership off stderr before and after release', () => {
    const stderr = captureStderrDuring(() => {
      setTuiOwnsTerminal(true);
      auditLog('INFO', 11, 'sink_only_info');
      setTuiOwnsTerminal(false);
    });

    const lines = readSinkLines(logHome());
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('"op":"sink_only_info"');
    expect(stderr).toBe('');
  });

  it('writes nothing on release when no records were buffered', () => {
    const stderr = captureStderrDuring(() => {
      setTuiOwnsTerminal(true);
      setTuiOwnsTerminal(false);
    });

    expect(stderr).toBe('');
  });

  it('does not reprint buffered lines on a second release', () => {
    setTuiOwnsTerminal(true);
    const firstRelease = captureStderrDuring(() => {
      auditLog('WARN', 13, 'printed_once');
      setTuiOwnsTerminal(false);
    });
    const secondRelease = captureStderrDuring(() => {
      setTuiOwnsTerminal(false);
    });

    expect(firstRelease).toContain('"op":"printed_once"');
    expect(secondRelease).toBe('');
  });
});

describe('auditLog sink and TUI terminal ownership (#3490)', () => {
  const logHome = useIsolatedLogHome();
  const feedback = captureUserFeedback();

  // No test may leak ownership into another suite: the flag is process state.
  afterEach(() => {
    setTuiOwnsTerminal(false);
  });

  it('does not own the terminal by default', () => {
    expect(tuiOwnsTerminal()).toBe(false);
  });

  /**
   * AB1 + AB3: the sink is unconditional, and under TUI ownership INFO goes
   * nowhere else.
   */
  it('routes INFO to the sink only while a TUI owns the terminal', () => {
    setTuiOwnsTerminal(true);
    const stderr = captureStderrDuring(() => {
      auditLog('INFO', 1, 'handshake_ok', { status: 'ok' });
    });

    const lines = readSinkLines(logHome());
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('"op":"handshake_ok"');
    expect(lines[0]).toContain('"level":"INFO"');
    expect(stderr).toBe('');
    expect(feedback()).toEqual([]);
  });

  /** AB4: WARN reaches the user through the feedback surface, not stderr. */
  it('publishes WARN as feedback instead of stderr while a TUI owns the terminal', () => {
    setTuiOwnsTerminal(true);
    const stderr = captureStderrDuring(() => {
      auditLog('WARN', 2, 'frame_decode_error', { reason: 'truncated' });
    });

    const lines = readSinkLines(logHome());
    expect(lines.length).toBe(1);
    expect(stderr).toBe('');
    expect(feedback().length).toBe(1);
    expect(feedback()[0].severity).toBe('warning');
    expect(feedback()[0].message).toBe(lines[0]);
  });

  /** AB4: ERROR maps to the error severity on the same surface. */
  it('publishes ERROR as feedback instead of stderr while a TUI owns the terminal', () => {
    setTuiOwnsTerminal(true);
    const stderr = captureStderrDuring(() => {
      auditLog('ERROR', 3, 'process_frames_error');
    });

    const lines = readSinkLines(logHome());
    expect(lines.length).toBe(1);
    expect(stderr).toBe('');
    expect(feedback().length).toBe(1);
    expect(feedback()[0].severity).toBe('error');
    expect(feedback()[0].message).toBe(lines[0]);
  });

  /**
   * AB2: without TUI ownership the stderr path is unchanged — the same
   * lines the sink holds, one JSON record per line, byte for byte.
   */
  it('writes INFO, WARN and ERROR to both stderr and the sink when no TUI owns the terminal', () => {
    const stderr = captureStderrDuring(() => {
      auditLog('INFO', 4, 'connect');
      auditLog('WARN', 4, 'frame_flood');
      auditLog('ERROR', 4, 'unhandled_dispatch');
    });

    const lines = readSinkLines(logHome());
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('"op":"connect"');
    expect(lines[1]).toContain('"op":"frame_flood"');
    expect(lines[2]).toContain('"op":"unhandled_dispatch"');
    expect(stderr).toBe(`${lines.join('\n')}\n`);
    expect(feedback()).toEqual([]);
  });

  /** AB1: the no-secrets property holds in the durable file, not just stderr. */
  it('redacts token-shaped detail values in the sink file', () => {
    captureStderrDuring(() => {
      auditLog('INFO', 5, 'get_api_key', { name: 'github-pat', key: SECRET });
    });

    const sink = fs.readFileSync(path.join(logHome(), SINK_FILE_NAME), 'utf8');
    expect(sink).not.toContain(SECRET);
    expect(sink).toContain('"op":"get_api_key"');
  });

  /** AB1: a missing audit record is itself a security signal. */
  it('still writes a sink record when details cannot be serialised', () => {
    captureStderrDuring(() => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      auditLog('WARN', 6, 'circular_op', circular);
    });

    const lines = readSinkLines(logHome());
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('"op":"circular_op"');
    expect(lines[0]).toContain('unserialisable');
  });

  /**
   * AB1: a sink that cannot be written must neither crash auditLog nor
   * suppress the default-mode stderr record.
   */
  it('keeps the stderr record and does not throw when the sink location is unwritable', () => {
    const blocker = path.join(logHome(), 'blocker');
    fs.writeFileSync(blocker, 'occupies the path the sink dir would need');
    process.env.LLXPRT_LOG_HOME = path.join(blocker, 'log');

    const stderr = captureStderrDuring(() => {
      auditLog('ERROR', 7, 'sink_unwritable_probe');
    });

    expect(stderr).toContain('"op":"sink_unwritable_probe"');
  });
});
