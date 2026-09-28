'use strict';
/* ------------------------------------------------------------------
   geo.js - world constants, vector math, path building
   Coordinate system: world units, y points DOWN (screen convention).
   The intersection centre is always at (0,0).
   ------------------------------------------------------------------ */

var CFG = {
  PPM:      12,      // world units per metre
  LANE:     48,      // width of one lane  (= 4 m)
  HALF:     24,      // half a lane        (lane centre offset)
  BOX:      48,      // half width of the carriageway = edge of junction box
  FAR:      880,     // where every approach path starts (~73 m out)
  RING:     150,     // roundabout: radius of the circulating lane centre
  CAR_L:    52,      // 4.3 m
  CAR_W:    24,      // 2.0 m
  ACC:      42,      // player acceleration   u/s^2  (~3.5 m/s^2)
  BRAKE:    110,     // player braking        u/s^2  (~9 m/s^2)
  COAST:    16,      // engine braking
  AI_ACC:   38,
  AI_DEC:   95,
  PED_V:    17       // 1.4 m/s
};

/* km/h  <->  world units per second */
function kmh(v){ return v / 3.6 * CFG.PPM; }
function toKmh(u){ return u * 3.6 / CFG.PPM; }

var Geo = (function(){

  function add(a,b){ return {x:a.x+b.x, y:a.y+b.y}; }
  function sub(a,b){ return {x:a.x-b.x, y:a.y-b.y}; }
  function mul(a,k){ return {x:a.x*k,   y:a.y*k};   }
  function len(a){ return Math.hypot(a.x,a.y); }
  function dist(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }
  function norm(a){ var l = len(a)||1; return {x:a.x/l, y:a.y/l}; }
  /* rotate 90 deg clockwise on screen (y down) => "to the right of" */
  function rot90cw(a){ return {x:-a.y, y:a.x}; }
  function lerp(a,b,t){ return {x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t}; }
  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }

  /* outward unit vector of each arm (pointing away from the centre) */
  var ARM_VEC = { N:{x:0,y:-1}, E:{x:1,y:0}, S:{x:0,y:1}, W:{x:-1,y:0} };
  var ARM_ORDER = ['N','E','S','W'];

  /* the arm lying to the right of somebody arriving FROM arm
     (identical to the arm a right turn would take them into) */
  function rightOf(arm){
    var i = ARM_ORDER.indexOf(arm);
    return ARM_ORDER[(i+3)%4];
  }
  function leftOf(arm){
    var i = ARM_ORDER.indexOf(arm);
    return ARM_ORDER[(i+1)%4];
  }
  function opposite(arm){
    var i = ARM_ORDER.indexOf(arm);
    return ARM_ORDER[(i+2)%4];
  }
  /* which way a from->to move turns */
  function turnOf(from,to){
    if (to === rightOf(from))   return 'right';
    if (to === leftOf(from))    return 'left';
    if (to === opposite(from))  return 'straight';
    return 'uturn';
  }

  /* centre of the APPROACH lane on arm, d units out from the centre */
  function laneIn(arm,d){
    var o = ARM_VEC[arm], r = rot90cw(o);
    return { x:o.x*d - r.x*CFG.HALF, y:o.y*d - r.y*CFG.HALF };
  }
  /* centre of the EXIT lane on arm, d units out from the centre */
  function laneOut(arm,d){
    var o = ARM_VEC[arm], r = rot90cw(o);
    return { x:o.x*d + r.x*CFG.HALF, y:o.y*d + r.y*CFG.HALF };
  }
  function lineIntersect(p1,d1,p2,d2){
    var den = d1.x*d2.y - d1.y*d2.x;
    if (Math.abs(den) < 1e-6) return null;
    var t = ((p2.x-p1.x)*d2.y - (p2.y-p1.y)*d2.x) / den;
    return { x:p1.x+d1.x*t, y:p1.y+d1.y*t };
  }
  function quadPoints(p0,c,p1,n){
    var out=[];
    for (var i=0;i<=n;i++){
      var t=i/n, m=1-t;
      out.push({ x:m*m*p0.x + 2*m*t*c.x + t*t*p1.x,
                 y:m*m*p0.y + 2*m*t*c.y + t*t*p1.y });
    }
    return out;
  }
  /* Chaikin corner cutting - turns a rough polyline into a drivable curve */
  function smooth(pts,iters){
    for (var k=0;k<(iters||1);k++){
      var out=[pts[0]];
      for (var i=0;i<pts.length-1;i++){
        var a=pts[i], b=pts[i+1];
        out.push({x:a.x*0.75+b.x*0.25, y:a.y*0.75+b.y*0.25});
        out.push({x:a.x*0.25+b.x*0.75, y:a.y*0.25+b.y*0.75});
      }
      out.push(pts[pts.length-1]);
      pts=out;
    }
    return pts;
  }
  function dedupe(pts){
    var out=[pts[0]];
    for (var i=1;i<pts.length;i++){
      if (dist(pts[i], out[out.length-1]) > 0.5) out.push(pts[i]);
    }
    return out;
  }

  /* ---------------- Path ---------------- */
  function Path(pts){
    this.pts = dedupe(pts);
    this.cum = [0];
    for (var i=1;i<this.pts.length;i++){
      this.cum.push(this.cum[i-1] + dist(this.pts[i-1], this.pts[i]));
    }
    this.length = this.cum[this.cum.length-1];
  }
  Path.prototype.at = function(s){
    s = clamp(s, 0, this.length);
    var lo = 0, hi = this.cum.length-1;
    while (lo < hi-1){
      var mid = (lo+hi)>>1;
      if (this.cum[mid] <= s) lo = mid; else hi = mid;
    }
    var a = this.pts[lo], b = this.pts[lo+1] || this.pts[lo];
    var seg = (this.cum[lo+1] - this.cum[lo]) || 1;
    var t = (s - this.cum[lo]) / seg;
    return { x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t,
             h:Math.atan2(b.y-a.y, b.x-a.x) };
  };
  /* first s (walking forward) at which the path is within r of the centre */
  Path.prototype.sAtRadius = function(r){
    for (var s=0; s<=this.length; s+=2){
      var p = this.at(s);
      if (Math.hypot(p.x,p.y) <= r) return s;
    }
    return this.length;
  };
  /* last s at which the path is still within r of the centre */
  Path.prototype.sLeavingRadius = function(r){
    for (var s=this.length; s>=0; s-=2){
      var p = this.at(s);
      if (Math.hypot(p.x,p.y) <= r) return s;
    }
    return 0;
  };

  /* ---- path through a normal junction: arm from -> arm to ----
     Turns start and finish a little way outside the junction box so the
     radius is realistic (about 5 m) instead of a 2 m hairpin. */
  function junctionPath(from,to){
    var turn = turnOf(from,to);
    var ext  = turn === 'straight' ? CFG.BOX : CFG.BOX + 34;
    var p0 = laneIn(from, CFG.FAR);
    var p1 = laneIn(from, ext);
    var p2 = laneOut(to,  ext);
    var p3 = laneOut(to,  CFG.FAR);
    var dIn  = mul(ARM_VEC[from], -1);
    var dOut = ARM_VEC[to];
    var pts  = [p0, p1];
    var c = lineIntersect(p1, dIn, p2, dOut);
    if (c && turn !== 'straight'){
      pts = pts.concat(quadPoints(p1, c, p2, 16).slice(1));
    } else {
      pts.push(p2);
    }
    pts.push(p3);
    return new Path(pts);
  }

  /* ---- path through a roundabout ---- */
  var ARM_ANGLE = { E:0, N:90, W:180, S:270 };   // maths angle, y flipped
  function ringPoint(deg, r){
    var a = deg*Math.PI/180;
    return { x:Math.cos(a)*r, y:-Math.sin(a)*r };
  }
  function roundaboutPath(from,to){
    var R  = CFG.RING;
    var a0 = ARM_ANGLE[from], a1 = ARM_ANGLE[to];
    var pts = [ laneIn(from, CFG.FAR), laneIn(from, R+70) ];
    /* sweep anticlockwise on screen = increasing maths angle */
    var start = a0 + 16, end = a1 - 16;
    while (end <= start) end += 360;
    for (var a=start; a<=end; a+=6) pts.push(ringPoint(a, R));
    pts.push(ringPoint(end, R));
    pts.push(laneOut(to, R+70));
    pts.push(laneOut(to, CFG.FAR));
    return new Path(smooth(pts, 2));
  }

  /* ---- straight rail line across the map ---- */
  function railPath(from,to,offset){
    var o = offset || 0;
    var a = ARM_VEC[from], b = ARM_VEC[to];
    var pa = rot90cw(a), pb = rot90cw(b);
    var p0 = { x:a.x*CFG.FAR + pa.x*o,    y:a.y*CFG.FAR + pa.y*o };
    var p1 = { x:b.x*CFG.FAR - pb.x*o,    y:b.y*CFG.FAR - pb.y*o };
    return new Path([p0, {x:0,y:0}, p1]);
  }

  /* ---- where do two paths conflict? ----
     Returns the EARLIEST point of closest approach, which is what a
     driver actually has to time: the crossing point for crossing paths,
     the merge point for merging paths. */
  function conflictOf(pa, pb, thresh){
    var best = null, step = 5;
    for (var sa=0; sa<=pa.length; sa+=step){
      var A = pa.at(sa);
      for (var sb=0; sb<=pb.length; sb+=step){
        var B = pb.at(sb);
        var d = Math.hypot(A.x-B.x, A.y-B.y);
        if (!best || d < best.d - 0.001)
          best = { d:d, sa:sa, sb:sb, x:(A.x+B.x)/2, y:(A.y+B.y)/2 };
      }
    }
    if (!best || best.d > (thresh || CFG.CAR_W+14)) return null;
    return best;
  }

  return { add:add, sub:sub, mul:mul, len:len, dist:dist, norm:norm,
           rot90cw:rot90cw, lerp:lerp, clamp:clamp,
           ARM_VEC:ARM_VEC, ARM_ORDER:ARM_ORDER, ARM_ANGLE:ARM_ANGLE,
           rightOf:rightOf, leftOf:leftOf, opposite:opposite, turnOf:turnOf,
           laneIn:laneIn, laneOut:laneOut, ringPoint:ringPoint,
           smooth:smooth, quadPoints:quadPoints, lineIntersect:lineIntersect,
           Path:Path, junctionPath:junctionPath, roundaboutPath:roundaboutPath,
           railPath:railPath, conflictOf:conflictOf };
})();
