/* Where does the crossing car land on screen, and when?
   Confirms that traffic you must give way to is actually visible,
   straight ahead or after a head check.   node test/pov-probe.js       */
const fs = require('fs'), vm = require('vm'), path = require('path');
const sandbox = {
  console, Math, Object, Array, JSON, Number, String, isFinite,
  window:{ devicePixelRatio:1 },
  document:{ createElement(){ return { getContext:() => ({}), style:{} }; } }
};
const c = vm.createContext(sandbox);
['i18n.js','geo.js','rules.js','signs.js','sim.js','scenarios.js','render.js','pov.js']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',f),'utf8'), c, { filename:f }));
const { Sim, SCENARIOS, CFG, POV } = c;

const W = 900, H = 620;
const FOV = 78 * Math.PI/180;          // must match pov.js
const F = (W/2)/Math.tan(FOV/2);

/* re-implement the projection here so the probe is independent of the
   drawing code and would catch a change in one but not the other */
function screenX(world, other, yaw){
  const p = world.player;
  const cc = Math.cos(p.pos.h), ss = Math.sin(p.pos.h);
  const ex = p.pos.x + cc*(p.len*0.10) + ss*(p.wid*0.20);
  const ey = p.pos.y + ss*(p.len*0.10) - cc*(p.wid*0.20);
  const hh = p.pos.h + yaw;
  const dx = other.pos.x - ex, dy = other.pos.y - ey;
  const f = dx*Math.cos(hh) + dy*Math.sin(hh);
  const r = dx*(-Math.sin(hh)) + dy*Math.cos(hh);
  if (f < 9) return null;
  return { x: W/2 + F*r/f, dist: Math.round(f/CFG.PPM) };
}

const rows = [];
for (const sc of SCENARIOS){
  if (!sc.traffic || !sc.traffic.length) continue;
  const w = new Sim.World(sc);
  const input = { throttle:false, brake:false, indicator:'off' };
  let seenAhead = null, seenLook = null;
  for (let i = 0; i < 60*10; i++){
    w.update(1/60, input);
    if (w.state !== 'run') break;
    const t = i/60;
    for (const o of w.vehicles){
      if (o.isPlayer || o.done) continue;
      const a = screenX(w, o, 0);
      if (a && a.x > 0 && a.x < W && seenAhead === null) seenAhead = { t, d:a.dist };
      for (const yaw of [-1.25, 1.25]){
        const b = screenX(w, o, yaw);
        if (b && b.x > 0 && b.x < W && seenLook === null) seenLook = { t, d:b.dist, yaw };
      }
    }
  }
  rows.push([sc.id, seenAhead, seenLook]);
}
console.log('lesson                first visible straight ahead   first visible on a head check');
console.log('-'.repeat(88));
let blind = 0;
for (const [id, a, b] of rows){
  const A = a ? ('t=' + a.t.toFixed(1) + 's at ' + a.d + ' m') : 'never';
  const B = b ? ('t=' + b.t.toFixed(1) + 's at ' + b.d + ' m') : 'never';
  if (!a && !b) blind++;
  console.log(id.padEnd(22) + A.padEnd(31) + B);
}
console.log('-'.repeat(88));
console.log(blind === 0
  ? 'every lesson shows its traffic before the junction'
  : blind + ' lesson(s) hide their traffic entirely');
