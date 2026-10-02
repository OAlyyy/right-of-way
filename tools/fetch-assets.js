/* Downloads the third-party files the 3D view uses. Run once:
     node tools/fetch-assets.js
   then  powershell -File tools/shrink-textures.ps1   (512 px copies)
   then  node tools/pack-assets.js                    (js/vendor/assets.js)

   three.js r147 (MIT) - the last release that still ships the classic
   non-module builds, which lets the game keep loading plain <script>s,
   run from file:// and bundle into one HTML file.
   Textures from Poly Haven (CC0, https://polyhaven.com).            */
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const THREE = 'https://cdn.jsdelivr.net/npm/three@0.147.0/';
const FILES = {
  'js/vendor/three.min.js':        THREE + 'build/three.min.js',
  'js/vendor/RoomEnvironment.js':  THREE + 'examples/js/environments/RoomEnvironment.js',
  'js/vendor/Sky.js':              THREE + 'examples/js/objects/Sky.js',
  'js/vendor/THREE-LICENSE.txt':   THREE + 'LICENSE'
};
const PH = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/';
const TEXTURES = {
  asphalt: 'asphalt_02',
  pavers:  'square_concrete_pavers',
  gravel:  'rocky_gravel',
  plaster: 'white_plaster_rough_01',
  roof:    'clay_roof_tiles_02',
  grass:   'leafy_grass',
  bark:    'bark_brown_02'
};
for (const [name, id] of Object.entries(TEXTURES)){
  FILES['assets/src/' + name + '_diff.jpg'] = PH + id + '/' + id + '_diff_1k.jpg';
  FILES['assets/src/' + name + '_nor.jpg']  = PH + id + '/' + id + '_nor_gl_1k.jpg';
}

(async () => {
  for (const [out, url] of Object.entries(FILES)){
    const dest = path.join(ROOT, out);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const r = await fetch(url, { headers: { 'User-Agent': 'kreuzungstrainer-dev/1.0' } });
    if (!r.ok) throw new Error(url + ' -> ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(dest, buf);
    console.log((buf.length/1024).toFixed(0).padStart(6) + ' kB  ' + out);
  }
})();
