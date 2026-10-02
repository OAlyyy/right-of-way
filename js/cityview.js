'use strict';
/* ------------------------------------------------------------------
   cityview.js - what the open world looks like, apart from the road.

   Lays out, once per map, everything the two views draw around the
   streets: blocks of houses along every block edge, trees and street
   lamps on the pavements, the U-Bahn's track bed. Pure geometry - no
   drawing here - so the driver's view and the map view show the same
   town, and a seed always rebuilds the same one.

   Measurements from the centre line of a street outwards:
     0 .. 48      carriageway (two 4 m lanes)
     48 .. 55     kerb
     55 .. 91     pavement (3 m)
     91 ..        front gardens, then houses
   Beside the main road the U-Bahn's bed (58 .. 134) comes first.
   ------------------------------------------------------------------ */

var CityView = (function(){

  var M = CFG.PPM;
  var KERB = CFG.BOX + 7;          // outer edge of the kerb
  var WALK = 36;                   // pavement width
  var DEPTH = 150;                 // a house, front to back (12.5 m)

  /* plaster colours you actually see on Frankfurt residential streets,
     plus the odd red sandstone front */
  var FACADES = ['#e8dcc4', '#efe7d6', '#d9c7a6', '#f2efe8', '#d8d2c6', '#e6d3b8',
                 '#cdb79b', '#e9e1cf', '#c9ced1', '#e3cfc0', '#b8836a', '#dccba8'];
  var ROOFS   = ['#4a4744', '#5a4038', '#7a4a3a', '#3e4145', '#6b3f33'];

  function rng(seed){
    var x = seed || 1;
    return function(){ x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
  }

  /* how far back from a street's centre line the houses start */
  function setback(map, isCol, index, side){
    /* beside the U-Bahn: its bed, then the cycle path, then the pavement */
    if (isCol && index === map.railCol && side > 0) return City.RAIL.bed[1] + 6 + 12 + WALK;
    return KERB + WALK;
  }

  /* ---------------- building one block ---------------- */
  function addBlock(out, rand, x0, y0, x1, y1, fronts, main){
    if (x1 - x0 < 120 || y1 - y0 < 120) return;
    var d = Math.min(DEPTH, (x1 - x0)/2 - 4, (y1 - y0)/2 - 4);
    var blk = { x0:x0, y0:y0, x1:x1, y1:y1, houses:[] };
    function house(ax, ay, bx, by, front, onMain){
      if (rand() < 0.10) return;                       // a gap: garden, driveway
      var yard = rand() < 0.5 ? 0 : 10 + rand()*24;    // some sit behind a front garden
      /* a front garden is fenced off from the pavement by a low hedge */
      var hedge = null;
      if (yard){
        if (front === 'N') hedge = { x0:ax, y0:ay, x1:bx, y1:ay + 7 };
        if (front === 'S') hedge = { x0:ax, y0:by - 7, x1:bx, y1:by };
        if (front === 'W') hedge = { x0:ax, y0:ay, x1:ax + 7, y1:by };
        if (front === 'E') hedge = { x0:bx - 7, y0:ay, x1:bx, y1:by };
      }
      if (front === 'N') ay += yard; if (front === 'S') by -= yard;
      if (front === 'W') ax += yard; if (front === 'E') bx -= yard;
      var floors = onMain ? 4 + Math.floor(rand()*2) : 2 + Math.floor(rand()*3);
      var h = (floors*3.0 + 0.6) * M;
      var shop = onMain && rand() < 0.7;
      blk.houses.push({
        x0:ax, y0:ay, x1:bx, y1:by, h:h, floors:floors, front:front,
        color:FACADES[Math.floor(rand()*FACADES.length)],
        roof: rand() < 0.72 ? ROOFS[Math.floor(rand()*ROOFS.length)] : null,
        roofH:(1.8 + rand()*1.6) * M,
        shop: shop,
        balcony: floors >= 3 && rand() < 0.5,          // a stack of balconies on the street side
        hedge: hedge,
        seed: Math.floor(rand()*1e6)
      });
    }
    function run(a, b, place){
      var p = a;
      while (b - p > 60){
        var w = 130 + rand()*110;
        if (b - p - w < 90) w = b - p;
        place(p, Math.min(b, p + w));
        p += w;
      }
    }
    /* long sides get the corners, short sides fill in between */
    if (fronts.N) run(x0, x1, function(a, b){ house(a, y0, b, y0 + d, 'N', main.N); });
    if (fronts.S) run(x0, x1, function(a, b){ house(a, y1 - d, b, y1, 'S', main.S); });
    var ya = fronts.N ? y0 + d : y0, yb = fronts.S ? y1 - d : y1;
    if (fronts.W) run(ya, yb, function(a, b){ house(x0, a, x0 + d, b, 'W', main.W); });
    if (fronts.E) run(ya, yb, function(a, b){ house(x1 - d, a, x1, b, 'E', main.E); });
    out.push(blk);
  }

  /* ---------------- the whole town ---------------- */
  function build(map){
    if (map._view) return map._view;
    var rand = rng(map.blockSeed || 99);
    var S = City.SPACING, cols = map.cols, rows = map.rows;
    var blocks = [], trees = [], lamps = [], c, r;
    function colX(i){ return (i - (cols-1)/2) * S; }
    function rowY(i){ return (i - (rows-1)/2) * S; }
    var OUT = S * 0.9;                                  // the ring of houses around the map

    for (c = -1; c < cols; c++){
      for (r = -1; r < rows; r++){
        /* the block between column lines c, c+1 and row lines r, r+1 */
        var hasW = c >= 0, hasE = c + 1 < cols, hasN = r >= 0, hasS = r + 1 < rows;
        if (!hasW && !hasE) continue;
        if (!hasN && !hasS) continue;
        var outerRow = !hasN || !hasS, outerCol = !hasW || !hasE;
        /* Inside the grid a block stands back from all four streets. In the
           ring outside it, the streets have ended: neighbouring blocks close
           up to one another, so a road that ends looks at a row of houses -
           except where the U-Bahn carries on past the end of the main road. */
        var x0 = !hasW ? colX(0) - OUT
               : !outerRow ? colX(c) + setback(map, true, c, 1)
               : c === map.railCol ? colX(c) + City.RAIL.bed[1] + 8 : colX(c);
        var x1 = !hasE ? colX(cols-1) + OUT
               : !outerRow ? colX(c+1) - setback(map, true, c+1, -1)
               : c + 1 === map.railCol ? colX(c+1) + City.RAIL.bed[0] - 8 : colX(c+1);
        var y0 = !hasN ? rowY(0) - OUT
               : !outerCol ? rowY(r) + setback(map, false, r, 1) : rowY(r);
        var y1 = !hasS ? rowY(rows-1) + OUT
               : !outerCol ? rowY(r+1) - setback(map, false, r+1, -1) : rowY(r+1);
        /* the ring's own houses face the street that runs along the map edge */
        if (outerRow && !outerCol){
          if (!hasN) y1 = rowY(0) - setback(map, false, 0, -1);
          if (!hasS) y0 = rowY(rows-1) + setback(map, false, rows-1, 1);
        }
        if (outerCol && !outerRow){
          if (!hasW) x1 = colX(0) - setback(map, true, 0, -1);
          if (!hasE) x0 = colX(cols-1) + setback(map, true, cols-1, 1);
        }
        var main = {
          N: hasN && r === map.priRow, S: hasS && r + 1 === map.priRow,
          W: hasW && c === map.priCol, E: hasE && c + 1 === map.priCol
        };
        /* houses face a side only where a street actually runs along it */
        var fronts = {
          N: outerRow ? !hasS : hasN, S: outerRow ? !hasN : hasS,
          W: outerCol ? !hasE : hasW, E: outerCol ? !hasW : hasE
        };
        if (outerRow && outerCol) fronts = { N:false, S:false, W:false, E:false };
        if (outerRow && !outerCol){ fronts.W = false; fronts.E = false; }
        if (outerCol && !outerRow){ fronts.N = false; fronts.S = false; }
        addBlock(blocks, rand, x0, y0, x1, y1, fronts, main);
      }
    }

    /* trees and lamps on the pavements, every so often, never in a junction */
    function alongStreet(isCol, i){
      var line = isCol ? colX(i) : rowY(i);
      var n = isCol ? rows : cols;
      var from = (isCol ? rowY(0) : colX(0)), to = (isCol ? rowY(rows-1) : colX(cols-1));
      var main = isCol ? i === map.priCol : i === map.priRow;
      var step = main ? 150 : 210;
      for (var t = from + 170; t < to - 120; t += step){
        var k = ((t - from) % S + S) % S;
        if (k < 190 || k > S - 190) continue;           // keep the junctions clear
        [-1, 1].forEach(function(side){
          /* along a main road the cycle path runs where the trees would
             stand, so they move back to the edge of the pavement */
          var off = setback(map, isCol, i, side) - (main ? 4 : WALK*0.35);
          var px = isCol ? line + side*off : t, py = isCol ? t : line + side*off;
          if (rand() < (main ? 0.9 : 0.55)) trees.push({ x:px, y:py, h:(7 + rand()*5)*M, r:(2.2 + rand()*1.4)*M, tone:rand() });
        });
        if (Math.round((t - from)/step) % 2 === 0){
          var lo = KERB + 6;
          /* on the kerb, its arm reaching out over the carriageway */
          lamps.push({ x:isCol ? line - lo : t + 40, y:isCol ? t + 40 : line - lo, col:isCol });
        }
      }
      void n;
    }
    for (c = 0; c < cols; c++) alongStreet(true, c);
    for (r = 0; r < rows; r++) alongStreet(false, r);

    /* Along every stretch of street between two junctions: cars parked at
       the kerb of the quiet streets (half on the pavement, as Frankfurt
       parks), people walking the pavements, and the odd manhole cover.
       Everything keeps clear of the junctions themselves. */
    var parked = [], walkers = [], manholes = [];
    var CAR_COLS = ['#c9ccd1','#b7bbc1','#6d7177','#2b2f36','#1d1f23','#f1f1ee','#e4e5e2',
                    '#1f3a5f','#2d4a6e','#9e2b25','#3d5a4a','#8a7f6d'];
    function stretches(isCol, i){
      var main = isCol ? i === map.priCol : i === map.priRow;
      var line = isCol ? colX(i) : rowY(i);
      var n = isCol ? rows : cols;
      for (var k = 0; k < n - 1; k++){
        var a = isCol ? rowY(k) : colX(k), b = isCol ? rowY(k+1) : colX(k+1);
        var clear = CFG.BOX + City.CORNER_R + 40;
        var from = a + clear, to = b - clear;
        [-1, 1].forEach(function(side){
          var railSide = isCol && i === map.railCol && side > 0;
          /* parked cars, facing the way the traffic on their side runs */
          if (!main && !railSide){
            var h = isCol ? (side > 0 ? -Math.PI/2 : Math.PI/2) : (side > 0 ? 0 : Math.PI);
            for (var t = from + rand()*30; t < to - 52; ){
              if (rand() < 0.7){
                var along = t + 26;
                parked.push({ x:isCol ? line + side*57 : along, y:isCol ? along : line + side*57, h:h, col:isCol,
                              color:rand() < 0.05 ? '#efe6c8' : CAR_COLS[Math.floor(rand()*CAR_COLS.length)],
                              type:Math.floor(rand()*5), seed:Math.floor(rand()*1e6) });
              }
              t += 52 + 12 + rand()*34;
            }
          }
          /* somebody walking this pavement, to and fro */
          if (rand() < 0.85){
            var off = railSide ? City.RAIL.bed[1] + 6 + 12 + WALK*0.5 : main ? CFG.BOX + 16 : KERB + WALK - 8;
            walkers.push({ col:isCol, line:line, side:side, off:off, a:from, b:to,
                           phase:rand(), speed:(1.1 + rand()*0.5)*M, look:rand() });
          }
        });
        if (rand() < 0.8){
          var m = a + (b - a)*(0.25 + rand()*0.5), lat = (rand() < 0.5 ? -1 : 1)*CFG.HALF*0.9;
          manholes.push({ x:isCol ? line + lat : m, y:isCol ? m : line + lat });
        }
      }
    }
    for (c = 0; c < cols; c++) stretches(true, c);
    for (r = 0; r < rows; r++) stretches(false, r);

    var houses = [];
    blocks.forEach(function(b){ houses = houses.concat(b.houses); });

    /* Street furniture, with its own dice so nothing else moves: on the
       side streets bins, bike hoops (some with a bike) and the odd bench,
       in the strip between the parked cars and the people walking; at
       every junction corner a street-name sign and bollards that stop
       corner parking; at some corners an advertising pillar. */
    var furn = [], frand = rng((map.blockSeed || 99) + 7177);
    function freeOf(x, y, d){
      for (var i = 0; i < trees.length; i++) if (Math.hypot(trees[i].x - x, trees[i].y - y) < d) return false;
      for (i = 0; i < lamps.length; i++) if (Math.hypot(lamps[i].x - x, lamps[i].y - y) < d*0.7) return false;
      for (i = 0; i < furn.length; i++) if (Math.hypot(furn[i].x - x, furn[i].y - y) < d) return false;
      return true;
    }
    function inBlock(x, y){
      return blocks.some(function(b){ return x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1; });
    }
    function sideStreet(isCol, i){
      var main = isCol ? i === map.priCol : i === map.priRow;
      if (main) return;
      var line = isCol ? colX(i) : rowY(i), n = isCol ? rows : cols;
      for (var k = 0; k < n - 1; k++){
        var a = isCol ? rowY(k) : colX(k), b = isCol ? rowY(k+1) : colX(k+1);
        var clear = CFG.BOX + City.CORNER_R + 60;
        [-1, 1].forEach(function(side){
          if (isCol && i === map.railCol && side > 0) return;
          for (var t = a + clear + frand()*80; t < b - clear; t += 110 + frand()*170){
            var r = frand(), kind = r < 0.45 ? 'bin' : r < 0.8 ? 'rack' : 'bench';
            var lat = side*(KERB + (kind === 'bench' ? WALK - 6 : 19));
            var x = isCol ? line + lat : t, y = isCol ? t : line + lat;
            if (!freeOf(x, y, kind === 'rack' ? 34 : 22)) continue;
            /* along the street; benches face it */
            var h = isCol ? Math.PI/2 : 0;
            furn.push({ kind:kind, x:x, y:y, h:h, side:side, col:isCol, bikes:kind === 'rack' ? Math.floor(frand()*3) : 0, seed:frand() });
          }
        });
      }
    }
    for (c = 0; c < cols; c++) sideStreet(true, c);
    for (r = 0; r < rows; r++) sideStreet(false, r);
    (map.nodes || []).forEach(function(n){
      if (n.layout && n.layout.type === 'roundabout') return;       // its own kerbs, no corners
      var c0 = Math.round(n.x/S + (cols - 1)/2), r0 = Math.round(n.y/S + (rows - 1)/2);
      var nameCol = map.streetName ? map.streetName(n, 'N') : '', nameRow = map.streetName ? map.streetName(n, 'E') : '';
      var pillarAt = frand() < 0.35 ? Math.floor(frand()*4) : -1;
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function(q, qi){
        if (c0 === map.railCol && q[0] > 0) return;              // the U-Bahn side has no corner
        var cx = n.x + q[0]*(KERB + 12), cy = n.y + q[1]*(KERB + City.CORNER_R + 16);
        if (inBlock(cx, cy)) return;
        if (qi % 2 === 0 || frand() < 0.5)
          furn.push({ kind:'name', x:cx, y:cy, a:nameCol, b:nameRow, q:q });
        /* bollards along the kerb where the corner rounds */
        var bx = n.x + q[0]*(KERB + 3), by = n.y + q[1]*(KERB + City.CORNER_R + 4);
        for (var j = 0; j < 3; j++) furn.push({ kind:'bollard', x:bx, y:by + q[1]*j*18 });
        if (qi === pillarAt){
          var px = n.x + q[0]*(KERB + WALK*0.55), py = n.y + q[1]*(KERB + City.CORNER_R + 60);
          if (!inBlock(px, py) && freeOf(px, py, 24)) furn.push({ kind:'pillar', x:px, y:py, seed:frand() });
        }
      });
      void r0;
    });

    map._view = { blocks:blocks, houses:houses, trees:trees, lamps:lamps,
                  parked:parked, walkers:walkers, manholes:manholes, furniture:furn,
                  colX:colX, rowY:rowY };
    return map._view;
  }

  /* the U-Bahn's bed, as a rectangle along the main road */
  function railBed(map){
    if (map.railCol < 0) return null;
    var v = build(map), x = v.colX(map.railCol), S = City.SPACING;
    var run = City.ENTRY + City.LINK + 400;
    return { x0:x + City.RAIL.bed[0], x1:x + City.RAIL.bed[1],
             y0:v.rowY(0) - run, y1:v.rowY(map.rows-1) + run,
             tracks:[x + City.RAIL.track.S, x + City.RAIL.track.N], S:S };
  }

  /* the cycle paths, as strips: each with its centre line from a to b
     (world units), its half-width, and the side streets it crosses */
  function bikePaths(map){
    return (map.bikeLanes || []).map(function(lane){
      var r = map.bikeRoute(lane);
      return { a:r.path.pts[0], b:r.path.pts[r.path.pts.length - 1], half:City.BIKE.half,
               col:lane.col, lane:lane, nodes:r.steps.map(function(st){ return st.node; }) };
    });
  }

  /* where a pavement walker is at time t: to and fro along their stretch */
  function walkerAt(wk, t){
    var len = wk.b - wk.a, u = (t*wk.speed/len + wk.phase*2) % 2;
    var back = u > 1, f = back ? 2 - u : u;
    var along = wk.a + f*len, lat = wk.side*wk.off + (back ? -1 : 1)*wk.side*3;
    var x = wk.col ? wk.line + lat : along, y = wk.col ? along : wk.line + lat;
    var dir = back ? -1 : 1;
    return { x:x, y:y, h: wk.col ? (dir > 0 ? Math.PI/2 : -Math.PI/2) : (dir > 0 ? 0 : Math.PI) };
  }
  /* is (x, y) inside a parked car (with a margin)? returns it, or null */
  function parkedAt(map, x, y, margin){
    var v = build(map), m = margin || 0;
    for (var i = 0; i < v.parked.length; i++){
      var pc = v.parked[i];
      var hx = (pc.col ? CFG.CAR_W : CFG.CAR_L)/2 + m, hy = (pc.col ? CFG.CAR_L : CFG.CAR_W)/2 + m;
      if (Math.abs(x - pc.x) < hx && Math.abs(y - pc.y) < hy) return pc;
    }
    return null;
  }

  return { build:build, railBed:railBed, bikePaths:bikePaths, walkerAt:walkerAt, parkedAt:parkedAt,
           KERB:KERB, WALK:WALK, rng:rng };
})();
