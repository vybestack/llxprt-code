/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* global module */

// --- BEGIN OCR TRUSTED MARKER SNIPPET ---
const OCR_DEFAULT_TRUSTED_MARKER_LOGINS = ['github-actions[bot]'];
function normalizeTrustedMarkerLogin(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
function resolveTrustedMarkerLogins(...sources) {
  const logins = new Set();
  for (const login of OCR_DEFAULT_TRUSTED_MARKER_LOGINS) {
    logins.add(login);
  }
  for (const source of sources) {
    if (typeof source === 'string') {
      const tokens = source.split(/[\s,;]+/);
      for (const token of tokens) {
        const normalized = normalizeTrustedMarkerLogin(token);
        if (normalized) {
          logins.add(normalized);
        }
      }
    } else if (Array.isArray(source)) {
      for (const element of source) {
        const normalized = normalizeTrustedMarkerLogin(element);
        if (normalized) {
          logins.add(normalized);
        }
      }
    }
  }
  return logins;
}
function isTrustedMarkerAuthor(user, trustedLogins) {
  if (user === null || typeof user !== 'object' || Array.isArray(user)) {
    return false;
  }
  if (user.type !== 'Bot') {
    return false;
  }
  const login = normalizeTrustedMarkerLogin(user.login);
  if (!login) {
    return false;
  }
  if (!(trustedLogins instanceof Set)) {
    return false;
  }
  return trustedLogins.has(login);
}
function isTrustedMarkerComment(comment, trustedLogins, marker) {
  if (
    comment === null ||
    typeof comment !== 'object' ||
    Array.isArray(comment)
  ) {
    return false;
  }
  if (typeof comment.body !== 'string') {
    return false;
  }
  if (typeof marker !== 'string' || marker.length === 0) {
    return false;
  }
  if (!comment.body.includes(marker)) {
    return false;
  }
  return isTrustedMarkerAuthor(comment.user, trustedLogins);
}
// Duplicate-id deduplication rule: if two trusted markers share the same
// id (concurrent/reattempted API payloads), only the first encountered is
// retained. This guarantees deleteDuplicateMarkerComments never receives an
// id list containing the canonical comment's own id.
function trustedMarkerComments(comments, trustedLogins, marker) {
  if (!Array.isArray(comments)) {
    return [];
  }
  const trusted = comments.filter(function (c) {
    return isTrustedMarkerComment(c, trustedLogins, marker);
  });
  const seenIds = new Set();
  const deduped = [];
  for (const comment of trusted) {
    if (!Number.isSafeInteger(comment.id) || comment.id <= 0) {
      continue;
    }
    if (!seenIds.has(comment.id)) {
      seenIds.add(comment.id);
      deduped.push(comment);
    }
  }
  return deduped.sort(function (a, b) {
    return a.id - b.id;
  });
}
function canonicalMarkerComment(comments, trustedLogins, marker) {
  const trusted = trustedMarkerComments(comments, trustedLogins, marker);
  return trusted.length > 0 ? trusted[0] : null;
}
function newestTrustedMarkerMatching(
  comments,
  trustedLogins,
  marker,
  predicate,
) {
  const trusted = trustedMarkerComments(comments, trustedLogins, marker);
  const pred =
    typeof predicate === 'function'
      ? predicate
      : function () {
          return true;
        };
  let result = null;
  for (const comment of trusted) {
    if (pred(comment)) {
      result = comment;
    }
  }
  return result;
}
function parseHiddenAutoCount(body) {
  const match = /<!--\s*ocr-auto-count:\s*(\d+)\s*-->/.exec(
    String(body === null || body === undefined ? '' : body),
  );
  if (!match) {
    return 0;
  }
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}
function resolveHiddenAutoCount(comments, trustedLogins, marker) {
  const trusted = trustedMarkerComments(comments, trustedLogins, marker);
  let max = 0;
  for (const comment of trusted) {
    const count = parseHiddenAutoCount(comment.body);
    if (count > max) {
      max = count;
    }
  }
  return max;
}
// --- END OCR TRUSTED MARKER SNIPPET ---

module.exports = {
  OCR_DEFAULT_TRUSTED_MARKER_LOGINS,
  normalizeTrustedMarkerLogin,
  resolveTrustedMarkerLogins,
  isTrustedMarkerAuthor,
  isTrustedMarkerComment,
  trustedMarkerComments,
  canonicalMarkerComment,
  newestTrustedMarkerMatching,
  parseHiddenAutoCount,
  resolveHiddenAutoCount,
};
