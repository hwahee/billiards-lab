/**
 * Todos — the demo page exercising the whole stack: TanStack Query (loading /
 * error / data states), mutations with invalidation, an optimistic toggle,
 * URL-derived list state, live WebSocket invalidation, and boundary-only
 * time-zone conversion.
 *
 * State policy: the page/list parameters live in the URL (shareable, no
 * duplicated state), server data lives in the query cache, and the only
 * `useState` is the uncommitted form input — nothing here is derivable.
 */
import { createTodoValidator, type TodoListQuery, type TodoStatus } from '@shared/domain/todo';
import { formatUtcInTimeZone } from '@shared/time';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';

import { ApiRequestError } from '../api/http';
import {
  useCaller,
  useCreateTodo,
  useDeleteTodo,
  useTodoLiveUpdates,
  useTodoList,
  useToggleTodoStatus,
} from '../api/queries';
import { useI18n } from '../i18n/locale-context';
import { TESTID } from '../testing/testids';
import { Alert } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Select } from '../ui/select';
import { Spinner } from '../ui/spinner';
import { TextField } from '../ui/text-field';

const PAGE_SIZE = 10;

type StatusFilter = TodoStatus | 'all';
type SortField = TodoListQuery['sortBy'];

export function TodosPage() {
  const { t, locale } = useI18n();
  useTodoLiveUpdates();

  // List state is derived from the URL — back/forward and deep links just work.
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const statusParam = searchParams.get('status');
  const status: StatusFilter =
    statusParam === 'open' || statusParam === 'done' ? statusParam : 'all';
  const sortByParam = searchParams.get('sortBy');
  const sortBy: SortField = sortByParam === 'title' ? 'title' : 'createdAt';

  // A new object each render is fine: TanStack Query compares keys by content.
  const query = {
    page,
    pageSize: PAGE_SIZE,
    sortBy,
    sortOrder: sortBy === 'title' ? ('asc' as const) : ('desc' as const),
    ...(status === 'all' ? {} : { status }),
  };

  const patchParams = (patch: Record<string, string | null>) => {
    setSearchParams((params) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      return params;
    });
  };

  const todoList = useTodoList(query);
  // A todo outlives the visit, so only members write (guests read) — the
  // server enforces this; the UI just doesn't offer what would be refused.
  const caller = useCaller();
  const canWrite = caller === 'member' || caller === 'anyone';
  const createTodo = useCreateTodo();
  const toggleStatus = useToggleTodoStatus();
  const deleteTodo = useDeleteTodo();

  // The only local state: the uncommitted form input (+ its validation error).
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState<string | undefined>(undefined);

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    const parsed = createTodoValidator.safeParse({ title });
    if (!parsed.ok) {
      setTitleError(t('error.validation'));
      return;
    }
    setTitleError(undefined);
    createTodo.mutate(parsed.value.title, {
      onSuccess: () => {
        setTitle('');
        patchParams({ page: null }); // jump back to the first page
      },
    });
  };

  const data = todoList.data;

  return (
    <section data-testid={TESTID.todos.page} aria-labelledby="todos-heading">
      <h2 id="todos-heading">{t('todos.title')}</h2>
      <p className="muted">{t('todos.description')}</p>

      {caller === 'guest' && (
        <div className="todo-guest-hint">
          <Alert tone="info" testId={TESTID.todos.guestHint}>
            {t('todos.guestHint')}
          </Alert>
        </div>
      )}

      {canWrite && (
        <form
          className="todo-create"
          onSubmit={submitCreate}
          aria-label={t('todos.createSubmit')}
          data-testid={TESTID.todos.createForm}
        >
          <TextField
            label={t('todos.createLabel')}
            placeholder={t('todos.createPlaceholder')}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            error={titleError}
            maxLength={200}
            testId={TESTID.todos.createInput}
          />
          <Button type="submit" loading={createTodo.isPending} testId={TESTID.todos.createSubmit}>
            <Plus aria-hidden size="1em" />
            {t('todos.createSubmit')}
          </Button>
        </form>
      )}

      <div className="todo-toolbar">
        <Select<StatusFilter>
          label={t('todos.filterLabel')}
          value={status}
          options={[
            { value: 'all', label: t('todos.filter.all') },
            { value: 'open', label: t('todos.filter.open') },
            { value: 'done', label: t('todos.filter.done') },
          ]}
          onChange={(value) => patchParams({ status: value === 'all' ? null : value, page: null })}
          testId={TESTID.todos.filterStatus}
        />
        <Select<SortField>
          label={t('todos.sortLabel')}
          value={sortBy}
          options={[
            { value: 'createdAt', label: t('todos.sort.createdAt') },
            { value: 'title', label: t('todos.sort.title') },
          ]}
          onChange={(value) =>
            patchParams({ sortBy: value === 'createdAt' ? null : value, page: null })
          }
          testId={TESTID.todos.sortBy}
        />
      </div>

      {/* ── TanStack Query state handling: loading / error / data ── */}
      {todoList.isPending && <Spinner label={t('common.loading')} testId={TESTID.todos.loading} />}

      {todoList.isError && (
        <Alert
          tone="error"
          testId={TESTID.todos.error}
          action={
            <Button
              variant="secondary"
              onClick={() => void todoList.refetch()}
              testId={TESTID.todos.errorRetry}
            >
              {t('common.retry')}
            </Button>
          }
        >
          {t('todos.loadFailed')}{' '}
          {/* API errors carry a server-localized message worth surfacing. */}
          {todoList.error instanceof ApiRequestError ? todoList.error.message : null}
        </Alert>
      )}

      {data && (
        <>
          <p className="muted" data-testid={TESTID.todos.totalCount}>
            {t('todos.total', { count: data.totalItems })}
          </p>

          {data.items.length === 0 ? (
            <p data-testid={TESTID.todos.empty}>{t('todos.empty')}</p>
          ) : (
            <ul
              className="todo-list"
              data-testid={TESTID.todos.list}
              aria-busy={todoList.isFetching || undefined}
            >
              {data.items.map((todo) => {
                const nextStatus: TodoStatus = todo.status === 'open' ? 'done' : 'open';
                return (
                  <li key={todo.id} className="todo-item" data-testid={TESTID.todos.item(todo.id)}>
                    <Checkbox
                      label={todo.title}
                      aria-label={t('todos.toggleStatus', {
                        title: todo.title,
                        status: t(`todos.status.${nextStatus}`),
                      })}
                      checked={todo.status === 'done'}
                      disabled={!canWrite}
                      onChange={() => toggleStatus.mutate({ id: todo.id, status: nextStatus })}
                      testId={TESTID.todos.itemToggle(todo.id)}
                    />
                    <Badge tone={todo.status === 'done' ? 'success' : 'neutral'}>
                      {t(`todos.status.${todo.status}`)}
                    </Badge>
                    {/* Boundary time-zone conversion: UTC → viewer's zone. */}
                    <time className="muted todo-item__time" dateTime={todo.createdAt}>
                      {formatUtcInTimeZone(todo.createdAt, { locale })}
                    </time>
                    {canWrite && (
                      <Button
                        variant="ghost"
                        aria-label={t('todos.deleteTodo', { title: todo.title })}
                        onClick={() => deleteTodo.mutate(todo.id)}
                        loading={deleteTodo.isPending && deleteTodo.variables === todo.id}
                        testId={TESTID.todos.itemDelete(todo.id)}
                      >
                        <Trash2 aria-hidden size="1em" />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <nav
            className="pagination"
            aria-label={t('common.page', { page: data.page, totalPages: data.totalPages })}
            data-testid={TESTID.todos.pagination}
          >
            <Button
              variant="secondary"
              disabled={data.page <= 1}
              onClick={() => patchParams({ page: String(data.page - 1) })}
              aria-label={t('common.previousPage')}
              testId={TESTID.todos.paginationPrev}
            >
              ←
            </Button>
            <span aria-live="polite" data-testid={TESTID.todos.paginationStatus}>
              {t('common.page', { page: data.page, totalPages: data.totalPages })}
            </span>
            <Button
              variant="secondary"
              disabled={!data.hasNextPage}
              onClick={() => patchParams({ page: String(data.page + 1) })}
              aria-label={t('common.nextPage')}
              testId={TESTID.todos.paginationNext}
            >
              →
            </Button>
          </nav>
        </>
      )}
    </section>
  );
}
