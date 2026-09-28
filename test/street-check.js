/* Pedestrians and cyclists in the Frankfurt map.
     - a careful driver is never accused, and the town's own cars never
       run anybody down, over several minutes and seeds
     - staged: turning right across a cyclist coming up behind you, and
       turning into a street somebody is crossing - booked for a driver
       who does not look, clean for one who does
                                               node test/street-check.js */
const fs = require('fs'), vm = require('vm'), path = require('path');

const ctx = vm.createContext({ console, Math, Object, Array, JSON, Number, String, Date });
['i18n.js','geo.js','rules.js','sim.js','scenarios.js','city.js','drive.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',f),'utf8'), ctx, { filename:f }));
const { Drive, Rules, Geo, Sim, kmh, toKmh, CFG } = ctx;

const DT = 1/60;
const careful = require('./drive-policy.js')(ctx);
const ACCUSATION = id => Rules.FAULTS[id].sev === 'major' && id !== 'kollision';
let problems = 0;
function fail(msg){ problems++; console.log('  FAIL ' + msg); }

/* ---------- 1. free driving among people ---------- */
console.log('seed  careful driver                     crossed  cyclists  town cars into people/cyclists');
console.log('-'.repeat(96));
for (const seed of [2, 5, 11, 33]){
  const w = new Drive.DriveWorld({ seed, target:9999, preset:'eschersheim' });
  const input = { throttle:false, brake:false, indicator:'off' };
  const crossed = new Set(), rode = new Set(), hits = new Set();
  let n = 0;
  for (let i = 0; i < 60*60*4; i++){
    if (w.paused) w.resume();
    careful(w, input); w.update(DT, input);
    for (const ped of w.peds){
      if (ped.state === 'walking' && Math.abs(ped.u) > CFG.BOX + 20 && ped.dir*ped.u > 0) crossed.add(ped);
      if (ped.state !== 'walking') continue;
      const pt = ped.point();
      for (const v of w.vehicles){
        if (v.isPlayer || v.done || v.v < kmh(3) || v.kind === 'tram') continue;
        const c = Sim.bodyCircles(v), front = c[c.length - 1];
        if (Math.hypot(front.x - pt.x, front.y - pt.y) < front.r + 6) hits.add(v.id + '>' + (n++ > -1 ? 'ped' : ''));
      }
    }
    for (const b of w.vehicles){
      if (b.kind !== 'bike') continue;
      if (b.s > b.path.length - 30) rode.add(b.id);
      for (const v of w.vehicles){
        if (v === b || v.isPlayer || v.done || v.kind === 'bike' || v.kind === 'tram') continue;
        if (Geo.dist(v.pos, b.pos) > 60) continue;
        const cv = Sim.bodyCircles(v), cb = Sim.bodyCircles(b);
        if (cv.some(p => cb.some(q => Math.hypot(p.x-q.x, p.y-q.y) < p.r + q.r - 2))) hits.add(v.id + '>' + b.id);
      }
    }
  }
  const acc = w.faults.filter(f => ACCUSATION(f.id));
  const tally = {};
  for (const f of w.faults) tally[f.id] = (tally[f.id] || 0) + 1;
  if (acc.length) fail('seed ' + seed + ': careful driver accused: ' + acc.map(f => f.id).join(' '));
  if (crossed.size < 8) fail('seed ' + seed + ': only ' + crossed.size + ' people got across');
  if (hits.size > 1) fail('seed ' + seed + ': town cars ran into people or cyclists ' + hits.size + ' times');
  console.log(String(seed).padEnd(6) +
    (w.cleared + ' junctions, ' + (Object.entries(tally).map(([k,v]) => k + '×' + v).join(' ') || 'clean')).padEnd(35) +
    String(crossed.size).padEnd(9) + String(rode.size).padEnd(10) + hits.size);
}

/* ---------- 2. staged situations ---------- */
function quiet(w){
  w.vehicles = [w.player]; w.peds = [];
  w.manageTrams = () => {}; w.manageBikes = () => {}; w.managePeds = () => {};
  w.spawnTraffic = () => null;
}
function place(w, steps){
  const p = w.player, built = w.map.routePath(steps);
  p.path = built.path; p.prof = Sim.curveProfile(p.path); p.steps = built.steps;
  p.stepIdx = 0; p.s = 0; p.prevS = 0; p.v = kmh(30);
  w.syncStep(p, true); p.pos = p.path.at(0);
}
function run(w, policy, secs){
  const input = { throttle:false, brake:false, indicator:'off' }, got = [];
  for (let i = 0; i < 60*secs; i++){
    if (w.pending){ got.push(w.pending.id + (w.pending.reason ? '/' + w.pending.reason : '')); w.resume(); }
    policy(w, input); w.update(DT, input);
  }
  return got;
}
/* indicates properly, keeps to 30, never looks at anybody */
function blind(w, input){
  const p = w.player, turn = Geo.turnOf(p.fromArm, p.toArm);
  input.indicator = turn !== 'straight' && p.s > p.lineS - 260 && p.s < p.exitS ? turn : 'off';
  const light = Rules.lightFor(w.junctionFor(p), p.fromArm, w.t);
  const stop = p.s < p.lineS && (light === 'red' || light === 'redyellow');
  const want = stop ? 0 : Math.min(kmh(30), w.curveSpeed(p, p.s));
  input.throttle = p.v < want - 2; input.brake = p.v > want + 2 || (stop && p.lineS - p.s < 60);
}

/* (a) Lindenbaum: right off Eschersheimer Landstraße, a cyclist on the
       cycle path beside you going straight on */
function cyclistWorld(){
  const w = new Drive.DriveWorld({ seed:3, target:9999, preset:'eschersheim' });
  quiet(w);
  const m = w.map, n = m.nodeAt(2, 2);
  place(w, [{ node:n, from:'S', to:'E' }, { node:m.nodeAt(3, 2), from:'W', to:'E' }]);
  n.lights.t0 = -w.t;                                   // main road green
  return { w, n, lane:m.bikeLanes.find(l => l.col && l.from === 'S') };
}
/* when does a driver who ignores cyclists reach the cycle path? */
function arrival(){
  const { w, n, lane } = cyclistWorld();
  const probe = w.spawnBike(lane, 0);
  probe.stepIdx = probe.steps.findIndex(st => st.node === n); w.syncStep(probe, true);
  const sa = w.conflictBetween(w.player, probe).sa;
  w.vehicles = [w.player];
  const input = { throttle:false, brake:false, indicator:'off' };
  for (let i = 0; i < 60*20; i++){
    if (w.player.s >= sa) return w.t;
    if (w.pending) w.resume();
    blind(w, input); w.update(DT, input);
  }
  return null;
}
const T_ARRIVE = arrival();
/* the classic: you overtook the cyclist a moment ago, now you turn
   right across their path and they arrive `lead` seconds after you */
function cyclist(policy, lead){
  const { w, n, lane } = cyclistWorld();
  const b = w.spawnBike(lane, 0);
  b.stepIdx = b.steps.findIndex(st => st.node === n); w.syncStep(b, true);
  const c = w.conflictBetween(w.player, b);
  b.v = b.cruise = kmh(20);
  b.s = c.sb - (T_ARRIVE + lead) * b.v; b.pos = b.path.at(b.s); w.syncStep(b, true);
  return run(w, policy, 18);
}
/* (b) a quiet corner: right into a side street somebody is crossing */
function pedestrian(policy, startIn){
  const w = new Drive.DriveWorld({ seed:3, target:9999, preset:'eschersheim' });
  quiet(w);
  const m = w.map, n = m.nodeAt(4, 3);
  place(w, [{ node:n, from:'S', to:'E' }, { node:m.nodeAt(5, 3), from:'W', to:'E' }]);
  const ped = new Sim.Ped({ arm:'E', d:ctx.City.CW.mid, node:n, u0:-(CFG.BOX + 22), dir:1, start:'waiting', intent:true });
  ped.wait = -startIn;                                  // steps up to the kerb a little later
  w.peds.push(ped);
  return run(w, policy, 18);
}

console.log('-'.repeat(96));
/* (a full second behind, you are across the path before they get there,
   they never have to brake - which is no fault, so it is not tested) */
for (const lead of [0.2, 0.5]){
  const b = cyclist(blind, lead), c = cyclist(careful, lead);
  console.log('cyclist ' + lead + ' s behind you, turning right:   not looking -> ' + (b.join(' ') || 'nothing') +
              '   careful -> ' + (c.join(' ') || 'clean'));
  if (!b.some(x => /abbiegen_rad|kollision/.test(x))) fail('cutting across the cyclist (lead ' + lead + ') was not booked');
  if (c.some(x => ACCUSATION(x.split('/')[0]) || x.startsWith('kollision'))) fail('careful driver booked with the cyclist: ' + c.join(' '));
}
/* they step up to the kerb while the car is still some seconds away -
   in time for anybody watching to let them across */
for (const t of [3.5, 5.0]){
  const b = pedestrian(blind, t), c = pedestrian(careful, t);
  console.log('pedestrian at the corner (after ' + t + ' s), turning right: not looking -> ' + (b.join(' ') || 'nothing') +
              '   careful -> ' + (c.join(' ') || 'clean'));
  if (!b.some(x => /fussgaenger|ped_kollision/.test(x))) fail('turning through the pedestrian (' + t + ') was not booked');
  if (c.some(x => ACCUSATION(x.split('/')[0]))) fail('careful driver booked with the pedestrian: ' + c.join(' '));
}
console.log('-'.repeat(96));
console.log(problems ? problems + ' problem(s) - investigate'
                     : 'people and cyclists cross safely, and turning without looking gets booked');
process.exit(problems ? 1 : 0);
