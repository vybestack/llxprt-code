/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { vi } from 'bun:test';
import * as fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';

interface NativeAcpResources {
  readonly handles: FileHandle[];
  readonly retiredMedia: SessionMediaOwner[];
  readonly disposals: Map<JournalRecordingService, number>;
  restore(): void;
}

export function observeNativeAcpResources(
  afterRecorder: (
    recorder: JournalRecordingService,
  ) => Promise<void> = async () => {},
): NativeAcpResources {
  const handles: FileHandle[] = [];
  const retiredMedia: SessionMediaOwner[] = [];
  const disposals = new Map<JournalRecordingService, number>();
  const open = fs.open;
  const disposeRecorder = JournalRecordingService.prototype.dispose;
  const disposeMedia = SessionMediaOwner.prototype.dispose;
  const files = vi
    .spyOn(fs, 'open')
    .mockImplementation(async (...args): Promise<FileHandle> => {
      const handle = await open(...args);
      if (String(args[0]).endsWith('.llxj')) handles.push(handle);
      return handle;
    });
  const recorders = vi
    .spyOn(JournalRecordingService.prototype, 'dispose')
    .mockImplementation(async function (
      this: JournalRecordingService,
    ): Promise<void> {
      disposals.set(this, (disposals.get(this) ?? 0) + 1);
      await disposeRecorder.call(this);
      await afterRecorder(this);
    });
  const media = vi
    .spyOn(SessionMediaOwner.prototype, 'dispose')
    .mockImplementation(async function (
      this: SessionMediaOwner,
    ): Promise<void> {
      retiredMedia.push(this);
      await disposeMedia.call(this);
    });
  return {
    handles,
    retiredMedia,
    disposals,
    restore(): void {
      media.mockRestore();
      recorders.mockRestore();
      files.mockRestore();
    },
  };
}
