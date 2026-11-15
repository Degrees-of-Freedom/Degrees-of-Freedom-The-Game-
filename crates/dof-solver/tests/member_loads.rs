//! Uniform loads along members.
//!
//! A uniform member load is applied the same way as self-weight, so it is
//! checked against the closed-form beam solutions and against the identical
//! self-weight case.

mod common;
use common::*;
use dof_solver::model::*;

const TIGHT: f64 = 1e-9;

fn member_load(b: &mut Build, id: &str, member: &str, force: [f64; 3]) {
    b.model.member_loads.push(MemberLoad { id: id.into(), member_id: member.into(), force });
}

/// Pin and roller with torsion held, span `l` along X.
fn simply_supported(l: f64) -> Build {
    let mut b = Build::linear();
    b.node("a", [0.0; 3]).node("b", [l, 0.0, 0.0]);
    b.beam("m", "a", "b").subdivisions = Some(4);
    b.support("a", [true, true, true, true, false, false]);
    b.support("b", [false, true, true, true, false, false]);
    b
}

/// Mid-span sag 5wL⁴/384EI, reactions wL/2, mid-span moment wL²/8.
#[test]
fn simply_supported_uniform_load() {
    let (l, w): (f64, f64) = (6.0, 2.0e3);
    let mut b = simply_supported(l);
    member_load(&mut b, "q", "m", [0.0, 0.0, -w]);
    let r = b.run();
    assert_eq!(r.status(0), "stable", "{:?}", r.reasons(0));
    let sag = r.at(&["members", "m", "deflection", "maxFromChord"]).as_f64().unwrap();
    close(sag, 5.0 * w * l.powi(4) / (384.0 * E * I), TIGHT);
    close(r.reaction("a")[2], w * l / 2.0, TIGHT);
    close(r.reaction("b")[2], w * l / 2.0, TIGHT);
    let applied = r.component(0).get("appliedForce").unwrap().as_array().unwrap()[2].as_f64().unwrap();
    close(applied, -w * l, TIGHT);
}

/// A member load equal to the self-weight gives the self-weight result.
#[test]
fn same_as_the_equivalent_self_weight() {
    let (l, rho, g) = (5.0, 7850.0, 9.81);
    let mut own = simply_supported(l);
    own.options.gravity = Some([0.0, 0.0, -g]);
    own.model.sections[0].density = rho;
    let mut applied = simply_supported(l);
    member_load(&mut applied, "q", "m", [0.0, 0.0, -rho * A * g]);
    let (a, b) = (own.run(), applied.run());
    for end in ["start", "end"] {
        let (fa, fb) = (a.forces("m", end), b.forces("m", end));
        for i in 0..6 {
            assert!((fa[i] - fb[i]).abs() <= 1e-9 * (1.0 + fa[i].abs()), "{end} {i}: {} vs {}", fa[i], fb[i]);
        }
    }
    close(b.reaction("a")[2], a.reaction("a")[2], TIGHT);
}

/// Several loads on one member add; the load factor scales them.
#[test]
fn loads_add_and_scale() {
    let l = 4.0;
    let mut b = simply_supported(l);
    member_load(&mut b, "q1", "m", [0.0, 0.0, -1.0e3]);
    member_load(&mut b, "q2", "m", [0.0, 0.0, -2.0e3]);
    b.options.load_factor = 2.0;
    close(b.run().reaction("a")[2], 2.0 * 3.0e3 * l / 2.0, TIGHT);
}

/// On a brace, half the load goes to each end node, like self-weight.
#[test]
fn brace_load_goes_to_its_ends() {
    let mut b = Build::linear();
    b.node("a", [0.0; 3]).node("b", [3.0, 0.0, 0.0]);
    b.brace("m", "a", "b");
    b.support("a", FIXED).support("b", FIXED);
    member_load(&mut b, "q", "m", [0.0, 0.0, -1.0e3]);
    let r = b.run();
    close(r.reaction("a")[2], 1.5e3, TIGHT);
    close(r.reaction("b")[2], 1.5e3, TIGHT);
}

/// Bad member loads are rejected with explicit diagnostics.
#[test]
fn invalid_member_loads_are_rejected() {
    let mut b = simply_supported(4.0);
    member_load(&mut b, "q", "nowhere", [0.0, 0.0, -1.0]);
    member_load(&mut b, "r", "m", [f64::NAN, 0.0, 0.0]);
    b.load("a", [0.0, 0.0, -1.0]);
    member_load(&mut b, "l0", "m", [0.0, 0.0, -1.0]);
    let r = b.run();
    assert_eq!(r.at(&["analysis", "status"]).as_str(), Some("invalid"));
    let codes: Vec<&str> = r.at(&["analysis", "reasonCodes"]).as_array().unwrap().iter().map(|c| c.as_str().unwrap()).collect();
    assert_eq!(codes, ["duplicateId", "nonFiniteInput", "unknownReference"]);
}

/// Member loads arrive through the JSON request, and a load case can replace them.
#[test]
fn json_requests_and_cases() {
    let request = r#"{
      "model": {
        "nodes": [{"id": "a", "position": [0, 0, 0]}, {"id": "b", "position": [4, 0, 0]}],
        "sections": [{"id": "s", "E": 210e9, "G": 81e9, "A": 7.49e-3, "Iy": 4.47e-5, "Iz": 4.47e-5, "J": 7.03e-5}],
        "members": [{"id": "m", "startNodeId": "a", "endNodeId": "b", "sectionId": "s"}],
        "foundations": [{"id": "fa", "nodeId": "a", "restrained": [true, true, true, true, true, true]}],
        "memberLoads": [{"id": "q", "memberId": "m", "force": [0, 0, -1000]}]
      },
      "options": {"fidelity": "linear"},
      "cases": [{"id": "model"}, {"id": "double", "memberLoads": [{"id": "q", "memberId": "m", "force": [0, 0, -2000]}]}, {"id": "none", "memberLoads": []}]
    }"#;
    let document = dof_solver::json::parse(&dof_solver::analyze_json(request)).unwrap();
    let cases = document.get("cases").unwrap().as_array().unwrap();
    let vertical = |i: usize| {
        let reaction = cases[i].get("result").unwrap().get("foundations").unwrap().get("fa").unwrap().get("reaction").unwrap();
        reaction.as_array().unwrap()[2].as_f64().unwrap()
    };
    close(vertical(0), 4.0e3, TIGHT);
    close(vertical(1), 8.0e3, TIGHT);
    zero(vertical(2), 4.0e3);
}
