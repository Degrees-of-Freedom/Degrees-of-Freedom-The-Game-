//! Analytical model and analysis options accepted by the solver.
//!
//! Conventions (the whole solver uses these and nothing else):
//!
//! * **Units** are SI base units: metres, newtons, newton-metres, radians,
//!   pascals, kilograms per cubic metre.
//! * **Global axes** are right-handed X, Y, Z. The solver has no built-in
//!   "up"; gravity is a vector supplied in the options.
//! * **Six-component vectors** hold translations (or forces) X, Y, Z followed
//!   by rotations (or moments) about X, Y, Z.
//! * **Member local axes**: `x` runs from the start node to the end node.
//!   `z` is the component of the member's `orientation` vector perpendicular
//!   to `x`, and `y = z × x`. Without an orientation the reference vector is
//!   global Z, or global X for a member parallel to global Z. `Iy` and `Iz`
//!   are second moments of area about local `y` and `z`.
//! * **Connections** join a member end to its node. A connection has six
//!   laws, one per local DOF in the order translation x, y, z then rotation
//!   x, y, z, expressed in the member local axes of the undeformed model. The
//!   connection axes are attached to the node and turn with it.
//! * **Connectivity is by id only.** Two nodes at the same coordinates are
//!   different nodes, and members meet only where they name the same node.

use std::collections::{BTreeMap, BTreeSet};

pub type Vec3 = [f64; 3];

/// Largest model the solver accepts, to bound memory and time.
pub const MAX_NODES: usize = 5_000;
pub const MAX_MEMBERS: usize = 10_000;
/// Members shorter than this (m) are rejected as zero-length.
pub const MIN_MEMBER_LENGTH: f64 = 1e-9;

#[derive(Clone, Debug, Default)]
pub struct Model {
    /// Caller-defined identifier of this model state, echoed in the result.
    pub version: Option<String>,
    pub nodes: Vec<Node>,
    pub sections: Vec<Section>,
    pub members: Vec<Member>,
    pub foundations: Vec<Foundation>,
    pub loads: Vec<Load>,
    /// Uniform loads along members, in addition to self-weight.
    pub member_loads: Vec<MemberLoad>,
}

#[derive(Clone, Debug)]
pub struct Node {
    pub id: String,
    pub position: Vec3,
}

/// Card-defined member properties.
#[derive(Clone, Debug)]
pub struct Section {
    pub id: String,
    /// Young's modulus, Pa.
    pub e: f64,
    /// Shear modulus, Pa. Required for beams.
    pub g: f64,
    /// Cross-section area, m².
    pub a: f64,
    /// Second moments of area about local y and z, m⁴. Required for beams.
    pub iy: f64,
    pub iz: f64,
    /// Torsion constant, m⁴. Required for beams.
    pub j: f64,
    /// Shear areas for deflection along local y and z, m². Omitted means no
    /// shear deformation (Euler–Bernoulli bending).
    pub shear_area_y: Option<f64>,
    pub shear_area_z: Option<f64>,
    /// Mass density, kg/m³, used only when self-weight is switched on.
    pub density: f64,
    pub capacity: Option<SectionCapacity>,
}

/// Member strength limits. Any omitted limit is not checked.
#[derive(Clone, Debug, Default)]
pub struct SectionCapacity {
    /// Axial tension and compression, N.
    pub tension: Option<f64>,
    pub compression: Option<f64>,
    /// Resultant shear, N.
    pub shear: Option<f64>,
    /// Torsion and bending about local y and z, N·m.
    pub torsion: Option<f64>,
    pub moment_y: Option<f64>,
    pub moment_z: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum MemberKind {
    /// Beam-column: axial, shear, biaxial bending and torsion.
    #[default]
    Beam,
    /// Two-way axial member, pinned at both ends.
    Brace,
    /// Tension-only straight axial member.
    Cable,
}

/// Behaviour of one local DOF of a connection.
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub enum Law {
    /// The member end moves with the node (an exact constraint).
    #[default]
    Rigid,
    /// No force or moment is transmitted.
    Free,
    /// Linear spring: N/m for translations, N·m/rad for rotations.
    Elastic(f64),
}

#[derive(Clone, Debug, Default)]
pub struct Connection {
    /// Optional unit X/Y/Z vectors expressed in the global reference frame.
    /// They turn with the attached node. Omission uses the member axes.
    pub axes: Option<[Vec3; 3]>,
    /// Laws for local translation x, y, z then rotation x, y, z.
    pub laws: [Law; 6],
    pub capacity: Option<ConnectionCapacity>,
}

/// Connection strength limits. Any omitted limit is not checked.
#[derive(Clone, Debug, Default)]
pub struct ConnectionCapacity {
    /// Force along the member axis, N.
    pub axial: Option<f64>,
    /// Resultant transverse force, N.
    pub shear: Option<f64>,
    /// Resultant moment (torsion and bending), N·m.
    pub moment: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct Member {
    pub id: String,
    pub kind: MemberKind,
    pub start_node_id: String,
    pub end_node_id: String,
    pub section_id: String,
    /// Vector fixing the local z axis; see the module documentation.
    pub orientation: Option<Vec3>,
    /// Connections of a beam to its nodes. Braces and cables are always
    /// pinned and ignore the laws, but their capacities are checked.
    pub start: Connection,
    pub end: Connection,
    /// Unstressed length, m (braces and cables). Defaults to the distance
    /// between the nodes. Give this or `initial_strain`, not both.
    pub rest_length: Option<f64>,
    /// Strain at the undeformed geometry; positive is pretension.
    pub initial_strain: Option<f64>,
    /// Card the member belongs to when the game has split one card into
    /// several analytical members. Echoed in the result, not interpreted.
    pub parent_id: Option<String>,
    /// Beam elements used for this member; overrides the analysis option.
    pub subdivisions: Option<u32>,
}

#[derive(Clone, Debug)]
pub struct Foundation {
    pub id: String,
    pub node_id: String,
    /// Restrained global DOFs: translations X, Y, Z then rotations X, Y, Z.
    pub restrained: [bool; 6],
}

/// Persistent nodal load in global axes.
#[derive(Clone, Debug)]
pub struct Load {
    pub id: String,
    pub node_id: String,
    pub force: Vec3,
    pub moment: Vec3,
}

/// A uniform load along the whole length of a member, N/m in global axes.
///
/// It is treated exactly like self-weight: applied once as consistent nodal
/// loads on each beam element, or half to each end of a brace or cable, and
/// it keeps its global direction as the member deforms (it is not a
/// follower load). It is multiplied by the load factor.
#[derive(Clone, Debug)]
pub struct MemberLoad {
    pub id: String,
    pub member_id: String,
    /// Force per unit undeformed length, N/m.
    pub force: Vec3,
}

/// Most load cases accepted in one request.
pub const MAX_LOAD_CASES: usize = 100;

/// One load case of a multi-case request: the same structure analysed under
/// different loads. Each case is a complete, independent analysis; omitted
/// fields keep the request's model loads and options.
#[derive(Clone, Debug)]
pub struct LoadCase {
    pub id: String,
    /// Replaces the model's nodal loads for this case.
    pub loads: Option<Vec<Load>>,
    /// Replaces the model's member loads for this case.
    pub member_loads: Option<Vec<MemberLoad>>,
    /// Replaces `options.load_factor`.
    pub load_factor: Option<f64>,
    /// Replaces `options.gravity`, so self-weight can be factored per case.
    pub gravity: Option<Vec3>,
    /// `false` analyses this case without self-weight.
    pub self_weight: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Fidelity {
    /// Small-displacement linear elastic analysis about the undeformed model.
    Linear,
    /// Geometrically nonlinear static analysis.
    #[default]
    Nonlinear,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum FailureMode {
    /// Report strength exceedance and change nothing.
    #[default]
    Report,
    /// Remove the most overloaded member, or release the most overloaded
    /// connection, and reanalyse, one event at a time.
    Remove,
}

#[derive(Clone, Debug)]
pub struct Options {
    /// Return mesh station cuts and physical end motions for rendering and
    /// independent capacity laws. This changes serialization only.
    pub member_fields: bool,
    pub fidelity: Fidelity,
    /// Gravity acceleration vector, m/s². Present switches self-weight on.
    pub gravity: Option<Vec3>,
    /// Multiplier on every external load, including self-weight.
    pub load_factor: f64,
    /// Beam elements per beam member.
    pub subdivisions: u32,
    /// Equilibrium iterations target: normalised residual.
    pub tolerance: f64,
    /// Normalised residual above which a result is not accepted as valid.
    pub residual_gate: f64,
    /// Newton iterations allowed in one load step.
    pub max_iterations: u32,
    /// Newton iterations allowed for a whole component. This is the solver's
    /// deterministic time limit: running out returns `unknown`.
    pub max_total_iterations: u32,
    /// Newton iterations allowed for the whole request: every component and
    /// every failure event share it, in a fixed order. Like the per-component
    /// limit it is a count, not a time, so results do not depend on how fast
    /// the machine is. Components left without budget report `unknown`.
    pub max_request_iterations: u32,
    /// A component whose largest displacement exceeds this fraction of its
    /// bounding-box diagonal is reported as excessively deformed.
    pub excessive_displacement_ratio: f64,
    /// Search for the critical load factor of a load-induced instability.
    pub critical_load_search: bool,
    /// A stable component that is no longer stable with its loads multiplied
    /// by this factor is reported as marginal. One disables the check.
    pub stability_margin: f64,
    pub failure: FailureMode,
    /// Failure events allowed before the analysis stops redistributing.
    pub max_failure_events: u32,
    /// Mode shapes returned per component; counts are never truncated.
    pub max_modes: u32,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            fidelity: Fidelity::Nonlinear,
            member_fields: false,
            gravity: None,
            load_factor: 1.0,
            subdivisions: 2,
            tolerance: 1e-9,
            residual_gate: 1e-5,
            max_iterations: 40,
            max_total_iterations: 400,
            max_request_iterations: 2000,
            excessive_displacement_ratio: 0.1,
            critical_load_search: true,
            stability_margin: 1.25,
            failure: FailureMode::Report,
            max_failure_events: 8,
            max_modes: 12,
        }
    }
}

/// A reason an input cannot be analysed.
#[derive(Clone, Debug)]
pub struct Issue {
    pub code: &'static str,
    pub message: String,
    pub ids: Vec<String>,
}

/// Sum of floating-point values, exact before the final rounding (the
/// algorithm of Shewchuk, as Python's `math.fsum`). Equal and opposite
/// extreme loads, such as 1e308, 3 and -1e308, keep their small remainder
/// instead of losing it to rounding or overflowing on the way. If the
/// running sum would overflow, the values are scaled down by a power of two,
/// which is exact, summed, and scaled back. A total that is itself beyond
/// the range of a double comes back as an infinity.
pub fn exact_sum(values: &[f64]) -> f64 {
    fn msum(values: impl Iterator<Item = f64>) -> f64 {
        let mut partials: Vec<f64> = Vec::new();
        for mut x in values {
            let mut kept = 0;
            for i in 0..partials.len() {
                let mut y = partials[i];
                if x.abs() < y.abs() {
                    std::mem::swap(&mut x, &mut y);
                }
                let high = x + y;
                let low = y - (high - x);
                if low != 0.0 {
                    partials[kept] = low;
                    kept += 1;
                }
                x = high;
            }
            partials.truncate(kept);
            partials.push(x);
        }
        partials.iter().rev().fold(0.0, |total, p| total + p)
    }
    let total = msum(values.iter().copied());
    if total.is_finite() || values.iter().any(|v| !v.is_finite()) {
        return total;
    }
    const SHIFT: f64 = 18446744073709551616.0; // 2^64
    msum(values.iter().map(|v| v / SHIFT)) * SHIFT
}

fn issue(code: &'static str, message: String, ids: &[&str]) -> Issue {
    Issue { code, message, ids: ids.iter().map(|s| s.to_string()).collect() }
}

fn finite(values: &[f64]) -> bool {
    values.iter().all(|v| v.is_finite())
}

/// Whether the stiffness coefficients an element is built from are all
/// positive, finite doubles. Finite card values can still overflow or
/// underflow once multiplied, for example E = 1e308 on an area of 2, or a
/// cable whose rest length is 1e-308.
fn coefficients_out_of_range(m: &Member, s: &Section, length: f64, piece: f64, options: &Options) -> Option<&'static str> {
    let ea = s.e * s.a;
    let mut positive = vec![ea, ea / piece, piece * piece];
    if m.kind == MemberKind::Beam {
        let gj = s.g * s.j;
        positive.extend([gj, gj / piece, piece * piece * piece]);
        for inertia in [s.iy, s.iz] {
            let ei = s.e * inertia;
            positive.extend([ei, 4.0 * ei / piece, 12.0 * ei / (piece * piece * piece)]);
        }
    } else {
        let rest = match (m.rest_length, m.initial_strain) {
            (Some(rest), _) => rest,
            (None, Some(strain)) => length / (1.0 + strain),
            (None, None) => length,
        };
        let ratio = length / rest;
        positive.extend([rest, ratio, 1.0 / ratio, ea / rest]);
        if !(ea * (ratio - 1.0)).is_finite() {
            return Some("its force at the built length is outside the numeric range.");
        }
    }
    if let Some(g) = options.gravity {
        let weight = s.density * s.a * (g[0] * g[0] + g[1] * g[1] + g[2] * g[2]).sqrt() * length;
        if !weight.is_finite() {
            return Some("its self-weight is outside the numeric range.");
        }
    }
    if positive.iter().all(|v| v.is_finite() && *v > 0.0) {
        None
    } else {
        Some("its geometry and section give stiffness coefficients outside the numeric range.")
    }
}

/// Check that a model is analysable. Returns every problem found.
pub fn validate(model: &Model, options: &Options) -> Vec<Issue> {
    let mut issues = Vec::new();
    if model.nodes.len() > MAX_NODES {
        issues.push(issue("tooLarge", format!("The model has {} nodes; at most {MAX_NODES} are accepted.", model.nodes.len()), &[]));
    }
    if model.members.len() > MAX_MEMBERS {
        issues.push(issue("tooLarge", format!("The model has {} members; at most {MAX_MEMBERS} are accepted.", model.members.len()), &[]));
    }
    if !issues.is_empty() {
        return issues;
    }

    let mut nodes: BTreeMap<&str, &Node> = BTreeMap::new();
    for node in &model.nodes {
        if !finite(&node.position) {
            issues.push(issue("nonFiniteInput", format!("Node '{}' has a non-finite position.", node.id), &[&node.id]));
        }
        if nodes.insert(&node.id, node).is_some() {
            issues.push(issue("duplicateId", format!("Duplicate node id '{}'.", node.id), &[&node.id]));
        }
    }

    let mut sections: BTreeMap<&str, &Section> = BTreeMap::new();
    for s in &model.sections {
        let mut numbers = vec![s.e, s.g, s.a, s.iy, s.iz, s.j, s.density];
        numbers.extend(s.shear_area_y);
        numbers.extend(s.shear_area_z);
        if let Some(c) = &s.capacity {
            numbers.extend([c.tension, c.compression, c.shear, c.torsion, c.moment_y, c.moment_z].into_iter().flatten());
        }
        if !finite(&numbers) || numbers.iter().any(|v| *v < 0.0) || s.e <= 0.0 || s.a <= 0.0 {
            issues.push(issue("invalidSection", format!("Section '{}' needs finite, non-negative properties with positive E and A.", s.id), &[&s.id]));
        }
        if sections.insert(&s.id, s).is_some() {
            issues.push(issue("duplicateId", format!("Duplicate section id '{}'.", s.id), &[&s.id]));
        }
    }

    let mut member_ids = BTreeSet::new();
    for m in &model.members {
        if !member_ids.insert(m.id.as_str()) {
            issues.push(issue("duplicateId", format!("Duplicate member id '{}'.", m.id), &[&m.id]));
        }
        let ends = (nodes.get(m.start_node_id.as_str()), nodes.get(m.end_node_id.as_str()));
        let (Some(a), Some(b)) = ends else {
            issues.push(issue("unknownReference", format!("Member '{}' refers to a node that does not exist.", m.id), &[&m.id]));
            continue;
        };
        let axis = [0, 1, 2].map(|i| b.position[i] - a.position[i]);
        let length = (axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]).sqrt();
        if !(length * length).is_finite() && a.position.iter().chain(&b.position).all(|v| v.is_finite()) {
            issues.push(issue("numericRange", format!("Member '{}' spans a distance whose square is outside the numeric range.", m.id), &[&m.id]));
            continue;
        }
        if m.start_node_id == m.end_node_id || !(length >= MIN_MEMBER_LENGTH) {
            issues.push(issue("zeroLength", format!("Member '{}' has zero length.", m.id), &[&m.id]));
            continue;
        }
        // Element stations along a subdivided beam must stay distinct at the
        // precision of the coordinates.
        let pieces = if m.kind == MemberKind::Beam { m.subdivisions.unwrap_or(options.subdivisions).max(1) } else { 1 };
        let piece = length / pieces as f64;
        let magnitude = a.position.iter().chain(&b.position).fold(0.0_f64, |most, v| most.max(v.abs()));
        if piece <= 64.0 * f64::EPSILON * magnitude {
            issues.push(issue("numericRange", format!("Member '{}' is too short for coordinates this large: its element stations would coincide.", m.id), &[&m.id]));
            continue;
        }
        match sections.get(m.section_id.as_str()) {
            None => issues.push(issue("unknownReference", format!("Member '{}' refers to section '{}', which does not exist.", m.id, m.section_id), &[&m.id])),
            Some(s) => {
                if m.kind == MemberKind::Beam && !(s.g > 0.0 && s.iy > 0.0 && s.iz > 0.0 && s.j > 0.0) {
                    issues.push(issue("invalidSection", format!("Beam '{}' needs a section with positive G, Iy, Iz and J.", m.id), &[&m.id, &s.id]));
                } else if let Some(problem) = coefficients_out_of_range(m, s, length, piece, options) {
                    issues.push(issue("numericRange", format!("Member '{}': {problem}", m.id), &[&m.id, &s.id]));
                }
            }
        }
        if let Some(o) = m.orientation {
            let c = [o[1] * axis[2] - o[2] * axis[1], o[2] * axis[0] - o[0] * axis[2], o[0] * axis[1] - o[1] * axis[0]];
            let sine = (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]).sqrt() / (length * (o[0] * o[0] + o[1] * o[1] + o[2] * o[2]).sqrt());
            if !finite(&o) || !(sine > 1e-6) {
                issues.push(issue("invalidOrientation", format!("The orientation of member '{}' must be a finite vector that is not parallel to the member.", m.id), &[&m.id]));
            }
        }
        for connection in [&m.start, &m.end] {
            if let Some([x, y, z]) = connection.axes {
                use crate::math::{cross, dot};
                let orthonormal = [x, y, z].iter().all(|v| (dot(v, v) - 1.0).abs() < 1e-10)
                    && dot(&x, &y).abs() < 1e-10 && dot(&x, &z).abs() < 1e-10
                    && dot(&y, &z).abs() < 1e-10 && dot(&cross(&x, &y), &z) > 1.0 - 1e-10;
                if !orthonormal {
                    issues.push(issue("invalidConnectionAxes", "Connector axes must be right-handed and orthonormal.".into(), &[&m.id]));
                }
            }
            for law in connection.laws {
                if let Law::Elastic(k) = law {
                    if !(k.is_finite() && k > 0.0) {
                        issues.push(issue("invalidConnection", format!("Member '{}' has an elastic connection stiffness that is not positive and finite.", m.id), &[&m.id]));
                    }
                }
            }
            if let Some(c) = &connection.capacity {
                if [c.axial, c.shear, c.moment].into_iter().flatten().any(|v| !(v.is_finite() && v >= 0.0)) {
                    issues.push(issue("invalidConnection", format!("Member '{}' has a connection capacity that is negative or not finite.", m.id), &[&m.id]));
                }
            }
        }
        if m.rest_length.is_some() && m.initial_strain.is_some() {
            issues.push(issue("invalidMember", format!("Member '{}' gives both a rest length and an initial strain.", m.id), &[&m.id]));
        }
        if m.rest_length.is_some_and(|l| !(l.is_finite() && l > 0.0)) || m.initial_strain.is_some_and(|e| !(e.is_finite() && e > -0.9)) {
            issues.push(issue("invalidMember", format!("Member '{}' has an invalid rest length or initial strain.", m.id), &[&m.id]));
        }
        if m.kind == MemberKind::Beam && (m.rest_length.is_some() || m.initial_strain.is_some()) {
            issues.push(issue("invalidMember", format!("Beam '{}' cannot have a rest length or initial strain; only braces and cables can.", m.id), &[&m.id]));
        }
        if m.subdivisions.is_some_and(|n| n == 0 || n > 64) {
            issues.push(issue("invalidMember", format!("Member '{}' must use between 1 and 64 subdivisions.", m.id), &[&m.id]));
        }
    }

    let mut foundation_ids = BTreeSet::new();
    let mut founded_nodes = BTreeMap::new();
    for f in &model.foundations {
        if !foundation_ids.insert(f.id.as_str()) {
            issues.push(issue("duplicateId", format!("Duplicate foundation id '{}'.", f.id), &[&f.id]));
        }
        if !nodes.contains_key(f.node_id.as_str()) {
            issues.push(issue("unknownReference", format!("Foundation '{}' refers to a node that does not exist.", f.id), &[&f.id]));
        } else if let Some(other) = founded_nodes.insert(f.node_id.as_str(), f.id.as_str()) {
            // Two foundations on one node restrain the same DOFs twice, and
            // their reactions could not be told apart.
            issues.push(issue("redundantConstraint", format!("Foundations '{other}' and '{}' restrain the same node.", f.id), &[other, &f.id]));
        }
    }

    let mut load_ids = BTreeSet::new();
    for l in &model.loads {
        if !load_ids.insert(l.id.as_str()) {
            issues.push(issue("duplicateId", format!("Duplicate load id '{}'.", l.id), &[&l.id]));
        }
        if !nodes.contains_key(l.node_id.as_str()) {
            issues.push(issue("unknownReference", format!("Load '{}' refers to a node that does not exist.", l.id), &[&l.id]));
        }
        if !finite(&l.force) || !finite(&l.moment) {
            issues.push(issue("nonFiniteInput", format!("Load '{}' is not finite.", l.id), &[&l.id]));
        }
    }

    // Finite loads can still add up to more than a double holds.
    let mut on_node: BTreeMap<&str, Vec<[f64; 6]>> = BTreeMap::new();
    for l in &model.loads {
        on_node.entry(l.node_id.as_str()).or_default().push([l.force[0], l.force[1], l.force[2], l.moment[0], l.moment[1], l.moment[2]]);
    }
    for (node, loads) in &on_node {
        let finite = loads.iter().flatten().all(|v| v.is_finite());
        if finite && (0..6).any(|i| !exact_sum(&loads.iter().map(|l| l[i]).collect::<Vec<_>>()).is_finite()) {
            issues.push(issue("numericRange", format!("The loads on node '{node}' add up to a combined force or moment outside the numeric range."), &[node]));
        }
    }

    for l in &model.member_loads {
        if !load_ids.insert(l.id.as_str()) {
            issues.push(issue("duplicateId", format!("Duplicate load id {}.", l.id), &[&l.id]));
        }
        if !member_ids.contains(l.member_id.as_str()) {
            issues.push(issue("unknownReference", format!("Member load {} refers to a member that does not exist.", l.id), &[&l.id]));
        }
        if !finite(&l.force) {
            issues.push(issue("nonFiniteInput", format!("Member load {} is not finite.", l.id), &[&l.id]));
        }
    }

    let o = options;
    let numbers = [o.load_factor, o.tolerance, o.residual_gate, o.excessive_displacement_ratio, o.stability_margin];
    if !finite(&numbers) || o.tolerance <= 0.0 || o.residual_gate <= 0.0 || o.excessive_displacement_ratio <= 0.0 || o.gravity.is_some_and(|g| !finite(&g)) {
        issues.push(issue("invalidOptions", "Analysis options must be finite, with positive tolerances.".into(), &[]));
    }
    if o.subdivisions == 0 || o.subdivisions > 64 || o.max_iterations == 0 || o.max_total_iterations == 0 || o.max_request_iterations == 0 {
        issues.push(issue("invalidOptions", "Subdivisions must be between 1 and 64 and iteration limits positive.".into(), &[]));
    }
    issues
}
