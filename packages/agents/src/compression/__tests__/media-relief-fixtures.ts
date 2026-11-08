/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 review round 3: the shared conversation for tests that hold a
 * request to a tight context window after history media relief. A provider
 * media allowance of 1,000,000 bytes rejects three 400,000 character images
 * while the enforcer's own retirement budget stays idle, so the provider is
 * what raises the byte overflow and the enforcer's relief is what answers it.
 */

import { afterEach, beforeEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  RetirementSession,
  aiTurn,
  imageTurn,
  type AdmittedImage,
} from './image-retirement-harness.js';

export const PROVIDER_MEDIA_BUDGET = 1_000_000;
/** Retirement budget far above the provider's: only the provider rejects. */
export const IDLE_RETIREMENT = 1_000_000_000;
/** Normalized base64 length of every image in the shared conversation. */
const IMAGE_BASE64 = 400_000;
const IMAGE_BYTES = (IMAGE_BASE64 / 4) * 3;
/** About 21,000 estimated tokens of text, over this window by itself. */
export const TIGHT_CONTEXT = 20_000;
const BIG_TEXT = 'word '.repeat(20_000);

export function textTurn(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

/** An AI entry that a Responses backend stored and could chain from. */
export function storedAiTurn(text: string, id: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { id, responsesStored: true },
  };
}

export interface ReliefConversation {
  readonly session: () => RetirementSession;
  /** Image turns separated by answers; returns the admitted images. */
  readonly seedImages: (count: number) => Promise<AdmittedImage[]>;
  /** One long text turn that alone exceeds {@link TIGHT_CONTEXT}. */
  readonly seedBigText: () => void;
}

/**
 * Registers the lifecycle hooks of one relief session holding the shared
 * 20,000 token window and returns lazy accessors for it.
 */
export function useReliefConversation(prefix: string): ReliefConversation {
  let directory = '';
  let current: RetirementSession | undefined;
  let nextFill = 1;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), prefix));
    current = new RetirementSession(
      directory,
      PROVIDER_MEDIA_BUDGET,
      512 * 1024 * 1024,
      IDLE_RETIREMENT,
    );
    current.contextLimit = TIGHT_CONTEXT;
    nextFill = 1;
  });
  afterEach(async () => {
    current?.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  const session = (): RetirementSession => {
    if (current === undefined) throw new Error('session not started');
    return current;
  };

  return {
    session,
    seedImages: async (count) => {
      const images: AdmittedImage[] = [];
      for (let index = 0; index < count; index += 1) {
        const image = await session().admit(IMAGE_BYTES, nextFill);
        nextFill += 1;
        images.push(image);
        session().history.add(imageTurn(image.reference, `hist-${index}`));
        session().history.add(aiTurn(`seen ${index}`));
      }
      return images;
    },
    seedBigText: () => {
      session().history.add(textTurn(BIG_TEXT));
      session().history.add(aiTurn('noted the long text'));
    },
  };
}
