'use strict';
/* ------------------------------------------------------------------
   pov.js - the view from the driver's seat.

   A pinhole camera sitting where the driver's eyes are, projecting the
   same world the top-down view draws. Ground geometry is painted first
   (road, pavements, track bed, markings), then everything that stands
   up - houses, trees, lamps, signs, lights, vehicles - is depth-sorted
   and drawn far to near.

   A lesson is one junction in open country. The open world is a whole
   town: every junction near you, the houses along every block, the
   U-Bahn beside the main road. Its layout comes from cityview.js.

   Camera space is (f, r, z): f forward, r to the right, z world height.
   ------------------------------------------------------------------ */

var POV = (function(){

  var M = CFG.PPM;                 // world units per metre
  var EYE_H   = 1.20 * M;          // eye height above the road
  var NEAR    = 0.75 * M;          // near clip plane
  var FAR_CUT = 130  * M;          // draw distance
  var FOV     = 78 * Math.PI/180;  // horizontal field of view
  var DETAIL  = 70 * M;            // windows and sleepers only this close

  var COL = {
    sky1:'#1b2740', sky2:'#3d4a63', haze:'#3d4a63',
    grass:'#23291f', road:'#2f2e2b', kerb:'#4c4941',
    paint:'#e9e5d9', paintDim:'#a8a499', island:'#2b3624',
    glass:'#161b21', interior:'#191713', dash:'#221f1a',
    route:'rgba(107,178,245,0.45)',
    pave:'#3a3833', yard:'#26301f', bed:'#3b3630', rail:'#8d8a82'
  };
  var VARS = {
    grass:'--grass', road:'--road', kerb:'--kerb', paint:'--paint',
    paintDim:'--paint-dim', island:'--island',
    sky1:'--sky-1', sky2:'--sky-2', haze:'--sky-2',
    interior:'--cabin', dash:'--cabin-dark'
  };
  var night = true;
  function luminance(hex){
    var h = (hex || '').replace('#','');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return 0;
    return (0.2126*((n>>16)&255) + 0.7152*((n>>8)&255) + 0.0722*(n&255)) / 255;
  }
  function syncTheme(){
    if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return;
    var cs = getComputedStyle(document.documentElement);
    for (var k in VARS){
      var v = cs.getPropertyValue(VARS[k]);
      if (v && v.trim()) COL[k] = v.trim();
    }
    var info = (cs.getPropertyValue('--info') || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(info)){
      var n = parseInt(info.slice(1), 16);
      COL.route = 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+',0.45)';
    }
    night = luminance(COL.sky1) < 0.3;
    /* the town's own surfaces follow day and night */
    COL.pave = night ? '#34322d' : '#b9b3a6';
    COL.yard = night ? '#1f271b' : '#7d9a5f';
    COL.bed  = night ? '#35302a' : '#8a8173';
    COL.rail = night ? '#8d8a82' : '#6c6a66';
    sprites = {};                                  // trees and lamps repaint too
  }

  /* ---------- colour helpers ---------- */
  function shade(hex, k){
    var h = (hex || '#888').replace('#','');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return hex;
    var r = Math.min(255, Math.round(((n>>16)&255)*k));
    var g = Math.min(255, Math.round(((n>>8)&255)*k));
    var b = Math.min(255, Math.round((n&255)*k));
    return 'rgb('+r+','+g+','+b+')';
  }
  /* houses and cars are darker at night, but never black */
  function lit(hex, k){ return shade(hex, night ? k*0.42 : k); }
  function hash(a, b, c){
    var x = (a*73856093) ^ (b*19349663) ^ (c*83492791);
    x = (x ^ (x >>> 13)) * 1274126177;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }

  /* ---------- camera ---------- */
  function makeCam(world, yaw, w, h){
    var p = world.player;
    var c = Math.cos(p.pos.h), s = Math.sin(p.pos.h);
    /* the driver sits ahead of the car's centre and to the left */
    var ex = p.pos.x + c*(p.len*0.10) + (-s)*(-p.wid*0.20);
    var ey = p.pos.y + s*(p.len*0.10) + ( c)*(-p.wid*0.20);
    var hh = p.pos.h + yaw;
    return {
      ex:ex, ey:ey, heading:hh,
      fx:Math.cos(hh), fy:Math.sin(hh),
      rx:-Math.sin(hh), ry:Math.cos(hh),
      F:(w/2)/Math.tan(FOV/2),
      cx:w/2, hy:h*0.47, eh:EYE_H, near:NEAR, w:w, h:h
    };
  }
  function toCam(cam, x, y, z){
    var dx = x - cam.ex, dy = y - cam.ey;
    return { f: dx*cam.fx + dy*cam.fy, r: dx*cam.rx + dy*cam.ry, z: z || 0 };
  }
  function proj(cam, p){
    var f = p.f < cam.near ? cam.near : p.f;
    var x = cam.cx + cam.F*p.r/f;
    var y = cam.hy + cam.F*(cam.eh - p.z)/f;
    /* keep the numbers sane for the rasteriser on extreme angles */
    if (x < -30000) x = -30000; else if (x > 30000) x = 30000;
    if (y < -30000) y = -30000; else if (y > 30000) y = 30000;
    return { x:x, y:y };
  }
  /* clip a polygon against the near plane (Sutherland-Hodgman, one plane) */
  function clipNear(pts, near){
    var out = [], n = pts.length, i;
    for (i = 0; i < n; i++){
      var a = pts[i], b = pts[(i+1) % n];
      var ain = a.f >= near, bin = b.f >= near;
      if (ain) out.push(a);
      if (ain !== bin){
        var t = (near - a.f) / (b.f - a.f);
        out.push({ f:near, r:a.r + (b.r-a.r)*t, z:a.z + (b.z-a.z)*t });
      }
    }
    return out;
  }
  /* add one polygon (world [x,y,z] points) to the current path */
  function tracePoly(ctx, cam, pts){
    var cs = [], i;
    for (i = 0; i < pts.length; i++) cs.push(toCam(cam, pts[i][0], pts[i][1], pts[i][2]));
    cs = clipNear(cs, cam.near);
    if (cs.length < 3) return false;
    for (i = 0; i < cs.length; i++){
      var s = proj(cam, cs[i]);
      if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y);
    }
    ctx.closePath();
    return true;
  }
  function fillPoly(ctx, cam, pts, color){
    ctx.beginPath();
    if (!tracePoly(ctx, cam, pts)) return;
    ctx.fillStyle = color;
    ctx.fill();
  }
  function rect(x0, y0, x1, y1, z){
    z = z || 0;
    return [[x0,y0,z],[x1,y0,z],[x1,y1,z],[x0,y1,z]];
  }

  /* a flat quad on the road, given in arm-local coordinates
     (d = distance out along the arm, lat = across it)             */
  function armQuad(ctx, cam, arm, d1, lat1, d2, lat2, color, ox, oy){
    ox = ox || 0; oy = oy || 0;
    var o = Geo.ARM_VEC[arm], q = Geo.rot90cw(o);
    function P(d, lat){ return [o.x*d + q.x*lat + ox, o.y*d + q.y*lat + oy, 0]; }
    fillPoly(ctx, cam, [P(d1,lat1), P(d2,lat1), P(d2,lat2), P(d1,lat2)], color);
  }

  /* ---------- billboards ---------- */
  function billboard(cam, x, y, zBottom, zTop){
    var c = toCam(cam, x, y, 0);
    if (c.f < cam.near || c.f > FAR_CUT) return null;
    var top = proj(cam, { f:c.f, r:c.r, z:zTop });
    var bot = proj(cam, { f:c.f, r:c.r, z:zBottom });
    return { x:top.x, top:top.y, h:bot.y - top.y, depth:c.f };
  }
  function drawBillboard(ctx, bb, img, worldW, worldH){
    if (!bb || bb.h <= 0.4) return;
    var w = bb.h * (worldW / worldH);
    ctx.drawImage(img, bb.x - w/2, bb.top, w, bb.h);
  }

  /* ---------- cached sprites ---------- */
  var sprites = {};
  function sprite(key, wpx, hpx, paint){
    if (sprites[key]) return sprites[key];
    var c = document.createElement('canvas');
    c.width = wpx; c.height = hpx;
    paint(c.getContext('2d'), wpx, hpx);
    sprites[key] = c;
    return c;
  }
  function pedSprite(kid){
    return sprite('ped' + (kid?'k':'a'), 48, 96, function(g, w, h){
      var skin = kid ? '#f0c9a0' : '#e8c9a8';
      var coat = kid ? '#e0863a' : '#4a5c7a';
      g.fillStyle = coat;
      g.beginPath();
      g.moveTo(w*0.28, h*0.30); g.lineTo(w*0.72, h*0.30);
      g.lineTo(w*0.68, h*0.66); g.lineTo(w*0.32, h*0.66);
      g.closePath(); g.fill();
      g.fillRect(w*0.34, h*0.62, w*0.13, h*0.36);   // legs
      g.fillRect(w*0.53, h*0.62, w*0.13, h*0.36);
      g.fillStyle = shade(coat, 0.75);
      g.fillRect(w*0.20, h*0.32, w*0.10, h*0.30);   // arms
      g.fillRect(w*0.70, h*0.32, w*0.10, h*0.30);
      g.fillStyle = skin;
      g.beginPath(); g.arc(w*0.5, h*0.19, w*0.16, 0, Math.PI*2); g.fill();
      g.fillStyle = '#2b2620';
      g.beginPath(); g.arc(w*0.5, h*0.13, w*0.16, Math.PI, Math.PI*2); g.fill();
    });
  }
  function lightSprite(state){
    return sprite('tl' + state, 44, 132, function(g, w, h){
      g.fillStyle = '#15181c';
      g.fillRect(w*0.10, 0, w*0.80, h);
      g.strokeStyle = '#2c3239'; g.lineWidth = 2;
      g.strokeRect(w*0.10, 0, w*0.80, h);
      var on = { red:'#ff3b30', yellow:'#ffcc00', green:'#2ecc5b' };
      [['red', h*0.19], ['yellow', h*0.50], ['green', h*0.81]].forEach(function(l){
        var lit = (state === l[0]) || (state === 'redyellow' && l[0] !== 'green');
        g.beginPath(); g.arc(w*0.5, l[1], w*0.26, 0, Math.PI*2);
        g.fillStyle = lit ? on[l[0]] : '#23272d';
        g.fill();
        if (lit){ g.shadowColor = on[l[0]]; g.shadowBlur = 14; g.fill(); g.shadowBlur = 0; }
      });
    });
  }
  /* a street tree: trunk and a loose, layered crown */
  function treeSprite(tone){
    var k = tone < 0.33 ? 0 : tone < 0.66 ? 1 : 2;
    return sprite('tree' + k + (night ? 'n' : 'd'), 128, 192, function(g, w, h){
      var greens = night ? [['#1c2a1a','#24361f','#2c4126'], ['#1a2718','#22331d','#2a3d24'], ['#202c19','#2a3a20','#334727']][k]
                         : [['#4f6e3a','#5f8246','#739a55'], ['#46663a','#567a45','#6a9152'], ['#5a7236','#6c8a41','#84a44f']][k];
      g.fillStyle = night ? '#2a231c' : '#5b4634';
      g.fillRect(w*0.46, h*0.50, w*0.08, h*0.50);
      var blobs = [[0.50,0.34,0.36],[0.32,0.42,0.24],[0.68,0.42,0.24],[0.42,0.22,0.22],[0.60,0.24,0.22],[0.50,0.50,0.22]];
      for (var layer = 0; layer < 3; layer++){
        g.fillStyle = greens[layer];
        blobs.forEach(function(b, i){
          var dx = (layer - 1) * 0.03 * (i % 2 ? 1 : -1), dy = -layer*0.02;
          g.beginPath();
          g.arc(w*(b[0]+dx), h*(b[1]+dy), w*b[2]*(1 - layer*0.22), 0, Math.PI*2);
          g.fill();
        });
      }
    });
  }
  function lampSprite(){
    return sprite('lamp' + (night ? 'n' : 'd'), 40, 200, function(g, w, h){
      g.fillStyle = night ? '#3a3d42' : '#5d6269';
      g.fillRect(w*0.46, h*0.06, w*0.08, h*0.94);
      g.fillRect(w*0.20, h*0.04, w*0.60, h*0.04);
      g.fillStyle = night ? '#ffe7a8' : '#d9dcdf';
      g.fillRect(w*0.14, h*0.075, w*0.34, h*0.02);
    });
  }
  /* the blue U-Bahn sign with the stop's name under it */
  function stationSprite(name){
    return sprite('stn' + name, 220, 300, function(g, w, h){
      g.fillStyle = '#5d6269';
      g.fillRect(w*0.47, h*0.30, w*0.06, h*0.70);
      g.fillStyle = '#1b4f9c';
      g.fillRect(w*0.30, 0, w*0.40, w*0.40);
      g.fillStyle = '#fff';
      g.font = 'bold ' + Math.round(w*0.32) + 'px Archivo, Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('U', w*0.5, w*0.21);
      g.fillStyle = '#f4f4f0';
      g.fillRect(0, h*0.32, w, h*0.13);
      g.fillStyle = '#1b1b1b';
      g.font = 'bold ' + Math.round(h*0.075) + 'px Archivo, Arial, sans-serif';
      g.fillText(name, w*0.5, h*0.385, w*0.96);
    });
  }

  /* ---------- sky, and Frankfurt on the horizon ---------- */
  /* A band of distant roofs all the way round, and to the south - where
     it really is from Eschersheim - the banking towers of the city. */
  var TOWERS = [
    { a:-0.16, w:0.030, h:0.23, top:'flat' },   // Commerzbank
    { a:-0.10, w:0.024, h:0.18, top:'flat' },
    { a:-0.07, w:0.022, h:0.20, top:'spike' },  // Main Tower
    { a:-0.02, w:0.026, h:0.16, top:'flat' },
    { a: 0.04, w:0.028, h:0.21, top:'pyramid' },// Messeturm
    { a: 0.10, w:0.020, h:0.13, top:'flat' }
  ];
  function drawHorizon(ctx, cam, world){
    var w = cam.w, H = cam.h, hy = cam.hy, i;
    var base = night ? '#141a26' : '#9aa6b3';
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.moveTo(0, hy);
    for (i = -60; i <= 60; i++){
      var a = cam.heading + i*0.02;
      var k = Math.floor((a / (Math.PI*2) * 314) % 314 + 314) % 314;
      var hh = (6 + hash(k, 3, 7)*16 + (hash(k, 5, 1) > 0.9 ? 12 : 0)) * H/700;
      var x = cam.cx + cam.F*Math.tan(i*0.02);
      if (Math.abs(i*0.02) > FOV*0.62) continue;
      ctx.lineTo(x, hy - hh); ctx.lineTo(x + cam.F*0.021, hy - hh);
    }
    ctx.lineTo(w, hy); ctx.closePath(); ctx.fill();
    if (!world.map) return;
    /* the skyline sits due south (heading +y) */
    TOWERS.forEach(function(t){
      var d = Math.atan2(Math.sin(Math.PI/2 + t.a - cam.heading), Math.cos(Math.PI/2 + t.a - cam.heading));
      if (Math.abs(d) > FOV*0.6) return;
      var x = cam.cx + cam.F*Math.tan(d), tw = cam.F*t.w, th = H*t.h*0.55;
      ctx.fillStyle = night ? '#1a2233' : '#8795a6';
      ctx.fillRect(x - tw/2, hy - th, tw, th);
      if (t.top === 'pyramid'){
        ctx.beginPath(); ctx.moveTo(x - tw/2, hy - th); ctx.lineTo(x, hy - th - tw*0.9); ctx.lineTo(x + tw/2, hy - th); ctx.fill();
      } else if (t.top === 'spike'){
        ctx.fillRect(x - 1, hy - th - tw*1.4, 2, tw*1.4);
      }
      if (night){
        ctx.fillStyle = 'rgba(255,214,140,0.55)';
        for (var j = 0; j < 14; j++)
          if (hash(Math.round(t.a*100), j, 9) > 0.45)
            ctx.fillRect(x - tw/2 + tw*hash(j, 2, Math.round(t.a*100)), hy - th*hash(j, 7, 3), 1.5, 1.5);
        ctx.fillStyle = '#ff3b30';
        ctx.fillRect(x - 1, hy - th - (t.top === 'spike' ? tw*1.4 : 0) - 2, 2, 2);
      }
    });
  }

  /* ---------- where the stop line is painted ---------- */
  /* In town the line sits where a car's front actually stops - further
     out beside the U-Bahn, so nobody waits on the tracks. */
  function stopLineX(sc, arm, ring){
    if (ring) return CFG.RING + CFG.BOX + 8;
    if (sc.rail && arm === sc.rail.side) return sc.rail.carHold - 2;
    if (sc.x !== undefined) return City.HOLD - 3;
    return CFG.BOX + 8;
  }

  /* ---------- ground: one junction ---------- */
  function drawJunctionGround(ctx, cam, sc, reach, city){
    var L = sc.layout;
    var ox = sc.x || 0, oy = sc.y || 0;
    var ring = L.type === 'roundabout';
    var inner = ring ? CFG.RING + CFG.BOX : 0;
    var i;

    /* carriageways + kerbs */
    L.arms.forEach(function(arm){
      var from = inner ? inner - 6 : -CFG.BOX;
      armQuad(ctx, cam, arm, from, -CFG.BOX-7, reach, CFG.BOX+7, COL.kerb, ox, oy);
      armQuad(ctx, cam, arm, from, -CFG.BOX,   reach, CFG.BOX,   COL.road, ox, oy);
    });

    if (ring){
      var N = 40, R0 = CFG.RING - CFG.BOX, R1 = CFG.RING + CFG.BOX;
      for (i = 0; i < N; i++){
        var a0 = i/N*Math.PI*2, a1 = (i+1)/N*Math.PI*2;
        fillPoly(ctx, cam, [
          [Math.cos(a0)*(R1+7)+ox, Math.sin(a0)*(R1+7)+oy, 0],
          [Math.cos(a1)*(R1+7)+ox, Math.sin(a1)*(R1+7)+oy, 0],
          [Math.cos(a1)*R0+ox, Math.sin(a1)*R0+oy, 0],
          [Math.cos(a0)*R0+ox, Math.sin(a0)*R0+oy, 0]], COL.kerb);
        fillPoly(ctx, cam, [
          [Math.cos(a0)*R1+ox, Math.sin(a0)*R1+oy, 0],
          [Math.cos(a1)*R1+ox, Math.sin(a1)*R1+oy, 0],
          [Math.cos(a1)*R0+ox, Math.sin(a1)*R0+oy, 0],
          [Math.cos(a0)*R0+ox, Math.sin(a0)*R0+oy, 0]], COL.road);
      }
      var island = [];
      for (i = 0; i < N; i++)
        island.push([Math.cos(i/N*Math.PI*2)*R0+ox, Math.sin(i/N*Math.PI*2)*R0+oy, 0]);
      fillPoly(ctx, cam, island, COL.island);
    } else {
      /* a town junction's corners are kerbed round, not left square */
      var bx = city ? CFG.BOX + 7 : CFG.BOX;
      fillPoly(ctx, cam, rect(-bx+ox, -bx+oy, bx+ox, bx+oy), city ? COL.kerb : COL.road);
      if (city) fillPoly(ctx, cam, rect(-CFG.BOX+ox, -CFG.BOX+oy, CFG.BOX+ox, CFG.BOX+oy), COL.road);
      /* the side arms' kerbs run across the mouth of every other arm:
         put the asphalt back where the arms meet the box */
      L.arms.forEach(function(arm){
        armQuad(ctx, cam, arm, -CFG.BOX, -CFG.BOX, CFG.BOX + 10, CFG.BOX, COL.road, ox, oy);
      });
    }
  }

  function drawJunctionMarkings(ctx, cam, sc, reach){
    var L = sc.layout, ox = sc.x || 0, oy = sc.y || 0;
    var ring = L.type === 'roundabout';
    L.arms.forEach(function(arm){
      var start = (ring ? CFG.RING + CFG.BOX : CFG.BOX) + 14;
      for (var d = start; d < reach - 20; d += 48)
        armQuad(ctx, cam, arm, d, -2, d + 26, 2, COL.paintDim, ox, oy);

      var sign = Rules.signOf(sc, arm);
      var lit  = sc.lights && sc.lights.groups[arm];
      var lineX = stopLineX(sc, arm, ring);
      var hasCross = L.crossings && L.crossings.indexOf(arm) >= 0;
      var town = sc.x !== undefined;
      if (hasCross && !town) lineX = Math.max(lineX, Sim.CROSS_MID + Sim.CROSS_HALF + 12);
      /* in town the crossing sits just outside the box, inside the line */
      if (hasCross && town){
        for (var zy = -CFG.BOX + 4; zy < CFG.BOX - 3; zy += 14)
          armQuad(ctx, cam, arm, City.CW.in, zy, City.CW.out, zy + 7, COL.paint, ox, oy);
        hasCross = false;
      }

      if (lit || sign === 'stop'){
        armQuad(ctx, cam, arm, lineX, -CFG.BOX, lineX + 7, 0, COL.paint, ox, oy);
      } else if (sign === 'yield' || sign === 'ringentry' || sign === 'exit'){
        for (var y = -CFG.BOX + 3; y < -2; y += 17)
          armQuad(ctx, cam, arm, lineX, y, lineX + 7, y + 10, COL.paint, ox, oy);
      }
      if (hasCross){
        for (var yy = -CFG.BOX + 6; yy < CFG.BOX - 4; yy += 17)
          armQuad(ctx, cam, arm, Sim.CROSS_MID - Sim.CROSS_HALF, yy,
                                 Sim.CROSS_MID + Sim.CROSS_HALF, yy + 10, COL.paint, ox, oy);
      }
    });
  }

  /* ---------- ground: the whole town ---------- */
  function nearNodes(world, cam, range){
    var out = [], nodes = world.map.nodes;
    for (var i = 0; i < nodes.length; i++){
      var n = nodes[i];
      var c = toCam(cam, n.x, n.y, 0);
      if (Math.hypot(c.f, c.r) > range) continue;
      if (c.f < -City.SPACING*0.6) continue;
      out.push(n);
    }
    return out;
  }
  function boxVisible(cam, x0, y0, x1, y1, pad){
    var pts = [[x0,y0],[x1,y0],[x1,y1],[x0,y1]], ahead = false, left = 0, right = 0, i;
    var t = Math.tan(FOV/2) * 1.1;
    for (i = 0; i < 4; i++){
      var c = toCam(cam, pts[i][0], pts[i][1], 0);
      if (c.f > cam.near) ahead = true;
      if (c.f > FAR_CUT + (pad || 0)) continue;
      if (c.r < -Math.max(c.f, 1)*t) left++;
      if (c.r >  Math.max(c.f, 1)*t) right++;
    }
    if (!ahead) return false;
    if (left === 4 || right === 4) return false;
    /* too far away altogether */
    var cx = Geo.clamp(cam.ex, x0, x1), cy = Geo.clamp(cam.ey, y0, y1);
    return Math.hypot(cx - cam.ex, cy - cam.ey) < FAR_CUT;
  }
  function drawCityGround(ctx, cam, world){
    var map = world.map, view = CityView.build(map), i;
    var reach = City.SPACING/2 + 2;

    /* courtyards and gardens: whatever the houses leave open */
    view.blocks.forEach(function(b){
      if (!boxVisible(cam, b.x0, b.y0, b.x1, b.y1)) return;
      fillPoly(ctx, cam, rect(b.x0, b.y0, b.x1, b.y1), COL.yard);
    });

    /* the U-Bahn's bed, under the roads that cross it */
    var bed = CityView.railBed(map);
    if (bed) fillPoly(ctx, cam, rect(bed.x0, bed.y0, bed.x1, bed.y1), COL.bed);

    var nodes = nearNodes(world, cam, FAR_CUT + City.SPACING);
    nodes.forEach(function(n){ drawJunctionGround(ctx, cam, n, reach, true); });

    /* the red cycle paths, over pavement and side streets alike */
    CityView.bikePaths(map).forEach(function(bp){
      var h = bp.half;
      fillPoly(ctx, cam, rect(Math.min(bp.a.x, bp.b.x) - (bp.col ? h : 0), Math.min(bp.a.y, bp.b.y) - (bp.col ? 0 : h),
                              Math.max(bp.a.x, bp.b.x) + (bp.col ? h : 0), Math.max(bp.a.y, bp.b.y) + (bp.col ? 0 : h), 0.2),
               night ? '#4a2a22' : '#b86a58');
    });

    /* rails: over the bed and across the roads, sleepers only up close */
    if (bed){
      var y0 = Math.max(bed.y0, cam.ey - FAR_CUT), y1 = Math.min(bed.y1, cam.ey + FAR_CUT);
      bed.tracks.forEach(function(tx){
        if (Math.abs(tx - cam.ex) < FAR_CUT){
          var sy0 = Math.max(y0, cam.ey - DETAIL*0.5), sy1 = Math.min(y1, cam.ey + DETAIL*0.5);
          ctx.beginPath();
          for (var sy = Math.ceil(sy0/9)*9; sy < sy1; sy += 9)
            tracePoly(ctx, cam, rect(tx - 13, sy, tx + 13, sy + 3.5, 0.2));
          ctx.fillStyle = night ? '#2a2521' : '#6e6255'; ctx.fill();
          fillPoly(ctx, cam, rect(tx - 9.5, y0, tx - 8, y1, 0.4), COL.rail);
          fillPoly(ctx, cam, rect(tx + 8, y0, tx + 9.5, y1, 0.4), COL.rail);
        }
      });
    }
    nodes.forEach(function(n){ drawJunctionMarkings(ctx, cam, n, reach); });
    void i;
  }

  /* ---------- ground: a lesson's single junction ---------- */
  function drawWorldGround(ctx, cam, world){
    if (world.map) drawCityGround(ctx, cam, world);
    else {
      var sc = world.junctionFor(world.player);
      drawJunctionGround(ctx, cam, sc, FAR_CUT, false);
      drawJunctionMarkings(ctx, cam, sc, FAR_CUT);
    }

    /* the route we are supposed to take, as chevrons on the road */
    var p = world.player;
    for (var s = p.s + 70; s < Math.min(p.path.length, p.s + 620); s += 62){
      var q = p.path.at(s);
      var c = Math.cos(q.h), sn = Math.sin(q.h);
      function P(fwd, lat){ return [q.x + c*fwd - sn*lat, q.y + sn*fwd + c*lat, 0.4]; }
      fillPoly(ctx, cam, [P(16,0), P(-8,-13), P(-2,0), P(-8,13)], COL.route);
    }
  }

  /* ---------- solids: prisms with a top smaller than the bottom ---------- */
  /* bottom and top are 4 world [x,y] corners each, in the same order
     around; faces turned away from the eye are skipped. Lit from the
     south-west, as the sun would be in the afternoon. */
  var SUN = (function(){ var l = Math.hypot(-0.5, 0.45, 0.75); return [-0.5/l, 0.45/l, 0.75/l]; })();
  function drawPrism(ctx, cam, bottom, z0, top, z1, color, onlyTop){
    var B = bottom.map(function(p){ return [p[0], p[1], z0]; });
    var T = top.map(function(p){ return [p[0], p[1], z1]; });
    var cx = 0, cy = 0, i;
    for (i = 0; i < 4; i++){ cx += B[i][0] + T[i][0]; cy += B[i][1] + T[i][1]; }
    cx /= 8; cy /= 8;
    var cz = (z0 + z1)/2;
    var faces = [T];
    if (!onlyTop) for (i = 0; i < 4; i++){
      var j = (i+1) % 4;
      faces.push([B[i], B[j], T[j], T[i]]);
    }
    for (i = 0; i < faces.length; i++){
      var f = faces[i];
      var ax = f[1][0]-f[0][0], ay = f[1][1]-f[0][1], az = f[1][2]-f[0][2];
      var bx = f[3][0]-f[0][0], by = f[3][1]-f[0][1], bz = f[3][2]-f[0][2];
      var nx = ay*bz - az*by, ny = az*bx - ax*bz, nz = ax*by - ay*bx;
      var mx = (f[0][0]+f[2][0])/2, my = (f[0][1]+f[2][1])/2, mz = (f[0][2]+f[2][2])/2;
      if (nx*(mx-cx) + ny*(my-cy) + nz*(mz-cz) < 0){ nx = -nx; ny = -ny; nz = -nz; }
      if (nx*(cam.ex-mx) + ny*(cam.ey-my) + nz*(cam.eh-mz) <= 0) continue;
      var nl = Math.hypot(nx, ny, nz) || 1;
      var k = 0.60 + 0.48*Math.max(0, (nx*SUN[0] + ny*SUN[1] + nz*SUN[2])/nl);
      fillPoly(ctx, cam, f, lit(color, k));
    }
  }
  /* a footprint in a vehicle's own frame: fwd from..to, lat half-width */
  function frame4(v, f0, f1, hw, lat0){
    var c = Math.cos(v.pos.h), s = Math.sin(v.pos.h), l = lat0 || 0;
    function P(fwd, lat){ lat += l; return [v.pos.x + c*fwd - s*lat, v.pos.y + s*fwd + c*lat]; }
    return [P(f1, -hw), P(f1, hw), P(f0, hw), P(f0, -hw)];
  }

  /* ---------- vehicles ---------- */
  function drawShadow(ctx, cam, v){
    fillPoly(ctx, cam, frame4(v, -v.len*0.54, v.len*0.54, v.wid*0.58).map(function(p){ return [p[0], p[1], 0.3]; }),
             night ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.28)');
  }
  function drawCar(ctx, cam, v){
    var L = v.len, W = v.wid, hw = W/2, m = M;
    var col = v.color;
    /* wheels, the body over them, then the glasshouse and the roof */
    [[-0.32, -1], [-0.32, 1], [0.33, -1], [0.33, 1]].forEach(function(wp){
      var f = wp[0]*L, lat = wp[1]*(hw - 1.6);
      var fp = frame4(v, f - 0.33*m, f + 0.33*m, 1.3, lat);
      drawPrism(ctx, cam, fp, 0, fp, 0.64*m, '#151515');
    });
    drawPrism(ctx, cam, frame4(v, -L/2, L/2, hw), 0.30*m,
                        frame4(v, -L/2 + 1.5, L/2 - 5, hw - 0.9), 0.98*m, col);
    drawPrism(ctx, cam, frame4(v, -L/2 + 7, L/2 - 17, hw - 1.3), 0.98*m,
                        frame4(v, -L/2 + 11, L/2 - 24, hw - 3.4), 1.42*m, '#1b232c');
    var roof = frame4(v, -L/2 + 11.5, L/2 - 24.5, hw - 3.6);
    drawPrism(ctx, cam, roof, 1.42*m, roof, 1.48*m, col);
    if (v.taxi){
      var sign = frame4(v, -3, 3, 3.6);
      drawPrism(ctx, cam, sign, 1.48*m, sign, 1.72*m, night ? '#ffe98a' : '#f4d03f');
    }
  }
  function drawTram(ctx, cam, v){
    var L = v.len, hw = v.wid/2, m = M;
    var body = frame4(v, -L/2, L/2, hw);
    var roof = frame4(v, -L/2 + 6, L/2 - 6, hw - 1.5);
    drawPrism(ctx, cam, body, 0.35*m, body, 2.35*m, v.color);
    drawPrism(ctx, cam, frame4(v, -L/2 - 0.2, L/2 + 0.2, hw + 0.2), 1.25*m,
                        frame4(v, -L/2 - 0.2, L/2 + 0.2, hw + 0.2), 2.25*m, '#1d252e');
    drawPrism(ctx, cam, frame4(v, -L/2 - 0.3, L/2 + 0.3, hw + 0.3), 0.40*m,
                        frame4(v, -L/2 - 0.3, L/2 + 0.3, hw + 0.3), 0.62*m, '#b8322a');
    drawPrism(ctx, cam, body, 2.35*m, roof, 3.30*m, v.color);
    var pan = frame4(v, -L*0.18, -L*0.06, hw - 6);
    drawPrism(ctx, cam, pan, 3.30*m, pan, 3.55*m, '#3a3f45');
  }
  function drawBus(ctx, cam, v){
    var L = v.len, hw = v.wid/2, m = M;
    var body = frame4(v, -L/2, L/2, hw);
    drawPrism(ctx, cam, body, 0.32*m, body, 2.85*m, v.color);
    drawPrism(ctx, cam, frame4(v, -L/2 - 0.2, L/2 + 0.2, hw + 0.2), 1.25*m,
                        frame4(v, -L/2 - 0.2, L/2 + 0.2, hw + 0.2), 2.45*m, '#1d252e');
  }
  function vehicleTop(v){
    if (v.kind === 'tram') return 3.30*M;
    if (v.kind === 'bus')  return 2.85*M;
    return 0.98*M;
  }
  /* a cyclist, seen side-on or from behind: close enough as a sprite */
  function bikeSprite(color){
    return sprite('bike' + color + (night ? 'n' : 'd'), 64, 96, function(g, w, h){
      g.strokeStyle = night ? '#222' : '#1b1b1b'; g.lineWidth = 4;
      g.beginPath(); g.arc(w*0.5, h*0.82, w*0.14, 0, Math.PI*2); g.stroke();
      g.strokeStyle = color; g.lineWidth = 4;
      g.beginPath(); g.moveTo(w*0.5, h*0.82); g.lineTo(w*0.5, h*0.52); g.stroke();
      g.fillStyle = shade(color, night ? 0.5 : 1);
      g.fillRect(w*0.32, h*0.22, w*0.36, h*0.32);          // jacket
      g.fillStyle = '#e2bf9d';
      g.beginPath(); g.arc(w*0.5, h*0.14, w*0.11, 0, Math.PI*2); g.fill();
      g.fillStyle = '#e8e8e2';
      g.beginPath(); g.arc(w*0.5, h*0.11, w*0.12, Math.PI, Math.PI*2); g.fill();
      g.fillStyle = '#c0281c'; g.fillRect(w*0.44, h*0.60, w*0.12, h*0.04);
    });
  }
  function drawVehicle(ctx, cam, v, t){
    if (v.kind === 'bike'){
      var bb = billboard(cam, v.pos.x, v.pos.y, 0, 1.85*M);
      drawBillboard(ctx, bb, bikeSprite(v.color || '#2b5d8a'), 0.9, 1.85);
      return;
    }
    drawShadow(ctx, cam, v);
    if (v.kind === 'tram') drawTram(ctx, cam, v);
    else if (v.kind === 'bus') drawBus(ctx, cam, v);
    else drawCar(ctx, cam, v);

    /* lamps: only visible from the side that has them */
    var c = Math.cos(v.pos.h), s = Math.sin(v.pos.h);
    var toCamX = cam.ex - v.pos.x, toCamY = cam.ey - v.pos.y;
    var behind = (toCamX*c + toCamY*s) < 0;
    var lampZ = v.kind === 'car' || !v.kind ? 0.72*M : vehicleTop(v)*0.30, hl = v.len/2 + 0.3, hw = v.wid/2;
    function lamp(fwd, lat, col, size, aspect, z){
      var x = v.pos.x + c*fwd - s*lat, y = v.pos.y + s*fwd + c*lat, zz = z || lampZ;
      var bb = billboard(cam, x, y, zz - size/2, zz + size/2);
      if (!bb || bb.h < 0.6) return;
      var a = aspect || 1.5;
      ctx.fillStyle = col;
      ctx.fillRect(bb.x - bb.h*a/2, bb.top, bb.h*a, bb.h);
      if (aspect) return;                          // a number plate does not glow
      if (night && bb.h > 1.5){
        ctx.globalAlpha = 0.28;
        ctx.beginPath(); ctx.arc(bb.x, bb.top + bb.h/2, bb.h*2.2, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    var blink = (t*2.2) % 1 < 0.55;
    var car = v.kind === 'car' || !v.kind;
    /* the white EU number plate, front and back */
    if (car) lamp(behind ? -hl : hl, 0, night ? '#8d8f94' : '#eeeeea', 1.3, 4.6, 0.46*M);
    if (behind){
      var tail = v.brakeLight ? '#ff4436' : (night ? '#c23a2e' : '#8f2f28');
      lamp(-hl, -hw*0.74, tail, 2.2);
      lamp(-hl,  hw*0.74, tail, 2.2);
      if (blink && v.indicator === 'left')  lamp(-hl, -hw*0.95, '#ffb02e', 2.2);
      if (blink && v.indicator === 'right') lamp(-hl,  hw*0.95, '#ffb02e', 2.2);
    } else {
      lamp(hl, -hw*0.70, night ? '#fff7dc' : '#e9e4d2', 2.2);
      lamp(hl,  hw*0.70, night ? '#fff7dc' : '#e9e4d2', 2.2);
      if (blink && v.indicator === 'left')  lamp(hl, -hw*0.95, '#ffb02e', 2.2);
      if (blink && v.indicator === 'right') lamp(hl,  hw*0.95, '#ffb02e', 2.2);
    }
    if (v.emergency){
      var f = (t*7) % 1 < 0.5;
      var bz = 1.55*M;
      [[-hw*0.5, f], [hw*0.5, !f]].forEach(function(b){
        var x = v.pos.x - s*b[0], y = v.pos.y + c*b[0];
        var bb = billboard(cam, x, y, bz, bz + 3);
        if (bb && bb.h > 0.6){ ctx.fillStyle = b[1] ? '#5ab4ff' : '#1d4470'; ctx.fillRect(bb.x - bb.h, bb.top, bb.h*2, bb.h); }
      });
    }
  }

  /* ---------- houses ---------- */
  function drawHouse(ctx, cam, hs){
    var x0 = hs.x0, y0 = hs.y0, x1 = hs.x1, y1 = hs.y1, h = hs.h;
    var ex = cam.ex, ey = cam.ey;
    /* each wall that faces us, with its outward direction for the light */
    var walls = [];
    if (ey < y0) walls.push({ a:[x1,y0], b:[x0,y0], n:[0,-1] });
    if (ey > y1) walls.push({ a:[x0,y1], b:[x1,y1], n:[0, 1] });
    if (ex < x0) walls.push({ a:[x0,y0], b:[x0,y1], n:[-1,0] });
    if (ex > x1) walls.push({ a:[x1,y1], b:[x1,y0], n:[ 1,0] });
    var near = Math.hypot(Geo.clamp(ex, x0, x1) - ex, Geo.clamp(ey, y0, y1) - ey);

    walls.forEach(function(wl){
      var k = 0.66 + 0.40*Math.max(0, wl.n[0]*SUN[0] + wl.n[1]*SUN[1] + 0.25);
      fillPoly(ctx, cam, [[wl.a[0],wl.a[1],0],[wl.b[0],wl.b[1],0],[wl.b[0],wl.b[1],h],[wl.a[0],wl.a[1],h]],
               lit(hs.color, k));
      /* a darker plinth, then windows up close */
      fillPoly(ctx, cam, [[wl.a[0],wl.a[1],0],[wl.b[0],wl.b[1],0],[wl.b[0],wl.b[1],0.55*M],[wl.a[0],wl.a[1],0.55*M]],
               lit(hs.color, k*0.72));
      if (near < DETAIL) drawWindows(ctx, cam, hs, wl);
    });

    /* the roof: pitched, ridge parallel to the street, or flat */
    if (hs.roof){
      var rh = hs.roofH, alongX = (hs.front === 'N' || hs.front === 'S');
      if (alongX){
        var ym = (y0 + y1)/2;
        if (ey < ym) fillPoly(ctx, cam, [[x0,y0,h],[x1,y0,h],[x1,ym,h+rh],[x0,ym,h+rh]], lit(hs.roof, 0.95));
        if (ey > ym) fillPoly(ctx, cam, [[x0,y1,h],[x1,y1,h],[x1,ym,h+rh],[x0,ym,h+rh]], lit(hs.roof, 0.80));
        if (ex < x0) fillPoly(ctx, cam, [[x0,y0,h],[x0,y1,h],[x0,ym,h+rh]], lit(hs.color, 0.78));
        if (ex > x1) fillPoly(ctx, cam, [[x1,y0,h],[x1,y1,h],[x1,ym,h+rh]], lit(hs.color, 0.70));
      } else {
        var xm = (x0 + x1)/2;
        if (ex < xm) fillPoly(ctx, cam, [[x0,y0,h],[x0,y1,h],[xm,y1,h+rh],[xm,y0,h+rh]], lit(hs.roof, 0.92));
        if (ex > xm) fillPoly(ctx, cam, [[x1,y0,h],[x1,y1,h],[xm,y1,h+rh],[xm,y0,h+rh]], lit(hs.roof, 0.82));
        if (ey < y0) fillPoly(ctx, cam, [[x0,y0,h],[x1,y0,h],[xm,y0,h+rh]], lit(hs.color, 0.78));
        if (ey > y1) fillPoly(ctx, cam, [[x0,y1,h],[x1,y1,h],[xm,y1,h+rh]], lit(hs.color, 0.72));
      }
    } else {
      /* flat roof: a parapet line */
      walls.forEach(function(wl){
        fillPoly(ctx, cam, [[wl.a[0],wl.a[1],h-0.35*M],[wl.b[0],wl.b[1],h-0.35*M],[wl.b[0],wl.b[1],h],[wl.a[0],wl.a[1],h]],
                 lit(hs.color, 0.6));
      });
    }
  }
  /* windows on one wall, batched into as few fills as possible */
  function drawWindows(ctx, cam, hs, wl){
    var ax = wl.a[0], ay = wl.a[1], dx = wl.b[0] - ax, dy = wl.b[1] - ay;
    var len = Math.hypot(dx, dy), ux = dx/len, uy = dy/len;
    var bay = 3.1*M, n = Math.max(1, Math.floor(len / bay)), pad = (len - n*bay)/2;
    var out = 0.15;                             // a hair proud of the wall
    var ox = wl.n[0]*out, oy = wl.n[1]*out;
    function Q(u0, u1, z0, z1){
      return [[ax + ux*u0 + ox, ay + uy*u0 + oy, z0], [ax + ux*u1 + ox, ay + uy*u1 + oy, z0],
              [ax + ux*u1 + ox, ay + uy*u1 + oy, z1], [ax + ux*u0 + ox, ay + uy*u0 + oy, z1]];
    }
    var glass = night ? '#141a22' : '#3c4a58', warm = '#f3c872', frame = hs.color;
    var dark = [], lamp = [];
    for (var fl = 0; fl < hs.floors; fl++){
      for (var i = 0; i < n; i++){
        var u = pad + i*bay + bay/2;
        var q;
        if (fl === 0 && hs.shop){
          q = Q(u - bay*0.42, u + bay*0.42, 0.55*M, 2.7*M);
        } else if (fl === 0 && i === Math.floor(n/2)){
          q = Q(u - 0.55*M, u + 0.55*M, 0.1*M, 2.25*M);        // the front door
          (night ? lamp : dark).push({ q:q, door:true });
          continue;
        } else {
          var z = fl*3.0*M + 0.95*M;
          q = Q(u - 0.62*M, u + 0.62*M, z, z + 1.45*M);
        }
        var on = night && hash(hs.seed, fl*31 + i, 5) < (fl === 0 && hs.shop ? 0.8 : 0.34);
        (on ? lamp : dark).push({ q:q });
      }
    }
    ctx.beginPath();
    dark.forEach(function(w){ if (!w.door) tracePoly(ctx, cam, w.q); });
    ctx.fillStyle = glass; ctx.fill();
    ctx.beginPath();
    dark.concat(lamp).forEach(function(w){ if (w.door) tracePoly(ctx, cam, w.q); });
    ctx.fillStyle = lit(frame, 0.45); ctx.fill();
    if (lamp.length){
      ctx.beginPath();
      lamp.forEach(function(w){ if (!w.door) tracePoly(ctx, cam, w.q); });
      ctx.fillStyle = warm; ctx.fill();
    }
  }

  /* ---------- standing objects, depth sorted ---------- */
  function depthOf(cam, x, y){ return Math.hypot(x - cam.ex, y - cam.ey); }
  function collectObjects(world, cam){
    var out = [];

    world.vehicles.forEach(function(v){
      if (v.done || v.isPlayer) return;
      var c = toCam(cam, v.pos.x, v.pos.y, 0);
      if (c.f < cam.near - v.len || c.f > FAR_CUT + v.len) return;
      out.push({ depth:Math.max(0, depthOf(cam, v.pos.x, v.pos.y) - v.len*0.35), kind:'veh', v:v });
    });

    world.peds.forEach(function(ped){
      if (ped.state === 'done') return;
      var pt = ped.point();
      var c = toCam(cam, pt.x, pt.y, 0);
      if (c.f < cam.near || c.f > FAR_CUT) return;
      out.push({ depth:depthOf(cam, pt.x, pt.y), kind:'ped', ped:ped, pt:pt });
    });

    function pushAt(ob, x, y){
      var c = toCam(cam, x, y, 0);
      if (c.f < cam.near || c.f > FAR_CUT) return;
      ob.depth = depthOf(cam, x, y); ob.x = x; ob.y = y;
      out.push(ob);
    }

    var junctions = world.map ? nearNodes(world, cam, FAR_CUT + 200) : [world.junctionFor(world.player)];
    junctions.forEach(function(sc){
      var L = sc.layout, ox = sc.x || 0, oy = sc.y || 0;
      /* road signs, on their posts */
      L.arms.forEach(function(arm){
        var type = L.type === 'roundabout' ? 'roundabout' : Rules.signOf(sc, arm);
        var o = Geo.ARM_VEC[arm], q = Geo.rot90cw(o);
        var base = L.type === 'roundabout' ? CFG.RING + CFG.BOX : CFG.BOX;
        var d = base + 46, lat = -(CFG.BOX + 26);
        if (sc.rail && arm === sc.rail.side) d = sc.rail.carHold + 10;
        var x = o.x*d + q.x*lat + ox, y = o.y*d + q.y*lat + oy;
        if (type !== 'none') pushAt({ kind:'sign', type:type, dz:0 }, x, y);
        if (L.zone && sc.player && arm === sc.player.from) pushAt({ kind:'sign', type:L.zone, dz:0 }, x + o.x*74, y + o.y*74);
        if (sc.gruenpfeil && sc.gruenpfeil.indexOf(arm) >= 0) pushAt({ kind:'sign', type:'green_arrow', dz:-0.55*M }, x, y);
      });
      if (L.busstop){
        var ob = Geo.ARM_VEC[L.busstop], qb = Geo.rot90cw(ob);
        pushAt({ kind:'sign', type:'bus_stop', dz:0 },
               ob.x*(CFG.BOX+430) + qb.x*(-(CFG.BOX+26)) + ox, ob.y*(CFG.BOX+430) + qb.y*(-(CFG.BOX+26)) + oy);
      }
      /* traffic lights: one before the junction, one on the far side */
      if (sc.lights){
        L.arms.forEach(function(arm){
          var st = Rules.lightFor(sc, arm, world.t);
          if (!st) return;
          var o = Geo.ARM_VEC[arm], q = Geo.rot90cw(o);
          var near = CFG.BOX + 26;
          if (sc.rail && arm === sc.rail.side) near = sc.rail.carHold + 8;
          [[near, -(CFG.BOX + 24)], [-(CFG.BOX + 30), -(CFG.BOX + 24)]].forEach(function(pos){
            pushAt({ kind:'light', state:st }, o.x*pos[0] + q.x*pos[1] + ox, o.y*pos[0] + q.y*pos[1] + oy);
          });
        });
      }
      /* the U-Bahn stop's sign on the corner */
      if (sc.place && sc.rail)
        pushAt({ kind:'station', name:sc.place }, ox + City.RAIL.bed[1] + 22, oy - CFG.BOX - 60);
    });

    if (world.map){
      var view = CityView.build(world.map);
      view.houses.forEach(function(hs){
        if (!boxVisible(cam, hs.x0, hs.y0, hs.x1, hs.y1)) return;
        var cx = Geo.clamp(cam.ex, hs.x0, hs.x1), cy = Geo.clamp(cam.ey, hs.y0, hs.y1);
        out.push({ depth:depthOf(cam, cx, cy), kind:'house', hs:hs });
      });
      view.trees.forEach(function(t){ pushAt({ kind:'tree', t:t }, t.x, t.y); });
      view.lamps.forEach(function(l){ pushAt({ kind:'lamp' }, l.x, l.y); });
    }

    out.sort(function(a, b){ return b.depth - a.depth; });
    return out;
  }

  /* ---------- the cabin you are sitting in ---------- */
  function drawInterior(ctx, w, h, world, yaw){
    var col = world.player.color;
    var shift = -yaw * w * 0.42;          // the cabin swings as you look round
    var hood = h * 0.845;

    ctx.save();
    ctx.translate(shift, 0);

    /* headlining */
    ctx.fillStyle = COL.dash;
    ctx.fillRect(-w, -1, w*3, h*0.055);

    /* A-pillars: raked back, and no wider than they need to be */
    ctx.fillStyle = COL.interior;
    ctx.beginPath();
    ctx.moveTo(-w*0.03, 0); ctx.lineTo(w*0.085, 0);
    ctx.lineTo(w*0.012, hood); ctx.lineTo(-w*0.03, hood);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w*1.03, 0); ctx.lineTo(w*0.915, 0);
    ctx.lineTo(w*0.988, hood); ctx.lineTo(w*1.03, hood);
    ctx.closePath(); ctx.fill();

    /* mirror */
    ctx.fillStyle = COL.dash;
    ctx.beginPath();
    ctx.moveTo(w*0.44, 0); ctx.lineTo(w*0.56, 0);
    ctx.lineTo(w*0.555, h*0.085); ctx.lineTo(w*0.445, h*0.085);
    ctx.closePath(); ctx.fill();

    /* bonnet, with the sky caught in its paint */
    var g = ctx.createLinearGradient(0, hood, 0, h);
    g.addColorStop(0, shade(col, night ? 0.55 : 0.85));
    g.addColorStop(0.35, shade(col, night ? 0.40 : 0.62));
    g.addColorStop(1, shade(col, night ? 0.25 : 0.40));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-w*0.05, h + 2);
    ctx.lineTo(w*0.10, hood);
    ctx.quadraticCurveTo(w*0.5, hood - h*0.035, w*0.90, hood);
    ctx.lineTo(w*1.05, h + 2);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = shade(col, 1.25); ctx.lineWidth = 1.5;
    ctx.stroke();

    /* dashboard lip + steering wheel rim */
    ctx.fillStyle = COL.dash;
    ctx.beginPath();
    ctx.ellipse(w*0.30, h*1.16, w*0.20, h*0.235, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    /* a soft vignette so the eye goes to the road */
    var v = ctx.createRadialGradient(w/2, h*0.42, h*0.28, w/2, h*0.42, h*0.95);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.26)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }

  /* our own headlights on the road ahead, after dark */
  function drawHeadlights(ctx, cam){
    if (!night) return;
    var w = cam.w, h = cam.h;
    var g = ctx.createRadialGradient(w/2, h*0.80, h*0.02, w/2, h*0.66, h*0.42);
    g.addColorStop(0, 'rgba(255,240,200,0.20)');
    g.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(w*0.18, h); ctx.lineTo(w*0.42, cam.hy + h*0.05);
    ctx.lineTo(w*0.58, cam.hy + h*0.05); ctx.lineTo(w*0.82, h);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* ---------- main entry ---------- */
  function frame(ctx, w, h, world, yaw){
    var cam = makeCam(world, yaw || 0, w, h);
    var horizon = cam.hy;

    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0, 0, w, h);

    /* sky */
    var sky = ctx.createLinearGradient(0, 0, 0, Math.max(1, horizon));
    sky.addColorStop(0, COL.sky1);
    sky.addColorStop(1, COL.sky2);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, Math.max(0, horizon));
    drawHorizon(ctx, cam, world);

    /* ground */
    ctx.fillStyle = world.map ? COL.pave : COL.grass;
    ctx.fillRect(0, Math.max(0, horizon), w, h - Math.max(0, horizon));

    drawWorldGround(ctx, cam, world);
    drawHeadlights(ctx, cam);

    /* haze along the horizon gives the distance some depth */
    var haze = ctx.createLinearGradient(0, horizon - h*0.02, 0, horizon + h*0.10);
    haze.addColorStop(0, COL.haze);
    haze.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizon - h*0.02, w, h*0.12);
    ctx.globalAlpha = 1;

    collectObjects(world, cam).forEach(function(ob){
      if (ob.kind === 'veh'){
        drawVehicle(ctx, cam, ob.v, world.t);
      } else if (ob.kind === 'house'){
        drawHouse(ctx, cam, ob.hs);
      } else if (ob.kind === 'tree'){
        var tb = billboard(cam, ob.t.x, ob.t.y, 0, ob.t.h);
        drawBillboard(ctx, tb, treeSprite(ob.t.tone), ob.t.r*2*1.35, ob.t.h);
      } else if (ob.kind === 'lamp'){
        var lb0 = billboard(cam, ob.x, ob.y, 0, 7.5*M);
        drawBillboard(ctx, lb0, lampSprite(), 1.5*M, 7.5*M);
        if (night && lb0 && lb0.h > 4){
          var gl = ctx.createRadialGradient(lb0.x, lb0.top + lb0.h*0.08, 0, lb0.x, lb0.top + lb0.h*0.08, lb0.h*0.35);
          gl.addColorStop(0, 'rgba(255,225,150,0.55)'); gl.addColorStop(1, 'rgba(255,225,150,0)');
          ctx.fillStyle = gl;
          ctx.fillRect(lb0.x - lb0.h*0.35, lb0.top + lb0.h*0.08 - lb0.h*0.35, lb0.h*0.7, lb0.h*0.7);
        }
      } else if (ob.kind === 'station'){
        var sb = billboard(cam, ob.x, ob.y, 0, 3.4*M);
        drawBillboard(ctx, sb, stationSprite(ob.name), 2.5*M, 3.4*M);
      } else if (ob.kind === 'ped'){
        var bb = billboard(cam, ob.pt.x, ob.pt.y, 0, (ob.ped.kid ? 1.25 : 1.74)*M);
        drawBillboard(ctx, bb, pedSprite(ob.ped.kid), 0.55, 1.74);
      } else if (ob.kind === 'sign'){
        var post = billboard(cam, ob.x, ob.y, 0, 1.72*M + ob.dz);
        if (post && post.h > 1){
          ctx.fillStyle = '#8b8b86';
          ctx.fillRect(post.x - post.h*0.018, post.top, Math.max(1, post.h*0.036), post.h);
        }
        var face = billboard(cam, ob.x, ob.y, 1.72*M + ob.dz, 2.62*M + ob.dz);
        drawBillboard(ctx, face, Signs.bitmap(ob.type, 96), 1, 1);
      } else if (ob.kind === 'light'){
        var lb = billboard(cam, ob.x, ob.y, 2.05*M, 3.10*M);
        drawBillboard(ctx, lb, lightSprite(ob.state), 0.35, 1.05);
        if (lb && lb.h > 2){
          ctx.fillStyle = '#4b4f55';
          var mast = billboard(cam, ob.x, ob.y, 0, 2.05*M);
          if (mast) ctx.fillRect(mast.x - lb.h*0.02, mast.top, Math.max(1, lb.h*0.04), mast.h);
        }
      }
    });

    drawInterior(ctx, w, h, world, yaw || 0);
    ctx.setTransform(1,0,0,1,0,0);
  }

  return { frame:frame, syncTheme:syncTheme, EYE_H:EYE_H, COL:COL };
})();
