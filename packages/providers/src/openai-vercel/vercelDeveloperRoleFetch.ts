/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Type guard: parsed JSON body has a `messages` array.
 */
function isMessagesBody(parsedBody: unknown): boolean {
  if (parsedBody === null || parsedBody === undefined) {
    return false;
  }
  if (typeof parsedBody !== 'object') {
    return false;
  }
  if (!('messages' in parsedBody)) {
    return false;
  }
  return Array.isArray((parsedBody as { messages?: unknown }).messages);
}

function isDeveloperRoleMessage(
  message: unknown,
): message is Record<string, unknown> & { role: string } {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { role?: unknown }).role === 'developer'
  );
}

/**
 * Some OpenAI-compatible providers reject the OpenAI "developer" role. The Vercel
 * OpenAI provider maps system prompts to "developer" for non-gpt-* model IDs, so
 * we rewrite it back to "system" for compatibility.
 */
export function createDeveloperRoleToSystemFetch(
  innerFetch: typeof fetch,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!init || typeof init.body !== 'string') {
      return innerFetch(input, init);
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(init.body) as unknown;
    } catch {
      return innerFetch(input, init);
    }

    if (!isMessagesBody(parsedBody)) {
      return innerFetch(input, init);
    }

    const developerMessages = (
      parsedBody as { messages: unknown[] }
    ).messages.filter(isDeveloperRoleMessage);
    if (developerMessages.length === 0) {
      return innerFetch(input, init);
    }

    const rewrittenMessages = (
      parsedBody as { messages: unknown[] }
    ).messages.map((message: unknown) =>
      isDeveloperRoleMessage(message)
        ? { ...message, role: 'system' }
        : message,
    );

    const headers = new Headers(init.headers);
    headers.delete('content-length');

    return innerFetch(input, {
      ...init,
      headers,
      body: JSON.stringify({
        ...(parsedBody as Record<string, unknown>),
        messages: rewrittenMessages,
      }),
    });
  };
}
