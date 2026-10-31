import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Api, StudioCaps, StudioFile, StudioJob, StudioPlanView, errorMessage } from '../../core/api';
import { Assistant } from '../../core/assistant';
import { KDENLIVE_GUIDE } from './kdenlive-guide';

interface Recipe {
  label: string;
  prompt: string;
  help: string;
  /** Só aparece com a legenda automática disponível. */
  whisper?: boolean;
}

export const RECIPES: Recipe[] = [
  { label: 'Reels vertical', help: 'Vídeo horizontal vira 9:16 com fundo desfocado', prompt: 'Transforme o vídeo em Reels vertical 1080x1920 com fundo desfocado, sem cortar a pessoa, pronto para o Instagram.' },
  { label: 'Cortar trecho', help: 'Fica só a parte que você quer', prompt: 'Corte o vídeo de 00:00:05 até 00:00:35.' },
  { label: 'Juntar vídeos', help: 'Vários clipes num vídeo só', prompt: 'Junte os vídeos escolhidos nesta ordem, no formato vertical 1080x1920, com uma transição suave entre eles.' },
  { label: 'Legendas automáticas', whisper: true, help: 'Escreve o que é falado e coloca no vídeo', prompt: 'Gere legendas em português do que é falado e queime no vídeo, com letras brancas grandes e contorno preto, longe da parte de baixo.' },
  { label: 'Legendas do meu texto', help: 'Você cola o texto; ele distribui ao longo do vídeo', prompt: 'Coloque estas legendas no vídeo, distribuídas ao longo dele, com letras brancas grandes e contorno preto:\n[cole o texto aqui]' },
  { label: 'Texto na tela', help: 'Gancho escrito nos primeiros segundos', prompt: 'Escreva no topo do vídeo, nos 3 primeiros segundos, em letras grandes: [seu gancho aqui]' },
  { label: 'Música de fundo', help: 'Escolha também o arquivo da música', prompt: 'Coloque a música escolhida baixinha no fundo (uns 20% do volume), mantendo a voz do vídeo.' },
  { label: 'Comprimir', help: 'Arquivo menor sem perder qualidade visível', prompt: 'Comprima o vídeo para menos de 50 MB mantendo boa qualidade para o Instagram.' },
  { label: 'Capa do Reels', help: 'Uma imagem do vídeo para usar de capa', prompt: 'Tire um quadro do segundo 2 do vídeo como capa JPEG 1080x1920.' },
  { label: 'Fotos para carrossel', help: 'Todas as fotos em 4:5, sem distorcer', prompt: 'Deixe todas as fotos em 1080x1350 (4:5) para carrossel, sem distorcer (com fundo desfocado se precisar).' },
  { label: 'Acelerar', help: 'Mais dinâmico, mesma voz', prompt: 'Deixe o vídeo 1,5x mais rápido, mantendo o tom da voz.' },
  { label: 'Tirar o áudio', help: 'Vídeo sem som', prompt: 'Remova o áudio do vídeo.' },
];

const KIND_LABELS: Record<StudioFile['kind'], string> = { video: 'Vídeo', imagem: 'Imagem', audio: 'Áudio', legenda: 'Legenda' };
const STEP_ICONS: Record<string, string> = { fila: '○', rodando: '◐', ok: '✓', erro: '✕' };

/** Mostra o comando como ele roda (para conferência). */
export const commandLine = (args: string[]) => ['ffmpeg', ...args.map((a) => (/[\s'"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))].join(' ');

/**
 * Estúdio: editar vídeos e imagens sem VS Code. Você cola as pastas, escreve o que quer, a IA monta o plano de comandos
 * do FFmpeg, você confere e executa. Os originais nunca são alterados: o resultado vai para a pasta "editados".
 */
@Component({
  selector: 'app-studio',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card">
      <h1>Estúdio</h1>
      <p class="muted small">Edite vídeos e imagens escrevendo o que quer. O {{ ai.name() }} monta o plano, você confere e executa.
        Os originais <strong>nunca</strong> são alterados: tudo o que for criado vai para a pasta <code>editados</code>, ao lado dos arquivos.</p>
      @if (caps(); as c) {
        @if (!c.ffmpeg) {
          <p class="alert warn">O <strong>FFmpeg</strong> (o programa que edita) não está instalado. No PowerShell:
            <code>winget install -e --id Gyan.FFmpeg</code>; depois feche e abra o dashboard.</p>
        } @else {
          <p class="muted small">FFmpeg: {{ c.ffmpeg }} ·
            @if (c.whisper && c.models.length) { legenda automática <strong>disponível</strong> }
            @else if (c.whisper) { legenda automática: falta o modelo
              <button type="button" class="link-btn" (click)="downloadModel('small')" title="Baixa o modelo de reconhecimento de fala em português (466 MB, uma vez)">baixar (466 MB)</button>
              @if (c.download.small; as d) { @if (!d.done) { · {{ mb(d.received) }} de {{ mb(d.total) }} MB } @else if (d.error) { · erro: {{ d.error }} } }
            } @else { legenda automática: use o Kdenlive (veja o guia abaixo) e traga o .srt }
          </p>
        }
      }
      @if (error()) { <p class="alert error">{{ error() }}</p> }
    </section>

    <section class="card">
      <h2>1. Onde estão os arquivos</h2>
      <p class="muted small">Cole o caminho da pasta (ou do arquivo), um por linha. Dica: no Explorador de Arquivos, clique com o
        botão direito na pasta › <strong>Copiar como caminho</strong>.</p>
      <textarea rows="3" [value]="paths()" (input)="paths.set($any($event.target).value)" aria-label="Caminhos das pastas ou arquivos"
                placeholder="C:\\Users\\voce\\Videos\\lancamento"></textarea>
      <div class="row">
        <button type="button" class="btn primary" [disabled]="busy() || !paths().trim()" (click)="loadFiles()" title="Lista os vídeos, fotos, músicas e legendas desses caminhos">Carregar arquivos</button>
      </div>
      @for (w of scanErrors(); track w) { <p class="muted small">⚠ {{ w }}</p> }
      @if (files().length) {
        <table class="data">
          <thead><tr><th></th><th>Arquivo</th><th>Tipo</th><th class="num">Duração</th><th class="num">Tamanho</th><th class="num">MB</th></tr></thead>
          <tbody>
            @for (f of files(); track f.path) {
              <tr>
                <td><input type="checkbox" [checked]="chosen().has(f.path)" (change)="toggle(f.path)" [attr.aria-label]="'Usar ' + f.name" /></td>
                <td [title]="f.path">{{ f.name }}</td>
                <td>{{ kindLabels[f.kind] }}</td>
                <td class="num">{{ f.duration ? f.duration + ' s' : '—' }}</td>
                <td class="num">{{ f.width ? f.width + 'x' + f.height : '—' }}</td>
                <td class="num">{{ mb(f.size) }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>

    <section class="card">
      <h2>2. O que você quer fazer</h2>
      <div class="chips">
        @for (r of recipes(); track r.label) {
          <button type="button" class="chip" [title]="r.help" (click)="request.set(r.prompt)">{{ r.label }}</button>
        }
      </div>
      <textarea rows="5" [value]="request()" (input)="request.set($any($event.target).value)" aria-label="Pedido de edição"
                placeholder="Ex.: deixe o vídeo vertical para Reels, corte os 5 primeiros segundos e coloque legendas em português"></textarea>
      <div class="row">
        <button type="button" class="btn primary" [disabled]="busy() || !chosen().size || !request().trim() || !caps()?.ffmpeg" (click)="makePlan()"
                [title]="'O ' + ai.name() + ' monta os comandos; nada é executado antes de você conferir'">
          @if (busy() === 'plan') { <span class="spinner"></span> Planejando… } @else { Planejar edição }
        </button>
      </div>
    </section>

    @if (plan(); as p) {
      <section class="card">
        <h2>3. Confira o plano</h2>
        <p><strong>{{ p.plan.resumo }}</strong></p>
        <ol class="steps">
          @for (s of p.plan.passos; track $index; let i = $index) {
            <li>
              <span class="icon" [title]="job()?.steps?.[i]?.status ?? 'fila'">{{ icons[job()?.steps?.[i]?.status ?? 'fila'] }}</span>
              {{ s.descricao }}
              <details>
                <summary title="O comando exato que vai rodar">ver {{ s.tipo === 'arquivo' ? 'arquivo' : 'comando' }}</summary>
                @if (s.tipo === 'arquivo') { <pre>{{ s.nome }}:\n{{ s.conteudo }}</pre> } @else { <pre>{{ cmd(s.args ?? []) }}</pre> }
              </details>
              @if (job()?.steps?.[i]?.status === 'erro' && job()?.steps?.[i]?.log) {
                <details open><summary>o que o FFmpeg disse</summary><pre>{{ job()!.steps[i].log }}</pre></details>
              }
            </li>
          }
        </ol>
        @for (a of p.plan.avisos; track a) { <p class="alert warn">{{ a }}</p> }
        @if (p.plan.kdenlive) { <p class="alert info"><strong>No Kdenlive:</strong> {{ p.plan.kdenlive }}</p> }
        @if (p.problems.length) {
          <div class="alert error">
            <strong>Este plano não pode ser executado</strong> (por segurança, o Estúdio só roda o FFmpeg nas pastas escolhidas):
            <ul>@for (pr of p.problems; track pr) { <li>{{ pr }}</li> }</ul>
            Peça de novo, com mais detalhes.
          </div>
        }
        <p class="muted small">Saída: <code>{{ p.outDir }}</code></p>
        <div class="row">
          @if (!job()) {
            <button type="button" class="btn primary" [disabled]="!!p.problems.length || !!busy()" (click)="execute()" title="Roda os comandos acima; os originais não são alterados">Executar</button>
          } @else if (job()!.done) {
            @if (job()!.error) { <p class="alert error">{{ job()!.error }}</p> } @else { <p class="alert ok">Pronto! Criados: {{ job()!.outputs.join(', ') }}</p> }
            <button type="button" class="btn ghost" (click)="openFolder()" title="Abre a pasta editados no Explorador de Arquivos">Abrir pasta editados</button>
          } @else {
            <span class="muted"><span class="spinner inline"></span> Editando… vídeos longos podem levar alguns minutos.</span>
          }
          <button type="button" class="btn ghost" (click)="resetPlan()" title="Descarta este plano para pedir outro">Pedir outra coisa</button>
        </div>
      </section>
    }

    <section class="card guide">
      <h2>Guia do Kdenlive: o que cada recurso faz</h2>
      <p class="muted small">Para acabamento fino (efeitos, transições, ajuste de legendas palavra por palavra), use o Kdenlive.
        Os nomes dos menus podem variar um pouco conforme a versão.</p>
      @for (s of guide; track s.title) {
        <details [open]="s.highlight">
          <summary [class.highlight]="s.highlight">{{ s.title }}</summary>
          <dl>
            @for (it of s.items; track it.name) {
              <dt>{{ it.name }}</dt>
              <dd>{{ it.what }}@if (it.where) { <br /><small class="muted">Onde: {{ it.where }}</small> }</dd>
            }
          </dl>
        </details>
      }
    </section>
  `,
  styles: `
    :host { display: grid; gap: 16px; }
    h1 { margin: 0 0 4px; font-size: 1.3rem; }
    h2 { margin: 0 0 8px; font-size: 1.05rem; }
    .small { font-size: .88rem; margin: 0 0 6px; }
    textarea { width: 100%; font-family: inherit; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
    .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
    .steps { display: grid; gap: 8px; padding-left: 20px;
      .icon { display: inline-block; width: 18px; }
      pre { white-space: pre-wrap; word-break: break-all; font-size: .8rem; background: var(--surface-2); padding: 8px; border-radius: 6px; } }
    details summary { cursor: pointer; color: var(--muted); font-size: .85rem; }
    .guide details { border-top: 1px solid var(--border); padding: 8px 0; }
    .guide summary { font-size: .95rem; color: inherit; font-weight: 600; }
    .guide summary.highlight { color: var(--accent); }
    dl { margin: 8px 0 0; display: grid; gap: 4px; }
    dt { font-weight: 600; margin-top: 6px; }
    dd { margin: 0 0 0 12px; }
    .spinner.inline { display: inline-block; width: 12px; height: 12px; vertical-align: -2px; }
  `,
})
export class StudioPage {
  private api = inject(Api);
  protected readonly ai = inject(Assistant);

  protected readonly kindLabels = KIND_LABELS;
  protected readonly icons = STEP_ICONS;
  protected readonly guide = KDENLIVE_GUIDE;
  protected readonly cmd = commandLine;
  protected mb = (bytes: number) => (bytes / 1_048_576).toFixed(1);

  protected caps = signal<StudioCaps | null>(null);
  protected paths = signal('');
  protected files = signal<StudioFile[]>([]);
  protected scanErrors = signal<string[]>([]);
  protected chosen = signal<Set<string>>(new Set());
  protected request = signal('');
  protected plan = signal<StudioPlanView | null>(null);
  protected job = signal<StudioJob | null>(null);
  protected busy = signal<'files' | 'plan' | 'run' | null>(null);
  protected error = signal('');
  protected recipes = computed(() => RECIPES.filter((r) => !r.whisper || (this.caps()?.whisper && this.caps()?.models.length)));

  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    try {
      this.paths.set(localStorage.getItem('estudio-caminhos') ?? '');
    } catch {
      // sem armazenamento local
    }
    this.loadCaps();
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  private async loadCaps(): Promise<void> {
    try {
      this.caps.set(await this.api.studioCaps());
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  async loadFiles(): Promise<void> {
    this.busy.set('files');
    this.error.set('');
    try {
      localStorage.setItem('estudio-caminhos', this.paths());
    } catch {
      // sem armazenamento local
    }
    try {
      const r = await this.api.studioFiles(this.paths().split('\n'));
      this.files.set(r.files);
      this.scanErrors.set(r.errors);
      this.chosen.set(new Set(r.files.map((f) => f.path)));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  toggle(path: string): void {
    this.chosen.update((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async makePlan(): Promise<void> {
    this.busy.set('plan');
    this.error.set('');
    this.job.set(null);
    try {
      const chosen = this.files().filter((f) => this.chosen().has(f.path)).map((f) => f.path);
      this.plan.set(await this.api.studioPlan(chosen, this.request()));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  async execute(): Promise<void> {
    const p = this.plan();
    if (!p) return;
    this.busy.set('run');
    this.error.set('');
    try {
      this.job.set(await this.api.studioRun(p.id));
      this.poll();
    } catch (e) {
      this.error.set(errorMessage(e));
      this.busy.set(null);
    }
  }

  private poll(): void {
    this.timer = setTimeout(async () => {
      const current = this.job();
      if (!current) return;
      try {
        const job = await this.api.studioJob(current.id);
        this.job.set(job);
        if (!job.done) return this.poll();
        this.busy.set(null);
      } catch (e) {
        this.error.set(errorMessage(e));
        this.busy.set(null);
      }
    }, 1500);
  }

  async openFolder(): Promise<void> {
    const p = this.plan();
    if (p) await this.api.studioOpen(p.outDir).catch((e) => this.error.set(errorMessage(e)));
  }

  async downloadModel(size: 'base' | 'small'): Promise<void> {
    try {
      await this.api.studioModel(size);
      const tick = async () => {
        await this.loadCaps();
        const d = this.caps()?.download?.[size];
        if (d && !d.done) this.timer = setTimeout(tick, 2000);
      };
      tick();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  resetPlan(): void {
    this.plan.set(null);
    this.job.set(null);
  }
}
