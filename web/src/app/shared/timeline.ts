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

// Each snapshot holds until the next one; the newest holds until `now`, so a
// service that has been unhealthy since the last poll shows up as such. Runs of
// the same status are merged. `history` may be in any order (the API sends it
// newest first).
export function timelineSegments(history: TimelinePoint[], now: Date = new Date()): TimelineSegment[] {
  const points = history
    .map((point) => ({ status: point.status, time: new Date(point.recordedAt).getTime() }))
    .filter((point) => !Number.isNaN(point.time))
    .sort((a, b) => a.time - b.time);
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
