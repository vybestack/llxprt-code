/**
 * Formats a Date as a human-readable relative time string.
 *
 * @plan PLAN-20260214-SESSIONBROWSER.P03, PLAN-20260214-SESSIONBROWSER.P05
 * @requirement REQ-RT-001, REQ-RT-002, REQ-RT-003, REQ-RT-004
 * @pseudocode integration-wiring.md lines 170-212
 */

// Time constants
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Month abbreviations
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

type DeltaMs = number;

interface RelativeBucket {
  thresholdMs: number;
  inclusive: boolean;
  label: (deltaMs: DeltaMs) => string;
}

const roundTo = (unitMs: number) => (deltaMs: DeltaMs) =>
  String(Math.round(deltaMs / unitMs));

const floorDiv = (unitMs: number) => (deltaMs: DeltaMs) =>
  String(Math.floor(deltaMs / unitMs));

function matchesBucket(deltaMs: DeltaMs, bucket: RelativeBucket): boolean {
  return bucket.inclusive
    ? deltaMs <= bucket.thresholdMs
    : deltaMs < bucket.thresholdMs;
}

const LONG_BUCKETS: readonly RelativeBucket[] = [
  { thresholdMs: 30 * SECOND, inclusive: true, label: () => 'just now' },
  { thresholdMs: 90 * SECOND, inclusive: true, label: () => '1 minute ago' },
  {
    thresholdMs: 45 * MINUTE,
    inclusive: false,
    label: (d) => `${roundTo(MINUTE)(d)} minutes ago`,
  },
  { thresholdMs: 90 * MINUTE, inclusive: false, label: () => '1 hour ago' },
  {
    thresholdMs: 22 * HOUR,
    inclusive: false,
    label: (d) => `${roundTo(HOUR)(d)} hours ago`,
  },
  { thresholdMs: 35 * HOUR, inclusive: true, label: () => 'yesterday' },
  {
    thresholdMs: 7 * DAY,
    inclusive: false,
    label: (d) => {
      const days = Math.round(d / DAY);
      return days === 1 ? '1 day ago' : `${days} days ago`;
    },
  },
  {
    thresholdMs: 26 * DAY,
    inclusive: false,
    label: (d) => {
      const weeks = Math.floor(d / (7 * DAY));
      return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
    },
  },
];

const SHORT_BUCKETS: readonly RelativeBucket[] = [
  { thresholdMs: 30 * SECOND, inclusive: true, label: () => 'now' },
  {
    thresholdMs: 45 * MINUTE,
    inclusive: false,
    label: (d) => `${Math.max(1, Math.round(d / MINUTE))}m ago`,
  },
  {
    thresholdMs: 22 * HOUR,
    inclusive: false,
    label: (d) => `${Math.max(1, Math.round(d / HOUR))}h ago`,
  },
  {
    thresholdMs: 7 * DAY,
    inclusive: false,
    label: (d) => `${Math.max(1, Math.round(d / DAY))}d ago`,
  },
  {
    thresholdMs: 26 * DAY,
    inclusive: false,
    label: (d) => `${floorDiv(7 * DAY)(d)}w ago`,
  },
];

function formatBucketed(
  deltaMs: DeltaMs,
  buckets: readonly RelativeBucket[],
): string | null {
  for (const bucket of buckets) {
    if (matchesBucket(deltaMs, bucket)) {
      return bucket.label(deltaMs);
    }
  }
  return null;
}

function formatLongDate(date: Date): string {
  const month = MONTHS[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  return `${month} ${day}, ${year}`;
}

function formatShortDate(date: Date, now: Date): string {
  const month = MONTHS[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  if (year === now.getUTCFullYear()) {
    return `${month} ${day}`;
  }
  return `${month} ${day}, ${year}`;
}

export function formatRelativeTime(
  date: Date,
  options?: { mode?: 'long' | 'short'; now?: Date },
): string {
  const mode = options?.mode ?? 'long';
  const now = options?.now ?? new Date();

  const rawDelta = now.getTime() - date.getTime();
  const deltaMs = rawDelta < 0 ? 0 : rawDelta;

  if (mode === 'long') {
    return formatBucketed(deltaMs, LONG_BUCKETS) ?? formatLongDate(date);
  }

  return formatBucketed(deltaMs, SHORT_BUCKETS) ?? formatShortDate(date, now);
}
