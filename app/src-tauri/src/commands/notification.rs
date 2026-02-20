/// Send a macOS native notification via osascript (no extra plugin needed)
#[tauri::command]
pub fn send_notification(title: String, body: String) -> Result<(), String> {
    let script = format!(
        "display notification \"{}\" with title \"{}\"",
        body.replace('\"', "\\\"").replace('\\', "\\\\"),
        title.replace('\"', "\\\"").replace('\\', "\\\\"),
    );
    std::process::Command::new("osascript")
        .args(["-e", &script])
        .spawn()
        .map_err(|e| format!("Failed to send notification: {}", e))?;
    Ok(())
}
