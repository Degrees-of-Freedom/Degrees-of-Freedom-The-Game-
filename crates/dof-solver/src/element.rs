//! Element formulations.
//!
//! **Beam-column.** A corotational element: a frame that follows the element
//! through arbitrarily large displacements and rotations is removed, leaving
//! small local deformations that are treated with linear beam theory plus the
//! low-order axial–bending coupling ("bowing") term that captures the member
//! P-δ effect inside one element. The strain energy is written once in
//! [`seg_energy`]; its automatic derivatives give the internal force and the
//! consistent tangent stiffness. Evaluated at the undeformed state, the same
//! Hessian is the classical linear 3D beam stiffness matrix.
//!
//! The element's 24 variables are the incremental motion of its two nodes
//! (translation and spin, 12 values) followed by the relative motions of its
//! two end connections (12 values). A rigid connection law has no variable: the
//! member end is tied to the node exactly. A free or elastic law adds one
//! variable, the relative motion between node and member end along that
//! connection axis, with spring energy for an elastic law.
//!
//! **Axial members.** Braces and cables are straight two-node bars with a
//! closed-form corotational force and tangent. A cable carries no compression.

use crate::ad::{Dual1, Dual2, Scalar};
use crate::math::*;

/// Constant data of one beam element.
#[derive(Clone, Debug)]
pub struct SegGeom {
    /// Vector from the first to the second node, undeformed.
    pub dx: V3<f64>,
    pub l0: f64,
    /// Undeformed local axes as matrix columns.
    pub e0: M3<f64>,
    /// Columns are each connector's axes expressed in the reference member frame.
    pub connector_basis: [M3<f64>; 2],
    pub ea: f64,
    pub gj: f64,
    pub eiy: f64,
    pub eiz: f64,
    /// Shear flexibility ratios 12EI/(G·As·L²) for bending about y and z.
    pub phi_y: f64,
    pub phi_z: f64,
    /// Per end and local DOF: whether the connection law has a variable, and
    /// its spring stiffness (zero for a free law).
    pub conn_var: [bool; 12],
    pub conn_k: [f64; 12],
}

/// Current configuration of a beam element's nodes.
#[derive(Clone, Copy, Debug)]
pub struct SegState {
    pub u: [V3<f64>; 2],
    pub r: [M3<f64>; 2],
}

pub const REFERENCE: SegState = SegState { u: [[0.0; 3]; 2], r: [IDENTITY; 2] };

// Differentiation variables of one element. The energy depends on the node
// translations only through their difference, so the twelve node motions
// reduce to nine variables; the connection variables follow.
const VAR_DU: usize = 0;
const VAR_SPIN: [usize; 2] = [3, 6];
const VAR_Q: usize = 9;

/// Differentiation variable of connection variable `i`. Only the laws that
/// have a variable are numbered, so an element with a few releases
/// differentiates in a few extra variables instead of twelve.
fn connection_variable(g: &SegGeom, i: usize) -> usize {
    VAR_Q + g.conn_var[..i].iter().filter(|v| **v).count()
}

/// Orientation of the connection axes at one node: the undeformed local
/// axes turned with the node, as a function of the node's incremental spin.
///
/// The spin enters as `exp(spin) · R · E0`, evaluated at zero spin, so the
/// value and both derivatives are known in closed form and are seeded
/// directly instead of being pushed through the exponential map.
#[inline(never)]
fn node_triad<T: Scalar>(g: &SegGeom, s: &SegState, k: usize) -> M3<T> {
    let m = mat_mul(&s.r[k], &g.e0);
    let mut out = [[T::cst(0.0); 3]; 3];
    for c in 0..3 {
        let column = col(&m, c);
        if !T::DERIVATIVES {
            for r in 0..3 {
                out[r][c] = T::cst(column[r]);
            }
            continue;
        }
        let axis = |i: usize| -> V3<f64> { std::array::from_fn(|k| if k == i { 1.0 } else { 0.0 }) };
        // d/dθi = ei × column; d²/dθi dθj = ½ (ei × (ej × column) + ej × (ei × column)).
        let first: [V3<f64>; 3] = std::array::from_fn(|i| cross(&axis(i), &column));
        for r in 0..3 {
            let mut second = [[0.0; 3]; 3];
            for i in 0..3 {
                for j in 0..3 {
                    second[i][j] = 0.5 * (cross(&axis(i), &first[j])[r] + cross(&axis(j), &first[i])[r]);
                }
            }
            out[r][c] = T::seeded3(column[r], VAR_SPIN[k], &[first[0][r], first[1][r], first[2][r]], &second);
        }
    }
    out
}

/// Offset and orientation of one member end relative to its node: the
/// sliding of translational releases and the triad after rotational ones.
#[inline(never)]
fn end_kinematics<T: Scalar>(g: &SegGeom, s: &SegState, q: &[f64; 12], k: usize) -> (Option<V3<T>>, M3<T>) {
    let b = 6 * k;
    let triad = node_triad::<T>(g, s, k);
    let variable = |i: usize| if g.conn_var[b + i] { T::variable(q[b + i], connection_variable(g, b + i)) } else { T::cst(q[b + i]) };
    let slides = g.conn_var[b] || g.conn_var[b + 1] || g.conn_var[b + 2];
    let motion = |i| mat_vec(&lift(&g.connector_basis[k]), &[variable(i), variable(i + 1), variable(i + 2)]);
    let slide = slides.then(|| mat_vec(&triad, &motion(0)));
    let turns = g.conn_var[b + 3] || g.conn_var[b + 4] || g.conn_var[b + 5];
    let triad = if turns { mat_mul(&triad, &exp_so3(&motion(3))) } else { triad };
    (slide, triad)
}

/// Corotated frame and local deformations: frame (columns), axial
/// elongation, and the local rotation vectors of the two ends.
#[inline(never)]
fn local_deformation<T: Scalar>(g: &SegGeom, s: &SegState, q: &[f64; 12]) -> (M3<T>, T, V3<T>, V3<T>) {
    let (slide1, t1) = end_kinematics::<T>(g, s, q, 0);
    let (slide2, t2) = end_kinematics::<T>(g, s, q, 1);
    let mut du: V3<T> = std::array::from_fn(|i| T::variable(s.u[1][i] - s.u[0][i], VAR_DU + i));
    if let Some(slide) = slide2 {
        du = add(&du, &slide);
    }
    if let Some(slide) = slide1 {
        du = sub(&du, &slide);
    }
    let d: V3<T> = std::array::from_fn(|i| du[i].offset(g.dx[i]));
    let length = dot(&d, &d).sqrt();
    // l − L0 from displacement differences, to avoid cancellation.
    let two_dx_du: V3<T> = std::array::from_fn(|i| du[i].offset(2.0 * g.dx[i]));
    let elongation = dot(&du, &two_dx_du) / length.offset(g.l0);

    let inverse = T::cst(1.0) / length;
    let e1 = [d[0] * inverse, d[1] * inverse, d[2] * inverse];
    // The frame's second axis follows the mean of the two end triads.
    let p = [0, 1, 2].map(|i| (t1[i][1] + t2[i][1]).scale(0.5));
    let e3 = cross(&e1, &p);
    let inverse = T::cst(1.0) / dot(&e3, &e3).sqrt();
    let e3 = [e3[0] * inverse, e3[1] * inverse, e3[2] * inverse];
    let e2 = cross(&e3, &e1);
    let frame = from_cols(&e1, &e2, &e3);
    let th1 = small_rotation_vector(&tmat_mul(&frame, &t1));
    let th2 = small_rotation_vector(&tmat_mul(&frame, &t2));
    (frame, elongation, th1, th2)
}

fn bending<T: Scalar>(a: T, b: T, ei: f64, phi: f64, l0: f64) -> T {
    ((a * a + b * b).scale(0.5 * (4.0 + phi)) + (a * b).scale(2.0 - phi)).scale(ei / (l0 * (1.0 + phi)))
}

/// Strain energy of a beam element and its end connections, at the state
/// `s` with connection variables `q`.
pub fn seg_energy<T: Scalar>(g: &SegGeom, s: &SegState, q: &[f64; 12]) -> T {
    let (_, elongation, a, b) = local_deformation::<T>(g, s, q);
    let bow = |p: T, q: T| (p * p + q * q).scale(2.0) - p * q;
    let strain = elongation.scale(1.0 / g.l0) + (bow(a[1], b[1]) + bow(a[2], b[2])).scale(1.0 / 30.0);
    let twist = b[0] - a[0];
    let mut energy = (strain * strain).scale(0.5 * g.ea * g.l0)
        + (twist * twist).scale(0.5 * g.gj / g.l0)
        + bending(a[1], b[1], g.eiy, g.phi_y, g.l0)
        + bending(a[2], b[2], g.eiz, g.phi_z, g.l0);
    for i in 0..12 {
        if g.conn_var[i] && g.conn_k[i] != 0.0 {
            let v = T::variable(q[i], connection_variable(g, i));
            energy = energy + (v * v).scale(0.5 * g.conn_k[i]);
        }
    }
    energy
}

/// Current corotated frame of a beam element (columns are the local axes).
pub fn seg_frame(g: &SegGeom, s: &SegState, q: &[f64; 12]) -> M3<f64> {
    local_deformation::<f64>(g, s, q).0
}

/// Strain energy as a plain number.
pub fn seg_energy_value(g: &SegGeom, s: &SegState, q: &[f64; 12]) -> f64 {
    seg_energy::<f64>(g, s, q)
}

/// Gradient and Hessian of the element energy in its 24 variables: the
/// incremental translation and spin of the two nodes, then the twelve
/// connection variables.
pub struct SegDerivatives {
    pub energy: f64,
    pub g: [f64; 24],
    /// Packed lower triangle, entry `(i, j)`, `i >= j`, at `i (i + 1) / 2 + j`.
    pub h: [f64; 300],
}

impl SegDerivatives {
    pub fn hess(&self, i: usize, j: usize) -> f64 {
        let (a, b) = if i >= j { (i, j) } else { (j, i) };
        self.h[a * (a + 1) / 2 + b]
    }
}

/// Each of the 24 element variables as a differentiation variable and a
/// sign: the two node translations are minus and plus the relative one.
fn element_variable(g: &SegGeom, a: usize) -> (usize, f64) {
    match a {
        0..=2 => (VAR_DU + a, -1.0),
        3..=5 => (VAR_SPIN[0] + a - 3, 1.0),
        6..=8 => (VAR_DU + a - 6, 1.0),
        9..=11 => (VAR_SPIN[1] + a - 9, 1.0),
        _ if g.conn_var[a - 12] => (connection_variable(g, a - 12), 1.0),
        // A rigid law has no variable.
        _ => (usize::MAX, 0.0),
    }
}

fn differentiate<const N: usize, const H: usize>(g: &SegGeom, s: &SegState, q: &[f64; 12]) -> SegDerivatives {
    let e = seg_energy::<Dual2<N, H>>(g, s, q);
    let map: [(usize, f64); 24] = std::array::from_fn(|a| element_variable(g, a));
    let mut out = SegDerivatives { energy: e.v, g: [0.0; 24], h: [0.0; 300] };
    let mut k = 0;
    for a in 0..24 {
        let (ia, sa) = map[a];
        if ia < N {
            out.g[a] = sa * e.g[ia];
        }
        for b in 0..=a {
            let (ib, sb) = map[b];
            if ia < N && ib < N {
                out.h[k] = sa * sb * e.hess(ia, ib);
            }
            k += 1;
        }
    }
    out
}

/// Differentiate a beam element at the given state. Elements without
/// connection variables use the cheapest, nine-variable evaluation.
pub fn seg_derivatives(g: &SegGeom, s: &SegState, q: &[f64; 12]) -> SegDerivatives {
    // Pick the smallest evaluation that holds this element's variables.
    match g.conn_var.iter().filter(|v| **v).count() {
        0 => differentiate::<9, 45>(g, s, q),
        1..=4 => differentiate::<13, 91>(g, s, q),
        5..=8 => differentiate::<17, 153>(g, s, q),
        _ => differentiate::<21, 231>(g, s, q),
    }
}

/// Energy and gradient of a beam element, without the Hessian. This is an
/// order of magnitude cheaper than [`seg_derivatives`] and is what the
/// equilibrium iterations use between tangent updates.
pub fn seg_gradient(g: &SegGeom, s: &SegState, q: &[f64; 12]) -> (f64, [f64; 24]) {
    fn run<const N: usize>(g: &SegGeom, s: &SegState, q: &[f64; 12]) -> (f64, [f64; 24]) {
        let e = seg_energy::<Dual1<N>>(g, s, q);
        let gradient = std::array::from_fn(|a| {
            let (index, sign) = element_variable(g, a);
            if index < N { sign * e.g[index] } else { 0.0 }
        });
        (e.v, gradient)
    }
    match g.conn_var.iter().filter(|v| **v).count() {
        0 => run::<9>(g, s, q),
        1..=4 => run::<13>(g, s, q),
        5..=8 => run::<17>(g, s, q),
        _ => run::<21>(g, s, q),
    }
}

/// Derivatives at the undeformed state in closed form: no force, and the
/// classical linear stiffness of a 3D beam with shear deformation, extended
/// to the connection variables.
///
/// The seven local deformations (elongation and the two end rotation
/// vectors relative to the chord) are linear in the twelve local end
/// displacements at this state, `a = B x`, so the stiffness is `Bᵀ K₇ B`
/// with `K₇` read off the quadratic energy in [`seg_energy`]. A unit test
/// checks the result against the automatic Hessian.
pub fn seg_linear(g: &SegGeom) -> SegDerivatives {
    let l = g.l0;
    // Rows: elongation, a = (ax, ay, az), b = (bx, by, bz). Columns: local
    // u, v, w, θx, θy, θz of the first end, then of the second.
    let mut b = [[0.0; 12]; 7];
    b[0][0] = -1.0;
    b[0][6] = 1.0;
    b[1][3] = 1.0;
    b[4][9] = 1.0;
    for (row, rotation) in [(2, 4), (5, 10)] {
        // Rotation about y relative to the chord, whose slope is −(w2 − w1)/L.
        b[row][rotation] = 1.0;
        b[row][8] = 1.0 / l;
        b[row][2] = -1.0 / l;
    }
    for (row, rotation) in [(3, 5), (6, 11)] {
        // Rotation about z relative to the chord, whose slope is (v2 − v1)/L.
        b[row][rotation] = 1.0;
        b[row][7] = -1.0 / l;
        b[row][1] = 1.0 / l;
    }
    let mut k7 = [[0.0; 7]; 7];
    k7[0][0] = g.ea / l;
    k7[1][1] = g.gj / l;
    k7[4][4] = g.gj / l;
    k7[1][4] = -g.gj / l;
    k7[4][1] = -g.gj / l;
    for (i, j, ei, phi) in [(2, 5, g.eiy, g.phi_y), (3, 6, g.eiz, g.phi_z)] {
        let c = ei / (l * (1.0 + phi));
        k7[i][i] = c * (4.0 + phi);
        k7[j][j] = c * (4.0 + phi);
        k7[i][j] = c * (2.0 - phi);
        k7[j][i] = c * (2.0 - phi);
    }
    // Local end displacements from the 24 element variables: the node motion
    // turned into local axes, plus the connection variable where there is one.
    let mut d = [[0.0; 24]; 12];
    for block in 0..4 {
        for i in 0..3 {
            for j in 0..3 {
                d[3 * block + i][3 * block + j] = g.e0[j][i];
            }
        }
    }
    for m in 0..12 {
        if g.conn_var[m] {
            let block = m / 3 * 3;
            for i in 0..3 {
                d[block + i][12 + m] = g.connector_basis[m / 6][i][m % 3];
            }
        }
    }
    // B D, then (B D)ᵀ K₇ (B D).
    let mut bd = [[0.0; 24]; 7];
    for r in 0..7 {
        for m in 0..12 {
            if b[r][m] != 0.0 {
                for c in 0..24 {
                    bd[r][c] += b[r][m] * d[m][c];
                }
            }
        }
    }
    let mut kbd = [[0.0; 24]; 7];
    for r in 0..7 {
        for s in 0..7 {
            if k7[r][s] != 0.0 {
                for c in 0..24 {
                    kbd[r][c] += k7[r][s] * bd[s][c];
                }
            }
        }
    }
    let mut out = SegDerivatives { energy: 0.0, g: [0.0; 24], h: [0.0; 300] };
    let mut k = 0;
    for i in 0..24 {
        for j in 0..=i {
            out.h[k] = (0..7).map(|r| bd[r][i] * kbd[r][j]).sum();
            k += 1;
        }
        if i >= 12 && g.conn_var[i - 12] {
            out.h[k - 1] += g.conn_k[i - 12];
        }
    }
    out
}

/// Constant data of a brace or cable.
#[derive(Clone, Debug)]
pub struct BarGeom {
    /// Vector from the first to the second node, undeformed.
    pub dx: V3<f64>,
    pub l0: f64,
    /// Unstressed length.
    pub rest: f64,
    pub ea: f64,
    pub cable: bool,
}

/// Force state of a bar: energy, axial force (tension positive), the force on
/// the second node, and the 3x3 tangent block.
pub struct BarEval {
    pub energy: f64,
    pub axial: f64,
    pub force: V3<f64>,
    pub tangent: M3<f64>,
    pub active: bool,
}

const SLACK: BarEval = BarEval { energy: 0.0, axial: 0.0, force: [0.0; 3], tangent: [[0.0; 3]; 3], active: false };

fn bar_tangent(n: &V3<f64>, axial_stiffness: f64, geometric: f64) -> M3<f64> {
    [0, 1, 2].map(|i| {
        [0, 1, 2].map(|j| {
            let nn = n[i] * n[j];
            axial_stiffness * nn + geometric * (if i == j { 1.0 } else { 0.0 } - nn)
        })
    })
}

impl BarGeom {
    /// Exact (large-displacement) response to the relative displacement `du`
    /// of the second node with respect to the first.
    pub fn nonlinear(&self, du: &V3<f64>) -> BarEval {
        let d = add(&self.dx, du);
        let length = norm(&d);
        let two = [0, 1, 2].map(|i| 2.0 * self.dx[i] + du[i]);
        let elongation = dot(du, &two) / (length + self.l0) + (self.l0 - self.rest);
        let axial = self.ea / self.rest * elongation;
        if (self.cable && axial <= 0.0) || length <= 0.0 {
            return SLACK;
        }
        let n = d.map(|v| v / length);
        BarEval {
            energy: 0.5 * axial * elongation,
            axial,
            force: n.map(|v| v * axial),
            tangent: bar_tangent(&n, self.ea / self.rest, axial / length),
            active: true,
        }
    }

    /// Axial force at the undeformed geometry (the pretension).
    pub fn initial_force(&self) -> f64 {
        self.ea / self.rest * (self.l0 - self.rest)
    }

    /// Response linearised about the undeformed, prestressed state. `active`
    /// is the assumed state of a cable; an inactive cable contributes nothing.
    pub fn linear(&self, du: &V3<f64>, active: bool) -> BarEval {
        if !active {
            return SLACK;
        }
        let n = self.dx.map(|v| v / self.l0);
        let initial = self.initial_force();
        let tangent = bar_tangent(&n, self.ea / self.rest, initial / self.l0);
        let stiff = mat_vec(&tangent, du);
        BarEval {
            energy: 0.0,
            axial: initial + self.ea / self.rest * dot(&n, du),
            force: [0, 1, 2].map(|i| initial * n[i] + stiff[i]),
            tangent,
            active: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geom() -> SegGeom {
        SegGeom {
            dx: [2.0, 0.0, 0.0],
            l0: 2.0,
            e0: IDENTITY,
            connector_basis: [IDENTITY; 2],
            ea: 5.0e6,
            gj: 3.0e4,
            eiy: 7.0e4,
            eiz: 2.0e4,
            phi_y: 0.0,
            phi_z: 0.0,
            conn_var: [false; 12],
            conn_k: [0.0; 12],
        }
    }

    #[test]
    fn reference_hessian_is_the_linear_beam_stiffness() {
        let g = geom();
        let d = seg_derivatives(&g, &REFERENCE, &[0.0; 12]);
        let l = g.l0;
        let close = |a: f64, b: f64| (a - b).abs() <= 1e-9 * b.abs().max(1.0);
        assert!(d.g.iter().all(|v| v.abs() < 1e-9));
        assert!(close(d.hess(0, 0), g.ea / l));
        assert!(close(d.hess(0, 6), -g.ea / l));
        assert!(close(d.hess(3, 3), g.gj / l));
        // Deflection along z bends about y; deflection along y bends about z.
        assert!(close(d.hess(2, 2), 12.0 * g.eiy / l.powi(3)));
        assert!(close(d.hess(1, 1), 12.0 * g.eiz / l.powi(3)));
        assert!(close(d.hess(4, 4), 4.0 * g.eiy / l));
        assert!(close(d.hess(5, 5), 4.0 * g.eiz / l));
        assert!(close(d.hess(4, 10), 2.0 * g.eiy / l));
        assert!(close(d.hess(2, 4), -6.0 * g.eiy / (l * l)));
        assert!(close(d.hess(1, 5), 6.0 * g.eiz / (l * l)));
    }

    #[test]
    fn rigid_motion_costs_no_energy() {
        let g = geom();
        let r = exp_so3(&[0.4, -0.9, 1.3]);
        let moved = mat_vec(&r, &g.dx);
        let state = SegState { u: [[0.3, 0.1, -0.2], [0, 1, 2].map(|i| [0.3, 0.1, -0.2][i] + moved[i] - g.dx[i])], r: [r, r] };
        let d = seg_derivatives(&g, &state, &[0.0; 12]);
        assert!(d.energy.abs() < 1e-12);
        assert!(d.g.iter().all(|v| v.abs() < 1e-6));
    }


    /// Apply a chart increment (node translations and spins, then connection
    /// variables) to a state.
    fn advance(s: &SegState, q: &[f64; 12], step: &[f64; 24]) -> (SegState, [f64; 12]) {
        let mut next = *s;
        for k in 0..2 {
            for i in 0..3 {
                next.u[k][i] += step[6 * k + i];
            }
            next.r[k] = mat_mul(&exp_so3(&[step[6 * k + 3], step[6 * k + 4], step[6 * k + 5]]), &s.r[k]);
        }
        (next, std::array::from_fn(|i| q[i] + step[12 + i]))
    }

    /// The automatic gradient and Hessian must be the derivatives of the
    /// energy at a deformed state, with and without connection variables.
    #[test]
    fn derivatives_match_finite_differences_of_the_energy() {
        for released in [false, true] {
            let mut g = geom();
            g.dx = [1.2, -0.7, 1.4];
            g.l0 = norm(&g.dx);
            let x = g.dx.map(|v| v / g.l0);
            let z = cross(&x, &[0.0, 1.0, 0.0]);
            let z = z.map(|v| v / norm(&z));
            g.e0 = from_cols(&x, &cross(&z, &x), &z);
            g.phi_y = 0.3;
            let mut q = [0.0; 12];
            if released {
                for i in [1, 4, 5, 6, 9, 11] {
                    g.conn_var[i] = true;
                    g.conn_k[i] = if i % 2 == 0 { 0.0 } else { 4.0e4 };
                    q[i] = 0.01 * (i as f64 - 5.0);
                }
            }
            let s = SegState {
                u: [[0.01, -0.02, 0.015], [0.03, 0.01, -0.02]],
                r: [exp_so3(&[0.05, -0.08, 0.11]), exp_so3(&[-0.04, 0.09, 0.07])],
            };
            let d = seg_derivatives(&g, &s, &q);
            let energy = |step: &[f64; 24]| {
                let (state, values) = advance(&s, &q, step);
                seg_energy_value(&g, &state, &values)
            };
            let active: Vec<usize> = (0..24).filter(|i| *i < 12 || g.conn_var[*i - 12]).collect();
            let scale = d.h.iter().fold(0.0_f64, |m, v| m.max(v.abs()));
            let h = 1e-4;
            for &a in &active {
                let mut step = [0.0; 24];
                step[a] = h;
                let plus = energy(&step);
                step[a] = -h;
                let gradient = (plus - energy(&step)) / (2.0 * h);
                assert!((gradient - d.g[a]).abs() <= 1e-6 * d.g.iter().fold(1.0_f64, |m, v| m.max(v.abs())), "gradient {a}: {gradient} vs {}", d.g[a]);
                for &b in &active {
                    let at = |sa: f64, sb: f64| {
                        let mut step = [0.0; 24];
                        step[a] += sa * h;
                        step[b] += sb * h;
                        energy(&step)
                    };
                    let second = (at(1.0, 1.0) - at(1.0, -1.0) - at(-1.0, 1.0) + at(-1.0, -1.0)) / (4.0 * h * h);
                    assert!((second - d.hess(a, b)).abs() <= 2e-5 * scale, "hessian {a},{b}: {second} vs {}", d.hess(a, b));
                }
            }
        }
    }

    /// The closed-form linear stiffness is the automatic Hessian at the
    /// undeformed state, for any orientation, shear flexibility and mix of
    /// connection laws.
    #[test]
    fn closed_form_linear_stiffness_matches_the_automatic_hessian() {
        for case in 0..4 {
            let mut g = geom();
            g.dx = [[2.0, 0.0, 0.0], [0.0, 0.0, 3.0], [1.2, -0.7, 1.4], [-0.3, 2.0, 0.9]][case];
            g.l0 = norm(&g.dx);
            let x = g.dx.map(|v| v / g.l0);
            let z = cross(&x, &[0.3, 1.0, -0.2]);
            let z = z.map(|v| v / norm(&z));
            g.e0 = from_cols(&x, &cross(&z, &x), &z);
            g.phi_y = 0.1 * case as f64;
            g.phi_z = 0.4;
            for i in 0..12 {
                if (i + case) % 3 == 0 {
                    g.conn_var[i] = true;
                    g.conn_k[i] = if i % 2 == 0 { 0.0 } else { 3.0e5 * (i as f64 + 1.0) };
                }
            }
            if case == 0 {
                g.conn_var = [false; 12];
                g.conn_k = [0.0; 12];
            }
            let automatic = seg_derivatives(&g, &REFERENCE, &[0.0; 12]);
            let closed = seg_linear(&g);
            let scale = automatic.h.iter().fold(0.0_f64, |m, v| m.max(v.abs()));
            for i in 0..24 {
                for j in 0..=i {
                    let (a, c) = (automatic.hess(i, j), closed.hess(i, j));
                    assert!((a - c).abs() <= 1e-10 * scale, "case {case}, entry {i},{j}: {a} vs {c}");
                }
            }
            // The gradient-only evaluation agrees with the full one.
            let s = SegState { u: [[0.01, -0.02, 0.015], [0.03, 0.01, -0.02]], r: [exp_so3(&[0.05, -0.08, 0.11]), exp_so3(&[-0.04, 0.09, 0.07])] };
            let q: [f64; 12] = std::array::from_fn(|i| if g.conn_var[i] { 0.002 * (i as f64 - 4.0) } else { 0.0 });
            let (full, (energy, gradient)) = (seg_derivatives(&g, &s, &q), seg_gradient(&g, &s, &q));
            assert!((full.energy - energy).abs() <= 1e-12 * energy.abs());
            for i in 0..24 {
                assert!((full.g[i] - gradient[i]).abs() <= 1e-10 * scale, "gradient {i}");
            }
        }
    }
    #[test]
    fn cable_carries_no_compression() {
        let bar = BarGeom { dx: [1.0, 0.0, 0.0], l0: 1.0, rest: 1.0, ea: 1.0e6, cable: true };
        assert!(!bar.nonlinear(&[-0.01, 0.0, 0.0]).active);
        let taut = bar.nonlinear(&[0.01, 0.0, 0.0]);
        assert!(taut.active && (taut.axial - 1.0e4).abs() < 1e-6);
    }
}
