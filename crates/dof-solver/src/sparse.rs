//! Sparse symmetric matrices with a supernodal multifrontal LDLᵀ
//! factorisation that reports the inertia of the matrix instead of failing on
//! a singular one.
//!
//! [`crate::linalg`] uses it for systems too large for the skyline (profile)
//! factorisation of solver 0.2, which it keeps for small ones; the skyline is
//! also the reference this factor is tested against. The semantics are the
//! same:
//!
//! * The matrix is scaled to a unit diagonal and `shift` is added to every
//!   scaled diagonal entry, so pivots are dimensionless.
//! * A pivot at or below [`NULL_PIVOT`] (or not finite) is a zero-stiffness
//!   motion. Its DOF is removed from the system exactly: its solution
//!   component is zero and its column of `L` is cleared, so it does not
//!   influence later pivots. That is an exact restraint, not a penalty
//!   spring, and the null vector it belongs to is recovered from the factor.
//! * A negative pivot means the matrix is indefinite.
//!
//! What changes is the elimination order. The skyline eliminated in the
//! reverse Cuthill–McKee equation order, whose fill grows like the bandwidth
//! squared: about n^(7/3) work for a three-dimensional frame. Here the
//! equations are first reordered by approximate minimum degree, which keeps
//! the factor sparse, and consecutive columns with the same structure are
//! factorised together as dense blocks (supernodes). If minimum degree would
//! do more work than the equation order (a chain, for example), the
//! equation order is kept.
//!
//! Inertia is invariant under a symmetric reordering (Sylvester's law), so
//! the null and negative pivot counts of a positive semidefinite or regular
//! matrix do not depend on the order. Which DOF carries a null or negative
//! pivot, the size of the smallest pivot and the rounding of the results do.
//!
//! Every loop runs in a fixed order, so the same matrix always gives the same
//! factor, bit for bit.

use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::rc::Rc;

/// Pivots of the unit-diagonal matrix at or below this are treated as zero.
pub const NULL_PIVOT: f64 = 1e-10;


/// Outcome of a factorisation.
#[derive(Clone, Debug, Default)]
pub struct Inertia {
    /// DOFs whose pivot was null, in elimination order.
    pub null: Vec<usize>,
    /// DOFs whose pivot was negative, in elimination order.
    pub negative: Vec<usize>,
    /// Smallest positive pivot of the unit-diagonal matrix (1 when empty).
    pub min_pivot: f64,
}

/// Columns `first..first + size` of the permuted matrix, factorised together.
struct Supernode {
    first: usize,
    size: usize,
    /// Rows below the block with a nonzero in it, ascending, all greater
    /// than `first + size - 1`.
    pattern: Vec<usize>,
    /// Supernodes whose update matrix is assembled into this one.
    children: Vec<usize>,
}

/// Ordering and structure of a sparsity pattern. It depends only on which
/// equations share an element, so a system computes it once and every
/// stiffness matrix and factorisation of that system reuses it.
pub struct Symbolic {
    n: usize,
    /// `perm[k]` is the equation eliminated `k`-th; `inv` is its inverse.
    perm: Vec<usize>,
    inv: Vec<usize>,
    /// Lower triangle of the permuted matrix by column. Rows are ascending
    /// and the first row of each column is its diagonal.
    col_ptr: Vec<usize>,
    rows: Vec<usize>,
    /// For each permuted row, the value positions of its entries left of the
    /// diagonal, for [`SparseMatrix::constrain`].
    row_ptr: Vec<usize>,
    row_values: Vec<usize>,
    supernodes: Vec<Supernode>,
    /// Supernode of each permuted column.
    owner: Vec<usize>,
    /// Entries of `L` below the diagonal, counting the dense blocks.
    pub factor_entries: usize,
    /// Multiply-adds of one numeric factorisation, approximately.
    pub factor_work: f64,
    /// Whether minimum degree was used (otherwise the equation order).
    pub reordered: bool,
}

impl Symbolic {
    /// Analyse the pattern in which every pair of DOFs that appear together
    /// in one of `groups` (one group per element) may be nonzero. The order
    /// is approximate minimum degree, postordered, unless the equation order
    /// does no more work (a chain, for example).
    pub fn new(n: usize, groups: &[Vec<usize>]) -> Self {
        Self::from_adjacency(&adjacency(n, groups))
    }

    /// [`Symbolic::new`] for the neighbour lists of [`adjacency`].
    pub fn from_adjacency(adjacency: &[Vec<usize>]) -> Self {
        let n = adjacency.len();
        let candidate = Self::with_order(adjacency, postorder(adjacency, minimum_degree(adjacency)), true);
        // The skyline's work is an upper bound on the sparse work in the
        // equation order, and cheap to compute. Only when it does not already
        // lose to minimum degree is the equation order analysed exactly; on a
        // tie the equation order is kept.
        if envelope_work(adjacency) <= candidate.factor_work {
            let plain = Self::with_order(adjacency, (0..n).collect(), false);
            if plain.factor_work <= candidate.factor_work {
                return plain;
            }
        }
        candidate
    }

    /// Analyse the pattern with a given ordering policy, whatever its cost.
    pub fn with_ordering(n: usize, groups: &[Vec<usize>], reorder: bool) -> Self {
        let adjacency = adjacency(n, groups);
        if reorder {
            Self::with_order(&adjacency, postorder(&adjacency, minimum_degree(&adjacency)), true)
        } else {
            Self::with_order(&adjacency, (0..n).collect(), false)
        }
    }

    /// Supernode count, largest block and largest front (diagnostics).
    pub fn shape(&self) -> (usize, usize, usize) {
        let largest = self.supernodes.iter().map(|s| s.size).max().unwrap_or(0);
        let front = self.supernodes.iter().map(|s| s.size + s.pattern.len()).max().unwrap_or(0);
        (self.supernodes.len(), largest, front)
    }

    /// Number of equations.
    pub fn len(&self) -> usize {
        self.n
    }

    fn with_order(adjacency: &[Vec<usize>], perm: Vec<usize>, reordered: bool) -> Self {
        let n = adjacency.len();
        let mut inv = vec![0; n];
        for (k, &eq) in perm.iter().enumerate() {
            inv[eq] = k;
        }
        // Permuted lower triangle, diagonal first.
        let mut col_ptr = Vec::with_capacity(n + 1);
        let mut rows = Vec::new();
        let mut upper: Vec<Vec<usize>> = vec![Vec::new(); n];
        for k in 0..n {
            col_ptr.push(rows.len());
            rows.push(k);
            let start = rows.len();
            for &u in &adjacency[perm[k]] {
                let r = inv[u];
                if r > k {
                    rows.push(r);
                    upper[r].push(k);
                }
            }
            rows[start..].sort_unstable();
        }
        col_ptr.push(rows.len());
        let mut row_ptr = Vec::with_capacity(n + 1);
        let mut row_values = Vec::new();
        {
            // Value position of (r, c) for every c < r, grouped by row.
            let mut count = vec![0usize; n + 1];
            for c in 0..n {
                for &r in &rows[col_ptr[c] + 1..col_ptr[c + 1]] {
                    count[r + 1] += 1;
                }
            }
            for r in 0..n {
                count[r + 1] += count[r];
            }
            row_ptr.extend_from_slice(&count);
            row_values.resize(count[n], 0);
            let mut next = count;
            for c in 0..n {
                for p in col_ptr[c] + 1..col_ptr[c + 1] {
                    let r = rows[p];
                    row_values[next[r]] = p;
                    next[r] += 1;
                }
            }
        }

        for list in upper.iter_mut() {
            list.sort_unstable();
        }
        let parent = elimination_tree(&upper);
        // Column counts of L below the diagonal, from the row subtrees.
        const NONE: usize = usize::MAX;
        let mut count = vec![0usize; n];
        let mut mark = vec![NONE; n];
        for k in 0..n {
            mark[k] = k;
            for &i in &upper[k] {
                let mut r = i;
                while mark[r] != k {
                    count[r] += 1;
                    mark[r] = k;
                    r = parent[r];
                }
            }
        }
        drop(upper);
        let mut children = vec![0usize; n];
        for &p in &parent {
            if p != NONE {
                children[p] += 1;
            }
        }
        // Fundamental supernodes: a column joins the one before it when it
        // is that column's parent, its only child's, and has the same
        // structure below.
        let mut supernodes: Vec<Supernode> = Vec::new();
        let mut owner = vec![0; n];
        for k in 0..n {
            let joins = k > 0 && parent[k - 1] == k && children[k] == 1 && count[k - 1] == count[k] + 1;
            if joins {
                supernodes.last_mut().map(|s| s.size += 1);
            } else {
                supernodes.push(Supernode { first: k, size: 1, pattern: Vec::new(), children: Vec::new() });
            }
            owner[k] = supernodes.len() - 1;
        }
        // Row structure of each supernode: its own columns' entries and its
        // children's structure, below the block.
        let mut mark = vec![NONE; n];
        for s in 0..supernodes.len() {
            let (first, size) = (supernodes[s].first, supernodes[s].size);
            let last = first + size - 1;
            let mut pattern = Vec::new();
            for c in first..=last {
                for &r in &rows[col_ptr[c] + 1..col_ptr[c + 1]] {
                    if r > last && mark[r] != s {
                        mark[r] = s;
                        pattern.push(r);
                    }
                }
            }
            for child in std::mem::take(&mut supernodes[s].children) {
                for &r in &supernodes[child].pattern {
                    if r > last && mark[r] != s {
                        mark[r] = s;
                        pattern.push(r);
                    }
                }
                supernodes[s].children.push(child);
            }
            pattern.sort_unstable();
            debug_assert_eq!(pattern.len(), count[last]);
            if let Some(&up) = pattern.first() {
                let p = owner[up];
                supernodes[p].children.push(s);
            }
            supernodes[s].pattern = pattern;
        }
        let supernodes = amalgamate(supernodes, &mut owner);
        let mut factor_entries = 0usize;
        let mut factor_work = 0.0;
        for node in &supernodes {
            let (size, below) = (node.size, node.pattern.len());
            factor_entries += size * (size - 1) / 2 + size * below;
            // Half the sum of the squared column counts below the diagonal.
            for j in 0..size {
                let column = (size - 1 - j + below) as f64;
                factor_work += 0.5 * column * column;
            }
        }
        Self {
            n,
            perm,
            inv,
            col_ptr,
            rows,
            row_ptr,
            row_values,
            supernodes,
            owner,
            factor_entries,
            factor_work,
            reordered,
        }
    }
}

/// Elimination tree from the entries left of the diagonal of each row
/// (Liu's algorithm with path compression). Roots have parent `usize::MAX`.
fn elimination_tree(upper: &[Vec<usize>]) -> Vec<usize> {
    const NONE: usize = usize::MAX;
    let n = upper.len();
    let mut parent = vec![NONE; n];
    let mut ancestor = vec![NONE; n];
    for k in 0..n {
        for &i in &upper[k] {
            let mut r = i;
            while ancestor[r] != NONE && ancestor[r] != k {
                let next = ancestor[r];
                ancestor[r] = k;
                r = next;
            }
            if ancestor[r] == NONE {
                ancestor[r] = k;
                parent[r] = k;
            }
        }
    }
    parent
}

/// The order `perm` rearranged into a postorder of its elimination tree:
/// the same fill, with every subtree in consecutive positions and each
/// column directly after its last child. Children are visited in their
/// original order, so the result is deterministic.
fn postorder(adjacency: &[Vec<usize>], perm: Vec<usize>) -> Vec<usize> {
    const NONE: usize = usize::MAX;
    let n = perm.len();
    let mut inv = vec![0; n];
    for (k, &eq) in perm.iter().enumerate() {
        inv[eq] = k;
    }
    let upper: Vec<Vec<usize>> = (0..n)
        .map(|k| {
            let mut list: Vec<usize> = adjacency[perm[k]].iter().map(|&u| inv[u]).filter(|&i| i < k).collect();
            list.sort_unstable();
            list
        })
        .collect();
    let parent = elimination_tree(&upper);
    let mut children: Vec<Vec<usize>> = vec![Vec::new(); n];
    for k in 0..n {
        if parent[k] != NONE {
            children[parent[k]].push(k);
        }
    }
    let mut order = Vec::with_capacity(n);
    let mut stack: Vec<(usize, usize)> = Vec::new();
    for root in (0..n).filter(|&k| parent[k] == NONE) {
        stack.push((root, 0));
        while let Some(&mut (k, ref mut next)) = stack.last_mut() {
            if *next < children[k].len() {
                let child = children[k][*next];
                *next += 1;
                stack.push((child, 0));
            } else {
                order.push(perm[k]);
                stack.pop();
            }
        }
    }
    order
}

/// Relaxed supernode amalgamation (as in CHOLMOD): a supernode is merged
/// into its parent when it ends directly before the parent's first column
/// and the merged block would hold few explicit zeros. Larger dense blocks
/// make the factorisation kernels faster; the zeros change no value, since
/// they are computed from zeros. Any order is valid, since only a child that
/// is contiguous with its parent merges; in postorder every parent has one.
fn amalgamate(nodes: Vec<Supernode>, owner: &mut [usize]) -> Vec<Supernode> {
    let count = nodes.len();
    let mut nodes: Vec<Option<Supernode>> = nodes.into_iter().map(Some).collect();
    let mut zeros = vec![0usize; count];
    for s in 0..count {
        let Some(node) = nodes[s].as_ref() else { continue };
        let Some(&up) = node.pattern.first() else { continue };
        let p = owner[up];
        let parent = nodes[p].as_ref().expect("a parent is merged only after its children");
        if node.first + node.size != parent.first {
            continue;
        }
        let (cs, ps, below) = (node.size, parent.size, parent.pattern.len());
        let size = cs + ps;
        let added = cs * (ps + below - node.pattern.len());
        let total = zeros[s] + zeros[p] + added;
        let entries = size * (size - 1) / 2 + size * below;
        let fraction = total as f64 / entries.max(1) as f64;
        let merge = size <= 4 || (size <= 16 && fraction < 0.8) || (size <= 48 && fraction < 0.1) || fraction < 0.05;
        if !merge {
            continue;
        }
        let child = nodes[s].take().expect("present");
        let parent = nodes[p].as_mut().expect("present");
        parent.first = child.first;
        parent.size = size;
        parent.children.retain(|&c| c != s);
        parent.children.extend(child.children);
        parent.children.sort_unstable();
        zeros[p] = total;
    }
    // Renumber the remaining supernodes and their children.
    let mut number = vec![usize::MAX; count];
    let mut kept = Vec::new();
    for (s, node) in nodes.into_iter().enumerate() {
        if let Some(node) = node {
            number[s] = kept.len();
            kept.push(node);
        }
    }
    for node in kept.iter_mut() {
        for c in node.children.iter_mut() {
            *c = number[*c];
        }
        node.children.sort_unstable();
    }
    for (index, node) in kept.iter().enumerate() {
        for k in node.first..node.first + node.size {
            owner[k] = index;
        }
    }
    kept
}

/// Neighbours of every DOF, ascending, without the DOF itself.
pub fn adjacency(n: usize, groups: &[Vec<usize>]) -> Vec<Vec<usize>> {
    let mut adjacency: Vec<Vec<usize>> = vec![Vec::new(); n];
    for group in groups {
        for &a in group {
            for &b in group {
                if a != b {
                    adjacency[a].push(b);
                }
            }
        }
    }
    for list in adjacency.iter_mut() {
        list.sort_unstable();
        list.dedup();
    }
    adjacency
}

/// Multiply-adds of a skyline factorisation in the given equation order.
pub fn envelope_work(adjacency: &[Vec<usize>]) -> f64 {
    adjacency
        .iter()
        .enumerate()
        .map(|(j, list)| {
            let height = (j - list.first().copied().unwrap_or(j).min(j)) as f64;
            height * height
        })
        .sum::<f64>()
        * 0.5
}

/// Fill-reducing elimination order by approximate minimum degree on the
/// quotient graph (Amestoy, Davis and Duff, 1996), without dense-row
/// detection. Returns the equations in elimination order.
///
/// Equations with the same neighbours, such as the three translations of a
/// node, are first merged into one weighted supervariable and eliminated
/// together, which also makes them one supernode. Ties are broken by the
/// lowest supervariable, so the order is deterministic.
pub fn minimum_degree(adjacency: &[Vec<usize>]) -> Vec<usize> {
    let n = adjacency.len();
    // Supervariables: equations whose closed neighbourhoods are equal.
    let closed: Vec<Vec<usize>> = (0..n)
        .map(|v| {
            let mut list = adjacency[v].clone();
            let at = list.partition_point(|&u| u < v);
            list.insert(at, v);
            list
        })
        .collect();
    let mut sorted: Vec<usize> = (0..n).collect();
    sorted.sort_by(|&a, &b| closed[a].cmp(&closed[b]).then(a.cmp(&b)));
    let mut super_of = vec![0usize; n];
    let mut members: Vec<Vec<usize>> = Vec::new();
    {
        let mut start = 0;
        let mut groups: Vec<Vec<usize>> = Vec::new();
        while start < n {
            let mut end = start + 1;
            while end < n && closed[sorted[end]] == closed[sorted[start]] {
                end += 1;
            }
            groups.push(sorted[start..end].to_vec());
            start = end;
        }
        // Number supervariables by their lowest equation.
        groups.sort_by_key(|g| g[0]);
        for (s, g) in groups.into_iter().enumerate() {
            for &v in &g {
                super_of[v] = s;
            }
            members.push(g);
        }
    }
    drop(closed);
    let ns = members.len();
    let weight: Vec<usize> = members.iter().map(|g| g.len()).collect();
    let mut vars: Vec<Vec<usize>> = members
        .iter()
        .enumerate()
        .map(|(s, g)| {
            let mut list: Vec<usize> = adjacency[g[0]].iter().map(|&u| super_of[u]).filter(|&t| t != s).collect();
            list.sort_unstable();
            list.dedup();
            list
        })
        .collect();
    let mut elems: Vec<Vec<usize>> = vec![Vec::new(); ns];
    let mut element: Vec<Vec<usize>> = vec![Vec::new(); ns];
    let mut element_weight = vec![0usize; ns];
    let mut element_alive = vec![false; ns];
    let mut alive = vec![true; ns];
    let mut degree: Vec<usize> = vars.iter().map(|list| list.iter().map(|&u| weight[u]).sum()).collect();
    let mut heap: BinaryHeap<Reverse<(usize, usize)>> = (0..ns).map(|v| Reverse((degree[v], v))).collect();
    let mut remaining: usize = n;
    let mut mark = vec![usize::MAX; ns];
    let mut seen = vec![usize::MAX; ns];
    let mut outside = vec![0isize; ns];
    let mut order = Vec::with_capacity(ns);
    let mut touched = Vec::new();
    let mut stamp = 0usize;
    while let Some(Reverse((d, p))) = heap.pop() {
        if !alive[p] || d != degree[p] {
            continue;
        }
        stamp += 1;
        // The new element: everything adjacent to p directly or through an
        // element p belongs to. Those elements are absorbed into it.
        let mut lp = Vec::new();
        mark[p] = stamp;
        for &u in &vars[p] {
            if alive[u] && mark[u] != stamp {
                mark[u] = stamp;
                lp.push(u);
            }
        }
        for &e in &elems[p] {
            if element_alive[e] {
                for &u in &element[e] {
                    if alive[u] && mark[u] != stamp {
                        mark[u] = stamp;
                        lp.push(u);
                    }
                }
                element_alive[e] = false;
                element[e] = Vec::new();
            }
        }
        alive[p] = false;
        order.push(p);
        remaining -= weight[p];
        vars[p] = Vec::new();
        elems[p] = Vec::new();
        lp.sort_unstable();
        let lp_weight: usize = lp.iter().map(|&u| weight[u]).sum();
        // |Le \ Lp| for every other element next to Lp.
        touched.clear();
        for &i in &lp {
            for &e in &elems[i] {
                if element_alive[e] {
                    if seen[e] != stamp {
                        seen[e] = stamp;
                        outside[e] = element_weight[e] as isize;
                        touched.push(e);
                    }
                    outside[e] -= weight[i] as isize;
                }
            }
        }
        // An element entirely inside the new one is redundant.
        for &e in &touched {
            if outside[e] <= 0 {
                element_alive[e] = false;
                element[e] = Vec::new();
            }
        }
        for &i in &lp {
            elems[i].retain(|&e| element_alive[e]);
            let external: usize = elems[i].iter().map(|&e| outside[e] as usize).sum();
            elems[i].push(p);
            vars[i].retain(|&u| alive[u] && mark[u] != stamp);
            let direct: usize = vars[i].iter().map(|&u| weight[u]).sum();
            let added = lp_weight - weight[i];
            let d = (degree[i] + added).min(direct + added + external).min(remaining - weight[i]);
            degree[i] = d;
            heap.push(Reverse((d, i)));
        }
        element[p] = lp;
        element_weight[p] = lp_weight;
        element_alive[p] = true;
    }
    order.into_iter().flat_map(|s| members[s].iter().copied()).collect()
}

/// A symmetric matrix on a fixed sparsity pattern, in the equation numbering
/// of its system.
#[derive(Clone)]
pub struct SparseMatrix {
    sym: Rc<Symbolic>,
    values: Vec<f64>,
}

impl SparseMatrix {
    /// A zero matrix on the pattern of `sym`.
    pub fn new(sym: Rc<Symbolic>) -> Self {
        let values = vec![0.0; sym.rows.len()];
        Self { sym, values }
    }

    pub fn clear(&mut self) {
        self.values.iter_mut().for_each(|v| *v = 0.0);
    }

    /// Value position of the permuted entry (r, c) with r >= c.
    #[inline]
    fn position(&self, r: usize, c: usize) -> Option<usize> {
        let sym = &*self.sym;
        let (start, end) = (sym.col_ptr[c], sym.col_ptr[c + 1]);
        sym.rows[start..end].binary_search(&r).ok().map(|k| start + k)
    }

    /// Add `v` to the symmetric entry `(i, j)`. Entries outside the pattern
    /// are ignored; the pattern is built from the same element lists.
    #[inline]
    pub fn add(&mut self, i: usize, j: usize, v: f64) {
        let (a, b) = (self.sym.inv[i], self.sym.inv[j]);
        let (r, c) = if a >= b { (a, b) } else { (b, a) };
        if let Some(k) = self.position(r, c) {
            self.values[k] += v;
        }
    }

    /// Entry `(i, j)`, zero outside the pattern.
    pub fn get(&self, i: usize, j: usize) -> f64 {
        let (a, b) = (self.sym.inv[i], self.sym.inv[j]);
        let (r, c) = if a >= b { (a, b) } else { (b, a) };
        self.position(r, c).map_or(0.0, |k| self.values[k])
    }

    /// Remove a DOF from the system: clear its row and column and put one on
    /// the diagonal, so that a zero right-hand side keeps it at zero.
    pub fn constrain(&mut self, dof: usize) {
        let sym = &*self.sym;
        let k = sym.inv[dof];
        for p in sym.col_ptr[k] + 1..sym.col_ptr[k + 1] {
            self.values[p] = 0.0;
        }
        for &p in &sym.row_values[sym.row_ptr[k]..sym.row_ptr[k + 1]] {
            self.values[p] = 0.0;
        }
        self.values[sym.col_ptr[k]] = 1.0;
    }

    /// Product with a vector, using the unfactored matrix.
    pub fn mul(&self, x: &[f64]) -> Vec<f64> {
        let sym = &*self.sym;
        let mut y = vec![0.0; sym.n];
        for c in 0..sym.n {
            let j = sym.perm[c];
            for p in sym.col_ptr[c]..sym.col_ptr[c + 1] {
                let i = sym.perm[sym.rows[p]];
                let v = self.values[p];
                y[i] += v * x[j];
                if i != j {
                    y[j] += v * x[i];
                }
            }
        }
        y
    }

    /// Factorise the matrix, after scaling to a unit diagonal and adding
    /// `shift` to every scaled diagonal entry.
    pub fn factor(&self, shift: f64) -> Factor {
        let sym = &*self.sym;
        let n = sym.n;
        let diag: Vec<f64> = (0..n).map(|eq| self.values[sym.col_ptr[sym.inv[eq]]].abs()).collect();
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
        let permuted_scale: Vec<f64> = sym.perm.iter().map(|&eq| scale[eq]).collect();

        let mut fixed = vec![false; n];
        let mut pivots = vec![0.0; n];
        let mut inertia = Inertia { min_pivot: 1.0, ..Inertia::default() };
        let mut panels: Vec<Vec<f64>> = Vec::with_capacity(sym.supernodes.len());
        let mut updates: Vec<Vec<f64>> = vec![Vec::new(); sym.supernodes.len()];
        let mut position = vec![0usize; n];
        let mut weights: Vec<(usize, f64)> = Vec::new();
        for (s, node) in sym.supernodes.iter().enumerate() {
            let (first, ns, r) = (node.first, node.size, node.pattern.len());
            let m = ns + r;
            for a in 0..ns {
                position[first + a] = a;
            }
            for (b, &row) in node.pattern.iter().enumerate() {
                position[row] = ns + b;
            }
            // The front of this supernode, as two column-major lower
            // triangles: the panel holds front columns 0..ns over all m rows
            // (entry (a, b) at b * m + a), the update holds the trailing
            // r × r block (entry (a, b) at (b - ns) * r + a - ns).
            let mut panel = vec![0.0; m * ns];
            let mut update = vec![0.0; r * r];
            for c in first..first + ns {
                let column = position[c] * m;
                for p in sym.col_ptr[c]..sym.col_ptr[c + 1] {
                    let row = sym.rows[p];
                    panel[column + position[row]] += self.values[p] * permuted_scale[row] * permuted_scale[c];
                }
                panel[column + position[c]] += shift;
            }
            for &child in &node.children {
                let from = std::mem::take(&mut updates[child]);
                let rows = &sym.supernodes[child].pattern;
                let rc = rows.len();
                for b in 0..rc {
                    let column = position[rows[b]];
                    let source = &from[b * rc..(b + 1) * rc];
                    if column < ns {
                        let target = &mut panel[column * m..(column + 1) * m];
                        for a in b..rc {
                            target[position[rows[a]]] += source[a];
                        }
                    } else {
                        let target = &mut update[(column - ns) * r..(column - ns + 1) * r];
                        for a in b..rc {
                            target[position[rows[a]] - ns] += source[a];
                        }
                    }
                }
            }
            // Factorise the block columns, left-looking: each column takes
            // the updates of the block columns before it, then its pivot.
            for j in 0..ns {
                let k = first + j;
                weights.clear();
                for i in 0..j {
                    let l = panel[i * m + j];
                    if !fixed[first + i] && l != 0.0 {
                        weights.push((i, l * pivots[first + i]));
                    }
                }
                let (done, rest) = panel.split_at_mut(j * m);
                let column = &mut rest[..m];
                subtract_columns(&mut column[j..], done, m, j, &weights);
                let d = column[j];
                if !d.is_finite() || d.abs() <= NULL_PIVOT {
                    fixed[k] = true;
                    pivots[k] = 1.0;
                    inertia.null.push(sym.perm[k]);
                    column[j + 1..].iter_mut().for_each(|v| *v = 0.0);
                    continue;
                }
                pivots[k] = d;
                if d < 0.0 {
                    inertia.negative.push(sym.perm[k]);
                } else if d < inertia.min_pivot {
                    inertia.min_pivot = d;
                }
                for v in column[j + 1..].iter_mut() {
                    *v /= d;
                }
            }
            // The update matrix for the parent: the Schur complement of the
            // block, F22 - L21 D L21ᵀ.
            for b in 0..r {
                weights.clear();
                for i in 0..ns {
                    let l = panel[i * m + ns + b];
                    if !fixed[first + i] && l != 0.0 {
                        weights.push((i, l * pivots[first + i]));
                    }
                }
                subtract_columns(&mut update[b * r + b..(b + 1) * r], &panel, m, ns + b, &weights);
            }
            if r > 0 {
                updates[s] = update;
            }
            panels.push(panel);
        }
        Factor { sym: self.sym.clone(), scale, fixed, pivots, panels, inertia }
    }
}

/// `target[i] -= Σ w · L[from + i]` over the panel columns `(column, w)` in
/// `weights`, where `L` is column-major with `m` rows. Four columns are
/// combined per pass so that each target entry is loaded and stored once
/// per four multiply-adds; the order of the sums is fixed.
#[inline]
fn subtract_columns(target: &mut [f64], panel: &[f64], m: usize, from: usize, weights: &[(usize, f64)]) {
    let len = m - from;
    let target = &mut target[..len];
    let column = |j: usize| &panel[j * m + from..j * m + m];
    let mut groups = weights.chunks_exact(4);
    for g in &mut groups {
        let (l0, l1, l2, l3) = (column(g[0].0), column(g[1].0), column(g[2].0), column(g[3].0));
        let (w0, w1, w2, w3) = (g[0].1, g[1].1, g[2].1, g[3].1);
        for ((((t, a), b), c), d) in target.iter_mut().zip(l0).zip(l1).zip(l2).zip(l3) {
            *t -= (a * w0 + b * w1) + (c * w2 + d * w3);
        }
    }
    for &(j, w) in groups.remainder() {
        for (t, l) in target.iter_mut().zip(column(j)) {
            *t -= l * w;
        }
    }
}

/// A factorised matrix, ready for solves and null-vector extraction.
#[derive(Clone)]
pub struct Factor {
    sym: Rc<Symbolic>,
    /// Unit-diagonal scaling, by equation.
    scale: Vec<f64>,
    /// Null-pivot columns, by elimination position.
    fixed: Vec<bool>,
    /// Scaled pivots, by elimination position.
    pivots: Vec<f64>,
    /// Columns of `L` of each supernode, column-major over its block rows
    /// and then its pattern rows; the unit diagonal is not used.
    panels: Vec<Vec<f64>>,
    pub inertia: Inertia,
}

impl Factor {
    /// Solve `K x = b`. Components at null-pivot DOFs are zero.
    pub fn solve(&self, b: &[f64]) -> Vec<f64> {
        let sym = &*self.sym;
        let n = sym.n;
        let mut y: Vec<f64> = (0..n).map(|k| b[sym.perm[k]] * self.scale[sym.perm[k]]).collect();
        for (node, panel) in sym.supernodes.iter().zip(&self.panels) {
            let (first, ns) = (node.first, node.size);
            let m = ns + node.pattern.len();
            for j in 0..ns {
                let k = first + j;
                if self.fixed[k] {
                    y[k] = 0.0;
                    continue;
                }
                let yk = y[k];
                if yk != 0.0 {
                    let column = &panel[j * m..(j + 1) * m];
                    for a in j + 1..ns {
                        y[first + a] -= column[a] * yk;
                    }
                    for (&row, l) in node.pattern.iter().zip(&column[ns..]) {
                        y[row] -= l * yk;
                    }
                }
            }
        }
        for k in 0..n {
            y[k] = if self.fixed[k] { 0.0 } else { y[k] / self.pivots[k] };
        }
        for (node, panel) in sym.supernodes.iter().zip(&self.panels).rev() {
            self.back_substitute(node, panel, &mut y, node.size);
        }
        (0..n).map(|eq| y[sym.inv[eq]] * self.scale[eq]).collect()
    }

    /// Back substitution with `Lᵀ` over the first `count` columns of one
    /// supernode, last column first.
    #[inline]
    fn back_substitute(&self, node: &Supernode, panel: &[f64], y: &mut [f64], count: usize) {
        let (first, ns) = (node.first, node.size);
        let m = ns + node.pattern.len();
        for j in (0..count).rev() {
            let k = first + j;
            if self.fixed[k] {
                y[k] = 0.0;
                continue;
            }
            let column = &panel[j * m..(j + 1) * m];
            let mut sum = 0.0;
            for a in j + 1..ns {
                sum += column[a] * y[first + a];
            }
            for (&row, l) in node.pattern.iter().zip(&column[ns..]) {
                sum += l * y[row];
            }
            y[k] -= sum;
        }
    }

    /// Direction associated with the pivot at `dof`: the null vector for a
    /// null pivot, or a direction of negative curvature for a negative one.
    /// It solves `Lᵀ y = e` for the pivot's column `e`, with every column
    /// eliminated after it at zero.
    pub fn pivot_vector(&self, dof: usize) -> Vec<f64> {
        let sym = &*self.sym;
        let k0 = sym.inv[dof];
        let mut y = vec![0.0; sym.n];
        y[k0] = 1.0;
        let s0 = sym.owner[k0];
        let node = &sym.supernodes[s0];
        self.back_substitute(node, &self.panels[s0], &mut y, k0 - node.first);
        for s in (0..s0).rev() {
            self.back_substitute(&sym.supernodes[s], &self.panels[s], &mut y, sym.supernodes[s].size);
        }
        (0..sym.n).map(|eq| y[sym.inv[eq]] * self.scale[eq]).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skyline::Skyline;

    thread_local! {
        /// Elimination order the property tests use; see [`both_orders`].
        static REORDER: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    }

    /// Run a property test with the equation order and with minimum degree.
    fn both_orders(test: impl Fn()) {
        for reorder in [false, true] {
            REORDER.with(|r| r.set(reorder));
            test();
        }
    }

    /// Deterministic pseudo-random numbers in [0, 1).
    struct Lcg(u64);
    impl Lcg {
        fn next(&mut self) -> f64 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (self.0 >> 11) as f64 / (1u64 << 53) as f64
        }
        fn below(&mut self, n: usize) -> usize {
            (self.next() * n as f64) as usize % n.max(1)
        }
    }

    /// Element groups of a random 3D frame-like pattern: `nodes` nodes of
    /// `per` DOFs joined by random two-node elements.
    fn random_groups(rng: &mut Lcg, nodes: usize, per: usize, elements: usize) -> (usize, Vec<Vec<usize>>) {
        let mut groups = Vec::new();
        for e in 0..elements {
            let a = if e < nodes - 1 { e } else { rng.below(nodes) };
            let b = if e < nodes - 1 { e + 1 } else { rng.below(nodes) };
            if a == b {
                continue;
            }
            let mut g: Vec<usize> = (0..per).map(|i| a * per + i).chain((0..per).map(|i| b * per + i)).collect();
            g.sort_unstable();
            groups.push(g);
        }
        (nodes * per, groups)
    }

    /// The same matrix in both storages: a sum over elements of `B Bᵀ`
    /// (positive semidefinite) plus `diagonal` times a random diagonal.
    fn both(rng: &mut Lcg, n: usize, groups: &[Vec<usize>], diagonal: f64) -> (Skyline, SparseMatrix) {
        let mut sky = Skyline::with_profile(n, groups);
        let mut sparse = SparseMatrix::new(Rc::new(Symbolic::with_ordering(n, groups, REORDER.with(|r| r.get()))));
        for g in groups {
            // Rank-two element: two random vectors on its DOFs.
            for _ in 0..2 {
                let v: Vec<f64> = g.iter().map(|_| rng.next() - 0.5).collect();
                for (a, &i) in g.iter().enumerate() {
                    for (b, &j) in g.iter().enumerate() {
                        if j <= i {
                            sky.add(i, j, v[a] * v[b]);
                            sparse.add(i, j, v[a] * v[b]);
                        }
                    }
                }
            }
        }
        for i in 0..n {
            let d = diagonal * (0.5 + rng.next());
            sky.add(i, i, d);
            sparse.add(i, i, d);
        }
        (sky, sparse)
    }

    fn close(a: &[f64], b: &[f64], tol: f64) -> bool {
        let size = a.iter().chain(b).fold(1e-300_f64, |m, v| m.max(v.abs()));
        a.iter().zip(b).all(|(x, y)| (x - y).abs() <= tol * size)
    }

    #[test]
    fn matches_the_skyline_on_regular_matrices() {
        both_orders(|| {
            let mut rng = Lcg(7);
            for trial in 0..40 {
                let (n, groups) = random_groups(&mut rng, 5 + trial * 3, 1 + trial % 6, 12 + trial * 6);
                let shift = if trial % 3 == 0 { -0.7 } else { 0.0 };
                let (sky, sparse) = both(&mut rng, n, &groups, 1.0);
                let (a, b) = (sky.factor(shift), sparse.factor(shift));
                assert_eq!(a.inertia.null.len(), b.inertia.null.len(), "trial {trial}");
                assert_eq!(a.inertia.negative.len(), b.inertia.negative.len(), "trial {trial}");
                let rhs: Vec<f64> = (0..n).map(|_| rng.next() - 0.5).collect();
                if a.inertia.null.is_empty() {
                    assert!(close(&a.solve(&rhs), &b.solve(&rhs), 1e-8), "trial {trial}");
                }
            }
        });
    }

    /// Nullity of the unit-diagonal matrix by dense elimination with full
    /// pivoting, which separates the exact null space from rounding.
    fn nullity(k: &SparseMatrix, n: usize) -> usize {
        let d: Vec<f64> = (0..n).map(|i| k.get(i, i).abs().sqrt().max(1e-300)).collect();
        let mut m: Vec<Vec<f64>> = (0..n).map(|i| (0..n).map(|j| k.get(i, j) / (d[i] * d[j])).collect()).collect();
        let mut used = vec![false; n];
        let mut rank = 0;
        loop {
            let mut best = (1e-9, n, n);
            for i in (0..n).filter(|i| !used[*i]) {
                for j in (0..n).filter(|j| !used[*j]) {
                    if m[i][j].abs() > best.0 {
                        best = (m[i][j].abs(), i, j);
                    }
                }
            }
            if best.1 == n {
                return n - rank;
            }
            let (pi, pj) = (best.1, best.2);
            used[pi] = true;
            rank += 1;
            let row = m[pi].clone();
            for i in (0..n).filter(|i| !used[*i]) {
                let f = m[i][pj] / row[pj];
                for j in 0..n {
                    m[i][j] -= f * row[j];
                }
            }
        }
    }

    #[test]
    fn finds_every_null_vector_of_a_singular_matrix() {
        both_orders(|| {
            // No diagonal term: the rank is at most two per element, so these
            // matrices are far more singular than any structure (up to 40 %
            // nullity). Threshold rank detection without pivoting can then keep
            // a rounding-sized pivot of an exact null direction, in either
            // factorisation. The sparse factor must never report a false null
            // and must miss no more null directions, nor report more rounding-
            // sized negative pivots, in total than the skyline. (Measured: the
            // skyline misses 46 and reports 27 negatives; this factor 21 and 10.)
            let mut rng = Lcg(11);
            let (mut missed_skyline, mut missed_sparse) = (0, 0);
            let (mut negative_skyline, mut negative_sparse) = (0, 0);
            for trial in 0..30 {
                let (n, groups) = random_groups(&mut rng, 6 + trial * 2, 2 + trial % 4, 10 + trial * 3);
                let (sky, sparse) = both(&mut rng, n, &groups, 0.0);
                let b = sparse.factor(0.0);
                let exact = nullity(&sparse, n);
                assert!(b.inertia.null.len() <= exact, "trial {trial}");
                missed_sparse += exact - b.inertia.null.len();
                let reference = sky.factor(0.0);
                missed_skyline += exact - reference.inertia.null.len().min(exact);
                negative_sparse += b.inertia.negative.len();
                negative_skyline += reference.inertia.negative.len();
                for &dof in &b.inertia.null {
                    let v = b.pivot_vector(dof);
                    let kv = sparse.mul(&v);
                    let size = v.iter().fold(0.0_f64, |m, x| m.max(x.abs()));
                    let diag = (0..n).fold(0.0_f64, |m, i| m.max(sparse.get(i, i).abs()));
                    assert!(kv.iter().all(|x| x.abs() <= 1e-7 * size * diag.max(1.0)), "trial {trial} dof {dof}");
                    assert!(v[dof] != 0.0);
                }
                // A load orthogonal to the null space is solved exactly.
                let mut rhs = sparse.mul(&(0..n).map(|_| rng.next() - 0.5).collect::<Vec<_>>());
                let x = b.solve(&rhs);
                let back = sparse.mul(&x);
                assert!(close(&back, &rhs, 1e-6), "trial {trial}");
                rhs.iter_mut().for_each(|v| *v = 0.0);
                assert!(b.solve(&rhs).iter().all(|v| *v == 0.0));
            }
            assert!(missed_sparse <= missed_skyline, "sparse missed {missed_sparse}, skyline {missed_skyline}");
            assert!(negative_sparse <= negative_skyline, "sparse {negative_sparse} negatives, skyline {negative_skyline}");
        });
    }

    #[test]
    fn negative_curvature_directions_are_negative() {
        both_orders(|| {
            let mut rng = Lcg(3);
            let (n, groups) = random_groups(&mut rng, 40, 3, 120);
            let (_, sparse) = both(&mut rng, n, &groups, 1.0);
            let factor = sparse.factor(-1.2);
            assert!(!factor.inertia.negative.is_empty());
            for &dof in &factor.inertia.negative {
                let v = factor.pivot_vector(dof);
                // Curvature of the shifted, scaled matrix along v.
                let kv = sparse.mul(&v);
                let mut curvature: f64 = v.iter().zip(&kv).map(|(a, b)| a * b).sum();
                for i in 0..n {
                    curvature -= 1.2 * sparse.get(i, i).abs() * v[i] * v[i];
                }
                assert!(curvature < 0.0, "dof {dof}");
            }
        });
    }

    #[test]
    fn constrain_clears_row_and_column() {
        both_orders(|| {
            let mut rng = Lcg(5);
            let (n, groups) = random_groups(&mut rng, 20, 3, 50);
            let (mut sky, mut sparse) = both(&mut rng, n, &groups, 0.5);
            for dof in [0, 7, n - 1] {
                sky.constrain(dof);
                sparse.constrain(dof);
            }
            let x: Vec<f64> = (0..n).map(|_| rng.next()).collect();
            assert!(close(&sky.mul(&x), &sparse.mul(&x), 1e-12));
            let rhs: Vec<f64> = (0..n).map(|i| if [0, 7, n - 1].contains(&i) { 0.0 } else { rng.next() }).collect();
            assert!(close(&sky.factor(0.0).solve(&rhs), &sparse.factor(0.0).solve(&rhs), 1e-8));
        });
    }

    #[test]
    fn same_matrix_gives_the_same_factor() {
        both_orders(|| {
            let mut rng = Lcg(9);
            let (n, groups) = random_groups(&mut rng, 60, 6, 200);
            let (_, sparse) = both(&mut rng, n, &groups, 0.1);
            let rhs: Vec<f64> = (0..n).map(|_| rng.next()).collect();
            let (a, b) = (sparse.factor(0.0).solve(&rhs), sparse.factor(0.0).solve(&rhs));
            assert!(a.iter().zip(&b).all(|(x, y)| x.to_bits() == y.to_bits()));
        });
    }

    #[test]
    fn minimum_degree_beats_the_band_on_a_grid() {
        // A 3D grid of 6-DOF nodes: the band order has far more fill.
        let side = 9;
        let id = |i: usize, j: usize, k: usize| (i * side + j) * side + k;
        let mut groups = Vec::new();
        for i in 0..side {
            for j in 0..side {
                for k in 0..side {
                    for (di, dj, dk) in [(1, 0, 0), (0, 1, 0), (0, 0, 1)] {
                        let (a, b, c) = (i + di, j + dj, k + dk);
                        if a < side && b < side && c < side {
                            let (p, q) = (id(i, j, k), id(a, b, c));
                            groups.push((0..6).map(|d| p * 6 + d).chain((0..6).map(|d| q * 6 + d)).collect());
                        }
                    }
                }
            }
        }
        let n = side * side * side * 6;
        let sym = Symbolic::new(n, &groups);
        assert!(sym.reordered);
        assert!(sym.factor_work * 3.0 < envelope_work(&adjacency(n, &groups)));
        // A chain keeps its own order.
        let chain: Vec<Vec<usize>> = (0..50).map(|i| vec![i, i + 1]).collect();
        assert!(!Symbolic::new(51, &chain).reordered);
    }

    #[test]
    fn empty_and_one_by_one() {
        let empty = SparseMatrix::new(Rc::new(Symbolic::new(0, &[])));
        let f = empty.factor(0.0);
        assert!(f.solve(&[]).is_empty() && f.inertia.min_pivot == 1.0);
        let mut one = SparseMatrix::new(Rc::new(Symbolic::new(1, &[])));
        one.add(0, 0, 4.0);
        assert_eq!(one.factor(0.0).solve(&[2.0]), vec![0.5]);
    }
}
