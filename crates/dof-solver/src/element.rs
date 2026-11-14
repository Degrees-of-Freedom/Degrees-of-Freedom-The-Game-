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

use crate::ad::{Dual2, Scalar};
use crate::math::*;

/// Constant data of one beam element.
#[derive(Clone, Debug)]
pub struct SegGeom {
    /// Vector from the first to the second node, undeformed.
    pub dx: V3<f64>,
    pub l0: f64,
    /// Undeformed local axes as matrix columns.
    pub e0: M3<f64>,
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

/// Displacement and orientation of one member end, after its connection.
#[inline(never)]
fn end_kinematics<T: Scalar>(g: &SegGeom, s: &SegState, x: &[T; 24], k: usize) -> (V3<T>, M3<T>) {
    let b = 6 * k;
    let spin = [x[b + 3], x[b + 4], x[b + 5]];
    // Connection axes: the undeformed local axes, turned with the node.
    let mut triad = mat_mul(&mat_mul(&exp_so3(&spin), &lift(&s.r[k])), &lift(&g.e0));
    let mut disp = [0, 1, 2].map(|i| x[b + i] + T::cst(s.u[k][i]));
    let q = 12 + b;
    if g.conn_var[b] || g.conn_var[b + 1] || g.conn_var[b + 2] {
        disp = add(&disp, &mat_vec(&triad, &[x[q], x[q + 1], x[q + 2]]));
    }
    if g.conn_var[b + 3] || g.conn_var[b + 4] || g.conn_var[b + 5] {
        triad = mat_mul(&triad, &exp_so3(&[x[q + 3], x[q + 4], x[q + 5]]));
    }
    (disp, triad)
}

/// Corotated frame and local deformations: frame (columns), axial
/// elongation, and the local rotation vectors of the two ends.
#[inline(never)]
fn local_deformation<T: Scalar>(g: &SegGeom, s: &SegState, x: &[T; 24]) -> (M3<T>, T, V3<T>, V3<T>) {
    let (u1, t1) = end_kinematics(g, s, x, 0);
    let (u2, t2) = end_kinematics(g, s, x, 1);
    let du = sub(&u2, &u1);
    let dx: V3<T> = g.dx.map(T::cst);
    let d = add(&dx, &du);
    let length = dot(&d, &d).sqrt();
    // l − L0 from displacement differences, to avoid cancellation.
    let two_dx_du = [0, 1, 2].map(|i| dx[i].scale(2.0) + du[i]);
    let elongation = dot(&du, &two_dx_du) / (length + T::cst(g.l0));

    let e1 = [d[0] / length, d[1] / length, d[2] / length];
    // The frame's second axis follows the mean of the two end triads.
    let p = [0, 1, 2].map(|i| (t1[i][1] + t2[i][1]).scale(0.5));
    let e3 = cross(&e1, &p);
    let n3 = dot(&e3, &e3).sqrt();
    let e3 = [e3[0] / n3, e3[1] / n3, e3[2] / n3];
    let e2 = cross(&e3, &e1);
    let frame = from_cols(&e1, &e2, &e3);
    let th1 = small_rotation_vector(&tmat_mul(&frame, &t1));
    let th2 = small_rotation_vector(&tmat_mul(&frame, &t2));
    (frame, elongation, th1, th2)
}

fn bending<T: Scalar>(a: T, b: T, ei: f64, phi: f64, l0: f64) -> T {
    ((a * a + b * b).scale(0.5 * (4.0 + phi)) + (a * b).scale(2.0 - phi)).scale(ei / (l0 * (1.0 + phi)))
}

/// Strain energy of a beam element and its end connections.
pub fn seg_energy<T: Scalar>(g: &SegGeom, s: &SegState, x: &[T; 24]) -> T {
    let (_, elongation, a, b) = local_deformation(g, s, x);
    let bow = |p: T, q: T| (p * p + q * q).scale(2.0) - p * q;
    let strain = elongation.scale(1.0 / g.l0) + (bow(a[1], b[1]) + bow(a[2], b[2])).scale(1.0 / 30.0);
    let twist = b[0] - a[0];
    let mut energy = (strain * strain).scale(0.5 * g.ea * g.l0)
        + (twist * twist).scale(0.5 * g.gj / g.l0)
        + bending(a[1], b[1], g.eiy, g.phi_y, g.l0)
        + bending(a[2], b[2], g.eiz, g.phi_z, g.l0);
    for i in 0..12 {
        if g.conn_var[i] && g.conn_k[i] != 0.0 {
            energy = energy + (x[12 + i] * x[12 + i]).scale(0.5 * g.conn_k[i]);
        }
    }
    energy
}

/// Current corotated frame of a beam element (columns are the local axes).
pub fn seg_frame(g: &SegGeom, s: &SegState, q: &[f64; 12]) -> M3<f64> {
    let mut x = [0.0; 24];
    x[12..].copy_from_slice(q);
    local_deformation(g, s, &x).0
}

/// Energy with plain numbers: `step` is added to the node motions.
pub fn seg_energy_value(g: &SegGeom, s: &SegState, q: &[f64; 12]) -> f64 {
    let mut x = [0.0; 24];
    x[12..].copy_from_slice(q);
    seg_energy(g, s, &x)
}

/// Gradient and Hessian of the element energy in its 24 variables.
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

fn differentiate<const N: usize, const H: usize>(g: &SegGeom, s: &SegState, q: &[f64; 12]) -> SegDerivatives {
    let mut x = [Dual2::<N, H>::cst(0.0); 24];
    for (i, v) in x.iter_mut().enumerate().take(12) {
        *v = Dual2::var(0.0, i);
    }
    for i in 0..12 {
        x[12 + i] = if N > 12 && g.conn_var[i] { Dual2::var(q[i], 12 + i) } else { Dual2::cst(q[i]) };
    }
    let e = seg_energy(g, s, &x);
    let mut out = SegDerivatives { energy: e.v, g: [0.0; 24], h: [0.0; 300] };
    out.g[..N].copy_from_slice(&e.g);
    out.h[..H].copy_from_slice(&e.h);
    out
}

/// Differentiate a beam element at the given state. Elements without
/// connection variables use the cheaper 12-variable evaluation.
pub fn seg_derivatives(g: &SegGeom, s: &SegState, q: &[f64; 12]) -> SegDerivatives {
    if g.conn_var.iter().any(|v| *v) {
        differentiate::<24, 300>(g, s, q)
    } else {
        differentiate::<12, 78>(g, s, q)
    }
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

    #[test]
    fn cable_carries_no_compression() {
        let bar = BarGeom { dx: [1.0, 0.0, 0.0], l0: 1.0, rest: 1.0, ea: 1.0e6, cable: true };
        assert!(!bar.nonlinear(&[-0.01, 0.0, 0.0]).active);
        let taut = bar.nonlinear(&[0.01, 0.0, 0.0]);
        assert!(taut.active && (taut.axial - 1.0e4).abs() < 1e-6);
    }
}
