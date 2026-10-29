/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { Text } from 'ink';
import { Colors } from '../colors.js';
import type { ReactElement } from 'react';
import { ApprovalMode, coreEvents } from '@vybestack/llxprt-code-core';
import { act } from 'react';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { renderWithProviders, waitFor } from '../../__tests__/render.js';
import { useAutoAcceptIndicator } from './useAutoAcceptIndicator.js';

function Indicator(
  props: Parameters<typeof useAutoAcceptIndicator>[0],
): ReactElement {
  const mode = useAutoAcceptIndicator(props);
  return <Text color={Colors.Foreground}>{mode}</Text>;
}

describe('approval input owner', () => {
  const makeOwner = useCommandOwners();

  it('changes only its bound owner and leaves a sibling usable after retirement', async () => {
    const owner = await makeOwner('owner');
    const sibling = await makeOwner('sibling');
    const readApprovalMode = () => owner.getApprovalMode();
    const setApprovalMode = (mode: ApprovalMode) => owner.setApprovalMode(mode);
    const first = renderWithProviders(
      <Indicator
        {...Object.assign(
          { agent: sibling },
          { readApprovalMode, setApprovalMode },
        )}
      />,
    );
    try {
      first.stdin.write('\u0019');
      await waitFor(() =>
        expect(owner.getApprovalMode()).toBe(ApprovalMode.YOLO),
      );
      expect(sibling.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
      act(() => {
        coreEvents.emitFolderTrustChanged(false);
      });
      expect(first.lastFrame()).toContain(ApprovalMode.DEFAULT);
      act(() => {
        coreEvents.emitFolderTrustChanged(true);
      });
      expect(first.lastFrame()).toContain(ApprovalMode.YOLO);
    } finally {
      first.unmount();
    }
    await owner.dispose();
    const second = renderWithProviders(
      <Indicator
        {...Object.assign(
          { agent: owner },
          {
            readApprovalMode: () => sibling.getApprovalMode(),
            setApprovalMode: (mode: ApprovalMode) =>
              sibling.setApprovalMode(mode),
          },
        )}
      />,
    );
    try {
      second.stdin.write('\u0019');
      await waitFor(() =>
        expect(sibling.getApprovalMode()).toBe(ApprovalMode.YOLO),
      );
    } finally {
      second.unmount();
    }
  });
});
