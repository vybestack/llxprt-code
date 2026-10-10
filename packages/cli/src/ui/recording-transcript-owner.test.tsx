/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Text } from 'ink';
import { render } from '../__tests__/render.js';
import { Colors } from './colors.js';
import { withRecordingLifetimeFixture } from '../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { resumeOwnerSession } from './utils/resumeOwnerSession.js';
import { getInteractiveTranscriptPath } from './AppContainerRuntime.js';
import type { Agent } from '@vybestack/llxprt-code-agents';

function Transcript({ agent }: { agent: Agent }) {
  return (
    <Text color={Colors.Foreground}>
      {getInteractiveTranscriptPath('agent', agent) ?? 'disabled'}
    </Text>
  );
}

describe('interactive owner transcript', () => {
  it('follows the actual Agent recording through resume and fork without raw swaps', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'start' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const original = agent.session.getRecording().path;
      if (!original) throw new Error('Expected original owner transcript');
      const first = render(<Transcript agent={agent} />);
      expect(
        first.lastFrame()?.split(String.fromCharCode(10)).join(''),
      ).toContain(original);
      first.unmount();

      const checkpoint = await agent.session.createCheckpoint('owner-fork');
      await resumeOwnerSession(agent, checkpoint.checkpointId, 'allowed');
      const forkPath = agent.session.getRecording().path;
      if (!forkPath) throw new Error('Expected fork transcript');
      expect(forkPath).not.toBe(original);
      const fork = render(<Transcript agent={agent} />);
      expect(
        fork.lastFrame()?.split(String.fromCharCode(10)).join(''),
      ).toContain(forkPath);
      fork.unmount();

      await agent.session.setRecording({ enabled: false });
      const next = await borrow();
      const target = (await agent.session.listBrowserTargets()).find(
        (entry) =>
          entry.kind === 'session' && entry.session.filePath === forkPath,
      );
      if (target?.kind !== 'session') throw new Error('Expected fork session');
      await resumeOwnerSession(next, target.session.sessionId, 'allowed');
      const resumed = render(<Transcript agent={next} />);
      expect(
        resumed.lastFrame()?.split(String.fromCharCode(10)).join(''),
      ).toContain(next.session.getRecording().path);
      resumed.unmount();
      await next.session.setRecording({ enabled: false });
      expect(
        (await readdir(dirname(forkPath))).filter((file) =>
          file.endsWith('.lock'),
        ),
      ).toHaveLength(0);
    });
  }, 30000);
});
