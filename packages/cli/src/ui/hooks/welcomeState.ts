/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WelcomeState } from './useWelcomeOnboarding.js';

export const INITIAL_WELCOME_STATE: WelcomeState = {
  step: 'welcome',
  authInProgress: false,
  modelsLoadStatus: 'idle',
};
