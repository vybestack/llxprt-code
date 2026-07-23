/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Compile-time type contract for the todo tools' mandatory dependency.
 *
 * The production tool registry always injects an ITodoService; the type
 * boundary must therefore make that dependency required so a mis-wired
 * construction fails at compile time rather than throwing at runtime.
 *
 * These assertions use expectTypeOf (run via vitest typecheck, see
 * vitest.config.ts typecheck.include) to prove the constructor's first
 * parameter is the required ITodoService (not optional) for every todo tool.
 *
 * They are complemented by runtime behavioral round-trip tests in
 * todo-tools.test.ts (injected ITodoService executes a write -> read cycle).
 */

import { expectTypeOf } from 'vitest';
import type { TodoRead } from '../tools/todo-read.js';
import type { TodoWrite } from '../tools/todo-write.js';
import type { TodoPause } from '../tools/todo-pause.js';
import type { ITodoService } from '../interfaces/ITodoService.js';
import type { IToolHost } from '../interfaces/IToolHost.js';

// The constructor's first parameter is the required ITodoService (not
// optional). ConstructorParameters[0] being exactly ITodoService (never
// `ITodoService | undefined`) proves the `?` was removed and that a
// zero-argument call would be a type error.
expectTypeOf<
  ConstructorParameters<typeof TodoRead>[0]
>().toEqualTypeOf<ITodoService>();
expectTypeOf<
  ConstructorParameters<typeof TodoWrite>[0]
>().toEqualTypeOf<ITodoService>();
expectTypeOf<
  ConstructorParameters<typeof TodoPause>[0]
>().toEqualTypeOf<ITodoService>();

// toolHost remains genuinely optional on TodoWrite and TodoPause (used only
// for emoji filtering); confirm it stays optional while the first parameter
// is mandatory.
expectTypeOf<ConstructorParameters<typeof TodoWrite>[1]>().toEqualTypeOf<
  IToolHost | undefined
>();
expectTypeOf<ConstructorParameters<typeof TodoPause>[1]>().toEqualTypeOf<
  IToolHost | undefined
>();
