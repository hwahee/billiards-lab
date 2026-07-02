/**
 * Control panel: every simulation variable as a slider, plus transport
 * controls (strike / pause / step / reset). Pure presentation — all state
 * lives in the useBilliardsSim hook.
 */
import type { MessageKey } from '@shared/i18n';
import { DEFAULT_PARAMS, type PhysicsParams } from '@shared/billiards/physics';

import { useI18n } from '../i18n/locale-context';
import { TESTID } from '../testing/testids';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import type { BilliardsSim } from './use-billiards';

function SliderRow({
  name,
  labelKey,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  disabled,
}: {
  name: string;
  labelKey: MessageKey;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const label = t(labelKey);
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return (
    <label className="billiards-slider">
      <span className="billiards-slider__label">{label}</span>
      <input
        type="range"
        data-testid={TESTID.billiards.control(name)}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="billiards-slider__value">
        {value.toFixed(decimals)}
        {unit ? ` ${unit}` : ''}
      </span>
    </label>
  );
}

interface PhysicsSliderSpec {
  key: keyof PhysicsParams;
  labelKey: MessageKey;
  min: number;
  max: number;
  step: number;
}

const PHYSICS_SLIDERS: readonly PhysicsSliderSpec[] = [
  {
    key: 'slidingFriction',
    labelKey: 'billiards.slidingFriction',
    min: 0.02,
    max: 0.5,
    step: 0.01,
  },
  {
    key: 'rollingFriction',
    labelKey: 'billiards.rollingFriction',
    min: 0.002,
    max: 0.06,
    step: 0.002,
  },
  { key: 'spinFriction', labelKey: 'billiards.spinFriction', min: 0.005, max: 0.1, step: 0.005 },
  {
    key: 'cushionRestitution',
    labelKey: 'billiards.cushionRestitution',
    min: 0.4,
    max: 1,
    step: 0.01,
  },
  { key: 'cushionFriction', labelKey: 'billiards.cushionFriction', min: 0, max: 0.6, step: 0.02 },
  { key: 'ballRestitution', labelKey: 'billiards.ballRestitution', min: 0.5, max: 1, step: 0.01 },
  { key: 'ballFriction', labelKey: 'billiards.ballFriction', min: 0, max: 0.25, step: 0.01 },
];

export function BilliardsControls({
  sim,
  showPrediction,
  onShowPredictionChange,
}: {
  sim: BilliardsSim;
  showPrediction: boolean;
  onShowPredictionChange: (show: boolean) => void;
}) {
  const { t } = useI18n();
  const { phase, shot, setShot, physics, setPhysics } = sim;

  return (
    <div className="billiards-panel">
      <section className="billiards-group">
        <h3>{t('billiards.group.shot')}</h3>
        <SliderRow
          name="speed"
          labelKey="billiards.speed"
          value={shot.speed}
          min={0.2}
          max={6}
          step={0.1}
          unit="m/s"
          onChange={(speed) => setShot({ ...shot, speed })}
        />
        <SliderRow
          name="direction"
          labelKey="billiards.direction"
          value={shot.directionDeg}
          min={-180}
          max={180}
          step={1}
          unit="°"
          onChange={(directionDeg) => setShot({ ...shot, directionDeg })}
        />
        <SliderRow
          name="lateral-speed"
          labelKey="billiards.lateralSpeed"
          value={shot.lateralSpeed}
          min={-2}
          max={2}
          step={0.05}
          unit="m/s"
          onChange={(lateralSpeed) => setShot({ ...shot, lateralSpeed })}
        />
        <SliderRow
          name="topspin"
          labelKey="billiards.topspin"
          value={shot.topspin}
          min={-250}
          max={250}
          step={5}
          unit="rad/s"
          onChange={(topspin) => setShot({ ...shot, topspin })}
        />
        <SliderRow
          name="sidespin"
          labelKey="billiards.sidespin"
          value={shot.sidespin}
          min={-250}
          max={250}
          step={5}
          unit="rad/s"
          onChange={(sidespin) => setShot({ ...shot, sidespin })}
        />
        <SliderRow
          name="rollspin"
          labelKey="billiards.rollspin"
          value={shot.rollspin}
          min={-250}
          max={250}
          step={5}
          unit="rad/s"
          onChange={(rollspin) => setShot({ ...shot, rollspin })}
        />
        <div className="billiards-actions">
          <Button
            testId={TESTID.billiards.strike}
            onClick={sim.strikeCue}
            disabled={phase !== 'idle'}
          >
            {t('billiards.strike')}
          </Button>
          <Button
            variant="secondary"
            testId={TESTID.billiards.pause}
            onClick={sim.togglePause}
            disabled={phase === 'idle'}
          >
            {phase === 'paused' ? t('billiards.resume') : t('billiards.pause')}
          </Button>
          <Button
            variant="secondary"
            testId={TESTID.billiards.step}
            onClick={sim.stepOnce}
            disabled={phase !== 'paused'}
          >
            {t('billiards.step')}
          </Button>
          <Button variant="ghost" testId={TESTID.billiards.reset} onClick={sim.reset}>
            {t('billiards.reset')}
          </Button>
        </div>
      </section>

      <section className="billiards-group">
        <h3>{t('billiards.group.physics')}</h3>
        {PHYSICS_SLIDERS.map((spec) => (
          <SliderRow
            key={spec.key}
            name={spec.key}
            labelKey={spec.labelKey}
            value={physics[spec.key]}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            onChange={(value) => setPhysics({ ...physics, [spec.key]: value })}
          />
        ))}
        <div className="billiards-actions">
          <Button
            variant="ghost"
            testId={TESTID.billiards.resetPhysics}
            onClick={() => setPhysics(DEFAULT_PARAMS)}
          >
            {t('billiards.resetPhysics')}
          </Button>
        </div>
      </section>

      <section className="billiards-group">
        <h3>{t('billiards.group.simulation')}</h3>
        <SliderRow
          name="sim-speed"
          labelKey="billiards.simSpeed"
          value={sim.simSpeed}
          min={0.1}
          max={3}
          step={0.1}
          unit="×"
          onChange={sim.setSimSpeed}
        />
        <Checkbox
          label={t('billiards.showPrediction')}
          checked={showPrediction}
          onChange={onShowPredictionChange}
          testId={TESTID.billiards.showPrediction}
        />
      </section>
    </div>
  );
}
