/* Shoulder checks, the way a person actually does them: a quick tap on
   the look key (the head eases round, exactly as main.js turns it), at
   various moments before a right turn. A real check must count; a
   missing or long-stale one must not.        node test/shoulder-check.js */
const fs = require('fs'), vm = require('vm'), path = require('path');

const ctx = vm.createContext({ console, Math, Object, Array, JSON, Number, String, Date });
['i18n.js','geo.js','rules.js','sim.js','scenarios.js','city.js','drive.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',f),'utf8'), ctx, { filename:f }));
const { Drive, Geo, Sim, kmh } = ctx;

const DT = 1/60, MAX_YAW = 1.25;              // as in main.js
let problems = 0;

/* A quiet right turn at a Tempo-30 corner (no cycle path, no traffic).
   `plan(w, p)` says when the key is held and when to wait. */
function drive(plan){
  const w = new Drive.DriveWorld({ seed:3, target:9999, preset:'eschersheim' });
  w.vehicles = [w.player]; w.peds = [];
  w.manageTrams = () => {}; w.manageBikes = () => {}; w.managePeds = () => {}; w.spawnTraffic = () => null;
  const m = w.map, n = m.nodeAt(4, 3), p = w.player;
  const built = m.routePath([{ node:n, from:'S', to:'E' }, { node:m.nodeAt(5, 3), from:'W', to:'E' }]);
  p.path = built.path; p.prof = Sim.curveProfile(p.path); p.steps = built.steps;
  p.stepIdx = 0; p.s = 0; p.prevS = 0; p.v = kmh(25);
  w.syncStep(p, true); p.pos = p.path.at(0);
  const input = { throttle:false, brake:false, indicator:'off', yaw:0, mirror:false };
  let yaw = 0;
  const got = [];
  for (let i = 0; i < 60*40; i++){
    if (w.pending){ got.push(w.pending.id); w.resume(); }
    const act = plan(w, p);
    /* the head: eases towards where the key points it, like main.js */
    const target = act.lookRight ? MAX_YAW : 0;
    yaw += (target - yaw) * Math.min(1, DT*8);
    input.yaw = yaw; input.mirror = !!act.mirror;
    input.indicator = p.s > p.lineS - 300 && p.s < p.exitS ? 'right' : 'off';
    const want = act.stop ? 0 : Math.min(kmh(25), w.curveSpeed(p, p.s));
    input.throttle = p.v < want - 2; input.brake = p.v > want + 2;
    w.update(DT, input);
  }
  return got.filter(id => /schulter|spiegel/.test(id));
}
/* tap = key held for 0.2 s starting when the car is `before` units short of the line */
function tapAt(before){
  let start = null;
  return (w, p) => {
    if (start === null && p.s > p.lineS - before) start = w.t;
    const lookRight = start !== null && w.t - start < 0.2;
    return { lookRight, mirror: p.s > p.lineS - 500 && p.s < p.lineS - 400 };
  };
}
const cases = [
  ['quick tap just before the line',            tapAt(60),   true],
  ['quick tap 3 s before the line',             tapAt(250),  true],
  ['look after the line, waiting, then turn',   (() => {
      let stopT = null;
      return (w, p) => {
        const past = p.s > p.lineS + 4;
        if (past && stopT === null) stopT = w.t;
        const waiting = stopT !== null && w.t - stopT < 4;
        const lookRight = stopT !== null && w.t - stopT > 3.0 && w.t - stopT < 3.2;
        return { stop: waiting, lookRight, mirror: p.s > p.lineS - 500 && p.s < p.lineS - 400 };
      };
    })(), true],
  ['no look at all',                            () => ({ mirror:true }), false],
  ['looked, then waited 15 s at the line',      (() => {
      let stopT = null;
      return (w, p) => {
        if (p.s > p.lineS - 40 && stopT === null) stopT = w.t;
        const waiting = stopT !== null && w.t - stopT < 15;
        const lookRight = stopT !== null && w.t - stopT < 0.2;
        return { stop: waiting, lookRight, mirror: stopT !== null && w.t - stopT > 13 && w.t - stopT < 13.2 };
      };
    })(), false]
];
console.log('situation                                   should pass   booked');
console.log('-'.repeat(80));
for (const [name, plan, ok] of cases){
  const got = drive(plan);
  const clean = !got.some(id => /schulter/.test(id));
  console.log(name.padEnd(44) + String(ok).padEnd(14) + (got.join(' ') || '-'));
  if (clean !== ok){ problems++; console.log('  FAIL ' + (ok ? 'a real shoulder check was not counted' : 'a missing check was not booked')); }
}
console.log('-'.repeat(80));
console.log(problems ? problems + ' problem(s) - investigate' : 'quick glances count, and only the missing or stale ones are booked');
process.exit(problems ? 1 : 0);
