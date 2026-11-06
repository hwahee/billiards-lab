/**
 * /api/todos — REST resource following every repo convention:
 * pagination/sort/filter (@shared/api/pagination), the error envelope,
 * schema validation at the boundary, and UTC-only timestamps.
 *
 * A todo outlives the visit that wrote it, so writing one is for members
 * only (`requireMember`); reading leaves nothing behind and stays open.
 */
import { searchParamsToObject } from '@shared/api/pagination';
import {
  createTodoValidator,
  listTodosQueryValidator,
  updateTodoValidator,
} from '@shared/domain/todo';

import { requireMember } from '../auth/session';
import type { Container } from '../container';
import { apiRoute, json, type HttpDeps } from '../http/respond';

export function todoCollectionRoutes(container: Container, deps: HttpDeps) {
  return apiRoute<'/api/todos'>(
    {
      /** GET /api/todos?page&pageSize&sortBy&sortOrder&status&q → Page<Todo> */
      GET: async (req) => {
        const params = new URL(req.url).searchParams;
        params.delete('lang'); // locale override is not part of the list query
        const query = listTodosQueryValidator.parse(searchParamsToObject(params));
        return json(await container.todoService().list(query));
      },

      /** POST /api/todos {title} → 201 Todo | 401 for a guest */
      POST: async (req, ctx) => {
        requireMember(ctx.caller);
        const input = createTodoValidator.parse(await req.json());
        const todo = await container.todoService().create(input);
        return json(todo, { status: 201 });
      },
    },
    deps,
  );
}

export function todoItemRoutes(container: Container, deps: HttpDeps) {
  return apiRoute<'/api/todos/:id'>(
    {
      /** GET /api/todos/:id → Todo | 404 */
      GET: async (req) => json(await container.todoService().get(req.params.id)),

      /** PATCH /api/todos/:id {title?, status?} → Todo | 404 | 401 for a guest */
      PATCH: async (req, ctx) => {
        requireMember(ctx.caller);
        const patch = updateTodoValidator.parse(await req.json());
        return json(await container.todoService().update(req.params.id, patch));
      },

      /** DELETE /api/todos/:id → 204 | 404 | 401 for a guest */
      DELETE: async (req, ctx) => {
        requireMember(ctx.caller);
        await container.todoService().delete(req.params.id);
        return new Response(null, { status: 204 });
      },
    },
    deps,
  );
}
