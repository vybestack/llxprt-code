/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import winston from 'winston';

/**
 * Request-controlled text reaches the message (winston merges a `message` key
 * from the meta object into it), so line breaks and other control characters
 * are escaped to keep every log entry on one line and stop forged entries.
 */
function escapeControlCharacters(text: string): string {
  return text.replace(/[\p{Cc}\u2028\u2029]/gu, (char) => {
    switch (char) {
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      default:
        return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
    }
  });
}

const logFormat = winston.format.combine(
  // First, add a timestamp to the log info object
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS A', // Custom timestamp format
  }),
  // Here we define the custom output format
  winston.format.printf((info) => {
    const { level, timestamp, message, ...rest } = info;
    return (
      `[${level.toUpperCase()}] ${timestamp} -- ${escapeControlCharacters(String(message))}` +
      `${Object.keys(rest).length > 0 ? `\n${JSON.stringify(rest, null, 2)}` : ''}`
    ); // Only print ...rest if present
  }),
);

const logger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [new winston.transports.Console()],
});

export { logger, logFormat };
