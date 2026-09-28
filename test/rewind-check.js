/* Rewind: break a rule, take it back, and check the town really went
   back in time - and keeps working afterwards.
                                            node test/rewind-check.js   */
const fs = require('fs'), vm = require('vm'), path = require('path');

const ctx = vm.createContext({ console, Math, Object, Array, JSON, Number, String, Date });
['i18n.js','geo.js','rules.js','sim.js','scenarios.js','city.js','drive.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',f),'utf8'), ctx, { filename:f }));
const { Drive, Sim, kmh, toKmh } = ctx;

const DT = 1/60;
const careful = require('./drive-policy.js')(ctx);
/* keeps to the limit, so what it gets booked for is the junctions:
   no indicators, no looking, never giving way, rolling through stops */
function reckless(w, input){
  input.indicator = 'off';
  input.brake = false;
  input.throttle = toKmh(w.player.v) < w.sc.limit - 3;
}

let problems = 0;
function check(ok, msg){ if (!ok){ problems++; console.log('  FAIL ' + msg); } }

function consistent(w, label){
  check(w.vehicles.indexOf(w.player) >= 0, label + ': player is not in the fleet');
  for (const v of w.vehicles){
    check(isFinite(v.s) && isFinite(v.v) && isFinite(v.pos.x) && isFinite(v.pos.y),
          label + ': NaN on ' + v.id);
    for (const k of Object.keys(v)){
      if (v[k] instanceof Sim.Vehicle)
        check(w.vehicles.indexOf(v[k]) >= 0, label + ': ' + v.id + '.' + k + ' points outside the fleet');
    }
  }
}

const SEEDS = [1, 7, 12, 23, 42, 91];
console.log('seed  rewinds  retried faults                       careful after rewind');
console.log('-'.repeat(90));
for (const seed of SEEDS){
  const w = new Drive.DriveWorld({ seed, target: 9999 });
  const input = { throttle:false, brake:false, indicator:'off' };
  let rewinds = 0, afterFaults = 0, afterCleared = 0;
  const ids = [];

  for (let round = 0; round < 4; round++){
    /* drive recklessly until the examiner stops us */
    let n = 0;
    while (!w.pending && n++ < 60*120){ reckless(w, input); w.update(DT, input); }
    if (!w.pending) break;
    const f = w.pending, tFault = w.t, sFault = w.player.s;
    const faultsBefore = w.faults.length;
    check(w.rewind(), 'seed ' + seed + ': rewind refused');
    rewinds++; ids.push(f.id);

    check(w.t < tFault, 'seed ' + seed + ': time did not go back');
    check(tFault - w.t <= 5.6, 'seed ' + seed + ': went back ' + (tFault - w.t).toFixed(1) + 's (too far)');
    check(w.faults.length < faultsBefore, 'seed ' + seed + ': fault still on the sheet');
    check(w.fixed.indexOf(f) >= 0, 'seed ' + seed + ': fault not kept for the summary');
    check(!w.paused && !w.pending && w.hold, 'seed ' + seed + ': not holding after rewind');
    consistent(w, 'seed ' + seed + ' after rewind');

    /* holding: nothing moves until gas */
    const t0 = w.t;
    input.throttle = false; input.brake = false;
    for (let i = 0; i < 30; i++) w.update(DT, input);
    check(w.t === t0, 'seed ' + seed + ': the town moved while holding');

    /* retry it properly for 20 s */
    input.throttle = true; w.update(DT, input);
    check(!w.hold, 'seed ' + seed + ': gas did not release the hold');
    const fBefore = w.faults.length, cBefore = w.cleared;
    for (let i = 0; i < 60*20; i++){
      if (w.pending){ w.resume(); }
      careful(w, input); w.update(DT, input);
    }
    afterFaults += w.faults.length - fBefore;
    afterCleared += w.cleared - cBefore;
    consistent(w, 'seed ' + seed + ' after retry');
    void sFault;
  }
  const rep = w.report();
  check(rep.fixed.length === rewinds, 'seed ' + seed + ': report lost retried faults');
  console.log(String(seed).padEnd(6) + String(rewinds).padEnd(9) + ids.join(' ').slice(0, 36).padEnd(37) +
              afterCleared + ' junctions, ' + afterFaults + ' new faults');
}
console.log('-'.repeat(90));
console.log(problems ? problems + ' problem(s) - investigate' : 'rewind restores the town cleanly on every seed');
process.exit(problems ? 1 : 0);
