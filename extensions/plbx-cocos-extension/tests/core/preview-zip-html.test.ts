import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import JSZip from 'jszip';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractHtmlFromZip } from '../../src/core/preview/server';

async function makeZip(dir: string, zipName: string, innerName: string, content: string): Promise<string> {
  const zip = new JSZip();
  zip.file(innerName, content);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const p = join(dir, zipName);
  writeFileSync(p, buf);
  return p;
}

describe('extractHtmlFromZip', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'plbx-zip-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds zip-name-matched HTML (Mintegral web-mobile-001.html)', async () => {
    const p = await makeZip(dir, 'web-mobile-001.zip', 'web-mobile-001.html', '<html>MINT</html>');
    expect(await extractHtmlFromZip(p)).toContain('MINT');
  });

  it('still finds index.html', async () => {
    const p = await makeZip(dir, 'bundle.zip', 'index.html', '<html>IDX</html>');
    expect(await extractHtmlFromZip(p)).toContain('IDX');
  });

  it('falls back to any root-level .html', async () => {
    const p = await makeZip(dir, 'weird.zip', 'game.html', '<html>GAME</html>');
    expect(await extractHtmlFromZip(p)).toContain('GAME');
  });

  it('throws when the ZIP has no HTML', async () => {
    const p = await makeZip(dir, 'empty.zip', 'data.json', '{}');
    await expect(extractHtmlFromZip(p)).rejects.toThrow();
  });
});
