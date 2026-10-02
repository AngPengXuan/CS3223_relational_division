import {
  begin,
  cmp,
  locate,
  makeRelation,
  pageFocus,
  plural,
  setText,
  settleTrivial,
  sortRows,
} from './relation';
import type { Focus, Frame, MemBlock, Row } from './relation';

export const SORT_STEPS = [
  'Sort s on S',
  'Sort r on (T, S)',
  'Scan r, reading one T group until the T value changes',
  'Merge the group against s, checking every s value appears',
  'Output T if all matched; move on to the next T group',
];

/**
 * Sort-based division. After both sorts, r is scanned exactly once, a group at
 * a time, and s is re-scanned from the top for every group -- a merge join
 * between one group's S values and s. Sorting is not counted, matching the
 * |r| + N × |s| analysis.
 */
export function sortDivision(r: Row[], s: Row[], capacity: number): Frame[] {
  const rec = begin(
    r,
    s,
    capacity,
    'Sort-based: sort both inputs, then a single pass over r with one merge pass over s per T group.',
  );
  if (settleTrivial(rec)) return rec.frames;

  rec.stage('Sort');
  rec.step = 0;
  rec.putRelation(makeRelation('s', 's', ['S'], sortRows(s), capacity, 'sorted on S'));
  rec.emit(
    'sort',
    'Sort s on S',
    `External sort of s: ${setText(sortRows(s).map((x) => x[0]))}. ` +
      `The sorting cost is left out of the count, as in the analysis.`,
    pageFocus(rec.rel('s'), 'moved'),
  );

  rec.step = 1;
  rec.putRelation(makeRelation('r', 'r', ['T', 'S'], sortRows(r), capacity, 'sorted on (T, S)'));
  rec.emit(
    'sort',
    'Sort r on (T, S)',
    'Every tuple with the same T value is now contiguous, and inside each group the S values ' +
      'ascend in the same order as s — so one merge pass is enough to check a group against s.',
    pageFocus(rec.rel('r'), 'moved'),
  );

  const rRel = rec.rel('r');
  const sRel = rec.rel('s');
  const rTuples = locate(rRel);
  const sTuples = locate(sRel);
  let rLoaded = -1;
  let groups = 0;
  let sReads = 0;

  for (let i = 0; i < rTuples.length; ) {
    const t = rTuples[i].row[0];
    groups += 1;
    rec.stage(`Group ${t}`);
    rec.step = 2;

    // Read r until T changes. Seeing that it changed means reading the next
    // tuple, which may be on a fresh page; that page then stays in the buffer
    // for the next group, so each r page is still read exactly once.
    const readNow: number[] = [];
    const load = (page: number) => {
      if (page === rLoaded) return;
      rLoaded = page;
      rec.reads += 1;
      readNow.push(page + 1);
    };
    const group: typeof rTuples = [];
    let j = i;
    while (j < rTuples.length && rTuples[j].row[0] === t) {
      load(rTuples[j].page);
      group.push(rTuples[j]);
      j++;
    }
    const next = rTuples[j];
    if (next) load(next.page);

    const block: MemBlock = {
      id: 'grp',
      title: `Current group: T = ${t}`,
      note: 'S values, ascending',
      order: 0,
      groups: [{ id: 'grp.g', items: group.map((g, k) => ({ id: `grp.${k}`, text: g.row[1] })) }],
    };
    rec.putMemory(block);
    const readText =
      readNow.length > 0
        ? `Read r page${readNow.length > 1 ? 's' : ''} ${readNow.join(', ')}. `
        : 'The page needed is already in the buffer. ';
    rec.emit(
      'group',
      `Scan group ${t}`,
      `${readText}Collected ${plural(group.length, 'tuple')} with T = ${t}, S ∈ ` +
        `${setText(group.map((g) => g.row[1]))}. ` +
        (next
          ? `The next tuple has T = ${next.row[0]}, so the group ends here.`
          : 'That is the end of r.'),
      [
        ...group.map((g): Focus => ({ id: g.id, emphasis: 'active' })),
        ...(next ? [{ id: next.id, emphasis: 'moved' } as Focus] : []),
      ],
    );

    // Merge: both sides ascend, so a cursor into each is enough.
    rec.step = 3;
    let g = 0;
    let sLoaded = -1;
    let ok = true;
    for (const sv of sTuples) {
      const want = sv.row[0];
      let sText = '';
      if (sv.page !== sLoaded) {
        sLoaded = sv.page;
        rec.reads += 1;
        sReads += 1;
        sText = `Read s page ${sv.page + 1}. `;
      }
      const skipped: string[] = [];
      while (g < group.length && cmp(group[g].row[1], want) < 0) {
        skipped.push(group[g].row[1]);
        g++;
      }
      const skipText =
        skipped.length > 0
          ? `Skip ${setText(skipped)} in the group — extra S values s does not ask for. `
          : '';

      if (g < group.length && group[g].row[1] === want) {
        block.groups[0].items[g].mark = 'ok';
        rec.emit(
          'match',
          `${want} ✓`,
          `${sText}${skipText}s needs ${want}; the group's cursor is on ${want}. Match — advance both cursors.`,
          [
            { id: sv.id, emphasis: 'match' },
            { id: `grp.${g}`, emphasis: 'match' },
            { id: group[g].id, emphasis: 'match' },
          ],
        );
        g++;
      } else {
        const where =
          g < group.length
            ? `the group's cursor is already on ${group[g].row[1]}, past ${want}`
            : 'the group has no S values left';
        rec.emit(
          'miss',
          `${want} missing — discard ${t}`,
          `${sText}${skipText}s needs ${want}, but ${where}. Both sides are sorted, so ${want} ` +
            `cannot turn up later: (${t}, ${want}) is not in r. ${t} fails, and the rest of s ` +
            `need not be read for this group.`,
          [
            { id: sv.id, emphasis: 'miss' },
            { id: 'grp', emphasis: 'miss' },
            ...(g < group.length ? [{ id: `grp.${g}`, emphasis: 'miss' } as Focus] : []),
          ],
        );
        ok = false;
        break;
      }
    }

    if (ok) {
      rec.step = 4;
      rec.output.push(t);
      rec.emit(
        'output',
        `Output ${t}`,
        `Every value of s was found in ${t}'s group, so ${t} ∈ r ÷ s.`,
        [
          { id: 'grp', emphasis: 'match' },
          { id: `out.${t}`, emphasis: 'output' },
        ],
      );
    }
    i = j;
  }

  rec.stage('Done');
  rec.step = -1;
  rec.memory = [];
  const rPages = rRel.pages.length;
  const sPages = sRel.pages.length;
  const bound = rPages + groups * sPages;
  rec.emit(
    'done',
    'Done',
    `r ÷ s = ${setText(rec.output)}. Excluding the sorts: r was read once (${plural(rPages, 'page')}) ` +
      `and s cost ${plural(sReads, 'page read')} over N = ${groups} T groups. The bound ` +
      `|r| + N × |s| = ${rPages} + ${groups} × ${sPages} = ${bound} assumes every group scans all of s` +
      (rec.reads < bound
        ? `; stopping at a group's first missing value saved ${bound - rec.reads} here.`
        : ', which is what happened here.'),
    rec.output.map((t) => ({ id: `out.${t}`, emphasis: 'output' as const })),
  );
  return rec.frames;
}
