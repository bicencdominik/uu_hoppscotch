import { HoppModule } from "."

/**
 * Release-notes check -- disabled for the air-gapped build.
 *
 * When active, this module's `onRootSetup` called `useWhatsNewDialog()`, which
 * fetches https://releases.hoppscotch.com/releases/<version>.json ten seconds
 * after boot, on the first load following a major version bump. It is the only
 * request this application makes on its own initiative.
 *
 * The failure is caught and silent, but it still opens a connection that cannot
 * succeed on every upgrade, and shows up in egress monitoring on a network that
 * is supposed to have none.
 *
 * `deprecated` is the module system's own opt-out -- see the filter in
 * `src/modules/index.ts`. The composable and its dialog component are left in
 * the tree so restoring this is a one-line change if the app is ever run
 * somewhere with internet access.
 */
export default <HoppModule>{
  deprecated: true,
}
