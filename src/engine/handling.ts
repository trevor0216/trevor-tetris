/** SDF value that means "infinite" (instant soft drop). TETR.IO stores ∞ the same way. */
export const SDF_INFINITE = 41;

/** All times in frames (1F = 1/60 s). */
export interface Handling {
  /** Auto repeat rate. 0 = instant to the wall. */
  arr: number;
  /** Delayed auto shift; fractional values allowed. */
  das: number;
  /** DAS cut delay after rotate / hold / spawn while pressed against a wall. */
  dcd: number;
  /** Soft drop factor; SDF_INFINITE (41) = ∞. */
  sdf: number;
  /** Ignore hard drop for 7 frames after a piece locks by itself. */
  preventAccidentalHardDrops: boolean;
  /** Releasing one direction while holding the other restarts the held direction's DAS. */
  cancelDasOnDirectionChange: boolean;
  /** With ∞ SDF, keep the piece on the floor while moving (soft drop wins). */
  preferSoftDrop: boolean;
}

export const DEFAULT_HANDLING: Readonly<Handling> = {
  arr: 0,
  das: 5.5,
  dcd: 2,
  sdf: 40,
  preventAccidentalHardDrops: true,
  cancelDasOnDirectionChange: false,
  preferSoftDrop: true,
};

export const FRAME_MS = 1000 / 60;
