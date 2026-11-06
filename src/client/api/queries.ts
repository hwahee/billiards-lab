/**
 * TanStack Query bindings for the API catalog (./endpoints.ts).
 *
 * Server state lives exclusively in the query cache — components never copy
 * it into local state. Cache keys are produced only by the key factories
 * (`todoKeys`, `authKeys`) so invalidation stays consistent.
 */
import type { Page } from '@shared/api/pagination';
import type { Todo, TodoStatus } from '@shared/domain/todo';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { authApi, sitemapApi, todosApi, type TodoListQueryInput } from './endpoints';
import { ApiRequestError } from './http';

const todoKeys = {
  all: ['todos'] as const,
  lists: () => [...todoKeys.all, 'list'] as const,
  list: (query: TodoListQueryInput) => [...todoKeys.lists(), query] as const,
};

const authKeys = {
  me: ['auth', 'me'] as const,
};

/**
 * The signed-in user: `User`, or `null` when signed out. The query errors
 * (404 `NOT_FOUND`) when the server runs without sign-in (`AUTH_DRIVER=none`).
 */
export function useMe() {
  return useQuery({ queryKey: authKeys.me, queryFn: () => authApi.me() });
}

/**
 * Who the visitor is, for deciding what the UI offers — mirrors the server's
 * `Caller` (src/server/auth/session.ts):
 *   - `member`  — signed in
 *   - `guest`   — sign-in exists but the visitor is not signed in
 *   - `anyone`  — the server runs without sign-in, so there is no split
 *   - `unknown` — `me` is still loading, or failed for another reason
 */
export function useCaller(): 'member' | 'guest' | 'anyone' | 'unknown' {
  const me = useMe();
  if (me.isSuccess) return me.data ? 'member' : 'guest';
  if (me.error instanceof ApiRequestError && me.error.code === 'NOT_FOUND') return 'anyone';
  return 'unknown';
}

/** Paginated list; keeps the previous page rendered while the next one loads. */
export function useTodoList(query: TodoListQueryInput) {
  return useQuery({
    queryKey: todoKeys.list(query),
    queryFn: () => todosApi.list(query),
    placeholderData: keepPreviousData,
  });
}

/** Creates a todo, then invalidates every cached list page. */
export function useCreateTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title: string) => todosApi.create({ title }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: todoKeys.lists() }),
  });
}

/**
 * Toggles open/done with an OPTIMISTIC UPDATE: every cached list page is
 * patched immediately, rolled back from the snapshot on error, and re-synced
 * with the server on settle.
 */
export function useToggleTodoStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TodoStatus }) =>
      todosApi.update(id, { status }),

    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: todoKeys.lists() });
      const snapshot = queryClient.getQueriesData<Page<Todo>>({ queryKey: todoKeys.lists() });
      queryClient.setQueriesData<Page<Todo>>({ queryKey: todoKeys.lists() }, (page) =>
        page
          ? {
              ...page,
              items: page.items.map((todo) => (todo.id === id ? { ...todo, status } : todo)),
            }
          : page,
      );
      return { snapshot };
    },

    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.snapshot ?? []) queryClient.setQueryData(key, data);
    },

    onSettled: () => queryClient.invalidateQueries({ queryKey: todoKeys.lists() }),
  });
}

/** Deletes a todo, then invalidates every cached list page. */
export function useDeleteTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => todosApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: todoKeys.lists() }),
  });
}

/**
 * Live updates: subscribes to the server's WebSocket (`/ws`) and invalidates
 * the todo lists whenever ANY instance mutates a todo — including changes
 * made by other users/tabs (fan-out crosses instances via the pub/sub bus).
 */
export function useTodoLiveUpdates(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
    socket.onmessage = () => {
      void queryClient.invalidateQueries({ queryKey: todoKeys.lists() });
    };
    return () => socket.close();
  }, [queryClient]);
}

/**
 * Service directory for the footer. It is a deploy-time-ish document, so it
 * is fetched once and kept fresh for the session rather than re-validated on
 * every mount; failures stay silent (the footer degrades to no column).
 */
export function useSitemap() {
  return useQuery({
    queryKey: ['sitemap'] as const,
    queryFn: () => sitemapApi.get(),
    staleTime: 5 * 60_000,
  });
}
