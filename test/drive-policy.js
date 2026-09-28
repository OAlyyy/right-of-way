/* A driver who actually obeys the rules, for the open-world tests to
   drive with. Shared by drive-check.js, longhalt-check.js and
   drive-render-check.js so "careful" means the same thing everywhere -
   pass it the vm context each test built (needs Geo, Rules, CFG, kmh). */
module.exports = function(ctx){
  const { Geo, Rules, CFG, kmh, Sim } = ctx;
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

    /* mirror first, then a look over the shoulder on the side we turn
       to - and keep checking while we wait at the line */
    const turning = (turn === 'left' || turn === 'right') && !roundabout;
    const waiting = p.s < p.lineS && p.s > p.lineS - 130 && p.v < kmh(4);
    input.mirror = turning && ((p.s > p.lineS - 320 && p.s < p.lineS - 150) || waiting);
    input.yaw = turning && ((p.s > p.lineS - 110 && p.s < p.lineS - 15) || waiting)
              ? (turn === 'right' ? 1.1 : -1.1) : 0;

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
    /* pedestrians: stop for anyone on the road in front of us, and let
       across anyone we owe it to - on a zebra, or where we turn in */
    for (const ped of w.peds){
      if (ped.node !== p.node) continue;
      const inSide = ped.arm === p.fromArm && p.crossS !== undefined && p.s < p.crossS;
      const exitSide = !inSide && ped.arm === p.toArm && p.exitCrossS !== undefined && p.s < p.exitCrossS;
      if (!inSide && !exitSide) continue;
      const cs = inSide ? p.crossS : p.exitCrossS;
      const wants = ped.state === 'waiting' && (ped.wants !== undefined ? ped.wants : ped.intent);
      const owed = ped.zebra || !ped.node || (exitSide && turn !== 'straight');
      const blocking = Sim.pedCrossing(ped, exitSide) || (wants && owed);
      /* short of the crossing - and still behind our stop line if the
         crossing is ahead of it */
      let at = cs - 16;
      /* waiting to cross into a street people are crossing: wait at the
         line rather than in the middle of the junction (Sec. 11) */
      if (p.s < p.lineS) at = Math.min(at, p.lineS - 6);
      if (blocking) stopAt = stopAt === null ? at : Math.min(stopAt, at);
    }
    /* past the line too: somebody with priority whose path we are about
       to cross - a cyclist from behind, an oncoming car while turning */
    if (p.s >= p.lineS){
      for (const o of w.vehicles){
        if (o.isPlayer || o.done) continue;
        const c = w.conflictBetween(p, o);
        if (!c || p.s > c.sa - 30) continue;
        if (Rules.priority(J, p, o, w.t).who !== 'b') continue;
        if (!w.hinders(p, o, c)) continue;
        const at = c.sa - p.len*0.5 - 18;
        stopAt = stopAt === null ? at : Math.min(stopAt, at);
      }
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
    /* never drive into whatever stands on our own path, bends included */
    want = Math.min(want, w.proximityBrake(p).v);
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
