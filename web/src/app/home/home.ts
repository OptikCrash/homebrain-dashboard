import { Component } from '@angular/core';
import { BotsCard } from '../bots/bots-card';
import { CouchdbCard } from '../couchdb/couchdb-card';
import { SyncthingCard } from '../syncthing/syncthing-card';
import { ActiveWorkCard } from '../team/active-work-card';
import { RosterCard } from '../team/roster-card';

@Component({
  selector: 'app-home',
  imports: [RosterCard, ActiveWorkCard, SyncthingCard, CouchdbCard, BotsCard],
  template: `
    <main>
      <h1>Home Brain dashboard</h1>
      <div class="cards">
        <app-roster-card />
        <app-active-work-card />
        <app-syncthing-card />
        <app-couchdb-card />
        <app-bots-card />
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
