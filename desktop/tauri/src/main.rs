#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // A missing `.env` is non-fatal; production builds run without one.
    let _ = dotenvy::dotenv();
    jobhunter_desktop_lib::run();
}
