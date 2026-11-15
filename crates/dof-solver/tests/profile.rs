//! Phase timings on the stress frame. Not a correctness test: run with
//! `cargo test --release --test profile -- --ignored --nocapture`.

mod common;
use common::*;
use dof_solver::model::*;
use dof_solver::system::{Config, Index, System};
use std::time::Instant;

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
