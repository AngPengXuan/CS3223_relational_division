import { useCallback, useState } from 'react';
import { DivisionVisualizer } from './components/DivisionVisualizer';
import { HistoryTimeline } from './components/HistoryTimeline';
import { GENERAL_STEPS, HASH_STEPS, hashDivision, hashDivisionGeneral } from './hashDivision';
import { parseR, parseS } from './history';
import type { Frame, Row } from './relation';
import { SORT_STEPS, sortDivision } from './sortDivision';
import './App.css';

type Algorithm = 'sort' | 'hash' | 'hash-general';

const ALGORITHMS: { value: Algorithm; label: string; steps: string[] }[] = [
  { value: 'sort', label: 'Sort-based', steps: SORT_STEPS },
  { value: 'hash', label: 'Hash-based', steps: HASH_STEPS },
  { value: 'hash-general', label: 'Hash-based (general)', steps: GENERAL_STEPS },
];

const CAPACITIES = [2, 3, 4];
const PARTITIONS = [2, 3, 4];

const EXAMPLE_R =
  'Alice CS2040, Bob CS1010, Alice CS1010, Carol CS3223, Dan CS1010, Carol CS2040, ' +
  'Alice CS2102, Bob CS2040, Carol CS2102, Carol CS1010';
const EXAMPLE_S = 'CS2040, CS1010, CS2102';

const NAMES = ['Alice', 'Bob', 'Carol', 'Dan', 'Eve', 'Frank', 'Grace', 'Heidi'];
const COURSES = ['CS1010', 'CS2040', 'CS2102', 'CS2103', 'CS3223', 'CS3230'];

interface Settings {
  algorithm: Algorithm;
  capacity: number;
  partitions: number;
  r: Row[];
  s: Row[];
}

function run({ algorithm, capacity, partitions, r, s }: Settings): Frame[] {
  if (algorithm === 'sort') return sortDivision(r, s, capacity);
  if (algorithm === 'hash') return hashDivision(r, s, capacity, partitions);
  return hashDivisionGeneral(r, s, capacity, partitions);
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A random instance that is worth dividing: some T values hold all of s (so
 * the answer is rarely empty), the rest hold a random subset, and every T
 * gets a few extra S values s does not ask for.
 */
function randomInstance(): { r: string; s: string } {
  const s = shuffle(COURSES).slice(0, 2 + Math.floor(Math.random() * 2));
  const names = shuffle(NAMES).slice(0, 4 + Math.floor(Math.random() * 2));
  const tuples: string[] = [];
  names.forEach((t, i) => {
    const complete = i < 2 || Math.random() < 0.3;
    for (const c of COURSES) {
      const wanted = s.includes(c);
      if ((wanted && (complete || Math.random() < 0.5)) || (!wanted && Math.random() < 0.3)) {
        tuples.push(`${t} ${c}`);
      }
    }
  });
  return { r: shuffle(tuples).join(', '), s: s.join(', ') };
}

function describe(r: Row[], s: Row[]): string {
  return `r has ${r.length} tuple${r.length === 1 ? '' : 's'}, s has ${s.length} value${
    s.length === 1 ? '' : 's'
  }. Step through the timeline to watch the algorithm run.`;
}

function App() {
  const [settings, setSettings] = useState<Settings>(() => ({
    algorithm: 'sort',
    capacity: 3,
    partitions: 3,
    r: parseR(EXAMPLE_R).rows,
    s: parseS(EXAMPLE_S).rows,
  }));
  const [frames, setFrames] = useState<Frame[]>(() => run(settings));
  const [cursor, setCursor] = useState(0);
  const [rText, setRText] = useState(EXAMPLE_R);
  const [sText, setSText] = useState(EXAMPLE_S);
  const [message, setMessage] = useState(describe(settings.r, settings.s));

  const current = frames[cursor];
  const steps = ALGORITHMS.find((a) => a.value === settings.algorithm)!.steps;

  /** Re-runs the algorithm under `next` and rewinds the timeline to its first frame. */
  function rebuild(next: Settings) {
    setSettings(next);
    setFrames(run(next));
    setCursor(0);
  }

  function load(rRaw: string, sRaw: string) {
    const r = parseR(rRaw);
    const s = parseS(sRaw);
    const notes: string[] = [describe(r.rows, s.rows)];
    if (r.invalid.length > 0) notes.push(`Ignored (need "T S"): ${r.invalid.join(', ')}.`);
    const dupes = r.duplicates + s.duplicates;
    if (dupes > 0) notes.push(`Dropped ${dupes} duplicate${dupes === 1 ? '' : 's'}.`);
    rebuild({ ...settings, r: r.rows, s: s.rows });
    setMessage(notes.join(' '));
  }

  const handleSeek = useCallback(
    (index: number) => {
      setCursor(Math.min(Math.max(index, 0), frames.length - 1));
    },
    [frames.length],
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>Relational Division Visualiser</h1>
        <p className="subtitle">
          CS3223 — computing r(T, S) ÷ s(S): the T values that appear in r with <em>every</em> S
          value in s. Step through the sort-based and hash-based algorithms page by page, and
          watch what each one reads, keeps in memory, and outputs.
        </p>
      </header>

      <section className="controls">
        <div className="control-group">
          <label htmlFor="algorithm">Algorithm</label>
          <select
            id="algorithm"
            className="wide"
            value={settings.algorithm}
            onChange={(e) => {
              const algorithm = e.target.value as Algorithm;
              rebuild({ ...settings, algorithm });
              setMessage(`Switched to the ${ALGORITHMS.find((a) => a.value === algorithm)!.label.toLowerCase()} algorithm.`);
            }}
          >
            {ALGORITHMS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label htmlFor="capacity">Tuples per page</label>
          <select
            id="capacity"
            value={settings.capacity}
            onChange={(e) => {
              const capacity = Number(e.target.value);
              rebuild({ ...settings, capacity });
              setMessage(`Pages now hold ${capacity} tuples.`);
            }}
          >
            {CAPACITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {settings.algorithm !== 'sort' && (
          <div className="control-group">
            <label htmlFor="partitions">Partitions (k)</label>
            <select
              id="partitions"
              value={settings.partitions}
              onChange={(e) => {
                const partitions = Number(e.target.value);
                rebuild({ ...settings, partitions });
                setMessage(`Partitioning into ${partitions} now.`);
              }}
            >
              {PARTITIONS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="control-group actions">
          <button
            className="ghost"
            onClick={() => {
              const inst = randomInstance();
              setRText(inst.r);
              setSText(inst.s);
              load(inst.r, inst.s);
            }}
          >
            Random
          </button>
          <button
            className="ghost"
            onClick={() => {
              setRText(EXAMPLE_R);
              setSText(EXAMPLE_S);
              load(EXAMPLE_R, EXAMPLE_S);
            }}
          >
            Example
          </button>
        </div>

        <form
          className="relation-form"
          onSubmit={(e) => {
            e.preventDefault();
            load(rText, sText);
          }}
        >
          <label htmlFor="r-input">r(T, S)</label>
          <textarea
            id="r-input"
            rows={2}
            value={rText}
            onChange={(e) => setRText(e.target.value)}
            placeholder="Alice CS2040, Alice CS1010, Bob CS2040"
            spellCheck={false}
          />
          <label htmlFor="s-input">s(S)</label>
          <input
            id="s-input"
            type="text"
            value={sText}
            onChange={(e) => setSText(e.target.value)}
            placeholder="CS2040, CS1010"
            spellCheck={false}
          />
          <button type="submit">Run</button>
        </form>

        <p className="field-hint">
          Write r as <code>T S</code> pairs separated by commas or new lines, and s as a list of S
          values. Integers order and hash as themselves (<code>h(v) = v</code>), so numeric data
          can be checked by hand; other values sort by character code and hash with FNV-1a. Each
          frame shows exact page reads and writes;{' '}
          {settings.algorithm === 'sort'
            ? 'the sorts themselves are not counted, matching the |r| + N × |s| analysis.'
            : 'the in-memory hash table uses 4 buckets on the composite key (T, S).'}
        </p>
      </section>

      <div className="status-bar">
        <span>{message}</span>
        <span className="stats">{current.stats}</span>
      </div>

      <HistoryTimeline frames={frames} cursor={cursor} onSeek={handleSeek} />

      <ol className="steps">
        {steps.map((text, i) => (
          <li key={i} className={i === current.step ? 'here' : ''}>
            {text}
          </li>
        ))}
      </ol>

      <DivisionVisualizer snapshot={current.snapshot} focus={current.focus} />
    </div>
  );
}

export default App;
