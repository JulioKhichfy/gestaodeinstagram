import { Injectable, inject, signal } from '@angular/core';
import { Api } from './api';

/** Nome do assistente configurado no backend (AI_PROVIDER): "Claude" ou "ChatGPT". */
@Injectable({ providedIn: 'root' })
export class Assistant {
  readonly name = signal('Claude');

  constructor() {
    try {
      inject(Api)
        .config()
        .then((c) => this.name.set(c.assistant ?? 'Claude'))
        .catch(() => undefined);
    } catch {
      // Api sem config() (testes): fica o padrão.
    }
  }
}
