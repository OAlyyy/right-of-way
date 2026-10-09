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
| `A` / `D` | **steer** (free drive and test) |
| `Q` / `E` | indicator left / right (toggles) |
| `←` / `→` | **look left / right** (shoulder check) — hold it; the mouse on the road looks round too |
| `M` | check the mirror |
| `L` | steer yourself / let the car steer |
| `G` | graphics: high (post-processing) / fast |
| `N` | sound on / off |
| `C` | camera: inside / behind the car / far behind |
| `T` | weather: clear / evening sun / rain |
| `X` | indicator off |
| `V` | switch driver view ⇄ map view |
| `H` | instructor hints on / off |
| `R` | restart the lesson |
| `Esc` | back to the lesson list |

On touch: the LOOK and MIRROR buttons sit bottom-left and the pedals
bottom-right, the indicator arrows flank the speedometer, and in free drive
you **drag the road** to steer (in lessons it turns your head).

In the 3D view your own car has a working instrument cluster (speedometer,
indicator arrows) seen through the wheel, and the town has five kinds of car
(hatchback, saloon, estate, SUV, van), cars parked along the quiet streets -
solid, hitting one counts - people walking the pavements, front-garden
hedges, balconies and clouds.

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

**People and cyclists.** Pedestrians wait at the corners of every junction
and cross: at lights on their own green, at a zebra whenever they like, and
elsewhere when the road is clear - but anyone turning into the street they
are crossing must let them go (§ 9 (3)). Cyclists ride red cycle paths along
both main roads; whoever turns across the path must let a cyclist going
straight on through, even one coming up from behind. That is why the game
now watches **where you look**: hold `Q` / `E` to look over your shoulder and
`M` (or the MIRROR button) to check the rear-view mirror, which the 3D view
shows at the top of the windscreen. Turning without a shoulder check is a
fault - across a cycle path it is a fail, as in the real test.

**You steer.** In free drive and the test the car no longer follows its
route by itself: `←` / `→` (or drag the road on a touch screen) turn the
wheel, which centres itself when you let go, and the faster you go the less
it turns. Your indicator tells the town - and the route - which way you mean
to go at the next junction; drive into another street and the game follows
you there, while the examiner's directions stay what they were. The line you
take is judged: over the centre line (§ 2 keep right), cutting a left turn,
swinging wide on a right, not positioning before a turn, clipping the kerb
(corners are rounded, 4 m, as real ones are), or driving against your own
indicator. The blue chevrons on the road show the proper line. `L` (or the
"Steering" button) hands the wheel back to the car; lessons always steer for
you, since their timing is built around the route.

**Take the test** runs a 15-minute exam on the Frankfurt map. The examiner
gives directions out loud, in German ("An der nächsten Kreuzung bitte rechts
abbiegen"); there are no hints and no rewinds, small faults are noted
silently, and one serious fault ends the test on the spot. You fail on one
serious fault, five small ones, or the same small one three times. Every
drive ends with the examiner's sheet: the five areas of the German practical
test (Verkehrsbeobachtung, Fahrzeugpositionierung, Geschwindigkeitsanpassung,
Kommunikation, Fahrzeugbedienung), each clean or with what went wrong.

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

### The 3D view

`js/gl.js` draws the driver's view in real 3D with three.js (WebGL), from
the same simulation and the same town layout (`js/cityview.js`) as the 2D
views: photo-scanned asphalt, paving, track gravel and plaster, houses with
framed windows, doors and shopfronts, tiled roofs, trees, street lamps,
sun shadows by day, lamp light and headlights at night, and cars with
clear-coat paint, glass, rims and Frankfurt number plates. You sit in the
car: dashboard, A-pillars and bonnet included. If WebGL is unavailable the
game falls back to the 2D projection in `js/pov.js`, which the tests use.

Real HDR photos of a German street by day and a square at night light the
scene and show in paint and glass. On "Graphics: high" (`G`) the picture also
gets soft contact shadows where things meet (ambient occlusion), a glow round
bright lights, a gentle colour grade with vignette, and FXAA edge smoothing;
phones and small screens start on "fast", which draws straight to the screen.

More that makes it feel real:

- **Trees** are grown in code from a few seeds: a trunk forking into limbs
  and twigs with real bark, carrying cards of drawn leaf sprays that let
  the sun through in dappled shadows and sway a little in the wind.
- **Wear and tear**, worked out in world space so nothing repeats:
  patched asphalt with tar seams and sealed cracks, markings worn through
  in places, grime at the foot of walls with rain streaks, stained
  paving, and glossy window glass that reflects the sky.
- **Car bodies** are lofted: rounded slices from nose to tail, so the
  bonnet, flanks and roofline are smooth and the clear coat reflects the
  street in long highlights; flush lamps, mirrors on stalks, proper arches.
- **The ride**: the car dives when you brake, squats when you pull away,
  leans out of turns and shivers over the road; on "high" the edges of
  the picture streak a little at speed.
- **Weather** (`T`): low evening sun with long shadows, or rain - grey
  light, mist, falling streaks, dark wet roads with puddles that mirror
  the sky. Works by night too.
- **The cabin**, in the manner of a current executive saloon: a low leather
  dashboard with a wood band and a line of ambient light running into the
  doors, one long curved display (instruments ahead, the satnav angled
  towards you), a head-up display with speed and limit, a sport wheel with
  button pads, paddles and stalks - and your hands on it, fingers round
  the rim, shirt cuffs and a watch. They turn with the wheel, to a point.
- **Your car** is an artist's model when the game is served over http: a
  modern concept car with its own dashboard, wheel, seats and door cards,
  in graphite (built as a centre-seat car; its driving position is moved
  to the left here); its wheels turn and steer, its steering wheel
  turns under rigged hands. Opened from disk or as the single file, the
  built car and cabin above are used instead.
- **Camera** (`C`): from the driver's seat, from just behind the car, or
  from further back and higher; the look keys swing the outside camera
  round the car.
- **Overhead line** along the U-Bahn: masts with cantilevers, a contact
  wire zig-zagging between them, droppers and a sagging catenary.
- **German traffic lights**: rounded housings on a black contrast board
  with a white rim, LED lenses under deep visors, and the yellow
  "Signal kommt" push-button box on the mast.
- **Street furniture**: bins on posts, bike hoops with parked bikes,
  benches, bollards at the corners, street-name signs at every junction,
  and round advertising pillars.
- **Buildings with depth** on their street fronts, lined up with the painted
  windows: stone sills, and on the older (Gründerzeit) houses stucco window
  surrounds, cornices and bands between the floors; shop awnings and
  lettered signs (lit at night, the pharmacy with its red A); door
  canopies; dormers and chimneys on pitched roofs; satellite dishes and
  TV aerials. Balconies have iron-bar, frosted-glass or painted railings with
  a slim handrail, and flower boxes on some floors.
- **Road details**: granite setts in the gutters with drain grates, and
  tram rails laid flush in concrete where they cross a street.
- **Sound** (`N`), synthesised in the browser with Web Audio, no files:
  an engine that pulls through the gears with speed and pedal, tyre and
  wind noise, the indicator relay, cars hissing past, the town's hum,
  birds by day, rain, and the tram's bell as it comes up near you.

Third-party files, all in the repo so the game runs offline:

| | |
|---|---|
| `js/vendor/three.min.js`, `RoomEnvironment.js`, `Sky.js` | three.js r147, MIT (`js/vendor/THREE-LICENSE.txt`) |
| `assets/tex/*.jpg` → `js/vendor/assets.js` | textures (asphalt, paving, gravel, plaster, roof tiles, grass, bark) from [Poly Haven](https://polyhaven.com), CC0 |
| `assets/models/*.glb` → `js/vendor/assets.js` | people: "Animated Men Pack" and "Animated Women Pack" by [Quaternius](https://quaternius.com), CC0 (via poly.pizza) |
| `js/vendor/GLTFLoader.js`, `SkeletonUtils.js`, `RGBELoader.js`, `Pass.js`, `UnrealBloomPass.js`, `CopyShader.js`, `LuminosityHighPassShader.js`, `FXAAShader.js` | three.js r147 add-ons, MIT |
| `assets/models/car_concept.glb` (fetched at run time) | your car, inside and out: "Car Concept" from the [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept), © 2024 Darmstadt Graphics Group GmbH, model and textures by Eric Chadwick, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changed here: scaled, the graphite finish chosen, glass simplified, and the driving position (wheel, instrument pod, column, pedals) moved from the centre to the left |
| `assets/models/hand_*.glb` → `js/vendor/assets.js` | the driver's hands: WebXR "generic hand" models, MIT, © Amazon ([webxr-input-profiles](https://github.com/immersive-web/webxr-input-profiles)) |
| `assets/hdri/*.hdr` → `js/vendor/assets.js` | sky photos "German Town Street" and "Hansaplatz" from [Poly Haven](https://polyhaven.com), CC0 |

People are rigged, animated models (walk and idle): men and women, children
among the walkers, and older people with grey hair who walk a little slower
and stooped; each has their own height and colours of shirt or dress,
trousers, hair and skin. Cyclists keep a simpler figure, since the models
have no cycling pose. Cars are baked per body type
into one mesh per material, so a street full of them stays fast.

To refresh them: `node tools/fetch-assets.js`, `node tools/fetch-people.js`, `node tools/fetch-car.js` and
`node tools/fetch-lighting.js`, then `powershell -File tools/shrink-textures.ps1`
and `node tools/shrink-hdr.js`, then `node tools/pack-assets.js`.
The textures travel as data URIs inside a script because WebGL refuses
images loaded from `file://`.

### The 2D driver view

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
node test/street-check.js        # people and cyclists: nobody run down, turning blind gets booked
node test/exam-check.js          # the test: careful driving passes, not looking or speeding fails
node test/shoulder-check.js      # quick glances count; missing or stale ones are booked
node test/steer-check.js         # steering yourself: a good line is clean, line faults are booked
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
