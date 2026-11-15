---
id: T10-audio
title: Generative soundtrack and the beat
status: done
depends_on: [T00]
owns: [src/audio/**, tests/unit/audio/**, plans/T10-audio.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**]
updated: 2026-11-15
---

# T10: audio

## 1. Purpose

Give the city its soundtrack: an endless, slowly varying synthwave track synthesized in the browser,
with a quiet bed of city hum under it, and a beat the picture can pulse to. No sound files. The
viewer hears nothing until they act, can mute at any time, and never hears a click, a burst or
anything harsh.

## 2. Context and orientation

`architecture.md` §6, and "Web Audio" in Agents.md. The tempo is `BPM` in
`src/contracts/constants.ts`, chosen so a whole number of beats fits the loop. The contract this
module implements is `BeatSource` in `src/contracts/audio.ts`; the app passes it to the engine with
`engine.setBeatSource`, and the engine turns it into the `uBeat` uniform. When audio is off the engine
uses its own clock at the same tempo, so this module never has to run for the visuals to pulse.

The module is split so most of it is testable without a browser: the composition (which note, when,
how loud) is pure and deterministic from a seed; only a thin layer touches `AudioContext`.

| File | Holds | Touches Web Audio |
|---|---|---|
| `src/audio/theory.ts` | natural minor scale, MIDI to Hz, chord-tone snapping | no |
| `src/audio/song.ts` | the composition: `createSong(seed).bar(n)` returns the events of bar n | no |
| `src/audio/transport.ts` | beats against the audio clock, the lookahead scheduler's bookkeeping, the clock smoother | no |
| `src/audio/mix.ts` | buses, effects, side-chain, city bed, master chain, on any `BaseAudioContext` | yes |
| `src/audio/voices.ts` | the twelve instruments, one function per note, and `playEvent` | yes |
| `src/audio/player.ts` | the live `AudioContext`, timer, suspend and resume, tab hide and show, the beat | yes |
| `src/audio/index.ts` | `createAudio`, the only thing the app imports | through the player |

Terms. A **bar** is 4 beats, 16 sixteenth-note **steps**. A **section** is 8 bars of one kind
(intro, verse, chorus, break). A **movement** is six to eight sections in one key with its own chord
progressions, bass and arpeggio patterns and lead motif. The song is an endless chain of movements.

## 3. Scope

Owns `src/audio/**` and `tests/unit/audio/**`. Scratch measurement pages and scripts are in
`shots/T10/` (git-ignored). Non-goals: UI for volume or mute (T12 calls this module's functions),
positional audio tied to scene objects.

## 4. Interfaces

Consumes `BPM` from `src/contracts/constants.ts`, `BeatSource` from `src/contracts/audio.ts`, and
`createRng`, `hashInts` from `src/core/random.ts`. Nothing else.

Provides, from `src/audio/index.ts`:

```ts
createAudio(options?: { seed?: number; volume?: number; muted?: boolean }): AudioSystem

interface AudioSystem {
  start(): Promise<void>;      // call inside a user gesture; creates the AudioContext; never rejects
  suspend(): Promise<void>;    // fade out, then stop the audio clock
  resume(): Promise<void>;
  setVolume(volume: number): void;   // 0..1, clamped; the gain is the square of the value
  setMuted(muted: boolean): void;    // silent, but the beat keeps running
  readonly beat: BeatSource;         // beatPosition() and energy()
  readonly state: 'idle' | 'running' | 'suspended' | 'unavailable' | 'closed';
  dispose(): void;
}
```

Defaults: seed 1, volume 0.8, not muted. Types `AudioOptions`, `AudioState` and `AudioSystem` are
exported too. `beat.beatPosition()` is null whenever `state` is not `running`, and counts fractional
beats from the first beat of the music otherwise. `beat.energy()` is the loudness of the current
bar, 0..1, eased over the first beat of a bar, and 1 when not running (what the engine assumes with
no source). States: `idle` before `start()`; `suspended` after `suspend()`, while the tab is hidden,
while the browser has interrupted the context, or while it is still waiting for a gesture;
`unavailable` when there is no Web Audio or the context could not be made; `closed` after `dispose()`.

## 5. Plan of work

**M1. Composition (pure).** A sequencer that, given a bar number, returns the events of that bar:
kick on every beat; snare on 2 and 4; closed hats on eighths or sixteenths with open hats on
off-beats; a sixteenth-note bass arpeggio following the chord; pad chords one per bar or two; a lead
phrase on some sections. Structure: 8-bar sections (intro, verse, chorus, break) in movements, each
with chord progressions in a minor key, and a key change at every movement. Proof: unit tests that
every event time lies inside its bar, notes lie in the scale, the same seed gives the same song, and
sections vary.

**M2. Voices.** Kick: sine with a fast pitch drop and a click. Snare: noise burst plus tones, with a
gated reverb tail. Hats: high-passed noise. Bass: two detuned saws through a resonant low-pass with
an envelope. Pad: detuned saws, slow attack, low-pass, chorus from modulated delays. Lead: saws and a
square with vibrato and a tempo-synced delay. Each voice is a function that builds its nodes,
schedules them and cleans up on `onended`.

**M3. Scheduler and transport.** The lookahead pattern: a timer every 25 ms schedules all events due
in the next 200 ms against `audioContext.currentTime` (see the Decision log for 200). `beat` reports
the fractional beat position from the audio clock so the picture follows the sound. Handle `suspend`
and `resume`, tab hide and show (no burst on return), and `interrupted` states.

**M4. Mix.** Side-chain: pads, bass and arpeggio duck on each kick (a gain automation, not a
compressor side-chain). Master: gentle compressor, then a limiter-style clamp, peak under -6 dBFS, a
fade-in of about two seconds on start. City bed: filtered brown noise with slow movement, very
quiet, plus rare distant whooshes.

**M5. Check by measurement.** Render through `OfflineAudioContext` in the browser from a scratch page
under `shots/T10/` and report peak level, RMS, clipping, per-band energy and clicks. Listening is a
human check.

**M6. Radio stations (2026-11-15, operator request: "5 stations ... each with a distinct synthwave
sound and billboard").** `src/audio/stations.ts` defines five stations; each is a `SongStyle`
(`song.ts`: scale, home keys, verse and lift progressions, turnarounds, colour rule, bass and
arpeggio patterns, legato bass, arpeggio speed, drum groove, swing) and a `SoundStyle` (`mix.ts`:
tempo, kick shape and drive, snare, bass, pad, arpeggio and lead variants, reverb length, delay
time and feedback, chorus depth, tape low-pass, tape wobble, side-chain depth, bus levels).

| Station | Genre | BPM | Scale, groove | Sound |
|---|---|---|---|---|
| Sunset FM 88.8 | Outrun | 105 | natural minor, four on the floor | the original, unchanged |
| Obsidian 93.3 | Darksynth | 112 | Phrygian (bII), power chords, `drive` | driven saw bass, dark pads, low hard kick |
| Velvet 97.1 | Chillwave | 84 | major with 7ths and 9ths, `half` time | round held bass, glass pads, FM bell, breathy lead, long room, light tape wobble |
| Starport 101.5 | Spacesynth | 120 | Dorian, `disco` (open hat on every off-beat, syndrum pickups) | octave pluck bass, clap, square arpeggio and lead |
| Plaza 104.3 | Mallsoft | 78 | major with dominant 7ths, `lazy`, swung eighths | FM electric piano, mallet, muted lead, heavy tape wobble and roll-off |

`AudioSystem` gains `setStation(id)` and `station`; `createAudio` takes `station`. Every station
keeps time from the moment the music first started, as if all five had been broadcasting all along,
so tuning lands mid-song at the start of the bar in progress, after 0.45 s of tuning noise (a swept
band of static and a faint whistle). A switch builds a new mixer on the same `AudioContext` and
fades the old one out (disposed after 0.6 s). The beat follows the station's tempo; the engine
reads `beatPosition()` as it always has, and falls back to `BPM` only when audio is off. Proof:
Sunset FM byte-identical to the old song; offline renders of each station; a live switching check.

## 6. Validation and acceptance

All of the following were run on 2026-11-14 in this session, on the final code, unless a line says
otherwise. The offline and live checks need the dev server on 5180.

**A1. `npm run check:task -- T10` exits 0.** Observed:

```
typecheck tsconfig.json: 0 error(s) in T10-audio, 0 elsewhere
typecheck tsconfig.node.json: 0 error(s) in T10-audio, 0 elsewhere
lint: ok (src/audio, tests/unit/audio)
tests: ok (tests/unit/audio)
   Test Files  4 passed (4)
        Tests  56 passed (56)
PASS T10-audio
```

**A2. The offline render reports peak at or below -6 dBFS and no clipped samples.**
`node shots/T10/measure.mjs` (16 bars from bar 0, seed 1, 44.1 kHz, listener volume 1, the worst case):

```
seed 1, bars 0..15, 37.22 s at 44100 Hz, rendered in 2537 ms
sections        : 0:intro0  8:verse0
output          : peak -6.28 dBFS (0.4853), rms -19.62 dBFS, dc L 0.000039 R 0.000041
ceiling         : -6.2 dBFS; samples at full scale 0; samples over -6 dBFS 0; in the clamp knee 19653 (0.599 %)
before master   : peak 1.44 dB, rms -16.64 dB
entering clamp  : peak -4.16 dB, rms -19.6 dB
bands dBFS      : sub 20-120 -22.8 | lowmid 120-500 -23.8 | mid 500-2k -33 | highmid 2k-6k -38.1 | high 6k-16k -44.9
side/mid        : -11.71 dB
clicks          : 0; largest sample-to-sample jump 0.1688
rms per bar dB  : -29 -27 -27.2 -27.2 -18.9 -19 -18.9 -18.4 -18.5 -18.4 -18.4 -18.2 -18.4 -18.4 -18.3 -18.2
voices          : started 519, dropped 0, peak active 20; scheduler {"emitted":539,"late":0,"dropped":0}
```

Ten minutes of seed 1 in four renders (`--start 0 --bars 64`, `--start 64 --bars 64`,
`--start 128 --bars 64`, `--start 192 --bars 72`), and the first 64 bars of three other seeds:

| Render | Peak dBFS | RMS dBFS | Over -6 dBFS | At full scale | In clamp knee | Clicks | Voices dropped, peak active |
|---|---|---|---|---|---|---|---|
| seed 1, bars 0-63 | -6.25 | -18.41 | 0 | 0 | 0.859 % | 0 | 0, 24 |
| seed 1, bars 64-127 | -6.24 | -18.75 | 0 | 0 | 0.676 % | 0 | 0, 25 |
| seed 1, bars 128-191 | -6.25 | -18.49 | 0 | 0 | 0.828 % | 1 (see below) | 0, 25 |
| seed 1, bars 192-263 | -6.25 | -18.25 | 0 | 0 | 0.862 % | 0 | 0, 25 |
| seed 2, bars 0-63 | -6.24 | -18.37 | 0 | 0 | 0.837 % | 0 | 0, 24 |
| seed 5, bars 0-63 | -6.22 | -18.27 | 0 | 0 | 0.833 % | 0 | 0, 24 |
| seed 20261114, bars 0-63 | -6.22 | -18.38 | 0 | 0 | 0.871 % | 0 | 0, 24 |
| seed 1, bars 24-31 at 48 kHz | -6.28 | -17.59 | 0 | 0 | 1.131 % | 0 | 0, 20 |

DC offset stayed under 0.0001 in every render. The one detection (bars 128-191, 11.7352 s, a jump of
0.0236 against 0.0093 around it) is the falling edge of a bass saw just after a note starts, while
its filter is still open: the bass stem alone shows the edge spread over eight samples
(`--dump 11.7352 --solo bass --start 128 --bars 6`), and no stem reports a click there. It is
waveform, not a discontinuity.

Loudness by section, seed 1, RMS per bar: intro without drums about -27 to -29 dBFS, intro with
drums -18.9, verse -18.4, chorus -17.2, break -21.4.

**A3. Every part is present and in proportion.** `node shots/T10/measure.mjs --stems --start 24 --bars 8`
(first chorus, each part soloed, level before the master chain; the whoosh row is from
`--stems --start 33 --bars 4`, where one occurs):

| Part | Peak dB | RMS dB | Clicks | Bands dBFS: sub, low-mid, mid, high-mid, high |
|---|---|---|---|---|
| kick | -4.12 | -16.13 | 2, its own beater noise | -21.6, -23.8, -53.2, -60.4, -65.2 |
| snare | -5.11 | -26.35 | 0 | -57.3, -41.5, -38.3, -33.6, -40.4 |
| hats | -17.38 | -45.51 | 0 | -128.2, -115.6, -86.3, -60.1, -48.4 |
| toms, crash, riser | -10.20 | -36.56 | 0 | -47.4, -41.7, -53.1, -47.0, -59.9 |
| bass | -13.38 | -20.09 | 0 | -25.1, -24.3, -38.6, -49.9, -75.9 |
| pad | -9.72 | -25.34 | 0 | -93.2, -31.6, -32.7, -41.8, -67.7 |
| arpeggio | -15.66 | -34.10 | 0 | -70.6, -39.9, -39.3, -48.0, -66.0 |
| lead | -13.29 | -26.09 | 0 | -96.1, -33.5, -30.3, -36.4, -53.4 |
| whoosh | -28.76 | -49.97 | 0 | -86.4, -67.9, -53.4, -57.3, -65.0 |
| city bed | -27.82 | -39.21 | 0 | -47.9, -56.9, -75.7, -83.5, -96.8 |

Kick and bass carry the sub band at about the same level; the full mix falls about 8 dB from the
low-mids to the mids and 20 dB to the highs, which is the "warm rather than harsh" target; the bed
sits 24 dB under the music.

**A4. Timing and tuning come out of the audio, not only out of the data.**
`node shots/T10/measure.mjs --timing`: 16 of 16 kicks found in four bars, mean interval 571.426 ms
against 571.429 expected, 105.001 BPM, worst distance from the grid 0.181 ms. Long bass notes (the
break) measure 65.41 Hz for C2 (0.0 cents) and 103.82 Hz for G sharp 2 (-0.1 cents). Pad chord tones
measure within 9.3 cents of their notes, which is the detune of the two saws (7 to 11 cents).

**A5. The click detector can fail.** `node shots/T10/measure.mjs --selftest` cuts a rendered signal
dead at a chosen fraction of its local peak. On the pad, bass and lead stems the cut is reported at
0.8, 0.4, 0.2 and 0.1 of the peak; on the arpeggio stem down to 0.2; on the full mix only at 0.8
(a smaller cut hides among the drums' own transients). So "0 clicks" on a stem is a strong statement
and on the full mix a weak one; the stems are the evidence. The detector also found a real defect
during the work (section 9, first entry).

**A6. Suspend, resume, mute and volume changes do not click.** `node shots/T10/measure.mjs --transitions`
applies fade out, fade in, level 0, level 0.64 and level 1 in the middle of a chorus through the
mixer calls the player uses: 0 clicks on pad, bass and lead together and on the full mix; the largest
jump near a change (0.0475) is smaller than in ordinary playing (0.0679); faded out is exact silence
and muted is -131 dBFS. The same run forces the voice limit down to 8: 127 of 249 notes are dropped,
never a kick or a snare, and the peak stays at -6.31 dBFS.

**A7. Creating the module without a gesture creates no `AudioContext`.** Unit test
`creates no AudioContext until start() is called` (a counting stand-in for the constructor), and in
the browser `node shots/T10/live.mjs`: `contexts 0, state idle, beat null` after `createAudio()`.

**A8. In a browser run: `start()` inside a click reaches `running`; the beat advances at `BPM`; hide
and show does not burst.** `node shots/T10/live.mjs`, Chromium 1234 headless, launched muted, 31 of
31 checks passed:

```
PASS  click Start: state becomes running
PASS  one AudioContext, running  sample rate 48000, reported output latency 0.04
PASS  beat advances at BPM  105.005 BPM measured against 105 over 721 frames
PASS  beat never null while running, never backwards  nulls 0, backwards 0
PASS  beat is smooth  worst deviation from a straight line 6.7 ms
PASS  volume 1: peak at or under -6 dBFS  peak -7.2 dBFS, rms -19.5 dBFS
PASS  muted: silent, still running, beat still moving  peak 0.00e+0, beat 28.42
PASS  volume 0.5: gain is the square, 0.25  peak -18.7 dBFS (limit -18.2)
PASS  suspend(): state suspended and beat null at once
PASS  suspended: context suspended, clock stopped, nothing scheduled  clock at 20.000 s
PASS  resume: the music picks up where it stopped  beat 34.46 before, 34.69 after 1.3 s suspended
PASS  hidden: suspended, beat null, context suspended
PASS  shown: no burst  10 events scheduled in the first 0.3 s back, 5 in an ordinary 0.3 s; beat 35.58 -> 36.28 across 3 s hidden; late 0, dropped 0
PASS  stall: missed notes are dropped, not played in a burst  1.5 s stall: 16 dropped, 0 pad notes restarted late, 3 scheduled on catching up
PASS  stall: the beat still follows the audio clock  beat moved 2.78 in about 1.6 s (2.8 expected)
PASS  dispose(): closed for good, context closed, beat null
```

Hide and show is simulated by overriding `document.visibilityState` and dispatching
`visibilitychange`; the page is not really hidden. A refused start (a context left suspended until a
gesture) is imitated by the page, because this Chromium starts a context without a gesture
(section 9): `start()` resolved, `state` was `suspended`, the beat null, and `resume()` from a click
got it running.

**Human checks.** None of these was done; nobody has listened to this.

- H-T10-1: it sounds like synthwave and is pleasant for ten minutes. Open
  `http://127.0.0.1:5180/shots/T10/live.html`, click Start; the Seed field picks another song.
- H-T10-2: no clicks at note starts or stops on real speakers and on headphones.
- H-T10-3: the kick and bass are still audible on phone or laptop speakers, which reproduce little
  below 120 Hz, and the overall level at the app's default volume (0.7, which is -6.2 dB below
  full, so about -12.5 dBFS peak) is neither too quiet nor too loud beside other tabs.
- H-T10-4: the picture pulses with the kick as heard, including over Bluetooth, where the reported
  output latency is large.
- H-T10-5: it starts, suspends on a hidden tab and resumes in Firefox and Safari, and on a phone.

**M6 acceptance (radio), all run on 2026-11-15 on the final code.**

**A9. Sunset FM is the old song, note for note.** A fingerprint (SHA-256 over sections, chords,
energy and events of bars 0 to 599) of seeds 1, 7, 1984, 2049 and 123456 was recorded before any
change (`shots/T10/golden/`) and matches after it. The unit test `SUNSET FM is the original
soundtrack` also compares bars of `createSong(seed)` with the station's song. It caught one real
change on the way (section 9).

**A10. Unit tests.** `tests/unit/audio/stations.test.ts`, 11 tests: five stations in dial order
with distinct names, genres and tempos; every note of every station in its own scale over 240
bars (the scales are written out again in the test); no chord on a diminished triad and no
semitone rub in any pad; each groove plays as described; Plaza swings only its off-beat eighths;
deterministic, and no two stations share a bar. Breaking the Phrygian scale (a natural second for
the flat second) failed the in-scale test; restored and compared. Whole audio suite 68 of 68.

**A11. Offline renders, 32 bars from bar 0 of seed 1, full mix at volume 1** (`node shots/T10/measure.mjs --station <id> --bars 32`):

| Station | Peak dBFS | RMS dBFS | Verse / chorus RMS per bar | In clamp knee | Clicks | Voices dropped, peak active |
|---|---|---|---|---|---|---|
| sunset | -6.27 | -18.57 | -18.4 / -17.2 | 0.85 % | 0 | 0, 23 |
| obsidian | -6.29 | -17.79 | -17.4 / -16.8 | 0.92 % | 0 | 0, 26 |
| velvet | -6.27 | -18.77 | -18.8 / -17.1 | 0.75 % | 0 | 0, 22 |
| starport | -6.28 | -18.07 | -18.0 / -16.8 | 0.99 % | 0 | 0, 26 |
| plaza | -6.25 | -19.07 | -19.1 / -17.2 | 0.79 % | 1 (below) | 0, 20 |

The first renders were 3 dB apart (Obsidian -15.5 dBFS with 3.4 % of samples in the clamp knee,
its driven bass 5 dB hot). Per-part stems in the first chorus (`--stems --start 24 --bars 8`) set
the bus levels in `stations.ts`, then a whole-mix level (`level.sum`) evened the stations to within
about 1 dB of Sunset FM, so changing station does not jump in loudness. Stems show no clicks except
the kick's own beater (as on Sunset FM). Plaza's single full-mix detection at 26.0004 s is a hat
landing on a kick: no stem shows it, and `--dump` shows noise-like content, not a step.

**A12. Live switching in Chromium,** `node shots/T10/radio.mjs` (muted browser, every output summed
into one analyser), 31 of 31: tuning before `start()` makes no context; each station measured at
its tempo (104.96, 112.00, 84.26, 119.97, 77.92 BPM against 105, 112, 84, 120, 78; no null or
backward beat); each comes in mid-song within 0.1 beat of the shared clock; tuning noise heard
(-30 to -33 dBFS RMS over the first 0.4 s); each plays under the ceiling (peaks -6.4 to -7.2 dBFS
at volume 1); ten switches 80 ms apart never pass the ceiling and end on the last station at its
tempo with one context and 21 voices; a switch while suspended leaves the context's clock and
output frozen, and resume plays the new station; a switch on a hidden tab stays silent and showing
the tab again does not burst; dispose closes. The original live suite, `node shots/T10/live.mjs`,
still passes 31 of 31 (its surface check now lists `setStation` and `station`).

**Human checks for M6.**

- H-T10-6: each station sounds like its genre and like a different station from the others, and
  the tuning noise is pleasant rather than harsh. Nobody has listened yet.

## 7. Idempotence and recovery

No persistent state. `dispose()` closes the context. Every check is safe to re-run. The scratch
files under `shots/T10/` are not part of the product and can be deleted. The offline and live
scripts stub Vite's hot-reload client in their page, so a sibling saving a file does not reload the
page in the middle of a render.

## 8. Progress

- [x] 2026-11-14 M1 composition: `src/audio/theory.ts`, `src/audio/song.ts`; 56 unit tests in
  `tests/unit/audio/`, with eight deliberate breaks each shown to fail a test (section 9).
- [x] 2026-11-14 M2 voices: `src/audio/voices.ts`, twelve voices, all on a `BaseAudioContext`.
- [x] 2026-11-14 M3 scheduler and transport: `src/audio/transport.ts` (pure), `src/audio/player.ts`
  (live), `src/audio/index.ts` (public). Live path checked in Chromium, 31 of 31.
- [x] 2026-11-14 M4 mix: `src/audio/mix.ts`. Balance set from measured stems over about ten passes.
- [x] 2026-11-14 M5 measurement: harness in `shots/T10/` (`offline.html`, `harness.js`,
  `measure.mjs` for the offline render; `live.html`, `live.js`, `live.mjs` for the live path).
  Numbers in section 6.
- [x] 2026-11-14 Second composition pass after reading the song as text (`measure.mjs --describe`):
  lead keeps its line, pad colour notes no longer rub, the third chorus rises a tone, whooshes
  spaced out. Re-measured afterwards; section 6 is from the final code.

- [x] 2026-11-15 M6 radio: `src/audio/stations.ts`; styles in `song.ts`, `mix.ts`, `voices.ts`;
  tempo per station in `transport.ts`; `setStation` and the shared clock in `player.ts`; exports in
  `index.ts`; `tests/unit/audio/stations.test.ts` and two tests in `index.test.ts`. Scratch:
  `shots/T10/golden/`, `shots/T10/radio.{html,js,mjs}`, `shots/T10/radio_susp.mjs`; `harness.js`
  and `measure.mjs` take `--station`. Evidence A9 to A12.

Nothing is left open in this plan. The human checks are the remaining work and are not this task's
to close.

## 9. Surprises and discoveries

- **A `ConstantSourceNode` sounds its default value of 1 for one frame.** The side-chain pulse set
  `offset` to 0 with `setValueAtTime(0, time)` and started at `time`. When `time` is not on a sample
  boundary the source starts one frame before the automation applies, and emits 1. Evidence: the pad
  stem went from 0 clicks to 10; at the kick the sum before the master chain read
  `0.0429, 0.0816, 0.0594`, one sample at nearly double. A probe with kick times on whole samples
  (0.1 s at 44.1 kHz) showed nothing, which is why it only appeared on some kicks. Fix: set
  `offset.value = 0` when the node is made. The same shape (a default value heard before the first
  event) is harmless in the voices, where the amplitude is 0 at that moment.
- **The browser's convolver normalization made the gated reverb nearly inaudible.** With
  `normalize` on, the browser scales the impulse by a factor of its own (in Chromium about 0.00125
  over the impulse's RMS [M], which for a 0.3 s impulse returns about 17 dB less energy than is
  sent). Measured: the snare's tail sat 14 dB under its first 20 ms. The mixer now sets
  `normalize = false` and scales its impulses to unit energy itself, so levels do not depend on the
  browser.
- **A gated reverb needs a short send.** Feeding the whole 0.22 s snare into the gated room gave a
  tail that died at the snare's own rate (about 3 dB per 20 ms after the cut). Sending only the
  first 70 ms gives the hold-then-shut shape. On the final code, in 20 ms windows before the master
  chain (`--profile snare --start 24 --from 0.72`): the hit at -17.4 dB, the room from -19.0 falling
  slowly to -26.6 dB over 0.3 s, then -37.9 and -58.0 dB.
- **The master compressor delays by 6 ms.** The discontinuity above showed at the kick before the
  master chain and 264 samples later after it. Worth knowing when reading a click time.
- **The first compressor setting flattened the song.** Threshold -18 dB, ratio 3: intro with drums,
  verse and chorus all measured -18.6 dBFS. Looser (threshold -14 dB, ratio 2.5, the sum taken down
  3 dB before it) plus softer kick, snare and bass outside the chorus gives the 1.2 dB step from
  verse to chorus recorded above. The step is modest; most of the lift is arrangement.
- **Three click detectors.** Jump against the RMS around it flagged every edge of a filtered saw
  (414 on a clean bass stem). Jump against the largest jump within 30 ms passed the clean stems but
  missed a deliberate hard cut. Adding the second difference (a kink) to that test sees cuts down to
  a tenth of the local peak on stems. See A5 for what it cannot see.
- **A spectrum cannot tune a sixteenth note.** Notes 0.11 s long smear across about 9 Hz, which is
  two semitones at 65 Hz; measuring them gave errors of -60 cents that were the method's, not the
  synth's. The tuning check uses the long bass notes of a break and held pad chords.
- **This Chromium starts an `AudioContext` without a gesture,** also with
  `--autoplay-policy=document-user-activation-required` [O]. The refused-start path is therefore
  imitated in the page (`?blocked=1`), not observed in a browser that really refuses.
- **The shared dev server reloads a scratch page when anyone saves.** A render died with
  "Execution context was destroyed". The scripts now answer `/@vite/client` with a stub.
- **Tests that agree by construction.** The first "every note is in the key" test used the module's
  own scale table, so swapping the minor third for a major one did not fail it. It now carries its
  own copy of the scale. Deliberate breaks, each failing at least one test and then reverted
  (the files were compared byte for byte with a backup afterwards): major third in the scale; late
  events played instead of dropped; ceiling raised to 0.51; no snare on beat four; an `AudioContext`
  made at creation; lead not moved to chord tones; bar randomness drawn from a shared stream; bass a
  semitone sharp.
- **Reading the song as text found what the numbers could not.** The first lead moved every note
  that fell on a beat to a chord tone, which collapsed a motif to `C C C D C`; a major seventh was
  voiced a semitone under its root; a ninth on the v chord is a minor ninth. All three were fixed in
  the composition and are now tested.

- **A theory helper given a scale argument broke `[...].map(degreeToSemitones)` (2026-11-15).**
  `map` passes the index as the second argument, which became the scale: the theory test received
  `NaN`s. The test now calls it through an arrow; TypeScript rejects the bare form, so a caller in
  `src` cannot make the same mistake unnoticed.
- **The fingerprint caught a change to Sunset FM (2026-11-15).** Making the arpeggio's length and
  stereo side follow the arpeggio speed changed Sunset FM's slow arpeggio (intro and first verse),
  where the old code always gave one step and panned by step. Both now follow the station's
  multiplier only, which is 1 for Sunset FM.
- **A suspended context freezes an analyser on its last buffer (2026-11-15).** The first radio
  check read a peak of 0.042 after a switch while suspended; the context's clock stood still at
  3.120 s and the analyser returned the same samples, captured mid-fade. Silence while suspended is
  now checked as a stopped clock and an unchanged output.

## 10. Decision log

All dated 2026-11-14.

- **Bar n is a pure function of the seed and n.** No sequencer state; movements are cached, bars are
  built on demand. Reason: the scheduler can skip, restart or start in the middle, and a test can ask
  for any bar.
- **Lookahead 200 ms, not the plan's 120 or Agents.md's 100.** Nothing here reacts to input, so a
  longer lookahead costs nothing audible, and it rides out a longer stall of the main thread, which
  a WebGL page has. Mute and suspend act on gains, not on what is scheduled, so they stay immediate.
- **After a stall, drop; do not catch up.** Events whose time has passed are skipped. The one
  exception is a pad chord with at least a beat left to ring, restarted from now and shortened, so a
  stall does not leave a bar with no harmony. This is also what makes a return from a hidden tab
  safe if the context was not suspended in time.
- **Hidden tab: fade, then suspend the context.** The audio clock stops, so the music resumes where
  it was and there is nothing to reset. The module listens for `visibilitychange` itself; the app
  also calls `suspend()` and `resume()` on the same event, and the two do not conflict (two
  independent reasons to be stopped, both cleared on return).
- **The beat is `currentTime`, carried forward by the wall clock for at most 50 ms between audio
  callbacks, minus the reported output latency (capped at 0.3 s), never running backwards.** Not
  `getOutputTimestamp()`, which I did not trust across browsers [M]. Measured: within 6.7 ms of a
  straight line, sampled on every animation frame for 5 s (721 frames).
- **The side-chain is one short-lived `ConstantSourceNode` per kick, added to the duck gains.** The
  first version scheduled `setTargetAtTime` pairs on the three long-lived gain parameters. That
  works, but it adds events to the same three timelines for as long as the music plays, and whether
  every browser discards old automation events was not tested. The pulse's automation dies with its
  node. Dips add, so a second kick within 0.2 s of the last does not duck.
- **Master chain: compressor, trim, soft clamp at 0.49 (-6.2 dBFS), then volume and the fade gate.**
  The clamp is a wave shaper that is a straight wire up to 0.36 and bends towards 0.49 above it; the
  volume and gate never exceed 1, so the ceiling holds in any browser whatever the compressor does.
  About 0.6 to 0.9 % of samples, kick and snare transients, pass through the bend. No second limiter.
- **Volume is squared; the default is 0.8.** A linear slider feels top-heavy. The app's 0.7 is
  -6.2 dB.
- **`start()`, `suspend()` and `resume()` return promises that never reject,** and `start()` settles
  within 0.4 s even when the browser leaves the context suspended. The state says what happened.
- **`energy()` returns 1 when not running,** the value the engine assumes with no source.
- **One note is one set of nodes,** as the plan says, with a limit of 64 sounding voices: hats,
  arpeggio and whooshes are dropped first, everything but kick and snare at 88. Normal play peaks at
  25, so the limit is a guard, not a feature.
- **More voices than the plan lists:** a plucked arpeggio, toms, a crash and a noise riser. They are
  what makes sections and their joins sound different from each other.
- **Form.** The first movement is intro, verse, verse, chorus, break, verse, chorus, chorus; later
  ones draw one of four forms that open on a break or an intro, so the key changes across a quiet
  section. Verse progressions start on the tonic, most chorus progressions on VI or iv. A section
  never ends at rest on the tonic chord. The third chorus of a movement is raised a tone.
- **The lead is a two-bar motif used as statement, repeat with a changed ending, contrast, return.**
  Repetition is what makes it memorable. The motif is a walk through the scale that mostly keeps its
  direction; notes on beats one and three, long notes and endings move to the nearest chord tone,
  the rest keep the line. Every melody comes from these rules and a seed; none is taken from a song.
- **Colour notes:** v always takes a seventh (its ninth is a minor ninth) and VII a ninth (its
  seventh makes a dominant seventh); a colour note a semitone from a triad note goes up an octave.
- **No rendered audio is written to disk,** not even as a scratch file for listening: the rule is
  no audio files of any kind. `shots/T10/live.html` is the listening page.
- **The live check runs the browser with `--mute-audio`,** so the tests do not play through this
  machine's speakers. The graph still runs and is measured through an analyser.

- **Five stations are styles of the one generator, not five generators (2026-11-15).** Endless,
  seeded by the city, and the measured behaviour of M1 to M5 carries over. What makes a station
  distinct is what a listener hears first in these genres: tempo, scale, groove, bass, and the
  instruments' timbre.
- **Sunset FM stays byte-identical (2026-11-15).** Every new knob defaults to the old value, and
  the optional mixer stages (bass drive, tape wobble, tape low-pass) are only built when a station
  asks for them. Its song seed is the city seed; the others hash the city seed with their place on
  the dial.
- **A station may have its own tempo; `BPM` in the contracts is unchanged (2026-11-15).** The
  engine already takes the beat from `beatPosition()` and uses `BPM` only when audio is off, so no
  contract change was needed. `beatAt` and `timeAt` take an optional tempo.
- **Tuning lands mid-song on a shared clock (2026-11-15).** Radio feels live when a station is
  somewhere in its song rather than starting over; the start of the bar in progress keeps the
  entry musical, and the scheduler's existing late-pad rule supplies the harmony at once. The beat
  jumps at a switch (beat positions differ by tempo), which the picture shows as one pulse.
- **A new mixer per switch, the old one faded and disposed (2026-11-15).** Simpler than
  re-patching a running graph, nothing ringing is cut, and voices still scheduled on the old mixer
  play into a closed gate. Ten switches in 0.8 s peaked at 21 voices.
- **Loudness evened by measurement, not by a loudness normaliser (2026-11-15).** Per-bus levels plus
  one whole-mix level per station; all five sit within about 1 dB of Sunset FM.

## 11. Contract change requests

None. `BeatSource` was enough as it stands.

## 12. Outcomes and retrospective

**Against Purpose.** The module synthesizes an endless track at `BPM` with no sound files: kick,
gated snare, hats, toms, crash, riser, sixteenth-note bass, side-chained pads, arpeggio, lead with
delay, a city bed and whooshes. It creates nothing until `start()`, mutes and suspends without a
click by measurement, never exceeded -6.22 dBFS in about 17 minutes of offline rendering across four
seeds, and supplies a beat that tracked the audio clock at 105.005 BPM. Ten minutes of any of the six
tested seeds change key at least three times, use all four kinds of section, and never play the same
eight bars in two neighbouring sections (unit-tested).

**Gaps and what was not verified.**

- How it sounds. Every judgement about balance and tone here is from numbers: levels, spectra,
  envelopes, note names. Whether it is pleasant, whether the snare is "big", whether the lead is
  memorable, is H-T10-1 and has not been done.
- Clicks on real speakers (H-T10-2). The measurement finds discontinuities; it does not find
  everything an ear calls a click, and on the full mix it only sees large ones.
- Any browser but headless Chromium 1234 on this machine. Firefox, Safari and phones are untested.
- A real refusal to start audio without a gesture: imitated only.
- A really hidden tab: simulated by overriding `document.visibilityState`. In a hidden tab the
  70 ms timer that suspends the context can be delayed by the browser's timer throttling [I]; the
  output is already faded by then, and the scheduler drops anything missed.
- The `interrupted` state of mobile Safari: handled in code by reading `ctx.state`, never observed.
- The output-latency correction of the beat: the arithmetic is tested, the perceived sync is not
  (H-T10-4).
- CPU cost on a slow device. An offline render runs about 12 times faster than real time here,
  which says little about a phone.
- Long runs: the longest single render was 165 s, and the live check runs under a minute. The design
  avoids anything that accumulates, but hours of playback were not run.
- The module inside the finished app. It type-checks against `src/app/app.ts` as it stood today
  (`0 error(s) elsewhere` above); the app was not booted with it by this task.

**Retrospective.** Building the measurement first paid for itself twice: the stems drove the balance
from a mix that was 30 dB darker in the highs than in the lows to the table above, and the click
detector caught a defect I had reasoned was impossible. What numbers could not do was judge the
music; printing the song as chords and note names was the closest substitute and changed the
composition more than any spectrum did.

**M6 outcome (2026-11-15).** Five stations, each its own style and sound at its own tempo, switch
live with tuning noise and land mid-song; Sunset FM is unchanged note for note. Measured: tempo,
level, ceiling, clicks on stems, switching while playing, suspended and hidden. Not verified: how
any of it sounds (H-T10-6); any browser but headless Chromium on this machine, and phones; CPU
cost of the FM and tape voices on a slow device (Velvet and Plaza start about half as many voices
as Sunset FM, but each FM note is two oscillators); long sessions with many switches beyond the
ten-switch run.
