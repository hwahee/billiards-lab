import type { ChatClientFrame, ChatServerFrame } from '@shared/domain/chat';

/** What a room hears from the connection. */
export interface RoomListener {
  onFrame(frame: ChatServerFrame): void;
  /** The socket dropped; the room is re-joined (and gets `joined` again) once it is back. */
  onDisconnect(): void;
}

const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 15_000;

/**
 * The tab's one chat socket (`/ws/chat`), shared by every room on the page.
 *
 * It opens when the first room is watched and closes shortly after the last
 * one is let go. While any room is watched it keeps itself connected — reconnecting
 * with backoff, then re-joining every watched room, which answers each with a
 * fresh `joined` so the room catches up on what it missed.
 *
 * Leaving the page closes it at once, so the server drops us from presence
 * right away — not whenever the browser gets to it, which for a page kept in
 * the back/forward cache could leave us in "who is here" until it is evicted.
 * Coming back from that cache opens a new socket, which re-joins and catches up.
 */
export class ChatConnection {
  private socket: WebSocket | null = null;
  private readonly rooms = new Map<string, Set<RoomListener>>();
  private retryMs = FIRST_RETRY_MS;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * `url` is read on every (re)connect: it carries the tab's guest id.
   * `page` is where `pagehide`/`pageshow` fire — `window` in a browser.
   */
  constructor(
    private readonly url: () => string,
    private readonly openSocket: (url: string) => WebSocket = (url) => new WebSocket(url),
    page: EventTarget | undefined = typeof window === 'undefined' ? undefined : window,
  ) {
    page?.addEventListener('pagehide', () => this.disconnect());
    page?.addEventListener('pageshow', (event) => {
      // Not persisted: a fresh page load, whose rooms connect as they are watched.
      if ((event as PageTransitionEvent).persisted) this.resume();
    });
  }

  /** Starts hearing `roomId`; returns the function that stops. */
  watch(roomId: string, listener: RoomListener): () => void {
    clearTimeout(this.idleTimer);
    let listeners = this.rooms.get(roomId);
    if (!listeners) {
      listeners = new Set();
      this.rooms.set(roomId, listeners);
      this.send({ type: 'join', roomId });
    } else if (this.isOpen()) {
      // The room is already joined: ask again so this listener gets its own `joined`.
      this.send({ type: 'join', roomId });
    }
    listeners.add(listener);
    if (!this.socket) this.connect();

    return () => {
      listeners.delete(listener);
      if (listeners.size > 0 || this.rooms.get(roomId) !== listeners) return;
      this.rooms.delete(roomId);
      this.send({ type: 'leave', roomId });
      if (this.rooms.size > 0) return;
      // Closed a moment later rather than at once: a room watched again right
      // away — a page swapping one chat for another, or React re-running an
      // effect in development — keeps this socket instead of reconnecting.
      this.idleTimer = setTimeout(() => {
        if (this.rooms.size === 0) this.disconnect();
      }, 0);
    };
  }

  /**
   * Opens a new socket right away. The server reads who we are when the
   * socket opens, so this is how a sign-in or sign-out reaches chat.
   */
  reconnect(): void {
    if (this.rooms.size === 0) return;
    this.disconnect();
    this.connect();
  }

  /** Back from the back/forward cache: the rooms still watched get a socket again. */
  private resume(): void {
    if (this.rooms.size > 0 && !this.socket) this.connect();
  }

  private connect(): void {
    clearTimeout(this.retryTimer);
    const socket = this.openSocket(this.url());
    this.socket = socket;

    socket.onopen = () => {
      this.retryMs = FIRST_RETRY_MS;
      for (const roomId of this.rooms.keys()) this.send({ type: 'join', roomId });
    };
    socket.onmessage = (event) => {
      const frame = JSON.parse(String(event.data)) as ChatServerFrame;
      const roomId = frame.type === 'message' ? frame.message.roomId : frame.roomId;
      for (const listener of this.rooms.get(roomId) ?? []) listener.onFrame(frame);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return; // replaced on purpose
      this.socket = null;
      this.notifyDisconnect();
      if (this.rooms.size === 0) return;
      this.retryTimer = setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
    };
  }

  private disconnect(): void {
    clearTimeout(this.retryTimer);
    const socket = this.socket;
    if (!socket) return;
    this.socket = null;
    socket.close();
    this.notifyDisconnect();
  }

  private notifyDisconnect(): void {
    for (const listeners of this.rooms.values()) {
      for (const listener of listeners) listener.onDisconnect();
    }
  }

  private isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Frames sent while connecting are dropped: `onopen` joins every watched room anyway. */
  private send(frame: ChatClientFrame): void {
    if (this.isOpen()) this.socket?.send(JSON.stringify(frame));
  }
}
