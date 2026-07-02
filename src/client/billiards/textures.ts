/**
 * Procedural equirectangular ball textures. Carom balls are plain-coloured;
 * painted rings and dots are added so the ball's rotation (the whole point of
 * simulating spin) is actually visible.
 */
import { CanvasTexture, SRGBColorSpace } from 'three';

export function makeBallTexture(baseColor: string, markColor: string): CanvasTexture {
  const width = 512;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = markColor;
  // Two "pole" rings on the equator (front/back of the ball)…
  for (const cx of [width * 0.25, width * 0.75]) {
    ctx.beginPath();
    ctx.arc(cx, height / 2, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = baseColor;
    ctx.arc(cx, height / 2, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = markColor;
  }
  // …and small dots offset from the equator so every rotation axis reads.
  for (const [fx, fy] of [
    [0.0, 0.28],
    [0.5, 0.72],
    [0.125, 0.62],
    [0.625, 0.38],
  ] as const) {
    ctx.beginPath();
    ctx.arc(fx * width, fy * height, 12, 0, Math.PI * 2);
    ctx.fill();
    if (fx === 0) {
      // The u=0 seam: mirror the dot on the right edge so it wraps cleanly.
      ctx.beginPath();
      ctx.arc(width, fy * height, 12, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
