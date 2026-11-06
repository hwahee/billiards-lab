/**
 * /api/chat — a room's history, and sending to it. Live delivery and who is
 * in the room travel over the /ws/chat socket (src/server/realtime/chat-gateway.ts).
 *
 * Unlike todos, sending is open to guests: the product owner chose chat as the
 * exception to "what outlives the visit is members-only" (CLAUDE.md). A guest
 * is named by the guest id their tab picked.
 */
import { chatHistoryQueryValidator, sendChatMessageValidator } from '@shared/domain/chat';

import type { Container } from '../container';
import { apiRoute, json, type HttpDeps } from '../http/respond';

export function chatMessageRoutes(container: Container, deps: HttpDeps) {
  return apiRoute<'/api/chat/rooms/:roomId/messages'>(
    {
      /** GET /api/chat/rooms/:roomId/messages?after=<seq> → ChatHistory (oldest first) | 404 */
      GET: async (req) => {
        const after = new URL(req.url).searchParams.get('after');
        const query = chatHistoryQueryValidator.parse({
          after: after === null || after === '' ? undefined : Number(after),
        });
        const items = await container.chatService().history(req.params.roomId, query);
        return json({ items });
      },

      /** POST /api/chat/rooms/:roomId/messages {text, guestId?} → 201 ChatMessage | 400 | 404 */
      POST: async (req, ctx) => {
        const input = sendChatMessageValidator.parse(await req.json());
        const chat = container.chatService();
        const author = chat.participantFor(ctx.caller, input.guestId);
        const message = await chat.send(req.params.roomId, author, input.text);
        return json(message, { status: 201 });
      },
    },
    deps,
  );
}
