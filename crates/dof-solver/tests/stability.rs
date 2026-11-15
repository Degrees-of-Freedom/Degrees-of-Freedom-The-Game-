//! Connectivity, load sharing, connection laws, mechanisms and component
//! isolation (criteria M01–M06, A03, A04, A06 and the matching acceptance
//! rows). Run in both fidelities where the answer is the same.

mod common;
use common::*;
use dof_solver::model::*;

const TIGHT: f64 = 1e-9;

fn both(build: impl Fn(&mut Build), check: impl Fn(&Run, f64)) {
    for (fidelity, tolerance) in [(Fidelity::Linear, TIGHT), (Fidelity::Nonlinear, 2e-4)] {
        let mut b = Build::new();
        b.options.fidelity = fidelity;
        build(&mut b);
        check(&b.run(), tolerance);
    }
}

/// Two axial members of different stiffness share one guided node, so they
/// see a common displacement and the load splits in proportion to EA/L.
#[test]
fn parallel_springs_share_load_by_stiffness() {
    let p = 9.0e4;
    let (k1, k2) = (E * A / 3.0, E * 2.0 * A / 4.0);
    both(
        |b| {
            let mut heavy = steel("s2");
            heavy.a = 2.0 * A;
            b.model.sections.push(heavy);
            b.node("top", [0.0, 0.0, 3.0]).node("low", [0.0; 3]).node("high", [0.0, 0.0, 7.0]);
            b.brace("k1", "top", "low");
            b.brace("k2", "top", "high").section_id = "s2".into();
            b.support("low", PINNED).support("high", PINNED);
            b.support("top", [true, true, false, false, false, false]);
            b.load("top", [0.0, 0.0, -p]);
        },
        |r, tolerance| {
            assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
            close(r.reaction("low")[2], p * k1 / (k1 + k2), tolerance);
            close(r.reaction("high")[2], p * k2 / (k1 + k2), tolerance);
            close(r.displacement("top")[2], -p / (k1 + k2), tolerance);
            // Compression below, tension above.
            assert!(r.forces("k1", "start")[0] < 0.0 && r.forces("k2", "start")[0] > 0.0);
        },
    );
}

fn solve3(mut a: [[f64; 3]; 3], mut b: [f64; 3]) -> [f64; 3] {
    for i in 0..3 {
        let p = (i..3).max_by(|x, y| a[*x][i].abs().total_cmp(&a[*y][i].abs())).unwrap();
        a.swap(i, p);
        b.swap(i, p);
        for r in i + 1..3 {
            let f = a[r][i] / a[i][i];
            for c in 0..3 {
                a[r][c] -= f * a[i][c];
            }
            b[r] -= f * b[i];
        }
    }
    let mut x = [0.0; 3];
    for i in (0..3).rev() {
        x[i] = (b[i] - (i + 1..3).map(|c| a[i][c] * x[c]).sum::<f64>()) / a[i][i];
    }
    x
}

/// Four players' foundations under one shared hub. Reactions must follow
/// relative stiffness: equal when the legs are equal, and matching an
/// independent hand solution of the hub equilibrium when they are not.
#[test]
fn shared_frame_distributes_reactions_between_two_to_four_players() {
    let p = 1.2e5;
    let hub = [0.0, 0.0, 3.0];
    let feet = [[4.0, 0.0, 0.0], [0.0, 4.0, 0.0], [-4.0, 0.0, 0.0], [0.0, -4.0, 0.0]];
    for areas in [[1.0, 1.0, 1.0, 1.0], [1.0, 3.0, 1.0, 3.0], [1.0, 2.0, 3.0, 4.0], [1.0, 2.5, 0.0, 4.0]] {
        // Independent solution: K u = F for the hub, then bar forces.
        let mut k = [[0.0; 3]; 3];
        let unit = |foot: [f64; 3]| [0, 1, 2].map(|i| (foot[i] - hub[i]) / 5.0);
        for (foot, area) in feet.iter().zip(areas) {
            let n = unit(*foot);
            for i in 0..3 {
                for j in 0..3 {
                    k[i][j] += E * A * area / 5.0 * n[i] * n[j];
                }
            }
        }
        let u = solve3(k, [0.0, 0.0, -p]);
        let mut b = Build::linear();
        b.node("hub", hub);
        for (i, (foot, area)) in feet.iter().zip(areas).enumerate() {
            if area == 0.0 {
                continue;
            }
            let mut section = steel(&format!("s{i}"));
            section.a = A * area;
            b.model.sections.push(section);
            b.node(&format!("p{i}"), *foot);
            b.brace(&format!("leg{i}"), "hub", &format!("p{i}")).section_id = format!("s{i}");
            b.support(&format!("p{i}"), PINNED);
        }
        let r = b.load("hub", [0.0, 0.0, -p]).run();
        assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
        let mut vertical = 0.0;
        for (i, (foot, area)) in feet.iter().zip(areas).enumerate() {
            if area == 0.0 {
                continue;
            }
            let n = unit(*foot);
            // Bar force for hub displacement u; the foot reaction balances it.
            let axial = -E * A * area / 5.0 * (n[0] * u[0] + n[1] * u[1] + n[2] * u[2]);
            let reaction = r.reaction(&format!("p{i}"));
            for c in 0..3 {
                if (axial * n[c]).abs() > 1e-6 * p {
                    close(reaction[c], axial * n[c], TIGHT);
                } else {
                    zero(reaction[c], p * 1e3);
                }
            }
            if axial.abs() > 1e-6 * p {
                close(r.forces(&format!("leg{i}"), "start")[0], axial, TIGHT);
            } else {
                zero(r.forces(&format!("leg{i}"), "start")[0], p * 1e3);
            }
            vertical += reaction[2];
        }
        // Under gravity alone the supports carry exactly the applied weight.
        close(vertical, p, TIGHT);
        if areas == [1.0, 3.0, 1.0, 3.0] {
            close(r.reaction("p0")[2], p / 8.0, TIGHT);
            close(r.reaction("p1")[2], 3.0 * p / 8.0, TIGHT);
        }
    }
}

/// A semi-rigid root connection on a cantilever adds PL²/k to the tip
/// deflection, and only for the connection axis that the bending acts on,
/// whichever way the member points.
#[test]
fn semi_rigid_connection_is_axis_specific_and_orientation_independent() {
    let (l, p, k) = (3.0_f64, 2.0e3_f64, 4.0e6_f64);
    let rigid = p * l.powi(3) / (3.0 * E * I);
    let frames: [([f64; 3], [f64; 3]); 4] = [
        ([1.0, 0.0, 0.0], [0.0, 0.0, 1.0]),
        ([0.0, 1.0, 0.0], [1.0, 0.0, 0.0]),
        ([0.0, 0.0, 1.0], [0.0, 1.0, 0.0]),
        ([1.0 / 3.0, 2.0 / 3.0, 2.0 / 3.0], [2.0 / 3.0, -2.0 / 3.0, 1.0 / 3.0]),
    ];
    for (axis, up) in frames {
        for (law_index, expected) in [(4, rigid + p * l * l / k), (5, rigid), (3, rigid)] {
            let mut b = Build::linear();
            b.node("a", [0.0; 3]).node("b", axis.map(|v| v * l));
            let m = b.beam("m", "a", "b");
            m.orientation = Some(up);
            m.start.laws[law_index] = Law::Elastic(k);
            b.support("a", FIXED).load("b", up.map(|v| -v * p));
            let r = b.run();
            assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
            let u = r.displacement("b");
            close(-(u[0] * up[0] + u[1] * up[1] + u[2] * up[2]), expected, TIGHT);
            let motion = r.at(&["members", "m", "connections", "start", "relativeMotion"]).as_array().unwrap()[law_index].as_f64().unwrap();
            if law_index == 4 {
                close(motion.abs(), p * l / k, TIGHT);
            } else {
                zero(motion, p * l / k);
            }
            // The member forces are the same in local axes for every orientation.
            let start = r.forces("m", "start");
            close(start[2].abs(), p, TIGHT);
            close(start[4].abs(), p * l, TIGHT);
            zero(start[5], p * l);
        }
    }
}

/// Fixed-ended beam with rotational springs at both ends and a central load:
/// the end moment falls between the pinned (0) and rigid (PL/8) limits as
/// (PL/8) / (1 + 2EI/kL).
#[test]
fn semi_rigid_ends_interpolate_between_pinned_and_rigid() {
    let (l, p) = (6.0, 4.0e4);
    for k in [1.0e3, 2.0e6, 4.0e7, 1.0e12] {
        both(
            |b| {
                b.node("a", [0.0; 3]).node("c", [l / 2.0, 0.0, 0.0]).node("b", [l, 0.0, 0.0]);
                b.beam("m1", "a", "c").start.laws[4] = Law::Elastic(k);
                // The far end slides axially, so no membrane tension builds up
                // and the first-order formula also holds at large deflection.
                let far = b.beam("m2", "c", "b");
                far.end.laws[4] = Law::Elastic(k);
                far.end.laws[0] = Law::Free;
                b.support("a", FIXED).support("b", FIXED).load("c", [0.0, 0.0, -p]);
            },
            |r, tolerance| {
                assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
                let expected = p * l / 8.0 / (1.0 + 2.0 * E * I / (k * l));
                close(r.forces("m1", "start")[4].abs(), expected, tolerance.max(1e-7));
                close(r.reaction("a")[4].abs(), expected, tolerance.max(1e-7));
            },
        );
    }
}

/// Moment, pin and partial-release connections transmit exactly the
/// components they should.
#[test]
fn releases_transmit_only_the_unreleased_components() {
    let (l, p) = (4.0, 3.0e3);
    // Pinned far end: the propped cantilever, with no moment at the pin.
    both(
        |b| {
            b.node("a", [0.0; 3]).node("c", [l / 2.0, 0.0, 0.0]).node("b", [l, 0.0, 0.0]);
            b.beam("m1", "a", "c");
            b.beam("m2", "c", "b").end.laws = HINGE;
            b.support("a", FIXED).support("b", FIXED).load("c", [0.0, 0.0, -p]);
        },
        |r, tolerance| {
            assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
            close(r.reaction("b")[2], 5.0 * p / 16.0, tolerance);
            close(r.reaction("a")[4].abs(), 3.0 * p * l / 16.0, tolerance);
            zero(r.reaction("b")[4], p * l * 1e4);
            zero(r.forces("m2", "end")[4], p * l * 1e4);
        },
    );
    // Axial slide at one end: all axial load goes to the other support,
    // while the sliding end still carries its share of the transverse load.
    both(
        |b| {
            b.node("a", [0.0; 3]).node("c", [l / 2.0, 0.0, 0.0]).node("b", [l, 0.0, 0.0]);
            b.beam("m1", "a", "c");
            b.beam("m2", "c", "b").end.laws[0] = Law::Free;
            b.support("a", FIXED).support("b", FIXED).load("c", [7.0e3, 0.0, -p]);
        },
        |r, tolerance| {
            assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
            close(r.reaction("a")[0], -7.0e3, tolerance);
            zero(r.reaction("b")[0], 7.0e3 * 1e5);
            close(r.reaction("b")[2], p / 2.0, tolerance.max(1e-6));
            let slide = r.at(&["members", "m2", "connections", "end", "relativeMotion"]).as_array().unwrap()[0].as_f64().unwrap();
            // Bending also shortens the chord a little in the nonlinear case.
            close(slide.abs(), 7.0e3 * (l / 2.0) / (E * A), tolerance.max(1e-6) * 10.0);
        },
    );
}

/// Members that cross at the same coordinates but name different nodes are
/// not connected: a load on one leaves the other untouched.
#[test]
fn coincident_members_are_not_connected() {
    let p = 5.0e3;
    both(
        |b| {
            b.node("a1", [-2.0, 0.0, 1.0]).node("c1", [0.0, 0.0, 1.0]).node("b1", [2.0, 0.0, 1.0]);
            b.node("a2", [0.0, -2.0, 1.0]).node("c2", [0.0, 0.0, 1.0]).node("b2", [0.0, 2.0, 1.0]);
            b.beam("x1", "a1", "c1");
            b.beam("x2", "c1", "b1");
            b.beam("y1", "a2", "c2");
            b.beam("y2", "c2", "b2");
            for node in ["a1", "b1", "a2", "b2"] {
                b.support(node, FIXED);
            }
            b.load("c1", [0.0, 0.0, -p]);
        },
        |r, tolerance| {
            assert_eq!(r.components(), 2);
            assert_eq!((r.status(0), r.status(1)), ("stable", "stable"));
            close(r.displacement("c1")[2], -p * 4.0_f64.powi(3) / (192.0 * E * I), tolerance);
            assert_eq!(r.displacement("c2"), [0.0; 6]);
            assert_eq!(r.reaction("a2"), [0.0; 6]);
        },
    );
}

fn portal(b: &mut Build) {
    b.node("a", [0.0; 3]).node("b", [4.0, 0.0, 0.0]).node("c", [0.0, 0.0, 3.0]).node("d", [4.0, 0.0, 3.0]);
    b.beam("col1", "a", "c");
    b.beam("col2", "b", "d");
    b.beam("beam", "c", "d");
    b.support("a", FIXED).support("b", FIXED);
    b.load("c", [2.0e3, 0.0, -1.0e4]);
}

/// An unsupported or unstable component is reported on its own and leaves
/// the verified results of an unrelated stable component unchanged.
#[test]
fn unstable_components_do_not_invalidate_stable_ones() {
    for fidelity in [Fidelity::Linear, Fidelity::Nonlinear] {
        let mut alone = Build::new();
        alone.options.fidelity = fidelity;
        portal(&mut alone);
        let reference = alone.run();
        assert_eq!(reference.status(0), "stable", "{:?}", reference.reasons(0));
        assert_eq!(reference.count(0, "staticIndeterminacy"), 6.0);

        for loaded in [false, true] {
            let mut b = alone.clone();
            // A floating beam, and a pin-jointed square that can sway.
            b.node("x", [10.0, 0.0, 5.0]).node("y", [12.0, 0.0, 5.0]);
            b.beam("floating", "x", "y");
            b.node("q1", [20.0, 0.0, 0.0]).node("q2", [23.0, 0.0, 0.0]).node("q3", [20.0, 0.0, 3.0]).node("q4", [23.0, 0.0, 3.0]);
            b.brace("s1", "q1", "q3");
            b.brace("s2", "q2", "q4");
            b.brace("s3", "q3", "q4");
            b.support("q1", PINNED).support("q2", PINNED);
            if loaded {
                b.load("x", [0.0, 0.0, -100.0]).load("q3", [50.0, 0.0, 0.0]);
            }
            let r = b.run();
            assert_eq!(r.components(), 3);
            let frame = r.component_of("a");
            assert_eq!(frame.get("status").unwrap().as_str(), Some("stable"));
            for node in ["c", "d"] {
                assert_eq!(r.displacement(node), reference.displacement(node));
            }
            assert_eq!(r.reaction("a"), reference.reaction("a"));

            let floating = r.component_of("x");
            assert_eq!(floating.get("status").unwrap().as_str(), Some("unstable"));
            assert_eq!(floating.get("resultsValid").unwrap().as_bool(), Some(false));
            assert_eq!(floating.get("flags").unwrap().get("unsupported").unwrap().as_bool(), Some(true));
            assert_eq!(floating.get("counts").unwrap().get("rigidBodyModes").unwrap().as_f64(), Some(6.0));
            assert_eq!(r.at(&["nodes", "x", "displacement"]), &dof_solver::json::Json::Null);
            assert_eq!(r.at(&["members", "floating", "forces"]), &dof_solver::json::Json::Null);

            // The square is unstable whether or not a load acts on it.
            let square = r.component_of("q1");
            assert_eq!(square.get("status").unwrap().as_str(), Some("unstable"));
            assert_eq!(square.get("counts").unwrap().get("mechanisms").unwrap().as_f64(), Some(3.0));
            assert_eq!(r.at(&["foundations", "f-q1", "valid"]).as_bool(), Some(false));
            let moving: Vec<&str> = square.get("unstableNodeIds").unwrap().as_array().unwrap().iter().map(|n| n.as_str().unwrap()).collect();
            assert_eq!(moving, ["q3", "q4"]);
        }
    }
}

/// A triangulated space truss has no usable joint rotations. They must not
/// make the stiffness singular, and the bar forces must be the statics ones.
#[test]
fn triangulated_truss_is_stable_without_joint_rotations() {
    let (radius, height, p) = (2.0_f64, 3.0_f64, 6.0e4);
    both(
        |b| {
            b.node("top", [0.0, 0.0, height]);
            for i in 0..3 {
                let angle = 2.0 * std::f64::consts::PI * i as f64 / 3.0;
                b.node(&format!("b{i}"), [radius * angle.cos(), radius * angle.sin(), 0.0]);
                b.brace(&format!("leg{i}"), &format!("b{i}"), "top");
                b.support(&format!("b{i}"), PINNED);
            }
            for i in 0..3 {
                b.brace(&format!("ring{i}"), &format!("b{i}"), &format!("b{}", (i + 1) % 3));
            }
            b.load("top", [0.0, 0.0, -p]);
        },
        |r, tolerance| {
            assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
            assert_eq!(r.count(0, "unusedDofs"), 12.0);
            assert_eq!(r.count(0, "freeDofs"), 3.0);
            assert_eq!(r.count(0, "mechanisms"), 0.0);
            let leg = (radius * radius + height * height).sqrt();
            for i in 0..3 {
                close(r.forces(&format!("leg{i}"), "start")[0], -p * leg / (3.0 * height), tolerance);
                close(r.reaction(&format!("b{i}"))[2], p / 3.0, tolerance);
            }
        },
    );
}

/// A brace-and-pin frame with no diagonal sways in its plane, and a planar
/// truss with no out-of-plane restraint falls sideways. Both are genuine
/// mechanisms and are reported with the nodes that move.
#[test]
fn in_plane_and_out_of_plane_mechanisms_are_detected() {
    for fidelity in [Fidelity::Linear, Fidelity::Nonlinear] {
        // Braced in its plane, free to fall out of it.
        let mut b = Build::new();
        b.options.fidelity = fidelity;
        b.node("a", [0.0; 3]).node("b", [4.0, 0.0, 0.0]).node("c", [2.0, 0.0, 3.0]);
        b.brace("ac", "a", "c");
        b.brace("bc", "b", "c");
        b.support("a", PINNED).support("b", PINNED);
        b.load("c", [0.0, 0.0, -1.0e3]);
        let r = b.run();
        assert_eq!(r.status(0), "unstable");
        assert_eq!(r.count(0, "mechanisms"), 1.0);
        let mode = &r.component(0).get("modes").unwrap().as_array().unwrap()[0];
        let shape = mode.get("displacements").unwrap().get("c").unwrap().as_array().unwrap();
        // The apex moves along Y only, and the shape is normalised to one.
        assert!((shape[1].as_f64().unwrap().abs() - 1.0).abs() < 1e-9);
        assert!(shape[0].as_f64().unwrap().abs() < 1e-9 && shape[2].as_f64().unwrap().abs() < 1e-9);

        // Hold the apex out of plane and the same truss is stable.
        b.support("c", [false, true, false, false, false, false]);
        assert_eq!(b.run().status(0), "stable");
    }

    // A rigid-jointed portal on pinned bases is stable in its plane, but its
    // columns lean over out of plane about the base pins.
    let mut b = Build::linear();
    portal(&mut b);
    b.model.foundations.clear();
    b.support("a", PINNED).support("b", PINNED);
    let r = b.run();
    assert_eq!(r.status(0), "unstable");
    assert_eq!(r.count(0, "mechanisms"), 1.0);
    assert!(r.reasons(0).contains(&"rigidBodyMotion"));
}

/// A member on ball joints can spin about its own axis. No load acts on that
/// spin, so it is reported but does not make the structure unstable; a torque
/// on a joint that nothing holds does.
#[test]
fn unloaded_spin_is_tolerated_and_loaded_spin_is_not() {
    for fidelity in [Fidelity::Linear, Fidelity::Nonlinear] {
        let mut b = Build::new();
        b.options.fidelity = fidelity;
        b.node("a", [0.0; 3]).node("c", [2.0, 0.0, 0.0]).node("b", [4.0, 0.0, 0.0]);
        b.beam("m1", "a", "c").start.laws = BALL;
        b.beam("m2", "c", "b").end.laws = BALL;
        b.support("a", PINNED).support("b", PINNED).load("c", [0.0, 0.0, -2.0e3]);
        let r = b.run();
        assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
        assert_eq!(r.count(0, "spinModes"), 1.0);
        assert_eq!(r.count(0, "mechanisms"), 0.0);
        close(r.reaction("a")[2], 1.0e3, 1e-6);

        b.moment("c", [50.0, 0.0, 0.0]);
        let r = b.run();
        assert_eq!(r.status(0), "unstable");
        assert!(r.reasons(0).contains(&"loadedSpinMode"));

        // A moment on a truss joint has nothing to act on.
        let mut b = Build::new();
        b.options.fidelity = fidelity;
        b.node("a", [0.0; 3]).node("b", [0.0, 0.0, 2.0]);
        b.brace("m", "a", "b");
        b.support("a", PINNED).support("b", [true, true, false, false, false, false]).moment("b", [0.0, 10.0, 0.0]);
        let r = b.run();
        assert_eq!(r.status(0), "unstable");
        assert!(r.reasons(0).contains(&"momentOnUnusedRotation"));
    }
}

/// A beam with one end fully released is not attached there: the node it
/// names stays in its own component.
#[test]
fn a_fully_released_end_is_not_a_connection() {
    let mut b = Build::linear();
    b.node("a", [0.0; 3]).node("b", [2.0, 0.0, 0.0]).node("far", [4.0, 0.0, 0.0]);
    b.beam("stub", "a", "b");
    b.beam("loose", "b", "far").end.laws = [Law::Free; 6];
    b.support("a", FIXED).load("far", [0.0, 0.0, -10.0]);
    let r = b.run();
    assert_eq!(r.components(), 2);
    // The loaded node has nothing holding it; the cantilever is unaffected.
    assert_eq!(r.component_of("far").get("status").unwrap().as_str(), Some("unstable"));
    assert_eq!(r.component_of("a").get("status").unwrap().as_str(), Some("stable"));
    assert_eq!(r.displacement("b"), [0.0; 6]);
}

/// The two-to-four-player load sharing of the shared frame also holds in the
/// nonlinear analysis: under gravity the supports carry exactly the applied
/// load, and each share stays within 0.1 % of the total load of the linear
/// share for these stiff, lightly loaded legs.
#[test]
fn shared_frame_load_sharing_holds_in_the_nonlinear_analysis() {
    let p = 1.2e5;
    let feet = [[4.0, 0.0, 0.0], [0.0, 4.0, 0.0], [-4.0, 0.0, 0.0], [0.0, -4.0, 0.0]];
    for areas in [[1.0, 1.0, 1.0, 1.0], [1.0, 3.0, 1.0, 3.0], [1.0, 2.0, 3.0, 4.0], [1.0, 2.5, 0.0, 4.0]] {
        let build = |fidelity: Fidelity| {
            let mut b = Build::new();
            b.options.fidelity = fidelity;
            b.node("hub", [0.0, 0.0, 3.0]);
            for (i, (foot, area)) in feet.iter().zip(areas).enumerate() {
                if area == 0.0 {
                    continue;
                }
                let mut section = steel(&format!("s{i}"));
                section.a = A * area;
                b.model.sections.push(section);
                b.node(&format!("p{i}"), *foot);
                b.brace(&format!("leg{i}"), "hub", &format!("p{i}")).section_id = format!("s{i}");
                b.support(&format!("p{i}"), PINNED);
            }
            b.load("hub", [0.0, 0.0, -p]);
            b.run()
        };
        let (linear, nonlinear) = (build(Fidelity::Linear), build(Fidelity::Nonlinear));
        assert_eq!(nonlinear.status(0), "stable", "{:?}", nonlinear.reasons(0));
        let mut total = 0.0;
        for i in 0..4 {
            if areas[i] == 0.0 {
                continue;
            }
            let (a, b) = (linear.reaction(&format!("p{i}"))[2], nonlinear.reaction(&format!("p{i}"))[2]);
            // Measured against the total load, because a share can be zero.
            assert!((b - a).abs() <= 1e-3 * p, "support p{i}: linear {a}, nonlinear {b}");
            total += b;
        }
        close(total, p, 1e-8);

/// A spin that lives only in a connection, such as a member on ball joints
/// at both ends turning about its own axis, moves no model node. It must not
/// be drawn as a movement of the nodes: scaling rounding noise up to one
/// once showed nodes g and h sliding by half a unit in this frame.
#[test]
fn connection_spins_are_not_drawn_as_node_movement() {
    let mut b = Build::linear();
    for (id, p) in [("a", [0.0, 0.0, 0.0]), ("b", [5.0, 0.0, 0.0]), ("c", [5.0, 4.0, 0.0]), ("d", [0.0, 4.0, 0.0]),
        ("e", [0.0, 0.0, 3.0]), ("f", [5.0, 0.0, 3.0]), ("g", [5.0, 4.0, 3.0]), ("h", [0.0, 4.0, 3.0])] {
        b.node(id, p);
    }
    for (id, s, e) in [("c1", "a", "e"), ("c2", "b", "f"), ("c3", "c", "g"), ("c4", "d", "h"), ("g1", "e", "f"), ("g2", "f", "g"), ("g3", "g", "h"), ("g4", "h", "e")] {
        let member = b.beam(id, s, e);
        member.start.laws = BALL;
        if id == "g2" {
            member.end.laws = BALL;
        }
    }
    for n in ["a", "b", "c", "d"] {
        b.support(n, PINNED);
    }
    let r = b.run();
    assert_eq!(r.status(0), "unstable");
    assert_eq!(r.count(0, "mechanisms"), 1.0);
    assert_eq!(r.count(0, "spinModes"), 2.0);
    let moving: Vec<&str> = r.component(0).get("unstableNodeIds").unwrap().as_array().unwrap().iter().map(|n| n.as_str().unwrap()).collect();
    assert_eq!(moving, ["f", "g", "h"]);
    for mode in r.component(0).get("modes").unwrap().as_array().unwrap() {
        if mode.get("kind").unwrap().as_str() != Some("spin") {
            continue;
        }
        let dof_solver::json::Json::Obj(nodes) = mode.get("displacements").unwrap() else { panic!("displacements must be an object") };
        for (node, values) in nodes {
            let values = values.as_array().unwrap();
            // A spin may turn a node in place, but never moves it.
            for v in &values[..3] {
                assert!(v.as_f64().unwrap().abs() < 1e-6, "spin moves node {node}: {}", mode.to_json_string());
            }
        }
    }
}
