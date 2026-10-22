import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Home } from './home';

describe('Home', () => {
  it('renders the heading, the team cards, the Syncthing card and the CouchDB card', async () => {
    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('h1')?.textContent).toContain('Home Brain dashboard');
    expect(element.querySelector('app-roster-card h2')?.textContent).toContain('Team roster');
    expect(element.querySelector('app-active-work-card h2')?.textContent).toContain('Active work');
    expect(element.querySelector('app-syncthing-card h2')?.textContent).toContain('Syncthing');
    expect(element.querySelector('app-couchdb-card h2')?.textContent).toContain('LiveSync / CouchDB');
  });
});
