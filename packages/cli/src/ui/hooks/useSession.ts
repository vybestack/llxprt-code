/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useContext } from 'react';
import {
  SessionContext,
  type SessionContextType,
} from '../containers/SessionController.js';

/**
 * Convenience hook for consuming SessionContext
 * @throws {Error} If used outside of SessionController provider
 */
export const useSession = (): SessionContextType => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within SessionController');
  }
  return context;
};
