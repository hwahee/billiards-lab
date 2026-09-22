/**
 * UI-automation test-id registry — the single source of truth for every
 * `data-testid` in the application. See docs/ui-automation.md for the full
 * conventions (naming, stability guarantees, ARIA-first selector guidance).
 *
 * Rules:
 *   - Never write a `data-testid` string inline in a component; add it here.
 *   - Format: `{page}.{section}.{element}`, kebab-case segments.
 *   - Dynamic ids (per-entity elements) are factory functions taking the
 *     entity id, e.g. `TESTID.todos.item(todo.id)`.
 */
export const TESTID = {
  app: {
    header: 'app.header',
    navTodos: 'app.nav.todos',
    navBilliards: 'app.nav.billiards',
    navDesignSystem: 'app.nav.design-system',
    themeToggle: 'app.controls.theme-toggle',
    designToggle: 'app.controls.design-toggle',
    localeSelect: 'app.controls.locale-select',
  },
  todos: {
    page: 'todos.page',
    createForm: 'todos.create.form',
    createInput: 'todos.create.input',
    createSubmit: 'todos.create.submit',
    filterStatus: 'todos.filter.status',
    sortBy: 'todos.sort.by',
    list: 'todos.list',
    item: (id: string) => `todos.item.${id}`,
    itemToggle: (id: string) => `todos.item.${id}.toggle`,
    itemDelete: (id: string) => `todos.item.${id}.delete`,
    loading: 'todos.loading',
    error: 'todos.error',
    errorRetry: 'todos.error.retry',
    empty: 'todos.empty',
    totalCount: 'todos.total-count',
    pagination: 'todos.pagination',
    paginationPrev: 'todos.pagination.prev',
    paginationNext: 'todos.pagination.next',
    paginationStatus: 'todos.pagination.status',
  },
  billiards: {
    page: 'billiards.page',
    canvas: 'billiards.canvas',
    control: (name: string) => `billiards.control.${name}`,
    strike: 'billiards.actions.strike',
    pause: 'billiards.actions.pause',
    step: 'billiards.actions.step',
    reset: 'billiards.actions.reset',
    resetPhysics: 'billiards.actions.reset-physics',
    showPrediction: 'billiards.control.show-prediction',
    ballState: (id: string) => `billiards.state.${id}`,
    eventLog: 'billiards.event-log',
    turnIndicator: 'billiards.turn-indicator',
    aimReadout: 'billiards.aim-readout',
    aimHud: 'billiards.aim-hud',
    aimHudDial: 'billiards.aim-hud.dial',
    aimHudPower: 'billiards.aim-hud.power',
    hudHint: 'billiards.hud.hint',
  },
  designSystem: {
    page: 'design-system.page',
    section: (name: string) => `design-system.section.${name}`,
    overlay: {
      openModal: 'design-system.overlay.open-modal',
      openSheet: 'design-system.overlay.open-sheet',
      openSidebar: 'design-system.overlay.open-sidebar',
      modal: 'design-system.overlay.modal',
      sheet: 'design-system.overlay.sheet',
      sidebar: 'design-system.overlay.sidebar',
      /* Opened from inside the modal — the nesting the stack has to survive. */
      nest: 'design-system.overlay.nest',
      confirm: 'design-system.overlay.confirm',
      confirmYes: 'design-system.overlay.confirm.yes',
      confirmNo: 'design-system.overlay.confirm.no',
      save: 'design-system.overlay.save',
      result: 'design-system.overlay.result',
      /* The declarative door — an inline sidebar is layout, not a popup. */
      inline: 'design-system.overlay.inline',
      inlineToggle: 'design-system.overlay.inline.toggle',
    },
  },
  notFound: {
    page: 'not-found.page',
    homeLink: 'not-found.home-link',
  },
} as const;
