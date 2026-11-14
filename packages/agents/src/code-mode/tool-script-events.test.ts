/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Recording, resume and telemetry of code mode runs (issue #4084, Phase D).
 * A run writes typed `tool_script_event` records next to, never inside, model
 * history; a resumed session redraws the run from them without running the
 * script again; nested calls and the run's lifecycle reach telemetry with
 * their parent links, and model-written text stays behind `logPrompts`.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { assertNoLiveWrappers } from './__tests__/runtime-test-helpers.js';
import {
  buildScriptAgent,
  runTurn,
  scratchDir,
  scriptResponse,
  type ScriptAgent,
} from './__tests__/script-agent.js';
import { formatToolScriptCard } from './tool-script-card.js';

const ALLOW_SHELL = {
  toolName: 'run_shell_command',
  decision: PolicyDecision.ALLOW,
  priority: 2,
};

const owned: ScriptAgent[] = [];
const scratch: string[] = [];
const previousHome = process.env.LLXPRT_CONFIG_HOME;

describe('code mode script records and telemetry', () => {
  afterEach(async () => {
    for (const agent of owned.splice(0)) await agent.cleanup();
    for (const dir of scratch.splice(0))
      rmSync(dir, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousHome;
    assertNoLiveWrappers();
  });

  function track(agent: ScriptAgent): ScriptAgent {
    owned.push(agent);
    return agent;
  }

  function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    scratch.push(dir);
    return dir;
  }

  function blocksOf(history: readonly IContent[], type: string) {
    return history.flatMap((content) =>
      content.blocks.filter((block) => block.type === type),
    );
  }

  /** Script: create a marker file, then read a file. */
  function countingScript(workspace: string) {
    const marker = join(workspace, 'ran');
    const file = join(workspace, 'a.txt');
    writeFileSync(file, 'alpha');
    return {
      marker,
      call: {
        source: `
        await tools["run_shell_command"]({ command: "touch ${marker}" });
        const read = await tools["read_file"]({ absolute_path: ${JSON.stringify(file)} });
        return read.value.text.trim();`,
        tools: ['run_shell_command', 'read_file'],
        purpose: 'count runs and read a',
      },
    };
  }

  describe('script records', () => {
    it('records the run next to model history, which keeps one call and one response', async () => {
      process.env.LLXPRT_CONFIG_HOME = tempDir('code-mode-records-home-');
      const workspace = scratchDir('code-mode-records-');
      const { call } = countingScript(workspace);
      const agent = track(
        await buildScriptAgent([call], { workspace, rules: [ALLOW_SHELL] }),
      );
      await agent.agent.session.setRecording({ enabled: true });

      await runTurn(agent.agent);

      const runs = await agent.agent.session.getToolScriptRuns();
      expect(runs).toHaveLength(1);
      const [run] = runs;
      expect(run.parentCallId).toBe('script-call-1');
      expect(run.purpose).toBe('count runs and read a');
      expect(run.tools).toStrictEqual(['run_shell_command', 'read_file']);
      expect(
        run.calls.map(({ sequence, tool, approval, status }) => ({
          sequence,
          tool,
          approval,
          status,
        })),
      ).toStrictEqual([
        {
          sequence: 1,
          tool: 'run_shell_command',
          approval: 'not_required',
          status: 'ok',
        },
        {
          sequence: 2,
          tool: 'read_file',
          approval: 'not_required',
          status: 'ok',
        },
      ]);
      expect(run.calls[1].argsSummary).toContain('a.txt');
      expect(run.calls[1].completeness).toBe('complete');
      expect(run.calls.every((nested) => nested.resultBytes > 0)).toBe(true);
      expect(run.calls[0].callId).toMatch(/^script-call-1#script-/);
      expect(run.finished).toMatchObject({
        ok: true,
        callCount: 2,
        partial: false,
        finalBytes: Buffer.byteLength('"alpha"'),
      });
      expect(run.finished?.inputBytes).toBe(
        run.calls[0].resultBytes + run.calls[1].resultBytes,
      );

      const history = await agent.agent.getHistory();
      expect(
        blocksOf(history, 'tool_call').map((block) =>
          block.type === 'tool_call' ? [block.id, block.name] : [],
        ),
      ).toStrictEqual([['script-call-1', 'execute_tool_script']]);
      expect(
        blocksOf(history, 'tool_response').map((block) =>
          block.type === 'tool_response' ? block.callId : '',
        ),
      ).toStrictEqual(['script-call-1']);
    }, 60_000);

    it('redraws a resumed run from its records without running the script again', async () => {
      process.env.LLXPRT_CONFIG_HOME = tempDir('code-mode-resume-home-');
      const workspace = scratchDir('code-mode-resume-');
      const { call, marker } = countingScript(workspace);
      const first = track(
        await buildScriptAgent([call], { workspace, rules: [ALLOW_SHELL] }),
      );
      await first.agent.session.setRecording({ enabled: true });
      await runTurn(first.agent);
      const sessionId = first.agent.session.getSessionId();
      const recorded = await first.agent.session.getToolScriptRuns();
      await first.agent.session.setRecording({ enabled: false });
      // The script ran once; remove its effect so a second run would show.
      expect(existsSync(marker)).toBe(true);
      rmSync(marker);

      // Same project (workspace), new agent: the provider has no turns, so
      // nothing here can ask the model or run a tool.
      const next = track(
        await buildScriptAgent([], { workspace, rules: [ALLOW_SHELL] }),
      );
      const history = await next.agent.session.resume(sessionId);
      const runs = await next.agent.session.getToolScriptRuns();

      expect(runs).toStrictEqual(recorded);
      expect(existsSync(marker)).toBe(false);
      expect(
        blocksOf(history, 'tool_call').map((block) =>
          block.type === 'tool_call' ? block.id : '',
        ),
      ).toStrictEqual(['script-call-1']);
      expect(
        blocksOf(history, 'tool_response').map((block) =>
          block.type === 'tool_response' ? block.callId : '',
        ),
      ).toStrictEqual(['script-call-1']);

      const card = formatToolScriptCard(runs[0], { source: call.source });
      expect(card).toContain('Purpose: count runs and read a');
      expect(card).toContain('Status: completed');
      expect(card).toContain('Tool calls: 2 (2 ok)');
      expect(card).toContain('✓ run_shell_command');
      expect(card).toContain('✓ read_file');
      expect(card).toContain('Script (');
    }, 60_000);
  });

  const TelemetryRecord = z.object({
    body: z.string(),
    attributes: z.record(z.unknown()),
  });

  function telemetryRecords(outfile: string) {
    return readFileSync(outfile, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        const parsed = TelemetryRecord.safeParse(JSON.parse(line));
        return parsed.success ? [parsed.data] : [];
      });
  }

  async function runWithTelemetry(logPrompts: boolean) {
    const workspace = scratchDir('code-mode-telemetry-');
    const outfile = join(tempDir('code-mode-telemetry-out-'), 'events.jsonl');
    writeFileSync(join(workspace, 'a.txt'), 'alpha');
    const agent = track(
      await buildScriptAgent(
        [
          {
            source: `const r = await tools["read_file"]({ absolute_path: ${JSON.stringify(join(workspace, 'a.txt'))} }); return r.value.text.trim();`,
            tools: ['read_file'],
            purpose: 'secret purpose text',
          },
        ],
        {
          workspace,
          config: { telemetry: { enabled: true, outfile, logPrompts } },
        },
      ),
    );
    await runTurn(agent.agent);
    const runId = (await scriptResponse(agent.agent)).ok;
    expect(runId).toBe(true);
    await agent.cleanup();
    owned.splice(owned.indexOf(agent), 1);
    expect(existsSync(outfile)).toBe(true);
    return telemetryRecords(outfile);
  }

  describe('script telemetry', () => {
    it('logs the nested call with its parent links and the run lifecycle, keeping text out without logPrompts', async () => {
      const records = await runWithTelemetry(false);
      const nested = records.find(
        (record) => record.attributes['function_name'] === 'read_file',
      );
      const parent = records.find(
        (record) =>
          record.attributes['function_name'] === 'execute_tool_script',
      );
      const lifecycle = records.find(
        (record) =>
          record.attributes['event.name'] === 'llxprt_code.tool_script_run',
      );

      expect(nested?.attributes).toMatchObject({
        origin: 'script',
        parent_call_id: 'script-call-1',
        agent_id: 'primary',
      });
      expect(nested?.attributes['script_run_id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(nested?.attributes['function_args']).toBeUndefined();
      expect(parent?.attributes['origin']).toBeUndefined();
      expect(parent?.attributes['function_args']).toBeUndefined();
      expect(lifecycle?.attributes).toMatchObject({
        parent_call_id: 'script-call-1',
        script_run_id: nested?.attributes['script_run_id'],
        agent_id: 'primary',
        nested_call_count: 1,
        final_bytes: Buffer.byteLength('"alpha"'),
        partial: false,
        success: true,
        termination_reason: 'completed',
      });
      expect(lifecycle?.attributes['input_bytes']).toBeGreaterThan(0);
      expect(lifecycle?.attributes['duration_ms']).toBeGreaterThan(0);
      expect(lifecycle?.attributes['purpose']).toBeUndefined();
      expect(JSON.stringify(records)).not.toContain('secret purpose text');
    }, 60_000);

    it('exports the purpose, source and nested arguments only when logPrompts is on', async () => {
      const records = await runWithTelemetry(true);
      const nested = records.find(
        (record) => record.attributes['function_name'] === 'read_file',
      );
      const parent = records.find(
        (record) =>
          record.attributes['function_name'] === 'execute_tool_script',
      );
      const lifecycle = records.find(
        (record) =>
          record.attributes['event.name'] === 'llxprt_code.tool_script_run',
      );

      expect(lifecycle?.attributes['purpose']).toBe('secret purpose text');
      expect(String(parent?.attributes['function_args'])).toContain(
        'tools[\\"read_file\\"]',
      );
      expect(String(nested?.attributes['function_args'])).toContain('a.txt');
    }, 60_000);
  });
});
