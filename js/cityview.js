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
    if (isCol && index === map.railCol && side > 0) return City.RAIL.bed[1] + 6 + WALK;
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
      if (front === 'N') ay += yard; if (front === 'S') by -= yard;
      if (front === 'W') ax += yard; if (front === 'E') bx -= yard;
      var floors = onMain ? 4 + Math.floor(rand()*2) : 2 + Math.floor(rand()*3);
      var h = (floors*3.0 + 0.6) * M;
      blk.houses.push({
        x0:ax, y0:ay, x1:bx, y1:by, h:h, floors:floors, front:front,
        color:FACADES[Math.floor(rand()*FACADES.length)],
        roof: rand() < 0.72 ? ROOFS[Math.floor(rand()*ROOFS.length)] : null,
        roofH:(1.8 + rand()*1.6) * M,
        shop: onMain && rand() < 0.7,
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
          var off = setback(map, isCol, i, side) - WALK*0.35;
          if (isCol && i === map.railCol && side > 0) off = City.RAIL.bed[1] + 6 + WALK*0.35;
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

    var houses = [];
    blocks.forEach(function(b){ houses = houses.concat(b.houses); });
    map._view = { blocks:blocks, houses:houses, trees:trees, lamps:lamps,
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

  return { build:build, railBed:railBed, KERB:KERB, WALK:WALK, rng:rng };
})();
