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
  /* observation: how far round a head must turn to count as a shoulder
     check, and how long before the actual turn a look still counts */
  var LOOK_YAW = 0.6, LOOK_WINDOW = 10, MIRROR_WINDOW = 14;

  /* ---------------- the world ---------------- */
  function DriveWorld(opts){
    opts = opts || {};
    this.map  = new City.Map({ cols:opts.cols || 5, rows:opts.rows || 4, seed:opts.seed || 7,
                               preset:opts.preset });
    this.nextTram = { S:0, N:0 };
    this.rand = City.rng((opts.seed || 7) * 31 + 11);
    this.sc   = { limit:50, timeLimit:1e9, layout:{ type:'cross', arms:Geo.ARM_ORDER, signs:{} },
                  points:[], title:'Freie Fahrt', en:'Free drive' };
    if (opts.preset === 'eschersheim'){
      this.sc.title = 'Frankfurt-Eschersheim · Weißer Stein';
      this.sc.en    = 'Frankfurt-Eschersheim · Weißer Stein';
    }
    /* who steers: you ('manual') or the car along its route ('auto') */
    this.steer = opts.steer === 'manual' ? 'manual' : 'auto';
    /* an exam: a set time, no help, no stopping to explain */
    this.exam = opts.exam ? { seconds:(opts.exam.minutes || 15)*60 } : null;
    if (this.exam){ this.sc.title = 'Prüfungsfahrt'; this.sc.en = 'Driving test'; }
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
    var m = this.map, ps = m.preset && m.preset.start;
    var start = ps ? m.nodeAt(ps.c, ps.r) : (m.nodeAt(0, m.rows - 1) || m.nodes[0]);
    var startArm = ps ? ps.from : (start.arms.indexOf('S') >= 0 ? 'S' : start.arms[0]);

    this.player = this.makeCar({
      node:start, from:startArm, steps:60, isPlayer:true,
      color:'#4da3ff', speed:50
    });
    this.player.maxV = kmh(90);
    this.player.v = kmh(30);
    this.vehicles.push(this.player);

    for (var i = 0; i < TARGET_TRAFFIC; i++) this.spawnTraffic(true);
    /* one train already somewhere on each track */
    if (m.railCol >= 0){
      this.spawnTram('S', 900 + this.rand()*2500);
      this.spawnTram('N', 900 + this.rand()*2500);
    }
    this.manageBikes(true);
    this.managePeds();
  };

  /* ---------------- the U-Bahn ---------------- */
  DriveWorld.prototype.spawnTram = function(dir, s){
    var tr = this.map.tramRoute(dir);
    if (!tr) return null;
    var R = City.RAIL;
    var v = new Sim.Vehicle({
      path:tr.path, fromArm:tr.steps[0].from, toArm:tr.steps[0].to,
      kind:'tram', len:R.TRAM_L, wid:R.TRAM_W, color:'#ecebe6',
      cruise:kmh(40), v:kmh(s ? 36 : 40), s:s || 0, track:dir,
      id:'t' + (this.nextId = (this.nextId || 0) + 1)
    });
    v.steps = tr.steps;
    v.stepIdx = 0;
    this.syncStep(v, true);
    v.pos = v.path.at(v.s);
    /* never drop a train onto somebody */
    for (var i = 0; i < this.vehicles.length; i++){
      var o = this.vehicles[i];
      if (Geo.dist(o.pos, v.pos) < (o.len + v.len)*0.5 + 40) return null;
    }
    this.vehicles.push(v);
    return v;
  };
  DriveWorld.prototype.manageTrams = function(){
    if (this.map.railCol < 0) return;
    var self = this;
    ['S','N'].forEach(function(dir){
      var running = self.vehicles.some(function(v){ return v.kind === 'tram' && v.track === dir && !v.done; });
      if (running){ self.nextTram[dir] = self.t + 18 + self.rand()*20; return; }
      if (self.t >= self.nextTram[dir]) self.spawnTram(dir, 0);
    });
  };

  /* what a German street actually looks like: mostly silver, grey,
     black, white and dark blue, the odd red - and ivory taxis */
  var CAR_COLORS = ['#c9ccd1','#b7bbc1','#6d7177','#2b2f36','#1d1f23','#f1f1ee','#e4e5e2',
                    '#1f3a5f','#2d4a6e','#9e2b25','#3d5a4a','#8a7f6d'];
  var TAXI = '#efe6c8';

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
    if (!o.isPlayer && !o.color && this.rand() < 0.07){ v.taxi = true; v.color = TAXI; }
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
      /* the indicator stalk flicks back once the wheel straightens */
      if (veh.isPlayer && Geo.turnOf(st.from, st.to) !== 'straight') this.indicatorOff = true;
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
      /* Every arm has a pedestrians' crossing across its mouth. Note where
         this car passes the one on the arm it comes in on and the one on
         the arm it leaves by - the points the examiner and the town's
         drivers check pedestrians against. Trains and bikes cross none. */
      /* Both are where the car's centre is when its bumper reaches the
         line people walk along: stopping a little short of either keeps
         the whole car off the crossing. */
      if (veh.kind !== 'tram' && veh.kind !== 'bike' && st.node.layout.type !== 'roundabout'){
        var reach = City.CW.mid + 4 + veh.len*0.5;
        veh.crossS = st.enterS + (City.ENTRY - reach);
        var n = st.node, o = Geo.ARM_VEC[st.to];
        for (var s = st.junctionS; s <= st.exitS; s += 2){
          var q = veh.path.at(s);
          if ((q.x - n.x)*o.x + (q.y - n.y)*o.y >= City.CW.mid - veh.len*0.5){ veh.exitCrossS = s; break; }
        }
      }
    }
  };

  /* ---------------- cyclists ---------------- */
  var BIKE_COLORS = ['#2b5d8a','#3d3f44','#8b2e2e','#2f6b4f','#c9a227','#6a4a8c','#d8d8d4'];
  DriveWorld.prototype.spawnBike = function(lane, s){
    var r = this.map.bikeRoute(lane);
    var v = new Sim.Vehicle({
      path:r.path, fromArm:lane.from, toArm:Geo.opposite(lane.from),
      kind:'bike', len:21, wid:8,
      color:BIKE_COLORS[Math.floor(this.rand()*BIKE_COLORS.length)],
      cruise:kmh(15 + this.rand()*7), v:kmh(16), s:s || 0, lane:lane,
      id:'b' + (this.nextId = (this.nextId || 0) + 1)
    });
    v.look = this.rand();
    v.steps = r.steps; v.stepIdx = 0;
    this.syncStep(v, true);
    v.pos = v.path.at(v.s);
    for (var i = 0; i < this.vehicles.length; i++)
      if (this.vehicles[i].kind === 'bike' && Geo.dist(this.vehicles[i].pos, v.pos) < 90) return null;
    this.vehicles.push(v);
    return v;
  };
  DriveWorld.prototype.manageBikes = function(initial){
    var self = this, lanes = this.map.bikeLanes || [];
    lanes.forEach(function(lane){
      var on = self.vehicles.filter(function(v){ return v.kind === 'bike' && v.lane === lane && !v.done; });
      if (initial){
        self.spawnBike(lane, 300 + self.rand()*1800);
        self.spawnBike(lane, 2500 + self.rand()*1800);
      } else if (on.length < 2 && self.rand() < 0.25) self.spawnBike(lane, 0);
    });
  };

  /* ---------------- pedestrians ---------------- */
  /* People waiting at the corners of the junctions around you, crossing
     the side of a junction they are standing at. They go when it is safe
     for them: on their own green at lights, in front of traffic turning
     in (which must let them), never into traffic coming along the road
     they cross - except on a zebra, where everyone must stop for them. */
  var PED_TARGET = 12;
  DriveWorld.prototype.managePeds = function(){
    var p = this.player, self = this;
    this.peds = this.peds.filter(function(ped){
      if (ped.state === 'done') return false;
      var pt = ped.point();
      if (Geo.dist(pt, p.pos) > 900) return false;
      return !(ped.state === 'waiting' && ped.wait > 45);
    });
    var tries = 0;
    while (this.peds.length < PED_TARGET && tries++ < 12){
      var n = this.map.nodes[Math.floor(this.rand()*this.map.nodes.length)];
      var d = Math.hypot(n.x - p.pos.x, n.y - p.pos.y);
      if (d > 700 || n.layout.type === 'roundabout') continue;
      var arms = n.arms.filter(function(a){ return !(n.rail && a === n.rail.side); });
      if (!arms.length) continue;
      var arm = arms[Math.floor(this.rand()*arms.length)];
      var right = this.rand() < 0.5;
      var clash = this.peds.some(function(q){ return q.node === n && q.arm === arm; });
      if (clash) continue;
      var zebra = !!(n.layout.crossings && n.layout.crossings.indexOf(arm) >= 0);
      var ped = new Sim.Ped({
        arm:arm, d:City.CW.mid, node:n, zebra:zebra,
        u0: right ? (CFG.BOX + 22) : -(CFG.BOX + 22), dir: right ? -1 : 1,
        start:'waiting', kid: this.rand() < 0.1, intent:true
      });
      ped.look = this.rand();
      ped.wait = -this.rand()*4;                   // not everyone sets off at once
      this.peds.push(ped);
    }
    void self;
  };
  /* Would walking on bring this pedestrian up against a vehicle's body
     somewhere along the next `span` units of their crossing? People wait
     for a car stood in their way; they do not walk into it. */
  DriveWorld.prototype.pedBlockedAhead = function(ped, span){
    var o = Geo.ARM_VEC[ped.arm], q = Geo.rot90cw(o);
    var nx = ped.node.x, ny = ped.node.y;
    for (var i = 0; i < this.vehicles.length; i++){
      var v = this.vehicles[i];
      if (v.done || v.kind === 'tram') continue;
      if (Math.abs(v.pos.x - nx) > 260 || Math.abs(v.pos.y - ny) > 260) continue;
      var circ = Sim.bodyCircles(v);
      for (var du = 4; du <= span; du += 8){
        var u = ped.u + ped.dir*du;
        if (Math.abs(u) > CFG.BOX + 30) break;
        var px = nx + o.x*ped.d + q.x*u, py = ny + o.y*ped.d + q.y*u;
        for (var k = 0; k < circ.length; k++)
          if (Math.hypot(circ[k].x - px, circ[k].y - py) < circ[k].r + 8) return true;
      }
    }
    return false;
  };
  /* how long the light for `arm` has shown green */
  function greenFor(n, arm, t){
    if (Rules.lightFor(n, arm, t) !== 'green') return -1;
    var k = 0;
    while (k < 40 && Rules.lightFor(n, arm, t - (k + 1)*0.5) === 'green') k++;
    return k*0.5;
  }
  /* Is it this pedestrian's turn by the rules - light, or no light? */
  DriveWorld.prototype.pedWants = function(ped){
    if (!ped.intent || ped.wait < 0) return false;
    var n = ped.node;
    /* Somebody arriving at the kerb does not step up to it as a car
       arrives that could no longer stop - they show they want to cross
       while the traffic can still react, and then keep wanting to. */
    if (!ped.wants && this.pedCarClose(ped, 2.6)) return false;
    if (!n.lights) return true;
    /* they walk with the traffic running alongside, and only set off
       early in its green so they are across before it ends */
    var g = greenFor(n, Geo.leftOf(ped.arm), this.t);
    return g >= 0 && g < 6;
  };
  /* ...and is it safe for them to go? */
  DriveWorld.prototype.pedMayGo = function(ped){
    var n = ped.node;
    if (this.pedBlockedAhead(ped, 60)) return false;     // a car standing on the crossing
    for (var i = 0; i < this.vehicles.length; i++){
      var v = this.vehicles[i];
      if (v.done || v.node !== n || v.kind === 'tram') continue;
      /* coming along the road they want to cross */
      if (v.fromArm === ped.arm && v.crossS !== undefined && v.s < v.crossS){
        var tt = (v.crossS - v.s) / Math.max(v.v, 1);
        if (v.v > kmh(6) && tt < (ped.zebra ? 1.6 : 3.4)) return false;
      }
      /* turning in: they have priority, but nobody steps in front of a
         car about to reach them, however slowly it is rolling */
      if (v.toArm === ped.arm && v.exitCrossS !== undefined && v.s < v.exitCrossS){
        var te = (v.exitCrossS - v.s) / Math.max(v.v, 1);
        /* a car already turning through the junction has committed: do
           not strand it in the middle of everybody else's way */
        var committed = v.s > v.lineS;
        if (v.v > kmh(3) && te < (committed ? 3.5 : 2.0)) return false;
      }
    }
    return true;
  };
  /* is a car coming at this crossing, within `secs`, too fast to stop easily? */
  DriveWorld.prototype.pedCarClose = function(ped, secs){
    for (var i = 0; i < this.vehicles.length; i++){
      var v = this.vehicles[i];
      if (v.done || v.node !== ped.node || v.kind === 'tram' || v.kind === 'bike') continue;
      var cs = (v.fromArm === ped.arm) ? v.crossS : (v.toArm === ped.arm) ? v.exitCrossS : undefined;
      if (cs === undefined || v.s >= cs || v.v < kmh(8)) continue;
      if ((cs - v.s) / v.v < secs) return true;
    }
    return false;
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
    /* a train against a car: its own table, since a train on the main
       road still crosses the car turning off it from the same arm */
    /* a cyclist on a cycle path: likewise their own table */
    var ab = a.kind === 'bike', bb = b.kind === 'bike';
    if (ab || bb){
      if (ab && bb) return null;
      var bike = ab ? a : b, other = ab ? b : a;
      if (other.kind === 'tram') return null;
      var bc = City.bikeConflict(bike.lane.from, bike.lane.off, other.fromArm, other.toArm);
      if (!bc) return null;
      var sbk = bike.enterS + bc.sb, soc = other.enterS + bc.sc;
      return ab ? { sa:sbk, sb:soc } : { sa:soc, sb:sbk };
    }
    var at = a.kind === 'tram', bt = b.kind === 'tram';
    if (at || bt){
      if (at && bt) return null;                  // separate tracks
      var tram = at ? a : b, car = at ? b : a;
      var rc = City.railConflict(tram.track, car.fromArm, car.toArm);
      if (!rc) return null;
      var st = tram.enterS + rc.st, sc = car.enterS + rc.sc;
      return at ? { sa:st, sb:sc } : { sa:sc, sb:st };
    }
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
      /* a train runs its whole line on schedule, wherever you are */
      var far = d > DESPAWN_FAR && v.kind !== 'tram';
      var finished = v.s >= v.path.length - 8;
      /* last resort: something wedged itself somewhere out of sight */
      var wedged = (v.stoppedFor || 0) > 25 && d > 900;
      if (!far && !finished && !wedged) keep.push(v);
    }
    this.vehicles = keep;
    var cars = keep.filter(function(v){ return v.kind !== 'tram' && v.kind !== 'bike'; }).length;
    while (cars < TARGET_TRAFFIC + 1) {
      if (!this.spawnTraffic()) break;
      cars++;
    }
    this.manageTrams();
    this.manageBikes(false);
    this.managePeds();
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
    /* where the driver has looked, and when: a glance over a shoulder is
       a head turned well round, the mirror a key press */
    /* A quick glance counts: the head only has to come round about 35
       degrees - a tap on the look key gets there, a full turn is not
       needed. Each new look is flashed up so the driver sees it counted. */
    var seen = this.seen || (this.seen = {});
    var yaw = input.yaw || 0;
    var look = yaw > LOOK_YAW ? 'right' : yaw < -LOOK_YAW ? 'left' : input.mirror ? 'mirror' : null;
    if (look && (seen[look] === undefined || this.t - seen[look] > 0.4)) this.lookFlash = { side:look, t:this.t };
    if (yaw > LOOK_YAW)  seen.right = this.t;
    if (yaw < -LOOK_YAW) seen.left  = this.t;
    if (input.mirror) seen.mirror = this.t;
    /* the exam is over when the examiner's time is */
    if (this.exam && this.t >= this.exam.seconds){ this.finish('exam_time'); return; }
    if (this.t - (this.lastSnap === undefined ? -1 : this.lastSnap) >= SNAP_EVERY) this.remember();
    this.t += dt;
    var i;

    for (i = 0; i < this.peds.length; i++) this.updatePed(this.peds[i], dt);

    for (i = 0; i < this.vehicles.length; i++){
      var veh = this.vehicles[i];
      if (veh.done) continue;
      this.syncStep(veh);
      if (veh.isPlayer) this.drivePlayer(veh, dt, input);
      else this.driveAI(veh, dt);
      if (veh.isPlayer && this.steer === 'manual') this.steerPlayer(veh, dt, input);
      else {
        veh.s += veh.v*dt;
        veh.pos = veh.path.at(veh.s);
      }
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
    this.checkTurn();
    if (this.steer === 'manual') this.checkLine(dt);
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
    this.adoptPath(p, this.map.routePath(route));
  };
  /* Put the player on a freshly built route, where they actually are:
     the new path overlaps the end of the old one, so find our place on it
     rather than starting from its beginning (which lies behind us). */
  DriveWorld.prototype.adoptPath = function(p, built){
    var at = { x:p.pos.x, y:p.pos.y, h:p.pos.h };
    p.path = built.path;
    p.prof = Sim.curveProfile(p.path);
    p.steps = built.steps;
    p.stepIdx = 0;
    var pr = project(p.path, at, 0, p.path.length, 4);
    p.s = pr.s; p.prevS = pr.s; p.lat = pr.e;
    this.syncStep(p, true);
    if (this.steer === 'manual') p.pos = at;          // we steer ourselves: stay put
    else p.pos = p.path.at(p.s);
  };

  /* ---------------- steering it yourself ---------------- */
  /* Where a point lies relative to a path: the nearest s (searched between
     s0 and s1 in `step`s, then refined) and the signed distance off it,
     positive to the right of the direction of travel. */
  function project(path, pt, s0, s1, step){
    s0 = Math.max(0, s0); s1 = Math.min(path.length, s1);
    var best = s0, bd = 1e18, s;
    for (s = s0; s <= s1; s += step){
      var q = path.at(s), d = (q.x - pt.x)*(q.x - pt.x) + (q.y - pt.y)*(q.y - pt.y);
      if (d < bd){ bd = d; best = s; }
    }
    for (s = Math.max(0, best - step); s <= Math.min(path.length, best + step); s += step/8){
      var q2 = path.at(s), d2 = (q2.x - pt.x)*(q2.x - pt.x) + (q2.y - pt.y)*(q2.y - pt.y);
      if (d2 < bd){ bd = d2; best = s; }
    }
    var q3 = path.at(best);
    var e = (pt.x - q3.x)*(-Math.sin(q3.h)) + (pt.y - q3.y)*Math.cos(q3.h);
    return { s:best, d:Math.sqrt(bd), e:e };
  }
  var WHEELBASE = 2.7 * CFG.PPM;
  /* switch mid-drive: handing the wheel to the car puts it back on its line */
  DriveWorld.prototype.setSteer = function(mode){
    var p = this.player;
    this.steer = mode === 'manual' ? 'manual' : 'auto';
    p.delta = 0;
    if (this.steer === 'auto') p.pos = p.path.at(p.s);
  };
  /* how far the front wheels may turn at this speed: full lock when slow,
     much less when fast, so the car cannot be flicked round at 50 */
  DriveWorld.prototype.maxSteer = function(p){
    var lat = 8 * CFG.PPM;                           // ~8 m/s² of grip: a car, not a race car
    return Math.max(0.07, Math.min(0.62, Math.atan(WHEELBASE*lat / Math.max(p.v*p.v, 1))));
  };
  /* A kinematic bicycle: the wheels turn toward where the driver steers at
     a steady rate and centre themselves when let go; the car moves where
     its wheels point. Afterwards we find ourselves on the route - the way
     we are meant to go - which is what every rule is judged against. */
  DriveWorld.prototype.steerPlayer = function(p, dt, input){
    this.chooseWay(p, input);
    var max = this.maxSteer(p);
    var abs = input.steerAbs !== undefined && input.steerAbs !== null;
    var target = Geo.clamp(abs ? input.steerAbs : (input.steer || 0), -1, 1) * max;
    var rate = abs ? 3.0 : (target === 0 ? 1.5 : 0.95);
    p.delta = p.delta || 0;
    p.delta += Geo.clamp(target - p.delta, -rate*dt, rate*dt);
    p.delta = Geo.clamp(p.delta, -max, max);
    var h = p.pos.h + p.v / WHEELBASE * Math.tan(p.delta) * dt;
    p.pos = { x:p.pos.x + Math.cos(h)*p.v*dt, y:p.pos.y + Math.sin(h)*p.v*dt, h:h };
    var pr = project(p.path, p.pos, p.s - 30, p.s + 90, 3);
    if (pr.d < 260){ p.s = pr.s; p.lat = pr.e; }
    this.keepOnRoad(p, dt);
  };
  /* Which way are we going at the next junction? What the indicator says,
     as other drivers would read it - until we are in the junction; there,
     whichever street we actually drive into. */
  DriveWorld.prototype.chooseWay = function(p, input){
    var st = p.steps[p.stepIdx];
    if (!st) return;
    var n = st.node, arms = n.arms;
    if (p.s < st.junctionS - 30){
      if (n.layout.type === 'roundabout') return;          // no indicating into a roundabout
      var ind = input.indicator, want;
      if (ind === 'left'  && arms.indexOf(Geo.leftOf(st.from))  >= 0) want = Geo.leftOf(st.from);
      else if (ind === 'right' && arms.indexOf(Geo.rightOf(st.from)) >= 0) want = Geo.rightOf(st.from);
      else want = st.plan;                                 // no indicator: the planned way, for now
      if (want !== st.to) this.replan(p, want);
      return;
    }
    if (p.s > st.exitS) return;
    /* inside: into which street is the car actually going? */
    for (var i = 0; i < arms.length; i++){
      var a = arms[i];
      if (a === st.from) continue;
      var o = Geo.ARM_VEC[a], q = Geo.rot90cw(o);
      var dx = p.pos.x - n.x, dy = p.pos.y - n.y;
      var along = dx*o.x + dy*o.y, across = dx*q.x + dy*q.y;
      var ring = n.layout.type === 'roundabout';
      if (along > (ring ? CFG.RING + CFG.BOX + 20 : CFG.BOX + 22) && Math.abs(across) < CFG.BOX + 10){
        if (a !== st.to){
          var said = input.indicator, turn = Geo.turnOf(st.from, a);
          this.replan(p, a);
          /* said one thing, did another */
          if (!ring && said !== (turn === 'straight' ? 'off' : turn))
            this.fault('falsch_geblinkt', null, {
              de:'Geblinkt: ' + ({ left:'links', right:'rechts', off:'nicht' }[said] || said) + ' – gefahren: ' + ({ left:'links', right:'rechts', straight:'geradeaus' }[turn]) + '.',
              en:'Indicated: ' + ({ left:'left', right:'right', off:'nothing' }[said] || said) + ' – drove: ' + turn + '.' });
        }
        return;
      }
    }
  };
  /* Rebuild the route from this junction, going `to`; the examiner's plan
     for this junction is kept so the directions still say what was asked. */
  DriveWorld.prototype.replan = function(p, to){
    var st = p.steps[p.stepIdx];
    var route = [{ node:st.node, from:st.from, to:to, plan:st.plan }];
    var next = this.map.neighbour(st.node, to);
    if (next) route = route.concat(this.map.buildRoute(next, Geo.opposite(to), 30, this.rand));
    var keepS = p.s;
    this.adoptPath(p, this.map.routePath(route));
    /* the approach is the same road whichever way we go: stay put on it */
    void keepS;
  };
  /* The kerb and the pavement: touching it is a fault; the car is not
     going through a house, though - far off the road it stops dead. */
  DriveWorld.prototype.keepOnRoad = function(p, dt){
    var c = Math.cos(p.pos.h), s = Math.sin(p.pos.h), hl = p.len*0.42, hw = p.wid*0.45, worst = 0;
    [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]].forEach(function(k){
      var x = p.pos.x + c*k[0] - s*k[1], y = p.pos.y + s*k[0] + c*k[1];
      worst = Math.max(worst, this.map.offRoad(x, y));
    }, this);
    p.offRoad = worst;
    /* the cars parked along the quiet streets are solid */
    if (typeof CityView !== 'undefined' && p.v > kmh(2)){
      var hit = null;
      [[hl, hw], [hl, -hw], [hl, 0]].forEach(function(k){
        if (!hit) hit = CityView.parkedAt(this.map, p.pos.x + c*k[0] - s*k[1], p.pos.y + s*k[0] + c*k[1], 0);
      }, this);
      if (hit){
        this.fault('kollision', null, { de:'Ein parkendes Auto.', en:'A parked car.' });
        p.v = 0;
      }
    }
    if (worst > 3 && p.v > kmh(2)){
      this.fault('bordstein', null, { de:'Mit dem Rad über den Bordstein.', en:'A wheel went over the kerb.' });
      p.v = Math.max(0, p.v - 60*CFG.PPM*dt*(worst > 14 ? 1 : 0.15));   // a knock, or a wall
    }
    if (this.map.offRoad(p.pos.x, p.pos.y) > 30) p.v = 0;
  };
  /* Where on the road the car is: kept right between junctions, taking a
     proper line through them, positioned correctly before turning. */
  var LINE_GRACE = 0.7;
  DriveWorld.prototype.checkLine = function(dt){
    var p = this.player, st = p.steps[p.stepIdx];
    if (!st || p.lat === undefined) return;
    var turn = Geo.turnOf(st.from, st.to), e = p.lat;
    var inside = p.s > p.lineS && p.s < st.exitS - 60;
    var ring = st.node.layout.type === 'roundabout';
    this.lineT = this.lineT || {};
    var self = this;
    function persist(key, bad, id, detail){
      self.lineT[key] = bad ? (self.lineT[key] || 0) + dt : 0;
      if (self.lineT[key] > LINE_GRACE && p.v > kmh(3)){ self.fault(id, null, detail); self.lineT[key] = 0; }
    }
    /* over the centre line: the left edge of the car half a metre over */
    var over = -(CFG.HALF - CFG.CAR_W/2) - 6;
    persist('centre', !inside && !ring && e < over, 'fahrstreifen',
      { de:'Mit dem Auto über der Mittellinie.', en:'Your car was over the centre line.' });
    if (inside && !ring && turn === 'left')
      persist('cut', e < -28, 'kurve_geschnitten', { de:'Die Ecke geschnitten.', en:'You cut the corner.' });
    if (inside && !ring && turn === 'right')
      persist('wide', e < -26, 'zu_weit', { de:'Nach links ausgeholt.', en:'You swung out to the left.' });
  };
  /* positioning, judged the moment we cross the line into the junction */
  DriveWorld.prototype.checkPosition = function(){
    var p = this.player, turn = p.turn();
    if (this.steer !== 'manual' || p.lat === undefined || p.node.layout.type === 'roundabout') return;
    if ((turn === 'left' && p.lat > 10) || (turn === 'right' && p.lat < -10))
      this.fault('einordnen', null, turn === 'left'
        ? { de:'Vor dem Linksabbiegen nicht zur Mitte eingeordnet.', en:'You did not move towards the middle before turning left.' }
        : { de:'Vor dem Rechtsabbiegen nicht rechts eingeordnet.', en:'You did not keep right before turning right.' });
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
    /* In the exam nobody stops to explain: small faults are noted
       silently, and a serious one ends the test on the spot. */
    if (this.exam){
      var d = Rules.FAULTS[id];
      if (d && d.sev === 'major'){ this.exam.failedBy = rec; this.finish('exam_fail'); }
      return;
    }
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
                 peds:this.peds.map(copyVehicle),
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
    this.peds = snap.peds.map(copyVehicle);
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
    this.turnWatch = null;                 // that turn has not happened yet
    this.pending = null;
    this.paused = false;
    this.crashPoint = null;
    this.hold = { fault:f, back:Math.max(0, Math.round(f.t - this.t)) };
    this.speedLimit();                     // the sign for where we are now
    return true;
  };

  /* ---------------- observation: mirror and shoulder ---------------- */
  /* Judged when you actually turn in - not at the stop line. A shoulder
     check belongs right before the turn itself, which is often after you
     have rolled past the line or waited there for people to cross; any
     look in the last LOOK_WINDOW seconds before that moment counts. */
  DriveWorld.prototype.checkEntry = function(){
    Sim.World.prototype.checkEntry.call(this);
    this.checkPosition();
    var p = this.player, turn = p.turn(), n = p.node;
    if ((turn !== 'left' && turn !== 'right') || n.layout.type === 'roundabout'){ this.turnWatch = null; return; }
    this.turnWatch = { side:turn, step:p.stepIdx, node:n, fromArm:p.fromArm,
                       at: p.exitCrossS !== undefined ? p.exitCrossS : p.junctionS + 60 };
  };
  DriveWorld.prototype.checkTurn = function(){
    var w = this.turnWatch, p = this.player;
    if (!w) return;
    var moved = p.stepIdx !== w.step;
    if (!moved && p.s < w.at) return;
    this.turnWatch = null;
    var seen = this.seen || {};
    var looked = seen[w.side] !== undefined && this.t - seen[w.side] < LOOK_WINDOW;
    var mirrored = seen.mirror !== undefined && this.t - seen.mirror < MIRROR_WINDOW;
    var side = w.side === 'right' ? { de:'rechts', en:'right' } : { de:'links', en:'left' };
    var key = w.side === 'right' ? '→' : '←';
    if (!looked){
      var cycle = this.cyclePathAcross(w.node, w.fromArm, w.side);
      this.fault(cycle ? 'schulterblick_rad' : 'schulterblick', null,
        { de:'Beim Abbiegen nach ' + side.de + ' kein Blick über die ' + side.de + 'e Schulter (Taste ' + key + ') in den letzten ' + LOOK_WINDOW + ' Sekunden davor.',
          en:'You turned ' + side.en + ' without looking over your ' + side.en + ' shoulder (key ' + key + ') in the ' + LOOK_WINDOW + ' seconds before.' });
    } else if (!mirrored){
      this.fault('spiegel');
    }
  };
  /* Does turning this way off `fromArm` at node `n` take us across a
     cycle path? Right: the one riding beside us; left: the oncoming one. */
  DriveWorld.prototype.cyclePathAcross = function(n, fromArm, turn){
    var want = turn === 'right' ? fromArm : Geo.opposite(fromArm);
    return (this.map.bikeLanes || []).some(function(l){
      return l.from === want && (l.col ? n.c === l.index : n.r === l.index);
    });
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
    /* the five areas the examiner scores, each with what went wrong in it */
    var cats = Rules.CATEGORIES.map(function(c){
      return { cat:c, faults:rows.filter(function(r){ return c.faults.indexOf(r.id) >= 0; }) };
    });
    var rep = { score:Math.max(0, score), passed: major === 0 && this.cleared >= this.target,
                faults:rows, fixed:fixed, reason:this.endReason, cleared:this.cleared, categories:cats };
    if (this.exam) rep.exam = this.examVerdict(rows, major);
    return rep;
  };
  /* Like the real test: one serious fault fails it; so do many small ones,
     or the same small one again and again - that shows it is not a slip. */
  DriveWorld.prototype.examVerdict = function(rows, major){
    var minors = rows.filter(function(r){ return r.def.sev === 'minor'; });
    var byId = {};
    minors.forEach(function(r){ byId[r.id] = (byId[r.id] || 0) + 1; });
    var repeated = Object.keys(byId).filter(function(k){ return byId[k] >= 3; });
    var why = major ? 'major' : minors.length >= 5 ? 'many' : repeated.length ? 'repeated'
            : this.endReason === 'exam_time' ? null : 'ended';
    return { passed: !why, why:why, minors:minors.length, repeated:repeated,
             failedBy:this.exam.failedBy || null, seconds:this.exam.seconds, driven:this.t };
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
    var plan = st.plan || st.to;                  // what the examiner asked for
    var turn = Geo.turnOf(st.from, plan);
    var far = dist > 60;
    var where = far ? { de:'In ' + Math.round(dist/10)*10 + ' Metern', en:'In ' + Math.round(dist/10)*10 + ' metres' }
                    : { de:'Jetzt', en:'Now' };
    var onto = this.map.streetName(st.node, plan);
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
