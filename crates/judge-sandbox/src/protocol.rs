//! The supervisor's output framing: `[u8 type][u32 BE length][payload]`, types O / E / X.

use crate::ExecEvent;
use bytes::Bytes;
use serde::Deserialize;

/// Largest frame the supervisor accepts on its input.
pub const MAX_FRAME: usize = 65536;
/// Largest frame we accept from it (it never sends more than its 64 KiB read buffer).
const MAX_IN_FRAME: usize = 1 << 20;

/// Final status of a supervised program.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExitStatus {
    pub exit_code: Option<i64>,
    pub signal: Option<i32>,
    pub wall_ms: f64,
    pub cpu_ms: f64,
    /// Largest single process (rusage).
    pub max_rss_kb: i64,
    /// Largest polled total of all sandbox processes (0 when not polled).
    #[serde(default)]
    pub peak_rss_kb: i64,
    /// The cgroup OOM killer fired (runc only: gVisor has no `memory.events` inside).
    pub oom_killed: bool,
    /// Killed by the supervisor for using more than `--max-rss-mb`.
    #[serde(default)]
    pub memory_limit: bool,
    /// Killed by the supervisor for creating more than `--max-files` inodes.
    #[serde(default)]
    pub file_limit: bool,
    pub timed_out: bool,
    pub output_limit: bool,
    pub killed: bool,
    pub spawn_error: Option<String>,
}

impl ExitStatus {
    pub fn success(&self) -> bool {
        self.exit_code == Some(0)
    }

    pub fn signal_name(&self) -> Option<String> {
        self.signal.map(signal_name)
    }
}

pub fn signal_name(sig: i32) -> String {
    let name = match sig {
        1 => "SIGHUP",
        2 => "SIGINT",
        3 => "SIGQUIT",
        4 => "SIGILL",
        5 => "SIGTRAP",
        6 => "SIGABRT",
        7 => "SIGBUS",
        8 => "SIGFPE",
        9 => "SIGKILL",
        10 => "SIGUSR1",
        11 => "SIGSEGV",
        12 => "SIGUSR2",
        13 => "SIGPIPE",
        14 => "SIGALRM",
        15 => "SIGTERM",
        24 => "SIGXCPU",
        25 => "SIGXFSZ",
        31 => "SIGSYS",
        _ => return format!("signal {sig}"),
    };
    name.to_string()
}

#[derive(Default)]
pub struct Decoder {
    buf: Vec<u8>,
}

impl Decoder {
    pub fn push(&mut self, data: &[u8]) -> Result<Vec<ExecEvent>, String> {
        self.buf.extend_from_slice(data);
        let mut out = Vec::new();
        let mut off = 0;
        while self.buf.len() - off >= 5 {
            let kind = self.buf[off];
            let len = u32::from_be_bytes(self.buf[off + 1..off + 5].try_into().unwrap()) as usize;
            if len > MAX_IN_FRAME {
                return Err(format!("frame of {len} bytes"));
            }
            if self.buf.len() - off - 5 < len {
                break;
            }
            let payload = &self.buf[off + 5..off + 5 + len];
            out.push(match kind {
                b'O' => ExecEvent::Stdout(Bytes::copy_from_slice(payload)),
                b'E' => ExecEvent::Stderr(Bytes::copy_from_slice(payload)),
                b'X' => ExecEvent::Exit(
                    serde_json::from_slice(payload).map_err(|e| format!("bad status: {e}"))?,
                ),
                k => return Err(format!("unknown frame type {k}")),
            });
            off += 5 + len;
        }
        self.buf.drain(..off);
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(k: u8, p: &[u8]) -> Vec<u8> {
        let mut v = vec![k];
        v.extend_from_slice(&(p.len() as u32).to_be_bytes());
        v.extend_from_slice(p);
        v
    }

    #[test]
    fn decodes_split_frames() {
        let mut all = frame(b'O', b"hello");
        all.extend(frame(b'E', b"err"));
        all.extend(frame(
            b'X',
            br#"{"exitCode":0,"signal":null,"wallMs":1.5,"cpuMs":1,"maxRssKb":10,"oomKilled":false,"timedOut":false,"outputLimit":false,"killed":false,"spawnError":null}"#,
        ));
        let mut d = Decoder::default();
        let mut evs = Vec::new();
        for chunk in all.chunks(3) {
            evs.extend(d.push(chunk).unwrap());
        }
        assert!(matches!(&evs[0], ExecEvent::Stdout(b) if &b[..] == b"hello"));
        assert!(matches!(&evs[1], ExecEvent::Stderr(b) if &b[..] == b"err"));
        assert!(matches!(&evs[2], ExecEvent::Exit(s) if s.success() && s.wall_ms == 1.5));
    }

    #[test]
    fn rejects_garbage() {
        assert!(Decoder::default().push(&frame(b'Z', b"")).is_err());
        assert_eq!(signal_name(11), "SIGSEGV");
        assert_eq!(signal_name(25), "SIGXFSZ");
    }
}
