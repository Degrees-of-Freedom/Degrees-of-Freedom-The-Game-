//! Symmetric skyline (profile) storage with an LDLᵀ factorisation that reports
//! the inertia of the matrix instead of failing on a singular one.
//!
//! The matrix is scaled to a unit diagonal before factorisation, so pivots are
//! dimensionless: a pivot is the stiffness left at a DOF once earlier DOFs are
//! condensed out, relative to its own diagonal stiffness. A pivot near zero is
//! a zero-stiffness motion (mechanism); a negative pivot means the matrix is
//! indefinite (a tangent stiffness past a critical point).
//!
//! A DOF with a null pivot is removed from the system exactly: its solution
//! component is zero and it does not influence later columns. That is an exact
//! restraint, not a penalty spring, and the null vector it belongs to is
//! recovered from the factor.

/// Pivots of the unit-diagonal matrix at or below this are treated as zero.
pub const NULL_PIVOT: f64 = 1e-10;

#[derive(Clone)]
pub struct Skyline {
    n: usize,
    /// First stored row of each column.
    first: Vec<usize>,
    /// Offset of each column in `a`; column `j` holds rows `first[j]..=j`.
    ptr: Vec<usize>,
    a: Vec<f64>,
}

/// Outcome of a factorisation.
#[derive(Clone, Debug, Default)]
pub struct Inertia {
    /// DOFs whose pivot was null, in elimination order.
    pub null: Vec<usize>,
    /// DOFs whose pivot was negative.
    pub negative: Vec<usize>,
    /// Smallest positive pivot of the unit-diagonal matrix (1 when empty).
    pub min_pivot: f64,
}

/// A factorised matrix, ready for solves and null-vector extraction.
pub struct Factor {
    sky: Skyline,
    scale: Vec<f64>,
    fixed: Vec<bool>,
    /// Scaled pivots, by DOF.
    pub pivots: Vec<f64>,
    pub inertia: Inertia,
}

impl Skyline {
    /// Build an empty matrix whose profile covers every pair of DOFs that
    /// appear together in one of `groups` (one group per element).
    pub fn with_profile(n: usize, groups: &[Vec<usize>]) -> Self {
        let mut first: Vec<usize> = (0..n).collect();
        for group in groups {
            if let Some(&lowest) = group.iter().min() {
                for &dof in group {
                    if lowest < first[dof] {
                        first[dof] = lowest;
                    }
                }
            }
        }
        let mut ptr = Vec::with_capacity(n + 1);
        let mut total = 0;
        for (j, &f) in first.iter().enumerate() {
            ptr.push(total);
            total += j - f + 1;
        }
        ptr.push(total);
        Self { n, first, ptr, a: vec![0.0; total] }
    }

    pub fn clear(&mut self) {
        self.a.iter_mut().for_each(|v| *v = 0.0);
    }

    #[inline]
    fn at(&self, i: usize, j: usize) -> usize {
        self.ptr[j] + i - self.first[j]
    }

    /// Add `v` to the symmetric entry `(i, j)`. Entries outside the profile
    /// are ignored; the profile is built from the same element lists.
    #[inline]
    pub fn add(&mut self, i: usize, j: usize, v: f64) {
        let (i, j) = if i <= j { (i, j) } else { (j, i) };
        if i >= self.first[j] {
            let k = self.at(i, j);
            self.a[k] += v;
        }
    }

    /// Remove a DOF from the system: clear its row and column and put one on
    /// the diagonal, so that a zero right-hand side keeps it at zero.
    pub fn constrain(&mut self, dof: usize) {
        for i in self.first[dof]..dof {
            let k = self.at(i, dof);
            self.a[k] = 0.0;
        }
        for j in dof + 1..self.n {
            if self.first[j] <= dof {
                let k = self.at(dof, j);
                self.a[k] = 0.0;
            }
        }
        let k = self.at(dof, dof);
        self.a[k] = 1.0;
    }

    /// `self + t (other - self)`, for two matrices with the same profile
    /// (both built by the same system).
    pub fn blend(&self, other: &Skyline, t: f64) -> Skyline {
        debug_assert!(self.n == other.n && self.ptr == other.ptr);
        let a = self.a.iter().zip(&other.a).map(|(x, y)| x + t * (y - x)).collect();
        Skyline { n: self.n, first: self.first.clone(), ptr: self.ptr.clone(), a }
    }

    /// Product with a vector, using the unfactored matrix.
    pub fn mul(&self, x: &[f64]) -> Vec<f64> {
        let mut y = vec![0.0; self.n];
        for j in 0..self.n {
            for i in self.first[j]..=j {
                let v = self.a[self.at(i, j)];
                y[i] += v * x[j];
                if i != j {
                    y[j] += v * x[i];
                }
            }
        }
        y
    }

    /// Factorise a copy of the matrix, after scaling to a unit diagonal and
    /// adding `shift` to every scaled diagonal entry.
    pub fn factor(&self, shift: f64) -> Factor {
        let n = self.n;
        let mut sky = self.clone();
        let diag: Vec<f64> = (0..n).map(|j| self.a[self.at(j, j)].abs()).collect();
        let largest = diag.iter().cloned().fold(0.0, f64::max);
        // A DOF with no stiffness of its own is scaled by the largest diagonal
        // so that its pivot comes out as zero.
        let scale: Vec<f64> = diag
            .iter()
            .map(|&d| {
                let reference = if d > 1e-30 * largest { d } else { largest };
                if reference > 0.0 { 1.0 / reference.sqrt() } else { 1.0 }
            })
            .collect();
        for j in 0..n {
            for i in sky.first[j]..=j {
                let k = sky.at(i, j);
                sky.a[k] *= scale[i] * scale[j];
            }
            let k = sky.at(j, j);
            sky.a[k] += shift;
        }

        let mut fixed = vec![false; n];
        let mut pivots = vec![0.0; n];
        let mut inertia = Inertia { min_pivot: 1.0, ..Inertia::default() };
        for j in 0..n {
            let fj = sky.first[j];
            // Reduce column j by the columns before it. Rows shared by
            // columns i and j are contiguous in both, so each reduction is
            // one dot product of two slices.
            for i in fj..j {
                let fi = sky.first[i];
                let low = fi.max(fj);
                let (pi, pj, len) = (sky.ptr[i] + low - fi, sky.ptr[j] + low - fj, i - low);
                let sum = dot(&sky.a[pi..pi + len], &sky.a[pj..pj + len]);
                let idx = sky.ptr[j] + i - fj;
                sky.a[idx] = if fixed[i] { 0.0 } else { sky.a[idx] - sum };
            }
            // Divide by earlier pivots and form this pivot.
            let mut d = sky.a[sky.at(j, j)];
            for i in fj..j {
                let idx = sky.at(i, j);
                let g = sky.a[idx];
                let l = g / pivots[i];
                sky.a[idx] = l;
                d -= g * l;
            }
            if !d.is_finite() || d.abs() <= NULL_PIVOT {
                fixed[j] = true;
                pivots[j] = 1.0;
                inertia.null.push(j);
            } else {
                pivots[j] = d;
                if d < 0.0 {
                    inertia.negative.push(j);
                } else if d < inertia.min_pivot {
                    inertia.min_pivot = d;
                }
            }
        }
        Factor { sky, scale, fixed, pivots, inertia }
    }
}

impl Factor {
    fn column(&self, j: usize) -> &[f64] {
        let sky = &self.sky;
        &sky.a[sky.ptr[j]..sky.ptr[j] + j - sky.first[j]]
    }

    /// Solve `K x = b`. Components at null-pivot DOFs are zero.
    pub fn solve(&self, b: &[f64]) -> Vec<f64> {
        let sky = &self.sky;
        let n = sky.n;
        let mut x: Vec<f64> = (0..n).map(|i| b[i] * self.scale[i]).collect();
        for j in 0..n {
            x[j] = if self.fixed[j] { 0.0 } else { x[j] - dot(self.column(j), &x[sky.first[j]..j]) };
        }
        for j in 0..n {
            x[j] = if self.fixed[j] { 0.0 } else { x[j] / self.pivots[j] };
        }
        for j in (0..n).rev() {
            let xj = x[j];
            if xj != 0.0 {
                for (xi, l) in x[sky.first[j]..j].iter_mut().zip(self.column(j)) {
                    *xi -= l * xj;
                }
            }
        }
        for i in 0..n {
            x[i] *= self.scale[i];
        }
        x
    }

    /// Direction associated with the pivot at `dof`: the null vector for a
    /// null pivot, or a direction of negative curvature for a negative one.
    pub fn pivot_vector(&self, dof: usize) -> Vec<f64> {
        let sky = &self.sky;
        let mut x = vec![0.0; sky.n];
        x[dof] = 1.0;
        for j in (0..=dof).rev() {
            let xj = x[j];
            if xj != 0.0 {
                for (xi, l) in x[sky.first[j]..j].iter_mut().zip(self.column(j)) {
                    *xi -= l * xj;
                }
            }
        }
        for i in 0..sky.n {
            x[i] *= self.scale[i];
        }
        x
    }
}

/// Dot product with four running sums, which the compiler can keep in
/// registers; the summation order is fixed, so results are repeatable.
fn dot(a: &[f64], b: &[f64]) -> f64 {
    let mut sums = [0.0; 4];
    let (chunks_a, chunks_b) = (a.chunks_exact(4), b.chunks_exact(4));
    let tail: f64 = chunks_a.remainder().iter().zip(chunks_b.remainder()).map(|(x, y)| x * y).sum();
    for (x, y) in chunks_a.zip(chunks_b) {
        for k in 0..4 {
            sums[k] += x[k] * y[k];
        }
    }
    (sums[0] + sums[1]) + (sums[2] + sums[3]) + tail
}

/// Reverse Cuthill–McKee ordering of a graph given as adjacency lists.
/// Returns the vertices in their new order. Ties break on vertex index, so
/// the ordering is deterministic.
pub fn reverse_cuthill_mckee(adjacency: &[Vec<usize>]) -> Vec<usize> {
    let n = adjacency.len();
    let mut visited = vec![false; n];
    let mut order = Vec::with_capacity(n);
    let mut by_degree: Vec<usize> = (0..n).collect();
    by_degree.sort_by_key(|&v| (adjacency[v].len(), v));
    for &start in &by_degree {
        if visited[start] {
            continue;
        }
        visited[start] = true;
        let mut head = order.len();
        order.push(start);
        while head < order.len() {
            let v = order[head];
            head += 1;
            let mut next: Vec<usize> = adjacency[v].iter().cloned().filter(|&w| !visited[w]).collect();
            next.sort_by_key(|&w| (adjacency[w].len(), w));
            next.dedup();
            for w in next {
                if !visited[w] {
                    visited[w] = true;
                    order.push(w);
                }
            }
        }
    }
    order.reverse();
    order
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chain(n: usize, grounded: bool) -> Skyline {
        let groups: Vec<Vec<usize>> = (0..n - 1).map(|i| vec![i, i + 1]).collect();
        let mut k = Skyline::with_profile(n, &groups);
        for i in 0..n - 1 {
            k.add(i, i, 1.0);
            k.add(i + 1, i + 1, 1.0);
            k.add(i, i + 1, -1.0);
        }
        if grounded {
            k.add(0, 0, 1.0);
        }
        k
    }

    #[test]
    fn solves_a_grounded_spring_chain() {
        let k = chain(5, true);
        let f = k.factor(0.0);
        assert!(f.inertia.null.is_empty() && f.inertia.negative.is_empty());
        let x = f.solve(&[0.0, 0.0, 0.0, 0.0, 1.0]);
        for (i, v) in x.iter().enumerate() {
            assert!((v - (i as f64 + 1.0)).abs() < 1e-12);
        }
    }

    #[test]
    fn finds_the_rigid_mode_of_a_free_chain() {
        let k = chain(5, false);
        let f = k.factor(0.0);
        assert_eq!(f.inertia.null.len(), 1);
        let mode = f.pivot_vector(f.inertia.null[0]);
        let residual = k.mul(&mode);
        assert!(residual.iter().all(|r| r.abs() < 1e-12));
        assert!(mode.iter().all(|v| (v - mode[0]).abs() < 1e-12 && v.abs() > 0.1));
    }

    #[test]
    fn counts_negative_pivots() {
        let mut k = chain(3, true);
        k.add(2, 2, -3.0);
        assert_eq!(k.factor(0.0).inertia.negative.len(), 1);
    }
}
