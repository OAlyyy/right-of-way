/* Downloads the player's car: the Khronos "Car Concept" sample model
   ((c) 2024 Darmstadt Graphics Group GmbH, model and textures by Eric
   Chadwick, CC-BY 4.0). It is fetched by the game on its own at run time
   (12 MB - too big to pack into the page).
     node tools/fetch-car.js                                          */
const fs = require('fs'), path = require('path');
const URL = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/glTF-Binary/CarConcept.glb';
(async () => {
  const r = await fetch(URL);
  if (!r.ok) throw new Error(URL + ' -> ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  const dest = path.join(__dirname, '..', 'assets', 'models', 'car_concept.glb');
  fs.mkdirSync(path.dirname(dest), { recursive:true });
  fs.writeFileSync(dest, buf);
  console.log((buf.length/1024/1024).toFixed(1) + ' MB  assets/models/car_concept.glb');
})();
