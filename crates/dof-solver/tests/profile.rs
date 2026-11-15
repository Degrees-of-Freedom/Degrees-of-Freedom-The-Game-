//! Phase timings on the stress frame. Not a correctness test: run with
//! `cargo test --release --test profile -- --ignored --nocapture`.

mod common;
use common::*;
use dof_solver::model::*;
use dof_solver::system::{Config, Index, System};
use std::time::Instant;

/// The braced multi-storey frame used by `scripts/bench-solver.mjs`.
fn frame(bays_x: usize, bays_y: usize, storeys: usize) -> Build {
    let mut b = Build::new();
    b.model.sections[0].density = 7850.0;
    let mut rod = steel("rod");
    rod.a = 3.0e-4;
    rod.density = 7850.0;
    b.model.sections.push(rod);
    b.options.gravity = Some([0.0, 0.0, -9.81]);
    let id = |i: usize, j: usize, k: usize| format!("{i}-{j}-{k}");
    let mut count = 0;
    let mut name = || {
        count += 1;
        format!("m{count}")
    };
    for k in 0..=storeys {
        for j in 0..=bays_y {
            for i in 0..=bays_x {
                b.node(&id(i, j, k), [4.0 * i as f64, 4.0 * j as f64, 3.0 * k as f64]);
                if k == 0 {
                    b.support(&id(i, j, 0), FIXED);
                    continue;
                }
                b.beam(&name(), &id(i, j, k - 1), &id(i, j, k));
                b.load(&id(i, j, k), [if k == storeys { 2.0e3 } else { 0.0 }, 5.0e2, -2.0e4]);
                if i > 0 {
                    let hinged = (i + j + k) % 3 == 0;
                    let beam = b.beam(&name(), &id(i - 1, j, k), &id(i, j, k));
                    if hinged {
                        beam.start.laws = HINGE;
                        beam.end.laws = HINGE;
                    }
                }
                if j > 0 {
                    b.beam(&name(), &id(i, j - 1, k), &id(i, j, k));
                }
                if i > 0 && j == 0 {
                    let kind = if i % 2 == 1 { MemberKind::Cable } else { MemberKind::Brace };
                    b.member(&name(), kind, &id(i - 1, j, k - 1), &id(i, j, k)).section_id = "rod".into();
                }
            }
        }
    }
    b
}

#[test]
#[ignore]
fn phase_timings() {
    for (label, subdivisions) in [("1 element per beam", 1), ("2 elements per beam", 2)] {
        let mut b = frame(5, 4, 6);
        b.options.subdivisions = subdivisions;
        let mut model = b.model.clone();
        model.nodes.sort_by(|x, y| x.id.cmp(&y.id));
        model.members.sort_by(|x, y| x.id.cmp(&y.id));
        model.sections.sort_by(|x, y| x.id.cmp(&y.id));
        model.foundations.sort_by(|x, y| x.id.cmp(&y.id));
        let index = Index::new(&model);
        let nodes: Vec<usize> = (0..model.nodes.len()).collect();
        let members: Vec<usize> = (0..model.members.len()).collect();

        let t = Instant::now();
        let sys = System::build(&index, &nodes, &members, &b.options);
        let build = t.elapsed();
        let state = sys.reference();
        let mut k = sys.stiffness();
        let t = Instant::now();
        let _ = sys.evaluate(&Config::Nonlinear(&state), Some(&mut k));
        let assemble = t.elapsed();
        let t = Instant::now();
        let _ = sys.energy(&state);
        let energy = t.elapsed();
        let t = Instant::now();
        let factor = k.factor(0.0);
        let factorise = t.elapsed();
        let t = Instant::now();
        let _ = factor.solve(&sys.load_vector());
        let solve = t.elapsed();
        println!(
            "{label}: {} members, {} equations, {} beam elements\n  build {build:?}, assemble {assemble:?}, energy {energy:?}, factorise {factorise:?}, solve {solve:?}",
            model.members.len(),
            sys.neq,
            sys.segs.len(),
        );
        for fidelity in [Fidelity::Linear, Fidelity::Nonlinear] {
            b.options.fidelity = fidelity;
            let t = Instant::now();
            let r = b.run();
            println!("  {fidelity:?} analysis {:?} ({})", t.elapsed(), r.status(0));
        }
    }
}
