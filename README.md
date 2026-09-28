# Fahrschule – Kreuzungstrainer

A local browser game for practising the *practical* German road rules: who goes
first at a junction, what the signs mean, when you have to stop, and why.

You drive it from the driver's seat. The game watches, and after every run it
tells you exactly what you did wrong, which rule applies and what to do instead
— in English, with the German terms underneath, because those are the words on
the signs and the ones your Fahrlehrer will use.

## Run it

**On this PC** — double-click **`index.html`** (or `start.bat`). No install, no
build step, no server; it is plain HTML/CSS/JS and runs straight from disk.

**On your phone** — two ways:

*Over your Wi-Fi (tests the live source, so edits show up on a refresh):*

```
node serve.js
```

It prints a `http://192.168.x.x:8080/` address. Type that into your phone's
browser while both devices are on the same Wi-Fi. Ctrl+C stops it. If nothing
loads, Windows Firewall is blocking node — allow it on **private** networks, or
use the file method below.

*As one file (no server, works offline, e-mail or AirDrop it to yourself):*

```
node build.js
```

That writes **`dist/kreuzungstrainer.html`** — the whole game, ~150 kB, in a
single file. Open it on any device.

### What to check on each

| | |
|---|---|
| **PC** | Keyboard: `W`/`S` to drive, `Q`/`E` to look, `A`/`D` for indicators, `V` to swap views. Resize the window narrow — the sidebar drops away and the task line moves into the HUD. Toggle **Night/Day**; the road and the sky repaint too. |
| **Phone, portrait** | Thumb controls: LOOK bottom-left, GAS/BRAKE bottom-right. Dragging the road should turn your head and spring back on release. Nothing should scroll or zoom while driving, and the pedals must sit clear of the home-bar area. |
| **Phone, landscape** | The chrome shrinks so the junction stays visible. Rotate mid-lesson — it re-fits without losing the run. |
| **Both** | Finish a lesson, check the debrief scrolls fully to the buttons. Reload — your points are still on the lesson cards. |

## How it plays

You sit in the car and look out through the windscreen. It steers itself along
the assigned route; **you** decide the things a driving examiner actually
watches — speed, indicators, and above all who goes first.

| Key | |
|---|---|
| `W` / `↑` | accelerate |
| `S` / `↓` / `Space` | brake |
| `Q` / `E` (or `←` / `→`) | **look left / right** — hold it |
| `A` / `D` | indicator left / right (toggles) |
| `V` | switch driver view ⇄ map view |
| `H` | instructor hints on / off |
| `R` | restart the lesson |
| `Esc` | back to the lesson list |

On touch: the LOOK buttons sit bottom-left and the pedals bottom-right, the
indicator arrows flank the speedometer, and you can **drag the road** to turn
your head.

### Looking is part of the lesson

From the driver's seat you genuinely cannot see across a junction without
looking, exactly as in the car. `test/pov-probe.js` measures this for every
lesson: at *rechts vor links*, the car you have to give way to is visible from
63 m away the moment you glance right — but only from 37 m if you stare
straight ahead. That is the whole point.

The **map view** (`V`) is the old top-down picture, and a live minimap of it
sits in the corner of the driver view, so you can always check the geometry
against what you saw.

### Language

English by default, with the German underneath. The **Deutsch / English**
button in the header swaps which one leads; both are complete, including every
fault explanation and every live hint.

Score starts at 100. Major faults (failing to give way, running a red, hitting
someone) cost a lot and mean a fail; minor ones (missing indicator, too fast)
only cost points. Progress is stored in `localStorage`.

## The 19 lessons

**Vorfahrt** — rechts vor links from the right · from the left (you have
priority: use it) · three cars at once
**Schilder** — Vorfahrt gewähren (205) · Stop (206) · Vorfahrtstraße (306) ·
abknickende Vorfahrtstraße
**Abbiegen** — turning left against oncoming traffic
**Fußgänger** — zebra crossing · turning across pedestrians (§ 9 III)
**Ampel** — red light · green but turning left · Grünpfeil (right on red)
**Kreisverkehr** — give way, no indicator in, right indicator out
**Besondere** — tram from the left · bus leaving its stop (§ 20 V) · blue light
and siren (§ 38) · leaving a verkehrsberuhigter Bereich
**Tempo** — Zone 30

The **Merkblatt** button opens a one-page summary of every rule the game tests.

## Free drive

Once the lessons feel routine, **Drive Frankfurt** on the menu puts you on
Eschersheimer Landstraße in Frankfurt-Eschersheim, heading south into
**Weißer Stein**. The streets around it are the real ones, in their real
order (names and junction types from OpenStreetMap), straightened onto the
game's grid:

- **Eschersheimer Landstraße** is the main road, with lights at every
  junction, and the **U-Bahn** (U1/U2/U3/U8) runs on its own track bed
  beside it. Turn off the main road across the tracks and the train goes
  first, even on your green and even from behind (§ 9 (3) StVO) — the
  classic Frankfurt exam trap. Cars from the side street wait *before* the
  tracks.
- **Am Weißen Stein** crosses it as a priority road; its side streets have
  give-way signs and one real stop sign.
- Everything else is **Tempo 30 with rechts vor links**, as in the real
  area.
- Simplifications: the real streets are not a grid, one-way streets are
  two-way here, and there are no pedestrians or cyclists in free drive yet.

**Random town** next to it builds a made-up grid from a random seed instead,
with a roundabout and more mixed junctions.

The driver's view shows the whole town: every junction near you, pavements,
blocks of three-to-five-storey houses with windows and shopfronts (lit at
night), street trees and lamps, the track bed with its rails, the blue U-sign
at the stations, and the Frankfurt banking towers on the horizon to the south.
Houses block your view into side streets exactly as they do in a real town,
which is why you have to look.

There is no script and no per-junction task: you just drive, following the
turn-by-turn instruction in the HUD, and the examiner stays quiet until you
break a rule — then the car stops and explains exactly what happened, same
fault catalogue as the lessons, before you carry on. From that popup,
**Rewind & try again** (`Space`) puts the whole town back about five seconds
before the mistake and freezes it until you press gas, so you can drive that
moment again properly; **Drive on** (`C`) keeps the fault on your sheet.
Rewound mistakes are listed separately in the summary and don't cost points.
**End drive** at any
point for a score and a junction count; **R** starts a fresh town.

`js/city.js` builds the grid and the street names; `js/drive.js` is the
DriveWorld that drives it — it reuses `js/sim.js`'s physics and `js/rules.js`'s
priority engine wholesale, so the two never disagree about what a fault is.
`test/drive-check.js` and `test/longhalt-check.js` drive it headlessly for
several simulated minutes on a range of seeds with a rule-following driver,
checking that the game never accuses that driver of breaking a rule and that
the town doesn't gridlock; `test/drive-render-check.js` renders every junction
kind the open world produces to catch drawing bugs the way `render-check.js`
does for the lessons.

## How the judging works

`js/rules.js` holds the actual priority engine. For any two vehicles whose paths
cross it answers *who must give way*, in the order the StVO applies:

1. **Traffic lights** override everything (green = priority, red = none).
2. **Signs** override rechts-vor-links (priority road > unmarked > give
   way/stop > leaving a home zone or driveway).
3. **Equal rank** → the left-turner yields to oncoming traffic (§ 9 III);
   otherwise **rechts vor links** (§ 8 I).
4. On top of that: trams, buses pulling out, and emergency vehicles.

Whether two paths conflict at all is computed **geometrically** (where the two
driven lines come closest), not from a table — so a car turning right off your
road correctly counts as no conflict, while the same car going straight does.

Failing to give way is detected the way the law phrases it: you are at fault if
a vehicle with priority *had to brake because of you*, or if you entered when
the gap was too small for you to clear in time.

## Layout

```
index.html           page + UI
style.css            palette, type, layout (light + dark)
js/geo.js            world constants, vector maths, path building
js/rules.js          priority engine + fault catalogue (the teaching content)
js/signs.js          German road signs drawn as vectors
js/sim.js            vehicles, pedestrians, lights, the examiner
js/scenarios.js      the 19 lessons
js/city.js           the open-world map: grid, junctions, Weißer Stein preset, U-Bahn
js/drive.js          DriveWorld - free driving through the open world, trams, rewind
js/cityview.js       the town around the roads: houses, trees, lamps, track bed
js/render.js         top-down drawing
js/pov.js            the driver's-seat view (perspective projection)
js/i18n.js           interface language, English and German
js/main.js           screens, input, scoring, progress, theme, language
build.js             bundles everything into dist/
serve.js             static server for testing on a phone
test/harness.js             drives every lesson correctly and recklessly
test/render-check.js        draws every lesson against a stub canvas
test/pov-probe.js           measures when each lesson's traffic becomes visible
test/pov-ascii.js           rasterises the driver view as text, to eyeball it
test/drive-check.js         drives the open world for several minutes, checking
                             for false accusations and gridlock
test/drive-render-check.js  draws every open-world junction kind against a
                             stub canvas
test/longhalt-check.js      confirms a long wait at a busy crossing always ends
test/drive-policy.js        the rule-following driver shared by the tests above
```

### The driver view

`js/pov.js` is a pinhole camera at eye height (1.20 m), projecting the same
world the map view draws. Road, markings and crossings are painted as ground
polygons clipped against the near plane; everything that stands up — cars,
pedestrians, signs on their posts, traffic lights — is depth-sorted and drawn
far to near. Cars are shaded boxes with a glass cabin, and their brake lights
and indicators only show from the side that actually has them.

## Look and feel

The palette is lifted from German signage (RAL): signal yellow `#FFCC00` — the
Vorfahrtstraße diamond — is the only accent, while red, green and blue are kept
for meaning alone. Type is Archivo and Archivo Narrow, the closest Google Fonts
come to DIN 1451, the typeface on real German road signs; the speedometer is
set in JetBrains Mono. Offline the fonts fall back to the system sans, which
costs the layout nothing.

Both themes are real: **Nacht** is a night drive on dark asphalt, **Tag** is
daylight over green verges. The canvas reads its colours back out of the
stylesheet, so the road repaints with the rest of the page. Without an explicit
choice it follows your OS setting.

## Tests

```
node test/harness.js             # rules: 19 lessons, careful run vs reckless run
node test/render-check.js        # drawing: both views, both languages, no NaN geometry
node test/pov-probe.js           # is each lesson's traffic actually visible in time?
node test/pov-ascii.js zebra 0 2.4        # print the driver view as text

node test/drive-check.js         # open world: no false accusations, no gridlock
node test/drive-render-check.js  # open world: every junction kind draws cleanly
node test/longhalt-check.js      # a long wait at a busy crossing always ends
node test/rewind-check.js        # break a rule, rewind, retry: the town restores cleanly
node test/tram-check.js          # Frankfurt map: trains run, get priority, nobody is falsely accused
```

`harness.js` is the useful one for the lessons. It drives each lesson twice —
once obeying the rules (expects a clean sheet) and once flat out (expects that
lesson's specific fault) — so changes to the rule engine can't silently break
a lesson.

`drive-check.js` is the equivalent for free drive, and the one that matters
most there: a false accusation against a driver who did nothing wrong is far
worse in an open town than in a lesson, because the game stops the car and
lectures you. It drives several seeds for several minutes each with a driver
built to actually follow the rules, and fails if that driver is ever accused
of breaking one, or if the town gridlocks.

## Adding a lesson

Append an entry to `js/scenarios.js`. Timing is declarative: set
`arriveRel: -0.4` on another car and it will be positioned so it reaches the
conflict point 0.4 s before you would, whatever the speeds involved.

```js
{
  id:'my-lesson', group:'Vorfahrt', level:2,
  title:'...', en:'...', task:'...', taskEn:'...',
  layout:{ type:'cross', arms:['N','E','S','W'],
           signs:{ N:'none', E:'yield', S:'none', W:'priority' } },
  limit:50,
  player:{ from:'S', to:'N', d0:CFG.BOX+600, v0:40 },
  traffic:[ { from:'E', to:'W', speed:40, arriveRel:-0.4 } ],
  merksatz:'...', merksatzEn:'...',
  points:[ ['deutsch','english'] ]
}
```

Signs per arm: `none` `yield` `stop` `priority` `exit` `ringentry`.
Layout extras: `crossings:['S']` (zebra), `rails:['W','E']`, `busstop:'S'`,
`playzone:'S'`, `zone:'zone30'`, `bend:['S','E']`, `type:'roundabout'`.

## A caveat worth stating

This is a training aid, not a legal reference. The engine models the common
cases well, but real junctions have details it does not (multiple lanes, cycle
lanes, sight lines, Zeichen 208 narrow passages, unmarked tram stops). For the
theory test use the official Fragenkatalog; for the practical test, your
Fahrlehrer wins every argument.
