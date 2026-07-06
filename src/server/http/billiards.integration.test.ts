/**
 * /api/billiards integration tests: the real app booted on an ephemeral port
 * with the in-memory drivers, exercising the server-authoritative room over
 * HTTP exactly as the client does.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import type { BilliardsCommand, BilliardsRoomSnapshot } from '@shared/billiards/room';

import { buildApp } from '../app';
import { loadServerConfig } from '../config';
import { createContainer, type Container } from '../container';
import { silentLogger } from '../lib/log';
import type { AppState } from '../routes/health';

let container: Container;
let server: Bun.Server<undefined>;
let baseUrl: string;

beforeAll(() => {
  const config = loadServerConfig({
    APP_ENV: 'local',
    DB_DRIVER: 'memory',
    PUBSUB_DRIVER: 'memory',
  });
  container = createContainer(config, { log: silentLogger });
  const state: AppState = { shuttingDown: false };
  const app = buildApp(container, state);
  server = Bun.serve({ port: 0, ...app });
  baseUrl = String(server.url).replace(/\/$/, '');
});

afterAll(async () => {
  await server.stop(true);
  await container.dispose();
});

async function getSnapshot(): Promise<{ status: number; body: BilliardsRoomSnapshot }> {
  const response = await fetch(`${baseUrl}/api/billiards`);
  return { status: response.status, body: (await response.json()) as BilliardsRoomSnapshot };
}

async function sendCommand(
  command: BilliardsCommand | Record<string, unknown>,
): Promise<{ status: number; body: BilliardsRoomSnapshot }> {
  const response = await fetch(`${baseUrl}/api/billiards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
  return { status: response.status, body: (await response.json()) as BilliardsRoomSnapshot };
}

// The room is a process singleton: re-rack before every test for isolation.
beforeEach(async () => {
  await sendCommand({ type: 'variant', variant: 'carom' });
});

describe('GET /api/billiards', () => {
  test('returns the authoritative snapshot', async () => {
    const { status, body } = await getSnapshot();
    expect(status).toBe(200);
    expect(body.variant).toBe('carom');
    expect(body.phase).toBe('idle');
    expect(body.game.balls).toHaveLength(4);
    expect(body.params.ballRadius).toBeGreaterThan(0);
  });
});

describe('POST /api/billiards', () => {
  test('rejects malformed commands with the validation envelope', async () => {
    const bad = await fetch(`${baseUrl}/api/billiards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'strike', shot: { speed: 999 } }),
    });
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  test('rejects unknown command types', async () => {
    const { status } = await sendCommand({ type: 'hack-the-table' });
    expect(status).toBe(400);
  });

  test('strike starts the server-side simulation; the clock advances on its own', async () => {
    const struck = await sendCommand({
      type: 'strike',
      shot: { speed: 2, directionRad: 0.2, topspin: 0, sidespin: 0 },
    });
    expect(struck.status).toBe(200);
    expect(struck.body.phase).toBe('running');

    await Bun.sleep(150);
    const later = await getSnapshot();
    expect(later.body.game.simTime).toBeGreaterThan(0.1);
    const cue = later.body.game.balls.find((b) => b.id === 'white')!;
    expect(cue.position.x).toBeGreaterThan(-0.75); // moved off its opening spot
  });

  test('reset stops the shot, re-racks and bumps the generation', async () => {
    const before = await getSnapshot();
    await sendCommand({
      type: 'strike',
      shot: { speed: 2, directionRad: 0, topspin: 0, sidespin: 0 },
    });
    await Bun.sleep(60);
    const reset = await sendCommand({ type: 'reset' });
    expect(reset.body.phase).toBe('idle');
    expect(reset.body.game.simTime).toBe(0);
    expect(reset.body.generation).toBe(before.body.generation + 1);
    expect(reset.body.game.balls).toEqual(before.body.game.balls);
  });

  test('variant switch re-racks the pool preset', async () => {
    const { body } = await sendCommand({ type: 'variant', variant: 'pool' });
    expect(body.variant).toBe('pool');
    expect(body.game.balls).toHaveLength(16);
  });

  test('placeBall repositions a resting ball while idle', async () => {
    const { body } = await sendCommand({ type: 'placeBall', ballId: 'redA', x: -0.2, y: 0.05 });
    const red = body.game.balls.find((b) => b.id === 'redA')!;
    expect(red.position).toEqual({ x: -0.2, y: 0.05 });
  });
});
