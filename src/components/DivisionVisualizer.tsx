import { useMemo } from 'react';
import type { Emphasis, Focus, MemBlock, Relation, Snapshot } from '../relation';
import { rowId } from '../relation';
import './DivisionVisualizer.css';

interface Props {
  snapshot: Snapshot;
  focus: Focus[];
}

type FocusClass = (id: string) => string;

export function DivisionVisualizer({ snapshot, focus }: Props) {
  const focusById = useMemo(() => {
    const map = new Map<string, Emphasis>();
    for (const f of focus) map.set(f.id, f.emphasis);
    return map;
  }, [focus]);

  const cls: FocusClass = (id) => {
    const e = focusById.get(id);
    return e ? `focus-${e}` : '';
  };

  return (
    <div className="division-canvas">
      <section className="pane disk-pane">
        <h2 className="pane-head">Disk</h2>
        {snapshot.disk.map((rel) => (
          <RelationCard key={rel.id} rel={rel} cls={cls} />
        ))}
      </section>

      <section className="pane memory-pane">
        <h2 className="pane-head">Memory</h2>
        {snapshot.memory.length === 0 ? (
          <p className="empty-note">Nothing held in memory.</p>
        ) : (
          snapshot.memory.map((block) => <MemoryCard key={block.id} block={block} cls={cls} />)
        )}
      </section>

      <section className="pane output-pane">
        <h2 className="pane-head">r ÷ s</h2>
        <div className="output-chips">
          {snapshot.output.length === 0 ? (
            <span className="empty-note">nothing yet</span>
          ) : (
            snapshot.output.map((t) => (
              <span key={t} className={`chip out ${cls(`out.${t}`)}`}>
                {t}
              </span>
            ))
          )}
        </div>
        <h2 className="pane-head">Disk I/O</h2>
        <dl className="cost">
          <div>
            <dt>page reads</dt>
            <dd>{snapshot.reads}</dd>
          </div>
          <div>
            <dt>page writes</dt>
            <dd>{snapshot.writes}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function RelationCard({ rel, cls }: { rel: Relation; cls: FocusClass }) {
  return (
    <div className={`relation ${cls(rel.id)}`}>
      <div className="relation-head">
        <span className="relation-name">
          {rel.name}({rel.schema.join(', ')})
        </span>
        {rel.note && <span className="relation-note">{rel.note}</span>}
        <span className="relation-size">
          {rel.pages.length} page{rel.pages.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="pages">
        {rel.pages.length === 0 && <span className="empty-note">empty</span>}
        {rel.pages.map((page, p) => (
          <div key={page.id} className={`page ${cls(page.id)}`}>
            <div className="page-head">p{p + 1}</div>
            {Array.from({ length: rel.capacity }, (_, i) => {
              const row = page.rows[i];
              if (!row) return <div key={i} className="tuple empty" />;
              return (
                <div key={i} className={`tuple ${cls(rowId(page.id, i))}`}>
                  {row.map((v, c) => (
                    <span key={c} className="cell">
                      {v}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function MemoryCard({ block, cls }: { block: MemBlock; cls: FocusClass }) {
  return (
    <div className={`mem-block ${cls(block.id)}`}>
      <div className="mem-head">
        <span className="mem-title">{block.title}</span>
        {block.note && <span className="mem-note">{block.note}</span>}
      </div>
      {block.groups.map((g) => (
        <div key={g.id} className={`mem-group ${cls(g.id)}`}>
          {g.label !== undefined && <span className="mem-label">{g.label}</span>}
          <div className="mem-items">
            {g.items.length === 0 && <span className="empty-note">—</span>}
            {g.items.map((item) => (
              <span
                key={item.id}
                className={`chip ${item.mark ? `mark-${item.mark}` : ''} ${cls(item.id)}`}
              >
                {item.text}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
