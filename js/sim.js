'use strict';
/* ------------------------------------------------------------------
   sim.js - the world: vehicles, pedestrians, traffic lights and the
   examiner ("Pruefer") that writes down every mistake.
   ------------------------------------------------------------------ */

var Sim = (function(){

  var CROSS_MID  = CFG.BOX + 46;   // distance of a zebra crossing from centre
  var CROSS_HALF = 18;             // half depth of the striped area

  /* ---------- helpers on paths ---------- */

  /* projection of a path point onto an arm axis (distance from centre
     measured along that arm, negative on the far side)                */
  function proj(p, arm){
    var o = Geo.ARM_VEC[arm];
    return p.x*o.x + p.y*o.y;
  }
  /* first s where the projection on `arm` drops to or below d (approach) */
  function sProjBelow(path, arm, d){
    for (var s=0; s<=path.length; s+=2){
      if (proj(path.at(s), arm) <= d) return s;
    }
    return path.length;
  }
  /* first s after `from` where the projection on `arm` rises to d (exit) */
  function sProjAbove(path, arm, d, from){
    for (var s=(from||0); s<=path.length; s+=2){
      if (proj(path.at(s), arm) >= d) return s;
    }
    return path.length;
  }
  /* comfortable speed through the curvature of the path, per 10 units */
  function curveProfile(path){
    var prof = [], A_LAT = 4.2*CFG.PPM, DEC = 70, i;
    for (var s=0; s<=path.length; s+=10){
      var a = path.at(Math.max(0,s-18)), b = path.at(s), c = path.at(Math.min(path.length,s+18));
      var h1 = Math.atan2(b.y-a.y, b.x-a.x), h2 = Math.atan2(c.y-b.y, c.x-b.x);
      var d = Math.abs(Math.atan2(Math.sin(h2-h1), Math.cos(h2-h1)));
      var arc = Geo.dist(a,b) + Geo.dist(b,c);
      var R = d > 0.01 ? arc/d : 1e6;
      prof.push(Math.min(kmh(200), Math.sqrt(A_LAT*R)));
    }
    /* backward pass: at every point be slow enough to still reach the
       speed the next bend demands, braking comfortably                */
    for (i = prof.length-2; i >= 0; i--)
      prof[i] = Math.min(prof[i], Math.sqrt(prof[i+1]*prof[i+1] + 2*DEC*10));
    return prof;
  }
  function curveV(veh, s){
    var i = Math.round(s/10);
    if (i < 0) i = 0;
    if (i >= veh.prof.length) i = veh.prof.length-1;
    return veh.prof[i];
  }
  /* speed we may still have now in order to be stopped at distance d */
  /* Is this vehicle actually coming, or is it parked at its own line? */
  function isApproaching(o){
    /* a train standing at its signal is waiting for green, not parked */
    if (o.kind === 'tram') return true;
    if (o.v > kmh(3)) return true;
    if (o.lineS !== undefined && o.s < o.lineS - 4) return false;
    return true;
  }

  function laneClass(v){ return v.kind === 'tram' ? 't' : (v.kind === 'bike' && v.lane) ? 'b' : 'c'; }

  function approachV(d, dec){
    if (d <= 0) return 0;
    return Math.sqrt(2*dec*d);
  }

  /* ---------------- Vehicle ---------------- */
  function Vehicle(o){
    for (var k in o) this[k] = o[k];
    this.kind      = o.kind || 'car';
    this.len       = o.len || CFG.CAR_L;
    this.wid       = o.wid || CFG.CAR_W;
    this.v         = o.v || 0;
    this.indicator = o.indicator || 'off';
    this.brakeLight= false;
    this.didStop   = false;
    this.prof      = curveProfile(this.path);
    this.pos       = this.path.at(this.s);
    this.done      = false;
  }
  Vehicle.prototype.front = function(){
    return { x:this.pos.x + Math.cos(this.pos.h)*this.len*0.5,
             y:this.pos.y + Math.sin(this.pos.h)*this.len*0.5 };
  };
  Vehicle.prototype.turn = function(){ return Geo.turnOf(this.fromArm, this.toArm); };

  /* ---------------- Pedestrian ---------------- */
  function Ped(o){
    for (var k in o) this[k] = o[k];
    this.u     = o.u0;                    // lateral position across the road
    this.state = o.start === 'walking' ? 'walking' : 'waiting';
    this.wait  = 0;
  }
  Ped.prototype.point = function(){
    var o = Geo.ARM_VEC[this.arm], p = Geo.rot90cw(o);
    /* in town a pedestrian belongs to one junction; a lesson's sits at 0,0 */
    var nx = this.node ? this.node.x : 0, ny = this.node ? this.node.y : 0;
    return { x:nx + o.x*this.d + p.x*this.u, y:ny + o.y*this.d + p.y*this.u };
  };
  /* Does this pedestrian have the right to be let across by `veh`?
     A zebra (and every crossing in a lesson) - always. Otherwise only
     traffic turning into their road must let them go (Sec. 9 (3)). */
  function pedPriority(ped, veh, exitSide){
    if (ped.zebra || !ped.node) return true;
    return exitSide && veh.turn() !== 'straight';
  }
  /* A waiting pedestrian who would step out right now if the road let
     them: on their green at lights, whenever they like otherwise. */
  function pedWants(ped){
    return ped.state === 'waiting' && (ped.wants !== undefined ? ped.wants : ped.intent);
  }
  /* Someone walking across in front of this vehicle: from the moment they
     step off the kerb until they are past its lane. (A lesson keeps its
     original, simpler test: anyone on the carriageway.) */
  function pedCrossing(ped, exitSide){
    if (ped.state !== 'walking') return false;
    if (!ped.node) return ped.onRoad();
    var lane = exitSide ? CFG.HALF : -CFG.HALF;
    return ped.dir*(ped.u - lane) < CFG.CAR_W/2 + 10 && Math.abs(ped.u) < CFG.BOX + 26;
  }
  Ped.prototype.onRoad = function(){ return Math.abs(this.u) < CFG.BOX + 4; };

  /* ---------------- World ---------------- */
  function World(sc){
    this.sc = sc;
    this.t  = 0;
    this.vehicles = [];
    this.peds = [];
    this.faults = [];
    this.state = 'run';          // run | done | crash
    this.endTimer = 0;
    this.maxSpeed = 0;
    this.idle = 0;
    this.hintText = null;
    this.build();
  }

  World.prototype.pathFor = function(spec){
    var L = this.sc.layout;
    if (spec.kind === 'tram') return Geo.railPath(spec.from, spec.to, spec.railOffset||0);
    if (L.type === 'roundabout') return Geo.roundaboutPath(spec.from, spec.to);
    if (spec.kind === 'bus' && spec.bay) return this.busPath(spec);
    return Geo.junctionPath(spec.from, spec.to);
  };

  /* a bus that starts parked in a lay-by and merges back into the lane */
  World.prototype.busPath = function(spec){
    var jp = Geo.junctionPath(spec.from, spec.to);
    var o  = Geo.ARM_VEC[spec.from], r = Geo.rot90cw(o);
    var d0 = spec.d0;
    var bay = { x:Geo.laneIn(spec.from,d0).x + r.x*CFG.LANE*0.66,
                y:Geo.laneIn(spec.from,d0).y + r.y*CFG.LANE*0.66 };
    var merged = Geo.laneIn(spec.from, d0-150);
    var pts = [bay, merged];
    for (var i=0;i<jp.pts.length;i++){
      if (proj(jp.pts[i], spec.from) < d0-150) pts.push(jp.pts[i]);
    }
    return new Geo.Path(Geo.smooth(pts,1));
  };

  World.prototype.build = function(){
    var sc = this.sc, self = this;
    var holdR = sc.layout.type === 'roundabout' ? CFG.RING + 76 : CFG.BOX + 8;

    function mk(spec, isPlayer){
      var path = self.pathFor(spec);
      var v = new Vehicle({
        path: path, fromArm: spec.from, toArm: spec.to,
        kind: spec.kind || 'car',
        color: spec.color || (isPlayer ? '#4da3ff' : '#e0574a'),
        isPlayer: !!isPlayer,
        len: spec.len, wid: spec.wid,
        emergency: !!spec.emergency,
        signOverride: spec.sign,
        cruise: kmh(spec.speed !== undefined ? spec.speed : 45),
        v: kmh(spec.v0 !== undefined ? spec.v0 : (spec.speed !== undefined ? spec.speed : 45)),
        s: 0, id: spec.id || ('v'+Math.random().toString(36).slice(2,7)),
        parked: !!spec.parked, releaseAt: spec.releaseAt,
        bay: !!spec.bay, indicator: spec.indicator || 'off'
      });
      v.s = (spec.kind === 'bus' && spec.bay) ? 0
          : v.path.sAtRadius(spec.d0 !== undefined ? spec.d0 : CFG.FAR-10);
      v.arriveRel = spec.arriveRel;
      if (spec.parked) v.v = 0;
      v.junctionS = v.path.sAtRadius(holdR);
      v.lineS = v.junctionS - v.len*0.5;   // where the FRONT reaches the line
      /* zebra crossing on the approach arm */
      if (self.hasCrossing(spec.from)){
        v.crossS = sProjBelow(v.path, spec.from, CROSS_MID + CROSS_HALF + 10);
      }
      /* zebra crossing on the arm we turn into */
      if (self.hasCrossing(spec.to) && spec.to !== spec.from){
        v.exitCrossS = sProjAbove(v.path, spec.to, CROSS_MID - CROSS_HALF - 6, v.junctionS);
      }
      v.pos = v.path.at(v.s);
      return v;
    }

    this.player = mk(sc.player, true);
    this.player.maxV = kmh(sc.player.maxSpeed || 70);
    this.vehicles.push(this.player);

    (sc.traffic||[]).forEach(function(spec){ self.vehicles.push(mk(spec,false)); });

    (sc.peds||[]).forEach(function(p){
      self.peds.push(new Ped({
        arm: p.arm, d: CROSS_MID,
        u0: p.from === 'right' ? (CFG.BOX+22) : -(CFG.BOX+22),
        dir: p.from === 'right' ? -1 : 1,
        start: p.start || 'waiting',
        kid: !!p.kid,
        intent: p.intent !== false
      }));
    });

    /* pre-compute the conflict point of every pair of paths */
    this.conf = {};
    for (var i=0;i<this.vehicles.length;i++){
      for (var j=i+1;j<this.vehicles.length;j++){
        var a = this.vehicles[i], b = this.vehicles[j];
        if (a.fromArm === b.fromArm) continue;      // queueing, not crossing
        var th = (a.kind==='tram'||b.kind==='tram') ? CFG.CAR_W+26 : CFG.CAR_W+14;
        var c = Geo.conflictOf(a.path, b.path, th);
        if (c) this.conf[a.id+'|'+b.id] = c;
      }
    }

    /* --- scenario timing ---------------------------------------------
       A scenario is only a good exercise if the other car reaches the
       conflict point at the right moment. Instead of hand-tuning start
       distances, a vehicle may declare arriveRel = how many seconds
       before (-) or after (+) the player it should get there. We solve
       for its start position once the conflict points are known.      */
    var p = this.player;
    for (var v = 0; v < this.vehicles.length; v++){
      var o = this.vehicles[v];
      if (o.isPlayer || o.arriveRel === undefined) continue;
      var c = this.conflictBetween(p, o);
      if (!c) continue;
      var ref = kmh(sc.player.refSpeed !== undefined ? sc.player.refSpeed
                    : (sc.player.v0 !== undefined ? sc.player.v0 : 45));
      var tPlayer = (c.sa - p.s) / Math.max(ref, kmh(5));
      var tO = Math.max(0.2, tPlayer + o.arriveRel);
      o.s = Geo.clamp(c.sb - tO*Math.max(o.v, kmh(5)), 0, Math.max(0, c.sb - 30));
      o.pos = o.path.at(o.s);
      o.junctionS = o.path.sAtRadius(holdR);
      o.lineS = o.junctionS - o.len*0.5;
    }
  };

  /* exposed so tools and the UI can ask "how fast may I take this bend" */
  World.prototype.curveSpeed = function(veh, s){ return curveV(veh, s); };

  /* Which junction's rules apply to this vehicle right now?
     A lesson has exactly one, so it is always the scenario itself; the
     open-world map returns whichever junction the car is approaching. */
  World.prototype.junctionFor = function(){ return this.sc; };

  World.prototype.hasCrossing = function(arm){
    return !!(this.sc.layout.crossings && this.sc.layout.crossings.indexOf(arm) >= 0);
  };
  World.prototype.conflictBetween = function(a,b){
    var c = this.conf[a.id+'|'+b.id];
    if (c) return { sa:c.sa, sb:c.sb, x:c.x, y:c.y };
    c = this.conf[b.id+'|'+a.id];
    if (c) return { sa:c.sb, sb:c.sa, x:c.x, y:c.y };
    return null;
  };
  World.prototype.light = function(arm, veh){
    return Rules.lightFor(this.junctionFor(veh || this.player), arm, this.t);
  };

  /* ---------------- longitudinal control ---------------- */

  /* everything that forces `veh` to slow down; returns {v, cause} */
  World.prototype.constraints = function(veh){
    var self = this, sc = this.sc;
    var best = { v: Math.min(veh.cruise, curveV(veh, veh.s)), cause:null, kind:null };
    function want(v, cause, kind){
      if (v < best.v){ best.v = v; best.cause = cause; best.kind = kind || cause; }
    }

    /* --- traffic light --- */
    var J  = this.junctionFor(veh);
    var ls = Rules.lightFor(J, veh.fromArm, this.t);
    if (ls && veh.s < veh.lineS){
      var d = veh.lineS - veh.s;
      var canStop = d > (veh.v*veh.v)/(2*CFG.AI_DEC);
      if (ls === 'red' || ls === 'redyellow' || (ls === 'yellow' && canStop)){
        if (!(Rules.hasGreenArrow(J, veh.fromArm) && veh.turn() === 'right' && veh.didStop))
          want(approachV(d - 4, CFG.AI_DEC), 'light', 'light');
      }
    }
    /* --- stop sign: a full halt, once --- */
    var sign = veh.signOverride || Rules.signOf(J, veh.fromArm);
    if ((sign === 'stop' || (Rules.hasGreenArrow(J, veh.fromArm) && ls === 'red'))
        && !veh.didStop && veh.s < veh.lineS){
      want(approachV(veh.lineS - veh.s - 2, CFG.AI_DEC), 'stopsign', 'stopsign');
    }
    /* --- Sec. 8 II StVO: approach slowly enough to still give way ---
       "mit maessiger Geschwindigkeit heranfahren". Without it an AI
       cruises up to the line at 50 and only reacts once somebody is
       actually there, by which point no amount of braking helps and it
       simply drives into them. Free driving only: a lesson's traffic is
       placed to arrive at a chosen moment, and slowing it here would
       rewrite the choreography the lesson is teaching. */
    if (this.moderateApproach && veh.s < veh.lineS && !veh.emergency){
      var onPriority = (sign === 'priority') || ls === 'green' || ls === 'yellow';
      if (!onPriority)
        want(approachV(veh.lineS - veh.s, CFG.AI_DEC*0.33) + kmh(7), 'sightline', 'sightline');
    }

    /* --- pedestrians on a crossing ahead of us --- */
    for (var pi=0; pi<this.peds.length; pi++){
      var ped = this.peds[pi];
      if (ped.node !== veh.node || veh.kind === 'tram' || veh.kind === 'bike') continue;
      var cs = null, exitSide = false;
      if (ped.arm === veh.fromArm && veh.crossS !== undefined && veh.s < veh.crossS) cs = veh.crossS;
      if (ped.arm === veh.toArm && veh.exitCrossS !== undefined && veh.s < veh.exitCrossS){ cs = veh.exitCrossS; exitSide = true; }
      if (cs === null) continue;
      /* Nobody drives into a person on the road. Somebody waiting is let
         across only by those who owe it to them - otherwise a car and a
         pedestrian each wait for the other for ever. */
      var blocking = ped.state === 'walking' ? pedCrossing(ped, exitSide)
                   : (pedWants(ped) && pedPriority(ped, veh, exitSide));
      if (!blocking) continue;
      /* Sec. 11: people on the crossing we leave by means the junction
         cannot be cleared - wait at our own line, not in everyone's way */
      if (exitSide && veh.s < veh.lineS && ped.node)
        want(approachV(veh.lineS - veh.s - 4, CFG.AI_DEC), 'ped', 'ped');
      else want(approachV(cs - veh.s - 12, CFG.AI_DEC), 'ped', 'ped');
    }
    /* --- keeping our distance from the car in front --- */
    var lead = this.leaderOf(veh);
    if (lead){
      var g = lead.gap - 18;
      want(Math.max(0, Math.min(lead.veh.v + Math.max(0,g)*0.9,
                                approachV(Math.max(0,g), CFG.AI_DEC))), lead.veh, 'follow');
    }

    /* --- Sec. 11 StVO: only enter a junction you can also clear ---
       Without this, a car stops halfway across, wedges the junction and
       everything behind it waits for ever. */
    if (lead && veh.s < veh.lineS && lead.veh.v < kmh(4)){
      var clearLen = (veh.exitS !== undefined ? veh.exitS - veh.lineS : 150) + veh.len*0.6;
      if (lead.gap < clearLen) want(approachV(veh.lineS - veh.s - 4, CFG.AI_DEC), 'blocked', 'blocked');
    }

    /* --- giving way to other vehicles --- */
    for (var i=0;i<this.vehicles.length;i++){
      var o = this.vehicles[i];
      if (o === veh || o.done) continue;

      var c = this.conflictBetween(veh, o);
      if (!c) continue;
      if (veh.s > c.sa + veh.len*0.5) continue;            // we are through
      if (o.s > c.sb + o.len*0.6) continue;                // they are through

      var pr = Rules.priority(this.junctionFor(veh), veh, o, this.t);
      var mustWait = (pr.who === 'b');                     // `o` has priority
      var tOther = (c.sb - o.s) / Math.max(o.v, kmh(10));
      var tMe    = (c.sa - veh.s) / Math.max(veh.v, kmh(6));

      /* Once you are past the line and merging into the same exit as
         the other car, your job is to clear the junction, not to stop in
         it (Sec. 11). Waiting inside a junction is only right when you
         are a left-turner holding for oncoming traffic. */
      /* Whoever is already crossing the junction is let out first, whatever
         the signs say: you cannot enforce priority against a car that is
         already in there. Only cars still short of their own line defer,
         and only to somebody actually moving through - defer to one that
         has stopped, and a left-turner waiting inside for us while we wait
         outside for it holds the junction shut for good. */
      var occupying = o.s > o.lineS && (o.exitS === undefined || o.s < o.exitS) &&
                      o.v > kmh(3) && o.brakeCause !== veh;
      /* Gate on the real conflict point, not our own give-way line: on a
         wide junction a car can clear its line well before it reaches
         where the paths actually cross, and stops needing to look out for
         someone already committed right when it matters most. */
      /* ...and a car still standing does not move off into them at all */
      if (occupying && veh.s < c.sa - 10 && (tMe < 3.2 || veh.v < kmh(5)))
        want(approachV(Math.max(0, c.sa - veh.s - 14), CFG.AI_DEC), o, 'occupied');

      var merging = (veh.toArm === o.toArm) && veh.s > veh.lineS + 6;
      /* patience: if we have both been crawling a while, somebody has to
         move, which is what a driver waving you through amounts to */
      var deadlocked = (veh.stoppedFor || 0) > 4 && (o.stoppedFor || 0) > 4;
      if (mustWait && isApproaching(o) && !deadlocked && !merging){
        if (tOther < tMe + 2.4 || o.s > c.sb - o.len){
          var stopAt = Math.min(veh.lineS, c.sa - veh.len*0.5 - 22);
          want(approachV(stopAt - veh.s, CFG.AI_DEC), o, 'yield');
        }
      } else if (pr.who === 'coordinate'){
        /* Nobody has priority here, so somebody still has to decide. Judge
           both cars by the same yardstick - the separate speed floors above
           flatter the other car, so each reads the other as the faster and
           both stop - and settle a dead heat the same way every time. Two
           cars politely waiting for each other lock a roundabout solid. */
        var floor = kmh(8);
        var tHim = (c.sb - o.s)   / Math.max(o.v,   floor);
        var tUs  = (c.sa - veh.s) / Math.max(veh.v, floor);
        var giveWay = tHim < tUs - 0.3 ||
                      (Math.abs(tHim - tUs) <= 0.3 && String(o.id) < String(veh.id));
        if (giveWay && tUs < 2.2 && !deadlocked)
          want(approachV(Math.max(0, c.sa - veh.s - 34), CFG.AI_DEC), o, 'yield');
      }
    }
    return best;
  };

  /* The vehicle we are following: nearest one ahead, in our lane, pointing
     roughly the same way. Works across separate paths, which the open-world
     map needs and a lesson does not mind. */
  World.prototype.leaderOf = function(veh){
    var best = null, c = Math.cos(veh.pos.h), s = Math.sin(veh.pos.h);
    for (var i=0;i<this.vehicles.length;i++){
      var o = this.vehicles[i];
      if (o === veh || o.done) continue;
      /* a train on its track or a cyclist on a cycle path is never "the
         car in front" of a car, nor the other way round */
      if (laneClass(o) !== laneClass(veh)) continue;
      var dx = o.pos.x - veh.pos.x, dy = o.pos.y - veh.pos.y;
      if (Math.hypot(dx,dy) > 420) continue;
      var lon =  dx*c + dy*s;
      var lat = -dx*s + dy*c;
      if (lon <= 0) continue;
      if (Math.abs(lat) > (veh.wid + o.wid)*0.5 + 14) continue;
      var dh = Math.atan2(Math.sin(o.pos.h - veh.pos.h), Math.cos(o.pos.h - veh.pos.h));
      if (Math.abs(dh) > 1.0) continue;
      var gap = lon - (veh.len + o.len)*0.5;
      if (!best || gap < best.gap) best = { veh:o, gap:gap };
    }
    return best;
  };

  /* Last-resort anti-crash braking for the AI only.
     Measured against the other car's real footprint - the same circles
     the collision test uses - rather than its bounding box. A box is far
     too fat side-on: it makes a car waiting in its own lane read as if it
     were parked across the junction, which is how a whole town gridlocks.
     Only what is genuinely ahead of our own nose counts; something level
     with us we drive clear of, we do not stop for. */
  World.prototype.proximityBrake = function(veh){
    var near = [], i, j, k;
    for (i=0;i<this.vehicles.length;i++){
      var o = this.vehicles[i];
      if (o === veh || o.done) continue;
      if (Geo.dist(o.pos, veh.pos) > 230) continue;
      /* A stand-off: two cars nosed into the same junction, each stopped
         for the other - or a ring of them, all inside and all standing.
         Somebody waves somebody through; settle it the same way every
         time so exactly one of them moves. Never applies to the player. */
      var still = (veh.stoppedFor || 0) > 6 && (o.stoppedFor || 0) > 6 && !o.isPlayer &&
                  veh.kind !== 'tram' && o.kind !== 'tram';        // a train never waves anyone on
      var mutual = o.brakeCause === veh ||
                   ((veh.stoppedFor || 0) > 20 && veh.s > veh.lineS && o.s > o.lineS);
      if (still && mutual && String(veh.id) < String(o.id)) continue;
      near.push({ veh:o, circ:bodyCircles(o) });
    }
    if (!near.length) return { v:1e9, who:null };

    /* Walk our own path forward from the nose and ask what we would
       actually drive into. Projecting on the current heading instead gets
       a turn badly wrong - it looks straight through the bend - and calls
       a car standing beside us an obstruction, which wedges junctions. */
    var half = veh.wid*0.5, limit = 1e9, who = null;
    var end = Math.min(190, veh.path.length - veh.s);
    for (var d = veh.len*0.5 + 4; d <= end; d += 8){
      var q = veh.path.at(veh.s + d);
      for (j=0;j<near.length;j++){
        var circ = near[j].circ;
        for (k=0;k<circ.length;k++){
          if (Math.hypot(circ[k].x - q.x, circ[k].y - q.y) > half + circ[k].r + 4) continue;
          var lim = approachV(Math.max(0, d - veh.len*0.5 - 12), CFG.AI_DEC*1.15);
          if (lim < limit){ limit = lim; who = near[j].veh; }
        }
      }
      if (limit <= 0) break;
    }
    return { v:limit, who:who };
  };

  /* ---------------- update ---------------- */
  World.prototype.update = function(dt, input){
    var i;
    if (this.state !== 'run'){ this.endTimer += dt; return; }
    this.t += dt;

    /* --- pedestrians decide whether to step onto the road --- */
    for (i=0;i<this.peds.length;i++) this.updatePed(this.peds[i], dt);

    /* --- vehicles --- */
    for (i=0;i<this.vehicles.length;i++){
      var veh = this.vehicles[i];
      if (veh.done) continue;
      if (veh.isPlayer) this.drivePlayer(veh, dt, input);
      else this.driveAI(veh, dt);

      veh.s += veh.v*dt;
      veh.pos = veh.path.at(veh.s);
      veh.stoppedFor = veh.v < kmh(5) ? (veh.stoppedFor || 0) + dt
                                       : Math.max(0, (veh.stoppedFor || 0) - dt*2.5);
      if (veh.v < kmh(1.6) && veh.s < veh.junctionS) veh.didStop = true;
      if (veh.s >= veh.path.length - 4){
        if (veh.isPlayer) this.finish('ziel');
        else veh.done = true;
      }
    }

    this.examine(dt, input);
    this.collisions();
  };

  World.prototype.updatePed = function(ped, dt){
    if (ped.state === 'walking'){
      /* in town: stop short of a car in the way - and if it just stands
         there, walk round it the way people do */
      if (ped.node && this.pedBlockedAhead && (ped.blockedFor || 0) < 1.5 && this.pedBlockedAhead(ped, 14)){
        ped.blockedFor = (ped.blockedFor || 0) + dt;
        return;
      }
      ped.u += ped.dir*CFG.PED_V*dt;
      if (Math.abs(ped.u) > CFG.BOX + 26) ped.state = 'done';
      return;
    }
    if (ped.state !== 'waiting') return;
    ped.wait += dt;
    /* in town: their light (if any) first, then the traffic */
    if (ped.node && this.pedWants){
      ped.wants = this.pedWants(ped);
      if (ped.wants && this.pedMayGo(ped)) ped.state = 'walking';
      return;
    }
    /* step out when the nearest approaching car is far enough away or slow */
    var safe = true;
    for (var i=0;i<this.vehicles.length;i++){
      var v = this.vehicles[i];
      if (v.done) continue;
      var cs = (v.fromArm === ped.arm && v.crossS !== undefined) ? v.crossS
             : (v.toArm === ped.arm && v.exitCrossS !== undefined) ? v.exitCrossS : null;
      if (cs === null || v.s > cs) continue;
      var tt = (cs - v.s) / Math.max(v.v, 1);
      if (v.v > kmh(6) && tt < 2.6) safe = false;
    }
    if (ped.intent && (safe || ped.wait > 6)) ped.state = 'walking';
  };

  World.prototype.driveAI = function(veh, dt){
    if (veh.parked){
      if (this.t < (veh.releaseAt||0)){ veh.v = 0; return; }
      if (this.t < (veh.releaseAt||0) + 1.2){ veh.indicator = 'left'; veh.v = 0; veh.pullingOut = true; return; }
      veh.pullingOut = veh.s < veh.path.sAtRadius(CFG.FAR - 260);
      veh.parked = false;
    }
    var c = this.constraints(veh);
    var prox = this.proximityBrake(veh);
    var target = Math.min(c.v, prox.v);
    veh.brakeCause = (c.v <= prox.v + 0.01) ? c.cause : prox.who;
    veh.brakeKind  = (c.v <= prox.v + 0.01) ? c.kind  : 'prox';
    if (target > veh.cruise) target = veh.cruise;

    if (target > veh.v) veh.v = Math.min(target, veh.v + CFG.AI_ACC*dt);
    else                veh.v = Math.max(target, veh.v - CFG.AI_DEC*dt);
    if (veh.v < 0) veh.v = 0;
    veh.brakeLight = target < veh.v - 1;

    /* AI indicators */
    var t = veh.turn();
    if (this.junctionFor(veh).layout.type === 'roundabout'){
      veh.indicator = veh.s > veh.path.length - 260 ? 'right' : 'off';
    } else if (veh.s > veh.junctionS - 220 && veh.s < veh.junctionS + 60 && t !== 'straight'){
      veh.indicator = t;
    } else if (!veh.pullingOut){
      veh.indicator = 'off';
    }
  };

  World.prototype.drivePlayer = function(veh, dt, input){
    /* A key is a pedal to the floor. A controller's trigger says how far
       the pedal is down (input.gas, input.brakeAmt, 0..1): the brake bites
       in proportion, and a part-pressed accelerator settles at a speed
       rather than climbing for ever, as a real one does against drag. */
    var gas = input.gas !== undefined && input.gas !== null ? input.gas : (input.throttle ? 1 : 0);
    var brk = input.brakeAmt !== undefined && input.brakeAmt !== null ? input.brakeAmt : (input.brake ? 1 : 0);
    if (brk > 0.03) veh.v -= (CFG.COAST + (CFG.BRAKE - CFG.COAST)*brk)*dt;
    else if (gas >= 0.999) veh.v += CFG.ACC*dt;
    else if (gas > 0.03 && veh.v < veh.maxV*Math.pow(gas, 0.8)) veh.v += CFG.ACC*(0.35 + 0.65*gas)*dt;
    else veh.v -= CFG.COAST*dt;
    veh.v = Geo.clamp(veh.v, 0, veh.maxV);
    veh.brakeLight = brk > 0.03;
    veh.indicator = input.indicator;
    this.maxSpeed = Math.max(this.maxSpeed, veh.v);
  };

  /* ---------------- the examiner ---------------- */
  World.prototype.fault = function(id, reason, detail){
    for (var i=0;i<this.faults.length;i++) if (this.faults[i].id === id) return;
    this.faults.push({ id:id, reason:reason||null, detail:detail||null, t:this.t });
  };

  World.prototype.examine = function(dt, input){
    var sc = this.sc, p = this.player, i;
    var prevS = p.prevS === undefined ? p.s : p.prevS;

    /* --- speed limit --- */
    /* Booked for driving too fast, not for the instant a new limit starts
       to apply: passing a sign at the old speed and slowing is what a
       driver actually does. */
    var lim = sc.limit || 50, nowKmh = toKmh(p.v);
    /* a warning first: creeping a few km/h over happens to everyone, and
       you get a few seconds to notice and ease off. Clearly too fast
       (more than 12 over) is booked almost at once, as in a real test. */
    this.speedWarn = nowKmh > lim + 2;
    if (nowKmh > lim + 4) this.overspeed = (this.overspeed || 0) + dt;
    else this.overspeed = 0;
    var grace = nowKmh > lim + 12 ? 1.2 : 4;
    if (this.overspeed > grace) this.fault('zu_schnell', null, {
      de: Math.round(toKmh(this.maxSpeed))+' km/h statt erlaubter '+lim+' km/h',
      en: Math.round(toKmh(this.maxSpeed))+' km/h where '+lim+' km/h is the limit' });
    /* --- Schrittgeschwindigkeit (home zone, bus with hazard lights) --- */
    if (sc.walkingPace && p.s < p.lineS && toKmh(p.v) > 9)
      this.fault('schritt', null, {
        de: Math.round(toKmh(p.v))+' km/h – erlaubt sind etwa 4 bis 7 km/h',
        en: Math.round(toKmh(p.v))+' km/h – about 4 to 7 km/h is allowed' });
    /* --- too fast through the bend --- */
    if (p.s > p.lineS && p.v > curveV(p, p.s)*1.7 && p.turn() !== 'straight')
      this.fault('kurve_zu_schnell');

    /* Note, every frame we are still short of the line, which conflicting
       cars the game is calling clear. A car far off can tip the arithmetic
       either way between one frame and the next, and the examiner must not
       be able to contradict a tenth of a second later the answer it was
       giving while we decided to go. */
    if (p.s < p.lineS){
      if (!p.wasClear) p.wasClear = {};
      for (var wi=0; wi<this.vehicles.length; wi++){
        var wv = this.vehicles[wi];
        if (wv.isPlayer || wv.done) continue;
        var wc = this.conflictBetween(p, wv);
        if (wc && !this.hinders(p, wv, wc)) p.wasClear[wv.id] = this.t;
      }
    }

    /* --- crossing the stop line: the big moment --- */
    if (prevS < p.lineS && p.s >= p.lineS){
      this.checkEntry();
    }
    /* --- stopped past the line while obliged to give way --- */
    /* (waiting for people on the crossing beyond the line is where you
       are meant to wait, so that does not count) */
    if (p.v < kmh(1.5) && p.s > p.lineS + 10 && p.s < p.lineS + 80 && this.mustGiveWayHere() && !this.pedBlocking())
      this.fault('haltelinie');

    /* --- pedestrian crossings --- */
    this.checkPeds(prevS);

    /* --- bus pulling out: did we squeeze past it? --- */
    for (i=0;i<this.vehicles.length;i++){
      var b = this.vehicles[i];
      if (b.kind !== 'bus' || !b.pullingOut || b.fromArm !== p.fromArm) continue;
      if (b.v < kmh(4) && proj(p.pos, p.fromArm) < proj(b.pos, b.fromArm) - 4)
        this.fault('bus_behindert', 'bus');
    }
    /* --- an AI with priority forced to brake because of us --- */
    for (i=0;i<this.vehicles.length;i++){
      var o = this.vehicles[i];
      if (o.isPlayer || o.done) continue;
      if (o.brakeCause !== p) continue;
      /* being behind us in the queue is not a failure to give way */
      if (o.brakeKind === 'follow' || o.brakeKind === 'blocked') continue;
      /* it stood and let us out: it does not get to change its mind */
      if (p.conceded && p.conceded[o.id]) continue;
      if (o.brakeKind === 'prox'){
        /* A last-resort lift-off is not evidence on its own: the envelope
           it uses is deliberately fat, so two cars rounding the same bend
           in their own lanes trip it. Blame us only where the paths really
           do cross, and only once we have actually crossed our own line -
           behind it we are where we belong. */
        if (!this.conflictBetween(p, o)) continue;
        if (p.s < p.lineS) continue;
        /* measured nose to body: a 25 m train's centre is far from the
           car it is braking for even when its front is right there */
        if (Geo.dist(o.pos, p.pos) - Math.max(0, o.len - CFG.CAR_L)*0.5 > 130) continue;
        var dh = Math.abs(Math.atan2(Math.sin(o.pos.h - p.pos.h), Math.cos(o.pos.h - p.pos.h)));
        if (dh < 0.6) continue;                 // same direction: just traffic
      }
      /* Slowing for its own bend is not "had to brake because of you". */
      var freeV = Math.min(o.cruise, this.curveSpeed(o, o.s));
      if (o.v > freeV*0.75) continue;
      var pr = Rules.priority(this.junctionFor(p), p, o, this.t);
      if (pr.who === 'b') this.fault(this.faultForReason(pr.reason), pr.reason, this.describe(o));
    }
    /* --- standing still although we had priority --- */
    if (p.v < kmh(1.2) && p.s < p.lineS && p.s > p.lineS - 150){
      /* queued behind somebody is not dithering: we cannot drive through
         the car in front, and Sec. 11 forbids entering a junction we
         could not clear anyway */
      var ahead = this.leaderOf(p);
      var queued = !!(ahead && ahead.gap < 110 && ahead.veh.v < kmh(6));
      if (!queued && !this.mustGiveWayHere() && !this.pedBlocking() && this.light(p.fromArm, p) !== 'red'
          && this.light(p.fromArm, p) !== 'redyellow'
          && (p.signOverride || Rules.signOf(this.junctionFor(p), p.fromArm)) !== 'stop'){
        this.idle += dt;
        if (this.idle > 2.0) this.fault('vorfahrt_nicht_genutzt');
      }
    } else this.idle = 0;

    /* --- time limit --- */
    if (this.t > (sc.timeLimit || 45)){ this.fault('zeit'); this.finish('zeit'); }

    p.prevS = p.s;
  };

  World.prototype.faultForReason = function(reason){
    if (reason === 'einsatz') return 'einsatz_blockiert';
    if (reason === 'bus')     return 'bus_behindert';
    if (reason === 'rad_abbiegen') return 'abbiegen_rad';
    return 'vorfahrt';
  };

  /* description of the other party, in German, for the report */
  World.prototype.describe = function(o){
    var p = this.player, de = null, en = null;
    if (o.fromArm === Geo.rightOf(p.fromArm)){ de = ' von rechts'; en = ' from your right'; }
    else if (o.fromArm === Geo.leftOf(p.fromArm)){ de = ' von links'; en = ' from your left'; }
    else if (o.fromArm === Geo.opposite(p.fromArm)){ de = ' aus dem Gegenverkehr'; en = ' coming the other way'; }
    var whatDe = o.kind === 'tram' ? 'Die Strassenbahn'
               : o.kind === 'bus'  ? 'Der Linienbus'
               : o.kind === 'bike' ? 'Der Radfahrer'
               : o.emergency       ? 'Das Einsatzfahrzeug' : 'Das Fahrzeug';
    var whatEn = o.kind === 'tram' ? 'The tram'
               : o.kind === 'bus'  ? 'The bus'
               : o.kind === 'bike' ? 'The cyclist'
               : o.emergency       ? 'The emergency vehicle' : 'The car';
    /* a cyclist beside us going our way comes from behind, not from a side */
    if (o.kind === 'bike' && o.fromArm === p.fromArm){ de = ' von hinten'; en = ' coming up behind you'; }
    return { de: whatDe + (de||''), en: whatEn + (en||'') };
  };

  /* Would pulling out now actually hold the other driver up?
     Both the live hint and the examiner ask this exact question, so the
     game can never warn you it is clear and then book you for going. */
  World.prototype.hinders = function(p, o, c){
    if (o.s > c.sb + o.len*0.6) return false;   // already through
    /* A car that is slow only because it is already easing off for us is
       still coming: pull out and it simply has to keep braking, which is
       the fault itself. Without this the game waves you into a car that
       lifted off precisely because you were waiting at the line. Once it
       has genuinely come to a stand we take it at its word and go. */
    var easingForUs = (o.brakeCause === p) && (o.stoppedFor || 0) < 3;
    /* nor is a car that has only stopped to let people cross: it goes the
       moment they are over, and it still has priority when it does */
    var waitingForPeople = o.brakeKind === 'ped' && o.s < c.sb;
    if (!easingForUs && !waitingForPeople){
      if (!isApproaching(o)) return false;      // waiting at its own line
      if (o.v < kmh(5)) return false;           // standing still
    }
    var freeV  = Math.max(o.v, o.cruise*0.8);
    var tOther = (c.sb - o.s - (o.len*0.5 + 18)) / Math.max(freeV, kmh(10));
    /* how long we really need to get clear from the speed we have now,
       pulling away at a normal rate - from a standstill that is longer
       than any steady speed would suggest */
    var dist = Math.max(0, c.sa + p.len*0.5 + 24 - p.s);
    var acc = (p.isPlayer ? CFG.ACC : CFG.AI_ACC) * 0.8;
    var tAcc = (-p.v + Math.sqrt(p.v*p.v + 2*acc*dist)) / acc;
    var tClear = Math.min(tAcc, dist / Math.max(p.v, kmh(14)) + 1.2);
    return tOther < tClear + 0.9;
  };

  /* is there, right now, somebody we are obliged to wait for? */
  World.prototype.mustGiveWayHere = function(){
    var p = this.player, sc = this.sc;
    var ls = this.light(p.fromArm, p);
    if (ls === 'red' || ls === 'redyellow') return true;
    for (var i=0;i<this.vehicles.length;i++){
      var o = this.vehicles[i];
      if (o.isPlayer || o.done) continue;
      /* a bus indicating out of its stop just ahead of us */
      if (o.kind === 'bus' && o.pullingOut && o.fromArm === p.fromArm){
        var gap = proj(p.pos, p.fromArm) - proj(o.pos, o.fromArm);
        if (gap > 0 && gap < 330) return true;
      }
      var c = this.conflictBetween(p,o);
      if (!c) continue;
      if (o.s > c.sb + o.len*0.6) continue;
      var pr = Rules.priority(this.junctionFor(p), p, o, this.t);
      if (pr.who !== 'b') continue;
      if (this.hinders(p, o, c)) return true;
    }
    return false;
  };
  World.prototype.pedBlocking = function(){
    var p = this.player;
    for (var i=0;i<this.peds.length;i++){
      var ped = this.peds[i];
      if (ped.node !== p.node) continue;
      if (ped.arm !== p.fromArm && ped.arm !== p.toArm) continue;
      if (ped.state === 'walking' && ped.onRoad()) return true;
      if (pedWants(ped) && pedPriority(ped, p, ped.arm === p.toArm)) return true;
    }
    return false;
  };

  /* the moment the player passes the give-way / stop line */
  World.prototype.checkEntry = function(){
    var sc = this.sc, p = this.player, i;
    var ls  = this.light(p.fromArm, p);
    var arrow = Rules.hasGreenArrow(this.junctionFor(p), p.fromArm) && p.turn() === 'right';

    /* red light */
    if (ls === 'red' || ls === 'redyellow'){
      if (arrow){ if (!p.didStop) this.fault('gruenpfeil_kein_halt'); }
      else this.fault('rotlicht');
    }
    /* stop sign */
    var sign = p.signOverride || Rules.signOf(this.junctionFor(p), p.fromArm);
    if (sign === 'stop' && !p.didStop) this.fault('stop_kein_halt');

    /* indicators */
    var t = p.turn();
    if (this.junctionFor(p).layout.type === 'roundabout'){
      if (p.indicator === 'left') this.fault('blinker_kreisel', null,
        { de:'Beim Einfahren in den Kreisel wird nicht geblinkt.',
          en:'You indicated left while joining the roundabout.' });
    } else if (t === 'left' && p.indicator !== 'left'){
      this.fault('blinker', null, { de:'Links abgebogen ohne Blinker.', en:'Turned left without indicating.' });
    } else if (t === 'right' && p.indicator !== 'right'){
      this.fault('blinker', null, { de:'Rechts abgebogen ohne Blinker.', en:'Turned right without indicating.' });
    }

    /* did we cut in front of somebody with priority? */
    /* Whoever was not in our way as we committed is noted down. The hint
       and the examiner must give the same answer, so a car that had
       stopped and let us go cannot become a failure to give way once we
       are already across the line and committed to the turn. */
    p.conceded = {};
    for (i=0;i<this.vehicles.length;i++){
      var o = this.vehicles[i];
      if (o.isPlayer || o.done) continue;
      var c = this.conflictBetween(p,o);
      if (!c) continue;
      var pr = Rules.priority(this.junctionFor(p), p, o, this.t);
      if (pr.who !== 'b') continue;
      var clearAt = p.wasClear && p.wasClear[o.id];
      var toldClear = clearAt !== undefined && this.t - clearAt < 0.7;
      if (this.hinders(p, o, c) && !toldClear)
        this.fault(this.faultForReason(pr.reason), pr.reason, this.describe(o));
      else p.conceded[o.id] = true;
    }
  };

  World.prototype.checkPeds = function(prevS){
    var p = this.player;
    for (var i=0;i<this.peds.length;i++){
      var ped = this.peds[i];
      if (ped.node !== p.node) continue;
      var exitSide = (ped.arm === p.toArm && p.exitCrossS !== undefined);
      var cs = (ped.arm === p.fromArm && p.crossS !== undefined) ? p.crossS
             : exitSide ? p.exitCrossS : null;
      if (cs === null) continue;
      if (cs === p.crossS) exitSide = false;
      if (prevS < cs && p.s >= cs){
        var turning = exitSide && p.turn() !== 'straight';
        var owed = pedPriority(ped, p, exitSide);
        var id = turning ? 'abbiegen_fussgaenger' : 'fussgaenger';
        /* Someone already crossing: a fault if they had the right to be
           there, or - even if they had not - if we drove at them. */
        if (pedCrossing(ped, exitSide) && (owed || this.pedInPath(p, ped, exitSide)))
          this.fault(id, null,
            { de:'Der Fussgänger war schon auf der Fahrbahn.',
              en:'The pedestrian was already on the road.' });
        else if (pedWants(ped) && owed && p.v > kmh(12))
          this.fault(id, null,
            { de:'Der Fussgänger wartete erkennbar am Bordstein.',
              en:'The pedestrian was clearly waiting at the kerb.' });
      }
    }
  };
  /* is a pedestrian on the road in, or about to walk into, our lane? */
  World.prototype.pedInPath = function(p, ped, exitSide){
    var lane = exitSide ? CFG.HALF : -CFG.HALF;       // our lane, across the crossing
    var ahead = ped.u + ped.dir*CFG.PED_V*1.0;        // where they will be in a second
    var lo = Math.min(ped.u, ahead), hi = Math.max(ped.u, ahead);
    return hi > lane - (CFG.CAR_W/2 + 10) && lo < lane + (CFG.CAR_W/2 + 10);
  };

  /* ---------------- collisions ---------------- */
  function bodyCircles(v){
    var c = Math.cos(v.pos.h), s = Math.sin(v.pos.h);
    var n = Math.max(2, Math.round(v.len/26)), out = [];
    for (var i=0;i<n;i++){
      var t = (i/(n-1) - 0.5)*(v.len - v.wid);
      out.push({ x:v.pos.x + c*t, y:v.pos.y + s*t, r:v.wid*0.5 });
    }
    return out;
  }
  World.prototype.collisions = function(){
    var p = this.player, i, j, k, m;
    var pc = bodyCircles(p);
    for (i=0;i<this.vehicles.length;i++){
      var o = this.vehicles[i];
      if (o.isPlayer || o.done) continue;
      var oc = bodyCircles(o);
      for (k=0;k<pc.length;k++) for (m=0;m<oc.length;m++){
        if (Math.hypot(pc[k].x-oc[m].x, pc[k].y-oc[m].y) < pc[k].r+oc[m].r-3){
          this.fault('kollision', null, this.describe(o));
          this.crashPoint = { x:(pc[k].x+oc[m].x)/2, y:(pc[k].y+oc[m].y)/2 };
          this.finish('crash');
          return;
        }
      }
    }
    /* a car standing still does not run anybody over */
    for (i=0;i<this.peds.length && p.v > kmh(3);i++){
      var ped = this.peds[i];
      if (ped.state === 'done') continue;
      var pp = ped.point();
      /* only the front of the car, driving on, can run somebody down */
      for (k=Math.floor(pc.length/2);k<pc.length;k++){
        if (Math.hypot(pc[k].x-pp.x, pc[k].y-pp.y) < pc[k].r + 9){
          this.fault('ped_kollision');
          this.crashPoint = pp;
          this.finish('crash');
          return;
        }
      }
    }
  };

  World.prototype.finish = function(why){
    if (this.state !== 'run') return;
    this.state = why === 'crash' ? 'crash' : 'done';
    this.endReason = why;
    this.player.v = why === 'crash' ? 0 : this.player.v;
  };

  /* ---------------- live coaching hint ---------------- */
  /* Returns a bilingual {de,en} pair, or null. The UI picks a language. */
  World.prototype.hint = function(){
    var p = this.player, sc = this.sc, i;
    if (this.state !== 'run') return null;
    var ls = this.light(p.fromArm, p);

    if (p.s < p.lineS){
      if (ls === 'red' || ls === 'redyellow')
        return { de:'Rot – vor der Haltelinie anhalten.',
                 en:'Red – stop before the line.' };
      if (ls === 'yellow')
        return { de:'Gelb – anhalten, wenn du noch sicher bremsen kannst.',
                 en:'Amber – stop if you can still brake safely.' };

      var sign = p.signOverride || Rules.signOf(this.junctionFor(p), p.fromArm);
      if (sign === 'stop' && !p.didStop)
        return { de:'Stoppschild: vollständig anhalten, auch wenn frei ist.',
                 en:'STOP sign: come to a complete standstill, even if the road is clear.' };
      if (Rules.hasGreenArrow(this.junctionFor(p), p.fromArm) && ls === 'red' && !p.didStop)
        return { de:'Grünpfeil: erst vollständig halten, dann rechts abbiegen.',
                 en:'Green arrow: stop completely first, then turn right.' };
      if (this.pedBlocking() && p.crossS !== undefined && p.s < p.crossS)
        return { de:'Fussgänger am Überweg – anhalten und vorlassen.',
                 en:'Pedestrian at the crossing – stop and let them go.' };

      /* who, specifically, do we have to wait for? */
      var worst = null;
      for (i=0;i<this.vehicles.length;i++){
        var o = this.vehicles[i];
        if (o.isPlayer || o.done) continue;
        var c = this.conflictBetween(p,o);
        if (!c || o.s > c.sb + o.len || !isApproaching(o)) continue;
        var pr = Rules.priority(this.junctionFor(p), p, o, this.t);
        var tOther = (c.sb - o.s)/Math.max(o.v, kmh(10));
        if (pr.who === 'b' && tOther < 5.5){
          var who = this.describe(o);
          var r = Rules.REASON_TEXT[pr.reason];
          worst = {
            de: who.de + ' hat Vorfahrt' + (r ? ' – ' + r.title.de.toLowerCase() : '') + '.',
            en: who.en + ' has priority' + (r ? ' – ' + r.title.en.toLowerCase() : '') + '.'
          };
        }
      }
      if (worst) return worst;

      /* nothing to wait for: coach the mechanics instead */
      var t = p.turn();
      if (this.junctionFor(p).layout.type === 'roundabout')
        return { de:'Kreisverkehr: Vorfahrt beachten, beim Einfahren NICHT blinken.',
                 en:'Roundabout: give way to the circle, and do NOT indicate joining it.' };
      if (t !== 'straight' && p.indicator !== t)
        return t === 'left'
          ? { de:'Blinker links setzen.', en:'Indicate left.' }
          : { de:'Blinker rechts setzen.', en:'Indicate right.' };
      /* turning across the tracks beside the main road */
      var JJ = this.junctionFor(p);
      /* only off the main road, where the train shares your green */
      if (JJ.rail && p.toArm === JJ.rail.side && (p.fromArm === 'N' || p.fromArm === 'S') &&
          p.s > p.lineS - 260)
        return { de:'Du biegst über die Gleise ab: Schulterblick – Bahnen von hinten und von vorn haben Vorrang.',
                 en:'You are turning across the tram tracks: look over your shoulder – trains from behind and ahead go first.' };
      if (p.v < kmh(3) && p.s > p.lineS - 120)
        return { de:'Frei – du darfst fahren.', en:'Clear – you may go.' };
      /* in the driver view you have to actually look before you go */
      if (p.s > p.lineS - 220 && this.junctionFor(p).layout.type !== 'roundabout')
        return { de:'Vor der Kreuzung: Tempo raus und nach links und rechts schauen.',
                 en:'Coming up to the junction: ease off and look left and right.' };
      return { de:'Frei – du darfst fahren.', en:'Clear – you may go.' };
    }

    var nearExit = (p.exitS !== undefined) ? (p.s > p.exitS - 260 && p.s < p.exitS)
                                           : (p.s > p.path.length - 300);
    if (this.junctionFor(p).layout.type === 'roundabout' && p.indicator !== 'right' && nearExit)
      return { de:'Vor dem Verlassen des Kreisels rechts blinken.',
               en:'Indicate right before you leave the roundabout.' };
    if (p.exitCrossS !== undefined && p.s < p.exitCrossS && this.pedBlocking())
      return { de:'Beim Abbiegen haben Fussgänger Vorrang.',
               en:'Pedestrians have priority over you while you turn.' };
    return null;
  };

  /* ---------------- final report ---------------- */
  World.prototype.report = function(){
    var score = 100, major = 0;
    var rows = this.faults.map(function(f){
      var def = Rules.FAULTS[f.id];
      score -= def.pts;
      if (def.sev === 'major') major++;
      return { id:f.id, def:def, reason:f.reason, detail:f.detail };
    });
    score = Math.max(0, score);
    return { score:score, passed: major === 0 && score >= 70, faults:rows,
             reason:this.endReason };
  };

  return { World:World, Vehicle:Vehicle, Ped:Ped, curveProfile:curveProfile,
           CROSS_MID:CROSS_MID, CROSS_HALF:CROSS_HALF, proj:proj, bodyCircles:bodyCircles,
           pedCrossing:pedCrossing };
})();
