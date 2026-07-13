const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = 'C:\\Users\\Miras\\onestate';
const GIT = path.join(ROOT, '.git');
const UE = path.join(ROOT, 'assets', 'ASSETS UE', 'secretbase');

function readObject(sha) {
  const file = path.join(GIT, 'objects', sha.slice(0, 2), sha.slice(2));
  if (!fs.existsSync(file)) return null;
  const data = zlib.inflateSync(fs.readFileSync(file));
  const nul = data.indexOf(0);
  const header = data.toString('ascii', 0, nul);
  const body = data.slice(nul + 1);
  return { type: header.split(' ')[0], body };
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
    if (full.includes('ASSETS UE/secretbase') && /Fence|Mat_Fence|Mat_Steel|Mat_Concrete_4|T_Fence|T_Steel_1|T_Concrete_4/i.test(full)) {
      out.push({ path: full, sha: entrySha, mode });
    }
    if (mode.startsWith('40')) walkTree(entrySha, full, out);
    offset = nul + 21;
    offset += (8 - (offset % 8)) % 8;
  }
}

const head = fs.readFileSync(path.join(GIT, 'refs', 'heads', 'main'), 'utf8').trim();
const commit = readObject(head);
const treeSha = commit.body.toString().match(/tree ([0-9a-f]{40})/)[1];
const gitFiles = [];
walkTree(treeSha, '', gitFiles);

let restored = 0, ok = 0, missing = [];
for (const f of gitFiles) {
  if (!f.mode.startsWith('100')) continue;
  const rel = f.path.replace(/^assets\//, '');
  const out = path.join(ROOT, 'assets', rel.replace(/\//g, path.sep));
  const blob = readObject(f.sha);
  if (!blob) continue;
  if (!fs.existsSync(out) || fs.statSync(out).size !== blob.body.length) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, blob.body);
    console.log('RESTORED', rel, blob.body.length);
    restored++;
  } else {
    ok++;
  }
}
console.log('OK:', ok, 'Restored:', restored);

// List git fence mesh files
const meshes = gitFiles.filter(f => /SM_Fence_[45]/.test(f.path) && f.mode.startsWith('100'));
console.log('\nGit fence files:', meshes.map(m => m.path).join('\n'));
