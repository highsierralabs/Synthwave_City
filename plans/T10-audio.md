---
id: T10-audio
title: Generative soundtrack and the beat
status: ready
depends_on: [T00]
owns: [src/audio/**, tests/unit/audio/**, plans/T10-audio.md]
reads: [architecture.md, Agents.md, src/contracts/**, src/core/**]
updated: 2026-11-14
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

## 3. Scope

Owns `src/audio/**`. Non-goals: UI for volume or mute (T12 calls this module's functions), positional
audio tied to scene objects.

## 4. Interfaces

Provides from `src/audio/index.ts`: `createAudio(options)` returning an object with `start()` (must be
called inside a gesture), `suspend()`, `resume()`, `setVolume(0..1)`, `setMuted(boolean)`, `beat`
(a `BeatSource`), `state`, and `dispose()`. Consumes `BPM`, `src/core/random.ts`.

## 5. Plan of work

**M1. Composition (pure).** A sequencer that, given a bar number, returns the events of that bar:
kick on every beat; snare on 2 and 4; closed hats on eighths or sixteenths with an occasional open
hat; a sixteenth-note bass arpeggio following the chord; pad chords one per bar or two; a lead phrase
from the chord's scale on some sections. Structure: 8-bar sections (intro, verse, chorus, break)
chosen in a long deterministic cycle, with a few chord progressions in minor keys (for example
Am F C G; Dm Bb F C; Em C G D) and a key change now and then. Proof: unit tests that every event time
lies inside its bar, notes lie in the scale, the same seed gives the same song, and sections vary.

**M2. Voices.** Kick: sine with a fast pitch drop and a click. Snare: noise burst plus tone through a
bandpass, with a gated reverb tail (noise convolution or a short feedback network, cut off abruptly;
the 80s sound). Hats: high-passed noise. Bass: two detuned saws through a resonant low-pass with an
envelope. Pad: several detuned saws, slow attack, low-pass, chorus from modulated delays. Lead: square
or saw with vibrato and a tempo-synced delay. Each voice is a function `play(time, params)` that
builds its nodes, schedules them and cleans up on `onended`.

**M3. Scheduler and transport.** The lookahead pattern: a timer every 25 ms schedules all events due
in the next 120 ms against `audioContext.currentTime`. `beat` reports the fractional beat position
from the audio clock so the picture follows the sound, not the other way round. Handle `suspend` and
`resume`, tab hide and show (no burst on return), and `interrupted` states.

**M4. Mix.** Side-chain: pads and bass duck on each kick (a gain automation, not a compressor
side-chain). Master: gentle compressor, then a limiter-style clamp, peak under -6 dBFS, a fade-in of a
second or two on start. City bed: filtered brown noise with slow movement, very quiet, plus rare
distant whooshes.

**M5. Check by measurement.** Render 16 bars with `OfflineAudioContext` in the browser (a small
harness page or the dev page behind a flag is T00's; if none exists, do it from a scratch HTML file
under `shots/` served by the dev server) and report peak level, RMS and whether any sample clips.
Listening is a human check.

## 6. Validation and acceptance

- `npm run check:task -- T10` exits 0, including the composition tests.
- The offline render reports peak at or below -6 dBFS and no clipped samples; the numbers are pasted
  into this plan.
- Creating the module without a gesture creates no `AudioContext`.
- In a browser run: `start()` inside a click reaches state `running`; `beat.beatPosition()` advances
  at `BPM`; hide and show the page does not burst.

Human checks: H-T10-1, it sounds like synthwave and is pleasant for ten minutes; H-T10-2, no clicks at
note starts or stops on real speakers.

## 7. Idempotence and recovery

No persistent state. `dispose()` closes the context.

## 8. Progress

- [ ] M1 composition
- [ ] M2 voices
- [ ] M3 scheduler and transport
- [ ] M4 mix
- [ ] M5 measurement

## 9. Surprises and discoveries

None yet.

## 10. Decision log

None yet.

## 11. Contract change requests

None.

## 12. Outcomes and retrospective

Not yet written.
