// Prevent a flash of console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    f2p_tracker_lib::run()
}
