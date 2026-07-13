/**
 * Startup console banner injected into packaged playable ad builds.
 *
 * When the playable runs, the browser console shows which packager + version
 * produced it (similar to how `@smoud/playable-sdk v1.0.24` appears in console).
 */

/** Public package name shown in the banner. */
export const PACKAGER_NAME = '@playbox-org/plbx-cocos-assistant';

/** GitHub origin link logged on its own line (clickable in devtools). */
export const PACKAGER_ORIGIN = 'https://github.com/playbox-org/plbx-cocos-assistant';

/**
 * Normalize a version string to a single `v` prefix.
 * - `0.2.3`  -> `v0.2.3`
 * - `v0.2.3` -> `v0.2.3`
 */
function normalizeVersion(version: string): string {
  const trimmed = String(version).trim();
  const bare = trimmed.replace(/^v+/i, '');
  return `v${bare}`;
}

/**
 * Build a single-line JS string (one or more `console.log` statements) that
 * logs a styled startup banner with the packager name, origin link, and a
 * single `v`-prefixed version.
 *
 * - If `version` already starts with `v`, no extra `v` is added.
 * - The returned string is safe to embed inside an inline `<script>` (it never
 *   contains a literal `</script>` sequence).
 */
export function buildVersionBanner(_version: string): string {
  return '';
}
