//! Discrete system of one structural component: nodes, elements, equation
//! numbering, loads, and the evaluation of internal forces and stiffness.
//!
//! Unknowns are the active free DOFs of the analysis nodes plus one scalar per
//! non-rigid connection law (the relative motion across that connection).
//! Restrained DOFs are eliminated exactly. Rotations of a node that no member
//! end is rotationally attached to carry no stiffness and no meaning; they
//! are left out of the system ("unused DOFs") instead of being propped up.

use crate::element::*;
use crate::math::*;
use crate::model::*;
use crate::skyline::{reverse_cuthill_mckee, Skyline};
use std::collections::BTreeMap;

/// Equation marker of a DOF held by a foundation.
pub const RESTRAINED: i32 = -1;
/// Equation marker of a rotation no member uses.
pub const INACTIVE: i32 = -2;

/// Lookup tables over a model whose nodes and members are sorted by id.
pub struct Index<'a> {
    pub model: &'a Model,
    pub node: BTreeMap<&'a str, usize>,
    pub section: BTreeMap<&'a str, usize>,
    /// Foundation index per node.
    pub foundation: Vec<Option<usize>>,
}

impl<'a> Index<'a> {
    pub fn new(model: &'a Model) -> Self {
        let node: BTreeMap<&str, usize> = model.nodes.iter().enumerate().map(|(i, n)| (n.id.as_str(), i)).collect();
        let section = model.sections.iter().enumerate().map(|(i, s)| (s.id.as_str(), i)).collect();
        let mut foundation = vec![None; model.nodes.len()];
        for (i, f) in model.foundations.iter().enumerate() {
            foundation[node[f.node_id.as_str()]] = Some(i);
        }
        Self { model, node, section, foundation }
    }
    pub fn ends(&self, member: &Member) -> [usize; 2] {
        [self.node[member.start_node_id.as_str()], self.node[member.end_node_id.as_str()]]
    }
}

/// Whether a member end transmits anything to its node.
pub fn end_attached(member: &Member, end: usize) -> bool {
    let connection = if end == 0 { &member.start } else { &member.end };
    member.kind != MemberKind::Beam || connection.laws.iter().any(|l| *l != Law::Free)
}

/// Undeformed local axes of a member as matrix columns.
pub fn local_axes(dx: &V3<f64>, orientation: Option<V3<f64>>) -> M3<f64> {
    let length = norm(dx);
    let x = dx.map(|v| v / length);
    let reference = orientation.unwrap_or(if x[2].abs() > 0.999 { [1.0, 0.0, 0.0] } else { [0.0, 0.0, 1.0] });
    let along = dot(&reference, &x);
    let z = [0, 1, 2].map(|i| reference[i] - along * x[i]);
    let zn = norm(&z);
    let z = z.map(|v| v / zn);
    let y = cross(&z, &x);
    from_cols(&x, &y, &z)
}

pub struct ANode {
    pub pos: V3<f64>,
    pub eq: [i32; 6],
    /// Model node this analysis node represents; `None` for the interior
    /// nodes of a subdivided beam and for a fully released member end.
    pub node: Option<usize>,
    /// Whether a member end holds this node's rotations.
    pub rotational: bool,
}

pub struct Seg {
    pub n: [usize; 2],
    pub geom: SegGeom,
    /// Equation of each connection variable, or negative when rigid.
    pub q_eq: [i32; 12],
    /// Consistent nodal loads of the self-weight on this element, global.
    pub self_weight: [f64; 12],
    /// Derivatives at the undeformed state: the linear stiffness matrix.
    pub linear: SegDerivatives,
}

pub struct Bar {
    pub n: [usize; 2],
    pub geom: BarGeom,
}

/// Elements that make up one model member.
pub enum Span {
    Segs(std::ops::Range<usize>),
    Bar(usize),
}

pub struct System {
    pub anodes: Vec<ANode>,
    pub segs: Vec<Seg>,
    pub bars: Vec<Bar>,
    /// Model member index and its elements, in member order.
    pub members: Vec<(usize, Span)>,
    pub neq: usize,
    /// Whether each equation is rotational (moment-valued residual).
    pub eq_rot: Vec<bool>,
    /// External load on every analysis node at load factor one.
    pub fext: Vec<[f64; 6]>,
    /// External load on every connection variable at load factor one: the
    /// part of a member's own weight that acts across a released connection.
    pub fext_q: Vec<f64>,
    /// Characteristic length that converts moments to forces in norms.
    pub lc: f64,
    /// Bounding-box diagonal of the component.
    pub size: f64,
    groups: Vec<Vec<usize>>,
    /// Rotations left out of the system because nothing uses them.
    pub unused_dofs: usize,
    /// Independent internal force unknowns, for the determinacy count.
    pub force_unknowns: usize,
    /// Model nodes with a moment applied to an unused rotation.
    pub moment_on_unused: Vec<usize>,
}

/// Deformed configuration for the nonlinear analysis.
#[derive(Clone)]
pub struct State {
    pub u: Vec<V3<f64>>,
    pub r: Vec<M3<f64>>,
    /// Connection variables, indexed by equation.
    pub q: Vec<f64>,
}

/// What to evaluate the system at.
pub enum Config<'a> {
    /// Small displacements `x` (by equation) about the undeformed state, with
    /// an assumed active flag per bar.
    Linear { x: &'a [f64], active: &'a [bool] },
    Nonlinear(&'a State),
}

/// Internal forces of the system at one configuration.
pub struct Eval {
    pub energy: f64,
    /// Internal force on every analysis node, global, all six DOFs.
    pub g: Vec<[f64; 6]>,
    /// Internal force on every equation.
    pub g_eq: Vec<f64>,
    /// Nodal forces of each beam element (two nodes, global).
    pub seg_g: Vec<[f64; 12]>,
    /// Axial force and active flag of each bar.
    pub bars: Vec<(f64, bool)>,
    /// Largest element force, as a scale for residuals.
    pub force_scale: f64,
}

impl System {
    pub fn build(index: &Index, nodes: &[usize], members: &[usize], options: &Options) -> System {
        let model = index.model;
        let mut anodes: Vec<ANode> = Vec::new();
        let mut local: BTreeMap<usize, usize> = BTreeMap::new();
        for &n in nodes {
            local.insert(n, anodes.len());
            anodes.push(ANode { pos: model.nodes[n].position, eq: [0; 6], node: Some(n), rotational: true });
        }

        // A node's rotations are in the system only if a beam end holds them.
        let mut rotation_used = vec![false; anodes.len()];
        for &m in members {
            let member = &model.members[m];
            if member.kind != MemberKind::Beam {
                continue;
            }
            for (end, node) in index.ends(member).into_iter().enumerate() {
                let laws = if end == 0 { &member.start.laws } else { &member.end.laws };
                if end_attached(member, end) && laws[3..].iter().any(|l| *l != Law::Free) {
                    rotation_used[local[&node]] = true;
                }
            }
        }

        let mut segs: Vec<Seg> = Vec::new();
        let mut bars: Vec<Bar> = Vec::new();
        let mut spans = Vec::new();
        let mut fext: Vec<[f64; 6]> = vec![[0.0; 6]; anodes.len()];
        let mut force_unknowns = 0;
        let mut total_length = 0.0;
        for &m in members {
            let member = &model.members[m];
            let section = &model.sections[index.section[member.section_id.as_str()]];
            let ends = index.ends(member);
            let (xa, xb) = (model.nodes[ends[0]].position, model.nodes[ends[1]].position);
            let dx = sub(&xb, &xa);
            let length = norm(&dx);
            total_length += length;
            let weight = options.gravity.map_or([0.0; 3], |g| g.map(|v| v * section.density * section.a));

            if member.kind != MemberKind::Beam {
                let rest = match (member.rest_length, member.initial_strain) {
                    (Some(rest), _) => rest,
                    (None, Some(strain)) => length / (1.0 + strain),
                    (None, None) => length,
                };
                let n = [local[&ends[0]], local[&ends[1]]];
                for node in n {
                    for i in 0..3 {
                        fext[node][i] += 0.5 * length * weight[i];
                    }
                }
                spans.push((m, Span::Bar(bars.len())));
                bars.push(Bar { n, geom: BarGeom { dx, l0: length, rest, ea: section.e * section.a, cable: member.kind == MemberKind::Cable } });
                force_unknowns += 1;
                continue;
            }

            let count = member.subdivisions.unwrap_or(options.subdivisions).max(1) as usize;
            let e0 = local_axes(&dx, member.orientation);
            let seg_length = length / count as f64;
            let first_seg = segs.len();
            // Analysis nodes along the member. A fully released end gets a
            // private node, so nothing ties it to the model node.
            let mut chain = Vec::with_capacity(count + 1);
            for k in 0..=count {
                let at_end = if k == 0 { Some(0) } else if k == count { Some(1) } else { None };
                match at_end {
                    Some(end) if end_attached(member, end) => chain.push(local[&ends[end]]),
                    _ => {
                        let t = k as f64 / count as f64;
                        chain.push(anodes.len());
                        anodes.push(ANode { pos: [0, 1, 2].map(|i| xa[i] + t * dx[i]), eq: [0; 6], node: None, rotational: true });
                        fext.push([0.0; 6]);
                    }
                }
            }
            let phi = |ei: f64, shear_area: Option<f64>| match shear_area {
                Some(area) if area > 0.0 => 12.0 * ei / (section.g * area * seg_length * seg_length),
                _ => 0.0,
            };
            for k in 0..count {
                let mut geom = SegGeom {
                    dx: dx.map(|v| v / count as f64),
                    l0: seg_length,
                    e0,
                    ea: section.e * section.a,
                    gj: section.g * section.j,
                    eiy: section.e * section.iy,
                    eiz: section.e * section.iz,
                    // Bending about y deflects along z, and the reverse.
                    phi_y: phi(section.e * section.iy, section.shear_area_z),
                    phi_z: phi(section.e * section.iz, section.shear_area_y),
                    conn_var: [false; 12],
                    conn_k: [0.0; 12],
                };
                for (end, at) in [(0usize, 0usize), (1, count - 1)] {
                    if k != at || !end_attached(member, end) {
                        continue;
                    }
                    let laws = if end == 0 { &member.start.laws } else { &member.end.laws };
                    for (i, law) in laws.iter().enumerate() {
                        match law {
                            Law::Rigid => {}
                            Law::Free => geom.conn_var[6 * end + i] = true,
                            Law::Elastic(stiffness) => {
                                geom.conn_var[6 * end + i] = true;
                                geom.conn_k[6 * end + i] = *stiffness;
                                force_unknowns += 1;
                            }
                        }
                    }
                }
                // Consistent nodal loads of a uniform load: half the weight
                // and the fixed-end moments ±(L²/12) x × w at the two ends.
                let x_axis = col(&e0, 0);
                let couple = cross(&x_axis, &weight).map(|v| v * seg_length * seg_length / 12.0);
                let mut self_weight = [0.0; 12];
                for i in 0..3 {
                    self_weight[i] = 0.5 * seg_length * weight[i];
                    self_weight[6 + i] = 0.5 * seg_length * weight[i];
                    self_weight[3 + i] = couple[i];
                    self_weight[9 + i] = -couple[i];
                }
                let n = [chain[k], chain[k + 1]];
                for (e, node) in n.into_iter().enumerate() {
                    for i in 0..6 {
                        fext[node][i] += self_weight[6 * e + i];
                    }
                }
                let linear = seg_derivatives(&geom, &REFERENCE, &[0.0; 12]);
                segs.push(Seg { n, geom, q_eq: [-1; 12], self_weight, linear });
                force_unknowns += 6;
            }
            spans.push((m, Span::Segs(first_seg..segs.len())));
        }
        rotation_used.resize(anodes.len(), true);

        let mut moment_on_unused = Vec::new();
        for load in &model.loads {
            let n = index.node[load.node_id.as_str()];
            let Some(&a) = local.get(&n) else { continue };
            for i in 0..3 {
                fext[a][i] += load.force[i];
                fext[a][3 + i] += load.moment[i];
            }
            if !rotation_used[a] && load.moment.iter().any(|v| *v != 0.0) && !moment_on_unused.contains(&n) {
                moment_on_unused.push(n);
            }
        }

        // Equation numbering in reverse Cuthill–McKee node order, with each
        // connection variable numbered next to the node it belongs to.
        let mut adjacency: Vec<Vec<usize>> = vec![Vec::new(); anodes.len()];
        let mut ends_at: Vec<Vec<(usize, usize)>> = vec![Vec::new(); anodes.len()];
        for (s, seg) in segs.iter().enumerate() {
            adjacency[seg.n[0]].push(seg.n[1]);
            adjacency[seg.n[1]].push(seg.n[0]);
            ends_at[seg.n[0]].push((s, 0));
            ends_at[seg.n[1]].push((s, 1));
        }
        for bar in &bars {
            adjacency[bar.n[0]].push(bar.n[1]);
            adjacency[bar.n[1]].push(bar.n[0]);
        }
        for list in adjacency.iter_mut() {
            list.sort_unstable();
            list.dedup();
        }
        let mut neq = 0usize;
        let mut eq_rot = Vec::new();
        let mut unused_dofs = 0;
        for a in reverse_cuthill_mckee(&adjacency) {
            anodes[a].rotational = rotation_used[a];
            let restrained = anodes[a].node.and_then(|n| index.foundation[n]).map_or([false; 6], |f| model.foundations[f].restrained);
            for i in 0..6 {
                anodes[a].eq[i] = if restrained[i] {
                    RESTRAINED
                } else if i >= 3 && !rotation_used[a] {
                    unused_dofs += 1;
                    INACTIVE
                } else {
                    eq_rot.push(i >= 3);
                    neq += 1;
                    neq as i32 - 1
                };
            }
            for &(s, end) in &ends_at[a] {
                for i in 0..6 {
                    if segs[s].geom.conn_var[6 * end + i] {
                        segs[s].q_eq[6 * end + i] = neq as i32;
                        eq_rot.push(i >= 3);
                        neq += 1;
                    }
                }
            }
        }

        let mut groups = Vec::with_capacity(segs.len() + bars.len());
        let mut system = System {
            anodes,
            segs,
            bars,
            members: spans,
            neq,
            eq_rot,
            fext,
            fext_q: vec![0.0; neq],
            lc: 1.0,
            size: 0.0,
            groups: Vec::new(),
            unused_dofs,
            force_unknowns,
            moment_on_unused,
        };
        for s in 0..system.segs.len() {
            groups.push(system.seg_eqs(s).iter().filter(|e| **e >= 0).map(|e| *e as usize).collect());
        }
        for bar in &system.bars {
            let eqs = bar.n.iter().flat_map(|n| system.anodes[*n].eq[..3].iter());
            groups.push(eqs.filter(|e| **e >= 0).map(|e| *e as usize).collect());
        }
        system.groups = groups;
        for seg in &system.segs {
            for k in 0..12 {
                if seg.q_eq[k] >= 0 {
                    // Load on the member end, resolved along the connection axis.
                    let (end, i) = (k / 6, k % 6);
                    let base = 6 * end + if i < 3 { 0 } else { 3 };
                    let load = [seg.self_weight[base], seg.self_weight[base + 1], seg.self_weight[base + 2]];
                    system.fext_q[seg.q_eq[k] as usize] += dot(&load, &col(&seg.geom.e0, i % 3));
                }
            }
        }
        if !members.is_empty() {
            system.lc = total_length / members.len() as f64;
        }
        let mut low = [f64::INFINITY; 3];
        let mut high = [f64::NEG_INFINITY; 3];
        for node in &system.anodes {
            for i in 0..3 {
                low[i] = low[i].min(node.pos[i]);
                high[i] = high[i].max(node.pos[i]);
            }
        }
        if !system.anodes.is_empty() {
            system.size = norm(&sub(&high, &low));
        }
        system
    }

    pub fn stiffness(&self) -> Skyline {
        Skyline::with_profile(self.neq, &self.groups)
    }

    /// Equations of a beam element's 24 variables.
    pub fn seg_eqs(&self, s: usize) -> [i32; 24] {
        let seg = &self.segs[s];
        let mut eqs = [-1; 24];
        eqs[..6].copy_from_slice(&self.anodes[seg.n[0]].eq);
        eqs[6..12].copy_from_slice(&self.anodes[seg.n[1]].eq);
        eqs[12..].copy_from_slice(&seg.q_eq);
        eqs
    }

    pub fn reference(&self) -> State {
        State { u: vec![[0.0; 3]; self.anodes.len()], r: vec![IDENTITY; self.anodes.len()], q: vec![0.0; self.neq] }
    }

    /// The state reached from `state` by the increment `alpha * d`.
    pub fn advance(&self, state: &State, d: &[f64], alpha: f64) -> State {
        let mut next = state.clone();
        for (a, node) in self.anodes.iter().enumerate() {
            let step = node.eq.map(|e| if e >= 0 { alpha * d[e as usize] } else { 0.0 });
            for i in 0..3 {
                next.u[a][i] += step[i];
            }
            if step[3] != 0.0 || step[4] != 0.0 || step[5] != 0.0 {
                next.r[a] = mat_mul(&exp_so3(&[step[3], step[4], step[5]]), &state.r[a]);
            }
        }
        for (q, step) in next.q.iter_mut().zip(d) {
            *q += alpha * step;
        }
        next
    }

    /// External load by equation at load factor one.
    pub fn load_vector(&self) -> Vec<f64> {
        let mut f = self.fext_q.clone();
        for (a, node) in self.anodes.iter().enumerate() {
            for i in 0..6 {
                if node.eq[i] >= 0 {
                    f[node.eq[i] as usize] = self.fext[a][i];
                }
            }
        }
        f
    }

    /// Norm of a force-like vector by equation, with moments divided by the
    /// characteristic length so that both kinds are forces.
    pub fn force_norm(&self, r: &[f64]) -> f64 {
        r.iter().zip(&self.eq_rot).map(|(v, rot)| if *rot { v / self.lc } else { *v }).map(|v| v * v).sum::<f64>().sqrt()
    }

    /// Norm of all external loads at load factor one, on the same scaling.
    pub fn load_norm(&self) -> f64 {
        let square = |f: &[f64; 6]| (0..6).map(|i| if i < 3 { f[i] } else { f[i] / self.lc }).map(|v| v * v).sum::<f64>();
        self.fext.iter().map(square).sum::<f64>().sqrt()
    }

    fn seg_state(&self, s: usize, state: &State) -> (SegState, [f64; 12]) {
        let seg = &self.segs[s];
        let mut q = [0.0; 12];
        for i in 0..12 {
            if seg.q_eq[i] >= 0 {
                q[i] = state.q[seg.q_eq[i] as usize];
            }
        }
        (SegState { u: [state.u[seg.n[0]], state.u[seg.n[1]]], r: [state.r[seg.n[0]], state.r[seg.n[1]]] }, q)
    }

    /// Strain energy at a deformed state.
    pub fn energy(&self, state: &State) -> f64 {
        let mut energy = 0.0;
        for s in 0..self.segs.len() {
            let (seg_state, q) = self.seg_state(s, state);
            energy += seg_energy_value(&self.segs[s].geom, &seg_state, &q);
        }
        for bar in &self.bars {
            energy += bar.geom.nonlinear(&sub(&state.u[bar.n[1]], &state.u[bar.n[0]])).energy;
        }
        energy
    }

    /// Current local axes of a beam element (columns).
    pub fn seg_frame(&self, s: usize, state: Option<&State>) -> M3<f64> {
        match state {
            None => self.segs[s].geom.e0,
            Some(state) => {
                let (seg_state, q) = self.seg_state(s, state);
                seg_frame(&self.segs[s].geom, &seg_state, &q)
            }
        }
    }

    /// Internal forces, and optionally the tangent stiffness, at `config`.
    pub fn evaluate(&self, config: &Config, mut stiffness: Option<&mut Skyline>) -> Eval {
        let mut eval = Eval {
            energy: 0.0,
            g: vec![[0.0; 6]; self.anodes.len()],
            g_eq: vec![0.0; self.neq],
            seg_g: Vec::with_capacity(self.segs.len()),
            bars: Vec::with_capacity(self.bars.len()),
            force_scale: 0.0,
        };
        for (s, seg) in self.segs.iter().enumerate() {
            let eqs = self.seg_eqs(s);
            let mut gradient = [0.0; 24];
            let nonlinear;
            let derivatives = match config {
                Config::Linear { x, .. } => {
                    let values = eqs.map(|e| if e >= 0 { x[e as usize] } else { 0.0 });
                    for i in 0..24 {
                        gradient[i] = (0..24).map(|j| seg.linear.hess(i, j) * values[j]).sum();
                    }
                    &seg.linear
                }
                Config::Nonlinear(state) => {
                    let (seg_state, q) = self.seg_state(s, state);
                    nonlinear = seg_derivatives(&seg.geom, &seg_state, &q);
                    gradient = nonlinear.g;
                    eval.energy += nonlinear.energy;
                    &nonlinear
                }
            };
            for end in 0..2 {
                for i in 0..6 {
                    let v = gradient[6 * end + i];
                    eval.g[seg.n[end]][i] += v;
                    eval.force_scale = eval.force_scale.max(if i < 3 { v.abs() } else { v.abs() / self.lc });
                }
            }
            for i in 0..24 {
                if eqs[i] >= 0 {
                    eval.g_eq[eqs[i] as usize] += gradient[i];
                }
            }
            let mut nodal = [0.0; 12];
            nodal.copy_from_slice(&gradient[..12]);
            eval.seg_g.push(nodal);
            if let Some(k) = stiffness.as_deref_mut() {
                for i in 0..24 {
                    if eqs[i] < 0 {
                        continue;
                    }
                    for j in 0..=i {
                        if eqs[j] >= 0 {
                            k.add(eqs[i] as usize, eqs[j] as usize, derivatives.hess(i, j));
                        }
                    }
                }
            }
        }
        for (b, bar) in self.bars.iter().enumerate() {
            let eq = [self.anodes[bar.n[0]].eq, self.anodes[bar.n[1]].eq];
            let result = match config {
                Config::Linear { x, active } => {
                    let at = |e: i32| if e >= 0 { x[e as usize] } else { 0.0 };
                    bar.geom.linear(&[0, 1, 2].map(|i| at(eq[1][i]) - at(eq[0][i])), active[b])
                }
                Config::Nonlinear(state) => bar.geom.nonlinear(&sub(&state.u[bar.n[1]], &state.u[bar.n[0]])),
            };
            eval.energy += result.energy;
            eval.force_scale = eval.force_scale.max(result.axial.abs());
            eval.bars.push((result.axial, result.active));
            for i in 0..3 {
                eval.g[bar.n[0]][i] -= result.force[i];
                eval.g[bar.n[1]][i] += result.force[i];
                for (end, sign) in [(0, -1.0), (1, 1.0)] {
                    if eq[end][i] >= 0 {
                        eval.g_eq[eq[end][i] as usize] += sign * result.force[i];
                    }
                }
            }
            if let Some(k) = stiffness.as_deref_mut() {
                for (ea, eb, sign) in [(0, 0, 1.0), (1, 1, 1.0), (1, 0, -1.0)] {
                    for i in 0..3 {
                        for j in 0..3 {
                            let (p, q) = (eq[ea][i], eq[eb][j]);
                            // Diagonal blocks are added once per symmetric pair.
                            if p >= 0 && q >= 0 && (ea != eb || j <= i) {
                                k.add(p as usize, q as usize, sign * result.tangent[i][j]);
                            }
                        }
                    }
                }
            }
        }
        eval
    }
}
