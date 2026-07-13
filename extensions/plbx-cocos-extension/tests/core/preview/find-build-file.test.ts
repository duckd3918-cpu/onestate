import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { findBuildFile } from '../../../src/core/preview/server';

// The preview/validator used to hardcode the output path as
// `{outputDir}/{networkId}/index.html` (+ any .html in that dir). A custom
// Output Naming template that moves the file out of the `{networkId}/` folder
// (e.g. `{networkId}.{ext}` → `applovin.html` at the root) made the validator
// report "not found". The fix resolves the real path with the same template.
describe('findBuildFile honors the output-naming template', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'plbx-preview-'));
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds the standard {networkId}/index.html layout (no template)', () => {
    const dir = join(root, 'std');
    mkdirSync(join(dir, 'applovin'), { recursive: true });
    writeFileSync(join(dir, 'applovin', 'index.html'), '<html></html>');
    const f = findBuildFile(dir, 'applovin');
    expect(f?.path).toBe(join(dir, 'applovin', 'index.html'));
  });

  it('returns null for a flat {networkId}.{ext} layout when given NO template (the bug)', () => {
    const dir = join(root, 'flat-notmpl');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'applovin.html'), '<html></html>');
    expect(findBuildFile(dir, 'applovin')).toBeNull();
  });

  it('finds the flat {networkId}.{ext} file when given the template', () => {
    const dir = join(root, 'flat-tmpl');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'applovin.html'), '<html></html>');
    const f = findBuildFile(dir, 'applovin', { template: '{networkId}.{ext}' });
    expect(f?.path).toBe(join(dir, 'applovin.html'));
    expect(f?.isZip).toBe(false);
  });

  it('resolves a user template variable ({projectName})', () => {
    const dir = join(root, 'projname');
    mkdirSync(join(dir, 'applovin'), { recursive: true });
    writeFileSync(join(dir, 'applovin', 'zombie-miner.html'), '<html></html>');
    const f = findBuildFile(dir, 'applovin', {
      template: '{networkId}/{projectName}.{ext}',
      templateVariables: { projectName: 'zombie-miner' },
    });
    expect(f?.path).toBe(join(dir, 'applovin', 'zombie-miner.html'));
  });
});
