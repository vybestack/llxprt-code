/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builds the notice appended to a compression request when a session recording
 * has materialized a file on disk. Shared by both LLM compression strategies
 * (OneShotStrategy and MiddleOutStrategy) so the two cannot drift.
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
export function buildTranscriptPathNotice(transcriptPath: string): string {
  return (
    `Note: a JSONL journal of this session is being recorded at: ${transcriptPath}\n` +
    `The journal may be incomplete — recording can begin part way through a session and can stop on a write error. ` +
    `Preserve this path verbatim in your summary, and record that detail dropped by compression may be recoverable by ` +
    `searching that file for the specific text needed. The file holds full tool results and can be very large, so it ` +
    `should be searched, not read whole.`
  );
}
