//! Finite kinematic mechanisms in the reference configuration. A connected
//! subtree held by a single free hinge can rotate as a rigid body through a
//! finite angle. Every member strain is constant throughout that motion.
//! Two ends tying the same body back to ground invalidate this construction.

use crate::math::{col, cross, mat_vec, sub, IDENTITY};
use crate::system::{System, RESTRAINED};

/// True when exact free-branch rotations span every translational null mode
/// of the reference tangent. This certifies a mechanism in the placed
/// structure, even if equilibrium in a displaced configuration is unknown.
pub fn spans_reference_modes(sys: &System, modes: &[Vec<f64>]) -> bool {
    if modes.is_empty() || modes.len() > 96 {
        return false;
    }
    let edges: Vec<_> = sys.segs.iter().map(|s| s.n).chain(sys.bars.iter().map(|b| b.n)).collect();
    let mut graph = vec![Vec::new(); sys.anodes.len()];
    for (edge, &[a, b]) in edges.iter().enumerate() {
        graph[a].push((edge, b));
        graph[b].push((edge, a));
    }
    let mut basis: Vec<Vec<f64>> = Vec::new();
    let mut visited_nodes = 0;
    for (edge, ends) in edges.iter().enumerate() {
        for side in 0..2 {
            let axes: Vec<_> = if let Some(seg) = sys.segs.get(edge) {
                let g = &seg.geom;
                (0..3).filter(|axis| {
                    let i = 6 * side + 3 + axis;
                    g.conn_var[i] && g.conn_k[i] == 0.0
                }).map(|axis| {
                    let local = g.connector_basis[side].as_ref().map_or(IDENTITY[axis], |m| col(m, axis));
                    mat_vec(&g.e0, &local)
                }).collect()
            } else {
                // The pinned axial law preserves length about every axis.
                IDENTITY.to_vec()
            };
            if axes.is_empty() { continue; }
            let pivot = ends[side];
            let mut seen = vec![false; graph.len()];
            let mut body = vec![ends[1 - side]];
            seen[body[0]] = true;
            let mut i = 0;
            let mut free = true;
            while i < body.len() {
                let node = body[i];
                i += 1;
                visited_nodes += 1;
                // Bound the diagnostic separately from the equilibrium
                // iterations. Exceeding this work yields no certificate.
                if visited_nodes > 1_000_000 { return false; }
                if node == pivot || sys.anodes[node].eq.contains(&RESTRAINED) {
                    free = false;
                    break;
                }
                for &(next_edge, next) in &graph[node] {
                    if next_edge != edge && !seen[next] {
                        seen[next] = true;
                        body.push(next);
                    }
                }
            }
            if !free { continue; }
            for axis in axes {
                let mut v = vec![0.0; sys.neq];
                for &node in &body {
                    let motion = cross(&axis, &sub(&sys.anodes[node].pos, &sys.anodes[pivot].pos));
                    for (eq, dx) in sys.anodes[node].eq[..3].iter().zip(motion) {
                        if *eq >= 0 { v[*eq as usize] = dx; }
                    }
                }
                let original = norm(&v);
                remove_span(&mut v, &basis);
                let remaining = norm(&v);
                if remaining > original * 1e-7 && remaining > 0.0 {
                    v.iter_mut().for_each(|x| *x /= remaining);
                    basis.push(v);
                    if basis.len() > modes.len() { return false; }
                }
            }
        }
    }
    basis.len() == modes.len() && modes.iter().all(|mode| {
        let mut translations: Vec<_> = mode.iter().zip(&sys.eq_rot).map(|(&x, &rotation)| if rotation {0.0} else {x}).collect();
        let original = norm(&translations);
        remove_span(&mut translations, &basis);
        original > 0.0 && norm(&translations) <= 1e-6 * original
    })
}

fn norm(v: &[f64]) -> f64 {
    v.iter().map(|x| x * x).sum::<f64>().sqrt()
}

fn remove_span(v: &mut [f64], basis: &[Vec<f64>]) {
    for axis in basis {
        let along: f64 = v.iter().zip(axis).map(|(x, y)| x * y).sum();
        v.iter_mut().zip(axis).for_each(|(x, y)| *x -= along * y);
    }
}
