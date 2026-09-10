/**
 * Panel pictures shared by more than one scheme.
 *
 * Each is a module-scope pure function of its inputs, so a panel's texture
 * is memoisable on exactly the values it draws. Scheme-specific panels stay
 * with their scheme; only what is genuinely shared lives here.
 */
import { CanvasTexture, SRGBColorSpace } from 'three';

import { PANEL_INK_DIM, PANEL_SIZE, panelBar, panelFrame, panelText } from './paint';

export function createPanelCanvas(size: { width: number; height: number } = PANEL_SIZE): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { canvas, ctx };
}

export function finishPanelTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * The standard shot readout: speed large, bearing beside it, power bar
 * under both. Used by every scheme whose control is the widget itself and
 * whose panel is only there to show the numbers.
 */
export function makeReadoutPanelTexture({
  speed,
  directionDeg,
  power,
  accent,
}: {
  speed: number;
  directionDeg: number;
  /** 0–1. */
  power: number;
  accent: string;
}): CanvasTexture {
  const { canvas, ctx } = createPanelCanvas();
  const { width, height } = PANEL_SIZE;

  panelFrame(ctx, { width, height, accent });
  const speedWidth = panelText(ctx, {
    text: speed.toFixed(1),
    x: 40,
    y: 82,
    size: 76,
    weight: 'bold',
  });
  panelText(ctx, { text: 'm/s', x: 50 + speedWidth, y: 96, size: 34, color: PANEL_INK_DIM });
  panelText(ctx, {
    text: `${directionDeg.toFixed(0)}°`,
    x: width - 44,
    y: 82,
    size: 40,
    align: 'right',
    color: PANEL_INK_DIM,
  });
  panelBar(ctx, { x: 40, y: 150, width: width - 80, height: 34, value: power, color: accent });

  return finishPanelTexture(canvas);
}

const BUTTON_SIZE = { width: 384, height: 152 } as const;

/**
 * A filled pill with a label — the face of an in-scene <SceneButton>. Solid
 * rather than outlined, because a button has to read as pressable at a
 * glance from across the table.
 */
export function makeActionButtonTexture({
  label,
  accent,
}: {
  label: string;
  accent: string;
}): CanvasTexture {
  const { canvas, ctx } = createPanelCanvas(BUTTON_SIZE);
  const { width, height } = BUTTON_SIZE;

  panelFrame(ctx, { width, height, accent, inset: 6, radius: height / 2 });
  const inset = 20;
  panelBar(ctx, {
    x: inset,
    y: inset,
    width: width - inset * 2,
    height: height - inset * 2,
    value: 1,
    color: accent,
  });
  panelText(ctx, {
    text: label,
    x: width / 2,
    y: height / 2 + 2,
    size: 58,
    weight: 'bold',
    align: 'center',
    color: '#0b121a',
  });

  return finishPanelTexture(canvas);
}
