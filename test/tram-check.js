/* The Frankfurt map (Weißer Stein) with its U-Bahn: a careful driver is
   never accused, the trains keep running end to end, nobody - the player
   or the town's own traffic - drives into a train, and a driver who turns
   across the tracks without looking gets booked for it.
                                               node test/tram-check.js   */
const fs = require('fs'), vm = require('vm'), path = require('path');

const ctx = vm.createContext({ console, Math, Object, Array, JSON, Number, String, Date });
['i18n.js','geo.js','rules.js','sim.js','scenarios.js','city.js','drive.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',f),'utf8'), ctx, { filename:f }));
const { Drive, Rules, Geo, kmh, toKmh } = ctx;

const DT = 1/60;
const careful = require('./drive-policy.js')(ctx);
const ACCUSATION = id => Rules.FAULTS[id].sev === 'major' && id !== 'kollision';

let problems = 0;
function fail(msg){ problems++; console.log('  FAIL ' + msg); }

/* bodies touching, the same test the game uses for the player */
function touching(a, b){
  const circ = v => {
    const c = Math.cos(v.pos.h), s = Math.sin(v.pos.h), n = Math.max(2, Math.round(v.len/26)), out = [];
    for (let i = 0; i < n; i++){ const t = (i/(n-1) - 0.5)*(v.len - v.wid); out.push({ x:v.pos.x + c*t, y:v.pos.y + s*t, r:v.wid/2 }); }
    return out;
  };
  for (const p of circ(a)) for (const q of circ(b))
    if (Math.hypot(p.x-q.x, p.y-q.y) < p.r + q.r - 3) return true;
  return false;
}

function run(seed, minutes, policy){
  const w = new Drive.DriveWorld({ seed, target:9999, preset:'eschersheim' });
  const input = { throttle:false, brake:false, indicator:'off' };
  const finished = new Set(), seen = new Set(), stuck = {};
  let tramHits = 0, worstTramHalt = 0, yields = 0, railNodes = 0;
  const hitPairs = new Set();
  for (let i = 0; i < 60*60*minutes; i++){
    if (w.paused) w.resume();
    policy(w, input);
    w.update(DT, input);
    if (w.player.node && w.player.node.rail) railNodes++;
    for (const v of w.vehicles){
      if (v.kind !== 'tram') continue;
      seen.add(v.id);
      if (v.s >= v.path.length - 20) finished.add(v.id);
      stuck[v.id] = v.v < kmh(2) ? (stuck[v.id] || 0) + DT : 0;
      worstTramHalt = Math.max(worstTramHalt, stuck[v.id]);
      for (const o of w.vehicles){
        if (o === v || o.kind === 'tram' || o.isPlayer || o.done) continue;
        if (o.brakeCause === v && o.brakeKind === 'yield') yields++;
        if (touching(v, o) && !hitPairs.has(v.id + o.id)){ hitPairs.add(v.id + o.id); tramHits++; }
      }
    }
  }
  return { w, finished:finished.size, seen:seen.size, tramHits, worstTramHalt, yields, railNodes };
}

console.log('seed  careful driver                          trains run/done  town cars into trains  cars yielded');
console.log('-'.repeat(100));
for (const seed of [1, 7, 12, 42, 91]){
  const a = run(seed, 4, careful);
  const acc = a.w.faults.filter(f => ACCUSATION(f.id));
  const tally = {};
  for (const f of a.w.faults) tally[f.id] = (tally[f.id] || 0) + 1;
  if (acc.length) fail('seed ' + seed + ': careful driver accused: ' + acc.map(f => f.id + '/' + f.reason).join(' '));
  if (a.w.faults.some(f => f.id === 'kollision')) fail('seed ' + seed + ': careful driver collided');
  if (a.tramHits) fail('seed ' + seed + ': ' + a.tramHits + ' town car(s) drove into a train');
  if (a.finished < 3) fail('seed ' + seed + ': only ' + a.finished + ' trains completed the line');
  if (a.worstTramHalt > 45) fail('seed ' + seed + ': a train stood for ' + a.worstTramHalt.toFixed(0) + 's');
  console.log(String(seed).padEnd(6) +
    (a.w.cleared + ' junctions, ' + (Object.entries(tally).map(([k,v]) => k + '×' + v).join(' ') || 'clean')).padEnd(40) +
    (a.seen + '/' + a.finished).padEnd(17) + String(a.tramHits).padEnd(23) + Math.round(a.yields/60) + ' s');
}

/* Turning across the tracks on green, a train coming up beside you:
   staged at Lindenbaum, the player turning right off Eschersheimer
   Landstraße just as a northbound train arrives. A driver who only
   watches the lights must be booked under Sec. 9 (3); a careful driver
   waits for the train and is not. */
const { Sim } = ctx;
function staged(policy, lead){
  const w = new Drive.DriveWorld({ seed:5, target:9999, preset:'eschersheim' });
  const m = w.map, n = m.nodeAt(2, 2);
  const built = m.routePath([{ node:n, from:'S', to:'E' }, { node:m.nodeAt(3, 2), from:'W', to:'E' }]);
  const p = w.player;
  p.path = built.path; p.prof = Sim.curveProfile(p.path); p.steps = built.steps;
  p.stepIdx = 0; p.s = 0; p.prevS = 0; p.v = kmh(30);
  w.syncStep(p, true); p.pos = p.path.at(0);
  w.vehicles = [p];
  n.lights.t0 = -w.t;                        // main road just turned green
  w.nextTram = { S:1e9, N:1e9 };             // only our train
  const tram = w.spawnTram('N', 0);
  tram.stepIdx = tram.steps.findIndex(st => st.node === n);
  w.syncStep(tram, true);
  const c = w.conflictBetween(p, tram);
  const tPlayer = (c.sa - p.s) / kmh(30);
  tram.s = c.sb - (tPlayer + lead) * tram.v; tram.pos = tram.path.at(tram.s);
  w.syncStep(tram, true);
  const input = { throttle:false, brake:false, indicator:'off' };
  const got = [];
  for (let i = 0; i < 60*20; i++){
    if (w.pending){ got.push(w.pending.id + '/' + w.pending.reason); w.resume(); }
    policy(w, input); w.update(DT, input);
  }
  return got;
}
const blind = (w, input) => {
  const p = w.player;
  const turn = Geo.turnOf(p.fromArm, p.toArm);
  input.indicator = turn !== 'straight' && p.s > p.lineS - 260 && p.s < p.exitS ? turn : 'off';
  const want = kmh(30);
  input.throttle = p.v < want - 2; input.brake = p.v > want + 2;
};
console.log('-'.repeat(100));
for (const lead of [0.4, 1.0, 1.6]){
  const b = staged(blind, lead), c = staged(careful, lead);
  console.log('train arrives ' + lead + ' s after you:  ignoring it -> ' + (b.join(' ') || 'nothing') +
              '   careful -> ' + (c.join(' ') || 'clean'));
  if (!b.some(x => /schiene_abbiegen|kollision/.test(x))) fail('cutting in front of the train (lead ' + lead + ') was not booked');
  if (c.some(x => ACCUSATION(x.split('/')[0]) || x.startsWith('kollision'))) fail('careful driver booked at the tracks: ' + c.join(' '));
}
console.log(problems ? problems + ' problem(s) - investigate' : 'the U-Bahn runs, gets priority, and a careful driver is never accused');
process.exit(problems ? 1 : 0);
