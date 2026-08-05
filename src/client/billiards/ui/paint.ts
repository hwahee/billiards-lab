/**
 * Painting kit for in-scene panels.
 *
 * Panel content is drawn to a canvas and used as a texture, which keeps
 * these UI elements free of font assets and DOM overlays. These helpers are
 * the vocabulary that keeps each panel a few lines long and keeps them all
 * looking like one family.
 *
 * Coordinates are canvas pixels; every panel is authored at PANEL_SIZE and
 * scaled to metres when mounted.
 */
export const PANEL_SIZE = { width: 512, height: 256 } as const;

const PANEL_INK = '#f4efe2';
export const PANEL_INK_DIM = 'rgba(244, 239, 226, 0.62)';
const PANEL_FILL = 'rgba(11, 18, 26, 0.84)';
const PANEL_TRACK = 'rgba(244, 239, 226, 0.16)';

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Clears the canvas and lays down the standard panel background. */
export function panelFrame(
  ctx: CanvasRenderingContext2D,
  {
    width,
    height,
    accent,
    inset = 8,
    radius = 26,
  }: {
    width: number;
    height: number;
    accent: string;
    inset?: number;
    radius?: number;
  },
): void {
  ctx.clearRect(0, 0, width, height);
  roundedRect(ctx, inset, inset, width - inset * 2, height - inset * 2, radius);
  ctx.fillStyle = PANEL_FILL;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = accent;
  ctx.stroke();
}

export function panelText(
  ctx: CanvasRenderingContext2D,
  {
    text,
    x,
    y,
    size = 36,
    weight = 'normal',
    color = PANEL_INK,
    align = 'left',
    baseline = 'middle',
  }: {
    text: string;
    x: number;
    y: number;
    size?: number;
    weight?: 'normal' | 'bold';
    color?: string;
    align?: CanvasTextAlign;
    baseline?: CanvasTextBaseline;
  },
): number {
  ctx.font = `${weight} ${size}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(text, x, y);
  return ctx.measureText(text).width;
}

/** Horizontal fill bar — the shared way every scheme shows power. */
export function panelBar(
  ctx: CanvasRenderingContext2D,
  {
    x,
    y,
    width,
    height,
    value,
    color,
  }: { x: number; y: number; width: number; height: number; value: number; color: string },
): void {
  const radius = height / 2;
  roundedRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = PANEL_TRACK;
  ctx.fill();
  const fill = Math.max(0, Math.min(1, value));
  if (fill <= 0) return;
  roundedRect(ctx, x, y, Math.max(height, width * fill), height, radius);
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Compass dial with a needle at `angleDeg` (counter-clockwise from +x, as
 * table bearings are). Canvas y grows downward, so the needle is mirrored.
 */
export function panelDial(
  ctx: CanvasRenderingContext2D,
  {
    cx,
    cy,
    radius,
    angleDeg,
    color,
  }: { cx: number; cy: number; radius: number; angleDeg: number; color: string },
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(244, 239, 226, 0.07)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(244, 239, 226, 0.35)';
  ctx.stroke();

  ctx.strokeStyle = 'rgba(244, 239, 226, 0.3)';
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    const inner = radius * (i % 3 === 0 ? 0.76 : 0.87);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy - Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * radius * 0.97, cy - Math.sin(a) * radius * 0.97);
    ctx.stroke();
  }

  const rad = (angleDeg * Math.PI) / 180;
  const tipX = cx + Math.cos(rad) * radius * 0.82;
  const tipY = cy - Math.sin(rad) * radius * 0.82;
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(tipX, tipY, 9, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(244, 239, 226, 0.85)';
  ctx.fill();
}
