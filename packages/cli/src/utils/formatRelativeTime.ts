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

export function formatRelativeTime(
  date: Date,
  options?: { mode?: 'long' | 'short'; now?: Date },
): string {
  const mode = options?.mode ?? 'long';
  const now = options?.now ?? new Date();

  let deltaMs = now.getTime() - date.getTime();

  // Clamp future dates to 0
  if (deltaMs < 0) {
    deltaMs = 0;
  }

  const deltaSeconds = deltaMs / SECOND;
  const deltaMinutes = deltaMs / MINUTE;
  const deltaHours = deltaMs / HOUR;
  const deltaDays = deltaMs / DAY;

  if (mode === 'long') {
    // <= 30 seconds: "just now"
    if (deltaSeconds <= 30) {
      return 'just now';
    }

    // 31-90 seconds: "1 minute ago"
    if (deltaSeconds <= 90) {
      return '1 minute ago';
    }

    // > 90 seconds to < 45 minutes: "N minutes ago"
    if (deltaMinutes < 45) {
      const minutes = Math.round(deltaMinutes);
      return `${minutes} minutes ago`;
    }

    // 45-89 minutes: "1 hour ago"
    if (deltaMinutes < 90) {
      return '1 hour ago';
    }

    // 90 minutes to < 22 hours: "N hours ago"
    if (deltaHours < 22) {
      const hours = Math.round(deltaHours);
      return `${hours} hours ago`;
    }

    // 22-35 hours: "yesterday"
    if (deltaHours <= 35) {
      return 'yesterday';
    }

    // 36 hours to < 7 days: "N days ago"
    if (deltaDays < 7) {
      const days = Math.round(deltaDays);
      return days === 1 ? '1 day ago' : `${days} days ago`;
    }

    // 7 days to < 26 days: "N weeks ago"
    if (deltaDays < 26) {
      const weeks = Math.floor(deltaDays / 7);
      return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
    }

    // >= 26 days: formatted date (MMM D, YYYY)
    const month = MONTHS[date.getUTCMonth()];
    const day = date.getUTCDate();
    const year = date.getUTCFullYear();
    return `${month} ${day}, ${year}`;
  }

  // Short mode
  // <= 30 seconds: "now"
  if (deltaSeconds <= 30) {
    return 'now';
  }

  // 31 seconds to < 45 minutes: "Nm ago"
  if (deltaMinutes < 45) {
    const minutes = Math.max(1, Math.round(deltaMinutes));
    return `${minutes}m ago`;
  }

  // 45 minutes to < 22 hours: "Nh ago"
  if (deltaHours < 22) {
    const hours = Math.max(1, Math.round(deltaHours));
    return `${hours}h ago`;
  }

  // 22 hours to < 7 days: "Nd ago"
  if (deltaDays < 7) {
    const days = Math.max(1, Math.round(deltaDays));
    return `${days}d ago`;
  }

  // 7 days to < 26 days: "Nw ago"
  if (deltaDays < 26) {
    const weeks = Math.floor(deltaDays / 7);
    return `${weeks}w ago`;
  }

  // >= 26 days: formatted date
  // Check if same year as now
  const month = MONTHS[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const nowYear = now.getUTCFullYear();

  if (year === nowYear) {
    // Short date (MMM D)
    return `${month} ${day}`;
  }

  // Different year: MMM D, YYYY
  return `${month} ${day}, ${year}`;
}
