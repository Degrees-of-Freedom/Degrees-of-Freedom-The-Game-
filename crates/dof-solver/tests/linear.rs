//! Linear elastic benchmarks with closed-form answers (criteria A01, M06,
//! M07 and the first rows of the acceptance table). The gate is 0.1 %
//! relative error on non-zero quantities; these cases are exact for the
//! element, so they are held to 1e-9.

mod common;
use common::*;
use dof_solver::model::*;

const TIGHT: f64 = 1e-9;

#[test]
fn axial_bar() {
    let (l, p) = (4.0, 5.0e4);
    for (kind, direction) in [(MemberKind::Beam, [1.0, 0.0, 0.0]), (MemberKind::Brace, [0.6, 0.0, 0.8])] {
        let mut b = Build::linear();
        b.node("a", [0.0; 3]).node("b", direction.map(|d| d * l));
        b.member("m", kind, "a", "b");
        b.support("a", FIXED);
        // Guide the free end along the bar so a brace has no mechanism.
        if kind == MemberKind::Brace {
            b.brace("g1", "b", "c").section_id = "s".into();
            b.brace("g2", "b", "d");
            b.node("c", [0.6 * l, 3.0, 0.8 * l + 0.1]).node("d", [0.6 * l, -3.0, 0.8 * l + 0.1]);
            b.support("c", PINNED).support("d", PINNED);
        }
        b.load("b", direction.map(|d| d * p));
        let r = b.run();
        assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
        if kind == MemberKind::Beam {
            close(r.displacement("b")[0], p * l / (E * A), TIGHT);
            close(r.forces("m", "start")[0], p, TIGHT);
            close(r.forces("m", "end")[0], p, TIGHT);
            close(r.reaction("a")[0], -p, TIGHT);
        } else {
            assert!(r.forces("m", "start")[0] > 0.0);
        }
    }
}

/// Tip load on a cantilever, in each transverse direction and for members
/// along each global axis: deflection PL³/3EI, rotation PL²/2EI, root
/// moment PL.
#[test]
fn cantilever_in_every_orientation() {
    let (l, p) = (3.0, 1.0e3);
    for axis in 0..3 {
        for transverse in 0..3 {
            if transverse == axis {
                continue;
            }
            let mut tip = [0.0; 3];
            tip[axis] = l;
            let mut force = [0.0; 3];
            force[transverse] = -p;
            let mut b = Build::linear();
            b.node("a", [0.0; 3]).node("b", tip);
            b.beam("m", "a", "b");
            b.support("a", FIXED).load("b", force);
            let r = b.run();
            assert_eq!(r.status(0), "stable");
            let u = r.displacement("b");
            close(u[transverse], -p * l.powi(3) / (3.0 * E * I), TIGHT);
            let rotation = (u[3] * u[3] + u[4] * u[4] + u[5] * u[5]).sqrt();
            close(rotation, p * l * l / (2.0 * E * I), TIGHT);
            let reaction = r.reaction("a");
            close(reaction[transverse], p, TIGHT);
            let moment = (reaction[3].powi(2) + reaction[4].powi(2) + reaction[5].powi(2)).sqrt();
            close(moment, p * l, TIGHT);
            // Root section: shear P and bending moment PL; none at the tip.
            let start = r.forces("m", "start");
            close(start[1].hypot(start[2]), p, TIGHT);
            close(start[4].hypot(start[5]), p * l, TIGHT);
            let end = r.forces("m", "end");
            zero(end[4].hypot(end[5]), p * l);
            zero(start[0], p);
            assert!(r.residual(0) < 1e-10);
        }
    }
}

/// The reference case of the OpenSees adapter test: both backends must
/// give the same tip deflection for the shared steel section.
#[test]
fn cantilever_matches_the_opensees_reference_value() {
    let mut b = Build::linear();
    b.node("a", [0.0; 3]).node("b", [3.0, 0.0, 0.0]);
    b.beam("m", "a", "b");
    b.support("a", FIXED).load("b", [0.0, 0.0, -1000.0]);
    let r = b.run();
    assert!((r.displacement("b")[2] + 9.5877e-4).abs() < 1e-7);
}

#[test]
fn torsion() {
    let (l, t) = (2.5, 800.0);
    let mut b = Build::linear();
    b.node("a", [0.0; 3]).node("b", [0.0, l, 0.0]);
    b.beam("m", "a", "b");
    b.support("a", FIXED).moment("b", [0.0, t, 0.0]);
    let r = b.run();
    assert_eq!(r.status(0), "stable");
    close(r.displacement("b")[4], t * l / (G * J), TIGHT);
    close(r.forces("m", "start")[3], t, TIGHT);
    close(r.reaction("a")[4], -t, TIGHT);
}

/// Simply supported beam with a central point load: deflection PL³/48EI,
/// end rotations PL²/16EI, reactions P/2, midspan moment PL/4.
#[test]
fn simply_supported_beam() {
    let (l, p) = (6.0, 2.0e4);
    let mut b = Build::linear();
    b.node("a", [0.0; 3]).node("c", [l / 2.0, 0.0, 0.0]).node("b", [l, 0.0, 0.0]);
    b.beam("m1", "a", "c");
    b.beam("m2", "c", "b");
    // Torsion is held at one end only, so the beam cannot spin.
    b.support("a", [true, true, true, true, false, false]);
    b.support("b", [false, true, true, false, false, false]);
    b.load("c", [0.0, 0.0, -p]);
    let r = b.run();
    assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
    close(r.displacement("c")[2], -p * l.powi(3) / (48.0 * E * I), TIGHT);
    close(r.displacement("a")[4].abs(), p * l * l / (16.0 * E * I), TIGHT);
    close(r.reaction("a")[2], p / 2.0, TIGHT);
    close(r.reaction("b")[2], p / 2.0, TIGHT);
    close(r.forces("m1", "end")[4].abs(), p * l / 4.0, TIGHT);
    close(r.forces("m1", "end")[4], r.forces("m2", "start")[4], TIGHT);
    assert_eq!(r.count(0, "staticIndeterminacy"), 0.0);
}

/// Self-weight as a uniform load: fixed-fixed beam end moments wL²/12 and
/// midspan deflection wL⁴/384EI; simply supported midspan 5wL⁴/384EI. The
/// applied weight must equal the vertical reactions exactly once.
#[test]
fn self_weight_is_a_uniform_load_counted_once() {
    let (l, density, g) = (8.0, 7850.0, 9.81);
    let w = density * A * g;
    for released in [false, true] {
        let mut b = Build::linear();
        b.model.sections[0].density = density;
        b.options.gravity = Some([0.0, 0.0, -g]);
        b.node("a", [0.0; 3]).node("b", [l, 0.0, 0.0]);
        let m = b.beam("m", "a", "b");
        if released {
            m.start.laws = HINGE;
            m.end.laws = HINGE;
        }
        b.support("a", FIXED).support("b", FIXED);
        let r = b.run();
        assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
        close(r.reaction("a")[2] + r.reaction("b")[2], w * l, TIGHT);
        close(r.reaction("a")[2], w * l / 2.0, TIGHT);
        close(r.forces("m", "start")[2].abs(), w * l / 2.0, TIGHT);
        if released {
            zero(r.forces("m", "start")[4], w * l * l);
            zero(r.reaction("a")[4], w * l * l);
        } else {
            close(r.forces("m", "start")[4].abs(), w * l * l / 12.0, TIGHT);
            close(r.reaction("a")[4].abs(), w * l * l / 12.0, TIGHT);
        }
        let applied = r.component(0).get("appliedForce").unwrap().as_array().unwrap()[2].as_f64().unwrap();
        close(applied, -w * l, TIGHT);
    }
}

/// Propped cantilever with a central load: prop reaction 5P/16 and fixed-end
/// moment 3PL/16. One degree of redundancy.
#[test]
fn propped_cantilever() {
    let (l, p) = (4.0, 3.0e3);
    let mut b = Build::linear();
    b.node("a", [0.0; 3]).node("c", [l / 2.0, 0.0, 0.0]).node("b", [l, 0.0, 0.0]);
    b.beam("m1", "a", "c");
    b.beam("m2", "c", "b");
    b.support("a", FIXED).support("b", [false, false, true, false, false, false]);
    b.load("c", [0.0, 0.0, -p]);
    let r = b.run();
    close(r.reaction("b")[2], 5.0 * p / 16.0, TIGHT);
    close(r.reaction("a")[4].abs(), 3.0 * p * l / 16.0, TIGHT);
    assert_eq!(r.count(0, "staticIndeterminacy"), 1.0);
}

/// Shear deformation: a short cantilever with a shear area deflects by
/// PL³/3EI + PL/(G·As).
#[test]
fn timoshenko_shear_deflection() {
    let (l, p, shear_area) = (0.8, 1.0e5, 3.0e-3);
    let mut b = Build::linear();
    b.model.sections[0].shear_area_z = Some(shear_area);
    b.node("a", [0.0; 3]).node("b", [l, 0.0, 0.0]);
    b.beam("m", "a", "b");
    b.support("a", FIXED).load("b", [0.0, 0.0, -p]);
    let r = b.run();
    close(r.displacement("b")[2], -(p * l.powi(3) / (3.0 * E * I) + p * l / (G * shear_area)), TIGHT);
}
