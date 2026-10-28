import { CAROUSEL_MAX, HASHTAG_SOFT, countHashtags, feedCrop, isVideoFile } from './media-files';

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

describe('feedCrop', () => {
  it('corta pelo centro só o que sai das proporções do feed', () => {
    expect(feedCrop(1080, 1350)).toBeNull();
    expect(feedCrop(853, 1280)).toEqual({ x: 0, y: 107, width: 853, height: 1066 }); // 2:3 -> 4:5
    expect(feedCrop(3000, 1000)).toEqual({ x: 545, y: 0, width: 1910, height: 1000 }); // panorâmica -> 1.91:1
  });
});
