import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BotsCard } from './bots-card';
import { BotId, BotsResponse, PresentBotHealth } from './bots-status';

const URL = '/api/status/bots';

function healthy(bot: BotId, overrides: Partial<PresentBotHealth> = {}): PresentBotHealth {
  return {
    bot,
    present: true,
    name: bot === 'chopper' ? 'Chopper' : 'AP-5',
    checked_at: '2026-10-23T12:00:00.000Z',
    container: 'running',
    container_started_at: '2026-10-20T08:00:00.000Z',
    api: 'up',
    readiness: 'ok',
    last_message_at: '2026-10-23T11:42:10.000Z',
    last_reply_at: '2026-10-23T11:42:15.000Z',
    stale: false,
    ...overrides,
  };
}

describe('BotsCard', () => {
  let fixture: ComponentFixture<BotsCard>;
  let http: HttpTestingController;
  let element: HTMLElement;

  const bot = (id: BotId) => element.querySelector<HTMLElement>(`.bot[data-bot="${id}"]`)!;
  const field = (id: BotId, name: string) =>
    bot(id).querySelector<HTMLElement>(`[data-field="${name}"] dd`)!;
  const badge = (id: BotId, name: string) => field(id, name).querySelector<HTMLElement>('.badge')!;

  function flush(body: BotsResponse) {
    http.expectOne(URL).flush(body);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [BotsCard],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(BotsCard);
    fixture.componentRef.setInput('refreshMs', 1000);
    element = fixture.nativeElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
    vi.useRealTimers();
  });

  it('shows a loading state before the first response', () => {
    expect(element.querySelector('h2')?.textContent).toContain('Bot health');
    expect(element.querySelector('.empty')?.textContent).toContain('Loading');
    flush({ bots: [healthy('chopper'), healthy('ap5')] });
  });

  it('shows both bots healthy with UTC message/reply times', () => {
    flush({ bots: [healthy('chopper'), healthy('ap5', { last_message_at: '2026-10-23T09:05:00.000Z' })] });

    expect(Array.from(element.querySelectorAll('.bot h3'), (h) => h.textContent)).toEqual(['Chopper', 'AP-5']);
    for (const id of ['chopper', 'ap5'] as const) {
      expect(badge(id, 'container').textContent).toBe('running');
      expect(badge(id, 'container').dataset['status']).toBe('healthy');
      expect(badge(id, 'api').textContent).toBe('up');
      expect(badge(id, 'api').dataset['status']).toBe('healthy');
      expect(badge(id, 'readiness').textContent).toBe('ok');
      expect(badge(id, 'readiness').dataset['status']).toBe('healthy');
      expect(bot(id).querySelector('.stale-badge')).toBeNull();
      expect(bot(id).classList).not.toContain('stale');
    }
    expect(field('chopper', 'last-message').textContent?.trim()).toBe('2026-10-23 11:42 UTC');
    expect(field('chopper', 'last-reply').querySelector('time')?.getAttribute('datetime')).toBe('2026-10-23T11:42:15.000Z');
    expect(field('ap5', 'last-message').textContent?.trim()).toBe('2026-10-23 09:05 UTC');
    expect(element.querySelector('.error')).toBeNull();
    expect(element.querySelector('.problem')).toBeNull();
  });

  it('marks only the stale bot as "status stale"', () => {
    flush({ bots: [healthy('chopper'), healthy('ap5', { checked_at: '2026-10-23T11:50:00.000Z', stale: true })] });

    expect(bot('chopper').querySelector('.stale-badge')).toBeNull();
    expect(bot('ap5').querySelector('.stale-badge')?.textContent).toBe('status stale');
    expect(bot('ap5').classList).toContain('stale');
    expect(bot('ap5').querySelector('.problem')?.textContent).toContain('Last checked 2026-10-23 11:50 UTC');
    // The last reading is still shown, just not trusted as current.
    expect(badge('ap5', 'container').textContent).toBe('running');
  });

  it('flags a reading with no check time as stale', () => {
    flush({ bots: [healthy('chopper', { checked_at: null, stale: true }), healthy('ap5')] });

    expect(bot('chopper').querySelector('.stale-badge')?.textContent).toBe('status stale');
    expect(bot('chopper').querySelector('.problem')?.textContent).toContain('No check time recorded');
  });

  it('shows readiness as n/a when the API is down', () => {
    flush({ bots: [healthy('chopper', { api: 'down', readiness: null }), healthy('ap5')] });

    expect(badge('chopper', 'api').textContent).toBe('down');
    expect(badge('chopper', 'api').dataset['status']).toBe('unhealthy');
    expect(badge('chopper', 'readiness').textContent).toBe('n/a');
    expect(badge('chopper', 'readiness').dataset['status']).toBe('unknown');
    expect(badge('ap5', 'readiness').textContent).toBe('ok');
  });

  it('shows a degraded readiness and a stopped container as problems', () => {
    flush({ bots: [healthy('chopper', { readiness: 'degraded' }), healthy('ap5', { container: 'exited' })] });

    expect(badge('chopper', 'readiness').textContent).toBe('degraded');
    expect(badge('chopper', 'readiness').dataset['status']).toBe('unhealthy');
    expect(badge('ap5', 'container').textContent).toBe('exited');
    expect(badge('ap5', 'container').dataset['status']).toBe('unhealthy');
  });

  it('shows unknown values and missing times without inventing data', () => {
    flush({
      bots: [
        healthy('chopper', { name: null, container: null, api: null, readiness: null, last_message_at: null, last_reply_at: null }),
        healthy('ap5'),
      ],
    });

    expect(bot('chopper').querySelector('h3')?.textContent).toBe('Chopper');
    expect(badge('chopper', 'container').textContent).toBe('unknown');
    expect(badge('chopper', 'container').dataset['status']).toBe('unknown');
    expect(badge('chopper', 'api').textContent).toBe('unknown');
    expect(badge('chopper', 'readiness').textContent).toBe('n/a');
    expect(field('chopper', 'last-message').textContent?.trim()).toBe('none recorded');
    expect(field('chopper', 'last-reply').textContent?.trim()).toBe('none recorded');
  });

  it('shows a bot whose status file is missing entirely', () => {
    flush({ bots: [healthy('chopper'), { bot: 'ap5', present: false }] });

    expect(bot('ap5').querySelector('h3')?.textContent).toBe('AP-5');
    expect(bot('ap5').querySelector('.empty')?.textContent).toContain('No status file for AP-5 yet');
    expect(bot('ap5').querySelector('dl')).toBeNull();
    expect(bot('ap5').querySelector('.stale-badge')).toBeNull();
    expect(badge('chopper', 'container').textContent).toBe('running');
  });

  it('refreshes on the interval and reflects the new state', () => {
    flush({ bots: [healthy('chopper'), healthy('ap5')] });
    expect(badge('chopper', 'api').textContent).toBe('up');

    vi.advanceTimersByTime(1000);
    flush({ bots: [healthy('chopper', { api: 'down', readiness: null }), healthy('ap5')] });
    expect(badge('chopper', 'api').textContent).toBe('down');
  });

  it('keeps the last data and shows an error when a refresh fails', () => {
    flush({ bots: [healthy('chopper'), healthy('ap5')] });
    vi.advanceTimersByTime(1000);
    http.expectOne(URL).flush({ error: 'Bot status unavailable' }, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();

    expect(element.querySelector('.error')?.textContent).toContain('retrying');
    expect(badge('chopper', 'container').textContent).toBe('running');

    vi.advanceTimersByTime(1000);
    flush({ bots: [healthy('chopper'), healthy('ap5')] });
    expect(element.querySelector('.error')).toBeNull();
  });

  it('shows only the error when the first request fails', () => {
    http.expectOne(URL).flush({ error: 'Bot status unavailable' }, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();

    expect(element.querySelector('.error')?.getAttribute('role')).toBe('alert');
    expect(element.querySelector('.empty')).toBeNull();
    expect(element.querySelector('.bot')).toBeNull();
  });
});
