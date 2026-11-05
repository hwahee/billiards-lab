/**
 * Worker role — background job processing.
 *
 * The same binary can run as `web`, `worker`, or `all` (SERVER_ROLE), so a
 * deployment can scale HTTP and background processing independently. Jobs
 * travel over the pub/sub bus: with the redis driver they are distributed
 * across instances; with the memory driver they stay in-process.
 *
 * Register new job types in `JOB_HANDLERS`.
 *
 * Besides jobs, the worker sweeps chat messages past their room's retention.
 * With several workers each one sweeps; the deletes simply overlap.
 */
import { s, toValidator } from '@shared/validation';

import type { Container } from './container';
import { CHANNELS } from './pubsub';

const jobValidator = toValidator(
  s.looseObject({
    type: s.string().check(s.minLength(1)),
  }),
);

/** How often chat messages past their room's retention are deleted. */
const CHAT_PURGE_INTERVAL_MS = 60_000;

type JobHandler = (job: Record<string, unknown>, container: Container) => Promise<void>;

const JOB_HANDLERS: Record<string, JobHandler> = {
  /** Demo job published by TodoService.create. Replace with real work. */
  'todo.created': (job, container) => {
    container.log.info('worker processed job', { type: 'todo.created', todoId: job.todoId });
    return Promise.resolve();
  },
};

/** Starts consuming jobs; returns an unsubscribe function for shutdown. */
export async function startWorker(container: Container): Promise<() => Promise<void>> {
  const { log } = container;
  const unsubscribe = await container.pubsub().subscribe(CHANNELS.jobs, (message) => {
    const parsed = jobValidator.safeParse(message);
    if (!parsed.ok) {
      log.warn('worker received malformed job', { message });
      return;
    }
    const handler = JOB_HANDLERS[parsed.value.type];
    if (!handler) {
      log.warn('worker received unknown job type', { type: parsed.value.type });
      return;
    }
    handler(parsed.value, container).catch((error: unknown) => {
      log.error('job failed', {
        type: parsed.value.type,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  const purgeChat = setInterval(() => {
    container
      .chatService()
      .purgeExpired()
      .then((deleted) => {
        if (deleted > 0) log.info('expired chat messages deleted', { deleted });
      })
      .catch((error: unknown) => {
        log.error('chat purge failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, CHAT_PURGE_INTERVAL_MS);

  log.info('worker started', { channel: CHANNELS.jobs });
  return async () => {
    clearInterval(purgeChat);
    await unsubscribe();
  };
}
