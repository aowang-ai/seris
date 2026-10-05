//! The native shell owns the gateway process; the bundled UI keeps its origin
//! and state across gateway restarts. Business traffic uses authenticated HTTP.
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

const MAX_FAILURES: u64 = 5;
const READY_TIMEOUT: Duration = Duration::from_secs(30);
struct GatewayState {
    ready: AtomicBool,
    stopping: AtomicBool,
    failures: AtomicU64,
    connection: Mutex<Option<Value>>,
    child: Mutex<Option<Child>>,
    tail: Mutex<String>,
}
fn bounded_tail(text: &mut String) {
    let mut cut = text.len().saturating_sub(8192);
    while !text.is_char_boundary(cut) {
        cut += 1;
    }
    text.drain(..cut);
}
fn failure_count(previous: u64, uptime: Duration) -> u64 {
    if uptime >= Duration::from_secs(30) {
        1
    } else {
        previous + 1
    }
}
impl GatewayState {
    fn push_tail(&self, text: &str) {
        let mut tail = self.tail.lock().unwrap();
        tail.push_str(text);
        bounded_tail(&mut tail);
    }
    fn snapshot(&self) -> Value {
        json!({"ready":self.ready.load(Ordering::SeqCst),"consecutiveFailures":self.failures.load(Ordering::SeqCst),
            "circuitBroken":self.failures.load(Ordering::SeqCst)>=MAX_FAILURES,"tail":self.tail.lock().unwrap().clone()})
    }
    fn stop_child(&self) {
        self.ready.store(false, Ordering::SeqCst);
        *self.connection.lock().unwrap() = None;
        if let Some(mut child) = self.child.lock().unwrap().take() {
            // Closing stdin requests a graceful gateway shutdown, including tools.
            drop(child.stdin.take());
            let deadline = Instant::now() + Duration::from_secs(5);
            while Instant::now() < deadline {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    kill_tree(&mut child);
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            kill_tree(&mut child);
            let _ = child.wait();
        }
    }
}
fn kill_tree(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .status();
    }
    let _ = child.kill();
}
fn runtime_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), Box<dyn std::error::Error>> {
    if cfg!(debug_assertions) {
        return Ok((
            PathBuf::from("node"),
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../core/dist/gateway/server.js")
                .canonicalize()?,
        ));
    }
    let resources = app.path().resource_dir()?;
    let manifest: Value = serde_json::from_slice(&std::fs::read(resources.join("manifest.json"))?)?;
    let id = manifest["id"]
        .as_str()
        .filter(|s| s.len() == 16 && s.chars().all(|c| c.is_ascii_hexdigit()))
        .ok_or("Invalid resource manifest")?;
    let cache = app.path().app_cache_dir()?.join("core");
    let core = cache.join(id);
    let entry = core.join("dist/gateway/server.js");
    if !entry.exists() {
        std::fs::create_dir_all(&cache)?;
        let staging = cache.join(format!("{id}.{}", std::process::id()));
        if staging.exists() {
            std::fs::remove_dir_all(&staging)?;
        }
        std::fs::create_dir_all(&staging)?;
        let archive = std::fs::File::open(resources.join("core.tar.gz"))?;
        tar::Archive::new(flate2::read::GzDecoder::new(archive)).unpack(&staging)?;
        if !staging.join("dist/gateway/server.js").exists() {
            return Err("Packaged gateway missing".into());
        }
        if core.exists() {
            std::fs::remove_dir_all(&core)?;
        }
        std::fs::rename(staging, &core)?;
    }
    let node = resources.join(if cfg!(windows) {
        "runtime/node.exe"
    } else {
        "runtime/node"
    });
    Ok((node, entry))
}
fn credential_response(request: &Value) -> Value {
    let result = (|| -> Result<Option<String>, String> {
        let account = request["account"].as_str().ok_or("Invalid account")?;
        if account.is_empty()
            || account.len() > 80
            || !account
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        {
            return Err("Invalid account".into());
        }
        let entry = keyring::Entry::new("im.seris.models", account)
            .map_err(|_| "Credential store unavailable")?;
        match request["op"].as_str() {
            Some("read") => match entry.get_password() {
                Ok(key) => Ok(Some(key)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(_) => Err("Credential store unavailable".into()),
            },
            Some("write") => {
                let key = request["key"]
                    .as_str()
                    .filter(|key| !key.is_empty())
                    .ok_or("Missing key")?;
                entry
                    .set_password(key)
                    .map_err(|_| "Credential store unavailable")?;
                Ok(None)
            }
            Some("delete") => match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(None),
                Err(_) => Err("Credential store unavailable".into()),
            },
            _ => Err("Invalid credential operation".into()),
        }
    })();
    match result {
        Ok(key) => json!({"type":"credential","id":request["id"],"key":key}),
        Err(error) => json!({"type":"credential","id":request["id"],"error":error}),
    }
}

fn spawn_gateway(
    app: &AppHandle,
    state: &Arc<GatewayState>,
) -> Result<(), Box<dyn std::error::Error>> {
    let (node, entry) = runtime_paths(app)?;
    let data = match std::env::var("SERIS_DATA_DIR")
        .ok()
        .filter(|s| !s.trim().is_empty())
    {
        Some(path) => PathBuf::from(path),
        None => app.path().app_data_dir()?,
    };
    std::fs::create_dir_all(&data)?;
    let data = data.canonicalize()?;
    let mut command = Command::new(node);
    command
        .arg(entry)
        .current_dir(&data)
        .env("SERIS_DATA_DIR", &data)
        .env("SERIS_MANAGED", "1")
        .env("SERIS_SECRET_STORE", "keyring")
        .env(
            "SERIS_PORT",
            if cfg!(debug_assertions) { "3789" } else { "0" },
        )
        .env("SERIS_DEV_ORIGIN", "http://localhost:5173")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn()?;
    let child_id = child.id();
    let stdout = child.stdout.take().ok_or("Missing stdout")?;
    let stderr = child.stderr.take().ok_or("Missing stderr")?;
    // Publish the handle before waiting for readiness, so startup failures and
    // application exit can always reap the child.
    {
        let mut slot = state.child.lock().unwrap();
        if state.stopping.load(Ordering::SeqCst) {
            kill_tree(&mut child);
            let _ = child.wait();
            return Err("Stopping".into());
        }
        *slot = Some(child);
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let out_state = Arc::clone(state);
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(request) = line.strip_prefix("seris credential ") {
                // This private pipe carries secrets. Never include these lines in diagnostics.
                if let Ok(request) = serde_json::from_str::<Value>(request) {
                    let credential_state = Arc::clone(&out_state);
                    // OS unlock/authorization dialogs must not block readiness or stdout draining.
                    std::thread::spawn(move || {
                        let response = credential_response(&request);
                        let mut slot = credential_state.child.lock().unwrap();
                        if let Some(child) = slot.as_mut().filter(|child| child.id() == child_id) {
                            if let Some(stdin) = child.stdin.as_mut() {
                                let _ = writeln!(stdin, "{response}");
                            }
                        }
                    });
                }
            } else if let Some(rest) = line.strip_prefix("seris ready at ") {
                let _ = tx.send(rest.to_owned());
            } else {
                out_state.push_tail(&format!("[stdout] {line}\n"));
            }
            // Keep draining after readiness; otherwise stdout can block Node.
        }
    });
    let err_state = Arc::clone(state);
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("[gateway] {line}");
            err_state.push_tail(&format!("[stderr] {line}\n"));
        }
    });
    let deadline = Instant::now() + READY_TIMEOUT;
    loop {
        if state.stopping.load(Ordering::SeqCst) {
            return Err("Stopping".into());
        }
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(line) => {
                let connection: Value = serde_json::from_str(&line)?;
                let url = connection["url"].as_str().ok_or("Missing gateway URL")?;
                let parsed = tauri::Url::parse(url)?;
                if parsed.scheme() != "http"
                    || parsed.host_str() != Some("127.0.0.1")
                    || connection["token"].as_str().unwrap_or("").is_empty()
                {
                    return Err("Invalid gateway connection".into());
                }
                *state.connection.lock().unwrap() = Some(connection);
                state.ready.store(true, Ordering::SeqCst);
                return Ok(());
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return Err("Gateway exited before readiness".into())
            }
            Err(_) if Instant::now() >= deadline => return Err("Gateway ready timeout".into()),
            Err(_) => {}
        }
    }
}
fn supervise(app: AppHandle, state: Arc<GatewayState>) {
    while !state.stopping.load(Ordering::SeqCst)
        && state.failures.load(Ordering::SeqCst) < MAX_FAILURES
    {
        let mut uptime = Duration::ZERO;
        match spawn_gateway(&app, &state) {
            Err(error) => state.push_tail(&format!("[startup] {error}\n")),
            Ok(()) => {
                let ready_at = Instant::now();
                loop {
                    if state.stopping.load(Ordering::SeqCst) {
                        break;
                    }
                    let exited = {
                        let mut slot = state.child.lock().unwrap();
                        match slot.as_mut() {
                            Some(child) => !matches!(child.try_wait(), Ok(None)),
                            None => true,
                        }
                    };
                    if exited {
                        state.push_tail("[exit] Gateway stopped\n");
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                uptime = ready_at.elapsed();
            }
        }
        state.stop_child();
        if state.stopping.load(Ordering::SeqCst) {
            break;
        }
        let failures = failure_count(state.failures.load(Ordering::SeqCst), uptime);
        state.failures.store(failures, Ordering::SeqCst);
        let delay = Duration::from_millis(
            (500 * 2u64.saturating_pow(failures.saturating_sub(1) as u32)).min(10_000),
        );
        let until = Instant::now() + delay;
        while Instant::now() < until && !state.stopping.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}
#[tauri::command]
fn gateway_connection(state: State<Arc<GatewayState>>) -> Option<Value> {
    state.connection.lock().unwrap().clone()
}
#[tauri::command]
fn gateway_status(state: State<Arc<GatewayState>>) -> Value {
    state.snapshot()
}
fn main() {
    let state = Arc::new(GatewayState {
        ready: AtomicBool::new(false),
        stopping: AtomicBool::new(false),
        failures: AtomicU64::new(0),
        connection: Mutex::new(None),
        child: Mutex::new(None),
        tail: Mutex::new(String::new()),
    });
    let setup_state = Arc::clone(&state);
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::clone(&state))
        .setup(move |app| {
            let handle = app.handle().clone();
            let state = Arc::clone(&setup_state);
            std::thread::spawn(move || supervise(handle, state));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![gateway_connection, gateway_status])
        .build(tauri::generate_context!())
        .expect("Error starting Seris");
    app.run(move |_, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            state.stopping.store(true, Ordering::SeqCst);
            state.stop_child();
        }
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Uses Node and a disposable entry in the real OS keychain"]
    fn native_credential_pipe_round_trip() {
        let module = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../core/dist/runtime/credentials.js")
            .canonicalize()
            .unwrap();
        let module = tauri::Url::from_file_path(module).unwrap();
        let account = format!("seris-pipe-test-{}", std::process::id());
        let script = format!("import {{createSecretStore}} from '{}';const s=createSecretStore();await s.write('{}','disposable-pipe-key');if(await s.read('{}')!=='disposable-pipe-key')throw Error('Wrong key');await s.delete('{}');console.log('PASS');process.exit(0);", module, account, account, account);
        let mut child = Command::new("node")
            .args(["--input-type=module", "-e", &script])
            .env("SERIS_SECRET_STORE", "keyring")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let mut passed = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(raw) = line.strip_prefix("seris credential ") {
                let request: Value = serde_json::from_str(raw).unwrap();
                let response = credential_response(&request);
                writeln!(child.stdin.as_mut().unwrap(), "{response}").unwrap();
            } else if line == "PASS" {
                passed = true;
            }
        }
        assert!(child.wait().unwrap().success());
        assert!(passed);
    }
    #[test]
    fn invalid_credential_requests_never_echo_secrets() {
        let response = credential_response(
            &json!({"id":"fixture","op":"write","account":"../invalid","key":"private-key"}),
        );
        assert_eq!(response["id"], "fixture");
        assert!(response["error"].is_string());
        assert!(!response.to_string().contains("private-key"));
    }
    #[test]
    #[ignore = "Uses a disposable entry in the real OS keychain"]
    fn system_keychain_round_trip() {
        let account = format!("seris-test-{}", std::process::id());
        let request = |op: &str| json!({"id":"fixture","op":op,"account":account,"key":"disposable-test-secret"});
        let written = credential_response(&request("write"));
        let read = credential_response(&request("read"));
        let deleted = credential_response(&request("delete"));
        assert!(written["error"].is_null(), "{written}");
        assert_eq!(read["key"], "disposable-test-secret");
        assert!(deleted["error"].is_null(), "{deleted}");
        assert!(credential_response(&request("read"))["key"].is_null());
    }
    #[test]
    fn utf8_tail_is_safe() {
        let mut s = "中".repeat(5000);
        bounded_tail(&mut s);
        assert!(s.len() <= 8192);
        assert!(s.chars().all(|c| c == '中'));
    }
    #[test]
    fn short_crashes_trip_circuit() {
        let mut n = 0;
        for _ in 0..5 {
            n = failure_count(n, Duration::from_secs(1));
        }
        assert_eq!(n, MAX_FAILURES);
        assert_eq!(failure_count(n, Duration::from_secs(31)), 1);
    }
    #[cfg(unix)]
    #[test]
    fn shutdown_closes_stdin_and_reaps_child() {
        use std::os::unix::process::CommandExt;
        let child = Command::new("/bin/sh")
            .args(["-c", "cat >/dev/null"])
            .process_group(0)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let pid = child.id();
        let state = GatewayState {
            ready: AtomicBool::new(true),
            stopping: AtomicBool::new(false),
            failures: AtomicU64::new(0),
            connection: Mutex::new(None),
            child: Mutex::new(Some(child)),
            tail: Mutex::new(String::new()),
        };
        let started = Instant::now();
        state.stop_child();
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(!state.ready.load(Ordering::SeqCst));
        assert!(state.child.lock().unwrap().is_none());
        assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
    }
}
