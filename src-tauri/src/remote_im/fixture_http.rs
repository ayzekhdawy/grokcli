//! Tiny HTTP fixture server for Remote IM protocol unit tests (shipped-path).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

#[derive(Clone)]
struct RouteResp {
    status: u16,
    body: String,
}

#[derive(Clone, Default)]
pub struct FixtureState {
    pub requests: Arc<Mutex<Vec<String>>>,
    /// path substring → FIFO of responses (pop front each hit)
    routes: Arc<Mutex<HashMap<String, Vec<RouteResp>>>>,
}

impl FixtureState {
    pub fn set_route(&self, path_contains: &str, status: u16, body: impl Into<String>) {
        self.routes.lock().unwrap().insert(
            path_contains.into(),
            vec![RouteResp {
                status,
                body: body.into(),
            }],
        );
    }

    /// Queue multiple sequential responses for the same path match.
    pub fn set_route_sequence(&self, path_contains: &str, responses: Vec<(u16, String)>) {
        let q = responses
            .into_iter()
            .map(|(status, body)| RouteResp { status, body })
            .collect();
        self.routes.lock().unwrap().insert(path_contains.into(), q);
    }

    /// Append one more response for a path (creates route if missing).
    #[allow(dead_code)]
    pub fn push_route(&self, path_contains: &str, status: u16, body: impl Into<String>) {
        self.routes
            .lock()
            .unwrap()
            .entry(path_contains.into())
            .or_default()
            .push(RouteResp {
                status,
                body: body.into(),
            });
    }

    pub fn request_paths(&self) -> Vec<String> {
        self.requests.lock().unwrap().clone()
    }
}

/// Spawn fixture HTTP server; returns base URL like http://127.0.0.1:PORT and a shutdown sender.
pub async fn spawn_fixture() -> (String, FixtureState, oneshot::Sender<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let state = FixtureState::default();
    let state_c = state.clone();
    let (tx, mut rx) = oneshot::channel::<()>();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut rx => break,
                acc = listener.accept() => {
                    let Ok((mut sock, _)) = acc else { continue };
                    let state = state_c.clone();
                    tokio::spawn(async move {
                        let mut buf = vec![0u8; 65536];
                        let n = match sock.read(&mut buf).await {
                            Ok(n) if n > 0 => n,
                            _ => return,
                        };
                        let req = String::from_utf8_lossy(&buf[..n]).to_string();
                        let first = req.lines().next().unwrap_or("").to_string();
                        state.requests.lock().unwrap().push(first.clone());
                        let (status, body) = {
                            let mut routes = state.routes.lock().unwrap();
                            let mut status = 404u16;
                            let mut body = "not found".to_string();
                            for (k, q) in routes.iter_mut() {
                                if first.contains(k.as_str()) || req.contains(k.as_str()) {
                                    if let Some(r) = q.first().cloned() {
                                        status = r.status;
                                        body = r.body;
                                        if q.len() > 1 {
                                            q.remove(0);
                                        }
                                    }
                                    break;
                                }
                            }
                            (status, body)
                        };
                        let resp = format!(
                            "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                            body.len()
                        );
                        let _ = sock.write_all(resp.as_bytes()).await;
                    });
                }
            }
        }
    });

    (format!("http://{addr}"), state, tx)
}
