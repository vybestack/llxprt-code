/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeToStdout } from '@vybestack/llxprt-code-core';

const ENABLE_BRACKETED_PASTE = '\x1b[?2004h';
const DISABLE_BRACKETED_PASTE = '\x1b[?2004l';

export const enableBracketedPaste = () => {
  writeToStdout(ENABLE_BRACKETED_PASTE);
};

export const disableBracketedPaste = () => {
  writeToStdout(DISABLE_BRACKETED_PASTE);
};
