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

  'common.skipToContent': 'Skip to main content',
  'common.loading': 'Loading…',
  'common.retry': 'Retry',
  'common.delete': 'Delete',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.confirm': 'Confirm',
  'common.page': 'Page {page} of {totalPages}',
  'common.previousPage': 'Previous page',
  'common.nextPage': 'Next page',
  'common.theme.light': 'Switch to light theme',
  'common.theme.dark': 'Switch to dark theme',
  'common.design.a': 'Design A (aesthetic)',
  'common.design.b': 'Design B (high visibility)',
  'common.design.office': 'Office skin (classic desktop)',
  'common.design.kids': 'Kids skin (playground)',
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

  'palette.recent': 'Recently used',
  'palette.hexLabel': 'Hex value',
  'palette.hexInvalid': 'Use a color like #5b5bd6 or #5b5bd680.',
  'palette.customColor': 'More colors (system picker)',
  'palette.contrastWarning': 'Contrast {ratio}:1 — below the {minimum}:1 minimum.',

  'designSystem.title': 'Design System',
  'designSystem.description':
    'Every token and component in one place. Use the header controls to toggle theme (light/dark), design variant (A / B / Office / Kids) and language.',
  'designSystem.colors': 'Color tokens',
  'designSystem.typography': 'Typography',
  'designSystem.buttons': 'Buttons',
  'designSystem.formFields': 'Form fields',
  'designSystem.feedback': 'Feedback',
  'designSystem.dataDisplay': 'Data display',
  'designSystem.disclosure': 'Disclosure (accordion)',
  'designSystem.colorInput': 'Color input (palette)',
  'designSystem.overlays': 'Overlays (modal / sheet / sidebar)',

  'notFound.title': 'Page not found',
  'notFound.goHome': 'Go to home',

  'error.validation': 'The request contains invalid data.',
  'error.notFound': 'The requested resource was not found.',
  'error.internal': 'An unexpected error occurred. Please try again.',
  'error.versionMismatch':
    'A new version of the application has been deployed. The page will reload.',
} as const;

export type MessageKey = keyof typeof en;
