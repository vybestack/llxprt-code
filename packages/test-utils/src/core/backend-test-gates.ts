/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { selectBackend } from '@vybestack/llxprt-code-core/services/history/historyBackendSelect.js';

/**
 * True when `LLXPRT_HISTORY_BACKEND=journal` selects the journal backend.
 *
 * A case that asserts the JSONL layout of the old backend (envelope lines,
 * seq watermarks, pending overlays) is written
 * `it.skipIf(journalBackendSelected)(...)` inside an ordinary `describe`, which
 * keeps the lint rules that look for a top-level `describe` satisfied. Each
 * such test has a journal-path twin or a journal contract elsewhere. A test
 * that asserts behaviour does not belong behind this gate.
 */
export const journalBackendSelected = selectBackend() === 'journal';
