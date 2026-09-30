'use strict';
/* ------------------------------------------------------------------
   i18n.js - interface language. English is the default; German stays
   visible as the second line, because the German terms are the ones
   written on the signs and used by your Fahrlehrer.
   ------------------------------------------------------------------ */

var I18N = (function(){

  var lang = 'en';

  /* a bilingual value is either {de,en} or the legacy pair [de,en] */
  function pick(p){
    if (!p) return '';
    if (typeof p === 'string') return p;
    if (Object.prototype.toString.call(p) === '[object Array]')
      return lang === 'de' ? p[0] : p[1];
    return p[lang] || p.en || p.de || '';
  }
  /* the same value in the other language, shown as the secondary line */
  function other(p){
    if (!p) return '';
    if (typeof p === 'string') return '';
    if (Object.prototype.toString.call(p) === '[object Array]')
      return lang === 'de' ? p[1] : p[0];
    return lang === 'de' ? (p.en || '') : (p.de || '');
  }

  var UI = {
    en: {
      'nav.lessons':'Lessons', 'nav.sheet':'Cheat sheet',
      'theme.night':'Night', 'theme.day':'Day',
      'lang.next':'Deutsch',

      'menu.h1':'German junctions,<br>until they <em>click</em>.',
      'menu.lead':'You drive, the game watches. After every run it names the mistake, ' +
                  'quotes the rule and explains why it reads that way.' +
                  '<span class="lead-en">Die deutschen Begriffe stehen jeweils darunter &ndash; ' +
                  'genau die brauchst du in der Fahrstunde.</span>',
      'menu.passed':'{a} / {b} passed',
      'menu.reset':'Reset progress',
      'menu.confirmReset':'Really delete your progress?',

      'card.level':'Level', 'card.points':'points', 'card.new':'not driven yet',

      'hud.time':'Time', 'hud.faults':'Faults', 'hud.limitTitle':'Speed limit',
      'hud.cleared':'Cleared',

      'brief.remember':'Remember:',
      'brief.start':'Drive', 'brief.startKey':'Space',
      'keys.throttle':'Throttle', 'keys.brake':'Brake', 'keys.indicators':'Indicators',
      'keys.hints':'Hints', 'keys.restart':'Restart',

      'side.lesson':'Lesson', 'side.signs':'Signs here', 'side.controls':'Controls',
      'side.note':'The car steers itself. You decide the speed, the indicators and, ' +
                  'above all, who goes first.',
      'side.hints':'Hints', 'side.quit':'Quit',
      'ctrl.throttle':'Accelerate', 'ctrl.brake':'Brake',
      'ctrl.indicators':'Indicate left / right', 'ctrl.indoff':'Indicators off',
      'ctrl.restart':'Restart lesson', 'ctrl.hints':'Instructor hints on / off',
      'ctrl.look':'Look left / right', 'ctrl.view':'Driver view / map view',
      'pedal.gas':'GAS', 'pedal.brake':'BRAKE',
      'look.label':'LOOK', 'view.toTop':'MAP', 'view.toPov':'DRIVER',
      'keys.look':'Look', 'keys.view':'View',
      'brief.drag':'Drag the road, or hold the LOOK buttons, to check left and right.',
      'ind.left':'Indicate left', 'ind.right':'Indicate right',

      'res.points':'Points', 'res.passed':'Passed', 'res.failed':'Not passed',
      'res.subClean':'Faultless. Exactly like that.',
      'res.subMinor':'Safely driven. A few details could still be sharper.',
      'res.subFail':'Here is what the examiner wrote down:',
      'res.noFaults':'No faults',
      'res.noFaultsWhy':'Priority read correctly, speed suited to the situation, indicators set.',
      'res.tip':'Tip: ', 'res.about':'What this is about',
      'res.again':'Again', 'res.againKey':'R',
      'res.next':'Next lesson', 'res.nextKey':'Enter', 'res.list':'Lesson list',

      'ref.title':'Cheat sheet – right of way in short',
      'ref.close':'Close',
      'ref.orderTitle':'The order you check things in',
      'ref.s1':'Police officer or traffic light? Those beat everything else.',
      'ref.s2':'Any signs? Signs beat rechts vor links.',
      'ref.s3':'Neither? Then rechts vor links applies.',
      'ref.s4':'Always on top: left-turners wait for oncoming traffic, anyone turning ' +
               'waits for pedestrians, and rail vehicles go first.',

      'drive.cta.title':'Ready for the real thing?',
      'drive.cta.sub':'Drive the streets around Weißer Stein in Frankfurt-Eschersheim: traffic lights, ' +
                      'the U-Bahn beside the main road, Tempo-30 side streets with rechts vor links. Get it wrong, rewind, try again.',
      'drive.cta.button':'Drive Frankfurt',
      'drive.cta.random':'Random town',
      'drive.fault.stopped':'Hold on a moment',
      'drive.fault.sub':'Here is what just went wrong:',
      'drive.fault.continue':'Drive on (keep the mistake)',
      'drive.fault.continueKey':'C',
      'drive.fault.rewind':'Rewind & try again',
      'drive.fault.rewindKey':'Space',
      'drive.hold':'Rewound {s} s. Press GAS (W) to try again — {tip}',
      'drive.hold.retrying':'Retrying: {what}',
      'drive.end':'End drive', 'drive.endShort':'End',
      'mirror.label':'MIRROR', 'ctrl.mirror':'Check the mirror',
      'ctrl.steer':'Steer (free drive & test; or drag the road)', 'ctrl.steerMode':'You steer / car steers',
      'steer.manual':'Steering: you', 'steer.auto':'Steering: car',
      'exam.button':'Take the test',
      'exam.timeLeft':'Left',
      'exam.passed':'Passed', 'exam.failed':'Not passed',
      'exam.sub.pass':'Clean enough to hand you your licence. {n} small fault(s).',
      'exam.sub.major':'The examiner ended the test here:',
      'exam.sub.many':'Too many small faults ({n}) – it adds up to unsafe driving.',
      'exam.sub.repeated':'The same fault again and again shows it was not a slip.',
      'exam.sub.ended':'You ended the test before the time was up.',
      'exam.checklist':'The examiner\'s five areas',
      'exam.ok':'no faults',
      'exam.stopped':'Please pull over. I am afraid the test ends here.',
      'drive.result.title':'Drive ended',
      'drive.result.sub':'{a} junctions driven cleanly.',
      'drive.result.explained':'Mistakes still on your sheet:',
      'drive.result.fixed':'Practised with a rewind ({n}) — not counted against you:',
      'drive.result.retry':'New town', 'drive.result.list':'Back to menu'
    },

    de: {
      'nav.lessons':'Lektionen', 'nav.sheet':'Merkblatt',
      'theme.night':'Nacht', 'theme.day':'Tag',
      'lang.next':'English',

      'menu.h1':'Deutsche Kreuzungen,<br>bis sie <em>sitzen</em>.',
      'menu.lead':'Du fährst, das Spiel schaut zu. Nach jeder Runde sagt es dir genau, ' +
                  'was du falsch gemacht hast &ndash; und warum die Regel so lautet.' +
                  '<span class="lead-en">Every explanation is repeated in English underneath.</span>',
      'menu.passed':'{a} / {b} bestanden',
      'menu.reset':'Fortschritt löschen',
      'menu.confirmReset':'Fortschritt wirklich löschen?',

      'card.level':'Stufe', 'card.points':'Punkte', 'card.new':'noch nicht gefahren',

      'hud.time':'Zeit', 'hud.faults':'Fehler', 'hud.limitTitle':'Erlaubte Höchstgeschwindigkeit',
      'hud.cleared':'Geschafft',

      'brief.remember':'Merksatz:',
      'brief.start':'Losfahren', 'brief.startKey':'Leertaste',
      'keys.throttle':'Gas', 'keys.brake':'Bremse', 'keys.indicators':'Blinker',
      'keys.hints':'Hinweise', 'keys.restart':'Neustart',

      'side.lesson':'Lektion', 'side.signs':'Beschilderung', 'side.controls':'Steuerung',
      'side.note':'Lenken übernimmt das Auto. Du entscheidest über Tempo, ' +
                  'Blinker und vor allem: wer zuerst fährt.',
      'side.hints':'Hinweise', 'side.quit':'Abbrechen',
      'ctrl.throttle':'Gas geben', 'ctrl.brake':'Bremsen',
      'ctrl.indicators':'Blinker links / rechts', 'ctrl.indoff':'Blinker aus',
      'ctrl.restart':'Neu starten', 'ctrl.hints':'Hinweise an / aus',
      'ctrl.look':'Nach links / rechts schauen', 'ctrl.view':'Fahrersicht / Kartensicht',
      'pedal.gas':'GAS', 'pedal.brake':'BREMSE',
      'look.label':'BLICK', 'view.toTop':'KARTE', 'view.toPov':'FAHRER',
      'keys.look':'Blick', 'keys.view':'Ansicht',
      'brief.drag':'Zieh die Strasse zur Seite oder halte die BLICK-Tasten, um nach links und rechts zu schauen.',
      'ind.left':'Blinker links', 'ind.right':'Blinker rechts',

      'res.points':'Punkte', 'res.passed':'Bestanden', 'res.failed':'Nicht bestanden',
      'res.subClean':'Fehlerfrei. Genau so.',
      'res.subMinor':'Sicher gefahren. Ein paar Kleinigkeiten gehen noch besser.',
      'res.subFail':'Das hier hat der Prüfer notiert:',
      'res.noFaults':'Keine Fehler',
      'res.noFaultsWhy':'Vorfahrt richtig erkannt, Tempo angepasst, Blinker gesetzt.',
      'res.tip':'Tipp: ', 'res.about':'Darum geht es',
      'res.again':'Nochmal', 'res.againKey':'R',
      'res.next':'Nächste Lektion', 'res.nextKey':'Enter', 'res.list':'Lektionsliste',

      'ref.title':'Merkblatt – Vorfahrt in Kurzform',
      'ref.close':'Schliessen',
      'ref.orderTitle':'Die Reihenfolge, in der du prüfst',
      'ref.s1':'Polizei oder Ampel? Die gehen allem vor.',
      'ref.s2':'Verkehrszeichen? Die gehen rechts vor links vor.',
      'ref.s3':'Nichts davon? Dann gilt rechts vor links.',
      'ref.s4':'Immer zusätzlich: Linksabbieger warten auf Gegenverkehr, Abbieger ' +
               'warten auf Fussgänger, Schienenfahrzeuge haben Vorrang.',

      'drive.cta.title':'Bereit für den Ernstfall?',
      'drive.cta.sub':'Fahr durch die Straßen rund um den Weißen Stein in Frankfurt-Eschersheim: Ampeln, ' +
                       'die U-Bahn neben der Hauptstraße, Tempo-30-Straßen mit rechts vor links. Fehler gemacht? Zurückspulen, nochmal.',
      'drive.cta.button':'Frankfurt fahren',
      'drive.cta.random':'Zufällige Stadt',
      'drive.fault.stopped':'Einen Moment bitte',
      'drive.fault.sub':'Das ist gerade schiefgelaufen:',
      'drive.fault.continue':'Weiterfahren (Fehler zählt)',
      'drive.fault.continueKey':'C',
      'drive.fault.rewind':'Zurückspulen & nochmal',
      'drive.fault.rewindKey':'Leertaste',
      'drive.hold':'{s} s zurückgespult. GAS (W) drücken und nochmal versuchen — {tip}',
      'drive.hold.retrying':'Neuer Versuch: {what}',
      'drive.end':'Fahrt beenden', 'drive.endShort':'Ende',
      'mirror.label':'SPIEGEL', 'ctrl.mirror':'In den Spiegel schauen',
      'ctrl.steer':'Lenken (freie Fahrt & Prüfung; oder Strasse ziehen)', 'ctrl.steerMode':'Selbst lenken / Auto lenkt',
      'steer.manual':'Lenken: du', 'steer.auto':'Lenken: Auto',
      'exam.button':'Prüfung fahren',
      'exam.timeLeft':'Rest',
      'exam.passed':'Bestanden', 'exam.failed':'Nicht bestanden',
      'exam.sub.pass':'Sauber genug für den Führerschein. {n} kleine(r) Fehler.',
      'exam.sub.major':'Der Prüfer hat die Prüfung hier beendet:',
      'exam.sub.many':'Zu viele kleine Fehler ({n}) – zusammen ist das unsicheres Fahren.',
      'exam.sub.repeated':'Derselbe Fehler immer wieder zeigt: das war kein Ausrutscher.',
      'exam.sub.ended':'Du hast die Prüfung vor Ablauf der Zeit beendet.',
      'exam.checklist':'Die fünf Bereiche des Prüfers',
      'exam.ok':'fehlerfrei',
      'exam.stopped':'Bitte fahren Sie rechts ran. Die Prüfung ist leider beendet.',
      'drive.result.title':'Fahrt beendet',
      'drive.result.sub':'{a} Kreuzungen fehlerfrei gemeistert.',
      'drive.result.explained':'Diese Fehler stehen noch auf deinem Bogen:',
      'drive.result.fixed':'Mit Zurückspulen geübt ({n}) – zählt nicht gegen dich:',
      'drive.result.retry':'Neue Stadt', 'drive.result.list':'Zurück zum Menü'
    }
  };

  /* lesson groups, keyed by the German name used in scenarios.js */
  var GROUPS = {
    'Vorfahrt':     { de:'Vorfahrt',      en:'Right of way' },
    'Schilder':     { de:'Schilder',      en:'Signs' },
    'Abbiegen':     { de:'Abbiegen',      en:'Turning' },
    'Fussgaenger':  { de:'Fussgänger', en:'Pedestrians' },
    'Ampel':        { de:'Ampel',         en:'Traffic lights' },
    'Kreisverkehr': { de:'Kreisverkehr',  en:'Roundabouts' },
    'Besondere':    { de:'Besondere Fälle', en:'Special cases' },
    'Tempo':        { de:'Tempo',         en:'Speed' }
  };

  function t(key, vars){
    var s = (UI[lang] && UI[lang][key]) || UI.en[key] || key;
    if (vars) for (var k in vars) s = s.split('{'+k+'}').join(vars[k]);
    return s;
  }
  function group(name){ return pick(GROUPS[name] || { de:name, en:name }); }

  return {
    t:t, pick:pick, other:other, group:group,
    get:function(){ return lang; },
    set:function(l){ lang = (l === 'de') ? 'de' : 'en'; },
    toggle:function(){ lang = lang === 'en' ? 'de' : 'en'; return lang; }
  };
})();
