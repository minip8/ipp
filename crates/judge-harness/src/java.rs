//! Java: keep imports and every top-level type, with `public` removed from top-level types (and the
//! package declaration removed) so the file compiles as `Main.java` in the default package.
//! Removed tokens are replaced by spaces, so javac's line and column numbers are the candidate's.
//! The fixed driver (`infra/sandbox/java/IppDriver.java`) calls the class by reflection, so it
//! never needs compiling with the candidate's code and its source cannot leak into diagnostics.

use crate::ts::{self, Arity, FoundMethod, blank, children, named_children, text};
use crate::verify::{ClassInfo, verify};
use crate::{Prepared, PreparedFile};
use ipp_judge_contracts::ProblemSignature;
use tree_sitter::Node;

pub const SOLUTION_FILE: &str = "Main.java";
const TYPE_DECLS: &[&str] = &[
    "class_declaration",
    "interface_declaration",
    "enum_declaration",
    "record_declaration",
    "annotation_type_declaration",
];

fn lang() -> tree_sitter::Language {
    tree_sitter_java::LANGUAGE.into()
}

fn name_of<'a>(n: Node, src: &'a str) -> Option<&'a str> {
    n.child_by_field_name("name").map(|x| text(x, src))
}

fn modifiers(n: Node) -> Option<Node> {
    named_children(n)
        .into_iter()
        .find(|c| c.kind() == "modifiers")
}

fn has_modifier(n: Node, src: &str, m: &str) -> bool {
    modifiers(n).is_some_and(|ms| children(ms).iter().any(|c| text(*c, src) == m))
}

fn arity(params: Option<Node>) -> Arity {
    let Some(params) = params else {
        return Arity::exact(0);
    };
    let mut n = 0;
    let mut variadic = false;
    for p in named_children(params) {
        match p.kind() {
            "formal_parameter" => n += 1,
            "spread_parameter" => variadic = true,
            _ => {}
        }
    }
    if variadic {
        Arity { min: n, max: None }
    } else {
        Arity::exact(n)
    }
}

/// A class named `name`: top level, or nested (then returned with its binary name `Outer$Inner`
/// and whether it is static).
fn find_class<'t>(root: Node<'t>, src: &str, name: &str) -> Option<(Node<'t>, String, bool)> {
    fn search<'t>(
        n: Node<'t>,
        src: &str,
        name: &str,
        prefix: &str,
        depth: usize,
    ) -> Option<(Node<'t>, String, bool)> {
        let top = depth == 0;
        for c in named_children(n) {
            if !TYPE_DECLS.contains(&c.kind()) {
                continue;
            }
            let Some(cname) = name_of(c, src) else {
                continue;
            };
            let binary = if prefix.is_empty() {
                cname.to_string()
            } else {
                format!("{prefix}${cname}")
            };
            if cname == name && c.kind() == "class_declaration" {
                let is_static = top || has_modifier(c, src, "static");
                return Some((c, binary, is_static));
            }
            // Bounded: nesting is unlimited in a candidate file, recursion is not.
            if depth < 16
                && let Some(body) = c.child_by_field_name("body")
                && let Some(found) = search(body, src, name, &binary, depth + 1)
            {
                return Some(found);
            }
        }
        None
    }
    search(root, src, name, "", 0)
}

fn collect_class(
    root: Node,
    src: &str,
    name: &str,
    depth: usize,
) -> Option<(ClassInfo, String, bool)> {
    let (class, binary, is_static) = find_class(root, src, name)?;
    let mut info = ClassInfo::default();
    if let Some(body) = class.child_by_field_name("body") {
        for m in named_children(body) {
            match m.kind() {
                "method_declaration" => {
                    if let Some(n) = name_of(m, src) {
                        let a = arity(m.child_by_field_name("parameters"));
                        info.methods.push(FoundMethod {
                            name: n.to_string(),
                            arity: a,
                        });
                    }
                }
                "constructor_declaration" => {
                    info.ctors.push(arity(m.child_by_field_name("parameters")))
                }
                _ => {}
            }
        }
    }
    if let Some(sup) = class.child_by_field_name("superclass") {
        let base = named_children(sup)
            .into_iter()
            .next()
            .map(|t| text(t, src).to_string());
        match base.and_then(|b| {
            (depth < 8)
                .then(|| collect_class(root, src, &b, depth + 1))
                .flatten()
        }) {
            Some((b, _, _)) => {
                info.methods.extend(b.methods);
                info.open_ended |= b.open_ended;
            }
            None => info.open_ended = true,
        }
    }
    Some((info, binary, is_static))
}

/// Blanks `package ...;` and the `public` modifier of top-level types.
fn strip(source: &str, root: Node) -> Vec<u8> {
    let mut body = source.as_bytes().to_vec();
    for c in named_children(root) {
        if c.kind() == "package_declaration" {
            blank(&mut body, c.byte_range());
        }
        if TYPE_DECLS.contains(&c.kind())
            && let Some(ms) = modifiers(c)
        {
            for t in children(ms) {
                if text(t, source) == "public" {
                    blank(&mut body, t.byte_range());
                }
            }
        }
    }
    body
}

pub fn prepare_tests(source: &str, sig: &ProblemSignature) -> Result<Prepared, String> {
    let tree = ts::parse(lang(), source);
    let root = tree.root_node();
    let class_ref = match collect_class(root, source, &sig.class_name, 0) {
        Some((info, binary, is_static)) => {
            if !is_static {
                return Err(format!(
                    "class `{}` is an inner (non-static) class; make it a top-level class or declare it `static`",
                    sig.class_name
                ));
            }
            verify(sig, &info)?;
            binary
        }
        None if root.has_error() => sig.class_name.clone(), // let javac explain
        None => {
            return Err(format!(
                "class `{}` not found: the tests call `{}`, so the file must define it",
                sig.class_name, sig.class_name
            ));
        }
    };
    Ok(Prepared {
        files: vec![(SOLUTION_FILE.to_string(), strip(source, root))],
        class_ref,
    })
}

/// File mode: javac needs the file named after its public top-level type, and `java` needs the
/// class that declares `main`.
pub fn prepare_file(source: &str) -> PreparedFile {
    let tree = ts::parse(lang(), source);
    let root = tree.root_node();
    let mut public_type = None;
    let mut main_classes: Vec<(bool, String)> = Vec::new();
    for c in named_children(root) {
        if !TYPE_DECLS.contains(&c.kind()) {
            continue;
        }
        let Some(name) = name_of(c, source) else {
            continue;
        };
        let public = has_modifier(c, source, "public");
        if public && public_type.is_none() {
            public_type = Some(name.to_string());
        }
        let has_main = c.child_by_field_name("body").is_some_and(|b| {
            named_children(b)
                .iter()
                .any(|m| m.kind() == "method_declaration" && name_of(*m, source) == Some("main"))
        });
        if has_main {
            main_classes.push((public, name.to_string()));
        }
    }
    // A name too long for a file name (255 bytes) would fail to unpack as an internal error;
    // as Main.java javac reports it as an ordinary compile error instead.
    let file_stem = public_type
        .clone()
        .filter(|n| n.len() <= 200)
        .unwrap_or_else(|| "Main".to_string());
    // Prefer the public class with main, then any class with main, then (Java 25 compact source
    // files: top-level `void main()`) the implicit class named after the file.
    main_classes.sort_by_key(|(public, _)| !*public);
    let main_class = main_classes
        .first()
        .map(|(_, n)| n.clone())
        .unwrap_or_else(|| file_stem.clone());
    PreparedFile {
        files: vec![(format!("{file_stem}.java"), source.as_bytes().to_vec())],
        entry: main_class,
        use_stdcxx_pch: false,
    }
}

/// javac echoes the offending source line; show the candidate's original line rather than the one
/// with `public` blanked out.
pub fn rewrite_diagnostics(output: &str, original: &str) -> String {
    let lines: Vec<&str> = original.lines().collect();
    let mut out = String::new();
    let mut replace_next: Option<usize> = None;
    for line in output.lines() {
        if let Some(n) = replace_next.take()
            && let Some(orig) = lines.get(n.wrapping_sub(1))
        {
            out.push_str(orig);
            out.push('\n');
            continue;
        }
        if let Some(rest) = line.strip_prefix(&format!("{SOLUTION_FILE}:"))
            && let Some((num, _)) = rest.split_once(':')
            && let Ok(n) = num.parse::<usize>()
        {
            replace_next = Some(n);
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}
