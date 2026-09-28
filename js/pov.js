'use strict';
/* ------------------------------------------------------------------
   pov.js - the view from the driver's seat.

   A pinhole camera sitting where the driver's eyes are, projecting the
   same world the top-down view draws. Ground geometry is painted first
   (road, markings, crossings), then everything that stands up off the
   road is depth-sorted and drawn far to near.

   Camera space is (f, r, z): f forward, r to the right, z world height.
   ------------------------------------------------------------------ */

var POV = (function(){

  var M = CFG.PPM;                 // world units per metre
  var EYE_H   = 1.20 * M;          // eye height above the road
  var NEAR    = 0.75 * M;          // near clip plane
  var FAR_CUT = 130  * M;          // draw distance
  var FOV     = 78 * Math.PI/180;  // horizontal field of view

  var COL = {
    sky1:'#1b2740', sky2:'#3d4a63', haze:'#3d4a63',
    grass:'#23291f', road:'#2f2e2b', kerb:'#4c4941',
    paint:'#e9e5d9', paintDim:'#a8a499', island:'#2b3624',
    glass:'#161b21', interior:'#191713', dash:'#221f1a',
    route:'rgba(107,178,245,0.45)'
  };
  var VARS = {
    grass:'--grass', road:'--road', kerb:'--kerb', paint:'--paint',
    paintDim:'--paint-dim', island:'--island',
    sky1:'--sky-1', sky2:'--sky-2', haze:'--sky-2',
    interior:'--cabin', dash:'--cabin-dark'
  };
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

  /* ---------- camera ---------- */
  function makeCam(world, yaw, w, h){
    var p = world.player;
    var c = Math.cos(p.pos.h), s = Math.sin(p.pos.h);
    /* the driver sits ahead of the car's centre and to the left */
    var ex = p.pos.x + c*(p.len*0.10) + (-s)*(-p.wid*0.20);
    var ey = p.pos.y + s*(p.len*0.10) + ( c)*(-p.wid*0.20);
    var hh = p.pos.h + yaw;
    return {
      ex:ex, ey:ey,
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
  /* pts: array of [x, y, z] in world space */
  function fillPoly(ctx, cam, pts, color){
    var cs = [], i;
    for (i = 0; i < pts.length; i++) cs.push(toCam(cam, pts[i][0], pts[i][1], pts[i][2]));
    cs = clipNear(cs, cam.near);
    if (cs.length < 3) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (i = 0; i < cs.length; i++){
      var s = proj(cam, cs[i]);
      if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y);
    }
    ctx.closePath();
    ctx.fill();
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

  /* ---------- ground ---------- */
  function drawWorldGround(ctx, cam, world){
    /* Everything here is built as if the current junction sat at the
       world origin - true for a lesson, not for the open world, where
       junctions sit at their own real map coordinates. ox/oy carries
       that real position through, and is zero for a lesson (its
       junction has no x/y), so nothing changes there. */
    var sc = world.junctionFor(world.player), L = sc.layout;
    var ox = sc.x || 0, oy = sc.y || 0;
    var ring = L.type === 'roundabout';
    var inner = ring ? CFG.RING + CFG.BOX : 0;
    var i;

    /* carriageways + kerbs */
    L.arms.forEach(function(arm){
      var from = inner ? inner - 6 : -CFG.BOX;
      armQuad(ctx, cam, arm, from, -CFG.BOX-7, FAR_CUT, CFG.BOX+7, COL.kerb, ox, oy);
      armQuad(ctx, cam, arm, from, -CFG.BOX,   FAR_CUT, CFG.BOX,   COL.road, ox, oy);
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
      fillPoly(ctx, cam, [
        [-CFG.BOX+ox,-CFG.BOX+oy,0], [CFG.BOX+ox,-CFG.BOX+oy,0],
        [ CFG.BOX+ox, CFG.BOX+oy,0], [-CFG.BOX+ox, CFG.BOX+oy,0]], COL.road);
    }

    /* markings */
    L.arms.forEach(function(arm){
      var start = (ring ? CFG.RING + CFG.BOX : CFG.BOX) + 14;
      for (var d = start; d < FAR_CUT; d += 48)
        armQuad(ctx, cam, arm, d, -2, d + 26, 2, COL.paintDim, ox, oy);

      var sign = Rules.signOf(sc, arm);
      var lit  = sc.lights && sc.lights.groups[arm];
      var lineX = ring ? CFG.RING + CFG.BOX + 8 : CFG.BOX + 8;
      var hasCross = L.crossings && L.crossings.indexOf(arm) >= 0;
      if (hasCross) lineX = Sim.CROSS_MID + Sim.CROSS_HALF + 12;

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

    /* the route we are supposed to take, as chevrons on the road */
    var p = world.player;
    for (var s = p.s + 70; s < Math.min(p.path.length, p.s + 620); s += 62){
      var q = p.path.at(s);
      var c = Math.cos(q.h), sn = Math.sin(q.h);
      function P(fwd, lat){ return [q.x + c*fwd - sn*lat, q.y + sn*fwd + c*lat, 0.4]; }
      fillPoly(ctx, cam, [P(16,0), P(-8,-13), P(-2,0), P(-8,13)], COL.route);
    }
  }

  /* ---------- vehicles as boxes ---------- */
  function boxFaces(v, z0, z1, shrink){
    var c = Math.cos(v.pos.h), s = Math.sin(v.pos.h);
    var hl = v.len/2 * (shrink || 1), hw = v.wid/2 * (shrink ? 0.94 : 1);
    function P(fwd, lat, z){
      return [v.pos.x + c*fwd - s*lat, v.pos.y + s*fwd + c*lat, z];
    }
    return [
      { pts:[P(hl,-hw,z0), P(hl,hw,z0), P(hl,hw,z1), P(hl,-hw,z1)],      n:[ c, s, 0], k:0.94 },
      { pts:[P(-hl,hw,z0), P(-hl,-hw,z0), P(-hl,-hw,z1), P(-hl,hw,z1)],  n:[-c,-s, 0], k:0.74 },
      { pts:[P(-hl,-hw,z0), P(hl,-hw,z0), P(hl,-hw,z1), P(-hl,-hw,z1)],  n:[ s,-c, 0], k:0.64 },
      { pts:[P(hl,hw,z0), P(-hl,hw,z0), P(-hl,hw,z1), P(hl,hw,z1)],      n:[-s, c, 0], k:0.80 },
      { pts:[P(hl,-hw,z1), P(hl,hw,z1), P(-hl,hw,z1), P(-hl,-hw,z1)],    n:[ 0, 0, 1], k:1.10 }
    ];
  }
  function drawBox(ctx, cam, v, z0, z1, color, shrink){
    boxFaces(v, z0, z1, shrink).forEach(function(face){
      /* is this face turned towards the camera? */
      var mid = face.pts[0], i;
      var cx = 0, cy = 0, cz = 0;
      for (i = 0; i < face.pts.length; i++){
        cx += face.pts[i][0]; cy += face.pts[i][1]; cz += face.pts[i][2];
      }
      cx /= 4; cy /= 4; cz /= 4;
      var fc = toCam(cam, cx, cy, cz);
      var nf = face.n[0]*cam.fx + face.n[1]*cam.fy;
      var nr = face.n[0]*cam.rx + face.n[1]*cam.ry;
      var nz = face.n[2];
      if (nf*fc.f + nr*fc.r + nz*(fc.z - cam.eh) >= 0) return;   // back-facing
      fillPoly(ctx, cam, face.pts, shade(color, face.k));
    });
  }
  function vehicleHeights(v){
    if (v.kind === 'tram') return { body:[0.35*M, 3.30*M], cab:null };
    if (v.kind === 'bus')  return { body:[0.32*M, 2.85*M], cab:null };
    return { body:[0.22*M, 1.05*M], cab:[1.05*M, 1.48*M] };
  }
  function drawVehicle(ctx, cam, v, t){
    var H = vehicleHeights(v);
    drawBox(ctx, cam, v, H.body[0], H.body[1], v.color);
    if (H.cab) drawBox(ctx, cam, v, H.cab[0], H.cab[1], COL.glass, 0.62);
    if (v.kind === 'tram' || v.kind === 'bus'){
      /* a window band rather than a separate cabin box */
      drawBox(ctx, cam, v, H.body[1]*0.52, H.body[1]*0.82, COL.glass, 0.97);
    }

    /* lamps: only visible from the side that has them */
    var c = Math.cos(v.pos.h), s = Math.sin(v.pos.h);
    var toCamX = cam.ex - v.pos.x, toCamY = cam.ey - v.pos.y;
    var behind = (toCamX*c + toCamY*s) < 0;
    var lampZ = H.body[1]*0.62, hl = v.len/2, hw = v.wid/2;
    function lamp(fwd, lat, col, size){
      var x = v.pos.x + c*fwd - s*lat, y = v.pos.y + s*fwd + c*lat;
      var bb = billboard(cam, x, y, lampZ - size/2, lampZ + size/2);
      if (!bb || bb.h < 0.6) return;
      ctx.fillStyle = col;
      ctx.fillRect(bb.x - bb.h*0.7, bb.top, bb.h*1.4, bb.h);
    }
    var blink = (t*2.2) % 1 < 0.55;
    if (behind){
      var tail = v.brakeLight ? '#ff4436' : '#8f2f28';
      lamp(-hl, -hw*0.72, tail, 3.2);
      lamp(-hl,  hw*0.72, tail, 3.2);
      if (blink && v.indicator === 'left')  lamp(-hl, -hw*0.95, '#ffb02e', 3.4);
      if (blink && v.indicator === 'right') lamp(-hl,  hw*0.95, '#ffb02e', 3.4);
    } else {
      lamp(hl, -hw*0.72, '#fff3d0', 3.2);
      lamp(hl,  hw*0.72, '#fff3d0', 3.2);
      if (blink && v.indicator === 'left')  lamp(hl, -hw*0.95, '#ffb02e', 3.4);
      if (blink && v.indicator === 'right') lamp(hl,  hw*0.95, '#ffb02e', 3.4);
    }
    if (v.emergency){
      var f = (t*7) % 1 < 0.5;
      lamp(0, -hw*0.5, f ? '#5ab4ff' : '#1d4470', 4);
      lamp(0,  hw*0.5, f ? '#1d4470' : '#5ab4ff', 4);
    }
  }

  /* ---------- standing objects, depth sorted ---------- */
  function collectObjects(world, cam){
    var sc = world.junctionFor(world.player), L = sc.layout, out = [];
    var ox = sc.x || 0, oy = sc.y || 0;

    world.vehicles.forEach(function(v){
      if (v.done || v.isPlayer) return;
      var c = toCam(cam, v.pos.x, v.pos.y, 0);
      if (c.f < cam.near - v.len || c.f > FAR_CUT) return;
      out.push({ depth:c.f, kind:'veh', v:v });
    });

    world.peds.forEach(function(ped){
      if (ped.state === 'done') return;
      var pt = ped.point();
      var c = toCam(cam, pt.x, pt.y, 0);
      if (c.f < cam.near || c.f > FAR_CUT) return;
      out.push({ depth:c.f, kind:'ped', ped:ped, pt:pt });
    });

    /* road signs, on their posts */
    L.arms.forEach(function(arm){
      var type = L.type === 'roundabout' ? 'roundabout' : Rules.signOf(sc, arm);
      var o = Geo.ARM_VEC[arm], q = Geo.rot90cw(o);
      var base = L.type === 'roundabout' ? CFG.RING + CFG.BOX : CFG.BOX;
      var d = base + 46, lat = -(CFG.BOX + 26);
      var x = o.x*d + q.x*lat + ox, y = o.y*d + q.y*lat + oy;

      if (type !== 'none') push(type, x, y, 0);
      if (L.zone && arm === sc.player.from) push(L.zone, x + o.x*74, y + o.y*74, 0);
      if (sc.gruenpfeil && sc.gruenpfeil.indexOf(arm) >= 0) push('green_arrow', x, y, -0.55*M);

      function push(t, sx, sy, dz){
        var c = toCam(cam, sx, sy, 0);
        if (c.f < cam.near || c.f > FAR_CUT) return;
        out.push({ depth:c.f, kind:'sign', type:t, x:sx, y:sy, dz:dz||0 });
      }
    });
    if (L.busstop){
      var ob = Geo.ARM_VEC[L.busstop], qb = Geo.rot90cw(ob);
      var bx = ob.x*(CFG.BOX+430) + qb.x*(-(CFG.BOX+26)) + ox;
      var by = ob.y*(CFG.BOX+430) + qb.y*(-(CFG.BOX+26)) + oy;
      var cb = toCam(cam, bx, by, 0);
      if (cb.f >= cam.near && cb.f <= FAR_CUT)
        out.push({ depth:cb.f, kind:'sign', type:'bus_stop', x:bx, y:by, dz:0 });
    }

    /* traffic lights: one before the junction, one on the far side */
    if (sc.lights){
      L.arms.forEach(function(arm){
        var st = Rules.lightFor(sc, arm, world.t);
        if (!st) return;
        var o = Geo.ARM_VEC[arm], q = Geo.rot90cw(o);
        [[CFG.BOX + 26, -(CFG.BOX + 24)], [-(CFG.BOX + 30), -(CFG.BOX + 24)]].forEach(function(pos){
          var x = o.x*pos[0] + q.x*pos[1] + ox, y = o.y*pos[0] + q.y*pos[1] + oy;
          var c = toCam(cam, x, y, 0);
          if (c.f < cam.near || c.f > FAR_CUT) return;
          out.push({ depth:c.f, kind:'light', state:st, x:x, y:y });
        });
      });
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

    /* bonnet */
    var g = ctx.createLinearGradient(0, hood, 0, h);
    g.addColorStop(0, shade(col, 0.72));
    g.addColorStop(1, shade(col, 0.42));
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

    /* ground */
    ctx.fillStyle = COL.grass;
    ctx.fillRect(0, Math.max(0, horizon), w, h - Math.max(0, horizon));

    drawWorldGround(ctx, cam, world);

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
