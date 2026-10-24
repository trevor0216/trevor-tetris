import type { PieceType } from "./types";

/**
 * TETR.IO's PRNG: a Park–Miller LCG (multiplier 16807, modulus 2^31 - 1),
 * as reimplemented in Triangle.js src/engine/utils/rng/index.ts.
 */
export class Rng {
  private value: number;

  constructor(seed: number) {
    this.value = seed % 2147483647;
    if (this.value <= 0) this.value += 2147483646;
  }

  next(): number {
    return (this.value = (16807 * this.value) % 2147483647);
  }

  nextFloat(): number {
    return (this.next() - 1) / 2147483646;
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i !== 0; i--) {
      const r = Math.floor(this.nextFloat() * (i + 1));
      [arr[i], arr[r]] = [arr[r], arr[i]];
    }
    return arr;
  }
}

export interface PieceQueue {
  /** Takes the next piece, or undefined when a fixed queue runs out. */
  shift(): PieceType | undefined;
  /** The next `n` pieces without consuming them (fewer if the queue is finite). */
  peek(n: number): PieceType[];
}

/** 7-bag in TETR.IO's base order Z L O S I J T, shuffled with Rng (Triangle.js queue/rng/bag7.ts). */
export class BagQueue implements PieceQueue {
  private rng: Rng;
  private buf: PieceType[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  private fill(n: number) {
    while (this.buf.length < n) this.buf.push(...this.rng.shuffle<PieceType>(["Z", "L", "O", "S", "I", "J", "T"]));
  }

  shift(): PieceType {
    this.fill(1);
    return this.buf.shift()!;
  }

  peek(n: number): PieceType[] {
    this.fill(n);
    return this.buf.slice(0, n);
  }
}

/** A fixed, finite piece sequence (puzzle mode). */
export class FixedQueue implements PieceQueue {
  private pieces: PieceType[];

  constructor(pieces: PieceType[]) {
    this.pieces = [...pieces];
  }

  shift(): PieceType | undefined {
    return this.pieces.shift();
  }

  peek(n: number): PieceType[] {
    return this.pieces.slice(0, n);
  }

  get remaining(): number {
    return this.pieces.length;
  }
}
