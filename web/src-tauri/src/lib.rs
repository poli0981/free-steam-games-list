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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
