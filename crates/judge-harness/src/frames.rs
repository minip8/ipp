//! Splitting the driver's stdout into the candidate's own output and nonce-framed result frames.
//!
//! A frame is `"\x1eIPP" + nonce + "\x1f" + <one-line JSON> + "\n"`. Anything else on stdout is
//! the candidate's output. The marker may arrive split across reads, so the parser buffers the
//! longest suffix that could still turn into a marker.

use serde_json::Value;

#[derive(Debug, PartialEq)]
pub enum Piece {
    /// Candidate output.
    Text(Vec<u8>),
    /// A frame; Err if it was not valid JSON or too large.
    Frame(Result<Value, String>),
}

pub fn marker(nonce: &str) -> Vec<u8> {
    let mut m = b"\x1eIPP".to_vec();
    m.extend_from_slice(nonce.as_bytes());
    m.push(0x1f);
    m
}

pub struct FrameParser {
    marker: Vec<u8>,
    buf: Vec<u8>,
    in_frame: bool,
    /// Bytes of `buf` already searched for the frame's newline (so a long frame arriving in many
    /// small reads is scanned once, not once per read).
    scanned: usize,
    max_frame: usize,
}

impl FrameParser {
    pub fn new(nonce: &str, max_frame: usize) -> Self {
        FrameParser {
            marker: marker(nonce),
            buf: Vec::new(),
            in_frame: false,
            scanned: 0,
            max_frame,
        }
    }

    pub fn push(&mut self, data: &[u8]) -> Vec<Piece> {
        self.buf.extend_from_slice(data);
        let mut out = Vec::new();
        loop {
            if self.in_frame {
                match self.buf[self.scanned..].iter().position(|b| *b == b'\n') {
                    Some(nl) => {
                        let nl = self.scanned + nl;
                        self.scanned = 0;
                        let body: Vec<u8> = self.buf.drain(..=nl).collect();
                        let parsed = serde_json::from_slice::<Value>(&body[..body.len() - 1])
                            .map_err(|e| e.to_string());
                        out.push(Piece::Frame(parsed));
                        self.in_frame = false;
                    }
                    None => {
                        self.scanned = self.buf.len();
                        if self.buf.len() > self.max_frame {
                            self.buf.clear();
                            self.scanned = 0;
                            self.in_frame = false;
                            out.push(Piece::Frame(Err("result frame too large".into())));
                        }
                        break;
                    }
                }
            } else {
                match find(&self.buf, &self.marker) {
                    Some(i) => {
                        if i > 0 {
                            out.push(Piece::Text(self.buf[..i].to_vec()));
                        }
                        self.buf.drain(..i + self.marker.len());
                        self.in_frame = true;
                    }
                    None => {
                        let keep = partial_suffix(&self.buf, &self.marker);
                        let emit = self.buf.len() - keep;
                        if emit > 0 {
                            out.push(Piece::Text(self.buf.drain(..emit).collect()));
                        }
                        break;
                    }
                }
            }
        }
        out
    }

    /// Whatever is left when the stream ends (candidate output that looked like a marker prefix).
    pub fn finish(&mut self) -> Vec<u8> {
        self.in_frame = false;
        self.scanned = 0;
        std::mem::take(&mut self.buf)
    }
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || hay.len() < needle.len() {
        return None;
    }
    hay.windows(needle.len()).position(|w| w == needle)
}

/// Length of the longest suffix of `buf` that is a proper prefix of `marker`.
fn partial_suffix(buf: &[u8], marker: &[u8]) -> usize {
    let max = (marker.len() - 1).min(buf.len());
    (1..=max)
        .rev()
        .find(|&k| buf[buf.len() - k..] == marker[..k])
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn run(chunks: &[&[u8]]) -> (Vec<u8>, Vec<Value>) {
        let mut p = FrameParser::new("abc", 1 << 20);
        let (mut text, mut frames) = (Vec::new(), Vec::new());
        for c in chunks {
            for piece in p.push(c) {
                match piece {
                    Piece::Text(t) => text.extend(t),
                    Piece::Frame(f) => frames.push(f.unwrap()),
                }
            }
        }
        text.extend(p.finish());
        (text, frames)
    }

    #[test]
    fn splits_text_and_frames() {
        let (t, f) = run(&[b"hello\x1eIPPabc\x1f{\"t\":\"ready\"}\nworld"]);
        assert_eq!(t, b"helloworld");
        assert_eq!(f, vec![json!({"t": "ready"})]);
    }

    #[test]
    fn marker_split_across_chunks() {
        let (t, f) = run(&[b"x\x1eI", b"PPab", b"c\x1f{\"a\":", b"1}\n", b"y"]);
        assert_eq!(t, b"xy");
        assert_eq!(f, vec![json!({"a": 1})]);
    }

    #[test]
    fn lookalikes_are_text() {
        let (t, f) = run(&[b"\x1eIPPabd\x1f{}\n", b"\x1eIP"]);
        assert_eq!(t, b"\x1eIPPabd\x1f{}\n\x1eIP");
        assert!(f.is_empty());
    }

    #[test]
    fn many_frames_one_chunk() {
        let (t, f) = run(&[b"\x1eIPPabc\x1f1\n\x1eIPPabc\x1f2\nz\x1eIPPabc\x1f3\n"]);
        assert_eq!(t, b"z");
        assert_eq!(f, vec![json!(1), json!(2), json!(3)]);
    }

    #[test]
    fn bad_and_oversized_frames() {
        let mut p = FrameParser::new("n", 8);
        let got = p.push(b"\x1eIPPn\x1fnot json\n");
        assert!(matches!(&got[0], Piece::Frame(Err(_))));
        let got = p.push(b"\x1eIPPn\x1f[1,2,3,4,5,6,7]");
        assert!(matches!(&got[0], Piece::Frame(Err(e)) if e.contains("too large")));
    }

    #[test]
    fn frame_split_into_many_reads() {
        let mut p = FrameParser::new("n", 1 << 20);
        assert!(p.push(b"\x1eIPPn\x1f[").is_empty());
        for _ in 0..1000 {
            assert!(p.push(b"1,").is_empty());
        }
        let got = p.push(b"1]\nafter");
        assert!(matches!(&got[0], Piece::Frame(Ok(Value::Array(a))) if a.len() == 1001));
        assert_eq!(got[1], Piece::Text(b"after".to_vec()));
    }
}
