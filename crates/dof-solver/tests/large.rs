//! Large structures, which use the sparse factorisation (see `linalg`).
//!
//! Every other acceptance test is small enough to keep the skyline. Here the
//! same analyses run on both factorisations: classifications must agree, and
//! results to the rounding of the two elimination orders. Where the two
//! disagree on a count (a rounding-sized pivot near the null threshold), the
//! sparse factor is checked against the exact null space instead.

mod common;
use common::*;
use dof_solver::json::Json;
use dof_solver::linalg::force_sparse;
use dof_solver::model::*;
use dof_solver::system::{Config, Index, System};

/// The system of a model with one component, with the model it indexes.
fn with_system<T>(b: &Build, f: impl FnOnce(&System) -> T) -> T {
    let mut model = b.model.clone();
    model.nodes.sort_by(|x, y| x.id.cmp(&y.id));
    model.members.sort_by(|x, y| x.id.cmp(&y.id));
    model.sections.sort_by(|x, y| x.id.cmp(&y.id));
    model.foundations.sort_by(|x, y| x.id.cmp(&y.id));
    let index = Index::new(&model);
    let nodes: Vec<usize> = (0..model.nodes.len()).collect();
    let members: Vec<usize> = (0..model.members.len()).collect();
    f(&System::build(&index, &nodes, &members, &b.options))
}

/// Whether the one component of `b` gets the sparse factorisation by size.
fn uses_sparse(b: &Build) -> bool {
    with_system(b, |sys| sys.pattern().is_sparse())
}

/// The result with the factorisation chosen by size, and with the skyline.
fn both(b: &Build) -> (Run, Run) {
    assert!(uses_sparse(b), "the model is too small to test the sparse factorisation");
    force_sparse(None);
    let sparse = b.run();
    force_sparse(Some(false));
    let skyline = b.run();
    force_sparse(None);
    (sparse, skyline)
}

/// The fields of a JSON object, in order.
fn fields(value: &Json) -> &[(String, Json)] {
    match value {
        Json::Obj(fields) => fields,
        other => panic!("expected an object, got {}", other.to_json_string()),
    }
}

/// Largest magnitude of the numbers in an array of arrays (`null` skipped).
fn largest(values: &[&Json]) -> f64 {
    values.iter().filter_map(|v| v.as_array()).flatten().filter_map(|x| x.as_f64()).fold(0.0, |m, x| m.max(x.abs()))
}

/// Same classification, mode counts and validity; nodal displacements,
/// reactions and member end forces equal within `tolerance` of each field's
/// largest value.
fn agree(a: &Run, b: &Run, tolerance: f64) {
    agree_except(a, b, tolerance, &[]);
}

/// [`agree`], without comparing the named fields of `counts`.
fn agree_except(a: &Run, b: &Run, tolerance: f64, skip: &[&str]) {
    assert_eq!(a.components(), b.components());
    for c in 0..a.components() {
        let (x, y) = (a.component(c), b.component(c));
        for field in ["status", "reasonCodes", "flags", "resultsValid", "unstableTangent", "criticalLoadFactor"] {
            assert_eq!(x.get(field).map(|v| v.to_json_string()), y.get(field).map(|v| v.to_json_string()), "component {c} {field}");
        }
        for (name, value) in fields(x.get("counts").unwrap()) {
            if !skip.contains(&name.as_str()) {
                assert_eq!(Some(value.to_json_string()), y.get("counts").unwrap().get(name).map(|v| v.to_json_string()), "component {c} count {name}");
            }
        }
    }
    for (group, field) in [("nodes", "displacement"), ("foundations", "reaction")] {
        let (xs, ys) = (fields(a.at(&[group])), fields(b.at(&[group])));
        let scale = largest(&xs.iter().filter_map(|(_, v)| v.get(field)).collect::<Vec<_>>()).max(1e-300);
        for ((id, x), (_, y)) in xs.iter().zip(ys) {
            let (x, y) = (x.get(field).unwrap(), y.get(field).unwrap());
            if let (Some(x), Some(y)) = (x.as_array(), y.as_array()) {
                for (p, q) in x.iter().zip(y) {
                    let (p, q) = (p.as_f64().unwrap(), q.as_f64().unwrap());
                    assert!((p - q).abs() <= tolerance * scale, "{group} {id} {field}: {p} vs {q}");
                }
            } else {
                assert_eq!(x.to_json_string(), y.to_json_string(), "{group} {id} {field}");
            }
        }
    }
    let (xs, ys) = (fields(a.at(&["members"])), fields(b.at(&["members"])));
    fn ends(m: &Json) -> Option<[Option<&Json>; 2]> {
        m.get("forces").map(|f| [f.get("start"), f.get("end")])
    }
    let scale = largest(&xs.iter().filter_map(|(_, m)| ends(m)).flatten().flatten().collect::<Vec<_>>()).max(1e-300);
    for ((id, x), (_, y)) in xs.iter().zip(ys) {
        match (ends(x), ends(y)) {
            (Some([Some(p0), Some(p1)]), Some([Some(q0), Some(q1)])) => {
                for (p, q) in [(p0, q0), (p1, q1)] {
                    for (u, v) in p.as_array().unwrap().iter().zip(q.as_array().unwrap()) {
                        let (u, v) = (u.as_f64().unwrap(), v.as_f64().unwrap());
                        assert!((u - v).abs() <= tolerance * scale, "member {id} forces: {u} vs {v}");
                    }
                }
            }
            (p, q) => assert_eq!(p.is_some(), q.is_some(), "member {id} forces"),
        }
    }
}

#[test]
fn stress_frame_agrees_across_factorisations() {
    for subdivisions in [1, 2] {
        for fidelity in [Fidelity::Linear, Fidelity::Nonlinear] {
            let mut b = frame(5, 4, 6);
            b.options.subdivisions = subdivisions;
            b.options.fidelity = fidelity;
            let (sparse, skyline) = both(&b);
            assert_eq!(sparse.status(0), "stable");
            // Linear: one solve, rounding only. Nonlinear: both are within
            // the equilibrium tolerance of the same state.
            agree(&sparse, &skyline, if fidelity == Fidelity::Linear { 1e-9 } else { 1e-7 });
        }
    }
}

#[test]
fn large_mechanism_is_found_by_both() {
    // Pin every base and hinge every girder: nothing resists sway across
    // the bays, which the braces of the first bay line only stop along it.
    let mut b = frame(5, 4, 6);
    for f in &mut b.model.foundations {
        f.restrained = PINNED;
    }
    let heights: std::collections::BTreeMap<String, f64> = b.model.nodes.iter().map(|n| (n.id.clone(), n.position[2])).collect();
    for m in &mut b.model.members {
        if m.kind == MemberKind::Beam && heights[&m.start_node_id] == heights[&m.end_node_id] {
            m.start.laws = HINGE;
            m.end.laws = HINGE;
        }
    }
    // The first-order classification (a nonlinear analysis of a sway
    // mechanism this size ends unresolved after its recovery attempts).
    b.options.fidelity = Fidelity::Linear;
    let (sparse, skyline) = both(&b);
    assert_eq!(sparse.status(0), "unstable");
    assert!(sparse.reasons(0).contains(&"mechanism"));
    assert_eq!(sparse.count(0, "mechanisms"), 1.0);
    // The spin count (and the indeterminacy derived from it) differs:
    // checked below.
    agree_except(&sparse, &skyline, 0.0, &["spinModes", "staticIndeterminacy"]);
    // The undeformed stiffness has 31 zero-energy motions. The sparse factor
    // finds all of them, each a null vector to rounding, with a clear gap to
    // the smallest positive pivot. The skyline keeps one of them as a
    // rounding-sized pivot of 2.6e-10, just above the null threshold, and so
    // reports one spin fewer.
    let nulls = |sparse: bool| {
        force_sparse(Some(sparse));
        let (count, residual, gap) = with_system(&b, |sys| {
            let zeros = vec![0.0; sys.neq];
            let active: Vec<bool> = sys.bars.iter().map(|x| !x.geom.cable || x.geom.initial_force() >= 0.0).collect();
            let mut k = sys.stiffness();
            sys.evaluate(&Config::Linear { x: &zeros, active: &active }, Some(&mut k));
            let factor = k.factor(0.0);
            let diagonal = (0..sys.neq)
                .map(|i| {
                    let mut e = vec![0.0; sys.neq];
                    e[i] = 1.0;
                    k.mul(&e)[i].abs()
                })
                .fold(0.0_f64, f64::max);
            let residual = factor.inertia.null.iter().fold(0.0_f64, |worst, &dof| {
                let v = factor.pivot_vector(dof);
                let size = v.iter().fold(0.0_f64, |m, x| m.max(x.abs()));
                let kv = k.mul(&v).iter().fold(0.0_f64, |m, x| m.max(x.abs()));
                worst.max(kv / (diagonal * size))
            });
            (factor.inertia.null.len(), residual, factor.inertia.min_pivot)
        });
        force_sparse(None);
        (count, residual, gap)
    };
    let (count, residual, gap) = nulls(true);
    assert_eq!(count, 31);
    assert!(residual < 1e-12, "null-vector residual {residual}");
    assert!(gap > 1e-5, "smallest positive pivot {gap}");
    let (skyline_count, _, skyline_gap) = nulls(false);
    assert_eq!(skyline_count, 30);
    assert!(skyline_gap < 1e-9);
}

/// A grid of fixed-base columns tied by girders, loaded concentrically at
/// the top. The straight state is an equilibrium at any load, so past the
/// buckling load it is converged and unstable.
fn columns(side: usize, storeys: usize, load: f64) -> Build {
    let mut b = Build::new();
    b.options.fidelity = Fidelity::Nonlinear;
    let id = |i: usize, j: usize, k: usize| format!("{i}-{j}-{k}");
    let mut count = 0;
    let mut name = || {
        count += 1;
        format!("m{count}")
    };
    for k in 0..=storeys {
        for j in 0..side {
            for i in 0..side {
                b.node(&id(i, j, k), [4.0 * i as f64, 4.0 * j as f64, 3.0 * k as f64]);
                if k == 0 {
                    b.support(&id(i, j, 0), FIXED);
                    continue;
                }
                b.beam(&name(), &id(i, j, k - 1), &id(i, j, k));
                if i > 0 {
                    b.beam(&name(), &id(i - 1, j, k), &id(i, j, k));
                }
                if j > 0 {
                    b.beam(&name(), &id(i, j - 1, k), &id(i, j, k));
                }
                if k == storeys {
                    b.load(&id(i, j, k), [0.0, 0.0, -load]);
                }
            }
        }
    }
    b
}

#[test]
fn large_buckling_and_critical_load_agree() {
    let (sparse, skyline) = both(&columns(6, 3, 1.0e7));
    assert_eq!(sparse.status(0), "unstable");
    assert_eq!(sparse.reasons(0), vec!["loadInducedInstability"]);
    // Inertia does not depend on the elimination order, nor (here) does any
    // step of the critical-load bisection.
    assert_eq!(sparse.component(0).get("unstableTangent").unwrap().to_json_string(), r#"{"negativePivots":13,"mechanisms":0}"#);
    agree(&sparse, &skyline, 0.0);
    let critical = sparse.number(0, "criticalLoadFactor");
    assert!(critical > 0.5 && critical < 0.55, "{critical}");
    // Below the critical load the same grid is stable and verified.
    let (sparse, skyline) = both(&columns(6, 3, 0.4e7));
    assert_eq!(sparse.status(0), "stable");
    agree(&sparse, &skyline, 1e-7);
}

#[test]
fn large_stability_reserve_agrees_across_factorisations() {
    // Below its buckling load (critical factor 0.52 of 1e7 N per column):
    // a reserve of about 1.3 by either search.
    for method in [ReserveMethod::Linearized, ReserveMethod::Path] {
        let mut b = columns(6, 3, 0.4e7);
        b.options.reserve_search = 4.0;
        b.options.reserve_method = method;
        let (sparse, skyline) = both(&b);
        assert_eq!(sparse.status(0), "stable", "{method:?}");
        let reserve = |r: &Run| r.component(0).get("reserve").unwrap().to_json_string();
        let text = reserve(&sparse);
        let lower = sparse.component(0).get("reserve").unwrap().get("lower").unwrap().as_f64().unwrap();
        assert!(lower > 1.1 && lower < 1.5, "{method:?}: {text}");
        assert!(text.contains("\"cause\":\"instability\""), "{method:?}: {text}");
        // Each probe's verdict agrees, so the brackets are the same.
        assert_eq!(text, reserve(&skyline), "{method:?}");
        agree(&sparse, &skyline, 1e-7);
    }
}
