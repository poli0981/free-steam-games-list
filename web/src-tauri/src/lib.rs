// Library entry point so `tauri build` and `tauri dev` share the same
// runtime. Keeps main.rs trivial for cross-platform binary plumbing.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_shell::init());

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
