/**
 * Pure helpers for ephemeral settings normalization.
 * Extracted from ConfigBase to keep file sizes under the project limit.
 */

export function normalizeStreamingValue(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 'enabled' : 'disabled';
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return 'enabled';
    }
    if (normalized === 'false') {
      return 'disabled';
    }
    if (normalized === 'enabled' || normalized === 'disabled') {
      return normalized;
    }
  }
  return value;
}

export function normalizeContextLimit(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return undefined;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return undefined;
}
