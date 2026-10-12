/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { buildToolDeclarationsFromView } from './clientToolGovernance.js';
import type { ChatSession } from './chatSession.js';
import type { TodoContinuationService } from './TodoContinuationService.js';

export async function setClientTools(
  toolRegistry: ToolSelection | undefined,
  publicationDeclarations: readonly ToolDeclaration[] | undefined,
  chat: ChatSession | undefined,
  initialize: () => Promise<ChatSession>,
  todos: TodoContinuationService,
): Promise<void> {
  if (toolRegistry === undefined && publicationDeclarations === undefined)
    return;
  const toolsView =
    typeof chat?.getToolsView === 'function' ? chat.getToolsView() : undefined;
  const toolDeclarations: ToolDeclaration[] =
    publicationDeclarations !== undefined
      ? [...publicationDeclarations]
      : buildToolDeclarationsFromView(toolRegistry, toolsView);
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
