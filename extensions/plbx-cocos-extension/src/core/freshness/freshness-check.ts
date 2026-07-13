/**
 * Self-update freshness check — version-tag model.
 *
 * The extension is installed via Cocos "Development Import" (a symlink into a
 * git checkout). Earlier versions asked git about the checkout state and hit
 * the GitHub compare API; that broke in real dev situations (detached HEAD,
 * local branch without upstream, git missing from the editor's GUI PATH).
 *
 * Current model is a pure version comparison:
 *  - local side:  `version` from this checkout's package.json
 *  - remote side: max semver tag from the GitHub /tags API (every release is
 *    tagged `vX.Y.Z` and pushed — that IS the publish step for this repo)
 *
 * No git involvement at all. Design:
 *  - `compareSemver` / `pickLatestTag` / `classify` — pure, unit-tested
 *  - `decideAction` — pure UX policy (nag only when behind)
 *  - `checkFreshness` — orchestrator with injected deps (testable without IO)
 *  - `defaultFetchTags` / `runFreshnessCheck` — the real IO sides
 */

export type FreshnessState = 'fresh' | 'behind' | 'ahead' | 'unknown';

export interface FreshnessVerdict {
  state: FreshnessState;
  /** Version of this checkout (package.json), or '' if unreadable. */
  localVersion: string;
  /** Latest published tag's version (no leading v), or '' if unavailable. */
  latestVersion: string;
  /** Why the state is `unknown`, for logging. */
  reason?: string;
}

export interface FreshnessAction {
  notify: boolean;
  severity: 'info' | 'warn';
  message: string;
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

function parseSemver(s: string): [number, number, number] | null {
  const m = (s || '').trim().match(SEMVER_RE);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Numeric semver comparison; throws nothing — unparseable sides sort lowest. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a) ?? [-1, -1, -1];
  const pb = parseSemver(b) ?? [-1, -1, -1];
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/** Max semver tag from a tag-name list (GitHub /tags order is NOT semver). */
export function pickLatestTag(tags: string[]): string | null {
  let best: string | null = null;
  for (const t of tags) {
    if (!parseSemver(t)) continue;
    if (best === null || compareSemver(t, best) > 0) best = t;
  }
  return best;
}

export interface ClassifyInput {
  /** package.json version of this checkout, '' if unreadable. */
  localVersion: string;
  /** Latest published semver tag (e.g. 'v0.2.13'), or null if unavailable. */
  latestTag: string | null;
}

/** Pure: map local/remote versions to a freshness verdict. */
export function classify(input: ClassifyInput): FreshnessVerdict {
  const localVersion = (input.localVersion || '').replace(/^v/, '');
  const latestVersion = (input.latestTag || '').replace(/^v/, '');

  if (!parseSemver(localVersion)) {
    return {
      state: 'unknown',
      localVersion,
      latestVersion,
      reason: 'local version unreadable (package.json)',
    };
  }
  if (!input.latestTag || !parseSemver(latestVersion)) {
    return {
      state: 'unknown',
      localVersion,
      latestVersion: '',
      reason: 'no published version tags reachable (offline / rate-limited)',
    };
  }

  const cmp = compareSemver(localVersion, latestVersion);
  const state: FreshnessState = cmp === 0 ? 'fresh' : cmp < 0 ? 'behind' : 'ahead';
  return { state, localVersion, latestVersion };
}

/**
 * Pure UX policy: nag only when a newer version is published. `ahead` is the
 * normal dev state right after a local bump (tag not pushed yet) — stay quiet.
 */
export function decideAction(v: FreshnessVerdict): FreshnessAction {
  if (v.state === 'behind') {
    return {
      notify: true,
      severity: 'warn',
      message: `Playbox extension v${v.latestVersion} is available (installed v${v.localVersion}).`,
    };
  }
  return { notify: false, severity: 'info', message: '' };
}

/** Pure: one-line status for the Settings "Check for updates" button. */
export function formatCheckResult(v: FreshnessVerdict): string {
  switch (v.state) {
    case 'fresh':
      return `Up to date (v${v.localVersion}).`;
    case 'behind':
      return `v${v.latestVersion} available — installed v${v.localVersion}.`;
    case 'ahead':
      return `Local v${v.localVersion} is newer than the latest published v${v.latestVersion}.`;
    default:
      return `Couldn't check update status${v.reason ? ` (${v.reason})` : ''}.`;
  }
}

export interface CheckDeps {
  /** Read this checkout's version (package.json). May throw. */
  getLocalVersion: () => string;
  /** Fetch tag names from the public repo; resolve null on any failure. */
  fetchTags: () => Promise<string[] | null>;
}

/** Orchestrator: local version + published tags → verdict. */
export async function checkFreshness(deps: CheckDeps): Promise<FreshnessVerdict> {
  let localVersion = '';
  try {
    localVersion = deps.getLocalVersion() || '';
  } catch {
    /* classified as unknown below */
  }
  const tags = await deps.fetchTags().catch(() => null);
  return classify({ localVersion, latestTag: tags ? pickLatestTag(tags) : null });
}

// ── Real (non-injected) dependency implementations ──────────────────────────

import { get as httpsGet } from 'https';
import { readFileSync } from 'fs';
import { join } from 'path';

/** Public GitHub repo this extension is published from. */
export const REPO_SLUG = 'playbox-org/plbx-cocos-assistant';

/**
 * Tag names via the GitHub /tags API (public repo — no auth). Resolves null on
 * any non-200, parse error, timeout, or network failure so the check degrades
 * to `unknown` rather than throwing. 100 per page covers years of releases.
 */
export function defaultFetchTags(slug: string = REPO_SLUG): Promise<string[] | null> {
  return new Promise((resolve) => {
    const req = httpsGet(
      {
        host: 'api.github.com',
        path: `/repos/${slug}/tags?per_page=100`,
        headers: {
          'User-Agent': 'plbx-cocos-extension',
          Accept: 'application/vnd.github+json',
        },
        timeout: 6000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            resolve(Array.isArray(j) ? j.map((t: any) => String(t?.name ?? '')) : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/** Convenience: run the freshness check for the checkout at `repoRoot`. */
export async function runFreshnessCheck(repoRoot: string): Promise<FreshnessVerdict> {
  return checkFreshness({
    getLocalVersion: () =>
      JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version,
    fetchTags: () => defaultFetchTags(),
  });
}
