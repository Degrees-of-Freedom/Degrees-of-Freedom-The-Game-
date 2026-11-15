//! Invariance, repeatability and robustness (criteria A08, section 4 replay,
//! and the symmetry, reordering, rotation and random-state acceptance rows).

mod common;
use common::*;
use dof_solver::json::Json;
use dof_solver::math::{exp_so3, mat_vec};
use dof_solver::model::*;

/// A small building that uses every element and connection type, with an
/// unsymmetric section so that member orientation matters.
fn building(fidelity: Fidelity) -> Build {
    let mut b = Build::new();
    b.options.fidelity = fidelity;
    b.options.gravity = Some([0.0, 0.0, -9.81]);
    b.model.sections[0].iz = 0.35 * I;
    b.model.sections[0].density = 7850.0;
    let mut rod = steel("rod");
    rod.a = 3.0e-4;
    rod.density = 7850.0;
    b.model.sections.push(rod);
    let corners = [[0.0, 0.0], [5.0, 0.0], [5.0, 4.0], [0.0, 4.0]];
    for (i, c) in corners.iter().enumerate() {
        b.node(&format!("base{i}"), [c[0], c[1], 0.0]).node(&format!("top{i}"), [c[0], c[1], 3.5]);
        b.beam(&format!("column{i}"), &format!("base{i}"), &format!("top{i}")).orientation = Some([1.0, 0.0, 0.0]);
        b.support(&format!("base{i}"), if i % 2 == 0 { FIXED } else { PINNED });
    }
    for i in 0..4 {
        let girder = b.beam(&format!("girder{i}"), &format!("top{i}"), &format!("top{}", (i + 1) % 4));
        girder.orientation = Some([0.0, 0.0, 1.0]);
        if i == 1 {
            girder.start.laws = HINGE;
        }
        if i == 2 {
            girder.end.laws[4] = Law::Elastic(3.0e6);
        }
    }
    b.brace("diagonal", "base0", "top1").section_id = "rod".into();
    let guy = b.cable("guy", "base1", "top2");
    guy.section_id = "rod".into();
    guy.initial_strain = Some(2.0e-4);
    b.cable("idle", "base3", "top0").section_id = "rod".into();
    b.load("top0", [6.0e3, 2.0e3, -4.0e4]).load("top2", [0.0, -3.0e3, -2.5e4]);
    b.moment("top1", [0.0, 800.0, 300.0]);
    b
}

fn rotate(b: &Build, r: &[[f64; 3]; 3]) -> Build {
    let mut out = b.clone();
    for node in &mut out.model.nodes {
        node.position = mat_vec(r, &node.position);
    }
    for member in &mut out.model.members {
        member.orientation = member.orientation.map(|o| mat_vec(r, &o));
    }
    for load in &mut out.model.loads {
        load.force = mat_vec(r, &load.force);
        load.moment = mat_vec(r, &load.moment);
    }
    out.options.gravity = out.options.gravity.map(|g| mat_vec(r, &g));
    out
}

#[track_caller]
fn same_vector(actual: [f64; 3], expected: [f64; 3], scale: f64) {
    for i in 0..3 {
        assert!((actual[i] - expected[i]).abs() <= 1e-6 * scale, "expected {expected:?}, got {actual:?}");
    }
}

/// Turning the whole model rigidly turns displacements and reactions with it
/// and leaves member forces in local axes, and every classification, alone.
#[test]
fn results_are_equivalent_under_rigid_rotation() {
    let r = exp_so3(&[0.3, -0.5, 0.8]);
    for fidelity in [Fidelity::Linear, Fidelity::Nonlinear] {
        let base = building(fidelity);
        let (a, b) = (base.run(), rotate(&base, &r).run());
        assert_eq!(a.status(0), "stable", "{:?}", a.reasons(0));
        assert_eq!(a.status(0), b.status(0));
        assert_eq!(a.reasons(0), b.reasons(0));
        let size = |v: [f64; 6]| v.iter().map(|x| x.abs()).fold(0.0, f64::max);
        let max_u = base.model.nodes.iter().map(|n| size(a.displacement(&n.id))).fold(0.0, f64::max);
        for node in &base.model.nodes {
            let (u, v) = (a.displacement(&node.id), b.displacement(&node.id));
            same_vector([v[0], v[1], v[2]], mat_vec(&r, &[u[0], u[1], u[2]]), max_u);
            same_vector([v[3], v[4], v[5]], mat_vec(&r, &[u[3], u[4], u[5]]), max_u);
        }
        for i in 0..4 {
            let (p, q) = (a.reaction(&format!("base{i}")), b.reaction(&format!("base{i}")));
            same_vector([q[0], q[1], q[2]], mat_vec(&r, &[p[0], p[1], p[2]]), 1.0e5);
            same_vector([q[3], q[4], q[5]], mat_vec(&r, &[p[3], p[4], p[5]]), 1.0e5);
        }
        for member in &base.model.members {
            assert_eq!(a.member(&member.id, "state"), b.member(&member.id, "state"));
            for end in ["start", "end"] {
                let (f, g) = (a.forces(&member.id, end), b.forces(&member.id, end));
                for k in 0..6 {
                    assert!((f[k] - g[k]).abs() <= 1e-6 * 1.0e5, "{} {end}: {f:?} vs {g:?}", member.id);
                }
            }
        }
    }
}

/// Listing nodes, members, foundations and loads in a different order gives
/// the same result to the last bit, and running twice does too.
#[test]
fn results_do_not_depend_on_input_order_and_repeat_exactly() {
    for fidelity in [Fidelity::Linear, Fidelity::Nonlinear] {
        let base = building(fidelity);
        let reference = base.run().0.to_json_string();
        assert_eq!(base.run().0.to_json_string(), reference);
        let mut shuffled = base.clone();
        shuffled.model.nodes.reverse();
        shuffled.model.members.reverse();
        shuffled.model.members.swap(1, 5);
        shuffled.model.foundations.rotate_left(2);
        shuffled.model.loads.reverse();
        shuffled.model.sections.reverse();
        assert_eq!(shuffled.run().0.to_json_string(), reference);
    }
}

/// Renaming every node changes the internal numbering; the physics must not
/// notice.
#[test]
fn results_do_not_depend_on_ids() {
    let base = building(Fidelity::Nonlinear);
    let rename = |id: &str| format!("{}-{id}", 9 - id.len() % 7);
    let mut renamed = base.clone();
    for node in &mut renamed.model.nodes {
        node.id = rename(&node.id);
    }
    for member in &mut renamed.model.members {
        member.start_node_id = rename(&member.start_node_id);
        member.end_node_id = rename(&member.end_node_id);
    }
    for foundation in &mut renamed.model.foundations {
        foundation.node_id = rename(&foundation.node_id);
    }
    for load in &mut renamed.model.loads {
        load.node_id = rename(&load.node_id);
    }
    let (a, b) = (base.run(), renamed.run());
    assert_eq!(a.status(0), b.status(0));
    for node in &base.model.nodes {
        let (u, v) = (a.displacement(&node.id), b.displacement(&rename(&node.id)));
        for k in 0..6 {
            assert!((u[k] - v[k]).abs() <= 1e-9 * 1e-2, "{u:?} vs {v:?}");
        }
    }
}

/// A mirror-symmetric frame under symmetric load has mirror-symmetric
/// reactions and no sway.
#[test]
fn symmetric_structure_has_symmetric_results() {
    for fidelity in [Fidelity::Linear, Fidelity::Nonlinear] {
        let mut b = Build::new();
        b.options.fidelity = fidelity;
        b.node("a", [-3.0, 0.0, 0.0]).node("b", [3.0, 0.0, 0.0]).node("c", [-3.0, 0.0, 4.0]).node("d", [3.0, 0.0, 4.0]);
        b.beam("left", "a", "c");
        b.beam("right", "b", "d");
        b.beam("top", "c", "d");
        b.support("a", FIXED).support("b", FIXED);
        b.load("c", [0.0, 0.0, -3.0e4]).load("d", [0.0, 0.0, -3.0e4]);
        let r = b.run();
        assert_eq!(r.status(0), "stable");
        let (left, right) = (r.reaction("a"), r.reaction("b"));
        close(left[2], 3.0e4, 1e-8);
        close(right[2], left[2], 1e-8);
        assert!((left[0] + right[0]).abs() < 1e-6 && (left[4] + right[4]).abs() < 1e-6);
        assert!((r.displacement("c")[0] + r.displacement("d")[0]).abs() < 1e-12);
    }
}

fn codes(result: &Json) -> Vec<String> {
    result.get("analysis").unwrap().get("reasonCodes").unwrap().as_array().unwrap().iter().map(|c| c.as_str().unwrap().to_string()).collect()
}

/// Every kind of bad input comes back as an `invalid` result with a reason
/// code; nothing panics and nothing is analysed.
#[test]
fn invalid_input_is_rejected_with_reason_codes() {
    let section = r#"{"id":"s","E":210e9,"G":81e9,"A":0.01,"Iy":1e-4,"Iz":1e-4,"J":1e-4}"#;
    let node = |id: &str, x: f64| format!(r#"{{"id":"{id}","position":[{x},0,0]}}"#);
    let member = |id: &str, a: &str, b: &str| format!(r#"{{"id":"{id}","startNodeId":"{a}","endNodeId":"{b}","sectionId":"s"}}"#);
    let request = |nodes: &str, members: &str, extra: &str| format!(r#"{{"model":{{"nodes":[{nodes}],"sections":[{section}],"members":[{members}]{extra}}}}}"#);
    let good = request(&format!("{},{}", node("a", 0.0), node("b", 1.0)), &member("m", "a", "b"), r#","foundations":[{"id":"f","nodeId":"a","restrained":[true,true,true,true,true,true]}]"#);
    let ok = dof_solver::json::parse(&dof_solver::analyze_json(&good)).unwrap();
    assert_eq!(ok.get("analysis").unwrap().get("status").unwrap().as_str(), Some("ok"));

    let cases: Vec<(String, &str)> = vec![
        ("".into(), "invalidInput"),
        ("{\"model\":".into(), "invalidInput"),
        ("[1,2,3]".into(), "invalidInput"),
        (r#"{"model":{"nodes":[]},"surprise":1}"#.into(), "invalidInput"),
        (r#"{"model":{"nodes":[{"id":"a","position":[0,0]}]}}"#.into(), "invalidInput"),
        (r#"{"model":{"nodes":[]},"options":{"fidelity":"exact"}}"#.into(), "invalidInput"),
        (request(&format!("{},{}", node("a", 0.0), node("a", 1.0)), "", ""), "duplicateId"),
        (request(&node("a", 0.0), &member("m", "a", "ghost"), ""), "unknownReference"),
        (request(&format!("{},{}", node("a", 0.0), node("b", 0.0)), &member("m", "a", "b"), ""), "zeroLength"),
        (good.replace("[1,0,0]", "[1e999,0,0]"), "nonFiniteInput"),
        (
            request(&node("a", 0.0), "", r#","foundations":[{"id":"f","nodeId":"a","restrained":[true,true,true,true,true,true]},{"id":"g","nodeId":"a","restrained":[true,true,true,false,false,false]}]"#),
            "redundantConstraint",
        ),
        (good.replace("210e9", "-1"), "invalidSection"),
        (good.replace(r#""sectionId":"s""#, r#""sectionId":"s","orientation":[2,0,0]"#), "invalidOrientation"),
        (good.replace(r#""sectionId":"s""#, r#""sectionId":"s","start":{"laws":["rigid","rigid","rigid","rigid",{"elastic":0},"rigid"]}"#), "invalidConnection"),
        (good.replace(r#""sectionId":"s""#, r#""sectionId":"s","initialStrain":0.1"#), "invalidMember"),
        (good.replace(r#"}}"#, r#"},"options":{"tolerance":0}}"#), "invalidOptions"),
    ];
    for (text, code) in cases {
        let result = dof_solver::json::parse(&dof_solver::analyze_json(&text)).unwrap();
        assert_eq!(result.get("analysis").unwrap().get("status").unwrap().as_str(), Some("invalid"), "{text}");
        assert!(codes(&result).contains(&code.to_string()), "{text} gave {:?}, expected {code}", codes(&result));
        assert!(result.get("components").unwrap().as_array().unwrap().is_empty());
    }
}

/// Stiffness ratios far beyond anything physical neither crash the solver
/// nor produce a non-finite or unverified "valid" result.
#[test]
fn extreme_stiffness_ratios_are_handled() {
    for stiffness in [1.0e-30, 1.0e-12, 1.0, 1.0e15, 1.0e30] {
        for fidelity in [Fidelity::Linear, Fidelity::Nonlinear] {
            let mut b = Build::new();
            b.options.fidelity = fidelity;
            b.node("a", [0.0; 3]).node("b", [3.0, 0.0, 0.0]);
            b.beam("m", "a", "b").start.laws[4] = Law::Elastic(stiffness);
            b.support("a", FIXED).load("b", [0.0, 0.0, -1.0e3]);
            let r = b.run();
            check_document(&r.0, &b.options);
            if stiffness >= 1.0e15 {
                // Indistinguishable from a rigid connection.
                assert_eq!(r.status(0), "stable");
                close(r.displacement("b")[2], -1.0e3 * 27.0 / (3.0 * E * I), 1e-6);
            }
            if stiffness <= 1.0e-12 {
                // Too soft to count as a restraint: never reported stable.
                assert_ne!(r.status(0), "stable");
            }
        }
    }
}

struct Random(u64);

impl Random {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn chance(&mut self, p: f64) -> bool {
        self.unit() < p
    }
    fn between(&mut self, low: f64, high: f64) -> f64 {
        low + (high - low) * self.unit()
    }
}

/// A random game-like state: members on a 3x3x3 grid with random types,
/// releases, springs, pretension, supports and loads. Some are deliberately
/// broken.
fn random_state(rng: &mut Random) -> Build {
    let mut b = Build::new();
    b.options.fidelity = if rng.chance(0.5) { Fidelity::Linear } else { Fidelity::Nonlinear };
    b.options.max_total_iterations = 60;
    b.options.subdivisions = 1 + rng.below(2) as u32;
    b.options.failure = if rng.chance(0.2) { FailureMode::Remove } else { FailureMode::Report };
    if rng.chance(0.3) {
        b.options.gravity = Some([0.0, 0.0, -9.81]);
        b.model.sections[0].density = 7850.0;
    }
    if rng.chance(0.3) {
        b.model.sections[0].capacity = Some(SectionCapacity { tension: Some(2.0e5), compression: Some(1.0e5), moment_y: Some(3.0e4), ..Default::default() });
    }
    let count = 2 + rng.below(8);
    let mut taken = [false; 27];
    for i in 0..count {
        // Distinct grid points, so that only deliberate cases are zero-length.
        let mut cell = rng.below(27);
        while taken[cell] {
            cell = (cell + 1) % 27;
        }
        taken[cell] = true;
        let position = [cell % 3, cell / 3 % 3, cell / 9].map(|c| 2.0 * c as f64);
        b.node(&format!("n{i}"), position);
    }
    for i in 0..rng.below(13) {
        let a = rng.below(count);
        let c = (a + 1 + rng.below(count - 1)) % count;
        let kind = match rng.below(20) {
            0..=11 => MemberKind::Beam,
            12..=16 => MemberKind::Brace,
            _ => MemberKind::Cable,
        };
        let pretension = rng.between(-0.01, 0.01);
        let mut laws = [[Law::Rigid; 6]; 2];
        for law in laws.iter_mut().flatten() {
            *law = match rng.below(20) {
                0..=16 => Law::Rigid,
                17..=18 => Law::Free,
                _ => Law::Elastic(10f64.powf(rng.between(-3.0, 12.0))),
            };
        }
        let strained = kind != MemberKind::Beam && rng.chance(0.3);
        let member = b.member(&format!("m{i}"), kind, &format!("n{a}"), &format!("n{c}"));
        member.start.laws = laws[0];
        member.end.laws = laws[1];
        if strained {
            member.initial_strain = Some(pretension);
        }
    }
    for _ in 0..1 + rng.below(4) {
        let node = format!("n{}", rng.below(count));
        if b.model.foundations.iter().any(|f| f.node_id == node) {
            continue;
        }
        let flags = if rng.chance(0.75) { FIXED } else { [0; 6].map(|_| rng.chance(0.5)) };
        b.support(&node, flags);
    }
    for _ in 0..rng.below(4) {
        let node = format!("n{}", rng.below(count));
        let force = [0, 1, 2].map(|_| rng.between(-1.0e4, 1.0e4));
        b.load(&node, force);
        if rng.chance(0.2) {
            b.moment(&node, [0.0, rng.between(-1.0e3, 1.0e3), 0.0]);
        }
    }
    if rng.chance(0.06) {
        match rng.below(5) {
            0 => b.model.nodes[0].position[1] = f64::NAN,
            4 => b.model.nodes[1].position = b.model.nodes[0].position,
            1 => b.model.nodes[0].id = "n1".into(),
            2 => b.model.sections[0].e = -1.0,
            _ => b.model.loads.push(Load { id: "bad".into(), node_id: "nowhere".into(), force: [f64::INFINITY, 0.0, 0.0], moment: [0.0; 3] }),
        }
    }
    b
}

fn all_finite(value: &Json) -> bool {
    match value {
        Json::Num(v) => v.is_finite(),
        Json::Arr(items) => items.iter().all(all_finite),
        Json::Obj(fields) => fields.iter().all(|(_, v)| all_finite(v)),
        _ => true,
    }
}

/// The promises every result must keep, whatever the input.
fn check_document(result: &Json, options: &Options) -> Vec<String> {
    assert!(all_finite(result), "non-finite number in {}", result.to_json_string());
    let text = result.to_json_string();
    assert_eq!(&dof_solver::json::parse(&text).unwrap(), result);
    let mut statuses = Vec::new();
    let nodes = result.get("nodes").unwrap();
    let foundations = result.get("foundations").unwrap();
    for component in result.get("components").unwrap().as_array().unwrap() {
        let status = component.get("status").unwrap().as_str().unwrap();
        assert!(["stable", "marginal", "unstable", "unknown"].contains(&status));
        let valid = component.get("resultsValid").unwrap().as_bool().unwrap();
        let id = component.get("id").unwrap();
        // Stable or marginal always comes with verified results; unknown never does.
        assert!(valid || (status != "stable" && status != "marginal"), "{text}");
        assert!(!(valid && status == "unknown"), "{text}");
        if valid {
            let convergence = component.get("convergence").unwrap();
            assert!(convergence.get("residual").unwrap().as_f64().unwrap() <= options.residual_gate);
            assert!(convergence.get("forceImbalance").unwrap().as_f64().unwrap() <= options.residual_gate);
            // Reactions balance the applied load on this component.
            let applied = component.get("appliedForce").unwrap().as_array().unwrap();
            let reaction = component.get("reactionForce").unwrap().as_array().unwrap();
            // One newton of slack covers prestressed states with no load.
            let scale = applied.iter().map(|v| v.as_f64().unwrap().abs()).fold(0.0, f64::max);
            for i in 0..3 {
                assert!((applied[i].as_f64().unwrap() + reaction[i].as_f64().unwrap()).abs() <= 1e-4 * scale + 1.0, "{text}");
            }
        }
        for node in component.get("nodeIds").unwrap().as_array().unwrap() {
            let entry = nodes.get(node.as_str().unwrap()).unwrap();
            assert_eq!(entry.get("componentId").unwrap(), id);
            assert_eq!(entry.get("displacement").unwrap().as_array().is_some(), valid, "{text}");
        }
        statuses.push(status.to_string());
    }
    if let Json::Obj(entries) = foundations {
        for (_, foundation) in entries {
            let valid = foundation.get("valid").unwrap().as_bool().unwrap();
            assert_eq!(foundation.get("reaction").unwrap().as_array().is_some(), valid, "{text}");
        }
    }
    statuses
}

/// Ten thousand seeded random states: no panic, no non-finite number, no
/// result marked valid without a verified equilibrium, and the same answer
/// when a state is analysed again. The work is split over threads, each with
/// its own fixed seed, so the set of states is the same on every run.
#[test]
fn ten_thousand_seeded_states_never_fail_unhandled() {
    seeded_sweep(1_250, None);
}

/// The same states with every system on the sparse factorisation, which
/// otherwise only large structures use: the result-document guarantees must
/// hold for both.
#[test]
fn seeded_states_through_the_sparse_factorisation_never_fail_unhandled() {
    seeded_sweep(500, Some(true));
}

fn seeded_sweep(cases_per_thread: usize, sparse: Option<bool>) {
    const THREADS: u64 = 8;
    let sweep = |seed: u64| {
        dof_solver::linalg::force_sparse(sparse);
        let mut rng = Random(seed);
        let mut tally = std::collections::BTreeMap::new();
        for case in 0..cases_per_thread {
            let state = random_state(&mut rng);
            let result = state.run().0;
            let status = result.get("analysis").unwrap().get("status").unwrap().as_str().unwrap().to_string();
            if status == "invalid" {
                assert!(!codes(&result).is_empty());
                *tally.entry("invalid input".to_string()).or_insert(0) += 1;
            } else {
                for status in check_document(&result, &state.options) {
                    *tally.entry(status).or_insert(0) += 1;
                }
            }
            if case % 50 == 0 {
                assert_eq!(state.run().0.to_json_string(), result.to_json_string(), "seed {seed} case {case} did not repeat");
            }
        }
        tally
    };
    let mut tally = std::collections::BTreeMap::new();
    std::thread::scope(|scope| {
        let workers: Vec<_> = (0..THREADS).map(|i| scope.spawn(move || sweep(0x9E37_79B9_7F4A_7C15 ^ (i + 1).wrapping_mul(0xD1B5_4A32_D192_ED03)))).collect();
        for worker in workers {
            for (status, count) in worker.join().expect("a seeded state made the solver panic") {
                *tally.entry(status).or_insert(0) += count;
            }
        }
    });
    let total = cases_per_thread * THREADS as usize;
    println!("component outcomes over {total} seeded states: {tally:?}");
    // Each outcome must make up more than 3 % of the states (300 of 10,000).
    for outcome in ["stable", "unstable", "invalid input"] {
        assert!(tally.get(outcome).copied().unwrap_or(0) > total * 3 / 100, "the generator produced too few '{outcome}' cases");
    }
}

/// Arbitrary bytes and truncated requests are answered, never thrown.
#[test]
fn malformed_requests_never_panic() {
    let mut rng = Random(42);
    let valid = r#"{"model":{"nodes":[{"id":"a","position":[0,0,0]},{"id":"b","position":[1,0,0]}],"sections":[{"id":"s","E":2e11,"A":0.01}],"members":[{"id":"m","kind":"brace","startNodeId":"a","endNodeId":"b","sectionId":"s"}]},"options":{"fidelity":"linear"}}"#;
    for _ in 0..3_000 {
        let mut bytes = valid.as_bytes().to_vec();
        for _ in 0..1 + rng.below(4) {
            let at = rng.below(bytes.len());
            match rng.below(3) {
                0 => bytes[at] = b" {}[],:\"0-9eE.tfn\\"[rng.below(18)],
                1 => bytes.truncate(at.max(1)),
                _ => bytes.insert(at, b"[{\"9,"[rng.below(5)]),
            }
        }
        if let Ok(text) = String::from_utf8(bytes) {
            let result = dof_solver::json::parse(&dof_solver::analyze_json(&text)).expect("the result is always valid JSON");
            assert!(all_finite(&result));
        }
    }
}
