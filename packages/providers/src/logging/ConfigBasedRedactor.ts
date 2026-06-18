/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Simple redactor implementation that works with a RedactionConfig.
 * Extracted from LoggingProviderWrapper to keep the main file under the
 * lint line budget.
 */

import { type IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RedactionConfig } from '@vybestack/llxprt-code-core/config/config.js';
import type { ITool } from '../IProvider.js';

export interface ConversationDataRedactor {
  redactMessage(content: IContent, provider: string): IContent;
  redactToolCall(tool: ITool): ITool;
  redactResponseContent(content: string, provider: string): string;
}

function isRedactionBoundary(character: string): boolean {
  return [' ', '\n', '\r', '\t', '"', "'"].includes(character);
}

function isCodeInRange(code: number, min: number, max: number): boolean {
  return code >= min && code <= max;
}

function isAsciiIdentifier(character: string): boolean {
  const code = character.charCodeAt(0);
  if (isCodeInRange(code, 48, 57)) {
    return true;
  }
  if (isCodeInRange(code, 65, 90)) {
    return true;
  }
  if (isCodeInRange(code, 97, 122)) {
    return true;
  }
  return character === '_' || character === '-';
}

function replaceBoundaryTokens(
  content: string,
  shouldRedactToken: (token: string) => boolean,
  replacement: string,
): string {
  let redacted = '';
  let index = 0;

  while (index < content.length) {
    const tokenStart = index;
    while (
      index < content.length &&
      !isRedactionBoundary(content[index] ?? '')
    ) {
      index += 1;
    }

    if (tokenStart < index) {
      const token = content.slice(tokenStart, index);
      redacted += shouldRedactToken(token) ? replacement : token;
    }

    if (index < content.length) {
      redacted += content[index];
      index += 1;
    }
  }

  return redacted;
}

function findCredentialKey(
  lowerContent: string,
  index: number,
): string | undefined {
  return ['password', 'pwd', 'pass'].find((key) =>
    lowerContent.startsWith(key, index),
  );
}

function isCredentialAssignment(
  lowerContent: string,
  index: number,
  credentialKey: string,
): boolean {
  const previous = index === 0 ? '' : (lowerContent[index - 1] ?? '');
  const next = lowerContent[index + credentialKey.length] ?? '';
  const previousIsIdentifier = previous !== '' && isAsciiIdentifier(previous);
  const nextIsSeparator =
    next === '=' || next === ':' || isRedactionBoundary(next);
  return !previousIsIdentifier && nextIsSeparator;
}

function findCredentialValueStart(content: string, index: number): number {
  let valueStart = index;
  while (
    valueStart < content.length &&
    isRedactionBoundary(content[valueStart] ?? '')
  ) {
    valueStart += 1;
  }
  if (content[valueStart] === '=' || content[valueStart] === ':') {
    valueStart += 1;
  }
  while (
    valueStart < content.length &&
    isRedactionBoundary(content[valueStart] ?? '')
  ) {
    valueStart += 1;
  }
  return valueStart;
}

function findTokenEnd(content: string, index: number): number {
  let valueEnd = index;
  while (
    valueEnd < content.length &&
    !isRedactionBoundary(content[valueEnd] ?? '')
  ) {
    valueEnd += 1;
  }
  return valueEnd;
}

function redactCredentialAssignments(content: string): string {
  let redacted = '';
  let index = 0;
  const lower = content.toLowerCase();

  while (index < content.length) {
    const matchedKey = findCredentialKey(lower, index);
    if (matchedKey && isCredentialAssignment(lower, index, matchedKey)) {
      const valueStart = findCredentialValueStart(
        content,
        index + matchedKey.length,
      );
      redacted += 'password=[REDACTED]';
      index = findTokenEnd(content, valueStart);
    } else {
      redacted += content[index] ?? '';
      index += 1;
    }
  }

  return redacted;
}

function isBearerTokenCharacter(character: string): boolean {
  return isAsciiIdentifier(character) || character === '.';
}

function redactBearerTokens(content: string): string {
  let redacted = '';
  let index = 0;
  const lower = content.toLowerCase();
  const prefix = 'bearer ';

  while (index < content.length) {
    const matchStart = lower.indexOf(prefix, index);
    if (matchStart === -1) {
      redacted += content.slice(index);
      break;
    }

    const tokenStart = matchStart + prefix.length;
    let tokenEnd = tokenStart;
    while (
      tokenEnd < content.length &&
      isBearerTokenCharacter(content[tokenEnd] ?? '')
    ) {
      tokenEnd += 1;
    }

    redacted += content.slice(index, matchStart);
    if (tokenEnd - tokenStart >= 16) {
      redacted += 'bearer [REDACTED-BEARER-TOKEN]';
    } else {
      redacted += content.slice(matchStart, tokenEnd);
    }
    index = tokenEnd;
  }

  return redacted;
}

function redactOwnerPathSegments(
  content: string,
  prefix: string,
  replacement: string,
): string {
  let redacted = '';
  let index = 0;

  while (index < content.length) {
    if (content.startsWith(prefix, index)) {
      let segmentEnd = index + prefix.length;
      while (
        segmentEnd < content.length &&
        !['/', ' ', '\n', '\r', '\t', '"'].includes(content[segmentEnd] ?? '')
      ) {
        segmentEnd += 1;
      }

      if (segmentEnd > index + prefix.length) {
        redacted += replacement;
        index = segmentEnd;
        continue;
      }
    }

    redacted += content[index] ?? '';
    index += 1;
  }

  return redacted;
}

function isPathTerminator(character: string): boolean {
  return [' ', '\n', '\r', '\t', '"'].includes(character);
}

function redactAbsolutePathsContaining(
  content: string,
  marker: string,
  replacement: string,
): string {
  let redacted = '';
  let index = 0;

  while (index < content.length) {
    if (content[index] === '/') {
      let pathEnd = index + 1;
      while (
        pathEnd < content.length &&
        !isPathTerminator(content[pathEnd] ?? '')
      ) {
        pathEnd += 1;
      }

      const path = content.slice(index, pathEnd);
      if (path.includes(marker)) {
        redacted += replacement;
        index = pathEnd;
        continue;
      }
    }

    redacted += content[index] ?? '';
    index += 1;
  }

  return redacted;
}

function isEmailCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  if (isCodeInRange(code, 48, 57)) {
    return true;
  }
  if (isCodeInRange(code, 65, 90)) {
    return true;
  }
  if (isCodeInRange(code, 97, 122)) {
    return true;
  }
  return ['.', '_', '%', '+', '-', '@'].includes(character);
}

function redactEmailAddresses(content: string): string {
  let redacted = '';
  let index = 0;

  while (index < content.length) {
    if (isEmailCharacter(content[index] ?? '')) {
      const tokenStart = index;
      while (index < content.length && isEmailCharacter(content[index] ?? '')) {
        index += 1;
      }
      const token = content.slice(tokenStart, index);
      redacted += isEmailLikeToken(token) ? '[REDACTED-EMAIL]' : token;
      continue;
    }

    redacted += content[index] ?? '';
    index += 1;
  }

  return redacted;
}

function isDigit(character: string): boolean {
  return character >= '0' && character <= '9';
}

function isWhitespace(character: string): boolean {
  return [' ', '\n', '\r', '\t'].includes(character);
}

function isWordCharacter(character: string): boolean {
  return isAsciiIdentifier(character);
}

function readFourDigits(content: string, index: number): number | undefined {
  let cursor = index;
  for (let count = 0; count < 4; count += 1) {
    if (!isDigit(content[cursor] ?? '')) {
      return undefined;
    }
    cursor += 1;
  }
  return cursor;
}

function readOptionalCardSeparator(content: string, index: number): number {
  const character = content[index] ?? '';
  return character === '-' || isWhitespace(character) ? index + 1 : index;
}

function readCreditCardCandidate(
  content: string,
  start: number,
): number | undefined {
  let cursor = start;
  for (let group = 0; group < 4; group += 1) {
    const afterDigits = readFourDigits(content, cursor);
    if (afterDigits === undefined) {
      return undefined;
    }
    cursor = afterDigits;
    if (group < 3) {
      cursor = readOptionalCardSeparator(content, cursor);
    }
  }
  return cursor;
}

function redactCreditCardNumbers(content: string): string {
  let redacted = '';
  let index = 0;

  while (index < content.length) {
    const previous = index === 0 ? '' : (content[index - 1] ?? '');
    const startsAtBoundary = previous === '' || !isWordCharacter(previous);
    if (startsAtBoundary && isDigit(content[index] ?? '')) {
      const candidateEnd = readCreditCardCandidate(content, index);
      const next =
        candidateEnd === undefined ? '' : (content[candidateEnd] ?? '');
      if (
        candidateEnd !== undefined &&
        (next === '' || !isWordCharacter(next))
      ) {
        redacted += '[REDACTED-CC-NUMBER]';
        index = candidateEnd;
        continue;
      }
    }

    redacted += content[index] ?? '';
    index += 1;
  }

  return redacted;
}

function redactUrls(content: string): string {
  return content.replace(/https?:\/\/[^\s"']+/g, '[REDACTED-URL]');
}

function applyCustomPatterns(
  content: string,
  patterns: RedactionConfig['customPatterns'],
): string {
  let redacted = content;
  for (const pattern of patterns ?? []) {
    if (pattern.enabled) {
      redacted = redacted.replace(pattern.pattern, pattern.replacement);
    }
  }
  return redacted;
}

function isEmailLikeToken(token: string): boolean {
  const atIndex = token.indexOf('@');
  return (
    atIndex > 0 &&
    token.indexOf('@', atIndex + 1) === -1 &&
    token.indexOf('.', atIndex + 2) > atIndex
  );
}

function isPhoneToken(token: string): boolean {
  return (
    token.length === 12 &&
    token[3] === '-' &&
    token[7] === '-' &&
    [...token].every((character, index) =>
      index === 3 || index === 7
        ? character === '-'
        : character >= '0' && character <= '9',
    )
  );
}

export class ConfigBasedRedactor implements ConversationDataRedactor {
  constructor(private redactionConfig: RedactionConfig) {}

  redactMessage(content: IContent, providerName: string): IContent {
    if (!this.shouldRedact()) {
      return content;
    }

    const redactedContent = { ...content };

    // Redact text blocks
    redactedContent.blocks = redactedContent.blocks.map((block) => {
      if (block.type === 'text') {
        return {
          ...block,
          text: this.redactContent(block.text, providerName),
        };
      } else if (block.type === 'tool_call') {
        const redactedParams = this.redactContent(
          JSON.stringify(block.parameters),
          providerName,
        );
        try {
          return {
            ...block,
            parameters: JSON.parse(redactedParams),
          };
        } catch {
          return block;
        }
      }
      return block;
    });

    return redactedContent;
  }

  redactToolCall(tool: ITool): ITool {
    if (!this.shouldRedact()) {
      return tool;
    }

    const redactedTool = { ...tool };

    // Both parameters and name are required fields on ITool.function
    const redactedParams = this.redactContent(
      JSON.stringify(redactedTool.function.parameters),
      'global',
    );
    try {
      redactedTool.function.parameters = JSON.parse(redactedParams);
    } catch {
      // If parsing fails, keep original parameters
      redactedTool.function.parameters = tool.function.parameters;
    }

    return redactedTool;
  }

  redactResponseContent(content: string, providerName: string): string {
    if (!this.shouldRedact()) {
      return content;
    }

    return this.redactContent(content, providerName);
  }

  private shouldRedact(): boolean {
    const cfg = this.redactionConfig;
    if (cfg.redactApiKeys || cfg.redactCredentials || cfg.redactFilePaths) {
      return true;
    }

    if (cfg.redactUrls || cfg.redactEmails || cfg.redactPersonalInfo) {
      return true;
    }

    return (cfg.customPatterns ?? []).some((pattern) => pattern.enabled);
  }

  private redactContent(content: string, _providerName: string): string {
    let redacted = content;

    // Apply basic API key redaction if enabled
    if (this.redactionConfig.redactApiKeys) {
      redacted = redacted.replace(/sk-[a-zA-Z0-9]{32,}/g, '[REDACTED-API-KEY]');
      redacted = redacted.replace(
        /sk-proj-[a-zA-Z0-9]{48}/g,
        '[REDACTED-OPENAI-PROJECT-KEY]',
      );
      redacted = redacted.replace(
        /sk-ant-[a-zA-Z0-9_-]{95}/g,
        '[REDACTED-ANTHROPIC-KEY]',
      );
      redacted = redacted.replace(
        /AIza[0-9A-Za-z_-]{35}/g,
        '[REDACTED-GOOGLE-KEY]',
      );
    }

    // Apply credential redaction if enabled
    if (this.redactionConfig.redactCredentials) {
      redacted = redactCredentialAssignments(redacted);
      redacted = redactBearerTokens(redacted);
    }

    // Apply file path redaction if enabled
    if (this.redactionConfig.redactFilePaths) {
      redacted = redactAbsolutePathsContaining(
        redacted,
        '.ssh/',
        '[REDACTED-SSH-PATH]',
      );
      redacted = redactAbsolutePathsContaining(
        redacted,
        '.env',
        '[REDACTED-ENV-FILE]',
      );
      redacted = redactOwnerPathSegments(
        redacted,
        '/home/',
        '[REDACTED-HOME-DIR]',
      );
      redacted = redactOwnerPathSegments(
        redacted,
        '/Users/',
        '[REDACTED-USER-DIR]',
      );
    }

    if (this.redactionConfig.redactUrls) {
      redacted = redactUrls(redacted);
    }

    // Apply email redaction if enabled
    if (this.redactionConfig.redactEmails) {
      redacted = redactEmailAddresses(redacted);
    }

    // Apply personal info redaction if enabled
    if (this.redactionConfig.redactPersonalInfo) {
      redacted = replaceBoundaryTokens(
        redacted,
        isPhoneToken,
        '[REDACTED-PHONE]',
      );
      redacted = redactCreditCardNumbers(redacted);
    }

    redacted = applyCustomPatterns(
      redacted,
      this.redactionConfig.customPatterns,
    );
    return redacted;
  }
}
