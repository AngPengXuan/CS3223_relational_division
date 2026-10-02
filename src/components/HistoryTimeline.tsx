import { useEffect, useMemo, useState } from 'react';
import { nextStage, previousStage, stageStartIndexes, stepWithinStage } from '../history';
import type { Frame, Phase } from '../relation';
import {
  IconPause,
  IconPlay,
  IconRestart,
  IconSkipEnd,
  IconSkipStart,
  IconStepBack,
  IconStepForward,
} from './TransportIcons';
import './HistoryTimeline.css';

interface Props {
  frames: Frame[];
  cursor: number;
  onSeek: (index: number) => void;
}

const PLAY_INTERVAL_MS = 900;

/**
 * Colour family for each sub-step tag: green for a match or an answer, red for
 * a miss, amber for disk-heavy reorganisation, teal for reading and building.
 */
function phaseTone(phase: Phase): string {
  switch (phase) {
    case 'match':
    case 'probe-hit':
    case 'output':
      return 'ok';
    case 'miss':
    case 'probe-miss':
      return 'danger';
    case 'sort':
    case 'partition':
    case 'flush':
      return 'warn';
    case 'read':
    case 'group':
    case 'build':
    case 'intersect':
      return 'move';
    default:
      return 'plain';
  }
}

export function HistoryTimeline({ frames, cursor, onSeek }: Props) {
  const [playing, setPlaying] = useState(false);
  const last = frames.length - 1;
  const atStart = cursor === 0;
  const atEnd = cursor >= last;

  const ticks = useMemo(() => stageStartIndexes(frames), [frames]);

  useEffect(() => {
    if (!playing) return;
    if (atEnd) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => onSeek(cursor + 1), PLAY_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [playing, atEnd, cursor, onSeek]);

  function seek(index: number) {
    setPlaying(false);
    onSeek(index);
  }

  // Three states: pause while running, restart once the end is reached, play otherwise.
  const middle = playing ? 'pause' : atEnd ? 'restart' : 'play';

  function handleMiddle() {
    if (middle === 'pause') {
      setPlaying(false);
      return;
    }
    if (middle === 'restart') onSeek(0);
    setPlaying(true);
  }

  const current = frames[cursor];
  const totalStages = frames[last].stageIndex + 1;
  const { step, total } = stepWithinStage(frames, cursor);

  return (
    <section className="timeline">
      <div className="transport">
        <button
          className="transport-button"
          onClick={() => seek(previousStage(frames, cursor))}
          disabled={atStart}
          title="Previous stage"
          aria-label="Previous stage"
        >
          <IconSkipStart />
        </button>
        <button
          className="transport-button"
          onClick={() => seek(cursor - 1)}
          disabled={atStart}
          title="Previous sub-step"
          aria-label="Previous sub-step"
        >
          <IconStepBack />
        </button>
        <button
          className="transport-button primary"
          onClick={handleMiddle}
          disabled={last === 0}
          title={middle === 'pause' ? 'Pause' : middle === 'restart' ? 'Replay from start' : 'Play'}
          aria-label={
            middle === 'pause' ? 'Pause' : middle === 'restart' ? 'Replay from start' : 'Play'
          }
        >
          {middle === 'pause' ? <IconPause /> : middle === 'restart' ? <IconRestart /> : <IconPlay />}
        </button>
        <button
          className="transport-button"
          onClick={() => seek(cursor + 1)}
          disabled={atEnd}
          title="Next sub-step"
          aria-label="Next sub-step"
        >
          <IconStepForward />
        </button>
        <button
          className="transport-button"
          onClick={() => seek(nextStage(frames, cursor))}
          disabled={atEnd}
          title="Next stage"
          aria-label="Next stage"
        >
          <IconSkipEnd />
        </button>
      </div>

      <div className="timeline-track">
        <div className="slider-wrap">
          <input
            type="range"
            className="timeline-slider"
            min={0}
            max={last}
            step={1}
            value={cursor}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Algorithm sub-step"
          />
          <div className="tick-strip" aria-hidden="true">
            {last > 0 &&
              ticks.map((t) => (
                <span
                  key={t}
                  className={`tick ${t === cursor ? 'here' : ''}`}
                  style={{ left: `calc(8px + (100% - 16px) * ${t / last})` }}
                />
              ))}
          </div>
        </div>
        <span className="timeline-position">
          {cursor} / {last}
        </span>
      </div>

      <div className="frame-line">
        <span className="op-tag stage">{current.stageLabel}</span>
        <span className="counter">
          stage {current.stageIndex + 1} of {totalStages}
        </span>
        <span className={`phase-tag ${phaseTone(current.phase)}`}>{current.label}</span>
        {total > 1 && (
          <span className="counter">
            sub-step {step} of {total}
          </span>
        )}
      </div>

      <p className="frame-detail">{current.detail}</p>
    </section>
  );
}
