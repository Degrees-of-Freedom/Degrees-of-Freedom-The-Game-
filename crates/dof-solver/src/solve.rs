//! Analysis of one structural component: stability classification, linear
//! solution, nonlinear equilibrium, and verification of the result.
//!
//! The order of work is:
//!
//! 1. **Linear stage.** Assemble the stiffness about the undeformed,
//!    prestressed state and factorise it. Null pivots are zero-stiffness
//!    motions. They are split into motions that move something
//!    (mechanisms) and motions that only spin things in place.
//! 2. **Nonlinear stage** (nonlinear fidelity only). Newton iterations on the
//!    full load, falling back to adaptive load increments. A first-order
//!    mechanism does not end the analysis here, because geometric stiffness
//!    may still give a stable equilibrium; the nonlinear result decides.
//! 3. **Verification.** A result is only reported as valid if the residual,
//!    the global force and moment balance and the element state laws hold.
//!
//! Nothing is ever stabilised artificially. Spin motions that no load acts
//! on are removed by fixing one DOF of each exactly, which changes no force.

use crate::math::*;
use crate::model::*;
use crate::skyline::{Factor, Skyline};
use crate::system::*;

/// A positive pivot below this marks a near-mechanism.
pub const NEAR_MECHANISM_PIVOT: f64 = 1e-7;
/// A null vector whose translations are below this fraction of its rotations
/// (times the characteristic length) is a pure rotation.
const ROTATION_ONLY: f64 = 1e-7;
/// Relative work above which a load is taken to drive a mode.
const LOADED_MODE: f64 = 1e-8;
/// Cable active-set rounds allowed in the linear stage.
const MAX_ACTIVE_SET: usize = 25;
/// Smallest load increment tried before giving up.
const MIN_LOAD_STEP: f64 = 1.0 / 1024.0;
/// Above this many null vectors the split into mechanisms and spins is not
/// computed exactly; see [`classify`].
const MAX_CLASSIFIED: usize = 96;
/// Normalised residual that rounding alone can produce; an iteration that
/// stalls below it has converged.
const ROUNDING_FLOOR: f64 = 1e-7;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Stable,
    Marginal,
    Unstable,
    Unknown,
}

/// A displacement pattern by equation.
pub struct Mode {
    pub kind: &'static str,
    pub shape: Vec<f64>,
}

/// A verified equilibrium.
pub struct Solution {
    pub eval: Eval,
    /// Deformed state; `None` for a linear solution.
    pub state: Option<State>,
    /// Linear displacements by equation (empty for a nonlinear solution).
    pub x: Vec<f64>,
    /// Multiplier on the model loads at this equilibrium.
    pub load_factor: f64,
}

pub struct Outcome {
    /// Inertia of the full-load constrained tangent after force/moment checks.
    /// Omitted for initial-tangent diagnoses and approximate mode splits.
    pub unstable_tangent: Option<(usize, usize)>,
    pub status: Status,
    pub reasons: Vec<&'static str>,
    pub solution: Option<Solution>,
    pub converged: bool,
    pub iterations: u32,
    /// Load increments accepted by the nonlinear solution (0 for linear).
    pub load_steps: u32,
    /// Fraction of the requested load at which equilibrium was last found.
    pub load_fraction_reached: f64,
    pub critical_load_factor: Option<f64>,
    pub residual: Option<f64>,
    pub force_imbalance: Option<f64>,
    pub moment_imbalance: Option<f64>,
    pub min_pivot: Option<f64>,
    pub mechanisms: usize,
    pub rigid_body_modes: usize,
    pub spin_modes: usize,
    pub modes: Vec<Mode>,
    pub max_displacement: Option<f64>,
}

struct Nulls {
    translational: Vec<Vec<f64>>,
    spin: Vec<Vec<f64>>,
    /// One DOF per spin mode whose restraint removes exactly that mode.
    gauge: Vec<usize>,
    spin_loaded: bool,
}

fn dot_n(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// Split the null space of a factorised stiffness into motions that translate
/// something and motions that only rotate. The null vectors from the factor
/// are an arbitrary basis, so translational content is eliminated from as
/// many of them as possible; what remains is the pure-rotation subspace.
///
/// With more than [`MAX_CLASSIFIED`] null vectors (a structure in pieces) the
/// elimination is skipped and each vector is classified by its own pivot DOF.
fn classify(sys: &System, factor: &Factor, load: &[f64]) -> Nulls {
    let weight = |eq: usize| if sys.eq_rot[eq] { sys.lc } else { 1.0 };
    let normalise = |v: &mut Vec<f64>| {
        let peak = v.iter().enumerate().map(|(i, x)| x.abs() * weight(i)).fold(0.0, f64::max);
        if peak > 0.0 {
            v.iter_mut().for_each(|x| *x /= peak);
        }
    };
    let mut nulls = Nulls { translational: Vec::new(), spin: Vec::new(), gauge: Vec::new(), spin_loaded: false };
    let dofs = &factor.inertia.null;
    if dofs.len() > MAX_CLASSIFIED {
        for &dof in dofs {
            let mut v = factor.pivot_vector(dof);
            normalise(&mut v);
            if sys.eq_rot[dof] {
                nulls.gauge.push(dof);
                nulls.spin.push(v);
            } else {
                nulls.translational.push(v);
            }
        }
    } else {
        let mut pool: Vec<Vec<f64>> = dofs.iter().map(|j| factor.pivot_vector(*j)).collect();
        pool.iter_mut().for_each(normalise);
        loop {
            let mut best = (ROTATION_ONLY, usize::MAX, 0usize);
            for (i, v) in pool.iter().enumerate() {
                for (eq, value) in v.iter().enumerate() {
                    if !sys.eq_rot[eq] && value.abs() > best.0 {
                        best = (value.abs(), i, eq);
                    }
                }
            }
            if best.1 == usize::MAX {
                break;
            }
            let pivot = pool.remove(best.1);
            for v in pool.iter_mut() {
                let ratio = v[best.2] / pivot[best.2];
                if ratio != 0.0 {
                    v.iter_mut().zip(&pivot).for_each(|(x, p)| *x -= ratio * p);
                    v[best.2] = 0.0;
                    normalise(v);
                }
            }
            nulls.translational.push(pivot);
        }
        // Pick the gauge DOFs by elimination with pivoting on the spin space.
        let mut reduced = pool.clone();
        for i in 0..reduced.len() {
            let (dof, _) = reduced[i].iter().enumerate().fold((0, 0.0), |b, (eq, x)| if x.abs() * weight(eq) > b.1 { (eq, x.abs() * weight(eq)) } else { b });
            nulls.gauge.push(dof);
            let pivot = reduced[i].clone();
            for v in reduced.iter_mut().skip(i + 1) {
                let ratio = v[dof] / pivot[dof];
                v.iter_mut().zip(&pivot).for_each(|(x, p)| *x -= ratio * p);
                v[dof] = 0.0;
            }
        }
        nulls.spin = pool;
    }
    let load_size = dot_n(load, load).sqrt();
    nulls.spin_loaded = nulls.spin.iter().any(|v| dot_n(load, v).abs() > LOADED_MODE * load_size * dot_n(v, v).sqrt());
    nulls
}

/// Number of rigid-body motions of the component that the foundations leave
/// free and that move at least one of its DOFs.
///
/// The restraints are constraints on a rigid motion (translation plus
/// rotation); its null space is the set of permitted rigid motions. A
/// permitted motion that moves nothing, such as a rotation about the line
/// through the nodes of a single guyed cable, does not count.
fn free_rigid_motions(sys: &System) -> usize {
    let scale = sys.size.max(sys.lc).max(1e-9);
    let mut rows: Vec<[f64; 6]> = Vec::new();
    for node in &sys.anodes {
        let x = node.pos.map(|v| v / scale);
        for i in 0..6 {
            if node.eq[i] != RESTRAINED || (i >= 3 && !node.rotational) {
                continue;
            }
            let mut axis = [0.0; 3];
            axis[i % 3] = 1.0;
            let arm = cross(&x, &axis);
            rows.push(if i < 3 { [axis[0], axis[1], axis[2], arm[0], arm[1], arm[2]] } else { [0.0, 0.0, 0.0, axis[0], axis[1], axis[2]] });
        }
    }
    // Reduced row echelon form, recording the pivot column of each row.
    let mut pivots: Vec<usize> = Vec::new();
    for column in 0..6 {
        let rank = pivots.len();
        let Some(best) = (rank..rows.len()).max_by(|a, b| rows[*a][column].abs().total_cmp(&rows[*b][column].abs())) else { break };
        if rows[best][column].abs() < 1e-8 {
            continue;
        }
        rows.swap(rank, best);
        let pivot = rows[rank].map(|v| v / rows[rank][column]);
        rows[rank] = pivot;
        for (r, row) in rows.iter_mut().enumerate() {
            if r != rank {
                let ratio = row[column];
                for k in 0..6 {
                    row[k] -= ratio * pivot[k];
                }
            }
        }
        pivots.push(column);
    }
    // One permitted motion per free column, expressed on the system's DOFs.
    let mut motions: Vec<Vec<f64>> = Vec::new();
    for free in (0..6).filter(|c| !pivots.contains(c)) {
        let mut motion = [0.0; 6];
        motion[free] = 1.0;
        for (r, &column) in pivots.iter().enumerate() {
            motion[column] = -rows[r][free];
        }
        let (t, w) = ([motion[0], motion[1], motion[2]], [motion[3], motion[4], motion[5]]);
        let mut on_dofs = Vec::new();
        for node in &sys.anodes {
            let u = add(&t, &cross(&w, &node.pos.map(|v| v / scale)));
            for i in 0..6 {
                if node.eq[i] >= 0 {
                    on_dofs.push(if i < 3 { u[i] } else { w[i - 3] });
                }
            }
        }
        // Keep it only if it is independent of the motions already found.
        for kept in &motions {
            let along = dot_n(&on_dofs, kept);
            on_dofs.iter_mut().zip(kept).for_each(|(x, k)| *x -= along * k);
        }
        let size = dot_n(&on_dofs, &on_dofs).sqrt();
        if size > 1e-8 {
            on_dofs.iter_mut().for_each(|x| *x /= size);
            motions.push(on_dofs);
        }
    }
    motions.len()
}

struct LinearStage {
    factor: Factor,
    nulls: Nulls,
    x: Vec<f64>,
    eval: Option<Eval>,
    /// The cable active set stopped changing.
    settled: bool,
}

fn linear_stage(sys: &System, f: &[f64], lam: f64) -> LinearStage {
    let zeros = vec![0.0; sys.neq];
    let mut active: Vec<bool> = sys.bars.iter().map(|b| !b.geom.cable || b.geom.initial_force() >= 0.0).collect();
    let mut k = sys.stiffness();
    let mut round = 0;
    loop {
        k.clear();
        let base = sys.evaluate(&Config::Linear { x: &zeros, active: &active }, Some(&mut k));
        let rhs: Vec<f64> = (0..sys.neq).map(|i| lam * f[i] - base.g_eq[i]).collect();
        let factor = k.factor(0.0);
        let nulls = classify(sys, &factor, &rhs);
        if !nulls.translational.is_empty() || nulls.spin_loaded || !factor.inertia.negative.is_empty() {
            return LinearStage { factor, nulls, x: zeros, eval: None, settled: false };
        }
        let x = factor.solve(&rhs);
        let eval = sys.evaluate(&Config::Linear { x: &x, active: &active }, None);
        let tolerance = 1e-9 * eval.force_scale.max(lam.abs() * sys.load_norm());
        let mut next = active.clone();
        for (b, bar) in sys.bars.iter().enumerate() {
            if !bar.geom.cable {
                continue;
            }
            if active[b] {
                next[b] = eval.bars[b].0 >= -tolerance;
            } else {
                let at = |e: i32| if e >= 0 { x[e as usize] } else { 0.0 };
                let (a, c) = (sys.anodes[bar.n[0]].eq, sys.anodes[bar.n[1]].eq);
                let du = [0, 1, 2].map(|i| at(c[i]) - at(a[i]));
                next[b] = bar.geom.linear(&du, true).axial > tolerance;
            }
        }
        round += 1;
        if next == active || round >= MAX_ACTIVE_SET {
            let settled = next == active;
            return LinearStage { factor, nulls, x, eval: Some(eval), settled };
        }
        active = next;
    }
}

struct Converged {
    eval: Eval,
    /// Factor of the tangent stiffness at the converged state.
    factor: Factor,
    residual: f64,
}

enum Failure {
    Budget,
    NoConvergence,
    NonFinite,
}

struct Newton<'a> {
    sys: &'a System,
    f: &'a [f64],
    gauge: &'a [usize],
    options: &'a Options,
    stiffness: Skyline,
    /// A factorised tangent from an earlier, nearby state, to start from.
    carry: Option<Factor>,
    iterations: u32,
    /// Load increments accepted on the way to the target load.
    steps: u32,
    budget: u32,
}

/// A residual that falls by less than this factor in one iteration means the
/// tangent in use is out of date and is rebuilt.
const SLOW_CONVERGENCE: f64 = 0.3;

impl Newton<'_> {
    /// Assemble the tangent stiffness at `state` into `self.stiffness`.
    /// At the undeformed state it is the stored linear stiffness, which costs
    /// almost nothing; elsewhere it is differentiated afresh.
    fn assemble(&mut self, state: &State, reference: bool) {
        let sys = self.sys;
        self.stiffness.clear();
        if reference {
            let zeros = vec![0.0; sys.neq];
            // The same cable states the nonlinear evaluation finds here.
            let active: Vec<bool> = sys.bars.iter().map(|b| !b.geom.cable || b.geom.initial_force() > 0.0).collect();
            sys.evaluate(&Config::Linear { x: &zeros, active: &active }, Some(&mut self.stiffness));
        } else {
            sys.evaluate(&Config::Nonlinear(state), Some(&mut self.stiffness));
        }
        for &dof in self.gauge {
            self.stiffness.constrain(dof);
        }
    }

    /// Iterate `state` to equilibrium under `lam` times the loads.
    /// `reference` says that `state` is the undeformed state.
    ///
    /// Each iteration evaluates the internal forces only. The tangent
    /// stiffness is kept from one iteration to the next and rebuilt when
    /// convergence slows or a step fails (a modified Newton method), so most
    /// iterations cost one force evaluation and one back-substitution.
    ///
    /// The step direction is the tangent solve whenever the tangent is
    /// positive definite. Otherwise the scaled tangent is shifted towards the
    /// identity until it is, which turns the step towards steepest descent of
    /// the potential energy. A backtracking line search on that energy
    /// accepts the step, so every accepted step lowers the energy.
    ///
    /// On convergence the tangent is rebuilt at the solution and returned
    /// factorised, because its inertia decides whether the equilibrium is
    /// stable.
    fn solve(&mut self, state: &mut State, lam: f64, mut reference: bool) -> Result<Converged, Failure> {
        let sys = self.sys;
        let mut shift = 0.0;
        let mut previous = f64::INFINITY;
        let mut factor = self.carry.take();
        // Whether `factor` was formed at the current state.
        let mut current = false;
        for _ in 0..self.options.max_iterations {
            if self.budget == 0 {
                return Err(Failure::Budget);
            }
            self.budget -= 1;
            self.iterations += 1;
            let eval = sys.evaluate(&Config::Nonlinear(state), None);
            let mut r: Vec<f64> = (0..sys.neq).map(|i| lam * self.f[i] - eval.g_eq[i]).collect();
            for &dof in self.gauge {
                r[dof] = 0.0;
            }
            let scale = (lam.abs() * sys.load_norm()).max(eval.force_scale);
            let residual = if scale > 0.0 { sys.force_norm(&r) / scale } else { 0.0 };
            if !residual.is_finite() || !eval.energy.is_finite() {
                return Err(Failure::NonFinite);
            }
            if residual <= self.options.tolerance || (residual <= ROUNDING_FLOOR && residual > 0.5 * previous) {
                self.assemble(state, reference);
                let factor = self.stiffness.factor(0.0);
                return Ok(Converged { eval, factor, residual });
            }
            if residual > SLOW_CONVERGENCE * previous || shift > 0.0 {
                factor = None;
            }
            previous = residual;

            let work = eval.energy.abs();
            let r_size = dot_n(&r, &r).sqrt();
            let mut assembled = false;
            let accepted = loop {
                if factor.is_none() {
                    if !assembled {
                        self.assemble(state, reference);
                        assembled = true;
                    }
                    factor = Some(self.stiffness.factor(shift));
                    current = true;
                }
                let Some(tangent) = factor.as_ref() else { return Err(Failure::NoConvergence) };
                // A singular tangent is usable only if the residual does not
                // push along its null vectors.
                let usable = tangent.inertia.negative.is_empty()
                    && tangent.inertia.null.iter().all(|j| {
                        let v = tangent.pivot_vector(*j);
                        dot_n(&r, &v).abs() <= LOADED_MODE * r_size * dot_n(&v, &v).sqrt()
                    });
                let mut step = None;
                if usable {
                    let d = tangent.solve(&r);
                    let slope = dot_n(&r, &d);
                    let external: f64 = lam * dot_n(self.f, &d);
                    let mut alpha = 1.0;
                    for _ in 0..14 {
                        if !(slope > 0.0) {
                            break;
                        }
                        let trial = sys.advance(state, &d, alpha);
                        let energy = sys.energy(&trial);
                        let change = energy - eval.energy - alpha * external;
                        let rounding = 1e-12 * (work + energy.abs() + (alpha * external).abs());
                        if energy.is_finite() && (change <= -1e-4 * alpha * slope || change.abs() <= rounding) {
                            step = Some(trial);
                            break;
                        }
                        alpha *= 0.5;
                    }
                }
                if let Some(next) = step {
                    break next;
                }
                // No acceptable step. An out-of-date tangent gets one more
                // chance rebuilt here; a current one is shifted further.
                if current {
                    shift = if shift == 0.0 { 1e-6 } else { shift * 100.0 };
                    if shift > 1e6 {
                        return Err(Failure::NoConvergence);
                    }
                }
                factor = None;
            };
            *state = accepted;
            reference = false;
            current = false;
            shift = if shift <= 1e-8 { 0.0 } else { shift * 0.1 };
        }
        Err(Failure::NoConvergence)
    }

    /// Equilibrium at `target` times the loads: directly if possible,
    /// otherwise by adaptive load increments from the undeformed state.
    /// On failure returns the fraction of the load that was reached.
    fn path(&mut self, target: f64) -> Result<(State, Converged), (f64, Failure)> {
        let mut state = self.sys.reference();
        match self.solve(&mut state, target, true) {
            Ok(result) => {
                self.steps += 1;
                return Ok((state, result));
            }
            Err(Failure::Budget) => return Err((0.0, Failure::Budget)),
            Err(_) => {}
        }
        let mut state = self.sys.reference();
        let (mut fraction, mut step) = (0.0_f64, 0.25_f64);
        // Settle prestress on its own before any load is applied.
        self.carry = None;
        let settled = match self.solve(&mut state, 0.0, true) {
            Ok(result) => result,
            Err(failure) => return Err((0.0, failure)),
        };
        // Each increment starts from the tangent of the one before.
        self.carry = Some(settled.factor);
        loop {
            let next = (fraction + step).min(1.0);
            let mut trial = state.clone();
            match self.solve(&mut trial, next * target, false) {
                Ok(result) => {
                    state = trial;
                    fraction = next;
                    self.steps += 1;
                    if fraction >= 1.0 {
                        return Ok((state, result));
                    }
                    self.carry = Some(result.factor);
                    step *= 1.5;
                }
                Err(Failure::Budget) => return Err((fraction, Failure::Budget)),
                Err(failure) => {
                    step *= 0.5;
                    if step < MIN_LOAD_STEP {
                        return Err((fraction, failure));
                    }
                }
            }
        }
    }
}

/// Whether a converged tangent shows a stable equilibrium.
fn tangent_stable(sys: &System, converged: &Converged, load: &[f64]) -> bool {
    converged.factor.inertia.negative.is_empty() && classify(sys, &converged.factor, load).translational.is_empty()
}

/// Sum of all external forces and of their moments about the origin,
/// reactions included, normalised by the load scale. Both are zero for a
/// structure in equilibrium.
fn imbalance(sys: &System, eval: &Eval, state: Option<&State>, lam: f64) -> (f64, f64) {
    let (mut force, mut moment) = ([0.0; 3], [0.0; 3]);
    // Moments are taken about the centroid of the nodes, not the origin, so
    // that a structure far from the origin keeps the precision of its check.
    let count = sys.anodes.len().max(1) as f64;
    let centroid = sys.anodes.iter().fold([0.0; 3], |c, n| add(&c, &n.pos)).map(|v| v / count);
    for (a, node) in sys.anodes.iter().enumerate() {
        let total: [f64; 6] = std::array::from_fn(|i| if node.eq[i] == RESTRAINED { eval.g[a][i] } else { lam * sys.fext[a][i] });
        let offset = sub(&node.pos, &centroid);
        let position = match state {
            Some(s) => add(&offset, &s.u[a]),
            None => offset,
        };
        let arm = cross(&position, &[total[0], total[1], total[2]]);
        for i in 0..3 {
            force[i] += total[i];
            moment[i] += arm[i] + total[3 + i];
        }
    }
    let scale = (lam.abs() * sys.load_norm()).max(eval.force_scale);
    if scale == 0.0 {
        return (0.0, 0.0);
    }
    (norm(&force) / scale, norm(&moment) / (scale * sys.size.max(sys.lc)))
}

fn largest_displacement(sys: &System, solution: &Solution) -> f64 {
    let mut largest: f64 = 0.0;
    for (a, node) in sys.anodes.iter().enumerate() {
        let u = match &solution.state {
            Some(state) => state.u[a],
            None => [0, 1, 2].map(|i| if node.eq[i] >= 0 { solution.x[node.eq[i] as usize] } else { 0.0 }),
        };
        largest = largest.max(norm(&u));
    }
    largest
}

pub fn analyze(sys: &System, options: &Options) -> Outcome {
    let f = sys.load_vector();
    let lam = options.load_factor;
    let mut out = Outcome {
        unstable_tangent: None,
        status: Status::Unknown,
        reasons: Vec::new(),
        solution: None,
        converged: false,
        iterations: 0,
        load_steps: 0,
        load_fraction_reached: 0.0,
        critical_load_factor: None,
        residual: None,
        force_imbalance: None,
        moment_imbalance: None,
        min_pivot: None,
        mechanisms: 0,
        rigid_body_modes: 0,
        spin_modes: 0,
        modes: Vec::new(),
        max_displacement: None,
    };

    let linear = linear_stage(sys, &f, lam);
    let mechanisms = linear.nulls.translational.len();
    out.mechanisms = mechanisms;
    out.spin_modes = linear.nulls.spin.len();
    out.rigid_body_modes = free_rigid_motions(sys).min(mechanisms + out.spin_modes);
    out.min_pivot = Some(linear.factor.inertia.min_pivot);
    for v in &linear.nulls.translational {
        out.modes.push(Mode { kind: "mechanism", shape: v.clone() });
    }
    for v in &linear.nulls.spin {
        out.modes.push(Mode { kind: "spin", shape: v.clone() });
    }
    let unsupported = sys.anodes.iter().all(|n| n.eq.iter().all(|e| *e != RESTRAINED));
    if mechanisms > 0 {
        out.reasons.push("mechanism");
        if unsupported {
            out.reasons.push("unsupported");
        } else if out.rigid_body_modes > 0 {
            out.reasons.push("rigidBodyMotion");
        }
        if mechanisms > out.rigid_body_modes {
            out.reasons.push("internalMechanism");
        }
    }
    if linear.nulls.spin_loaded {
        out.reasons.push("loadedSpinMode");
    }
    if !sys.moment_on_unused.is_empty() {
        out.reasons.push("momentOnUnusedRotation");
    }
    let prestress_unstable = !linear.factor.inertia.negative.is_empty();
    // Conditions no amount of deformation can cure.
    let hopeless = linear.nulls.spin_loaded || !sys.moment_on_unused.is_empty() || (mechanisms > 0 && out.rigid_body_modes > 0);
    let first_order_unstable = mechanisms > 0 || hopeless;

    if options.fidelity == Fidelity::Linear || hopeless {
        if first_order_unstable {
            out.status = Status::Unstable;
        } else if prestress_unstable {
            out.status = Status::Unstable;
            out.reasons.push("loadInducedInstability");
            if let Some(&dof) = linear.factor.inertia.negative.first() {
                out.modes.push(Mode { kind: "buckling", shape: linear.factor.pivot_vector(dof) });
            }
        } else if !linear.settled {
            out.reasons.push("cableStateUnresolved");
        } else if let Some(eval) = linear.eval {
            let residual: Vec<f64> = (0..sys.neq).map(|i| lam * f[i] - eval.g_eq[i]).collect();
            let scale = (lam.abs() * sys.load_norm()).max(eval.force_scale);
            // Null-pivot DOFs carry no equation; their residual is not an error.
            let mut checked = residual;
            for &dof in &linear.factor.inertia.null {
                checked[dof] = 0.0;
            }
            let normalised = if scale > 0.0 { sys.force_norm(&checked) / scale } else { 0.0 };
            out.converged = true;
            out.load_fraction_reached = 1.0;
            let prestressed = sys.bars.iter().any(|b| b.geom.initial_force() != 0.0);
            finish(sys, options, &mut out, Solution { eval, state: None, x: linear.x, load_factor: lam }, normalised, !prestressed);
            if out.status == Status::Stable && linear.factor.inertia.min_pivot < NEAR_MECHANISM_PIVOT {
                out.status = Status::Marginal;
                out.reasons.push("nearMechanism");
            }
        }
        return out;
    }

    let mut newton = Newton { sys, f: &f, gauge: &linear.nulls.gauge, options, stiffness: sys.stiffness(), carry: None, iterations: 0, steps: 0, budget: options.max_total_iterations };
    let path = newton.path(lam);
    out.iterations = newton.iterations;
    out.load_steps = newton.steps;
    let load: Vec<f64> = f.iter().map(|v| lam * v).collect();
    match path {
        Err((fraction, failure)) => {
            out.load_fraction_reached = fraction;
            // A first-order mechanism alone may still stabilize through
            // finite deformation. A cut hinge supplies a stronger, purely
            // kinematic proof if its exact rigid motions span the nullspace.
            // Neither outcome supplies forces at a missing equilibrium.
            if first_order_unstable {
                if linear.factor.inertia.null.len() <= MAX_CLASSIFIED &&
                    crate::hinge::spans_reference_modes(sys, &linear.nulls.translational) {
                    out.status = Status::Unstable;
                    out.reasons.push("finiteReferenceMechanism");
                }
                out.reasons.push("recoveryFailed");
            }
            out.reasons.push(match failure {
                Failure::Budget => "iterationLimit",
                Failure::NoConvergence => "noConvergence",
                Failure::NonFinite => "nonFinite",
            });
        }
        Ok((state, converged)) => {
            out.converged = true;
            out.load_fraction_reached = 1.0;
            out.min_pivot = Some(converged.factor.inertia.min_pivot);
            let tangent = classify(sys, &converged.factor, &load);
            if !converged.factor.inertia.negative.is_empty() || !tangent.translational.is_empty() {
                // A witnessed mode is physical evidence only at an equilibrated
                // state. Its count is independent of the order/sign of vectors.
                let (force, moment) = imbalance(sys, &converged.eval, Some(&state), lam);
                let residual = converged.residual;
                out.force_imbalance = Some(force);
                out.moment_imbalance = Some(moment);
                out.residual = Some(residual);
                if ![force,moment,residual].iter().all(|v| v.is_finite() && *v <= options.residual_gate) {
                    out.reasons.push("equilibriumNotVerified");
                    return out;
                }
                if converged.factor.inertia.null.len() <= MAX_CLASSIFIED {
                    out.unstable_tangent = Some((converged.factor.inertia.negative.len(), tangent.translational.len()));
                }
                // Report the final modes, including a change in nullity from
                // the initial tangent. Zero-energy spins have no translational
                // rank and never raise the severity.
                out.modes.retain(|m| m.kind == "spin");
                out.mechanisms = tangent.translational.len();
                out.modes.extend(tangent.translational.iter().map(|v| Mode {kind: "mechanism", shape:v.clone()}));
            }
            if !converged.factor.inertia.negative.is_empty() {
                out.status = Status::Unstable;
                out.reasons.push("loadInducedInstability");
                let dof = converged.factor.inertia.negative[0];
                out.modes.push(Mode { kind: "buckling", shape: converged.factor.pivot_vector(dof) });
                if options.critical_load_search {
                    let (factor, used) = critical_load(sys, &f, &linear.nulls.gauge, options, lam);
                    out.critical_load_factor = factor;
                    out.iterations += used;
                }
            } else if !tangent.translational.is_empty() {
                out.status = Status::Unstable;
                if !first_order_unstable {
                    out.reasons.push("mechanism");
                }
            } else {
                if first_order_unstable {
                    // A first-order mechanism that geometric stiffness holds.
                    out.reasons.retain(|r| *r != "mechanism" && *r != "internalMechanism");
                    out.reasons.push("stabilisedByGeometry");
                    out.modes.retain(|m| m.kind != "mechanism");
                    out.mechanisms = 0;
                }
                let residual = converged.residual;
                let stable_state = state.clone();
                finish(sys, options, &mut out, Solution { eval: converged.eval, state: Some(state), x: Vec::new(), load_factor: lam }, residual, true);
                if out.status == Status::Stable {
                    if converged.factor.inertia.min_pivot < NEAR_MECHANISM_PIVOT {
                        out.status = Status::Marginal;
                        out.reasons.push("nearMechanism");
                    } else if options.stability_margin > 1.0 && lam != 0.0 {
                        // Does the equilibrium survive a little more load?
                        let mut probe = Newton { budget: options.max_total_iterations, iterations: 0, stiffness: sys.stiffness(), carry: Some(converged.factor), ..newton };
                        let mut state = stable_state;
                        let amplified: Vec<f64> = load.iter().map(|v| v * options.stability_margin).collect();
                        let survives = probe.solve(&mut state, lam * options.stability_margin, false)
                            .ok().map(|result| tangent_stable(sys, &result, &amplified));
                        out.iterations += probe.iterations;
                        if survives == Some(false) {
                            out.status = Status::Marginal;
                            out.reasons.push("lowStabilityMargin");
                        } else if survives.is_none() {
                            out.reasons.push("reserveUnresolved");
                        }
                    }
                }
            }
        }
    }
    out
}

/// Accept or reject an equilibrium and record its quality measures.
fn finish(sys: &System, options: &Options, out: &mut Outcome, solution: Solution, residual: f64, check_moments: bool) {
    let (force, moment) = imbalance(sys, &solution.eval, solution.state.as_ref(), solution.load_factor);
    out.residual = Some(residual);
    out.force_imbalance = Some(force);
    out.moment_imbalance = Some(moment);
    let gate = options.residual_gate;
    let finite = solution.eval.g.iter().flatten().all(|v| v.is_finite()) && solution.x.iter().all(|v| v.is_finite());
    if !finite || !residual.is_finite() {
        out.reasons.push("nonFinite");
        return;
    }
    if residual > gate || force > gate || (check_moments && moment > gate) {
        out.reasons.push("equilibriumNotVerified");
        return;
    }
    let displacement = largest_displacement(sys, &solution);
    out.max_displacement = Some(displacement);
    out.status = Status::Stable;
    if sys.size > 0.0 && displacement > options.excessive_displacement_ratio * sys.size {
        out.status = Status::Unstable;
        out.reasons.push("excessiveDeformation");
    }
    out.solution = Some(solution);
}

/// Load factor at which the fundamental equilibrium path first loses
/// stability, found by bisection between zero and the applied factor.
/// Returns the factor, if found, and the Newton iterations the search used.
fn critical_load(sys: &System, f: &[f64], gauge: &[usize], options: &Options, lam: f64) -> (Option<f64>, u32) {
    let mut newton = Newton { sys, f, gauge, options, stiffness: sys.stiffness(), carry: None, iterations: 0, steps: 0, budget: options.max_total_iterations };
    let factor = critical_load_with(&mut newton, sys, f, lam);
    (factor, newton.iterations)
}

fn critical_load_with(newton: &mut Newton, sys: &System, f: &[f64], lam: f64) -> Option<f64> {
    let stable_at = |newton: &mut Newton, fraction: f64| -> Option<bool> {
        let mut state = sys.reference();
        let load: Vec<f64> = f.iter().map(|v| v * fraction * lam).collect();
        match newton.solve(&mut state, fraction * lam, true) {
            Ok(result) => Some(tangent_stable(sys, &result, &load)),
            Err(_) => None,
        }
    };
    if stable_at(newton, 0.0)? == false {
        return None;
    }
    let (mut low, mut high) = (0.0, 1.0);
    for _ in 0..12 {
        let middle = 0.5 * (low + high);
        match stable_at(newton, middle) {
            Some(true) => low = middle,
            Some(false) => high = middle,
            None => return None,
        }
    }
    Some(0.5 * (low + high) * lam)
}
