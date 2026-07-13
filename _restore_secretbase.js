const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = 'C:\\Users\\Miras\\onestate';
const GIT = path.join(ROOT, '.git');

function readObject(sha) {
  const file = path.join(GIT, 'objects', sha.slice(0, 2), sha.slice(2));
  if (!fs.existsSync(file)) return null;
  const data = zlib.inflateSync(fs.readFileSync(file));
  const nul = data.indexOf(0);
  return { type: data.toString('ascii', 0, nul).split(' ')[0], body: data.slice(nul + 1) };
}

function walkTree(sha, prefix, out) {
  const obj = readObject(sha);
  if (!obj || obj.type !== 'tree') return;
  let offset = 0;
  while (offset < obj.body.length) {
    const space = obj.body.indexOf(32, offset);
    const mode = obj.body.toString('ascii', offset, space);
    const nul = obj.body.indexOf(0, space);
    const name = obj.body.toString('utf8', space + 1, nul);
    const entrySha = obj.body.slice(nul + 1, nul + 21).toString('hex');
    const full = prefix ? `${prefix}/${name}` : name;
    if (full.includes('ASSETS UE/secretbase')) out.push({ path: full, sha: entrySha, mode });
    if (mode.startsWith('40')) walkTree(entrySha, full, out);
    offset = nul + 21;
    offset += (8 - (offset % 8)) % 8;
  }
}

const head = fs.readFileSync(path.join(GIT, 'refs', 'heads', 'main'), 'utf8').trim();
const treeSha = readObject(head).body.toString().match(/tree ([0-9a-f]{40})/)[1];
const gitFiles = [];
walkTree(treeSha, '', gitFiles);

let restored = 0, skipped = 0;
for (const f of gitFiles) {
  if (!f.mode.startsWith('100')) continue;
  const rel = f.path.replace(/^assets\//, '');
  const out = path.join(ROOT, 'assets', rel.replace(/\//g, path.sep));
  const blob = readObject(f.sha);
  if (!blob) continue;
  if (!fs.existsSync(out)) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, blob.body);
    restored++;
  } else {
    skipped++;
  }
}
console.log('secretbase restore: skipped', skipped, 'restored', restored);
