/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { WIRE_ROUTES, type WireRoute } from './wireBodyCapture.js';

/** Use the million-token model without changing unrelated wire fixtures. */
export function sendPeakRoute(routeId: string): WireRoute {
  const route = WIRE_ROUTES.find((candidate) => candidate.id === routeId);
  if (route === undefined)
    throw new Error(`Unknown send peak route ${routeId}`);
  const openaiModel = route.id === 'openai-chat-plain' ? 'gpt-4.1' : 'gpt-5.6';
  return {
    ...route,
    model: route.providerName === 'anthropic' ? route.model : openaiModel,
    ephemerals: {
      ...route.ephemerals,
      'context-limit': 1_000_000,
      maxOutputTokens: 1024,
    },
    providerSettings: {
      ...route.providerSettings,
      ...(route.id === 'openai-chat-plain' ? { apiMode: 'chat' } : {}),
    },
  };
}
