//! Stability reserve search (`options.reserveSearch`): the load multiplier,
//! above the applied load, at which a stable nonlinear equilibrium path first
//! loses stability. The game's structure evaluator reports it as the global
//! buckling factor that the retired voxel analysis estimated by linear
//! eigenvalue screening.

mod common;
use common::*;
use dof_solver::json::Json;
use dof_solver::model::*;
use std::f64::consts::PI;

/// Two percent mesh gate, as for the critical-load tests, plus the bracket.
const BUCKLING_GATE: f64 = 0.02;

fn column(length: f64, load: f64) -> Build {
    let mut b = Build::new();
    b.options.subdivisions = 4;
    b.options.reserve_search = 128.0;
    b.node("a", [0.0; 3]).node("b", [0.0, 0.0, length]);
    b.beam("m", "a", "b");
    b.support("a", [true, true, true, false, false, true]);
    b.support("b", [true, true, false, false, false, false]);
    b.load("b", [0.0, 0.0, -load]);
    b
}

fn reserve(run: &Run) -> &Json {
    run.component(0).get("reserve").expect("a requested reserve is reported")
}

fn bound(run: &Run, name: &str) -> Option<f64> {
    reserve(run).get(name).and_then(Json::as_f64)
}

/// A pin-ended column at a quarter of the Euler load has a reserve of four.
#[test]
fn column_reserve_matches_the_euler_load() {
    let length = 12.0;
    let euler = PI * PI * E * I / (length * length);
    let run = column(length, 0.25 * euler).run();
    assert_eq!(run.status(0), "stable", "{:?}", run.reasons(0));
    let (lower, upper) = (bound(&run, "lower").unwrap(), bound(&run, "upper").unwrap());
    assert!(lower < upper && upper / lower < 1.012, "bracket {lower}..{upper}");
    close(lower, 4.0, BUCKLING_GATE);
    assert_eq!(reserve(&run).get("cause").unwrap().as_str(), Some("instability"));
}

/// The reserve agrees with direct analyses: stable at the lower bound and
/// unstable at the upper bound.
#[test]
fn reserve_bounds_agree_with_direct_analyses() {
    let length = 12.0;
    let euler = PI * PI * E * I / (length * length);
    let load = 0.3 * euler;
    let run = column(length, load).run();
    let (lower, upper) = (bound(&run, "lower").unwrap(), bound(&run, "upper").unwrap());
    let mut at = column(length, load * lower);
    at.options.reserve_search = 0.0;
    at.options.stability_margin = 1.0;
    assert_eq!(at.run().status(0), "stable");
    let mut above = column(length, load * upper);
    above.options.reserve_search = 0.0;
    assert_eq!(above.run().status(0), "unstable");
}

/// A tie in tension never buckles: the search reaches its limit and reports
/// no upper bound.
#[test]
fn a_tie_is_stable_up_to_the_search_limit() {
    let mut b = Build::new();
    b.options.reserve_search = 64.0;
    b.node("a", [0.0; 3]).node("b", [0.0, 0.0, -3.0]);
    b.brace("t", "a", "b");
    b.support("a", FIXED);
    b.support("b", [false, false, false, true, true, true]);
    // Lateral restraint of the free end comes from a second, horizontal tie.
    b.node("c", [3.0, 0.0, -3.0]).node("d", [0.0, 3.0, -3.0]);
    b.brace("h", "b", "c");
    b.brace("k", "b", "d");
    b.support("c", FIXED).support("d", FIXED);
    b.load("b", [0.0, 0.0, -1e4]);
    let run = b.run();
    assert_eq!(run.status(0), "stable", "{:?}", run.reasons(0));
    assert_eq!(bound(&run, "lower"), Some(64.0));
    assert_eq!(bound(&run, "upper"), None);
    assert!(reserve(&run).get("cause").unwrap().as_str().is_none());
}

/// A shallow two-bar arch (von Mises truss) snaps through: past its limit
/// load no equilibrium can be continued along the loaded path.
#[test]
fn a_shallow_arch_reports_its_limit_point() {
    let (half_span, rise) = (2.0, 0.1);
    let mut b = Build::new();
    b.options.reserve_search = 1e3;
    // A limit point costs failed continuation probes; give the search room.
    b.options.max_total_iterations = 2000;
    b.node("l", [-half_span, 0.0, 0.0]).node("r", [half_span, 0.0, 0.0]).node("c", [0.0, 0.0, rise]);
    b.brace("bl", "l", "c");
    b.brace("br", "c", "r");
    b.support("l", FIXED).support("r", FIXED);
    // Out-of-plane restraint of the apex keeps the problem planar.
    b.support("c", [false, true, false, true, true, true]);
    // Shallow-arch limit load for a linear axial law: 2EA(h/L)³/(3√3).
    let length = (half_span * half_span + rise * rise).sqrt();
    let limit = 2.0 * E * A * (rise / length).powi(3) / (3.0 * 3f64.sqrt());
    let load = 0.2 * limit;
    b.load("c", [0.0, 0.0, -load]);
    let run = b.run();
    assert_eq!(run.status(0), "stable", "{:?}", run.reasons(0));
    let (lower, upper) = (bound(&run, "lower").unwrap(), bound(&run, "upper").unwrap());
    assert!(upper / lower < 1.012, "bracket {lower}..{upper}");
    // The large-displacement bar's strain measure differs from the shallow
    // formula at second order; the snap load agrees within ten percent.
    close(lower, 5.0, 0.1);
    let mut above = b.clone();
    above.options.reserve_search = 0.0;
    above.model.loads[0].force[2] = -load * upper;
    assert_ne!(above.run().status(0), "stable");
}

/// Running out of iterations leaves the verified equilibrium intact and
/// reports the search as incomplete.
#[test]
fn an_exhausted_budget_leaves_the_equilibrium_valid() {
    let length = 12.0;
    let euler = PI * PI * E * I / (length * length);
    let mut b = column(length, 0.25 * euler);
    b.options.max_total_iterations = 12;
    let run = b.run();
    assert_eq!(run.status(0), "stable");
    assert_eq!(run.component(0).get("resultsValid").unwrap().as_bool(), Some(true));
    assert!(matches!(reserve(&run), Json::Null));
    assert!(run.reasons(0).contains(&"reserveSearchIncomplete"), "{:?}", run.reasons(0));
}

/// The search is off by default, and the report then has no reserve field,
/// so existing responses are unchanged.
#[test]
fn the_reserve_is_absent_unless_requested() {
    let mut b = column(12.0, 1e5);
    b.options.reserve_search = 0.0;
    assert!(b.run().component(0).get("reserve").is_none());
}

/// A linear analysis has no nonlinear path to follow; the reserve is null
/// and the reason says so.
#[test]
fn a_linear_analysis_does_not_search() {
    let mut b = column(12.0, 1e5);
    b.options.fidelity = Fidelity::Linear;
    let run = b.run();
    assert!(matches!(run.component(0).get("reserve"), Some(Json::Null)));
}

/// Out-of-range limits are rejected with the other option checks.
#[test]
fn invalid_search_limits_are_rejected() {
    for limit in [0.5, 1.0, -2.0, 1e9, f64::NAN] {
        let mut b = column(12.0, 1e5);
        b.options.reserve_search = limit;
        let run = b.run();
        assert_eq!(run.at(&["analysis", "status"]).as_str(), Some("invalid"), "limit {limit}");
    }
}
