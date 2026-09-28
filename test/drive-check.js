/* Drives the open world for several simulated minutes with a careful
   driver and with a reckless one.

   The careful run is the one that matters: false accusations in free
   driving are far worse than a missed one, because the game stops the
   car and lectures you.        node test/drive-check.js               */
const fs = require('fs'), vm = require('vm'), path = require('path');

const ctx = vm.createContext({ console, Math, Object, Array, JSON, Number, String, Date });
['i18n.js','geo.js','rules.js','sim.js','scenarios.js','city.js','drive.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',f),'utf8'), ctx, { filename:f }));
const { Drive, Rules, kmh, toKmh } = ctx;

const DT = 1/60;
const careful = require('./drive-policy.js')(ctx);

function reckless(w, input){
  input.indicator = 'off';
  input.brake = false;
  input.throttle = toKmh(w.player.v) < w.sc.limit + 14;
}

function run(policy, seed, minutes){
  const w = new Drive.DriveWorld({ seed, target: 9999 });
  const input = { throttle:false, brake:false, indicator:'off' };
  let pauses = 0, halt = 0, worstHalt = 0;
  for (let i = 0; i < 60 * 60 * minutes; i++){
    if (w.paused){ pauses++; w.resume(); }
    policy(w, input);
    w.update(DT, input);
    if (w.player.v < kmh(1)){ halt++; if (halt > worstHalt) worstHalt = halt; }
    else halt = 0;
  }
  const tally = {};
  for (const f of w.faults) tally[f.id] = (tally[f.id] || 0) + 1;
  return { w, pauses, tally, halt: worstHalt / 60 };
}

/* An accusation is the examiner claiming we broke a rule. A collision is
   an event we can see out of the windscreen: unwelcome, but not the game
   telling us something untrue. Only the first kind must never happen to a
   driver who obeyed the rules. */
const ACCUSATION = id => Rules.FAULTS[id].sev === 'major' && id !== 'kollision';

/* A busy unmarked crossing can legitimately make a careful driver wait a
   long time for a gap - StVO gives no right to one. Verified separately
   (test/longhalt-check.js) that such a wait always ends on its own and
   the drive is clean afterwards; this limit is for a town that has
   actually seized up, not a driver who is simply being patient. */
const HALT_LIMIT = 50;

const MINUTES = 3;
const SEEDS = [1, 7, 12, 17, 23, 24, 42, 91];
let accused = 0, jammed = 0, bumps = 0;
console.log('seed  careful driver                                        reckless driver');
console.log('-'.repeat(100));
for (const seed of SEEDS){
  const a = run(careful, seed, MINUTES);
  const b = run(reckless, seed, MINUTES);
  const af = Object.entries(a.tally).map(([k,v]) => k + '×' + v).join(' ') || 'clean';
  const bf = Object.entries(b.tally).map(([k,v]) => k + '×' + v).join(' ') || 'clean';
  const acc = a.w.faults.filter(f => ACCUSATION(f.id)).length;
  if (acc > 0) accused++;
  if (a.halt > HALT_LIMIT) jammed++;
  bumps += a.tally.kollision || 0;
  console.log(String(seed).padEnd(6) +
    (a.w.cleared + ' junctions, longest halt ' + a.halt.toFixed(0) + 's, ' + af).padEnd(54) +
    (b.w.cleared + ' junctions, ' + bf).slice(0, 44));
}
console.log('-'.repeat(100));
console.log(accused === 0
  ? 'no careful run was accused of breaking a rule'
  : accused + ' careful run(s) were accused of breaking a rule - investigate');
console.log(jammed === 0
  ? 'the town kept moving on every seed'
  : jammed + ' seed(s) gridlocked for over ' + HALT_LIMIT + 's - investigate');
console.log(bumps + ' collision(s) across ' + (SEEDS.length*MINUTES) + ' minutes of careful driving');
