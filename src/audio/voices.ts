// The instruments. Each one builds its nodes for a single note, schedules every change on the audio
// clock, and takes itself apart when its last source ends. Sources are one-shot, so a note is a new
// set of nodes; only the noise buffer is shared. Envelopes are ramps and targets that start and end
// at zero, never jumps, so no note clicks.
import type { Mix } from './mix';
import { Voice, type NoteEvent } from './song';
import { midiToHz } from './theory';

/** Count the voice, and release its nodes when `last`, the source that stops last, has ended. */
function own(mix: Mix, last: AudioScheduledSourceNode, outputs: readonly AudioNode[]): void {
  mix.voices.active++;
  mix.voices.started++;
  last.onended = (): void => {
    mix.voices.active--;
    for (const node of outputs) node.disconnect();
  };
}

function oscillator(mix: Mix, type: OscillatorType, hz: number, cents: number, start: number, stop: number): OscillatorNode {
  const osc = mix.ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = hz;
  osc.detune.value = cents;
  osc.start(start);
  osc.stop(stop);
  return osc;
}

/** A stretch of the shared noise, starting somewhere different for each voice. */
function noise(mix: Mix, start: number, stop: number): AudioBufferSourceNode {
  const source = mix.ctx.createBufferSource();
  source.buffer = mix.noise;
  source.loop = true;
  source.start(start, (mix.voices.started * 0.2371) % (mix.noise.duration - 0.01));
  source.stop(stop);
  return source;
}

function lowpass(mix: Mix, q: number): BiquadFilterNode {
  const node = mix.ctx.createBiquadFilter();
  node.type = 'lowpass';
  node.Q.value = q;
  return node;
}

function shaped(mix: Mix, type: BiquadFilterType, hz: number, q: number): BiquadFilterNode {
  const node = mix.ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = hz;
  node.Q.value = q;
  return node;
}

function silentGain(mix: Mix): GainNode {
  const node = mix.ctx.createGain();
  node.gain.value = 0;
  return node;
}

/**
 * Percussive envelope: up in `attack`, exponentially down to `floor` times the peak just before
 * `end`, then to exactly zero over the last few milliseconds. A higher floor is a slower decay.
 */
function strike(param: AudioParam, time: number, peak: number, attack: number, end: number, floor = 0.001): void {
  param.setValueAtTime(0, time);
  param.linearRampToValueAtTime(peak, time + attack);
  param.exponentialRampToValueAtTime(peak * floor, end - RELEASE);
  param.linearRampToValueAtTime(0, end);
}

/** The last stretch of a percussive envelope, a straight line down to zero. */
const RELEASE = 0.006;

/** Send a mono voice to its bus, through a panner only when it is off-centre. */
function toBus(mix: Mix, from: AudioNode, bus: AudioNode, pan: number): AudioNode {
  if (pan === 0) {
    from.connect(bus);
    return from;
  }
  const panner = mix.ctx.createStereoPanner();
  panner.pan.value = pan;
  from.connect(panner).connect(bus);
  return panner;
}

// ---- Drums ------------------------------------------------------------------------------------------

/** Sine with a fast pitch drop for the thump, and a few milliseconds of noise for the beater. */
function kick(mix: Mix, time: number, velocity: number): void {
  const end = time + 0.33;
  const body = oscillator(mix, 'sine', 180, 0, time, end);
  body.frequency.setValueAtTime(180, time);
  body.frequency.exponentialRampToValueAtTime(54, time + 0.09);
  body.frequency.exponentialRampToValueAtTime(45, end);
  const amp = silentGain(mix);
  amp.gain.setValueAtTime(0, time);
  amp.gain.linearRampToValueAtTime(velocity, time + 0.0015);
  amp.gain.setValueAtTime(velocity, time + 0.02);
  amp.gain.exponentialRampToValueAtTime(velocity * 0.012, end - RELEASE);
  amp.gain.linearRampToValueAtTime(0, end);
  body.connect(amp).connect(mix.kick);

  const click = noise(mix, time, time + 0.02);
  const clickAmp = silentGain(mix);
  strike(clickAmp.gain, time, velocity * 0.22, 0.0005, time + 0.018);
  click.connect(shaped(mix, 'bandpass', 3200, 0.8)).connect(clickAmp).connect(mix.kick);

  own(mix, body, [amp, clickAmp]);
  mix.duck(time, velocity);
}

/**
 * Filtered noise over two short tones. `room` is how much goes to the gated reverb; only the first
 * few hundredths of a second are sent, so the room holds and then shuts instead of trailing off.
 */
function snare(mix: Mix, time: number, velocity: number, room: number): void {
  const end = time + 0.22;
  const out = mix.ctx.createGain();
  const rattle = noise(mix, time, end);
  const band = shaped(mix, 'lowpass', 7500, 0.6);
  rattle.connect(shaped(mix, 'highpass', 900, 0.6)).connect(band);
  const rattleAmp = silentGain(mix);
  strike(rattleAmp.gain, time, velocity * 0.9, 0.001, end, 0.02);
  band.connect(rattleAmp).connect(out);

  const low = oscillator(mix, 'triangle', 215, 0, time, time + 0.16);
  low.frequency.setValueAtTime(215, time);
  low.frequency.exponentialRampToValueAtTime(165, time + 0.06);
  const lowAmp = silentGain(mix);
  strike(lowAmp.gain, time, velocity * 0.7, 0.001, time + 0.15);
  low.connect(lowAmp).connect(out);

  const high = oscillator(mix, 'sine', 345, 0, time, time + 0.1);
  high.frequency.setValueAtTime(345, time);
  high.frequency.exponentialRampToValueAtTime(250, time + 0.04);
  const highAmp = silentGain(mix);
  strike(highAmp.gain, time, velocity * 0.35, 0.001, time + 0.09);
  high.connect(highAmp).connect(out);

  out.connect(mix.snare);
  const send = silentGain(mix);
  strike(send.gain, time, velocity * room, 0.001, time + GATED_SEND);
  band.connect(send).connect(mix.gated);
  own(mix, rattle, [out, send]);
}

/** How long a drum feeds the gated reverb. */
const GATED_SEND = 0.07;

function tom(mix: Mix, time: number, midi: number, velocity: number, room: number): void {
  const end = time + 0.34;
  const hz = midiToHz(midi);
  const body = oscillator(mix, 'sine', hz, 0, time, end);
  body.frequency.setValueAtTime(hz * 1.55, time);
  body.frequency.exponentialRampToValueAtTime(hz, time + 0.07);
  const amp = silentGain(mix);
  strike(amp.gain, time, velocity, 0.002, end, 0.01);
  const out = mix.ctx.createGain();
  body.connect(amp).connect(out);

  const skin = noise(mix, time, time + GATED_SEND);
  const skinBand = shaped(mix, 'bandpass', 2400, 0.7);
  skin.connect(skinBand);
  const skinAmp = silentGain(mix);
  strike(skinAmp.gain, time, velocity * 0.25, 0.001, time + 0.045);
  skinBand.connect(skinAmp).connect(out);

  out.connect(mix.perc);
  const send = silentGain(mix);
  strike(send.gain, time, velocity * room, 0.001, time + GATED_SEND);
  skinBand.connect(send).connect(mix.gated);
  own(mix, body, [out, send]);
}

/** High-passed noise: a tick when closed, a short wash when open. */
function hat(mix: Mix, time: number, velocity: number, pan: number, ring: number): void {
  const end = time + ring;
  const source = noise(mix, time, end);
  const amp = silentGain(mix);
  strike(amp.gain, time, velocity, 0.001, end);
  source.connect(shaped(mix, 'highpass', 7200, 0.7)).connect(shaped(mix, 'lowpass', 12500, 0.5)).connect(amp);
  own(mix, source, [toBus(mix, amp, mix.hats, pan)]);
}

function crash(mix: Mix, time: number, velocity: number): void {
  const end = time + 1.7;
  const source = noise(mix, time, end);
  const amp = silentGain(mix);
  strike(amp.gain, time, velocity * 0.5, 0.003, end);
  source.connect(shaped(mix, 'highpass', 3800, 0.6)).connect(shaped(mix, 'lowpass', 11000, 0.5)).connect(amp).connect(mix.perc);
  own(mix, source, [amp]);
}

/** A band of noise that climbs and swells for the whole of `seconds`, then lets go. */
function riser(mix: Mix, time: number, seconds: number, velocity: number): void {
  const top = time + seconds;
  const end = top + 0.06;
  const source = noise(mix, time, end);
  const band = shaped(mix, 'bandpass', 400, 1.6);
  band.frequency.setValueAtTime(400, time);
  band.frequency.exponentialRampToValueAtTime(6500, top);
  const amp = silentGain(mix);
  amp.gain.setValueAtTime(0, time);
  amp.gain.linearRampToValueAtTime(velocity * 0.02, time + 0.05);
  amp.gain.exponentialRampToValueAtTime(velocity * 0.45, top);
  amp.gain.linearRampToValueAtTime(0, end);
  source.connect(band).connect(amp).connect(mix.perc);
  own(mix, source, [amp]);
}

/** Something passing far off: a band of noise that swells, drops in pitch and crosses the stereo field. */
function whoosh(mix: Mix, time: number, seconds: number, velocity: number, colour: number, direction: number): void {
  const end = time + seconds;
  const source = noise(mix, time, end);
  const centre = 320 + 700 * colour;
  const band = shaped(mix, 'bandpass', centre, 1.1);
  band.frequency.setValueAtTime(centre, time);
  band.frequency.exponentialRampToValueAtTime(centre * 1.5, time + seconds * 0.45);
  band.frequency.exponentialRampToValueAtTime(centre * 0.6, end);
  const amp = silentGain(mix);
  amp.gain.setValueAtTime(0, time);
  amp.gain.linearRampToValueAtTime(velocity * 0.13, time + seconds * 0.5);
  amp.gain.linearRampToValueAtTime(0, end);
  const panner = mix.ctx.createStereoPanner();
  panner.pan.setValueAtTime(-0.85 * direction, time);
  panner.pan.linearRampToValueAtTime(0.85 * direction, end);
  source.connect(band).connect(amp).connect(panner).connect(mix.ambience);
  own(mix, source, [panner]);
}

// ---- Pitched voices ---------------------------------------------------------------------------------

/** Two detuned saws through a resonant low-pass that snaps shut, over a sine at the same pitch. */
function bass(mix: Mix, time: number, seconds: number, midi: number, velocity: number, tone: number): void {
  const hz = midiToHz(midi);
  const off = time + seconds;
  const end = off + 0.08;
  const saws = mix.ctx.createGain();
  saws.gain.value = 0.42;
  const a = oscillator(mix, 'sawtooth', hz, -7, time, end);
  const b = oscillator(mix, 'sawtooth', hz, 7, time, end);
  a.connect(saws);
  b.connect(saws);
  const filter = lowpass(mix, 2 + 2.5 * tone);
  const floor = 170 + 420 * tone;
  const peak = floor + (600 + 3600 * tone) * (0.45 + 0.55 * velocity);
  filter.frequency.setValueAtTime(peak, time);
  filter.frequency.setTargetAtTime(floor, time + 0.004, 0.05);
  const amp = silentGain(mix);
  amp.gain.setValueAtTime(0, time);
  amp.gain.setTargetAtTime(velocity, time, 0.003);
  amp.gain.setTargetAtTime(0, off, 0.009);
  saws.connect(filter).connect(amp);
  // The sub goes round the filter so the bottom stays put while the filter moves.
  const sub = oscillator(mix, 'sine', hz, 0, time, end);
  const subLevel = mix.ctx.createGain();
  subLevel.gain.value = 0.55;
  sub.connect(subLevel).connect(amp);
  amp.connect(mix.bass);
  own(mix, sub, [amp]);
}

/** One note of a chord: two saws drifting against each other, a slow swell, a filter that opens with it. */
function pad(mix: Mix, time: number, seconds: number, midi: number, velocity: number, tone: number, pan: number): void {
  const hz = midiToHz(midi);
  const off = time + seconds;
  const end = off + 1.9;
  const spread = 7 + (midi % 5);
  const a = oscillator(mix, 'sawtooth', hz, -spread, time, end);
  const b = oscillator(mix, 'sawtooth', hz, spread, time, end);
  const filter = lowpass(mix, 0.6);
  const open = 650 + 2700 * tone;
  filter.frequency.setValueAtTime(open * 0.45, time);
  filter.frequency.setTargetAtTime(open, time, 0.5);
  const amp = silentGain(mix);
  amp.gain.setValueAtTime(0, time);
  amp.gain.setTargetAtTime(velocity * 0.5, time, 0.13);
  amp.gain.setTargetAtTime(0, off, 0.27);
  a.connect(filter);
  b.connect(filter);
  filter.connect(amp);
  own(mix, a, [toBus(mix, amp, mix.pad, pan)]);
}

/** A pluck: saw and square through a filter that closes in a few hundredths of a second. */
function arp(mix: Mix, time: number, midi: number, velocity: number, tone: number, pan: number): void {
  const hz = midiToHz(midi);
  const end = time + 0.42;
  const a = oscillator(mix, 'sawtooth', hz, -5, time, end);
  const b = oscillator(mix, 'square', hz, 5, time, end);
  const squareLevel = mix.ctx.createGain();
  squareLevel.gain.value = 0.45;
  const filter = lowpass(mix, 2.2);
  const floor = 500 + 500 * tone;
  filter.frequency.setValueAtTime(floor + 1200 + 5200 * tone, time);
  filter.frequency.setTargetAtTime(floor, time + 0.003, 0.05);
  const amp = silentGain(mix);
  strike(amp.gain, time, velocity * 0.7, 0.002, end);
  a.connect(filter);
  b.connect(squareLevel).connect(filter);
  filter.connect(amp);
  own(mix, a, [toBus(mix, amp, mix.arp, pan)]);
}

/** Two saws and a square, a filter that follows the note, vibrato that arrives late, and a slide in. */
function lead(mix: Mix, time: number, seconds: number, midi: number, velocity: number, tone: number, glide: number): void {
  const hz = midiToHz(midi);
  const off = time + seconds;
  const end = off + 0.35;
  const oscs = [
    oscillator(mix, 'sawtooth', hz, -8, time, end),
    oscillator(mix, 'sawtooth', hz, 8, time, end),
    oscillator(mix, 'square', hz, 0, time, end),
  ];
  const squareLevel = mix.ctx.createGain();
  squareLevel.gain.value = 0.4;
  const filter = lowpass(mix, 1.3);
  const open = Math.min(7000, hz * 2.2 + 700 + 2600 * tone);
  filter.frequency.setValueAtTime(open * 1.7, time);
  filter.frequency.setTargetAtTime(open, time + 0.01, 0.09);
  oscs[0]!.connect(filter);
  oscs[1]!.connect(filter);
  oscs[2]!.connect(squareLevel).connect(filter);
  if (glide !== 0) {
    const from = midiToHz(midi + glide);
    for (const osc of oscs) {
      osc.frequency.setValueAtTime(from, time);
      osc.frequency.exponentialRampToValueAtTime(hz, time + 0.05);
    }
  }
  let vibrato: OscillatorNode | null = null;
  if (seconds > 0.3) {
    // Vibrato in cents, fading in once the note has settled.
    vibrato = oscillator(mix, 'sine', 5.6, 0, time, end);
    const depth = silentGain(mix);
    depth.gain.setValueAtTime(0, time + 0.16);
    depth.gain.linearRampToValueAtTime(13, time + 0.5);
    vibrato.connect(depth);
    for (const osc of oscs) depth.connect(osc.detune);
  }
  const amp = silentGain(mix);
  amp.gain.setValueAtTime(0, time);
  amp.gain.setTargetAtTime(velocity * 0.5, time, 0.006);
  if (seconds > 0.08) amp.gain.setTargetAtTime(velocity * 0.4, time + 0.05, 0.12);
  amp.gain.setTargetAtTime(0, off, 0.045);
  filter.connect(amp).connect(mix.lead);
  own(mix, oscs[0]!, [amp]);
}

// ---- Dispatch ---------------------------------------------------------------------------------------

/** Parts that are dropped first when too many voices are sounding. */
function isExpendable(voice: number): boolean {
  return voice === Voice.hat || voice === Voice.openHat || voice === Voice.arp || voice === Voice.whoosh;
}

/** How far past the limit the essential parts may go before they are dropped too. */
const VOICE_HEADROOM = 24;

/**
 * Play one event of the composition at `time` on the mixer's audio clock, lasting `seconds`.
 * Returns false when the note was skipped to keep the number of voices bounded.
 */
export function playEvent(mix: Mix, event: NoteEvent, time: number, seconds: number): boolean {
  const { voice, velocity } = event;
  // An exponential ramp cannot start from or reach zero, and a note with no length has no envelope.
  if (!(velocity > 0.001) || !(seconds > 0)) return false;
  const active = mix.voices.active;
  if (active >= mix.maxVoices && (isExpendable(voice) || (active >= mix.maxVoices + VOICE_HEADROOM && voice !== Voice.kick && voice !== Voice.snare))) {
    mix.voices.dropped++;
    return false;
  }
  switch (voice) {
    case Voice.kick: kick(mix, time, velocity); break;
    case Voice.snare: snare(mix, time, velocity, event.tone); break;
    case Voice.hat: hat(mix, time, velocity, event.pan, 0.05); break;
    case Voice.openHat: hat(mix, time, velocity, event.pan, Math.min(0.32, Math.max(0.12, seconds))); break;
    case Voice.tom: tom(mix, time, event.midi, velocity, event.tone); break;
    case Voice.crash: crash(mix, time, velocity); break;
    case Voice.riser: riser(mix, time, seconds, velocity); break;
    case Voice.bass: bass(mix, time, seconds, event.midi, velocity, event.tone); break;
    case Voice.pad: pad(mix, time, seconds, event.midi, velocity, event.tone, event.pan); break;
    case Voice.arp: arp(mix, time, event.midi, velocity, event.tone, event.pan); break;
    case Voice.lead: lead(mix, time, seconds, event.midi, velocity, event.tone, event.glide); break;
    case Voice.whoosh: whoosh(mix, time, seconds, velocity, event.tone, event.pan); break;
  }
  return true;
}
