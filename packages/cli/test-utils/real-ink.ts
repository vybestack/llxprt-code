/**
 * Real Ink exports for tests that render through Ink's reconciler.
 *
 * Direct module paths bypass the Vitest `ink` stub alias without importing
 * Ink's package entry point from inside a mock of that same entry point.
 *
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export { default as Box } from '../../../node_modules/ink/build/components/Box.js';
export { default as Text } from '../../../node_modules/ink/build/components/Text.js';
export { default as Static } from '../../../node_modules/ink/build/components/Static.js';
export { default as Transform } from '../../../node_modules/ink/build/components/Transform.js';
export { default as Newline } from '../../../node_modules/ink/build/components/Newline.js';
export { default as Spacer } from '../../../node_modules/ink/build/components/Spacer.js';
export { default as useInput } from '../../../node_modules/ink/build/hooks/use-input.js';
export { default as useApp } from '../../../node_modules/ink/build/hooks/use-app.js';
export { default as useStdin } from '../../../node_modules/ink/build/hooks/use-stdin.js';
export { default as useStdout } from '../../../node_modules/ink/build/hooks/use-stdout.js';
export { default as useStderr } from '../../../node_modules/ink/build/hooks/use-stderr.js';
export { default as useFocus } from '../../../node_modules/ink/build/hooks/use-focus.js';
export { default as useFocusManager } from '../../../node_modules/ink/build/hooks/use-focus-manager.js';
export { default as useIsScreenReaderEnabled } from '../../../node_modules/ink/build/hooks/use-is-screen-reader-enabled.js';
