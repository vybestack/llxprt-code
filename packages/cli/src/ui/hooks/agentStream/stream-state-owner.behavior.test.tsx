/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { renderHook } from '../../../__tests__/render.js';
import { useCommandOwners } from '../../../__tests__/command-owner-fixture.js';
import { resolveEmojiFilterMode } from '../../utils/iContentToHistoryItems.js';
import { useStreamState } from './useStreamState.js';

function filterForOwner(owner: Agent, decoy: Agent): boolean {
  const readMode = Object.assign(() => resolveEmojiFilterMode(owner), {
    ephemeral: decoy,
    projectTempDir: owner.workspace.getWorkingDirectory(),
    checkpoint: { getCheckpointingEnabled: () => false },
  });
  const addItem = (): number => 0;
  const hook = renderHook(() =>
    useStreamState(
      addItem,
      readMode,
      owner.workspace.getWorkingDirectory(),
      undefined,
    ),
  );
  try {
    return hook.result.current.sanitizeContent('Hello 😀').blocked;
  } finally {
    hook.unmount();
  }
}

describe('stream state policy owner', () => {
  const makeOwner = useCommandOwners();
  it('filters using the captured live policy rather than a conflicting runtime', async () => {
    const owner = await makeOwner('state-owner');
    const sibling = await makeOwner('state-sibling');
    owner.setEphemeralSetting('emojifilter', 'error');
    sibling.setEphemeralSetting('emojifilter', 'allowed');
    expect(filterForOwner(owner, sibling)).toBe(true);
    owner.setEphemeralSetting('emojifilter', 'allowed');
    expect(filterForOwner(owner, sibling)).toBe(false);
    await owner.dispose();
    expect(filterForOwner(sibling, owner)).toBe(false);
  });
});
