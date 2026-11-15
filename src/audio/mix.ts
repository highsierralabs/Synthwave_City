// The mixer: one bus per part, the shared effects, the side-chain, the city bed and the master chain.
// It takes any BaseAudioContext, so the live AudioContext and an OfflineAudioContext run the same graph.
//
//   kick ─ saturator ─┐
//   snare, hats, perc ┼─ drums ─────────────────────────────┐
//   gated send ─ gated reverb ─┘                            │
//   bass ─ duck ────────────────────────────────────────────┤
//   pad ─ high-pass ─ chorus ─ duck ─┬──────────────────────┤
//   arp ─ duck ─┬────────────────────│──────────────────────┼─ premaster ─ shelf ─ high-pass ─
//   lead ───────┼────────────────────│──────────────────────┤     compressor ─ trim ─ clamp ─
//               ├─ ping-pong delay ──│──────────────────────┤     volume ─ gate ─ output
//               └─ reverb ───────────┴──────────────────────┤
//   city bed, whooshes ─ ambience ──────────────────────────┘
//
// A SoundStyle (one per radio station, src/audio/stations.ts) picks the instruments, the tempo the
// delay is timed to, the rooms and the levels. Three stages exist only where a style asks for them:
// drive on the bass bus, a tape wobble (a modulated delay on the whole mix, after premaster) and a
// tape low-pass (after the shelf). SUNSET_SOUND has none of them and is the original graph.
import { BPM } from '../contracts/constants';
import { createRng, hashInts, type Rng } from '../core/random';

/** Nothing leaves the clamp above this: -6.2 dBFS. */
export const CEILING = 0.49;
/** The clamp is transparent below this level and bends above it. */
export const CLAMP_KNEE = 0.36;

/** Voices that may sound at once before quiet parts are dropped. */
export const DEFAULT_MAX_VOICES = 64;

/**
 * The side-chain: how far each bus dips on a full-strength kick (1 would be silence), how fast it
 * goes down, how long it is held there and the time constant of the way back, in seconds.
 */
const DUCK = { pad: 0.72, bass: 0.5, arp: 0.4, attack: 0.006, hold: 0.035, recover: 0.09, minGap: 0.2 } as const;

/** What one station sounds like. The composition is a SongStyle in song.ts. */
export interface SoundStyle {
  /** Tempo of the station; the delay is timed to it and the player keeps time with it. */
  readonly bpm: number;
  /** Kick: start, settled and final pitch in Hz, seconds to settle, length, beater click level. */
  readonly kick: { readonly from: number; readonly to: number; readonly tail: number; readonly drop: number; readonly length: number; readonly click: number };
  /** Saturation of the kick bus; higher is harder. */
  readonly kickDrive: number;
  /** `gated`: the 80s snare into the gated room. `clap`: three slaps and a tail. `soft`: a light brushed snare. */
  readonly snare: 'gated' | 'clap' | 'soft';
  /** `saw`: two saws and a sub. `grit`: the same, more resonant, for a driven bus. `pluck`: saw and square, snappy. `round`: triangle and sine, smooth. */
  readonly bass: 'saw' | 'grit' | 'pluck' | 'round';
  /** Saturation of the bass bus; 0 leaves it clean (no stage is built). */
  readonly bassDrive: number;
  /** `saw`: bright detuned saws. `dark`: the same, closed down. `glass`: soft triangles. `keys`: an FM electric piano. */
  readonly pad: 'saw' | 'dark' | 'glass' | 'keys';
  /** `pluck`: saw and square. `square`: bright squares an octave apart. `bell`: an FM bell. `mallet`: a short FM mallet. */
  readonly arp: 'pluck' | 'square' | 'bell' | 'mallet';
  /** `saw`: saws and a square. `square`: a bright square with fast vibrato. `flute`: soft and breathy. `muted`: a filtered square that opens slowly. */
  readonly lead: 'saw' | 'square' | 'flute' | 'muted';
  /** Length of the hall reverb's impulse. */
  readonly reverbSeconds: number;
  /** Delay time in beats: 0.75 a dotted eighth, 0.5 an eighth. */
  readonly delayBeats: number;
  readonly delayFeedback: number;
  /** Depth of the pad chorus, 1 as designed. */
  readonly chorusDepth: number;
  /** Corner of a tape low-pass over the whole mix, Hz; 0 for none. */
  readonly tape: number;
  /** Tape wobble: seconds of slow delay swing over the whole mix (0.004 is about 15 cents); 0 for none. */
  readonly wow: number;
  /** Side-chain depth, 1 as designed. */
  readonly duck: number;
  /** Bus gains relative to LEVEL. */
  readonly level: Readonly<Partial<Record<'kick' | 'snare' | 'hats' | 'perc' | 'bass' | 'pad' | 'arp' | 'lead' | 'reverb' | 'delay' | 'sum', number>>>;
}

/** The first station's sound: the mix this module has always made. */
export const SUNSET_SOUND: SoundStyle = {
  bpm: BPM,
  kick: { from: 180, to: 54, tail: 45, drop: 0.09, length: 0.33, click: 0.22 },
  kickDrive: 2.2,
  snare: 'gated',
  bass: 'saw',
  bassDrive: 0,
  pad: 'saw',
  arp: 'pluck',
  lead: 'saw',
  reverbSeconds: 2.6,
  delayBeats: 0.75,
  delayFeedback: 0.42,
  chorusDepth: 1,
  tape: 0,
  wow: 0,
  duck: 1,
  level: {},
};

/** Bus gains. The balance of the mix lives here; plans/T10-audio.md records how it was measured. */
const LEVEL = {
  kick: 0.56,
  kickDrive: 2.2,
  snare: 0.38,
  gatedReturn: 7.5,
  hats: 0.2,
  perc: 0.3,
  bass: 0.3,
  pad: 0.165,
  padChorusWet: 0.9,
  arp: 0.32,
  lead: 0.25,
  delayReturn: 0.5,
  delayFeedback: 0.42,
  reverbReturn: 0.3,
  padToReverb: 0.3,
  arpToDelay: 0.5,
  arpToReverb: 0.2,
  leadToDelay: 0.42,
  leadToReverb: 0.35,
  snareToReverb: 0.1,
  bedRumble: 0.06,
  bedAir: 0.016,
  sum: 0.7,
  trim: 0.58,
} as const;

export interface MixOptions {
  /** Seeds the noise the mixer generates. */
  seed?: number;
  /** Where the finished signal goes. Defaults to the context's destination. */
  output?: AudioNode;
  maxVoices?: number;
  /** False leaves out the city bed, to measure the parts on their own. Whooshes still play. */
  bed?: boolean;
  /** The station's sound. Default SUNSET_SOUND. */
  sound?: SoundStyle;
}

export interface VoiceCount {
  /** Voices created and not yet ended. */
  active: number;
  /** Voices created since the mixer was made. */
  started: number;
  /** Notes skipped because too many voices were sounding. */
  dropped: number;
}

export interface Mix {
  readonly ctx: BaseAudioContext;
  readonly sound: SoundStyle;
  // Inputs, one per part.
  readonly kick: AudioNode;
  readonly snare: AudioNode;
  /** The gated reverb: snare and toms send here. */
  readonly gated: AudioNode;
  readonly hats: AudioNode;
  readonly perc: AudioNode;
  readonly bass: AudioNode;
  readonly pad: AudioNode;
  readonly arp: AudioNode;
  readonly lead: AudioNode;
  readonly ambience: AudioNode;
  /** Two seconds of white noise, shared by every noise voice. */
  readonly noise: AudioBuffer;
  readonly voices: VoiceCount;
  readonly maxVoices: number;
  /** Dip the pad, bass and arpeggio at `time`, as a compressor keyed by the kick would. `amount` 0..1. */
  duck(time: number, amount: number): void;
  /** Set the listener volume, 0..1 as a gain. Moves there over a few hundredths of a second. */
  setLevel(gain: number, time: number): void;
  /** Open the output from silence. `timeConstant` seconds; three of them is 95 % of the way. */
  fadeIn(time: number, timeConstant: number): void;
  /** Close the output quickly and without a click. */
  fadeOut(time: number): void;
  /** Points to measure at: the sum before the master chain, and the signal entering the clamp. */
  readonly taps: { readonly preMaster: AudioNode; readonly preClamp: AudioNode };
  /** Stop the sources the mixer owns and detach it from its output. */
  dispose(): void;
}

function whiteNoise(ctx: BaseAudioContext, seconds: number, rng: Rng): AudioBuffer {
  const length = Math.floor(seconds * ctx.sampleRate);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let sum = 0;
  for (let i = 0; i < length; i++) {
    const v = rng.next() * 2 - 1;
    data[i] = v;
    sum += v;
  }
  const mean = sum / length;
  for (let i = 0; i < length; i++) data[i] = data[i]! - mean;
  return buffer;
}

/** Stereo brown noise that loops without a seam: the last stretch is cross-faded into the first. */
function bedNoise(ctx: BaseAudioContext, seconds: number, rng: Rng): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(seconds * rate);
  const overlap = Math.floor(0.5 * rate);
  const buffer = ctx.createBuffer(2, length, rate);
  const raw = new Float32Array(length + overlap);
  for (let channel = 0; channel < 2; channel++) {
    let y = 0;
    let peak = 0;
    for (let i = 0; i < raw.length; i++) {
      // A leaky integrator: brown above about 15 Hz, and no drift below.
      y = 0.998 * y + (rng.next() * 2 - 1);
      raw[i] = y;
      const a = Math.abs(y);
      if (a > peak) peak = a;
    }
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      let v = raw[i]!;
      if (i < overlap) {
        const t = i / overlap;
        v = v * Math.sin(t * Math.PI * 0.5) + raw[length + i]! * Math.cos(t * Math.PI * 0.5);
      }
      data[i] = v / peak;
    }
  }
  return buffer;
}

/** Scale every channel to unit energy, so a convolver's output carries the energy of its input. */
function unitEnergy(buffer: AudioBuffer): AudioBuffer {
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i]! * data[i]!;
    const scale = sum > 0 ? 1 / Math.sqrt(sum) : 0;
    for (let i = 0; i < data.length; i++) data[i] = data[i]! * scale;
  }
  return buffer;
}

/** A hall: noise that dies away over `seconds` and darkens as it goes. */
function hallImpulse(ctx: BaseAudioContext, seconds: number, rng: Rng): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(seconds * rate);
  const preDelay = Math.floor(0.012 * rate);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let low = 0;
    for (let i = preDelay; i < length; i++) {
      const t = (i - preDelay) / rate;
      // One-pole low-pass whose corner falls from about 9 kHz to 1.5 kHz.
      const corner = 1500 + 7500 * Math.exp(-t * 2.2);
      const k = 1 - Math.exp((-2 * Math.PI * corner) / rate);
      low += k * (rng.next() * 2 - 1 - low);
      const rise = Math.min(1, t / 0.004);
      data[i] = low * rise * Math.exp((-6.9 * t) / seconds);
    }
  }
  return unitEnergy(buffer);
}

/** The 80s gated room: dense noise that barely decays and is then cut off. */
function gatedImpulse(ctx: BaseAudioContext, seconds: number, rng: Rng): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(seconds * rate);
  const cut = Math.floor(0.014 * rate);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      const rise = Math.min(1, t / 0.004);
      const left = length - 1 - i;
      const gate = left < cut ? 0.5 - 0.5 * Math.cos((Math.PI * left) / cut) : 1;
      data[i] = (rng.next() * 2 - 1) * rise * gate * Math.exp(-t / 0.45);
    }
  }
  return unitEnergy(buffer);
}

/** Odd-length transfer curve for a WaveShaper, so an input of 0 lands exactly on the middle sample. */
function shaperCurve(shape: (x: number) => number): Float32Array<ArrayBuffer> {
  const n = 4097;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.sign(x) * shape(Math.abs(x));
  }
  return curve;
}

/** Straight up to the knee, then bending towards the ceiling, which it approaches and never reaches. */
export function clampShape(x: number): number {
  if (x <= CLAMP_KNEE) return x;
  const room = CEILING - CLAMP_KNEE;
  return CLAMP_KNEE + room * Math.tanh((x - CLAMP_KNEE) / room);
}

export function createMix(ctx: BaseAudioContext, options: MixOptions = {}): Mix {
  const rng = createRng(hashInts(options.seed ?? 1, 0xa0d10));
  const output = options.output ?? ctx.destination;
  const owned: AudioScheduledSourceNode[] = [];
  const sound = options.sound ?? SUNSET_SOUND;
  const lv = (part: keyof SoundStyle['level']): number => sound.level[part] ?? 1;

  const gain = (value: number): GainNode => {
    const node = ctx.createGain();
    node.gain.value = value;
    return node;
  };
  /** A gain that is always two channels, so a mono part reaches both sides of whatever follows. */
  const stereo = (value: number): GainNode => {
    const node = gain(value);
    node.channelCount = 2;
    node.channelCountMode = 'explicit';
    return node;
  };
  const filter = (type: BiquadFilterType, frequency: number, q = 0.707, gainDb = 0): BiquadFilterNode => {
    const node = ctx.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    node.gain.value = gainDb;
    return node;
  };
  const lfo = (frequency: number, depth: number, target: AudioParam): void => {
    const osc = ctx.createOscillator();
    osc.frequency.value = frequency;
    const amount = gain(depth);
    osc.connect(amount).connect(target);
    osc.start();
    owned.push(osc);
  };

  // ---- Master chain
  const premaster = stereo(LEVEL.sum * lv('sum'));
  const shelf = filter('highshelf', 9000, 0.707, -1.5);
  const subsonic = filter('highpass', 28);
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.knee.value = 10;
  compressor.ratio.value = 2.5;
  compressor.attack.value = 0.015;
  compressor.release.value = 0.25;
  const trim = stereo(LEVEL.trim);
  const clamp = ctx.createWaveShaper();
  clamp.curve = shaperCurve(clampShape);
  const volume = gain(1);
  const gate = gain(0);
  // Optional tape stages: a slow wobble before the shelf, a low-pass after it.
  let head: AudioNode = premaster;
  if (sound.wow > 0) {
    const wobble = ctx.createDelay(0.1);
    wobble.delayTime.value = 0.004 + sound.wow * 1.2;
    head.connect(wobble);
    head = wobble;
    lfo(0.31, sound.wow, wobble.delayTime);
    lfo(4.7, sound.wow * 0.025, wobble.delayTime);
  }
  head.connect(shelf);
  let tail: AudioNode = shelf;
  if (sound.tape > 0) {
    const tape = filter('lowpass', sound.tape, 0.6);
    tail.connect(tape);
    tail = tape;
  }
  tail.connect(subsonic).connect(compressor).connect(trim).connect(clamp).connect(volume).connect(gate).connect(output);

  // ---- Shared effects
  const reverbIn = gain(1);
  const reverb = ctx.createConvolver();
  // The impulses are scaled here, not by the browser, so the level is the same everywhere.
  reverb.normalize = false;
  reverb.buffer = hallImpulse(ctx, sound.reverbSeconds, rng.fork(1));
  reverbIn.connect(reverb).connect(gain(LEVEL.reverbReturn * lv('reverb'))).connect(premaster);

  // Ping-pong delay on dotted eighths: left, then right, each repeat darker.
  const delayIn = gain(1);
  const delayTime = (sound.delayBeats * 60) / sound.bpm;
  const delayLeft = ctx.createDelay(1);
  const delayRight = ctx.createDelay(1);
  delayLeft.delayTime.value = delayTime;
  delayRight.delayTime.value = delayTime;
  const delayTone = filter('lowpass', 3200);
  const delayThin = filter('highpass', 300);
  const feedbackRight = gain(sound.delayFeedback);
  const feedbackLeft = gain(sound.delayFeedback);
  delayIn.connect(delayTone).connect(delayThin).connect(delayLeft);
  delayLeft.connect(feedbackRight).connect(delayRight);
  delayRight.connect(feedbackLeft).connect(delayTone);
  const delayOut = ctx.createChannelMerger(2);
  delayLeft.connect(delayOut, 0, 0);
  delayRight.connect(delayOut, 0, 1);
  const delayReturn = gain(LEVEL.delayReturn * lv('delay'));
  delayOut.connect(delayReturn).connect(premaster);
  delayReturn.connect(gain(0.25)).connect(reverbIn);

  // ---- Drums
  const drums = gain(1);
  drums.connect(premaster);
  const kick = gain(LEVEL.kick * lv('kick'));
  const kickDrive = ctx.createWaveShaper();
  const drive = sound.kickDrive;
  kickDrive.curve = shaperCurve((x) => Math.tanh(drive * x) / Math.tanh(drive));
  kick.connect(kickDrive).connect(drums);
  const snare = gain(LEVEL.snare * lv('snare'));
  snare.connect(drums);
  snare.connect(gain(LEVEL.snareToReverb)).connect(reverbIn);
  const gated = gain(LEVEL.snare * lv('snare'));
  const gatedRoom = ctx.createConvolver();
  gatedRoom.normalize = false;
  gatedRoom.buffer = gatedImpulse(ctx, 0.3, rng.fork(2));
  gated.connect(gatedRoom).connect(filter('highpass', 280)).connect(filter('lowpass', 4800)).connect(gain(LEVEL.gatedReturn)).connect(drums);
  const hats = gain(LEVEL.hats * lv('hats'));
  hats.connect(drums);
  const perc = gain(LEVEL.perc * lv('perc'));
  perc.connect(drums);

  // ---- Bass
  const bass = gain(LEVEL.bass * lv('bass'));
  const bassDuck = gain(1);
  if (sound.bassDrive > 0) {
    // Drive, then take the fizz off the top; the shaper's output is normalised to its input range.
    const shaper = ctx.createWaveShaper();
    const amount = sound.bassDrive;
    shaper.curve = shaperCurve((x) => Math.tanh(amount * x) / Math.tanh(amount));
    shaper.oversample = '2x';
    bass.connect(gain(1.6)).connect(shaper).connect(filter('lowpass', 2600, 0.8)).connect(gain(0.55)).connect(bassDuck);
  } else {
    bass.connect(bassDuck);
  }
  bassDuck.connect(premaster);

  // ---- Pad: thinned below the bass, widened by a two-voice chorus, ducked by the kick
  const pad = gain(LEVEL.pad * lv('pad'));
  const padBody = filter('highpass', 150);
  const padDuck = stereo(1);
  pad.connect(padBody).connect(gain(0.6)).connect(padDuck);
  const chorusOut = ctx.createChannelMerger(2);
  const chorusLeft = ctx.createDelay(0.05);
  const chorusRight = ctx.createDelay(0.05);
  chorusLeft.delayTime.value = 0.017;
  chorusRight.delayTime.value = 0.023;
  lfo(0.31, 0.0035 * sound.chorusDepth, chorusLeft.delayTime);
  lfo(0.47, 0.0042 * sound.chorusDepth, chorusRight.delayTime);
  padBody.connect(chorusLeft).connect(chorusOut, 0, 0);
  padBody.connect(chorusRight).connect(chorusOut, 0, 1);
  chorusOut.connect(gain(LEVEL.padChorusWet)).connect(padDuck);
  padDuck.connect(premaster);
  padDuck.connect(gain(LEVEL.padToReverb)).connect(reverbIn);

  // ---- Arpeggio and lead
  const arp = gain(LEVEL.arp * lv('arp'));
  const arpDuck = gain(1);
  arp.connect(arpDuck).connect(premaster);
  arp.connect(gain(LEVEL.arpToDelay)).connect(delayIn);
  arp.connect(gain(LEVEL.arpToReverb)).connect(reverbIn);
  const lead = gain(LEVEL.lead * lv('lead'));
  lead.connect(premaster);
  lead.connect(gain(LEVEL.leadToDelay)).connect(delayIn);
  lead.connect(gain(LEVEL.leadToReverb)).connect(reverbIn);

  // ---- City bed: a low rumble and a band of far traffic, both drifting slowly
  const ambience = gain(1);
  ambience.connect(premaster);
  const bed = ctx.createBufferSource();
  bed.buffer = bedNoise(ctx, 8, rng.fork(3));
  bed.loop = true;
  const rumble = filter('lowpass', 240, 0.5);
  const air = filter('bandpass', 850, 0.35);
  const airLevel = gain(LEVEL.bedAir);
  bed.connect(rumble).connect(gain(LEVEL.bedRumble)).connect(ambience);
  bed.connect(air).connect(airLevel).connect(ambience);
  lfo(0.045, 90, rumble.frequency);
  lfo(0.071, LEVEL.bedAir * 0.5, airLevel.gain);
  if (options.bed !== false) {
    bed.start();
    owned.push(bed);
  }

  // The side-chain. Each kick gets its own short-lived source that swings from 0 down to -1 and
  // back; scaled per bus, it is added to the duck gains, which rest at 1. A note's worth of
  // automation dies with its source, so nothing accumulates on a long-lived parameter however
  // long the music plays.
  const duckBus = gain(1);
  const duckDepth = (d: number): number => Math.min(0.9, d * sound.duck);
  duckBus.connect(gain(duckDepth(DUCK.pad))).connect(padDuck.gain);
  duckBus.connect(gain(duckDepth(DUCK.bass))).connect(bassDuck.gain);
  duckBus.connect(gain(duckDepth(DUCK.arp))).connect(arpDuck.gain);
  let lastDuck = Number.NEGATIVE_INFINITY;

  return {
    ctx,
    sound,
    kick,
    snare,
    gated,
    hats,
    perc,
    bass,
    pad,
    arp,
    lead,
    ambience,
    noise: whiteNoise(ctx, 2, rng.fork(4)),
    voices: { active: 0, started: 0, dropped: 0 },
    maxVoices: options.maxVoices ?? DEFAULT_MAX_VOICES,
    duck(time: number, amount: number): void {
      // Dips add up, so two close together could take a gain below zero: skip the second.
      if (time - lastDuck < DUCK.minGap) return;
      lastDuck = time;
      const depth = amount < 0 ? 0 : amount > 1 ? 1 : amount;
      const end = time + DUCK.hold + DUCK.recover * 7;
      const pulse = ctx.createConstantSource();
      // The source defaults to 1, and it can start a frame before the first automation event
      // applies: without this line that one frame doubles the pad level, an audible tick.
      pulse.offset.value = 0;
      pulse.offset.setValueAtTime(0, time);
      pulse.offset.setTargetAtTime(-depth, time, DUCK.attack);
      pulse.offset.setTargetAtTime(0, time + DUCK.hold, DUCK.recover);
      pulse.connect(duckBus);
      pulse.onended = (): void => pulse.disconnect();
      pulse.start(time);
      pulse.stop(end);
    },
    setLevel(level: number, time: number): void {
      volume.gain.setTargetAtTime(level < 0 ? 0 : level > 1 ? 1 : level, time, 0.03);
    },
    fadeIn(time: number, timeConstant: number): void {
      gate.gain.setTargetAtTime(1, time, timeConstant);
    },
    fadeOut(time: number): void {
      gate.gain.setTargetAtTime(0, time, 0.012);
    },
    taps: { preMaster: premaster, preClamp: trim },
    dispose(): void {
      for (const source of owned) {
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
      }
      gate.disconnect();
    },
  };
}
