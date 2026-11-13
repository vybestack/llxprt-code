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
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ApprovalMode, createAgent } from '@vybestack/llxprt-code-agents';
import type { Agent, AgentEvent } from '@vybestack/llxprt-code-agents';
import { replaySession } from '@vybestack/llxprt-code-core';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ProfileManager, Storage } from '@vybestack/llxprt-code-settings';
import {
  REVIEW_DATA_CLOSE,
  REVIEW_DATA_OPEN,
} from '../../../refusal/reviewPrompt.js';
import { startAnthropicEndpoint } from './anthropic-refusal-endpoint.js';
import {
  emptyRefusalReply,
  readJsonl,
  requestedWaits,
  startScriptedEndpoint,
  stopReply,
  type EndpointReply,
  type ReplyResponder,
  type RequestConnection,
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

export interface ReviewWireData {
  readonly refusal: { readonly provider: string; readonly model: string };
  readonly latestUserGoal: string | null;
  readonly entries: readonly ReviewWireEntry[];
}

/** The data block a reviewer was shown, read back from its wire request. */
export function reviewData(request: WireRequest): ReviewWireData | undefined {
  for (const message of request.messages) {
    const text = messageText(message);
    // The prompt itself names the delimiters; the data block is the last one.
    const start = text.lastIndexOf(REVIEW_DATA_OPEN);
    const end = text.indexOf(REVIEW_DATA_CLOSE, start);
    if (start < 0 || end < 0) continue;
    return JSON.parse(
      text.slice(start + REVIEW_DATA_OPEN.length, end),
    ) as ReviewWireData;
  }
  return undefined;
}

/** The entries a reviewer was shown, read back from its wire request. */
export function reviewEntries(
  request: WireRequest,
): readonly ReviewWireEntry[] {
  return reviewData(request)?.entries ?? [];
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

export type WireProtocol = 'openai' | 'anthropic';

/** What a scripted answer may need to know about the run it belongs to. */
export interface ScenarioEnv {
  readonly workingDir: string;
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
    /** Provider the profile uses. Default: openai. */
    readonly protocol?: WireProtocol;
    readonly model?: string;
    readonly modelParams?: Readonly<Record<string, unknown>>;
  };
  /** Provider, model and model parameters of the foreground session. */
  readonly foregroundProtocol?: WireProtocol;
  readonly foregroundModel?: string;
  readonly foregroundParams?: Readonly<Record<string, unknown>>;
  /** Files written under the working directory before the prompt. */
  readonly files?: Readonly<Record<string, string>>;
  readonly prompt?: string;
  /** Foreground answer to a non-review request. Default: refuse while marked. */
  readonly foreground?: (
    request: WireRequest,
    env: ScenarioEnv,
  ) => EndpointReply;
  /** Answer to a review request, wherever it lands. Default: valid rewrite. */
  readonly reviewer?: (
    request: WireRequest,
    env: ScenarioEnv,
    connection: RequestConnection,
  ) => EndpointReply | Promise<EndpointReply>;
  /**
   * Runs while the reviewer is "thinking", before its answer is sent. It is
   * given the public events the host has received so far.
   */
  readonly duringReview?: (
    agent: Agent,
    eventsSoFar: readonly AgentEvent[],
  ) => Promise<void>;
  /** Abort the request while the reviewer is "thinking". */
  readonly abortDuringReview?: boolean;
  readonly history?: readonly IContent[];
}

export interface ReviewRun {
  readonly events: readonly AgentEvent[];
  /** Backoff of every resend, as the journal recorded it; a rewrite records 0. */
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
  /** Review requests whose client hung up before the reply ended. */
  readonly abandonedReviews: number;
  readonly historyAfter: Awaited<ReturnType<Agent['getHistory']>>;
  readonly tokenRecords: ReadonlyArray<Record<string, unknown>>;
  readonly journalRecords: ReadonlyArray<Record<string, unknown>>;
  /** History a resume of the recorded session would restore. */
  readonly replayed: readonly IContent[];
  /** The unique name the scenario's reviewer profile was saved under. */
  readonly profileName: string | undefined;
}

function refuseWhileMarked(request: WireRequest): EndpointReply {
  return wireIncludes(request, ORIGINAL_PHRASE)
    ? emptyRefusalReply()
    : stopReply('recovered answer');
}

/**
 * Every test file shares one session root, so a fixed profile name would let
 * two scenarios overwrite each other's base-url before either loads it.
 */
function uniqueProfileName(name: string): string {
  return `${name}-${randomUUID().slice(0, 8)}`;
}

async function saveProfile(
  profile: NonNullable<ReviewScenario['profile']>,
  profileName: string,
  endpoint: ScriptedEndpoint,
): Promise<void> {
  await new ProfileManager().saveProfile(profileName, {
    version: 1,
    provider: profile.protocol ?? 'openai',
    model: profile.model ?? REVIEWER_MODEL,
    modelParams: { ...profile.modelParams },
    ephemeralSettings: {
      'base-url': endpoint.url,
      'auth-key': 'reviewer-local-key',
    },
  });
}

function startEndpoint(
  protocol: WireProtocol | undefined,
  responder: ReplyResponder,
): Promise<ScriptedEndpoint> {
  return protocol === 'anthropic'
    ? startAnthropicEndpoint(responder)
    : startScriptedEndpoint(responder);
}

function writeFiles(
  workingDir: string,
  files: Readonly<Record<string, string>> | undefined,
): void {
  for (const [relative, content] of Object.entries(files ?? {})) {
    const target = join(workingDir, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
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
  profileName: string | undefined,
): Promise<void> {
  const settings: Record<string, unknown> = {
    'refusal.retries': 1,
    'refusal.backoff-ms': 1,
    'refusal.rewrite': true,
    'refusal.max-rewrites': 1,
    ...scenario.settings,
  };
  if (scenario.profile !== undefined && profileName !== undefined) {
    settings[scenario.profile.setting] = profileName;
  }
  for (const [key, value] of Object.entries(settings)) {
    agent.setEphemeralSetting(key, value);
  }
  for (const [key, value] of Object.entries(scenario.foregroundParams ?? {})) {
    agent.setModelParam(key, value);
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
  readonly endpoints: Endpoints;
  readonly workingDir: string;
  readonly sessionId: string;
  readonly profileName: string | undefined;
}): Promise<ReviewRun> {
  const { agent, endpoints, profileName } = input;
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
    waits: requestedWaits(journalRecords),
    stats,
    foreground: endpoints.foreground
      .requests()
      .filter((r) => !isReviewRequest(r)),
    reviews: everything.filter(isReviewRequest),
    profileEndpoint: [...endpoints.profile.requests()],
    foregroundEndpoint: [...endpoints.foreground.requests()],
    abandonedReviews: [endpoints.foreground, endpoints.profile]
      .flatMap((endpoint) =>
        endpoint
          .disconnectedRequests()
          .map((index) => endpoint.requests()[index]),
      )
      .filter(isReviewRequest).length,
    historyAfter,
    tokenRecords: readJsonl(tokenLog),
    journalRecords,
    replayed: await replayJournal(journalPath, journalRecords),
    profileName,
  };
}

/** Runs one refused prompt through the real agent and both endpoints. */
export async function runReviewScenario(
  scenario: ReviewScenario = {},
): Promise<ReviewRun> {
  const workingDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'llxprt-review-')),
  );
  const env: ScenarioEnv = { workingDir };
  const sessionId = `review-${randomUUID()}`;
  const answerReview =
    scenario.reviewer ?? ((request) => summaryRewriteReply(request));
  const answerForeground = scenario.foreground ?? refuseWhileMarked;
  let agent: Agent | undefined;
  const events: AgentEvent[] = [];
  const controller = new AbortController();
  const respond: ReplyResponder = async (request, _index, connection) => {
    if (!isReviewRequest(request)) return answerForeground(request, env);
    if (agent !== undefined) await scenario.duringReview?.(agent, [...events]);
    if (scenario.abortDuringReview === true) controller.abort();
    return answerReview(request, env, connection);
  };
  const foregroundProtocol = scenario.foregroundProtocol ?? 'openai';
  const endpoints: Endpoints = {
    foreground: await startEndpoint(foregroundProtocol, respond),
    profile: await startEndpoint(scenario.profile?.protocol, respond),
  };
  const profileName =
    scenario.profile === undefined
      ? undefined
      : uniqueProfileName(scenario.profile.name);
  try {
    writeFiles(workingDir, scenario.files);
    if (scenario.profile !== undefined && profileName !== undefined) {
      await saveProfile(scenario.profile, profileName, endpoints.profile);
    }
    agent = await createAgent({
      provider: foregroundProtocol,
      model: scenario.foregroundModel ?? 'scripted-model',
      workingDir,
      sessionId,
      approvalMode: ApprovalMode.YOLO,
      auth: { apiKey: 'local-test-key', baseUrl: endpoints.foreground.url },
    });
    await prepareAgent(agent, scenario, profileName);
    for await (const event of agent.stream(scenario.prompt ?? PROMPT, {
      signal: controller.signal,
    })) {
      events.push(event);
    }
    return await collectRun({
      agent,
      events,
      endpoints,
      workingDir,
      sessionId,
      profileName,
    });
  } finally {
    await agent?.dispose();
    await endpoints.foreground.stop();
    await endpoints.profile.stop();
    if (profileName !== undefined) {
      await new ProfileManager().deleteProfile(profileName).catch(() => {});
    }
    rmSync(workingDir, { recursive: true, force: true });
  }
}
