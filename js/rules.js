'use strict';
/* ------------------------------------------------------------------
   rules.js - the StVO priority engine + the fault catalogue.
   This is the "Fahrlehrer" brain of the game. Every piece of text is
   bilingual: {de, en}. The UI picks a language, the engine never does.
   ------------------------------------------------------------------ */

var Rules = (function(){

  /* Rank of a road arm. Higher rank = has priority.
       4  Vorfahrtstrasse / priority road (Z 306, Z 301)
       3  unmarked road, rechts-vor-links applies
       2  Vorfahrt gewaehren (Z 205) or Stop (Z 206)   -> must give way
       1  leaving a driveway / verkehrsberuhigter Bereich / field track
     Traffic lights, when running, override all of this.              */
  var SIGN_RANK = {
    'priority' : 4,
    'none'     : 3,
    'yield'    : 2,
    'stop'     : 2,
    'exit'     : 1,
    'ring'     : 4,
    'ringentry': 2
  };

  function signOf(sc, arm){
    return (sc.layout.signs && sc.layout.signs[arm]) || 'none';
  }

  /* ---------------- traffic lights ---------------- */
  function lightFor(sc, arm, t){
    var L = sc.lights;
    if (!L) return null;
    var group = L.groups[arm];
    if (!group) return null;
    var total = 0, i;
    for (i=0;i<L.program.length;i++) total += L.program[i].dur;
    var tt = ((t + (L.t0||0)) % total + total) % total;
    for (i=0;i<L.program.length;i++){
      if (tt < L.program[i].dur) return L.program[i][group] || 'red';
      tt -= L.program[i].dur;
    }
    return 'red';
  }
  function lightRank(state){
    if (state === 'green' || state === 'yellow') return 4;
    return 0;
  }
  function hasGreenArrow(sc, arm){
    return !!(sc.gruenpfeil && sc.gruenpfeil.indexOf(arm) >= 0);
  }

  /* ---------------- effective rank of one vehicle ---------------- */
  function rankOf(sc, veh, t){
    if (veh.ranked !== undefined) return veh.ranked;
    /* in a roundabout, priority depends on whether you are already
       circulating, not on which arm you came from */
    if (sc.layout.type === 'roundabout')
      return (veh.s >= veh.junctionS) ? SIGN_RANK.ring : SIGN_RANK.ringentry;
    var ls = lightFor(sc, veh.fromArm, t);
    if (ls !== null) return lightRank(ls);
    var s = veh.signOverride || signOf(sc, veh.fromArm);
    return SIGN_RANK[s] !== undefined ? SIGN_RANK[s] : 3;
  }

  /* ------------------------------------------------------------------
     Who has to give way?  Called only for pairs whose paths conflict.
       'a' / 'b'    -> that one has priority
       'coordinate' -> neither yields, just keep clear
       'follow'     -> same approach arm, a queue
     ------------------------------------------------------------------ */
  function priority(sc, a, b, t){
    if (a.fromArm === b.fromArm)
      return { who:'follow', reason:'same_arm' };

    var ra = rankOf(sc, a, t), rb = rankOf(sc, b, t);

    if (sc.railPriority && ra === rb){
      if (a.kind === 'tram' && b.kind !== 'tram') return { who:'a', reason:'schiene' };
      if (b.kind === 'tram' && a.kind !== 'tram') return { who:'b', reason:'schiene' };
    }
    if (a.kind === 'bus' && a.pullingOut) return { who:'a', reason:'bus' };
    if (b.kind === 'bus' && b.pullingOut) return { who:'b', reason:'bus' };
    if (a.emergency) return { who:'a', reason:'einsatz' };
    if (b.emergency) return { who:'b', reason:'einsatz' };

    if (ra !== rb){
      var lit = sc.lights && lightFor(sc, a.fromArm, t) !== null;
      return { who: ra > rb ? 'a' : 'b', reason: lit ? 'ampel' : 'schild' };
    }

    /* --- equal rank --- */
    if (sc.layout.type === 'roundabout')
      return { who:'coordinate', reason:'kreisel' };

    var ta = Geo.turnOf(a.fromArm, a.toArm);
    var tb = Geo.turnOf(b.fromArm, b.toArm);

    /* oncoming: the one turning left gives way */
    if (b.fromArm === Geo.opposite(a.fromArm)){
      if (ta === 'left' && tb === 'left') return { who:'coordinate', reason:'voreinander' };
      if (ta === 'left')  return { who:'b', reason:'linksabbieger' };
      if (tb === 'left')  return { who:'a', reason:'linksabbieger' };
      return { who:'coordinate', reason:'kein_konflikt' };
    }

    /* otherwise: rechts vor links */
    if (b.fromArm === Geo.rightOf(a.fromArm)) return { who:'b', reason:'rvl' };
    if (a.fromArm === Geo.rightOf(b.fromArm)) return { who:'a', reason:'rvl' };

    return { who:'coordinate', reason:'unklar' };
  }

  /* ------------------------------------------------------------------
     Why the decision went that way, in both languages.
     ------------------------------------------------------------------ */
  var REASON_TEXT = {
    rvl: {
      title:{ de:'Rechts vor links', en:'Right before left' },
      text:{
        de:'An einer Kreuzung ohne Schilder und ohne Ampel hat Vorfahrt, wer von rechts kommt.',
        en:'At a junction with no signs and no lights, whoever comes from the right goes first (§ 8 (1) StVO).' }
    },
    schild: {
      title:{ de:'Beschilderte Vorfahrt', en:'Priority by sign' },
      text:{
        de:'Die Verkehrszeichen regeln hier die Vorfahrt – rechts vor links gilt dann nicht mehr.',
        en:'Signs settle priority here, so rechts vor links no longer applies. Give way and stop always lose against a priority road.' }
    },
    ampel: {
      title:{ de:'Lichtzeichen', en:'Traffic lights' },
      text:{
        de:'Ampeln gehen den Verkehrszeichen und rechts vor links vor.',
        en:'Traffic lights override every sign and rechts vor links (§ 37 StVO).' }
    },
    linksabbieger: {
      title:{ de:'Linksabbieger warten', en:'Left-turners wait' },
      text:{
        de:'Wer links abbiegt, muss entgegenkommende Fahrzeuge durchfahren lassen – auch auf der Vorfahrtstrasse.',
        en:'Turning left you must let oncoming traffic through, even when you are on the priority road (§ 9 (3) StVO).' }
    },
    voreinander: {
      title:{ de:'Voreinander abbiegen', en:'Turning in front of each other' },
      text:{
        de:'Zwei Linksabbieger, die sich entgegenkommen, fahren voreinander ab – beide tasten sich vor.',
        en:'Two opposing left-turners pass in front of each other rather than around (§ 9 (4) StVO).' }
    },
    kreisel: {
      title:{ de:'Im Kreisverkehr', en:'Inside the roundabout' },
      text:{
        de:'Im Kreisel gibt es kein rechts vor links – wer drin ist, fährt weiter, wer rein will, wartet.',
        en:'There is no rechts vor links inside a roundabout: circulating traffic keeps going, joining traffic waits.' }
    },
    schiene: {
      title:{ de:'Schienenfahrzeug', en:'Rail vehicle' },
      text:{
        de:'Schienenfahrzeuge haben an ungeregelten Kreuzungen Vorrang – auch wenn sie von links kommen.',
        en:'Trams go first at junctions without signs or lights, even coming from your left (§ 8 (1) StVO).' }
    },
    bus: {
      title:{ de:'Linienbus fährt ab', en:'Bus leaving its stop' },
      text:{
        de:'Blinkt ein Bus an der Haltestelle zum Abfahren, musst du ihm das Einfahren ermöglichen – notfalls warten.',
        en:'A bus indicating to leave its stop must be let out; brake if you have to (§ 20 (5) StVO).' }
    },
    einsatz: {
      title:{ de:'Einsatzfahrzeug', en:'Emergency vehicle' },
      text:{
        de:'Blaulicht und Martinshorn heisst: sofort freie Bahn schaffen.',
        en:'Blue light plus siren means make way immediately (§ 38 (1) StVO).' }
    },
    same_arm: {
      title:{ de:'Vordermann', en:'The car ahead' },
      text:{ de:'Abstand halten.', en:'Keep your distance.' }
    },
    kein_konflikt: { title:{ de:'Kein Konflikt', en:'No conflict' }, text:{ de:'', en:'' } },
    unklar: {
      title:{ de:'Vorsicht', en:'Caution' },
      text:{ de:'Im Zweifel: Vorsicht und Verständigung.', en:'When in doubt, proceed carefully.' }
    }
  };

  /* ------------------------------------------------------------------
     Fault catalogue - what the examiner can write down.
     ------------------------------------------------------------------ */
  var FAULTS = {
    vorfahrt: {
      pts:35, sev:'major', law:'§ 8 StVO',
      title:{ de:'Vorfahrt missachtet', en:'Failed to give way' },
      why:{
        de:'Du bist in die Kreuzung eingefahren, obwohl ein bevorrechtigtes Fahrzeug so nahe war, dass es bremsen musste. Vorfahrt gewähren heisst: der andere darf nicht wesentlich behindert werden.',
        en:'You entered the junction while a vehicle with priority was close enough that it had to brake. Giving way means the other driver must not be held up at all.' },
      tip:{
        de:'Frühzeitig vom Gas, bis zur Sichtlinie heranrollen, schauen – und nur einfahren, wenn du sicher durch bist.',
        en:'Come off the gas early, roll up to the line, look – and only pull out when you are certain you will clear it.' }
    },
    rotlicht: {
      pts:40, sev:'major', law:'§ 37 StVO',
      title:{ de:'Rote Ampel überfahren', en:'Ran a red light' },
      why:{
        de:'Du hast die Haltelinie bei Rot überfahren. Rot bedeutet: vor der Kreuzung warten.',
        en:'You crossed the stop line on red. Red means wait before the junction.' },
      tip:{
        de:'Bei Gelb gilt: anhalten, wenn das ohne starkes Bremsen möglich ist.',
        en:'On amber the rule is: stop, if you can do so without braking hard.' }
    },
    stop_kein_halt: {
      pts:30, sev:'major', law:'Zeichen 206',
      title:{ de:'Am Stoppschild nicht angehalten', en:'Did not stop at the STOP sign' },
      why:{
        de:'Das Stoppschild verlangt IMMER einen vollständigen Halt an der Haltelinie – auch wenn die Strasse frei ist.',
        en:'A STOP sign always requires a complete standstill at the line, even when the road is empty.' },
      tip:{
        de:'Die Räder müssen wirklich stehen. Erst halten, dann vortasten, dann fahren.',
        en:'The wheels must genuinely stop. Halt first, then edge forward, then go.' }
    },
    gruenpfeil_kein_halt: {
      pts:30, sev:'major', law:'Zeichen 720',
      title:{ de:'Grünpfeil ohne Halt benutzt', en:'Used the green arrow without stopping' },
      why:{
        de:'Der Grünpfeil erlaubt das Rechtsabbiegen bei Rot – aber nur nach vollständigem Halt an der Haltelinie und nur, wenn niemand behindert wird.',
        en:'The green arrow permits a right turn on red, but only after a full stop at the line and only if nobody is obstructed.' },
      tip:{
        de:'Erst stehen, dann schauen, dann abbiegen.',
        en:'Stop first, then look, then turn.' }
    },
    fussgaenger: {
      pts:40, sev:'major', law:'§ 26 StVO',
      title:{ de:'Fussgänger am Zebrastreifen nicht vorgelassen', en:'Did not let a pedestrian cross' },
      why:{
        de:'Am Fussgängerüberweg haben Fussgänger, die erkennbar hinüber wollen, Vorrang. Du musst ihnen das Überqueren ermöglichen – notfalls anhalten.',
        en:'At a zebra crossing, pedestrians who clearly intend to cross have priority. You must enable them to cross, stopping if necessary.' },
      tip:{
        de:'Mit mässiger Geschwindigkeit annähern und bremsbereit sein. Am Überweg gilt zusätzlich Ueberholverbot.',
        en:'Approach at a moderate speed with the brake covered. Overtaking is also banned at a crossing.' }
    },
    abbiegen_fussgaenger: {
      pts:40, sev:'major', law:'§ 9 (3) StVO',
      title:{ de:'Beim Abbiegen Fussgänger missachtet', en:'Ignored pedestrians while turning' },
      why:{
        de:'Wer abbiegt, muss auf Fussgänger, die die Strasse überqueren, in die er einbiegt, besondere Rücksicht nehmen – sie haben Vorrang.',
        en:'When you turn, pedestrians crossing the road you are turning into have priority over you.' },
      tip:{
        de:'Beim Abbiegen langsam machen und in die Seitenstrasse schauen, bevor du einbiegst.',
        en:'Slow right down as you turn and look into the side road before you commit.' }
    },
    blinker: {
      pts:10, sev:'minor', law:'§ 9 (1) StVO',
      title:{ de:'Blinker nicht oder zu spät gesetzt', en:'Missing indicator' },
      why:{
        de:'Jede Richtungsänderung ist rechtzeitig und deutlich anzukündigen.',
        en:'Every change of direction must be signalled clearly and in good time.' },
      tip:{
        de:'Blinken, bevor du bremst und dich einordnest – nicht erst im Abbiegen.',
        en:'Indicate before you brake and move over, not once you are already turning.' }
    },
    blinker_kreisel: {
      pts:10, sev:'minor', law:'§ 8 (1a) StVO',
      title:{ de:'Falsch geblinkt am Kreisverkehr', en:'Wrong indicator at the roundabout' },
      why:{
        de:'Beim EINfahren in den Kreisverkehr wird nicht geblinkt. Beim AUSfahren blinkst du rechts.',
        en:'You do not indicate when entering a roundabout. You indicate right when leaving it.' },
      tip:{
        de:'Merksatz: rein ohne Blinker, raus mit rechts.',
        en:'Remember: no indicator going in, right indicator coming out.' }
    },
    zu_schnell: {
      pts:15, sev:'minor', law:'§ 3 StVO',
      title:{ de:'Geschwindigkeit überschritten', en:'Exceeded the speed limit' },
      why:{
        de:'Du warst schneller als erlaubt. Innerorts sind ohne Schild 50 km/h zulässig, in einer Zone 30 nur 30 km/h.',
        en:'You went faster than permitted. In town the default is 50 km/h, and only 30 inside a Zone 30.' },
      tip:{
        de:'Vor Kreuzungen ohnehin runter mit dem Tempo – du musst rechtzeitig anhalten können.',
        en:'Slow down before junctions anyway: you have to be able to stop in time.' }
    },
    kurve_zu_schnell: {
      pts:10, sev:'minor', law:'§ 3 (1) StVO',
      title:{ de:'Zu schnell abgebogen', en:'Turned too fast' },
      why:{
        de:'Vor dem Abbiegen wird abgebremst, im Abbiegen wird beschleunigt. Du bist mit deutlich zu viel Tempo in die Kurve gefahren.',
        en:'Brake before the turn and accelerate through it. You went into the bend far too fast.' },
      tip:{
        de:'Der Ablauf: blinken – bremsen – einordnen – schauen – abbiegen.',
        en:'The sequence is: indicate, brake, position, look, turn.' }
    },
    schritt: {
      pts:20, sev:'minor', law:'§ 42 / § 20 StVO',
      title:{ de:'Schrittgeschwindigkeit nicht eingehalten', en:'Did not drive at walking pace' },
      why:{
        de:'Hier ist Schrittgeschwindigkeit vorgeschrieben – das sind etwa 4 bis 7 km/h.',
        en:'Walking pace is required here, which means roughly 4 to 7 km/h.' },
      tip:{
        de:'Im verkehrsberuhigten Bereich und an einem Bus mit Warnblinklicht: Schritttempo.',
        en:'In a home zone, and passing a bus with hazard lights on: walking pace.' }
    },
    kollision: {
      pts:60, sev:'major', law:'',
      title:{ de:'Zusammenstoss', en:'Collision' },
      why:{
        de:'Ein Unfall – in der Prüfung ein sofortiges Nicht-Bestehen.',
        en:'A crash. In the real test this is an instant fail.' },
      tip:{
        de:'Lieber einmal zu früh vom Gas als einmal zu spät auf die Bremse.',
        en:'Better off the gas a moment too early than on the brake a moment too late.' }
    },
    ped_kollision: {
      pts:100, sev:'major', law:'',
      title:{ de:'Fussgänger angefahren', en:'Hit a pedestrian' },
      why:{
        de:'Schwerster denkbarer Fehler.',
        en:'The most serious mistake there is.' },
      tip:{
        de:'An Überwegen, Haltestellen und beim Abbiegen immer bremsbereit sein.',
        en:'At crossings, at bus stops and whenever you turn, keep the brake covered.' }
    },
    haltelinie: {
      pts:10, sev:'minor', law:'Zeichen 294',
      title:{ de:'Über der Haltelinie gehalten', en:'Stopped past the line' },
      why:{
        de:'Angehalten wird VOR der Haltelinie, nicht darauf oder dahinter.',
        en:'You stop before the line, not on it and not beyond it.' },
      tip:{
        de:'Die Haltelinie ist auch deine Sichtlinie – dahinter stehst du schon im Kreuzungsbereich.',
        en:'The line is also your sight line: past it you are already in the junction.' }
    },
    kreuzung_blockiert: {
      pts:20, sev:'minor', law:'§ 11 (1) StVO',
      title:{ de:'Im Kreuzungsbereich stehen geblieben', en:'Stopped inside the junction' },
      why:{
        de:'In eine Kreuzung darf man nur einfahren, wenn man sie auch räumen kann.',
        en:'Only enter a junction if you can also clear it.' },
      tip:{
        de:'Erst schauen, ob hinter der Kreuzung Platz ist.',
        en:'Check there is room on the far side first.' }
    },
    einsatz_blockiert: {
      pts:35, sev:'major', law:'§ 38 StVO',
      title:{ de:'Einsatzfahrzeug behindert', en:'Obstructed an emergency vehicle' },
      why:{
        de:'Bei Blaulicht und Einsatzhorn ist sofort freie Bahn zu schaffen.',
        en:'Blue light and siren: make way at once.' },
      tip:{
        de:'Rechts ranfahren, notfalls anhalten – aber nicht in die Kreuzung rollen.',
        en:'Pull to the right and stop if needed, but never roll into the junction.' }
    },
    bus_behindert: {
      pts:20, sev:'minor', law:'§ 20 (5) StVO',
      title:{ de:'Linienbus nicht abfahren lassen', en:'Did not let the bus pull out' },
      why:{
        de:'Blinkt ein Bus an der Haltestelle links, hat er Vorrang beim Abfahren.',
        en:'A bus indicating left at a stop has priority when pulling out.' },
      tip:{
        de:'Notfalls anhalten und ihn rausfahren lassen.',
        en:'Stop if you have to and let it out.' }
    },
    vorfahrt_nicht_genutzt: {
      pts:0, sev:'hint', law:'§ 1 StVO',
      title:{ de:'Unnötig angehalten', en:'Stopped without reason' },
      why:{
        de:'Du hattest Vorfahrt und hast trotzdem gehalten. Das ist kein Beinahe-Unfall, aber es verunsichert die anderen und stört den Verkehrsfluss.',
        en:'You had priority and stopped anyway. Not dangerous, but it confuses other drivers and blocks the flow.' },
      tip:{
        de:'Vorfahrt heisst auch: zügig und klar fahren, wenn sie dir zusteht.',
        en:'Having priority also means using it promptly and clearly.' }
    },
    zeit: {
      pts:0, sev:'hint', law:'',
      title:{ de:'Zeit abgelaufen', en:'Out of time' },
      why:{
        de:'Die Situation hat sich nicht aufgelöst.',
        en:'The situation never resolved.' },
      tip:{
        de:'Wenn die Kreuzung frei ist, darfst du fahren.',
        en:'Once the junction is clear, you may go.' }
    }
  };

  return {
    SIGN_RANK: SIGN_RANK, FAULTS: FAULTS, REASON_TEXT: REASON_TEXT,
    signOf: signOf, lightFor: lightFor, rankOf: rankOf,
    hasGreenArrow: hasGreenArrow, priority: priority
  };
})();
