import { Board } from "./board";
import { DEFAULT_HANDLING, SDF_INFINITE, type Handling } from "./handling";
import { canMoveDown, detectTSpin, tryRotate } from "./movement";
import { spawnPos } from "./pieces";
import type { PieceQueue } from "./queue";
import type { Action, InputEvent, PiecePos, PieceType, Rotation, SpinKind } from "./types";

/*
 * Real-time game simulation at a fixed 60 Hz. The structure mirrors TETR.IO's
 * engine as reimplemented in Triangle.js (src/engine/index.ts, commit 1441854):
 * inputs carry a subframe offset, DAS/ARR and gravity are advanced up to each
 * input's subframe before it is applied, and the piece's y is a float so
 * gravity and soft drop accumulate fractional rows. See NOTES.md for each
 * constant and behavior and where it was verified.
 */

export interface GameOptions {
  queue: PieceQueue;
  board?: Board;
  hold?: PieceType | null;
  handling?: Partial<Handling>;
  /** Rows per frame. TETR.IO default 0.02 (one row every 50 frames). */
  gravity?: number;
  /** Frames on the ground before locking. TETR.IO default 30. */
  lockTime?: number;
  /** Move/rotate resets before a grounded piece force-locks. TETR.IO default 15. */
  lockResets?: number;
  allowHold?: boolean;
  allow180?: boolean;
  /** Clutch clears: after a line clear, a blocked spawn is pushed up instead of topping out. */
  clutch?: boolean;
}

export interface LockResult {
  piece: PieceType;
  pos: PiecePos;
  lines: number;
  spin: SpinKind;
  /** Full T-Spin Triple. */
  tst: boolean;
  perfectClear: boolean;
  /** B2B streak after this lock (0 = none). */
  b2b: number;
  /** Combo after this lock (0 = first clear in a chain or no clear). */
  combo: number;
  hardDrop: boolean;
  frame: number;
}

export type GameOver = null | "topout" | "queue-empty";

interface ShiftState {
  held: boolean;
  das: number;
  arr: number;
  dir: -1 | 1;
}

interface Falling {
  type: PieceType;
  rot: Rotation;
  x: number;
  /** Float row of the box top; the piece occupies row floor(y). */
  y: number;
  locking: number;
  lockResets: number;
  rotResets: number;
  totalRotations: number;
  highestY: number;
}

const SPAWN_SUBROW = 0.04;
const SAFE_LOCK_FRAMES = 7;

export class Game {
  readonly board: Board;
  readonly queue: PieceQueue;
  handling: Handling;
  readonly gravity: number;
  readonly lockTime: number;
  readonly maxLockResets: number;
  readonly allowHold: boolean;
  readonly allow180: boolean;
  readonly clutch: boolean;

  hold: PieceType | null;
  holdLocked = false;
  falling: Falling | null = null;
  over: GameOver = null;
  frame = 0;
  /** Spin state of the falling piece's last successful rotation; cleared by any move or fall. */
  lastSpin: SpinKind | null = null;

  stats = {
    pieces: 0,
    lines: 0,
    /** -1 = no active combo. */
    combo: -1,
    /** -1 = no active B2B. */
    b2b: -1,
    maxCombo: 0,
    maxB2b: 0,
    tspins: { mini: [0, 0, 0, 0], full: [0, 0, 0, 0] },
    quads: 0,
    perfectClears: 0,
  };

  private subframe = 0;
  private lShift: ShiftState = { held: false, das: 0, arr: 0, dir: -1 };
  private rShift: ShiftState = { held: false, das: 0, arr: 0, dir: 1 };
  private lastShift: -1 | 1 = -1;
  private softDropHeld = false;
  private hitWall = false;
  private forceLock = false;
  private safeLock = 0;
  private lastWasClear = false;
  private results: LockResult[] = [];

  constructor(opts: GameOptions) {
    this.board = opts.board ?? new Board();
    this.queue = opts.queue;
    this.hold = opts.hold ?? null;
    this.handling = { ...DEFAULT_HANDLING, ...opts.handling };
    this.gravity = opts.gravity ?? 0.02;
    this.lockTime = opts.lockTime ?? 30;
    this.maxLockResets = opts.lockResets ?? 15;
    this.allowHold = opts.allowHold ?? true;
    this.allow180 = opts.allow180 ?? true;
    this.clutch = opts.clutch ?? true;
    this.nextPiece(false);
  }

  /** The falling piece at its current integer row. */
  get piece(): PiecePos | null {
    const f = this.falling;
    return f && { type: f.type, rot: f.rot, x: f.x, y: Math.floor(f.y) };
  }

  /** Where the falling piece would land on a hard drop. */
  get ghost(): PiecePos | null {
    let p = this.piece;
    if (!p) return null;
    while (canMoveDown(this.board, p)) p = { ...p, y: p.y - 1 };
    return p;
  }

  /** Advances one frame, applying `events` at their subframe offsets. Returns pieces locked this frame. */
  tick(events: readonly InputEvent[] = []): LockResult[] {
    this.results = [];
    this.subframe = 0;
    for (const e of events) {
      this.processSubframe(e.subframe);
      if (e.type === "down") this.keyDown(e.action);
      else this.keyUp(e.action);
    }
    this.frame++;
    this.processAllShift(1 - this.subframe);
    this.fall(1 - this.subframe);
    return this.results;
  }

  // ---- input -------------------------------------------------------------

  private keyDown(action: Action) {
    if (this.over) return;
    switch (action) {
      case "moveLeft":
        this.activateShift(this.lShift);
        this.shift();
        return;
      case "moveRight":
        this.activateShift(this.rShift);
        this.shift();
        return;
      case "softDrop":
        this.softDropHeld = true;
        return;
      case "rotateCW":
        this.rotate(1);
        return;
      case "rotateCCW":
        this.rotate(-1);
        return;
      case "rotate180":
        if (this.allow180) this.rotate(2);
        return;
      case "hardDrop":
        if (this.safeLock !== 0) return;
        this.hardDrop();
        return;
      case "hold":
        this.doHold();
        return;
    }
  }

  private keyUp(action: Action) {
    switch (action) {
      case "moveLeft":
        this.releaseShift(this.lShift, this.rShift);
        return;
      case "moveRight":
        this.releaseShift(this.rShift, this.lShift);
        return;
      case "softDrop":
        this.softDropHeld = false;
        return;
    }
  }

  private activateShift(s: ShiftState) {
    s.held = true;
    s.das = 0;
    s.arr = this.handling.arr;
    this.lastShift = s.dir;
  }

  private releaseShift(s: ShiftState, other: ShiftState) {
    s.held = false;
    s.das = 0;
    if (other.held) this.lastShift = other.dir;
    if (this.handling.cancelDasOnDirectionChange) {
      other.arr = this.handling.arr;
      other.das = 0;
    }
  }

  private processSubframe(subframe: number) {
    if (subframe <= this.subframe) return;
    const delta = subframe - this.subframe;
    this.processAllShift(delta);
    this.fall(delta);
    this.subframe = subframe;
  }

  private processAllShift(delta: number) {
    this.processShift(this.lShift, delta);
    this.processShift(this.rShift, delta);
  }

  private processShift(s: ShiftState, delta: number) {
    if (!s.held || this.lastShift !== s.dir) return;
    const { das, arr } = this.handling;
    const arrDelta = Math.max(0, delta - Math.max(0, das - s.das));
    s.das = Math.min(s.das + delta, das);
    if (s.das < das) return;
    if (!this.falling) return;
    s.arr += arrDelta;
    if (s.arr < arr) return;
    const steps = arr === 0 ? this.board.width : Math.floor(s.arr / arr);
    s.arr -= arr * steps;
    for (let i = 0; i < steps; i++) this.shift();
  }

  /** DAS cut: only applies when the last shift attempt was blocked by a wall or stack. */
  private dcd() {
    const { das, dcd, arr } = this.handling;
    if (!this.hitWall || !dcd) return;
    for (const s of [this.lShift, this.rShift]) {
      s.das = Math.min(s.das, das - dcd);
      s.arr = arr;
    }
  }

  // ---- piece motion ------------------------------------------------------

  private fits(f: Falling, x: number, y: number, rot: Rotation = f.rot): boolean {
    return this.board.fits({ type: f.type, rot, x, y: Math.floor(y) });
  }

  private is20G(): boolean {
    if (!this.softDropHeld) return false;
    const { sdf, preferSoftDrop } = this.handling;
    return preferSoftDrop && (sdf === SDF_INFINITE || this.gravity * sdf > this.board.visibleHeight);
  }

  private shouldLock(): boolean {
    return !!this.falling && this.falling.lockResets >= this.maxLockResets;
  }

  private shift(): boolean {
    const f = this.falling;
    if (!f) return false;
    if (!this.fits(f, f.x + this.lastShift, f.y)) {
      this.hitWall = true;
      return false;
    }
    f.x += this.lastShift;
    f.lockResets = Math.min(31, f.lockResets + 1);
    this.hitWall = false;
    this.lastSpin = null;
    if (this.is20G()) this.slamToFloor();
    if (!this.shouldLock()) f.locking = 0;
    return true;
  }

  private rotate(amount: 1 | -1 | 2): boolean {
    const f = this.falling;
    if (!f) return false;
    const r = tryRotate(this.board, this.piece!, amount);
    if (!r) return false;
    f.rot = r.pos.rot;
    if (r.kickIndex >= 0) {
      const keepSubrow = f.totalRotations > this.maxLockResets + 15;
      f.x += r.kick[0];
      f.y = (keepSubrow ? f.y : Math.ceil(f.y) - 0.1) + r.kick[1];
    }
    f.lockResets = Math.min(31, f.lockResets + 1);
    f.rotResets = Math.min(63, f.rotResets + 1);
    this.lastSpin = detectTSpin(this.board, r.pos, r.tstKick);
    f.totalRotations++;
    this.dcd();
    if (!this.shouldLock()) f.locking = 0;
    return true;
  }

  /** Moves the piece down by up to one row; fails unless the whole next row is free. */
  private fallBy(v: number): boolean {
    const f = this.falling!;
    let y1 = Math.round(1e6 * (f.y - v)) / 1e6;
    let y2 = f.y - 1;
    if (y1 % 1 === 0) y1 -= 1e-6;
    if (y2 % 1 === 0) y2 += 2e-6;
    if (!this.fits(f, f.x, y1) || !this.fits(f, f.x, y2)) return false;
    const highest = f.highestY;
    if (highest > y1) f.highestY = Math.floor(y1);
    f.y = y1;
    this.lastSpin = null;
    if (y1 < highest) {
      f.lockResets = 0;
      f.rotResets = 0;
    }
    return true;
  }

  private slamToFloor() {
    while (this.fallBy(1));
  }

  private fall(sub: number) {
    if (this.safeLock > 0) this.safeLock--;
    const f = this.falling;
    if (!f || this.over) return;

    let amount = this.gravity * sub;
    if (this.softDropHeld) {
      const { sdf } = this.handling;
      amount = sdf === SDF_INFINITE ? 400 * sub : Math.max(amount * sdf, 0.05 * sdf);
    }
    if (this.shouldLock() && !canMoveDown(this.board, this.piece!)) {
      amount = 20;
      this.forceLock = true;
    }
    const fastAfter = this.maxLockResets + 15;
    if (f.rotResets > fastAfter) amount += 0.5 * sub * (f.rotResets - fastAfter);

    for (let d = amount; d > 0; d -= Math.min(1, d)) {
      if (!this.fallBy(Math.min(1, d))) {
        f.locking += sub;
        if (f.locking > this.lockTime || this.forceLock || this.shouldLock()) {
          if (this.handling.preventAccidentalHardDrops) this.safeLock = SAFE_LOCK_FRAMES;
          this.lock(false);
        }
        return;
      }
    }
  }

  private hardDrop() {
    if (!this.falling) return;
    this.slamToFloor();
    this.lock(true);
  }

  private doHold() {
    const f = this.falling;
    if (!f || !this.allowHold || this.holdLocked) return;
    if (this.hold) {
      const held = this.hold;
      this.hold = f.type;
      this.initiatePiece(held, true);
    } else {
      if (this.queue.peek(1).length === 0) return;
      this.hold = f.type;
      this.nextPiece(true);
    }
    this.holdLocked = true;
  }

  // ---- lock & spawn ------------------------------------------------------

  private lock(hardDrop: boolean) {
    const pos = this.piece!;
    const spin = this.lastSpin ?? "none";
    this.board.place(pos);
    const lines = this.board.clearLines().length;
    const perfectClear = lines > 0 && this.board.isEmpty();

    const s = this.stats;
    s.pieces++;
    s.lines += lines;
    if (lines > 0) {
      s.combo++;
      if (spin !== "none" || lines >= 4) s.b2b++;
      else s.b2b = -1;
    } else {
      s.combo = -1;
    }
    if (spin !== "none") s.tspins[spin][lines]++;
    if (lines >= 4 && spin === "none") s.quads++;
    if (perfectClear) s.perfectClears++;
    s.maxCombo = Math.max(s.maxCombo, s.combo);
    s.maxB2b = Math.max(s.maxB2b, s.b2b);

    this.results.push({
      piece: pos.type,
      pos,
      lines,
      spin,
      tst: spin === "full" && lines === 3,
      perfectClear,
      b2b: Math.max(s.b2b, 0),
      combo: Math.max(s.combo, 0),
      hardDrop,
      frame: this.frame,
    });

    this.lastWasClear = lines > 0;
    this.holdLocked = false;
    this.nextPiece(false);
  }

  private nextPiece(isHold: boolean) {
    let next = this.queue.shift();
    // A finite queue can still play out the held piece.
    if (next === undefined && !isHold && this.hold && this.allowHold) {
      next = this.hold;
      this.hold = null;
    }
    if (next === undefined) {
      this.falling = null;
      this.over = "queue-empty";
      return;
    }
    this.initiatePiece(next, isHold);
  }

  private initiatePiece(type: PieceType, isHold: boolean) {
    this.dcd();
    this.hitWall = false;
    this.forceLock = false;
    this.lastSpin = null;
    if (!isHold) this.holdLocked = false;

    const sp = spawnPos(type, this.board.width, this.board.visibleHeight);
    const f: Falling = {
      type,
      rot: 0,
      x: sp.x,
      y: sp.y + SPAWN_SUBROW,
      locking: 0,
      lockResets: 0,
      rotResets: 0,
      totalRotations: 0,
      highestY: sp.y,
    };
    this.falling = f;

    if (!this.fits(f, f.x, f.y)) {
      let ok = false;
      if (this.lastWasClear && this.clutch) {
        while (Math.floor(f.y) < this.board.height) {
          f.y++;
          f.highestY++;
          if (this.fits(f, f.x, f.y)) {
            ok = true;
            break;
          }
        }
      }
      if (!ok) {
        this.falling = null;
        this.over = "topout";
        return;
      }
    }
    if (this.is20G()) this.slamToFloor();
  }
}
