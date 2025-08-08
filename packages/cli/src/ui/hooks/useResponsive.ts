/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useTerminalSize } from './useTerminalSize.js';
import {
  getBreakpoint,
  isNarrowWidth,
  type Breakpoint,
} from '../utils/responsive.js';

export interface UseResponsiveReturn {
  width: number;
  breakpoint: Breakpoint;
  isNarrow: boolean;
  isStandard: boolean;
  isWide: boolean;
}

export function useResponsive(): UseResponsiveReturn {
  const { columns } = useTerminalSize();
  const breakpoint = getBreakpoint(columns);

  return {
    width: columns,
    breakpoint,
    isNarrow: isNarrowWidth(columns),
    isStandard: breakpoint === 'STANDARD',
    isWide: breakpoint === 'WIDE',
  };
}
