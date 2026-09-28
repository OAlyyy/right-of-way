/* The driving test mode: a careful driver passes, the classic ways of
   failing fail, and the examiner never stops to explain in between.
                                                 node test/exam-check.js */
const fs = require('fs'), vm = require('vm'), path = require('path');

const ctx = vm.createContext({ console, Math, Object, Array, JSON, Number, String, Date });
['i18n.js','geo.js','rules.js','sim.js','scenarios.js','city.js','drive.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',f),'utf8'), ctx, { filename:f }));
const { Drive, Rules, Geo, kmh, toKmh } = ctx;

const DT = 1/60;
const careful = require('./drive-policy.js')(ctx);
let problems = 0;
function fail(msg){ problems++; console.log('  FAIL ' + msg); }

function exam(policy, seed, minutes){
  const w = new Drive.DriveWorld({ seed, target:1e9, preset:'eschersheim', exam:{ minutes } });
  const input = { throttle:false, brake:false, indicator:'off' };
  let paused = 0;
  for (let i = 0; i < 60*60*(minutes + 1) && w.state === 'run'; i++){
    if (w.paused || w.pending) paused++;
    policy(w, input); w.update(DT, input);
  }
  return { w, rep:w.report(), paused };
}
function describe(r){
  const e = r.rep.exam;
  return (e.passed ? 'PASSED' : 'failed (' + e.why + (e.failedBy ? ': ' + e.failedBy.id : '') + ')') +
         ' after ' + (e.driven/60).toFixed(1) + ' min, ' + r.rep.faults.length + ' fault(s)';
}

/* like careful, but never checks the mirror or looks over a shoulder */
function noLooking(w, input){ careful(w, input); input.yaw = 0; input.mirror = false; }
/* like careful, but always 10 km/h over the limit */
function speeder(w, input){
  careful(w, input);
  const p = w.player, want = kmh(w.sc.limit + 12);
  if (p.s < p.lineS - 250 || p.s > p.exitS){ input.throttle = p.v < want; input.brake = false; }
}

console.log('driver             seed  result');
console.log('-'.repeat(80));
for (const seed of [4, 21]){
  const r = exam(careful, seed, 6);
  console.log('careful            ' + String(seed).padEnd(6) + describe(r));
  if (!r.rep.exam.passed) fail('careful driver failed the test on seed ' + seed + ': ' +
    r.rep.faults.map(f => f.id).join(' '));
  if (r.paused) fail('the examiner stopped the car to explain during a test');
}
{
  const r = exam(noLooking, 4, 6);
  console.log('never looks        4     ' + describe(r));
  if (r.rep.exam.passed) fail('driving without mirror and shoulder checks passed');
  const obs = r.rep.categories.find(c => c.cat.id === 'beobachtung');
  if (!obs.faults.length) fail('missed checks did not land under "observing traffic"');
}
{
  const r = exam(speeder, 21, 6);
  console.log('speeds             21    ' + describe(r));
  if (r.rep.exam.passed) fail('driving 12 km/h too fast throughout passed');
  const sp = r.rep.categories.find(c => c.cat.id === 'tempo');
  if (!sp.faults.length) fail('speeding did not land under "choosing your speed"');
}
console.log('-'.repeat(80));
console.log(problems ? problems + ' problem(s) - investigate' : 'the test passes careful driving and fails the rest');
process.exit(problems ? 1 : 0);
