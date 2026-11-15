//! The stiffness matrix of a system and its factorisation, chosen by size.
//!
//! Solver 0.3 has two factorisations with the same semantics (unit-diagonal
//! scaling, null pivots as exact restraints, inertia, solves and null
//! vectors):
//!
//! * [`crate::skyline`], solver 0.2's profile LDLᵀ in the equation order.
//!   Its work grows like the bandwidth squared, about n^(7/3) for a
//!   three-dimensional frame, but for a small system it is as fast as any.
//! * [`crate::sparse`], a supernodal multifrontal LDLᵀ in a fill-reducing
//!   order, for everything larger.
//!
//! A system whose skyline factorisation costs at most [`SMALL_WORK`]
//! multiply-adds (about a millisecond) keeps the skyline, so its results are
//! bit-for-bit those of solver 0.2. That covers every structure of game
//! size. Which DOF carries a null or negative pivot, the smallest pivot and
//! rounding depend on the elimination order; near the classification
//! thresholds (null and near-mechanism pivots, gauge ties) a different order
//! can therefore change a degenerate state's classification. Keeping the
//! order wherever speed does not require a new one confines those changes to
//! structures solver 0.2 could not analyse in useful time.

use crate::skyline::{self, Skyline};
use crate::sparse::{self, SparseMatrix, Symbolic};
use std::rc::Rc;

pub use crate::sparse::Inertia;

/// Multiply-adds of a skyline factorisation up to which a system keeps it.
pub const SMALL_WORK: f64 = 4.0e6;

thread_local! {
    static FORCED: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
}

/// For tests: make every system built on this thread use the sparse
/// factorisation (`Some(true)`) or the skyline (`Some(false)`) whatever its
/// size, or restore the choice by size (`None`).
#[doc(hidden)]
pub fn force_sparse(choice: Option<bool>) {
    FORCED.with(|f| f.set(choice));
}

/// The factorisation chosen for one system, with its precomputed structure.
pub enum Pattern {
    /// An empty matrix on the skyline profile, cloned for each stiffness.
    Profile(Skyline),
    Sparse(Rc<Symbolic>),
}

impl Pattern {
    /// Choose for the pattern in which every pair of DOFs that appear
    /// together in one of `groups` (one group per element) may be nonzero.
    pub fn new(n: usize, groups: &[Vec<usize>]) -> Self {
        let sparse = FORCED.with(|f| f.get()).unwrap_or_else(|| skyline_work(n, groups) > SMALL_WORK);
        if sparse {
            Pattern::Sparse(Rc::new(Symbolic::new(n, groups)))
        } else {
            Pattern::Profile(Skyline::with_profile(n, groups))
        }
    }

    /// A zero matrix on this pattern.
    pub fn matrix(&self) -> Stiffness {
        match self {
            Pattern::Profile(empty) => Stiffness::Profile(empty.clone()),
            Pattern::Sparse(sym) => Stiffness::Sparse(SparseMatrix::new(sym.clone())),
        }
    }

    /// Whether the sparse factorisation is used.
    pub fn is_sparse(&self) -> bool {
        matches!(self, Pattern::Sparse(_))
    }

    /// The sparse structure, if the sparse factorisation is used.
    pub fn symbolic(&self) -> Option<&Symbolic> {
        match self {
            Pattern::Sparse(sym) => Some(sym),
            Pattern::Profile(_) => None,
        }
    }
}

/// Multiply-adds of a skyline factorisation of the pattern: half the sum of
/// the squared column heights, each from the lowest DOF sharing an element
/// with that column. One pass over the groups, as the profile is built.
fn skyline_work(n: usize, groups: &[Vec<usize>]) -> f64 {
    let mut first: Vec<usize> = (0..n).collect();
    for group in groups {
        if let Some(&lowest) = group.iter().min() {
            for &dof in group {
                first[dof] = first[dof].min(lowest);
            }
        }
    }
    first.iter().enumerate().map(|(j, &f)| ((j - f) as f64).powi(2)).sum::<f64>() * 0.5
}

/// A symmetric stiffness matrix in the equation numbering of its system.
#[derive(Clone)]
pub enum Stiffness {
    Profile(Skyline),
    Sparse(SparseMatrix),
}

impl Stiffness {
    pub fn clear(&mut self) {
        match self {
            Stiffness::Profile(k) => k.clear(),
            Stiffness::Sparse(k) => k.clear(),
        }
    }

    /// Add `v` to the symmetric entry `(i, j)`.
    #[inline]
    pub fn add(&mut self, i: usize, j: usize, v: f64) {
        match self {
            Stiffness::Profile(k) => k.add(i, j, v),
            Stiffness::Sparse(k) => k.add(i, j, v),
        }
    }

    /// Remove a DOF from the system: clear its row and column and put one on
    /// the diagonal.
    pub fn constrain(&mut self, dof: usize) {
        match self {
            Stiffness::Profile(k) => k.constrain(dof),
            Stiffness::Sparse(k) => k.constrain(dof),
        }
    }

    /// Product with a vector, using the unfactored matrix.
    pub fn mul(&self, x: &[f64]) -> Vec<f64> {
        match self {
            Stiffness::Profile(k) => k.mul(x),
            Stiffness::Sparse(k) => k.mul(x),
        }
    }

    /// Factorise after scaling to a unit diagonal and adding `shift` to every
    /// scaled diagonal entry.
    pub fn factor(&self, shift: f64) -> Factor {
        match self {
            Stiffness::Profile(k) => {
                let mut f = k.factor(shift);
                Factor { inertia: std::mem::take(&mut f.inertia), kind: Kind::Profile(f) }
            }
            Stiffness::Sparse(k) => {
                let mut f = k.factor(shift);
                Factor { inertia: std::mem::take(&mut f.inertia), kind: Kind::Sparse(f) }
            }
        }
    }
}

#[derive(Clone)]
enum Kind {
    Profile(skyline::Factor),
    Sparse(sparse::Factor),
}

/// A factorised stiffness, ready for solves and null-vector extraction.
#[derive(Clone)]
pub struct Factor {
    pub inertia: Inertia,
    kind: Kind,
}

impl Factor {
    /// Solve `K x = b`. Components at null-pivot DOFs are zero.
    pub fn solve(&self, b: &[f64]) -> Vec<f64> {
        match &self.kind {
            Kind::Profile(f) => f.solve(b),
            Kind::Sparse(f) => f.solve(b),
        }
    }

    /// Direction associated with the pivot at `dof`: the null vector for a
    /// null pivot, or a direction of negative curvature for a negative one.
    pub fn pivot_vector(&self, dof: usize) -> Vec<f64> {
        match &self.kind {
            Kind::Profile(f) => f.pivot_vector(dof),
            Kind::Sparse(f) => f.pivot_vector(dof),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chain(n: usize) -> Vec<Vec<usize>> {
        (0..n - 1).map(|i| vec![i, i + 1]).collect()
    }

    #[test]
    fn small_systems_keep_the_skyline_and_large_ones_go_sparse() {
        assert!(!Pattern::new(200, &chain(200)).is_sparse());
        // A 3D grid of 6-DOF nodes far above the threshold.
        let side = 8;
        let id = |i: usize, j: usize, k: usize| (i * side + j) * side + k;
        let mut groups = Vec::new();
        for i in 0..side {
            for j in 0..side {
                for k in 0..side {
                    for (a, b, c) in [(i + 1, j, k), (i, j + 1, k), (i, j, k + 1)] {
                        if a < side && b < side && c < side {
                            let (p, q) = (id(i, j, k), id(a, b, c));
                            groups.push((0..6).map(|d| p * 6 + d).chain((0..6).map(|d| q * 6 + d)).collect());
                        }
                    }
                }
            }
        }
        let pattern = Pattern::new(side * side * side * 6, &groups);
        assert!(pattern.is_sparse() && pattern.symbolic().unwrap().reordered);
    }

    #[test]
    fn skyline_work_matches_the_neighbour_estimate() {
        let groups: Vec<Vec<usize>> = vec![vec![0, 4, 7], vec![2, 3], vec![1, 7, 9], vec![5, 6, 8, 9]];
        let estimate = crate::sparse::envelope_work(&crate::sparse::adjacency(10, &groups));
        assert_eq!(skyline_work(10, &groups), estimate);
    }

    #[test]
    fn both_storages_give_the_same_solution() {
        let n = 30;
        let groups = chain(n);
        let profile = Pattern::Profile(Skyline::with_profile(n, &groups));
        let sparse = Pattern::Sparse(Rc::new(Symbolic::with_ordering(n, &groups, true)));
        let (mut a, mut b) = (profile.matrix(), sparse.matrix());
        for k in [&mut a, &mut b] {
            for i in 0..n - 1 {
                k.add(i, i, 2.0);
                k.add(i + 1, i + 1, 1.0);
                k.add(i + 1, i, -1.0);
            }
            k.constrain(n - 1);
        }
        let rhs: Vec<f64> = (0..n).map(|i| if i == n - 1 { 0.0 } else { (i as f64).sin() }).collect();
        let (x, y) = (a.factor(0.0).solve(&rhs), b.factor(0.0).solve(&rhs));
        assert!(x.iter().zip(&y).all(|(p, q)| (p - q).abs() <= 1e-12 * x.iter().fold(1.0_f64, |m, v| m.max(v.abs()))));
        assert_eq!(a.mul(&rhs).len(), b.mul(&rhs).len());
    }
}
