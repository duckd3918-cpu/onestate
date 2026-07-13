import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import {
  detectRiskyAudio,
  riskyAudioMarker,
  parseRiskyAudioMarker,
  RISKY_AUDIO_EXTENSIONS,
} from '../../../src/core/packager/audio-format-check';

const FIXTURE = join(__dirname, '../../fixtures/risky-audio');

describe('detectRiskyAudio', () => {
  it('finds ogg/opus/webm anywhere in the tree, never mp3/m4a', () => {
    const found = detectRiskyAudio(FIXTURE).map((p) => p.replace(/\\/g, '/'));
    expect(found.some((p) => p.endsWith('assets/x.ogg'))).toBe(true);
    expect(found.some((p) => p.endsWith('assets/sub/y.opus'))).toBe(true);
    expect(found.some((p) => p.endsWith('z.webm'))).toBe(true);
    expect(found.some((p) => p.endsWith('.mp3'))).toBe(false);
    expect(found.some((p) => p.endsWith('.m4a'))).toBe(false);
  });

  it('skips node_modules', () => {
    // node_modules is gitignored, so create the trap at runtime — proves the
    // skip on a fresh clone instead of vacuously passing when the dir is absent.
    const nm = join(FIXTURE, 'node_modules');
    mkdirSync(nm, { recursive: true });
    writeFileSync(join(nm, 'skip.ogg'), '');
    try {
      const found = detectRiskyAudio(FIXTURE).map((p) => p.replace(/\\/g, '/'));
      expect(found.some((p) => p.includes('node_modules'))).toBe(false);
      expect(found.some((p) => p.endsWith('assets/x.ogg'))).toBe(true); // still finds real ones
    } finally {
      rmSync(nm, { recursive: true, force: true });
    }
  });

  it('returns [] for a missing directory (no false warning)', () => {
    expect(detectRiskyAudio(join(FIXTURE, 'does-not-exist'))).toEqual([]);
  });

  it('exposes the risky extension set (ogg/opus/webm)', () => {
    expect(RISKY_AUDIO_EXTENSIONS).toEqual(expect.arrayContaining(['.ogg', '.opus', '.webm']));
    expect(RISKY_AUDIO_EXTENSIONS).not.toContain('.mp3');
  });
});

describe('riskyAudioMarker / parseRiskyAudioMarker', () => {
  it('round-trips the file list through the head-comment marker', () => {
    const paths = ['assets/x.ogg', 'z.webm'];
    const html = `<head><!-- ${riskyAudioMarker(paths)} --></head>`;
    expect(parseRiskyAudioMarker(html)).toEqual(paths);
  });

  it('returns [] when the marker is absent', () => {
    expect(parseRiskyAudioMarker('<head><title>x</title></head>')).toEqual([]);
  });
});
