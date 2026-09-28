'use strict';
/* ------------------------------------------------------------------
   gl.js - the driver's view in real 3D (three.js / WebGL).

   Draws exactly the world the 2D views draw - same map, same houses
   (cityview.js), same vehicles from the simulation - but as lit, shaded,
   textured geometry: photo-scanned asphalt, paving and gravel, plaster
   houses with real windows, glossy car paint reflecting the sky, sun
   shadows by day and street lamps and headlights by night.

   Nothing in here decides anything about the rules: it only looks. If
   WebGL or three.js is missing, main.js falls back to pov.js.

   World units (12 per metre, 2D y pointing "down" the map) become
   metres in three.js: X = x/12, Z = y/12, and Y is height.
   ------------------------------------------------------------------ */

var GL3D = (function(){

  var U = 1 / CFG.PPM;                    // world units -> metres
  var FOV_H = 78;                         // horizontal, degrees, as in pov.js
  var EYE_H = 1.20;

  var ok = null, renderer = null, canvas = null;
  var scene, camera, sun, hemi, sky, pmrem, envDay, envNight;
  var night = true;
  var tex = {}, texReady = {};
  var built = null;                       // the static scene for one world
  var dyn = null;                         // per-vehicle meshes
  var chevrons = [], lampLights = [], headlamp = null;
  var lastW = 0, lastH = 0;

  /* ---------------- start-up ---------------- */
  function available(){
    if (ok !== null) return ok;
    ok = false;
    if (typeof THREE === 'undefined' || typeof document === 'undefined') return ok;
    try {
      canvas = document.getElementById('gl');
      if (!canvas) return ok;
      renderer = new THREE.WebGLRenderer({ canvas:canvas, antialias:true, powerPreference:'high-performance' });
    } catch (e){ renderer = null; return ok; }
    THREE.ColorManagement.legacyMode = false;          // colours are given in sRGB
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, 1, 0.08, 2500);
    camera.rotation.order = 'YXZ';

    hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5b5346, 0.75);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    sun.castShadow = true;
    var small = Math.min(window.innerWidth, window.innerHeight) < 700;
    sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    var sc = sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun); scene.add(sun.target);

    sky = new THREE.Sky();
    sky.scale.setScalar(2000);
    var u = sky.material.uniforms;
    u.turbidity.value = 6; u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    scene.add(sky);

    pmrem = new THREE.PMREMGenerator(renderer);
    envDay = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;

    /* street lamps light the road around you after dark: a few real
       lights, moved to whichever lamps are nearest */
    for (var i = 0; i < 6; i++){
      var pl = new THREE.PointLight(0xffd9a0, 0, 22, 2);
      scene.add(pl); lampLights.push(pl);
    }
    headlamp = new THREE.SpotLight(0xfff4dd, 0, 70, 0.5, 0.45, 1.6);
    scene.add(headlamp); scene.add(headlamp.target);

    loadTextures();
    syncTheme();
    ok = true;
    return ok;
  }

  /* ---------------- textures ---------------- */
  function loadTextures(){
    if (typeof ASSETS === 'undefined') return;
    Object.keys(ASSETS).forEach(function(k){
      var img = new Image();
      img.onload = function(){
        texReady[k] = img;
        var t = new THREE.Texture(img);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        if (/_diff$/.test(k)) t.encoding = THREE.sRGBEncoding;
        t.needsUpdate = true;
        tex[k] = t;
        if (k === 'plaster_diff') facades = null;       // rebuild the facades with it
        applyTextures();
      };
      img.src = ASSETS[k];
    });
  }
  var MAT = null;
  function mats(){
    if (MAT) return MAT;
    function std(o){ return new THREE.MeshStandardMaterial(o); }
    MAT = {
      asphalt: std({ color:0x9a9a9a, roughness:0.92 }),
      pavers:  std({ color:0xcfcac2, roughness:0.9 }),
      gravel:  std({ color:0xb8b0a4, roughness:1.0 }),
      grass:   std({ color:0xa8b890, roughness:1.0 }),
      field:   std({ color:0x9fb07e, roughness:1.0 }),
      kerb:    std({ color:0xb9b6ae, roughness:0.8 }),
      paint:   std({ color:0xf2f0ea, roughness:0.6, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2 }),
      rail:    std({ color:0x9a9ea4, metalness:0.85, roughness:0.35 }),
      sleeper: std({ color:0x6e665c, roughness:0.95 }),
      wallA:   std({ vertexColors:true, roughness:0.92, emissive:0xffc978, emissiveIntensity:0 }),
      wallB:   std({ vertexColors:true, roughness:0.92, emissive:0xffc978, emissiveIntensity:0 }),
      shop:    std({ vertexColors:true, roughness:0.85, emissive:0xfff0d0, emissiveIntensity:0 }),
      home:    std({ vertexColors:true, roughness:0.92, emissive:0xffc978, emissiveIntensity:0 }),
      gable:   std({ vertexColors:true, roughness:0.95 }),
      roof:    std({ vertexColors:true, roughness:0.85 }),
      trunk:   std({ color:0x4b3b2d, roughness:1.0 }),
      leaves:  std({ color:0xffffff, roughness:0.85 }),
      metal:   std({ color:0x5b6068, metalness:0.6, roughness:0.45 }),
      lampHead:std({ color:0xdddddd, emissive:0xffe2a8, emissiveIntensity:0, roughness:0.4 }),
      housing: std({ color:0x16191d, roughness:0.6 }),
      lensOff: std({ color:0x1d2126, roughness:0.3 }),
      red:     std({ color:0x330000, emissive:0xff2a1a, emissiveIntensity:2.2 }),
      amber:   std({ color:0x331d00, emissive:0xffb000, emissiveIntensity:2.2 }),
      green:   std({ color:0x00220d, emissive:0x21e36a, emissiveIntensity:2.0 }),
      chevron: new THREE.MeshBasicMaterial({ color:0x6bb2f5, transparent:true, opacity:0.55, depthWrite:false,
                                             polygonOffset:true, polygonOffsetFactor:-4, polygonOffsetUnits:-4 }),
      tower:   std({ color:0x8a97a8, roughness:0.6, metalness:0.3, emissive:0xffd690, emissiveIntensity:0, fog:false })
    };
    return MAT;
  }
  /* ground textures: repeat every so many metres */
  var TILE = { asphalt:5, pavers:2.4, gravel:3, grass:4, field:6 };
  function applyTextures(){
    var M = mats();
    [['asphalt','asphalt'], ['pavers','pavers'], ['gravel','gravel'], ['grass','grass'], ['field','grass'], ['kerb','pavers']]
      .forEach(function(p){
        var d = tex[p[1] + '_diff'], n = tex[p[1] + '_nor'];
        if (d && M[p[0]].map !== d){ M[p[0]].map = d; M[p[0]].needsUpdate = true; }
        if (n && M[p[0]].normalMap !== n){ M[p[0]].normalMap = n; M[p[0]].needsUpdate = true; }
      });
    if (tex.roof_diff && M.roof.map !== tex.roof_diff){ M.roof.map = tex.roof_diff; M.roof.normalMap = tex.roof_nor || null; M.roof.needsUpdate = true; }
    if (tex.plaster_diff && M.gable.map !== tex.plaster_diff){ M.gable.map = tex.plaster_diff; M.gable.needsUpdate = true; }
    buildFacades();
  }

  /* ---------------- facades: plaster with real windows ---------------- */
  /* One texture tile is four window bays wide and three floors high, so
     windows line up with the walls they are mapped onto. Two variants of
     which windows are lit at night keep whole streets from matching. */
  var BAY = 3.1, FLOOR = 3.0;
  var facades = null;
  function hash(a, b, c){
    var x = (a*73856093) ^ (b*19349663) ^ (c*83492791);
    x = (x ^ (x >>> 13)) * 1274126177;
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }
  function tileCanvas(w, h){ var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function plasterBase(g, w, h){
    var img = texReady.plaster_diff;
    g.fillStyle = '#e9e6e0'; g.fillRect(0, 0, w, h);
    if (img){ for (var x = 0; x < w; x += 256) for (var y = 0; y < h; y += 256) g.drawImage(img, x, y, 256, 256); }
  }
  function drawWindow(g, x, y, ww, wh, variant){
    /* recess shadow, frame, glass with a sky reflection, sill */
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x - 3, y - 3, ww + 6, wh + 6);
    g.fillStyle = '#f4f2ec'; g.fillRect(x, y, ww, wh);
    var gl = g.createLinearGradient(x, y, x + ww, y + wh);
    gl.addColorStop(0, '#6d8298'); gl.addColorStop(0.45, '#2c3a48'); gl.addColorStop(1, '#1a232d');
    g.fillStyle = gl; g.fillRect(x + 4, y + 4, ww - 8, wh - 8);
    /* mullion and transom, like a German Dreh-Kipp window */
    g.fillStyle = '#f4f2ec';
    g.fillRect(x + ww/2 - 2, y + 4, 4, wh - 8);
    g.fillRect(x + 4, y + wh*0.30, ww - 8, 3);
    if (variant > 0.72){                              // a blind half down
      g.fillStyle = 'rgba(220,214,200,0.92)'; g.fillRect(x + 4, y + 4, ww - 8, (wh - 8)*0.45);
    }
    g.fillStyle = '#9d988f'; g.fillRect(x - 5, y + wh, ww + 10, 6);
  }
  function buildFacades(){
    if (facades || !texReady.plaster_diff) return;
    var M = mats();
    var PX = 128;                                     // pixels per bay / floor
    function upper(seed){
      var c = tileCanvas(PX*4, PX*3), g = c.getContext('2d');
      var e = tileCanvas(PX*4, PX*3), ge = e.getContext('2d');
      plasterBase(g, c.width, c.height);
      ge.fillStyle = '#000'; ge.fillRect(0, 0, e.width, e.height);
      /* a string course under every floor */
      for (var f = 0; f < 3; f++){
        g.fillStyle = 'rgba(0,0,0,0.07)'; g.fillRect(0, f*PX + PX - 5, c.width, 5);
        for (var b = 0; b < 4; b++){
          var x = b*PX + PX*0.30, y = f*PX + PX*0.22, ww = PX*0.40, wh = PX*0.50;
          drawWindow(g, x, y, ww, wh, hash(seed, f, b));
          if (hash(seed, b, f + 7) < 0.36){
            var lg = ge.createLinearGradient(0, y, 0, y + wh);
            lg.addColorStop(0, '#ffcf88'); lg.addColorStop(1, '#d9953f');
            ge.fillStyle = lg; ge.fillRect(x + 4, y + 4, ww - 8, wh - 8);
          }
        }
      }
      return { map:canvasTex(c), emissive:canvasTex(e) };
    }
    function ground(shop){
      var c = tileCanvas(PX*4, PX), g = c.getContext('2d');
      var e = tileCanvas(PX*4, PX), ge = e.getContext('2d');
      plasterBase(g, c.width, c.height);
      ge.fillStyle = '#000'; ge.fillRect(0, 0, e.width, e.height);
      g.fillStyle = '#8f8a80'; g.fillRect(0, PX*0.84, c.width, PX*0.16);       // plinth
      for (var b = 0; b < 4; b++){
        if (shop){
          g.fillStyle = '#2b2f33'; g.fillRect(b*PX + 8, PX*0.08, PX - 16, PX*0.12);  // fascia
          var sg = g.createLinearGradient(0, PX*0.24, 0, PX*0.84);
          sg.addColorStop(0, '#556676'); sg.addColorStop(1, '#1b232b');
          g.fillStyle = '#d9d6cf'; g.fillRect(b*PX + 10, PX*0.22, PX - 20, PX*0.64);
          g.fillStyle = sg; g.fillRect(b*PX + 14, PX*0.26, PX - 28, PX*0.58);
          ge.fillStyle = '#fff1d8'; ge.fillRect(b*PX + 14, PX*0.26, PX - 28, PX*0.58);
        } else if (b === 1){
          g.fillStyle = '#5a4130'; g.fillRect(b*PX + PX*0.34, PX*0.18, PX*0.32, PX*0.66);  // door
          g.fillStyle = '#c9a86a'; g.fillRect(b*PX + PX*0.60, PX*0.52, 4, 4);
          g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(b*PX + PX*0.30, PX*0.14, PX*0.40, 6);
        } else {
          drawWindow(g, b*PX + PX*0.30, PX*0.26, PX*0.40, PX*0.46, hash(b, 3, 5));
          if (hash(b, 9, 1) < 0.4){ ge.fillStyle = '#e9a85a'; ge.fillRect(b*PX + PX*0.30 + 4, PX*0.30, PX*0.40 - 8, PX*0.38); }
        }
      }
      return { map:canvasTex(c), emissive:canvasTex(e) };
    }
    var a = upper(11), b = upper(29), s = ground(true), h = ground(false);
    M.wallA.map = a.map; M.wallA.emissiveMap = a.emissive; M.wallA.needsUpdate = true;
    M.wallB.map = b.map; M.wallB.emissiveMap = b.emissive; M.wallB.needsUpdate = true;
    M.shop.map = s.map;  M.shop.emissiveMap = s.emissive;  M.shop.needsUpdate = true;
    M.home.map = h.map;  M.home.emissiveMap = h.emissive;  M.home.needsUpdate = true;
    [M.wallA, M.wallB, M.shop, M.home].forEach(function(m){ if (tex.plaster_nor) m.normalMap = tex.plaster_nor; });
    facades = true;
  }
  function canvasTex(c){
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
    return t;
  }

  /* ---------------- geometry builder ---------------- */
  /* Everything static is merged into a handful of big meshes, one per
     material, so a whole town is a few dozen draw calls. */
  function Builder(){ this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; this.col = null; }
  Builder.prototype.color = function(css){
    if (!css){ this.col = null; return this; }
    var c = new THREE.Color(css); this.col = [c.r, c.g, c.b]; return this;
  };
  /* four corners [x,y,z] in metres, uv per corner; winding fixed so the
     face points along n */
  Builder.prototype.quad = function(a, b, c, d, n, uv){
    var ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2], vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
    var cx = uy*vz - uz*vy, cy = uz*vx - ux*vz, cz = ux*vy - uy*vx;
    var pts = [a, b, c, d], uvs = uv;
    if (cx*n[0] + cy*n[1] + cz*n[2] < 0){ pts = [a, d, c, b]; uvs = [uv[0], uv[3], uv[2], uv[1]]; }
    var base = this.p.length/3, self = this;
    pts.forEach(function(v, k){
      self.p.push(v[0], v[1], v[2]); self.n.push(n[0], n[1], n[2]);
      self.uv.push(uvs[k][0], uvs[k][1]);
      if (self.col) self.c.push(self.col[0], self.col[1], self.col[2]);
    });
    this.i.push(base, base+1, base+2, base, base+2, base+3);
  };
  Builder.prototype.tri = function(a, b, c, n, uv){
    this.quad(a, b, c, c, n, [uv[0], uv[1], uv[2], uv[2]]);
  };
  /* flat, facing up, in world units; uv in metres / tile */
  Builder.prototype.flat = function(x0, y0, x1, y1, h, tile){
    var X0 = x0*U, Z0 = y0*U, X1 = x1*U, Z1 = y1*U, t = tile || 1;
    this.quad([X0,h,Z0], [X1,h,Z0], [X1,h,Z1], [X0,h,Z1], [0,1,0],
              [[X0/t, Z0/t], [X1/t, Z0/t], [X1/t, Z1/t], [X0/t, Z1/t]]);
  };
  /* an axis-aligned box in metres, all six sides */
  Builder.prototype.box = function(x0, x1, y0, y1, z0, z1, tile){
    var t = tile || 1, self = this;
    function q(a, b, c, d, n, w, h){ self.quad(a, b, c, d, n, [[0,0],[w/t,0],[w/t,h/t],[0,h/t]]); }
    q([x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1],[0,1,0], x1-x0, z1-z0);
    q([x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[0,0,-1], x1-x0, y1-y0);
    q([x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[0,0,1], x1-x0, y1-y0);
    q([x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[-1,0,0], z1-z0, y1-y0);
    q([x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0],[1,0,0], z1-z0, y1-y0);
  };
  Builder.prototype.mesh = function(mat, shadows){
    if (!this.i.length) return null;
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.c.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    var m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.castShadow = !!shadows;
    m.matrixAutoUpdate = false;
    return m;
  };

  /* arm-local (d out along the arm, lat across) -> world units */
  function armPt(arm, d, lat, ox, oy){
    var o = Geo.ARM_VEC[arm], q = Geo.rot90cw(o);
    return [ox + o.x*d + q.x*lat, oy + o.y*d + q.y*lat];
  }
  function armFlat(B, arm, d1, l1, d2, l2, ox, oy, h, tile){
    var a = armPt(arm, d1, l1, ox, oy), b = armPt(arm, d2, l2, ox, oy);
    B.flat(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), h, tile);
  }
  function armBox(B, arm, d1, l1, d2, l2, ox, oy, h0, h1){
    var a = armPt(arm, d1, l1, ox, oy), b = armPt(arm, d2, l2, ox, oy);
    B.box(Math.min(a[0], b[0])*U, Math.max(a[0], b[0])*U, h0, h1, Math.min(a[1], b[1])*U, Math.max(a[1], b[1])*U, 1);
  }

  /* ---------------- one junction's road, kerbs and paint ---------------- */
  function stopLineX(sc, arm, ring){
    if (ring) return CFG.RING + CFG.BOX + 8;
    if (sc.rail && arm === sc.rail.side) return sc.rail.carHold - 2;
    if (sc.x !== undefined) return CFG.BOX + 30;
    return CFG.BOX + 8;
  }
  var KERB_W = 2.6, KERB_H = 0.13;             // world units wide, metres high
  function buildJunction(parts, sc, reach, city){
    var L = sc.layout, ox = sc.x || 0, oy = sc.y || 0, B = CFG.BOX;
    var ring = L.type === 'roundabout';
    var road = parts.road, kerb = parts.kerb, paint = parts.paint;

    if (ring){
      /* the ring as a band of segments, the island raised */
      var N = 48, R0 = CFG.RING - B, R1 = CFG.RING + B;
      for (var i = 0; i < N; i++){
        var a0 = i/N*Math.PI*2, a1 = (i+1)/N*Math.PI*2;
        var P = function(a, r, h){ return [(ox + Math.cos(a)*r)*U, h, (oy + Math.sin(a)*r)*U]; };
        road.quad(P(a0,R0,0.03), P(a1,R0,0.03), P(a1,R1,0.03), P(a0,R1,0.03), [0,1,0],
                  [[0,0],[1,0],[1,1],[0,1]].map(function(t){ return [t[0]*2, t[1]*2]; }));
        parts.island.tri(P(a0,0,0.16), P(a0,R0,0.16), P(a1,R0,0.16), [0,1,0], [[0,0],[1,0],[1,1]]);
        kerb.quad(P(a0,R0,0), P(a1,R0,0), P(a1,R0,0.16), P(a0,R0,0.16), [-Math.cos((a0+a1)/2),0,-Math.sin((a0+a1)/2)], [[0,0],[1,0],[1,1],[0,1]]);
      }
      L.arms.forEach(function(arm){ armFlat(road, arm, R1 - 20, -B, reach, B, ox, oy, 0.03, TILE.asphalt); });
    } else {
      road.flat(ox - B, oy - B, ox + B, oy + B, 0.03, TILE.asphalt);
      L.arms.forEach(function(arm){ armFlat(road, arm, B, -B, reach, B, ox, oy, 0.03, TILE.asphalt); });
    }

    /* kerbs: along both sides of every arm, across the mouth of any arm
       that is missing (a T-junction), and not across the U-Bahn's bed */
    Geo.ARM_ORDER.forEach(function(arm){
      var has = L.arms.indexOf(arm) >= 0;
      var start = ring ? CFG.RING + B + 10 : B;
      if (has){
        [-1, 1].forEach(function(side){
          var lat0 = side*B, lat1 = side*(B + KERB_W);
          if (sc.rail && arm === sc.rail.side){
            armBox(kerb, arm, start, lat0, City.RAIL.bed[0] - 2, lat1, ox, oy, 0, KERB_H);
            armBox(kerb, arm, City.RAIL.bed[1] + 2, lat0, reach, lat1, ox, oy, 0, KERB_H);
          } else armBox(kerb, arm, start, lat0, reach, lat1, ox, oy, 0, KERB_H);
        });
      } else if (!ring && city){
        armBox(kerb, arm, B, -B - KERB_W, B + KERB_W, B + KERB_W, ox, oy, 0, KERB_H);
      }
    });

    /* paint */
    L.arms.forEach(function(arm){
      var start = (ring ? CFG.RING + B : B) + 14;
      for (var d = start; d < reach - 20; d += 48) armFlat(paint, arm, d, -1.6, d + 26, 1.6, ox, oy, 0.045);
      var sign = Rules.signOf(sc, arm);
      var lit = sc.lights && sc.lights.groups[arm];
      var lineX = stopLineX(sc, arm, ring);
      var hasCross = L.crossings && L.crossings.indexOf(arm) >= 0;
      if (hasCross) lineX = Math.max(lineX, Sim.CROSS_MID + Sim.CROSS_HALF + 12);
      if (lit || sign === 'stop') armFlat(paint, arm, lineX, -B, lineX + 6, 0, ox, oy, 0.045);
      else if (sign === 'yield' || sign === 'ringentry' || sign === 'exit'){
        /* the Haifischzähne: a row of white triangles */
        for (var y = -B + 3; y < -4; y += 12){
          var p0 = armPt(arm, lineX + 9, y, ox, oy), p1 = armPt(arm, lineX + 9, y + 8, ox, oy), p2 = armPt(arm, lineX, y + 4, ox, oy);
          paint.tri([p0[0]*U,0.045,p0[1]*U], [p1[0]*U,0.045,p1[1]*U], [p2[0]*U,0.045,p2[1]*U], [0,1,0], [[0,0],[1,0],[0,1]]);
        }
      }
      if (hasCross){
        for (var yy = -B + 5; yy < B - 4; yy += 14)
          armFlat(paint, arm, Sim.CROSS_MID - Sim.CROSS_HALF, yy, Sim.CROSS_MID + Sim.CROSS_HALF, yy + 7, ox, oy, 0.045);
      }
    });
    if (L.playzone) armFlat(parts.pave, L.playzone, B + 40, -B, reach, B, ox, oy, 0.035, TILE.pavers);
    if (L.busstop) armFlat(road, L.busstop, B + 330, -B - 46, B + 580, -B, ox, oy, 0.03, TILE.asphalt);
  }

  /* ---------------- signs, lights, poles ---------------- */
  function signFace(type){
    var key = 'sign:' + type;
    if (signTex[key]) return signTex[key];
    var c = Signs.bitmap(type, 256);
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    signTex[key] = new THREE.MeshStandardMaterial({ map:t, transparent:true, alphaTest:0.3, roughness:0.5, side:THREE.FrontSide });
    return signTex[key];
  }
  var signTex = {};
  function faceTowards(obj, arm){
    /* the face looks back up the arm, at traffic coming in on it */
    var o = Geo.ARM_VEC[arm];
    obj.rotation.y = Math.atan2(o.x, o.y);
  }
  function addSign(group, type, x, y, arm, lift){
    var M = mats(), h = 2.2 + (lift || 0);
    var post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, h + 0.4, 8), M.metal);
    post.position.set(x*U, (h + 0.4)/2, y*U); post.castShadow = true;
    group.add(post);
    var face = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.75), signFace(type));
    face.position.set(x*U, h + 0.2, y*U);
    faceTowards(face, arm);
    var o = Geo.ARM_VEC[arm];
    face.position.x += o.x*0.04; face.position.z += o.y*0.04;
    group.add(face);
    var back = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), M.metal);
    back.position.copy(face.position); back.rotation.y = face.rotation.y + Math.PI;
    back.position.x -= o.x*0.02; back.position.z -= o.y*0.02;
    group.add(back);
  }
  /* a signal head on its mast; returns the three lenses to switch */
  function addSignal(group, x, y, arm){
    var M = mats();
    var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 3.4, 10), M.metal);
    mast.position.set(x*U, 1.7, y*U); mast.castShadow = true; group.add(mast);
    var head = new THREE.Group();
    head.position.set(x*U, 2.75, y*U);
    faceTowards(head, arm);
    var box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.95, 0.25), M.housing);
    box.castShadow = true; head.add(box);
    var lenses = {};
    [['red', 0.30], ['yellow', 0], ['green', -0.30]].forEach(function(l){
      var lens = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), M.lensOff);
      lens.position.set(0, l[1], 0.13);
      head.add(lens);
      var visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.14), M.housing);
      visor.position.set(0, l[1] + 0.12, 0.19); head.add(visor);
      lenses[l[0]] = lens;
    });
    group.add(head);
    return lenses;
  }
  function addStation(group, name, x, y){
    var c = document.createElement('canvas'); c.width = 256; c.height = 360;
    var g = c.getContext('2d');
    g.fillStyle = '#1b4f9c'; g.fillRect(64, 0, 128, 128);
    g.fillStyle = '#fff'; g.font = 'bold 104px Archivo, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('U', 128, 70);
    g.fillStyle = '#f4f4f0'; g.fillRect(0, 150, 256, 60);
    g.fillStyle = '#1b1b1b'; g.font = 'bold 34px Archivo, Arial, sans-serif'; g.fillText(name, 128, 182, 244);
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    var mat = new THREE.MeshStandardMaterial({ map:t, transparent:true, alphaTest:0.2, side:THREE.DoubleSide, roughness:0.5 });
    var M = mats();
    var post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 8), M.metal);
    post.position.set(x*U, 1.6, y*U); group.add(post);
    var face = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.97), mat);
    face.position.set(x*U, 3.0, y*U); group.add(face);
    face.userData.billboard = true;
    return face;
  }

  /* ---------------- houses ---------------- */
  function buildHouses(parts, houses){
    houses.forEach(function(hs){
      var x0 = hs.x0*U, x1 = hs.x1*U, z0 = hs.y0*U, z1 = hs.y1*U, h = hs.h*U;
      var gh = Math.min(FLOOR, h);
      var up = hash(hs.seed, 1, 1) < 0.5 ? parts.wallA : parts.wallB;
      var gr = hs.shop ? parts.shop : parts.home;
      up.color(hs.color); gr.color(hs.color); parts.gable.color(hs.color);
      /* four walls: ground floor band, then the storeys above */
      var walls = [
        { a:[x1,z0], b:[x0,z0], n:[0,0,-1] }, { a:[x0,z1], b:[x1,z1], n:[0,0,1] },
        { a:[x0,z0], b:[x0,z1], n:[-1,0,0] }, { a:[x1,z1], b:[x1,z0], n:[1,0,0] }
      ];
      walls.forEach(function(w){
        var len = Math.hypot(w.b[0]-w.a[0], w.b[1]-w.a[1]);
        var u1 = len / (BAY*4);
        gr.quad([w.a[0],0,w.a[1]], [w.b[0],0,w.b[1]], [w.b[0],gh,w.b[1]], [w.a[0],gh,w.a[1]], w.n,
                [[0,0],[u1,0],[u1,1],[0,1]]);
        if (h > gh){
          var v1 = (h - gh) / (FLOOR*3);
          up.quad([w.a[0],gh,w.a[1]], [w.b[0],gh,w.b[1]], [w.b[0],h,w.b[1]], [w.a[0],h,w.a[1]], w.n,
                  [[0,0],[u1,0],[u1,v1],[0,v1]]);
        }
      });
      /* the eaves: a darker band just under the roof */
      parts.eaves.color('#6b655c');
      parts.eaves.box(x0 - 0.12, x1 + 0.12, h - 0.02, h + 0.14, z0 - 0.12, z1 + 0.12, 1);
      if (hs.roof){
        var rh = hs.roofH*U, alongX = (hs.front === 'N' || hs.front === 'S');
        parts.roof.color(hs.roof);
        var hr = h + 0.14;
        if (alongX){
          var zm = (z0 + z1)/2, sl = Math.hypot(zm - z0, rh);
          var e = 0.35;                                      // overhang
          parts.roof.quad([x0-e,hr,z0-e], [x1+e,hr,z0-e], [x1+e,hr+rh,zm], [x0-e,hr+rh,zm], [0, (zm-z0), -rh],
                          [[0,0],[(x1-x0)/3,0],[(x1-x0)/3,sl/3],[0,sl/3]]);
          parts.roof.quad([x0-e,hr,z1+e], [x1+e,hr,z1+e], [x1+e,hr+rh,zm], [x0-e,hr+rh,zm], [0, (z1-zm), rh],
                          [[0,0],[(x1-x0)/3,0],[(x1-x0)/3,sl/3],[0,sl/3]]);
          parts.gable.tri([x0,hr,z0], [x0,hr,z1], [x0,hr+rh,zm], [-1,0,0], [[0,0],[(z1-z0)/4,0],[(z1-z0)/8,rh/4]]);
          parts.gable.tri([x1,hr,z0], [x1,hr,z1], [x1,hr+rh,zm], [1,0,0], [[0,0],[(z1-z0)/4,0],[(z1-z0)/8,rh/4]]);
        } else {
          var xm = (x0 + x1)/2, sl2 = Math.hypot(xm - x0, rh), e2 = 0.35;
          parts.roof.quad([x0-e2,hr,z0-e2], [x0-e2,hr,z1+e2], [xm,hr+rh,z1+e2], [xm,hr+rh,z0-e2], [-rh, (xm-x0), 0],
                          [[0,0],[(z1-z0)/3,0],[(z1-z0)/3,sl2/3],[0,sl2/3]]);
          parts.roof.quad([x1+e2,hr,z0-e2], [x1+e2,hr,z1+e2], [xm,hr+rh,z1+e2], [xm,hr+rh,z0-e2], [rh, (x1-xm), 0],
                          [[0,0],[(z1-z0)/3,0],[(z1-z0)/3,sl2/3],[0,sl2/3]]);
          parts.gable.tri([x0,hr,z0], [x1,hr,z0], [xm,hr+rh,z0], [0,0,-1], [[0,0],[(x1-x0)/4,0],[(x1-x0)/8,rh/4]]);
          parts.gable.tri([x0,hr,z1], [x1,hr,z1], [xm,hr+rh,z1], [0,0,1], [[0,0],[(x1-x0)/4,0],[(x1-x0)/8,rh/4]]);
        }
      } else {
        parts.roof.color('#6f6a64');
        parts.roof.quad([x0,h+0.14,z0], [x1,h+0.14,z0], [x1,h+0.14,z1], [x0,h+0.14,z1], [0,1,0], [[0,0],[1,0],[1,1],[0,1]]);
      }
    });
  }

  /* ---------------- trees and lamps, instanced ---------------- */
  function crownGeometry(){
    var g = new THREE.SphereGeometry(1, 14, 10);        // indexed, so it shades smooth
    var p = g.attributes.position;
    for (var i = 0; i < p.count; i++){
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      var k = 1 + 0.18*Math.sin(x*5.1 + z*3.7) + 0.12*Math.cos(y*6.3 + x*2.2);
      p.setXYZ(i, x*k, y*k*0.85, z*k);
    }
    g.computeVertexNormals();
    return g;
  }
  function buildTrees(group, trees){
    if (!trees.length) return;
    var M = mats();
    var trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.22, 1, 7), M.trunk, trees.length);
    var crown = new THREE.InstancedMesh(crownGeometry(), M.leaves, trees.length*3);
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    var col = new THREE.Color();
    trees.forEach(function(t, i){
      var h = t.h*U, r = t.r*U, x = t.x*U, z = t.y*U;
      var th = h*0.5;
      m.compose(p.set(x, th/2, z), q.identity(), s.set(1, th, 1)); trunk.setMatrixAt(i, m);
      for (var k = 0; k < 3; k++){
        var a = k*2.1 + t.tone*6, off = k === 0 ? 0 : r*0.45;
        var rr = r*(k === 0 ? 1 : 0.72);
        m.compose(p.set(x + Math.cos(a)*off, th + r*0.75 + (k === 0 ? 0.3 : -0.2), z + Math.sin(a)*off),
                  q.identity(), s.set(rr, rr, rr));
        crown.setMatrixAt(i*3 + k, m);
        col.setHSL(0.22 + t.tone*0.07, 0.42 + 0.08*k, 0.13 + 0.035*k + t.tone*0.035);
        crown.setColorAt(i*3 + k, col);
      }
    });
    trunk.castShadow = crown.castShadow = true;
    crown.receiveShadow = true;
    group.add(trunk); group.add(crown);
  }
  function buildLamps(group, lamps){
    if (!lamps.length) return [];
    var M = mats();
    var pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.09, 7.6, 8), M.metal, lamps.length);
    var arm  = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.07, 0.07), M.metal, lamps.length);
    var head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.12, 0.28), M.lampHead, lamps.length);
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1,1,1), p = new THREE.Vector3();
    var e = new THREE.Euler(), out = [];
    lamps.forEach(function(l, i){
      var x = l.x*U, z = l.y*U;
      /* the arm reaches out over the road: +x beside a column, +z beside a row */
      var dx = l.col ? 1 : 0, dz = l.col ? 0 : 1;
      m.compose(p.set(x, 3.8, z), q.identity(), s); pole.setMatrixAt(i, m);
      q.setFromEuler(e.set(0, l.col ? 0 : -Math.PI/2, 0));
      m.compose(p.set(x + dx*0.75, 7.55, z + dz*0.75), q, s); arm.setMatrixAt(i, m);
      m.compose(p.set(x + dx*1.45, 7.45, z + dz*1.45), q, s); head.setMatrixAt(i, m);
      out.push(new THREE.Vector3(x + dx*1.45, 7.2, z + dz*1.45));
    });
    pole.castShadow = true;
    group.add(pole); group.add(arm); group.add(head);
    return out;
  }

  /* ---------------- the static scene ---------------- */
  function buildWorld(world){
    if (built){ scene.remove(built.group); disposeGroup(built.group); }
    if (dyn){
      Object.keys(dyn.meshes).forEach(function(id){ scene.remove(dyn.meshes[id]); });
      Object.keys(dyn.peds).forEach(function(id){ scene.remove(dyn.peds[id]); });
    }
    dyn = { meshes:{}, peds:{} };
    var M = mats(), group = new THREE.Group();
    var P = {
      ground:new Builder(), yard:new Builder(), bed:new Builder(), road:new Builder(), kerb:new Builder(),
      paint:new Builder(), pave:new Builder(), island:new Builder(),
      wallA:new Builder(), wallB:new Builder(), shop:new Builder(), home:new Builder(),
      gable:new Builder(), roof:new Builder(), eaves:new Builder()
    };
    var signals = [], stations = [], lampPos = [];

    if (world.map){
      var map = world.map, view = CityView.build(map);
      var S = City.SPACING;
      /* pavements everywhere, gardens inside the blocks, fields beyond */
      P.ground.flat(view.colX(-3), view.rowY(-3), view.colX(map.cols + 2), view.rowY(map.rows + 2), 0, TILE.pavers);
      view.blocks.forEach(function(b){ P.yard.flat(b.x0, b.y0, b.x1, b.y1, 0.012, TILE.grass); });
      var bed = CityView.railBed(map);
      if (bed) P.bed.flat(bed.x0, bed.y0, bed.x1, bed.y1, 0.02, TILE.gravel);
      map.nodes.forEach(function(n){ buildJunction(P, n, S/2 + 2, true); });
      buildHouses(P, view.houses);
      buildTrees(group, view.trees);
      lampPos = buildLamps(group, view.lamps);
      if (bed) buildRails(group, map, bed, view);
      map.nodes.forEach(function(n){ addJunctionFurniture(group, n, signals, stations, world); });
      buildSkyline(group, view, map);
    } else {
      var sc = world.junctionFor(world.player);
      var far = 190/U;
      buildJunction(P, sc, far, false);
      buildLessonCountry(group, sc);
      if (sc.layout.rails) buildLessonRails(group, sc);
      addJunctionFurniture(group, sc, signals, stations, world);
      buildSkyline(group, null, null);
    }

    var layers = [
      ['ground', M.pavers], ['yard', world.map ? M.grass : M.field], ['bed', M.gravel], ['road', M.asphalt],
      ['kerb', M.kerb], ['paint', M.paint], ['pave', M.pavers], ['island', M.grass],
      ['wallA', M.wallA, true], ['wallB', M.wallB, true], ['shop', M.shop, true], ['home', M.home, true],
      ['gable', M.gable, true], ['roof', M.roof, true], ['eaves', M.kerb, true]
    ];
    layers.forEach(function(l){
      var mesh = P[l[0]].mesh(l[1], l[2]);
      if (mesh) group.add(mesh);
    });
    scene.add(group);
    built = { world:world, group:group, signals:signals, stations:stations, lamps:lampPos };
    placeChevrons();
  }
  function disposeGroup(g){
    g.traverse(function(o){ if (o.geometry) o.geometry.dispose(); });
  }

  function addJunctionFurniture(group, sc, signals, stations, world){
    var L = sc.layout, ox = sc.x || 0, oy = sc.y || 0;
    L.arms.forEach(function(arm){
      var type = L.type === 'roundabout' ? 'roundabout' : Rules.signOf(sc, arm);
      var base = L.type === 'roundabout' ? CFG.RING + CFG.BOX : CFG.BOX;
      var d = base + 46, lat = -(CFG.BOX + 26);
      if (sc.rail && arm === sc.rail.side) d = sc.rail.carHold + 10;
      var p = armPt(arm, d, lat, ox, oy);
      if (type !== 'none') addSign(group, type, p[0], p[1], arm);
      if (L.zone && sc.player && arm === sc.player.from){
        var pz = armPt(arm, d + 74, lat, ox, oy); addSign(group, L.zone, pz[0], pz[1], arm);
      }
      if (sc.gruenpfeil && sc.gruenpfeil.indexOf(arm) >= 0){
        var pg = armPt(arm, d - 8, lat - 4, ox, oy); addSign(group, 'green_arrow', pg[0], pg[1], arm, -0.7);
      }
      if (sc.lights && sc.lights.groups[arm]){
        var near = sc.rail && arm === sc.rail.side ? sc.rail.carHold + 8 : CFG.BOX + 26;
        [[near, -(CFG.BOX + 24)], [-(CFG.BOX + 30), -(CFG.BOX + 24)]].forEach(function(pos){
          var q = armPt(arm, pos[0], pos[1], ox, oy);
          signals.push({ sc:sc, arm:arm, lenses:addSignal(group, q[0], q[1], arm), state:null });
        });
      }
    });
    if (L.busstop){
      var pb = armPt(L.busstop, CFG.BOX + 430, -(CFG.BOX + 60), ox, oy);
      addSign(group, 'bus_stop', pb[0], pb[1], L.busstop);
    }
    if (sc.place && sc.rail) stations.push(addStation(group, sc.place, ox + City.RAIL.bed[1] + 22, oy - CFG.BOX - 60));
    void world;
  }

  function buildRails(group, map, bed, view){
    var M = mats(), rb = new Builder();
    bed.tracks.forEach(function(tx){
      [-8.6, 8.6].forEach(function(g){
        rb.box((tx + g - 0.45)*U, (tx + g + 0.45)*U, 0.02, 0.17, bed.y0*U, bed.y1*U, 1);
      });
    });
    group.add(rb.mesh(M.rail, true));
    /* sleepers every 0.65 m, except where a street crosses */
    var rows = []; for (var r = 0; r < map.rows; r++) rows.push(view.rowY(r));
    var spots = [];
    for (var y = bed.y0; y < bed.y1; y += 0.65/U){
      var onRoad = rows.some(function(ry){ return Math.abs(y - ry) < CFG.BOX + 6; });
      if (!onRoad) spots.push(y);
    }
    var sl = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.14, 0.24), M.sleeper, spots.length*bed.tracks.length);
    var m = new THREE.Matrix4(), k = 0;
    bed.tracks.forEach(function(tx){
      spots.forEach(function(y){ m.makeTranslation(tx*U, 0.06, y*U); sl.setMatrixAt(k++, m); });
    });
    sl.receiveShadow = true;
    group.add(sl);
  }
  function buildLessonRails(group, sc){
    var M = mats(), rb = new Builder(), gb = new Builder();
    var arm = sc.layout.rails[0], far = 190/U;
    [-11, 11].forEach(function(g){
      var a = armPt(arm, far, g - 0.45, 0, 0), b = armPt(Geo.opposite(arm), far, -g - 0.45, 0, 0);
      var c = armPt(arm, far, g + 0.45, 0, 0);
      rb.box(Math.min(a[0], b[0], c[0])*U, Math.max(a[0], b[0], c[0])*U, 0.02, 0.1,
             Math.min(a[1], b[1], c[1])*U, Math.max(a[1], b[1], c[1])*U, 1);
    });
    var e0 = armPt(arm, far, -22, 0, 0), e1 = armPt(Geo.opposite(arm), far, 22, 0, 0);
    gb.flat(Math.min(e0[0], e1[0]), Math.min(e0[1], e1[1]), Math.max(e0[0], e1[0]), Math.max(e0[1], e1[1]), 0.02, TILE.gravel);
    group.add(rb.mesh(M.rail, true));
    group.add(gb.mesh(M.gravel));
  }
  /* fields, a few trees and farm houses far off, so a lesson's junction
     sits in a landscape rather than on a green plate */
  function buildLessonCountry(group, sc){
    var M = mats(), fb = new Builder();
    fb.flat(-30000, -30000, 30000, 30000, -0.005, TILE.field);
    group.add(fb.mesh(M.field));
    var rand = CityView.rng(4242), trees = [];
    for (var i = 0; i < 90; i++){
      var x = (rand()*2 - 1)*1900, y = (rand()*2 - 1)*1900;
      if (Math.abs(x) < 320 || Math.abs(y) < 320) continue;       // keep sight lines open
      trees.push({ x:x, y:y, h:(8 + rand()*6)*CFG.PPM, r:(2.4 + rand()*1.6)*CFG.PPM, tone:rand() });
    }
    buildTrees(group, trees);
    var P = { wallA:new Builder(), wallB:new Builder(), shop:new Builder(), home:new Builder(),
              gable:new Builder(), roof:new Builder(), eaves:new Builder() };
    var houses = [];
    [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(function(q, k){
      var cx = q[0]*(700 + rand()*500), cy = q[1]*(700 + rand()*500);
      houses.push({ x0:cx, y0:cy, x1:cx + 160, y1:cy + 130, h:(2*3 + 0.6)*CFG.PPM, floors:2, front:'N',
                    color:['#efe7d6','#e6d3b8','#d9c7a6','#f2efe8'][k], roof:'#7a4a3a', roofH:3*CFG.PPM, shop:false, seed:k });
    });
    buildHouses(P, houses);
    [['wallA', M.wallA], ['wallB', M.wallB], ['home', M.home], ['gable', M.gable], ['roof', M.roof], ['eaves', M.kerb]]
      .forEach(function(l){ var m = P[l[0]].mesh(l[1], true); if (m) group.add(m); });
    void sc;
  }
  /* Frankfurt's banking towers, far off to the south */
  function buildSkyline(group, view, map){
    var M = mats(), b = new Builder();
    var cz = 1500, towers = [[-260, 26, 95], [-170, 22, 76], [-110, 20, 88], [-30, 24, 70], [70, 26, 92], [160, 18, 58], [230, 20, 50]];
    towers.forEach(function(t){
      b.box(t[0] - t[1]/2, t[0] + t[1]/2, 0, t[2], cz - t[1]/2, cz + t[1]/2, 8);
    });
    if (!map) cz = 0;
    var mesh = b.mesh(M.tower);
    if (mesh){ mesh.castShadow = false; mesh.receiveShadow = false; group.add(mesh); }
    void view;
  }

  /* ---------------- vehicles ---------------- */
  var paintMats = {};
  function paintMat(color){
    if (paintMats[color]) return paintMats[color];
    paintMats[color] = new THREE.MeshPhysicalMaterial({
      color:color, metalness:0.45, roughness:0.32, clearcoat:1.0, clearcoatRoughness:0.06,
      envMapIntensity: night ? 0.12 : 0.8
    });
    return paintMats[color];
  }
  /* our own bonnet: dark metallic, and not mirroring the whole sky into
     the bottom of the view */
  var own = null;
  function ownPaint(){
    if (!own) own = new THREE.MeshPhysicalMaterial({ color:'#233f63', metalness:0.5, roughness:0.38,
                      clearcoat:0.8, clearcoatRoughness:0.12, envMapIntensity:0.25 });
    return own;
  }
  var VM = null;
  function vehicleMats(){
    if (VM) return VM;
    VM = {
      glass:  new THREE.MeshPhysicalMaterial({ color:0x0d1419, metalness:0.2, roughness:0.04, clearcoat:1, envMapIntensity:1.6 }),
      tyre:   new THREE.MeshStandardMaterial({ color:0x121212, roughness:0.9 }),
      rim:    new THREE.MeshStandardMaterial({ color:0xb9bec5, metalness:0.9, roughness:0.28 }),
      trim:   new THREE.MeshStandardMaterial({ color:0x15171a, roughness:0.55 }),
      chrome: new THREE.MeshStandardMaterial({ color:0xdadde2, metalness:1, roughness:0.15 }),
      head:   new THREE.MeshStandardMaterial({ color:0xf6f3ea, emissive:0xfff3d2, emissiveIntensity:0.15, roughness:0.1 }),
      tail:   new THREE.MeshStandardMaterial({ color:0x5a0a06, emissive:0xff2410, emissiveIntensity:0.25, roughness:0.2 }),
      brake:  new THREE.MeshStandardMaterial({ color:0xff3020, emissive:0xff2410, emissiveIntensity:3.0 }),
      blink:  new THREE.MeshStandardMaterial({ color:0xffa200, emissive:0xffa200, emissiveIntensity:3.0 }),
      blue:   new THREE.MeshStandardMaterial({ color:0x2a6dff, emissive:0x3d7dff, emissiveIntensity:4.0 }),
      blueOff:new THREE.MeshStandardMaterial({ color:0x0b1e44, roughness:0.3 }),
      /* matt black plastic, unlit: it sits in the car's own shade */
      dash:   new THREE.MeshBasicMaterial({ color:0x121314 }),
      tramRed:new THREE.MeshStandardMaterial({ color:0xb8322a, roughness:0.4, metalness:0.2 }),
      grey:   new THREE.MeshStandardMaterial({ color:0x3b3f45, roughness:0.6 }),
      taxi:   null
    };
    return VM;
  }
  var plateCache = {};
  function plateMat(text){
    if (plateCache[text]) return plateCache[text];
    var c = document.createElement('canvas'); c.width = 256; c.height = 56;
    var g = c.getContext('2d');
    g.fillStyle = '#f7f7f2'; g.fillRect(0, 0, 256, 56);
    g.fillStyle = '#123c9c'; g.fillRect(0, 0, 30, 56);
    g.fillStyle = '#ffd400'; g.beginPath(); g.arc(15, 18, 7, 0, Math.PI*2); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 16px Arial'; g.textAlign = 'center'; g.fillText('D', 15, 48);
    g.strokeStyle = '#111'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 253, 53);
    g.fillStyle = '#111'; g.font = 'bold 38px Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(text, 40, 30);
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    return (plateCache[text] = new THREE.MeshStandardMaterial({ map:t, roughness:0.4 }));
  }
  function plateText(id){
    var n = 0; for (var i = 0; i < id.length; i++) n = (n*31 + id.charCodeAt(i)) >>> 0;
    var L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
    return 'F-' + L[n % L.length] + L[(n >> 5) % L.length] + ' ' + (100 + n % 8900);
  }
  function part(geo, mat, x, y, z, parent, shadow){
    var m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (shadow){ m.castShadow = true; }
    parent.add(m);
    return m;
  }
  function extrudeSide(shape, width, bevel){
    var g = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.01, width - 2*bevel), bevelEnabled: true,
      bevelThickness: bevel, bevelSize: bevel*0.7, bevelSegments: 3, curveSegments: 10
    });
    g.translate(0, 0, -(width - 2*bevel)/2);
    g.computeVertexNormals();
    return g;
  }
  var carGeo = {};
  /* a car, facing +x, wheels on y = 0, width along z (+z is its right) */
  function buildCar(v){
    var L = v.len*U, W = v.wid*U, h = L/2;
    var key = L.toFixed(2) + 'x' + W.toFixed(2);
    var G = carGeo[key];
    if (!G){
      var body = new THREE.Shape();
      body.moveTo(-h + 0.08, 0.28);
      body.lineTo(h - 0.16, 0.28);
      body.quadraticCurveTo(h, 0.28, h, 0.44);
      body.lineTo(h, 0.60);
      body.quadraticCurveTo(h - 0.03, 0.76, h - 0.30, 0.80);
      body.lineTo(L*0.21, 0.92);
      body.lineTo(-L*0.41, 0.97);
      body.quadraticCurveTo(-h + 0.02, 0.96, -h, 0.84);
      body.lineTo(-h, 0.44);
      body.quadraticCurveTo(-h, 0.28, -h + 0.08, 0.28);
      /* the glasshouse: windscreen from the scuttle up to the roof, which
         runs back to a sloping rear window - proportions of a family car,
         with the driver's eyes about a metre behind the windscreen base */
      var cab = new THREE.Shape();
      cab.moveTo(L*0.22, 0.90);
      cab.quadraticCurveTo(L*0.12, 1.22, L*0.05, 1.40);
      cab.lineTo(-L*0.27, 1.43);
      cab.quadraticCurveTo(-L*0.38, 1.30, -L*0.44, 0.96);
      cab.lineTo(L*0.22, 0.90);
      var roof = new THREE.Shape();
      roof.moveTo(L*0.065, 1.39); roof.lineTo(-L*0.28, 1.42);
      roof.lineTo(-L*0.28, 1.475); roof.lineTo(L*0.06, 1.445); roof.lineTo(L*0.065, 1.39);
      G = carGeo[key] = {
        body: extrudeSide(body, W, 0.09),
        cab:  extrudeSide(cab, W*0.84, 0.1),
        roof: extrudeSide(roof, W*0.80, 0.04),
        tyre: new THREE.CylinderGeometry(0.33, 0.33, 0.24, 22).rotateX(Math.PI/2),
        rim:  new THREE.CylinderGeometry(0.21, 0.21, 0.02, 16).rotateX(Math.PI/2),
        pillar: new THREE.BoxGeometry(0.12, 0.48, W*0.845),
        lamp: new THREE.BoxGeometry(0.05, 0.11, 0.36),
        lampRear: new THREE.BoxGeometry(0.05, 0.12, 0.40),
        blinker: new THREE.BoxGeometry(0.05, 0.07, 0.12),
        plate: new THREE.PlaneGeometry(0.52, 0.115),
        grille: new THREE.BoxGeometry(0.05, 0.15, W*0.46),
        bumper: new THREE.BoxGeometry(0.1, 0.12, W*0.92),
        mirror: new THREE.BoxGeometry(0.14, 0.1, 0.2)
      };
    }
    var VMs = vehicleMats();
    var paint = v.isPlayer ? ownPaint() : paintMat(v.taxi ? '#efe6c8' : v.color);
    var g = new THREE.Group();
    part(G.body, paint, 0, 0, 0, g, true);
    g.userData.cab = part(G.cab, VMs.glass, 0, 0, 0, g, true);
    g.userData.roofPanel = part(G.roof, paint, 0, 0, 0, g, true);
    g.userData.pillar = part(G.pillar, paint, -L*0.11, 1.17, 0, g, false);
    part(G.grille, VMs.trim, h + 0.005, 0.50, 0, g);
    part(G.bumper, VMs.trim, h - 0.02, 0.32, 0, g);
    part(G.bumper, VMs.trim, -h + 0.02, 0.32, 0, g);
    [-1, 1].forEach(function(side){
      part(G.mirror, paint, L*0.15, 0.98, side*(W/2 + 0.08), g);
    });
    g.userData.wheels = [];
    [[L*0.31, 1], [L*0.31, -1], [-L*0.30, 1], [-L*0.30, -1]].forEach(function(w){
      var wg = new THREE.Group(); wg.position.set(w[0], 0.33, w[1]*(W/2 - 0.12));
      var t = new THREE.Mesh(G.tyre, VMs.tyre); t.castShadow = true; wg.add(t);
      var r = new THREE.Mesh(G.rim, VMs.rim); r.position.z = w[1]*0.12; wg.add(r);
      g.add(wg); g.userData.wheels.push(wg);
    });
    [-1, 1].forEach(function(side){
      part(G.lamp, VMs.head, h - 0.01, 0.64, side*(W/2 - 0.30), g);
      part(G.lampRear, VMs.tail, -h + 0.005, 0.72, side*(W/2 - 0.28), g);
    });
    /* brake lights and indicators: separate lit copies, shown when on */
    g.userData.brake = [-1, 1].map(function(side){
      var m = part(G.lampRear, VMs.brake, -h - 0.004, 0.72, side*(W/2 - 0.28), g); m.visible = false; return m;
    });
    g.userData.blink = { left:[], right:[] };
    [[h - 0.005, 0.64], [-h + 0.0, 0.84]].forEach(function(pos){
      [-1, 1].forEach(function(side){
        var m = part(G.blinker, VMs.blink, pos[0] + (pos[0] > 0 ? 0.01 : -0.012), pos[1], side*(W/2 - 0.1), g);
        m.visible = false;
        g.userData.blink[side < 0 ? 'left' : 'right'].push(m);
      });
    });
    var pm = plateMat(plateText(String(v.id)));
    var pf = part(G.plate, pm, h + 0.06, 0.42, 0, g); pf.rotation.y = Math.PI/2;
    var pr = part(G.plate, pm, -h - 0.02, 0.50, 0, g); pr.rotation.y = -Math.PI/2;
    if (v.taxi){
      var c = document.createElement('canvas'); c.width = 128; c.height = 40;
      var cg = c.getContext('2d'); cg.fillStyle = '#ffe36b'; cg.fillRect(0, 0, 128, 40);
      cg.fillStyle = '#111'; cg.font = 'bold 30px Arial'; cg.textAlign = 'center'; cg.textBaseline = 'middle'; cg.fillText('TAXI', 64, 21);
      var tt = new THREE.CanvasTexture(c); tt.encoding = THREE.sRGBEncoding;
      var sign = part(new THREE.BoxGeometry(0.22, 0.16, 0.5),
        new THREE.MeshStandardMaterial({ map:tt, emissive:0xffe36b, emissiveMap:tt, emissiveIntensity:0.6 }), -L*0.16, 1.55, 0, g);
      sign.rotation.y = Math.PI/2;
    }
    if (v.emergency){
      g.userData.beacons = [-1, 1].map(function(side){
        return part(new THREE.BoxGeometry(0.25, 0.1, 0.35), VMs.blueOff, -L*0.16, 1.52, side*0.22, g);
      });
    }
    return g;
  }
  /* a Frankfurt Stadtbahn car: long, white, a dark window band, red trim */
  function buildTram(v){
    var L = v.len*U, W = v.wid*U, h = L/2, VMs = vehicleMats();
    var s = new THREE.Shape();
    s.moveTo(-h + 0.5, 0.40);
    s.lineTo(h - 0.5, 0.40);
    s.quadraticCurveTo(h, 0.40, h, 1.0);
    s.lineTo(h - 0.25, 2.55);
    s.quadraticCurveTo(h - 0.45, 3.35, h - 1.1, 3.38);
    s.lineTo(-h + 1.1, 3.38);
    s.quadraticCurveTo(-h + 0.45, 3.35, -h + 0.25, 2.55);
    s.lineTo(-h, 1.0);
    s.quadraticCurveTo(-h, 0.40, -h + 0.5, 0.40);
    var g = new THREE.Group();
    part(extrudeSide(s, W, 0.12), paintMat('#ecebe6'), 0, 0, 0, g, true);
    part(new THREE.BoxGeometry(L - 1.4, 1.1, W + 0.03), VMs.glass, 0, 1.95, 0, g);
    [-1, 1].forEach(function(end){                       // the driver's windscreens
      var ws = part(new THREE.BoxGeometry(0.1, 1.05, W*0.86), VMs.glass, end*(h - 0.33), 2.05, 0, g);
      ws.rotation.z = end*0.16;
    });
    part(new THREE.BoxGeometry(L - 0.9, 0.22, W + 0.04), VMs.tramRed, 0, 0.72, 0, g);
    [-0.33, -0.11, 0.11, 0.33].forEach(function(f){
      part(new THREE.BoxGeometry(1.3, 1.95, W + 0.05), VMs.grey, f*L, 1.45, 0, g);
    });
    [-1, 1].forEach(function(end){
      part(new THREE.BoxGeometry(2.4, 0.5, W - 0.3), VMs.trim, end*(h - 3.6), 0.3, 0, g);
    });
    var pan = new THREE.Group(); pan.position.set(-L*0.12, 3.45, 0); g.add(pan);
    part(new THREE.BoxGeometry(1.4, 0.12, 0.9), VMs.grey, 0, 0, 0, pan);
    var arm1 = part(new THREE.BoxGeometry(1.5, 0.05, 0.05), VMs.grey, 0.3, 0.45, 0, pan); arm1.rotation.z = 0.6;
    part(new THREE.BoxGeometry(0.1, 0.05, 1.6), VMs.grey, 0.9, 0.9, 0, pan);
    [-1, 1].forEach(function(end){
      [-1, 1].forEach(function(side){
        part(new THREE.BoxGeometry(0.05, 0.14, 0.3), end > 0 ? VMs.head : VMs.tail, end*(h - 0.02), 0.95, side*(W/2 - 0.35), g);
      });
    });
    g.userData.brake = []; g.userData.blink = { left:[], right:[] }; g.userData.wheels = [];
    return g;
  }
  function buildBus(v){
    var L = v.len*U, W = v.wid*U, VMs = vehicleMats();
    var g = new THREE.Group();
    part(new THREE.BoxGeometry(L, 2.55, W), paintMat(v.color || '#e8e2d4'), 0, 1.6, 0, g, true);
    part(new THREE.BoxGeometry(L - 0.8, 1.0, W + 0.03), VMs.glass, -0.2, 2.1, 0, g);
    part(new THREE.BoxGeometry(0.05, 1.3, W*0.9), VMs.glass, L/2 + 0.01, 2.0, 0, g);
    g.userData.wheels = [];
    [[L*0.32, 1], [L*0.32, -1], [-L*0.25, 1], [-L*0.25, -1]].forEach(function(w){
      var t = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 20).rotateX(Math.PI/2), VMs.tyre);
      t.position.set(w[0], 0.5, w[1]*(W/2 - 0.2)); g.add(t);
    });
    g.userData.brake = [-1, 1].map(function(side){
      var m = part(new THREE.BoxGeometry(0.05, 0.2, 0.25), VMs.brake, -L/2 - 0.01, 0.9, side*(W/2 - 0.2), g); m.visible = false; return m;
    });
    g.userData.blink = { left:[], right:[] };
    [-1, 1].forEach(function(side){
      [L/2 + 0.01, -L/2 - 0.01].forEach(function(x){
        var m = part(new THREE.BoxGeometry(0.05, 0.12, 0.15), VMs.blink, x, 0.9, side*(W/2 - 0.05), g);
        m.visible = false; g.userData.blink[side < 0 ? 'left' : 'right'].push(m);
      });
    });
    return g;
  }
  /* what you see of your own car from the driver's seat */
  function buildCockpit(v, car){
    var L = v.len*U, W = v.wid*U, VMs = vehicleMats();
    car.userData.cab.visible = false;
    car.userData.roofPanel.visible = false;
    car.userData.pillar.visible = false;
    /* the inside: seats, door trims and floor, all dark, covering the top
       of the body we would otherwise be looking down on */
    part(new THREE.BoxGeometry(L*0.44, 0.40, W - 0.10), VMs.dash, -L*0.18, 0.87, 0, car);
    /* the dashboard: a low shelf under the windscreen, a cowl over the
       instruments in front of the driver */
    part(new THREE.BoxGeometry(0.50, 0.16, W - 0.12), VMs.dash, L*0.18, 0.84, 0, car);
    part(new THREE.BoxGeometry(0.26, 0.09, 0.5), VMs.dash, L*0.11, 0.97, -W*0.20, car);
    /* A-pillars along the windscreen edges, roof lining above */
    [-1, 1].forEach(function(side){
      var a = new THREE.Vector3(L*0.22, 0.92, side*(W*0.42)), b = new THREE.Vector3(L*0.05, 1.40, side*(W*0.38));
      var len = a.distanceTo(b);
      var pil = new THREE.Mesh(new THREE.BoxGeometry(0.09, len, 0.13), VMs.dash);
      pil.position.copy(a).add(b).multiplyScalar(0.5);
      pil.lookAt(b); pil.rotateX(Math.PI/2);
      car.add(pil);
    });
    part(new THREE.BoxGeometry(1.4, 0.04, W*0.84), VMs.dash, -L*0.11, 1.41, 0, car);
    part(new THREE.BoxGeometry(0.04, 0.07, 0.26), VMs.dash, L*0.045, 1.31, 0, car);     // mirror
    var wheel = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 10, 36), VMs.dash);
    wheel.position.set(L*0.085, 0.87, -W*0.20);
    wheel.rotation.y = Math.PI/2; wheel.rotation.x = 0; wheel.rotateX(-0.45);
    car.add(wheel);
  }

  function vehicleMesh(v){
    var key = v.id + '|' + v.kind + '|' + (v.taxi ? 't' : v.color);
    var cur = dyn.meshes[v.id];
    if (cur && cur.userData.key === key) return cur;
    if (cur){ scene.remove(cur); }
    var g = v.kind === 'tram' ? buildTram(v) : v.kind === 'bus' ? buildBus(v) : buildCar(v);
    if (v.isPlayer) buildCockpit(v, g);
    g.userData.key = key;
    scene.add(g);
    dyn.meshes[v.id] = g;
    return g;
  }
  function syncVehicles(world, t){
    var seen = {};
    world.vehicles.forEach(function(v){
      if (v.done) return;
      seen[v.id] = true;
      var g = vehicleMesh(v);
      g.position.set(v.pos.x*U, 0, v.pos.y*U);
      g.rotation.y = -v.pos.h;
      (g.userData.wheels || []).forEach(function(w){ w.children[0] && (w.rotation.z = -(v.s*U)/0.33); });
      var blink = (t*2.2) % 1 < 0.55;
      (g.userData.brake || []).forEach(function(m){ m.visible = !!v.brakeLight; });
      var bl = g.userData.blink;
      if (bl){
        bl.left.forEach(function(m){ m.visible = blink && v.indicator === 'left'; });
        bl.right.forEach(function(m){ m.visible = blink && v.indicator === 'right'; });
      }
      if (g.userData.beacons){
        var f = (t*7) % 1 < 0.5, VMs = vehicleMats();
        g.userData.beacons[0].material = f ? VMs.blue : VMs.blueOff;
        g.userData.beacons[1].material = f ? VMs.blueOff : VMs.blue;
      }
    });
    Object.keys(dyn.meshes).forEach(function(id){
      if (!seen[id]){ scene.remove(dyn.meshes[id]); delete dyn.meshes[id]; }
    });
  }
  function syncPeds(world){
    var seen = {};
    world.peds.forEach(function(ped, i){
      var k = 'p' + i;
      if (ped.state === 'done') return;
      seen[k] = true;
      var g = dyn.peds[k];
      if (!g){
        g = new THREE.Group();
        var coat = new THREE.MeshStandardMaterial({ color: ped.kid ? 0xe0863a : 0x3f5373, roughness:0.8 });
        var s = ped.kid ? 0.72 : 1;
        part(new THREE.CylinderGeometry(0.2*s, 0.17*s, 0.7*s, 10), coat, 0, 1.1*s, 0, g, true);
        part(new THREE.CylinderGeometry(0.08*s, 0.08*s, 0.8*s, 8), mats().trunk, -0.08*s, 0.4*s, 0, g, true);
        part(new THREE.CylinderGeometry(0.08*s, 0.08*s, 0.8*s, 8), mats().trunk, 0.08*s, 0.4*s, 0, g, true);
        part(new THREE.SphereGeometry(0.12*s, 12, 10), new THREE.MeshStandardMaterial({ color:0xe2bf9d }), 0, 1.6*s, 0, g, true);
        scene.add(g); dyn.peds[k] = g;
      }
      var pt = ped.point();
      g.position.set(pt.x*U, 0, pt.y*U);
    });
    Object.keys(dyn.peds).forEach(function(k){ if (!seen[k]){ scene.remove(dyn.peds[k]); delete dyn.peds[k]; } });
  }

  /* ---------------- per frame: lights, route, sky ---------------- */
  function syncSignals(world){
    var M = mats();
    built.signals.forEach(function(s){
      var st = Rules.lightFor(s.sc, s.arm, world.t);
      if (st === s.state) return;
      s.state = st;
      s.lenses.red.material    = (st === 'red' || st === 'redyellow') ? M.red : M.lensOff;
      s.lenses.yellow.material = (st === 'yellow' || st === 'redyellow') ? M.amber : M.lensOff;
      s.lenses.green.material  = st === 'green' ? M.green : M.lensOff;
    });
  }
  function placeChevrons(){
    if (!chevrons.length){
      var sh = new THREE.Shape();
      sh.moveTo(1.3, 0); sh.lineTo(-0.7, -1.05); sh.lineTo(-0.2, 0); sh.lineTo(-0.7, 1.05); sh.lineTo(1.3, 0);
      var geo = new THREE.ShapeGeometry(sh).rotateX(Math.PI/2);
      for (var i = 0; i < 9; i++){
        var m = new THREE.Mesh(geo, mats().chevron);
        m.renderOrder = 2;
        chevrons.push(m);
      }
    }
    chevrons.forEach(function(c){ scene.add(c); });
  }
  function syncChevrons(world){
    var p = world.player, k = 0;
    for (var s = p.s + 70; s < Math.min(p.path.length, p.s + 620) && k < chevrons.length; s += 62, k++){
      var q = p.path.at(s);
      chevrons[k].visible = true;
      chevrons[k].position.set(q.x*U, 0.06, q.y*U);
      chevrons[k].rotation.y = -q.h;
    }
    for (; k < chevrons.length; k++) chevrons[k].visible = false;
  }
  function syncNightLights(world){
    var M = mats();
    [M.wallA, M.wallB, M.home].forEach(function(m){ m.emissiveIntensity = night ? 1.25 : 0; });
    /* the studio-lit reflection map is for glossy paint and glass; on
       stone, plaster and leaves it would just flood everything with light */
    if (envLevel !== night){
      envLevel = night;
      Object.keys(M).forEach(function(k){
        if (M[k].isMeshStandardMaterial) M[k].envMapIntensity = night ? 0.03 : 0.28;
      });
      var V = vehicleMats();
      Object.keys(V).forEach(function(k){
        if (V[k] && V[k].isMeshStandardMaterial) V[k].envMapIntensity = night ? 0.15 : (k === 'glass' ? 1.4 : 0.6);
      });
    }
    M.shop.emissiveIntensity = night ? 0.9 : 0;
    M.lampHead.emissiveIntensity = night ? 3.0 : 0;
    M.tower.emissiveIntensity = night ? 0.25 : 0;
    var VMs = vehicleMats();
    VMs.head.emissiveIntensity = night ? 2.5 : 0.15;
    VMs.tail.emissiveIntensity = night ? 1.4 : 0.25;
    /* move the real lights onto the lamps nearest the car */
    var p = world.player, px = p.pos.x*U, pz = p.pos.y*U;
    var near = built.lamps.slice().sort(function(a, b){
      return Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz);
    });
    lampLights.forEach(function(l, i){
      if (!night || !near[i]){ l.intensity = 0; return; }
      l.intensity = 3; l.position.copy(near[i]);
    });
  }
  function syncTheme(){
    if (typeof getComputedStyle !== 'function') return;
    var v = getComputedStyle(document.documentElement).getPropertyValue('--sky-1').trim().replace('#','');
    if (v.length === 3) v = v[0]+v[0]+v[1]+v[1]+v[2]+v[2];
    var n = parseInt(v, 16);
    night = isNaN(n) ? true : (0.2126*((n>>16)&255) + 0.7152*((n>>8)&255) + 0.0722*(n&255))/255 < 0.3;
    if (!scene) return;
    if (night){
      sky.visible = false;
      scene.background = new THREE.Color(0x0b1220);
      scene.fog = new THREE.FogExp2(0x0e1624, 0.0085);
      hemi.color.set(0x5a6f99); hemi.groundColor.set(0x1a1814); hemi.intensity = 0.32;
      sun.color.set(0x9fb4ff); sun.intensity = 0.28;
      renderer.toneMappingExposure = 1.05;
      scene.environment = envDay;
      Object.keys(paintMats).forEach(function(k){ paintMats[k].envMapIntensity = 0.12; });
    } else {
      sky.visible = true;
      scene.background = null;
      scene.fog = new THREE.FogExp2(0xc9d6e2, 0.0042);
      hemi.color.set(0xcfe3ff); hemi.groundColor.set(0x5b5346); hemi.intensity = 0.75;
      sun.color.set(0xfff1dc); sun.intensity = 2.3;
      renderer.toneMappingExposure = 0.95;
      scene.environment = envDay;
      Object.keys(paintMats).forEach(function(k){ paintMats[k].envMapIntensity = 0.8; });
    }
    var el = THREE.MathUtils.degToRad(night ? 20 : 38), az = THREE.MathUtils.degToRad(215);
    sunDir.setFromSphericalCoords(1, Math.PI/2 - el, az);
    sky.material.uniforms.sunPosition.value.copy(sunDir);
  }
  var sunDir = new (typeof THREE !== 'undefined' ? THREE.Vector3 : Object)();
  var envLevel = null;

  /* ---------------- main entry ---------------- */
  function frame(world, yaw, w, h){
    if (!available()) return false;
    if (!built || built.world !== world) buildWorld(world);
    if (w !== lastW || h !== lastH){
      renderer.setSize(w, h, false);
      lastW = w; lastH = h;
    }
    var p = world.player, c = Math.cos(p.pos.h), s = Math.sin(p.pos.h);
    /* the driver: just behind the car's middle, on the left */
    var back = -0.028*p.len;
    var ex = p.pos.x + c*back + s*(p.wid*0.20);
    var ey = p.pos.y + s*back - c*(p.wid*0.20);
    camera.position.set(ex*U, EYE_H, ey*U);
    camera.rotation.set(-0.035, -(p.pos.h + (yaw || 0)) - Math.PI/2, 0);
    var aspect = w / Math.max(1, h);
    var vfov = 2*Math.atan(Math.tan(FOV_H*Math.PI/360) / aspect) * 180/Math.PI;
    /* about what you see from a real driver's seat; on a tall screen the
       view narrows sideways rather than growing a fish-eye roof and floor */
    camera.fov = Math.min(60, Math.max(38, vfov));
    camera.aspect = aspect;
    camera.updateProjectionMatrix();

    syncVehicles(world, world.t);
    syncPeds(world);
    syncSignals(world);
    syncChevrons(world);
    syncNightLights(world);
    built.stations.forEach(function(st){ st.rotation.y = Math.atan2(camera.position.x - st.position.x, camera.position.z - st.position.z); });

    /* the sun's shadow box follows the car */
    var cx = p.pos.x*U, cz = p.pos.y*U;
    sun.target.position.set(cx + c*25, 0, cz + s*25);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 150);
    /* our own headlights after dark */
    headlamp.intensity = night ? 18 : 0;
    headlamp.position.set(cx + c*2.2, 0.75, cz + s*2.2);
    headlamp.target.position.set(cx + c*30, 0, cz + s*30);

    renderer.render(scene, camera);
    return true;
  }

  return { available:available, frame:frame, syncTheme:syncTheme,
           /* for poking at the scene from the browser console */
           debug:function(){ return { scene:scene, camera:camera, renderer:renderer, dyn:dyn }; } };
})();
