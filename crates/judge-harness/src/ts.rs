//! Small tree-sitter helpers shared by the language extractors.

use tree_sitter::{Language, Node, Parser, Tree};

pub fn parse(lang: Language, src: &str) -> Tree {
    let mut p = Parser::new();
    p.set_language(&lang)
        .expect("tree-sitter grammar ABI matches the runtime");
    p.parse(src, None)
        .expect("parse without timeout or cancellation")
}

pub fn text<'a>(n: Node, src: &'a str) -> &'a str {
    &src[n.byte_range()]
}

pub fn named_children(n: Node) -> Vec<Node> {
    let mut c = n.walk();
    n.named_children(&mut c).collect()
}

pub fn children(n: Node) -> Vec<Node> {
    let mut c = n.walk();
    n.children(&mut c).collect()
}

/// Overwrites a byte range with spaces, keeping newlines, so every line and column that follows
/// stays where it was (compiler diagnostics then point at the candidate's own positions).
pub fn blank(buf: &mut [u8], range: std::ops::Range<usize>) {
    for b in &mut buf[range] {
        if *b != b'\n' && *b != b'\r' {
            *b = b' ';
        }
    }
}

/// How many arguments a method accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Arity {
    pub min: usize,
    /// None = variadic
    pub max: Option<usize>,
}

impl Arity {
    pub fn exact(n: usize) -> Self {
        Arity {
            min: n,
            max: Some(n),
        }
    }
    pub fn any() -> Self {
        Arity { min: 0, max: None }
    }
    pub fn accepts(&self, n: usize) -> bool {
        n >= self.min && self.max.is_none_or(|m| n <= m)
    }
    pub fn describe(&self) -> String {
        match self.max {
            Some(m) if m == self.min => format!("{m}"),
            Some(m) => format!("{}..{m}", self.min),
            None => format!("{} or more", self.min),
        }
    }
}

/// A method found in the candidate's class.
#[derive(Debug, Clone)]
pub struct FoundMethod {
    pub name: String,
    pub arity: Arity,
}

pub fn plural(n: usize) -> &'static str {
    if n == 1 { "" } else { "s" }
}
