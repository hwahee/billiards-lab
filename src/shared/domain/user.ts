/**
 * User domain — the shared contract between server and client.
 *
 * Members live on the member server (CLAUDE.md). A service knows a member
 * only as the member server named them when they signed in — the OIDC `sub`
 * and `name` claims — and keeps no user records of its own. There is no
 * password anywhere in this contract, by design.
 */
export interface User {
  /** The member's id on the member server (OIDC `sub`). */
  id: string;
  /** The member's nickname as of their sign-in (OIDC `name`). */
  displayName: string;
}
