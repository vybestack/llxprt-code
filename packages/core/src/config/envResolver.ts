/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Environment variable documentation and resolution for Config construction.
 *
 * This module documents all known application-specific environment variables
 * consumed by the Config system. Environment variables fall into two categories:
 *
 * ## Construction-time env vars (resolved once at startup)
 * These are read during Config construction or CLI bootstrap and their values
 * are captured into Config fields. They can be centralized here.
 *
 * ## Call-time env vars (read at access time)
 * These are read inside getters each time they're called, providing live
 * env-precedence semantics. They MUST remain inline in their getters because
 * centralizing them would change semantics (env changes mid-session would
 * stop being visible).
 *
 * ## Platform env vars (not application-specific)
 * Standard OS/platform variables like HTTPS_PROXY, HTTP_PROXY, HOME, CI,
 * NODE_ENV are consumed where needed and are not centralized here.
 *
 * @plan PLAN-20260311-ISSUE1573
 */

/**
 * Documented application environment variables.
 *
 * ### Construction-time (CLI bootstrap — `loadCliConfig()`)
 * - `LLXPRT_PROFILE`         — Profile name to load at startup
 * - `LLXPRT_DEFAULT_PROVIDER` — Fallback provider when not set via CLI args or profile
 * - `LLXPRT_DEFAULT_MODEL`   — Fallback model when not set via CLI args or profile
 * - `GEMINI_MODEL`           — Legacy model name (deprecated, prefer LLXPRT_DEFAULT_MODEL)
 * - `DEBUG` / `DEBUG_MODE`   — Enable debug logging output
 * - `NO_BROWSER`             — Suppress browser launch for OAuth flows
 * - `OTEL_EXPORTER_OTLP_ENDPOINT` — OpenTelemetry endpoint override
 *
 * ### Call-time (env-precedence getters in Config — remain inline)
 * - `VERBOSE`                — Enables verbose telemetry/diagnostic output
 * - `SEATBELT_PROFILE`       — macOS sandbox profile override
 * - `LLXPRT_LOG_CONVERSATIONS` — Enable conversation logging ("true"/"1")
 * - `LLXPRT_CONVERSATION_LOG_PATH` — Custom path for conversation logs
 *
 * ### Platform (standard OS — not application-specific)
 * - `HTTPS_PROXY` / `https_proxy` / `HTTP_PROXY` / `http_proxy` — Proxy config
 * - `HOME`                   — User home directory
 * - `CI`                     — CI environment detection
 * - `NODE_ENV` / `VITEST`    — Test environment detection
 */

/**
 * Construction-time environment configuration.
 * These values are read once during Config construction and captured.
 */
export interface ConstructionTimeEnvConfig {
  /** Whether verbose diagnostic output is enabled (VERBOSE=true) */
  verbose: boolean;
  /** Whether running in a test environment (NODE_ENV=test or VITEST set) */
  isTestEnvironment: boolean;
}

/**
 * Resolve environment variables that are consumed during Config construction.
 * Call-time env reads (SEATBELT_PROFILE, LLXPRT_LOG_CONVERSATIONS, etc.)
 * remain inline in their respective getters.
 */
export function resolveConstructionTimeEnv(): ConstructionTimeEnvConfig {
  const isTestEnvironment =
    process.env.NODE_ENV === 'test' || !!process.env.VITEST;
  return {
    verbose: process.env.VERBOSE === 'true' && !isTestEnvironment,
    isTestEnvironment,
  };
}
