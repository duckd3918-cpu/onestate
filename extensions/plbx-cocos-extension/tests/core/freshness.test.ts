import { describe, it, expect } from 'vitest';
import {
  compareSemver,
  pickLatestTag,
  classify,
  decideAction,
  checkFreshness,
  formatCheckResult,
} from '../../src/core/freshness/freshness-check';

describe('compareSemver', () => {
  it('orders by major/minor/patch', () => {
    expect(compareSemver('0.2.12', '0.2.13')).toBeLessThan(0);
    expect(compareSemver('0.2.13', '0.2.12')).toBeGreaterThan(0);
    expect(compareSemver('0.2.12', '0.2.12')).toBe(0);
    expect(compareSemver('0.10.0', '0.9.9')).toBeGreaterThan(0); // numeric, not lexicographic
    expect(compareSemver('1.0.0', '0.99.99')).toBeGreaterThan(0);
  });
  it('tolerates a leading v', () => {
    expect(compareSemver('v0.2.13', '0.2.12')).toBeGreaterThan(0);
  });
});

describe('pickLatestTag', () => {
  it('returns the max semver tag, not the first listed', () => {
    expect(pickLatestTag(['v0.2.11', 'v0.2.13', 'v0.2.12'])).toBe('v0.2.13');
  });
  it('ignores non-semver tags', () => {
    expect(pickLatestTag(['snapshot', 'v0.2.9', 'release-candidate'])).toBe('v0.2.9');
  });
  it('returns null when nothing parses', () => {
    expect(pickLatestTag(['foo', 'bar'])).toBeNull();
    expect(pickLatestTag([])).toBeNull();
  });
});

describe('classify (version model)', () => {
  it('behind when the latest published tag is newer', () => {
    const v = classify({ localVersion: '0.2.12', latestTag: 'v0.2.13' });
    expect(v.state).toBe('behind');
    expect(v.latestVersion).toBe('0.2.13');
  });
  it('fresh when versions match', () => {
    expect(classify({ localVersion: '0.2.13', latestTag: 'v0.2.13' }).state).toBe('fresh');
  });
  it('ahead when local version is newer than any published tag (pre-release dev)', () => {
    expect(classify({ localVersion: '0.2.14', latestTag: 'v0.2.13' }).state).toBe('ahead');
  });
  it('unknown when tags could not be fetched', () => {
    const v = classify({ localVersion: '0.2.12', latestTag: null });
    expect(v.state).toBe('unknown');
    expect(v.reason).toBeTruthy();
  });
  it('unknown when local version is missing', () => {
    expect(classify({ localVersion: '', latestTag: 'v0.2.13' }).state).toBe('unknown');
  });
});

describe('decideAction', () => {
  it('notifies on behind with both versions in the message', () => {
    const a = decideAction(classify({ localVersion: '0.2.12', latestTag: 'v0.2.13' }));
    expect(a.notify).toBe(true);
    expect(a.severity).toBe('warn');
    expect(a.message).toContain('0.2.13');
    expect(a.message).toContain('0.2.12');
  });
  it('stays silent on fresh / ahead / unknown', () => {
    for (const v of [
      classify({ localVersion: '1.0.0', latestTag: 'v1.0.0' }),
      classify({ localVersion: '1.0.1', latestTag: 'v1.0.0' }),
      classify({ localVersion: '1.0.0', latestTag: null }),
    ]) {
      expect(decideAction(v).notify).toBe(false);
    }
  });
});

describe('formatCheckResult', () => {
  it('covers every state with a human-readable line', () => {
    expect(formatCheckResult(classify({ localVersion: '1.0.0', latestTag: 'v1.0.0' }))).toContain(
      'Up to date',
    );
    expect(formatCheckResult(classify({ localVersion: '1.0.0', latestTag: 'v1.1.0' }))).toContain(
      '1.1.0',
    );
    expect(formatCheckResult(classify({ localVersion: '1.1.0', latestTag: 'v1.0.0' }))).toContain(
      'newer',
    );
    expect(formatCheckResult(classify({ localVersion: '1.0.0', latestTag: null }))).toContain(
      "Couldn't check",
    );
  });
});

describe('checkFreshness (orchestration with injected deps)', () => {
  it('combines local version + fetched tags', async () => {
    const v = await checkFreshness({
      getLocalVersion: () => '0.2.12',
      fetchTags: async () => ['v0.2.13', 'v0.2.12', 'v0.2.11'],
    });
    expect(v.state).toBe('behind');
    expect(v.localVersion).toBe('0.2.12');
    expect(v.latestVersion).toBe('0.2.13');
  });

  it('degrades to unknown when the tag fetch fails', async () => {
    const v = await checkFreshness({
      getLocalVersion: () => '0.2.12',
      fetchTags: async () => null,
    });
    expect(v.state).toBe('unknown');
  });

  it('degrades to unknown when reading the local version throws', async () => {
    const v = await checkFreshness({
      getLocalVersion: () => {
        throw new Error('no package.json');
      },
      fetchTags: async () => ['v0.2.13'],
    });
    expect(v.state).toBe('unknown');
  });

  it('does not depend on git state at all (no git dep in the contract)', async () => {
    // Regression guard for the detached-HEAD bug: the check is now a pure
    // version comparison — no upstream, no working tree, no git binary.
    const v = await checkFreshness({
      getLocalVersion: () => '0.2.13',
      fetchTags: async () => ['v0.2.13'],
    });
    expect(v.state).toBe('fresh');
  });
});
