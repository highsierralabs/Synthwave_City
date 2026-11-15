// The beat contract (architecture.md section 6).

export interface BeatSource {
  /**
   * Fractional beats since the music started, from the audio clock, or null when audio is not
   * running. The engine falls back to its own clock at BPM when this returns null.
   */
  beatPosition(): number | null;
  /** Loudness of the current section, 0..1. Optional; 1 is assumed. */
  energy?(): number;
}
