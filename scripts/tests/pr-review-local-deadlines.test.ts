/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it } from 'bun:test';
import { z } from 'zod';

it('allows a quiet local response to finish within its explicit deadline', async () => {
  const moduleUrl = new URL('../pr-review-local.ts', import.meta.url).href;
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      '--eval',
      `import { createLocalReviewRunner } from ${JSON.stringify(moduleUrl)};
let received = 0;
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  idleTimeout: 0,
  fetch: async (request) => {
    const body = await request.json();
    received += 1;
    await Bun.sleep(8000);
    return Response.json({
      message: { content: JSON.stringify({ requestBytes: JSON.stringify(body).length }) },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 10,
      eval_count: 10,
    });
  },
});
try {
  const output = await createLocalReviewRunner({
    endpoint: 'http://127.0.0.1:' + server.port,
    timeoutMs: 20000,
    budgetMs: 30000,
  })('static retry evidence');
  console.log(JSON.stringify({ received, output: JSON.parse(output) }));
} finally {
  server.stop(true);
}`,
    ],
    env: { ...process.env, BUN_CONFIG_HTTP_IDLE_TIMEOUT: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ exitCode, stderr }).toMatchObject({ exitCode: 0 });
  const result = z
    .object({
      received: z.number(),
      output: z.object({ requestBytes: z.number() }),
    })
    .parse(JSON.parse(stdout));
  expect(result.received).toBe(1);
  expect(result.output.requestBytes).toBeGreaterThan(
    'static retry evidence'.length,
  );
}, 25000);
