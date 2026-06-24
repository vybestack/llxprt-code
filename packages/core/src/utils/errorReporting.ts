/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type Content } from '@google/genai';

function reportToStderr(message: string, ...extras: unknown[]): void {
  const parts = [message, ...extras];
  const output = parts.map((part) => formatPart(part)).join(' ') + '\n';
  try {
    process.stderr.write(output);
  } catch {
    // Swallow write failures to avoid masking the original error
  }
}

function formatPart(part: unknown): string {
  if (part instanceof Error) {
    return part.stack ?? `${part.name}: ${part.message}`;
  }
  if (typeof part === 'object' && part !== null) {
    try {
      return JSON.stringify(part);
    } catch {
      return String(part);
    }
  }
  return String(part);
}

interface ErrorReportData {
  error: { message: string; stack?: string } | { message: string };
  context?: unknown;
  additionalInfo?: Record<string, unknown>;
}

/** Normalises an unknown error value into a structured { message, stack? } object. */
function normaliseError(error: Error | unknown): {
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return { message: String((error as { message: unknown }).message) };
  }
  return { message: String(error) };
}

/** Writes a minimal error report (excluding context) as a fallback when context can't be stringified. */
async function writeMinimalReport(
  errorToReport: { message: string; stack?: string },
  baseMessage: string,
  reportPath: string,
): Promise<void> {
  try {
    const minimalReportContent = { error: errorToReport };
    const stringifiedContent = JSON.stringify(minimalReportContent, null, 2);
    await fs.writeFile(reportPath, stringifiedContent);
    reportToStderr(
      `${baseMessage} Partial report (excluding context) available at: ${reportPath}`,
    );
  } catch (minimalWriteError) {
    reportToStderr(
      `${baseMessage} Failed to write even a minimal error report:`,
      minimalWriteError,
    );
  }
}

/**
 * Generates an error report, writes it to a temporary file, and logs information to console.error.
 * @param error The error object.
 * @param context The relevant context (e.g., chat history, request contents).
 * @param type A string to identify the type of error (e.g., 'startChat', 'generateJson-api').
 * @param baseMessage The initial message to log to console.error before the report path.
 */
export async function reportError(
  error: Error | unknown,
  baseMessage: string,
  context?: Content[] | Record<string, unknown> | unknown[],
  type = 'general',
  reportingDir = os.tmpdir(), // for testing
): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportFileName = `llxprt-client-error-${type}-${timestamp}.json`;
  const reportPath = path.join(reportingDir, reportFileName);

  const errorToReport = normaliseError(error);

  const reportContent: ErrorReportData = { error: errorToReport };

  if (context) {
    reportContent.context = context;
  }

  let stringifiedReportContent: string;
  try {
    stringifiedReportContent = JSON.stringify(reportContent, null, 2);
  } catch (stringifyError) {
    // This can happen if context contains something like BigInt
    reportToStderr(
      `${baseMessage} Could not stringify report content (likely due to context):`,
      stringifyError,
    );
    reportToStderr('Original error that triggered report generation:', error);
    if (context) {
      reportToStderr(
        'Original context could not be stringified or included in report.',
      );
    }
    await writeMinimalReport(errorToReport, baseMessage, reportPath);
    return;
  }

  try {
    await fs.writeFile(reportPath, stringifiedReportContent);
    reportToStderr(`${baseMessage} Full report available at: ${reportPath}`);
  } catch (writeError) {
    reportToStderr(
      `${baseMessage} Additionally, failed to write detailed error report:`,
      writeError,
    );
    // Log the original error as a fallback if report writing fails
    reportToStderr('Original error that triggered report generation:', error);
    if (context) {
      logContextFallback(context);
    }
  }
}

function logContextFallback(context: unknown): void {
  try {
    reportToStderr('Original context:', context);
  } catch {
    try {
      reportToStderr(
        'Original context (stringified, truncated):',
        JSON.stringify(context).substring(0, 1000),
      );
    } catch {
      reportToStderr('Original context could not be logged or stringified.');
    }
  }
}
