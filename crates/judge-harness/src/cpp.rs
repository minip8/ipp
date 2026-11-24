//! C++: keep every top-level item of the candidate's file in order, drop the definition of `main`,
//! append the generated harness (which supplies its own `main`).
//!
//! Translation unit layout (`main.cpp`), compiled with `-include ipp/support.h` (precompiled):
//!
//! ```text
//! #define main __ipp_user_main      // fallback in case tree-sitter missed a `main`
//! #line 1 "solution.cpp"
//! <candidate source, `main` blanked out with spaces so all positions are unchanged>
//! #line 1 "[harness]"
//! #undef <every macro the candidate defined>
//! <generated dispatch table + main>
//! ```

use crate::ts::{self, Arity, FoundMethod, blank, named_children, text};
use crate::verify::{ClassInfo, verify};
use crate::{Prepared, PreparedFile};
use ipp_judge_contracts::{Primitive, ProblemKind, ProblemSignature, Ty};
use std::collections::BTreeSet;
use tree_sitter::Node;

pub const SOLUTION_FILE: &str = "solution.cpp";
pub const HARNESS_FILE: &str = "[harness]";
pub const TU_FILE: &str = "main.cpp";
pub const USER_MAIN: &str = "__ipp_user_main";

fn lang() -> tree_sitter::Language {
    tree_sitter_cpp::LANGUAGE.into()
}

/// C++ spelling of a contract type (same table as `cppType` in contracts/src/scaffold.ts).
pub fn cpp_type(t: &Ty) -> String {
    match t {
        Ty::Array(i) | Ty::List(i) => format!("std::vector<{}>", cpp_type(i)),
        Ty::Prim(p) => match p {
            Primitive::Int => "int",
            Primitive::Long => "long long",
            Primitive::Double => "double",
            Primitive::Bool => "bool",
            Primitive::String => "std::string",
            Primitive::Char => "char",
            Primitive::Void => "void",
        }
        .to_string(),
    }
}

/// Nodes at namespace scope of the global namespace, looking through preprocessor conditionals
/// and `extern "C" { ... }` blocks.
/// Iterative (explicit stack, source order kept): conditionals can be nested arbitrarily deep.
fn top_level<'t>(root: Node<'t>) -> Vec<Node<'t>> {
    let mut out = Vec::new();
    // Children still to visit, last one on top.
    let mut stack: Vec<Node<'t>> = named_children(root).into_iter().rev().collect();
    while let Some(c) = stack.pop() {
        match c.kind() {
            "preproc_if" | "preproc_ifdef" | "preproc_else" | "preproc_elif"
            | "preproc_elifdef" => stack.extend(named_children(c).into_iter().rev()),
            "linkage_specification" => {
                if let Some(b) = c.child_by_field_name("body") {
                    if b.kind() == "declaration_list" {
                        stack.extend(named_children(b).into_iter().rev());
                    } else {
                        out.push(b);
                    }
                }
            }
            _ => out.push(c),
        }
    }
    out
}

/// Follows a declarator down to its function_declarator, if it declares a function.
fn function_declarator(mut n: Node) -> Option<Node> {
    for _ in 0..16 {
        match n.kind() {
            "function_declarator" => return Some(n),
            "reference_declarator"
            | "pointer_declarator"
            | "parenthesized_declarator"
            | "attributed_declarator" => {
                n = n
                    .child_by_field_name("declarator")
                    .or_else(|| named_children(n).into_iter().last())?;
            }
            _ => return None,
        }
    }
    None
}

fn function_name<'a>(fd: Node, src: &'a str) -> Option<(Option<&'a str>, &'a str)> {
    let d = fd.child_by_field_name("declarator")?;
    match d.kind() {
        "identifier" | "field_identifier" => Some((None, text(d, src))),
        "qualified_identifier" => {
            let scope = d.child_by_field_name("scope").map(|s| text(s, src));
            let name = d.child_by_field_name("name")?;
            Some((scope, text(name, src)))
        }
        _ => None,
    }
}

fn arity(fd: Node, src: &str) -> Arity {
    let Some(params) = fd.child_by_field_name("parameters") else {
        return Arity::exact(0);
    };
    let (mut min, mut max, mut variadic) = (0, 0, false);
    let all = ts::children(params);
    let named = named_children(params);
    if named.len() == 1
        && named[0].kind() == "parameter_declaration"
        && text(named[0], src).trim() == "void"
    {
        return Arity::exact(0);
    }
    for c in all {
        match c.kind() {
            "parameter_declaration" => {
                min += 1;
                max += 1;
            }
            "optional_parameter_declaration" => max += 1,
            "variadic_parameter_declaration" | "..." => variadic = true,
            _ => {}
        }
    }
    Arity {
        min,
        max: if variadic { None } else { Some(max) },
    }
}

fn class_name_of<'a>(n: Node, src: &'a str) -> Option<&'a str> {
    n.child_by_field_name("name").map(|x| text(x, src))
}

/// A class/struct definition (with body) named `name` among the top-level items.
fn find_class<'t>(items: &[Node<'t>], src: &str, name: &str) -> Option<Node<'t>> {
    for &it in items {
        let cand = match it.kind() {
            "class_specifier" | "struct_specifier" => Some(it),
            "declaration" | "type_definition" => it
                .child_by_field_name("type")
                .filter(|t| matches!(t.kind(), "class_specifier" | "struct_specifier")),
            _ => None,
        };
        if let Some(c) = cand
            && class_name_of(c, src) == Some(name)
            && c.child_by_field_name("body").is_some()
        {
            return Some(c);
        }
    }
    None
}

fn base_classes(class: Node, src: &str) -> Vec<String> {
    let mut out = Vec::new();
    for c in named_children(class) {
        if c.kind() == "base_class_clause" {
            for b in named_children(c) {
                if matches!(
                    b.kind(),
                    "type_identifier" | "qualified_type_identifier" | "template_type"
                ) {
                    out.push(text(b, src).to_string());
                }
            }
        }
    }
    out
}

fn collect_class(items: &[Node], src: &str, name: &str, depth: usize) -> Option<ClassInfo> {
    let class = find_class(items, src, name)?;
    let mut info = ClassInfo::default();
    let body = class.child_by_field_name("body")?;
    let mut members = Vec::new();
    for m in named_children(body) {
        match m.kind() {
            "template_declaration" => members.extend(named_children(m)),
            "preproc_if" | "preproc_ifdef" | "preproc_else" | "preproc_elif" => {
                members.extend(named_children(m))
            }
            _ => members.push(m),
        }
    }
    for m in members {
        let decl = match m.kind() {
            "function_definition" | "field_declaration" | "declaration" => {
                m.child_by_field_name("declarator")
            }
            _ => None,
        };
        let Some(fd) = decl.and_then(function_declarator) else {
            continue;
        };
        let Some((_, fname)) = function_name(fd, src) else {
            continue;
        };
        if fname == name {
            info.ctors.push(arity(fd, src));
        } else {
            info.methods.push(FoundMethod {
                name: fname.to_string(),
                arity: arity(fd, src),
            });
        }
    }
    // Out-of-class definitions: `int Solution::f(...) { ... }`.
    for &it in items {
        if it.kind() != "function_definition" {
            continue;
        }
        let Some(fd) = it
            .child_by_field_name("declarator")
            .and_then(function_declarator)
        else {
            continue;
        };
        if let Some((Some(scope), fname)) = function_name(fd, src)
            && scope == name
            && fname != name
            && !info.methods.iter().any(|x| x.name == fname)
        {
            info.methods.push(FoundMethod {
                name: fname.to_string(),
                arity: arity(fd, src),
            });
        }
    }
    for base in base_classes(class, src) {
        match (depth < 8)
            .then(|| collect_class(items, src, &base, depth + 1))
            .flatten()
        {
            Some(b) => {
                info.methods.extend(b.methods);
                info.open_ended |= b.open_ended;
            }
            None => info.open_ended = true,
        }
    }
    Some(info)
}

/// Every macro the file defines, at any depth. Iterative: candidate files can nest expressions
/// tens of thousands of levels deep, and recursion would overflow a worker thread's stack and
/// abort the whole judge.
fn collect_macros(root: Node, src: &str, out: &mut BTreeSet<String>) {
    let mut cursor = root.walk();
    loop {
        let n = cursor.node();
        if matches!(n.kind(), "preproc_def" | "preproc_function_def")
            && let Some(name) = n.child_by_field_name("name")
        {
            out.insert(text(name, src).to_string());
        }
        if cursor.goto_first_child() {
            continue;
        }
        loop {
            if cursor.goto_next_sibling() {
                break;
            }
            if !cursor.goto_parent() {
                return;
            }
        }
    }
}

fn is_main(n: Node, src: &str) -> bool {
    if n.kind() != "function_definition" {
        return false;
    }
    let Some(fd) = n
        .child_by_field_name("declarator")
        .and_then(function_declarator)
    else {
        return false;
    };
    matches!(function_name(fd, src), Some((None, "main")))
}

/// Builds the translation unit for tests mode, or the `invalid_submission` message.
pub fn prepare_tests(source: &str, sig: &ProblemSignature) -> Result<Prepared, String> {
    let tree = ts::parse(lang(), source);
    let root = tree.root_node();
    let items = top_level(root);

    match collect_class(&items, source, &sig.class_name, 0) {
        Some(info) => verify(sig, &info)?,
        // tree-sitter-cpp does not understand every macro trick; when the file does not parse
        // cleanly let the compiler have the final word instead of rejecting it.
        None if root.has_error() => {}
        None => {
            return Err(format!(
                "class `{}` not found: the tests call `{}`, so the file must define it",
                sig.class_name, sig.class_name
            ));
        }
    }

    let mut body = source.as_bytes().to_vec();
    for it in &items {
        if is_main(*it, source) {
            blank(&mut body, it.byte_range());
        }
    }
    let mut macros = BTreeSet::new();
    collect_macros(root, source, &mut macros);

    let mut tu = String::with_capacity(source.len() + 2048);
    tu.push_str(&format!(
        "#define main {USER_MAIN}\n#line 1 \"{SOLUTION_FILE}\"\n"
    ));
    tu.push_str(&String::from_utf8_lossy(&body));
    if !tu.ends_with('\n') {
        tu.push('\n');
    }
    tu.push_str(&format!("#line 1 \"{HARNESS_FILE}\"\n"));
    tu.push_str(&harness(sig, &macros));
    Ok(Prepared {
        files: vec![(TU_FILE.to_string(), tu.into_bytes())],
        class_ref: sig.class_name.clone(),
    })
}

fn harness(sig: &ProblemSignature, macros: &BTreeSet<String>) -> String {
    let mut h = String::new();
    for m in macros {
        h.push_str(&format!("#undef {m}\n"));
    }
    h.push_str("#undef main\n");
    h.push_str("namespace __ipp_gen {\n");
    h.push_str(&format!("using C = ::{};\n", sig.class_name));
    let params: &[ipp_judge_contracts::Param] = if sig.kind == ProblemKind::Design {
        &sig.ctor_params
    } else {
        &[]
    };
    h.push_str("static void* make(const std::vector<::__ipp::Json>& a, double& ms) {\n");
    h.push_str(&format!(
        "    if (a.size() != {0}) throw ::__ipp::BadInput(\"expected {0} constructor argument(s)\");\n",
        params.len()
    ));
    let mut names = Vec::new();
    for (i, p) in params.iter().enumerate() {
        h.push_str(&format!(
            "    auto a{i} = ::__ipp::from_json<{}>(a[{i}]);\n",
            cpp_type(&p.ty)
        ));
        names.push(format!("a{i}"));
    }
    h.push_str("    auto t0 = ::__ipp::Clock::now();\n");
    h.push_str(&format!("    C* obj = new C({});\n", names.join(", ")));
    h.push_str("    ms += ::__ipp::ms_since(t0);\n    return obj;\n}\n");
    h.push_str("static void destroy(void* p) { delete static_cast<C*>(p); }\n");
    h.push_str(
        "static ::__ipp::CallOut call(void* p, const std::string& m, const std::vector<::__ipp::Json>& a) {\n    C& o = *static_cast<C*>(p);\n",
    );
    for m in &sig.methods {
        h.push_str(&format!(
            "    if (m == \"{0}\") return ::__ipp::invoke(o, &C::{0}, a);\n",
            m.name
        ));
    }
    h.push_str("    throw ::__ipp::BadInput(\"unknown method \" + m);\n}\n");
    h.push_str("}  // namespace __ipp_gen\n");
    h.push_str("int main() { return ::__ipp::run_loop({__ipp_gen::make, __ipp_gen::destroy, __ipp_gen::call}); }\n");
    h
}

pub fn prepare_file(source: &str) -> PreparedFile {
    PreparedFile {
        files: vec![(SOLUTION_FILE.to_string(), source.as_bytes().to_vec())],
        entry: SOLUTION_FILE.to_string(),
        use_stdcxx_pch: source.contains("bits/stdc++.h"),
    }
}

/// Compiler output as the candidate may see it: diagnostics located in the harness or the
/// driver support header lose their location and source snippet; `__ipp_user_main` reads `main`.
pub fn rewrite_diagnostics(output: &str) -> String {
    // GCC names the force-included header "support.h" or by its full path, depending on context.
    let hidden = [
        HARNESS_FILE,
        "/opt/ipp/include/ipp/support.h",
        "ipp/support.h",
        "support.h",
        "<command-line>",
    ];
    let mut out = String::new();
    let mut suppress = false;
    let mut harness_errors = false;
    for line in output.lines() {
        let snippet = line.starts_with(' ')
            || line.starts_with('\t')
            || line.starts_with('|')
            || line
                .trim_start_matches(|c: char| c.is_ascii_digit())
                .starts_with(" |");
        if snippet {
            if !suppress {
                out.push_str(line);
                out.push('\n');
            }
            continue;
        }
        if let Some(h) = hidden.iter().find(|h| line.contains(**h)) {
            suppress = true;
            if line.contains("error") {
                harness_errors = true;
            }
            // "[harness]:12:5: error: ..." -> "[test harness]: error: ..."
            let rest = line.split_once(h).map(|(_, r)| r).unwrap_or("");
            let rest = rest.trim_start_matches(|c: char| c == ':' || c.is_ascii_digit());
            if line.starts_with("In file included from") || rest.trim().is_empty() {
                continue;
            }
            out.push_str("[test harness]: ");
            out.push_str(rest.trim_start());
            out.push('\n');
            continue;
        }
        suppress = false;
        out.push_str(line);
        out.push('\n');
    }
    let mut out = out.replace(USER_MAIN, "main");
    if harness_errors {
        out.push_str(
            "note: the test harness could not call your class; check the class name, method names, \
             parameter and return types against the problem's signature\n",
        );
    }
    out
}
