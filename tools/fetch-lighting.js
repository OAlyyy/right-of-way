/* Downloads what the "High" graphics use: the three.js post-processing
   add-ons (r147 classic builds, MIT) and two sky photos from Poly Haven
   (CC0) for real lighting and reflections - a German street by day, a
   German square at night.
     node tools/fetch-lighting.js   then   node tools/shrink-hdr.js      */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const EX = 'https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/';
const PH = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/';
const FILES = {
  'js/vendor/RGBELoader.js':               EX + 'loaders/RGBELoader.js',
  'js/vendor/Pass.js':                     EX + 'postprocessing/Pass.js',
  'js/vendor/UnrealBloomPass.js':          EX + 'postprocessing/UnrealBloomPass.js',
  'js/vendor/CopyShader.js':               EX + 'shaders/CopyShader.js',
  'js/vendor/LuminosityHighPassShader.js': EX + 'shaders/LuminosityHighPassShader.js',
  'js/vendor/FXAAShader.js':               EX + 'shaders/FXAAShader.js',
  'assets/src/sky_day.hdr':   PH + 'german_town_street_1k.hdr',
  'assets/src/sky_night.hdr': PH + 'hansaplatz_1k.hdr'
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
