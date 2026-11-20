/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createContext } from 'react';
import type { StartupStdinBuffer } from '../../utils/startup-stdin.js';

export const StartupStdinContext = createContext<
  StartupStdinBuffer | undefined
>(undefined);
