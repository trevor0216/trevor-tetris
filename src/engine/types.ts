export type PieceType = "I" | "J" | "L" | "O" | "S" | "T" | "Z";
export const PIECE_TYPES: readonly PieceType[] = ["I", "J", "L", "O", "S", "T", "Z"];

/** 0 = spawn, 1 = R (one CW turn), 2 = 180, 3 = L (one CCW turn). */
export type Rotation = 0 | 1 | 2 | 3;

/**
 * Board cell codes. 0 is empty, 1-7 are the piece colors (index into
 * PIECE_TYPES + 1), 8 is garbage.
 */
export type CellValue = number;
export const EMPTY = 0;
export const GARBAGE = 8;

export function pieceCell(type: PieceType): CellValue {
  return PIECE_TYPES.indexOf(type) + 1;
}

export function cellPiece(value: CellValue): PieceType | null {
  return value >= 1 && value <= 7 ? PIECE_TYPES[value - 1] : null;
}

/**
 * Board coordinates are y-up: row 0 is the bottom row. A piece's (x, y) is the
 * top-left corner of its bounding box; cell (cx, cy) of the box (cy counted
 * downward) sits at board (x + cx, y - cy).
 */
export interface PiecePos {
  type: PieceType;
  rot: Rotation;
  x: number;
  y: number;
}

export type SpinKind = "none" | "mini" | "full";

export type Action =
  | "moveLeft"
  | "moveRight"
  | "softDrop"
  | "hardDrop"
  | "rotateCW"
  | "rotateCCW"
  | "rotate180"
  | "hold";

export interface InputEvent {
  type: "down" | "up";
  action: Action;
  /** Position within the current frame, in [0, 1). */
  subframe: number;
}
