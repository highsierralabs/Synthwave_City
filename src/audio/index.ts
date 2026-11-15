// The soundtrack (architecture.md section 6): a generative synthwave track made of oscillators,
// noise and filters, a quiet city bed under it, and the beat the picture pulses to.
//
//   const audio = createAudio({ seed, volume: 0.7, muted: false, station: 'sunset' });   // no AudioContext yet
//   button.addEventListener('click', () => {
//     void audio.start();                                             // inside the gesture
//     engine.setBeatSource(audio.beat);
//   });
//
// Layout: theory.ts and song.ts compose (pure), transport.ts keeps time (pure), mix.ts and voices.ts
// make the sound on any BaseAudioContext, player.ts runs them live.
import { createPlayer, type AudioOptions, type AudioSystem } from './player';

export type { AudioOptions, AudioState, AudioSystem } from './player';
export { DEFAULT_STATION, isStationId, nextStation, STATION_IDS, STATIONS, type Station, type StationId } from './stations';

/**
 * Make the soundtrack. Nothing audible or expensive happens here and no AudioContext is created:
 * that waits for `start()`, which must be called inside a user gesture.
 */
export function createAudio(options: AudioOptions = {}): AudioSystem {
  return createPlayer(options).system;
}
