'use strict';
/* ------------------------------------------------------------------
   city.js - the open world.

   A grid of junctions joined by two-lane streets. Each junction carries
   its own signs, so the same priority engine that runs a single lesson
   runs the whole town. You drive a route through it; the examiner sits
   in the passenger seat and stops you the moment you get something
   wrong.
   ------------------------------------------------------------------ */

var City = (function(){

  var SPACING = 1160;              // centre to centre (~97 m)
  var ENTRY   = 250;               // where a junction's own geometry starts
  var LINK    = SPACING - 2*ENTRY; // straight bit between two junctions

  /* Across the mouth of every arm, from the corner outwards, the way a
     German street is laid out: the pedestrians' crossing, the cyclists'
     crossing (where a cycle path runs alongside), then the stop line.
     Distances from the junction centre along the arm. */
  var CW    = { in:55, out:73, mid:64 };   // pedestrian crossing band (1.5 m)
  var BIKE  = { off:79, half:6, V:18 };    // cycle path: centre off the road's centre line
  var HOLD  = CFG.BOX + 49;                // where a car's front stops: behind both
  var CORNER_R = 48;                       // kerb radius at a street corner (4 m)

  /* deterministic RNG so a seed always rebuilds the same town */
  function rng(seed){
    var x = seed || 12345;
    return function(){
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      return ((x >>> 0) % 100000) / 100000;
    };
  }

  /* ---------------- the local shape of one junction ---------------- */
  /* from the entry point on arm A to the exit point on arm B, in
     coordinates local to the junction centre                         */
  function junctionPiece(from, to, kind){
    if (kind === 'roundabout'){
      var pts = [Geo.laneIn(from, ENTRY), Geo.laneIn(from, CFG.RING + 70)];
      var a0 = Geo.ARM_ANGLE[from] + 16, a1 = Geo.ARM_ANGLE[to] - 16;
      while (a1 <= a0) a1 += 360;
      for (var a = a0; a <= a1; a += 6) pts.push(Geo.ringPoint(a, CFG.RING));
      pts.push(Geo.ringPoint(a1, CFG.RING));
      pts.push(Geo.laneOut(to, CFG.RING + 70));
      pts.push(Geo.laneOut(to, ENTRY));
      return Geo.smooth(pts, 2);
    }
    var turn = Geo.turnOf(from, to);
    var ext  = turn === 'straight' ? CFG.BOX : CFG.BOX + 34;
    var p1 = Geo.laneIn(from, ext), p2 = Geo.laneOut(to, ext);
    var out = [Geo.laneIn(from, ENTRY), p1];
    if (turn !== 'straight'){
      var c = Geo.lineIntersect(p1, Geo.mul(Geo.ARM_VEC[from], -1), p2, Geo.ARM_VEC[to]);
      if (c) out = out.concat(Geo.quadPoints(p1, c, p2, 16).slice(1));
      else out.push(p2);
    } else out.push(p2);
    out.push(Geo.laneOut(to, ENTRY));
    return out;
  }

  /* Where two cars crossing the same junction actually meet.
     Computed once for every pair of movements and reused everywhere. */
  var CONFLICT = null;
  function buildConflictTable(){
    if (CONFLICT) return CONFLICT;
    CONFLICT = {};
    var arms = Geo.ARM_ORDER, moves = [];
    arms.forEach(function(f){
      arms.forEach(function(t){
        if (f !== t) moves.push({ f:f, t:t, path:new Geo.Path(junctionPiece(f, t, 'cross')) });
      });
    });
    for (var i = 0; i < moves.length; i++){
      for (var j = 0; j < moves.length; j++){
        if (i === j) continue;
        var A = moves[i], B = moves[j];
        if (A.f === B.f) continue;                 // a queue, not a crossing
        var c = Geo.conflictOf(A.path, B.path, CFG.CAR_W + 14);
        if (c) CONFLICT[A.f + A.t + '|' + B.f + B.t] = { sa:c.sa, sb:c.sb };
      }
    }
    return CONFLICT;
  }
  function localConflict(fa, ta, fb, tb){
    return buildConflictTable()[fa + ta + '|' + fb + tb] || null;
  }

  /* Real Frankfurt street names, so the free drive reads like a real
     town instead of "Street 3". A separate RNG stream from the layout's
     own `rand`, so naming never perturbs which junction gets which sign -
     the two are shuffled independently. */
  var FRANKFURT_STREETS = [
    'Zeil', 'Kaiserstraße', 'Berger Straße', 'Mainzer Landstraße',
    'Bockenheimer Landstraße', 'Friedberger Landstraße', 'Eschersheimer Landstraße',
    'Hanauer Landstraße', 'Schweizer Straße', 'Leipziger Straße', 'Münchener Straße',
    'Taunusstraße', 'Gutleutstraße', 'Niddastraße', 'Braubachstraße', 'Fahrgasse',
    'Oeder Weg', 'Berliner Straße', 'Adickesallee', 'Miquelallee', 'Frankenallee',
    'Darmstädter Landstraße', 'Homburger Landstraße', 'Grüneburgweg'
  ];
  function shuffled(list, rand){
    var out = list.slice(), i;
    for (i = out.length - 1; i > 0; i--){
      var j = Math.floor(rand()*(i+1)), t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  /* ---------------- Frankfurt-Eschersheim, around Weißer Stein ----------------
     The real streets around the Weißer Stein U-Bahn stop, in their real
     order, straightened onto the game's grid. Eschersheimer Landstraße is
     the main road, lit at every junction, and the U-Bahn (U1/U2/U3/U8)
     runs on its own track bed beside it. Am Weißen Stein crosses it as a
     priority road; everything else is a Tempo-30 residential street where
     rechts vor links applies - which is exactly what the real area is
     like. One-way streets are two-way here: the engine has no one-ways.
     Street names and junction types are from OpenStreetMap (© ODbL). */
  var ESCHERSHEIM = {
    cols:6, rows:5,
    colStreets:['Niedwiesenstraße', 'Alt-Eschersheim', 'Eschersheimer Landstraße',
                'Landgraf-Philipp-Straße', 'Neumannstraße', 'Dehnhardtstraße'],
    rowStreets:['Zehnmorgenstraße', 'Am Weißen Stein', 'Am Lindenbaum',
                'Höllbergstraße', 'Kleinschmidtstraße'],
    mainCol:2, mainRow:1,
    start:{ c:2, r:1, from:'N' },                // heading south into Weißer Stein
    stops:{ '4,1':'stop' },                      // one real Stop sign on the way
    zebras:{ '1,3':'W', '4,2':'N', '0,3':'E' },  // Zeichen 350 on quiet side streets
    gruenpfeil:{ '2,3':['W'] },
    places:{ '2,1':'Weißer Stein', '2,2':'Lindenbaum' }
  };

  /* Where the U-Bahn's two tracks lie, measured east of the road's centre
     line, and the lines trams and cars wait at. Right-hand running: the
     southbound train uses the western track, the northbound the eastern. */
  var RAIL = {
    side:'E',
    track:{ S:78, N:114 },           // track centre per direction of travel
    bed:[58, 134],                   // gravel bed, between the two kerbs
    bikeOff:146,                     // the cycle path runs on beyond the bed
    carHold:164,                     // cars from the east wait before path and tracks
    tramHold:CFG.BOX + 22,           // trams wait before the road
    TRAM_L:300, TRAM_W:32            // one 25 m Stadtbahn car
  };

  /* ---------------- the map ---------------- */
  function Map(opts){
    opts = opts || {};
    var preset = opts.preset === 'eschersheim' ? ESCHERSHEIM : null;
    this.preset = preset;
    this.cols = preset ? preset.cols : (opts.cols || 5);
    this.rows = preset ? preset.rows : (opts.rows || 4);
    var rand = rng(opts.seed || 7);
    var srand = rng((opts.seed || 7) * 7919 + 104729);
    var pool = shuffled(FRANKFURT_STREETS, srand);
    this.rowStreets = []; this.colStreets = [];
    var ri, ci;
    if (preset){
      this.rowStreets = preset.rowStreets.slice();
      this.colStreets = preset.colStreets.slice();
    } else {
      for (ri = 0; ri < this.rows; ri++) this.rowStreets.push(pool[ri % pool.length]);
      for (ci = 0; ci < this.cols; ci++) this.colStreets.push(pool[(this.rows + ci) % pool.length]);
    }
    this.nodes = [];

    var c, r, i;
    for (r = 0; r < this.rows; r++){
      for (c = 0; c < this.cols; c++){
        this.nodes.push({
          id: r*this.cols + c, c:c, r:r,
          x: (c - (this.cols-1)/2) * SPACING,
          y: (r - (this.rows-1)/2) * SPACING,
          arms: [], layout:{ type:'cross', signs:{} }, lights:null
        });
      }
    }
    /* which streets are through-roads */
    var priRow = preset ? preset.mainRow : 1 + Math.floor(rand()*Math.max(1, this.rows-1));
    var priCol = preset ? preset.mainCol : 1 + Math.floor(rand()*Math.max(1, this.cols-1));
    this.priRow = priRow; this.priCol = priCol;
    this.railCol = preset ? preset.mainCol : -1;

    for (i = 0; i < this.nodes.length; i++){
      var n = this.nodes[i];
      if (n.r > 0)           n.arms.push('N');
      if (n.r < this.rows-1) n.arms.push('S');
      if (n.c > 0)           n.arms.push('W');
      if (n.c < this.cols-1) n.arms.push('E');
      /* the renderer reads L.arms off the layout, the way a lesson's
         scenario carries it - keep the two shapes the same */
      n.layout.arms = n.arms;

      var onPriRow = (n.r === priRow), onPriCol = (n.c === priCol);
      var roll = rand();
      var key = n.c + ',' + n.r;

      if (preset && onPriCol){
        /* every crossing of the main road is lit - the U-Bahn crosses
           there too, and the tram runs with the main road's green */
        n.lights = {
          groups:{ N:'A', S:'A', E:'B', W:'B' }, t0: Math.floor(rand()*20),
          /* with an all-red gap each way, so a 25 m train that took
             the amber has time to clear the side road */
          program:[ { A:'green', B:'red', dur:14 }, { A:'yellow', B:'red', dur:3 },
                    { A:'red', B:'red', dur:2 },
                    { A:'red', B:'redyellow', dur:1.5 }, { A:'red', B:'green', dur:11 },
                    { A:'red', B:'yellow', dur:3 }, { A:'red', B:'red', dur:2 },
                    { A:'redyellow', B:'red', dur:1.5 } ]
        };
        n.arms.forEach(function(a){ n.layout.signs[a] = 'none'; });
        n.kind = 'lights';
        n.rail = RAIL;
        n.railPriority = true;
        if (preset.gruenpfeil[key]) n.gruenpfeil = preset.gruenpfeil[key];
      } else if (preset && onPriRow){
        n.arms.forEach(function(a){
          n.layout.signs[a] = (a === 'E' || a === 'W') ? 'priority' : (preset.stops[key] || 'yield');
        });
        n.kind = 'priority';
      } else if (preset){
        n.arms.forEach(function(a){ n.layout.signs[a] = 'none'; });
        n.kind = 'rvl';
        if (preset.zebras[key] && n.arms.indexOf(preset.zebras[key]) >= 0)
          n.layout.crossings = [preset.zebras[key]];
      } else if (onPriRow && onPriCol){
        /* two main roads meeting: put lights here */
        n.lights = {
          groups:{ N:'A', S:'A', E:'B', W:'B' }, t0: Math.floor(rand()*20),
          program:[ { A:'green', B:'red', dur:12 }, { A:'yellow', B:'red', dur:3 },
                    { A:'red', B:'redyellow', dur:1.5 }, { A:'red', B:'green', dur:12 },
                    { A:'red', B:'yellow', dur:3 }, { A:'redyellow', B:'red', dur:1.5 } ]
        };
        n.arms.forEach(function(a){ n.layout.signs[a] = 'none'; });
        n.kind = 'lights';
      } else if (onPriRow || onPriCol){
        var mainArms = onPriRow ? ['E','W'] : ['N','S'];
        n.arms.forEach(function(a){
          n.layout.signs[a] = mainArms.indexOf(a) >= 0 ? 'priority'
                            : (roll > 0.78 ? 'stop' : 'yield');
        });
        n.kind = 'priority';
      } else if (roll > 0.88 && n.arms.length === 4){
        /* the town's roundabout */
        n.layout.type = 'roundabout';
        n.arms.forEach(function(a){ n.layout.signs[a] = 'ringentry'; });
        n.kind = 'roundabout';
      } else {
        n.arms.forEach(function(a){ n.layout.signs[a] = 'none'; });
        n.kind = 'rvl';
      }

      /* a zebra crossing on some approaches of quiet junctions */
      if (!preset && n.kind === 'rvl' && rand() > 0.72){
        n.layout.crossings = [n.arms[Math.floor(rand()*n.arms.length)]];
      }
      n.limit = (n.kind === 'rvl' || n.kind === 'roundabout') ? 30 : 50;
      /* the rule engine reads these off an object shaped like a scenario */
      if (!n.rail) n.railPriority = false;
      if (preset && preset.places[key]) n.place = preset.places[key];
    }
    /* a stable look for every block of houses, from its own seed */
    this.blockSeed = (opts.seed || 7) * 131 + 17;

    /* One-way cycle paths along both sides of the main roads, riding with
       the traffic beside them. `from` is the arm a cyclist comes in on,
       `off` how far to the right of their direction of travel the path
       lies. Beside the U-Bahn the path runs on beyond the track bed. */
    this.bikeLanes = [];
    var self = this;
    [['N', true], ['S', true], ['W', false], ['E', false]].forEach(function(l){
      var isCol = l[1];
      var index = isCol ? priCol : priRow;
      if (index < 0) return;
      var off = BIKE.off;
      if (isCol && index === self.railCol && l[0] === 'S') off = RAIL.bikeOff;    // northbound, east side
      self.bikeLanes.push({ id:self.bikeLanes.length, from:l[0], col:isCol, index:index, off:off });
    });
    this.nodeAt = function(cc, rr){
      if (cc < 0 || rr < 0 || cc >= this.cols || rr >= this.rows) return null;
      return this.nodes[rr*this.cols + cc];
    };
  }

  /* How far a point is outside the carriageway (world units), 0 on it.
     The town's streets are the grid lines, each BOX either side, running
     between the outermost junctions; a roundabout's island is not road. */
  Map.prototype.offRoad = function(x, y){
    var S = SPACING, c0 = -(this.cols-1)/2*S, r0 = -(this.rows-1)/2*S, i, best = 1e9;
    for (i = 0; i < this.nodes.length; i++){
      var n = this.nodes[i];
      if (n.layout.type !== 'roundabout') continue;
      var rr = Math.hypot(x - n.x, y - n.y);
      if (rr < CFG.RING - CFG.BOX) return CFG.RING - CFG.BOX - rr;          // on the island
      if (rr <= CFG.RING + CFG.BOX) return 0;                             // on the ring
    }
    /* a junction's corners are rounded, as kerbs are: inside the curve
       between two streets is still road */
    var nc = Geo.clamp(Math.round((x - c0)/S), 0, this.cols-1), nr = Geo.clamp(Math.round((y - r0)/S), 0, this.rows-1);
    var nn = this.nodeAt(nc, nr);
    if (nn && nn.layout.type !== 'roundabout'){
      var ax = Math.abs(x - nn.x), ay = Math.abs(y - nn.y), R = CORNER_R, B = CFG.BOX;
      if (ax > B && ay > B && ax < B + R && ay < B + R &&
          nn.arms.indexOf(x > nn.x ? 'E' : 'W') >= 0 && nn.arms.indexOf(y > nn.y ? 'S' : 'N') >= 0){
        var fd = R - Math.hypot(B + R - ax, B + R - ay);
        if (fd >= 0) return 0;
      }
    }
    /* the outermost junctions' boxes are road right to their far edge */
    var xMin = c0 - CFG.BOX, xMax = c0 + (this.cols-1)*S + CFG.BOX;
    var yMin = r0 - CFG.BOX, yMax = r0 + (this.rows-1)*S + CFG.BOX;
    /* along a row street */
    var ry = Math.round((y - r0)/S), rowY = r0 + Geo.clamp(ry, 0, this.rows-1)*S;
    var dxRow = Math.max(0, xMin - x, x - xMax);
    best = Math.min(best, Math.max(0, Math.abs(y - rowY) - CFG.BOX) + dxRow);
    /* along a column street */
    var cx = Math.round((x - c0)/S), colX = c0 + Geo.clamp(cx, 0, this.cols-1)*S;
    var dyCol = Math.max(0, yMin - y, y - yMax);
    best = Math.min(best, Math.max(0, Math.abs(x - colX) - CFG.BOX) + dyCol);
    return best;
  };

  Map.prototype.neighbour = function(node, arm){
    var d = { N:[0,-1], S:[0,1], E:[1,0], W:[-1,0] }[arm];
    return this.nodeAt(node.c + d[0], node.r + d[1]);
  };

  /* The street a given exit from `node` belongs to: a north-south arm is
     the column's street, an east-west arm the row's - the grid's real
     corridors, not the junction itself. */
  Map.prototype.streetName = function(node, arm){
    return (arm === 'N' || arm === 'S') ? this.colStreets[node.c] : this.rowStreets[node.r];
  };

  /* ---------------- routes ---------------- */
  /* A route is a list of junction traversals. Each one knows where it
     starts along the path, where its give-way line is, and where it
     hands over to the next.                                          */
  Map.prototype.buildRoute = function(startNode, startArm, steps, rand){
    rand = rand || Math.random;
    var route = [], node = startNode, from = startArm, i;
    for (i = 0; i < steps; i++){
      var outs = node.arms.filter(function(a){ return a !== from; });
      if (!outs.length) break;
      /* prefer going straight on, the way a real route mostly does */
      var straight = Geo.opposite(from);
      var to;
      if (outs.indexOf(straight) >= 0 && rand() < 0.5) to = straight;
      else to = outs[Math.floor(rand()*outs.length) % outs.length];
      var next = this.neighbour(node, to);
      route.push({ node:node, from:from, to:to });
      if (!next) break;
      node = next;
      from = Geo.opposite(to);
    }
    return route;
  };

  /* Turn a route into one long path, remembering the landmarks the
     rule engine needs for every step. Points are de-duplicated here so
     the indices still line up with the finished Path.               */
  Map.prototype.routePath = function(route){
    var pts = [], marks = [];
    function push(p){
      if (!pts.length || Geo.dist(pts[pts.length-1], p) > 0.5) pts.push(p);
    }
    var first = route[0];
    var lead = Geo.laneIn(first.from, ENTRY + LINK);
    push({ x:first.node.x + lead.x, y:first.node.y + lead.y });

    route.forEach(function(step, i){
      var piece = junctionPiece(step.from, step.to, step.node.layout.type);
      /* the link before this junction already ends on the piece's first
         point, which push() then drops as a duplicate - the junction
         starts at that shared point, not at the one after it */
      var first = { x:step.node.x + piece[0].x, y:step.node.y + piece[0].y };
      var startIdx = (pts.length && Geo.dist(pts[pts.length-1], first) <= 0.5)
                   ? pts.length - 1 : pts.length;
      piece.forEach(function(q){ push({ x:step.node.x + q.x, y:step.node.y + q.y }); });
      marks.push({ step:step, startIdx:startIdx, endIdx:pts.length - 1 });
      var nxt = route[i+1];
      if (nxt){
        var link = Geo.laneIn(nxt.from, ENTRY);
        push({ x:nxt.node.x + link.x, y:nxt.node.y + link.y });
      } else {
        var out = Geo.laneOut(step.to, ENTRY + LINK);
        push({ x:step.node.x + out.x, y:step.node.y + out.y });
      }
    });

    var path = new Geo.Path(pts);
    var steps = marks.map(function(m){
      var n = m.step.node;
      /* the give-way line is set back from the carriageway edge, so a car
         waiting at it stands clear of the traffic crossing in front */
      var holdR = n.layout.type === 'roundabout' ? CFG.RING + 76
                : (n.rail && m.step.from === n.rail.side) ? n.rail.carHold   // before the tracks
                : Math.hypot(HOLD, CFG.HALF);                    // behind the crossings
      var enterS = path.cum[m.startIdx];
      var exitS  = path.cum[m.endIdx];
      /* the give-way line: first point inside holdR, searched only
         across this junction rather than the whole route */
      var jS = enterS;
      for (var t = enterS; t <= exitS; t += 2){
        var q = path.at(t);
        if (Math.hypot(q.x - n.x, q.y - n.y) <= holdR){ jS = t; break; }
      }
      /* `plan` is the way the examiner wants you to go here; `to` the way
         you are actually going - they part when you choose otherwise */
      return { node:n, from:m.step.from, to:m.step.to, plan:m.step.plan || m.step.to,
               enterS:enterS, exitS:exitS, junctionS:jS };
    });
    return { path:path, steps:steps };
  };

  /* ---------------- the U-Bahn ---------------- */
  /* One straight run down the whole main road, per direction, with the
     same landmarks a car's route carries for every junction it crosses:
     where the junction's geometry starts and ends, and where the train
     waits at a red light (short of the side road it crosses). */
  Map.prototype.tramRoute = function(dir){
    if (this.railCol < 0) return null;
    var col = [], r;
    for (r = 0; r < this.rows; r++) col.push(this.nodeAt(this.railCol, r));
    var south = dir === 'S';
    if (!south) col.reverse();
    var x = col[0].x + RAIL.track[dir];
    var run = ENTRY + LINK + 400;
    var y0 = south ? col[0].y - run : col[0].y + run;
    var y1 = south ? col[col.length-1].y + run : col[col.length-1].y - run;
    var path = new Geo.Path([{ x:x, y:y0 }, { x:x, y:y1 }]);
    function sAt(y){ return Math.abs(y - y0); }
    var k = south ? 1 : -1;
    var steps = col.map(function(n){
      return { node:n, from: south ? 'N' : 'S', to: south ? 'S' : 'N',
               enterS: sAt(n.y - k*ENTRY), exitS: sAt(n.y + k*ENTRY),
               junctionS: sAt(n.y - k*RAIL.tramHold) };
    });
    return { path:path, steps:steps };
  };

  /* Where a train on track `dir` and a car making the move from->to meet
     inside one junction, both measured from the start of that junction's
     geometry. Turning off the main road across the tracks is the classic
     case: Sec. 9 (3) StVO makes you let the train through first. */
  var RAIL_CONFLICT = {};
  function railConflict(dir, from, to){
    var key = dir + '|' + from + to;
    if (key in RAIL_CONFLICT) return RAIL_CONFLICT[key];
    var x = RAIL.track[dir], k = dir === 'S' ? 1 : -1;
    var tram = new Geo.Path([{ x:x, y:-k*ENTRY }, { x:x, y:k*ENTRY }]);
    var car  = new Geo.Path(junctionPiece(from, to, 'cross'));
    var c = Geo.conflictOf(tram, car, RAIL.TRAM_W/2 + CFG.CAR_W/2 + 10);
    return (RAIL_CONFLICT[key] = c ? { st:c.sa, sc:c.sb } : null);
  }

  /* ---------------- cycle paths ---------------- */
  /* A cyclist's run along one side of a main road, with the landmarks for
     every junction on the way - the same shape as a car's or a train's,
     so the rule engine treats them all alike. The stop line is short of
     the side street the path crosses. */
  function bikeFrame(from, off){
    var dir = Geo.mul(Geo.ARM_VEC[from], -1), right = Geo.rot90cw(dir);
    return { dir:dir, right:right, off:off };
  }
  Map.prototype.bikeRoute = function(lane){
    var nodes = [], i;
    var n = lane.col ? this.rows : this.cols;
    for (i = 0; i < n; i++) nodes.push(lane.col ? this.nodeAt(lane.index, i) : this.nodeAt(i, lane.index));
    /* in the direction of travel */
    var f = bikeFrame(lane.from, lane.off);
    nodes.sort(function(a, b){ return (a.x*f.dir.x + a.y*f.dir.y) - (b.x*f.dir.x + b.y*f.dir.y); });
    var run = ENTRY + LINK*0.8;
    var a = nodes[0], b = nodes[nodes.length - 1];
    function at(node, t){ return { x:node.x + f.dir.x*t + f.right.x*f.off, y:node.y + f.dir.y*t + f.right.y*f.off }; }
    var p0 = at(a, -run), p1 = at(b, run);
    var path = new Geo.Path([p0, p1]);
    function sOf(node, t){ var q = at(node, t); return Math.hypot(q.x - p0.x, q.y - p0.y); }
    var steps = nodes.map(function(node){
      return { node:node, from:lane.from, to:Geo.opposite(lane.from),
               enterS:sOf(node, -ENTRY), exitS:sOf(node, ENTRY),
               junctionS:sOf(node, -(CFG.BOX + 14)) };
    });
    return { path:path, steps:steps };
  };
  /* where a cyclist on this path and a car making from->to meet, both
     measured from the start of the junction's geometry */
  var BIKE_CONFLICT = {};
  function bikeConflict(from, off, cfrom, cto){
    var key = from + off + '|' + cfrom + cto;
    if (key in BIKE_CONFLICT) return BIKE_CONFLICT[key];
    var f = bikeFrame(from, off);
    var bike = new Geo.Path([
      { x:-f.dir.x*ENTRY + f.right.x*off, y:-f.dir.y*ENTRY + f.right.y*off },
      { x: f.dir.x*ENTRY + f.right.x*off, y: f.dir.y*ENTRY + f.right.y*off }]);
    var car = new Geo.Path(junctionPiece(cfrom, cto, 'cross'));
    var c = Geo.conflictOf(bike, car, CFG.CAR_W/2 + BIKE.half + 10);
    return (BIKE_CONFLICT[key] = c ? { sb:c.sa, sc:c.sb } : null);
  }

  return {
    SPACING:SPACING, ENTRY:ENTRY, LINK:LINK, RAIL:RAIL, CW:CW, BIKE:BIKE, HOLD:HOLD, CORNER_R:CORNER_R,
    Map:Map, junctionPiece:junctionPiece,
    localConflict:localConflict, buildConflictTable:buildConflictTable,
    railConflict:railConflict, bikeConflict:bikeConflict,
    rng:rng
  };
})();
