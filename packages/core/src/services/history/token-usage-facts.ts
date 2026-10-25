/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readNeutralRowFact } from '../../journal/neutral-row-fact-storage.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  neutralRowFactKey,
  type NeutralRowFactRegistration,
} from '../../journal/neutralRowFacts.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { JournalResponsePlan } from './journal-response-plan.js';
import { JournalTailSource } from './journal-tail-source.js';
import { journalEntryPlans } from './journal-entry-plans.js';
import {
  measureRequestRow,
  serializeRequestRow,
  stableStringify,
  type RequestRowMeasurement,
  type TokenCountFn,
} from './token-usage-measurement.js';
import type { IContent } from './IContent.js';

const measurementSchema = z.object({
  tokens: z.number().nonnegative(),
  bucket: z.enum(['history', 'media', 'injected']),
  fingerprintKey: z.string().nullable(),
  toolResults: z.array(
    z.object({
      callId: z.string(),
      blockToolName: z.string(),
      resultTokens: z.number().nonnegative(),
      wasTruncated: z.boolean(),
    }),
  ),
  toolCalls: z.array(z.object({ id: z.string(), name: z.string() })),
});
const unitSchema = z.object({
  signature: z.string(),
  measurement: measurementSchema,
});
const rowSchema = z.array(unitSchema);
export interface StoredTokenUsageUnit {
  readonly signature: string;
  readonly measurement: RequestRowMeasurement;
}
const registrationIdentity = {
  kind: 'token-usage',
  revision: '1',
} satisfies Pick<NeutralRowFactRegistration, 'kind' | 'revision'>;

export function decodeTokenUsageFacts(
  bytes: Uint8Array | undefined,
): readonly StoredTokenUsageUnit[] {
  return bytes === undefined
    ? []
    : rowSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}

export async function tokenUsagePlanSignature(
  plan: JournalResponsePlan,
  entryStamp: (label: bigint) => Promise<string>,
): Promise<string> {
  const hash = createHash('sha256');
  hash.update(
    stableStringify({
      speaker: plan.header.speaker,
      id: plan.header.metadata?.id,
      synthetic: plan.header.metadata?.synthetic,
    }),
  );
  let previousLabel: bigint | undefined;
  let previousStamp = '';
  for (const ref of plan.blocks) {
    if (ref.at.label !== previousLabel) {
      previousStamp = await entryStamp(ref.at.label);
      previousLabel = ref.at.label;
    }
    hash.update(
      stableStringify({
        ...ref,
        at: { ...ref.at, label: ref.at.label.toString() },
        stamp: previousStamp,
      }),
    );
  }
  return hash.digest('hex');
}

export async function readTokenUsagePlan(
  plan: JournalResponsePlan,
): Promise<IContent> {
  const blocks: IContent['blocks'] = [];
  for await (const block of plan.openBlocks()) blocks.push(block);
  return { ...plan.header, blocks };
}

export function tokenUsageFactRegistration(
  countTokens: TokenCountFn,
): NeutralRowFactRegistration {
  return {
    ...registrationIdentity,
    async measure(snapshot, entry, previous) {
      const source = await JournalTailSource.create(snapshot, []);
      const old = decodeTokenUsageFacts(previous);
      const units: StoredTokenUsageUnit[] = [];
      for await (const plan of journalEntryPlans(source, entry)) {
        const signature = await tokenUsagePlanSignature(plan, (label) =>
          snapshot.rowMeasurementStamp(label === entry.label ? entry : label),
        );
        const stored = old.find((unit) => unit.signature === signature);
        units.push(
          stored ?? {
            signature,
            measurement: measureRequestRow(
              await readTokenUsagePlan(plan),
              countTokens,
            ),
          },
        );
      }
      return new TextEncoder().encode(JSON.stringify(units));
    },
  };
}

export async function storedTokenUsageFacts(
  snapshot: VersionSnapshot,
  label: bigint,
): Promise<readonly StoredTokenUsageUnit[]> {
  return decodeTokenUsageFacts(
    await readNeutralRowFact(
      snapshot.facts,
      neutralRowFactKey(registrationIdentity, label),
    ),
  );
}

export interface TokenUsageRowFact {
  readonly sequence: bigint;
  readonly measurement: RequestRowMeasurement;
  fingerprint(
    budget: number,
  ): Promise<{ readonly text: string; readonly consumed: number } | null>;
}

export function tokenUsageRowFact(
  plan: JournalResponsePlan,
  sequence: bigint,
  measurement: RequestRowMeasurement,
): TokenUsageRowFact {
  return {
    sequence,
    measurement,
    async fingerprint(budget) {
      if (budget <= 0) return null;
      if (measurement.fingerprintKey !== null) {
        const text = `C#${measurement.fingerprintKey}`;
        return { text, consumed: text.length };
      }
      const serialized = serializeRequestRow(await readTokenUsagePlan(plan));
      const synthetic = plan.header.metadata?.synthetic === true ? 1 : 0;
      return {
        text: `C:${plan.header.speaker}:${synthetic}:${serialized.slice(0, budget)}`,
        consumed: serialized.length,
      };
    },
  };
}
