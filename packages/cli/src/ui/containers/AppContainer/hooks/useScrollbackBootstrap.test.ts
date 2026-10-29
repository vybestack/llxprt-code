/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  JournalSession,
  NativeJournalPageReader,
} from '@vybestack/llxprt-code-core';
import { JournalDisplayWriter } from '@vybestack/llxprt-code-core/journal/display-recording.js';
import { ToolCallStatus } from '../../../types.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { renderHook, waitFor } from '../../../../__tests__/render.js';
import { LoadedSettings } from '../../../../config/settings.js';
import {
  useScrollbackBootstrap,
  scrollbackPagerSettingsFrom,
  type JournalPathSource,
} from './useScrollbackBootstrap.js';

function settings(ui: Record<string, unknown> = {}): LoadedSettings {
  return new LoadedSettings(
    { settings: {}, path: '' },
    { settings: {}, path: '' },
    { settings: {}, path: '' },
    { settings: { ui }, path: '' },
    true,
  );
}

async function journal(path: string, text: string): Promise<void> {
  const session = await JournalSession.create(path);
  try {
    await session.append([
      { speaker: 'human', blocks: [{ type: 'text', text }] },
    ]);
  } finally {
    await session.close();
  }
}

function source(readPath: () => string | null): JournalPathSource {
  return {
    getCurrentRecording: () => {
      const path = readPath();
      return path === null ? null : { getFilePath: () => path };
    },
  };
}

describe('journal transcript bootstrap', () => {
  const directory = useTempDir('journal-bootstrap-');

  it('opens the journal with default settings without a feature flag', async () => {
    const path = join(directory(), 'default.llxj');
    await journal(path, 'persisted startup prompt');
    const loaded = settings();
    const journalSource = source(() => path);
    const mounted = renderHook(() =>
      useScrollbackBootstrap({
        settings: loaded,
        recordingSwapCallbacks: journalSource,
      }),
    );
    try {
      await waitFor(() => {
        expect(
          mounted.result.current.pager?.store
            .getState()
            .rows.map((row) => row.item.text),
        ).toStrictEqual(['persisted startup prompt']);
      });
    } finally {
      mounted.unmount();
    }
  });

  it('follows a session swap and releases the previous journal window', async () => {
    const first = join(directory(), 'first.llxj');
    const second = join(directory(), 'second.llxj');
    await journal(first, 'old session');
    await journal(second, 'resumed session');
    let path = first;
    const journalSource = source(() => path);
    const loaded = settings();
    const mounted = renderHook(() =>
      useScrollbackBootstrap({
        settings: loaded,
        recordingSwapCallbacks: journalSource,
      }),
    );
    try {
      await waitFor(() => expect(mounted.result.current.pager).not.toBeNull());
      const previous = mounted.result.current.pager;
      path = second;
      await waitFor(() => {
        expect(
          mounted.result.current.pager?.store
            .getState()
            .rows.map((row) => row.item.text),
        ).toStrictEqual(['resumed session']);
      });
      expect(previous?.store.metrics().residentRows).toBe(0);
    } finally {
      mounted.unmount();
    }
  });

  it('waits for journal materialization without creating a fallback transcript', async () => {
    const file = join(directory(), 'late.llxj');
    let path: string | null = null;
    const journalSource = source(() => path);
    const loaded = settings();
    const mounted = renderHook(() =>
      useScrollbackBootstrap({
        settings: loaded,
        recordingSwapCallbacks: journalSource,
      }),
    );
    try {
      expect(mounted.result.current.pager).toBeNull();
      await journal(file, 'first materialized row');
      path = file;
      await waitFor(() => {
        expect(
          mounted.result.current.pager?.store
            .getState()
            .rows.map((row) => row.item.text),
        ).toStrictEqual(['first materialized row']);
      });
    } finally {
      mounted.unmount();
    }
  });

  it('keeps approvals in a newly materialized live journal pending', async () => {
    const file = join(directory(), 'live-approval.llxj');
    let path: string | null = null;
    const journalSource = source(() => path);
    const loaded = settings();
    const mounted = renderHook(() =>
      useScrollbackBootstrap({
        settings: loaded,
        recordingSwapCallbacks: journalSource,
      }),
    );
    const session = await JournalSession.create(file);
    try {
      await session.append([
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'skill',
              name: 'activate_skill',
              parameters: {},
            },
          ],
        },
      ]);
      const reader = await NativeJournalPageReader.open(file);
      const transcriptId = (await reader.entryAt(0)).transcriptId.toString();
      await reader.close();
      await new JournalDisplayWriter(session.store).append(
        {
          type: 'tool-approval',
          attemptId: '',
          callId: 'skill',
          format: 'json',
        },
        JSON.stringify({
          request: { journalIdentity: { transcriptId, attemptId: '' } },
          status: 'awaiting_approval',
        }),
      );
      path = file;
      await waitFor(() => {
        const tools = mounted.result.current.pager?.store
          .getState()
          .rows.flatMap((row) =>
            row.item.type === 'tool_group' ? row.item.tools : [],
          );
        expect(tools).toHaveLength(1);
        expect(tools?.[0].status).toBe(ToolCallStatus.Pending);
      });
    } finally {
      mounted.unmount();
      await session.close();
    }
  });

  it('maps configured residency settings from KiB to bytes', () => {
    expect(
      scrollbackPagerSettingsFrom(
        settings({
          scrollbackMarginViewports: 3,
          scrollbackByteFloorKiB: 64,
        }),
      ),
    ).toMatchObject({ marginViewports: 3, byteFloorBytes: 65536 });
    expect(scrollbackPagerSettingsFrom(settings())).toMatchObject({
      marginViewports: 2,
      byteFloorBytes: 262144,
    });
  });
});
