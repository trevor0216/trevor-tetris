import { pieceCells } from "./pieces";
import { EMPTY, GARBAGE, PIECE_TYPES, cellPiece, pieceCell } from "./types";
import type { CellValue, PiecePos, PieceType } from "./types";

/** A 10-wide board with `visibleHeight` visible rows plus a hidden buffer above. Row 0 is the bottom. */
export class Board {
  readonly width: number;
  readonly visibleHeight: number;
  readonly height: number;
  readonly cells: Uint8Array;

  constructor(width = 10, visibleHeight = 20, buffer = 20, cells?: Uint8Array) {
    this.width = width;
    this.visibleHeight = visibleHeight;
    this.height = visibleHeight + buffer;
    this.cells = cells ?? new Uint8Array(width * this.height);
  }

  get(x: number, y: number): CellValue {
    return this.cells[y * this.width + x];
  }

  set(x: number, y: number, v: CellValue): void {
    this.cells[y * this.width + x] = v;
  }

  /** Walls, floor and the ceiling of the buffer count as occupied. */
  occupied(x: number, y: number): boolean {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return true;
    return this.get(x, y) !== EMPTY;
  }

  fits(p: PiecePos): boolean {
    for (const [x, y] of pieceCells(p)) if (this.occupied(x, y)) return false;
    return true;
  }

  place(p: PiecePos): void {
    const v = pieceCell(p.type);
    for (const [x, y] of pieceCells(p)) this.set(x, y, v);
  }

  isRowFull(y: number): boolean {
    for (let x = 0; x < this.width; x++) if (this.get(x, y) === EMPTY) return false;
    return true;
  }

  /** Removes full rows, shifting everything above down. Returns cleared row indices (pre-clear). */
  clearLines(): number[] {
    const cleared: number[] = [];
    let write = 0;
    for (let y = 0; y < this.height; y++) {
      if (this.isRowFull(y)) {
        cleared.push(y);
        continue;
      }
      if (write !== y) this.cells.copyWithin(write * this.width, y * this.width, (y + 1) * this.width);
      write++;
    }
    this.cells.fill(EMPTY, write * this.width);
    return cleared;
  }

  isEmpty(): boolean {
    return this.cells.every((c) => c === EMPTY);
  }

  clone(): Board {
    return new Board(this.width, this.visibleHeight, this.height - this.visibleHeight, this.cells.slice());
  }

  /**
   * Builds a board from rows written top to bottom: "." empty, "G" garbage,
   * IJLOSTZ colored cells. The last string is row 0.
   */
  static fromRows(rows: string[], width = 10, visibleHeight = 20, buffer = 20): Board {
    const b = new Board(width, visibleHeight, buffer);
    if (rows.length > b.height) throw new Error(`board has ${rows.length} rows, max ${b.height}`);
    rows.forEach((row, i) => {
      if (row.length !== width) throw new Error(`row ${i} is ${row.length} wide, expected ${width}: "${row}"`);
      const y = rows.length - 1 - i;
      [...row].forEach((ch, x) => b.set(x, y, charToCell(ch)));
    });
    return b;
  }

  /** Rows top to bottom, trimmed to the highest non-empty row (at least `minRows`). */
  toRows(minRows = 0): string[] {
    let top = -1;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) if (this.get(x, y) !== EMPTY) top = y;
    }
    const rows: string[] = [];
    for (let y = Math.max(top, minRows - 1); y >= 0; y--) {
      let s = "";
      for (let x = 0; x < this.width; x++) s += cellToChar(this.get(x, y));
      rows.push(s);
    }
    return rows;
  }
}

export function charToCell(ch: string): CellValue {
  if (ch === ".") return EMPTY;
  if (ch === "G") return GARBAGE;
  if ((PIECE_TYPES as readonly string[]).includes(ch)) return pieceCell(ch as PieceType);
  throw new Error(`bad board character "${ch}"`);
}

export function cellToChar(v: CellValue): string {
  if (v === EMPTY) return ".";
  if (v === GARBAGE) return "G";
  return cellPiece(v) ?? "?";
}
