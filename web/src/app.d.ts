declare global {
  /** Injected by vite.config.ts from package.json - the single source of truth
   *  for the app version, which also matches the Android versionName.
   *
   *  Declared inside `declare global` on purpose: this file has a top-level
   *  export, which makes it a module, and a bare `declare const` in a module is
   *  local to it rather than ambient. */
  const __APP_VERSION__: string;

  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
