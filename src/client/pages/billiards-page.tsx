/**
 * Billiards Lab — a deterministic carom simulation.
 *
 * The strike variables (initial velocity vector, spin axis / rate) and the
 * physical coefficients fully determine the evolution; because the engine is
 * a fixed-step pure function, the "predicted paths" overlay is not an
 * approximation but exactly what the live run will do.
 */
import { useMemo, useState } from 'react';

import {
  CAROM_TABLE,
  cloneBalls,
  predictPaths,
  strike,
  type BallState,
} from '@shared/billiards/physics';

import { ballSpec, BALL_SPECS, CUE_BALL_ID, toStrikeInput } from '../billiards/config';
import { BilliardsControls } from '../billiards/controls';
import { BilliardsScene } from '../billiards/scene';
import { useBilliardsSim, type SimEvent } from '../billiards/use-billiards';
import { useI18n } from '../i18n/locale-context';
import { TESTID } from '../testing/testids';

function BallReadout({ ball }: { ball: BallState }) {
  const { t } = useI18n();
  const spec = ballSpec(ball.id);
  const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
  const spin = Math.hypot(ball.spin.x, ball.spin.y, ball.spin.z);
  return (
    <li className="billiards-readout__row" data-testid={TESTID.billiards.ballState(ball.id)}>
      <span className="billiards-readout__dot" style={{ background: spec.color }} aria-hidden />
      <span className="billiards-readout__name">{t(spec.labelKey)}</span>
      <code>
        v {speed.toFixed(2)} m/s · ω {spin.toFixed(0)} rad/s
      </code>
    </li>
  );
}

function EventLog({ events }: { events: SimEvent[] }) {
  const { t } = useI18n();
  return (
    <div data-testid={TESTID.billiards.eventLog}>
      <h4 className="billiards-readout__subtitle">{t('billiards.events')}</h4>
      {events.length === 0 ? (
        <p className="muted billiards-readout__empty">{t('billiards.events.empty')}</p>
      ) : (
        <ol className="billiards-events">
          {events
            .slice()
            .reverse()
            .map((entry, index) => {
              const { event } = entry;
              const text =
                event.type === 'ball'
                  ? t('billiards.event.ball', {
                      ball: t(ballSpec(event.ballId).labelKey),
                      other: t(ballSpec(event.otherId).labelKey),
                    })
                  : t('billiards.event.cushion', { ball: t(ballSpec(event.ballId).labelKey) });
              return (
                <li key={`${entry.time}-${index}`}>
                  <code>{entry.time.toFixed(2)}s</code> {text}
                </li>
              );
            })}
        </ol>
      )}
    </div>
  );
}

export function BilliardsPage() {
  const { t } = useI18n();
  const sim = useBilliardsSim();
  const [showPrediction, setShowPrediction] = useState(true);

  // Exact preview: apply the current strike to a clone of the current layout
  // and run the same deterministic engine to rest.
  const prediction = useMemo(() => {
    if (!showPrediction || sim.phase !== 'idle') return null;
    const balls = cloneBalls(sim.snapshot);
    const cue = balls.find((ball) => ball.id === CUE_BALL_ID);
    if (!cue) return null;
    strike(cue, toStrikeInput(sim.shot));
    return predictPaths(balls, CAROM_TABLE, sim.physics);
  }, [showPrediction, sim.phase, sim.snapshot, sim.shot, sim.physics]);

  const orderedSnapshot = BALL_SPECS.map((spec) =>
    sim.snapshot.find((ball) => ball.id === spec.id),
  ).filter((ball): ball is BallState => ball !== undefined);

  return (
    <section className="billiards-page" data-testid={TESTID.billiards.page}>
      <header className="billiards-header">
        <h2>{t('billiards.title')}</h2>
        <p className="muted">{t('billiards.description')}</p>
      </header>
      <div className="billiards-layout">
        <div className="billiards-canvas" data-testid={TESTID.billiards.canvas}>
          <BilliardsScene sim={sim} prediction={prediction} />
        </div>
        <div className="billiards-side">
          <BilliardsControls
            sim={sim}
            showPrediction={showPrediction}
            onShowPredictionChange={setShowPrediction}
          />
          <section className="billiards-group billiards-readout">
            <h3>{t('billiards.group.state')}</h3>
            <p className="muted billiards-readout__time">
              {t('billiards.simTime')}: <code>{sim.simTime.toFixed(2)}s</code>
            </p>
            <ul className="billiards-readout__list">
              {orderedSnapshot.map((ball) => (
                <BallReadout key={ball.id} ball={ball} />
              ))}
            </ul>
            <EventLog events={sim.events} />
          </section>
        </div>
      </div>
    </section>
  );
}
