/* A careful driver can get stuck waiting a long time at a busy unmarked
   crossing - StVO gives no right to a gap, so this is not a bug on its
   own. What WOULD be a bug: the wait never ending, or the drive turning
   sour once it does. This drives long enough on seeds known to produce a
   long wait and checks both.                node test/longhalt-check.js */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = vm.createContext({ console, Math, Object, Array, JSON, Number, String, Date });
['i18n.js','geo.js','rules.js','sim.js','scenarios.js','city.js','drive.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',f),'utf8'), ctx, { filename:f }));
const { Drive, Rules, kmh } = ctx;
const careful = require('./drive-policy.js')(ctx);
const DT = 1/60;
const MINUTES = 12;

function run(seed){
  const w = new Drive.DriveWorld({ seed, target: 99999 });
  const input = { throttle:false, brake:false, indicator:'off' };
  let stuckSince = null, worstHalt = 0, everUnstuckAfterLong = true;
  for (let i = 0; i < 60*60*MINUTES; i++){
    if (w.paused) w.resume();
    careful(w, input);
    w.update(DT, input);
    if (w.player.v < kmh(1)){
      if (stuckSince === null) stuckSince = w.t;
    } else {
      if (stuckSince !== null) worstHalt = Math.max(worstHalt, w.t - stuckSince);
      stuckSince = null;
    }
  }
  const stillStuck = stuckSince !== null && (w.t - stuckSince) > 60;
  const majors = w.faults.filter(f => Rules.FAULTS[f.id].sev === 'major' && f.id !== 'kollision').length;
  return { cleared: w.cleared, worstHalt, stillStuck, majors, faultCount: w.faults.length };
}

/* seeds 1, 3, 42 are known from earlier sweeps to produce one long wait */
let bad = 0;
console.log('seed  minutes  cleared  worst halt   still stuck at end?  faults');
console.log('-'.repeat(70));
for (const seed of [1, 3, 42]){
  const r = run(seed);
  if (r.stillStuck || r.majors > 0) bad++;
  console.log(String(seed).padEnd(6) + String(MINUTES).padEnd(9) + String(r.cleared).padEnd(9) +
    (r.worstHalt.toFixed(0)+'s').padEnd(13) + String(r.stillStuck).padEnd(21) + r.faultCount);
}
console.log('-'.repeat(70));
console.log(bad === 0
  ? 'every long wait ended on its own and the drive stayed clean'
  : bad + ' seed(s) never recovered or turned sour - investigate');
if (bad > 0) process.exit(1);
