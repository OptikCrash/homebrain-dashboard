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
