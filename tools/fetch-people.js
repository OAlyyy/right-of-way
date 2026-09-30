/* Downloads the people models and the three.js add-ons to load them.
     node tools/fetch-people.js
   People: "Animated Men Pack" by Quaternius (CC0), via poly.pizza.
   GLTFLoader / SkeletonUtils: three.js r147 (MIT), classic builds.   */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const THREE = 'https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/';
const FILES = {
  'js/vendor/GLTFLoader.js':    THREE + 'loaders/GLTFLoader.js',
  'js/vendor/SkeletonUtils.js': THREE + 'utils/SkeletonUtils.js',
  'assets/models/man_suit.glb':    'https://static.poly.pizza/66b57880-bcb0-479a-8d72-5c3e88afaa39.glb',
  'assets/models/man.glb':         'https://static.poly.pizza/3746be88-6799-4817-929b-6bc067c47caa.glb',
  'assets/models/man_sleeves.glb': 'https://static.poly.pizza/e6019b9f-aed0-400c-8df4-ce5b648e9b82.glb'
};
(async () => {
  for (const [out, url] of Object.entries(FILES)){
    const r = await fetch(url, { headers:{ 'User-Agent':'right-of-way-dev/1.0' } });
    if (!r.ok) throw new Error(url + ' -> ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    const dest = path.join(ROOT, out);
    fs.mkdirSync(path.dirname(dest), { recursive:true });
    fs.writeFileSync(dest, buf);
    console.log((buf.length/1024).toFixed(0).padStart(6) + ' kB  ' + out);
  }
})();
