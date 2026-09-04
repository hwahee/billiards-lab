/**
 * Billiards Lab — a deterministic carom and pool simulation.
 *
 * The strike variables (initial velocity vector, spin axis / rate) and the
 * physical coefficients fully determine the evolution; because the engine is
 * a fixed-step pure function, the "predicted paths" overlay is not an
 * approximation but exactly what the live run will do.
 */
import { useMemo, useState } from 'react';

import { DEFAULT_PARAMS, type BallState } from '@shared/billiards/physics';

import { AIM_SCHEMES, activeAimCue } from '../billiards/aim';
import { useAimScheme } from '../billiards/aim/use-aim-scheme';
import { ballLabel, ballSpec, PRESETS } from '../billiards/config';
import { HudLayer, HudPanel } from '../billiards/ui';
import { BilliardsControls } from '../billiards/controls';
import { BilliardsScene } from '../billiards/scene';
import type { SimEvent } from '@shared/billiards/game-state';

import { useBilliardsSim } from '../billiards/use-billiards';
import { usePredictedPaths } from '../billiards/use-predicted-paths';
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
      <span className="billiards-readout__name">{ballLabel(t, ball.id)}</span>
      <code>
        {ball.potted ? (
          t('billiards.potted')
        ) : (
          <>
            v {speed.toFixed(2)} m/s · ω {spin.toFixed(0)} rad/s
          </>
        )}
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
                      ball: ballLabel(t, event.ballId),
                      other: ballLabel(t, event.otherId),
                    })
                  : event.type === 'cushion'
                    ? t('billiards.event.cushion', { ball: ballLabel(t, event.ballId) })
                    : t('billiards.event.pocket', { ball: ballLabel(t, event.ballId) });
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
  const [aimScheme, setAimScheme] = useAimScheme();
  const AimOverlay = AIM_SCHEMES[aimScheme].Overlay;
  const aimCue = activeAimCue(sim);
  const preset = PRESETS[sim.variant];

  // Exact preview: the current strike applied to a clone of the current
  // layout and run to rest by the same deterministic engine. Aiming changes
  // its input on every pointer move, so it runs on a frame callback rather
  // than here — see usePredictedPaths.
  const prediction = usePredictedPaths({
    enabled: showPrediction && sim.phase === 'idle',
    balls: sim.snapshot,
    cueBallId: preset.cueBallId,
    table: preset.table,
    physics: sim.physics,
    shot: sim.shot,
  });

  // Derived once per snapshot: the readout list below is rebuilt whenever
  // this array is, and aiming re-renders this page dozens of times a second
  // without touching the snapshot at all.
  const orderedSnapshot = useMemo(
    () =>
      preset.ballSpecs
        .map((spec) => sim.snapshot.find((ball) => ball.id === spec.id))
        .filter((ball): ball is BallState => ball !== undefined),
    [preset, sim.snapshot],
  );

  return (
    <section className="billiards-page" data-testid={TESTID.billiards.page}>
      <header className="billiards-header">
        <h2>{t('billiards.title')}</h2>
        <p className="muted">{t('billiards.description')}</p>
      </header>
      <div className="billiards-layout">
        <div className="billiards-canvas" data-testid={TESTID.billiards.canvas}>
          <BilliardsScene
            sim={sim}
            prediction={prediction}
            aimScheme={aimScheme}
            strikeLabel={t('billiards.strike')}
          />
          {/* Screen-space widgets over the 3D view. The layer owns the
              geography; each widget just names an anchor, so the aim HUD and
              the status hint coexist without knowing about each other. */}
          <HudLayer>
            {AimOverlay && aimCue && (
              <AimOverlay
                cue={aimCue}
                shot={sim.shot}
                onShotChange={sim.setShot}
                ballRadius={DEFAULT_PARAMS.ballRadius}
              />
            )}
            {sim.phase === 'idle' && (
              <HudPanel anchor="top-left" testId={TESTID.billiards.hudHint} className="hud-hint">
                {t('billiards.dragHint')}
              </HudPanel>
            )}
          </HudLayer>
        </div>
        <div className="billiards-side">
          <BilliardsControls
            sim={sim}
            showPrediction={showPrediction}
            onShowPredictionChange={setShowPrediction}
            aimScheme={aimScheme}
            onAimSchemeChange={setAimScheme}
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
