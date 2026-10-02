import {
  appendRow,
  begin,
  h,
  h2,
  locate,
  makeRelation,
  pageFocus,
  pageName,
  plural,
  range,
  setText,
  settleTrivial,
  sub,
  tupleText,
} from './relation';
import type { Focus, Frame, MemBlock, Recorder, Row, Value } from './relation';

export const HASH_STEPS = [
  'Read s once and keep it in memory',
  'Partition r on T, so each partition fits in memory',
  'Build: hash table on (T, S), plus the distinct T values',
  'Probe (VT, s) for every s; a miss discards VT',
  'Output VT when every probe hits',
];

export const GENERAL_STEPS = [
  'Partition r on S',
  'Partition s on S, with the same hash function',
  'Run the standard hash algorithm on each pair (rᵢ, sᵢ), giving Qᵢ',
  'Intersect: r ÷ s = Q₀ ∩ Q₁ ∩ …',
];

/** Buckets of the in-memory hash table; small, so its contents stay readable. */
const MEM_BUCKETS = 4;

function keyOf(t: Value, s: Value): string {
  return `${t}\u0000${s}`;
}

/**
 * Hashes every tuple of `srcId` on column `col` into k partitions on disk. An
 * output page is written the moment it fills; the partly filled ones are
 * written in a final flush.
 */
function partition(rec: Recorder, srcId: string, col: number, k: number) {
  const src = rec.rel(srcId);
  const attr = src.schema[col];
  const parts = range(k).map((i) => {
    const rel = makeRelation(
      `${srcId}${i}`,
      `${src.name}${sub(i)}`,
      src.schema,
      [],
      src.capacity,
      `h(${attr}) mod ${k} = ${i}`,
    );
    rec.putRelation(rel);
    return rel;
  });

  src.pages.forEach((page, index) => {
    rec.reads += 1;
    const focus: Focus[] = [{ id: page.id, emphasis: 'active' }];
    const lines: string[] = [];
    let filled = 0;
    for (const row of page.rows) {
      const p = h(row[col]) % k;
      const put = appendRow(parts[p], row);
      if (put.filled) {
        rec.writes += 1;
        filled += 1;
      }
      focus.push({ id: put.id, emphasis: 'moved' });
      lines.push(`${tupleText(row)} → ${parts[p].name}`);
    }
    rec.emit(
      'partition',
      `Partition ${pageName(src, index)}`,
      `Read ${pageName(src, index)} and hash each tuple on ${attr}: ${lines.join('; ')}.` +
        (filled > 0 ? ` ${plural(filled, 'output page')} filled and written out.` : ''),
      focus,
    );
  });

  const partial = parts.filter((p) => {
    const last = p.pages[p.pages.length - 1];
    return last && last.rows.length < p.capacity;
  });
  rec.writes += partial.length;
  rec.emit(
    'flush',
    `Flush ${src.name}'s partitions`,
    partial.length > 0
      ? `Write the ${plural(partial.length, 'partly filled output page')} ` +
          `(${partial.map((p) => p.name).join(', ')}). ${src.name} now lives in ${k} partitions.`
      : `Every output page was already full and written. ${src.name} now lives in ${k} partitions.`,
    partial.map((p) => ({ id: p.pages[p.pages.length - 1].id, emphasis: 'moved' as const })),
  );
}

interface StandardSteps {
  build: number;
  probe: number;
  output: number;
}

/**
 * The standard hash algorithm on one fragment of r, with s's values already in
 * memory under item ids `${sBlock}.${value}`. Builds the (T, S) table and the
 * distinct T values, then probes every (VT, s). Qualifying T values are handed
 * to `qualify`, which records them and returns the frame's explanation.
 */
function buildAndProbe(
  rec: Recorder,
  relId: string,
  sBlock: string,
  sValues: Value[],
  steps: StandardSteps,
  qualify: (t: Value) => { detail: string; focus: Focus[] },
): Value[] {
  const rel = rec.rel(relId);
  const table: MemBlock = {
    id: 'ht',
    title: `Hash table on (T, S), built from ${rel.name}`,
    note: `bucket = h(T, S) mod ${MEM_BUCKETS}`,
    order: 1,
    groups: range(MEM_BUCKETS).map((b) => ({ id: `ht.b${b}`, label: String(b), items: [] })),
  };
  const distinct: MemBlock = {
    id: 'dt',
    title: 'Distinct T values',
    order: 2,
    groups: [{ id: 'dt.g', items: [] }],
  };
  rec.putMemory(table);
  rec.putMemory(distinct);

  // ---- build
  rec.step = steps.build;
  const keys = new Set<string>();
  const ts: Value[] = [];
  rel.pages.forEach((page, index) => {
    rec.reads += 1;
    const focus: Focus[] = [{ id: page.id, emphasis: 'active' }];
    const lines: string[] = [];
    for (const [t, s] of page.rows) {
      const b = h2(t, s) % MEM_BUCKETS;
      const id = `ht.${keyOf(t, s)}`;
      table.groups[b].items.push({ id, text: `${t}, ${s}` });
      keys.add(keyOf(t, s));
      focus.push({ id, emphasis: 'moved' });
      const fresh = !ts.includes(t);
      if (fresh) {
        ts.push(t);
        distinct.groups[0].items.push({ id: `dt.${t}`, text: t });
        focus.push({ id: `dt.${t}`, emphasis: 'moved' });
      }
      lines.push(`(${t}, ${s}) → bucket ${b}${fresh ? `, new T value ${t}` : ''}`);
    }
    rec.emit(
      'build',
      `Build from ${pageName(rel, index)}`,
      `Read ${pageName(rel, index)} into the hash table: ${lines.join('; ')}.`,
      focus,
    );
  });

  // ---- probe
  const qualified: Value[] = [];
  for (const t of ts) {
    const item = distinct.groups[0].items.find((i) => i.id === `dt.${t}`)!;
    let ok = true;
    rec.step = steps.probe;
    for (const sv of sValues) {
      const b = h2(t, sv) % MEM_BUCKETS;
      if (keys.has(keyOf(t, sv))) {
        rec.emit(
          'probe-hit',
          `(${t}, ${sv}) found`,
          `VT = ${t}: probe bucket ${b} for (${t}, ${sv}) — found.`,
          [
            { id: `dt.${t}`, emphasis: 'active' },
            { id: `ht.${keyOf(t, sv)}`, emphasis: 'match' },
            { id: `${sBlock}.${sv}`, emphasis: 'match' },
          ],
        );
      } else {
        item.mark = 'bad';
        rec.emit(
          'probe-miss',
          `(${t}, ${sv}) absent — discard ${t}`,
          `VT = ${t}: probe bucket ${b} for (${t}, ${sv}) — not there, so ${t} never pairs ` +
            `with ${sv}. Discard ${t}; the rest of s need not be probed.`,
          [
            { id: `dt.${t}`, emphasis: 'miss' },
            { id: `ht.b${b}`, emphasis: 'miss' },
            { id: `${sBlock}.${sv}`, emphasis: 'miss' },
          ],
        );
        ok = false;
        break;
      }
    }
    if (ok) {
      item.mark = 'ok';
      qualified.push(t);
      rec.step = steps.output;
      const { detail, focus } = qualify(t);
      rec.emit('output', `${t} qualifies`, detail, [{ id: `dt.${t}`, emphasis: 'match' }, ...focus]);
    }
  }
  return qualified;
}

function sBlockFor(id: string, title: string, values: Value[]): MemBlock {
  return {
    id,
    title,
    order: 0,
    groups: [{ id: `${id}.g`, items: values.map((v) => ({ id: `${id}.${v}`, text: v })) }],
  };
}

/**
 * Hash-based division when, for any one T value, all of its r tuples fit in
 * memory: partition r on T so whole T groups land together, then build and
 * probe one partition at a time against s held in memory.
 */
export function hashDivision(r: Row[], s: Row[], capacity: number, k: number): Frame[] {
  const rec = begin(
    r,
    s,
    capacity,
    `Hash-based: partition r on T into ${k} partitions, then build and probe each one in memory.`,
  );
  if (settleTrivial(rec)) return rec.frames;

  const sRel = rec.rel('s');
  const sValues = locate(sRel).map((x) => x.row[0]);
  rec.stage('Load s');
  rec.step = 0;
  rec.reads += sRel.pages.length;
  rec.putMemory(sBlockFor('sm', 's, held in memory', sValues));
  rec.emit(
    'read',
    'Read s into memory',
    `Read s's ${plural(sRel.pages.length, 'page')} once. Every probe below checks against these ` +
      `${plural(sValues.length, 'value')}.`,
    pageFocus(sRel, 'active'),
  );

  rec.stage('Partition r on T');
  rec.step = 1;
  partition(rec, 'r', 0, k);

  for (const i of range(k)) {
    const part = rec.rel(`r${i}`);
    rec.stage(`Partition ${part.name}`);
    rec.dropMemory('ht', 'dt');
    if (part.pages.length === 0) {
      rec.step = 1;
      rec.emit('skip', `${part.name} is empty`, `No T value hashed to ${part.name}; nothing to do.`);
      continue;
    }
    buildAndProbe(rec, part.id, 'sm', sValues, { build: 2, probe: 3, output: 4 }, (t) => {
      rec.output.push(t);
      return {
        detail: `Every (${t}, s) probe hit, so ${t} ∈ r ÷ s. Output it. Since partitioning on T put ` +
          `all of ${t}'s tuples in ${part.name}, no other partition can change that verdict.`,
        focus: [{ id: `out.${t}`, emphasis: 'output' }],
      };
    });
  }

  rec.stage('Done');
  rec.step = -1;
  rec.memory = [];
  const rPages = rec.rel('r').pages.length;
  const partPages = range(k).reduce((n, i) => n + rec.rel(`r${i}`).pages.length, 0);
  rec.emit(
    'done',
    'Done',
    `r ÷ s = ${setText(rec.output)}. Cost: s read once (${sRel.pages.length}), r read once to ` +
      `partition (${rPages}), ${partPages} partition pages written and read back once each — ` +
      `${rec.reads} reads and ${rec.writes} writes, about |s| + 3|r|.`,
    rec.output.map((t) => ({ id: `out.${t}`, emphasis: 'output' as const })),
  );
  return rec.frames;
}

/**
 * The general case, when one T value's tuples may not fit in memory: partition
 * both r and s on S. Each sᵢ is then checked only against the rᵢ that could
 * hold its values; a T value is in r ÷ s exactly when it qualifies in every
 * pair, so the answer is the intersection of the per-pair results.
 */
export function hashDivisionGeneral(r: Row[], s: Row[], capacity: number, k: number): Frame[] {
  const rec = begin(
    r,
    s,
    capacity,
    `General hash-based: partition both r and s on S into ${k} partitions, divide each pair, ` +
      `and intersect.`,
  );
  if (settleTrivial(rec)) return rec.frames;

  rec.stage('Partition r on S');
  rec.step = 0;
  partition(rec, 'r', 1, k);

  rec.stage('Partition s on S');
  rec.step = 1;
  partition(rec, 's', 0, k);

  let acc: Value[] | null = null;
  const accBlock: MemBlock = {
    id: 'acc',
    title: 'Result so far: ∩ of the Qᵢ',
    note: 'no pair divided yet',
    order: 9,
    groups: [{ id: 'acc.g', items: [] }],
  };
  rec.putMemory(accBlock);

  for (const i of range(k)) {
    const ri = rec.rel(`r${i}`);
    const si = rec.rel(`s${i}`);
    const sValues = locate(si).map((x) => x.row[0]);
    rec.stage(`Pair ${ri.name} ÷ ${si.name}`);
    rec.dropMemory('ht', 'dt', 'sm', 'qi');
    rec.step = 2;

    if (sValues.length === 0) {
      rec.emit(
        'skip',
        `${si.name} is empty — skip`,
        `No value of s hashed to partition ${i}, so this pair asks nothing of any T value: ` +
          `every T trivially qualifies. It cannot narrow the intersection, so skip it.`,
        [{ id: si.id, emphasis: 'active' }],
      );
      continue;
    }

    rec.reads += si.pages.length;
    rec.putMemory(sBlockFor('sm', `${si.name}, held in memory`, sValues));
    const qBlock: MemBlock = {
      id: 'qi',
      title: `Q${sub(i)} = ${ri.name} ÷ ${si.name}`,
      order: 3,
      groups: [{ id: 'qi.g', items: [] }],
    };
    rec.putMemory(qBlock);

    let q: Value[];
    if (ri.pages.length === 0) {
      q = [];
      rec.emit(
        'read',
        `${ri.name} is empty`,
        `Read ${si.name} = ${setText(sValues)} into memory. But no tuple of r has an S value in ` +
          `partition ${i}, so no T value can pair with ${setText(sValues)}: Q${sub(i)} = ∅.`,
        [{ id: ri.id, emphasis: 'miss' }, ...pageFocus(si, 'active')],
      );
    } else {
      rec.emit(
        'read',
        `Read ${si.name} into memory`,
        `Read ${si.name} = ${setText(sValues)}. Only these S values can appear in ${ri.name}, so ` +
          `this pair is an ordinary division ${ri.name} ÷ ${si.name}.`,
        pageFocus(si, 'active'),
      );
      q = buildAndProbe(rec, ri.id, 'sm', sValues, { build: 2, probe: 2, output: 2 }, (t) => {
        qBlock.groups[0].items.push({ id: `qi.${t}`, text: t, mark: 'ok' });
        return {
          detail: `Every (${t}, s) probe hit for ${si.name}, so ${t} ∈ Q${sub(i)}. This is not yet ` +
            `an answer: ${t} must qualify in every other pair too.`,
          focus: [{ id: `qi.${t}`, emphasis: 'output' }],
        };
      });
    }

    // ---- intersect
    rec.step = 3;
    const before: Value[] | null = acc;
    const kept: Value[] = before === null ? q : before.filter((t) => q.includes(t));
    const dropped = before === null ? [] : before.filter((t) => !q.includes(t));
    acc = kept;
    accBlock.note = undefined;
    accBlock.groups[0].items = kept.map((t) => ({ id: `acc.${t}`, text: t }));
    rec.emit(
      'intersect',
      `Intersect with Q${sub(i)}`,
      before === null
        ? `First pair divided: the running result starts as Q${sub(i)} = ${setText(q)}.`
        : `${setText(before)} ∩ Q${sub(i)} ${setText(q)} = ${setText(kept)}.` +
            (dropped.length > 0
              ? ` ${setText(dropped)} dropped out: ${dropped.length === 1 ? 'it lacks' : 'they lack'} ` +
                `some S value in ${si.name}.`
              : ''),
      [
        { id: 'acc', emphasis: 'active' },
        ...kept.map((t): Focus => ({ id: `acc.${t}`, emphasis: 'match' })),
      ],
    );

    if (kept.length === 0) {
      rec.emit(
        'intersect',
        'Result is empty — stop',
        'The intersection is already empty, and intersecting further can only keep it so. ' +
          'The remaining pairs need not be read.',
        [{ id: 'acc', emphasis: 'miss' }],
      );
      break;
    }
  }

  rec.stage('Done');
  rec.step = -1;
  rec.memory = [];
  rec.output = acc ?? [];
  rec.emit(
    'done',
    'Done',
    `r ÷ s = ${setText(rec.output)}, the T values that qualified in every pair that had any s ` +
      `values. Cost: r and s each read once to partition, the partitions written, then read ` +
      `back once each — ${rec.reads} reads and ${rec.writes} writes.`,
    rec.output.map((t) => ({ id: `out.${t}`, emphasis: 'output' as const })),
  );
  return rec.frames;
}
