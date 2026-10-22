import { Component } from '@angular/core';
import { BuildersCard } from '../builders/builders-card';

@Component({
  selector: 'app-home',
  imports: [BuildersCard],
  template: `
    <main>
      <h1>Home Brain dashboard</h1>
      <div class="cards">
        <app-builders-card />
      </div>
    </main>
  `,
  styles: `
    main {
      padding: 2rem;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 28rem), 1fr));
      gap: 1rem;
    }
  `,
})
export class Home {}
