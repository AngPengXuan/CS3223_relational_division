import type { Frame, Row } from './relation';

// ----------------------------------------------------------------- input

export interface ParsedRelation {
  rows: Row[];
  invalid: string[];
  duplicates: number;
}

function dedupe(rows: Row[]): { rows: Row[]; duplicates: number } {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const row of rows) {
    const key = row.join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return { rows: out, duplicates: rows.length - out.length };
}

/**
 * Reads r as "Alice CS2040, Alice CS1010" -- one tuple per comma, semicolon or line,
 * T and S separated by spaces or a colon. Relations are sets, so duplicate
 * tuples are dropped and counted rather than kept.
 */
export function parseR(raw: string): ParsedRelation {
  const rows: Row[] = [];
  const invalid: string[] = [];
  for (const entry of raw.split(/[\n,;]+/).map((e) => e.trim())) {
    if (entry === '') continue;
    const parts = entry.split(/[\s:]+/).filter((p) => p !== '');
    if (parts.length === 2) rows.push(parts);
    else invalid.push(entry);
  }
  return { ...dedupe(rows), invalid };
}

/** Reads s as "CS2040, CS1010, CS2102" -- any mix of commas, semicolons and whitespace. */
export function parseS(raw: string): ParsedRelation {
  const rows = raw
    .split(/[\s,;]+/)
    .filter((v) => v !== '')
    .map((v) => [v]);
  return { ...dedupe(rows), invalid: [] };
}

// ------------------------------------------------------------ navigation

/** Index of the first frame of the stage `frames[at]` belongs to. */
export function stageStart(frames: Frame[], at: number): number {
  let i = at;
  while (i > 0 && !frames[i].isOpStart) i--;
  return i;
}

/** Index of the last frame of the stage `frames[at]` belongs to. */
export function stageEnd(frames: Frame[], at: number): number {
  const stage = frames[at].stageIndex;
  let i = at;
  while (i + 1 < frames.length && frames[i + 1].stageIndex === stage) i++;
  return i;
}

/** Where the cursor sits inside its own stage, 1-based. */
export function stepWithinStage(frames: Frame[], at: number): { step: number; total: number } {
  const start = stageStart(frames, at);
  const end = stageEnd(frames, at);
  return { step: at - start + 1, total: end - start + 1 };
}

/** Frame indexes that begin a stage -- the tick marks under the slider. */
export function stageStartIndexes(frames: Frame[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < frames.length; i++) if (frames[i].isOpStart) out.push(i);
  return out;
}

/** Track-skip back: to the start of this stage, or the previous one if already there. */
export function previousStage(frames: Frame[], at: number): number {
  const start = stageStart(frames, at);
  if (at > start) return start;
  return start > 0 ? stageStart(frames, start - 1) : 0;
}

/** Track-skip forward: to the next stage's first frame, or the very end. */
export function nextStage(frames: Frame[], at: number): number {
  const end = stageEnd(frames, at);
  return end + 1 < frames.length ? end + 1 : frames.length - 1;
}
