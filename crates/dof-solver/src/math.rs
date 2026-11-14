//! Small fixed-size vector and rotation helpers, generic over [`Scalar`].

use crate::ad::Scalar;

pub type V3<T> = [T; 3];
/// Row-major 3x3 matrix: `m[row][col]`.
pub type M3<T> = [[T; 3]; 3];

pub const IDENTITY: M3<f64> = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];

pub fn lift<T: Scalar>(m: &M3<f64>) -> M3<T> {
    m.map(|r| r.map(T::cst))
}
pub fn dot<T: Scalar>(a: &V3<T>, b: &V3<T>) -> T {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
pub fn cross<T: Scalar>(a: &V3<T>, b: &V3<T>) -> V3<T> {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
pub fn add<T: Scalar>(a: &V3<T>, b: &V3<T>) -> V3<T> {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
pub fn sub<T: Scalar>(a: &V3<T>, b: &V3<T>) -> V3<T> {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
pub fn col<T: Scalar>(m: &M3<T>, j: usize) -> V3<T> {
    [m[0][j], m[1][j], m[2][j]]
}
pub fn from_cols<T: Scalar>(a: &V3<T>, b: &V3<T>, c: &V3<T>) -> M3<T> {
    [[a[0], b[0], c[0]], [a[1], b[1], c[1]], [a[2], b[2], c[2]]]
}
pub fn mat_vec<T: Scalar>(m: &M3<T>, v: &V3<T>) -> V3<T> {
    [dot(&m[0], v), dot(&m[1], v), dot(&m[2], v)]
}
pub fn mat_mul<T: Scalar>(a: &M3<T>, b: &M3<T>) -> M3<T> {
    let c = [col(b, 0), col(b, 1), col(b, 2)];
    [0, 1, 2].map(|i| [0, 1, 2].map(|j| dot(&a[i], &c[j])))
}
/// Transpose of `a` times `b`.
pub fn tmat_mul<T: Scalar>(a: &M3<T>, b: &M3<T>) -> M3<T> {
    let (ca, cb) = ([col(a, 0), col(a, 1), col(a, 2)], [col(b, 0), col(b, 1), col(b, 2)]);
    [0, 1, 2].map(|i| [0, 1, 2].map(|j| dot(&ca[i], &cb[j])))
}
/// Transpose of `m` times `v`, for plain numbers.
pub fn tmat_vec(m: &M3<f64>, v: &V3<f64>) -> V3<f64> {
    [0, 1, 2].map(|j| m[0][j] * v[0] + m[1][j] * v[1] + m[2][j] * v[2])
}
pub fn norm(v: &V3<f64>) -> f64 {
    dot(v, v).sqrt()
}

/// Rotation matrix of a rotation vector (the Rodrigues formula). Written in
/// terms of the squared angle so that it stays differentiable at zero.
pub fn exp_so3<T: Scalar>(th: &V3<T>) -> M3<T> {
    let t = dot(th, th);
    let (a, b) = if t.val() < 1e-8 {
        (
            T::cst(1.0) - t.scale(1.0 / 6.0) + (t * t).scale(1.0 / 120.0),
            T::cst(0.5) - t.scale(1.0 / 24.0) + (t * t).scale(1.0 / 720.0),
        )
    } else {
        let s = t.sqrt();
        (s.sin() / s, (T::cst(1.0) - s.cos()) / t)
    };
    let z = T::cst(0.0);
    let hat = [[z, -th[2], th[1]], [th[2], z, -th[0]], [-th[1], th[0], z]];
    let mut r = [[z; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            // hat squared = th thᵀ − (th·th) I
            let sq = if i == j { th[i] * th[j] - t } else { th[i] * th[j] };
            let id = if i == j { 1.0 } else { 0.0 };
            r[i][j] = T::cst(id) + a * hat[i][j] + b * sq;
        }
    }
    r
}

/// Rotation vector of a rotation matrix whose angle is well below 90°, as it
/// is for the local (deformational) rotations of a corotational element. A
/// fixed series of `asin(s)/s` in `s²` keeps it smooth at zero.
pub fn small_rotation_vector<T: Scalar>(r: &M3<T>) -> V3<T> {
    let v = [
        (r[2][1] - r[1][2]).scale(0.5),
        (r[0][2] - r[2][0]).scale(0.5),
        (r[1][0] - r[0][1]).scale(0.5),
    ];
    let s2 = dot(&v, &v);
    let mut f = T::cst(1.0);
    let mut p = s2;
    for c in [1.0 / 6.0, 3.0 / 40.0, 15.0 / 336.0, 105.0 / 3456.0, 945.0 / 42240.0] {
        f = f + p.scale(c);
        p = p * s2;
    }
    [v[0] * f, v[1] * f, v[2] * f]
}

/// Rotation vector of any rotation matrix (angle between 0 and 180°).
pub fn log_so3(r: &M3<f64>) -> V3<f64> {
    let axial = [r[2][1] - r[1][2], r[0][2] - r[2][0], r[1][0] - r[0][1]];
    let cos = ((r[0][0] + r[1][1] + r[2][2] - 1.0) * 0.5).clamp(-1.0, 1.0);
    let angle = cos.acos();
    if angle < 1e-7 {
        return axial.map(|a| 0.5 * a);
    }
    if angle < std::f64::consts::PI - 1e-5 {
        let k = angle / (2.0 * angle.sin());
        return axial.map(|a| k * a);
    }
    // Near 180°: take the axis from the largest diagonal term of (R + I) / 2.
    let d = [0, 1, 2].map(|i| ((r[i][i] + 1.0) * 0.5).max(0.0));
    let k = if d[0] >= d[1] && d[0] >= d[2] { 0 } else if d[1] >= d[2] { 1 } else { 2 };
    let root = d[k].sqrt().max(1e-12);
    let mut axis = [0, 1, 2].map(|i| (r[i][k] + r[k][i]) * 0.25 / root);
    axis[k] = root;
    if dot(&axis, &axial) < 0.0 {
        axis = axis.map(|a| -a);
    }
    axis.map(|a| a * angle)
}
