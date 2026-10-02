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
    loadSkies();
    setQuality(quality);

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
      railing: std({ color:0x3a3d40, metalness:0.5, roughness:0.45 }),      // handrails, dark painted metal
      railPanel: std({ vertexColors:true, roughness:0.6, side:THREE.DoubleSide }),
      planter: std({ color:0x9a5a3c, roughness:0.85 }),
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
      trunk:   std({ color:0x9c9088, roughness:1.0 }),
      metal:   std({ color:0x5b6068, metalness:0.6, roughness:0.45 }),
      lampHead:std({ color:0xdddddd, emissive:0xffe2a8, emissiveIntensity:0, roughness:0.4 }),
      housing: std({ color:0x1f2226, roughness:0.55 }),
      lensOff: std({ color:0x1d2126, roughness:0.3 }),
      /* unlit lenses keep a hint of their colour, as real ones do */
      offRed:   std({ color:0x2a0907, roughness:0.15, envMapIntensity:0.8 }),
      offAmber: std({ color:0x2a1b05, roughness:0.15, envMapIntensity:0.8 }),
      offGreen: std({ color:0x062018, roughness:0.15, envMapIntensity:0.8 }),
      mast:    std({ color:0x7a817d, metalness:0.55, roughness:0.5 }),
      wire:    std({ color:0x3a3430, metalness:0.6, roughness:0.45 }),
      button:  std({ color:0xf2c200, roughness:0.45 }),
      gutter:  std({ color:0x8f8b84, roughness:0.85 }),             // granite setts along the kerb
      stucco:  std({ vertexColors:true, roughness:0.9 }),           // window surrounds, cornices
      sill:    std({ color:0xcdc6b8, roughness:0.8 }),
      awning:  std({ vertexColors:true, roughness:0.95, side:THREE.DoubleSide }),
      brick:   std({ color:0x8c4a3a, roughness:0.95 }),
      dish:    std({ color:0xe4e4e2, metalness:0.3, roughness:0.45 }),
      dormerGlass: std({ color:0x1d2630, roughness:0.08, envMapIntensity:1.2 }),
      panel:   std({ color:0xa9a59d, roughness:0.9 }),              // concrete round the tram rails
      groove:  std({ color:0x1b1a19, roughness:0.9 }),
      red:     std({ color:0x330000, emissive:0xff2a1a, emissiveIntensity:2.2 }),
      amber:   std({ color:0x331d00, emissive:0xffb000, emissiveIntensity:2.2 }),
      green:   std({ color:0x00220d, emissive:0x21e36a, emissiveIntensity:2.0 }),
      chevron: new THREE.MeshBasicMaterial({ color:0x6bb2f5, transparent:true, opacity:0.55, depthWrite:false,
                                             polygonOffset:true, polygonOffsetFactor:-4, polygonOffsetUnits:-4 }),
      tower:   std({ color:0x8a97a8, roughness:0.6, metalness:0.3, emissive:0xffd690, emissiveIntensity:0, fog:false })
    };
    applyWear();
    return MAT;
  }
  /* ---------------- wear and tear ---------------- */
  /* A new town looks fake. These shader additions work in world space, so
     nothing repeats with the texture tiles: asphalt gets lighter and darker
     stretches, repair patches with tar seams and sealed cracks; markings
     are worn through where tyres run; walls are grimy at the foot with
     rain streaks; paving is stained; window glass is glossy and reflects
     the sky photo. */
  var WEAR_NOISE = [
    'varying vec3 vWPos; uniform float uWet;',
    'float wHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float wNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);',
    '  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y); }',
    ''].join('\n');
  var WEAR = {
    /* asphalt: patches, seams, sealed cracks, tone */
    road: [
      'vec2 wp = vWPos.xz; float wRough = 1.0;',
      'float tone = wNoise(wp/11.0)*0.6 + wNoise(wp/2.7)*0.4;',
      'diffuseColor.rgb *= 0.86 + 0.26*tone;',
      'vec2 cell = floor(wp / vec2(7.0, 5.0)), inC = fract(wp / vec2(7.0, 5.0)) * vec2(7.0, 5.0);',
      'float hp = wHash(cell);',
      'if (hp < 0.16){',
      '  vec2 o = vec2(wHash(cell + 3.1), wHash(cell + 5.7)) * vec2(3.0, 2.0) + 0.3;',
      '  vec2 sz = vec2(1.6 + wHash(cell + 1.3)*2.6, 1.0 + wHash(cell + 9.2)*1.8);',
      '  vec2 d = min(inC - o, o + sz - inC);',
      '  if (min(d.x, d.y) > 0.0){',
      '    diffuseColor.rgb *= 0.70; wRough = 0.85;',
      '    if (min(d.x, d.y) < 0.05) diffuseColor.rgb *= 0.55;',
      '  }',
      '}',
      'float crackZone = smoothstep(0.55, 0.7, wNoise(wp/17.0 + 4.0));',
      'float crack = 1.0 - smoothstep(0.0, 0.012, abs(wNoise(wp/2.2) - 0.5));',
      'diffuseColor.rgb *= 1.0 - 0.45*crack*crackZone;',
      /* wet: darker, glossy, with puddles that mirror the sky */
      'float pud = smoothstep(0.64, 0.72, wNoise(wp/3.3 + 11.0)) * uWet;',
      'diffuseColor.rgb *= mix(1.0, 0.5, uWet) * (1.0 - 0.3*pud);',
      'wRough = mix(wRough, 0.3, uWet); wRough = mix(wRough, 0.04, pud);'].join('\n'),
    /* markings: worn through in places, dirty everywhere */
    paint: [
      'vec2 wp = vWPos.xz; float wRough = 1.0;',
      'float wear = wNoise(wp*1.7)*0.55 + wNoise(wp*7.0)*0.3 + wNoise(wp*23.0)*0.15;',
      'if (wear > 0.74) discard;',
      'diffuseColor.rgb *= 0.80 + 0.2*wNoise(wp*3.0);',
      'diffuseColor.rgb *= mix(1.0, 0.75, uWet); wRough = mix(1.0, 0.35, uWet);'].join('\n'),
    /* paving: stains and uneven weathering */
    pave: [
      'vec2 wp = vWPos.xz; float wRough = 1.0;',
      'diffuseColor.rgb *= 0.86 + 0.2*wNoise(wp/4.0) - 0.08*smoothstep(0.7, 0.85, wNoise(wp*0.9 + 7.0));',
      'diffuseColor.rgb *= mix(1.0, 0.62, uWet); wRough = mix(1.0, 0.45, uWet);'].join('\n'),
    /* walls: grime at the foot, rain streaks, each stretch a bit different */
    wall: [
      'float wRough = 1.0;',
      'float hz = vWPos.x + vWPos.z, gy = vWPos.y;',
      'diffuseColor.rgb *= mix(0.66, 1.0, smoothstep(0.05, 1.3, gy));',
      'diffuseColor.rgb *= 1.0 - 0.13*smoothstep(0.45, 0.85, wNoise(vec2(hz*2.2, gy*0.07)));',
      'diffuseColor.rgb *= 0.93 + 0.12*wNoise(vec2(hz/13.0, 0.5));',
      'diffuseColor.rgb *= mix(1.0, mix(0.7, 0.92, smoothstep(0.0, 2.5, gy)), uWet);'].join('\n')
  };
  function addWear(mat, kind, glass){
    mat.onBeforeCompile = function(sh){
      sh.uniforms.uWet = wet;
      sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      var f = WEAR_NOISE + sh.fragmentShader;
      f = f.replace('#include <map_fragment>', '#include <map_fragment>\n' + WEAR[kind]);
      f = f.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor *= wRough;');
      /* glossy glass: where the roughness map says glass, the sky photo shows */
      if (glass) f = f.replace('#include <lights_fragment_maps>',
        '#include <lights_fragment_maps>\n  radiance *= 1.0 + 5.0*(1.0 - smoothstep(0.08, 0.3, roughnessFactor));');
      /* wet ground reflects much more than the dry stone it is */
      else if (kind !== 'wall') f = f.replace('#include <lights_fragment_maps>',
        '#include <lights_fragment_maps>\n  radiance *= 1.0 + 2.2*uWet;');
      sh.fragmentShader = f;
    };
    mat.customProgramCacheKey = function(){ return 'wear-' + kind + (glass ? '-glass' : ''); };
    mat.needsUpdate = true;
  }
  function applyWear(){
    var M = mats();
    if (M._worn) return;
    M._worn = true;
    addWear(M.asphalt, 'road');
    addWear(M.paint, 'paint');
    addWear(M.pavers, 'pave');
    addWear(M.kerb, 'pave');
    addWear(M.gutter, 'pave');
    addWear(M.panel, 'pave');
    addWear(M.wallA, 'wall', true); addWear(M.wallB, 'wall', true);
    addWear(M.shop, 'wall', true);  addWear(M.home, 'wall', true);
    addWear(M.gable, 'wall');
  }
  /* ground textures: repeat every so many metres */
  var TILE = { asphalt:5, pavers:2.4, gravel:3, grass:4, field:6 };
  function applyTextures(){
    var M = mats();
    [['asphalt','asphalt'], ['cycle','asphalt'], ['pavers','pavers'], ['gravel','gravel'], ['grass','grass'], ['field','grass'], ['kerb','pavers'],
     ['hedge','grass'], ['balc','plaster'], ['trunk','bark'], ['gutter','pavers'], ['panel','plaster'], ['sill','plaster']]
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
  /* the glass of a window, for the roughness map: dark = glossy */
  function glassMask(g, x, y, ww, wh, variant){
    g.fillStyle = '#121212'; g.fillRect(x + 4, y + 4, ww - 8, wh - 8);
    g.fillStyle = '#fff';
    g.fillRect(x + ww/2 - 2, y + 4, 4, wh - 8);
    g.fillRect(x + 4, y + wh*0.30, ww - 8, 3);
    if (variant > 0.72) g.fillRect(x + 4, y + 4, ww - 8, (wh - 8)*0.45);
  }
  function buildFacades(){
    if (facades || !texReady.plaster_diff) return;
    var M = mats();
    var PX = 128;                                     // pixels per bay / floor
    function upper(seed){
      var c = tileCanvas(PX*4, PX*3), g = c.getContext('2d');
      var e = tileCanvas(PX*4, PX*3), ge = e.getContext('2d');
      var r = tileCanvas(PX*4, PX*3), gr = r.getContext('2d');
      gr.fillStyle = '#fff'; gr.fillRect(0, 0, r.width, r.height);
      plasterBase(g, c.width, c.height);
      ge.fillStyle = '#000'; ge.fillRect(0, 0, e.width, e.height);
      /* a string course under every floor */
      for (var f = 0; f < 3; f++){
        g.fillStyle = 'rgba(0,0,0,0.07)'; g.fillRect(0, f*PX + PX - 5, c.width, 5);
        for (var b = 0; b < 4; b++){
          var x = b*PX + PX*0.30, y = f*PX + PX*0.22, ww = PX*0.40, wh = PX*0.50;
          drawWindow(g, x, y, ww, wh, hash(seed, f, b));
          glassMask(gr, x, y, ww, wh, hash(seed, f, b));
          if (hash(seed, b, f + 7) < 0.36){
            var lg = ge.createLinearGradient(0, y, 0, y + wh);
            lg.addColorStop(0, '#ffcf88'); lg.addColorStop(1, '#d9953f');
            ge.fillStyle = lg; ge.fillRect(x + 4, y + 4, ww - 8, wh - 8);
          }
        }
      }
      return { map:canvasTex(c), emissive:canvasTex(e), rough:canvasTex(r, true) };
    }
    function ground(shop){
      var c = tileCanvas(PX*4, PX), g = c.getContext('2d');
      var e = tileCanvas(PX*4, PX), ge = e.getContext('2d');
      var r = tileCanvas(PX*4, PX), gr = r.getContext('2d');
      gr.fillStyle = '#fff'; gr.fillRect(0, 0, r.width, r.height);
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
          gr.fillStyle = '#121212'; gr.fillRect(b*PX + 14, PX*0.26, PX - 28, PX*0.58);
        } else if (b === 1){
          g.fillStyle = '#5a4130'; g.fillRect(b*PX + PX*0.34, PX*0.18, PX*0.32, PX*0.66);  // door
          g.fillStyle = '#c9a86a'; g.fillRect(b*PX + PX*0.60, PX*0.52, 4, 4);
          g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(b*PX + PX*0.30, PX*0.14, PX*0.40, 6);
        } else {
          drawWindow(g, b*PX + PX*0.30, PX*0.26, PX*0.40, PX*0.46, hash(b, 3, 5));
          glassMask(gr, b*PX + PX*0.30, PX*0.26, PX*0.40, PX*0.46, hash(b, 3, 5));
          if (hash(b, 9, 1) < 0.4){ ge.fillStyle = '#e9a85a'; ge.fillRect(b*PX + PX*0.30 + 4, PX*0.30, PX*0.40 - 8, PX*0.38); }
        }
      }
      return { map:canvasTex(c), emissive:canvasTex(e), rough:canvasTex(r, true) };
    }
    var a = upper(11), b = upper(29), s = ground(true), h = ground(false);
    M.wallA.map = a.map; M.wallA.emissiveMap = a.emissive; M.wallA.needsUpdate = true;
    M.wallB.map = b.map; M.wallB.emissiveMap = b.emissive; M.wallB.needsUpdate = true;
    M.shop.map = s.map;  M.shop.emissiveMap = s.emissive;  M.shop.needsUpdate = true;
    M.home.map = h.map;  M.home.emissiveMap = h.emissive;  M.home.needsUpdate = true;
    M.wallA.roughnessMap = a.rough; M.wallB.roughnessMap = b.rough;
    M.shop.roughnessMap = s.rough;  M.home.roughnessMap = h.rough;
    [M.wallA, M.wallB, M.shop, M.home].forEach(function(m){ if (tex.plaster_nor) m.normalMap = tex.plaster_nor; });
    facades = true;
  }
  function canvasTex(c, linear){
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (!linear) t.encoding = THREE.sRGBEncoding;
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

    /* a strip of granite setts in the gutter along each kerb, with a drain
       grate every 20 m or so (not across the U-Bahn's tracks) */
    if (parts.gutter && city && !ring) L.arms.forEach(function(arm){
      [-1, 1].forEach(function(side){
        var q = Geo.rot90cw(Geo.ARM_VEC[arm]);
        var sideArm = Geo.ARM_ORDER.filter(function(a2){
          return Geo.ARM_VEC[a2].x === q.x*side && Geo.ARM_VEC[a2].y === q.y*side;
        })[0];
        var start = fillet[arm + sideArm] ? B + R : B, l0 = side*(B - 4), l1 = side*B;
        var runs = (sc.rail && arm === sc.rail.side) ? [[start, City.RAIL.bed[0] - 2], [City.RAIL.bed[1] + 2, reach]] : [[start, reach]];
        runs.forEach(function(rn){
          if (rn[1] - rn[0] < 6) return;
          armFlat(parts.gutter, arm, rn[0], Math.min(l0, l1), rn[1], Math.max(l0, l1), ox, oy, 0.034, 0.5);
          for (var d = rn[0] + 70; d < rn[1] - 20; d += 240){
            var pt = armPt(arm, d, side*(B - 2), ox, oy);
            parts.drains.push({ x:pt[0]*U, z:pt[1]*U, along:arm === 'N' || arm === 'S' });
          }
        });
      });
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
  /* a German signal head on its mast: rounded housing on a black
     contrast board with a white rim, three lenses under deep visors, and
     the yellow push-button box for people on foot. Returns the lenses. */
  var SIG = null;
  function signalKit(){
    if (SIG) return SIG;
    var M = mats();
    function rounded(w, h, r){
      var s = new THREE.Shape();
      s.moveTo(-w/2 + r, -h/2); s.lineTo(w/2 - r, -h/2); s.quadraticCurveTo(w/2, -h/2, w/2, -h/2 + r);
      s.lineTo(w/2, h/2 - r); s.quadraticCurveTo(w/2, h/2, w/2 - r, h/2);
      s.lineTo(-w/2 + r, h/2); s.quadraticCurveTo(-w/2, h/2, -w/2, h/2 - r);
      s.lineTo(-w/2, -h/2 + r); s.quadraticCurveTo(-w/2, -h/2, -w/2 + r, -h/2);
      return s;
    }
    /* the contrast board: black, a white stripe round the edge */
    var c = document.createElement('canvas'); c.width = 128; c.height = 256;
    var x = c.getContext('2d');
    x.fillStyle = '#f4f4f0'; x.fillRect(0, 0, 128, 256);
    x.fillStyle = '#0c0d0e'; x.fillRect(9, 9, 110, 238);
    var bt = new THREE.CanvasTexture(c); bt.encoding = THREE.sRGBEncoding;
    /* a lit LED lens: bright in the middle, a ring of dots towards the rim */
    var l = document.createElement('canvas'); l.width = l.height = 64;
    var lx = l.getContext('2d'), gr = lx.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.55, '#d8d8d8'); gr.addColorStop(1, '#7a7a7a');
    lx.fillStyle = gr; lx.fillRect(0, 0, 64, 64);
    lx.fillStyle = 'rgba(0,0,0,0.18)';
    for (var ry = 4; ry < 64; ry += 6) for (var rx = 4; rx < 64; rx += 6){ lx.beginPath(); lx.arc(rx, ry, 1.3, 0, Math.PI*2); lx.fill(); }
    var lt = new THREE.CanvasTexture(l); lt.encoding = THREE.sRGBEncoding;
    function lit(col, emi, k){
      return new THREE.MeshStandardMaterial({ color:col, emissive:emi, emissiveMap:lt, emissiveIntensity:k, roughness:0.2 });
    }
    var visor = new THREE.CylinderGeometry(0.125, 0.125, 0.2, 16, 1, true, Math.PI/2, Math.PI).rotateX(Math.PI/2).translate(0, 0.0, 0.1);
    SIG = {
      housing: new THREE.ExtrudeGeometry(rounded(0.32, 0.92, 0.07), { depth:0.2, bevelEnabled:true, bevelThickness:0.015, bevelSize:0.015, bevelSegments:2 }).translate(0, 0, -0.2),
      board: (function(){
        var bg = new THREE.ShapeGeometry(rounded(0.62, 1.22, 0.05), 6), p = bg.attributes.position, uv = bg.attributes.uv;
        for (var i = 0; i < p.count; i++) uv.setXY(i, p.getX(i)/0.62 + 0.5, p.getY(i)/1.22 + 0.5);
        return bg;
      })(),
      boardMat: new THREE.MeshStandardMaterial({ map:bt, roughness:0.6 }),
      boardBack: new THREE.MeshStandardMaterial({ color:0x2a2c2f, roughness:0.7 }),
      lens: new THREE.CircleGeometry(0.1, 24),
      rim: new THREE.TorusGeometry(0.106, 0.012, 6, 24),
      visor: visor,
      visorMat: (function(){ var m = M.housing.clone(); m.side = THREE.DoubleSide; return m; })(),
      litRed: lit(0x400000, 0xff2a14, 2.6), litAmber: lit(0x402800, 0xffa400, 2.6), litGreen: lit(0x003318, 0x20f080, 2.4),
      button: new THREE.BoxGeometry(0.11, 0.19, 0.08),
      arrow: (function(){
        var cc = document.createElement('canvas'); cc.width = 64; cc.height = 112;
        var gx = cc.getContext('2d'); gx.fillStyle = '#f2c200'; gx.fillRect(0, 0, 64, 112);
        gx.fillStyle = '#111'; gx.fillRect(14, 14, 36, 22);
        gx.font = 'bold 15px Arial'; gx.textAlign = 'center'; gx.fillText('Signal', 32, 66); gx.fillText('kommt', 32, 84);
        var tx = new THREE.CanvasTexture(cc); tx.encoding = THREE.sRGBEncoding;
        return new THREE.MeshStandardMaterial({ map:tx, roughness:0.45 });
      })()
    };
    return SIG;
  }
  function addSignal(group, x, y, arm){
    var M = mats(), K = signalKit();
    var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 3.4, 12), M.mast);
    mast.position.set(x*U, 1.7, y*U); mast.castShadow = true; group.add(mast);
    var head = new THREE.Group();
    head.position.set(x*U, 2.75, y*U);
    faceTowards(head, arm);
    var box = new THREE.Mesh(K.housing, M.housing);
    box.position.z = 0.09; box.castShadow = true; head.add(box);
    var board = new THREE.Mesh(K.board, K.boardMat);
    board.position.z = -0.13; head.add(board);
    var bback = new THREE.Mesh(K.board, K.boardBack);
    bback.position.z = -0.134; bback.rotation.y = Math.PI; head.add(bback);
    var lenses = {};
    [['red', 0.29], ['yellow', 0], ['green', -0.29]].forEach(function(l){
      var lens = new THREE.Mesh(K.lens, M.lensOff);
      lens.position.set(0, l[1], 0.111);
      head.add(lens);
      var rim = new THREE.Mesh(K.rim, M.housing);
      rim.position.set(0, l[1], 0.112); head.add(rim);
      var visor = new THREE.Mesh(K.visor, K.visorMat);
      visor.position.set(0, l[1], 0.11); head.add(visor);
      lenses[l[0]] = lens;
    });
    group.add(head);
    /* the request button, at hand height, turned towards the pavement */
    var btn = new THREE.Group();
    btn.position.set(x*U, 1.1, y*U);
    faceTowards(btn, arm); btn.rotateY(Math.PI/2);
    var bb = new THREE.Mesh(K.button, M.button); bb.position.z = 0.1; btn.add(bb);
    var face = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.175), K.arrow); face.position.z = 0.141; btn.add(face);
    group.add(btn);
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
  /* Depth on the street front of each house, lined up with the windows
     painted in the facade: stone sills under every window; on older
     (Gründerzeit) houses stucco surrounds with a cornice over each window
     and a band between the floors; on shops an awning and a lettered
     sign; a canopy over front doors; dormers and chimneys on pitched
     roofs, and here and there a satellite dish or a TV aerial. */
  var SHOPS = [['Bäckerei', '#f3e6c8', '#6b3b1f'], ['Apotheke', '#ffffff', '#c8102e'], ['Café', '#2f2a26', '#f1e3c6'],
               ['Friseur', '#111111', '#f2f2f2'], ['Kiosk', '#1d4f91', '#ffffff'], ['Blumen', '#2f6b3a', '#ffffff'],
               ['Optik', '#ffffff', '#1d1d1d'], ['Metzgerei', '#8c1c13', '#ffffff'], ['Reisebüro', '#f2b705', '#1d1d1d'],
               ['Sparkasse', '#e2001a', '#ffffff'], ['Döner', '#c0392b', '#ffd34d'], ['Buchhandlung', '#24343f', '#e9dcc0']];
  var AWNINGS = ['#9e2b25', '#2f5d3a', '#1f3a5f', '#c9b48a', '#6b2d4d', '#3a3a3a'];
  var shopSignMats = {};
  function shopSignMat(i){
    if (shopSignMats[i]) return shopSignMats[i];
    var s = SHOPS[i], c = document.createElement('canvas'); c.width = 512; c.height = 96;
    var x = c.getContext('2d');
    x.fillStyle = s[1]; x.fillRect(0, 0, 512, 96);
    x.fillStyle = s[2]; x.textAlign = 'center'; x.textBaseline = 'middle';
    var size = 60; x.font = 'bold ' + size + 'px Georgia, serif';
    while (x.measureText(s[0]).width > 470){ size -= 2; x.font = 'bold ' + size + 'px Georgia, serif'; }
    x.fillText(s[0], 256, 52);
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    t.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
    return (shopSignMats[i] = new THREE.MeshStandardMaterial({ map:t, roughness:0.4, emissive:0xffffff, emissiveMap:t, emissiveIntensity:0 }));
  }
  var apoMat = null;
  function apothekeMat(){
    if (apoMat) return apoMat;
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var x = c.getContext('2d');
    x.fillStyle = '#c8102e'; x.fillRect(0, 0, 128, 128);
    x.fillStyle = '#fff'; x.font = 'bold 100px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('A', 64, 70);
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    return (apoMat = new THREE.MeshStandardMaterial({ map:t, roughness:0.4, emissive:0xffffff, emissiveMap:t, emissiveIntensity:0 }));
  }
  function lighter(css, k){
    var c = new THREE.Color(css); c.lerp(new THREE.Color('#ffffff'), k); return '#' + c.getHexString();
  }
  function houseDetails(parts, hs){
    if (!parts.stucco) return;
    var x0 = hs.x0*U, x1 = hs.x1*U, z0 = hs.y0*U, z1 = hs.y1*U, h = hs.h*U, gh = Math.min(FLOOR, h);
    /* the street wall: from a to b, facing out along n */
    var W = hs.front === 'N' ? { a:[x1,z0], b:[x0,z0], n:[0,-1] } : hs.front === 'S' ? { a:[x0,z1], b:[x1,z1], n:[0,1] }
          : hs.front === 'W' ? { a:[x0,z0], b:[x0,z1], n:[-1,0] } : { a:[x1,z1], b:[x1,z0], n:[1,0] };
    var len = Math.hypot(W.b[0] - W.a[0], W.b[1] - W.a[1]);
    var dx = (W.b[0] - W.a[0])/len, dz = (W.b[1] - W.a[1])/len, nx = W.n[0], nz = W.n[1];
    var old = hash(hs.seed, 7, 3) < 0.4;
    /* an axis-aligned box: s along the wall (s0..s1), y0..y1, standing out o0..o1 from it */
    function wbox(B, s0, s1, y0, y1, o0, o1){
      var ax = W.a[0] + dx*s0 + nx*o0, az = W.a[1] + dz*s0 + nz*o0;
      var bx = W.a[0] + dx*s1 + nx*o1, bz = W.a[1] + dz*s1 + nz*o1;
      B.box(Math.min(ax, bx), Math.max(ax, bx), y0, y1, Math.min(az, bz), Math.max(az, bz), 1);
    }
    parts.stucco.color(lighter(hs.color, 0.55));
    var bays = Math.floor(len/BAY + 1e-6);
    /* windows on the floors above */
    var floorsUp = Math.max(0, Math.round((h - gh - 0.6)/FLOOR));
    for (var j = 0; j < floorsUp; j++){
      var wy0 = gh + j*FLOOR + 0.28*FLOOR, wy1 = wy0 + 0.5*FLOOR;
      for (var k = 0; k < bays; k++){
        var s0 = (k + 0.30)*BAY, s1 = (k + 0.70)*BAY;
        wbox(parts.sill, s0 - 0.08, s1 + 0.08, wy0 - 0.07, wy0, 0, 0.09);
        if (old){
          wbox(parts.stucco, s0 - 0.12, s0, wy0, wy1, 0, 0.05);
          wbox(parts.stucco, s1, s1 + 0.12, wy0, wy1, 0, 0.05);
          wbox(parts.stucco, s0 - 0.12, s1 + 0.12, wy1, wy1 + 0.1, 0, 0.05);
          wbox(parts.stucco, s0 - 0.2, s1 + 0.2, wy1 + 0.1, wy1 + 0.2, 0, 0.11);        // the cornice over it
        }
      }
      if (old) wbox(parts.stucco, 0, len, gh + j*FLOOR - 0.06, gh + j*FLOOR + 0.1, 0, 0.07);   // band between floors
    }
    if (old && h > gh) wbox(parts.stucco, -0.05, len + 0.05, h - 0.32, h - 0.02, 0, 0.16);   // a deeper cornice at the top
    /* the ground floor: a shop, or a home with its front door */
    if (hs.shop){
      var si = Math.floor(hash(hs.seed, 2, 9)*SHOPS.length);
      var ac = AWNINGS[Math.floor(hash(hs.seed, 4, 4)*AWNINGS.length)];
      parts.awning.color(ac);
      for (var b = 0; b < bays; b++){
        if (hash(hs.seed, b, 21) < 0.35) continue;
        /* an awning over this bay, sloping out and down */
        var as0 = b*BAY + 0.12, as1 = (b + 1)*BAY - 0.12, top = 2.42, out = 1.25, drop = 0.5;
        var p0 = [W.a[0] + dx*as0, W.a[1] + dz*as0], p1 = [W.a[0] + dx*as1, W.a[1] + dz*as1];
        parts.awning.quad([p0[0], top, p0[1]], [p1[0], top, p1[1]],
                          [p1[0] + nx*out, top - drop, p1[1] + nz*out], [p0[0] + nx*out, top - drop, p0[1] + nz*out],
                          [nx*0.4, 1, nz*0.4], [[0,0],[1,0],[1,1],[0,1]]);
        parts.awning.quad([p0[0] + nx*out, top - drop, p0[1] + nz*out], [p1[0] + nx*out, top - drop, p1[1] + nz*out],
                          [p1[0] + nx*out, top - drop - 0.22, p1[1] + nz*out], [p0[0] + nx*out, top - drop - 0.22, p0[1] + nz*out],
                          [nx, 0, nz], [[0,0],[1,0],[1,1],[0,1]]);
      }
      /* the shop's name along the fascia */
      var sw = Math.min(len - 0.6, 4.2), sm = len/2;
      var signGeo = new THREE.BoxGeometry(sw, 0.42, 0.06);
      var sg = new THREE.Mesh(signGeo, shopSignMat(si));
      sg.position.set(W.a[0] + dx*sm + nx*0.05, 2.72, W.a[1] + dz*sm + nz*0.05);
      sg.rotation.y = Math.atan2(dx, dz) - Math.PI/2;
      if (Math.abs(nx) > 0.5) sg.rotation.y = Math.atan2(-nz, nx) * 0 + (nx > 0 ? Math.PI/2 : -Math.PI/2);
      else sg.rotation.y = nz > 0 ? 0 : Math.PI;
      parts.signs.push(sg);
      if (SHOPS[si][0] === 'Apotheke'){
        /* the red A, standing out from the wall so you see it down the street */
        var ap = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.1), apothekeMat());
        var as = Math.min(len - 0.4, 0.5);
        ap.position.set(W.a[0] + dx*as + nx*0.5, 3.3, W.a[1] + dz*as + nz*0.5);
        ap.rotation.y = Math.abs(nx) > 0.5 ? 0 : Math.PI/2;
        parts.signs.push(ap);
      }
    } else if (bays >= 2){
      /* a little concrete canopy over the front door (bay 1 of the pattern) */
      var ds = 1.5*BAY;
      if (ds + 0.8 < len){
        wbox(parts.sill, ds - 0.75, ds + 0.75, 2.38, 2.48, 0, 0.75);
      }
      for (var b2 = 0; b2 < bays; b2++){
        if (b2 % 4 === 1) continue;
        wbox(parts.sill, (b2 + 0.30)*BAY - 0.06, (b2 + 0.70)*BAY + 0.06, 0.78, 0.84, 0, 0.08);
      }
    }
    /* a satellite dish on the odd balcony-less front */
    if (!hs.balcony && hash(hs.seed, 5, 5) < 0.22 && floorsUp > 0 && bays > 0){
      var fj = Math.floor(hash(hs.seed, 6, 1)*floorsUp), kk = Math.floor(hash(hs.seed, 6, 2)*bays);
      var ds2 = (kk + 0.85)*BAY, dy = gh + fj*FLOOR + 0.9*FLOOR;
      parts.dishes.push({ x:W.a[0] + dx*ds2 + nx*0.32, y:dy, z:W.a[1] + dz*ds2 + nz*0.32, ry:Math.atan2(nx, nz) });
    }
    /* chimneys, and dormers where the roof is tall enough to take one */
    if (hs.roof){
      var rh = hs.roofH*U, hr = h + 0.14, alongX = hs.front === 'N' || hs.front === 'S';
      var nch = 1 + (hash(hs.seed, 8, 8) < 0.4 ? 1 : 0);
      for (var c = 0; c < nch; c++){
        var cf = 0.2 + 0.6*hash(hs.seed, 9, c);
        var cx = alongX ? x0 + (x1 - x0)*cf : (x0 + x1)/2 + (hash(hs.seed, 3, c) - 0.5)*0.6;
        var cz = alongX ? (z0 + z1)/2 + (hash(hs.seed, 3, c) - 0.5)*0.6 : z0 + (z1 - z0)*cf;
        parts.chimney.box(cx - 0.28, cx + 0.28, hr + rh*0.6, hr + rh + 0.9, cz - 0.28, cz + 0.28, 1);
        parts.sill.box(cx - 0.33, cx + 0.33, hr + rh + 0.9, hr + rh + 1.0, cz - 0.33, cz + 0.33, 1);
      }
      if (rh > 2.2 && bays >= 2){
        var depthR = alongX ? (z1 - z0)/2 : (x1 - x0)/2;           // eave to ridge, in plan
        for (var dk = 0; dk < bays; dk += 2){
          var dsx = (dk + 0.5)*BAY;
          if (dsx + 0.9 > len) break;
          var f0 = 0.22, fy = hr + rh*f0, dh = 1.15, back = depthR*0.62;
          /* the dormer's front sits f0 of the way up the slope */
          var front = [W.a[0] + dx*dsx - nx*depthR*f0, W.a[1] + dz*dsx - nz*depthR*f0];
          var sx0 = front[0] - dx*0.75, sz0 = front[1] - dz*0.75, sx1 = front[0] + dx*0.75, sz1 = front[1] + dz*0.75;
          var bx0 = sx0 - nx*back, bz0 = sz0 - nz*back, bx1 = sx1 - nx*back, bz1 = sz1 - nz*back;
          parts.gable.color(lighter(hs.color, 0.1));
          parts.gable.box(Math.min(sx0, sx1, bx0, bx1), Math.max(sx0, sx1, bx0, bx1), fy - 0.3, fy + dh,
                          Math.min(sz0, sz1, bz0, bz1), Math.max(sz0, sz1, bz0, bz1), 1);
          /* its window, and a little flat roof */
          var gx = front[0] + nx*0.01, gz = front[1] + nz*0.01;
          parts.dormerGlass.quad([gx - dx*0.45, fy + 0.15, gz - dz*0.45], [gx + dx*0.45, fy + 0.15, gz + dz*0.45],
                                 [gx + dx*0.45, fy + dh - 0.18, gz + dz*0.45], [gx - dx*0.45, fy + dh - 0.18, gz - dz*0.45],
                                 [nx, 0, nz], [[0,0],[1,0],[1,1],[0,1]]);
          parts.roof.color(hs.roof);
          parts.roof.box(Math.min(sx0, sx1, bx0, bx1) - 0.12, Math.max(sx0, sx1, bx0, bx1) + 0.12, fy + dh, fy + dh + 0.12,
                         Math.min(sz0, sz1, bz0, bz1) - 0.12, Math.max(sz0, sz1, bz0, bz1) + 0.12, 1);
        }
      }
    } else if (hash(hs.seed, 1, 9) < 0.5){
      /* flat roofs: a TV aerial */
      var ax0 = (x0 + x1)/2, az0 = (z0 + z1)/2;
      parts.aerials.push({ x:ax0, y:h + 0.14, z:az0, ry:hash(hs.seed, 2, 2)*Math.PI });
    }
  }
  function buildHouses(parts, houses){
    houses.forEach(function(hs){
      houseDetails(parts, hs);
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
  /* Street trees are grown once per session from a few seeds: a trunk
     that forks into limbs and twigs (bark from Poly Haven), with the twigs
     carrying cards of drawn leaf sprays. The cards are lit as if they were
     one round crown, so light falls across the whole tree rather than
     flickering card by card, and their holes let the sun through in
     dappled shadows. The crowns move a little in the wind. */
  var TREE_KINDS = 4, treeKit = null, wind = { value:0 };
  function rng(seed){
    return function(){ seed = (seed*16807) % 2147483647; return (seed - 1)/2147483646; };
  }
  function leafTexture(){
    var c = document.createElement('canvas'); c.width = c.height = 512;
    var g = c.getContext('2d'), R = rng(11);
    function leaf(x, y, ang, L){
      var W = L*(0.26 + R()*0.08);
      g.save(); g.translate(x, y); g.rotate(ang);
      g.beginPath(); g.moveTo(0, 0);
      g.quadraticCurveTo(L*0.45, -W, L, 0);
      g.quadraticCurveTo(L*0.45, W, 0, 0);
      var light = 20 + R()*24;
      g.fillStyle = 'hsl(' + (78 + R()*34).toFixed(0) + ',' + (38 + R()*22).toFixed(0) + '%,' + light.toFixed(0) + '%)';
      g.fill();
      g.strokeStyle = 'hsla(80,40%,' + (light + 14).toFixed(0) + '%,0.55)'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(L*0.08, 0); g.lineTo(L*0.9, 0); g.stroke();
      g.restore();
    }
    g.lineCap = 'round';
    /* sprays of twigs from the bottom middle, leaves along each */
    for (var s = 0; s < 7; s++){
      var a = -Math.PI/2 + (s/6 - 0.5)*2.2 + (R() - 0.5)*0.3;
      var len = 200 + R()*150, x0 = 256 + (R() - 0.5)*30, y0 = 505;
      var x1 = x0 + Math.cos(a)*len, y1 = y0 + Math.sin(a)*len;
      g.strokeStyle = '#4a3b2c'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      for (var i = 0; i < 16; i++){
        var t = 0.22 + (i/15)*0.78, side = i % 2 ? 1 : -1;
        leaf(x0 + (x1 - x0)*t, y0 + (y1 - y0)*t, a + side*(0.5 + R()*0.7), 34 + R()*22);
      }
      leaf(x1, y1, a + (R() - 0.5)*0.4, 44 + R()*14);
    }
    var t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
    return t;
  }
  /* one tree, in metres: wood as tapered tubes, leaves as cards */
  function growTree(seed){
    var R = rng(seed*7919 + 3), V = THREE.Vector3;
    var segs = [], cards = [];
    var up = new V(0, 1, 0);
    function jitter(d, k){
      return d.clone().add(new V((R() - 0.5)*k, (R() - 0.5)*k*0.6, (R() - 0.5)*k)).normalize();
    }
    function branch(p, dir, len, r, depth){
      var end = p.clone().addScaledVector(dir, len);
      segs.push([p, end, r, r*0.62]);
      if (depth === 0){
        for (var k = 0; k < 3; k++){
          var at = p.clone().lerp(end, 0.35 + 0.65*R());
          cards.push({ at:at, dir:jitter(dir.clone().add(up.clone().multiplyScalar(0.4)), 1.6), s:2.0 + R()*1.0 });
        }
        return;
      }
      var n = depth === 2 ? 4 : 3;
      for (var i = 0; i < n; i++){
        var from = p.clone().lerp(end, 0.45 + 0.55*R());
        var side = new V(Math.cos(R()*6.28), 0, Math.sin(R()*6.28));
        var nd = dir.clone().addScaledVector(side, 0.9).addScaledVector(up, 0.25).normalize();
        branch(from, nd, len*(0.6 + R()*0.15), r*0.6, depth - 1);
      }
    }
    var trunkTop = 2.6 + R()*0.9;
    var top = new V((R() - 0.5)*0.3, trunkTop, (R() - 0.5)*0.3);
    segs.push([new V(0, -0.2, 0), top, 0.24, 0.17]);
    var mains = 4 + Math.floor(R()*2);
    for (var m = 0; m < mains; m++){
      var az = m/mains*Math.PI*2 + R()*0.6, el = 0.6 + R()*0.45;
      var dir = new V(Math.cos(az)*Math.cos(el), Math.sin(el), Math.sin(az)*Math.cos(el));
      branch(top.clone().addScaledVector(up, -R()*0.6), dir, 2.6 + R()*1.0, 0.13, 2);
    }
    branch(top, jitter(up, 0.3), 3.0, 0.14, 2);              // the leader

    /* crown centre and size, to light the cards as one round crown */
    var box = new THREE.Box3();
    cards.forEach(function(c){ box.expandByPoint(c.at); });
    var centre = box.getCenter(new V()), half = box.getSize(new V()).multiplyScalar(0.5);

    /* wood */
    var pos = [], nor = [], uv = [], idx = [];
    segs.forEach(function(sg){
      var a = sg[0], b = sg[1], d = b.clone().sub(a), L = d.length(); d.normalize();
      var u = Math.abs(d.y) < 0.9 ? new V(0, 1, 0).cross(d).normalize() : new V(1, 0, 0).cross(d).normalize();
      var w = d.clone().cross(u), sides = sg[2] > 0.15 ? 9 : 6, base = pos.length/3;
      for (var e = 0; e < 2; e++){
        var c = e ? b : a, r = e ? sg[3] : sg[2];
        for (var i = 0; i <= sides; i++){
          var th = i/sides*Math.PI*2, cs = Math.cos(th), sn = Math.sin(th);
          var n = u.clone().multiplyScalar(cs).addScaledVector(w, sn);
          pos.push(c.x + n.x*r, c.y + n.y*r, c.z + n.z*r);
          nor.push(n.x, n.y, n.z);
          uv.push(i/sides * Math.max(1, Math.round(sg[2]*8))/2, e*L/1.2);
        }
      }
      for (var j = 0; j < sides; j++){
        var p0 = base + j, p1 = base + j + 1, q0 = p0 + sides + 1, q1 = p1 + sides + 1;
        idx.push(p0, q0, p1, p1, q0, q1);
      }
    });
    var wood = new THREE.BufferGeometry();
    wood.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    wood.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    wood.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    wood.setIndex(idx);

    /* leaves: each card stands out from its twig, the spray's stem at the twig */
    pos = []; nor = []; uv = []; idx = [];
    cards.forEach(function(c){
      var d = c.dir, side = new V(R() - 0.5, R() - 0.5, R() - 0.5).cross(d).normalize();
      var base = pos.length/3, s = c.s;
      [[-0.5, 0, 0, 0], [0.5, 0, 1, 0], [0.5, 1, 1, 1], [-0.5, 1, 0, 1]].forEach(function(k){
        var p = c.at.clone().addScaledVector(side, k[0]*s).addScaledVector(d, k[1]*s - 0.15);
        var n = p.clone().sub(centre).divide(half).normalize().addScaledVector(up, 0.35).normalize();
        pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uv.push(k[2], k[3]);
      });
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    var leaves = new THREE.BufferGeometry();
    leaves.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    leaves.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    leaves.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    leaves.setIndex(idx);
    leaves.computeBoundingBox();
    var bb = leaves.boundingBox;
    return { wood:wood, leaves:leaves, h:bb.max.y,
             r:Math.max(bb.max.x, -bb.min.x, bb.max.z, -bb.min.z) };
  }
  function treeSetup(){
    if (treeKit) return treeKit;
    var leafTex = leafTexture(), kinds = [];
    for (var i = 0; i < TREE_KINDS; i++) kinds.push(growTree(i + 1));
    var leafMat = new THREE.MeshStandardMaterial({ map:leafTex, alphaTest:0.5, side:THREE.DoubleSide,
                                                   roughness:0.75, alphaToCoverage:true });
    leafMat.onBeforeCompile = function(sh){
      sh.uniforms.uWind = wind;
      sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        '#ifdef USE_INSTANCING',
        '  float ph = instanceMatrix[3].x*0.37 + instanceMatrix[3].z*0.23;',
        '#else',
        '  float ph = 0.0;',
        '#endif',
        '  float sway = max(position.y - 2.5, 0.0) * 0.014;',
        '  transformed.x += sin(uWind*1.6 + ph + position.y*0.5) * sway;',
        '  transformed.z += cos(uWind*1.2 + ph*1.3 + position.x*0.6) * sway;'].join('\n'));
      /* both sides of a card take the crown's normal, so backs are not black */
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
        'float faceDirection = 1.0;\nvec3 normal = normalize( vNormal );\nvec3 geometryNormal = normal;');
    };
    var depthMat = new THREE.MeshDepthMaterial({ depthPacking:THREE.RGBADepthPacking, map:leafTex, alphaTest:0.5 });
    return (treeKit = { kinds:kinds, leafMat:leafMat, depthMat:depthMat });
  }
  function buildTrees(group, trees){
    if (!trees.length) return;
    var M = mats(), kit = treeSetup();
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    var col = new THREE.Color(), byKind = [];
    trees.forEach(function(t, i){
      var k = Math.floor(t.tone*997) % TREE_KINDS;
      (byKind[k] = byKind[k] || []).push(t);
    });
    byKind.forEach(function(list, k){
      if (!list) return;
      var kind = kit.kinds[k];
      var wood = new THREE.InstancedMesh(kind.wood, M.trunk, list.length);
      var leaves = new THREE.InstancedMesh(kind.leaves, kit.leafMat, list.length);
      list.forEach(function(t, i){
        var h = t.h*U*1.1, r = t.r*U*1.5;
        q.setFromAxisAngle(THREE.Object3D.DefaultUp, t.tone*40);
        m.compose(p.set(t.x*U, 0, t.y*U), q, s.set(r/kind.r, h/kind.h, r/kind.r));
        wood.setMatrixAt(i, m); leaves.setMatrixAt(i, m);
        /* each tree its own green: some yellower, some darker and bluer */
        col.setHSL(0.20 + t.tone*0.07, 0.30, 0.62 + ((t.tone*7.3) % 1)*0.16);
        leaves.setColorAt(i, col);
      });
      wood.castShadow = wood.receiveShadow = true;
      leaves.castShadow = leaves.receiveShadow = true;
      leaves.customDepthMaterial = kit.depthMat;
      group.add(wood); group.add(leaves);
    });
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
      paint:new Builder(), pave:new Builder(), island:new Builder(), gutter:new Builder(), drains:[],
      stucco:new Builder(), sill:new Builder(), awning:new Builder(), chimney:new Builder(), dormerGlass:new Builder(),
      signs:[], dishes:[], aerials:[],
      bike:new Builder(), bikeX:new Builder(),
      hedge:new Builder(), balc:new Builder(), rail:new Builder(),
      railBars:new Builder(), railGlass:new Builder(), railPanel:new Builder(), planter:new Builder(), flowers:new Builder(),
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
      if (bed){ buildRails(group, map, bed, view); buildCatenary(group, map, bed, view); }
      buildFurniture(group, view);
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
      ['kerb', M.kerb], ['paint', M.paint], ['pave', M.pavers], ['island', M.grass], ['gutter', M.gutter],
      ['bike', M.cycle], ['bikeX', M.cycle],
      ['hedge', M.hedge, true], ['balc', M.balc, true], ['rail', M.railing, true],
      ['railBars', balconyMats().bars, true], ['railGlass', balconyMats().glass], ['railPanel', M.railPanel, true],
      ['planter', M.planter, true], ['flowers', balconyMats().flowers, true],
      ['wallA', M.wallA, true], ['wallB', M.wallB, true], ['shop', M.shop, true], ['home', M.home, true],
      ['gable', M.gable, true], ['roof', M.roof, true], ['eaves', M.kerb, true],
      ['stucco', M.stucco, true], ['sill', M.sill, true], ['awning', M.awning, true], ['chimney', M.brick, true],
      ['dormerGlass', M.dormerGlass]
    ];
    layers.forEach(function(l){
      var mesh = P[l[0]] && P[l[0]].mesh(l[1], l[2]);
      if (mesh) group.add(mesh);
    });
    if (P.drains && P.drains.length) group.add(buildDrains(P.drains));
    if (P.signs) mergeByMaterial(P.signs).forEach(function(m){ group.add(m); });
    if (P.dishes && (P.dishes.length || P.aerials.length)) buildRoofBits(group, P.dishes, P.aerials);
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
  function Merger(){ this.pos = []; this.nor = []; this.col = []; this.uv = []; this.idx = []; }
  Merger.prototype.add = function(geo, m4, color){
    var p = geo.attributes.position, n = geo.attributes.normal, base = this.pos.length/3, i;
    var nm = new THREE.Matrix3().getNormalMatrix(m4), v = new THREE.Vector3();
    for (i = 0; i < p.count; i++){
      v.fromBufferAttribute(p, i).applyMatrix4(m4); this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); this.nor.push(v.x, v.y, v.z);
      if (color) this.col.push(color.r, color.g, color.b);
      if (geo.attributes.uv) this.uv.push(geo.attributes.uv.getX(i), geo.attributes.uv.getY(i)); else this.uv.push(0, 0);
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
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx.length > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : this.idx);
    g.computeBoundingSphere();
    var m = new THREE.Mesh(g, mat);
    m.castShadow = !!shadow; m.receiveShadow = true; m.matrixAutoUpdate = false;
    return m;
  };

  /* cars parked along the quiet streets, half up on the kerb */
  function buildParked(group, view){
    if (!view.parked.length) return;
    /* the same baked bodies as the moving cars, drawn as instances: one
       draw per body type and material, each car its own paint colour */
    var VMs = vehicleMats(), byType = {};
    view.parked.forEach(function(pc){ (byType[pc.type] = byType[pc.type] || []).push(pc); });
    var parkedPaint = new THREE.MeshPhysicalMaterial({ color:0xffffff, metalness:0.45, roughness:0.34,
                                                        clearcoat:1, clearcoatRoughness:0.08, envMapIntensity:0.8 });
    parkedPaintMat = parkedPaint;
    var mats = { paint:parkedPaint, cabPaint:parkedPaint, glass:VMs.glass, trim:VMs.trim, chrome:VMs.chrome,
                 tyre:VMs.tyre, rim:VMs.rim, head:VMs.head, drl:VMs.drl, tail:VMs.tail };
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
    var up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    Object.keys(byType).forEach(function(t){
      var list = byType[t], type = TYPE_NAMES[t];
      var B = bakedCar(type, carGeometry(type, CFG.CAR_L*U, CFG.CAR_W*U));
      Object.keys(B).forEach(function(k){
        if (!mats[k]) return;
        var im = new THREE.InstancedMesh(B[k], mats[k], list.length);
        list.forEach(function(pc, i){
          m.compose(pv.set(pc.x*U, 0.03, pc.y*U), q.setFromAxisAngle(up, -pc.h), s);
          im.setMatrixAt(i, m);
          if (k === 'paint' || k === 'cabPaint') im.setColorAt(i, col.set(pc.color));
        });
        im.castShadow = k === 'paint' || k === 'glass' || k === 'tyre';
        im.receiveShadow = true;
        im.frustumCulled = false;                     // instances spread over the whole town
        group.add(im);
      });
    });
  }
  var parkedPaintMat = null;

  var BALC = null;
  function balconyMats(){
    if (BALC) return BALC;
    var c = document.createElement('canvas'); c.width = 128; c.height = 128;
    var x = c.getContext('2d');
    x.clearRect(0, 0, 128, 128);
    x.fillStyle = '#2f3236';
    x.fillRect(0, 0, 128, 10); x.fillRect(0, 118, 128, 10);           // top and bottom rails
    for (var i = 4; i < 128; i += 14) x.fillRect(i, 0, 5, 128);        // the bars
    var bt = new THREE.CanvasTexture(c); bt.encoding = THREE.sRGBEncoding; bt.wrapS = THREE.RepeatWrapping;
    var f = document.createElement('canvas'); f.width = 128; f.height = 64;
    var y = f.getContext('2d'), R = rng(77);
    y.fillStyle = '#2f5a2a'; y.fillRect(0, 0, 128, 64);
    for (var k = 0; k < 160; k++){ y.fillStyle = 'hsl(' + (95 + R()*40) + ',45%,' + (18 + R()*20) + '%)'; y.beginPath(); y.arc(R()*128, R()*64, 2 + R()*4, 0, 6.3); y.fill(); }
    var cols = ['#e8364d', '#ff6f91', '#f6c90e', '#ffffff', '#d6336c', '#ff8c42'];
    for (k = 0; k < 70; k++){ y.fillStyle = cols[Math.floor(R()*cols.length)]; y.beginPath(); y.arc(R()*128, R()*64, 2 + R()*2.5, 0, 6.3); y.fill(); }
    var ft = new THREE.CanvasTexture(f); ft.encoding = THREE.sRGBEncoding; ft.wrapS = ft.wrapT = THREE.RepeatWrapping;
    BALC = {
      bars: new THREE.MeshStandardMaterial({ map:bt, alphaTest:0.5, side:THREE.DoubleSide, metalness:0.4, roughness:0.5 }),
      glass: new THREE.MeshStandardMaterial({ color:0xcfe0e6, transparent:true, opacity:0.45, roughness:0.15,
                                              side:THREE.DoubleSide, depthWrite:false, envMapIntensity:1.2 }),
      flowers: new THREE.MeshStandardMaterial({ map:ft, roughness:0.9 })
    };
    return BALC;
  }
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
      /* one style per house: iron bars, frosted glass, or painted panels */
      var st = hash(hs.seed, 11, 2), style = st < 0.45 ? 'bars' : st < 0.7 ? 'glass' : 'panel';
      var panelCol = ['#b8c4c9', '#d9cfa8', '#8a9a7b', '#c98f6b', '#e8e4da', '#7b8fa8'][Math.floor(hash(hs.seed, 3, 11)*6)];
      var B = style === 'bars' ? P.railBars : style === 'glass' ? P.railGlass : P.railPanel;
      if (style === 'panel') B.color(panelCol);
      /* a point at (s along the front from the middle, o out from the wall) */
      function pt(s, o, y){ return alongX ? [mid + s, y, wall + out*o] : [wall + out*o, y, mid + s]; }
      function quad(Bd, s0, o0, s1, o1, y0, y1, nrm){
        var len = Math.hypot(s1 - s0, o1 - o0);
        Bd.quad(pt(s0, o0, y0), pt(s1, o1, y0), pt(s1, o1, y1), pt(s0, o0, y1), nrm, [[0,0],[len/0.9,0],[len/0.9,1],[0,1]]);
      }
      /* an axis-aligned box from (s0,o0) to (s1,o1), y0..y1 */
      function box(Bd, s0, o0, s1, o1, y0, y1){
        var p = pt(s0, o0, 0), q = pt(s1, o1, 0);
        Bd.box(Math.min(p[0], q[0]), Math.max(p[0], q[0]), y0, y1, Math.min(p[2], q[2]), Math.max(p[2], q[2]), 1);
      }
      var outN = alongX ? [0, 0, out] : [out, 0, 0], sideN = alongX ? [1, 0, 0] : [0, 0, 1];
      var D = 1.25, Wd = 1.4;
      for (var f = 1; f < hs.floors; f++){
        var y = f*FLOOR;
        box(P.balc, -Wd, 0, Wd, D, y - 0.15, y);                         // the slab
        /* the railing: front and both ends, 1 m high, a slim handrail on top */
        quad(B, -Wd + 0.03, D - 0.03, Wd - 0.03, D - 0.03, y, y + 0.95, outN);
        quad(B, -Wd + 0.03, 0, -Wd + 0.03, D - 0.03, y, y + 0.95, sideN);
        quad(B, Wd - 0.03, 0, Wd - 0.03, D - 0.03, y, y + 0.95, sideN);
        box(P.rail, -Wd, D - 0.06, Wd, D, y + 0.95, y + 1.0);
        box(P.rail, -Wd, 0, -Wd + 0.06, D, y + 0.95, y + 1.0);
        box(P.rail, Wd - 0.06, 0, Wd, D, y + 0.95, y + 1.0);
        /* flower boxes hung on the rail on some floors */
        if (hash(hs.seed, f, 13) < 0.4){
          var fs0 = -Wd + 0.2 + hash(hs.seed, f, 14)*0.6, fs1 = fs0 + 1.1;
          box(P.planter, fs0, D, fs1, D + 0.2, y + 0.72, y + 0.92);
          box(P.flowers, fs0 + 0.02, D + 0.02, fs1 - 0.02, D + 0.18, y + 0.92, y + 1.12);
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

  /* many small meshes sharing a few materials: bake them into one each */
  function mergeByMaterial(list){
    var by = new Map();
    list.forEach(function(m){
      m.updateMatrix();
      if (!by.has(m.material)) by.set(m.material, new Merger());
      by.get(m.material).add(m.geometry, m.matrix);
    });
    var out = [];
    by.forEach(function(mg, mat){ var mesh = mg.mesh(mat, true); if (mesh) out.push(mesh); });
    return out;
  }
  function buildRoofBits(group, dishes, aerials){
    var M = mats(), mg = new Merger(), ag = new Merger(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    var bowl = new THREE.SphereGeometry(0.36, 16, 8, 0, Math.PI*2, 0, Math.PI*0.32).rotateX(-Math.PI/2);
    var arm = new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6).rotateX(Math.PI/2);
    dishes.forEach(function(d){
      q.setFromEuler(e.set(-0.5, d.ry, 0, 'YXZ'));
      m4.compose(new THREE.Vector3(d.x, d.y, d.z), q, new THREE.Vector3(1, 1, 1)); mg.add(bowl, m4);
      m4.compose(new THREE.Vector3(d.x, d.y - 0.05, d.z), q, new THREE.Vector3(1, 1, 1)); mg.add(arm, m4);
    });
    var mast = new THREE.CylinderGeometry(0.025, 0.03, 2.2, 6), bar = new THREE.CylinderGeometry(0.012, 0.012, 1.1, 5).rotateZ(Math.PI/2);
    aerials.forEach(function(a){
      m4.compose(new THREE.Vector3(a.x, a.y + 1.1, a.z), q.setFromEuler(e.set(0, a.ry, 0)), new THREE.Vector3(1, 1, 1)); ag.add(mast, m4);
      for (var k = 0; k < 4; k++){
        m4.compose(new THREE.Vector3(a.x, a.y + 1.5 + k*0.17, a.z), q.setFromEuler(e.set(0, a.ry, 0)), new THREE.Vector3(1 - k*0.18, 1, 1));
        ag.add(bar, m4);
      }
    });
    var dm = mg.mesh(M.dish, true), am = ag.mesh(M.metal, false);
    if (dm) group.add(dm);
    if (am) group.add(am);
  }

  /* drain grates in the gutters: cast iron, slotted */
  function buildDrains(list){
    var c = document.createElement('canvas'); c.width = 64; c.height = 96;
    var x = c.getContext('2d');
    x.fillStyle = '#26282a'; x.fillRect(0, 0, 64, 96);
    x.fillStyle = '#3c3e40'; x.fillRect(3, 3, 58, 90);
    x.fillStyle = '#0a0a0a';
    for (var y = 9; y < 90; y += 9) x.fillRect(9, y, 46, 4);
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    var mat = new THREE.MeshStandardMaterial({ map:t, metalness:0.6, roughness:0.6,
                                               polygonOffset:true, polygonOffsetFactor:-3, polygonOffsetUnits:-3 });
    var geo = new THREE.PlaneGeometry(0.45, 0.65).rotateX(-Math.PI/2);
    var im = new THREE.InstancedMesh(geo, mat, list.length), m = new THREE.Matrix4(), r = new THREE.Matrix4();
    list.forEach(function(d, i){
      m.makeRotationY(d.along ? 0 : Math.PI/2);
      m.setPosition(d.x, 0.037, d.z);
      im.setMatrixAt(i, m);
    });
    void r;
    im.receiveShadow = true;
    return im;
  }

  /* ---------------- street furniture ---------------- */
  /* Bins on posts, steel bike hoops (some with a bike leant on them),
     benches, bollards, street-name signs at every corner and round
     advertising pillars - merged by material, so a whole town of them
     is a handful of draws. */
  var nameSignCache = {};
  function nameSignMat(text){
    if (nameSignCache[text]) return nameSignCache[text];
    var c = document.createElement('canvas'); c.width = 512; c.height = 112;
    var x = c.getContext('2d');
    x.fillStyle = '#f7f7f3'; x.fillRect(0, 0, 512, 112);
    x.strokeStyle = '#151515'; x.lineWidth = 6; x.strokeRect(9, 9, 494, 94);
    x.fillStyle = '#151515'; x.textAlign = 'center'; x.textBaseline = 'middle';
    var size = 54; x.font = 'bold ' + size + 'px Arial';
    while (size > 22 && x.measureText(text).width > 460){ size -= 2; x.font = 'bold ' + size + 'px Arial'; }
    x.fillText(text, 256, 58);
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    t.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
    return (nameSignCache[text] = new THREE.MeshStandardMaterial({ map:t, roughness:0.5 }));
  }
  var posterTex = null;
  function posterMat(){
    if (posterTex) return posterTex;
    var c = document.createElement('canvas'); c.width = 1024; c.height = 256;
    var x = c.getContext('2d'), rand = CityView.rng(31);
    var cols = ['#d6402f', '#f2b705', '#1d5fa8', '#2f8f5b', '#e86a92', '#f4efe2', '#222831', '#7a4fb3'];
    x.fillStyle = '#e9e4d6'; x.fillRect(0, 0, 1024, 256);
    for (var px = 0; px < 1024; ){
      var w = 120 + Math.floor(rand()*110), bg = cols[Math.floor(rand()*cols.length)];
      x.fillStyle = bg; x.fillRect(px + 4, 10, w - 8, 236);
      x.fillStyle = bg === '#f4efe2' || bg === '#f2b705' ? '#222' : '#fff';
      x.font = 'bold ' + (26 + Math.floor(rand()*16)) + 'px Arial'; x.textAlign = 'center';
      var words = ['KONZERT', 'FESTIVAL', 'THEATER', 'AUSSTELLUNG', 'KINO', 'MESSE', 'OPER', 'ZIRKUS', 'JAZZ'];
      x.fillText(words[Math.floor(rand()*words.length)], px + w/2, 70);
      x.fillRect(px + 20, 100, w - 40, 6);
      x.font = '18px Arial'; x.fillText('Frankfurt', px + w/2, 140);
      x.fillText(String(1 + Math.floor(rand()*28)) + '.' + String(1 + Math.floor(rand()*12)) + '.', px + w/2, 170);
      px += w;
    }
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.wrapS = THREE.RepeatWrapping;
    return (posterTex = new THREE.MeshStandardMaterial({ map:t, roughness:0.75 }));
  }
  var FURN = null;
  function furnMats(){
    if (FURN) return FURN;
    function std(o){ return new THREE.MeshStandardMaterial(o); }
    FURN = {
      steel:  std({ color:0x8c9196, metalness:0.75, roughness:0.35 }),
      anthr:  std({ color:0x34383d, metalness:0.4, roughness:0.55 }),
      bin:    std({ color:0xe2622a, roughness:0.5 }),
      white:  std({ color:0xf2f2ee, roughness:0.4 }),
      wood:   std({ color:0x8a6342, roughness:0.8 }),
      green:  std({ color:0x2f4a3a, metalness:0.3, roughness:0.6 }),
      tyre:   std({ color:0x151515, roughness:0.85 }),
      frame:  std({ color:0x2a4f7a, metalness:0.4, roughness:0.45 })
    };
    return FURN;
  }
  function buildFurniture(group, view){
    var list = view.furniture || [];
    if (!list.length) return;
    var F = furnMats(), mg = {};
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    var G = {
      cyl: new THREE.CylinderGeometry(1, 1, 1, 14), box: new THREE.BoxGeometry(1, 1, 1),
      hoop: new THREE.TorusGeometry(0.4, 0.025, 6, 20, Math.PI),
      wheel: new THREE.TorusGeometry(0.33, 0.022, 6, 22), dome: new THREE.SphereGeometry(1, 16, 8, 0, Math.PI*2, 0, Math.PI/2)
    };
    /* put a unit shape into the merged mesh for this material */
    function put(mat, geo, x, y, z, sx, sy, sz, ry, rx, rz){
      m4.compose(p.set(x, y, z), q.setFromEuler(e.set(rx || 0, ry || 0, rz || 0, 'YXZ')), s.set(sx, sy, sz));
      (mg[mat] || (mg[mat] = new Merger())).add(geo, m4);
    }
    /* a point a metres along the street and b metres towards the houses */
    function at(o, a, b){ return o.col ? [o.x*U + b*o.side, o.y*U + a] : [o.x*U + a, o.y*U + b*o.side]; }
    var names = [];
    list.forEach(function(o){
      var X = o.x*U, Z = o.y*U, ry = -(o.h || 0);
      if (o.kind === 'bin'){
        put('anthr', G.cyl, X, 0.6, Z, 0.04, 1.2, 0.04);
        put('bin', G.cyl, X + 0.0, 0.85, Z, 0.21, 0.55, 0.21);
        put('anthr', G.cyl, X, 1.14, Z, 0.22, 0.03, 0.22);
      } else if (o.kind === 'rack'){
        /* hoops across the pavement; a bike leant on each of the first few */
        var across = ry + Math.PI/2;
        for (var k = 0; k < 3; k++){
          var hp = at(o, (k - 1)*0.9, 0);
          put('steel', G.hoop, hp[0], 0.0, hp[1], 1, 2.0, 1, across);
          if (k < o.bikes){
            var al = (k - 1)*0.9 + 0.12;
            [-0.52, 0.52].forEach(function(w){
              var wp = at(o, al, w);
              put('tyre', G.wheel, wp[0], 0.34, wp[1], 1, 1, 1, across);
            });
            var bp = at(o, al, 0);
            put('frame', G.box, bp[0], 0.55, bp[1], 1.0, 0.035, 0.035, across);
            var sp = at(o, al, -0.2), hb = at(o, al, 0.45);
            put('frame', G.box, sp[0], 0.72, sp[1], 0.03, 0.4, 0.03, across);
            put('anthr', G.box, sp[0], 0.94, sp[1], 0.24, 0.04, 0.1, across);       // saddle
            put('anthr', G.box, hb[0], 0.98, hb[1], 0.04, 0.03, 0.5, across);       // handlebar
          }
        }
      } else if (o.kind === 'bench'){
        var bc = at(o, 0, 0);
        put('wood', G.box, bc[0], 0.45, bc[1], 1.6, 0.05, 0.42, ry);
        var back = at(o, 0, 0.2);
        put('wood', G.box, back[0], 0.75, back[1], 1.6, 0.32, 0.04, ry);
        [-0.7, 0.7].forEach(function(a){ var lp = at(o, a, 0); put('anthr', G.box, lp[0], 0.22, lp[1], 0.06, 0.44, 0.42, ry); });
      } else if (o.kind === 'bollard'){
        put('anthr', G.cyl, X, 0.45, Z, 0.07, 0.9, 0.07);
        put('white', G.cyl, X, 0.75, Z, 0.072, 0.07, 0.072);
        put('anthr', G.dome, X, 0.9, Z, 0.07, 0.04, 0.07);
      } else if (o.kind === 'pillar'){
        put('green', G.cyl, X, 0.15, Z, 0.68, 0.3, 0.68);
        put('poster', G.cyl, X, 1.65, Z, 0.62, 2.7, 0.62, o.seed*6);
        put('green', G.cyl, X, 3.05, Z, 0.7, 0.1, 0.7);
        put('green', G.dome, X, 3.1, Z, 0.66, 0.35, 0.66);
      } else if (o.kind === 'name'){
        put('anthr', G.cyl, X, 1.5, Z, 0.035, 3.0, 0.035);
        names.push(o);
      }
    });
    var mats = { steel:F.steel, anthr:F.anthr, bin:F.bin, white:F.white, wood:F.wood, green:F.green, tyre:F.tyre, frame:F.frame, poster:posterMat() };
    Object.keys(mg).forEach(function(k){
      var m = mg[k].mesh(mats[k], true);
      if (m) group.add(m);
    });
    /* street names: one blade along each street, both sides printed */
    var blade = new THREE.PlaneGeometry(0.9, 0.2), blades = [];
    names.forEach(function(o){
      [[o.a, Math.PI/2, 2.95], [o.b, 0, 2.7]].forEach(function(n){
        if (!n[0]) return;
        var mat = nameSignMat(n[0]);
        [0, Math.PI].forEach(function(flip){
          var b = new THREE.Mesh(blade, mat);
          b.position.set(o.x*U, n[2], o.y*U);
          b.rotation.y = n[1] + flip;
          b.translateX(flip ? -0.47 : 0.47);
          b.translateZ(0.004);
          blades.push(b);
        });
      });
    });
    mergeByMaterial(blades).forEach(function(m){ m.castShadow = false; group.add(m); });
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
      if (!g || g.parent !== scene){
        /* now and then a child, walking along with everyone else */
        g = o.wk._mesh = buildPerson(o.wk.look, ((o.wk.look*17.3) % 1) < 0.12);
        scene.add(g); walkerAll.push(g);
      }
      g.visible = true;
      g.position.set(o.at.x*U, 0.02, o.at.y*U);
      g.rotation.y = -o.at.h;
      swing(g, 0.42, t);
      walkerShown.push(g);
    });
  }

  /* the overhead line: masts along the east edge of the bed every 30 m or
     so (never in a road), each with a cantilever reaching over both
     tracks; a contact wire zig-zagging a little from mast to mast, so the
     pantograph wears evenly, hung by droppers from a sagging catenary */
  function buildCatenary(group, map, bed, view){
    var M = mats(), poles = new Merger(), wires = new Merger();
    var rod = new THREE.CylinderGeometry(1, 1, 1, 10), thin = new THREE.CylinderGeometry(1, 1, 1, 5);
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), mid = new THREE.Vector3();
    var up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3();
    function link(mg, geo, a, b, r){
      d.subVectors(b, a); var len = d.length();
      if (len < 1e-4) return;
      q.setFromUnitVectors(up, d.normalize());
      m4.compose(mid.copy(a).add(b).multiplyScalar(0.5), q, sc.set(r, len, r));
      mg.add(geo, m4);
    }
    var V = THREE.Vector3;
    var rows = []; for (var r = 0; r < map.rows; r++) rows.push(view.rowY(r));
    var clear = CFG.BOX + 40;
    var ys = [];
    for (var y = bed.y0 + 20; y < bed.y1 - 20; y += 360){
      var yy = y, tries = 0;
      while (rows.some(function(ry){ return Math.abs(yy - ry) < clear; }) && tries++ < 8) yy += 60;
      if (!ys.length || yy - ys[ys.length - 1] > 180) ys.push(yy);
    }
    var px = (bed.x1 - 2)*U, tracks = bed.tracks.map(function(t){ return t*U; });
    var far = Math.min.apply(null, tracks) - 0.6;
    var CW = 5.6, MW = 6.75;
    ys.forEach(function(y, i){
      var z = y*U;
      link(poles, rod, new V(px, 0, z), new V(px, 7.5, z), 0.11);
      link(poles, rod, new V(px, 7.5, z), new V(px, 7.56, z), 0.13);              // cap
      link(poles, rod, new V(px, 7.1, z), new V(far, 7.1, z), 0.045);              // cantilever
      link(poles, rod, new V(px, 6.2, z), new V(far + 0.3, 6.95, z), 0.035);       // stay
      tracks.forEach(function(tx){
        var stag = (i % 2 ? 0.22 : -0.22);
        link(poles, rod, new V(tx + stag, 7.1, z), new V(tx + stag, CW + 0.05, z), 0.018);   // registration
        link(poles, rod, new V(tx + stag - 0.25, CW + 0.08, z), new V(tx + stag + 0.25, CW + 0.08, z), 0.012);
      });
    });
    /* wires, span by span */
    for (var k = 0; k < ys.length - 1; k++){
      var z0 = ys[k]*U, z1 = ys[k + 1]*U;
      tracks.forEach(function(tx){
        var s0 = k % 2 ? 0.22 : -0.22, s1 = -s0, n = 6, prev = null, prevC = null;
        for (var j = 0; j <= n; j++){
          var f = j/n, z = z0 + (z1 - z0)*f;
          var sag = 0.38*4*f*(1 - f);
          var ms = new V(tx + s0 + (s1 - s0)*f, MW - sag, z), ct = new V(tx + s0 + (s1 - s0)*f, CW, z);
          if (prev){ link(wires, thin, prev, ms, 0.008); link(wires, thin, prevC, ct, 0.011); }
          if (j > 0 && j < n) link(wires, thin, ms, ct, 0.003);
          prev = ms; prevC = ct;
        }
      });
    }
    var pm = poles.mesh(M.mast, true), wm = wires.mesh(M.wire, false);
    if (pm) group.add(pm);
    if (wm) group.add(wm);
  }
  function buildRails(group, map, bed, view){
    var M = mats(), rb = new Builder(), gb = new Builder(), pb = new Builder();
    /* on the gravel the rails stand up on sleepers; where a street
       crosses they lie flush in a concrete panel, a groove beside each */
    var gap = CFG.BOX + 6, spans = [], from = bed.y0;
    var cuts = [];
    for (var r0 = 0; r0 < map.rows; r0++){ var ry0 = view.rowY(r0); if (ry0 > bed.y0 && ry0 < bed.y1) cuts.push(ry0); }
    cuts.sort(function(a, b){ return a - b; }).forEach(function(ry){
      spans.push([from, ry - gap, false]); spans.push([ry - gap, ry + gap, true]); from = ry + gap;
    });
    spans.push([from, bed.y1, false]);
    bed.tracks.forEach(function(tx){
      [-8.6, 8.6].forEach(function(g){
        spans.forEach(function(sp){
          if (sp[1] <= sp[0]) return;
          if (!sp[2]) rb.box((tx + g - 0.45)*U, (tx + g + 0.45)*U, 0.02, 0.17, sp[0]*U, sp[1]*U, 1);
          else {
            rb.box((tx + g - 0.45)*U, (tx + g + 0.45)*U, 0.03, 0.044, sp[0]*U, sp[1]*U, 1);
            var gi = g < 0 ? 1 : -1;                     // the groove on the inside of each rail
            gb.box((tx + g + gi*0.45)*U - (gi < 0 ? 0.045 : 0), (tx + g + gi*0.45)*U + (gi > 0 ? 0.045 : 0), 0.03, 0.043, sp[0]*U, sp[1]*U, 1);
          }
        });
      });
      cuts.forEach(function(ry){ pb.flat(tx - 14, ry - gap, tx + 14, ry + gap, 0.036, 1.6); });
    });
    group.add(rb.mesh(M.rail, true));
    var gm = gb.mesh(M.groove), pm = pb.mesh(M.panel);
    if (gm) group.add(gm);
    if (pm) group.add(pm);
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
     - x in fractions of the length from its middle, y in metres - that the
     lofted body and glasshouse below are shaped to. */
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
  /* ---------------- smooth bodies ---------------- */
  /* A body is lofted: slices across the car from nose to tail, each a
     rounded section (flat-ish top, near-upright sides, soft shoulders,
     tucked under at the sill) between the side profile's lower and upper
     lines. In plan the slices narrow towards both ends, so nose and tail
     come out round, and the wheel arches are cut out of the sides. With
     smooth normals the clear coat then reflects the sky in long, unbroken
     highlights, as real paint does. */
  var PLAN_P = 5;                                   // plan-view squareness of the ends
  function curveFn(pts){
    /* y at x along a side-profile line given as [x, y] points, smoothed */
    var c = new THREE.SplineCurve(pts.map(function(p){ return new THREE.Vector2(p[0], p[1]); }));
    var s = c.getPoints(120).sort(function(a, b){ return a.x - b.x; });
    return function(x){
      if (x <= s[0].x) return s[0].y;
      if (x >= s[s.length - 1].x) return s[s.length - 1].y;
      var lo = 0, hi = s.length - 1;
      while (hi - lo > 1){ var mid = (lo + hi) >> 1; if (s[mid].x <= x) lo = mid; else hi = mid; }
      var t = (x - s[lo].x)/Math.max(1e-6, s[hi].x - s[lo].x);
      return s[lo].y + (s[hi].y - s[lo].y)*t;
    };
  }
  /* stations from end to end, closer together at the ends where it curves */
  function stations(n){
    var out = [];
    for (var i = 0; i <= n; i++) out.push(-Math.cos(Math.PI*i/n));
    return out;
  }
  /* grid of points [station][ring] -> indexed, smooth-shaded geometry */
  function gridGeometry(P, closed){
    var pos = [], idx = [], rows = P.length, cols = P[0].length;
    P.forEach(function(row){ row.forEach(function(p){ pos.push(p[0], p[1], p[2]); }); });
    var cm = closed ? cols : cols - 1;
    for (var i = 0; i < rows - 1; i++)
      for (var j = 0; j < cm; j++){
        var a = i*cols + j, b = i*cols + (j + 1) % cols, c = a + cols, d = b + cols;
        idx.push(a, c, b, b, c, d);
      }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  /* one slice: a rounded rectangle, half width w, from bot to top, with
     corner radii rb (sill) and rt (shoulder), a slightly domed top and
     sides leaning in by lean towards the top. 28 points round, starting
     at the bottom middle; points 9..19 are the top, 6..22 top and sides */
  var SECTION = 28;
  function section(w, bot, top, rb, rt, lean, dome){
    var h = Math.max(0.002, top - bot);
    rt = Math.min(rt, w*0.9, h*0.6); rb = Math.min(rb, w*0.9, h*0.4);
    var half = [[0, bot], [(w - rb)*0.5, bot]];
    for (var k = 0; k < 4; k++){ var a = -Math.PI/2 + k*Math.PI/6; half.push([w - rb + Math.cos(a)*rb, bot + rb + Math.sin(a)*rb]); }
    for (k = 1; k <= 2; k++) half.push([w, bot + rb + (h - rb - rt)*k/3]);
    for (k = 0; k < 5; k++){ var b = k*Math.PI/8; half.push([w - rt + Math.cos(b)*rt, top - rt + Math.sin(b)*rt]); }
    half.push([(w - rt)*0.5, top + dome*0.75], [0, top + dome]);
    var ring = half.slice();
    for (k = half.length - 2; k >= 1; k--) ring.push([-half[k][0], half[k][1]]);
    return ring.map(function(p){
      var f = (p[1] - bot)/h;
      return [p[0]*(1 - lean*f), p[1]];
    });
  }
  function loftBody(T, L, W){
    var n = T.body.length, h = L/2;
    var upper = curveFn(T.body.slice(3, n - 1).map(function(p){ return [p[0]*L, p[1]]; }));
    var lower = curveFn([T.body[n - 1], T.body[0], T.body[1], T.body[2]].map(function(p){ return [p[0]*L, p[1]]; }));
    var R = T.wheelR + 0.06, arches = [0.31*L, -0.30*L];
    function floor(x){
      var y = lower(x);
      arches.forEach(function(xc){
        var d = x - xc;
        if (Math.abs(d) < R) y = Math.max(y, T.wheelR + 0.01 + Math.sqrt(R*R - d*d));
      });
      return y;
    }
    var P = [];
    stations(40).forEach(function(s){
      var x = s*h*0.999, cut = floor(x);
      var w = (W/2) * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(s), PLAN_P)), 1/PLAN_P);
      P.push(section(Math.max(0.002, w), lower(x), upper(x), 0.08, 0.17, 0.05, 0.025).map(function(p){
        return [x, Math.max(cut, p[1]), p[0]];
      }));
    });
    return gridGeometry(P, true);
  }
  /* the glasshouse, narrower at the roof than at the belt; with opts just
     the top (or top and sides) between x0 and x1, a hair proud of the
     glass - the painted roof, or a panel van's blind sides */
  function loftCab(T, L, Wc, opts){
    var cab = T.cab;
    var x0 = cab[cab.length - 1][0]*L, x1 = cab[0][0]*L;
    var top = curveFn(cab.map(function(p){ return [p[0]*L, p[1]]; }));
    var bot = function(x){ var t = (x - x0)/(x1 - x0); return cab[cab.length - 1][1] + (cab[0][1] - cab[cab.length - 1][1])*t; };
    var lean = T.panel ? 0.06 : 0.2, P = [];
    var a0 = opts ? opts.x0 : x0, a1 = opts ? opts.x1 : x1;
    stations(opts ? 12 : 28).forEach(function(s){
      var x = a0 + (a1 - a0)*(s + 1)/2;
      var sc = ((x - x0)/(x1 - x0))*2 - 1;
      var plan = Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(sc)), 8)), 1/8);
      var ring = section(Math.max(0.002, Wc/2*plan), bot(x), Math.max(bot(x) + 0.002, top(x)), 0.001, 0.14, lean, 0.03);
      if (opts) ring = ring.slice(opts.from, SECTION - opts.from + 1).map(function(p){ return [p[0]*1.012, p[1] + 0.008]; });
      P.push(ring.map(function(p){ return [x, p[1], p[0]]; }));
    });
    return gridGeometry(P, !opts);
  }
  /* the angle of the round nose in plan at a given width, to set lamps flush */
  function endSlope(L, W, z){
    var f = Math.min(0.98, Math.abs(z)/(W/2));
    return Math.atan((L/2) * Math.pow(f, PLAN_P - 1) * Math.pow(1 - Math.pow(f, PLAN_P), 1/PLAN_P - 1) / (W/2));
  }
  /* how far forward (or back) the round nose reaches at a given width */
  function endX(L, W, z){
    var f = Math.min(0.999, Math.abs(z)/(W/2));
    return (L/2) * Math.pow(1 - Math.pow(f, PLAN_P), 1/PLAN_P);
  }

  var carGeo = {};
  function carGeometry(type, L0, W){
    var T = CAR_TYPES[type], L = L0*T.len, key = type + L.toFixed(2) + 'x' + W.toFixed(2);
    if (carGeo[key]) return carGeo[key];
    var cab = T.cab, top = cab.reduce(function(m, p){ return Math.max(m, p[1]); }, 0);
    var rf = T.roof;
    var G = {
      T:T, L:L, W:W, top:top,
      body: loftBody(T, L, W),
      cab:  loftCab(T, L, W*T.glassW),
      roof: loftCab(T, L, W*T.glassW, { x0:rf[1]*L, x1:rf[0]*L, from:9 }),
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
      lamp: new THREE.BoxGeometry(0.05, 0.09, 0.34),
      drl:  new THREE.BoxGeometry(0.04, 0.02, 0.30),
      lampRear: new THREE.BoxGeometry(0.05, 0.10, 0.36),
      blinker: new THREE.BoxGeometry(0.05, 0.07, 0.12),
      plate: new THREE.PlaneGeometry(0.52, 0.115),
      grille: new THREE.BoxGeometry(0.05, 0.14, W*0.46),
      bumper: new THREE.BoxGeometry(0.08, 0.07, W*0.5),
      sill: new THREE.BoxGeometry(L*0.62, 0.14, W + 0.01),
      mirror: new THREE.SphereGeometry(0.1, 14, 10).scale(0.75, 0.62, 1.15),
      stalk: new THREE.BoxGeometry(0.06, 0.04, 0.1),
      mirrorGlass: new THREE.CircleGeometry(0.075, 16).scale(1, 0.75, 1),
      panel: T.panel ? loftCab(T, L, W*T.glassW, { x0:-0.49*L, x1:0.11*L, from:6 }) : null
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
    if (G.panel) put('paint', G.panel, 0, 0, 0);                         // a panel van's blind sides
    if (T.sill) put('trim', G.sill, 0, T.ride + 0.08, 0);
    put('trim', G.grille, h + 0.005, T.ride + 0.22, 0);
    /* a dark lower air intake; the bumpers themselves are body colour */
    put('trim', G.bumper, endX(L, W, W*0.31) - 0.035, T.body[2][1] + 0.05, 0);
    var mirX = T.cab[0][0]*L - 0.1, mirY = T.cab[0][1] + 0.07, mirZ = W*T.glassW/2 + 0.2;
    [-1, 1].forEach(function(side){
      put('paint', G.mirror, mirX, mirY, side*mirZ);
      put('trim', G.stalk, mirX, mirY - 0.02, side*(mirZ - 0.13));
      put('glass', G.mirrorGlass, mirX - 0.077, mirY, side*mirZ, -Math.PI/2);
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
    var belt = T.cab[0][1], seamH = belt - T.ride - 0.36, seamY = T.ride + 0.12 + seamH/2;
    var doors = [T.cab[0][0]*L - 0.05, (T.roof[0] + T.roof[1])*0.42*L];
    if (!T.panel) doors.push(Math.max(-L*0.36, T.roof[1]*L*0.72));
    [-1, 1].forEach(function(side){
      doors.forEach(function(x, i){
        put('trim', G.seam, x, seamY, side*(W/2 + 0.002), 0, seamH/0.5);
        if (i < doors.length - 1) put('chrome', G.handle, x - 0.22, belt - 0.22, side*(W/2 + 0.008));
      });
    });
    if (type === 'estate' || type === 'suv')
      [-1, 1].forEach(function(side){ put('trim', G.rail, (T.roof[0] + T.roof[1])*0.5*L, G.top + 0.06, side*W*0.34); });
    put('chrome', G.exhaust, -endX(L, W, W*0.3) + 0.02, T.ride + 0.02, W*0.3);
    var lz = W/2 - 0.27, lampX = endX(L, W, lz), tailX = endX(L, W, lz), ls = endSlope(L, W, lz);
    [-1, 1].forEach(function(side){
      put('head', G.lamp, lampX - 0.022, T.lampY, side*lz, -side*ls);
      put('drl', G.drl, lampX - 0.015, T.lampY - 0.065, side*lz, -side*ls);
      put('tail', G.lampRear, -tailX + 0.022, T.tailY, side*lz, side*ls);
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
      var lz = W/2 - 0.27;
      var m = part(G.lampRear, VMs.brake, -endX(L, W, lz) + 0.018, T.tailY, side*lz, g);
      m.rotation.y = side*endSlope(L, W, lz); m.visible = false; return m;
    });
    g.userData.blink = { left:[], right:[] };
    var bx = endX(L, W, W/2 - 0.16);
    [[bx - 0.02, T.lampY], [-bx + 0.02, T.tailY + 0.1]].forEach(function(pos){
      [-1, 1].forEach(function(side){
        var m = part(G.blinker, VMs.blink, pos[0] + (pos[0] > 0 ? 0.01 : -0.012), pos[1], side*(W/2 - 0.16), g);
        m.visible = false;
        g.userData.blink[side < 0 ? 'left' : 'right'].push(m);
      });
    });
    var pm = plateMat(plateText(String(v.id)));
    var nb = T.body.length;
    var pf = part(G.plate, pm, h + 0.012, T.body[2][1] + 0.1, 0, g); pf.rotation.y = Math.PI/2;
    var pr = part(G.plate, pm, -h - 0.012, T.body[nb - 1][1] + 0.14, 0, g); pr.rotation.y = -Math.PI/2;
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
  /* what you see of your own car from the driver's seat: a shaped
     dashboard with the instruments in a pod, a centre screen showing the
     satnav, vents and a trim strip, door cards, the A-pillars and roof
     lining, and a leather wheel with your hands on it */
  var CABIN = null;
  function cabinMats(){
    if (CABIN) return CABIN;
    function std(o){ return new THREE.MeshStandardMaterial(o); }
    CABIN = {
      dash:    std({ color:0x26272a, roughness:0.88, envMapIntensity:0.15 }),
      dashTop: std({ color:0x1d1e20, roughness:0.95, envMapIntensity:0.1 }),
      trim:    std({ color:0x8e9298, metalness:0.7, roughness:0.35 }),
      piano:   std({ color:0x0b0c0d, roughness:0.12, envMapIntensity:0.6 }),
      vent:    std({ color:0x0e0f10, roughness:0.7 }),
      door:    std({ color:0x2e2f33, roughness:0.85, envMapIntensity:0.12 }),
      fabric:  std({ color:0x6f6d69, roughness:1.0, envMapIntensity:0.1 }),
      pillar:  std({ color:0x3b3c3f, roughness:0.95, envMapIntensity:0.1 }),
      leather: std({ color:0x18181a, roughness:0.55, envMapIntensity:0.3 }),
      skin:    std({ color:0xc8987a, roughness:0.7, envMapIntensity:0.2 }),
      sleeve:  std({ color:0x2b3342, roughness:0.9, envMapIntensity:0.1 })
    };
    return CABIN;
  }
  /* a profile in (d forward of the eyes, height) pushed across the car */
  function crossExtrude(pts, ex, z0, z1){
    var s = new THREE.Shape();
    pts.forEach(function(p, i){ if (i) s.lineTo(ex + p[0], p[1]); else s.moveTo(ex + p[0], p[1]); });
    var g = new THREE.ExtrudeGeometry(s, { depth:z1 - z0, bevelEnabled:true, bevelThickness:0.012,
                                           bevelSize:0.012, bevelSegments:2, curveSegments:12 });
    g.translate(0, 0, z0);
    g.computeVertexNormals();
    return g;
  }
  function buildCockpit(v, car){
    var L = v.len*U, W = v.wid*U, VMs = vehicleMats(), C = cabinMats();
    var ex = -0.028*L, dz = -0.20*W;                 // the driver's eyes, as in frame()
    car.userData.cab.visible = false;
    car.userData.roofPanel.visible = false;
    car.userData.pillar.visible = false;
    /* seats, floor and the rest of the inside, dark, covering the body top */
    part(new THREE.BoxGeometry(L*0.44, 0.40, W - 0.10), VMs.dash, -L*0.18, 0.87, 0, car);
    /* the footwells and centre console, under the wheel */
    part(new THREE.BoxGeometry(0.70, 0.40, W - 0.14), C.door, ex + 0.28, 0.768, 0, car);

    /* the dashboard: windscreen base, a long soft top, a rounded lip,
       then the face dropping away towards your knees */
    var dash = [[1.17,0.90],[1.05,0.955],[0.80,0.975],[0.68,0.97],[0.645,0.945],[0.63,0.88],[0.60,0.72],[0.57,0.55],[1.17,0.55]];
    part(crossExtrude(dash, ex, -W/2 + 0.12, W/2 - 0.12), C.dash, 0, 0, 0, car);
    /* a trim strip across the face, and air vents */
    part(new THREE.BoxGeometry(0.012, 0.018, W - 0.34), C.trim, ex + 0.638, 0.915, 0, car);
    [-0.11, 0.11, -(W/2 - 0.24), W/2 - 0.24].forEach(function(z){
      part(new THREE.BoxGeometry(0.03, 0.065, 0.15), C.vent, ex + 0.622, 0.85, z, car);
      for (var k = -1; k <= 1; k++) part(new THREE.BoxGeometry(0.034, 0.006, 0.14), C.trim, ex + 0.622, 0.85 + k*0.02, z, car);
    });

    /* the instrument pod: the cluster under a short hood */
    /* a slim curved hood, open towards you */
    var hood = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.34, 20, 1, true, Math.PI*0.45, Math.PI*0.7)
      .rotateX(Math.PI/2), C.dashTop);
    hood.material = C.dashTop.clone(); hood.material.side = THREE.DoubleSide;
    hood.position.set(ex + 0.82, 0.985, dz);
    hood.rotation.y = 0;
    car.add(hood);
    var cc = document.createElement('canvas'); cc.width = 512; cc.height = 160;
    var ctex = new THREE.CanvasTexture(cc); ctex.encoding = THREE.sRGBEncoding;
    var cluster = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.094),
      new THREE.MeshBasicMaterial({ map:ctex, toneMapped:false }));
    cluster.position.set(ex + 0.81, 1.025, dz);
    cluster.rotation.set(0, -Math.PI/2, 0); cluster.rotateX(-0.25);
    car.add(cluster);
    car.userData.cluster = { canvas:cc, ctx:cc.getContext('2d'), tex:ctex, last:'' };

    /* the centre screen: the satnav, the same picture as the minimap */
    var mapCanvas = typeof document !== 'undefined' && document.getElementById('minimap');
    var scr = new THREE.Group();
    scr.position.set(ex + 0.80, 1.035, 0.03);
    scr.rotation.y = -Math.PI/2 - 0.42;                 // turned towards the driver
    scr.rotateX(-0.12);
    var bezel = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.15, 0.014), C.piano);
    scr.add(bezel);
    if (mapCanvas){
      var mtex = new THREE.CanvasTexture(mapCanvas); mtex.encoding = THREE.sRGBEncoding;
      var screen = new THREE.Mesh(new THREE.PlaneGeometry(0.228, 0.13),
        new THREE.MeshBasicMaterial({ map:mtex, toneMapped:false }));
      /* the square map, cropped to the screen's shape */
      mtex.repeat.set(1, 0.13/0.228); mtex.offset.set(0, (1 - 0.13/0.228)*0.62);
      screen.position.z = 0.0075;
      scr.add(screen);
      car.userData.navTex = mtex;
    }
    car.add(scr);

    /* door cards with a sill and armrest on both sides */
    [-1, 1].forEach(function(side){
      var z = side*(W/2 - 0.09);
      part(new THREE.BoxGeometry(1.35, 0.42, 0.06), C.door, ex + 0.25, 0.76, z, car);
      part(new THREE.BoxGeometry(1.35, 0.05, 0.12), C.dashTop, ex + 0.25, 0.975, side*(W/2 - 0.11), car);
      part(new THREE.BoxGeometry(0.40, 0.05, 0.10), C.door, ex + 0.05, 0.80, side*(W/2 - 0.15), car);
      part(new THREE.BoxGeometry(0.10, 0.03, 0.02), C.trim, ex + 0.38, 0.90, side*(W/2 - 0.125), car);   // door handle
    });
    /* A-pillars along the windscreen edges, roof lining and sun visors above */
    [-1, 1].forEach(function(side){
      var a = new THREE.Vector3(L*0.22, 0.92, side*(W*0.42)), b = new THREE.Vector3(L*0.05, 1.40, side*(W*0.38));
      var len = a.distanceTo(b);
      var pil = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, len, 10).scale(1, 1, 1.5), C.pillar);
      pil.position.copy(a).add(b).multiplyScalar(0.5);
      pil.lookAt(b); pil.rotateX(Math.PI/2);
      car.add(pil);
      part(new THREE.BoxGeometry(0.2, 0.022, 0.36), C.fabric, L*0.02, 1.37, side*0.36, car);
    });
    part(new THREE.BoxGeometry(1.4, 0.04, W*0.84), C.fabric, -L*0.11, 1.41, 0, car);

    /* the steering wheel: a thick leather rim, three spokes with a
       metal trim, the airbag boss - and your hands, at a quarter to three */
    var column = new THREE.Group();
    column.position.set(L*0.085, 0.87, dz);
    column.rotation.y = Math.PI/2; column.rotateX(0.45);
    var shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.32, 14).rotateX(Math.PI/2).translate(0, 0, 0.18), C.dashTop);
    column.add(shroud);
    var wheel = new THREE.Group();
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.026, 14, 48), C.leather));
    [[0, 0.115, 0.04], [Math.PI, 0.115, 0.04], [-Math.PI/2, 0.12, 0.05]].forEach(function(sp){
      var spoke = new THREE.Mesh(new THREE.BoxGeometry(sp[1], sp[2], 0.022), C.leather);
      spoke.position.set(Math.cos(sp[0])*(0.075 + sp[1]/2 - 0.02), Math.sin(sp[0])*(0.075 + sp[1]/2 - 0.02), 0.005);
      spoke.rotation.z = sp[0];
      wheel.add(spoke);
      var tr = new THREE.Mesh(new THREE.BoxGeometry(sp[1]*0.8, 0.006, 0.004), C.trim);
      tr.position.copy(spoke.position); tr.position.z = -0.008; tr.rotation.z = sp[0];
      wheel.add(tr);
    });
    wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.05, 24).rotateX(Math.PI/2), C.leather));
    var boss = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.02, 24).rotateX(Math.PI/2), C.dash);
    boss.position.z = -0.03; wheel.add(boss);
    column.add(wheel);
    /* the hands hold on (ten to two) as the wheel turns, up to about a quarter turn */
    var grip = new THREE.Group(), hands = [];
    [Math.PI*0.8, Math.PI*0.2].forEach(function(a){
      /* the hand's x points out from the hub, y along the rim */
      var hand = new THREE.Group();
      hand.position.set(Math.cos(a)*0.185, Math.sin(a)*0.185, 0);
      hand.rotation.z = a;
      /* the back of the hand towards you, fingers curled round the rim */
      var back = new THREE.Mesh(new THREE.SphereGeometry(0.036, 16, 12).scale(0.75, 1.2, 0.55), C.skin);
      back.position.set(0.004, 0, -0.03);
      hand.add(back);
      var fingers = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.014, 8, 16, Math.PI*1.35).rotateX(Math.PI/2).rotateY(2.04), C.skin);
      fingers.scale.set(1, 2.2, 1);
      hand.add(fingers);
      var thumb = new THREE.Mesh(new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.011, 0.04, 4, 8) : new THREE.CylinderGeometry(0.011, 0.011, 0.05, 8), C.skin);
      thumb.position.set(-0.02, a > Math.PI/2 ? -0.03 : 0.03, -0.026);
      thumb.rotation.z = a > Math.PI/2 ? 0.5 : -0.5;
      hand.add(thumb);
      grip.add(hand);
      hands.push(hand);
    });
    column.add(grip);
    car.add(column);
    car.userData.steeringWheel = wheel;
    /* forearms in jacket sleeves, from the elbows to the hands */
    var arms = [-1, 1].map(function(side, i){
      var fore = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.046, 1, 14), C.sleeve);
      car.add(fore);
      return { hand:hands[i], fore:fore, elbow:new THREE.Vector3(ex + 0.14, 0.84, dz + side*0.27) };
    });
    car.userData.arms = { column:column, grip:grip, wheel:wheel, list:arms };
  }
  /* each frame: the hands turn with the wheel (to a point), the forearms follow */
  var armTmp = null;
  function updateArms(A){
    if (!armTmp) armTmp = { v:new THREE.Vector3(), d:new THREE.Vector3(), up:new THREE.Vector3(0, 1, 0) };
    A.grip.rotation.z = Math.max(-1.1, Math.min(1.1, A.wheel.rotation.z));
    A.column.updateMatrix(); A.grip.updateMatrix();
    A.list.forEach(function(a){
      var hp = armTmp.v.copy(a.hand.position).applyMatrix4(A.grip.matrix).applyMatrix4(A.column.matrix);
      var d = armTmp.d.copy(hp).sub(a.elbow), len = d.length();
      a.fore.position.copy(a.elbow).addScaledVector(d, 0.5);
      a.fore.quaternion.setFromUnitVectors(armTmp.up, d.normalize());
      a.fore.scale.set(1, len*0.92, 1);
    });
  }

  /* the cluster: a round speedometer (0-200), the speed in figures, the
     green arrows when an indicator is on, lit softly at night */
  function drawCluster(cl, kmh, indicator, blink){
    var key = Math.round(kmh) + indicator + blink + night;
    if (key === cl.last) return;
    cl.last = key;
    var g = cl.ctx, w = cl.canvas.width, h = cl.canvas.height;
    /* a digital cockpit: dark glass, a speed arc, big figures, arrows */
    var bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0d1520'); bg.addColorStop(1, '#05080c');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    var accent = night ? '#ff9b4a' : '#4fb3ff', ink = night ? '#ffd9b0' : '#eaf3ff';
    var cx = w*0.5, cy = h*0.98, r = h*0.82, a0 = Math.PI*1.12, a1 = Math.PI*1.88;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 10;
    g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke();
    var an = a0 + (Math.min(kmh, 160)/160)*(a1 - a0);
    g.strokeStyle = accent; g.lineWidth = 10;
    g.beginPath(); g.arc(cx, cy, r, a0, Math.max(a0 + 0.001, an)); g.stroke();
    g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 64px Arial'; g.fillText(String(Math.round(kmh)), cx, h*0.52);
    g.font = '18px Arial'; g.fillStyle = 'rgba(234,243,255,0.6)'; g.fillText('km/h', cx, h*0.80);
    g.font = '15px Arial';
    for (var s = 0; s <= 160; s += 40){
      var a = a0 + (s/160)*(a1 - a0);
      g.fillText(String(s), cx + Math.cos(a)*(r - 26), cy + Math.sin(a)*(r - 26));
    }
    [['left', w*0.1, -1], ['right', w*0.9, 1]].forEach(function(ar){
      var on = indicator === ar[0] && blink;
      g.fillStyle = on ? '#2bff6a' : '#132a1a';
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
      if (g.userData.arms) updateArms(g.userData.arms);
      if (g.userData.navTex) g.userData.navTex.needsUpdate = true;
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
  /* Quaternius' "Animated Men Pack" and "Animated Women Pack" (CC0):
     loaded once from the packed assets, then every pedestrian gets their
     own copy - man or woman, child, adult or older, own colours, own
     height, walking or standing. Until they have loaded (a moment after
     the page opens) the simple figures below stand in. */
  var people = { ready:false, models:[], version:0 };
  var PEOPLE_LAYER = 1;
  var DRESSES = ['#7a1f2b','#2c4a6e','#3d5a3a','#c9a227','#5a2f5b','#1f1f24','#b85c38','#8aa1b1'];
  var GREY_HAIR = ['#c9c6c0', '#e4e2dc', '#9c9893', '#b5b1aa'];
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
          people.models.push({ scene:root, height:Math.max(0.01, box.max.y - box.min.y), minY:box.min.y, key:k,
                               female:/woman/.test(k), walk:clip('Walk'), idle:clip('Idle') || clip('Standing') });
          people.models.sort(function(a, b){ return a.key < b.key ? -1 : 1; });   // the same person every time
          if (--left === 0){ people.ready = true; people.version++; }
        }, function(){ if (--left === 0 && people.models.length){ people.ready = true; people.version++; } });
      }).catch(function(){ left--; });
    });
  }
  /* who someone is, from their one random number: about a fifth are
     older (grey hair, a little shorter and stooped, slower) */
  function isOld(look, kid){ return !kid && ((look*31.7) % 1) < 0.22; }
  function buildModelPerson(look, kid){
    var mdl = people.models[Math.floor(look*997) % people.models.length];
    var old = isOld(look, kid), vary = (look*13.7) % 1;
    var inst = THREE.SkeletonUtils.clone(mdl.scene);
    var h = kid ? 1.1 + vary*0.32 : (mdl.female ? 1.56 + vary*0.22 : 1.68 + vary*0.24) - (old ? 0.05 : 0);
    var s = h / mdl.height;
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
        else if (/^Hair/.test(m.name)) c = pick(old ? GREY_HAIR : HAIR, (look*9.1) % 1);
        else if (/^Dress/.test(m.name)) c = pick(DRESSES, (look*7.3) % 1);
        else if (/^Skin/.test(m.name)) c = pick(SKINS, (look*5.3) % 1);
        if (!c) return m;
        var n = m.clone(); n.color.set(c); return n;
      };
      o.material = Array.isArray(o.material) ? o.material.map(recolor) : recolor(o.material);
    });
    var g = new THREE.Group();
    /* older people lean a little forward from the feet */
    var lean = new THREE.Group();
    if (old) lean.rotation.z = -0.07;
    lean.add(inst); g.add(lean);
    var mixer = new THREE.AnimationMixer(inst);
    mixer.timeScale = old ? 0.8 : kid ? 1.15 : 1;
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
      var K = signalKit();
      s.lenses.red.material    = (st === 'red' || st === 'redyellow') ? K.litRed : M.offRed;
      s.lenses.yellow.material = (st === 'yellow' || st === 'redyellow') ? K.litAmber : M.offAmber;
      s.lenses.green.material  = st === 'green' ? K.litGreen : M.offGreen;
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
      if (treeKit) treeKit.leafMat.envMapIntensity = night ? 0.05 : 0.45;
      var V = vehicleMats();
      Object.keys(V).forEach(function(k){
        if (V[k] && V[k].isMeshStandardMaterial) V[k].envMapIntensity = night ? 0.15 : (k === 'glass' ? 1.4 : 0.6);
      });
    }
    M.shop.emissiveIntensity = night ? 0.9 : 0;
    Object.keys(shopSignMats).forEach(function(k){ shopSignMats[k].emissiveIntensity = night ? 0.55 : 0; });
    if (apoMat) apoMat.emissiveIntensity = night ? 0.9 : 0;
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
    var rain = weather === 'rain', evening = weather === 'evening' && !night;
    wet.value = rain ? 1 : 0;
    if (night){
      sky.visible = false;
      scene.background = new THREE.Color(rain ? 0x0a0e14 : 0x0b1220);
      scene.fog = new THREE.FogExp2(rain ? 0x10151c : 0x0e1624, rain ? 0.013 : 0.0085);
      hemi.color.set(0x5a6f99); hemi.groundColor.set(0x1a1814); hemi.intensity = 0.32;
      sun.color.set(0x9fb4ff); sun.intensity = 0.28;
      renderer.toneMappingExposure = 1.05;
      scene.environment = envNight || envDay;
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
      if (evening){
        /* low sun in the west: long shadows, warm light, a pink haze */
        scene.fog = new THREE.FogExp2(0xd9b49a, 0.0045);
        hemi.color.set(0xffd2b0); hemi.groundColor.set(0x4a3a30); hemi.intensity = 0.55;
        sun.color.set(0xffa860); sun.intensity = 2.6;
        renderer.toneMappingExposure = 1.0;
      } else if (rain){
        /* overcast: no sun to speak of, flat grey light, mist down the street */
        sky.visible = false;
        scene.background = new THREE.Color(0x9aa2aa);
        scene.fog = new THREE.FogExp2(0x9ba3ab, 0.011);
        hemi.color.set(0xd8e0e8); hemi.groundColor.set(0x4c4d4f); hemi.intensity = 1.15;
        sun.color.set(0xdfe6ee); sun.intensity = 0.35;
        renderer.toneMappingExposure = 1.0;
        if (clouds) clouds.visible = false;
      }
    }
    var u = sky.material.uniforms;
    u.turbidity.value = evening ? 9 : 6; u.rayleigh.value = evening ? 2.6 : 1.4;
    var el = THREE.MathUtils.degToRad(night ? 20 : evening ? 6 : rain ? 50 : 38);
    var az = THREE.MathUtils.degToRad(evening ? 250 : 215);
    sunDir.setFromSphericalCoords(1, Math.PI/2 - el, az);
    u.sunPosition.value.copy(sunDir);
    if (rainFx) rainFx.visible = rain;
  }
  /* ---------------- weather ---------------- */
  var weather = 'clear', wet = { value:0 }, rainFx = null;
  function setWeather(w){
    weather = w === 'evening' || w === 'rain' ? w : 'clear';
    syncTheme();
  }
  /* rain: streaks in a box that travels with you, falling and wrapping */
  var RAIN_N = 2600, RAIN_BOX = 36, RAIN_H = 18, rainLast = 0;
  function rainSetup(){
    if (rainFx) return rainFx;
    var pos = new Float32Array(RAIN_N*6);
    for (var i = 0; i < RAIN_N; i++){
      var x = (Math.random() - 0.5)*RAIN_BOX, y = Math.random()*RAIN_H, z = (Math.random() - 0.5)*RAIN_BOX;
      pos.set([x, y, z, x + 0.03, y + 0.55, z + 0.02], i*6);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rainFx = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color:0xc4ccd6, transparent:true, opacity:0.32, fog:false }));
    rainFx.frustumCulled = false;
    rainFx.visible = weather === 'rain';
    scene.add(rainFx);
    return rainFx;
  }
  function syncRain(cx, cz){
    var r = rainSetup(), now = performance.now()/1000, dt = Math.min(0.05, now - (rainLast || now));
    rainLast = now;
    if (!r.visible) return;
    var a = r.geometry.attributes.position.array, fall = 11*dt;
    for (var i = 0; i < RAIN_N; i++){
      var k = i*6, y = a[k + 1] - fall;
      if (y < 0) y += RAIN_H;
      a[k + 1] = y; a[k + 4] = y + 0.55;
    }
    r.geometry.attributes.position.needsUpdate = true;
    /* the box follows the car in whole steps, so the drops do not slide with it */
    r.position.set(Math.round(cx/RAIN_BOX*4)*RAIN_BOX/4, 0, Math.round(cz/RAIN_BOX*4)*RAIN_BOX/4);
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
    var shadow = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color:0x000000, transparent:true, opacity:0.28 }));
    var stem = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color:0x1a1b1e }));
    var frameMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color:0x17181b }));
    var glass = new THREE.Mesh(new THREE.BufferGeometry(),
                  new THREE.MeshBasicMaterial({ map:rt.texture, side:THREE.DoubleSide }));
    var sheen = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color:0xffffff, transparent:true, opacity:0.06 }));
    shadow.position.z = -1; stem.position.z = -0.5; glass.position.z = 1; sheen.position.z = 2;
    [shadow, stem, frameMesh, glass, sheen].forEach(function(m){ ov.add(m); });
    return (mirror = { rt:rt, cam:cam, ov:ov, ocam:ocam, frame:frameMesh, glass:glass, shadow:shadow, stem:stem, sheen:sheen, size:'' });
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
    var cx = w/2, cy = h - 18 - mh/2 - (big ? 0 : 4);
    m.ocam.left = 0; m.ocam.right = w; m.ocam.top = h; m.ocam.bottom = 0; m.ocam.updateProjectionMatrix();
    var size = Math.round(mw) + 'x' + Math.round(mh);
    if (m.size !== size){
      m.size = size;
      /* rounded, a little narrower at the bottom, like a real mirror */
      var shape = function(sw, sh, r, taper){
        var s = new THREE.Shape(), b = sw/2*(1 - taper), t = sw/2;
        s.moveTo(-b + r, -sh/2); s.lineTo(b - r, -sh/2);
        s.quadraticCurveTo(b, -sh/2, b + (t - b)*0.2, -sh/2 + r);
        s.lineTo(t, sh/2 - r); s.quadraticCurveTo(t, sh/2, t - r, sh/2);
        s.lineTo(-t + r, sh/2); s.quadraticCurveTo(-t, sh/2, -t, sh/2 - r);
        s.lineTo(-b - (t - b)*0.2, -sh/2 + r); s.quadraticCurveTo(-b, -sh/2, -b + r, -sh/2);
        var geo = new THREE.ShapeGeometry(s, 10), uv = geo.attributes.uv, p = geo.attributes.position;
        for (var i = 0; i < p.count; i++) uv.setXY(i, 1 - (p.getX(i) + sw/2)/sw, (p.getY(i) + sh/2)/sh);   // mirrored
        return geo;
      };
      var R = mh*0.32;
      m.frame.geometry.dispose(); m.frame.geometry = shape(mw + 14, mh + 14, R + 6, 0.05);
      m.shadow.geometry.dispose(); m.shadow.geometry = shape(mw + 22, mh + 20, R + 9, 0.05);
      m.glass.geometry.dispose(); m.glass.geometry = shape(mw, mh, R, 0.05);
      /* a faint reflection of the cabin across the top of the glass */
      m.sheen.geometry.dispose(); m.sheen.geometry = shape(mw*0.92, mh*0.3, R*0.4, 0);
    }
    m.shadow.position.set(cx, cy - 5, -1);
    m.frame.position.set(cx, cy, 0);
    m.glass.position.set(cx, cy, 1); m.glass.scale.set(1, 1, 1);
    m.sheen.position.set(cx, cy + mh*0.28, 2);
    m.stem.position.set(cx, (cy + mh/2 + h)/2 + 2, -0.5); m.stem.scale.set(Math.max(10, mw*0.05), h - cy - mh/2, 1);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(m.ov, m.ocam);
    renderer.autoClear = true;
  }

  /* ---------------- sky photos for light and reflections ---------------- */
  /* Real HDR photos of a German street by day and a square at night
     (Poly Haven, CC0) light the scene and shine in paint and glass; the
     sky you see stays the drawn one. Until they load the studio light
     above stands in. */
  function loadSkies(){
    if (typeof ASSETS === 'undefined' || !THREE.RGBELoader) return;
    [['sky_day', 'day'], ['sky_night', 'night']].forEach(function(pair){
      if (!ASSETS[pair[0]]) return;
      new THREE.RGBELoader().load(ASSETS[pair[0]], function(t){
        t.mapping = THREE.EquirectangularReflectionMapping;
        var env = pmrem.fromEquirectangular(t).texture;
        t.dispose();
        if (pair[1] === 'day') envDay = env; else envNight = env;
        syncTheme();
      });
    });
  }

  /* ---------------- post-processing ("Graphics: high") ---------------- */
  /* The scene goes into an off-screen picture, then: soft contact
     shadows where things meet (ambient occlusion, worked out from the
     depth at half size), a glow round bright lights (bloom), a gentle
     colour grade and vignette, and edge smoothing (FXAA) onto the screen.
     "Fast" draws straight to the screen as before. */
  var quality = 'high', post = null;
  function setQuality(q){
    quality = q === 'fast' ? 'fast' : 'high';
    if (!renderer) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'fast' ? 1 : 1.5));
  }
  var QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  var AO_FS = [
    'uniform sampler2D tDepth; uniform mat4 projInv; uniform vec2 texel; uniform float radius, projScale, aspect, strength;',
    'varying vec2 vUv;',
    'vec3 viewPos(vec2 uv){ float d = texture2D(tDepth, uv).x;',
    '  vec4 p = projInv * vec4(vec3(uv, d)*2.0 - 1.0, 1.0); return p.xyz / p.w; }',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
    'void main(){',
    '  if (texture2D(tDepth, vUv).x >= 0.99999){ gl_FragColor = vec4(1.0); return; }',
    '  vec3 P = viewPos(vUv);',
    '  vec3 r = viewPos(vUv + vec2(texel.x, 0.0)) - P, l = P - viewPos(vUv - vec2(texel.x, 0.0));',
    '  vec3 u = viewPos(vUv + vec2(0.0, texel.y)) - P, d = P - viewPos(vUv - vec2(0.0, texel.y));',
    '  vec3 N = normalize(cross(abs(r.z) < abs(l.z) ? r : l, abs(u.z) < abs(d.z) ? u : d));',
    '  float rad = min(radius * projScale / -P.z, 0.08);',
    '  float a = hash(gl_FragCoord.xy) * 6.2832, sum = 0.0;',
    '  for (int i = 0; i < 12; i++){',
    '    float t = (float(i) + 0.5) / 12.0; a += 2.39996;',
    '    vec2 off = vec2(cos(a) / aspect, sin(a)) * rad * t;',
    '    vec3 v = viewPos(vUv + off) - P; float vv = dot(v, v);',
    '    float fall = 1.0 - smoothstep(radius*radius, 4.0*radius*radius, vv);',
    '    sum += fall * max(0.0, dot(v, N) + P.z*0.004) / (vv + 0.002);',
    '  }',
    '  float ao = max(0.0, 1.0 - strength * radius * sum / 12.0);',
    '  ao = mix(1.0, ao, smoothstep(1.2, 2.5, -P.z));          // not inside our own car',
    '  gl_FragColor = vec4(vec3(ao), 1.0);',
    '}'].join('\n');
  /* blur the speckle away without bleeding across edges */
  var BLUR_FS = [
    'uniform sampler2D tAO, tDepth; uniform vec2 texel; uniform float near, far;',
    'varying vec2 vUv;',
    'float lin(vec2 uv){ float z = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0*near*far / (far + near - z*(far - near)); }',
    'void main(){',
    '  float zc = lin(vUv), s = 0.0, w = 0.0;',
    '  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++){',
    '    vec2 uv = vUv + vec2(float(x), float(y)) * texel;',
    '    float k = exp(-abs(lin(uv) - zc) / (zc*0.03));',
    '    s += texture2D(tAO, uv).r * k; w += k;',
    '  }',
    '  gl_FragColor = vec4(vec3(s / w), 1.0);',
    '}'].join('\n');
  var GRADE_FS = [
    'uniform sampler2D tScene, tAO; uniform float aoMix, sat, contrast, vign, blur; uniform vec3 shadowTint, lightTint;',
    'varying vec2 vUv;',
    'vec3 toSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }',
    'void main(){',
    '  vec3 c = texture2D(tScene, vUv).rgb;',
    '  if (blur > 0.0){                                      // speed: the edges streak',
    '    vec2 dir = (vUv - vec2(0.5, 0.55)) * blur;',
    '    for (int i = 1; i < 6; i++) c += texture2D(tScene, vUv - dir*float(i)).rgb;',
    '    c /= 6.0;',
    '  }',
    '  c *= mix(1.0, texture2D(tAO, vUv).r, aoMix);',
    '  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));',
    '  c = max(mix(vec3(l), c, sat), 0.0);',
    '  c *= mix(shadowTint, lightTint, smoothstep(0.0, 0.5, l));',
    '  c = clamp(toSRGB(c), 0.0, 1.0);',
    '  c = mix(c, c*c*(3.0 - 2.0*c), contrast);',
    '  vec2 q = vUv - 0.5;',
    '  c *= 1.0 - vign * smoothstep(0.1, 0.55, dot(q, q));',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'].join('\n');

  function postSetup(){
    var size = renderer.getDrawingBufferSize(new THREE.Vector2()), W = size.x, H = size.y;
    if (post && post.W === W && post.H === H) return post;
    if (post) ['scene', 'ao', 'aoBlur', 'ldr'].forEach(function(k){ post[k].dispose(); });
    var p = post || {};
    p.W = W; p.H = H;
    var hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1);
    var depth = new THREE.DepthTexture(W, H);
    p.scene = new THREE.WebGLRenderTarget(W, H, { type:THREE.HalfFloatType, depthTexture:depth,
                                                  samples:renderer.capabilities.isWebGL2 ? 4 : 0 });
    p.ao = new THREE.WebGLRenderTarget(hw, hh, { depthBuffer:false });
    p.aoBlur = new THREE.WebGLRenderTarget(hw, hh, { depthBuffer:false });
    p.ldr = new THREE.WebGLRenderTarget(W, H, { depthBuffer:false });
    if (!p.quad){
      var mat = function(fs, uniforms){
        return new THREE.ShaderMaterial({ uniforms:uniforms, vertexShader:QUAD_VS, fragmentShader:fs,
                                          depthTest:false, depthWrite:false });
      };
      p.aoMat = mat(AO_FS, { tDepth:{ value:null }, projInv:{ value:new THREE.Matrix4() }, texel:{ value:new THREE.Vector2() },
                             radius:{ value:1.0 }, projScale:{ value:1 }, aspect:{ value:1 }, strength:{ value:1.1 } });
      p.blurMat = mat(BLUR_FS, { tAO:{ value:null }, tDepth:{ value:null }, texel:{ value:new THREE.Vector2() },
                                 near:{ value:camera.near }, far:{ value:camera.far } });
      p.gradeMat = mat(GRADE_FS, { tScene:{ value:null }, tAO:{ value:null }, aoMix:{ value:0.85 },
                                   sat:{ value:1.08 }, contrast:{ value:0.18 }, vign:{ value:0.32 }, blur:{ value:0 },
                                   shadowTint:{ value:new THREE.Vector3(0.97, 1.0, 1.04) },
                                   lightTint:{ value:new THREE.Vector3(1.03, 1.0, 0.96) } });
      p.fxaaMat = new THREE.ShaderMaterial({ uniforms:THREE.UniformsUtils.clone(THREE.FXAAShader.uniforms),
                                             vertexShader:THREE.FXAAShader.vertexShader,
                                             fragmentShader:THREE.FXAAShader.fragmentShader,
                                             depthTest:false, depthWrite:false });
      p.quad = new THREE.FullScreenQuad(null);
      p.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(W, H), 0.3, 0.45, 0.9);
    }
    p.bloom.setSize(W, H);
    p.aoMat.uniforms.tDepth.value = depth;
    p.aoMat.uniforms.texel.value.set(1/hw, 1/hh);
    p.blurMat.uniforms.tDepth.value = depth;
    p.blurMat.uniforms.tAO.value = p.ao.texture;
    p.blurMat.uniforms.texel.value.set(1/hw, 1/hh);
    p.gradeMat.uniforms.tScene.value = p.scene.texture;
    p.gradeMat.uniforms.tAO.value = p.aoBlur.texture;
    p.fxaaMat.uniforms.tDiffuse.value = p.ldr.texture;
    p.fxaaMat.uniforms.resolution.value.set(1/W, 1/H);
    return (post = p);
  }
  function pass(material, target){
    post.quad.material = material;
    renderer.setRenderTarget(target);
    post.quad.render(renderer);
  }
  function renderPost(speed){
    var p = postSetup();
    renderer.setRenderTarget(p.scene);
    renderer.render(scene, camera);

    var u = p.aoMat.uniforms;
    u.projInv.value.copy(camera.projectionMatrixInverse);
    u.projScale.value = camera.projectionMatrix.elements[5] * 0.5;
    u.aspect.value = camera.aspect;
    u.strength.value = night ? 1.5 : 2.2;
    pass(p.aoMat, p.ao);
    pass(p.blurMat, p.aoBlur);

    /* lamps and lit windows glow at night; by day only the brightest sun glints */
    p.bloom.threshold = night ? 0.72 : 0.9;
    p.bloom.strength  = night ? 0.45 : 0.22;
    p.bloom.radius    = night ? 0.3 : 0.4;
    p.bloom.render(renderer, null, p.scene, 0, false);

    p.gradeMat.uniforms.vign.value = night ? 0.32 : 0.3;
    p.gradeMat.uniforms.blur.value = Math.max(0, Math.min(1, ((speed || 0) - 6)/22)) * 0.0045;
    pass(p.gradeMat, p.ldr);
    pass(p.fxaaMat, null);
  }

  /* ---------------- the body in the seat ---------------- */
  /* The car dives when you brake, squats when you pull away, leans out of
     a turn and shivers over the road surface. The whole car moves with
     you, so the dashboard stays put and the world tilts, as it does. */
  var ride = { t:null, v:0, h:0, s:0, pitch:0, pv:0, roll:0, rv:0 };
  function rideMotion(p, t){
    var v = p.v*U, h = p.pos.h;
    if (ride.t === null || t < ride.t || t - ride.t > 0.5){
      ride.t = t; ride.v = v; ride.h = h; ride.pitch = ride.pv = ride.roll = ride.rv = 0;
      return ride;
    }
    var dt = t - ride.t;
    if (dt <= 0) return ride;
    var acc = (v - ride.v)/dt;
    var lat = v * Math.atan2(Math.sin(h - ride.h), Math.cos(h - ride.h))/dt;
    ride.t = t; ride.v = v; ride.h = h; ride.s += v*dt;
    var tp = Math.max(-0.04, Math.min(0.025, acc*0.0055));
    var tr = Math.max(-0.035, Math.min(0.035, lat*0.0045));
    /* a damped spring each way, stepped finely so it is the same at any frame rate */
    for (var n = Math.ceil(dt/0.008), k = 0; k < n; k++){
      var d = dt/n;
      ride.pv += ((tp - ride.pitch)*70 - ride.pv*11)*d; ride.pitch += ride.pv*d;
      ride.rv += ((tr - ride.roll)*60 - ride.rv*10)*d;  ride.roll  += ride.rv*d;
    }
    return ride;
  }
  var rideQ = null;

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
    /* the ride: road shiver grows with speed */
    var rm = rideMotion(p, world.t || 0), sp = Math.min(1, rm.v/12);
    var bump = (Math.sin(rm.s*2.3)*0.5 + Math.sin(rm.s*5.9 + 1.3)*0.3 + Math.sin(rm.s*13.1)*0.2) * sp;
    if (!rideQ) rideQ = { car:new THREE.Quaternion(), body:new THREE.Quaternion(), e:new THREE.Euler(0, 0, 0, 'YXZ') };
    rideQ.car.setFromEuler(rideQ.e.set(0, -p.pos.h - Math.PI/2, 0));
    rideQ.body.setFromEuler(rideQ.e.set(rm.pitch + bump*0.0015, 0, rm.roll));
    rideQ.body.premultiply(rideQ.car).multiply(rideQ.car.invert());          // body tilt, in world space
    camera.quaternion.premultiply(rideQ.body);
    camera.position.y += bump*0.006;
    var aspect = w / Math.max(1, h);
    var vfov = 2*Math.atan(Math.tan(FOV_H*Math.PI/360) / aspect) * 180/Math.PI;
    /* about what you see from a real driver's seat; on a tall screen the
       view narrows sideways rather than growing a fish-eye roof and floor */
    camera.fov = Math.min(60, Math.max(38, vfov));
    camera.aspect = aspect;
    camera.updateProjectionMatrix();

    syncVehicles(world, world.t);
    /* our own car tilts with us, about our eyes */
    var own = dyn.meshes[p.id];
    if (own){
      own.rotation.set(0, -p.pos.h, 0);
      own.position.sub(camera.position).applyQuaternion(rideQ.body).add(camera.position);
      own.quaternion.premultiply(rideQ.body);
      own.position.y += bump*0.006;
    }
    syncPeds(world);
    syncWalkers(world);
    syncSignals(world);
    syncChevrons(world);
    syncNightLights(world);
    wind.value = (world.t || 0);
    built.stations.forEach(function(st){ st.rotation.y = Math.atan2(camera.position.x - st.position.x, camera.position.z - st.position.z); });

    /* the sun's shadow box follows the car, and so does the sky */
    var cx = p.pos.x*U, cz = p.pos.y*U;
    if (clouds) clouds.position.set(cx, 0, cz);
    syncRain(cx, cz);
    sun.target.position.set(cx + c*25, 0, cz + s*25);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 150);
    /* our own headlights after dark */
    headlamp.intensity = night ? 18 : 0;
    headlamp.position.set(cx + c*2.2, 0.75, cz + s*2.2);
    headlamp.target.position.set(cx + c*30, 0, cz + s*30);

    if (quality === 'high') renderPost(rm.v);
    else renderer.render(scene, camera);
    if (world.map) drawMirror(world, yaw, w, h, opts && opts.mirror);
    return true;
  }

  return { available:available, frame:frame, syncTheme:syncTheme, setQuality:setQuality, setWeather:setWeather,
           /* for poking at the scene from the browser console */
           debug:function(){ return { scene:scene, camera:camera, renderer:renderer, dyn:dyn, post:post }; } };
})();
