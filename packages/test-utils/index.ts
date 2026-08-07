/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Package entry point.
 *
 * This file and `src/index.ts` are both resolved as the package root — Bun and
 * Node follow the `main` field to `src/index.ts`, while several workspaces map
 * the package name here through tsconfig `paths`. Re-exporting the real barrel
 * keeps the two entry points from drifting apart and exposing different names.
 */

export * from './src/index.js';
