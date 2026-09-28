'use strict';
/* ------------------------------------------------------------------
   signs.js - vector drawings of the German traffic signs used in game.
   Every sign is drawn centred on (x,y) with a bounding size s.
   ------------------------------------------------------------------ */

var Signs = (function(){

  function poly(ctx, pts, fill, stroke, lw){
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i=1;i<pts.length;i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill){ ctx.fillStyle = fill; ctx.fill(); }
    if (stroke){ ctx.strokeStyle = stroke; ctx.lineWidth = lw||2; ctx.stroke(); }
  }
  function circle(ctx,x,y,r,fill,stroke,lw){
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
    if (fill){ ctx.fillStyle=fill; ctx.fill(); }
    if (stroke){ ctx.strokeStyle=stroke; ctx.lineWidth=lw||2; ctx.stroke(); }
  }
  function roundRect(ctx,x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
  }

  /* a little walking person, used on crossing / play-street signs */
  function pedGlyph(ctx,x,y,h,col){
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.lineWidth = Math.max(1, h*0.11);
    ctx.lineCap = 'round';
    circle(ctx, x, y-h*0.36, h*0.13, col, null);
    ctx.beginPath();
    ctx.moveTo(x, y-h*0.22); ctx.lineTo(x, y+h*0.04);       // torso
    ctx.moveTo(x, y-h*0.16); ctx.lineTo(x+h*0.18, y-h*0.02); // arm
    ctx.moveTo(x, y-h*0.16); ctx.lineTo(x-h*0.14, y+h*0.02); // arm
    ctx.moveTo(x, y+h*0.04); ctx.lineTo(x+h*0.16, y+h*0.34); // leg
    ctx.moveTo(x, y+h*0.04); ctx.lineTo(x-h*0.13, y+h*0.32); // leg
    ctx.stroke();
    ctx.restore();
  }

  function arrowCurve(ctx, cx, cy, r, a0, a1, col, lw, head){
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap='round';
    ctx.beginPath(); ctx.arc(cx,cy,r,a0,a1); ctx.stroke();
    if (head){
      var hx = cx + Math.cos(a1)*r, hy = cy + Math.sin(a1)*r;
      var tx = -Math.sin(a1), ty = Math.cos(a1);
      var nx = Math.cos(a1),  ny = Math.sin(a1);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(hx + tx*lw*1.9, hy + ty*lw*1.9);
      ctx.lineTo(hx - nx*lw*1.5 + tx*0 - tx*0, hy - ny*lw*1.5);
      ctx.lineTo(hx + nx*lw*1.5, hy + ny*lw*1.5);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------- */
  var draw = {

    /* Zeichen 205 - Vorfahrt gewaehren */
    yield: function(ctx,x,y,s){
      var h = s*0.86;
      poly(ctx, [[x, y+h*0.62],[x-s*0.5, y-h*0.42],[x+s*0.5, y-h*0.42]], '#ffffff', '#d02020', s*0.13);
    },

    /* Zeichen 206 - Stop */
    stop: function(ctx,x,y,s){
      var r = s*0.5, pts=[];
      for (var i=0;i<8;i++){
        var a = Math.PI/8 + i*Math.PI/4;
        pts.push([x+Math.cos(a)*r, y+Math.sin(a)*r]);
      }
      poly(ctx, pts, '#d02020', '#ffffff', s*0.06);
      ctx.fillStyle='#fff';
      ctx.font = 'bold '+(s*0.32)+'px Arial, sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('STOP', x, y+s*0.02);
    },

    /* Zeichen 306 - Vorfahrtstrasse */
    priority: function(ctx,x,y,s){
      var r = s*0.5;
      poly(ctx, [[x,y-r],[x+r,y],[x,y+r],[x-r,y]], '#ffffff', '#111', s*0.05);
      var r2 = r*0.66;
      poly(ctx, [[x,y-r2],[x+r2,y],[x,y+r2],[x-r2,y]], '#ffcc00', null);
    },

    /* Zeichen 301 - Vorfahrt (an der naechsten Kreuzung) */
    priority_next: function(ctx,x,y,s){
      var h=s*0.86;
      poly(ctx, [[x, y-h*0.5],[x-s*0.5, y+h*0.42],[x+s*0.5, y+h*0.42]], '#ffffff', '#111', s*0.05);
      ctx.strokeStyle='#111'; ctx.lineWidth=s*0.09; ctx.lineCap='butt';
      ctx.beginPath();
      ctx.moveTo(x-s*0.26,y+h*0.14); ctx.lineTo(x+s*0.26,y+h*0.14);
      ctx.moveTo(x,y+h*0.30); ctx.lineTo(x,y-h*0.10);
      ctx.stroke();
    },

    /* Zeichen 350 - Fussgaengerueberweg */
    crossing: function(ctx,x,y,s){
      var r=s*0.5;
      poly(ctx, [[x-r,y-r],[x+r,y-r],[x+r,y+r],[x-r,y+r]], '#1a4fa0', '#fff', s*0.05);
      poly(ctx, [[x-r*0.72,y+r*0.72],[x+r*0.5,y-r*0.6],[x+r*0.72,y+r*0.72]], '#fff', null);
      pedGlyph(ctx, x-r*0.1, y-r*0.04, s*0.62, '#1a4fa0');
      ctx.fillStyle='#fff';
      ctx.fillRect(x-r*0.72, y+r*0.5, r*1.44, r*0.2);
    },

    /* Zeichen 215 - Kreisverkehr */
    roundabout: function(ctx,x,y,s){
      var r=s*0.5;
      circle(ctx,x,y,r,'#1a4fa0','#fff',s*0.05);
      for (var i=0;i<3;i++){
        var a0 = -Math.PI/2 + i*(Math.PI*2/3) + 0.35;
        var a1 = a0 + 1.25;
        arrowCurve(ctx, x, y, r*0.52, a0, a1, '#fff', s*0.085, true);
      }
    },

    /* Zeichen 274.1 - Zone 30 */
    zone30: function(ctx,x,y,s){
      var r=s*0.5;
      poly(ctx, [[x-r,y-r*0.9],[x+r,y-r*0.9],[x+r,y+r*0.9],[x-r,y+r*0.9]], '#fff', '#111', s*0.045);
      circle(ctx,x,y-r*0.06,r*0.46,'#fff','#d02020',s*0.09);
      ctx.fillStyle='#111';
      ctx.font='bold '+(s*0.36)+'px Arial, sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('30', x, y-r*0.04);
      ctx.font='bold '+(s*0.17)+'px Arial, sans-serif';
      ctx.fillText('ZONE', x, y+r*0.62);
    },

    /* Zeichen 274 - zulaessige Hoechstgeschwindigkeit */
    limit50: function(ctx,x,y,s){
      circle(ctx,x,y,s*0.5,'#fff','#d02020',s*0.11);
      ctx.fillStyle='#111';
      ctx.font='bold '+(s*0.44)+'px Arial, sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('50', x, y+s*0.02);
    },

    /* Zeichen 325.1 - verkehrsberuhigter Bereich (Spielstrasse) */
    play_street: function(ctx,x,y,s){
      var r=s*0.5;
      poly(ctx, [[x-r,y-r],[x+r,y-r],[x+r,y+r],[x-r,y+r]], '#1a4fa0', '#fff', s*0.05);
      ctx.fillStyle='#fff';
      ctx.fillRect(x-r*0.8, y+r*0.42, r*1.6, r*0.16);
      pedGlyph(ctx, x+r*0.28, y+r*0.02, s*0.52, '#fff');
      pedGlyph(ctx, x-r*0.34, y+r*0.06, s*0.38, '#fff');
      /* small car silhouette */
      ctx.fillStyle='#fff';
      roundRect(ctx, x-r*0.78, y-r*0.62, r*0.72, r*0.34, r*0.08); ctx.fill();
    },

    /* Zeichen 720 - Gruenpfeil */
    green_arrow: function(ctx,x,y,s){
      var r=s*0.5;
      poly(ctx, [[x-r,y-r],[x+r,y-r],[x+r,y+r],[x-r,y+r]], '#111', '#333', s*0.04);
      ctx.save();
      ctx.fillStyle='#25c05a';
      ctx.translate(x,y);
      ctx.beginPath();
      ctx.moveTo(-r*0.55,-r*0.5); ctx.lineTo(-r*0.15,-r*0.5);
      ctx.lineTo(-r*0.15, r*0.02); ctx.lineTo(r*0.2, r*0.02);
      ctx.lineTo(r*0.2, -r*0.28); ctx.lineTo(r*0.68, r*0.16);
      ctx.lineTo(r*0.2, r*0.6);  ctx.lineTo(r*0.2, r*0.34);
      ctx.lineTo(-r*0.55, r*0.34);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    },

    /* Andreaskreuz - Schienenverkehr hat Vorrang */
    tram: function(ctx,x,y,s){
      var r=s*0.5;
      ctx.save();
      ctx.strokeStyle='#d02020'; ctx.lineWidth=s*0.15; ctx.lineCap='round';
      ctx.beginPath();
      ctx.moveTo(x-r*0.9,y-r*0.55); ctx.lineTo(x+r*0.9,y+r*0.55);
      ctx.moveTo(x-r*0.9,y+r*0.55); ctx.lineTo(x+r*0.9,y-r*0.55);
      ctx.stroke();
      ctx.restore();
    },

    /* Bushaltestelle (Zeichen 224) */
    bus_stop: function(ctx,x,y,s){
      var r=s*0.5;
      circle(ctx,x,y,r,'#ffcc00','#111',s*0.05);
      ctx.fillStyle='#111';
      ctx.fillRect(x-r*0.42, y-r*0.42, r*0.84, r*0.62);
      ctx.fillStyle='#ffcc00';
      ctx.fillRect(x-r*0.32, y-r*0.32, r*0.64, r*0.24);
      ctx.fillStyle='#111';
      circle(ctx, x-r*0.24, y+r*0.26, r*0.11, '#111', null);
      circle(ctx, x+r*0.24, y+r*0.26, r*0.11, '#111', null);
    },

    /* "no sign here" placeholder for rechts-vor-links junctions */
    none: function(ctx,x,y,s){
      circle(ctx,x,y,s*0.46,'rgba(255,255,255,0.06)','#6b7684',s*0.05);
      ctx.strokeStyle='#6b7684'; ctx.lineWidth=s*0.07; ctx.lineCap='round';
      ctx.beginPath();
      ctx.moveTo(x-s*0.16,y-s*0.16); ctx.lineTo(x+s*0.16,y+s*0.16);
      ctx.stroke();
    },

    ringentry: function(ctx,x,y,s){ draw.yield(ctx,x,y,s); },
    ring:      function(ctx,x,y,s){ draw.priority(ctx,x,y,s); },
    exit:      function(ctx,x,y,s){ draw.play_street(ctx,x,y,s); }
  };

  /* label shown under a sign in the briefing panel */
  var LABEL = {
    yield:        ['Vorfahrt gewaehren', 'Give way (Z 205)'],
    stop:         ['Stop', 'Full stop required (Z 206)'],
    priority:     ['Vorfahrtstrasse', 'Priority road (Z 306)'],
    priority_next:['Vorfahrt', 'Priority at next junction (Z 301)'],
    crossing:     ['Fussgaengerueberweg', 'Zebra crossing (Z 350)'],
    roundabout:   ['Kreisverkehr', 'Roundabout (Z 215)'],
    zone30:       ['Zone 30', 'Zone limit 30 km/h'],
    limit50:      ['Tempo 50', 'Speed limit 50 km/h'],
    play_street:  ['Verkehrsberuhigter Bereich', 'Home zone - walking pace'],
    green_arrow:  ['Gruenpfeil', 'Right on red after a full stop (Z 720)'],
    tram:         ['Andreaskreuz', 'Rail vehicles have priority'],
    bus_stop:     ['Haltestelle', 'Bus stop (Z 224)'],
    none:         ['Kein Schild', 'No sign - rechts vor links applies'],
    ringentry:    ['Vorfahrt gewaehren', 'Give way to the circle'],
    exit:         ['Ausfahrt', 'Leaving a home zone - give way to all']
  };

  function render(ctx, type, x, y, s){
    var f = draw[type];
    if (f) f(ctx, x, y, s);
  }

  /* Build a small <canvas> element showing a sign - used by the UI panels */
  function chip(type, size){
    size = size || 46;
    var c = document.createElement('canvas');
    var dpr = window.devicePixelRatio || 1;
    c.width = size*dpr; c.height = size*dpr;
    c.style.width = size+'px'; c.style.height = size+'px';
    var ctx = c.getContext('2d');
    ctx.scale(dpr,dpr);
    render(ctx, type, size/2, size/2, size*0.86);
    return c;
  }

  /* Signs are redrawn on every frame in both views, so rasterise each
     one once and reuse the bitmap. Keyed by type and pixel size. */
  var cache = {};
  function bitmap(type, px){
    var key = type + '|' + px;
    if (cache[key]) return cache[key];
    var c = document.createElement('canvas');
    c.width = px; c.height = px;
    var g = c.getContext('2d');
    render(g, type, px/2, px/2, px*0.72);
    cache[key] = c;
    return c;
  }

  return { render:render, chip:chip, bitmap:bitmap,
           LABEL:LABEL, pedGlyph:pedGlyph, draw:draw };
})();
