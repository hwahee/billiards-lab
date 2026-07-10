/**
 * WebSocket integration tests for the billiards live feed: the real app plus
 * the pub/sub → /ws bridge, so a strike POSTed over HTTP must stream room
 * snapshots to every socket that subscribed to the billiards channel — and
 * to nobody else.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import type { BilliardsLiveMessage } from '@shared/billiards/room';

import { bridgePubSubToWebSocket, buildApp } from '../app';
import { loadServerConfig } from '../config';
import { createContainer, type Container } from '../container';
import { silentLogger } from '../lib/log';
import type { AppState } from '../routes/health';

let container: Container;
let server: Bun.Server<undefined>;
let baseUrl: string;
let unbridge: () => Promise<void>;

beforeAll(async () => {
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
  unbridge = await bridgePubSubToWebSocket(server, container);
});

afterAll(async () => {
  await unbridge();
  await server.stop(true);
  await container.dispose();
});

beforeEach(async () => {
  await fetch(`${baseUrl}/api/billiards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'variant', variant: 'carom' }),
  });
});

interface FeedSocket {
  frames: BilliardsLiveMessage[];
  raw: string[];
  send: (message: unknown) => void;
  sendRaw: (text: string) => void;
  close: () => void;
}

async function openFeedSocket(): Promise<FeedSocket> {
  const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws`);
  const frames: BilliardsLiveMessage[] = [];
  const raw: string[] = [];
  socket.onmessage = (event) => {
    const text = String(event.data);
    raw.push(text);
    const parsed = JSON.parse(text) as { channel?: string };
    if (parsed.channel === 'billiards') frames.push(parsed as BilliardsLiveMessage);
  };
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error('ws connect failed'));
  });
  return {
    frames,
    raw,
    send: (message) => socket.send(JSON.stringify(message)),
    sendRaw: (text) => socket.send(text),
    close: () => socket.close(),
  };
}

async function strike(speed = 2): Promise<void> {
  const response = await fetch(`${baseUrl}/api/billiards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'strike',
      shot: { speed, directionRad: 0.25, topspin: 0, sidespin: 0 },
    }),
  });
  expect(response.status).toBe(200);
}

describe('billiards live feed', () => {
  test('a whole shot produces exactly two frames: the strike echo and the at-rest state', async () => {
    const feed = await openFeedSocket();
    feed.send({ type: 'subscribe', channel: 'billiards' });
    await Bun.sleep(30); // let the subscription land before the strike

    await strike(0.05); // gentle: rests in well under a second
    for (let i = 0; i < 40 && feed.frames.length < 2; i += 1) await Bun.sleep(100);
    await Bun.sleep(200); // room for any extra (unwanted) frames to arrive
    feed.close();

    // No mid-roll streaming: clients replay the deterministic trajectory
    // locally, so the server sends only the start and the authoritative end.
    expect(feed.frames.map((f) => f.snapshot.phase)).toEqual(['running', 'idle']);
    expect(feed.frames[0]!.snapshot.game.simTime).toBe(0);
    expect(feed.frames[1]!.snapshot.game.simTime).toBeGreaterThan(0);
  });

  test('a socket that never subscribed receives no billiards frames', async () => {
    const feed = await openFeedSocket();
    await strike();
    await Bun.sleep(200);
    feed.close();
    expect(feed.frames).toHaveLength(0);
  });

  test('unsubscribe stops the feed', async () => {
    const feed = await openFeedSocket();
    feed.send({ type: 'subscribe', channel: 'billiards' });
    await Bun.sleep(30);
    await strike();
    await Bun.sleep(120);
    expect(feed.frames.length).toBeGreaterThan(0);

    feed.send({ type: 'unsubscribe', channel: 'billiards' });
    await Bun.sleep(30);
    const seen = feed.frames.length;
    await Bun.sleep(200);
    feed.close();
    expect(feed.frames.length).toBe(seen);
  });

  test('malformed inbound messages are ignored without killing the socket', async () => {
    const feed = await openFeedSocket();
    feed.sendRaw('not json at all');
    feed.send({ type: 'subscribe', channel: 'nuclear-launch' });
    feed.send({ type: 'subscribe', channel: 'billiards' });
    await Bun.sleep(30);
    await strike();
    await Bun.sleep(150);
    feed.close();
    expect(feed.frames.length).toBeGreaterThan(0);
  });
});
