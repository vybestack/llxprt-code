/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ResumeCursorBoot } from '../../resumeCursorBoot.js';
import { SessionRecordingService } from '../../SessionRecordingService.js';
import type { ForkError, ForkResult } from '../../SessionTransitionService.js';

/** A fork of the old layout: the JSONL recorder and the cursor boot that names the child's file. */
export interface JsonlFork extends ForkResult {
  readonly recording: SessionRecordingService;
  readonly boot: ResumeCursorBoot;
}

/** Narrows a fork result to the old layout; a test that pins the old backend gets nothing else. */
export function requireJsonlFork(result: ForkResult | ForkError): JsonlFork {
  if (!result.ok) throw new Error(`fork failed: ${result.error}`);
  const { recording, boot } = result;
  if (
    !(recording instanceof SessionRecordingService) ||
    !(boot instanceof ResumeCursorBoot)
  )
    throw new Error('The fork is not of the old layout');
  return { ...result, recording, boot };
}
