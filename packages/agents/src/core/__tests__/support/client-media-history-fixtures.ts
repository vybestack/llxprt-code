/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { errorMessage } from '@vybestack/llxprt-code-test-utils';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { AgentClient } from '../../client.js';
import { createSessionPolicyFixture } from '../session-policy-fixture.js';
import { fixturePaths } from '../client-test-helpers.js';
import { collectHistoryFixture } from './collect-history-test-fixture.js';

export const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
export const SECOND_IMAGE_BASE64 = 'AQIDBAUGBwg=';

export function inlineMediaHistory(data: string = PNG_BASE64): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data,
        },
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'url',
          data: 'https://example.test/image.png',
        },
      ],
    },
  ];
}

export class FailOnceReleaseStore extends LocalMediaStore {
  releaseFailurePending = true;

  override async release(contentId: string, ownerId: string): Promise<void> {
    if (this.releaseFailurePending) {
      this.releaseFailurePending = false;
      throw new Error('induced history release failure');
    }
    await super.release(contentId, ownerId);
  }
}

export function leafErrorMessages(error: unknown): readonly string[] {
  return error instanceof AggregateError
    ? error.errors.flatMap(leafErrorMessages)
    : [errorMessage(error)];
}

export async function deferredRowsOf(target: AgentClient): Promise<IContent[]> {
  const journal = target['_storedHistoryService'];
  if (journal === undefined) throw new Error('Missing deferred journal');
  return collectHistoryFixture(journal.streamRawHistory());
}

/** Builds a sibling client over `store` whose settings and invocation ports come from a fresh policy fixture. */
export function createSuppliedStoreClient(
  base: AgentClient,
  store: LocalMediaStore,
): {
  readonly client: AgentClient;
  readonly policy: ReturnType<typeof createSessionPolicyFixture>;
} {
  const config = base['config'];
  const client = new AgentClient(
    config,
    base['runtimeState'],
    () => undefined,
    store,
    fixturePaths(),
  );
  const policy = createSessionPolicyFixture();
  policy.owner.bindTelemetry(config);
  client.bindRuntimeSettings(
    policy.readRuntimeSettings,
    policy.readToolGovernance,
  );
  client.bindProviderInvocation(policy.prepareProviderInvocation);
  return { client, policy };
}
