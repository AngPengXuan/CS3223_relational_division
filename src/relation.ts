/**
 * Shared vocabulary for the division algorithms: tuples and pages, the order
 * and hash function they rely on, the snapshot the renderer consumes, and the
 * recorder that turns an instrumented run into timeline frames.
 */

export type Value = string;

/** A tuple of r is [T, S]; a tuple of s is [S]. */
export type Row = Value[];

export interface Page {
  id: string;
  rows: Row[];
}

/** A relation on disk, cut into pages of `capacity` tuples. */
export interface Relation {
  id: string;
  name: string;
  schema: string[];
  capacity: number;
  pages: Page[];
  note?: string;
}

export interface MemItem {
  id: string;
  text: string;
  /** Sticky verdict, kept across frames: a matched S value, a discarded or output T value. */
  mark?: 'ok' | 'bad';
}

export interface MemGroup {
  id: string;
  label?: string;
  items: MemItem[];
}

/** Something held in memory: a sort group, a hash table, a set of T values. */
export interface MemBlock {
  id: string;
  title: string;
  note?: string;
  /** Display order; blocks are drawn lowest first. */
  order: number;
  groups: MemGroup[];
}

export interface Snapshot {
  disk: Relation[];
  memory: MemBlock[];
  output: Value[];
  reads: number;
  writes: number;
}

export type Emphasis = 'active' | 'match' | 'miss' | 'moved' | 'output';

/** A page, tuple, memory block, bucket or item to highlight, by id. */
export interface Focus {
  id: string;
  emphasis: Emphasis;
}

export type Phase =
  | 'init'
  | 'sort'
  | 'read'
  | 'group'
  | 'partition'
  | 'flush'
  | 'build'
  | 'match'
  | 'miss'
  | 'probe-hit'
  | 'probe-miss'
  | 'output'
  | 'skip'
  | 'intersect'
  | 'done';

/**
 * One frame of the timeline: the whole run exactly as it stood at one sub-step.
 * Frames are grouped into stages ("Sort", "Group T = Alice", "Partition r₁"),
 * and `isOpStart` marks the first frame of each, which is where the slider
 * draws its tick marks.
 */
export interface Frame {
  stageIndex: number;
  stageLabel: string;
  /** Which line of the algorithm's step list this frame belongs to; -1 for none. */
  step: number;
  phase: Phase;
  label: string;
  detail: string;
  focus: Focus[];
  snapshot: Snapshot;
  stats: string;
  isOpStart: boolean;
}

// ------------------------------------------------------------ ordering

const INTEGER = /^-?\d+$/;

/**
 * Integers compare numerically and everything else by code point, so "c10"
 * sorts after "c9" only if you write it as a number. Equality is exactly
 * string equality, which the merge in the sort-based algorithm depends on.
 */
export function cmp(a: Value, b: Value): number {
  if (INTEGER.test(a) && INTEGER.test(b)) return Number(a) - Number(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortRows(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    for (let i = 0; i < a.length; i++) {
      const c = cmp(a[i], b[i]);
      if (c !== 0) return c;
    }
    return 0;
  });
}

// --------------------------------------------------------------- hashing

/**
 * Integers hash to themselves, so partitioning numeric data can be checked by
 * hand; anything else goes through 32-bit FNV-1a, which spreads short strings
 * like "CS2040" and "CS1010" far better than summing character codes would.
 */
export function h(v: Value): number {
  if (INTEGER.test(v)) return Math.abs(Number(v));
  let x = 2166136261;
  for (let i = 0; i < v.length; i++) {
    x ^= v.charCodeAt(i);
    x = Math.imul(x, 16777619) >>> 0;
  }
  return x;
}

/** The composite key (T, S) an in-memory hash table is built on. */
export function h2(t: Value, s: Value): number {
  return h(`${t}\u0000${s}`);
}

// ----------------------------------------------------------------- pages

export function makeRelation(
  id: string,
  name: string,
  schema: string[],
  rows: Row[],
  capacity: number,
  note?: string,
): Relation {
  const pages: Page[] = [];
  for (let i = 0; i < rows.length; i += capacity) {
    pages.push({ id: `${id}.p${pages.length}`, rows: rows.slice(i, i + capacity) });
  }
  return { id, name, schema, capacity, pages, note };
}

export function rowId(pageId: string, i: number): string {
  return `${pageId}.${i}`;
}

/** Every tuple of `rel` with where it lives, in file order. */
export function locate(rel: Relation): { row: Row; page: number; id: string }[] {
  return rel.pages.flatMap((p, page) =>
    p.rows.map((row, i) => ({ row, page, id: rowId(p.id, i) })),
  );
}

/**
 * Appends to the last page, opening a new one when it is full. Reports whether
 * the append filled the page, which is the moment an output buffer is written.
 */
export function appendRow(rel: Relation, row: Row): { id: string; filled: boolean } {
  let last = rel.pages[rel.pages.length - 1];
  if (!last || last.rows.length >= rel.capacity) {
    last = { id: `${rel.id}.p${rel.pages.length}`, rows: [] };
    rel.pages.push(last);
  }
  last.rows.push(row);
  return { id: rowId(last.id, last.rows.length - 1), filled: last.rows.length === rel.capacity };
}

export function pageFocus(rel: Relation, emphasis: Emphasis): Focus[] {
  return rel.pages.map((p) => ({ id: p.id, emphasis }));
}

// ------------------------------------------------------------------ text

const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';

export function sub(i: number): string {
  return String(i)
    .split('')
    .map((d) => SUBSCRIPTS[Number(d)])
    .join('');
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function setText(values: Value[]): string {
  return `{${values.join(', ')}}`;
}

export function tupleText(row: Row): string {
  return `(${row.join(', ')})`;
}

export function pageName(rel: Relation, index: number): string {
  return `${rel.name} page ${index + 1}`;
}

export function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

export function distinctT(rows: Row[]): Value[] {
  return [...new Set(rows.map((r) => r[0]))].sort(cmp);
}

// -------------------------------------------------------------- recorder

/**
 * The live state of one run, plus the frames captured from it. Algorithms
 * mutate the public fields directly and call `emit` at every moment worth
 * seeing; each emit deep-copies the state, so later mutation never leaks
 * back into an earlier frame.
 */
export class Recorder {
  disk: Relation[] = [];
  memory: MemBlock[] = [];
  output: Value[] = [];
  reads = 0;
  writes = 0;
  step = -1;
  readonly frames: Frame[] = [];

  private stageIndex = -1;
  private stageLabel = '';
  private stageOpen = false;

  stage(label: string) {
    this.stageIndex += 1;
    this.stageLabel = label;
    this.stageOpen = false;
  }

  emit(phase: Phase, label: string, detail: string, focus: Focus[] = []) {
    const snapshot: Snapshot = structuredClone({
      disk: this.disk,
      memory: [...this.memory].sort((a, b) => a.order - b.order),
      output: this.output,
      reads: this.reads,
      writes: this.writes,
    });
    this.frames.push({
      stageIndex: this.stageIndex,
      stageLabel: this.stageLabel,
      step: this.step,
      phase,
      label,
      detail,
      focus,
      snapshot,
      stats: `${plural(this.reads, 'read')} · ${plural(this.writes, 'write')}`,
      isOpStart: !this.stageOpen,
    });
    this.stageOpen = true;
  }

  rel(id: string): Relation {
    const rel = this.disk.find((r) => r.id === id);
    if (!rel) throw new Error(`No relation ${id}`);
    return rel;
  }

  putRelation(rel: Relation) {
    const i = this.disk.findIndex((r) => r.id === rel.id);
    if (i >= 0) this.disk[i] = rel;
    else this.disk.push(rel);
  }

  putMemory(block: MemBlock) {
    this.dropMemory(block.id);
    this.memory.push(block);
  }

  dropMemory(...ids: string[]) {
    this.memory = this.memory.filter((b) => !ids.includes(b.id));
  }
}

/** Starts a run with r and s on disk, as given, and records the opening frame. */
export function begin(r: Row[], s: Row[], capacity: number, intro: string): Recorder {
  const rec = new Recorder();
  rec.disk = [
    makeRelation('r', 'r', ['T', 'S'], r, capacity),
    makeRelation('s', 's', ['S'], s, capacity),
  ];
  const rPages = rec.rel('r').pages.length;
  const sPages = rec.rel('s').pages.length;
  rec.stage('Input');
  rec.emit(
    'init',
    'Input relations',
    `r(T, S) holds ${plural(r.length, 'tuple')} on ${plural(rPages, 'page')} and s(S) holds ` +
      `${plural(s.length, 'value')} on ${plural(sPages, 'page')}, ${capacity} tuples to a page. ` +
      `r ÷ s is every T value that appears in r paired with every S value in s. ${intro}`,
  );
  return rec;
}

/**
 * The degenerate inputs no algorithm needs to run for. Returns true, with the
 * final frame recorded, when the answer is already known.
 */
export function settleTrivial(rec: Recorder): boolean {
  const r = locate(rec.rel('r')).map((t) => t.row);
  const s = locate(rec.rel('s'));
  if (r.length === 0) {
    rec.stage('Done');
    rec.emit('done', 'Empty r', 'r is empty, so no T value exists to qualify: r ÷ s = ∅.');
    return true;
  }
  if (s.length === 0) {
    rec.output = distinctT(r);
    rec.stage('Done');
    rec.emit(
      'done',
      'Empty s',
      `With s empty, every T value vacuously pairs with all of s, so r ÷ s = π_T(r) = ` +
        `${setText(rec.output)}. No algorithm is needed.`,
      rec.output.map((t) => ({ id: `out.${t}`, emphasis: 'output' as const })),
    );
    return true;
  }
  return false;
}
