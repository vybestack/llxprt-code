/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SetActiveModelOperation } from '../ui/contexts/RuntimeContext.js';

interface SessionModelCommands {
  getModel(): string;
  getProvider(): string;
  setModel(model: string): Promise<void>;
}

export function createSessionModelCommand(
  session: SessionModelCommands,
): SetActiveModelOperation {
  return async (model) => {
    const previousModel = session.getModel();
    await session.setModel(model);
    return {
      previousModel,
      nextModel: session.getModel(),
      providerName: session.getProvider(),
      authRefreshed: true,
    };
  };
}
