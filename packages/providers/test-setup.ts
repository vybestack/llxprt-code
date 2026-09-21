/**
 * @plan:PLAN-20260603-ISSUE1584.P06
 * @requirement:REQ-PKG-001
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Clear credential-proxy env vars so unit tests don't inherit the host
// process's proxy configuration (which would skip proactive renewal scheduling
// and alter token-store behaviour).
delete process.env.LLXPRT_CREDENTIAL_SOCKET;
delete process.env.LLXPRT_CAPABILITY_TOKEN;
delete process.env.LLXPRT_CAPABILITY_FD;
