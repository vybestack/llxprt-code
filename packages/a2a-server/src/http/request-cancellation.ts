/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Request } from 'express';
import type { RequestContext, User } from '@a2a-js/sdk/server';

interface RequestCancellationUser extends User {
  readonly requestAbortSignal: AbortSignal;
}

/** The SDK forwards UserBuilder's result unchanged to RequestContext.context.user. */
export async function createRequestCancellationUser(
  request: Request,
): Promise<RequestCancellationUser> {
  const response = request.res;
  if (response === undefined) {
    throw new TypeError(
      'HTTP request has no response for disconnect cancellation',
    );
  }
  const controller = new AbortController();
  const onClose = (): void => {
    if (!response.writableFinished) {
      controller.abort(new Error('HTTP client disconnected'));
    }
  };
  response.once('close', onClose);
  response.once('finish', () => response.removeListener('close', onClose));
  if (response.destroyed) onClose();
  return {
    isAuthenticated: false,
    userName: '',
    requestAbortSignal: controller.signal,
  };
}

export function readRequestAbortSignal(context: RequestContext): AbortSignal {
  // The SDK also permits transport-free execution, which has no disconnect event.
  if (context.context === undefined) return new AbortController().signal;
  const user = context.context.user;
  if (user === undefined || !('requestAbortSignal' in user)) {
    throw new TypeError('HTTP request cancellation signal was not attached');
  }
  if (!(user.requestAbortSignal instanceof AbortSignal)) {
    throw new TypeError('HTTP request cancellation signal is invalid');
  }
  return user.requestAbortSignal;
}
