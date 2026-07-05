/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AppContainer — thin orchestration shell.
 *
 * All hook extraction, state management, and rendering logic now lives in:
 *   - containers/AppContainer/hooks/useAppBootstrap.ts   (history, session, IO)
 *   - containers/AppContainer/hooks/useAppDialogs.ts     (dialogs, auth, profiles)
 *   - containers/AppContainer/hooks/useAppInput.ts       (input, gemini stream)
 *   - containers/AppContainer/hooks/useAppLayout.ts      (layout, measurements)
 *   - containers/AppContainer/builders/useUIStateBuilder.ts
 *   - containers/AppContainer/builders/useUIActionsBuilder.ts
 *
 * This file is kept for backwards-compatibility — it re-exports the component
 * under the original `AppContainer` name used by App.tsx and the public API.
 */

import {
  AppContainerRuntime,
  type AppContainerRuntimeProps,
} from './AppContainerRuntime.js';

export type AppContainerProps = AppContainerRuntimeProps;

export const AppContainer = (props: AppContainerProps) => (
  <AppContainerRuntime {...props} />
);
