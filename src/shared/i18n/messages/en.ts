/**
 * English message catalog — the source of truth for message keys.
 * Every other locale must provide exactly the same keys (enforced by the
 * `Record<MessageKey, string>` annotation on the other catalogs).
 *
 * Interpolation uses `{name}` placeholders, resolved by `translate()`.
 */
export const en = {
  'app.title': 'Bun Fullstack Boilerplate',
  'app.tagline': 'React · Bun · Bun server monorepo starter',

  'nav.todos': 'Todos',
  'nav.designSystem': 'Design System',
  'nav.billiards': 'Billiards',

  'common.skipToContent': 'Skip to main content',
  'common.loading': 'Loading…',
  'common.retry': 'Retry',
  'common.delete': 'Delete',
  'common.cancel': 'Cancel',
  'common.page': 'Page {page} of {totalPages}',
  'common.previousPage': 'Previous page',
  'common.nextPage': 'Next page',
  'common.theme.light': 'Switch to light theme',
  'common.theme.dark': 'Switch to dark theme',
  'common.design.a': 'Design A (aesthetic)',
  'common.design.b': 'Design B (high visibility)',
  'common.language': 'Language',

  'todos.title': 'Todos',
  'todos.description': 'A small demo domain exercising the full stack.',
  'todos.createLabel': 'New todo title',
  'todos.createPlaceholder': 'What needs to be done?',
  'todos.createSubmit': 'Add todo',
  'todos.empty': 'Nothing here yet. Add your first todo above.',
  'todos.filterLabel': 'Filter by status',
  'todos.filter.all': 'All',
  'todos.filter.open': 'Open',
  'todos.filter.done': 'Done',
  'todos.sortLabel': 'Sort by',
  'todos.sort.createdAt': 'Created date',
  'todos.sort.title': 'Title',
  'todos.toggleStatus': 'Mark "{title}" as {status}',
  'todos.deleteTodo': 'Delete "{title}"',
  'todos.status.open': 'Open',
  'todos.status.done': 'Done',
  'todos.loadFailed': 'Could not load todos.',
  'todos.total': '{count} items in total',

  'designSystem.title': 'Design System',
  'designSystem.description':
    'Every token and component in one place. Use the header controls to toggle theme (light/dark), design variant (A/B) and language.',
  'designSystem.colors': 'Color tokens',
  'designSystem.typography': 'Typography',
  'designSystem.buttons': 'Buttons',
  'designSystem.formFields': 'Form fields',
  'designSystem.feedback': 'Feedback',
  'designSystem.dataDisplay': 'Data display',

  'billiards.title': 'Billiards Lab',
  'billiards.description':
    'A deterministic carom simulation: set the strike vector, spin axis and physical coefficients, and the whole evolution is computed exactly — preview it with the predicted paths.',
  'billiards.group.shot': 'Shot variables',
  'billiards.group.physics': 'Physics coefficients',
  'billiards.group.simulation': 'Simulation',
  'billiards.group.state': 'Live state',
  'billiards.speed': 'Initial speed',
  'billiards.direction': 'Direction',
  'billiards.lateralSpeed': 'Lateral speed',
  'billiards.topspin': 'Topspin / backspin',
  'billiards.sidespin': 'Sidespin',
  'billiards.rollspin': 'Roll spin (curve)',
  'billiards.slidingFriction': 'Sliding friction μs',
  'billiards.rollingFriction': 'Rolling friction μr',
  'billiards.spinFriction': 'Spin decay μsp',
  'billiards.cushionRestitution': 'Cushion restitution',
  'billiards.cushionFriction': 'Cushion friction',
  'billiards.ballRestitution': 'Ball restitution',
  'billiards.ballFriction': 'Ball friction',
  'billiards.simSpeed': 'Playback speed',
  'billiards.strike': 'Strike',
  'billiards.pause': 'Pause',
  'billiards.resume': 'Resume',
  'billiards.step': 'Step 1/60 s',
  'billiards.reset': 'Reset table',
  'billiards.resetPhysics': 'Restore defaults',
  'billiards.showPrediction': 'Show predicted paths',
  'billiards.simTime': 'Sim time',
  'billiards.ball.white': 'White (cue)',
  'billiards.ball.yellow': 'Yellow',
  'billiards.ball.redA': 'Red A',
  'billiards.ball.redB': 'Red B',
  'billiards.events': 'Collision log',
  'billiards.events.empty': 'No collisions yet.',
  'billiards.event.cushion': '{ball} — cushion',
  'billiards.event.ball': '{ball} ↔ {other}',

  'notFound.title': 'Page not found',
  'notFound.goHome': 'Go to home',

  'error.validation': 'The request contains invalid data.',
  'error.notFound': 'The requested resource was not found.',
  'error.internal': 'An unexpected error occurred. Please try again.',
  'error.versionMismatch':
    'A new version of the application has been deployed. The page will reload.',
} as const;

export type MessageKey = keyof typeof en;
