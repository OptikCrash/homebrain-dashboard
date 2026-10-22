import { timelineSegments } from './timeline';

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 22, 12, minutes)).toISOString();

describe('timelineSegments', () => {
  it('returns no segments for an empty history', () => {
    expect(timelineSegments([], new Date(at(0)))).toEqual([]);
  });

  it('merges runs of the same status and sizes them by duration', () => {
    // Newest first, as the API sends it.
    const history = [
      { status: 'healthy', recordedAt: at(30) },
      { status: 'unhealthy', recordedAt: at(20) },
      { status: 'unhealthy', recordedAt: at(10) },
      { status: 'healthy', recordedAt: at(0) },
    ];

    const segments = timelineSegments(history, new Date(at(40)));

    expect(segments.map((s) => [s.status, s.percent])).toEqual([
      ['healthy', 25],
      ['unhealthy', 50],
      ['healthy', 25],
    ]);
    expect(segments[1].start.toISOString()).toBe(at(10));
    expect(segments[1].end.toISOString()).toBe(at(30));
  });

  it('lets a single snapshot taken now fill the strip', () => {
    const segments = timelineSegments([{ status: 'unknown', recordedAt: at(5) }], new Date(at(5)));
    expect(segments).toHaveLength(1);
    expect(segments[0].percent).toBe(100);
  });

  describe('window', () => {
    const hours = (h: number) => new Date(Date.UTC(2026, 9, 22, 12) + h * 3_600_000).toISOString();

    it('drops snapshots older than 24 hours by default and cuts the one holding at the window start', () => {
      // Spans 48 hours; the window is 12:00 on the 21st → 12:00 on the 22nd.
      const history = [
        { status: 'healthy', recordedAt: hours(-6) },
        { status: 'unhealthy', recordedAt: hours(-30) },
        { status: 'unknown', recordedAt: hours(-40) },
        { status: 'healthy', recordedAt: hours(-48) },
      ];

      const segments = timelineSegments(history, new Date(hours(0)));

      expect(segments.map((s) => [s.status, s.percent])).toEqual([
        ['unhealthy', 75],
        ['healthy', 25],
      ]);
      // The tooltip's start time is the window's start, not the 30-hour-old snapshot.
      expect(segments[0].start.toISOString()).toBe(hours(-24));
      expect(segments[0].end.toISOString()).toBe(hours(-6));
      expect(segments[1].end.toISOString()).toBe(hours(0));
    });

    it('keeps a snapshot recorded exactly at the window start', () => {
      const segments = timelineSegments(
        [
          { status: 'unhealthy', recordedAt: hours(-24) },
          { status: 'healthy', recordedAt: hours(-30) },
        ],
        new Date(hours(0)),
      );
      expect(segments.map((s) => s.status)).toEqual(['unhealthy']);
      expect(segments[0].start.toISOString()).toBe(hours(-24));
    });

    it('carries a status older than the window across all of it', () => {
      const segments = timelineSegments([{ status: 'healthy', recordedAt: hours(-30) }], new Date(hours(0)));
      expect(segments).toHaveLength(1);
      expect(segments[0].start.toISOString()).toBe(hours(-24));
      expect(segments[0].percent).toBe(100);
    });

    it('takes a custom window', () => {
      const segments = timelineSegments(
        [
          { status: 'healthy', recordedAt: hours(-1) },
          { status: 'unhealthy', recordedAt: hours(-3) },
        ],
        new Date(hours(0)),
        2 * 3_600_000,
      );
      expect(segments.map((s) => [s.status, s.percent])).toEqual([
        ['unhealthy', 50],
        ['healthy', 50],
      ]);
      expect(segments[0].start.toISOString()).toBe(hours(-2));
    });
  });

  it('ignores snapshots with unparseable timestamps', () => {
    const segments = timelineSegments(
      [
        { status: 'healthy', recordedAt: 'not a date' },
        { status: 'unhealthy', recordedAt: at(0) },
      ],
      new Date(at(10)),
    );
    expect(segments.map((s) => s.status)).toEqual(['unhealthy']);
  });
});
