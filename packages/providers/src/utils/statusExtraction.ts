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
 * Extract an HTTP status code from an error value using a multi-step
 * resolution chain: direct `status` property → `response.status` →
 * message parsing for a `429` marker.
 *
 * Returns `undefined` when no usable status can be determined.
 */
export function extractHttpStatus(error: unknown): number | undefined {
  let status = readDirectStatus(error);

  if (isInvalidStatus(status)) {
    status = readResponseStatus(error);
  }

  if (isInvalidStatus(status) && has429InMessage(error)) {
    status = 429;
  }

  return isInvalidStatus(status) ? undefined : status;
}

/**
 * Returns true when an error carries a `status` property of 200. Streaming
 * wrappers surface successful starts as 200 errors and must not be retried.
 */
export function isOkStatusError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }
  return readStatus(error as { status?: number }) === 200;
}

function readDirectStatus(error: unknown): number | undefined {
  if (!isRecord(error) || !('status' in error)) {
    return undefined;
  }
  return readStatus(error as { status?: number });
}

function readResponseStatus(error: unknown): number | undefined {
  if (!isRecord(error) || !('response' in error)) {
    return undefined;
  }
  const response = (error as { response?: unknown }).response;
  if (!isRecord(response) || !('status' in response)) {
    return undefined;
  }
  return readStatus(response as { status?: number });
}

function has429InMessage(error: unknown): boolean {
  return error instanceof Error && error.message.includes('429');
}

function readStatus(holder: { status?: number }): number | undefined {
  const status = holder.status;
  return typeof status === 'number' ? status : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isInvalidStatus(status: number | undefined): boolean {
  return status === undefined || status === 0 || Number.isNaN(status);
}
