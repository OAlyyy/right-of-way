'use strict';
/* ------------------------------------------------------------------
   drive.js - free driving through the open world.

   Reuses the lesson simulator wholesale: same physics, same priority
   engine, same fault catalogue. What changes is that every car now
   carries a route through many junctions instead of sitting on one,
   and the examiner interrupts the drive the moment you get it wrong.
   ------------------------------------------------------------------ */

var Drive = (function(){

  var TARGET_TRAFFIC = 13;
  var SPAWN_NEAR = 2400, DESPAWN_FAR = 3400;
  /* rewind: a snapshot of the whole town every half second, the last ~15 s
     kept, and a retry goes back this far before the moment of the fault */
  var SNAP_EVERY = 0.5, SNAP_KEEP = 30, REWIND_BY = 5;

  /* ---------------- the world ---------------- */
  function DriveWorld(opts){
    opts = opts || {};
    this.map  = new City.Map({ cols:opts.cols || 5, rows:opts.rows || 4, seed:opts.seed || 7 });
    this.rand = City.rng((opts.seed || 7) * 31 + 11);
    this.sc   = { limit:50, timeLimit:1e9, layout:{ type:'cross', arms:Geo.ARM_ORDER, signs:{} },
                  points:[], title:'Freie Fahrt', en:'Free drive' };
    this.t = 0;
    this.vehicles = [];
    this.peds = [];
    this.faults = [];
    this.state = 'run';
    this.endTimer = 0;
    this.maxSpeed = 0;
    this.idle = 0;
    this.paused = false;
    this.pending = null;          // the fault being explained right now
    this.fixed   = [];            // faults taken back with a rewind and retried
    this.history = [];            // snapshots for rewinding
    this.hold    = null;          // after a rewind: frozen until you press gas
    this.cleared = 0;             // junctions driven correctly
    this.target  = opts.target || 12;
    this.moderateApproach = true; // Sec. 8 II: live traffic eases off at junctions
    this.build();
  }
  DriveWorld.prototype = Object.create(Sim.World.prototype);
  DriveWorld.prototype.constructor = DriveWorld;

  /* ---------------- building ---------------- */
  DriveWorld.prototype.build = function(){
    City.buildConflictTable();
    var m = this.map;
    var start = m.nodeAt(0, m.rows - 1) || m.nodes[0];
    var startArm = start.arms.indexOf('S') >= 0 ? 'S' : start.arms[0];

    this.player = this.makeCar({
      node:start, from:startArm, steps:60, isPlayer:true,
      color:'#4da3ff', speed:50
    });
    this.player.maxV = kmh(90);
    this.player.v = kmh(30);
    this.vehicles.push(this.player);

    for (var i = 0; i < TARGET_TRAFFIC; i++) this.spawnTraffic(true);
  };

  var CAR_COLORS = ['#e0574a','#e8b93c','#54a86b','#d8dde3','#7a6fd0','#3f8fd0','#c97b3f'];

  DriveWorld.prototype.makeCar = function(o){
    var route = this.map.buildRoute(o.node, o.from, o.steps, this.rand);
    if (!route.length) return null;
    var built = this.map.routePath(route);
    var v = new Sim.Vehicle({
      path: built.path, fromArm: route[0].from, toArm: route[0].to,
      kind: o.kind || 'car',
      color: o.color || CAR_COLORS[Math.floor(this.rand()*CAR_COLORS.length)],
      isPlayer: !!o.isPlayer,
      cruise: kmh(o.speed || (38 + Math.floor(this.rand()*14))),
      v: kmh(o.v0 !== undefined ? o.v0 : (o.speed || 42)),
      s: o.s || 0,
      id: 'v' + (this.nextId = (this.nextId || 0) + 1)
    });
    v.steps = built.steps;
    v.stepIdx = 0;
    this.syncStep(v, true);
    v.pos = v.path.at(v.s);
    return v;
  };

  /* Move a vehicle's "current junction" on when it has driven through
     one, and republish the landmarks the rule engine reads. */
  DriveWorld.prototype.syncStep = function(veh, force){
    var st = veh.steps[veh.stepIdx];
    while (st && veh.s > st.exitS + 10 && veh.stepIdx < veh.steps.length - 1){
      if (veh.isPlayer && !veh.faultedHere) this.cleared++;
      veh.faultedHere = false;
      veh.stepIdx++;
      veh.didStop = false;
      veh.conceded = null;          // a new junction, a fresh judgement
      st = veh.steps[veh.stepIdx];
      force = true;
    }
    if (!st) return;
    if (force || veh.fromArm !== st.from){
      veh.fromArm  = st.from;
      veh.toArm    = st.to;
      veh.node     = st.node;
      veh.junctionS = st.junctionS;
      veh.lineS     = st.junctionS - veh.len*0.5;
      veh.enterS    = st.enterS;
      veh.exitS     = st.exitS;
      veh.crossS = undefined; veh.exitCrossS = undefined;
      var cr = st.node.layout.crossings;
      if (cr && cr.indexOf(st.from) >= 0) veh.crossS = veh.lineS - 26;
    }
  };

  /* ---------------- rules context ---------------- */
  DriveWorld.prototype.junctionFor = function(veh){
    var n = (veh && veh.node) || (this.player && this.player.node);
    return n || this.sc;
  };
  DriveWorld.prototype.hasCrossing = function(){ return false; };

  /* Two cars conflict only if they are both at the same junction. */
  DriveWorld.prototype.conflictBetween = function(a, b){
    if (!a.node || !b.node || a.node !== b.node) return null;
    if (a.fromArm === b.fromArm) return null;
    /* A roundabout's conflict table is still built from straight-line
       "cross" geometry (buildConflictTable always passes kind:'cross'),
       which is only an approximation good for where an entering car meets
       the ring. Two cars both already circulating never actually cross -
       it is a single lane - so without this a phantom intersection from
       that approximation has them "coordinate" past each other and collide;
       likewise two cars both still waiting to enter do not cross either. */
    if (a.node.layout.type === 'roundabout'){
      var aCirc = a.s >= a.junctionS, bCirc = b.s >= b.junctionS;
      if (aCirc === bCirc) return null;
    }
    var lc = City.localConflict(a.fromArm, a.toArm, b.fromArm, b.toArm);
    if (!lc) return null;
    return { sa: a.enterS + lc.sa, sb: b.enterS + lc.sb };
  };

  /* ---------------- traffic ---------------- */
  DriveWorld.prototype.spawnTraffic = function(initial){
    var m = this.map, p = this.player;
    for (var tries = 0; tries < 20; tries++){
      var node = m.nodes[Math.floor(this.rand()*m.nodes.length)];
      if (!node.arms.length) continue;
      var arm = node.arms[Math.floor(this.rand()*node.arms.length)];
      var d = Math.hypot(node.x - (p ? p.pos.x : 0), node.y - (p ? p.pos.y : 0));
      if (p && (d < 420 || d > SPAWN_NEAR)) continue;
      var car = this.makeCar({ node:node, from:arm, steps:8, s:this.rand()*700 });
      if (!car) continue;
      /* don't drop one on top of somebody */
      var clash = false;
      for (var i = 0; i < this.vehicles.length; i++){
        if (Geo.dist(this.vehicles[i].pos, car.pos) < 120) { clash = true; break; }
      }
      if (clash) continue;
      this.vehicles.push(car);
      return car;
    }
    return null;
  };

  DriveWorld.prototype.cullTraffic = function(){
    var p = this.player, keep = [];
    for (var i = 0; i < this.vehicles.length; i++){
      var v = this.vehicles[i];
      if (v.isPlayer){ keep.push(v); continue; }
      var d = Geo.dist(v.pos, p.pos);
      var far = d > DESPAWN_FAR;
      var finished = v.s >= v.path.length - 8;
      /* last resort: something wedged itself somewhere out of sight */
      var wedged = (v.stoppedFor || 0) > 25 && d > 900;
      if (!far && !finished && !wedged) keep.push(v);
    }
    this.vehicles = keep;
    while (this.vehicles.length < TARGET_TRAFFIC + 1) {
      if (!this.spawnTraffic()) break;
    }
  };

  /* ---------------- update ---------------- */
  DriveWorld.prototype.update = function(dt, input){
    if (this.paused || this.state !== 'run'){
      if (this.state !== 'run') this.endTimer += dt;
      return;
    }
    /* just rewound: the town waits for you to set off again */
    if (this.hold){
      if (!input.throttle && !input.brake) return;
      this.hold = null;
    }
    if (this.t - (this.lastSnap === undefined ? -1 : this.lastSnap) >= SNAP_EVERY) this.remember();
    this.t += dt;
    var i;

    for (i = 0; i < this.vehicles.length; i++){
      var veh = this.vehicles[i];
      if (veh.done) continue;
      this.syncStep(veh);
      if (veh.isPlayer) this.drivePlayer(veh, dt, input);
      else this.driveAI(veh, dt);
      veh.s += veh.v*dt;
      veh.pos = veh.path.at(veh.s);
      /* patience timer: feeds the deadlock breaker in the rule engine */
      veh.stoppedFor = veh.v < kmh(5) ? (veh.stoppedFor || 0) + dt
                                       : Math.max(0, (veh.stoppedFor || 0) - dt*2.5);
      if (veh.v < kmh(1.6) && veh.s < veh.junctionS) veh.didStop = true;
      if (veh.s >= veh.path.length - 4){
        if (veh.isPlayer) this.extendPlayer();
        else veh.done = true;
      }
    }

    this.examine(dt, input);
    if (this.grace > 0) this.grace -= dt; else this.collisions();
    this.speedLimit();
    if ((this.tick = (this.tick || 0) + 1) % 45 === 0) this.cullTraffic();
    if (this.cleared >= this.target && !this.faults.length) this.finish('ziel');
  };

  /* the road never runs out: graft another stretch on the end */
  DriveWorld.prototype.extendPlayer = function(){
    var p = this.player;
    var last = p.steps[p.steps.length - 1];
    var node = this.map.neighbour(last.node, last.to);
    if (!node){ this.finish('ziel'); return; }
    var route = this.map.buildRoute(node, Geo.opposite(last.to), 40, this.rand);
    if (!route.length){ this.finish('ziel'); return; }
    var built = this.map.routePath(route);
    p.path = built.path;
    p.prof = Sim.curveProfile(p.path);
    p.steps = built.steps;
    p.stepIdx = 0;
    p.s = 0;
    p.prevS = 0;
    this.syncStep(p, true);
    p.pos = p.path.at(0);
  };

  /* The limit belongs to the street you are on, and a new one starts at
     the sign - which stands where the next junction's geometry begins,
     not the moment the last junction is behind you. */
  DriveWorld.prototype.speedLimit = function(){
    var p = this.player, st = p.steps && p.steps[p.stepIdx];
    if (!st) return;
    var here = st.node.limit || 50;
    if (p.s < st.enterS && p.streetLimit){
      this.sc.limit  = p.streetLimit;
      this.nextLimit = here !== p.streetLimit ? here : null;
    } else {
      p.streetLimit  = here;
      this.sc.limit  = here;
      this.nextLimit = null;
    }
  };

  /* ---------------- the examiner ---------------- */
  /* Same checks as a lesson, but instead of running to the end we stop
     the car and explain the moment something goes wrong. */
  DriveWorld.prototype.fault = function(id, reason, detail){
    if (this.pending) return;
    this.lastFault = this.lastFault || {};
    if (this.lastFault[id] !== undefined && this.t - this.lastFault[id] < 10) return;
    this.lastFault[id] = this.t;
    var rec = { id:id, reason:reason || null, detail:detail || null, t:this.t };
    this.faults.push(rec);
    this.pending = rec;
    this.paused = true;
    this.player.faultedHere = true;
    var def = Rules.FAULTS[id];
    if (def && def.sev === 'major') this.majors = (this.majors || 0) + 1;
  };
  DriveWorld.prototype.resume = function(){
    this.pending = null;
    this.paused = false;
    this.crashPoint = null;
    this.grace = 2.5;              // don't re-trigger on the same contact
  };

  /* ---------------- rewind ---------------- */
  /* Paths, junction nodes and routes never change once built, so a
     vehicle copy can share them; only the few fields that are mutated in
     place need their own copy, and references between vehicles (who is
     braking for whom) are re-pointed at the copies. */
  function copyMap(o){
    var c = {};
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k];
    return c;
  }
  function copyVehicle(v){
    var c = Object.create(Object.getPrototypeOf(v));
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) c[k] = v[k];
    if (v.conceded) c.conceded = copyMap(v.conceded);
    if (v.wasClear) c.wasClear = copyMap(v.wasClear);
    return c;
  }
  function copyFleet(list){
    var out = list.map(copyVehicle), byId = {};
    out.forEach(function(v){ byId[v.id] = v; });
    out.forEach(function(v){
      for (var k in v){
        if (Object.prototype.hasOwnProperty.call(v, k) && v[k] instanceof Sim.Vehicle)
          v[k] = byId[v[k].id] || null;
      }
    });
    return out;
  }
  var SCALARS = ['t','cleared','idle','overspeed','maxSpeed','tick','grace','nextLimit'];

  DriveWorld.prototype.remember = function(){
    var snap = { vehicles:copyFleet(this.vehicles), limit:this.sc.limit,
                 lastFault:copyMap(this.lastFault || {}) }, self = this;
    SCALARS.forEach(function(k){ snap[k] = self[k]; });
    this.history.push(snap);
    if (this.history.length > SNAP_KEEP) this.history.shift();
    this.lastSnap = this.t;
  };

  DriveWorld.prototype.canRewind = function(){ return this.history.length > 0; };

  /* Take the fault back: put the town where it was a few seconds before
     it happened and let the driver try that moment again. */
  DriveWorld.prototype.rewind = function(){
    var f = this.pending;
    if (!f || !this.history.length) return false;
    var want = f.t - REWIND_BY, i = this.history.length - 1;
    while (i > 0 && this.history[i].t > want) i--;
    var snap = this.history[i], self = this;
    this.history.length = i + 1;           // the future we are undoing

    this.vehicles = copyFleet(snap.vehicles);
    for (var j = 0; j < this.vehicles.length; j++)
      if (this.vehicles[j].isPlayer) this.player = this.vehicles[j];
    SCALARS.forEach(function(k){ self[k] = snap[k]; });
    this.sc.limit = snap.limit;
    this.lastFault = copyMap(snap.lastFault);
    this.lastSnap = this.t;

    /* Everything after the snapshot never happened. The fault you are
       retrying is kept aside so the summary can show what you practised;
       anything else in that window will simply happen again if repeated. */
    this.faults = this.faults.filter(function(x){ return x.t <= snap.t; });
    this.majors = this.faults.filter(function(x){
      var d = Rules.FAULTS[x.id]; return d && d.sev === 'major';
    }).length;
    this.fixed.push(f);
    this.pending = null;
    this.paused = false;
    this.crashPoint = null;
    this.hold = { fault:f, back:Math.max(0, Math.round(f.t - this.t)) };
    this.speedLimit();                     // the sign for where we are now
    return true;
  };

  /* A knock stops you and gets explained, but the drive carries on. */
  DriveWorld.prototype.finish = function(why){
    if (why === 'crash'){ this.player.v = 0; return; }
    if (this.state !== 'run') return;
    this.state = 'done';
    this.endReason = why;
  };

  DriveWorld.prototype.report = function(){
    var score = 100, major = 0;
    var rows = this.faults.map(function(f){
      var def = Rules.FAULTS[f.id];
      score -= def.pts;
      if (def.sev === 'major') major++;
      return { id:f.id, def:def, reason:f.reason, detail:f.detail };
    });
    var fixed = this.fixed.map(function(f){
      return { id:f.id, def:Rules.FAULTS[f.id], reason:f.reason, detail:f.detail };
    });
    return { score:Math.max(0, score), passed: major === 0 && this.cleared >= this.target,
             faults:rows, fixed:fixed, reason:this.endReason, cleared:this.cleared };
  };

  /* ---------------- navigation ---------------- */
  /* the street the player is on right now, for the HUD */
  DriveWorld.prototype.currentStreet = function(){
    var p = this.player, st = p.steps && p.steps[p.stepIdx];
    if (!st) return null;
    return this.map.streetName(st.node, st.to);
  };

  /* what the examiner tells you to do next */
  DriveWorld.prototype.instruction = function(){
    var p = this.player;
    if (!p.steps || !p.steps[p.stepIdx]) return null;
    var st = p.steps[p.stepIdx];
    var dist = Math.max(0, (st.junctionS - p.s) / CFG.PPM);
    var turn = Geo.turnOf(st.from, st.to);
    var far = dist > 60;
    var where = far ? { de:'In ' + Math.round(dist/10)*10 + ' Metern', en:'In ' + Math.round(dist/10)*10 + ' metres' }
                    : { de:'Jetzt', en:'Now' };
    var onto = this.map.streetName(st.node, st.to);
    var what = turn === 'left'  ? { de:'links abbiegen auf die ' + onto, en:'turn left onto ' + onto }
             : turn === 'right' ? { de:'rechts abbiegen auf die ' + onto, en:'turn right onto ' + onto }
             : { de:'geradeaus weiter auf der ' + onto, en:'carry straight on along ' + onto };
    if (st.node.layout.type === 'roundabout')
      what = { de:'im Kreisverkehr ' + (turn === 'left' ? 'dritte' : turn === 'right' ? 'erste' : 'zweite') + ' Ausfahrt auf die ' + onto,
               en:'take the ' + (turn === 'left' ? 'third' : turn === 'right' ? 'first' : 'second') + ' exit onto ' + onto };
    return { de: where.de + ' ' + what.de + '.', en: where.en + ', ' + what.en + '.',
             turn:turn, dist:dist, street:onto };
  };

  return { DriveWorld:DriveWorld };
})();
