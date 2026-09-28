'use strict';
/* ------------------------------------------------------------------
   render.js - top-down drawing of the world.
   ------------------------------------------------------------------ */

var Render = (function(){

  /* Defaults are the night palette; syncTheme() replaces them with
     whatever the stylesheet currently resolves to, so the road follows
     the viewer's light / dark theme like the rest of the page.        */
  var COL = {
    grass:   '#23291f',
    grass2:  '#283021',
    road:    '#2f2e2b',
    kerb:    '#4c4941',
    paint:   '#e9e5d9',
    paintDim:'#a8a499',
    island:  '#2b3624',
    rail:    '#7e7b72',
    shadow:  'rgba(0,0,0,.45)',
    bad:     '#ff6a5e',
    route:   'rgba(107,178,245,0.34)',
    routeArrow:'rgba(107,178,245,0.62)'
  };

  var VARS = {
    grass:'--grass', grass2:'--grass-2', road:'--road', kerb:'--kerb',
    paint:'--paint', paintDim:'--paint-dim', island:'--island',
    rail:'--rail', shadow:'--shadow', bad:'--bad'
  };
  function hexToRgba(hex, a){
    var h = (hex||'').trim().replace('#','');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    if (h.length !== 6) return null;
    var n = parseInt(h,16);
    if (isNaN(n)) return null;
    return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+a+')';
  }
  /* read the palette back out of the stylesheet */
  function syncTheme(){
    if (typeof document === 'undefined' || !document.documentElement) return;
    if (typeof getComputedStyle !== 'function') return;
    var cs = getComputedStyle(document.documentElement);
    for (var k in VARS){
      var v = cs.getPropertyValue(VARS[k]);
      if (v && v.trim()) COL[k] = v.trim();
    }
    var info = (cs.getPropertyValue('--info')||'').trim();
    COL.route = hexToRgba(info, 0.34) || COL.route;
    COL.routeArrow = hexToRgba(info, 0.62) || COL.routeArrow;
  }

  function armAngle(arm){
    var o = Geo.ARM_VEC[arm];
    return Math.atan2(o.y, o.x);
  }

  /* ---------- camera ---------- */
  function camera(ctx, w, h, world, preview){
    /* Every drawing function below builds its geometry as if the current
       junction sat at the origin - true for a lesson (there is only ever
       one), not for the open world, where junctions sit at their own real
       map coordinates. Recentring the whole transform on the live
       junction here means nothing below needs to know the difference. */
    var j = world.junctionFor(world.player);
    var ox = j.x || 0, oy = j.y || 0;
    var span = j.layout.type === 'roundabout' ? 1180 : 950;
    if (preview) span = j.layout.type === 'roundabout' ? 900 : 680;
    var scale = Math.min(w, h) / span;
    var p = world.player.pos;
    var lx = p.x - ox, ly = p.y - oy;
    var cam = { x:0, y:0 };
    if (!preview){
      /* follow the car when far out, settle onto the junction when close,
         but never so tightly that the junction appears too late to read */
      var k = Geo.clamp((Math.hypot(lx, ly) - 90)/460, 0, 1) * 0.55;
      cam = { x:lx*k, y:ly*k };
    }
    ctx.setTransform(1,0,0,1,0,0);
    ctx.translate(w/2, h/2);
    ctx.scale(scale, scale);
    ctx.translate(-(cam.x + ox), -(cam.y + oy));
    return scale;
  }

  /* ---------- the town, seen from above ---------- */
  /* Everything here is in real map coordinates. The single-junction
     drawing below works as if its junction sat at the origin, so the
     frame translates onto each junction before calling it. */
  function drawCity(ctx, world){
    var map = world.map, view = CityView.build(map);
    var night = isNight();
    ctx.fillStyle = night ? '#34322d' : '#b9b3a6';
    var b0 = view.colX(-2), b1 = view.colX(map.cols + 1), c0 = view.rowY(-2), c1 = view.rowY(map.rows + 1);
    ctx.fillRect(b0, c0, b1 - b0, c1 - c0);
    ctx.fillStyle = night ? '#1f271b' : '#7d9a5f';
    view.blocks.forEach(function(b){ ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); });

    var bed = CityView.railBed(map);
    if (bed){
      ctx.fillStyle = night ? '#35302a' : '#8a8173';
      ctx.fillRect(bed.x0, bed.y0, bed.x1 - bed.x0, bed.y1 - bed.y0);
    }
    var reach = City.SPACING/2 + 2;
    map.nodes.forEach(function(n){
      ctx.save(); ctx.translate(n.x, n.y);
      drawJunctionGround(ctx, n, reach);
      ctx.restore();
    });
    ctx.fillStyle = night ? '#4a2a22' : '#b86a58';
    CityView.bikePaths(map).forEach(function(bp){
      var h = bp.half;
      ctx.fillRect(Math.min(bp.a.x, bp.b.x) - (bp.col ? h : 0), Math.min(bp.a.y, bp.b.y) - (bp.col ? 0 : h),
                   Math.abs(bp.b.x - bp.a.x) + (bp.col ? 2*h : 0), Math.abs(bp.b.y - bp.a.y) + (bp.col ? 0 : 2*h));
    });
    if (bed){
      ctx.strokeStyle = COL.rail; ctx.lineWidth = 2.5;
      bed.tracks.forEach(function(tx){
        [-9, 9].forEach(function(o){
          ctx.beginPath(); ctx.moveTo(tx + o, bed.y0); ctx.lineTo(tx + o, bed.y1); ctx.stroke();
        });
      });
    }
    map.nodes.forEach(function(n){
      ctx.save(); ctx.translate(n.x, n.y);
      drawJunctionMarkings(ctx, n, reach);
      ctx.restore();
    });
  }
  /* rooftops and tree crowns go over the ground, under the traffic */
  function drawCityTops(ctx, world){
    var view = CityView.build(world.map), night = isNight();
    view.houses.forEach(function(h){
      ctx.fillStyle = COL.shadow;
      ctx.fillRect(h.x0 + 10, h.y0 + 12, h.x1 - h.x0, h.y1 - h.y0);
      ctx.fillStyle = h.roof || h.color;
      if (night) ctx.globalAlpha = 0.75;
      ctx.fillRect(h.x0, h.y0, h.x1 - h.x0, h.y1 - h.y0);
      ctx.globalAlpha = 1;
      /* the ridge line of a pitched roof */
      if (h.roof){
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2;
        ctx.beginPath();
        if (h.front === 'N' || h.front === 'S'){
          var ym = (h.y0 + h.y1)/2; ctx.moveTo(h.x0, ym); ctx.lineTo(h.x1, ym);
        } else {
          var xm = (h.x0 + h.x1)/2; ctx.moveTo(xm, h.y0); ctx.lineTo(xm, h.y1);
        }
        ctx.stroke();
      }
    });
    view.trees.forEach(function(t){
      ctx.fillStyle = night ? 'rgba(36,54,31,0.9)' : 'rgba(86,122,69,0.92)';
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r*0.9, 0, Math.PI*2); ctx.fill();
    });
  }
  function isNight(){
    var h = (COL.road || '').replace('#','');
    var n = parseInt(h.length === 3 ? h[0]+h[0]+h[1]+h[1]+h[2]+h[2] : h, 16);
    return isNaN(n) ? true : ((n>>16)&255) < 90;
  }

  /* ---------- ground ---------- */
  function drawGround(ctx, world){
    var sc = world.junctionFor(world.player), i;
    ctx.fillStyle = COL.grass;
    ctx.fillRect(-CFG.FAR*1.4, -CFG.FAR*1.4, CFG.FAR*2.8, CFG.FAR*2.8);

    /* a little texture so motion is visible */
    ctx.fillStyle = COL.grass2;
    for (i=-8;i<=8;i++) for (var j=-8;j<=8;j++){
      if ((i+j)%2) continue;
      ctx.fillRect(i*130-60, j*130-60, 66, 66);
    }
    drawJunctionGround(ctx, sc, CFG.FAR);
  }
  function drawJunctionGround(ctx, sc, reach){
    var L = sc.layout;
    var ring = L.type === 'roundabout';
    var inner = ring ? CFG.RING + CFG.BOX : 0;

    /* carriageways */
    L.arms.forEach(function(arm){
      ctx.save();
      ctx.rotate(armAngle(arm));
      ctx.fillStyle = COL.kerb;
      ctx.fillRect(inner ? inner-6 : 0, -CFG.BOX-7, reach, CFG.BOX*2+14);
      ctx.fillStyle = COL.road;
      ctx.fillRect(inner ? inner-6 : 0, -CFG.BOX, reach, CFG.BOX*2);
      ctx.restore();
    });

    if (ring){
      ctx.beginPath();
      ctx.arc(0,0,CFG.RING+CFG.BOX+7,0,Math.PI*2);
      ctx.fillStyle = COL.kerb; ctx.fill();
      ctx.beginPath();
      ctx.arc(0,0,CFG.RING+CFG.BOX,0,Math.PI*2);
      ctx.fillStyle = COL.road; ctx.fill();
      ctx.beginPath();
      ctx.arc(0,0,CFG.RING-CFG.BOX,0,Math.PI*2);
      ctx.fillStyle = COL.island; ctx.fill();
      ctx.beginPath();
      ctx.arc(0,0,CFG.RING-CFG.BOX,0,Math.PI*2);
      ctx.strokeStyle = COL.kerb; ctx.lineWidth = 7; ctx.stroke();
      /* a few bushes on the island */
      ctx.fillStyle = COL.kerb;
      for (var b=0;b<7;b++){
        var a = b/7*Math.PI*2, r = (CFG.RING-CFG.BOX)*0.55;
        ctx.beginPath();
        ctx.arc(Math.cos(a)*r, Math.sin(a)*r, 16, 0, Math.PI*2);
        ctx.fill();
      }
    } else {
      /* junction box on top of the arms */
      ctx.fillStyle = COL.road;
      ctx.fillRect(-CFG.BOX, -CFG.BOX, CFG.BOX*2, CFG.BOX*2);
    }

    /* home-zone paving on one arm */
    if (L.playzone){
      ctx.save();
      ctx.rotate(armAngle(L.playzone));
      ctx.fillStyle = COL.kerb;
      ctx.fillRect(CFG.BOX+40, -CFG.BOX, CFG.FAR, CFG.BOX*2);
      ctx.strokeStyle = COL.road; ctx.lineWidth = 2;
      for (var x=CFG.BOX+60; x<CFG.FAR; x+=40){
        ctx.beginPath(); ctx.moveTo(x, -CFG.BOX); ctx.lineTo(x, CFG.BOX); ctx.stroke();
      }
      ctx.restore();
    }

    /* bus lay-by */
    if (L.busstop){
      ctx.save();
      ctx.rotate(armAngle(L.busstop));
      ctx.fillStyle = COL.road;
      ctx.fillRect(CFG.BOX+330, -CFG.BOX-46, 250, 46);
      ctx.strokeStyle = COL.paintDim; ctx.lineWidth = 3;
      ctx.setLineDash([14,12]);
      ctx.beginPath();
      ctx.moveTo(CFG.BOX+330, -CFG.BOX); ctx.lineTo(CFG.BOX+580, -CFG.BOX);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    }
  }

  /* ---------- road markings ---------- */
  function drawMarkings(ctx, world){
    drawJunctionMarkings(ctx, world.junctionFor(world.player), CFG.FAR);
  }
  function drawJunctionMarkings(ctx, sc, reach){
    var L = sc.layout;
    var ring = L.type === 'roundabout';
    var inner = ring ? CFG.RING + CFG.BOX : CFG.BOX;

    L.arms.forEach(function(arm){
      ctx.save();
      ctx.rotate(armAngle(arm));

      /* centre line (Leitlinie) */
      ctx.strokeStyle = COL.paintDim; ctx.lineWidth = 4;
      ctx.setLineDash([26, 22]);
      ctx.beginPath();
      ctx.moveTo(inner + 14, 0); ctx.lineTo(reach, 0);
      ctx.stroke();
      ctx.setLineDash([]);

      /* give-way / stop line on the approach half (local y in [-BOX,0]);
         in town it sits where a car's front really stops, and beside
         the U-Bahn in front of the tracks */
      var sign  = Rules.signOf(sc, arm);
      var lit   = sc.lights && sc.lights.groups[arm];
      var lineX = ring ? CFG.RING + CFG.BOX + 8
                : (sc.rail && arm === sc.rail.side) ? sc.rail.carHold - 2
                : sc.x !== undefined ? City.HOLD - 3 : CFG.BOX + 8;
      var hasCross = L.crossings && L.crossings.indexOf(arm) >= 0;
      var town = sc.x !== undefined;
      if (hasCross && !town) lineX = Math.max(lineX, Sim.CROSS_MID + Sim.CROSS_HALF + 12);
      /* in town the zebra sits just outside the box, inside the line */
      if (hasCross && town){
        ctx.fillStyle = COL.paint;
        for (var zy = -CFG.BOX + 4; zy < CFG.BOX - 3; zy += 14) ctx.fillRect(City.CW.in, zy, City.CW.out - City.CW.in, 7);
        hasCross = false;
      }

      if (lit || sign === 'stop'){
        ctx.fillStyle = COL.paint;
        ctx.fillRect(lineX, -CFG.BOX, 7, CFG.BOX);
      } else if (sign === 'yield' || sign === 'ringentry' || sign === 'exit'){
        /* Wartelinie: broken line */
        ctx.fillStyle = COL.paint;
        for (var y=-CFG.BOX+3; y<-2; y+=17) ctx.fillRect(lineX, y, 7, 10);
      }

      /* zebra crossing */
      if (hasCross){
        ctx.fillStyle = COL.paint;
        for (var yy=-CFG.BOX+6; yy<CFG.BOX-4; yy+=17){
          ctx.fillRect(Sim.CROSS_MID - Sim.CROSS_HALF, yy, Sim.CROSS_HALF*2, 10);
        }
      }
      ctx.restore();
    });

    /* rails */
    if (L.rails){
      ctx.save();
      ctx.strokeStyle = COL.rail; ctx.lineWidth = 3;
      var a = Geo.ARM_VEC[L.rails[0]], p = Geo.rot90cw(a);
      [-11, 11].forEach(function(off){
        ctx.beginPath();
        ctx.moveTo(a.x*CFG.FAR + p.x*off, a.y*CFG.FAR + p.y*off);
        ctx.lineTo(-a.x*CFG.FAR + p.x*off, -a.y*CFG.FAR + p.y*off);
        ctx.stroke();
      });
      ctx.restore();
    }
  }

  /* ---------- the route the player has to take ---------- */
  function drawRoute(ctx, world){
    var p = world.player, path = p.path;
    ctx.save();
    ctx.strokeStyle = COL.route;
    ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.setLineDash([22, 20]);
    ctx.beginPath();
    var started = false;
    for (var s = p.s; s <= Math.min(path.length, p.s + 900); s += 12){
      var q = path.at(s);
      if (!started){ ctx.moveTo(q.x, q.y); started = true; } else ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    /* arrow at the exit */
    var e = path.at(Math.min(path.length, p.junctionS + 210));
    ctx.translate(e.x, e.y); ctx.rotate(e.h);
    ctx.fillStyle = COL.routeArrow;
    ctx.beginPath();
    ctx.moveTo(20,0); ctx.lineTo(-10,-14); ctx.lineTo(-10,14);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* ---------- signs at the roadside ---------- */
  function drawSigns(ctx, world, scale){
    var sc = world.junctionFor(world.player), L = sc.layout;
    L.arms.forEach(function(arm){
      var type = L.type === 'roundabout' ? 'roundabout' : Rules.signOf(sc, arm);

      /* signs stand on the right-hand kerb of the approaching driver */
      var o = Geo.ARM_VEC[arm], r = Geo.rot90cw(o);
      var base = L.type === 'roundabout' ? CFG.RING + CFG.BOX : CFG.BOX;
      var d = base + 46;
      var off = -(CFG.BOX + 34);
      var x = o.x*d + r.x*off, y = o.y*d + r.y*off;

      /* an unsigned arm simply has no post - that IS the information */
      if (type !== 'none') drawSignPost(ctx, type, x, y, 54);

      if (L.zone && arm === sc.player.from)
        drawSignPost(ctx, L.zone, x + 74*o.x, y + 74*o.y, 54);
      if (sc.gruenpfeil && sc.gruenpfeil.indexOf(arm) >= 0)
        drawSignPost(ctx, 'green_arrow', x, y - 60, 40);
      if (L.bend && arm === sc.player.from)
        drawBendPlate(ctx, x, y + 40, L.bend);
    });

    if (L.busstop){
      var o2 = Geo.ARM_VEC[L.busstop], r2 = Geo.rot90cw(o2);
      var bx = o2.x*(CFG.BOX+430) + r2.x*(-(CFG.BOX+34));
      var by = o2.y*(CFG.BOX+430) + r2.y*(-(CFG.BOX+34));
      drawSignPost(ctx, 'bus_stop', bx, by, 48);
    }
    if (L.playzone){
      var o3 = Geo.ARM_VEC[L.playzone], r3 = Geo.rot90cw(o3);
      drawSignPost(ctx, 'play_street',
        o3.x*(CFG.BOX+70) + r3.x*(CFG.BOX+34),
        o3.y*(CFG.BOX+70) + r3.y*(CFG.BOX+34), 50);
    }
  }

  function drawSignPost(ctx, type, x, y, size){
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = COL.shadow;
    ctx.beginPath(); ctx.ellipse(3, 8, size*0.5, size*0.22, 0, 0, Math.PI*2); ctx.fill();
    var box = size*1.5;
    ctx.drawImage(Signs.bitmap(type, Math.round(box*2)), -box/2, -box/2, box, box);
    ctx.restore();
  }

  /* the "priority road bends" plate under sign 306 */
  function drawBendPlate(ctx, x, y, bend){
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-24, -15, 48, 30);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.strokeRect(-24, -15, 48, 30);
    /* thick line = course of the priority road, thin = the side roads */
    ctx.strokeStyle = '#111'; ctx.lineWidth = 5; ctx.lineCap = 'butt';
    var a = Geo.ARM_VEC[bend[0]], b = Geo.ARM_VEC[bend[1]];
    ctx.beginPath();
    ctx.moveTo(a.x*16, a.y*16); ctx.lineTo(0,0); ctx.lineTo(b.x*16, b.y*16);
    ctx.stroke();
    ctx.lineWidth = 2;
    var c = Geo.ARM_VEC[Geo.opposite(bend[0])], d = Geo.ARM_VEC[Geo.opposite(bend[1])];
    ctx.beginPath();
    ctx.moveTo(0,0); ctx.lineTo(c.x*15, c.y*15);
    ctx.moveTo(0,0); ctx.lineTo(d.x*15, d.y*15);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- traffic lights ---------- */
  function drawLights(ctx, world){
    var sc = world.junctionFor(world.player);
    if (!sc.lights) return;
    sc.layout.arms.forEach(function(arm){
      var st = Rules.lightFor(sc, arm, world.t);
      if (!st) return;
      var o = Geo.ARM_VEC[arm], r = Geo.rot90cw(o);
      /* beside the U-Bahn the signal stands before the tracks */
      var d = (sc.rail && arm === sc.rail.side) ? sc.rail.carHold + 8 : CFG.BOX + 30;
      var x = o.x*d + r.x*(-(CFG.BOX+30));
      var y = o.y*d + r.y*(-(CFG.BOX+30));
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = '#15181c';
      ctx.beginPath();
      ctx.moveTo(-11,-30); ctx.lineTo(11,-30); ctx.lineTo(11,30); ctx.lineTo(-11,30);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#2a2f36'; ctx.lineWidth = 2; ctx.stroke();
      var on = { red:'#ff3b30', yellow:'#ffcc00', green:'#2ecc5b' };
      [['red',-19],['yellow',0],['green',19]].forEach(function(l){
        var lit = (st === l[0]) || (st === 'redyellow' && (l[0]==='red'||l[0]==='yellow'));
        ctx.beginPath(); ctx.arc(0, l[1], 7.5, 0, Math.PI*2);
        ctx.fillStyle = lit ? on[l[0]] : '#23272d';
        ctx.fill();
        if (lit){
          ctx.shadowColor = on[l[0]]; ctx.shadowBlur = 16;
          ctx.fill(); ctx.shadowBlur = 0;
        }
      });
      ctx.restore();
    });
  }

  /* ---------- pedestrians ---------- */
  function drawPeds(ctx, world){
    world.peds.forEach(function(ped){
      if (ped.state === 'done') return;
      var p = ped.point();
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = COL.shadow;
      ctx.beginPath(); ctx.ellipse(2,3,10,7,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = ped.kid ? '#ffd166' : '#f2e8d5';
      ctx.beginPath(); ctx.ellipse(0,0, ped.kid?7:9, ped.kid?5:6, 0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = ped.kid ? '#e0863a' : '#5b6b8a';
      ctx.beginPath(); ctx.arc(0,0, ped.kid?4.5:5.5, 0, Math.PI*2); ctx.fill();
      if (ped.state === 'waiting'){
        ctx.strokeStyle = 'rgba(255,220,120,0.85)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0,0,15,0,Math.PI*2); ctx.stroke();
      }
      ctx.restore();
    });
  }

  /* ---------- vehicles ---------- */
  function roundRect(ctx,x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
  }

  function drawVehicle(ctx, v, t){
    var L = v.len, W = v.wid;
    ctx.save();
    ctx.translate(v.pos.x, v.pos.y);
    ctx.rotate(v.pos.h);

    ctx.fillStyle = COL.shadow;
    roundRect(ctx, -L/2+3, -W/2+4, L, W, 7); ctx.fill();

    if (v.kind === 'bike'){
      ctx.fillStyle = '#1b1b1b'; ctx.fillRect(-L/2, -1.5, L, 3);
      ctx.fillStyle = v.color || '#2b5d8a';
      ctx.beginPath(); ctx.ellipse(-2, 0, 5, 4.5, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#e8e8e2';
      ctx.beginPath(); ctx.arc(1, 0, 2.6, 0, Math.PI*2); ctx.fill();
      ctx.restore();
      return;
    }
    if (v.kind === 'tram'){
      ctx.fillStyle = v.color || '#d8dde3';
      roundRect(ctx, -L/2, -W/2, L, W, 8); ctx.fill();
      ctx.fillStyle = '#c8322a';
      ctx.fillRect(-L/2, -W/2, L, 5);
      ctx.fillStyle = '#2c3540';
      for (var i=0;i<5;i++) ctx.fillRect(-L/2+14+i*(L-30)/5, -W/2+6, (L-30)/5-8, W-12);
    } else {
      ctx.fillStyle = v.color;
      roundRect(ctx, -L/2, -W/2, L, W, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2; ctx.stroke();
      /* windows */
      ctx.fillStyle = 'rgba(20,28,38,0.72)';
      roundRect(ctx, L*0.06, -W/2+4, L*0.24, W-8, 3); ctx.fill();
      roundRect(ctx, -L*0.30, -W/2+4, L*0.26, W-8, 3); ctx.fill();
      if (v.kind === 'bus'){
        ctx.fillStyle = 'rgba(20,28,38,0.6)';
        ctx.fillRect(-L*0.05, -W/2+4, L*0.08, W-8);
      }
    }
    /* head / tail lights */
    ctx.fillStyle = v.brakeLight ? '#ff5a4a' : '#8a3b34';
    ctx.fillRect(-L/2-1, -W/2+3, 4, 6);
    ctx.fillRect(-L/2-1,  W/2-9, 4, 6);
    ctx.fillStyle = '#ffeec2';
    ctx.fillRect(L/2-3, -W/2+3, 4, 6);
    ctx.fillRect(L/2-3,  W/2-9, 4, 6);

    /* indicators */
    var blink = (t*2.2) % 1 < 0.55;
    if (v.indicator === 'left' && blink){
      ctx.fillStyle = '#ffb02e';
      ctx.fillRect(L/2-6, -W/2-2, 7, 6);
      ctx.fillRect(-L/2-1, -W/2-2, 7, 6);
    }
    if (v.indicator === 'right' && blink){
      ctx.fillStyle = '#ffb02e';
      ctx.fillRect(L/2-6, W/2-4, 7, 6);
      ctx.fillRect(-L/2-1, W/2-4, 7, 6);
    }
    /* blue lights */
    if (v.emergency){
      var f = (t*7) % 1 < 0.5;
      ctx.fillStyle = f ? '#4da3ff' : '#1a3f6b';
      ctx.fillRect(-6, -W/2-3, 12, 5);
      ctx.fillStyle = f ? '#1a3f6b' : '#4da3ff';
      ctx.fillRect(-6, W/2-2, 12, 5);
    }
    ctx.restore();
  }

  /* ---------- main entry ---------- */
  function frame(ctx, w, h, world, preview){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,w,h);
    var scale = camera(ctx, w, h, world, preview);
    /* the junction's own drawing is built around the origin: move onto
       wherever it really is (a lesson's is at the origin anyway) */
    var j = world.junctionFor(world.player);
    if (world.map) drawCity(ctx, world);
    ctx.save(); ctx.translate(j.x || 0, j.y || 0);
    if (!world.map){ drawGround(ctx, world); drawMarkings(ctx, world); }
    ctx.restore();
    if (world.map) drawCityTops(ctx, world);
    drawRoute(ctx, world);
    ctx.save(); ctx.translate(j.x || 0, j.y || 0);
    drawSigns(ctx, world, scale);
    ctx.restore();
    drawPeds(ctx, world);             // a pedestrian knows where it stands
    world.vehicles.forEach(function(v){ if (!v.done) drawVehicle(ctx, v, world.t); });
    ctx.save(); ctx.translate(j.x || 0, j.y || 0);
    drawLights(ctx, world);
    ctx.restore();

    if (world.crashPoint){
      var c = world.crashPoint, r = 26 + Math.sin(world.endTimer*9)*6;
      ctx.strokeStyle = COL.bad; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI*2); ctx.stroke();
    }
    ctx.setTransform(1,0,0,1,0,0);
  }

  return { frame:frame, COL:COL, syncTheme:syncTheme };
})();
