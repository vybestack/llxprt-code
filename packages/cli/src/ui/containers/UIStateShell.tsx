/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { LayoutManager } from '../components/LayoutManager.js';

interface UIStateShellProps {
  children: React.ReactNode;
}

export const UIStateShell: React.FC<UIStateShellProps> = ({ children }) => (
  <LayoutManager>{children}</LayoutManager>
);
