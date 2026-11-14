//! Geometrically nonlinear benchmarks (criteria A02, A04, A05 and the
//! buckling, sway and cable acceptance rows). Gates: 1 % on nonlinear
//! reference quantities and 2 % on mesh-converged buckling loads.

mod common;
use common::*;
use dof_solver::model::*;
use std::f64::consts::PI;

const NONLINEAR_GATE: f64 = 0.01;
const BUCKLING_GATE: f64 = 0.02;

fn bisect(mut low: f64, mut high: f64, f: impl Fn(f64) -> f64) -> f64 {
    for _ in 0..200 {
        let middle = 0.5 * (low + high);
        if f(middle) > 0.0 {
            high = middle;
        } else {
            low = middle;
        }
    }
    0.5 * (low + high)
}

fn column(length: f64, load: f64, subdivisions: u32) -> Build {
    let mut b = Build::new();
    b.options.subdivisions = subdivisions;
    b.node("a", [0.0; 3]).node("b", [0.0, 0.0, length]);
    b.beam("m", "a", "b");
    // Pinned both ends; twist held at the base so the column cannot spin.
    b.support("a", [true, true, true, false, false, true]);
    b.support("b", [true, true, false, false, false, false]);
    b.load("b", [0.0, 0.0, -load]);
    b
}

/// Pin-ended column: the critical load converges on the Euler load π²EI/L²
/// as the member is subdivided, and is within the gate from two elements.
#[test]
fn euler_buckling_load_and_mesh_convergence() {
    let length = 12.0;
    let euler = PI * PI * E * I / (length * length);
    let mut errors = Vec::new();
    for subdivisions in [1, 2, 4, 8] {
        let r = column(length, 1.5 * euler, subdivisions).run();
        assert_eq!(r.status(0), "unstable");
        assert!(r.reasons(0).contains(&"loadInducedInstability"), "{:?}", r.reasons(0));
        assert_eq!(r.component(0).get("resultsValid").unwrap().as_bool(), Some(false));
        let critical = r.number(0, "criticalLoadFactor") * 1.5 * euler;
        errors.push((critical - euler).abs() / euler);
    }
    println!("Euler buckling relative errors for 1, 2, 4, 8 elements: {errors:?}");
    assert!(errors[1] < BUCKLING_GATE && errors[2] < BUCKLING_GATE && errors[3] < BUCKLING_GATE);
    assert!(errors[0] > errors[1] && errors[1] > errors[2]);
    assert!(errors[3] < 2e-3);
}

/// Below the critical load the column is stable; close to it the reserve is
/// under the margin and the state is marginal, not stable.
#[test]
fn stability_margin_grades_a_compressed_column() {
    let length = 12.0;
    let euler = PI * PI * E * I / (length * length);
    let safe = column(length, 0.5 * euler, 4).run();
    assert_eq!(safe.status(0), "stable", "{:?}", safe.reasons(0));
    close(safe.reaction("a")[2], 0.5 * euler, 1e-8);
    let near = column(length, 0.9 * euler, 4).run();
    assert_eq!(near.status(0), "marginal");
    assert!(near.reasons(0).contains(&"lowStabilityMargin"));
    // The linear analysis cannot see buckling at all.
    let mut linear = column(length, 1.5 * euler, 4);
    linear.options.fidelity = Fidelity::Linear;
    assert_eq!(linear.run().status(0), "stable");
}

/// Imperfect column: a lateral load at mid-height is amplified by the axial
/// load. Beam-column theory gives δ = (HL³/48EI) · 3(tan u − u)/u³ with
/// u = (π/2)√(P/Pcr).
#[test]
fn compressed_imperfect_column_amplifies_its_deflection() {
    let (length, lateral) = (12.0, 500.0);
    let euler = PI * PI * E * I / (length * length);
    let first_order = lateral * length.powi(3) / (48.0 * E * I);
    for ratio in [0.25, 0.5, 0.7] {
        let mut b = Build::new();
        b.options.subdivisions = 4;
        b.node("a", [0.0; 3]).node("c", [0.0, 0.0, length / 2.0]).node("b", [0.0, 0.0, length]);
        b.beam("m1", "a", "c");
        b.beam("m2", "c", "b");
        b.support("a", [true, true, true, false, false, true]);
        b.support("b", [true, true, false, false, false, false]);
        b.load("b", [0.0, 0.0, -ratio * euler]).load("c", [lateral, 0.0, 0.0]);
        let r = b.run();
        assert_ne!(r.status(0), "unstable", "{:?}", r.reasons(0));
        let u = 0.5 * PI * ratio.sqrt();
        close(r.displacement("c")[0], first_order * 3.0 * (u.tan() - u) / u.powi(3), NONLINEAR_GATE);
        assert!(r.residual(0) < 1e-5);
    }
}

/// Sway of a cantilever column under axial load P and lateral load H:
/// Δ = (H/Pk)(tan kL − kL), k = √(P/EI). Converges under subdivision.
#[test]
fn sway_frame_second_order_response() {
    let (length, lateral) = (5.0, 200.0);
    let critical = PI * PI * E * I / (4.0 * length * length);
    let axial = 0.4 * critical;
    let k = (axial / (E * I)).sqrt();
    let exact = lateral / (axial * k) * ((k * length).tan() - k * length);
    let first_order = lateral * length.powi(3) / (3.0 * E * I);
    assert!(exact > 1.5 * first_order);
    let mut errors = Vec::new();
    for subdivisions in [1, 2, 4] {
        let mut b = Build::new();
        b.options.subdivisions = subdivisions;
        b.node("a", [0.0; 3]).node("b", [0.0, 0.0, length]);
        b.beam("m", "a", "b");
        b.support("a", FIXED).load("b", [lateral, 0.0, -axial]);
        let r = b.run();
        assert_ne!(r.status(0), "unstable");
        errors.push((r.displacement("b")[0] - exact).abs() / exact);
        // Base moment includes the P-Δ term.
        if subdivisions == 4 {
            close(r.reaction("a")[4].abs(), lateral * length + axial * exact, NONLINEAR_GATE);
        }
    }
    println!("Sway deflection relative errors for 1, 2, 4 elements: {errors:?}");
    assert!(errors[1] < NONLINEAR_GATE && errors[2] < NONLINEAR_GATE && errors[2] < errors[0]);
}

fn guy_wire(b: &mut Build) {
    // A node guided along X between two cables anchored either side.
    b.node("w1", [-3.0, 0.0, 0.0]).node("n", [0.0; 3]).node("w2", [3.0, 0.0, 0.0]);
    b.cable("left", "w1", "n");
    b.cable("right", "n", "w2");
    b.support("w1", PINNED).support("w2", PINNED);
    b.support("n", [false, true, true, false, false, false]);
}

/// A cable resists tension only: pushed towards one anchor, the cable on
/// that side goes slack and carries nothing.
#[test]
fn cables_never_carry_compression() {
    let p = 4.0e4;
    for fidelity in [Fidelity::Linear, Fidelity::Nonlinear] {
        let mut b = Build::new();
        b.options.fidelity = fidelity;
        guy_wire(&mut b);
        b.load("n", [p, 0.0, 0.0]);
        let r = b.run();
        assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
        assert_eq!(r.member("left", "state").as_str(), Some("active"));
        assert_eq!(r.member("right", "state").as_str(), Some("slack"));
        close(r.forces("left", "start")[0], p, 1e-6);
        assert_eq!(r.forces("right", "start")[0], 0.0);
        close(r.reaction("w1")[0], -p, 1e-6);
        assert_eq!(r.reaction("w2")[0], 0.0);
        close(r.displacement("n")[0], p * 3.0 / (E * A), 1e-4);
    }
    // With cables only on the far side, nothing resists the push at all.
    let mut b = Build::new();
    b.node("n", [0.0; 3]).node("w2", [3.0, 0.0, 0.0]);
    b.cable("right", "n", "w2");
    b.support("w2", PINNED).support("n", [false, true, true, false, false, false]);
    b.load("n", [p, 0.0, 0.0]);
    let r = b.run();
    // The node swings through to the far side of the anchor before the cable
    // can pull: an equilibrium, but nowhere near the built geometry.
    assert_eq!(r.status(0), "unstable");
    assert!(r.reasons(0).contains(&"excessiveDeformation"), "{:?}", r.reasons(0));
}

/// A cable longer than the gap is slack until the load has taken up the
/// slack. The first-order model is a mechanism, yet a stable nonlinear
/// equilibrium exists and is found.
#[test]
fn slack_cable_activates_after_taking_up_its_slack() {
    let (p, rest) = (2.0e4, 2.05);
    let mut b = Build::new();
    b.node("s", [0.0, 0.0, 2.0]).node("n", [0.0; 3]);
    b.cable("c", "s", "n").rest_length = Some(rest);
    b.support("s", PINNED).support("n", [true, true, false, false, false, false]);
    b.load("n", [0.0, 0.0, -p]);

    let mut linear = b.clone();
    linear.options.fidelity = Fidelity::Linear;
    let r = linear.run();
    assert_eq!(r.status(0), "unstable");
    assert!(r.reasons(0).contains(&"mechanism"));

    let r = b.run();
    assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
    assert!(r.reasons(0).contains(&"stabilisedByGeometry"));
    close(r.displacement("n")[2], -(rest - 2.0 + p * rest / (E * A)), 1e-8);
    close(r.forces("c", "start")[0], p, 1e-8);
    close(r.reaction("s")[2], p, 1e-8);
}

fn cable_span(strain: Option<f64>, area: f64, p: f64) -> Build {
    let mut b = Build::new();
    b.model.sections[0].a = area;
    b.node("a", [-3.0, 0.0, 0.0]).node("m", [0.0; 3]).node("b", [3.0, 0.0, 0.0]);
    b.cable("c1", "a", "m").initial_strain = strain;
    b.cable("c2", "m", "b").initial_strain = strain;
    b.support("a", PINNED).support("b", PINNED);
    b.support("m", [false, true, false, false, false, false]);
    b.load("m", [0.0, 0.0, -p]);
    b
}

/// Exact sag of a two-segment cable span under a central load, from the
/// equilibrium of the middle node alone.
fn span_sag(strain: f64, area: f64, p: f64) -> (f64, f64) {
    let half = 3.0_f64;
    let rest = half / (1.0 + strain);
    let tension = |sag: f64| E * area * ((half * half + sag * sag).sqrt() - rest) / rest;
    let sag = bisect(0.0, half, |sag| 2.0 * tension(sag) * sag / (half * half + sag * sag).sqrt() - p);
    (sag, tension(sag))
}

/// A pretensioned cable span carries a transverse load through geometric
/// stiffness: 4T/L in the linearised model, and the exact nonlinear
/// equilibrium of the loaded node otherwise.
#[test]
fn pretensioned_cable_system() {
    let (strain, area, p) = (1.0e-3, 4.0e-4, 2.0e3);
    let pretension = E * area * strain;

    let mut linear = cable_span(Some(strain), area, p);
    linear.options.fidelity = Fidelity::Linear;
    let r = linear.run();
    assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
    close(r.displacement("m")[2], -p * 6.0 / (4.0 * pretension), 1e-9);

    // No load: the pretension is in equilibrium and reacted at the anchors.
    let r = cable_span(Some(strain), area, 0.0).run();
    assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
    close(r.forces("c1", "start")[0], pretension, 1e-9);
    close(r.reaction("a")[0], -pretension, 1e-9);

    let r = cable_span(Some(strain), area, p).run();
    assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
    let (sag, tension) = span_sag(strain, area, p);
    close(r.displacement("m")[2], -sag, 1e-6);
    close(r.forces("c1", "end")[0], tension, 1e-6);
    close(r.reaction("a")[2] + r.reaction("b")[2], p, 1e-8);
    assert!(r.residual(0) < 1e-5);
}

/// With no pretension the span has no first-order stiffness at all and
/// carries load only by deflecting. The large-deflection equilibrium is
/// found, and an excessive one is reported as such.
#[test]
fn large_deflection_cable() {
    let p = 5.0e4;
    let r = cable_span(None, A, p).run();
    assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
    assert!(r.reasons(0).contains(&"stabilisedByGeometry"));
    let (sag, tension) = span_sag(0.0, A, p);
    close(r.displacement("m")[2], -sag, 1e-6);
    close(r.forces("c1", "start")[0], tension, 1e-6);

    // A very soft cable sags by a large fraction of the span.
    let soft = 1.0e-6;
    let mut b = cable_span(None, soft, p);
    let r = b.run();
    assert_eq!(r.status(0), "unstable");
    assert!(r.reasons(0).contains(&"excessiveDeformation"));
    b.options.excessive_displacement_ratio = 10.0;
    let r = b.run();
    assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
    let (sag, tension) = span_sag(0.0, soft, p);
    assert!(sag > 1.0);
    close(r.displacement("m")[2], -sag, 1e-6);
    close(r.forces("c1", "start")[0], tension, 1e-6);
}

/// Pure bending rolls a cantilever into a circular arc of radius EI/M. An
/// end moment of πEI/2L turns the tip through 90°.
#[test]
fn cantilever_rolls_up_under_end_moment() {
    let length = 10.0;
    let moment = PI * E * I / (2.0 * length);
    let radius = E * I / moment;
    let mut b = Build::new();
    b.options.subdivisions = 10;
    b.options.excessive_displacement_ratio = 10.0;
    b.node("a", [0.0; 3]).node("b", [length, 0.0, 0.0]);
    b.beam("m", "a", "b");
    b.support("a", FIXED).moment("b", [0.0, moment, 0.0]);
    let r = b.run();
    assert_ne!(r.status(0), "unknown", "{:?}", r.reasons(0));
    let u = r.displacement("b");
    close(u[0], radius - length, NONLINEAR_GATE);
    close(u[2], -radius, NONLINEAR_GATE);
    close(u[4], PI / 2.0, NONLINEAR_GATE);
    close(r.forces("m", "start")[4].abs(), moment, 1e-6);
}

/// The elastica: a cantilever with tip load PL²/EI = 1 deflects by
/// 0.30172 L and shortens by 0.05643 L (Mattiasson, 1981).
#[test]
fn elastica_tip_load() {
    let length = 10.0;
    let p = E * I / (length * length);
    let mut b = Build::new();
    b.options.subdivisions = 8;
    b.options.excessive_displacement_ratio = 10.0;
    b.node("a", [0.0; 3]).node("b", [length, 0.0, 0.0]);
    b.beam("m", "a", "b");
    b.support("a", FIXED).load("b", [0.0, 0.0, -p]);
    let r = b.run();
    assert_ne!(r.status(0), "unknown", "{:?}", r.reasons(0));
    close(r.displacement("b")[2], -0.30172 * length, NONLINEAR_GATE);
    close(r.displacement("b")[0], -0.05643 * length, NONLINEAR_GATE);
    close(r.displacement("b")[4], 0.46135, NONLINEAR_GATE);
    assert!(r.residual(0) < 1e-5);

    // Running out of iterations is reported as unresolved, with no results.
    b.options.max_total_iterations = 1;
    let r = b.run();
    assert_eq!(r.status(0), "unknown");
    assert!(r.reasons(0).contains(&"iterationLimit"));
    assert_eq!(r.component(0).get("resultsValid").unwrap().as_bool(), Some(false));
    assert_eq!(r.at(&["foundations", "f-a", "reaction"]), &dof_solver::json::Json::Null);
}
