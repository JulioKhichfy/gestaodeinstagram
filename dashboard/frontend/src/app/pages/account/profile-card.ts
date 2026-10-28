import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { Api, DiscoveredProfile, DiscoveryStatus, errorMessage } from '../../core/api';
import { STATUS_LABELS } from '../../core/discovery';
import { compact, dateBR, dec, pct } from '../../core/format';

/** Card de um perfil descoberto. Não envia nada ao perfil: o contato é manual, pelo link. */
@Component({
  selector: 'app-profile-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = profile();
    <article class="card" [class.off]="p.available === false || p.status === 'descartado'">
      <header>
        @if (p.public?.picture; as pic) { <img [src]="pic" alt="" loading="lazy" referrerpolicy="no-referrer" /> }
        @else { <span class="ph" aria-hidden="true">{{ p.username[0] }}</span> }
        <div class="who">
          <a [href]="p.profileUrl" target="_blank" rel="noopener"><strong>&#64;{{ p.username }}</strong></a>
          @if (p.public?.name) { <small class="muted">{{ p.public?.name }}</small> }
        </div>
        <span class="aff" [title]="'Afinidade com a sua conta (0 a 100)'">{{ p.affinity }}</span>
      </header>

      @if (p.available === false) {
        <p class="muted small">{{ p.error }}</p>
      } @else if (p.available === null) {
        <p class="muted small">Dados públicos ainda não consultados.</p>
      } @else {
        <dl>
          <div><dt>Seguidores</dt><dd>{{ fmt.compact(p.followers) }}</dd></div>
          <div><dt>Engajamento</dt><dd>{{ fmt.pct(p.avgEngagement) }}</dd></div>
          <div><dt>Posts/semana</dt><dd>{{ fmt.dec(p.postsPerWeek) }}</dd></div>
          <div><dt>Último post</dt><dd>{{ fmt.dateBR(p.public?.lastPostAt) }}</dd></div>
        </dl>
        @if (p.niche) { <p class="small"><span class="muted">Nicho:</span> {{ p.niche }}</p> }
        @if (p.public?.biography) { <p class="bio small">{{ p.public?.biography }}</p> }
      }

      @if (p.reasons.length) {
        <ul class="small">@for (r of p.reasons; track r) { <li>{{ r }}</li> }</ul>
      }

      <footer>
        <label class="field">
          <span class="sr">Status</span>
          <select [value]="p.status" (change)="save({ status: $any($event.target).value })" aria-label="Status">
            @for (s of statuses; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
          </select>
        </label>
        <button type="button" class="chip" [class.active]="p.watch" (click)="save({ watch: !p.watch })"
          [attr.aria-pressed]="p.watch" title="Concorrente ou referência">★ Referência</button>
        <a class="btn ghost" [href]="p.profileUrl" target="_blank" rel="noopener">Abrir no Instagram ↗</a>
      </footer>
      <details>
        <summary class="small">Anotações{{ p.notes ? ' ✎' : '' }}</summary>
        <textarea rows="2" [value]="p.notes" (change)="save({ notes: $any($event.target).value })"
          placeholder="Ex.: falar sobre parceria em novembro" aria-label="Anotações"></textarea>
      </details>
      @if (error()) { <p class="alert error small">{{ error() }}</p> }
    </article>
  `,
  styles: `
    .card { display: grid; gap: 8px; align-content: start; height: 100%; box-sizing: border-box; }
    .off { opacity: .65; }
    header { display: flex; align-items: center; gap: 10px; }
    img, .ph { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; flex: none; }
    .ph { display: grid; place-items: center; background: var(--surface-2); font-weight: 700; text-transform: uppercase; }
    .who { display: grid; min-width: 0; flex: 1; a { overflow-wrap: anywhere; } }
    .aff { font-weight: 700; font-variant-numeric: tabular-nums; border: 1px solid var(--border-strong); border-radius: 999px; padding: 2px 10px; }
    dl { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin: 0;
      dt { font-size: .72rem; color: var(--muted); } dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; } }
    p { margin: 0; }
    .bio { color: var(--muted); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    ul { margin: 0; padding-left: 18px; }
    footer { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: auto; select { width: auto; } }
    textarea { width: 100%; box-sizing: border-box; margin-top: 6px; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    @media (max-width: 520px) { dl { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  `,
})
export class ProfileCard {
  private api = inject(Api);

  readonly profile = input.required<DiscoveredProfile>();
  readonly changed = output<DiscoveredProfile>();

  protected readonly fmt = { compact, dateBR, dec, pct };
  protected readonly statuses = Object.entries(STATUS_LABELS) as [DiscoveryStatus, string][];
  protected error = signal('');

  async save(body: Partial<{ status: DiscoveryStatus; notes: string; watch: boolean }>): Promise<void> {
    this.error.set('');
    try {
      this.changed.emit(await this.api.updateDiscovered(this.profile().id, body));
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
