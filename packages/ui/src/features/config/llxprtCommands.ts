import type { SessionConfig } from './llxprtAdapter';
import { listModels, type ModelInfo } from './llxprtAdapter';
import { validateSessionConfig } from './llxprtConfig';

export interface CommandOutcome {
  readonly handled: boolean;
  readonly messages: string[];
}

export async function handleModelListCommand(
  session: SessionConfig,
  deps?: { listModelsImpl?: (session: SessionConfig) => Promise<ModelInfo[]> },
): Promise<CommandOutcome> {
  const missing = validateSessionConfig(session, { requireModel: false });
  if (missing.length > 0) {
    return { handled: true, messages: missing };
  }
  const getModels = deps?.listModelsImpl ?? listModels;
  try {
    const models = await getModels(session);
    if (models.length === 0) {
      return { handled: true, messages: ['No models returned by provider.'] };
    }
    const lines = ['Available models:'].concat(
      models.map((model) => {
        const namePart = model.name ? ` (${model.name})` : '';
        return `- ${model.id}${namePart}`;
      }),
    );
    return { handled: true, messages: lines };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { handled: true, messages: [`Failed to list models: ${message}`] };
  }
}
