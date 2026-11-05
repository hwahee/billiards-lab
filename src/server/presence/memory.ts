import type { PresenceStore } from './types';

/**
 * Single-process presence. Info is JSON round-tripped, like the memory pub/sub,
 * so anything that would break under Redis breaks here too. Nothing expires:
 * every connection this process holds says goodbye through its close handler.
 */
export function createMemoryPresenceStore(): PresenceStore {
  const scopes = new Map<string, Map<string, string>>();

  return {
    async join({ scope, connectionId, info }) {
      let connections = scopes.get(scope);
      if (!connections) {
        connections = new Map();
        scopes.set(scope, connections);
      }
      connections.set(connectionId, JSON.stringify(info ?? null));
      return Promise.resolve();
    },

    async leave(scope, connectionId) {
      const connections = scopes.get(scope);
      connections?.delete(connectionId);
      if (connections?.size === 0) scopes.delete(scope);
      return Promise.resolve();
    },

    async list(scope) {
      const connections = scopes.get(scope);
      return Promise.resolve(
        [...(connections ?? [])].map(([connectionId, info]) => ({
          connectionId,
          info: JSON.parse(info) as unknown,
        })),
      );
    },

    async refresh() {
      return Promise.resolve();
    },

    async sweep() {
      return Promise.resolve([]);
    },

    async close() {
      scopes.clear();
      return Promise.resolve();
    },
  };
}
