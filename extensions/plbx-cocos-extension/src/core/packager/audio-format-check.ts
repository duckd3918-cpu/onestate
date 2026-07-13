import * as fs from 'fs';
import { join, extname, relative } from 'path';

/**
 * Audio extensions that Safari / iOS Web Audio `decodeAudioData()` cannot decode
 * on older or in-app WKWebViews. A playable whose game awaits audio decode on
 * bootstrap can hang (grey/black screen) on those WebViews. Safe alternatives:
 * .mp3, .m4a/AAC, .wav. See docs/superpowers/specs/2026-06-17-risky-audio-validation-design.md.
 */
export const RISKY_AUDIO_EXTENSIONS = ['.ogg', '.opus', '.webm'];

/** Plaintext head-comment marker prefix — emitted into the build when risky
 *  audio is found and parsed back out by the preview validator. */
const MARKER_PREFIX = 'plbx-risky-audio:';

/** Recursively scan a build directory for assets with a risky audio extension.
 *  Returns build-relative paths (forward-slashed). [] for a missing/unreadable
 *  dir so a transient error never produces a false warning. Skips node_modules. */
export function detectRiskyAudio(buildDir: string): string[] {
  const risky = new Set(RISKY_AUDIO_EXTENSIONS);
  const found: string[] = [];

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // missing/unreadable — skip silently
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (risky.has(extname(entry.name).toLowerCase())) {
        found.push(relative(buildDir, full).split('\\').join('/'));
      }
    }
  };

  walk(buildDir);
  return found;
}

/** The inner text of the head-comment marker (HtmlBuilder.injectHeadComment wraps
 *  it in `<!-- ... -->`). */
export function riskyAudioMarker(paths: string[]): string {
  return `${MARKER_PREFIX} ${paths.join(', ')}`;
}

/** Parse the risky-audio file list back out of a packaged HTML's head comment.
 *  Returns [] when the marker is absent. */
export function parseRiskyAudioMarker(html: string): string[] {
  const m = html.match(/<!--\s*plbx-risky-audio:\s*([^>]*?)\s*-->/);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
