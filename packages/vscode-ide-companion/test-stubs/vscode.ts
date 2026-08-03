/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test-only stand-in for the `vscode` module.
 *
 * The real module is injected by the VS Code host at runtime and is not
 * installable, so under Bun's native test runner the specifier cannot be
 * resolved at all — every test file in this package fails to load before a
 * single mock is applied. `tsconfig.bun-test.json` maps `vscode` here so
 * resolution succeeds; `vi.mock('vscode', …)` in each test then supplies the
 * behaviour.
 *
 * Every runtime export the package touches must be declared here: Bun's
 * `mock.module` replaces the values of a module's existing exports, so a name
 * that is absent from this stub stays absent from the mocked namespace.
 * Types are deliberately not modelled — production type-checking uses
 * `@types/vscode` through the package's real tsconfig.
 */

export const commands: unknown = undefined;
export const window: unknown = undefined;
export const workspace: unknown = undefined;
export const env: unknown = undefined;
export const extensions: unknown = undefined;

export const Disposable: unknown = undefined;
export const EventEmitter: unknown = undefined;
export const ExtensionMode: unknown = undefined;
export const Position: unknown = undefined;
export const Range: unknown = undefined;
export const Selection: unknown = undefined;
export const TextEditorSelectionChangeKind: unknown = undefined;
export const Uri: unknown = undefined;
export const ViewColumn: unknown = undefined;
