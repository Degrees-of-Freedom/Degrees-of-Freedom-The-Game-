//! Deflection reported along a member, between its end nodes.
//!
//! Hermite beam elements with consistent loads give exact nodal values for a
//! uniform load, so the stations of a subdivided simply supported beam match
//! the closed-form deflection curve to round-off.

mod common;
use common::*;
use dof_solver::json::Json;
use dof_solver::model::*;

const TIGHT: f64 = 1e-9;
const RHO: f64 = 7850.0;
const GRAVITY: f64 = 9.81;

/// Pin at `a`, roller at `b`, torsion held at both, span `l` along X,
/// loaded only by its own weight along -Z.
fn simply_supported(l: f64, subdivisions: u32, fidelity: Fidelity) -> Build {
    let mut b = Build::new();
    b.options.fidelity = fidelity;
    b.options.gravity = Some([0.0, 0.0, -GRAVITY]);
    b.model.sections[0].density = RHO;
    b.node("a", [0.0; 3]).node("b", [l, 0.0, 0.0]);
    b.beam("m", "a", "b").subdivisions = Some(subdivisions);
    b.support("a", [true, true, true, true, false, false]);
    b.support("b", [false, true, true, true, false, false]);
    b
}

fn stations(run: &Run, member: &str) -> Vec<(f64, [f64; 6])> {
    let list = run.at(&["members", member, "deflection", "stations"]).as_array().unwrap();
    list.iter()
        .map(|s| {
            let d = s.get("displacement").unwrap().as_array().unwrap();
            (s.get("at").unwrap().as_f64().unwrap(), std::array::from_fn(|i| d[i].as_f64().unwrap()))
        })
        .collect()
}

fn deflection_number(run: &Run, member: &str, field: &str) -> f64 {
    run.at(&["members", member, "deflection", field]).as_f64().unwrap()
}

/// Simply supported beam under self-weight: every station is on the curve
/// w x (L³ − 2 L x² + x³) / 24EI, and the largest sag is 5 w L⁴ / 384EI at
/// mid-span.
#[test]
fn simply_supported_self_weight_stations() {
    let l: f64 = 6.0;
    let w = RHO * A * GRAVITY;
    let curve = |x: f64| -w * x * (l.powi(3) - 2.0 * l * x * x + x.powi(3)) / (24.0 * E * I);
    let r = simply_supported(l, 4, Fidelity::Linear).run();
    assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
    let points = stations(&r, "m");
    assert_eq!(points.len(), 5);
    for (k, (at, d)) in points.iter().enumerate() {
        assert_eq!(*at, k as f64 / 4.0);
        if k == 0 || k == 4 {
            zero(d[2], w * l.powi(4) / (E * I));
        } else {
            close(d[2], curve(at * l), TIGHT);
        }
    }
    close(deflection_number(&r, "m", "maxFromChord"), 5.0 * w * l.powi(4) / (384.0 * E * I), TIGHT);
    close(deflection_number(&r, "m", "atMax"), 0.5, TIGHT);
    close(deflection_number(&r, "m", "length"), l, TIGHT);
}

/// The station count follows the member's subdivisions.
#[test]
fn stations_follow_subdivisions() {
    for n in [1, 2, 3, 8] {
        let r = simply_supported(5.0, n, Fidelity::Linear).run();
        assert_eq!(stations(&r, "m").len(), n as usize + 1);
    }
}

/// The chord measure removes the member's rigid-body motion: a cantilever
/// whose root is a soft rotational spring drops and tilts as a whole, but its
/// sag from the chord is that of the flexible member alone.
#[test]
fn chord_deflection_excludes_support_motion() {
    let (l, p) = (3.0, 1.0e3);
    let run = |spring: Option<f64>| {
        let mut b = Build::linear();
        b.node("a", [0.0; 3]).node("b", [l, 0.0, 0.0]).node("c", [2.0 * l, 0.0, 0.0]);
        b.beam("m", "a", "b");
        let tip = b.beam("t", "b", "c");
        tip.subdivisions = Some(4);
        if let Some(k) = spring {
            tip.start.laws = [Law::Rigid, Law::Rigid, Law::Rigid, Law::Rigid, Law::Elastic(k), Law::Elastic(k)];
        }
        b.support("a", FIXED).load("c", [0.0, 0.0, -p]);
        b.run()
    };
    let (stiff, soft) = (run(None), run(Some(1.0e7)));
    // The soft joint makes the tip drop further, as a rigid-body rotation...
    assert!(soft.displacement("c")[2] < 1.1 * stiff.displacement("c")[2]);
    // ...but its own bending, relative to its chord, is unchanged: the end
    // moment and shear are the same, so the curve about the chord is the same.
    close(deflection_number(&soft, "t", "maxFromChord"), deflection_number(&stiff, "t", "maxFromChord"), 1e-5);
    // Cantilever under tip load, measured from the chord: largest at x = L/2
    // among the stations, |v(L) x / L − v(x)| with v(x) = P x²(3L − x)/6EI.
    let v = |x: f64| p * x * x * (3.0 * l - x) / (6.0 * E * I);
    close(deflection_number(&stiff, "t", "maxFromChord"), v(l) * 0.5 - v(0.5 * l), 1e-5);
}

/// A brace or cable is one straight element: no stations are reported.
#[test]
fn axial_members_have_no_deflection_stations() {
    let mut b = Build::linear();
    b.node("a", [0.0; 3]).node("b", [3.0, 0.0, 0.0]);
    b.brace("m", "a", "b");
    b.support("a", FIXED).support("b", [false, true, true, true, true, true]).load("b", [1.0e3, 0.0, 0.0]);
    let r = b.run();
    assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
    assert!(matches!(r.member("m", "deflection"), Json::Null));
}

/// The nonlinear analysis reports the same stations, from the deformed state,
/// and agrees with the linear one for a small load.
#[test]
fn nonlinear_stations_agree_for_small_loads() {
    let linear = simply_supported(6.0, 4, Fidelity::Linear).run();
    let nonlinear = simply_supported(6.0, 4, Fidelity::Nonlinear).run();
    assert_eq!(nonlinear.status(0), "stable", "{:?}", nonlinear.reasons(0));
    let (a, b) = (stations(&linear, "m"), stations(&nonlinear, "m"));
    for ((_, da), (_, db)) in a.iter().zip(&b) {
        assert!((da[2] - db[2]).abs() <= 1e-3 * a[2].1[2].abs());
    }
}

/// Without a verified solution there is nothing to report.
#[test]
fn unverified_members_have_null_deflection() {
    let mut b = Build::linear();
    b.node("a", [0.0; 3]).node("b", [3.0, 0.0, 0.0]);
    b.beam("m", "a", "b");
    b.load("b", [0.0, 0.0, -1.0e3]);
    let r = b.run();
    assert!(matches!(r.member("m", "deflection"), Json::Null));
}
