/* Headless test harness.
   Loads the game logic (no DOM needed) and drives every scenario with two
   scripted drivers:
     "careful"  - gives way whenever the rules require it   -> expect 0 faults
     "reckless" - full throttle, no indicator, never yields -> expect a fault
   Run with:  node test/harness.js
*/
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ctx = vm.createContext({ console, Math, Object, Array, JSON, Number, String });
['geo.js','rules.js','sim.js','scenarios.js'].forEach(f => {
  const src = fs.readFileSync(path.join(__dirname,'..','js',f),'utf8');
  vm.runInContext(src, ctx, { filename:f });
});
const { Sim, SCENARIOS, Rules, Geo, kmh, toKmh, CFG } = ctx;

const DT = 1/60;

function drive(sc, policy, maxT = 90){
  const w = new Sim.World(sc);
  const input = { throttle:false, brake:false, indicator:'off' };
  let steps = 0;
  while (w.state === 'run' && steps*DT < maxT){
    policy(w, input);
    w.update(DT, input);
    steps++;
  }
  return w;
}

/* ---- careful driver ---- */
function careful(w, input){
  const p = w.player, sc = w.sc;
  const turn = Geo.turnOf(p.fromArm, p.toArm);

  if (sc.layout.type === 'roundabout')
    input.indicator = p.s > p.path.length - 300 ? 'right' : 'off';
  else if (turn !== 'straight' && p.s > p.junctionS - 260)
    input.indicator = turn;
  else input.indicator = 'off';

  const sign = Rules.signOf(sc, p.fromArm);
  const light = w.light(p.fromArm);
  const arrow = Rules.hasGreenArrow(sc, p.fromArm) && turn === 'right';

  let mustStopAtLine = false;
  if (p.s < p.lineS){
    if (light === 'red' || light === 'redyellow') mustStopAtLine = true;
    if (sign === 'stop' && !p.didStop) mustStopAtLine = true;
    if (arrow && light === 'red' && !p.didStop) mustStopAtLine = true;
    if (w.mustGiveWayHere()) mustStopAtLine = true;
  }
  /* pedestrians: stop before the crossing */
  let pedStop = null;
  for (const ped of w.peds){
    const cs = (ped.arm === p.fromArm && p.crossS !== undefined) ? p.crossS
             : (ped.arm === p.toArm && p.exitCrossS !== undefined) ? p.exitCrossS : null;
    if (cs === null || p.s >= cs) continue;
    const blocking = (ped.state === 'walking' && ped.onRoad()) ||
                     (ped.state === 'waiting' && ped.intent);
    if (blocking) pedStop = cs - 16;
  }

  let targetS = null;
  if (mustStopAtLine) targetS = p.lineS - 6;
  if (pedStop !== null) targetS = targetS === null ? pedStop : Math.min(targetS, pedStop);

  const inZone = sc.walkingPace && p.s < p.lineS;
  let want = kmh(inZone ? 6 : Math.min(sc.limit, 45));

  /* a good driver slows down for the bend instead of taking it flat out */
  want = Math.min(want, w.curveSpeed(p, p.s)*1.15);

  /* and keeps a distance from whatever is directly ahead in the lane */
  for (const o of w.vehicles){
    if (o === p || o.done) continue;
    const dx = o.pos.x - p.pos.x, dy = o.pos.y - p.pos.y;
    const c = Math.cos(p.pos.h), sn = Math.sin(p.pos.h);
    const lon = dx*c + dy*sn, lat = -dx*sn + dy*c;
    if (lon <= 0 || Math.abs(lat) > 34) continue;
    const gap = lon - (p.len + o.len)/2 - 20;
    want = Math.min(want, Math.max(0, Math.sqrt(2*CFG.BRAKE*0.5*Math.max(0,gap))));
  }
  if (targetS !== null){
    const d = targetS - p.s;
    want = d <= 0 ? 0 : Math.min(want, Math.sqrt(2*CFG.BRAKE*0.55*Math.max(0,d)));
  }
  input.throttle = p.v < want - 3;
  input.brake    = p.v > want + 3;
}

/* ---- reckless driver ---- */
function reckless(w, input){
  input.indicator = 'off';
  input.brake = false;
  input.throttle = toKmh(w.player.v) < w.sc.limit + 2;
}

/* ---- expectations for the reckless run ---- */
const EXPECT = {
  'rvl-rechts':'vorfahrt', 'rvl-links':null, 'rvl-drei':'vorfahrt',
  'vorfahrt-gewaehren':'vorfahrt', 'stop':'stop_kein_halt',
  'vorfahrtstrasse':null, 'links-gegenverkehr':'vorfahrt',
  'abknickend':null, 'zebra':'fussgaenger', 'zebra-abbiegen':'abbiegen_fussgaenger',
  'ampel-rot':'rotlicht', 'ampel-links':'vorfahrt', 'gruenpfeil':'gruenpfeil_kein_halt',
  'kreisverkehr':'vorfahrt', 'strassenbahn':'vorfahrt', 'bus':'bus_behindert',
  'einsatzfahrzeug':'einsatz_blockiert', 'spielstrasse':'schritt', 'zone30':'vorfahrt'
};

let bad = 0;
console.log('scenario              careful                              reckless');
console.log('-'.repeat(96));
for (const sc of SCENARIOS){
  const a = drive(sc, careful);
  const b = drive(sc, reckless);
  const af = a.faults.map(f=>f.id);
  const bf = b.faults.map(f=>f.id);
  const okA = af.length === 0 && a.endReason === 'ziel';
  const want = EXPECT[sc.id];
  const okB = want === null ? true : bf.includes(want);
  if (!okA || !okB) bad++;
  console.log(
    sc.id.padEnd(21),
    ((okA?'OK  ':'FAIL') + ' ' + (a.endReason||'-') + ' [' + af.join(',') + ']').padEnd(37),
    (okB?'OK  ':'FAIL') + ' want=' + want + ' got=[' + bf.join(',') + ']'
  );
}
console.log('-'.repeat(96));
console.log(bad === 0 ? 'ALL GOOD' : bad + ' scenario(s) need attention');
