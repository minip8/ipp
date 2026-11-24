//! Result comparison: a line-by-line port of `packages/content/src/compare.ts` (the reference
//! semantics), including its JavaScript number behaviour. Keep the two in step.

use crate::Compare;
use serde_json::Value;

const EPS: f64 = 1e-6;

fn as_js_number(v: &Value) -> Option<f64> {
    v.as_f64()
}

fn is_js_integer(x: f64) -> bool {
    x.is_finite() && x.trunc() == x
}

fn numbers_equal(a: f64, b: f64) -> bool {
    if is_js_integer(a) && is_js_integer(b) {
        return a == b;
    }
    let diff = (a - b).abs();
    diff <= EPS || diff <= EPS * a.abs().max(b.abs())
}

/// `Number.prototype.toString` / `JSON.stringify` for a finite number.
pub fn js_number_string(x: f64) -> String {
    if !x.is_finite() {
        return "null".into();
    }
    if x == 0.0 {
        return "0".into();
    }
    let neg = x < 0.0;
    // Rust's `{:e}` prints the shortest digits that round-trip, like ECMAScript's algorithm.
    let e = format!("{:e}", x.abs());
    let (mantissa, exp) = e.split_once('e').expect("exponent");
    let exp: i32 = exp.parse().expect("exponent");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n = exp + 1;
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let sign = if n > 0 { '+' } else { '-' };
        let e = (n - 1).abs();
        if k == 1 {
            format!("{digits}e{sign}{e}")
        } else {
            format!("{}.{}e{sign}{e}", &digits[..1], &digits[1..])
        }
    };
    if neg { format!("-{body}") } else { body }
}

/// `JSON.stringify` for the values that can appear in results.
fn js_stringify(v: &Value) -> String {
    match v {
        Value::Number(n) => js_number_string(n.as_f64().unwrap_or(f64::NAN)),
        Value::Array(a) => format!(
            "[{}]",
            a.iter().map(js_stringify).collect::<Vec<_>>().join(",")
        ),
        _ => serde_json::to_string(v).unwrap_or_default(),
    }
}

fn canonical(v: &Value, deep: bool) -> String {
    match v {
        Value::Array(a) => {
            let mut parts: Vec<String> = a.iter().map(|x| canonical(x, deep)).collect();
            if deep {
                parts.sort();
            }
            format!("[{}]", parts.join(","))
        }
        _ => js_stringify(v),
    }
}

fn exact(a: &Value, b: &Value) -> bool {
    if let (Some(x), Some(y)) = (as_js_number(a), as_js_number(b)) {
        return numbers_equal(x, y);
    }
    match (a, b) {
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| exact(p, q))
        }
        // `===`: objects are compared by reference in the reference implementation, so never equal.
        (Value::Object(_), _) | (_, Value::Object(_)) => false,
        (Value::Array(_), _) | (_, Value::Array(_)) => false,
        _ => a == b,
    }
}

pub fn results_equal(actual: &Value, expected: &Value, mode: Compare) -> bool {
    if mode == Compare::Exact {
        return exact(actual, expected);
    }
    let (Value::Array(a), Value::Array(e)) = (actual, expected) else {
        return exact(actual, expected);
    };
    if a.len() != e.len() {
        return false;
    }
    let deep = mode == Compare::UnorderedDeep;
    let mut ka: Vec<String> = a.iter().map(|v| canonical(v, deep)).collect();
    let mut ke: Vec<String> = e.iter().map(|v| canonical(v, deep)).collect();
    ka.sort();
    ke.sort();
    ka == ke
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn js_numbers() {
        let cases: &[(f64, &str)] = &[
            (1.0, "1"),
            (-0.0, "0"),
            (0.1, "0.1"),
            (0.1 + 0.2, "0.30000000000000004"),
            (123456789.0, "123456789"),
            (1e21, "1e+21"),
            (1.5e21, "1.5e+21"),
            (1e20, "100000000000000000000"),
            (1e-6, "0.000001"),
            (1e-7, "1e-7"),
            (1.25e-7, "1.25e-7"),
            (-2.5, "-2.5"),
            (9007199254740993.0, "9007199254740992"),
        ];
        for (x, s) in cases {
            assert_eq!(js_number_string(*x), *s, "{x}");
        }
    }

    #[test]
    fn exact_mode() {
        assert!(results_equal(
            &json!([0, 1]),
            &json!([0, 1]),
            Compare::Exact
        ));
        assert!(!results_equal(
            &json!([1, 0]),
            &json!([0, 1]),
            Compare::Exact
        ));
        assert!(results_equal(&json!(2.0), &json!(2), Compare::Exact));
        assert!(results_equal(
            &json!(0.1 + 0.2),
            &json!(0.3),
            Compare::Exact
        ));
        assert!(results_equal(&json!(1e-7), &json!(0), Compare::Exact));
        // both integers: compared exactly, like Number.isInteger in the reference
        assert!(!results_equal(
            &json!(1000000.0),
            &json!(1000001),
            Compare::Exact
        ));
        assert!(results_equal(
            &json!(1000000.5),
            &json!(1000000.5000001),
            Compare::Exact
        ));
        assert!(!results_equal(&json!(1.5), &json!(1.6), Compare::Exact));
        assert!(results_equal(&json!(null), &json!(null), Compare::Exact));
        assert!(!results_equal(&json!(null), &json!(0), Compare::Exact));
        assert!(!results_equal(&json!("1"), &json!(1), Compare::Exact));
        assert!(results_equal(
            &json!("héllo\n"),
            &json!("héllo\n"),
            Compare::Exact
        ));
        assert!(results_equal(&json!(true), &json!(true), Compare::Exact));
        assert!(!results_equal(
            &json!([1, 2]),
            &json!([1, 2, 3]),
            Compare::Exact
        ));
        assert!(results_equal(
            &json!([[1.0], [2]]),
            &json!([[1], [2.0000000001]]),
            Compare::Exact
        ));
        assert!(!results_equal(
            &json!({"a": 1}),
            &json!({"a": 1}),
            Compare::Exact
        ));
    }

    #[test]
    fn unordered_modes() {
        assert!(results_equal(
            &json!([1, 0]),
            &json!([0, 1]),
            Compare::Unordered
        ));
        assert!(!results_equal(
            &json!([1, 1]),
            &json!([0, 1]),
            Compare::Unordered
        ));
        assert!(results_equal(
            &json!([1.0, 2]),
            &json!([2, 1]),
            Compare::Unordered
        ));
        assert!(results_equal(
            &json!([[1, 2], [3]]),
            &json!([[3], [1, 2]]),
            Compare::Unordered
        ));
        assert!(!results_equal(
            &json!([[2, 1], [3]]),
            &json!([[3], [1, 2]]),
            Compare::Unordered
        ));
        assert!(results_equal(
            &json!([[2, 1], [3]]),
            &json!([[3], [1, 2]]),
            Compare::UnorderedDeep
        ));
        assert!(results_equal(
            &json!([[-1, 0, 1], [-1, -1, 2]]),
            &json!([[-1, 2, -1], [1, 0, -1]]),
            Compare::UnorderedDeep
        ));
        assert!(!results_equal(
            &json!([[1, 1], [2]]),
            &json!([[1], [1, 2]]),
            Compare::UnorderedDeep
        ));
        // non-arrays fall back to exact
        assert!(results_equal(&json!(3), &json!(3.0), Compare::Unordered));
        assert!(!results_equal(
            &json!([1]),
            &json!([1, 1]),
            Compare::Unordered
        ));
        assert!(results_equal(
            &json!(["b", "a"]),
            &json!(["a", "b"]),
            Compare::Unordered
        ));
    }
}
