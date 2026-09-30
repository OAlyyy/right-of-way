/* Steering yourself. A driver who steers smoothly along the proper line
   (pure pursuit: aim at a point a little way ahead, steer towards it)
   must drive cleanly for minutes; the classic line faults - drifting over
   the middle, cutting a left turn, letting go of the wheel - must be
   booked; and the way you go must follow what you do, not the plan.
                                                node test/steer-check.js */
const fs = require('fs'), vm = require('vm'), path = require('path');

const ctx = vm.createContext({ console, Math, Object, Array, JSON, Number, String, Date });
['i18n.js','geo.js','rules.js','sim.js','scenarios.js','city.js','drive.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',f),'utf8'), ctx, { filename:f }));
const { Drive, Rules, Geo, kmh, CFG } = ctx;

const DT = 1/60, WB = 2.7*CFG.PPM;
const careful = require('./drive-policy.js')(ctx);
const LINE = /fahrstreifen|kurve_geschnitten|zu_weit|einordnen|bordstein|falsch_geblinkt/;
const ACCUSATION = id => Rules.FAULTS[id].sev === 'major' && id !== 'kollision';
let problems = 0;
function fail(msg){ problems++; console.log('  FAIL ' + msg); }

/* steer towards a point `ahead` along our route, `off` to the right of it */
function pursue(w, input, off){
  /* look less far ahead when slow: steering in late, not cutting in */
  const p = w.player, Ld = Math.max(3.2*CFG.PPM, p.v*0.55);
  const q = p.path.at(p.s + Ld);
  const o = typeof off === 'function' ? off(w) : (off || 0);
  const tx = q.x - Math.sin(q.h)*o, ty = q.y + Math.cos(q.h)*o;
  let a = Math.atan2(ty - p.pos.y, tx - p.pos.x) - p.pos.h;
  a = Math.atan2(Math.sin(a), Math.cos(a));
  const delta = Math.atan(2*WB*Math.sin(a)/Ld);
  input.steerAbs = Math.max(-1, Math.min(1, delta / w.maxSteer(p)));
}
function drive(seed, minutes, policy){
  const w = new Drive.DriveWorld({ seed, target:9999, preset:'eschersheim', steer:'manual' });
  const input = { throttle:false, brake:false, indicator:'off' };
  const got = [];
  for (let i = 0; i < 60*60*minutes; i++){
    if (w.pending){ got.push(w.pending.id); w.resume(); }
    if (w.indicatorOff){ input.indicator = 'off'; w.indicatorOff = false; }
    policy(w, input); w.update(DT, input);
  }
  return { w, got };
}

/* ---------- 1. a good driver ---------- */
console.log('seed  steering along the proper line');
console.log('-'.repeat(80));
for (const seed of [3, 8, 19]){
  const { w, got } = drive(seed, 3, (w, input) => { careful(w, input); pursue(w, input, 0); });
  const line = got.filter(id => LINE.test(id)), acc = got.filter(ACCUSATION);
  console.log(String(seed).padEnd(6) + w.cleared + ' junctions, ' + (got.join(' ') || 'clean'));
  if (w.cleared < 8) fail('seed ' + seed + ': only ' + w.cleared + ' junctions - is the car getting stuck?');
  if (line.length) fail('seed ' + seed + ': good steering booked for its line: ' + line.join(' '));
  if (acc.length) fail('seed ' + seed + ': good steering accused: ' + acc.join(' '));
}

/* ---------- 2. the classic line faults ---------- */
console.log('-'.repeat(80));
function expect(name, policy, id){
  const { got } = drive(3, 2, policy);
  const ok = got.includes(id);
  console.log(name.padEnd(46) + (ok ? 'booked: ' + id : 'NOT booked (got ' + (got.join(' ') || 'nothing') + ')'));
  if (!ok) fail(name + ': expected ' + id);
}
/* 2.5 m left of the proper line, all the time */
expect('drifting over the centre line', (w, input) => { careful(w, input); pursue(w, input, -30); }, 'fahrstreifen');
/* diving across the corner on every left turn */
expect('cutting the corner turning left', (w, input) => {
  careful(w, input);
  pursue(w, input, w => {
    const p = w.player;
    return p.turn() === 'left' && p.s > p.lineS - 40 && p.s < p.exitS ? -60 : 0;
  });
}, 'kurve_geschnitten');
/* hands off the wheel: the road turns, the car does not */
expect('not steering at all', (w, input) => { careful(w, input); input.steerAbs = 0; }, 'bordstein');

/* ---------- 3. your way, not the plan ---------- */
{
  /* indicate right at every junction that has a right turn, and take it */
  const { w, got } = drive(8, 2, (w, input) => {
    careful(w, input);
    const p = w.player, st = p.steps[p.stepIdx];
    if (p.s < st.junctionS && st.node.arms.includes(Geo.rightOf(st.from))) input.indicator = 'right';
    pursue(w, input, 0);
  });
  const rights = w.faults.length >= 0;
  const turnedOwnWay = got.filter(id => id === 'falsch_geblinkt').length === 0;
  console.log('choosing your own way (always right)'.padEnd(46) + (turnedOwnWay ? 'followed, ' + w.cleared + ' junctions' : 'booked: ' + got.join(' ')));
  if (!turnedOwnWay || !rights) fail('taking your own way was booked as a fault');
  if (got.some(id => /fahrstreifen|kurve|zu_weit|bordstein/.test(id))) fail('own-way driving booked for its line: ' + got.join(' '));
}
{
  /* indicate right, then drive straight on anyway */
  const { got } = drive(8, 2, (w, input) => {
    careful(w, input);
    const p = w.player, st = p.steps[p.stepIdx];
    const straightOn = st.node.arms.includes(Geo.opposite(st.from)) && st.node.arms.includes(Geo.rightOf(st.from));
    if (straightOn && p.s < st.exitS) input.indicator = 'right';
    if (straightOn && p.s > p.lineS - 60 && p.s < st.exitS){ input.steerAbs = 0; return; }
    pursue(w, input, 0);
  });
  const ok = got.includes('falsch_geblinkt');
  console.log('indicating right, driving straight on'.padEnd(46) + (ok ? 'booked: falsch_geblinkt' : 'NOT booked (got ' + (got.join(' ') || 'nothing') + ')'));
  if (!ok) fail('driving against your own indicator was not booked');
}
console.log('-'.repeat(80));
console.log(problems ? problems + ' problem(s) - investigate' : 'steering yourself: a good line is clean, the classic mistakes are booked');
process.exit(problems ? 1 : 0);
