import { DatePipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { TimelineSegment, historyLabel } from './timeline';

// The colours a strip can show, in legend order. Any other status draws grey,
// like 'unknown'.
const LEGEND = [
  { status: 'healthy', label: 'Healthy' },
  { status: 'unhealthy', label: 'Unhealthy' },
  { status: 'unknown', label: 'Unknown (check failed)' },
];

// A service's status history over (at most) the last 24 hours, as a labelled strip of
// segments with a legend. Hovering a segment shows its status and time span.
@Component({
  selector: 'app-history-strip',
  imports: [DatePipe],
  template: `
    <figure class="history">
      <figcaption class="label">{{ label() }}</figcaption>
      <div class="strip" role="img" [attr.aria-label]="ariaLabel()">
        @for (segment of segments(); track segment.start.getTime()) {
          <span
            class="segment"
            [attr.data-status]="segment.status"
            [style.width.%]="segment.percent"
            [title]="segment.status + ': ' + (segment.start | date: 'short') + ' – ' + (segment.end | date: 'short')"
          ></span>
        }
      </div>
      <ul class="legend" aria-label="Legend">
        @for (item of legend; track item.status) {
          <li><span class="swatch" [attr.data-status]="item.status" aria-hidden="true"></span>{{ item.label }}</li>
        }
      </ul>
      <p class="meaning">{{ unhealthyMeaning() }}</p>
    </figure>
  `,
  styles: `
    .history {
      margin: 0.75rem 0 0;
    }
    .label {
      font-size: 0.8rem;
      font-weight: 600;
      color: #57606a;
      margin-bottom: 0.3rem;
    }
    .strip {
      display: flex;
      height: 0.6rem;
      border-radius: 3px;
      overflow: hidden;
      background: #eaeef2;
    }
    .segment,
    .swatch {
      background: #8c959f;
    }
    .segment[data-status='healthy'],
    .swatch[data-status='healthy'] {
      background: #2da44e;
    }
    .segment[data-status='unhealthy'],
    .swatch[data-status='unhealthy'] {
      background: #cf222e;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 1rem;
      list-style: none;
      margin: 0.4rem 0 0;
      padding: 0;
    }
    .legend,
    .meaning {
      color: #57606a;
      font-size: 0.8rem;
    }
    .legend li {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .swatch {
      display: inline-block;
      width: 0.7rem;
      height: 0.7rem;
      border-radius: 2px;
    }
    .meaning {
      margin: 0.25rem 0 0;
    }
  `,
})
export class HistoryStrip {
  readonly segments = input.required<TimelineSegment[]>();
  // Names the strip for screen readers, e.g. "CouchDB history".
  readonly ariaLabel = input.required<string>();
  // What a red segment means for this service.
  readonly unhealthyMeaning = input.required<string>();

  protected readonly legend = LEGEND;
  // Up to 24 hours, but only as far back as the history actually reaches.
  protected readonly label = computed(() => historyLabel(this.segments()));
}
