'use strict';
/* ------------------------------------------------------------------
   main.js - screens, input, HUD, scoring, progress, theme, language.
   ------------------------------------------------------------------ */

(function(){

  var canvas = document.getElementById('game');
  var ctx    = canvas.getContext('2d');
  var mini   = document.getElementById('minimap');
  var mctx   = mini.getContext('2d');
  var W = 0, H = 0;

  var MAX_YAW = 1.25;                 // how far you can turn your head

  var state = {
    screen:'menu', world:null, scIndex:0, mode:'lesson',
    hints:true, view:'pov',
    yaw:0, yawTarget:0, drag:null,
    last:0
  };

  var DRIVE_BRIEF = {
    task: { de:'Fahr ganz normal. Der Prüfer schweigt, bis du einen Fehler machst, und ' +
                'hält dann an, um ihn zu erklären – dieselben Regeln wie in jeder Lektion, ' +
                'jetzt aber alle gemischt.',
            en:'Drive normally. The examiner sits quietly until you get something wrong, ' +
               'then stops the car to explain it – the same rules as every lesson, now all ' +
               'mixed together.' },
    merk: { de:'Hier gibt es kein Drehbuch – lies jede Kreuzung, so wie sie kommt.',
            en:'There is no script here – read every junction as it comes.' }
  };
  /* the Frankfurt map: what is special about this bit of town */
  var FRANKFURT_BRIEF = {
    task: { de:'Du startest auf der Eschersheimer Landstraße und fährst auf den Weißen Stein zu. ' +
                'Neben der Hauptstraße fährt die U-Bahn (U1/U2/U3/U8) auf eigenem Gleis. Alle ' +
                'Kreuzungen der Hauptstraße haben Ampeln; die Wohnstraßen sind Tempo 30 mit rechts vor links. ' +
                'Der Prüfer hält an, sobald du einen Fehler machst – dann kannst du zurückspulen.',
            en:'You start on Eschersheimer Landstraße, heading south to Weißer Stein. The U-Bahn ' +
               '(U1/U2/U3/U8) runs on its own track beside the main road. Every junction on the main ' +
               'road has lights; the side streets are Tempo 30 with rechts vor links. The examiner ' +
               'stops you the moment you make a mistake – then you can rewind and try again.' },
    merk: { de:'Wer über die Gleise abbiegt, lässt die Bahn durch – auch bei Grün, auch von hinten.',
            en:'Turning across the tracks, let the train through – even on green, even from behind.' }
  };
  /* the driving test: what the examiner expects */
  var EXAM_MINUTES = 15;
  var EXAM_BRIEF = {
    task: { de:'Die Prüfungsfahrt dauert ' + EXAM_MINUTES + ' Minuten. Der Prüfer sagt dir, wo es langgeht. ' +
                'Es gibt keine Hinweise und kein Zurückspulen. Kleine Fehler werden notiert; ein schwerer ' +
                'Fehler beendet die Prüfung sofort. Vor jedem Abbiegen: Spiegel (M), Blinker (Q/E), Schulterblick (←/→).',
            en:'The test drive lasts ' + EXAM_MINUTES + ' minutes. The examiner tells you where to go. ' +
               'No hints, no rewinding. Small faults are noted; one serious fault ends the test at once. ' +
               'Before every turn: mirror (M), indicator (Q/E), shoulder check (←/→).' },
    merk: { de:'Nicht bestanden bei einem schweren Fehler, bei fünf kleinen, oder wenn derselbe kleine dreimal passiert.',
            en:'You fail on one serious fault, on five small ones, or on the same small one three times.' }
  };
  var input = { throttle:false, brake:false, indicator:'off' };
  var look  = { left:false, right:false, mirror:false };
  var wheelKeys = { left:false, right:false };
  var STEER = 'fahrschule.steer.v1';
  var GFX   = 'fahrschule.gfx.v1';
  var SOUND = 'fahrschule.sound.v1';
  var WEATHER = 'fahrschule.weather.v1';
  var WEATHERS = ['clear', 'evening', 'rain'];

  function el(id){ return document.getElementById(id); }
  function show(id, on){ el(id).classList.toggle('hidden', !on); }
  function clear(n){ while (n.firstChild) n.removeChild(n.firstChild); }
  function make(tag, cls, text){
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  /* a main line in the chosen language plus the other language beneath */
  function bilingual(parent, pair, mainCls, subCls){
    var main = I18N.pick(pair), sub = I18N.other(pair);
    if (main) parent.appendChild(make('div', mainCls, main));
    if (sub && sub !== main) parent.appendChild(make('div', subCls, sub));
  }

  /* ---------------- storage ---------------- */
  function load(key, fb){
    try { var v = localStorage.getItem(key); return v === null ? fb : JSON.parse(v); }
    catch(e){ return fb; }
  }
  function save(key, val){ try { localStorage.setItem(key, JSON.stringify(val)); } catch(e){} }
  var STORE = 'fahrschule.progress.v1';
  var THEME = 'fahrschule.theme.v1';
  var LANG  = 'fahrschule.lang.v1';
  var VIEW  = 'fahrschule.view.v1';
  var progress = load(STORE, {}) || {};

  /* ---------------- theme ---------------- */
  function systemDark(){
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function isDark(){
    var a = document.documentElement.getAttribute('data-theme');
    return a ? a === 'dark' : systemDark();
  }
  function applyTheme(choice){
    if (choice) document.documentElement.setAttribute('data-theme', choice);
    else document.documentElement.removeAttribute('data-theme');
    el('btn-theme').textContent = I18N.t(isDark() ? 'theme.day' : 'theme.night');
    Render.syncTheme();
    POV.syncTheme();
    if (typeof GL3D !== 'undefined') GL3D.syncTheme();
    if (state.world) draw();
  }

  /* ---------------- language ---------------- */
  function applyLang(){
    var l = I18N.get();
    document.documentElement.setAttribute('lang', l);
    el('btn-lang').textContent = I18N.t('lang.next');
    if (state.steer) applySteerLabel();
    if (state.gfx) applyGfxLabel();
    if (state.sound !== undefined) applySoundLabel();
    if (state.weather) applyWeatherLabel();
    el('btn-theme').textContent = I18N.t(isDark() ? 'theme.day' : 'theme.night');
    el('menu-h1').innerHTML   = I18N.t('menu.h1');
    el('menu-lead').innerHTML = I18N.t('menu.lead');
    el('btn-view').textContent = I18N.t(state.view === 'pov' ? 'view.toTop' : 'view.toPov');

    var nodes = document.querySelectorAll('[data-t]');
    for (var i = 0; i < nodes.length; i++)
      nodes[i].textContent = I18N.t(nodes[i].getAttribute('data-t'));

    /* the keyboard legend in the briefing */
    var keys = el('brief-keys');
    clear(keys);
    [['W', 'keys.throttle'], ['S', 'keys.brake'], ['A D', 'keys.steer'], ['Q E', 'keys.indicators'],
     ['← →', 'keys.look'], ['M', 'keys.mirror'], ['V', 'keys.view'], ['H', 'keys.hints']]
    .forEach(function(k){
      var sp = make('span');
      k[0].split(' ').forEach(function(key){ sp.appendChild(make('kbd', null, key)); });
      sp.appendChild(document.createTextNode(' ' + I18N.t(k[1])));
      keys.appendChild(sp);
    });

    el('ref-body').innerHTML = '';
    buildMenu();
    if (state.world){
      if (state.mode === 'drive') fillDriveBrief();
      else fillLesson(state.world.sc);
    }
    if (state.screen === 'result') refreshResultLabels();
    if (state.world && state.world.pending && !el('overlay-fault').classList.contains('hidden'))
      showFaultOverlay(state.world.pending);
  }

  /* ---------------- canvas sizing ---------------- */
  function resize(){
    var wrap = el('canvas-wrap');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = wrap.clientWidth; H = wrap.clientHeight;
    if (!W || !H) return;
    canvas.width  = Math.round(W*dpr);
    canvas.height = Math.round(H*dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state.world) draw();
  }

  /* ---------------- menu ---------------- */
  function buildMenu(){
    var grid = el('level-grid');
    clear(grid);
    var groups = {}, order = [];
    SCENARIOS.forEach(function(sc, i){
      if (!groups[sc.group]){ groups[sc.group] = []; order.push(sc.group); }
      groups[sc.group].push({ sc:sc, i:i });
    });
    order.forEach(function(g){
      var sec = make('div','group');
      sec.appendChild(make('h3','group-title eyebrow', I18N.group(g)));
      var row = make('div','group-row');
      groups[g].forEach(function(item){
        var sc = item.sc, p = progress[sc.id];
        var card = make('button','card' + (p && p.passed ? ' done' : ''));
        card.type = 'button';
        card.appendChild(make('div','card-lvl', I18N.t('card.level') + ' ' + sc.level));
        card.appendChild(make('div','card-title', I18N.pick({ de:sc.title, en:sc.en })));
        card.appendChild(make('div','card-en',    I18N.other({ de:sc.title, en:sc.en })));
        var foot = make('div','card-foot');
        foot.appendChild(p
          ? make('span','badge' + (p.passed ? ' ok' : ' bad'), p.best + ' ' + I18N.t('card.points'))
          : make('span','badge new', I18N.t('card.new')));
        card.appendChild(foot);
        card.onclick = function(){ startScenario(item.i); };
        row.appendChild(card);
      });
      sec.appendChild(row);
      grid.appendChild(sec);
    });
    var done = SCENARIOS.filter(function(s){
      return progress[s.id] && progress[s.id].passed;
    }).length;
    el('progress-line').textContent = I18N.t('menu.passed', { a:done, b:SCENARIOS.length });
    el('tally-fill').style.width = Math.round(done/SCENARIOS.length*100) + '%';
  }

  /* ---------------- lesson text ---------------- */
  function signList(sc){
    var out = [], L = sc.layout;
    var mine = L.type === 'roundabout' ? 'roundabout' : Rules.signOf(sc, sc.player.from);
    out.push(mine);
    if (L.zone) out.push(L.zone);
    if (sc.gruenpfeil && sc.gruenpfeil.indexOf(sc.player.from) >= 0) out.push('green_arrow');
    if (L.crossings && L.crossings.length) out.push('crossing');
    if (L.rails) out.push('tram');
    if (L.busstop) out.push('bus_stop');
    var cross = Rules.signOf(sc, Geo.rightOf(sc.player.from));
    if (L.type !== 'roundabout' && cross !== mine && cross !== 'none') out.push(cross);
    return out.filter(function(s,i,a){ return s !== 'none' && a.indexOf(s) === i; });
  }

  function fillLesson(sc){
    var titlePair = { de:sc.title, en:sc.en };
    var taskPair  = { de:sc.task,  en:sc.taskEn };
    var merkPair  = { de:sc.merksatz, en:sc.merksatzEn };

    el('brief-group').textContent   = I18N.group(sc.group) + ' · ' + I18N.t('card.level') + ' ' + sc.level;
    el('brief-title').textContent   = I18N.pick(titlePair);
    el('brief-en').textContent      = I18N.other(titlePair);
    el('brief-task').textContent    = I18N.pick(taskPair);
    el('brief-task-en').textContent = I18N.other(taskPair);
    el('brief-merk').textContent    = I18N.pick(merkPair);
    el('brief-merk-sub').textContent = I18N.other(merkPair);

    var box = el('brief-signs');
    clear(box);
    signList(sc).forEach(function(t){
      var item = make('div','signitem');
      item.appendChild(Signs.chip(t, 52));
      var lab = Signs.LABEL[t] || [t, ''];
      var txt = make('div','signtxt');
      txt.appendChild(make('div','sl-de', I18N.pick(lab)));
      txt.appendChild(make('div','sl-en', I18N.other(lab)));
      item.appendChild(txt);
      box.appendChild(item);
    });

    el('side-title').textContent = I18N.pick(titlePair);
    el('side-task').textContent  = I18N.pick(taskPair);
    el('hud-task').textContent   = I18N.pick(taskPair);
    var sb = el('side-signs');
    clear(sb);
    signList(sc).forEach(function(t){ sb.appendChild(Signs.chip(t, 40)); });
  }

  function startScenario(i){
    state.mode = 'lesson';
    state.scIndex = i;
    var sc = SCENARIOS[i];
    state.world = new Sim.World(sc);
    input.throttle = false; input.brake = false; input.indicator = 'off';
    look.left = false; look.right = false;
    state.yaw = 0; state.yawTarget = 0; state.drag = null;
    el('pedal-gas').classList.remove('down');
    el('pedal-brake').classList.remove('down');
    state.screen = 'brief';
    fillLesson(sc);
    show('screen-menu', false);
    show('screen-play', true);
    show('overlay-brief', true);
    show('overlay-result', false);
    show('overlay-ref', false);
    show('overlay-fault', false);
    el('btn-end-drive').classList.add('hidden'); el('btn-end-hud').classList.add('hidden');
    el('btn-menu-hud').classList.remove('hidden');
    applyView();
    resize();
    updateHud();
    draw();
  }

  /* ---------------- free drive ---------------- */
  function fillDriveBrief(){
    var w = state.world, titlePair = { de:w.sc.title, en:w.sc.en };
    var B = w.exam ? EXAM_BRIEF : w.map.preset ? FRANKFURT_BRIEF : DRIVE_BRIEF;
    el('brief-group').textContent   = I18N.t(w.exam ? 'exam.button' : 'drive.cta.button');
    el('brief-title').textContent   = I18N.pick(titlePair);
    el('brief-en').textContent      = I18N.other(titlePair);
    el('brief-task').textContent    = I18N.pick(B.task);
    el('brief-task-en').textContent = I18N.other(B.task);
    el('brief-merk').textContent    = I18N.pick(B.merk);
    el('brief-merk-sub').textContent = I18N.other(B.merk);
    clear(el('brief-signs'));

    el('side-title').textContent = I18N.pick(titlePair);
    el('side-task').textContent  = I18N.pick(B.task);
    clear(el('side-signs'));
  }

  function startDrive(which){
    state.mode = 'drive';
    if (which === 'frankfurt' || which === 'random' || which === 'exam') state.driveMap = which;
    var exam = state.driveMap === 'exam';
    var seed = Math.floor(Math.random()*100000);
    state.world = new Drive.DriveWorld({ seed:seed, cols:6, rows:5, target:1e9,
      preset: state.driveMap === 'random' ? null : 'eschersheim',
      exam: exam ? { minutes:EXAM_MINUTES } : null,
      steer: state.steer });
    wheelKeys.left = wheelKeys.right = false; input.steer = 0; input.steerAbs = null; state.wheel = null;
    state.spoken = null;
    input.throttle = false; input.brake = false; input.indicator = 'off';
    look.left = false; look.right = false; look.mirror = false;
    state.yaw = 0; state.yawTarget = 0; state.drag = null;
    el('pedal-gas').classList.remove('down');
    el('pedal-brake').classList.remove('down');
    state.screen = 'brief';
    fillDriveBrief();
    show('screen-menu', false);
    show('screen-play', true);
    show('overlay-brief', true);
    show('overlay-result', false);
    show('overlay-ref', false);
    show('overlay-fault', false);
    el('btn-end-drive').classList.remove('hidden'); el('btn-end-hud').classList.remove('hidden');
    el('btn-menu-hud').classList.add('hidden');
    applyView();
    resize();
    updateHud();
    draw();
  }

  function beginDriving(){
    state.screen = 'play';
    show('overlay-brief', false);
    state.last = performance.now();
  }

  /* stopped mid-drive to explain a fault, examiner-in-the-passenger-seat style */
  function showFaultOverlay(f){
    var box = el('fault-card');
    clear(box);
    box.appendChild(faultRow(f));
    el('btn-fault-rewind').classList.toggle('hidden', !state.world.canRewind());
    show('overlay-fault', true);
    state.faultShownAt = performance.now();
  }
  /* one explained mistake: what, which law, why it matters, what to do */
  function faultRow(f){
    var def = Rules.FAULTS[f.id];
    var row = make('div','fault ' + def.sev);
    row.appendChild(make('div','f-plate', def.pts ? '−' + def.pts : 'i'));
    var body = make('div','f-body');
    body.appendChild(make('div','f-title', I18N.pick(def.title)));
    body.appendChild(make('div','f-en', I18N.other(def.title) + (def.law ? '  ·  ' + def.law : '')));
    if (f.detail) body.appendChild(make('div','f-detail', I18N.pick(f.detail)));
    body.appendChild(make('div','f-why',   I18N.pick(def.why)));
    body.appendChild(make('div','f-whyen', I18N.other(def.why)));
    var r = Rules.REASON_TEXT[f.reason];
    if (r && I18N.pick(r.text)){
      var rb = make('div','f-rule');
      rb.appendChild(make('strong', null, I18N.pick(r.title) + ': '));
      rb.appendChild(document.createTextNode(I18N.pick(r.text)));
      rb.appendChild(make('div','f-ruleen', I18N.other(r.text)));
      body.appendChild(rb);
    }
    body.appendChild(make('div','f-tip', I18N.t('res.tip') + I18N.pick(def.tip)));
    row.appendChild(body);
    return row;
  }
  function resumeDrive(){
    show('overlay-fault', false);
    if (state.world) state.world.resume();
  }
  /* back to a few seconds before the mistake, frozen until you press gas */
  function rewindDrive(){
    if (!state.world || !state.world.rewind()) return;
    show('overlay-fault', false);
    input.throttle = false; input.brake = false;
    input.indicator = state.world.player.indicator || 'off';
    el('pedal-gas').classList.remove('down');
    el('pedal-brake').classList.remove('down');
    updateHud();
    draw();
  }

  function driveResult(){
    if (!state.world) return;
    state.screen = 'result';
    show('overlay-fault', false);
    var w = state.world, rep = w.report();
    var majors = rep.faults.filter(function(f){ return f.def.sev === 'major'; }).length;

    el('res-score').textContent = rep.score;
    var verdict = el('res-verdict');
    verdict.textContent = I18N.t('drive.result.title');
    verdict.className = 'verdict ' + (majors ? 'bad' : 'ok');
    el('res-sub').textContent = I18N.t('drive.result.sub', { a:rep.cleared });
    if (rep.exam){
      var ex = rep.exam;
      verdict.textContent = I18N.t(ex.passed ? 'exam.passed' : 'exam.failed');
      verdict.className = 'verdict ' + (ex.passed ? 'ok' : 'bad');
      el('res-sub').textContent = ex.passed ? I18N.t('exam.sub.pass', { n:ex.minors })
        : I18N.t('exam.sub.' + ex.why, { n:ex.minors });
    }

    var list = el('res-faults');
    clear(list);
    if (rep.faults.length){
      list.appendChild(make('div','sub', I18N.t('drive.result.explained')));
      rep.faults.forEach(function(f){ list.appendChild(faultRow(f)); });
    } else {
      var row0 = make('div','fault ok');
      row0.appendChild(make('div','f-plate','0'));
      var b0 = make('div','f-body');
      b0.appendChild(make('div','f-title', I18N.t('res.noFaults')));
      b0.appendChild(make('div','f-why',   I18N.t('res.noFaultsWhy')));
      row0.appendChild(b0);
      list.appendChild(row0);
    }
    if (rep.fixed.length){
      list.appendChild(make('div','sub', I18N.t('drive.result.fixed', { n:rep.fixed.length })));
      rep.fixed.forEach(function(f){
        var r = faultRow(f);
        r.classList.add('fixed');
        r.querySelector('.f-plate').textContent = '↺';
        list.appendChild(r);
      });
    }
    clear(el('res-points'));
    el('res-points').appendChild(checklist(rep));

    refreshResultLabels();
    show('overlay-result', true);
    draw();
  }
  /* the examiner's scoring sheet: five areas, each clean or not */
  function checklist(rep){
    var box = make('div', 'checklist');
    box.appendChild(make('h4', 'eyebrow', I18N.t('exam.checklist')));
    (rep.categories || []).forEach(function(c){
      var row = make('div', 'check-row ' + (c.faults.length ? 'bad' : 'ok'));
      row.appendChild(make('span', 'check-mark', c.faults.length ? '✗' : '✓'));
      var t = make('span', 'check-name', I18N.pick(c.cat));
      row.appendChild(t);
      var counts = {};
      c.faults.forEach(function(f){ var k = I18N.pick(f.def.title); counts[k] = (counts[k] || 0) + 1; });
      var what = Object.keys(counts).map(function(k){ return k + (counts[k] > 1 ? ' ×' + counts[k] : ''); }).join(', ');
      row.appendChild(make('span', 'check-what', what || I18N.t('exam.ok')));
      box.appendChild(row);
    });
    return box;
  }
  function endDrive(){
    if (state.mode !== 'drive' || !state.world) return;
    if (state.world.exam && state.world.state === 'run') state.world.finish('exam_end');
    driveResult();
  }

  /* ---------------- view ---------------- */
  function applyView(){
    var pov = state.view === 'pov';
    el('btn-view').textContent = I18N.t(pov ? 'view.toTop' : 'view.toPov');
    mini.classList.toggle('hidden', !pov);
    el('look-l').classList.toggle('hidden', !pov);
    el('look-r').classList.toggle('hidden', !pov);
  }
  function toggleView(){
    state.view = state.view === 'pov' ? 'top' : 'pov';
    save(VIEW, state.view);
    applyView();
    draw();
  }

  /* ---------------- loop ---------------- */
  function tick(now){
    requestAnimationFrame(tick);
    var dt = Math.min(0.05, (now - state.last)/1000);
    state.last = now;
    if (state.screen !== 'play' || !state.world){ if (typeof Sound !== 'undefined') Sound.idle(); return; }

    /* head movement: keys, buttons or a drag on the road */
    if (state.drag === null){
      var t = 0;
      if (look.left)  t -= MAX_YAW;
      if (look.right) t += MAX_YAW;
      state.yawTarget = t;
    }
    state.yaw += (state.yawTarget - state.yaw) * Math.min(1, dt*8);
    if (Math.abs(state.yaw - state.yawTarget) < 0.002) state.yaw = state.yawTarget;

    /* the examiner sees where you look: head turned, mirror checked */
    input.yaw = state.yaw;
    input.mirror = look.mirror;
    input.steer = (wheelKeys.right ? 1 : 0) - (wheelKeys.left ? 1 : 0);
    /* the indicator stalk flicks back after a turn, as in a real car */
    if (state.world.indicatorOff){ input.indicator = 'off'; state.world.indicatorOff = false; }
    state.world.update(dt, input);
    if (typeof Sound !== 'undefined') Sound.update(state.world, input, dt, { night:isDark(), rain:state.weather === 'rain' });
    if (state.world.exam) examiner(state.world);
    updateHud();
    draw();

    if (state.mode === 'drive'){
      var fo = el('overlay-fault'), open = !fo.classList.contains('hidden');
      if (state.world.pending && !open) showFaultOverlay(state.world.pending);
      else if (!state.world.pending && open) show('overlay-fault', false);
      if (state.world.state !== 'run' && state.world.endTimer > 0.9) driveResult();
    } else if (state.world.state !== 'run' && state.world.endTimer > 0.9){
      finishRun();
    }
  }

  /* ---------------- the examiner's voice ---------------- */
  /* Directions as a German examiner gives them, once per junction, a
     little before you reach it - and the words nobody wants to hear. */
  var ORD = { right:'erste', straight:'zweite', left:'dritte' };
  function examiner(w){
    var p = w.player, st = p.steps && p.steps[p.stepIdx];
    if (w.state !== 'run'){
      if (w.endReason === 'exam_fail' && state.spoken !== 'end'){
        state.spoken = 'end';
        say('Bitte fahren Sie rechts ran. Die Prüfung ist leider beendet.');
      }
      return;
    }
    if (!st) return;
    var key = p.stepIdx + '@' + st.node.id;
    var dist = (st.junctionS - p.s) / CFG.PPM;
    if (state.spoken === key || dist > 75 || dist < 5) return;
    state.spoken = key;
    var plan = st.plan || st.to;
    var turn = Geo.turnOf(st.from, plan), street = w.map.streetName(st.node, plan);
    var text;
    if (st.node.layout.type === 'roundabout')
      text = 'Im Kreisverkehr bitte die ' + ORD[turn] + ' Ausfahrt nehmen.';
    else if (turn === 'straight')
      text = p.stepIdx % 3 === 0 ? 'Bitte weiter geradeaus.' : '';
    else
      text = 'An der nächsten Kreuzung bitte ' + (turn === 'right' ? 'rechts' : 'links') +
             ' abbiegen, in die ' + street + '.';
    if (text) say(text);
  }
  function say(text){
    try {
      if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return;
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE'; u.rate = 0.95;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e){}
  }

  function draw(){
    if (!state.world || !W || !H) return;
    var gl = el('gl');
    if (state.view === 'pov' && state.screen !== 'brief'){
      /* real 3D when the browser can do it; the flat projection otherwise */
      var in3d = typeof GL3D !== 'undefined' && GL3D.available();
      gl.classList.toggle('hidden', !in3d);
      if (in3d){
        ctx.save();
        ctx.setTransform(1,0,0,1,0,0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        GL3D.frame(state.world, state.yaw, W, H, { mirror:look.mirror });
      } else POV.frame(ctx, W, H, state.world, state.yaw);
      drawMinimap();
    } else {
      gl.classList.add('hidden');
      Render.frame(ctx, W, H, state.world, state.screen === 'brief');
      if (state.view === 'pov') drawMinimap();
    }
  }
  function drawMinimap(){
    if (mini.classList.contains('hidden')) return;
    var s = mini.width, w = state.world;
    Render.frame(mctx, s, s, w, true, true);
    if (!w.map) return;
    var k = s/296;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    /* you: a bold arrow where the map is centred */
    mctx.save();
    mctx.translate(s/2, s*0.66);
    mctx.fillStyle = '#ffffff'; mctx.strokeStyle = '#1b6fd6'; mctx.lineWidth = 4*k;
    mctx.beginPath();
    mctx.moveTo(0, -17*k); mctx.lineTo(12*k, 13*k); mctx.lineTo(0, 6*k); mctx.lineTo(-12*k, 13*k);
    mctx.closePath(); mctx.fill(); mctx.stroke();
    mctx.restore();
    /* north, so the map can be matched to the real one */
    var nh = -Math.PI/2 - w.player.pos.h;
    var nx = s - 22*k, ny = 22*k;
    mctx.save();
    mctx.translate(nx, ny);
    mctx.fillStyle = 'rgba(20,24,30,0.72)';
    mctx.beginPath(); mctx.arc(0, 0, 15*k, 0, Math.PI*2); mctx.fill();
    mctx.rotate(nh - Math.PI/2 + Math.PI/2);
    mctx.fillStyle = '#e8533f';
    mctx.beginPath(); mctx.moveTo(0, -12*k); mctx.lineTo(5*k, 0); mctx.lineTo(-5*k, 0); mctx.closePath(); mctx.fill();
    mctx.fillStyle = '#ffffff'; mctx.font = 'bold ' + Math.round(11*k) + 'px Arial'; mctx.textAlign = 'center'; mctx.textBaseline = 'middle';
    mctx.fillText('N', 0, 6*k);
    mctx.restore();
    /* what comes next: an arrow, how far, and the street */
    var ins = w.instruction && w.instruction();
    if (!ins) return;
    var ph = 64*k;
    mctx.fillStyle = 'rgba(16,20,26,0.86)';
    mctx.fillRect(0, s - ph, s, ph);
    drawTurnIcon(mctx, 34*k, s - ph/2, 22*k, ins.turn, w.player.steps[w.player.stepIdx].node.layout.type === 'roundabout');
    var d = ins.dist;
    var dt = d < 12 ? I18N.t('mini.now') : (d < 100 ? Math.round(d/5)*5 : Math.round(d/10)*10) + ' m';
    mctx.fillStyle = '#ffffff'; mctx.textAlign = 'left'; mctx.textBaseline = 'alphabetic';
    mctx.font = 'bold ' + Math.round(26*k) + 'px Arial';
    mctx.fillText(dt, 66*k, s - ph + 30*k);
    mctx.fillStyle = 'rgba(255,255,255,0.72)'; mctx.font = Math.round(13*k) + 'px Arial';
    var name = ins.street || '';
    while (name.length > 4 && mctx.measureText(name).width > s - 74*k) name = name.slice(0, -2);
    if (name !== (ins.street || '')) name += '…';
    mctx.fillText(name, 66*k, s - ph + 52*k);
  }
  /* satnav arrows: left, right, straight on, or a roundabout exit */
  function drawTurnIcon(g, x, y, r, turn, roundabout){
    g.save();
    g.translate(x, y);
    g.strokeStyle = '#ffffff'; g.fillStyle = '#ffffff';
    g.lineWidth = r*0.28; g.lineCap = 'round'; g.lineJoin = 'round';
    var head = function(px, py, ang){
      g.save(); g.translate(px, py); g.rotate(ang);
      g.beginPath(); g.moveTo(r*0.42, 0); g.lineTo(-r*0.22, -r*0.36); g.lineTo(-r*0.22, r*0.36); g.closePath(); g.fill();
      g.restore();
    };
    if (roundabout){
      g.beginPath(); g.arc(0, r*0.15, r*0.42, 0, Math.PI*2); g.stroke();
      g.beginPath(); g.moveTo(0, r); g.lineTo(0, r*0.57); g.stroke();
      var a = turn === 'right' ? 0 : turn === 'left' ? Math.PI : -Math.PI/2;
      var ex = Math.cos(a)*r*0.42, ey = r*0.15 + Math.sin(a)*r*0.42;
      g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex + Math.cos(a)*r*0.45, ey + Math.sin(a)*r*0.45); g.stroke();
      head(ex + Math.cos(a)*r*0.6, ey + Math.sin(a)*r*0.6, a);
    } else if (turn === 'left' || turn === 'right'){
      var sd = turn === 'right' ? 1 : -1;
      g.beginPath(); g.moveTo(-sd*r*0.35, r); g.lineTo(-sd*r*0.35, -r*0.05);
      g.quadraticCurveTo(-sd*r*0.35, -r*0.45, 0, -r*0.45); g.lineTo(sd*r*0.45, -r*0.45); g.stroke();
      head(sd*r*0.6, -r*0.45, sd > 0 ? 0 : Math.PI);
    } else {
      g.beginPath(); g.moveTo(0, r); g.lineTo(0, -r*0.5); g.stroke();
      head(0, -r*0.72, -Math.PI/2);
    }
    g.restore();
  }

  /* ---------------- HUD ---------------- */
  function updateHud(){
    var w = state.world, p = w.player;
    var v = Math.round(toKmh(p.v));
    var sp = el('hud-speed');
    sp.textContent = v;
    sp.className = v > (w.sc.limit || 50) + 2 ? 'over' : '';
    el('hud-limit').textContent  = w.sc.limit;
    if (state.mode === 'drive' && w.exam){
      var left = Math.max(0, Math.ceil(w.exam.seconds - w.t));
      el('hud-time-label').textContent = I18N.t('exam.timeLeft');
      el('hud-time').textContent = Math.floor(left/60) + ':' + ('0' + left % 60).slice(-2);
      var ins = w.instruction();
      el('hud-task').textContent = ins ? I18N.pick(ins) : '';
    } else if (state.mode === 'drive'){
      el('hud-time-label').textContent = I18N.t('hud.cleared');
      el('hud-time').textContent = w.cleared;
      var instr = w.instruction();
      el('hud-task').textContent = instr ? I18N.pick(instr) : '';
    } else {
      el('hud-time-label').textContent = I18N.t('hud.time');
      el('hud-time').textContent = Math.max(0, Math.ceil((w.sc.timeLimit || 45) - w.t));
    }
    el('hud-faults').textContent = w.faults.length;

    var blink = (w.t*2.2) % 1 < 0.55;
    el('ind-l').classList.toggle('on', p.indicator === 'left'  && blink);
    el('ind-r').classList.toggle('on', p.indicator === 'right' && blink);
    el('look-l').classList.toggle('on', state.yaw < -0.05);
    el('look-r').classList.toggle('on', state.yaw >  0.05);

    /* nobody whispers the answers in an exam */
    var h = state.hints && !w.exam ? I18N.pick(w.hint()) : '';
    /* a look just registered: say so, briefly - you should know it counted */
    var lf = w.lookFlash;
    if (lf && w.t - lf.t < 1.2)
      h = I18N.pick(lf.side === 'mirror' ? { de:'✓ Spiegel', en:'✓ Mirror checked' }
          : lf.side === 'right' ? { de:'✓ Schulterblick rechts', en:'✓ Shoulder check right' }
          : { de:'✓ Schulterblick links', en:'✓ Shoulder check left' });
    /* after a rewind, always say what you are retrying and how to get it right */
    if (w.hold){
      var fd = Rules.FAULTS[w.hold.fault.id];
      h = I18N.t('drive.hold.retrying', { what:I18N.pick(fd.title) }) + '\n' +
          I18N.t('drive.hold', { s:w.hold.back, tip:I18N.pick(fd.tip) });
    }
    /* too fast: say so before it is booked (not in the test - but the
       speedometer still turns red there) */
    if (w.speedWarn && !w.exam && !w.hold)
      h = I18N.t('warn.speed', { lim:w.sc.limit || 50 });
    el('hud-speed').parentNode.classList.toggle('warn', !!w.speedWarn && (w.t*3) % 1 < 0.5);
    if (w.speedWarn && !w.exam && typeof Sound !== 'undefined') Sound.warn();
    var hb = el('hud-hint');
    if (h !== hb.dataset.msg){
      hb.textContent = h || '';
      hb.dataset.msg = h || '';
    }
    hb.classList.toggle('hidden', !h);
  }

  /* ---------------- debrief ---------------- */
  /* the retry/list buttons are shared between a lesson's debrief and a
     drive's summary; keep their wording matched to whichever is showing,
     including across a language toggle while the result screen is up */
  function refreshResultLabels(){
    if (state.mode === 'drive'){
      el('btn-retry').querySelector('span').textContent = I18N.t('drive.result.retry');
      el('btn-retry').onclick = startDrive;
      el('btn-next').classList.add('hidden');
      el('btn-list').textContent = I18N.t('drive.result.list');
    } else {
      el('btn-retry').querySelector('span').textContent = I18N.t('res.again');
      el('btn-retry').onclick = function(){ startScenario(state.scIndex); };
      el('btn-next').classList.toggle('hidden', state.scIndex >= SCENARIOS.length - 1);
      el('btn-list').textContent = I18N.t('res.list');
    }
  }

  function finishRun(){
    if (state.screen === 'result') return;
    state.screen = 'result';
    var w = state.world, sc = w.sc, rep = w.report();

    var prev = progress[sc.id];
    progress[sc.id] = {
      best:   Math.max(rep.score, prev ? prev.best : 0),
      passed: rep.passed || !!(prev && prev.passed)
    };
    save(STORE, progress);

    el('res-score').textContent = rep.score;
    var verdict = el('res-verdict');
    verdict.textContent = I18N.t(rep.passed ? 'res.passed' : 'res.failed');
    verdict.className = 'verdict ' + (rep.passed ? 'ok' : 'bad');
    el('res-sub').textContent = rep.passed
      ? I18N.t(rep.faults.length ? 'res.subMinor' : 'res.subClean')
      : I18N.t('res.subFail');

    var list = el('res-faults');
    clear(list);
    if (!rep.faults.length){
      var row0 = make('div','fault ok');
      row0.appendChild(make('div','f-plate','0'));
      var b0 = make('div','f-body');
      b0.appendChild(make('div','f-title', I18N.t('res.noFaults')));
      b0.appendChild(make('div','f-why',   I18N.t('res.noFaultsWhy')));
      row0.appendChild(b0);
      list.appendChild(row0);
    }
    rep.faults.forEach(function(f){
      var d = f.def;
      var row = make('div','fault ' + d.sev);
      row.appendChild(make('div','f-plate', d.pts ? '−' + d.pts : 'i'));

      var body = make('div','f-body');
      body.appendChild(make('div','f-title', I18N.pick(d.title)));
      body.appendChild(make('div','f-en',
        I18N.other(d.title) + (d.law ? '  ·  ' + d.law : '')));
      if (f.detail) body.appendChild(make('div','f-detail', I18N.pick(f.detail)));
      body.appendChild(make('div','f-why',   I18N.pick(d.why)));
      body.appendChild(make('div','f-whyen', I18N.other(d.why)));

      var r = Rules.REASON_TEXT[f.reason];
      if (r && I18N.pick(r.text)){
        var rb = make('div','f-rule');
        rb.appendChild(make('strong', null, I18N.pick(r.title) + ': '));
        rb.appendChild(document.createTextNode(I18N.pick(r.text)));
        rb.appendChild(make('div','f-ruleen', I18N.other(r.text)));
        body.appendChild(rb);
      }
      body.appendChild(make('div','f-tip', I18N.t('res.tip') + I18N.pick(d.tip)));
      row.appendChild(body);
      list.appendChild(row);
    });

    var pts = el('res-points');
    clear(pts);
    pts.appendChild(make('h4','eyebrow', I18N.t('res.about')));
    sc.points.forEach(function(p){
      var li = make('div','point');
      bilingual(li, p, 'p-de', 'p-en');
      pts.appendChild(li);
    });

    refreshResultLabels();
    show('overlay-result', true);
    draw();
    buildMenu();
  }

  /* ---------------- reference sheet ---------------- */
  var REF_ROWS = [
    ['none', { de:'Rechts vor links', en:'Right before left' },
      { de:'Keine Schilder, keine Ampel: wer von rechts kommt, fährt zuerst. Auch dann, wenn der andere abbiegt.',
        en:'No signs, no lights: whoever comes from the right goes first, even if they are turning.' }],
    ['yield', { de:'Vorfahrt gewähren (Z 205)', en:'Give way (sign 205)' },
      { de:'Du musst warten. Anhalten nur, wenn nötig – aber der Bevorrechtigte darf nicht bremsen müssen.',
        en:'You must wait. Stop only if you need to, but never make the other driver brake.' }],
    ['stop', { de:'Stop (Z 206)', en:'Stop (sign 206)' },
      { de:'Immer vollständig anhalten an der Haltelinie, auch bei freier Strasse. Danach vortasten.',
        en:'Always come to a complete stop at the line, even on an empty road. Then edge forward.' }],
    ['priority', { de:'Vorfahrtstrasse (Z 306)', en:'Priority road (sign 306)' },
      { de:'Du hast Vorfahrt, solange du der Strasse folgst. Beim Abbiegen gelten wieder die Abbiegeregeln.',
        en:'You have priority as long as you follow the road. Turning off, the turning rules apply again.' }],
    ['crossing', { de:'Fussgängerüberweg (Z 350)', en:'Zebra crossing (sign 350)' },
      { de:'Fussgängern, die erkennbar hinüber wollen, das Überqueren ermöglichen. Ausserdem Überhol- und Halteverbot.',
        en:'Let pedestrians who clearly want to cross go. No overtaking and no stopping either.' }],
    ['roundabout', { de:'Kreisverkehr (Z 215 + 205)', en:'Roundabout (signs 215 + 205)' },
      { de:'Der Verkehr im Kreisel hat Vorfahrt. Rein ohne Blinker, raus mit rechts.',
        en:'Traffic in the circle has priority. No indicator going in, right indicator coming out.' }],
    ['green_arrow', { de:'Grünpfeil (Z 720)', en:'Green arrow (sign 720)' },
      { de:'Rechtsabbiegen bei Rot nur nach vollständigem Halt und ohne jede Behinderung.',
        en:'Right turn on red only after a full stop and only if you obstruct nobody.' }],
    ['tram', { de:'Schienenfahrzeuge', en:'Rail vehicles' },
      { de:'An ungeregelten Kreuzungen haben Bahnen Vorrang, auch von links. Schilder und Ampeln gehen aber vor.',
        en:'Trams go first at unregulated junctions, even from the left. Signs and lights still override that.' }],
    ['bus_stop', { de:'Linienbus (§ 20 StVO)', en:'Buses (§ 20 StVO)' },
      { de:'Blinkt der Bus an der Haltestelle, hat er Vorrang beim Abfahren. Bus mit Warnblinklicht: nur Schrittgeschwindigkeit vorbei.',
        en:'A bus indicating at a stop has priority pulling out. Passing one with hazard lights on: walking pace only.' }],
    ['play_street', { de:'Verkehrsberuhigter Bereich (Z 325)', en:'Home zone (sign 325)' },
      { de:'Schrittgeschwindigkeit, Fussgänger dürfen die ganze Strasse nutzen, beim Verlassen allen Vorfahrt gewähren.',
        en:'Walking pace, pedestrians may use the whole road, and you give way to everyone when leaving.' }],
    ['zone30', { de:'Zone 30', en:'Zone 30' },
      { de:'Höchstens 30 km/h, meist ohne Vorfahrtschilder – also rechts vor links.',
        en:'30 km/h maximum, and usually no priority signs, so rechts vor links applies.' }]
  ];

  function buildReference(){
    var box = el('ref-body');
    if (box.childElementCount) return;
    var sec = make('div','ref-order');
    sec.appendChild(make('h4', null, I18N.t('ref.orderTitle')));
    [['1','ref.s1'], ['2','ref.s2'], ['3','ref.s3'], ['+','ref.s4']].forEach(function(s){
      var row = make('div','ref-step');
      row.appendChild(make('i', null, s[0]));
      row.appendChild(make('div', null, I18N.t(s[1])));
      sec.appendChild(row);
    });
    box.appendChild(sec);

    REF_ROWS.forEach(function(r){
      var row = make('div','ref-row');
      var c = make('div','ref-sign');
      c.appendChild(Signs.chip(r[0], 50));
      row.appendChild(c);
      var t = make('div','ref-txt');
      t.appendChild(make('div','ref-title', I18N.pick(r[1])));
      t.appendChild(make('div','ref-de', I18N.pick(r[2])));
      t.appendChild(make('div','ref-en', I18N.other(r[2])));
      row.appendChild(t);
      box.appendChild(row);
    });
  }

  /* ---------------- input ---------------- */
  function setIndicator(dir){
    input.indicator = (input.indicator === dir) ? 'off' : dir;
    if (state.world) updateHud();
  }
  /* who steers in free drive and the test: you, or the car */
  function toggleSteer(){
    state.steer = state.steer === 'manual' ? 'auto' : 'manual';
    save(STEER, state.steer);
    if (state.mode === 'drive' && state.world) state.world.setSteer(state.steer);
    wheelKeys.left = wheelKeys.right = false; input.steerAbs = null;
    applySteerLabel();
  }
  function applySteerLabel(){
    el('btn-steer').textContent = I18N.t(state.steer === 'manual' ? 'steer.manual' : 'steer.auto');
    el('btn-steer').classList.toggle('off', state.steer !== 'manual');
  }
  /* post-processing (soft shadows in corners, glow, colour grade) on or off */
  function setGfx(q){
    state.gfx = q;
    save(GFX, q);
    if (typeof GL3D !== 'undefined') GL3D.setQuality(q);
    applyGfxLabel();
  }
  function applyGfxLabel(){
    el('btn-gfx').textContent = I18N.t(state.gfx === 'high' ? 'gfx.high' : 'gfx.fast');
    el('btn-gfx').classList.toggle('off', state.gfx !== 'high');
  }
  function setSound(v){
    state.sound = v;
    save(SOUND, v);
    if (typeof Sound !== 'undefined') Sound.setOn(v);
    applySoundLabel();
  }
  function applySoundLabel(){
    el('btn-sound').textContent = I18N.t(state.sound ? 'sound.on' : 'sound.off');
    el('btn-sound').classList.toggle('off', !state.sound);
  }
  /* clear, low evening sun, or rain on wet roads */
  function setWeather(w){
    state.weather = WEATHERS.indexOf(w) < 0 ? 'clear' : w;
    save(WEATHER, state.weather);
    if (typeof GL3D !== 'undefined') GL3D.setWeather(state.weather);
    applyWeatherLabel();
  }
  function applyWeatherLabel(){
    el('btn-weather').textContent = I18N.t('weather.' + state.weather);
  }
  function setHints(on){
    state.hints = on;
    el('btn-hints').classList.toggle('off', !on);
  }

  window.addEventListener('keydown', function(e){
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key.toLowerCase();
    if (k === ' ' || k.indexOf('arrow') === 0) e.preventDefault();

    if (state.screen === 'brief' && (k === ' ' || k === 'enter')){ beginDriving(); return; }
    if (state.screen === 'result'){
      if (k === 'r' || k === ' '){
        if (state.mode === 'drive') startDrive(); else startScenario(state.scIndex);
        return;
      }
      if (k === 'enter' && state.mode !== 'drive' && state.scIndex < SCENARIOS.length - 1){
        startScenario(state.scIndex + 1); return;
      }
    }
    if (k === 'h'){ setHints(!state.hints); return; }
    if (k === 'v'){ toggleView(); return; }
    if (k === 'escape'){ toMenu(); return; }
    if (state.screen !== 'play') return;

    /* the examiner has stopped the car to explain something: only the
       Continue key does anything until you acknowledge it */
    if (state.mode === 'drive' && !el('overlay-fault').classList.contains('hidden')){
      /* Space is also the brake: a held or panicked press must not rewind
         the moment the card appears - only a fresh press, after a beat */
      if (e.repeat || performance.now() - (state.faultShownAt || 0) < 900) return;
      if (k === ' ' || k === 'enter' || k === 'backspace'){
        if (state.world.canRewind()) rewindDrive(); else resumeDrive();
      }
      if (k === 'c') resumeDrive();
      return;
    }

    /* the Space that chose "rewind" must not auto-repeat into a brake press
       and set the car off before you are ready */
    if (e.repeat && k === ' ' && state.world && state.world.hold) return;
    if (k === 'w' || k === 'arrowup')   { input.throttle = true; el('pedal-gas').classList.add('down'); }
    if (k === 's' || k === 'arrowdown' || k === ' '){ input.brake = true; el('pedal-brake').classList.add('down'); }
    /* A / D steer, as in any driving game; Q / E are the indicator stalk;
       the arrow keys turn your head (shoulder check) */
    if (k === 'a') wheelKeys.left = true;
    if (k === 'd') wheelKeys.right = true;
    if (k === 'arrowleft')  look.left = true;
    if (k === 'arrowright') look.right = true;
    if (k === 'l'){ toggleSteer(); return; }
    if (k === 'g'){ setGfx(state.gfx === 'high' ? 'fast' : 'high'); return; }
    if (k === 'n'){ setSound(!state.sound); return; }
    if (k === 't'){ setWeather(WEATHERS[(WEATHERS.indexOf(state.weather) + 1) % WEATHERS.length]); return; }
    if (k === 'm') look.mirror = true;
    if (k === 'q' && !e.repeat) setIndicator('left');
    if (k === 'e' && !e.repeat) setIndicator('right');
    if (k === 'x') input.indicator = 'off';
    if (k === 'r'){ if (state.mode === 'drive') startDrive(); else startScenario(state.scIndex); }
  });
  window.addEventListener('keyup', function(e){
    var k = e.key.toLowerCase();
    if (k === 'w' || k === 'arrowup')   { input.throttle = false; el('pedal-gas').classList.remove('down'); }
    if (k === 's' || k === 'arrowdown' || k === ' '){ input.brake = false; el('pedal-brake').classList.remove('down'); }
    if (k === 'arrowleft')  look.left = false;
    if (k === 'arrowright') look.right = false;
    if (k === 'a') wheelKeys.left = false;
    if (k === 'd') wheelKeys.right = false;
    if (k === 'm') look.mirror = false;
  });
  window.addEventListener('blur', function(){
    input.throttle = false; input.brake = false;
    look.left = false; look.right = false;
    el('pedal-gas').classList.remove('down');
    el('pedal-brake').classList.remove('down');
  });

  /* press-and-hold buttons (mouse, touch and pen in one path) */
  function hold(id, onDown, onUp){
    var n = el(id), pid = null;
    function down(e){
      e.preventDefault();
      pid = e.pointerId;
      if (n.setPointerCapture && e.pointerId !== undefined){
        try { n.setPointerCapture(e.pointerId); } catch(err){}
      }
      onDown(); n.classList.add('down');
    }
    function up(e){ if (e && e.cancelable) e.preventDefault(); pid = null; onUp(); n.classList.remove('down'); }
    n.addEventListener('pointerdown', down);
    n.addEventListener('pointerup', up);
    n.addEventListener('pointercancel', up);
    n.addEventListener('lostpointercapture', up);
    n.addEventListener('contextmenu', function(e){ e.preventDefault(); });
    /* no long-press text selection, magnifier or callout on iOS; pointer
       events still arrive, so the press itself is unaffected */
    n.addEventListener('touchstart', function(e){ if (e.cancelable) e.preventDefault(); }, { passive:false });

    /* iOS, above all inside another app's frame, sometimes loses the
       button's pointerup and the pedal sticks down. Back-ups: the same
       finger lifting anywhere, and the touch list no longer holding a
       finger on (or near) the button. */
    function held(){ return pid !== null || n.classList.contains('down'); }
    function release(){ if (held()) up(); }
    window.addEventListener('pointerup', function(e){ if (e.pointerId === pid) release(); }, true);
    window.addEventListener('pointercancel', function(e){ if (e.pointerId === pid) release(); }, true);
    function touchesGone(e){
      if (!held()) return;
      var r = n.getBoundingClientRect(), pad = 48;
      for (var i = 0; i < e.touches.length; i++){
        var t = e.touches[i];
        if (t.clientX > r.left - pad && t.clientX < r.right + pad &&
            t.clientY > r.top - pad  && t.clientY < r.bottom + pad) return;
      }
      release();
    }
    document.addEventListener('touchend', touchesGone, { passive:true, capture:true });
    document.addEventListener('touchcancel', touchesGone, { passive:true, capture:true });
    document.addEventListener('visibilitychange', function(){ if (document.hidden) release(); });
    window.addEventListener('pagehide', release);
    window.addEventListener('blur', release);
  }

  /* belt and braces: a selection that still lands on the HUD or the
     touch controls is cleared at once */
  document.addEventListener('selectionchange', function(){
    var sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed || !sel.anchorNode) return;
    var n = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentNode;
    if (n && n.closest && n.closest('.controls, #hud')) sel.removeAllRanges();
  });

  /* Drag across the road: when you steer yourself, that is the wheel
     (sideways from where you touched, let go and it centres); otherwise
     it turns your head, as before. */
  function steeringByHand(){
    return state.mode === 'drive' && state.world && state.world.steer === 'manual';
  }
  function initDragLook(){
    canvas.addEventListener('pointerdown', function(e){
      if (state.screen !== 'play') return;
      /* a finger on the road is the steering wheel; a mouse, which has
         A / D beside it, looks round instead */
      if (steeringByHand() && e.pointerType !== 'mouse'){
        state.wheel = { id:e.pointerId, x:e.clientX };
        input.steerAbs = 0;
        try { canvas.setPointerCapture(e.pointerId); } catch(err){}
        return;
      }
      if (state.view !== 'pov') return;
      state.drag = { id:e.pointerId, x:e.clientX, yaw:state.yawTarget };
      try { canvas.setPointerCapture(e.pointerId); } catch(err){}
    });
    canvas.addEventListener('pointermove', function(e){
      if (state.wheel && e.pointerId === state.wheel.id){
        input.steerAbs = Geo.clamp((e.clientX - state.wheel.x) / Math.max(120, W*0.28), -1, 1);
        return;
      }
      if (!state.drag || e.pointerId !== state.drag.id) return;
      var dx = e.clientX - state.drag.x;
      state.yawTarget = Geo.clamp(state.drag.yaw - dx/Math.max(160, W*0.42), -MAX_YAW, MAX_YAW);
    });
    function release(e){
      if (state.wheel && (!e || e.pointerId === state.wheel.id)){ state.wheel = null; input.steerAbs = null; return; }
      if (!state.drag || (e && e.pointerId !== state.drag.id)) return;
      state.drag = null;
      state.yawTarget = 0;
    }
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('lostpointercapture', release);
  }

  /* ---------------- navigation ---------------- */
  function toMenu(){
    state.screen = 'menu';
    state.world = null;
    show('screen-play', false);
    show('screen-menu', true);
    show('overlay-ref', false);
    buildMenu();
  }

  function init(){
    I18N.set(load(LANG, 'en'));
    state.view = load(VIEW, 'pov') === 'top' ? 'top' : 'pov';
    applyTheme(load(THEME, null));
    applyLang();
    applyView();

    hold('pedal-gas',   function(){ input.throttle = true; },  function(){ input.throttle = false; });
    hold('pedal-brake', function(){ input.brake = true; },     function(){ input.brake = false; });
    hold('look-l',      function(){ look.left = true; },       function(){ look.left = false; });
    hold('look-r',      function(){ look.right = true; },      function(){ look.right = false; });
    hold('look-m',      function(){ look.mirror = true; },     function(){ look.mirror = false; });
    initDragLook();

    el('btn-start').onclick = beginDriving;
    el('btn-retry').onclick = function(){ startScenario(state.scIndex); };
    el('btn-next').onclick  = function(){ startScenario(Math.min(SCENARIOS.length-1, state.scIndex+1)); };
    el('btn-list').onclick  = toMenu;
    el('btn-menu').onclick  = toMenu;
    el('btn-quit').onclick  = toMenu;
    el('btn-drive').onclick = function(){ startDrive('frankfurt'); };
    el('btn-drive-random').onclick = function(){ startDrive('random'); };
    el('btn-exam').onclick = function(){ startDrive('exam'); };
    el('btn-fault-continue').onclick = resumeDrive;
    el('btn-fault-rewind').onclick = rewindDrive;
    el('btn-end-drive').onclick = endDrive;
    el('btn-end-hud').onclick = endDrive;
    el('btn-menu-hud').onclick = toMenu;
    el('btn-view').onclick  = toggleView;
    el('btn-ref').onclick   = function(){ buildReference(); show('overlay-ref', true); };
    el('btn-ref-close').onclick = function(){ show('overlay-ref', false); };
    el('btn-hints').onclick = function(){ setHints(!state.hints); };
    state.steer = load(STEER, 'manual') === 'auto' ? 'auto' : 'manual';
    applySteerLabel();
    el('btn-steer').onclick = toggleSteer;
    /* phones and small screens start on fast */
    var small = Math.min(window.innerWidth, window.innerHeight) < 600 || /Mobi|Android/i.test(navigator.userAgent);
    setGfx(load(GFX, small ? 'fast' : 'high') === 'fast' ? 'fast' : 'high');
    el('btn-gfx').onclick = function(){ setGfx(state.gfx === 'high' ? 'fast' : 'high'); };
    setSound(load(SOUND, true) !== false);
    el('btn-sound').onclick = function(){ setSound(!state.sound); };
    setWeather(load(WEATHER, 'clear'));
    el('btn-weather').onclick = function(){ setWeather(WEATHERS[(WEATHERS.indexOf(state.weather) + 1) % WEATHERS.length]); };
    /* browsers only allow sound after the first key or tap */
    ['keydown', 'pointerdown'].forEach(function(ev){
      window.addEventListener(ev, function(){ if (typeof Sound !== 'undefined') Sound.unlock(); }, true);
    });
    el('ind-l').onclick = function(){ setIndicator('left'); };
    el('ind-r').onclick = function(){ setIndicator('right'); };
    el('btn-lang').onclick = function(){
      save(LANG, I18N.toggle());
      applyLang();
    };
    el('btn-theme').onclick = function(){
      var choice = isDark() ? 'light' : 'dark';
      save(THEME, choice);
      applyTheme(choice);
    };
    el('btn-reset').onclick = function(){
      if (confirm(I18N.t('menu.confirmReset'))){
        progress = {}; save(STORE, progress); buildMenu();
      }
    };

    if (window.matchMedia){
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function(){ if (!load(THEME, null)) applyTheme(null); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', function(){ setTimeout(resize, 250); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

    resize();
    requestAnimationFrame(tick);
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else init();
})();
