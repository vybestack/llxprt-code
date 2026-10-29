/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun's test runner ends the process without emitting `process.on('exit')`,
 * so the scratch root's exit hook never runs. Remove it after each file.
 */
import { afterAll } from 'bun:test';
import { removeScratchRoot } from '../../packages/core/src/storage/scratch-root.ts';

afterAll(() => removeScratchRoot());
