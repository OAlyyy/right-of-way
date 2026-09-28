/* Rasterises the driver view into text so the projection can be eyeballed
   without a browser.  node test/pov-ascii.js [scenarioId] [yaw] [seconds]  */
const fs = require('fs'), vm = require('vm'), path = require('path');

const COLS = 96, ROWS = 34;
const grid = [], legend = new Map();
let chars = '.:-=+*#%@ABCDEFGHJKLMNPQRSTUVWXYZ';

function reset(){
  grid.length = 0;
  for (let y = 0; y < ROWS; y++) grid.push(new Array(COLS).fill(' '));
}
function charFor(style){
  if (typeof style !== 'string') return null;   // gradients are overlays; skip
  if (style.indexOf('rgba') === 0 && /,\s*0(\.\d+)?\)/.test(style)) return null; // faint overlay
  if (!legend.has(style)) legend.set(style, chars[legend.size % chars.length]);
  return legend.get(style);
}
function fillPolyGrid(pts, ch){
  if (!ch || pts.length < 3) return;
  let ymin = Math.max(0, Math.floor(Math.min(...pts.map(p => p[1]))));
  let ymax = Math.min(ROWS - 1, Math.ceil(Math.max(...pts.map(p => p[1]))));
  for (let y = ymin; y <= ymax; y++){
    const yc = y + 0.5, xs = [];
    for (let i = 0; i < pts.length; i++){
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)){
        xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2){
      const x0 = Math.max(0, Math.round(xs[i])), x1 = Math.min(COLS - 1, Math.round(xs[i + 1]));
      for (let x = x0; x <= x1; x++) grid[y][x] = ch;
    }
  }
}

function makeCtx(w, h){
  const sx = COLS / w, sy = ROWS / h;
  let cur = [], style = '#000';
  const noop = () => {};
  const ctx = {
    canvas:{ width:w, height:h },
    set fillStyle(v){ style = v; }, get fillStyle(){ return style; },
    strokeStyle:'', lineWidth:1, font:'', textAlign:'', textBaseline:'',
    lineCap:'', lineJoin:'', shadowColor:'', shadowBlur:0, globalAlpha:1,
    save:noop, restore:noop, stroke:noop, clip:noop, setLineDash:noop,
    translate:noop, rotate:noop, scale:noop, setTransform:noop, transform:noop,
    clearRect:noop, strokeRect:noop, fillText:noop, strokeText:noop,
    measureText:() => ({ width:6 }),
    createLinearGradient:() => ({ addColorStop:noop }),
    createRadialGradient:() => ({ addColorStop:noop }),
    beginPath(){ cur = []; },
    closePath(){},
    moveTo(x, y){ cur.push([x * sx, y * sy]); },
    lineTo(x, y){ cur.push([x * sx, y * sy]); },
    arc(x, y, r){ for (let i = 0; i < 12; i++){ const a = i / 12 * Math.PI * 2;
      cur.push([(x + Math.cos(a) * r) * sx, (y + Math.sin(a) * r) * sy]); } },
    ellipse(x, y, rx, ry){ for (let i = 0; i < 12; i++){ const a = i / 12 * Math.PI * 2;
      cur.push([(x + Math.cos(a) * rx) * sx, (y + Math.sin(a) * ry) * sy]); } },
    arcTo(){}, quadraticCurveTo(cx, cy, x, y){ cur.push([x * sx, y * sy]); },
    bezierCurveTo(a, b, c2, d, x, y){ cur.push([x * sx, y * sy]); },
    rect(x, y, ww, hh){ cur = [[x*sx,y*sy],[(x+ww)*sx,y*sy],[(x+ww)*sx,(y+hh)*sy],[x*sx,(y+hh)*sy]]; },
    fill(){ fillPolyGrid(cur, charFor(style)); },
    fillRect(x, y, ww, hh){
      fillPolyGrid([[x*sx,y*sy],[(x+ww)*sx,y*sy],[(x+ww)*sx,(y+hh)*sy],[x*sx,(y+hh)*sy]], charFor(style));
    },
    drawImage(img, x, y, ww, hh){
      fillPolyGrid([[x*sx,y*sy],[(x+ww)*sx,y*sy],[(x+ww)*sx,(y+hh)*sy],[x*sx,(y+hh)*sy]], charFor('IMG'));
    }
  };
  return ctx;
}

const sandbox = {
  console, Math, Object, Array, JSON, Number, String, isFinite,
  window:{ devicePixelRatio:1 },
  /* offscreen sprite canvases must NOT paint into the ASCII grid */
  document:{ createElement(){
    const noop = () => {};
    const nul = new Proxy({}, { get:(t, k) =>
      (k === 'measureText') ? () => ({ width:6 }) :
      (k === 'createLinearGradient' || k === 'createRadialGradient') ? () => ({ addColorStop:noop }) :
      (k === 'canvas') ? { width:64, height:64 } : noop });
    return { getContext:() => nul, style:{}, width:64, height:64 };
  } }
};
const c = vm.createContext(sandbox);
['i18n.js','geo.js','rules.js','signs.js','sim.js','scenarios.js','render.js','pov.js']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',f),'utf8'), c, { filename:f }));

const id   = process.argv[2] || 'rvl-rechts';
const yaw  = parseFloat(process.argv[3] || '0');
const secs = parseFloat(process.argv[4] || '3');

const sc = c.SCENARIOS.find(s => s.id === id) || c.SCENARIOS[0];
const w = new c.Sim.World(sc);
const input = { throttle:false, brake:false, indicator:'off' };
for (let i = 0; i < secs * 60; i++) w.update(1/60, input);

reset();
const ctx = makeCtx(900, 620);
c.POV.frame(ctx, 900, 620, w, yaw);
console.log('=== ' + sc.id + '  yaw=' + yaw + '  t=' + secs + 's  speed=' +
            Math.round(c.toKmh(w.player.v)) + ' km/h ===');
console.log('+' + '-'.repeat(COLS) + '+');
grid.forEach(r => console.log('|' + r.join('') + '|'));
console.log('+' + '-'.repeat(COLS) + '+');
console.log([...legend.entries()].map(([k, v]) => v + '=' + k).join('  '));
