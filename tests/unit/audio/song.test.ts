import { describe, expect, it } from 'vitest';
import {
  BARS_PER_SECTION, BEATS_PER_BAR, MAX_SECTIONS_PER_MOVEMENT, STEP_BEATS, STEPS_PER_BAR, Voice, createSong, isMelodic,
  padVoicing, type Bar, type NoteEvent, type SectionKind, type VoiceId,
} from '../../../src/audio/song';
import { degreeToSemitones, mod } from '../../../src/audio/theory';
import { BPM } from '../../../src/contracts/constants';

const SEEDS = [1, 2, 3, 7, 1984, 20261114];
/** Written out here, not imported, so the test does not agree with the code by construction. */
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];
/** Ten minutes of music, in bars. */
const TEN_MINUTES = Math.ceil((600 * BPM) / 60 / BEATS_PER_BAR);

const of = (bar: Bar, voice: VoiceId): NoteEvent[] => bar.events.filter((e) => e.voice === voice);
const stepsOf = (events: readonly NoteEvent[]): number[] => events.map((e) => e.beat / STEP_BEATS);
/** What a bar plays, without loudness: the same music gives the same string. */
const signature = (bar: Bar): string => bar.events.filter((e) => e.voice !== Voice.whoosh).map((e) => `${e.voice}@${e.beat}:${e.midi}`).join(' ');

function barsOf(seed: number, count = TEN_MINUTES): Bar[] {
  const song = createSong(seed);
  const out: Bar[] = [];
  for (let i = 0; i < count; i++) out.push(song.bar(i));
  return out;
}

const ALL = SEEDS.map((seed) => ({ seed, bars: barsOf(seed) }));

describe('song: every event is well formed', () => {
  it('onsets lie inside the bar on the sixteenth grid, in order', () => {
    for (const { bars } of ALL) {
      for (const bar of bars) {
        let previous = -1;
        for (const e of bar.events) {
          expect(e.beat).toBeGreaterThanOrEqual(0);
          expect(e.beat).toBeLessThan(BEATS_PER_BAR);
          expect(Number.isInteger(e.beat / STEP_BEATS)).toBe(true);
          expect(e.beat).toBeGreaterThanOrEqual(previous);
          previous = e.beat;
        }
      }
    }
  });

  it('lengths, levels and positions are in range', () => {
    for (const { bars } of ALL) {
      for (const bar of bars) {
        for (const e of bar.events) {
          expect(e.duration).toBeGreaterThan(0);
          expect(e.velocity).toBeGreaterThan(0.05);
          expect(e.velocity).toBeLessThanOrEqual(1);
          expect(e.tone).toBeGreaterThanOrEqual(0);
          expect(e.tone).toBeLessThanOrEqual(1);
          expect(Math.abs(e.pan)).toBeLessThanOrEqual(1);
          expect(Number.isInteger(e.midi)).toBe(true);
          if (e.voice !== Voice.lead) expect(e.glide).toBe(0);
          // Only a pad chord, a riser or a whoosh may ring on into the next bar.
          if (e.voice !== Voice.pad && e.voice !== Voice.riser && e.voice !== Voice.whoosh && e.voice !== Voice.crash) {
            expect(e.beat + e.duration).toBeLessThanOrEqual(BEATS_PER_BAR);
          }
        }
      }
    }
  });

  it('a bar index is clamped and floored', () => {
    const song = createSong(5);
    expect(song.bar(-3)).toBe(song.bar(0));
    expect(song.bar(2.9)).toBe(song.bar(2));
    expect(song.bar(2).index).toBe(2);
  });
});

describe('song: harmony', () => {
  it('every note of the bass, pad, arpeggio and lead is in the key of its section', () => {
    let checked = 0;
    for (const { bars } of ALL) {
      for (const bar of bars) {
        for (const e of bar.events) {
          if (!isMelodic(e.voice)) continue;
          expect(NATURAL_MINOR, `bar ${bar.index} voice ${e.voice} midi ${e.midi} tonic ${bar.section.tonic}`).toContain(mod(e.midi - bar.section.tonic, 12));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(40_000);
  });

  it('chords are built on i, III, iv, v, VI or VII, with a colour that does not clash', () => {
    const roots = new Set<number>();
    for (const { bars } of ALL) {
      for (const bar of bars) {
        const { root, colour } = bar.chord;
        roots.add(root);
        expect([0, 2, 3, 4, 5, 6]).toContain(root);
        expect([6, 8]).toContain(colour);
        if (root === 4) expect(colour).toBe(6);
        if (root === 6) expect(colour).toBe(8);
      }
    }
    expect(roots.size).toBeGreaterThanOrEqual(5);
  });

  it('a pad chord is the triad plus its colour note, with no semitone rub, and covers every bar', () => {
    for (const { bars } of ALL) {
      let ringsUntil = 0;
      for (const bar of bars) {
        const notes = of(bar, Voice.pad);
        const start = bar.index * BEATS_PER_BAR;
        if (notes.length === 0) {
          // A tied chord from the bar before must still be sounding to the end of this bar.
          expect(ringsUntil, `bar ${bar.index} has no pad`).toBeGreaterThan(start + BEATS_PER_BAR - 0.5);
          continue;
        }
        expect(notes.length).toBe(4);
        const base = mod(bar.section.tonic - bar.section.transpose, 12);
        const expected = padVoicing(base, bar.chord).map((m) => m + bar.section.transpose);
        const midis = notes.map((e) => e.midi).sort((a, b) => a - b);
        expect(midis).toEqual(expected);
        const classes = new Set(midis.map((m) => mod(m - bar.section.tonic, 12)));
        for (const k of [0, 2, 4, bar.chord.colour]) expect(classes.has(mod(degreeToSemitones(bar.chord.root + k), 12))).toBe(true);
        for (let i = 1; i < midis.length; i++) expect(midis[i]! - midis[i - 1]!).toBeGreaterThanOrEqual(2);
        for (const e of notes) expect(e.beat).toBe(0);
        ringsUntil = start + notes[0]!.duration;
        expect(notes[0]!.duration).toBeGreaterThan(BEATS_PER_BAR - 0.5);
      }
    }
  });

  it('each part stays in its register', () => {
    const range: Record<number, [number, number]> = {
      [Voice.bass]: [33, 64],
      [Voice.pad]: [57, 82],
      [Voice.arp]: [55, 92],
      [Voice.lead]: [58, 98],
    };
    for (const { bars } of ALL) {
      for (const bar of bars) {
        for (const e of bar.events) {
          const r = range[e.voice];
          if (!r) continue;
          expect(e.midi, `voice ${e.voice} bar ${bar.index}`).toBeGreaterThanOrEqual(r[0]);
          expect(e.midi, `voice ${e.voice} bar ${bar.index}`).toBeLessThanOrEqual(r[1]);
        }
      }
    }
  });

  it('the bass starts every bar on the root of the chord', () => {
    for (const { bars } of ALL) {
      for (const bar of bars) {
        const first = of(bar, Voice.bass)[0];
        if (!first) continue;
        expect(first.beat).toBe(0);
        expect(mod(first.midi - bar.section.tonic, 12)).toBe(mod(degreeToSemitones(bar.chord.root), 12));
      }
    }
  });
});

describe('song: rhythm', () => {
  it('four on the floor, and the snare on two and four, in every verse and chorus bar', () => {
    for (const { bars } of ALL) {
      for (const bar of bars) {
        if (bar.section.kind !== 'verse' && bar.section.kind !== 'chorus') continue;
        const kicks = stepsOf(of(bar, Voice.kick));
        for (const step of [0, 4, 8, 12]) expect(kicks).toContain(step);
        const snares = stepsOf(of(bar, Voice.snare));
        expect(snares).toContain(4);
        expect(snares).toContain(12);
      }
    }
  });

  it('the bass drives in sixteenths through verses and choruses', () => {
    for (const { bars } of ALL) {
      for (const bar of bars) {
        if (bar.section.kind !== 'verse' && bar.section.kind !== 'chorus') continue;
        const notes = of(bar, Voice.bass);
        expect(notes.length).toBeGreaterThanOrEqual(12);
        for (const e of notes) expect(e.duration).toBeLessThan(STEP_BEATS);
      }
    }
  });

  it('an intro opens without drums or bass, and a break has no kick', () => {
    for (const { bars } of ALL) {
      for (const bar of bars) {
        if (bar.section.kind === 'intro' && bar.barInSection < 4) {
          expect(of(bar, Voice.kick).length + of(bar, Voice.snare).length + of(bar, Voice.hat).length + of(bar, Voice.bass).length).toBe(0);
          expect(of(bar, Voice.pad).length + of(bar, Voice.arp).length).toBeGreaterThan(0);
        }
        if (bar.section.kind === 'break') expect(of(bar, Voice.kick).length).toBe(0);
      }
    }
  });

  it('a chorus is busier on the hats than a first verse', () => {
    const { bars } = ALL[0]!;
    const hats = (kind: SectionKind, variant: number): number => {
      const bar = bars.find((x) => x.section.kind === kind && x.section.variant === variant && x.barInSection === 2)!;
      return of(bar, Voice.hat).length + of(bar, Voice.openHat).length;
    };
    expect(hats('chorus', 0)).toBeGreaterThan(hats('verse', 0));
  });

  it('a section that leads into a chorus ends with a fill', () => {
    for (const { bars } of ALL) {
      for (const bar of bars) {
        if (bar.barInSection !== BARS_PER_SECTION - 1 || bar.section.nextKind !== 'chorus') continue;
        const extra = of(bar, Voice.tom).length + of(bar, Voice.riser).length + Math.max(0, of(bar, Voice.snare).length - 2);
        expect(extra, `bar ${bar.index} (${bar.section.kind})`).toBeGreaterThan(0);
      }
    }
  });
});

describe('song: the lead', () => {
  it('plays through every chorus and stays out of intros and breaks', () => {
    for (const { bars } of ALL) {
      for (const bar of bars) {
        const notes = of(bar, Voice.lead).length;
        if (bar.section.kind === 'chorus') expect(notes).toBeGreaterThanOrEqual(2);
        if (bar.section.kind === 'intro' || bar.section.kind === 'break') expect(notes).toBe(0);
      }
    }
  });

  it('is one note at a time', () => {
    for (const { bars } of ALL) {
      for (const bar of bars) {
        const notes = of(bar, Voice.lead);
        for (let i = 1; i < notes.length; i++) {
          expect(notes[i - 1]!.beat + notes[i - 1]!.duration).toBeLessThanOrEqual(notes[i]!.beat);
        }
      }
    }
  });

  it('lands on a chord tone on beats one and three', () => {
    let checked = 0;
    for (const { bars } of ALL) {
      for (const bar of bars) {
        for (const e of of(bar, Voice.lead)) {
          if (e.beat !== 0 && e.beat !== 2) continue;
          const above = mod(e.midi - bar.section.tonic - degreeToSemitones(bar.chord.root), 12);
          const third = mod(degreeToSemitones(bar.chord.root + 2) - degreeToSemitones(bar.chord.root), 12);
          expect([0, third, 7], `bar ${bar.index} beat ${e.beat} midi ${e.midi}`).toContain(above);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('a chorus states its motif, repeats it, departs and returns: the same rhythm in bars 1-2, 3-4 and 7-8', () => {
    for (const { bars } of ALL) {
      for (const first of bars) {
        if (first.section.kind !== 'chorus' || first.barInSection !== 0 || first.index + 7 >= bars.length) continue;
        const rhythm = (offset: number): string => stepsOf(of(bars[first.index + offset]!, Voice.lead)).join(',');
        expect(rhythm(2)).toBe(rhythm(0));
        expect(rhythm(3)).toBe(rhythm(1));
        expect(rhythm(6)).toBe(rhythm(0));
        expect(rhythm(7)).toBe(rhythm(1));
        // The departure is not a copy of the statement.
        const line = (offset: number): string => of(bars[first.index + offset]!, Voice.lead).map((e) => `${e.beat}:${e.midi}`).join(',');
        expect(line(4) + line(5)).not.toBe(line(0) + line(1));
      }
    }
  });

  it('comes to rest on the root or fifth of the last chord of a chorus', () => {
    for (const { bars } of ALL) {
      for (const bar of bars) {
        if (bar.section.kind !== 'chorus' || bar.barInSection !== BARS_PER_SECTION - 1) continue;
        const last = of(bar, Voice.lead).at(-1)!;
        const above = mod(last.midi - bar.section.tonic - degreeToSemitones(bar.chord.root), 12);
        expect([0, 7]).toContain(above);
        expect(last.duration).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('slides only between notes that touch, and never further than a fifth', () => {
    for (const { bars } of ALL) {
      for (const bar of bars) {
        const notes = of(bar, Voice.lead);
        for (let i = 0; i < notes.length; i++) {
          const e = notes[i]!;
          if (e.glide === 0) continue;
          expect(i).toBeGreaterThan(0);
          expect(Math.abs(e.glide)).toBeLessThanOrEqual(7);
          expect(e.midi + e.glide).toBe(notes[i - 1]!.midi);
        }
      }
    }
  });
});

describe('song: form', () => {
  it('opens with an intro, in eight-bar sections that know their neighbours', () => {
    for (const { seed, bars } of ALL) {
      expect(bars[0]!.section.kind).toBe('intro');
      const song = createSong(seed);
      for (const bar of bars) {
        expect(bar.barInSection).toBe((bar.index - bar.section.startBar));
        expect(bar.barInSection).toBeLessThan(BARS_PER_SECTION);
        expect(bar.section.startBar % BARS_PER_SECTION).toBe(0);
        if (bar.index >= BARS_PER_SECTION) {
          const before = bars[bar.section.startBar - 1];
          if (before) {
            expect(before.section.nextKind).toBe(bar.section.kind);
            expect(bar.section.prevKind).toBe(before.section.kind);
            expect(bar.section.index).toBe(before.section.index + 1);
          }
        }
        expect(song.sectionAt(bar.index)).toEqual(bar.section);
      }
    }
  });

  it('uses all four kinds of section in ten minutes and never the same kind three times running', () => {
    for (const { bars } of ALL) {
      const kinds: SectionKind[] = [];
      for (let i = 0; i < bars.length; i += BARS_PER_SECTION) kinds.push(bars[i]!.section.kind);
      expect(new Set(kinds).size).toBe(4);
      for (let i = 2; i < kinds.length; i++) expect(kinds[i] === kinds[i - 1] && kinds[i] === kinds[i - 2]).toBe(false);
    }
  });

  it('changes key at every movement, across a quiet section', () => {
    for (const { bars } of ALL) {
      let movements = 0;
      for (let i = BARS_PER_SECTION; i < bars.length; i += BARS_PER_SECTION) {
        const here = bars[i]!.section;
        const before = bars[i - 1]!.section;
        expect(here.movement - before.movement).toBeLessThanOrEqual(1);
        if (here.movement === before.movement) continue;
        movements++;
        expect(mod(here.tonic - here.transpose, 12)).not.toBe(mod(before.tonic - before.transpose, 12));
        expect(['intro', 'break']).toContain(here.kind);
        expect(here.variant).toBe(0);
      }
      // No form is longer than MAX_SECTIONS_PER_MOVEMENT sections, so ten minutes hold several.
      expect(movements).toBeGreaterThanOrEqual(Math.floor(bars.length / (MAX_SECTIONS_PER_MOVEMENT * BARS_PER_SECTION)) - 1);
      expect(movements).toBeGreaterThanOrEqual(3);
    }
  });

  it('only the third chorus of a movement is raised, by a tone', () => {
    let raised = 0;
    for (const { bars } of ALL) {
      for (const bar of bars) {
        const expected = bar.section.kind === 'chorus' && bar.section.variant >= 2 ? 2 : 0;
        expect(bar.section.transpose).toBe(expected);
        if (expected > 0) raised++;
      }
    }
    expect(raised).toBeGreaterThan(0);
  });

  it('energy is 0..1, highest in a chorus and lowest in a break or the opening', () => {
    for (const { seed, bars } of ALL) {
      const mean: Record<SectionKind, number[]> = { intro: [], verse: [], chorus: [], break: [] };
      for (const bar of bars) {
        expect(bar.energy).toBeGreaterThan(0);
        expect(bar.energy).toBeLessThanOrEqual(1);
        mean[bar.section.kind].push(bar.energy);
      }
      const avg = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
      expect(avg(mean.chorus)).toBeGreaterThan(avg(mean.verse));
      expect(avg(mean.verse)).toBeGreaterThan(avg(mean.break));
      expect(avg(mean.verse)).toBeGreaterThan(avg(mean.intro));

      const song = createSong(seed);
      expect(song.energyAt(-5)).toBe(bars[0]!.energy);
      expect(song.energyAt(0)).toBe(bars[0]!.energy);
      // From the second beat of a bar on it is that bar's energy; it never steps by more than the eased rate.
      for (const bar of bars.slice(0, 80)) {
        expect(song.energyAt(bar.index * BEATS_PER_BAR + 1.5)).toBeCloseTo(bar.energy, 12);
        expect(song.energyAt(bar.index * BEATS_PER_BAR + 3.999)).toBeCloseTo(bar.energy, 12);
      }
      let previous = song.energyAt(0);
      for (let beat = 0; beat < 400; beat += 0.05) {
        const e = song.energyAt(beat);
        expect(Math.abs(e - previous)).toBeLessThan(0.05);
        previous = e;
      }
    }
  });
});

describe('song: determinism and variety', () => {
  it('the same seed is the same song, in whatever order the bars are asked for', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const forwards = barsOf(seed, 200);
      const song = createSong(seed);
      const order = [199, 3, 150, 64, 0, 65, 63, 128, 7, 8, 120, 121, 40];
      for (const i of order) expect(song.bar(i)).toEqual(forwards[i]);
      const backwards = createSong(seed);
      for (let i = 199; i >= 0; i--) expect(backwards.bar(i)).toEqual(forwards[i]);
    }
  });

  it('asking twice returns the same events, and a far bar does not disturb a near one', () => {
    const song = createSong(11);
    const early = JSON.stringify(song.bar(5));
    song.bar(5000);
    for (let i = 100; i < 140; i++) song.bar(i);
    expect(JSON.stringify(song.bar(5))).toBe(early);
    expect(song.bar(5000).section.movement).toBeGreaterThan(60);
  });

  it('different seeds are different songs', () => {
    const text = ALL.map(({ bars }) => bars.slice(8, 40).map(signature).join('|'));
    expect(new Set(text).size).toBe(SEEDS.length);
    const leads = ALL.map(({ bars }) => bars.filter((b) => b.section.kind === 'chorus').slice(0, 8).map((b) => of(b, Voice.lead).map((e) => `${e.beat}:${mod(e.midi - b.section.tonic, 12)}`).join(',')).join('|'));
    expect(new Set(leads).size).toBe(SEEDS.length);
  });

  it('ten minutes are not a short loop', () => {
    for (const { bars } of ALL) {
      const distinct = new Set(bars.map(signature));
      expect(distinct.size).toBeGreaterThan(60);
      // No two sections in a row play the same eight bars.
      const sections: string[] = [];
      for (let i = 0; i + BARS_PER_SECTION <= bars.length; i += BARS_PER_SECTION) {
        sections.push(bars.slice(i, i + BARS_PER_SECTION).map(signature).join('|'));
      }
      for (let i = 1; i < sections.length; i++) expect(sections[i]).not.toBe(sections[i - 1]);
      // And the material itself turns over: several keys and several chorus melodies.
      const keys = new Set(bars.map((b) => b.section.tonic));
      expect(keys.size).toBeGreaterThanOrEqual(3);
      const melodies = new Set(bars.filter((b) => b.section.kind === 'chorus' && b.barInSection === 0 && b.section.variant === 0)
        .map((b) => of(b, Voice.lead).map((e) => `${e.beat}:${mod(e.midi - b.section.tonic, 12)}`).join(',')));
      expect(melodies.size).toBeGreaterThanOrEqual(3);
    }
  });

  it('whooshes are rare and never crowd each other', () => {
    for (const { bars } of ALL) {
      const at = bars.filter((b) => of(b, Voice.whoosh).length > 0).map((b) => b.index);
      expect(at.length).toBeGreaterThan(3);
      expect(at.length).toBeLessThan(bars.length * 0.15);
      for (const bar of bars) expect(of(bar, Voice.whoosh).length).toBeLessThanOrEqual(1);
      const blocks = at.map((i) => Math.floor(i / 4));
      expect(new Set(blocks).size).toBe(blocks.length);
    }
  });

  it('every voice is used', () => {
    const used = new Set<number>();
    for (const bar of ALL[0]!.bars) for (const e of bar.events) used.add(e.voice);
    expect(used.size).toBe(Object.keys(Voice).length);
    expect(STEPS_PER_BAR).toBe(16);
  });
});
