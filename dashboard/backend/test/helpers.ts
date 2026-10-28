// Isola os testes: dados e mídia em pastas temporárias, nunca em backend/data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-dashboard-test-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.MEDIA_DIR = path.join(tmp, 'media');
fs.mkdirSync(process.env.MEDIA_DIR, { recursive: true });
// Contas fictícias: os testes nunca dependem do accounts.json real.
process.env.ACCOUNTS_FILE = path.join(import.meta.dirname, 'fixtures', 'accounts.json');
// Nunca chamar o Jev de verdade nos testes, mesmo que a chave exista no ambiente do PC.
delete process.env.TYPESAFE_API_KEY;
delete process.env.JEV_BASE_URL;

export const TMP = tmp;
