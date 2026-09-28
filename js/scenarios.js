'use strict';
/* ------------------------------------------------------------------
   scenarios.js - the lessons.
   arriveRel: seconds before (-) / after (+) the player that this
   vehicle reaches the point where the two paths conflict.
   The engine solves the start position from it, so the timing of a
   lesson is exact instead of hand-tuned.
   ------------------------------------------------------------------ */

var SCENARIOS = (function(){

  /* default start: about 4.4 s of approach at 40 km/h */
  function start(speed, secs){ return CFG.BOX + (secs||4.4)*kmh(speed||40); }

  var LIGHTS_NS = {
    groups:{ N:'A', S:'A', E:'B', W:'B' },
    program:[
      { A:'red',       B:'green',     dur:8   },
      { A:'red',       B:'yellow',    dur:3   },
      { A:'redyellow', B:'red',       dur:1.5 },
      { A:'green',     B:'red',       dur:9   },
      { A:'yellow',    B:'red',       dur:3   },
      { A:'red',       B:'redyellow', dur:1.5 }
    ]
  };

  var list = [
  /* ---------------------------------------------------------- 1 */
  {
    id:'rvl-rechts', group:'Vorfahrt', level:1,
    title:'Rechts vor links',
    en:'Right before left',
    task:'Fahre geradeaus ueber die Kreuzung.',
    taskEn:'Drive straight across the junction.',
    layout:{ type:'cross', arms:['N','E','S','W'],
             signs:{ N:'none', E:'none', S:'none', W:'none' } },
    limit:50,
    player:{ from:'S', to:'N', d0:start(40), v0:40 },
    traffic:[ { from:'E', to:'W', speed:38, arriveRel:-0.4, color:'#e0574a' } ],
    merksatz:'Keine Schilder, keine Ampel? Dann gilt: rechts vor links.',
    merksatzEn:'No signs, no lights? Then it is rechts vor links: right before left.',
    points:[
      ['An einer Kreuzung ohne Verkehrszeichen hat das Fahrzeug von rechts Vorfahrt.',
       'At a junction with no signs, the vehicle from the right has priority.'],
      ['Das gilt unabhaengig davon, wohin der andere faehrt - auch wenn er abbiegt.',
       'It applies no matter where the other car is going, including when it turns.'],
      ['Vorfahrt gewaehren heisst: der andere darf nicht bremsen muessen.',
       'Giving way means the other driver must not have to brake at all.']
    ]
  },
  /* ---------------------------------------------------------- 2 */
  {
    id:'rvl-links', group:'Vorfahrt', level:1,
    title:'Von links kommt jemand',
    en:'Someone from the left',
    task:'Fahre geradeaus. Ueberlege, wer hier Vorfahrt hat.',
    taskEn:'Drive straight on. Work out who has priority.',
    layout:{ type:'cross', arms:['N','E','S','W'],
             signs:{ N:'none', E:'none', S:'none', W:'none' } },
    limit:50,
    player:{ from:'S', to:'N', d0:start(40), v0:40 },
    traffic:[ { from:'W', to:'E', speed:38, arriveRel:-0.2, color:'#e8b93c' } ],
    merksatz:'Vorfahrt haben heisst auch: sie zuegig nutzen.',
    merksatzEn:'Having priority also means using it, promptly and clearly.',
    points:[
      ['Der andere kommt von LINKS - du hast Vorfahrt und darfst fahren.',
       'The other car comes from your LEFT, so you have priority.'],
      ['Trotzdem bremsbereit bleiben: Vorfahrt gilt nur, wenn der andere sie auch beachtet.',
       'Stay ready to brake anyway - priority only helps if the other driver respects it.'],
      ['Unnoetiges Anhalten stoert den Verkehrsfluss und verunsichert die anderen.',
       'Stopping without reason disrupts the flow and confuses other drivers.']
    ]
  },
  /* ---------------------------------------------------------- 3 */
  {
    id:'rvl-drei', group:'Vorfahrt', level:2,
    title:'Drei Fahrzeuge gleichzeitig',
    en:'Three cars at once',
    task:'Fahre geradeaus. Von beiden Seiten kommt jemand.',
    taskEn:'Drive straight. Traffic is coming from both sides.',
    layout:{ type:'cross', arms:['N','E','S','W'],
             signs:{ N:'none', E:'none', S:'none', W:'none' } },
    limit:50,
    player:{ from:'S', to:'N', d0:start(40), v0:40 },
    traffic:[
      { from:'E', to:'W', speed:36, arriveRel:-0.5, color:'#e0574a' },
      { from:'W', to:'E', speed:36, arriveRel:-0.1, color:'#e8b93c' }
    ],
    merksatz:'Erst den von rechts durchlassen, dann selbst fahren.',
    merksatzEn:'Let the one on your right through first, then go.',
    points:[
      ['Das Fahrzeug von rechts hat Vorfahrt vor dir - du musst warten.',
       'The car from the right goes before you.'],
      ['Das Fahrzeug von links muss dir Vorfahrt gewaehren - es wartet auf dich.',
       'The car from the left has to wait for you.'],
      ['Reihenfolge: rechts zuerst, dann du, dann der von links.',
       'Order: the one from the right, then you, then the one from the left.']
    ]
  },
  /* ---------------------------------------------------------- 4 */
  {
    id:'vorfahrt-gewaehren', group:'Schilder', level:2,
    title:'Vorfahrt gewaehren',
    en:'Give way sign',
    task:'Fahre geradeaus. Du kommst aus der untergeordneten Strasse.',
    taskEn:'Drive straight on. You are on the minor road.',
    layout:{ type:'cross', arms:['N','E','S','W'],
             signs:{ N:'yield', E:'priority', S:'yield', W:'priority' } },
    limit:50,
    player:{ from:'S', to:'N', d0:start(40), v0:40 },
    traffic:[ { from:'W', to:'E', speed:45, arriveRel:-0.3, color:'#54a86b' } ],
    merksatz:'Schilder schlagen rechts vor links.',
    merksatzEn:'Signs beat rechts vor links.',
    points:[
      ['Das umgedrehte Dreieck (Zeichen 205) bedeutet: Vorfahrt gewaehren.',
       'The upside-down triangle (sign 205) means: give way.'],
      ['Hier kommt der andere von LINKS - und hat trotzdem Vorfahrt, weil er auf der Vorfahrtstrasse faehrt.',
       'Here the other car comes from the LEFT and still has priority, because it is on the priority road.'],
      ['Anhalten musst du nur, wenn es noetig ist - ist die Strasse frei, darfst du rollend fahren.',
       'You only have to stop if necessary; if the road is clear you may roll on.']
    ]
  },
  /* ---------------------------------------------------------- 5 */
  {
    id:'stop', group:'Schilder', level:2,
    title:'Stoppschild',
    en:'STOP sign',
    task:'Fahre geradeaus - achte auf das Stoppschild.',
    taskEn:'Drive straight on - mind the STOP sign.',
    layout:{ type:'cross', arms:['N','E','S','W'],
             signs:{ N:'stop', E:'priority', S:'stop', W:'priority' } },
    limit:50,
    player:{ from:'S', to:'N', d0:start(40), v0:40 },
    traffic:[ { from:'E', to:'W', speed:45, arriveRel:1.6, color:'#e0574a' } ],
    merksatz:'Stop heisst stehen - immer, auch wenn alles frei ist.',
    merksatzEn:'Stop means stop – always, even when the road is empty.',
    points:[
      ['Zeichen 206 verlangt einen vollstaendigen Halt an der Haltelinie. Die Raeder muessen stehen.',
       'Sign 206 requires a complete standstill at the line. The wheels must actually stop.'],
      ['Erst halten, dann langsam vortasten, bis du die Querstrasse einsehen kannst.',
       'Stop first, then edge forward until you can see along the main road.'],
      ['Rollen statt Halten ist einer der haeufigsten Pruefungsfehler.',
       'Rolling instead of stopping is one of the most common test failures.']
    ]
  },
  /* ---------------------------------------------------------- 6 */
  {
    id:'vorfahrtstrasse', group:'Schilder', level:2,
    title:'Auf der Vorfahrtstrasse',
    en:'On the priority road',
    task:'Fahre geradeaus. Du bist auf der Vorfahrtstrasse.',
    taskEn:'Drive straight on. You are on the priority road.',
    layout:{ type:'cross', arms:['N','E','S','W'],
             signs:{ N:'priority', E:'yield', S:'priority', W:'yield' } },
    limit:50,
    player:{ from:'S', to:'N', d0:start(45), v0:45 },
    traffic:[ { from:'E', to:'W', speed:35, arriveRel:0.1, color:'#e0574a' } ],
    merksatz:'Gelbe Raute = du hast Vorfahrt. Rechts vor links gilt nicht mehr.',
    merksatzEn:'Yellow diamond = you have priority. Rechts vor links no longer applies.',
    points:[
      ['Die gelbe Raute (Zeichen 306) sagt dir: du bist auf der Vorfahrtstrasse.',
       'The yellow diamond (sign 306) tells you: you are on the priority road.'],
      ['Der Wagen von rechts hat ein Wartepflicht-Schild und muss dich durchlassen.',
       'The car on your right faces a give-way sign and must let you through.'],
      ['Trotzdem: Vertrauen ersetzt keine Bremsbereitschaft.',
       'Even so: trusting the sign is no substitute for covering the brake.']
    ]
  },
  /* ---------------------------------------------------------- 7 */
  {
    id:'links-gegenverkehr', group:'Abbiegen', level:3,
    title:'Links abbiegen mit Gegenverkehr',
    en:'Turning left against oncoming traffic',
    task:'Biege links ab. Denk an den Blinker.',
    taskEn:'Turn left. Remember your indicator.',
    layout:{ type:'cross', arms:['N','E','S','W'],
             signs:{ N:'priority', E:'yield', S:'priority', W:'yield' } },
    limit:50,
    player:{ from:'S', to:'W', d0:start(42), v0:42 },
    traffic:[ { from:'N', to:'S', speed:45, arriveRel:-0.5, color:'#54a86b' } ],
    merksatz:'Linksabbieger warten - auch auf der Vorfahrtstrasse.',
    merksatzEn:'Left-turners wait – even on the priority road.',
    points:[
      ['Wer links abbiegt, muss entgegenkommende Fahrzeuge durchfahren lassen (Paragraph 9 Absatz 3 StVO).',
       'Turning left, you must let oncoming traffic pass first.'],
      ['Die Vorfahrtstrasse hilft dir hier nicht: der Gegenverkehr faehrt auf derselben Strasse.',
       'Being on the priority road does not help here - the oncoming car is on the same road.'],
      ['Blinken, einordnen, warten - und dabei die Raeder gerade lassen.',
       'Indicate, position, wait - and keep your wheels straight while waiting.']
    ]
  },
  /* ---------------------------------------------------------- 8 */
  {
    id:'abknickend', group:'Schilder', level:3,
    title:'Abknickende Vorfahrtstrasse',
    en:'Priority road that bends',
    task:'Folge der Vorfahrtstrasse nach rechts.',
    taskEn:'Follow the priority road to the right.',
    layout:{ type:'cross', arms:['N','E','S','W'],
             signs:{ N:'yield', E:'priority', S:'priority', W:'yield' },
             bend:['S','E'] },
    limit:50,
    player:{ from:'S', to:'E', d0:start(40), v0:40 },
    traffic:[ { from:'N', to:'S', speed:35, arriveRel:0.3, color:'#e8b93c' } ],
    merksatz:'Die Vorfahrt folgt dem dicken Strich - nicht der Geradeausrichtung.',
    merksatzEn:'Priority follows the thick line on the plate, not the way you are pointing.',
    points:[
      ['Das Zusatzschild zeigt den Verlauf der Vorfahrtstrasse: sie knickt hier ab.',
       'The small plate under the sign shows how the priority road runs - it bends here.'],
      ['Du behaeltst die Vorfahrt, wenn du dem Verlauf folgst - musst aber blinken, weil du die Richtung aenderst.',
       'You keep priority when you follow the bend, but you must indicate, because you change direction.'],
      ['Das Fahrzeug aus der wartepflichtigen Strasse muss dich durchlassen.',
       'The car on the give-way arm has to let you through.']
    ]
  },
  /* ---------------------------------------------------------- 9 */
  {
    id:'zebra', group:'Fussgaenger', level:1,
    title:'Zebrastreifen',
    en:'Zebra crossing',
    task:'Fahre geradeaus ueber den Fussgaengerueberweg.',
    taskEn:'Drive straight over the pedestrian crossing.',
    layout:{ type:'cross', arms:['N','E','S','W'],
             signs:{ N:'priority', E:'yield', S:'priority', W:'yield' },
             crossings:['S'] },
    limit:50,
    player:{ from:'S', to:'N', d0:start(45), v0:45 },
    traffic:[],
    peds:[ { arm:'S', from:'right', start:'waiting' } ],
    merksatz:'Am Zebrastreifen hat der Fussgaenger Vorrang - nicht du.',
    merksatzEn:'At a zebra crossing the pedestrian goes first, not you.',
    points:[
      ['Fussgaenger, die erkennbar hinueber wollen, musst du das Ueberqueren ermoeglichen (Paragraph 26 StVO).',
       'You must enable pedestrians who clearly want to cross to do so.'],
      ['Also: Tempo raus, bremsbereit sein, notfalls anhalten - und nicht erst, wenn sie schon auf der Fahrbahn sind.',
       'So: slow down, cover the brake, stop if needed - not only once they are already on the road.'],
      ['Am Ueberweg gilt Ueberhol- und Halteverbot.',
       'Overtaking and stopping are forbidden at a zebra crossing.']
    ]
  },
  /* ---------------------------------------------------------- 10 */
  {
    id:'zebra-abbiegen', group:'Fussgaenger', level:3,
    title:'Abbiegen mit Fussgaengern',
    en:'Turning across pedestrians',
    task:'Biege rechts ab.',
    taskEn:'Turn right.',
    layout:{ type:'cross', arms:['N','E','S','W'],
             signs:{ N:'priority', E:'none', S:'priority', W:'none' },
             crossings:['E'] },
    limit:50,
    player:{ from:'S', to:'E', d0:start(42), v0:42 },
    traffic:[],
    peds:[ { arm:'E', from:'left', start:'waiting' } ],
    merksatz:'Wer abbiegt, wartet auf Fussgaenger in der Strasse, in die er einbiegt.',
    merksatzEn:'If you are turning, you wait for pedestrians in the road you turn into.',
    points:[
      ['Paragraph 9 Absatz 3 StVO: Abbieger muessen auf Fussgaenger besondere Ruecksicht nehmen - sie haben Vorrang.',
       'When turning, pedestrians crossing the road you turn into have priority.'],
      ['Das gilt auch ohne Zebrastreifen und auch fuer Radfahrer, die geradeaus weiterfahren.',
       'This applies without a zebra crossing too, and to cyclists going straight on.'],
      ['Deshalb im Abbiegen langsam machen und in die Seitenstrasse schauen.',
       'So slow down as you turn and look into the side road.']
    ]
  },
  /* ---------------------------------------------------------- 11 */
  {
    id:'ampel-rot', group:'Ampel', level:1,
    title:'Rote Ampel',
    en:'Red light',
    task:'Fahre geradeaus - beachte die Ampel.',
    taskEn:'Drive straight on - watch the light.',
    layout:{ type:'cross', arms:['N','E','S','W'],
             signs:{ N:'none', E:'none', S:'none', W:'none' } },
    limit:50, timeLimit:40,
    lights:Object.assign({ t0:0 }, LIGHTS_NS),
    player:{ from:'S', to:'N', d0:start(45), v0:45 },
    traffic:[ { from:'W', to:'E', speed:45, d0:520, color:'#54a86b' } ],
    merksatz:'Ampel schlaegt Schild. Rot heisst: vor der Haltelinie warten.',
    merksatzEn:'Lights beat signs. Red means wait before the junction.',
    points:[
      ['Lichtzeichen gehen Verkehrszeichen und rechts vor links vor (Paragraph 37 StVO).',
       'Traffic lights override signs and rechts-vor-links.'],
      ['Bei Gelb anhalten, wenn das ohne starkes Bremsen moeglich ist.',
       'On amber, stop if you can do so without braking hard.'],
      ['Rot-Gelb heisst noch nicht "fahren", sondern "gleich geht es los".',
       'Red-amber does not mean go yet - it means get ready.']
    ]
  },
  /* ---------------------------------------------------------- 12 */
  {
    id:'ampel-links', group:'Ampel', level:3,
    title:'Gruen, aber links abbiegen',
    en:'Green, but turning left',
    task:'Biege bei Gruen links ab.',
    taskEn:'Turn left on green.',
    layout:{ type:'cross', arms:['N','E','S','W'],
             signs:{ N:'none', E:'none', S:'none', W:'none' } },
    limit:50, timeLimit:40,
    lights:Object.assign({ t0:8 }, LIGHTS_NS),
    player:{ from:'S', to:'W', d0:start(42), v0:42 },
    traffic:[ { from:'N', to:'S', speed:45, arriveRel:-0.4, color:'#e0574a' } ],
    merksatz:'Gruen heisst nicht "freie Fahrt fuer Linksabbieger".',
    merksatzEn:'Green is not a free run for left-turners.',
    points:[
      ['Ein gruenes Rundlicht erlaubt das Abbiegen - aber der Gegenverkehr hat ebenfalls Gruen.',
       'A plain green light permits the turn, but oncoming traffic has green as well.'],
      ['Du faehrst in die Kreuzung ein und wartest dort, bis eine Luecke kommt.',
       'You move into the junction and wait there for a gap.'],
      ['Nur ein gruener PFEIL wuerde dir freie Fahrt geben.',
       'Only a green ARROW would give you a protected turn.']
    ]
  },
  /* ---------------------------------------------------------- 13 */
  {
    id:'gruenpfeil', group:'Ampel', level:4,
    title:'Gruenpfeil',
    en:'Green arrow on red',
    task:'Biege rechts ab. Die Ampel ist rot, aber da haengt ein Gruenpfeil.',
    taskEn:'Turn right. The light is red but there is a green arrow.',
    layout:{ type:'cross', arms:['N','E','S','W'],
             signs:{ N:'none', E:'none', S:'none', W:'none' } },
    limit:50, timeLimit:45,
    lights:{ groups:{ N:'A', S:'A', E:'B', W:'B' }, t0:0,
             program:[ { A:'red', B:'green', dur:26 },
                       { A:'red', B:'yellow', dur:3 },
                       { A:'redyellow', B:'red', dur:1.5 },
                       { A:'green', B:'red', dur:8 },
                       { A:'yellow', B:'red', dur:3 },
                       { A:'red', B:'redyellow', dur:1.5 } ] },
    gruenpfeil:['S'],
    player:{ from:'S', to:'E', d0:start(40), v0:40 },
    traffic:[ { from:'W', to:'E', speed:45, arriveRel:1.4, color:'#54a86b' } ],
    merksatz:'Gruenpfeil = Stoppschild. Erst stehen, dann schauen, dann abbiegen.',
    merksatzEn:'Treat the green arrow as a STOP sign: stop, look, then turn.',
    points:[
      ['Der Gruenpfeil (Zeichen 720) erlaubt Rechtsabbiegen bei Rot - aber nur nach vollstaendigem Halt.',
       'The green arrow permits a right turn on red, but only after a complete stop.'],
      ['Danach musst du jeden anderen durchlassen: Querverkehr mit Gruen und Fussgaenger.',
       'After stopping you must give way to everyone: cross traffic on green and pedestrians.'],
      ['Ohne Halt ist es ein Rotlichtverstoss.',
       'Without stopping it counts as running a red light.']
    ]
  },
  /* ---------------------------------------------------------- 14 */
  {
    id:'kreisverkehr', group:'Kreisverkehr', level:3,
    title:'Kreisverkehr',
    en:'Roundabout',
    task:'Nimm die zweite Ausfahrt (geradeaus).',
    taskEn:'Take the second exit (straight ahead).',
    layout:{ type:'roundabout', arms:['N','E','S','W'],
             signs:{ N:'ringentry', E:'ringentry', S:'ringentry', W:'ringentry' } },
    limit:50, timeLimit:50,
    player:{ from:'S', to:'N', d0:start(35), v0:35, maxSpeed:60 },
    traffic:[ { from:'W', to:'E', speed:28, arriveRel:-0.6, color:'#e0574a' } ],
    merksatz:'Rein ohne Blinker, raus mit rechts.',
    merksatzEn:'No indicator going in, right indicator coming out.',
    points:[
      ['Zeichen 215 mit Zeichen 205: der Verkehr IM Kreisel hat Vorfahrt.',
       'Roundabout sign with give way: traffic already in the circle has priority.'],
      ['Beim Einfahren wird NICHT geblinkt - sonst denken andere, du faehrst gleich wieder raus.',
       'Do NOT indicate when entering, or others will think you are leaving immediately.'],
      ['Vor der Ausfahrt rechts blinken. Im Kreisel gilt kein rechts vor links.',
       'Indicate right before your exit. Rechts-vor-links does not apply inside.']
    ]
  },
  /* ---------------------------------------------------------- 15 */
  {
    id:'strassenbahn', group:'Besondere', level:4,
    title:'Strassenbahn von links',
    en:'Tram from the left',
    task:'Fahre geradeaus. Von links kommt eine Strassenbahn.',
    taskEn:'Drive straight. A tram is coming from the left.',
    layout:{ type:'cross', arms:['N','E','S','W'],
             signs:{ N:'none', E:'none', S:'none', W:'none' },
             rails:['W','E'] },
    limit:50, railPriority:true,
    player:{ from:'S', to:'N', d0:start(40), v0:40 },
    traffic:[ { from:'W', to:'E', kind:'tram', speed:42, arriveRel:-0.5,
                len:190, wid:32, color:'#d8dde3' } ],
    merksatz:'Schienenfahrzeuge haben Vorrang - auch von links.',
    merksatzEn:'Rail vehicles go first – even from the left.',
    points:[
      ['An einer Kreuzung ohne Zeichen und ohne Ampel hat die Bahn Vorrang, egal aus welcher Richtung.',
       'At a junction with no signs or lights the tram goes first, whichever side it comes from.'],
      ['Eine Bahn braucht viel laenger zum Anhalten und kann nicht ausweichen.',
       'A tram needs much longer to stop and cannot swerve.'],
      ['Wo Schilder oder Ampeln stehen, gelten aber diese - dann gilt fuer die Bahn dasselbe wie fuer Autos.',
       'Where signs or lights exist, they apply to the tram just like to cars.']
    ]
  },
  /* ---------------------------------------------------------- 16 */
  {
    id:'bus', group:'Besondere', level:2,
    title:'Bus an der Haltestelle',
    en:'Bus at a stop',
    task:'Fahre geradeaus. Vor dir steht ein Bus an der Haltestelle.',
    taskEn:'Drive straight. There is a bus at the stop ahead.',
    layout:{ type:'cross', arms:['N','E','S','W'],
             signs:{ N:'priority', E:'yield', S:'priority', W:'yield' },
             busstop:'S' },
    limit:50, timeLimit:45,
    player:{ from:'S', to:'N', d0:start(45, 5.6), v0:45 },
    traffic:[ { from:'S', to:'N', kind:'bus', bay:true, d0:CFG.BOX+430,
                len:120, wid:28, speed:35, parked:true, releaseAt:1.6,
                color:'#3f8fd0' } ],
    merksatz:'Blinkt der Bus an der Haltestelle, hat er Vorrang beim Abfahren.',
    merksatzEn:'If the bus is indicating at its stop, it has priority pulling out.',
    points:[
      ['Paragraph 20 Absatz 5 StVO: einem abfahrbereiten Linienbus ist das Einfahren zu ermoeglichen.',
       'A bus indicating to leave its stop must be allowed to pull out.'],
      ['Notfalls musst du anhalten - vorbeiziehen ist hier falsch.',
       'Stop if necessary - squeezing past is wrong here.'],
      ['Faehrt ein Bus mit Warnblinklicht eine Haltestelle an, darfst du nur mit Schrittgeschwindigkeit vorbei.',
       'If a bus approaches a stop with hazard lights on, you may only pass at walking pace.']
    ]
  },
  /* ---------------------------------------------------------- 17 */
  {
    id:'einsatzfahrzeug', group:'Besondere', level:3,
    title:'Blaulicht und Martinshorn',
    en:'Blue light and siren',
    task:'Du willst geradeaus - ein Einsatzfahrzeug kreuzt.',
    taskEn:'You want to go straight - an emergency vehicle is crossing.',
    layout:{ type:'cross', arms:['N','E','S','W'],
             signs:{ N:'priority', E:'yield', S:'priority', W:'yield' } },
    limit:50,
    player:{ from:'S', to:'N', d0:start(45), v0:45 },
    traffic:[ { from:'E', to:'W', speed:60, arriveRel:-0.3, emergency:true,
                sign:'yield', color:'#c8322a' } ],
    merksatz:'Blaulicht plus Horn heisst: sofort freie Bahn.',
    merksatzEn:'Blue light plus siren means make way, right now.',
    points:[
      ['Paragraph 38 StVO: bei Blaulicht UND Einsatzhorn haben alle sofort freie Bahn zu schaffen.',
       'With blue light AND siren, everybody must make way at once.'],
      ['Deine Vorfahrtstrasse zaehlt dann nicht - auch nicht dein gruenes Licht.',
       'Your priority road does not count then, and neither does your green light.'],
      ['Nicht in die Kreuzung rollen: dort blockierst du genau den Weg, den er braucht.',
       'Do not roll into the junction - that is exactly the space it needs.']
    ]
  },
  /* ---------------------------------------------------------- 18 */
  {
    id:'spielstrasse', group:'Besondere', level:4,
    title:'Aus dem verkehrsberuhigten Bereich',
    en:'Leaving a home zone',
    task:'Fahre aus dem verkehrsberuhigten Bereich heraus nach rechts.',
    taskEn:'Leave the home zone and turn right.',
    layout:{ type:'cross', arms:['N','E','S','W'],
             signs:{ N:'none', E:'none', S:'exit', W:'none' },
             playzone:'S' },
    limit:50, walkingPace:true, timeLimit:55,
    player:{ from:'S', to:'E', d0:CFG.BOX+210, v0:6, refSpeed:6, maxSpeed:50 },
    traffic:[ { from:'W', to:'E', speed:45, arriveRel:-0.4, color:'#e8b93c' } ],
    merksatz:'Wer aus einem verkehrsberuhigten Bereich kommt, hat gegenueber allen Wartepflicht.',
    merksatzEn:'Coming out of a home zone you give way to absolutely everyone.',
    points:[
      ['Im verkehrsberuhigten Bereich gilt Schrittgeschwindigkeit - etwa 4 bis 7 km/h.',
       'In a home zone you must drive at walking pace, roughly 4 to 7 km/h.'],
      ['Beim Verlassen musst du allen anderen Vorfahrt gewaehren - rechts vor links gilt hier nicht.',
       'When leaving it you must give way to everybody - rechts-vor-links does not apply.'],
      ['Dasselbe gilt beim Ausfahren aus einem Grundstueck, einer Tankstelle oder einem Feldweg.',
       'The same applies when leaving a property, a petrol station or a field track.']
    ]
  },
  /* ---------------------------------------------------------- 19 */
  {
    id:'zone30', group:'Tempo', level:2,
    title:'Zone 30',
    en:'Zone 30',
    task:'Fahre geradeaus durch die Zone 30.',
    taskEn:'Drive straight through the 30 zone.',
    layout:{ type:'cross', arms:['N','E','S','W'],
             signs:{ N:'none', E:'none', S:'none', W:'none' },
             zone:'zone30' },
    limit:30,
    player:{ from:'S', to:'N', d0:start(30, 5.5), v0:30, maxSpeed:70 },
    traffic:[ { from:'E', to:'W', speed:28, arriveRel:-0.4, color:'#e0574a' } ],
    merksatz:'In der Zone 30 gilt fast immer auch rechts vor links.',
    merksatzEn:'In a Zone 30 rechts vor links almost always applies too.',
    points:[
      ['Zone-30-Gebiete sind bewusst kaum beschildert - deshalb gilt dort meist rechts vor links.',
       'Zone 30 areas are deliberately almost sign-free, so rechts-vor-links usually applies.'],
      ['30 km/h ist das Maximum, nicht die Zielgeschwindigkeit.',
       '30 km/h is the maximum, not a target.'],
      ['Rechne mit parkenden Autos, Kindern und Radfahrern.',
       'Expect parked cars, children and cyclists.']
    ]
  }
  ];

  list.forEach(function(sc){
    if (!sc.layout.arms) sc.layout.arms = ['N','E','S','W'];
    if (!sc.timeLimit) sc.timeLimit = 45;
  });

  return list;
})();
