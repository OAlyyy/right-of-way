/* Renders one frame of every scenario against a stub 2D context.
   Catches missing functions and NaN / Infinity coordinates, which show up
   in a real browser as an invisible or badly broken picture.
   Run with:  node test/render-check.js                                  */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let problems = [];
let current = '';

function stubCtx(){
  const rec = {
    canvas:{ width:900, height:620 },
    globalAlpha:1, shadowBlur:0
  };
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
['i18n.js','geo.js','rules.js','signs.js','sim.js','scenarios.js','render.js','pov.js'].forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',f),'utf8'), ctxv, { filename:f });
});
const { Sim, SCENARIOS, Render, Signs, POV, I18N } = ctxv;

const c = stubCtx();
for (const sc of SCENARIOS){
  const w = new Sim.World(sc);
  current = sc.id;
  /* one frame at the start (briefing preview), then a few seconds in */
  Render.frame(c, 900, 620, w, true);
  POV.frame(c, 900, 620, w, 0);
  const input = { throttle:true, brake:false, indicator:'left' };
  for (let i=0;i<60*6;i++) w.update(1/60, input);
  Render.frame(c, 900, 620, w, false);
  /* the driver view, straight ahead and with the head turned both ways */
  for (const yaw of [0, -1.25, 1.25, 0.6]) POV.frame(c, 900, 620, w, yaw);
  POV.frame(c, 380, 680, w, 0);        // phone portrait
  /* both languages must resolve every hint and fault */
  for (const lang of ['en','de']){
    I18N.set(lang);
    const h = w.hint();
    if (h && !I18N.pick(h)) problems.push(current+': hint has no '+lang+' text');
    for (const f of w.report().faults){
      if (!I18N.pick(f.def.title)) problems.push(current+': fault '+f.id+' has no '+lang+' title');
      if (!I18N.pick(f.def.why))   problems.push(current+': fault '+f.id+' has no '+lang+' why');
      if (!I18N.pick(f.def.tip))   problems.push(current+': fault '+f.id+' has no '+lang+' tip');
      if (f.detail && !I18N.pick(f.detail)) problems.push(current+': fault '+f.id+' detail missing '+lang);
    }
    const sc2 = w.sc;
    if (!I18N.pick({de:sc2.title,en:sc2.en})) problems.push(current+': no '+lang+' title');
    if (!I18N.pick({de:sc2.task,en:sc2.taskEn})) problems.push(current+': no '+lang+' task');
    if (!I18N.pick({de:sc2.merksatz,en:sc2.merksatzEn})) problems.push(current+': no '+lang+' merksatz');
  }
  I18N.set('en');
}
/* every sign type must draw */
current = 'signs';
for (const t of Object.keys(Signs.LABEL)) Signs.render(c, t, 40, 40, 50);

if (problems.length){
  const seen = new Set();
  problems.filter(p => !seen.has(p) && seen.add(p)).slice(0,40).forEach(p => console.log('  ' + p));
  console.log(problems.length + ' rendering problem(s)');
  process.exit(1);
}
console.log('render: ' + SCENARIOS.length + ' scenarios + ' +
            Object.keys(Signs.LABEL).length + ' signs drew cleanly');
