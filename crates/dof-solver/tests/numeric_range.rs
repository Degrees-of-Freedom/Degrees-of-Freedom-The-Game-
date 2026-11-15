//! Numeric range and request budgets: the cases the OpenSees service guards
//! against (Tal's `test_numeric_range.py`), and a work limit shared across
//! a whole request. Every outcome must be an explicit result: never a NaN,
//! never a valid result that was not verified.

mod common;
use common::*;
use dof_solver::json::Json;
use dof_solver::model::*;

fn codes(r: &Run) -> Vec<String> {
    r.at(&["analysis", "reasonCodes"]).as_array().unwrap().iter().map(|c| c.as_str().unwrap().to_string()).collect()
}

fn invalid_with(r: &Run, code: &str) {
    assert_eq!(r.at(&["analysis", "status"]).as_str(), Some("invalid"), "{}", r.0.to_json_string());
    assert!(codes(r).contains(&code.to_string()), "expected {code}: {:?}", codes(r));
    assert!(r.at(&["components"]).as_array().unwrap().is_empty());
}

/// A fixed base node with only point loads on it.
fn loaded_base(values: &[f64], component: usize, fidelity: Fidelity) -> Build {
    let mut b = Build::new();
    b.options.fidelity = fidelity;
    b.node("base", [0.0; 3]).node("tip", [1.0, 0.0, 0.0]);
    b.beam("m", "base", "tip");
    b.support("base", FIXED);
    for v in values {
        let mut action = [0.0; 6];
        action[component] = *v;
        let id = format!("l{}", b.model.loads.len());
        b.model.loads.push(Load { id, node_id: "base".into(), force: [action[0], action[1], action[2]], moment: [action[3], action[4], action[5]] });
    }
    b
}

#[test]
fn finite_loads_whose_total_overflows_are_rejected() {
    for fidelity in [Fidelity::Linear, Fidelity::Nonlinear] {
        for component in [0, 5] {
            invalid_with(&loaded_base(&[1e308, 1e308], component, fidelity).run(), "numericRange");
        }
    }
}

#[test]
fn cancelling_extreme_loads_keep_their_small_remainder() {
    for values in [vec![1e308, 3.0, -1e308], vec![1e308, 1e308, 3.0, -1e308, -1e308]] {
        let r = loaded_base(&values, 4, Fidelity::Linear).run();
        assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
        // The base reacts the 3 N·m moment that is left, exactly.
        assert_eq!(r.reaction("base"), [0.0, 0.0, 0.0, 0.0, -3.0, 0.0]);
    }
    assert_eq!(exact_sum(&[1e308, 1e308, 3.0, -1e308, -1e308]), 3.0);
    // The exact sum of the three doubles, which plain addition rounds away.
    assert_eq!(exact_sum(&[0.1, 0.2, -0.3]), 2.7755575615628914e-17);
    assert_eq!(exact_sum(&[1e308, 1e308]), f64::INFINITY);
}

#[test]
fn a_span_whose_square_overflows_is_rejected() {
    for fidelity in [Fidelity::Linear, Fidelity::Nonlinear] {
        let mut b = Build::new();
        b.options.fidelity = fidelity;
        b.node("a", [-1e200, 0.0, 0.0]).node("b", [1e200, 0.0, 0.0]);
        b.beam("m", "a", "b");
        b.support("a", FIXED);
        invalid_with(&b.run(), "numericRange");
    }
}

#[test]
fn subdivision_stations_that_would_coincide_are_rejected() {
    let mut b = Build::new();
    b.options.subdivisions = 8;
    b.node("a", [1e16, 0.0, 0.0]).node("b", [1e16 + 2.0, 0.0, 0.0]);
    b.beam("m", "a", "b");
    b.support("a", FIXED);
    invalid_with(&b.run(), "numericRange");
}

#[test]
fn section_products_outside_the_range_are_rejected() {
    // E = 1e308 on an area of 2: EA overflows.
    let mut b = Build::new();
    b.model.sections[0].e = 1e308;
    b.model.sections[0].a = 2.0;
    b.node("a", [0.0; 3]).node("b", [1.0, 0.0, 0.0]);
    b.beam("m", "a", "b");
    b.support("a", FIXED);
    invalid_with(&b.run(), "numericRange");

    // A cable with a rest length of 1e-308: its strain overflows.
    let mut b = Build::new();
    b.node("a", [0.0; 3]).node("b", [1.0, 0.0, 0.0]);
    b.cable("c", "a", "b").rest_length = Some(1e-308);
    b.support("a", FIXED).support("b", FIXED);
    invalid_with(&b.run(), "numericRange");
}

/// Far from the origin the structure must still verify its equilibrium:
/// moments are balanced about the structure, not about the origin.
#[test]
fn a_structure_far_from_the_origin_still_verifies() {
    let (l, p) = (3.0, 1.0e3);
    for offset in [0.0, 1e6, 1e9] {
        for fidelity in [Fidelity::Linear, Fidelity::Nonlinear] {
            let mut b = Build::new();
            b.options.fidelity = fidelity;
            b.node("a", [offset, offset, 0.0]).node("b", [offset + l, offset, 0.0]);
            b.beam("m", "a", "b");
            b.support("a", FIXED).load("b", [0.0, 0.0, -p]);
            let r = b.run();
            assert_eq!(r.status(0), "stable", "offset {offset}: {:?}", r.reasons(0));
            close(r.reaction("a")[2], p, 1e-6);
            close(r.reaction("a")[4].abs(), p * l, 1e-6);
        }
    }
}

/// Five identical, separate cantilevers that each need nonlinear work.
fn five_cantilevers() -> Build {
    let mut b = Build::new();
    let length = 10.0;
    let p = E * I / (length * length);
    b.options.excessive_displacement_ratio = 10.0;
    for k in 0..5 {
        let (a, t) = (format!("a{k}"), format!("t{k}"));
        b.node(&a, [0.0, 5.0 * k as f64, 0.0]).node(&t, [length, 5.0 * k as f64, 0.0]);
        b.beam(&format!("m{k}"), &a, &t);
        b.support(&a, FIXED).load(&t, [0.0, 0.0, -p]);
    }
    b
}

/// The work limit is shared by the whole request, in a fixed order: when it
/// runs out, the parts not yet analysed report `unknown`, the parts already
/// analysed keep their verified results, and the outcome repeats exactly.
#[test]
fn the_request_budget_is_shared_across_components() {
    let generous = five_cantilevers().run();
    let used = generous.at(&["analysis", "iterations"]).as_f64().unwrap() as u32;
    for c in 0..5 {
        assert_eq!(generous.status(c), "stable");
    }
    let per_component = used / 5;
    assert!(per_component > 1);

    // Enough for two and a half cantilevers.
    let mut tight = five_cantilevers();
    tight.options.max_request_iterations = per_component * 5 / 2;
    let r = tight.run();
    let statuses: Vec<&str> = (0..5).map(|c| r.status(c)).collect();
    assert_eq!(&statuses[..2], ["stable", "stable"], "{statuses:?}");
    assert_eq!(&statuses[3..], ["unknown", "unknown"], "{statuses:?}");
    assert!(r.reasons(4).contains(&"iterationLimit"));
    assert!(codes(&r).contains(&"requestIterationLimit".to_string()));
    assert!((r.at(&["analysis", "iterations"]).as_f64().unwrap() as u32) <= per_component * 5 / 2);
    // Verified results of the parts analysed are the same as with a generous budget.
    assert_eq!(r.displacement("t0"), generous.displacement("t0"));
    assert_eq!(r.at(&["nodes", "t4", "displacement"]), &Json::Null);
    assert_eq!(tight.run().0.to_json_string(), r.0.to_json_string());

    // A zero budget is not an analysis.
    let mut none = five_cantilevers();
    none.options.max_request_iterations = 0;
    invalid_with(&none.run(), "invalidOptions");
}
