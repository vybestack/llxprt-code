/**
 * @plan PLAN-20250120-DEBUGLOGGING.P15
 * @requirement REQ-INT-001.1
 */
import { IContent } from '../../services/history/IContent.js';

export async function* parseResponsesStream(
  stream: ReadableStream<Uint8Array>,
): AsyncIterableIterator<IContent> {
  // TODO: This function needs to be completely rewritten to work with IContent format
  // instead of the old IMessage format. For now, throwing an error to allow build to succeed.

  // Prevent unreachable code warning
  void stream;

  // Temporary yield to satisfy require-yield rule, then throw
  // eslint-disable-next-line no-constant-condition
  if (false) {
    yield { speaker: 'ai' as const, blocks: [] };
  }

  throw new Error(
    'parseResponsesStream needs to be rewritten for IContent format',
  );
}

export function parseErrorResponse(
  status: number,
  body: string,
  providerName: string,
): Error {
  // Try to parse JSON error response first
  try {
    const errorData = JSON.parse(body);

    // Handle various error response formats
    let message = 'Unknown error';
    if (errorData.error?.message) {
      message = errorData.error.message;
    } else if (errorData.error?.description) {
      message = errorData.error.description;
    } else if (errorData.message) {
      message = errorData.message;
    } else if (errorData.description) {
      message = errorData.description;
    } else if (typeof errorData === 'string') {
      message = errorData;
    }

    // Determine the error prefix based on status
    let errorPrefix = 'API Error';
    if (status >= 400 && status < 500) {
      errorPrefix = 'Client error';
    } else if (status >= 500 && status < 600) {
      errorPrefix = 'Server error';
    }

    const error = new Error(`${errorPrefix}: ${message}`);
    (error as { status?: number }).status = status;
    (error as { code?: string }).code = errorData.error?.code || errorData.code;
    return error;
  } catch {
    // For invalid JSON, use a consistent format
    const errorPrefix =
      status >= 500 && status < 600 ? 'Server error' : 'API Error';
    const error = new Error(
      `${errorPrefix}: ${providerName} API error: ${status}`,
    );
    (error as { status?: number }).status = status;
    return error;
  }
}
