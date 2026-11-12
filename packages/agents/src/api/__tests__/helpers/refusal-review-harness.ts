/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Harness for issue #4036 phase 3 behavior tests: a real public Agent over the
 * real OpenAI provider, a foreground endpoint that refuses while a marker
 * phrase is in the request, a reviewer endpoint reached through a saved
 * profile, and the session journal replayed after the run.
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalMode, createAgent } from '@vybestack/llxprt-code-agents';
import type { Agent, AgentEvent } from '@vybestack/llxprt-code-agents';
import { replaySession } from '@vybestack/llxprt-code-core';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ProfileManager, Storage } from '@vybestack/llxprt-code-settings';
import { installRefusalWaitForTesting } from '../../../refusal/refusalWait.js';
import {
  REVIEW_DATA_CLOSE,
  REVIEW_DATA_OPEN,
} from '../../../refusal/reviewPrompt.js';
import { drain } from './agentHarness.js';
import {
  emptyRefusalReply,
  readJsonl,
  startScriptedEndpoint,
  stopReply,
  type EndpointReply,
  type ScriptedEndpoint,
  type WireRequest,
} from './refusal-endpoint.js';

/** The phrase the foreground endpoint objects to. */
export const ORIGINAL_PHRASE = 'attach the head to the forearm mesh';
export const REWRITTEN_PHRASE =
  'position the head mesh against the forearm mesh';
export const SUMMARY_ORIGINAL = `State snapshot: the agent will ${ORIGINAL_PHRASE} in src/mesh/fit.ts and kills 3 surviving mutants (42 of 50).`;
export const SUMMARY_REWRITTEN = `State snapshot: the agent will ${REWRITTEN_PHRASE} in src/mesh/fit.ts and terminates 3 surviving mutants (42 of 50).`;
export const REVIEWER_MODEL = 'reviewer-model';
export const PROMPT = 'please continue the mesh work';

export interface ReviewWireEntry {
  readonly id: string;
  readonly role: string;
  readonly kind: string;
  readonly editable: boolean;
  readonly text: string;
}

function messageText(message: { content?: unknown }): string {
  const { content } = message;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: unknown) =>
      typeof part === 'object' && part !== null && 'text' in part
        ? String((part as { text: unknown }).text)
        : '',
    )
    .join('');
}

/** The entries a reviewer was shown, read back from its wire request. */
export function reviewEntries(request: WireRequest): ReviewWireEntry[] {
  for (const message of request.messages) {
    const text = messageText(message);
    // The prompt itself names the delimiters; the data block is the last one.
    const start = text.lastIndexOf(REVIEW_DATA_OPEN);
    const end = text.indexOf(REVIEW_DATA_CLOSE, start);
    if (start < 0 || end < 0) continue;
    const data = JSON.parse(
      text.slice(start + REVIEW_DATA_OPEN.length, end),
    ) as {
      entries: ReviewWireEntry[];
    };
    return data.entries;
  }
  return [];
}

export function isReviewRequest(request: WireRequest): boolean {
  return request.messages.some((message) =>
    messageText(message).includes(REVIEW_DATA_OPEN),
  );
}

export function wireIncludes(request: WireRequest, text: string): boolean {
  return request.messages.some((message) =>
    messageText(message).includes(text),
  );
}

/** A reviewer reply carrying this verdict object as JSON text. */
export function verdictReply(verdict: unknown): EndpointReply {
  return stopReply(JSON.stringify(verdict));
}

/** The reviewer answer that rewrites the compression summary. */
export function summaryRewriteReply(
  request: WireRequest,
  newText: string = SUMMARY_REWRITTEN,
): EndpointReply {
  const summary = reviewEntries(request).find((e) => e.kind === 'summary');
  return verdictReply({
    verdict: 'rewrite',
    explanation: 'Plain wording for a mesh-fitting summary.',
    rewrites: [{ id: summary?.id ?? 'missing', newText }],
  });
}

export function seedHistory(summaryText: string): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: summaryText }],
      metadata: { isSummary: true, synthetic: true },
    },
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Continuing from the snapshot.' }],
      metadata: { synthetic: true, reason: 'compression-continuation' },
    },
  ];
}

export interface ReviewScenario {
  /** Ephemeral settings applied before the prompt (on top of retries 1). */
  readonly settings?: Readonly<Record<string, unknown>>;
  /**
   * A saved profile that points at the second endpoint and the setting that
   * names it. Omit to leave both settings unset.
   */
  readonly profile?: {
    readonly name: string;
    readonly setting: 'refusal.review-profile' | 'compression.profile';
  };
  /** Foreground answer to a non-review request. Default: refuse while marked. */
  readonly foreground?: (request: WireRequest) => EndpointReply;
  /** Answer to a review request, wherever it lands. Default: valid rewrite. */
  readonly reviewer?: (request: WireRequest) => EndpointReply;
  /** Runs while the reviewer is "thinking", before its answer is sent. */
  readonly duringReview?: (agent: Agent) => Promise<void>;
  /** Abort the request while the reviewer is "thinking". */
  readonly abortDuringReview?: boolean;
  readonly history?: readonly IContent[];
}

export interface ReviewRun {
  readonly events: readonly AgentEvent[];
  readonly waits: readonly number[];
  readonly stats: ReturnType<Agent['getStats']>;
  /** Requests the foreground endpoint received, review calls excluded. */
  readonly foreground: readonly WireRequest[];
  /** Review requests, wherever they were sent. */
  readonly reviews: readonly WireRequest[];
  /** Everything the profile endpoint received. */
  readonly profileEndpoint: readonly WireRequest[];
  /** Everything the foreground endpoint received, review calls included. */
  readonly foregroundEndpoint: readonly WireRequest[];
  readonly historyAfter: Awaited<ReturnType<Agent['getHistory']>>;
  readonly tokenRecords: ReadonlyArray<Record<string, unknown>>;
  readonly journalRecords: ReadonlyArray<Record<string, unknown>>;
  /** History a resume of the recorded session would restore. */
  readonly replayed: readonly IContent[];
}

function refuseWhileMarked(request: WireRequest): EndpointReply {
  return wireIncludes(request, ORIGINAL_PHRASE)
    ? emptyRefusalReply()
    : stopReply('recovered answer');
}

async function saveProfile(
  name: string,
  endpoint: ScriptedEndpoint,
): Promise<void> {
  await new ProfileManager().saveProfile(name, {
    version: 1,
    provider: 'openai',
    model: REVIEWER_MODEL,
    modelParams: {},
    ephemeralSettings: {
      'base-url': endpoint.url,
      'auth-key': 'reviewer-local-key',
    },
  });
}

async function replayJournal(
  journalPath: string,
  journalRecords: ReadonlyArray<Record<string, unknown>>,
): Promise<readonly IContent[]> {
  const start = journalRecords.find((r) => r['type'] === 'session_start');
  const projectHash = (
    start?.['payload'] as { projectHash?: string } | undefined
  )?.projectHash;
  if (projectHash === undefined) return [];
  const replay = await replaySession(journalPath, projectHash);
  return replay.ok ? replay.history : [];
}

/** Settings, seeded history and journal recording for one scenario. */
async function prepareAgent(
  agent: Agent,
  scenario: ReviewScenario,
): Promise<void> {
  const settings: Record<string, unknown> = {
    'refusal.retries': 1,
    'refusal.backoff-ms': 15000,
    'refusal.rewrite': true,
    'refusal.max-rewrites': 1,
    ...scenario.settings,
  };
  if (scenario.profile !== undefined) {
    settings[scenario.profile.setting] = scenario.profile.name;
  }
  for (const [key, value] of Object.entries(settings)) {
    agent.setEphemeralSetting(key, value);
  }
  await agent.setHistory([
    ...(scenario.history ?? seedHistory(SUMMARY_ORIGINAL)),
  ]);
  await agent.session.setRecording({ enabled: true });
}

interface Endpoints {
  readonly foreground: ScriptedEndpoint;
  readonly profile: ScriptedEndpoint;
}

/** Everything a finished prompt left behind, read while the agent is alive. */
async function collectRun(input: {
  readonly agent: Agent;
  readonly events: readonly AgentEvent[];
  readonly waits: readonly number[];
  readonly endpoints: Endpoints;
  readonly workingDir: string;
  readonly sessionId: string;
}): Promise<ReviewRun> {
  const { agent, endpoints } = input;
  const historyAfter = await agent.getHistory();
  const journalPath = agent.session.getRecording().path ?? '';
  const stats = agent.getStats();
  await agent.session.setRecording({ enabled: false });
  const journalRecords = readJsonl(journalPath);
  const tokenLog = join(
    new Storage(input.workingDir).getProjectTempDir(),
    'token-usage',
    `${input.sessionId}.jsonl`,
  );
  const everything = [
    ...endpoints.foreground.requests(),
    ...endpoints.profile.requests(),
  ];
  return {
    events: input.events,
    waits: input.waits,
    stats,
    foreground: endpoints.foreground
      .requests()
      .filter((r) => !isReviewRequest(r)),
    reviews: everything.filter(isReviewRequest),
    profileEndpoint: [...endpoints.profile.requests()],
    foregroundEndpoint: [...endpoints.foreground.requests()],
    historyAfter,
    tokenRecords: readJsonl(tokenLog),
    journalRecords,
    replayed: await replayJournal(journalPath, journalRecords),
  };
}

/** Runs one refused prompt through the real agent and both endpoints. */
export async function runReviewScenario(
  scenario: ReviewScenario = {},
): Promise<ReviewRun> {
  const workingDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'llxprt-review-')),
  );
  const sessionId = `review-${randomUUID()}`;
  const answerReview = scenario.reviewer ?? ((r) => summaryRewriteReply(r));
  let agent: Agent | undefined;
  const controller = new AbortController();
  const respond = async (request: WireRequest): Promise<EndpointReply> => {
    if (!isReviewRequest(request)) {
      return (scenario.foreground ?? refuseWhileMarked)(request);
    }
    if (agent !== undefined) await scenario.duringReview?.(agent);
    if (scenario.abortDuringReview === true) controller.abort();
    return answerReview(request);
  };
  const endpoints: Endpoints = {
    foreground: await startScriptedEndpoint(respond),
    profile: await startScriptedEndpoint(respond),
  };
  const waits: number[] = [];
  const restoreWait = installRefusalWaitForTesting((ms) => {
    waits.push(ms);
    return Promise.resolve();
  });
  try {
    if (scenario.profile !== undefined) {
      await saveProfile(scenario.profile.name, endpoints.profile);
    }
    agent = await createAgent({
      provider: 'openai',
      model: 'scripted-model',
      workingDir,
      sessionId,
      approvalMode: ApprovalMode.YOLO,
      auth: { apiKey: 'local-test-key', baseUrl: endpoints.foreground.url },
    });
    await prepareAgent(agent, scenario);
    const events = await drain(
      agent.stream(PROMPT, { signal: controller.signal }),
    );
    return await collectRun({
      agent,
      events,
      waits,
      endpoints,
      workingDir,
      sessionId,
    });
  } finally {
    restoreWait();
    await agent?.dispose();
    await endpoints.foreground.stop();
    await endpoints.profile.stop();
    rmSync(workingDir, { recursive: true, force: true });
  }
}
