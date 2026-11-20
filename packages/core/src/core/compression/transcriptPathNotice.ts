/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  COMPRESSION_PROMPT_FILES,
  fillCompressionPromptFile,
  type CompressionPromptSource,
} from './compressionPromptFiles.js';

/**
 * Builds the notice appended to a compression request when a session recording
 * has materialized a file on disk. Shared by both LLM compression strategies
 * (OneShotStrategy and MiddleOutStrategy) so the two cannot drift. The text
 * lives in `compression/transcript-path.md`, which users can override.
 *
 * The wording deliberately avoids calling the file a "full transcript":
 * recording is optional, can be enabled part way through a session (seeding
 * only the history present at that moment), and deactivates on a write
 * failure. It also steers the reader toward searching the file for a specific
 * string, because the journal contains full tool results and reading it whole
 * would burn more context than the compression saved.
 *
 * The notice is part of the compression request, so it asks the summarizing
 * model to carry the path into the summary — that is what makes the pointer
 * outlive the compression that drops the detail.
 */
export function buildTranscriptPathNotice(
  source: CompressionPromptSource,
  transcriptPath: string,
): string {
  return fillCompressionPromptFile(
    source,
    COMPRESSION_PROMPT_FILES.transcriptPath,
    'TRANSCRIPT_PATH',
    transcriptPath,
  );
}
