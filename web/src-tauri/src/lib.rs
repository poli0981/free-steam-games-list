// Library entry point so `tauri build` and `tauri dev` share the same
// runtime. Keeps main.rs trivial for cross-platform binary plumbing.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
