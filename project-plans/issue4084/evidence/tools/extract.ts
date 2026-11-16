/**
 * Issue #4084 Phase E: collect the session recording and token-usage logs of
 * one tmux run and compute its metrics.
 *
 * Usage: bun project-plans/issue4084/evidence/tools/extract.ts <run-dir>
 * Writes <run-dir>/session.jsonl, <run-dir>/token-usage*.jsonl and
 * <run-dir>/metrics.json, and prints the metrics.
 */

import { copyFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The checkout holding this file: the working directory the runs used. */
const PROJECT = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const LOGS = path.join(homedir(), 'Library/Logs/llxprt-code/tmp');

interface Line {
  type?: string;
  ts?: string;
  record_type?: string;
  payload?: any;
  [key: string]: any;
}

function readJsonl(file: string): Line[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Line);
}

function findSession(start: number, end: number): { dir: string; file: string } {
  const found: { dir: string; file: string }[] = [];
  for (const hash of readdirSync(LOGS)) {
    const chats = path.join(LOGS, hash, 'chats');
    let files: string[];
    try {
      files = readdirSync(chats).filter(
        (f) => f.startsWith('session-') && f.endsWith('.jsonl'),
      );
    } catch {
      continue;
    }
    for (const f of files) {
      const first = readFileSync(path.join(chats, f), 'utf8').split('\n')[0];
      const head = JSON.parse(first) as Line;
      if (head.type !== 'session_start') continue;
      const at = Date.parse(head.payload.startTime) / 1000;
      if (head.payload.cwd !== PROJECT) continue;
      if (at >= start - 2 && at <= end) found.push({ dir: path.join(LOGS, hash), file: path.join(chats, f) });
    }
  }
  if (found.length !== 1)
    throw new Error(`expected one session in the run window, found ${found.length}: ${found.map((f) => f.file).join(', ')}`);
  return found[0];
}

function usage(records: Line[]) {
  const turns = records.filter((r) => r.record_type === 'turn');
  const callIds = new Map<string, string>();
  for (const turn of turns)
    for (const call of turn.tool_calls ?? []) callIds.set(call.call_id, call.tool_name);
  const byTool: Record<string, number> = {};
  for (const name of callIds.values()) byTool[name] = (byTool[name] ?? 0) + 1;
  const sum = (key: string) => turns.reduce((total, t) => total + (t[key] ?? 0), 0);
  return {
    requests: turns.length,
    failedAttempts: turns.filter((t) => t.attempt_outcome !== 'success').map((t) => t.attempt_outcome),
    inputTokens: sum('actual_prompt_tokens'),
    cachedTokens: sum('cached_tokens'),
    outputTokens: sum('output_tokens'),
    lastRequestInputTokens: turns.at(-1)?.actual_prompt_tokens ?? 0,
    maxRequestInputTokens: Math.max(0, ...turns.map((t) => t.actual_prompt_tokens ?? 0)),
    toolResultTokens: [...new Map(turns.flatMap((t) => (t.tool_calls ?? []).map((c: any) => [c.call_id, c.result_tokens ?? 0]))).values()].reduce((a, b) => a + b, 0),
    toolCalls: callIds.size,
    toolCallsByName: byTool,
  };
}

function main(runDir: string): void {
  const start = Number(readFileSync(path.join(runDir, 'start-epoch.txt'), 'utf8'));
  const end = Number(readFileSync(path.join(runDir, 'end-epoch.txt'), 'utf8'));
  const { dir, file } = findSession(start, end);
  const session = readJsonl(file);
  const sessionId = session[0].payload.sessionId as string;
  copyFileSync(file, path.join(runDir, 'session.jsonl'));

  const usageDir = path.join(dir, 'token-usage');
  const usageFiles = readdirSync(usageDir).filter(
    (f) => f === `${sessionId}.jsonl` || f.startsWith(`${sessionId}::`),
  );
  const parentFile = `${sessionId}.jsonl`;
  const parentUsage = usage(readJsonl(path.join(usageDir, parentFile)));
  copyFileSync(path.join(usageDir, parentFile), path.join(runDir, 'token-usage-parent.jsonl'));
  const children: Record<string, ReturnType<typeof usage>> = {};
  for (const f of usageFiles.filter((f) => f !== parentFile)) {
    const label = f.split('#')[1] ?? f;
    children[label] = usage(readJsonl(path.join(usageDir, f)));
    copyFileSync(path.join(usageDir, f), path.join(runDir, `token-usage-child-${label}.jsonl`));
  }

  const contents = session.filter((l) => l.type === 'content').map((l) => ({ ts: l.ts!, ...l.payload.content }));
  const directCalls = contents.flatMap((c) => c.blocks.filter((b: any) => b.type === 'tool_call').map((b: any) => b.name as string));
  const directByName: Record<string, number> = {};
  for (const name of directCalls) directByName[name] = (directByName[name] ?? 0) + 1;
  const scriptEvents = session.filter((l) => l.type === 'tool_script_event').map((l) => l.payload);
  const nested = scriptEvents.filter((e) => e.phase === 'call');
  const nestedByName: Record<string, number> = {};
  for (const e of nested) nestedByName[e.tool] = (nestedByName[e.tool] ?? 0) + 1;
  const runs = scriptEvents.filter((e) => e.phase === 'finished').map((e) => ({
    ok: e.ok,
    errorCode: e.errorCode,
    callCount: e.callCount,
    partial: e.partial,
    inputBytes: e.inputBytes,
    finalBytes: e.finalBytes,
    durationMs: e.durationMs,
  }));
  const human = contents.filter((c) => c.speaker === 'human');
  const aiTexts = contents.filter((c) => c.speaker === 'ai').map((c) => ({ ts: c.ts, text: c.blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') })).filter((c) => c.text.trim() !== '');
  const firstHuman = human[0]?.ts;
  const lastAi = contents.filter((c) => c.speaker === 'ai').at(-1)?.ts;
  const metrics = {
    run: path.basename(runDir),
    commit: readFileSync(path.join(runDir, 'commit.txt'), 'utf8').trim(),
    sessionId,
    harnessWallSeconds: end - start,
    turnSeconds: firstHuman && lastAi ? (Date.parse(lastAi) - Date.parse(firstHuman)) / 1000 : null,
    parent: parentUsage,
    children,
    directToolCalls: directCalls.length,
    directToolCallsByName: directByName,
    nestedToolCalls: nested.length,
    nestedToolCallsByName: nestedByName,
    scriptRuns: runs,
    sessionEvents: session.filter((l) => l.type === 'session_event').map((l) => l.payload.message).filter((m: string) => !m.startsWith('Skill conflict')),
    humanMessages: human.length,
  };
  writeFileSync(path.join(runDir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  writeFileSync(path.join(runDir, 'final-answer.md'), `${aiTexts.at(-1)?.text ?? ''}\n`);
  console.log(JSON.stringify(metrics, null, 2));
}

main(process.argv[2]);
