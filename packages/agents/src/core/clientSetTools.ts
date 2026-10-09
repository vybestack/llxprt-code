/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { buildToolDeclarationsFromView } from './clientToolGovernance.js';
import type { ChatSession } from './chatSession.js';
import type { TodoContinuationService } from './TodoContinuationService.js';

export async function setClientTools(
  toolRegistry: ReturnType<Config['getToolRegistry']> | null | undefined,
  chat: ChatSession | undefined,
  initialize: () => Promise<ChatSession>,
  todos: TodoContinuationService,
): Promise<void> {
  if (toolRegistry == null) return;
  const toolsView =
    typeof chat?.getToolsView === 'function' ? chat.getToolsView() : undefined;
  const toolDeclarations: ToolDeclaration[] = toolsView
    ? buildToolDeclarationsFromView(toolRegistry, toolsView)
    : toolRegistry
        .getFunctionDeclarations()
        .filter((d) => typeof d.name === 'string' && d.name.length > 0)
        .map(
          (d): ToolDeclaration => ({
            name: d.name!,
            parametersJsonSchema: (d.parametersJsonSchema ??
              d.parameters ??
              {}) as Record<string, unknown>,
            ...(typeof d.description === 'string'
              ? { description: d.description }
              : {}),
          }),
        );
  todos.updateTodoToolAvailabilityFromDeclarations(toolDeclarations);
  const logger = new DebugLogger('llxprt:client:setTools');
  logger.debug(
    () => `setTools called, declarations count: ${toolDeclarations.length}`,
  );
  if (toolDeclarations.length === 0)
    logger.warn(
      () => 'WARNING: setTools called but toolDeclarations is empty!',
      { stackTrace: new Error().stack },
    );
  (chat ?? (await initialize())).setTools(toolDeclarations);
}
