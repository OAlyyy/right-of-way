/* A driver who actually obeys the rules, for the open-world tests to
   drive with. Shared by drive-check.js, longhalt-check.js and
   drive-render-check.js so "careful" means the same thing everywhere -
   pass it the vm context each test built (needs Geo, Rules, CFG, kmh). */
module.exports = function(ctx){
  const { Geo, Rules, CFG, kmh } = ctx;
  return function careful(w, input){
    const p = w.player;
    const J = w.junctionFor(p);
    const turn = Geo.turnOf(p.fromArm, p.toArm);
    const roundabout = J.layout && J.layout.type === 'roundabout';

    /* indicate in good time; never indicate joining a roundabout */
    if (roundabout)
      input.indicator = (p.exitS !== undefined && p.s > p.exitS - 240) ? 'right' : 'off';
    else if (turn !== 'straight' && p.s > p.lineS - 260 && p.s < p.exitS)
      input.indicator = turn;
    else input.indicator = 'off';

    const sign = Rules.signOf(J, p.fromArm);
    const light = Rules.lightFor(J, p.fromArm, w.t);

    let stopAt = null;
    if (p.s < p.lineS){
      let must = false;
      if (light === 'red' || light === 'redyellow') must = true;
      if (sign === 'stop' && !p.didStop) must = true;
      if (w.mustGiveWayHere()) must = true;
      if (must) stopAt = p.lineS - 6;
    }
    for (const ped of w.peds){
      if (p.crossS === undefined || p.s >= p.crossS) continue;
      const blocking = (ped.state === 'walking' && ped.onRoad()) ||
                       (ped.state === 'waiting' && ped.intent);
      if (blocking) stopAt = stopAt === null ? p.crossS - 16 : Math.min(stopAt, p.crossS - 16);
    }

    /* well under the limit, slow for bends, keep a gap */
    let want = kmh(Math.min(w.sc.limit, 45));
    want = Math.min(want, w.curveSpeed(p, p.s) * 1.1);

    /* A careful driver approaches any line they might have to stop at
       slowly enough that they still can - the StVO says exactly this
       ("mit maessiger Geschwindigkeit heranfahren"), and without it you
       arrive too fast to give way to something you only see late. */
    const mustBeAbleToStop = (sign === 'yield' || sign === 'stop' ||
                              sign === 'ringentry' || light !== null);
    if (mustBeAbleToStop && p.s < p.lineS){
      const d = p.lineS - 6 - p.s;
      want = Math.min(want, Math.sqrt(2*CFG.BRAKE*0.30*Math.max(0, d)) + kmh(4));
    }
    const lead = w.leaderOf(p);
    if (lead){
      const g = lead.gap - 22;
      want = Math.min(want, Math.max(0, Math.sqrt(2*CFG.BRAKE*0.5*Math.max(0, g))));
    }
    if (stopAt !== null){
      const d = stopAt - p.s;
      want = d <= 0 ? 0 : Math.min(want, Math.sqrt(2*CFG.BRAKE*0.5*Math.max(0, d)));
    }
    input.throttle = p.v < want - 3;
    input.brake    = p.v > want + 3;
  };
};
