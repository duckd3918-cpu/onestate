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
  const header = data.toString('ascii', 0, nul);
  return { type: header.split(' ')[0], body: data.slice(nul + 1) };
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
const commit = readObject(head);
const treeSha = commit.body.toString().match(/tree ([0-9a-f]{40})/)[1];
const gitFiles = [];
walkTree(treeSha, '', gitFiles);

let restored = 0, ok = 0;
const fenceOnly = /SM_Fence_[45]|Mat_Fence_1|T_Fence_1|Mat_Steel_[12]\.|T_Steel_1_|Mat_Concrete_4\.|T_Concrete_4_/;
for (const f of gitFiles) {
  if (!f.mode.startsWith('100')) continue;
  if (!fenceOnly.test(f.path)) continue;
  const rel = f.path.replace(/^assets\//, '');
  const out = path.join(ROOT, 'assets', rel.replace(/\//g, path.sep));
  const blob = readObject(f.sha);
  if (!blob) continue;
  if (!fs.existsSync(out)) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, blob.body);
    console.log('RESTORED', rel);
    restored++;
  } else {
    ok++;
  }
}
console.log('Existing:', ok, 'Restored:', restored);

// Force reimport fences: delete library cache + set imported=false
const fenceUuids = [
  '9356c2b5-3d9d-4b00-aae8-72772671d49f',
  '61242b20-bd3e-4dc7-99d0-08c293952d66',
];
const lib = path.join(ROOT, 'library');
let libDeleted = 0;
for (const uuid of fenceUuids) {
  const prefix = uuid.slice(0, 2);
  const dir = path.join(lib, prefix);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(uuid)) {
      fs.unlinkSync(path.join(dir, f));
      libDeleted++;
    }
  }
}
console.log('Deleted library cache files:', libDeleted);

for (const name of ['SM_Fence_4.gltf.meta', 'SM_Fence_5.gltf.meta']) {
  const metaPath = path.join(ROOT, 'assets', 'ASSETS UE', 'secretbase', 'Meshes', name);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  meta.imported = false;
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
  console.log('Marked for reimport:', name);
}
