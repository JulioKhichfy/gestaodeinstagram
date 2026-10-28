import { CAROUSEL_MAX, HASHTAG_SOFT, countHashtags, isVideoFile } from './media-files';

describe('media-files', () => {
  it('conta hashtags com acentos e ignora # solto', () => {
    expect(countHashtags('#decoração #casa # #kit_natal texto')).toBe(3);
    expect(countHashtags('sem hashtags')).toBe(0);
  });

  it('segue os limites atuais', () => {
    expect(CAROUSEL_MAX).toBe(20);
    expect(HASHTAG_SOFT).toBe(5);
  });

  it('reconhece vídeos por tipo ou extensão', () => {
    expect(isVideoFile(new File([''], 'a.mov'))).toBe(true);
    expect(isVideoFile(new File([''], 'a.bin', { type: 'video/mp4' }))).toBe(true);
    expect(isVideoFile(new File([''], 'a.jpg', { type: 'image/jpeg' }))).toBe(false);
  });
});
