/**
 * Chat load test: N people join one room over real WebSockets, then messages
 * are sent into it. Reports how long it took until everyone saw everyone, and
 * how much the server sent for presence and for messages.
 *
 *   bun run chat:load            # 300 people, 100 messages
 *   bun run chat:load 1000 200   # people, messages
 *
 * Runs the real app in this process on the configuration of your .env with
 * the in-memory database; with PUBSUB_DRIVER=redis, presence and fan-out go
 * through Redis as they would across instances. The clients share the
 * process, so read the times as relative, not as a capacity figure.
 */
import { participantKey, type ChatParticipant, type ChatServerFrame } from '@shared/domain/chat';

import { buildApp } from '../src/server/app';
import { loadServerConfig } from '../src/server/config';
import { createContainer } from '../src/server/container';
import { silentLogger } from '../src/server/lib/log';

const people = Number(process.argv[2] ?? 300);
const messages = Number(process.argv[3] ?? 100);
const TIMEOUT_MS = 120_000;
const ROOM = `load.${Date.now()}`;

const container = createContainer(loadServerConfig({ ...process.env, DB_DRIVER: 'memory' }), {
  log: silentLogger,
});
await container.chatService().openRoom({
  id: ROOM,
  policy: { retentionMs: 60_000, backlog: { maxCount: 50, maxAgeMs: null } },
});
const server = Bun.serve({ port: 0, ...buildApp(container, { shuttingDown: false }) });
const stopChat = await container.chatGateway().start();
const base = String(server.url).replace(/\/$/, '');

let bytes = 0;
let presenceFrames = 0;
let messageFrames = 0;
let complete = 0;
let onComplete: () => void = () => undefined;

/**
 * One visitor: keeps who is in the room from the snapshot and the changes
 * that follow — counted incrementally, so the thousand clients sharing this
 * process do not become the bottleneck being measured.
 */
function visitor(index: number): WebSocket {
  const guestId = index.toString(16).padStart(6, '0');
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws/chat?guestId=${guestId}`);
  const connections = new Map<string, string>(); // connection → person key
  const tabs = new Map<string, number>(); // person key → open connections
  const add = (connectionId: string, participant: ChatParticipant) => {
    if (connections.has(connectionId)) return;
    const key = participantKey(participant);
    connections.set(connectionId, key);
    tabs.set(key, (tabs.get(key) ?? 0) + 1);
  };
  const remove = (connectionId: string) => {
    const key = connections.get(connectionId);
    if (key === undefined) return;
    connections.delete(connectionId);
    const left = (tabs.get(key) ?? 1) - 1;
    if (left === 0) tabs.delete(key);
    else tabs.set(key, left);
  };
  let sawEveryone = false;
  ws.onopen = () => ws.send(JSON.stringify({ type: 'join', roomId: ROOM }));
  ws.onmessage = (event) => {
    const text = String(event.data);
    bytes += text.length;
    const frame = JSON.parse(text) as ChatServerFrame;
    if (frame.type === 'message') {
      messageFrames += 1;
      if (messageFrames === people * messages) onComplete();
      return;
    }
    if (frame.type === 'presence') {
      connections.clear();
      tabs.clear();
      for (const entry of frame.entries) add(entry.connectionId, entry.participant);
    } else if (frame.type === 'presence-add') {
      add(frame.entry.connectionId, frame.entry.participant);
    } else if (frame.type === 'presence-remove') {
      remove(frame.connectionId);
    } else {
      return;
    }
    presenceFrames += 1;
    if (!sawEveryone && tabs.size === people) {
      sawEveryone = true;
      complete += 1;
      if (complete === people) onComplete();
    }
  };
  return ws;
}

function waitForCompletion(): Promise<boolean> {
  return Promise.race([
    new Promise<boolean>((resolve) => (onComplete = () => resolve(true))),
    Bun.sleep(TIMEOUT_MS).then(() => false),
  ]);
}

const mb = (count: number) => `${(count / 1e6).toFixed(1)} MB`;

let started = performance.now();
const joined = waitForCompletion();
const sockets = Array.from({ length: people }, (_, index) => visitor(index));
const everyoneSeen = await joined;
console.log(
  `${people} people joined: ${everyoneSeen ? `${(performance.now() - started).toFixed(0)} ms until everyone saw everyone` : `not done after ${TIMEOUT_MS} ms`}, ` +
    `${presenceFrames} presence frames, ${mb(bytes)}`,
);

bytes = 0;
started = performance.now();
const delivered = waitForCompletion();
for (let index = 0; index < messages; index += 1) {
  await fetch(`${base}/api/chat/rooms/${ROOM}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: `load message ${index}`, guestId: 'ffffff' }),
  });
}
const allDelivered = await delivered;
console.log(
  `${messages} messages to ${people} people: ${allDelivered ? `${(performance.now() - started).toFixed(0)} ms until all delivered` : `not done after ${TIMEOUT_MS} ms`}, ${mb(bytes)}`,
);

for (const ws of sockets) ws.close();
await stopChat();
await server.stop(true);
await container.dispose();
process.exit(everyoneSeen && allDelivered ? 0 : 1);
