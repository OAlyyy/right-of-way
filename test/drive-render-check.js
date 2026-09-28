/* Renders the open world through the same stub canvas as render-check.js,
   across several junction kinds (cross, priority, rvl, roundabout,
   lights) and both views, for a handful of seeds and a stretch of drive
   time. Catches NaN/Infinity geometry and, more importantly, verifies the
   junction the camera and ground are drawn around actually matches the
   one the player's rule engine is using - the two used to disagree
   silently, since the ground math assumed the junction always sat at the
   world origin.                                    node test/drive-render-check.js */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let problems = [];
let current = '';

function stubCtx(){
  const rec = { canvas:{ width:900, height:620 }, globalAlpha:1, shadowBlur:0 };
  const methods = ['save','restore','beginPath','closePath','moveTo','lineTo','arc','arcTo',
    'ellipse','rect','fill','stroke','fillRect','strokeRect','clearRect','translate','rotate',
    'scale','setTransform','transform','fillText','strokeText','setLineDash','getLineDash',
    'measureText','createLinearGradient','createRadialGradient','createPattern',
    'drawImage','quadraticCurveTo','bezierCurveTo','clip'];
  for (const m of methods){
    rec[m] = function(){
      for (const a of arguments){
        if (typeof a === 'number' && !isFinite(a))
          problems.push(current + ': ' + m + '() got ' + a);
      }
      if (m === 'measureText') return { width:10 };
      if (m === 'createLinearGradient' || m === 'createRadialGradient')
        return { addColorStop(){} };
      return undefined;
    };
  }
  for (const p of ['fillStyle','strokeStyle','lineWidth','font','textAlign','textBaseline',
                   'lineCap','lineJoin','shadowColor','globalCompositeOperation']){
    let v = null;
    Object.defineProperty(rec, p, {
      get(){ return v; },
      set(x){
        if (typeof x === 'number' && !isFinite(x)) problems.push(current+': '+p+' = '+x);
        if (x === undefined) problems.push(current+': '+p+' = undefined');
        v = x;
      }
    });
  }
  return rec;
}

const sandbox = {
  console, Math, Object, Array, JSON, Number, String, isFinite,
  window:{ devicePixelRatio:1 },
  document:{ createElement(){ return { getContext:()=>stubCtx(), style:{} }; } }
};
const ctxv = vm.createContext(sandbox);
['i18n.js','geo.js','rules.js','signs.js','sim.js','scenarios.js','city.js','drive.js','cityview.js','render.js','pov.js']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',f),'utf8'), ctxv, { filename:f }));
const { Drive, Render, POV } = ctxv;
const careful = require('./drive-policy.js')(ctxv);

const c = stubCtx();
const kindsSeen = new Set();
const DT = 1/60;

/* the random towns, then the Frankfurt map (houses, trees, U-Bahn) */
for (const [seed, preset] of [[1], [3], [4], [7], [2, 'eschersheim'], [9, 'eschersheim']]){
  const w = new Drive.DriveWorld({ seed, target: 99999, preset });
  const input = { throttle:false, brake:false, indicator:'off' };
  current = 'seed' + seed + ' @0s';
  Render.frame(c, 900, 620, w, false);
  POV.frame(c, 900, 620, w, 0);

  for (let i = 0; i < 60*200; i++){
    if (w.paused) w.resume();
    careful(w, input);
    w.update(DT, input);

    if (i % 90 === 0){
      current = 'seed' + seed + ' @' + w.t.toFixed(0) + 's';
      const node = w.junctionFor(w.player);
      kindsSeen.add(node.layout.type === 'roundabout' ? 'roundabout' : (node.kind || 'cross'));
      if (typeof w.map.streetName(node, node.arms[0]) !== 'string')
        problems.push(current + ': streetName() did not return a string');

      /* The camera/ground must be built around the SAME junction the rule
         engine is judging the player against right now - not the origin,
         and not some other node - or the picture and the rules disagree. */
      const before = { x: node.x || 0, y: node.y || 0 };
      Render.frame(c, 900, 620, w, false);
      const after = w.junctionFor(w.player);
      if (after !== node && Math.hypot((after.x||0)-before.x, (after.y||0)-before.y) > 1200)
        problems.push(current + ': junction moved implausibly far between frame and check');

      POV.frame(c, 900, 620, w, 0);
      POV.frame(c, 900, 620, w, 1.25);
      POV.frame(c, 380, 680, w, 0);
    }
  }
}

if (!kindsSeen.has('roundabout') || kindsSeen.size < 4)
  problems.push('only saw junction kinds: ' + Array.from(kindsSeen).join(',') + ' - widen the seed/time sweep');

if (problems.length){
  const seen = new Set();
  problems.filter(p => !seen.has(p) && seen.add(p)).slice(0,40).forEach(p => console.log('  ' + p));
  console.log(problems.length + ' rendering problem(s)');
  process.exit(1);
}
console.log('drive-render: 4 random towns + Frankfurt twice, junction kinds seen: ' + Array.from(kindsSeen).join(', '));
