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

  var ok = null, renderer = null, canvas = null, clouds = null;
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
    camera.layers.enable(1);                            // people (see PEOPLE_LAYER)

    hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5b5346, 0.75);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    sun.castShadow = true;
    var small = Math.min(window.innerWidth, window.innerHeight) < 700;
    sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    var sc = sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.camera.layers.enable(1);                 // people cast shadows too
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

    /* fair-weather clouds, far off, drifting with the car like the sky */
    clouds = new THREE.Group();
    var cc = document.createElement('canvas'); cc.width = 256; cc.height = 128;
    var cg = cc.getContext('2d');
    for (var b = 0; b < 14; b++){
      var bx = 40 + Math.random()*176, by = 50 + Math.random()*40, br = 18 + Math.random()*30;
      var gr = cg.createRadialGradient(bx, by, 0, bx, by, br);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      cg.fillStyle = gr; cg.fillRect(0, 0, 256, 128);
    }
    var ctx2 = new THREE.CanvasTexture(cc); ctx2.encoding = THREE.sRGBEncoding;
    var cmat = new THREE.SpriteMaterial({ map:ctx2, transparent:true, depthWrite:false, fog:false, opacity:0.85 });
    for (var k = 0; k < 16; k++){
      var sp = new THREE.Sprite(cmat);
      var a = k/16*Math.PI*2 + Math.random()*0.3, d = 900 + Math.random()*500;
      sp.position.set(Math.cos(a)*d, 160 + Math.random()*180, Math.sin(a)*d);
      sp.scale.set(360 + Math.random()*260, 120 + Math.random()*70, 1);
      clouds.add(sp);
    }
    scene.add(clouds);

    loadTextures();
    loadPeople();
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
      cycle:   std({ color:0xc2604a, roughness:0.9 }),          // red cycle-path asphalt
      manhole: std({ color:0x2e2d2b, metalness:0.6, roughness:0.55 }),
      hedge:   std({ color:0x4f6e3c, roughness:1.0 }),
      balc:    std({ color:0xd8d4cc, roughness:0.85 }),
      railing: std({ color:0xcfd2d4, metalness:0.35, roughness:0.45 }),     // light painted metal
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
    [['asphalt','asphalt'], ['cycle','asphalt'], ['pavers','pavers'], ['gravel','gravel'], ['grass','grass'], ['field','grass'], ['kerb','pavers'],
     ['hedge','grass'], ['balc','plaster']]
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
    if (sc.x !== undefined) return City.HOLD - 3;
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

    /* rounded corners in town: asphalt fills the curve between two streets
       and the kerb follows it, 4 m radius - the same shape the examiner's
       kerb check uses (City.Map.offRoad) */
    var R = City.CORNER_R, fillet = {};
    if (city && !ring){
      [['N','E'], ['E','S'], ['S','W'], ['W','N']].forEach(function(pr){
        if (L.arms.indexOf(pr[0]) < 0 || L.arms.indexOf(pr[1]) < 0) return;
        fillet[pr[0] + pr[1]] = fillet[pr[1] + pr[0]] = true;
        var a = Geo.ARM_VEC[pr[0]], b = Geo.ARM_VEC[pr[1]];
        var cx = ox + (a.x + b.x)*(B + R), cy = oy + (a.y + b.y)*(B + R);
        var px = ox + (a.x + b.x)*B, py = oy + (a.y + b.y)*B;
        var N = 9, prev = null;
        for (var k = 0; k <= N; k++){
          var t = k/N*Math.PI/2;
          var dx = -b.x*Math.cos(t) - a.x*Math.sin(t), dy = -b.y*Math.cos(t) - a.y*Math.sin(t);
          var pt = { x:cx + dx*R, y:cy + dy*R, dx:dx, dy:dy };
          if (prev){
            road.tri([px*U, 0.03, py*U], [prev.x*U, 0.03, prev.y*U], [pt.x*U, 0.03, pt.y*U], [0,1,0], [[0,0],[1,0],[0,1]]);
            /* the kerb's face towards the road, and its top */
            var nx = -(prev.dx + pt.dx)/2, ny = -(prev.dy + pt.dy)/2;
            kerb.quad([prev.x*U, 0, prev.y*U], [pt.x*U, 0, pt.y*U], [pt.x*U, KERB_H, pt.y*U], [prev.x*U, KERB_H, prev.y*U],
                      [nx, 0, ny], [[0,0],[1,0],[1,1],[0,1]]);
            var ix0 = cx + prev.dx*(R - KERB_W), iy0 = cy + prev.dy*(R - KERB_W);
            var ix1 = cx + pt.dx*(R - KERB_W), iy1 = cy + pt.dy*(R - KERB_W);
            kerb.quad([prev.x*U, KERB_H, prev.y*U], [pt.x*U, KERB_H, pt.y*U], [ix1*U, KERB_H, iy1*U], [ix0*U, KERB_H, iy0*U],
                      [0,1,0], [[0,0],[1,0],[1,1],[0,1]]);
          }
          prev = pt;
        }
      });
    }

    /* kerbs: along both sides of every arm, across the mouth of any arm
       that is missing (a T-junction), and not across the U-Bahn's bed */
    Geo.ARM_ORDER.forEach(function(arm){
      var has = L.arms.indexOf(arm) >= 0;
      if (has){
        [-1, 1].forEach(function(side){
          /* which street lies on this side of the arm - if it is there,
             the corner between them is rounded and the kerb starts after it */
          var q = Geo.rot90cw(Geo.ARM_VEC[arm]);
          var sideArm = Geo.ARM_ORDER.filter(function(a2){
            return Geo.ARM_VEC[a2].x === q.x*side && Geo.ARM_VEC[a2].y === q.y*side;
          })[0];
          var start = ring ? CFG.RING + B + 10 : (fillet[arm + sideArm] ? B + R : B);
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
      if (hasCross && !city) lineX = Math.max(lineX, Sim.CROSS_MID + Sim.CROSS_HALF + 12);
      if (lit || sign === 'stop') armFlat(paint, arm, lineX, -B, lineX + 6, 0, ox, oy, 0.045);
      /* in town the people cross just outside the junction box: a zebra
         where there is one, the broken lines of a Furt at the lights */
      if (city && !(sc.rail && arm === sc.rail.side)){
        if (hasCross){
          for (var zy = -B + 4; zy < B - 3; zy += 14) armFlat(paint, arm, City.CW.in, zy, City.CW.out, zy + 7, ox, oy, 0.045);
        } else if (sc.lights){
          for (var fy = -B; fy < B; fy += 10){
            armFlat(paint, arm, City.CW.in, fy, City.CW.in + 1.6, fy + 5, ox, oy, 0.045);
            armFlat(paint, arm, City.CW.out - 1.6, fy, City.CW.out, fy + 5, ox, oy, 0.045);
          }
        }
      }
      else if (sign === 'yield' || sign === 'ringentry' || sign === 'exit'){
        /* the Haifischzähne: a row of white triangles */
        for (var y = -B + 3; y < -4; y += 12){
          var p0 = armPt(arm, lineX + 9, y, ox, oy), p1 = armPt(arm, lineX + 9, y + 8, ox, oy), p2 = armPt(arm, lineX, y + 4, ox, oy);
          paint.tri([p0[0]*U,0.045,p0[1]*U], [p1[0]*U,0.045,p1[1]*U], [p2[0]*U,0.045,p2[1]*U], [0,1,0], [[0,0],[1,0],[0,1]]);
        }
      }
      if (hasCross && !city){
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
      bike:new Builder(), bikeX:new Builder(),
      hedge:new Builder(), balc:new Builder(), rail:new Builder(),
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
      buildBikePaths(P, map);
      buildHouses(P, view.houses);
      buildStreetBits(P, group, view);
      buildParked(group, view);
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
      ['bike', M.cycle], ['bikeX', M.cycle],
      ['hedge', M.hedge, true], ['balc', M.balc, true], ['rail', M.railing],
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

  /* the red cycle paths along the main roads, and where they cross a side
     street: red over the asphalt, with the broken white edges of a
     Radfahrerfurt */
  function buildBikePaths(P, map){
    CityView.bikePaths(map).forEach(function(bp){
      var h = bp.half;
      P.bike.flat(Math.min(bp.a.x, bp.b.x) - (bp.col ? h : 0), Math.min(bp.a.y, bp.b.y) - (bp.col ? 0 : h),
                  Math.max(bp.a.x, bp.b.x) + (bp.col ? h : 0), Math.max(bp.a.y, bp.b.y) + (bp.col ? 0 : h),
                  0.02, TILE.asphalt);
      var from = bp.lane.from, off = bp.lane.off;
      var dir = { x:-Geo.ARM_VEC[from].x, y:-Geo.ARM_VEC[from].y }, right = Geo.rot90cw(dir);
      var side = Geo.ARM_ORDER.filter(function(a){
        return Geo.ARM_VEC[a].x === right.x && Geo.ARM_VEC[a].y === right.y;
      })[0];
      bp.nodes.forEach(function(n){
        if (n.arms.indexOf(side) < 0) return;
        function pt(t, lat){ return [n.x + dir.x*t + right.x*lat, n.y + dir.y*t + right.y*lat]; }
        var e = CFG.BOX + 7, p0 = pt(-e, off - h), p1 = pt(e, off + h);
        P.bikeX.flat(Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1]), 0.036, TILE.asphalt);
        for (var t = -e; t < e; t += 9){
          [off - h, off + h - 1.4].forEach(function(lat){
            var q0 = pt(t, lat), q1 = pt(t + 4.5, lat + 1.4);
            P.paint.flat(Math.min(q0[0], q1[0]), Math.min(q0[1], q1[1]), Math.max(q0[0], q1[0]), Math.max(q0[1], q1[1]), 0.045);
          });
        }
      });
    });
  }

  /* ---------------- merging many copies into one mesh ---------------- */
  /* A hundred parked cars as separate objects would be thousands of draw
     calls; baked into one mesh per material they are a handful. */
  function Merger(){ this.pos = []; this.nor = []; this.col = []; this.idx = []; }
  Merger.prototype.add = function(geo, m4, color){
    var p = geo.attributes.position, n = geo.attributes.normal, base = this.pos.length/3, i;
    var nm = new THREE.Matrix3().getNormalMatrix(m4), v = new THREE.Vector3();
    for (i = 0; i < p.count; i++){
      v.fromBufferAttribute(p, i).applyMatrix4(m4); this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); this.nor.push(v.x, v.y, v.z);
      if (color) this.col.push(color.r, color.g, color.b);
    }
    if (geo.index){ for (i = 0; i < geo.index.count; i++) this.idx.push(base + geo.index.getX(i)); }
    else for (i = 0; i < p.count; i++) this.idx.push(base + i);
  };
  Merger.prototype.mesh = function(mat, shadow){
    if (!this.idx.length) return null;
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx.length > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : this.idx);
    g.computeBoundingSphere();
    var m = new THREE.Mesh(g, mat);
    m.castShadow = !!shadow; m.receiveShadow = true; m.matrixAutoUpdate = false;
    return m;
  };

  /* cars parked along the quiet streets, half up on the kerb */
  function buildParked(group, view){
    if (!view.parked.length) return;
    var VMs = vehicleMats();
    var paint = new Merger(), glass = new Merger(), tyres = new Merger(), rims = new Merger(), trim = new Merger(), tail = new Merger();
    var m = new THREE.Matrix4(), part = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1,1,1), pv = new THREE.Vector3();
    var col = new THREE.Color();
    view.parked.forEach(function(pc){
      var G = carGeometry(TYPE_NAMES[pc.type], CFG.CAR_L*U, CFG.CAR_W*U), T = G.T, L = G.L, W = G.W, h = L/2;
      /* a little up on the kerb, the kerb side a touch higher */
      m.compose(pv.set(pc.x*U, 0.03, pc.y*U), q.setFromAxisAngle(new THREE.Vector3(0,1,0), -pc.h), s);
      col.set(pc.color);
      function at(geo, x, y, z, into, c){ part.makeTranslation(x, y, z).premultiply(m); into.add(geo, part, c); }
      at(G.body, 0, 0, 0, paint, col);
      at(G.roof, 0, 0, 0, paint, col);
      if (G.panel) at(G.panel, -L*0.19, (G.top + 1.14)/2, 0, paint, col);
      at(G.cab, 0, 0, 0, glass);
      [[L*0.31, 1], [L*0.31, -1], [-L*0.30, 1], [-L*0.30, -1]].forEach(function(w){
        at(G.tyre, w[0], T.wheelR, w[1]*(W/2 - 0.1), tyres);
        at(G.rim, w[0], T.wheelR, w[1]*(W/2 - 0.1) + w[1]*0.12, rims);
      });
      [L*0.31, -L*0.30].forEach(function(x){ at(G.liner, x, T.wheelR*2 + 0.04, 0, trim); });
      at(G.bumper, h - 0.02, T.ride + 0.04, 0, trim);
      at(G.bumper, -h + 0.02, T.ride + 0.04, 0, trim);
      at(G.grille, h + 0.005, T.ride + 0.22, 0, trim);
      if (T.sill) at(G.sill, 0, T.ride + 0.08, 0, trim);
      [-1, 1].forEach(function(side){
        at(G.lampRear, -h + 0.005, T.tailY, side*(W/2 - 0.28), tail);
        at(G.mirror, T.cab[0][0]*L - 0.08, T.cab[0][1] + 0.08, side*(W/2 + 0.09), paint, col);
      });
    });
    var parkedPaint = new THREE.MeshPhysicalMaterial({ vertexColors:true, metalness:0.45, roughness:0.34,
                                                        clearcoat:1, clearcoatRoughness:0.08, envMapIntensity:0.8 });
    parkedPaintMat = parkedPaint;
    [[paint, parkedPaint, true], [glass, VMs.glass, true], [tyres, VMs.tyre, true], [rims, VMs.rim],
     [trim, VMs.trim], [tail, VMs.tail]].forEach(function(p){
      var mesh = p[0].mesh(p[1], p[2]);
      if (mesh) group.add(mesh);
    });
  }
  var parkedPaintMat = null;

  /* front-garden hedges, balconies on the street side, manhole covers */
  function buildStreetBits(P, group, view){
    view.houses.forEach(function(hs){
      if (hs.hedge){
        var hd = hs.hedge;
        P.hedge.box(hd.x0*U, hd.x1*U, 0, 0.95 + (hs.seed % 5)*0.06, hd.y0*U, hd.y1*U, 1.5);
      }
      if (!hs.balcony) return;
      var x0 = hs.x0*U, x1 = hs.x1*U, z0 = hs.y0*U, z1 = hs.y1*U;
      var alongX = hs.front === 'N' || hs.front === 'S';
      var mid = alongX ? (x0 + x1)/2 : (z0 + z1)/2;
      var wall = hs.front === 'N' ? z0 : hs.front === 'S' ? z1 : hs.front === 'W' ? x0 : x1;
      var out = (hs.front === 'N' || hs.front === 'W') ? -1 : 1;
      for (var f = 1; f < hs.floors; f++){
        var y = f*FLOOR;
        var a = wall, b = wall + out*1.25, lo = Math.min(a, b), hi = Math.max(a, b);
        if (alongX){
          P.balc.box(mid - 1.4, mid + 1.4, y - 0.15, y, lo, hi, 1);
          P.rail.box(mid - 1.4, mid + 1.4, y, y + 1.0, out < 0 ? lo : hi - 0.05, out < 0 ? lo + 0.05 : hi, 1);
          P.rail.box(mid - 1.4, mid - 1.35, y, y + 1.0, lo, hi, 1);
          P.rail.box(mid + 1.35, mid + 1.4, y, y + 1.0, lo, hi, 1);
        } else {
          P.balc.box(lo, hi, y - 0.15, y, mid - 1.4, mid + 1.4, 1);
          P.rail.box(out < 0 ? lo : hi - 0.05, out < 0 ? lo + 0.05 : hi, y, y + 1.0, mid - 1.4, mid + 1.4, 1);
          P.rail.box(lo, hi, y, y + 1.0, mid - 1.4, mid - 1.35, 1);
          P.rail.box(lo, hi, y, y + 1.0, mid + 1.35, mid + 1.4, 1);
        }
      }
    });
    if (view.manholes.length){
      var mh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.34, 0.34, 0.02, 20), mats().manhole, view.manholes.length);
      var mm = new THREE.Matrix4();
      view.manholes.forEach(function(p, i){ mm.makeTranslation(p.x*U, 0.036, p.y*U); mh.setMatrixAt(i, mm); });
      mh.receiveShadow = true;
      group.add(mh);
    }
  }

  /* ---------------- people on the pavements ---------------- */
  /* each walker keeps their own figure; only the nearest few are drawn */
  var walkerShown = [], walkerAll = [], walkerTown = null;
  function syncWalkers(world){
    walkerShown.forEach(function(g){ g.visible = false; });
    walkerShown = [];
    if (!world.map) return;
    var view = CityView.build(world.map), p = world.player, t = world.t;
    if (walkerTown !== view){                       // a new drive: clear out the last town's people
      walkerAll.forEach(function(g){ scene.remove(g); });
      walkerAll = []; walkerTown = view;
    }
    var near = view.walkers.map(function(wk){
      var at = CityView.walkerAt(wk, t);
      return { wk:wk, at:at, d:Math.hypot(at.x - p.pos.x, at.y - p.pos.y) };
    }).filter(function(o){ return o.d < 150*CFG.PPM; })
      .sort(function(a, b){ return a.d - b.d; }).slice(0, 28);
    near.forEach(function(o){
      var g = o.wk._mesh;
      if (g && people.ready && g.userData.version !== people.version){ scene.remove(g); g = null; }
      if (!g || g.parent !== scene){ g = o.wk._mesh = buildPerson(o.wk.look, false); scene.add(g); walkerAll.push(g); }
      g.visible = true;
      g.position.set(o.at.x*U, 0.02, o.at.y*U);
      g.rotation.y = -o.at.h;
      swing(g, 0.42, t);
      walkerShown.push(g);
    });
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
      drl:    new THREE.MeshStandardMaterial({ color:0xffffff, emissive:0xf4f8ff, emissiveIntensity:1.6 }),
      tail:   new THREE.MeshStandardMaterial({ color:0x5a0a06, emissive:0xff2410, emissiveIntensity:0.25, roughness:0.2 }),
      brake:  new THREE.MeshStandardMaterial({ color:0xff3020, emissive:0xff2410, emissiveIntensity:3.0 }),
      blink:  new THREE.MeshStandardMaterial({ color:0xffa200, emissive:0xffa200, emissiveIntensity:3.0 }),
      blue:   new THREE.MeshStandardMaterial({ color:0x2a6dff, emissive:0x3d7dff, emissiveIntensity:4.0 }),
      blueOff:new THREE.MeshStandardMaterial({ color:0x0b1e44, roughness:0.3 }),
      /* dark grey, slightly grained plastic: lit, so it has shape, but dull */
      dash:   new THREE.MeshStandardMaterial({ color:0x232428, roughness:0.95, metalness:0, envMapIntensity:0.15 }),
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
  /* ---------------- car bodies ---------------- */
  /* Five shapes you see on any German street: hatchback (a Golf), saloon,
     estate (a Passat Variant), SUV and a small van. Each is a side profile
     - x in fractions of the length from its middle, y in metres - drawn
     through and then rounded, and a glasshouse on top. */
  var CAR_TYPES = {
    hatch: { len:0.93, ride:0.28, wheelR:0.32, lampY:0.66, tailY:0.82, glassW:0.84,
      body:[[-.48,.28],[.47,.28],[.5,.42],[.5,.62],[.44,.80],[.22,.92],[-.44,.98],[-.5,.96],[-.5,.45]],
      cab: [[.23,.90],[.13,1.24],[.05,1.44],[-.36,1.46],[-.47,1.25],[-.49,.97]],
      roof:[.065, -.37] },
    sedan: { len:1.0, ride:0.28, wheelR:0.33, lampY:0.64, tailY:0.74, glassW:0.84,
      body:[[-.48,.28],[.47,.28],[.5,.42],[.5,.62],[.43,.80],[.21,.92],[-.41,.97],[-.5,.90],[-.5,.45]],
      cab: [[.22,.90],[.12,1.22],[.05,1.40],[-.27,1.43],[-.38,1.30],[-.44,.96]],
      roof:[.065, -.28] },
    estate: { len:1.05, ride:0.28, wheelR:0.33, lampY:0.64, tailY:0.82, glassW:0.84,
      body:[[-.48,.28],[.47,.28],[.5,.42],[.5,.62],[.43,.80],[.21,.92],[-.46,.98],[-.5,.95],[-.5,.45]],
      cab: [[.22,.90],[.12,1.22],[.05,1.41],[-.42,1.43],[-.48,1.30],[-.49,.97]],
      roof:[.065, -.43] },
    suv: { len:1.03, ride:0.38, wheelR:0.37, lampY:0.84, tailY:0.98, glassW:0.84,
      body:[[-.48,.38],[.46,.38],[.5,.55],[.5,.82],[.43,.98],[.20,1.08],[-.45,1.12],[-.5,1.08],[-.5,.55]],
      cab: [[.21,1.06],[.10,1.42],[.03,1.66],[-.41,1.68],[-.47,1.45],[-.49,1.12]],
      roof:[.045, -.42], sill:true },
    van: { len:1.12, ride:0.34, wheelR:0.36, lampY:0.76, tailY:0.95, glassW:0.9,
      body:[[-.48,.34],[.47,.34],[.5,.50],[.5,.78],[.45,.98],[.34,1.06],[-.49,1.10],[-.5,1.05],[-.5,.50]],
      cab: [[.35,1.04],[.26,1.60],[.22,1.90],[-.49,1.92],[-.50,1.10]],
      roof:[.23, -.49], panel:true }
  };
  var TYPE_NAMES = ['hatch', 'sedan', 'estate', 'suv', 'van'];
  function typeFor(v){
    if (v.isPlayer || v.taxi || v.emergency) return 'sedan';
    var n = 0, id = String(v.id);
    for (var i = 0; i < id.length; i++) n = (n*31 + id.charCodeAt(i)) >>> 0;
    return TYPE_NAMES[[0,0,0,1,1,2,2,3,3,4][n % 10]];     // plenty of hatchbacks, fewer vans
  }
  function profileShape(pts, L){
    var sm = Geo.smooth(pts.concat([pts[0]]).map(function(p){ return { x:p[0]*L, y:p[1] }; }), 2);
    var s = new THREE.Shape();
    sm.forEach(function(p, i){ if (i) s.lineTo(p.x, p.y); else s.moveTo(p.x, p.y); });
    return s;
  }
  /* the body's side profile with its sill cut up round both wheels, so
     the tyres show in their arches as on a real car */
  function bodyWithArches(T, L){
    var R = T.wheelR + 0.05, out = [T.body[0]];
    [-0.30, 0.31].forEach(function(xf){
      var xc = xf*L;
      for (var k = 0; k <= 10; k++){
        var x = xc - R + 2*R*k/10;
        var y = Math.max(T.ride, T.wheelR + Math.sqrt(Math.max(0, R*R - (x - xc)*(x - xc))));
        out.push([x/L, y]);
      }
    });
    return out.concat(T.body.slice(1));
  }
  var carGeo = {};
  function carGeometry(type, L0, W){
    var T = CAR_TYPES[type], L = L0*T.len, key = type + L.toFixed(2) + 'x' + W.toFixed(2);
    if (carGeo[key]) return carGeo[key];
    var cab = T.cab, top = cab.reduce(function(m, p){ return Math.max(m, p[1]); }, 0);
    var rf = T.roof;
    var roof = new THREE.Shape();
    roof.moveTo(rf[0]*L, top - 0.03); roof.lineTo(rf[1]*L, top - 0.01);
    roof.lineTo(rf[1]*L, top + 0.045); roof.lineTo((rf[0] - 0.005)*L, top + 0.025);
    var G = {
      T:T, L:L, W:W, top:top,
      body: extrudeSide(profileShape(bodyWithArches(T, L), L), W, 0.09),
      cab:  extrudeSide(profileShape(T.cab, L), W*T.glassW, 0.1),
      roof: extrudeSide(roof, W*(T.glassW - 0.04), 0.04),
      /* a tyre with a rounded sidewall: a fat torus, the rim filling its middle */
      tyre: new THREE.TorusGeometry(T.wheelR - 0.1, 0.105, 10, 28).scale(1, 1, 1.1),
      seam: new THREE.BoxGeometry(0.012, 0.5, 0.008),
      handle: new THREE.BoxGeometry(0.15, 0.03, 0.025),
      rail: new THREE.BoxGeometry(L*0.5, 0.035, 0.04),
      exhaust: new THREE.CylinderGeometry(0.035, 0.035, 0.14, 10).rotateZ(Math.PI/2),
      rim:  new THREE.CylinderGeometry(T.wheelR*0.62, T.wheelR*0.62, 0.03, 20).rotateX(Math.PI/2),
      spoke: new THREE.BoxGeometry(T.wheelR*1.1, 0.045, 0.02),
      hub:  new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10).rotateX(Math.PI/2),
      liner: new THREE.BoxGeometry((T.wheelR + 0.05)*2, 0.02, W - 0.16),
      pillar: new THREE.BoxGeometry(0.12, (top - T.body[6][1])*0.95, W*(T.glassW + 0.005)),
      lamp: new THREE.BoxGeometry(0.05, 0.10, 0.38),
      drl:  new THREE.BoxGeometry(0.04, 0.02, 0.34),
      lampRear: new THREE.BoxGeometry(0.05, 0.11, 0.40),
      blinker: new THREE.BoxGeometry(0.05, 0.07, 0.12),
      plate: new THREE.PlaneGeometry(0.52, 0.115),
      grille: new THREE.BoxGeometry(0.05, 0.14, W*0.46),
      bumper: new THREE.BoxGeometry(0.1, 0.13, W*0.94),
      sill: new THREE.BoxGeometry(L*0.62, 0.14, W + 0.04),
      mirror: new THREE.BoxGeometry(0.16, 0.11, 0.22),
      mirrorGlass: new THREE.PlaneGeometry(0.15, 0.09),
      panel: T.panel ? new THREE.BoxGeometry(L*0.60, top - 1.14, W*T.glassW + 0.03) : null
    };
    return (carGeo[key] = G);
  }
  /* Every fixed part of one body type, merged by material. Built once per
     type and shared by every car of that type. The windscreen and the
     roof (with the door pillar) are kept apart so the player's own car
     can hide them from inside. */
  function bakedCar(type, G){
    if (G.baked) return G.baked;
    var T = G.T, L = G.L, W = G.W, h = L/2, C = {};
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pv = new THREE.Vector3(), sv = new THREE.Vector3();
    function put(key, geo, x, y, z, ry, sy, rz){
      m4.compose(pv.set(x, y, z), q.setFromEuler(e.set(0, ry || 0, rz || 0)), sv.set(1, sy || 1, 1));
      (C[key] || (C[key] = new Merger())).add(geo, m4);
    }
    put('paint', G.body, 0, 0, 0);
    put('glass', G.cab, 0, 0, 0);
    put('cabPaint', G.roof, 0, 0, 0);
    put('cabPaint', G.pillar, (T.roof[0] + T.roof[1])*0.42*L, (G.top + T.body[6][1])/2, 0);
    if (G.panel) put('paint', G.panel, -L*0.19, (G.top + 1.14)/2, 0);      // a panel van's blind sides
    if (T.sill) put('trim', G.sill, 0, T.ride + 0.08, 0);
    put('trim', G.grille, h + 0.005, T.ride + 0.22, 0);
    put('trim', G.bumper, h - 0.02, T.ride + 0.04, 0);
    put('trim', G.bumper, -h + 0.02, T.ride + 0.04, 0);
    var mirX = T.cab[0][0]*L - 0.08, mirY = T.cab[0][1] + 0.08;
    [-1, 1].forEach(function(side){
      put('paint', G.mirror, mirX, mirY, side*(W/2 + 0.09));
      put('glass', G.mirrorGlass, mirX - 0.081, mirY, side*(W/2 + 0.09), -Math.PI/2);
    });
    [[L*0.31, 1], [L*0.31, -1], [-L*0.30, 1], [-L*0.30, -1]].forEach(function(w){
      var zc = w[1]*(W/2 - 0.1);
      put('tyre', G.tyre, w[0], T.wheelR, zc);
      put('rim', G.rim, w[0], T.wheelR, zc + w[1]*0.12);
      for (var k = 0; k < 5; k++) put('rim', G.spoke, w[0], T.wheelR, zc + w[1]*0.135, 0, 1, k*Math.PI/5);
      put('trim', G.hub, w[0], T.wheelR, zc + w[1]*0.14);
    });
    /* dark liners in the arches, so you never see through the car */
    [L*0.31, -L*0.30].forEach(function(x){ put('trim', G.liner, x, T.wheelR*2 + 0.04, 0); });
    /* the doors: shut lines where they meet, a handle on each */
    var belt = T.cab[0][1], seamH = belt - T.ride - 0.16, seamY = T.ride + 0.1 + seamH/2;
    var doors = [T.cab[0][0]*L - 0.05, (T.roof[0] + T.roof[1])*0.42*L];
    if (!T.panel) doors.push(Math.max(-L*0.36, T.roof[1]*L*0.72));
    [-1, 1].forEach(function(side){
      doors.forEach(function(x, i){
        put('trim', G.seam, x, seamY, side*(W/2 + 0.002), 0, seamH/0.5);
        if (i < doors.length - 1) put('chrome', G.handle, x - 0.22, belt - 0.12, side*(W/2 + 0.01));
      });
    });
    if (type === 'estate' || type === 'suv')
      [-1, 1].forEach(function(side){ put('trim', G.rail, (T.roof[0] + T.roof[1])*0.5*L, G.top + 0.06, side*W*0.34); });
    put('chrome', G.exhaust, -h - 0.02, T.ride + 0.02, W*0.3);
    [-1, 1].forEach(function(side){
      put('head', G.lamp, h - 0.01, T.lampY, side*(W/2 - 0.30));
      put('drl', G.drl, h - 0.005, T.lampY - 0.07, side*(W/2 - 0.30));
      put('tail', G.lampRear, -h + 0.005, T.tailY, side*(W/2 - 0.28));
    });
    G.baked = {};
    Object.keys(C).forEach(function(k){ G.baked[k] = C[k].mesh(null).geometry; });
    return G.baked;
  }

  /* a car, facing +x, wheels on y = 0, width along z (+z is its right) */
  function buildCar(v){
    var type = typeFor(v);
    var G = carGeometry(type, v.len*U, v.wid*U), T = G.T, L = G.L, W = G.W, h = L/2;
    var VMs = vehicleMats();
    var paint = v.isPlayer ? ownPaint() : paintMat(v.taxi ? '#efe6c8' : v.color);
    var g = new THREE.Group();
    /* the whole car, baked per body type into one mesh per material and
       shared by every car of that type: ~10 draws instead of ~70 */
    var B = bakedCar(type, G);
    var mats = { paint:paint, glass:VMs.glass, cabPaint:paint, trim:VMs.trim, chrome:VMs.chrome, tyre:VMs.tyre,
                 rim:VMs.rim, head:VMs.head, drl:VMs.drl, tail:VMs.tail };
    Object.keys(B).forEach(function(k){
      var m = new THREE.Mesh(B[k], mats[k]);
      m.castShadow = k === 'paint' || k === 'glass' || k === 'tyre';
      g.add(m);
      if (k === 'glass') g.userData.cab = m;
      if (k === 'cabPaint') g.userData.roofPanel = m;
    });
    g.userData.pillar = { visible:true };             // part of the roof mesh now
    g.userData.wheels = [];
    /* brake lights and indicators: separate lit copies, shown when on */
    g.userData.brake = [-1, 1].map(function(side){
      var m = part(G.lampRear, VMs.brake, -h - 0.004, T.tailY, side*(W/2 - 0.28), g); m.visible = false; return m;
    });
    g.userData.blink = { left:[], right:[] };
    [[h - 0.005, T.lampY], [-h + 0.0, T.tailY + 0.1]].forEach(function(pos){
      [-1, 1].forEach(function(side){
        var m = part(G.blinker, VMs.blink, pos[0] + (pos[0] > 0 ? 0.01 : -0.012), pos[1], side*(W/2 - 0.1), g);
        m.visible = false;
        g.userData.blink[side < 0 ? 'left' : 'right'].push(m);
      });
    });
    var pm = plateMat(plateText(String(v.id)));
    var pf = part(G.plate, pm, h + 0.06, T.ride + 0.14, 0, g); pf.rotation.y = Math.PI/2;
    var pr = part(G.plate, pm, -h - 0.02, T.ride + 0.22, 0, g); pr.rotation.y = -Math.PI/2;
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
    part(new THREE.BoxGeometry(0.26, 0.17, 0.54), VMs.dash, L*0.11, 0.985, -W*0.20, car);
    /* the instrument cluster in its cowl: a live speedometer and the
       indicator arrows, drawn into a small canvas every frame */
    var cc = document.createElement('canvas'); cc.width = 512; cc.height = 160;
    var ctex = new THREE.CanvasTexture(cc); ctex.encoding = THREE.sRGBEncoding;
    var cluster = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.14),
      new THREE.MeshBasicMaterial({ map:ctex, toneMapped:false }));
    cluster.position.set(L*0.11 - 0.14, 0.99, -W*0.20);
    cluster.rotation.y = -Math.PI/2;
    car.add(cluster);
    car.userData.cluster = { canvas:cc, ctx:cc.getContext('2d'), tex:ctex, last:'' };
    /* A-pillars along the windscreen edges, roof lining above */
    [-1, 1].forEach(function(side){
      var a = new THREE.Vector3(L*0.22, 0.92, side*(W*0.42)), b = new THREE.Vector3(L*0.05, 1.40, side*(W*0.38));
      var len = a.distanceTo(b);
      var pil = new THREE.Mesh(new THREE.BoxGeometry(0.06, len, 0.09), VMs.dash);
      pil.position.copy(a).add(b).multiplyScalar(0.5);
      pil.lookAt(b); pil.rotateX(Math.PI/2);
      car.add(pil);
    });
    part(new THREE.BoxGeometry(1.4, 0.04, W*0.84), VMs.dash, -L*0.11, 1.41, 0, car);
    part(new THREE.BoxGeometry(0.04, 0.07, 0.26), VMs.dash, L*0.045, 1.31, 0, car);     // mirror
    /* the steering wheel: a rim and three spokes, turning as you steer */
    var column = new THREE.Group();
    column.position.set(L*0.085, 0.87, -W*0.20);
    column.rotation.y = Math.PI/2; column.rotateX(-0.45);
    var wheel = new THREE.Group();
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 10, 36), VMs.dash));
    [Math.PI/2, Math.PI*7/6, Math.PI*11/6].forEach(function(a){
      var spoke = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.024, 0.012), VMs.dash);
      spoke.position.set(Math.cos(a)*0.085, Math.sin(a)*0.085, 0);
      spoke.rotation.z = a;
      wheel.add(spoke);
    });
    wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16).rotateX(Math.PI/2), VMs.dash));
    column.add(wheel);
    car.add(column);
    car.userData.steeringWheel = wheel;
  }

  /* the cluster: a round speedometer (0-200), the speed in figures, the
     green arrows when an indicator is on, lit softly at night */
  function drawCluster(cl, kmh, indicator, blink){
    var key = Math.round(kmh) + indicator + blink + night;
    if (key === cl.last) return;
    cl.last = key;
    var g = cl.ctx, w = cl.canvas.width, h = cl.canvas.height;
    g.fillStyle = '#07090b'; g.fillRect(0, 0, w, h);
    var cx = w*0.5, cy = h*0.92, r = h*0.8;
    var ink = night ? '#ffb46a' : '#e8edf2';
    g.strokeStyle = ink; g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, r, Math.PI*1.1, Math.PI*1.9); g.stroke();
    g.fillStyle = ink; g.font = 'bold 18px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (var s = 0; s <= 200; s += 20){
      var a = Math.PI*1.1 + (s/200)*Math.PI*0.8;
      var x0 = cx + Math.cos(a)*r, y0 = cy + Math.sin(a)*r;
      var x1 = cx + Math.cos(a)*(r - (s % 40 ? 10 : 18)), y1 = cy + Math.sin(a)*(r - (s % 40 ? 10 : 18));
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      if (s % 40 === 0) g.fillText(String(s), cx + Math.cos(a)*(r - 34), cy + Math.sin(a)*(r - 34));
    }
    var an = Math.PI*1.1 + (Math.min(kmh, 200)/200)*Math.PI*0.8;
    g.strokeStyle = '#ff3b2f'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(an)*(r - 8), cy + Math.sin(an)*(r - 8)); g.stroke();
    g.fillStyle = ink; g.font = 'bold 34px Arial';
    g.fillText(Math.round(kmh) + '', cx, cy - r*0.42);
    g.font = '14px Arial'; g.fillText('km/h', cx, cy - r*0.2);
    /* indicator arrows */
    [['left', w*0.12, -1], ['right', w*0.88, 1]].forEach(function(ar){
      var on = indicator === ar[0] && blink;
      g.fillStyle = on ? '#2bff6a' : '#16301d';
      g.beginPath();
      g.moveTo(ar[1] + ar[2]*30, h*0.45); g.lineTo(ar[1], h*0.25); g.lineTo(ar[1], h*0.37);
      g.lineTo(ar[1] - ar[2]*26, h*0.37); g.lineTo(ar[1] - ar[2]*26, h*0.53); g.lineTo(ar[1], h*0.53);
      g.lineTo(ar[1], h*0.65); g.closePath(); g.fill();
    });
    cl.tex.needsUpdate = true;
  }

  function vehicleMesh(v){
    var key = v.id + '|' + v.kind + '|' + (v.taxi ? 't' : v.color);
    var cur = dyn.meshes[v.id];
    if (cur && cur.userData.key === key) return cur;
    if (cur){ scene.remove(cur); }
    var g = v.kind === 'tram' ? buildTram(v) : v.kind === 'bus' ? buildBus(v)
          : v.kind === 'bike' ? buildBike(v) : buildCar(v);
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
      (g.userData.wheels || []).forEach(function(w, k){
        if (w.children[0]) w.rotation.z = -(v.s*U)/0.33;
        /* the front pair turns with the steering (a car's first two wheels) */
        if (k < 2 && v.kind !== 'bike') w.rotation.y = -(v.delta || 0);
      });
      if (g.userData.steeringWheel) g.userData.steeringWheel.rotation.z = -(v.delta || 0) * 14;
      if (g.userData.cluster) drawCluster(g.userData.cluster, v.v*3.6/CFG.PPM, v.indicator, (t*2.2) % 1 < 0.55);
      /* a cyclist pedals while moving */
      if (g.userData.rider){
        var ph = v.s*U*1.6;
        g.userData.rider.userData.limbs.forEach(function(l){ l.hip.rotation.z = 0.9 + Math.sin(ph + (l.side > 0 ? Math.PI : 0))*0.45; });
      }
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
  /* ---------------- people ---------------- */
  var COATS  = ['#2f3b52','#5b3a2e','#3d4a3a','#7a1f2b','#1f1f24','#8b7355','#2c5a7a','#b9b2a6','#6b2f5b','#c4572e'];
  var TROUSERS = ['#1d2330','#26282c','#3b3a36','#2a3b5c','#4a4038'];
  var SKINS  = ['#f0d0b4','#e2bf9d','#c89a74','#8d5f3e','#5e3d28'];
  var HAIR   = ['#2b2620','#4a3322','#8a6a45','#1a1a1a','#b8b0a2'];
  var pmat = {};
  function colorMat(c, rough){
    var k = c + (rough || '');
    return pmat[k] || (pmat[k] = new THREE.MeshStandardMaterial({ color:c, roughness:rough || 0.85 }));
  }
  function pick(list, x){ return list[Math.floor(x*list.length) % list.length]; }
  var PG = null;
  function personGeo(){
    if (PG) return PG;
    PG = {
      torso: new THREE.CylinderGeometry(0.19, 0.16, 0.62, 12),
      hips:  new THREE.CylinderGeometry(0.16, 0.15, 0.16, 12),
      leg:   new THREE.CylinderGeometry(0.075, 0.06, 0.84, 8).translate(0, -0.42, 0),
      arm:   new THREE.CylinderGeometry(0.05, 0.045, 0.62, 8).translate(0, -0.31, 0),
      head:  new THREE.SphereGeometry(0.115, 14, 12),
      hair:  new THREE.SphereGeometry(0.12, 14, 8, 0, Math.PI*2, 0, Math.PI*0.55),
      shoe:  new THREE.BoxGeometry(0.24, 0.07, 0.1),
      bag:   new THREE.BoxGeometry(0.1, 0.32, 0.26)
    };
    return PG;
  }
  /* ---------------- real people: rigged, animated models ---------------- */
  /* Quaternius' "Animated Men Pack" (CC0): loaded once from the packed
     assets, then every pedestrian gets their own copy - own colours, own
     height, walking or standing. Until they have loaded (a moment after
     the page opens) the simple figures below stand in. */
  var people = { ready:false, models:[], version:0 };
  var PEOPLE_LAYER = 1;
  var SHIRTS = ['#2f3b52','#7a1f2b','#3d4a3a','#c9c4b8','#1f1f24','#8b7355','#2c5a7a','#6b2f5b','#c4572e','#4a6a8a','#e0ddd4','#5a5a5a'];
  function loadPeople(){
    if (typeof THREE.GLTFLoader === 'undefined' || typeof ASSETS === 'undefined') return;
    var keys = Object.keys(ASSETS).filter(function(k){ return /^model_/.test(k); });
    var loader = new THREE.GLTFLoader(), left = keys.length;
    keys.forEach(function(k){
      fetch(ASSETS[k]).then(function(r){ return r.arrayBuffer(); }).then(function(buf){
        loader.parse(buf, '', function(gltf){
          var root = gltf.scene;
          root.updateMatrixWorld(true);
          var box = new THREE.Box3().setFromObject(root);
          /* bounds generous enough for any pose, so a person off screen
             is skipped (culling a walking figure by its standing pose
             would cut off swinging arms and legs) */
          root.traverse(function(o){
            if (!o.isSkinnedMesh) return;
            o.geometry.computeBoundingSphere();
            o.geometry.boundingSphere.radius *= 1.8;
          });
          var clip = function(name){
            return gltf.animations.filter(function(a){ return new RegExp(name + '$').test(a.name); })[0];
          };
          people.models.push({ scene:root, height:Math.max(0.01, box.max.y - box.min.y), minY:box.min.y,
                               walk:clip('Walk'), idle:clip('Idle') || clip('Standing') });
          if (--left === 0){ people.ready = true; people.version++; }
        }, function(){ if (--left === 0 && people.models.length){ people.ready = true; people.version++; } });
      }).catch(function(){ left--; });
    });
  }
  function buildModelPerson(look, kid){
    var mdl = people.models[Math.floor(look*997) % people.models.length];
    var inst = THREE.SkeletonUtils.clone(mdl.scene);
    var h = kid ? 1.25 : 1.62 + ((look*13.7) % 1)*0.3, s = h / mdl.height;
    inst.scale.multiplyScalar(s);
    inst.position.y = -mdl.minY*s;
    inst.rotation.y = Math.PI/2;                     // the model faces +z; ours face +x
    inst.traverse(function(o){
      if (!o.isMesh) return;
      o.castShadow = true;
      o.layers.set(PEOPLE_LAYER);                    // drawn and shadowed, but not in the small mirror
      var recolor = function(m){
        var c = null;
        if (/^Shirt/.test(m.name)) c = pick(SHIRTS, (look*7.3) % 1);
        else if (/^Pants/.test(m.name)) c = pick(TROUSERS, (look*3.7) % 1);
        else if (/^Hair/.test(m.name)) c = pick(HAIR, (look*9.1) % 1);
        else if (/^Skin/.test(m.name)) c = pick(SKINS, (look*5.3) % 1);
        if (!c) return m;
        var n = m.clone(); n.color.set(c); return n;
      };
      o.material = Array.isArray(o.material) ? o.material.map(recolor) : recolor(o.material);
    });
    var g = new THREE.Group();
    g.add(inst);
    var mixer = new THREE.AnimationMixer(inst);
    var walk = mdl.walk ? mixer.clipAction(mdl.walk) : null, idle = mdl.idle ? mixer.clipAction(mdl.idle) : null;
    [walk, idle].forEach(function(a){ if (a){ a.play(); a.setEffectiveWeight(0); a.time = look*a.getClip().duration; } });
    if (idle) idle.setEffectiveWeight(1);
    g.userData = { model:true, mixer:mixer, walk:walk, idle:idle, version:people.version, lastT:null };
    return g;
  }

  /* a person facing +x, feet on y = 0; limbs hang from hip and shoulder
     pivots so they can swing. `simple` forces the stand-in figure (a
     cyclist's, whose pose the models do not have). */
  function buildPerson(look, kid, simple){
    if (people.ready && !simple) return buildModelPerson(look, kid);
    var G = personGeo(), g = new THREE.Group(), body = new THREE.Group();
    var s = kid ? 0.68 : (0.94 + 0.12*((look*7) % 1));
    body.scale.setScalar(s);
    g.add(body);
    var coat = colorMat(pick(COATS, look)), legs = colorMat(pick(TROUSERS, (look*3.7) % 1));
    var skin = colorMat(pick(SKINS, (look*5.3) % 1), 0.6), hair = colorMat(pick(HAIR, (look*9.1) % 1));
    var t = part(G.torso, coat, 0, 1.22, 0, body, true);
    part(G.hips, legs, 0, 0.88, 0, body, true);
    var head = part(G.head, skin, 0, 1.68, 0, body, true);
    part(G.hair, hair, -0.01, 1.70, 0, body);
    var limbs = [];
    [-1, 1].forEach(function(side){
      var hip = new THREE.Group(); hip.position.set(0, 0.88, side*0.085); body.add(hip);
      var l = new THREE.Mesh(G.leg, legs); l.castShadow = true; hip.add(l);
      var shoe = new THREE.Mesh(G.shoe, colorMat('#1b1b1b')); shoe.position.set(0.05, -0.84, 0); hip.add(shoe);
      var sh = new THREE.Group(); sh.position.set(0, 1.49, side*0.215); body.add(sh);
      var a = new THREE.Mesh(G.arm, coat); a.castShadow = true; sh.add(a);
      limbs.push({ hip:hip, shoulder:sh, side:side });
    });
    if (!kid && look > 0.6) part(G.bag, colorMat('#3a2c22'), -0.02, 1.05, 0.26, body);
    g.userData.limbs = limbs; g.userData.phase = look*6.28;
    void t; void head;
    return g;
  }
  function swing(g, amount, t){
    if (g.userData.model){
      /* the model's own walk or idle, advanced by game time - so people
         freeze when the game pauses and do not skip on a rewind */
      var u = g.userData, dt = u.lastT === null ? 0 : Geo.clamp(t - u.lastT, 0, 0.1);
      u.lastT = t;
      if (u.walk) u.walk.setEffectiveWeight(amount > 0 ? 1 : 0);
      if (u.idle) u.idle.setEffectiveWeight(amount > 0 ? 0 : 1);
      u.mixer.update(dt);
      return;
    }
    var ph = t*7.5 + g.userData.phase;
    g.userData.limbs.forEach(function(l){
      var a = Math.sin(ph) * amount * l.side;
      l.hip.rotation.z = a;
      l.shoulder.rotation.z = -a*0.8;
    });
  }
  function syncPeds(world){
    var seen = {};
    world.peds.forEach(function(ped, i){
      if (ped.state === 'done') return;
      if (ped.look === undefined) ped.look = (i*0.37 + 0.11) % 1;
      var k = ped.gid || (ped.gid = 'p' + (++pedIds));
      seen[k] = true;
      var g = dyn.peds[k];
      /* built before the models arrived? swap in the real person */
      if (g && people.ready && g.userData.version !== people.version){ scene.remove(g); g = null; }
      if (!g){ g = buildPerson(ped.look, ped.kid); scene.add(g); dyn.peds[k] = g; }
      var pt = ped.point();
      g.position.set(pt.x*U, 0, pt.y*U);
      /* facing the way they walk across; waiting, they face the road */
      var q = Geo.rot90cw(Geo.ARM_VEC[ped.arm]);
      g.rotation.y = -Math.atan2(q.y*ped.dir, q.x*ped.dir);
      swing(g, ped.state === 'walking' ? 0.45 : 0, world.t);
    });
    Object.keys(dyn.peds).forEach(function(k){ if (!seen[k]){ scene.remove(dyn.peds[k]); delete dyn.peds[k]; } });
  }
  var pedIds = 0;

  /* a cyclist on a city bike, facing +x */
  function buildBike(v){
    var VMs = vehicleMats(), g = new THREE.Group();
    var frame = colorMat(v.color || '#2b5d8a', 0.4);
    var tyre = new THREE.TorusGeometry(0.33, 0.03, 8, 28);
    g.userData.wheels = [];
    [-0.52, 0.52].forEach(function(x){
      var wg = new THREE.Group(); wg.position.set(x, 0.34, 0);
      var t = new THREE.Mesh(tyre, VMs.tyre); t.castShadow = true; wg.add(t);
      var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.01, 12).rotateX(Math.PI/2), colorMat('#9aa0a6', 0.3));
      hub.material = new THREE.MeshStandardMaterial({ color:0x9aa0a6, transparent:true, opacity:0.25, metalness:0.8 });
      wg.add(hub);
      g.add(wg); g.userData.wheels.push(wg);
    });
    function bar(a, b, r, m){
      var va = new THREE.Vector3(a[0], a[1], 0), vb = new THREE.Vector3(b[0], b[1], 0);
      var mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, va.distanceTo(vb), 6), m);
      mesh.position.copy(va).add(vb).multiplyScalar(0.5);
      mesh.lookAt(vb); mesh.rotateX(Math.PI/2);
      g.add(mesh); return mesh;
    }
    bar([-0.52, 0.34], [-0.05, 0.36], 0.025, frame);
    bar([-0.05, 0.36], [0.40, 0.80], 0.025, frame);
    bar([-0.52, 0.34], [-0.18, 0.86], 0.022, frame);
    bar([-0.05, 0.36], [-0.20, 0.90], 0.025, frame);
    bar([0.52, 0.34], [0.40, 0.95], 0.022, frame);
    bar([-0.18, 0.86], [0.40, 0.80], 0.025, frame);
    part(new THREE.BoxGeometry(0.1, 0.02, 0.56), colorMat('#1a1a1a'), 0.38, 1.0, 0, g);          // handlebar
    part(new THREE.BoxGeometry(0.24, 0.05, 0.14), colorMat('#1a1a1a'), -0.22, 0.93, 0, g);        // saddle
    /* the rider: leaning a little forward, hands on the bar */
    var rider = buildPerson(v.look || 0.3, false, true);
    rider.position.set(-0.24, -0.02, 0);
    var body = rider.children[0];
    body.rotation.z = -0.22;
    rider.userData.limbs.forEach(function(l){ l.shoulder.rotation.z = -1.0; });
    g.add(rider);
    g.userData.rider = rider;
    var helmet = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI*2, 0, Math.PI*0.5), colorMat('#e8e8e2', 0.4));
    helmet.position.set(0.18, 1.72, 0); body.add(helmet);
    part(new THREE.BoxGeometry(0.04, 0.04, 0.06), VMs.tail, -0.6, 0.62, 0, g);                    // rear light
    g.userData.brake = []; g.userData.blink = { left:[], right:[] };
    return g;
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
      if (parkedPaintMat) parkedPaintMat.envMapIntensity = 0.12;
      if (clouds) clouds.visible = false;
    } else {
      sky.visible = true;
      scene.background = null;
      scene.fog = new THREE.FogExp2(0xc9d6e2, 0.0042);
      hemi.color.set(0xcfe3ff); hemi.groundColor.set(0x5b5346); hemi.intensity = 0.75;
      sun.color.set(0xfff1dc); sun.intensity = 2.3;
      renderer.toneMappingExposure = 0.95;
      scene.environment = envDay;
      Object.keys(paintMats).forEach(function(k){ paintMats[k].envMapIntensity = 0.8; });
      if (parkedPaintMat) parkedPaintMat.envMapIntensity = 0.8;
      if (clouds) clouds.visible = true;
    }
    var el = THREE.MathUtils.degToRad(night ? 20 : 38), az = THREE.MathUtils.degToRad(215);
    sunDir.setFromSphericalCoords(1, Math.PI/2 - el, az);
    sky.material.uniforms.sunPosition.value.copy(sunDir);
  }
  var sunDir = new (typeof THREE !== 'undefined' ? THREE.Vector3 : Object)();
  var envLevel = null;

  /* ---------------- the rear-view mirror ---------------- */
  /* A second camera at the mirror, looking back along the car, drawn into
     a small picture at the top of the windscreen - flipped left to right,
     as a mirror is, so a cyclist behind you on the right shows on the right. */
  var mirror = null;
  function mirrorSetup(){
    if (mirror) return mirror;
    var rt = new THREE.WebGLRenderTarget(640, 200);
    rt.texture.encoding = THREE.sRGBEncoding;
    var cam = new THREE.PerspectiveCamera(24, 3.2, 0.3, 900);
    cam.rotation.order = 'YXZ';
    var ov = new THREE.Scene(), ocam = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
    var frameMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color:0x0c0d0e }));
    var glass = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
                  new THREE.MeshBasicMaterial({ map:rt.texture, side:THREE.DoubleSide }));
    glass.position.z = 1;
    ov.add(frameMesh); ov.add(glass);
    return (mirror = { rt:rt, cam:cam, ov:ov, ocam:ocam, frame:frameMesh, glass:glass });
  }
  function drawMirror(world, yaw, w, h, big){
    if (Math.abs(yaw || 0) > 0.35) return;           // looking out of a side window
    var m = mirrorSetup(), p = world.player;
    var c = Math.cos(p.pos.h), s = Math.sin(p.pos.h);
    m.cam.position.set((p.pos.x + c*0.2*CFG.PPM)*U, 1.32, (p.pos.y + s*0.2*CFG.PPM)*U);
    m.cam.rotation.set(-0.03, -(p.pos.h + Math.PI) - Math.PI/2, 0);
    var own = dyn.meshes[p.id];
    if (own) own.visible = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(m.rt);
    renderer.render(scene, m.cam);
    renderer.setRenderTarget(null);
    renderer.shadowMap.autoUpdate = true;
    if (own) own.visible = true;

    var mw = Math.min(w*0.36, 320) * (big ? 1.45 : 1), mh = mw/3.2;
    var cx = w/2, cy = h - 10 - mh/2 - (big ? 0 : 4);
    m.ocam.left = 0; m.ocam.right = w; m.ocam.top = h; m.ocam.bottom = 0; m.ocam.updateProjectionMatrix();
    m.frame.position.set(cx, cy, 0); m.frame.scale.set(mw + 10, mh + 10, 1);
    m.glass.position.set(cx, cy, 1); m.glass.scale.set(-mw, mh, 1);     // negative: mirrored
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(m.ov, m.ocam);
    renderer.autoClear = true;
  }

  /* ---------------- main entry ---------------- */
  function frame(world, yaw, w, h, opts){
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
    /* eyes a little down the road, as a driver sits: enough to see the
       instruments through the wheel on a wide screen */
    camera.rotation.set(-0.085, -(p.pos.h + (yaw || 0)) - Math.PI/2, 0);
    var aspect = w / Math.max(1, h);
    var vfov = 2*Math.atan(Math.tan(FOV_H*Math.PI/360) / aspect) * 180/Math.PI;
    /* about what you see from a real driver's seat; on a tall screen the
       view narrows sideways rather than growing a fish-eye roof and floor */
    camera.fov = Math.min(60, Math.max(38, vfov));
    camera.aspect = aspect;
    camera.updateProjectionMatrix();

    syncVehicles(world, world.t);
    syncPeds(world);
    syncWalkers(world);
    syncSignals(world);
    syncChevrons(world);
    syncNightLights(world);
    built.stations.forEach(function(st){ st.rotation.y = Math.atan2(camera.position.x - st.position.x, camera.position.z - st.position.z); });

    /* the sun's shadow box follows the car, and so does the sky */
    var cx = p.pos.x*U, cz = p.pos.y*U;
    if (clouds) clouds.position.set(cx, 0, cz);
    sun.target.position.set(cx + c*25, 0, cz + s*25);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 150);
    /* our own headlights after dark */
    headlamp.intensity = night ? 18 : 0;
    headlamp.position.set(cx + c*2.2, 0.75, cz + s*2.2);
    headlamp.target.position.set(cx + c*30, 0, cz + s*30);

    renderer.render(scene, camera);
    if (world.map) drawMirror(world, yaw, w, h, opts && opts.mirror);
    return true;
  }

  return { available:available, frame:frame, syncTheme:syncTheme,
           /* for poking at the scene from the browser console */
           debug:function(){ return { scene:scene, camera:camera, renderer:renderer, dyn:dyn }; } };
})();
