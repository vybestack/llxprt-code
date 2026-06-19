/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type IModel } from '../IModel.js';
import type { GeminiAuthMode } from './geminiServerTools.js';

/** Default model list used for OAuth mode and as fallback. */
export function getDefaultModelList(providerName: string): IModel[] {
  return [
    {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      provider: providerName,
      supportedToolFormats: [],
    },
    {
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      provider: providerName,
      supportedToolFormats: [],
    },
    {
      id: 'gemini-2.5-flash-lite',
      name: 'Gemini 2.5 Flash Lite',
      provider: providerName,
      supportedToolFormats: [],
    },
    {
      id: 'gemini-3-pro-preview',
      name: 'Gemini 3 Pro Preview',
      provider: providerName,
      supportedToolFormats: [],
    },
    {
      id: 'gemini-3-flash-preview',
      name: 'Gemini 3 Flash Preview',
      provider: providerName,
      supportedToolFormats: [],
    },
  ];
}

/**
 * Fetches models from the Gemini API using the current auth token.
 * Returns undefined if the fetch fails or no API key is available.
 */
export async function fetchModelsFromApi(
  providerName: string,
  getAuthToken: () => Promise<string>,
  getBaseURL: () => string | undefined,
): Promise<IModel[] | undefined> {
  const apiKey = (await getAuthToken()) || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return undefined;
  }

  try {
    const baseURL = getBaseURL();
    const url = baseURL
      ? `${baseURL.replace(/\/$/, '')}/v1beta/models?key=${apiKey}`
      : `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (response.ok) {
      const data = (await response.json()) as {
        models?: Array<{ name: string; displayName?: string }>;
      };
      if (data.models && data.models.length > 0) {
        return data.models.map((model) => ({
          id: model.name.replace('models/', ''),
          name: model.displayName ?? model.name,
          provider: providerName,
          supportedToolFormats: [],
        }));
      }
    }
  } catch {
    // API request failed; fall through to default models.
  }
  return undefined;
}

/**
 * Resolve the model list for the given auth mode, fetching from the API for
 * API key/Vertex AI modes and falling back to the default list.
 */
export async function resolveModelList(
  providerName: string,
  authMode: GeminiAuthMode,
  getAuthToken: () => Promise<string>,
  getBaseURL: () => string | undefined,
): Promise<IModel[]> {
  const defaultModels = getDefaultModelList(providerName);
  if (authMode === 'oauth') {
    return defaultModels;
  }
  if (authMode === 'gemini-api-key' || authMode === 'vertex-ai') {
    const fetched = await fetchModelsFromApi(
      providerName,
      getAuthToken,
      getBaseURL,
    );
    if (fetched !== undefined) {
      return fetched;
    }
  }
  return defaultModels;
}
