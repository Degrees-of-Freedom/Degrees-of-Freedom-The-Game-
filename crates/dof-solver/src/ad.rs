//! Forward-mode automatic differentiation to second order.
//!
//! Element strain energy is written once, generically over [`Scalar`]. With
//! `f64` it returns the energy; with [`Dual2`] it also returns the exact
//! gradient (internal force) and Hessian (consistent tangent stiffness). This
//! keeps the force and the tangent consistent with each other by construction.

use std::ops::{Add, Div, Mul, Neg, Sub};

/// Number type the element kinematics are generic over.
pub trait Scalar:
    Copy + Add<Output = Self> + Sub<Output = Self> + Mul<Output = Self> + Div<Output = Self> + Neg<Output = Self>
{
    fn cst(v: f64) -> Self;
    fn val(&self) -> f64;
    fn sqrt(self) -> Self;
    fn sin(self) -> Self;
    fn cos(self) -> Self;
    /// Multiply by a plain constant.
    fn scale(self, k: f64) -> Self;
}

impl Scalar for f64 {
    fn cst(v: f64) -> Self {
        v
    }
    fn val(&self) -> f64 {
        *self
    }
    fn sqrt(self) -> Self {
        f64::sqrt(self)
    }
    fn sin(self) -> Self {
        f64::sin(self)
    }
    fn cos(self) -> Self {
        f64::cos(self)
    }
    fn scale(self, k: f64) -> Self {
        self * k
    }
}

/// Value, gradient and packed lower-triangular Hessian in `N` variables.
/// `H` must equal `N * (N + 1) / 2`; entry `(i, j)` with `i >= j` is stored at
/// `i * (i + 1) / 2 + j`.
#[derive(Clone, Copy)]
pub struct Dual2<const N: usize, const H: usize> {
    pub v: f64,
    pub g: [f64; N],
    pub h: [f64; H],
}

impl<const N: usize, const H: usize> Dual2<N, H> {
    /// Independent variable number `i` with value `v`.
    pub fn var(v: f64, i: usize) -> Self {
        let mut d = Self::cst(v);
        d.g[i] = 1.0;
        d
    }

    /// Hessian entry `(i, j)` in either order.
    pub fn hess(&self, i: usize, j: usize) -> f64 {
        let (a, b) = if i >= j { (i, j) } else { (j, i) };
        self.h[a * (a + 1) / 2 + b]
    }

    /// Apply a scalar function with value `f` and derivatives `f1`, `f2`.
    #[inline]
    fn chain(&self, f: f64, f1: f64, f2: f64) -> Self {
        let mut r = Self { v: f, g: [0.0; N], h: [0.0; H] };
        let mut k = 0;
        for i in 0..N {
            r.g[i] = f1 * self.g[i];
            let gi = f2 * self.g[i];
            for j in 0..=i {
                r.h[k] = f1 * self.h[k] + gi * self.g[j];
                k += 1;
            }
        }
        r
    }
}

impl<const N: usize, const H: usize> Add for Dual2<N, H> {
    type Output = Self;
    #[inline]
    fn add(mut self, o: Self) -> Self {
        self.v += o.v;
        for i in 0..N {
            self.g[i] += o.g[i];
        }
        for k in 0..H {
            self.h[k] += o.h[k];
        }
        self
    }
}

impl<const N: usize, const H: usize> Sub for Dual2<N, H> {
    type Output = Self;
    #[inline]
    fn sub(mut self, o: Self) -> Self {
        self.v -= o.v;
        for i in 0..N {
            self.g[i] -= o.g[i];
        }
        for k in 0..H {
            self.h[k] -= o.h[k];
        }
        self
    }
}

impl<const N: usize, const H: usize> Neg for Dual2<N, H> {
    type Output = Self;
    #[inline]
    fn neg(self) -> Self {
        self.scale(-1.0)
    }
}

impl<const N: usize, const H: usize> Mul for Dual2<N, H> {
    type Output = Self;
    #[inline]
    fn mul(self, o: Self) -> Self {
        let mut r = Self { v: self.v * o.v, g: [0.0; N], h: [0.0; H] };
        let mut k = 0;
        for i in 0..N {
            r.g[i] = self.v * o.g[i] + o.v * self.g[i];
            for j in 0..=i {
                r.h[k] = self.v * o.h[k] + o.v * self.h[k] + self.g[i] * o.g[j] + self.g[j] * o.g[i];
                k += 1;
            }
        }
        r
    }
}

impl<const N: usize, const H: usize> Div for Dual2<N, H> {
    type Output = Self;
    #[inline]
    fn div(self, o: Self) -> Self {
        let inv = 1.0 / o.v;
        self * o.chain(inv, -inv * inv, 2.0 * inv * inv * inv)
    }
}

impl<const N: usize, const H: usize> Scalar for Dual2<N, H> {
    fn cst(v: f64) -> Self {
        Self { v, g: [0.0; N], h: [0.0; H] }
    }
    fn val(&self) -> f64 {
        self.v
    }
    fn sqrt(self) -> Self {
        let s = self.v.sqrt();
        self.chain(s, 0.5 / s, -0.25 / (s * self.v))
    }
    fn sin(self) -> Self {
        let (s, c) = self.v.sin_cos();
        self.chain(s, c, -s)
    }
    fn cos(self) -> Self {
        let (s, c) = self.v.sin_cos();
        self.chain(c, -s, -c)
    }
    #[inline]
    fn scale(mut self, k: f64) -> Self {
        self.v *= k;
        for i in 0..N {
            self.g[i] *= k;
        }
        for j in 0..H {
            self.h[j] *= k;
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derivatives_match_finite_differences() {
        // f(x, y) = sin(x) * sqrt(y) / (x + y)
        let (x0, y0) = (0.7, 1.9);
        let x = Dual2::<2, 3>::var(x0, 0);
        let y = Dual2::<2, 3>::var(y0, 1);
        let f = x.sin() * y.sqrt() / (x + y);
        let eval = |x: f64, y: f64| x.sin() * y.sqrt() / (x + y);
        let h = 1e-4;
        let fx = (eval(x0 + h, y0) - eval(x0 - h, y0)) / (2.0 * h);
        let fy = (eval(x0, y0 + h) - eval(x0, y0 - h)) / (2.0 * h);
        let fxx = (eval(x0 + h, y0) - 2.0 * eval(x0, y0) + eval(x0 - h, y0)) / (h * h);
        let fxy = (eval(x0 + h, y0 + h) - eval(x0 + h, y0 - h) - eval(x0 - h, y0 + h) + eval(x0 - h, y0 - h))
            / (4.0 * h * h);
        assert!((f.v - eval(x0, y0)).abs() < 1e-14);
        assert!((f.g[0] - fx).abs() < 1e-7 && (f.g[1] - fy).abs() < 1e-7);
        assert!((f.hess(0, 0) - fxx).abs() < 1e-6 && (f.hess(0, 1) - fxy).abs() < 1e-6);
    }
}
