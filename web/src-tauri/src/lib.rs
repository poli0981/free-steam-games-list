// Library entry point so `tauri build` and `tauri dev` share the same
// runtime. Keeps main.rs trivial for cross-platform binary plumbing.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single-instance MUST be the first plugin so it can short-circuit a
    // duplicate launch before any other state initialises. Without this, each
    // Start-menu / shortcut invocation spawns a separate process that stays
    // resident — Task Manager grew an extra `f2p-tracker.exe` per launch.
    // Desktop-only: the plugin isn't published for iOS / Android, matching
    // the updater gating below and in Cargo.toml.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        use tauri::Manager;
        builder = builder.plugin(tauri_plugin_single_instance::init(
            |app, _args, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            },
        ));
    }

    builder = builder.plugin(tauri_plugin_shell::init());

    // The updater plugin only ships on desktop. Tauri rejects it at compile
    // time for iOS / Android, and we gate the Cargo dep the same way in
    // Cargo.toml so mobile builds don't pull it in.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(|app| {
            purge_stale_webview_data(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Clear the webview's storage once, the first time a new version runs.
///
/// Builds up to 1.4.5 registered a PWA service worker, and one registered at
/// tauri.localhost can NEVER be updated: the update algorithm refetches the
/// worker script bypassing the worker, and Tauri's custom protocol does not
/// satisfy it. Measured over CDP against a real release build:
///
///   TypeError: Failed to update a ServiceWorker for scope
///   ('http://tauri.localhost/') with script ('http://tauri.localhost/sw.js'):
///   An unknown error occurred when fetching the script.
///
/// So that worker keeps serving its own precache - including index.html -
/// forever. The 2.0.0 build launched showing the 1.4.x React UI inside the new
/// 2.0.0 window, and no amount of frontend code could fix it: the frontend that
/// would do the fixing is the part being served from the stale cache.
///
/// It has to happen out here, before the webview loads anything. The current
/// build ships no service worker at all (see vite.config.ts), so this runs once
/// per upgrade and then never again.
///
/// COST, STATED PLAINLY: this also clears localStorage and IndexedDB, so the
/// legal consent, theme and language choices are asked for again, and the
/// catalogue is re-downloaded once. WebView2's ClearBrowsingData is all-or-
/// nothing; there is no way to drop only the service worker. An upgrade that
/// re-asks for consent is a far better outcome than one that silently ships the
/// previous version's app.
///
/// Best effort throughout: a failure here must not stop the app from starting.
fn purge_stale_webview_data<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Manager;

    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let stamp = dir.join("webview-data-version");
    let current = app.package_info().version.to_string();

    if std::fs::read_to_string(&stamp).unwrap_or_default().trim() == current {
        return;
    }

    if let Some(webview) = app.get_webview_window("main") {
        let _ = webview.clear_all_browsing_data();

        // Reload, or the user is left looking at a blank window: setup() runs
        // while the first page is already loading, and clearing storage out
        // from under it leaves a document with an empty body. Verified by hand
        // against a real stuck install - after the reload the 2.0.0 UI appears.
        //
        // The delay is a concession to WebView2's ClearBrowsingData being
        // asynchronous with no completion signal exposed through Tauri.
        // Reloading too early would simply repeat the blank page. If the reload
        // is missed entirely the next launch is still correct, because the
        // stamp below is already written and no second clear happens.
        let w = webview.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(600));
            let _ = w.eval("location.reload()");
        });
    }

    // Written even if the clear failed. Retrying on every launch would wipe the
    // user's settings every time, which is worse than the stale cache this is
    // meant to cure.
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(&stamp, &current);
}
