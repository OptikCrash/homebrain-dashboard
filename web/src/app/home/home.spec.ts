import { TestBed } from '@angular/core/testing';
import { Home } from './home';

describe('Home', () => {
  it('renders the placeholder heading', async () => {
    await TestBed.configureTestingModule({ imports: [Home] }).compileComponents();

    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();

    const heading = (fixture.nativeElement as HTMLElement).querySelector('h1');
    expect(heading?.textContent).toContain('Home Brain dashboard');
  });
});
