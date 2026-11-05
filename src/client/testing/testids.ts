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
    /** The service name in the header — a link home. */
    homeLink: 'app.header.home-link',
    /** Kept from the old header nav; the link now sits in the footer's bottom line. */
    navDesignSystem: 'app.nav.design-system',
    themeToggle: 'app.controls.theme-toggle',
    designToggle: 'app.controls.design-toggle',
    localeSelect: 'app.controls.locale-select',
    account: {
      signIn: 'app.account.sign-in',
      user: 'app.account.user',
      signOut: 'app.account.sign-out',
    },
    footer: 'app.footer',
    /** The <ul> of services rendered from /sitemap.json (absent while loading). */
    footerServices: 'app.footer.services',
    footerGithub: 'app.footer.github',
    footerCopyright: 'app.footer.copyright',
    /** The bottom line's links: the design system, then terms and privacy. */
    footerLegal: 'app.footer.legal',
  },
  todos: {
    page: 'todos.page',
    createForm: 'todos.create.form',
    createInput: 'todos.create.input',
    createSubmit: 'todos.create.submit',
    guestHint: 'todos.guest-hint',
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
  home: {
    page: 'home.page',
    chat: {
      panel: 'home.chat.panel',
      status: 'home.chat.status',
      participants: 'home.chat.participants',
      log: 'home.chat.log',
      message: (seq: number) => `home.chat.message.${seq}`,
      empty: 'home.chat.empty',
      form: 'home.chat.form',
      input: 'home.chat.input',
      send: 'home.chat.send',
    },
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
  signInFailed: {
    page: 'sign-in-failed.page',
    message: 'sign-in-failed.message',
    retry: 'sign-in-failed.retry',
    homeLink: 'sign-in-failed.home-link',
  },
} as const;
