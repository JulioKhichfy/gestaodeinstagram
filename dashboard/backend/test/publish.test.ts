import './helpers.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, describe, it } from 'node:test';

const { validate, CAROUSEL_MAX } = await import('../src/publish.ts');

const media = process.env.MEDIA_DIR!;
const files = Array.from({ length: CAROUSEL_MAX + 1 }, (_, i) => `img${i}.jpg`);

before(() => {
  for (const f of [...files, 'video.mp4', 'cover.jpg']) fs.writeFileSync(path.join(media, f), 'x');
});

describe('validate', () => {
  it('post estático exige exatamente 1 JPEG', () => {
    assert.equal(validate({ type: 'image', caption: '', items: ['img0.jpg'] }), null);
    assert.match(validate({ type: 'image', caption: '', items: ['video.mp4'] })!, /1 imagem/);
    assert.match(validate({ type: 'image', caption: '', items: ['img0.jpg', 'img1.jpg'] })!, /1 imagem/);
  });

  it(`carrossel aceita de 2 a ${CAROUSEL_MAX} itens`, () => {
    assert.match(validate({ type: 'carousel', caption: '', items: ['img0.jpg'] })!, /2 a/);
    assert.equal(validate({ type: 'carousel', caption: '', items: files.slice(0, CAROUSEL_MAX) }), null);
    assert.match(validate({ type: 'carousel', caption: '', items: files })!, /2 a/);
  });

  it('reels exige 1 vídeo e capa JPEG', () => {
    assert.equal(validate({ type: 'reel', caption: '', items: ['video.mp4'], coverItem: 'cover.jpg' }), null);
    assert.match(validate({ type: 'reel', caption: '', items: ['img0.jpg'] })!, /vídeo/);
  });

  it('limita legenda e hashtags', () => {
    assert.match(validate({ type: 'image', caption: 'a'.repeat(2201), items: ['img0.jpg'] })!, /2200/);
    const tags = Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(' ');
    assert.match(validate({ type: 'image', caption: tags, items: ['img0.jpg'] })!, /hashtags/);
  });

  it('recusa caminhos fora da pasta de mídia', () => {
    assert.match(validate({ type: 'image', caption: '', items: ['../data/store.json'] })!, /não foi encontrada/);
  });
});
