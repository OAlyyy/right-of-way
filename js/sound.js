/* Sound, made in the browser with Web Audio - nothing to download.
   The engine pulls through the gears with your speed and pedal, tyres
   and wind grow louder as you go faster, the indicator ticks, cars hiss
   past, the town hums, birds sing by day, and a tram rings its bell as
   it comes up near you. Browsers only allow sound after a key or a tap,
   so unlock() is called from the first one. */
var Sound = (function(){
  'use strict';
  var ac = null, out = null, on = true, N = null;
  var tickAt = 0, tickTock = false, birdAt = 0, rang = {};
  var sm = { rpm:800, load:0.3 };

  /* about 1000 rpm per so many m/s in each gear, as in a small petrol car */
  var GEARS = [2.1, 3.9, 5.8, 7.9, 10.0];

  function noiseBuffer(){
    var b = ac.createBuffer(1, ac.sampleRate*2, ac.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random()*2 - 1;
    return b;
  }
  function noise(type, freq, q){
    var s = ac.createBufferSource(); s.buffer = N.buf; s.loop = true;
    s.playbackRate.value = 0.8 + Math.random()*0.4;
    var f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 0.7;
    var g = ac.createGain(); g.gain.value = 0;
    s.connect(f); f.connect(g); g.connect(out);
    s.start();
    return { f:f, g:g };
  }
  function build(){
    out = ac.createGain(); out.gain.value = 0;
    /* a soft limiter so several sounds at once never clip */
    var comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    out.connect(comp); comp.connect(ac.destination);
    N = { buf:noiseBuffer() };
    /* the engine: the firing note and its overtones, through a filter
       that opens up when you press the pedal */
    var ef = ac.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 400; ef.Q.value = 2.5;
    var eg = ac.createGain(); eg.gain.value = 0;
    ef.connect(eg); eg.connect(out);
    N.eng = [1, 2, 4].map(function(mult, i){
      var o = ac.createOscillator(); o.type = i === 2 ? 'square' : 'sawtooth';
      var g = ac.createGain(); g.gain.value = [0.5, 0.35, 0.08][i];
      o.connect(g); g.connect(ef); o.start();
      return { o:o, mult:mult };
    });
    N.engF = ef; N.engG = eg;
    N.rumble = noise('bandpass', 90, 1.2);             // combustion grumble
    N.road = noise('lowpass', 380, 0.8);               // tyres on asphalt
    N.wind = noise('bandpass', 900, 0.4);
    N.hum = noise('lowpass', 160, 0.5);                // the town in the distance
    N.pass = noise('bandpass', 700, 0.6);              // cars going by
    N.rain = noise('highpass', 2600, 0.5);             // rain on the roof and glass
  }
  function unlock(){
    try {
      if (!ac){
        var C = window.AudioContext || window.webkitAudioContext;
        if (!C) return;
        ac = new C(); build();
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (e){ ac = null; }
  }
  function set(param, v, tc){ param.setTargetAtTime(v, ac.currentTime, tc || 0.08); }

  /* one click of the indicator relay */
  function tick(high){
    var t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
    o.type = 'square'; o.frequency.value = high ? 2300 : 1700;
    f.type = 'highpass'; f.frequency.value = 900;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(f); f.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.05);
  }
  /* a bell: a few inharmonic partials that ring and fade */
  function bell(at, gain){
    [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.9, 0.12]].forEach(function(p){
      var o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 1180*p[0];
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain*p[1], at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 1.4/p[0] + 0.25);
      o.connect(g); g.connect(out);
      o.start(at); o.stop(at + 2);
    });
  }
  function chirp(at, gain){
    var n = 2 + Math.floor(Math.random()*3), f0 = 2800 + Math.random()*1600;
    for (var i = 0; i < n; i++){
      var t = at + i*0.11, o = ac.createOscillator(), g = ac.createGain();
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0*1.45, t + 0.07);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.1);
    }
  }

  /* every frame of the game: world and input, or nothing to fall quiet */
  function update(world, input, dt, opts){
    if (!ac) return;
    var live = !!(on && world && world.player && world.state === 'run' && !world.pending);
    set(out.gain, live ? 0.7 : 0, 0.15);
    if (!live) return;
    var PPM = (typeof CFG !== 'undefined' && CFG.PPM) || 12;
    var p = world.player, v = Math.max(0, p.v/PPM), now = ac.currentTime;
    var night = opts && opts.night;

    /* engine: pick the gear a calm driver would be in, rev and load from that */
    var pedal = input && input.throttle, brake = input && input.brake;
    var cap = pedal ? 3000 : 2300, gear = 0;
    while (gear < GEARS.length - 1 && v/GEARS[gear]*1000 > cap) gear++;
    var rpm = Math.max(800, v/GEARS[gear]*1000);
    sm.rpm += (rpm - sm.rpm) * Math.min(1, dt*6);
    sm.load += ((pedal ? 1 : brake ? 0.05 : v > 0.5 ? 0.2 : 0.3) - sm.load) * Math.min(1, dt*5);
    var fire = sm.rpm/60*2;                             // four cylinders: two firings a turn
    N.eng.forEach(function(e){ set(e.o.frequency, fire*e.mult, 0.05); });
    set(N.engF.frequency, 260 + sm.load*1100 + sm.rpm*0.15, 0.08);
    set(N.engG.gain, 0.11 + sm.load*0.12, 0.1);
    set(N.rumble.f.frequency, fire*1.5, 0.05);
    set(N.rumble.g.gain, 0.05 + sm.load*0.08, 0.1);

    /* tyres and wind */
    var sp = Math.min(1, v/22);
    set(N.road.g.gain, sp*0.35, 0.2);
    set(N.road.f.frequency, 250 + sp*500, 0.2);
    set(N.wind.g.gain, sp*sp*0.18, 0.3);
    set(N.hum.g.gain, night ? 0.05 : 0.09, 0.5);
    set(N.rain.g.gain, opts && opts.rain ? 0.13 : 0, 0.6);

    /* the nearest moving car hisses past */
    var pass = 0, trams = [];
    (world.vehicles || []).forEach(function(o){
      if (o === p || o.done || !o.pos) return;
      var d = Math.hypot(o.pos.x - p.pos.x, o.pos.y - p.pos.y)/PPM;
      if (o.kind === 'tram') trams.push({ o:o, d:d });
      if (o.kind === 'bike' || !(o.v > 1)) return;
      pass = Math.max(pass, Math.min(1, (o.v/PPM)/14) * Math.max(0, 1 - d/28));
    });
    set(N.pass.g.gain, pass*pass*0.4, 0.12);

    /* the tram rings once as it comes up near you */
    trams.forEach(function(t){
      var id = t.o.id, last = rang[id] || -1e9;
      if (t.d < 45 && t.o.v > 1 && (world.t || 0) - last > 25){
        rang[id] = world.t || 0;
        bell(now + 0.02, 0.16); bell(now + 0.34, 0.14);
      }
    });

    /* the indicator relay: tick ... tock */
    var ind = input && input.indicator && input.indicator !== 'off';
    if (ind && now >= tickAt){
      tick(tickTock); tickTock = !tickTock;
      tickAt = now + 0.36;
    } else if (!ind){ tickAt = now; tickTock = false; }

    /* birds in the trees by day */
    if (!night && !(opts && opts.rain) && now > birdAt){
      if (birdAt) chirp(now, 0.025 + Math.random()*0.03);
      birdAt = now + 3 + Math.random()*8;
    }
  }
  /* a soft two-note chime, at most every couple of seconds */
  var warnAt = 0;
  function warn(){
    if (!ac || !on) return;
    var t = ac.currentTime;
    if (t < warnAt) return;
    warnAt = t + 2.2;
    [[880, 0], [660, 0.16]].forEach(function(n){
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = n[0];
      g.gain.setValueAtTime(0.0001, t + n[1]);
      g.gain.exponentialRampToValueAtTime(0.18, t + n[1] + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + n[1] + 0.25);
      o.connect(g); g.connect(out); o.start(t + n[1]); o.stop(t + n[1] + 0.3);
    });
  }
  function idle(){ if (ac) set(out.gain, 0, 0.15); }
  function toggle(){ on = !on; if (!on) idle(); return on; }
  function setOn(v){ on = !!v; if (!on) idle(); }

  return { unlock:unlock, update:update, idle:idle, warn:warn, toggle:toggle, setOn:setOn,
           enabled:function(){ return on; },
           debug:function(){ return { ac:ac, rpm:sm.rpm, load:sm.load, out:out && out.gain.value }; } };
})();
