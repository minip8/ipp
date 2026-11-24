//! Checking the candidate's class against the problem signature (by name and arity).

use crate::ts::{Arity, FoundMethod, plural};
use ipp_judge_contracts::{ProblemKind, ProblemSignature};

#[derive(Debug, Clone, Default)]
pub struct ClassInfo {
    pub methods: Vec<FoundMethod>,
    /// Arity of every declared constructor; empty = only the implicit default constructor.
    pub ctors: Vec<Arity>,
    /// The class inherits from something we could not inspect, so a missing method or
    /// constructor might be inherited: do not reject on absence.
    pub open_ended: bool,
}

pub fn verify(sig: &ProblemSignature, class: &ClassInfo) -> Result<(), String> {
    let cls = &sig.class_name;
    let want_ctor = if sig.kind == ProblemKind::Design {
        sig.ctor_params.len()
    } else {
        0
    };
    let ctor_ok = if class.ctors.is_empty() {
        want_ctor == 0 || class.open_ended
    } else {
        class.ctors.iter().any(|a| a.accepts(want_ctor)) || class.open_ended
    };
    if !ctor_ok {
        return Err(if want_ctor == 0 {
            format!("class `{cls}` needs a constructor that takes no arguments")
        } else {
            format!(
                "class `{cls}` has no constructor taking {want_ctor} argument{} (the tests construct it as `{cls}({})`)",
                plural(want_ctor),
                sig.ctor_params
                    .iter()
                    .map(|p| p.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        });
    }
    for m in &sig.methods {
        let found: Vec<&FoundMethod> = class.methods.iter().filter(|f| f.name == m.name).collect();
        let n = m.params.len();
        if found.is_empty() {
            if class.open_ended {
                continue;
            }
            return Err(format!("class `{cls}` has no method `{}`", m.name));
        }
        if !found.iter().any(|f| f.arity.accepts(n)) {
            let has = found[0].arity;
            return Err(format!(
                "method `{}` of class `{cls}` takes {} parameter{}, but the problem calls it with {n} ({})",
                m.name,
                has.describe(),
                if has.min == 1 && has.max == Some(1) {
                    ""
                } else {
                    "s"
                },
                m.params
                    .iter()
                    .map(|p| p.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
    }
    Ok(())
}
