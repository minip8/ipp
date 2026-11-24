//! Python: keep imports, class and function definitions and top-level assignments; blank out
//! `if __name__ == "__main__":` blocks and every other top-level statement with side effects.
//! Blanking (spaces, newlines kept) means line numbers in tracebacks are the candidate's own.
//! The fixed driver (`infra/sandbox/python/driver.py`) loads the result as `solution.py`.

use crate::ts::{self, Arity, FoundMethod, blank, named_children, text};
use crate::verify::{ClassInfo, verify};
use crate::{Prepared, PreparedFile};
use ipp_judge_contracts::ProblemSignature;
use tree_sitter::Node;

pub const SOLUTION_FILE: &str = "solution.py";
pub const MAIN_FILE: &str = "main.py";

fn lang() -> tree_sitter::Language {
    tree_sitter_python::LANGUAGE.into()
}

/// Statements that only define things.
fn is_definition(n: Node, src: &str) -> bool {
    match n.kind() {
        "import_statement"
        | "import_from_statement"
        | "future_import_statement"
        | "class_definition"
        | "function_definition"
        | "decorated_definition"
        | "type_alias_statement"
        | "pass_statement" => true,
        "expression_statement" => named_children(n).iter().all(|c| match c.kind() {
            "assignment" | "augmented_assignment" => true,
            // docstring
            "string" | "concatenated_string" => true,
            // `sys.setrecursionlimit(...)` is configuration, not a side effect worth dropping
            "call" => c
                .child_by_field_name("function")
                .is_some_and(|f| text(f, src).ends_with("setrecursionlimit")),
            _ => false,
        }),
        // `try: import x` / `except ImportError: ...`
        "try_statement" => named_children(n).iter().all(|c| match c.kind() {
            "block" => named_children(*c)
                .iter()
                .all(|s| is_definition(*s, src) || s.kind() == "comment"),
            "except_clause" | "else_clause" | "finally_clause" => named_children(*c)
                .iter()
                .filter(|s| s.kind() == "block")
                .all(|b| {
                    named_children(*b)
                        .iter()
                        .all(|s| is_definition(*s, src) || s.kind() == "comment")
                }),
            "comment" => true,
            _ => false,
        }),
        _ => false,
    }
}

fn definition_of(n: Node) -> Node {
    if n.kind() == "decorated_definition" {
        n.child_by_field_name("definition").unwrap_or(n)
    } else {
        n
    }
}

fn decorators<'a>(n: Node, src: &'a str) -> Vec<&'a str> {
    if n.kind() != "decorated_definition" {
        return vec![];
    }
    named_children(n)
        .into_iter()
        .filter(|c| c.kind() == "decorator")
        .map(|c| text(c, src).trim_start_matches('@').trim())
        .collect()
}

fn arity(params: Node, skip_first: bool) -> Arity {
    let (mut min, mut max, mut variadic) = (0usize, 0usize, false);
    let mut keyword_only = false;
    for p in named_children(params) {
        let kind = match p.kind() {
            "typed_parameter" => {
                let inner = named_children(p).into_iter().next();
                match inner.map(|i| i.kind()) {
                    Some("list_splat_pattern") => "list_splat_pattern",
                    Some("dictionary_splat_pattern") => "dictionary_splat_pattern",
                    _ => "identifier",
                }
            }
            k => k,
        };
        match kind {
            "identifier" if !keyword_only => {
                min += 1;
                max += 1;
            }
            "default_parameter" | "typed_default_parameter" if !keyword_only => max += 1,
            "list_splat_pattern" => {
                variadic = true;
                keyword_only = true;
            }
            "keyword_separator" => keyword_only = true,
            _ => {}
        }
    }
    if skip_first {
        min = min.saturating_sub(1);
        max = max.saturating_sub(1);
    }
    Arity {
        min,
        max: if variadic { None } else { Some(max) },
    }
}

fn find_class<'t>(module: Node<'t>, src: &str, name: &str) -> Option<Node<'t>> {
    named_children(module)
        .into_iter()
        .map(definition_of)
        .find(|d| {
            d.kind() == "class_definition"
                && d.child_by_field_name("name")
                    .is_some_and(|n| text(n, src) == name)
        })
}

fn collect_class(module: Node, src: &str, name: &str, depth: usize) -> Option<ClassInfo> {
    let class = find_class(module, src, name)?;
    let mut info = ClassInfo::default();
    if let Some(body) = class.child_by_field_name("body") {
        for item in named_children(body) {
            let def = definition_of(item);
            match def.kind() {
                "function_definition" => {
                    let Some(n) = def.child_by_field_name("name") else {
                        continue;
                    };
                    let decs = decorators(item, src);
                    let is_static = decs.contains(&"staticmethod");
                    let a = def
                        .child_by_field_name("parameters")
                        .map(|p| arity(p, !is_static))
                        .unwrap_or(Arity::any());
                    let fname = text(n, src);
                    if fname == "__init__" {
                        info.ctors.push(a);
                    } else if decs
                        .iter()
                        .any(|d| d.ends_with(".setter") || d.ends_with(".deleter"))
                    {
                        // property accessors are not callable methods
                    } else {
                        info.methods.push(FoundMethod {
                            name: fname.to_string(),
                            arity: a,
                        });
                    }
                }
                "expression_statement" => {
                    // `twoSum = helper` in the class body: callable, arity unknown
                    for a in named_children(def) {
                        if a.kind() == "assignment"
                            && let Some(l) = a.child_by_field_name("left")
                            && l.kind() == "identifier"
                        {
                            info.methods.push(FoundMethod {
                                name: text(l, src).to_string(),
                                arity: Arity::any(),
                            });
                        }
                    }
                }
                _ => {}
            }
        }
    }
    if let Some(bases) = class.child_by_field_name("superclasses") {
        for b in named_children(bases) {
            if b.kind() == "keyword_argument" {
                continue; // metaclass=...
            }
            let bname = text(b, src);
            if bname == "object" {
                continue;
            }
            match (depth < 8 && b.kind() == "identifier")
                .then(|| collect_class(module, src, bname, depth + 1))
                .flatten()
            {
                Some(base) => {
                    info.methods.extend(base.methods);
                    if info.ctors.is_empty() {
                        info.ctors = base.ctors;
                    }
                    info.open_ended |= base.open_ended;
                }
                None => info.open_ended = true,
            }
        }
    }
    Some(info)
}

pub fn prepare_tests(source: &str, sig: &ProblemSignature) -> Result<Prepared, String> {
    let tree = ts::parse(lang(), source);
    let root = tree.root_node();
    if root.has_error() {
        // Python itself reports the syntax error (as a compile error, with the right line).
        // Nothing runs before compile() succeeds, so passing the file through unfiltered is safe;
        // the driver also never runs it as __main__.
        return Ok(Prepared {
            files: vec![(SOLUTION_FILE.to_string(), source.as_bytes().to_vec())],
            class_ref: sig.class_name.clone(),
        });
    }
    match collect_class(root, source, &sig.class_name, 0) {
        Some(info) => verify(sig, &info)?,
        None => {
            return Err(format!(
                "class `{}` not found: the tests call `{}`, so the file must define it at the top level",
                sig.class_name, sig.class_name
            ));
        }
    }
    let mut body = source.as_bytes().to_vec();
    for stmt in named_children(root) {
        if stmt.kind() == "comment" || is_definition(stmt, source) {
            continue;
        }
        blank(&mut body, stmt.byte_range());
    }
    Ok(Prepared {
        files: vec![(SOLUTION_FILE.to_string(), body)],
        class_ref: sig.class_name.clone(),
    })
}

pub fn prepare_file(source: &str) -> PreparedFile {
    PreparedFile {
        files: vec![(MAIN_FILE.to_string(), source.as_bytes().to_vec())],
        entry: MAIN_FILE.to_string(),
        use_stdcxx_pch: false,
    }
}
