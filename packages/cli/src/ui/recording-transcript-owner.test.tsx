import { openRouteAAgent } from '../../../agents/src/api/__tests__/helpers/route-a-agent.js';
import { useFakeResponsesReplay } from '../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import { runCleanupSteps } from '../../../agents/src/core/subagent-cleanup.js';
import { describe, expect, it } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Text } from 'ink';
import { render } from '../__tests__/render.js';
import { Colors } from './colors.js';
import { resumeOwnerSession } from './utils/resumeOwnerSession.js';
import { getInteractiveTranscriptPath } from './transcriptPath.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function Transcript({
  readRecordingPath,
}: {
  readRecordingPath: () => string | undefined;
}) {
  return (
    <Text color={Colors.Foreground}>
      {getInteractiveTranscriptPath(
        'agent',
        readRecordingPath,
        () => undefined,
      ) ?? 'disabled'}
    </Text>
  );
}

describe('interactive owner transcript', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');
  it('follows the actual Agent recording through resume and fork without raw swaps', async () => {
    const route = await openRouteAAgent({ config: { interactive: true } });
    const closers = [route.close];
    try {
      const { agent } = route;
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'start' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const original = agent.session.getRecording().path;
      if (!original) throw new Error('Expected original owner transcript');
      const first = render(
        <Transcript
          readRecordingPath={() => agent.session.getRecording().path}
        />,
      );
      expect(
        first.lastFrame()?.split(String.fromCharCode(10)).join(''),
      ).toContain(original);
      first.unmount();

      const checkpoint = await agent.session.createCheckpoint('owner-fork');
      await resumeOwnerSession(
        agent.session.resume.bind(agent.session),
        checkpoint.checkpointId,
        'allowed',
        agent.session.listBrowserTargetsDetailed.bind(agent.session),
      );
      const forkPath = agent.session.getRecording().path;
      if (!forkPath) throw new Error('Expected fork transcript');
      expect(forkPath).not.toBe(original);
      const fork = render(
        <Transcript
          readRecordingPath={() => agent.session.getRecording().path}
        />,
      );
      expect(
        fork.lastFrame()?.split(String.fromCharCode(10)).join(''),
      ).toContain(forkPath);
      fork.unmount();

      await agent.session.setRecording({ enabled: false });
      const nextRoute = await openRouteAAgent({
        config: { interactive: true, workingDir: route.directory },
      });
      closers.push(nextRoute.close);
      const next = nextRoute.agent;
      const target = (await agent.session.listBrowserTargets()).find(
        (entry) =>
          entry.kind === 'session' && entry.session.filePath === forkPath,
      );
      if (target?.kind !== 'session') throw new Error('Expected fork session');
      await resumeOwnerSession(
        next.session.resume.bind(next.session),
        target.session.sessionId,
        'allowed',
        next.session.listBrowserTargetsDetailed.bind(next.session),
      );
      const resumed = render(
        <Transcript
          readRecordingPath={() => next.session.getRecording().path}
        />,
      );
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
    } finally {
      await runCleanupSteps(closers.reverse());
    }
  }, 30000);
});
