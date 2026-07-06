/**
 * /api/billiards — the server-authoritative billiards room.
 *
 *   GET  → current room snapshot (initial load / polling)
 *   POST → one BilliardsCommand (validated union), returns the updated snapshot
 *
 * Realtime fan-out of state updates is the WebSocket's job; these routes are
 * the request/response half of the protocol.
 */
import { billiardsCommandValidator } from '@shared/billiards/room';

import type { Container } from '../container';
import { apiRoute, json, type HttpDeps } from '../http/respond';

export function billiardsRoutes(container: Container, deps: HttpDeps) {
  return apiRoute<'/api/billiards'>(
    {
      /** GET /api/billiards → BilliardsRoomSnapshot */
      GET: () => Promise.resolve(json(container.billiardsRoom().snapshot())),

      /** POST /api/billiards {type, …} → BilliardsRoomSnapshot | 400 */
      POST: async (req) => {
        const command = billiardsCommandValidator.parse(await req.json());
        return json(container.billiardsRoom().command(command));
      },
    },
    deps,
  );
}
