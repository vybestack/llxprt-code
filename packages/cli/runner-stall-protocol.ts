/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Names shared by the runner (runner-stall-inspector.ts) and the test process
 * (test-utils/stall-report.ts) for the files they exchange. Kept apart from
 * both so the runner, which is copied together with its sibling runner-*.ts
 * modules, does not depend on anything under test-utils.
 */

/** Directory the runner and the test process exchange files through. */
export const STALL_DIR_ENV = 'LLXPRT_CLI_TEST_STALL_DIR';
/** File whose appearance asks the process to write its report. */
export const STALL_REQUEST_FILE = 'request';
/** File the report is written to. */
export const STALL_REPORT_FILE = 'report.txt';
/**
 * Append-only record of the lifecycle points the process reached. It is
 * written synchronously, so it survives a process whose event loop is no
 * longer running and so cannot answer a report request.
 */
export const STALL_STAGES_FILE = 'stages.log';
