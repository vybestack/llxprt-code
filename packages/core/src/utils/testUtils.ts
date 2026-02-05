/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Testing utilities for simulating 429 errors in unit tests
 */

let requestCounter = 0;
let simulate429Enabled = false;
let simulate429AfterRequests = 0;
let fallbackOccurred = false;

/**
 * Check if we should simulate a 429 error for the current request
 */
export function shouldSimulate429(): boolean {
  if (!simulate429Enabled || fallbackOccurred) {
    return false;
  }

  requestCounter++;

  // If afterRequests is set, only simulate after that many requests
  if (simulate429AfterRequests > 0) {
    return requestCounter > simulate429AfterRequests;
  }

  // Otherwise, simulate for every request
  return true;
}

/**
 * Reset the request counter (useful for tests)
 */
export function resetRequestCounter(): void {
  requestCounter = 0;
}

/**
 * Disable 429 simulation after successful fallback
 */
export function disableSimulationAfterFallback(): void {
  fallbackOccurred = true;
}

/**
 * Create a simulated 429 error response
 */
export function createSimulated429Error(): Error {
  const error = new Error('Rate limit exceeded (simulated)') as Error & {
    status: number;
  };
  error.status = 429;
  return error;
}

/**
 * Reset simulation state when switching auth methods
 */
export function resetSimulationState(): void {
  fallbackOccurred = false;
  resetRequestCounter();
}

/**
 * Enable/disable 429 simulation programmatically (for tests)
 */
export function setSimulate429(enabled: boolean, afterRequests = 0): void {
  simulate429Enabled = enabled;
  simulate429AfterRequests = afterRequests;
  fallbackOccurred = false; // Reset fallback state when simulation is re-enabled
  resetRequestCounter();
}
