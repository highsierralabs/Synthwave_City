import { describe, expect, it } from 'vitest';
import { SUNSET_SOUND } from '../../../src/audio/mix';
import { colourFor, createSong, isMelodic, padVoicing, SUNSET_STYLE, Voice, type Song } from '../../../src/audio/song';
import { DEFAULT_STATION, isStationId, nextStation, STATION_IDS, STATIONS, stationSeed, type StationId } from '../../../src/audio/stations';
import { degreeToSemitones, mod } from '../../../src/audio/theory';

// The scales, written out again here so a wrong table in the module cannot agree with itself.
const SCALES: Readonly<Record<StationId, readonly number[]>> = {
  sunset: [0, 2, 3, 5, 7, 8, 10],
  obsidian: [0, 1, 3, 5, 7, 8, 10],
  velvet: [0, 2, 4, 5, 7, 9, 11],
  starport: [0, 2, 3, 5, 7, 9, 10],
  plaza: [0, 2, 4, 5, 7, 9, 11],
};

const BARS = 240;
const songs = new Map<StationId, Song>(STATION_IDS.map((id) => [id, createSong(stationSeed(id, 1984), STATIONS[id].song)]));
const songOf = (id: StationId): Song => songs.get(id)!;

describe('stations', () => {
  it('five stations on the FM dial, in order, each with its own name, genre and tempo', () => {
    expect(STATION_IDS.length).toBe(5);
    const freqs = STATION_IDS.map((id) => Number(STATIONS[id].frequency));
    for (let i = 0; i < freqs.length; i++) {
      expect(freqs[i]).toBeGreaterThanOrEqual(87.5);
      expect(freqs[i]).toBeLessThanOrEqual(108);
      if (i > 0) expect(freqs[i]).toBeGreaterThan(freqs[i - 1]!);
    }
    for (const key of ['name', 'genre'] as const) expect(new Set(STATION_IDS.map((id) => STATIONS[id][key])).size).toBe(5);
    const tempos = STATION_IDS.map((id) => STATIONS[id].sound.bpm);
    expect(new Set(tempos).size).toBe(5);
    for (const bpm of tempos) expect(bpm >= 70 && bpm <= 130).toBe(true);
    for (const id of STATION_IDS) expect(STATIONS[id].id).toBe(id);
  });

  it('SUNSET FM is the original soundtrack: same style, same sound, the city seed', () => {
    expect(DEFAULT_STATION).toBe('sunset');
    expect(STATIONS.sunset.song).toBe(SUNSET_STYLE);
    expect(STATIONS.sunset.sound).toBe(SUNSET_SOUND);
    expect(SUNSET_SOUND.bpm).toBe(105);
    for (const seed of [1, 7, 1984]) {
      expect(stationSeed('sunset', seed)).toBe(seed);
      const plain = createSong(seed);
      const tuned = createSong(stationSeed('sunset', seed), STATIONS.sunset.song);
      for (const bar of [0, 9, 31, 77, 200]) expect(tuned.bar(bar)).toEqual(plain.bar(bar));
    }
  });

  it('the other stations have their own seeds, different from each other', () => {
    for (const seed of [1, 1984]) {
      const seeds = STATION_IDS.map((id) => stationSeed(id, seed));
      expect(new Set(seeds).size).toBe(5);
      for (const s of seeds) expect(Number.isInteger(s) && s >= 0).toBe(true);
    }
  });

  it('the dial wraps round and ids are checked', () => {
    let id: StationId = 'sunset';
    const seen: StationId[] = [];
    for (let i = 0; i < 5; i++) {
      seen.push(id);
      id = nextStation(id);
    }
    expect(id).toBe('sunset');
    expect(seen).toEqual([...STATION_IDS]);
    expect(isStationId('velvet')).toBe(true);
    for (const bad of ['', 'Velvet', 'radio', 3, null, undefined]) expect(isStationId(bad)).toBe(false);
  });

  it('every station is deterministic, and no two sound the same', () => {
    for (const id of STATION_IDS) {
      const again = createSong(stationSeed(id, 1984), STATIONS[id].song);
      for (const bar of [0, 12, 40, 150]) expect(again.bar(bar)).toEqual(songOf(id).bar(bar));
    }
    for (const a of STATION_IDS) {
      for (const b of STATION_IDS) {
        if (a >= b) continue;
        let same = 0;
        for (let bar = 8; bar < 40; bar++) if (JSON.stringify(songOf(a).bar(bar).events) === JSON.stringify(songOf(b).bar(bar).events)) same++;
        expect(same, `${a} and ${b}`).toBe(0);
      }
    }
  });

  it('every note of every station is in the key of its section, in that station scale', () => {
    for (const id of STATION_IDS) {
      const scale = SCALES[id];
      for (let b = 0; b < BARS; b++) {
        const bar = songOf(id).bar(b);
        for (const e of bar.events) {
          if (!isMelodic(e.voice)) continue;
          expect(scale.includes(mod(e.midi - bar.section.tonic, 12)), `${id} bar ${b} voice ${e.voice} midi ${e.midi}`).toBe(true);
        }
      }
    }
  });

  it('events lie inside their bar with sane lengths and levels, swung or not', () => {
    for (const id of STATION_IDS) {
      for (let b = 0; b < BARS; b++) {
        for (const e of songOf(id).bar(b).events) {
          expect(e.beat >= 0 && e.beat < 4, `${id} beat ${e.beat}`).toBe(true);
          expect(e.duration > 0).toBe(true);
          expect(e.velocity > 0 && e.velocity <= 1).toBe(true);
        }
      }
    }
  });

  it('no station builds a chord on a diminished triad, and no chord rubs a semitone', () => {
    for (const id of STATION_IDS) {
      const scale = SCALES[id];
      const song = songOf(id);
      for (let b = 0; b < BARS; b++) {
        const { chord, section } = song.bar(b);
        const third = degreeToSemitones(chord.root + 2, scale) - degreeToSemitones(chord.root, scale);
        const fifth = degreeToSemitones(chord.root + 4, scale) - degreeToSemitones(chord.root, scale);
        expect([3, 4], `${id} bar ${b} root ${chord.root}`).toContain(third);
        expect(fifth, `${id} bar ${b} root ${chord.root}`).toBe(7);
        const notes = padVoicing(section.tonic, chord, scale);
        for (let i = 0; i < notes.length; i++) for (let j = 0; j < i; j++) expect(Math.abs(notes[i]! - notes[j]!)).not.toBe(1);
      }
    }
  });

  it('the colour rule reproduces the first station: VII takes the ninth, v the seventh', () => {
    expect(colourFor(SUNSET_STYLE, 6, false)).toBe(8);
    expect(colourFor(SUNSET_STYLE, 4, true)).toBe(6);
    expect(colourFor(SUNSET_STYLE, 0, true)).toBe(8);
    expect(colourFor(SUNSET_STYLE, 0, false)).toBe(6);
    // Power chords: the root an octave up.
    expect(colourFor(STATIONS.obsidian.song, 0, true)).toBe(7);
    // Mallsoft keeps its dominant sevenths.
    expect(colourFor(STATIONS.plaza.song, 4, false)).toBe(6);
  });

  it('each groove plays as described', () => {
    const steps = (id: StationId, voice: number, kind: string): Set<number>[] => {
      const out: Set<number>[] = [];
      for (let b = 0; b < BARS; b++) {
        const bar = songOf(id).bar(b);
        if (bar.section.kind !== kind) continue;
        out.push(new Set(bar.events.filter((e) => e.voice === voice).map((e) => Math.round(e.beat * 4))));
      }
      return out;
    };
    // Half time: the snare on three only, no kick on two or four.
    for (const s of steps('velvet', Voice.snare, 'verse')) expect(s.has(8) && !s.has(4)).toBe(true);
    for (const s of steps('velvet', Voice.kick, 'chorus')) expect(s.has(4) || s.has(12)).toBe(false);
    // Disco: an open hat on every off-beat of a chorus that is not cut short by a fill.
    const disco = steps('starport', Voice.openHat, 'chorus');
    expect(disco.filter((s) => [2, 6, 10, 14].every((k) => s.has(k))).length).toBeGreaterThan(disco.length / 2);
    // Drive: sixteenth hats in a first verse.
    for (const s of steps('obsidian', Voice.hat, 'verse')) expect(s.size).toBeGreaterThanOrEqual(12);
    // Four on the floor everywhere it should be.
    for (const id of ['sunset', 'obsidian', 'starport'] as const) {
      for (const s of steps(id, Voice.kick, 'verse')) expect([0, 4, 8, 12].every((k) => s.has(k))).toBe(true);
    }
  });

  it('mallsoft swings its off-beat eighths and nothing else', () => {
    let swung = 0;
    for (let b = 8; b < 40; b++) {
      for (const e of songOf('plaza').bar(b).events) {
        const step = e.beat * 4;
        if (Number.isInteger(step)) expect(step % 4).not.toBe(2);
        else {
          expect(Math.floor(step) % 4).toBe(2);
          swung++;
        }
      }
    }
    expect(swung).toBeGreaterThan(50);
    for (let b = 8; b < 40; b++) for (const e of songOf('sunset').bar(b).events) expect(Number.isInteger(e.beat * 4)).toBe(true);
  });
});
