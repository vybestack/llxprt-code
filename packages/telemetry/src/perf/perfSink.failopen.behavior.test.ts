/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for PerfSink fail-open + rate-limited diagnostics under
 * EACCES/EROFS/ENOSPC (P04B, EVIDENCE-AC8, D6).
 *
 * The filesystem port injects deterministic errno failures at the append
 * boundary. The caller must remain unaffected (no throw escapes to the
 * operation path), diagnostics are rate-limited, and a failure in one write
 * must not poison later writes forever.
 *
 * No real-disk fill, no chmod. Narrow package-private fault injection only.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  PerfSink,
  FaultInjectingPerfFilesystem,
  type PerfSinkFilesystem,
} from './PerfSink.js';

// ---------------------------------------------------------------------------
// Temp-dir helper
// ---------------------------------------------------------------------------

let dir: string;

describe('PerfSink fail-open behavior', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-failopen-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Valid record factory
  // ---------------------------------------------------------------------------

  function throwEaccesWhen(condition: boolean): void {
    if (condition) {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    }
  }

  function operationRecord(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      schema_version: 1,
      record_type: 'operation',
      ts: '2026-08-08T12:00:00.000Z',
      session_id: 'sess-abc',
      operation_id: 'sess-abc#agentic-loop#f7e2',
      runtime_id: 'rt-main',
      parent_runtime_id: null,
      subagent_name: null,
      project_hash: 'sha256:project-hash',
      llxprt_version: '0.11.0',
      git_sha: 'abc1234',
      runtime: 'bun-1.3.14',
      platform: 'darwin-arm64',
      provider: 'openai',
      model: 'gpt-4o',
      context_tokens: 1000,
      output_tokens: 500,
      terminal_cols: 120,
      terminal_rows: 40,
      render_mode: 'incremental',
      concurrent_instances: 1,
      status: 'completed',
      client_prepare_ms: 5,
      stream_handler_ms: 10,
      ink_render_ms: 20,
      ink_render_count: 3,
      stdout_bytes: 4096,
      stdout_write_calls: 3,
      stdout_write_sync_ms: 2,
      client_finalize_ms: 1,
      provider_attempts: 1,
      provider_attempt_sum_ms: 800,
      provider_union_ms: 800,
      tool_calls: 2,
      tool_call_sum_ms: 300,
      tool_union_ms: 280,
      agent_activity_union_ms: 1000,
      operation_elapsed_ms: 1200,
      approval_wait_ms: 0,
      unclassified_elapsed_ms: 100,
      session_operation_index: 1,
      uptime_ms: 50000,
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------------
  // Caller remains unaffected under EACCES/EROFS/ENOSPC on appendFile
  // ---------------------------------------------------------------------------

  describe('PerfSink fail-open — caller unaffected (AC-8, D6)', () => {
    for (const code of ['EACCES', 'EROFS', 'ENOSPC'] as const) {
      it(`write does not reject on ${code} from appendFile`, async () => {
        const faultFs = new FaultInjectingPerfFilesystem({
          failMethod: 'appendFile',
          code,
        });

        const sink = new PerfSink({
          dir,
          runUuid: `fail-${code}`,
          fs: faultFs,
          onDiagnostic: () => {},
        });

        // write should resolve (fail-open), not reject.
        await expect(sink.write(operationRecord())).resolves.toBeUndefined();
        await sink.dispose();
      });

      it(`write does not reject on ${code} from openExclusive`, async () => {
        const faultFs = new FaultInjectingPerfFilesystem({
          failMethod: 'openExclusive',
          code,
        });

        const sink = new PerfSink({
          dir,
          runUuid: `open-${code}`,
          fs: faultFs,
          onDiagnostic: () => {},
        });

        await expect(sink.write(operationRecord())).resolves.toBeUndefined();
        await sink.dispose();
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Rate-limited diagnostics
  // ---------------------------------------------------------------------------

  describe('PerfSink diagnostics are rate-limited (AC-8)', () => {
    it('emits at most one diagnostic per rate-limit window', async () => {
      const diagnostics: string[] = [];
      const faultFs = new FaultInjectingPerfFilesystem({
        failMethod: 'appendFile',
        code: 'EACCES',
      });

      const sink = new PerfSink({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000000',
        fs: faultFs,
        diagRateLimitMs: 60_000,
        onDiagnostic: (msg) => diagnostics.push(msg),
      });

      // Three failing writes within one rate-limit window.
      await sink.write(operationRecord({ session_operation_index: 0 }));
      await sink.write(operationRecord({ session_operation_index: 1 }));
      await sink.write(operationRecord({ session_operation_index: 2 }));
      await sink.dispose();

      expect(diagnostics.length).toBe(1);
    });

    it('a zero-length rate-limit window never suppresses diagnostics', async () => {
      const diagnostics: string[] = [];
      const faultFs = new FaultInjectingPerfFilesystem({
        failMethod: 'appendFile',
        code: 'ENOSPC',
      });

      // Use a zero-length window so every failure emits.
      const sink = new PerfSink({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000001',
        fs: faultFs,
        diagRateLimitMs: 0,
        onDiagnostic: (msg) => diagnostics.push(msg),
      });

      await sink.write(operationRecord({ session_operation_index: 0 }));
      await sink.write(operationRecord({ session_operation_index: 1 }));
      await sink.dispose();

      expect(diagnostics.length).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // A filesystem failure in one write does not poison later writes
  // ---------------------------------------------------------------------------

  describe('PerfSink failure recovery (AC-8)', () => {
    it('a failed write does not poison later writes when the filesystem recovers', async () => {
      let shouldFail = true;

      const recoveringFs: PerfSinkFilesystem = {
        async ensureDir(d: string): Promise<void> {
          try {
            await fs.promises.access(d);
          } catch {
            await fs.promises.mkdir(d, { recursive: true, mode: 0o700 });
          }
        },
        async openExclusive(p: string, mode: number): Promise<void> {
          throwEaccesWhen(shouldFail);
          const fd = await fs.promises.open(p, 'wx', mode);
          await fd.close();
        },
        async appendFile(p: string, data: string, mode: number): Promise<void> {
          throwEaccesWhen(shouldFail);
          await fs.promises.appendFile(p, data, { encoding: 'utf8', mode });
        },
      };

      const sink = new PerfSink({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000002',
        fs: recoveringFs,
        diagRateLimitMs: 0,
        onDiagnostic: () => {},
      });

      // First write fails (filesystem error, fail-open).
      await sink.write(operationRecord({ session_operation_index: 0 }));

      // Filesystem recovers.
      shouldFail = false;

      // Second write succeeds.
      await sink.write(operationRecord({ session_operation_index: 1 }));
      await sink.dispose();

      // A file should exist with one record (the second write).
      const files = fs.readdirSync(dir);
      expect(files).toHaveLength(1);
      const content = fs.readFileSync(path.join(dir, files[0]), 'utf8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.session_operation_index).toBe(1);
    });

    it('failed exclusive open does not advance day/file state', async () => {
      const diagnostics: string[] = [];
      let openAttempts = 0;

      const stateCheckingFs: PerfSinkFilesystem = {
        async ensureDir(d: string): Promise<void> {
          try {
            await fs.promises.access(d);
          } catch {
            await fs.promises.mkdir(d, { recursive: true, mode: 0o700 });
          }
        },
        async openExclusive(p: string, mode: number): Promise<void> {
          openAttempts++;
          throwEaccesWhen(openAttempts === 1);
          const fd = await fs.promises.open(p, 'wx', mode);
          await fd.close();
        },
        async appendFile(p: string, data: string, mode: number): Promise<void> {
          await fs.promises.appendFile(p, data, { encoding: 'utf8', mode });
        },
      };

      const sink = new PerfSink({
        dir,
        runUuid: '00000000-0000-4000-8000-000000000003',
        fs: stateCheckingFs,
        diagRateLimitMs: 0,
        onDiagnostic: (msg) => diagnostics.push(msg),
      });

      // First write: openExclusive fails, state must NOT advance.
      await sink.write(operationRecord());
      expect(diagnostics.length).toBe(1);

      // Second write: openExclusive succeeds, state advances, append succeeds.
      await sink.write(operationRecord());
      await sink.dispose();

      expect(openAttempts).toBe(2);
      const files = fs.readdirSync(dir);
      expect(files).toHaveLength(1);
    });
  });
});
