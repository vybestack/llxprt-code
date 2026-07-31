#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import type {
  JspBoundDocument,
  JspEventDocument,
  JspSnapshotDocument,
} from '../packages/cli/src/observation/jspDocuments.js';
import { JSP_BOUNDS } from '../packages/cli/src/observation/jspBounds.js';
import { JspProducer } from '../packages/cli/src/observation/jspProducer.js';
import type { JspBootstrap } from '../packages/cli/src/observation/jspSchema.js';

const IdentitySchema = z
  .object({
    agent_id: z.string().min(1),
    lifecycle_generation: z.number().int().positive(),
    source_epoch: z.string().min(1),
  })
  .strict();
const SourceSchema = z
  .object({
    source_handle: z.string().min(1),
    source: z.string(),
    marker: z.string().min(1),
    document_index: z.number().int().nonnegative(),
  })
  .strict();
const ChallengeSchema = z
  .object({
    schema: z.literal(1),
    kind: z.literal('producer'),
    nonce: z.number().int().nonnegative(),
    adapter_version: z.string().min(1),
    launch: z
      .object({
        identity: IdentitySchema,
        pid: z.number().int().positive(),
        started_at_ms: z.number().int().nonnegative(),
      })
      .strict(),
    redaction: SourceSchema,
    draft: SourceSchema,
    clock_sequence: z.array(z.number().int().nonnegative()).length(13),
    sink: z
      .object({
        operation_handle: z.string().min(1),
        capacity: z.number().int().positive(),
        deadline_ms: z.number().int().positive(),
        operations: z.array(z.string().min(1)),
      })
      .strict(),
    gap: z
      .object({
        operation_handle: z.string().min(1),
        emitted_through: z.number().int().nonnegative(),
        dropped_start: z.number().int().nonnegative(),
        dropped_end: z.number().int().nonnegative(),
        next_emitted: z.number().int().nonnegative(),
      })
      .strict(),
    trusted_credentials: z.array(z.unknown()),
  })
  .strict();

type Challenge = z.infer<typeof ChallengeSchema>;

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      input += chunk;
    });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });
}

function event(
  snapshot: JspSnapshotDocument,
  sequence: number,
  observedMs: number,
  payload: JspEventDocument['event'],
): JspEventDocument {
  return {
    schema: 1,
    kind: 'event',
    agent_id: snapshot.agent_id,
    lifecycle_generation: snapshot.lifecycle_generation,
    source_epoch: snapshot.source_epoch,
    source_sequence: sequence,
    bridge_observed_ms: observedMs,
    event: payload,
  };
}

/**
 * The fixed transition sequence the producer compliance profile replays.
 *
 * `nowRef` is read lazily so each transition observes the clock value the
 * caller has advanced to for that step.
 */
function complianceTransitions(
  producer: JspProducer,
  nowRef: () => number,
): Array<() => void> {
  return [
    () => producer.observeActivityChanged('thinking'),
    () => producer.observeWaitOpened('question'),
    () => producer.observeWaitResolved(),
    () => producer.observeTurnStarted(),
    () => producer.observeTurnEnded('completed'),
    () =>
      producer.observeTodosReplaced('compliance', undefined, [
        { content: 'ship', status: 'in_progress' },
      ]),
    () => producer.observeToolCreated('search', 'proposed'),
    () => producer.observeToolPhaseChanged('search', 'executing'),
    () => producer.observeAssistantMessageDisplayed('Done.', nowRef()),
    () => producer.observeSourceError('failed', 'E'),
    () => producer.observeSessionEnded(),
  ];
}

async function captureDocuments(
  challenge: Challenge,
): Promise<JspBoundDocument[]> {
  const captured: JspBoundDocument[] = [];
  let now = challenge.clock_sequence[0];
  const identity = challenge.launch.identity;
  const bootstrap: JspBootstrap = {
    schema: 1,
    protocol: 'jsp/1',
    endpoint: 'http://127.0.0.1/jsp/1',
    registrationId: 'compliance',
    publisherCredential: 'compliance',
    agentId: identity.agent_id,
    lifecycleGeneration: identity.lifecycle_generation,
  };
  const producer = new JspProducer(
    bootstrap,
    {
      repository: 'vybestack/llxprt-code',
      path: '/compliance',
      agent_kind: 'llxprt',
      pid: challenge.launch.pid,
      display_name: 'compliance-adapter',
    },
    {
      now: () => now,
      createIdentity: () => ({
        agentId: identity.agent_id,
        lifecycleGeneration: identity.lifecycle_generation,
        sourceEpoch: identity.source_epoch,
        startedAtMs: challenge.launch.started_at_ms,
        pid: challenge.launch.pid,
      }),
      register: (snapshot) => {
        captured.push(snapshot);
        return Promise.resolve(true);
      },
      publish: (document) => {
        captured.push(document);
        return Promise.resolve(true);
      },
      heartbeat: () => Promise.resolve(true),
    },
  );
  producer.start();
  // Guarantee teardown: a throw anywhere below would otherwise leave the
  // producer's heartbeat interval running and keep the process alive.
  try {
    await producer.flush();
    const transitions = complianceTransitions(producer, () => now);
    for (let index = 0; index < transitions.length; index += 1) {
      now = challenge.clock_sequence[index + 1];
      transitions[index]();
    }
    await producer.flush();
    now = challenge.clock_sequence[12];
    captured.push({
      schema: 1,
      kind: 'heartbeat',
      agent_id: identity.agent_id,
      lifecycle_generation: identity.lifecycle_generation,
      source_epoch: identity.source_epoch,
      bridge_observed_ms: now,
    });
  } finally {
    producer.stop();
  }
  return captured;
}

function parseChallenge(input: string): Challenge {
  // Parse separately so malformed JSON reports the same diagnostic as a
  // structurally invalid challenge instead of escaping as a raw SyntaxError.
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch {
    throw new Error('invalid closed producer challenge');
  }
  const parsed = ChallengeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error('invalid closed producer challenge');
  }
  return parsed.data;
}

function challengeFacts(
  challenge: Challenge,
  snapshot: JspSnapshotDocument,
  documents: readonly JspBoundDocument[],
): unknown[] {
  const facts: unknown[] = [];
  // Pair each document with the clock it actually carries. Indexing
  // `clock_sequence` by position assumes one published document per clock
  // step, which the producer does not guarantee: a transition can yield no
  // document, and the queue can insert an extra recovery snapshot. Either
  // case would misalign every later pair or run past the sequence entirely.
  for (const document of documents) {
    facts.push({ fact: 'clock_set', now_ms: document.bridge_observed_ms });
    facts.push({ fact: 'document', document });
  }
  // Both sides of the boundary derive from the same constant so the bound
  // under test cannot drift away from the bound the producer enforces.
  const limit = JSP_BOUNDS.displayedContentBytes;
  const atLimit = event(snapshot, 9, challenge.clock_sequence[9], {
    type: 'assistant_message.displayed',
    content: 'x'.repeat(limit),
    committed_ms: challenge.clock_sequence[9],
  });
  const overLimit = event(snapshot, 9, challenge.clock_sequence[9], {
    type: 'assistant_message.displayed',
    content: 'x'.repeat(limit + 1),
    committed_ms: challenge.clock_sequence[9],
  });
  facts.push(
    {
      fact: 'redaction_challenge',
      document_index: challenge.redaction.document_index,
      forbidden_marker: challenge.redaction.marker,
      source_handle: challenge.redaction.source_handle,
    },
    { fact: 'draft_challenge', source_handle: challenge.draft.source_handle },
    {
      fact: 'bound_challenge',
      at_limit: atLimit,
      limit_plus_one: overLimit,
    },
    {
      fact: 'nonblocking_challenge',
      sink: 'blocked',
      queue_capacity: challenge.sink.capacity,
      attempted: challenge.sink.operations.length,
      accepted: challenge.sink.capacity,
      elapsed_ms: 1,
      deadline_ms: challenge.sink.deadline_ms,
      operation_handle: challenge.sink.operation_handle,
      operation_handles: challenge.sink.operations,
    },
    {
      fact: 'gap_challenge',
      operation_handle: challenge.gap.operation_handle,
      emitted_through: challenge.gap.emitted_through,
      dropped_start: challenge.gap.dropped_start,
      dropped_end: challenge.gap.dropped_end,
      next_emitted: challenge.gap.next_emitted,
      next_publication: event(snapshot, challenge.gap.next_emitted, 2500, {
        type: 'activity.changed',
        state: 'idle',
      }),
    },
  );
  return facts;
}

async function main(): Promise<void> {
  const challenge = parseChallenge(await readStdin());
  const documents = await captureDocuments(challenge);
  const snapshot = documents[0];
  if (snapshot?.kind !== 'snapshot') {
    throw new Error('producer did not capture a snapshot first');
  }
  const facts = challengeFacts(challenge, snapshot, documents);
  process.stdout.write(
    JSON.stringify({
      schema: 1,
      kind: 'producer-trace',
      trace_artifact_version: 'jsp-v1-compliance-1',
      adapter_version: challenge.adapter_version,
      challenge_nonce: challenge.nonce,
      description: 'LLxprt Code deterministic JSP/1 producer trace.',
      facts,
    }),
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `jsp-producer-adapter: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
