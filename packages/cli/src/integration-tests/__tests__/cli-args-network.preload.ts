/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createRequire } from 'node:module';
import type * as Undici from 'undici';

const requireUndici = createRequire(
  createRequire(import.meta.url).resolve('undici/package.json'),
);
const transport: typeof Undici = requireUndici('./');
const nativeDispatch = transport.Agent.prototype.dispatch;
const fallback = new transport.Agent();
fallback.dispatch = nativeDispatch;
const network = new transport.MockAgent({ agent: fallback });
network.disableNetConnect();
network
  .get(/.*/)
  .intercept({ method: 'POST', path: /.*/ })
  .reply(401, {
    error: {
      code: 401,
      status: 'UNAUTHENTICATED',
      message: 'Synthetic CLI credential rejected',
    },
  })
  .persist();
transport.Agent.prototype.dispatch = function (options, handler): boolean {
  const origin = new URL(String(options.origin));
  if (
    origin.hostname === '127.0.0.1' ||
    origin.hostname === 'localhost' ||
    origin.hostname === '[::1]'
  )
    return nativeDispatch.call(this, options, handler);
  return network.dispatch(options, handler);
};
