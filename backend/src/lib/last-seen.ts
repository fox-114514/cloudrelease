const LAST_SEEN_UPDATE_INTERVAL_MS = 60_000;

/**
 * Decides whether a DB write to `Device.lastSeenAt` is due, given the value
 * most recently loaded from the database. Both HTTP request auth and the
 * WS connect path go through this helper so the throttle stays consistent
 * across transports: a busy client doing 100 polls per minute still only
 * causes a single `lastSeenAt` write during that window.
 */
export function shouldUpdateLastSeen(
  previous: Date | null,
  now: Date = new Date(),
): boolean {
  if (!previous) return true;
  return now.getTime() - previous.getTime() >= LAST_SEEN_UPDATE_INTERVAL_MS;
}

export { LAST_SEEN_UPDATE_INTERVAL_MS };
