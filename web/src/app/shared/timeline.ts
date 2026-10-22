// Turns a service's snapshot history into the segments of its timeline strip.
// Plain functions, no Angular, so the strip needs no charting library.

export interface TimelinePoint {
  status: string;
  recordedAt: string;
}

export interface TimelineSegment {
  status: string;
  start: Date;
  end: Date;
  // Share of the strip's width, 0-100.
  percent: number;
}

// How far back the strip reaches.
export const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;

// Each snapshot holds until the next one; the newest holds until `now`, so a
// service that has been unhealthy since the last poll shows up as such. Runs of
// the same status are merged. `history` may be in any order (the API sends it
// newest first). Only the last `windowMs` before `now` is kept: older snapshots
// are dropped, and one still holding at the window's start is cut to begin there.
export function timelineSegments(
  history: TimelinePoint[],
  now: Date = new Date(),
  windowMs: number = HISTORY_WINDOW_MS,
): TimelineSegment[] {
  const windowStart = now.getTime() - windowMs;
  const sorted = history
    .map((point) => ({ status: point.status, time: new Date(point.recordedAt).getTime() }))
    .filter((point) => !Number.isNaN(point.time))
    .sort((a, b) => a.time - b.time);
  // The newest snapshot at or before the window's start still holds there.
  let firstKept = 0;
  while (firstKept + 1 < sorted.length && sorted[firstKept + 1].time <= windowStart) firstKept++;
  const points = sorted
    .slice(firstKept)
    .map((point) => ({ status: point.status, time: Math.max(point.time, windowStart) }));
  if (points.length === 0) return [];

  const first = points[0].time;
  const last = Math.max(now.getTime(), points[points.length - 1].time);
  const total = last - first;

  const segments: TimelineSegment[] = [];
  for (let i = 0; i < points.length; i++) {
    const start = points[i].time;
    const end = i + 1 < points.length ? points[i + 1].time : last;
    const previous = segments[segments.length - 1];
    if (previous && previous.status === points[i].status) {
      previous.end = new Date(end);
    } else {
      segments.push({ status: points[i].status, start: new Date(start), end: new Date(end), percent: 0 });
    }
  }

  for (const segment of segments) {
    // A single snapshot taken "now" has no duration; let it fill the strip.
    segment.percent = total > 0
      ? ((segment.end.getTime() - segment.start.getTime()) / total) * 100
      : 100 / segments.length;
  }
  return segments;
}

// Names the span the strip really covers. The API sends only its newest
// snapshots (100 at the time of writing, ~50 minutes at the default 30s poll), so
// the strip often reaches back less than the full window; the label must say so
// rather than claim 24 hours. Rounds down so it never overstates.
export function historyLabel(segments: TimelineSegment[], windowMs: number = HISTORY_WINDOW_MS): string {
  if (segments.length === 0) return 'History';
  const covered = Math.min(segments[segments.length - 1].end.getTime() - segments[0].start.getTime(), windowMs);
  const hours = Math.floor(covered / 3_600_000);
  if (hours >= 2) return `History — last ${hours} hours`;
  const minutes = Math.floor(covered / 60_000);
  if (minutes >= 2) return `History — last ${minutes} minutes`;
  return 'History — last minute';
}
