//! Whole-model analysis: component isolation, strength checks, the optional
//! failure sequence, and the result document.
//!
//! Result conventions:
//!
//! * A value that is unavailable or unverified is `null`, never zero.
//! * Member forces are section forces `[N, Vy, Vz, T, My, Mz]` in the member's
//!   current local axes, as the resultants acting on the face whose outward
//!   normal is local +x. `N` is positive in tension. The `start` and `end`
//!   values use the same convention, so an unloaded member has equal values
//!   at both ends for `N`, `Vy`, `Vz` and `T`.
//! * Foundation reactions are the forces and moments the foundation applies
//!   to the structure, in global axes. A positive vertical reaction pushes
//!   the structure along the positive axis; uplift shows as the opposite sign.

use crate::json::{object, Json};
use crate::math::*;
use crate::model::*;
use crate::solve::{self, Outcome, Status};
use crate::system::*;
use std::collections::{BTreeMap, BTreeSet};

pub const SOLVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// A mode whose largest model-node motion is below this fraction of its
/// largest motion overall (connection variables included) moves no node.
const NODE_PARTICIPATION: f64 = 1e-9;

fn strings(items: impl IntoIterator<Item = impl Into<String>>) -> Json {
    Json::Arr(items.into_iter().map(|s| Json::Str(s.into())).collect())
}

/// Result for an input that cannot be analysed.
pub fn invalid(version: Option<&str>, issues: &[Issue]) -> Json {
    let diagnostics: Vec<Json> = issues
        .iter()
        .map(|i| object([("code", i.code.into()), ("message", i.message.as_str().into()), ("ids", strings(i.ids.iter().cloned()))]))
        .collect();
    let codes: BTreeSet<&str> = issues.iter().map(|i| i.code).collect();
    object([
        (
            "analysis",
            object([
                ("solverVersion", SOLVER_VERSION.into()),
                ("modelVersion", version.into()),
                ("units", "SI".into()),
                ("status", "invalid".into()),
                ("reasonCodes", strings(codes)),
                ("diagnostics", Json::Arr(diagnostics)),
            ]),
        ),
        ("components", Json::Arr(Vec::new())),
        ("nodes", Json::Obj(Vec::new())),
        ("members", Json::Obj(Vec::new())),
        ("foundations", Json::Obj(Vec::new())),
        ("failureEvents", Json::Arr(Vec::new())),
    ])
}

/// Demand over capacity for each limit state a capacity is given for.
fn section_checks(f: &[f64; 6], capacity: &SectionCapacity) -> Vec<(f64, &'static str)> {
    let ratio = |demand: f64, limit: f64| demand / limit.max(1e-300);
    let mut checks = Vec::new();
    let axial = if f[0] >= 0.0 { capacity.tension.map(|c| ratio(f[0], c)) } else { capacity.compression.map(|c| ratio(-f[0], c)) };
    let bending = [capacity.moment_y.map(|c| ratio(f[4].abs(), c)), capacity.moment_z.map(|c| ratio(f[5].abs(), c))];
    let flexure: f64 = bending.iter().flatten().sum();
    if axial.is_some() || bending.iter().any(|b| b.is_some()) {
        // Linear axial–flexural interaction.
        let total = axial.unwrap_or(0.0) + flexure;
        let label = if flexure == 0.0 {
            if f[0] >= 0.0 { "tension" } else { "compression" }
        } else if axial.unwrap_or(0.0) == 0.0 {
            "bending"
        } else {
            "axialBending"
        };
        checks.push((total, label));
    }
    if let Some(c) = capacity.shear {
        checks.push((ratio(f[1].hypot(f[2]), c), "shear"));
    }
    if let Some(c) = capacity.torsion {
        checks.push((ratio(f[3].abs(), c), "torsion"));
    }
    checks
}

fn connection_checks(f: &[f64; 6], capacity: &ConnectionCapacity) -> Vec<(f64, &'static str)> {
    let ratio = |demand: f64, limit: f64| demand / limit.max(1e-300);
    let mut checks = Vec::new();
    if let Some(c) = capacity.axial {
        checks.push((ratio(f[0].abs(), c), "connectionAxial"));
    }
    if let Some(c) = capacity.shear {
        checks.push((ratio(f[1].hypot(f[2]), c), "connectionShear"));
    }
    if let Some(c) = capacity.moment {
        checks.push((ratio((f[3] * f[3] + f[4] * f[4] + f[5] * f[5]).sqrt(), c), "connectionMoment"));
    }
    checks
}

fn governing(checks: Vec<(f64, &'static str)>) -> Option<(f64, &'static str)> {
    checks.into_iter().fold(None, |best, c| match best {
        Some(b) if b.0 >= c.0 => Some(b),
        _ => Some(c),
    })
}

fn utilisation_json(result: Option<(f64, &'static str)>) -> [(&'static str, Json); 2] {
    [("utilization", result.map(|r| r.0).into()), ("governingLimitState", result.map(|r| r.1).into())]
}

/// The most overloaded object found in one analysis pass.
#[derive(Clone)]
struct Overload {
    ratio: f64,
    limit_state: &'static str,
    member: usize,
    /// `Some(end)` for a connection, `None` for the member itself.
    end: Option<usize>,
}

struct Pass {
    components: Vec<Json>,
    nodes: BTreeMap<String, Json>,
    members: BTreeMap<String, Json>,
    foundations: BTreeMap<String, Json>,
    reasons: BTreeSet<&'static str>,
    iterations: u32,
    overload: Option<Overload>,
}

fn status_name(status: Status) -> &'static str {
    match status {
        Status::Stable => "stable",
        Status::Marginal => "marginal",
        Status::Unstable => "unstable",
        Status::Unknown => "unknown",
    }
}

/// Group nodes and members into structural components: sets joined by at
/// least one member end that transmits something.
fn components(index: &Index) -> Vec<(Vec<usize>, Vec<usize>)> {
    let model = index.model;
    let n = model.nodes.len();
    let mut parent: Vec<usize> = (0..n + model.members.len()).collect();
    fn find(parent: &mut [usize], mut i: usize) -> usize {
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    }
    let mut touched = vec![false; n];
    for (m, member) in model.members.iter().enumerate() {
        for (end, node) in index.ends(member).into_iter().enumerate() {
            if end_attached(member, end) {
                touched[node] = true;
                let (a, b) = (find(&mut parent, node), find(&mut parent, n + m));
                // The smaller index becomes the root, so numbering is stable.
                parent[a.max(b)] = a.min(b);
            }
        }
    }
    for load in &model.loads {
        touched[index.node[load.node_id.as_str()]] = true;
    }
    let mut groups: BTreeMap<usize, (Vec<usize>, Vec<usize>)> = BTreeMap::new();
    for i in 0..n {
        // A node with no member and no load is not a structure.
        if touched[i] {
            groups.entry(find(&mut parent, i)).or_default().0.push(i);
        }
    }
    for m in 0..model.members.len() {
        groups.entry(find(&mut parent, n + m)).or_default().1.push(m);
    }
    groups.into_values().collect()
}

/// Undeformed length of a model member.
fn member_length(index: &Index, member: &Member) -> f64 {
    let [a, b] = index.ends(member);
    norm(&sub(&index.model.nodes[b].position, &index.model.nodes[a].position))
}

/// Displacement of analysis node `a`, global axes: translations, then the
/// rotation vector (the logarithm of the nodal rotation in the nonlinear case).
fn displacement_of(sys: &System, solution: &solve::Solution, a: usize) -> [f64; 6] {
    match &solution.state {
        Some(state) => {
            let rotation = log_so3(&state.r[a]);
            [state.u[a][0], state.u[a][1], state.u[a][2], rotation[0], rotation[1], rotation[2]]
        }
        None => sys.anodes[a].eq.map(|e| if e >= 0 { solution.x[e as usize] } else { 0.0 }),
    }
}

/// Deflection along a beam member, from the analysis nodes of its elements.
///
/// Stations are the element ends: `subdivisions + 1` points at
/// `at = k / subdivisions` of the member length from the start. Nothing is
/// interpolated between them, so a finer station spacing needs more
/// subdivisions. A member end that is fully released has its own analysis
/// node, so its station is the end of the member, not the model node.
///
/// `maxFromChord` is the largest distance of a deformed station from the
/// straight line through the deformed end stations: the sag or bow a
/// deflection limit such as span / 250 is checked against. It excludes the
/// member's rigid-body motion and the movement of its supports.
fn deflection_json(sys: &System, solution: &solve::Solution, range: &std::ops::Range<usize>, length: f64) -> Json {
    let mut chain: Vec<usize> = range.clone().map(|s| sys.segs[s].n[0]).collect();
    chain.push(sys.segs[range.end - 1].n[1]);
    let count = chain.len() - 1;
    let displacements: Vec<[f64; 6]> = chain.iter().map(|&a| displacement_of(sys, solution, a)).collect();
    let deformed: Vec<V3<f64>> = chain.iter().zip(&displacements).map(|(&a, d)| [0, 1, 2].map(|i| sys.anodes[a].pos[i] + d[i])).collect();
    let (p0, p1) = (deformed[0], deformed[count]);
    let chord = sub(&p1, &p0);
    let chord_length = norm(&chord);
    let mut max_from_chord = 0.0f64;
    let mut at_max = 0.0;
    for (k, p) in deformed.iter().enumerate() {
        let offset = sub(p, &p0);
        // Distance from the chord line; from the start point if the ends meet.
        let distance = if chord_length > 1e-12 * length.max(1e-300) { norm(&cross(&offset, &chord)) / chord_length } else { norm(&offset) };
        if distance > max_from_chord {
            max_from_chord = distance;
            at_max = k as f64 / count as f64;
        }
    }
    let stations: Vec<Json> =
        displacements.iter().enumerate().map(|(k, d)| object([("at", (k as f64 / count as f64).into()), ("displacement", (*d).into())])).collect();
    object([("stations", Json::Arr(stations)), ("maxFromChord", max_from_chord.into()), ("atMax", at_max.into()), ("length", length.into())])
}

fn analyse_once(index: &Index, options: &Options, failed: &BTreeSet<String>, remaining: &mut u32) -> Pass {
    let model = index.model;
    let mut pass = Pass {
        components: Vec::new(),
        nodes: BTreeMap::new(),
        members: BTreeMap::new(),
        foundations: BTreeMap::new(),
        reasons: BTreeSet::new(),
        iterations: 0,
        overload: None,
    };
    for node in &model.nodes {
        pass.nodes.insert(node.id.clone(), object([("componentId", Json::Null), ("displacement", Json::Null)]));
    }
    for foundation in &model.foundations {
        // Replaced below for every foundation that belongs to a component.
        pass.foundations.insert(
            foundation.id.clone(),
            object([("nodeId", foundation.node_id.as_str().into()), ("componentId", Json::Null), ("valid", false.into()), ("reaction", Json::Null)]),
        );
    }
    for id in failed {
        pass.members.insert(id.clone(), object([("componentId", Json::Null), ("state", "failed".into()), ("forces", Json::Null), ("utilization", Json::Null)]));
    }

    for (number, (nodes, members)) in components(index).into_iter().enumerate() {
        let id = format!("c{}", number + 1);
        let sys = System::build(index, &nodes, &members, options);
        // Each component gets what is left of the request's budget, up to its
        // own limit, in component order: the same work in the same order
        // every time, on any machine.
        let mut budgeted = options.clone();
        budgeted.max_total_iterations = options.max_total_iterations.min(*remaining);
        let outcome: Outcome = solve::analyze(&sys, &budgeted);
        *remaining = remaining.saturating_sub(outcome.iterations);
        if budgeted.max_total_iterations < options.max_total_iterations && outcome.reasons.contains(&"iterationLimit") {
            pass.reasons.insert("requestIterationLimit");
        }
        pass.iterations += outcome.iterations;
        let solution = outcome.solution.as_ref();
        let lam = options.load_factor;
        let mut reasons: Vec<&'static str> = outcome.reasons.clone();
        let mut strength_exceeded = false;

        // Nodes.
        for (a, anode) in sys.anodes.iter().enumerate() {
            let Some(n) = anode.node else { continue };
            let displacement: Json = solution.map(|s| displacement_of(&sys, s, a)).into();
            pass.nodes.insert(model.nodes[n].id.clone(), object([("componentId", id.as_str().into()), ("displacement", displacement)]));
            if let Some(f) = index.foundation[n] {
                let foundation = &model.foundations[f];
                let reaction: Json = match solution {
                    None => Json::Null,
                    Some(s) => {
                        let r: [f64; 6] = std::array::from_fn(|i| if foundation.restrained[i] { s.eval.g[a][i] - lam * sys.fext[a][i] } else { 0.0 });
                        r.into()
                    }
                };
                pass.foundations.insert(
                    foundation.id.clone(),
                    object([("nodeId", foundation.node_id.as_str().into()), ("componentId", id.as_str().into()), ("valid", solution.is_some().into()), ("reaction", reaction)]),
                );
            }
        }

        // Members.
        for (m, span) in &sys.members {
            let member = &model.members[*m];
            let section = &model.sections[index.section[member.section_id.as_str()]];
            let mut fields: Vec<(&str, Json)> = vec![("componentId", id.as_str().into()), ("parentId", member.parent_id.clone().into())];
            match (solution, span) {
                (None, _) => fields.extend([("state", Json::Null), ("forces", Json::Null), ("utilization", Json::Null), ("governingLimitState", Json::Null), ("connections", Json::Null), ("deflection", Json::Null)]),
                (Some(s), Span::Bar(b)) => {
                    let (axial, active) = s.eval.bars[*b];
                    let forces = [axial, 0.0, 0.0, 0.0, 0.0, 0.0];
                    let member_check = section.capacity.as_ref().and_then(|c| governing(section_checks(&forces, c)));
                    let mut connections = Vec::new();
                    for (end, connection) in [&member.start, &member.end].into_iter().enumerate() {
                        let check = connection.capacity.as_ref().and_then(|c| governing(connection_checks(&forces, c)));
                        note_overload(&mut pass.overload, check, *m, Some(end));
                        strength_exceeded |= check.is_some_and(|c| c.0 > 1.0);
                        let [u, g] = utilisation_json(check);
                        connections.push(object([("relativeMotion", [0.0; 6].into()), u, g]));
                    }
                    note_overload(&mut pass.overload, member_check, *m, None);
                    strength_exceeded |= member_check.is_some_and(|c| c.0 > 1.0);
                    let [u, g] = utilisation_json(member_check);
                    fields.extend([
                        ("state", if active { "active" } else { "slack" }.into()),
                        ("forces", object([("start", forces.into()), ("end", forces.into())])),
                        u,
                        g,
                        ("connections", object([("start", connections.remove(0)), ("end", connections.remove(0))])),
                        // A brace or cable is one straight element: nothing lies between its ends.
                        ("deflection", Json::Null),
                    ]);
                }
                (Some(s), Span::Segs(range)) => {
                    let mut stations: Vec<[f64; 6]> = Vec::new();
                    for seg_index in range.clone() {
                        let seg = &sys.segs[seg_index];
                        let frame = sys.seg_frame(seg_index, s.state.as_ref());
                        for end in 0..2 {
                            let sign = if end == 0 { -1.0 } else { 1.0 };
                            let net: [f64; 6] = std::array::from_fn(|i| s.eval.seg_g[seg_index][6 * end + i] - lam * seg.self_weight[6 * end + i]);
                            let force = tmat_vec(&frame, &[net[0], net[1], net[2]]);
                            let moment = tmat_vec(&frame, &[net[3], net[4], net[5]]);
                            stations.push([force[0], force[1], force[2], moment[0], moment[1], moment[2]].map(|v| sign * v));
                        }
                    }
                    let (start, end) = (stations[0], stations[stations.len() - 1]);
                    let member_check = section.capacity.as_ref().and_then(|c| governing(stations.iter().flat_map(|f| section_checks(f, c)).collect()));
                    note_overload(&mut pass.overload, member_check, *m, None);
                    strength_exceeded |= member_check.is_some_and(|c| c.0 > 1.0);
                    let mut connections = Vec::new();
                    for (e, (connection, forces)) in [(&member.start, &start), (&member.end, &end)].into_iter().enumerate() {
                        let seg_index = if e == 0 { range.start } else { range.end - 1 };
                        let motion: [f64; 6] = std::array::from_fn(|i| {
                            let eq = sys.segs[seg_index].q_eq[6 * e + i];
                            if eq < 0 {
                                0.0
                            } else {
                                match &s.state {
                                    Some(state) => state.q[eq as usize],
                                    None => s.x[eq as usize],
                                }
                            }
                        });
                        let check = connection.capacity.as_ref().and_then(|c| governing(connection_checks(forces, c)));
                        note_overload(&mut pass.overload, check, *m, Some(e));
                        strength_exceeded |= check.is_some_and(|c| c.0 > 1.0);
                        let [u, g] = utilisation_json(check);
                        connections.push(object([("relativeMotion", motion.into()), u, g]));
                    }
                    let [u, g] = utilisation_json(member_check);
                    fields.extend([
                        ("state", "active".into()),
                        ("forces", object([("start", start.into()), ("end", end.into())])),
                        u,
                        g,
                        ("connections", object([("start", connections.remove(0)), ("end", connections.remove(0))])),
                        ("deflection", deflection_json(&sys, s, range, member_length(index, member))),
                    ]);
                }
            }
            pass.members.insert(member.id.clone(), Json::Obj(fields.into_iter().map(|(k, v)| (k.to_string(), v)).collect()));
        }
        if strength_exceeded {
            reasons.push("strengthExceeded");
        }

        // Modes, mapped from equations to model nodes.
        let mut unstable_nodes: BTreeSet<&str> = BTreeSet::new();
        let mut modes = Vec::new();
        for mode in &outcome.modes {
            let mut shape: Vec<(&str, [f64; 6])> = Vec::new();
            for anode in &sys.anodes {
                if let Some(n) = anode.node {
                    shape.push((model.nodes[n].id.as_str(), anode.eq.map(|e| if e >= 0 { mode.shape[e as usize] } else { 0.0 })));
                }
            }
            let peak = |range: std::ops::Range<usize>| shape.iter().map(|(_, v)| v[range.clone()].iter().map(|x| x * x).sum::<f64>().sqrt()).fold(0.0, f64::max);
            // A spin has no translation worth scaling by, only rounding noise.
            let scale = if mode.kind != "spin" && peak(0..3) > 0.0 { peak(0..3) } else { peak(3..6) };
            // The whole mode, connection variables included, with rotations
            // weighted by the characteristic length so that both are lengths.
            let whole = mode.shape.iter().zip(&sys.eq_rot).map(|(v, rot)| v.abs() * if *rot { sys.lc } else { 1.0 }).fold(0.0, f64::max);
            let node_scale = if mode.kind == "spin" { scale * sys.lc } else { scale };
            // A motion that lives only in connection variables, such as a
            // member spinning about its own axis on ball joints, moves no
            // model node. Scaling its rounding noise up to one would draw a
            // movement that does not exist, so it is reported with no nodes.
            let moves_nodes = node_scale > NODE_PARTICIPATION * whole;
            let mut displacements = Vec::new();
            for (node_id, values) in shape {
                if moves_nodes && values.iter().any(|v| v.abs() > 1e-6 * scale) {
                    if mode.kind != "spin" {
                        unstable_nodes.insert(node_id);
                    }
                    displacements.push((node_id.to_string(), values.map(|v| v / scale).into()));
                }
            }
            if modes.len() < options.max_modes as usize {
                modes.push(object([("kind", mode.kind.into()), ("displacements", Json::Obj(displacements))]));
            }
        }

        let mut applied = [0.0; 3];
        let mut reaction = [0.0; 3];
        for (a, anode) in sys.anodes.iter().enumerate() {
            for i in 0..3 {
                applied[i] += lam * sys.fext[a][i];
                if let (Some(s), true) = (solution, anode.eq[i] == RESTRAINED) {
                    reaction[i] += s.eval.g[a][i] - lam * sys.fext[a][i];
                }
            }
        }
        let has = |code: &str| reasons.iter().any(|r| *r == code);
        let internal = outcome.mechanisms.saturating_sub(outcome.rigid_body_modes);
        let determinacy = sys.force_unknowns as f64 - sys.neq as f64 + (outcome.mechanisms + outcome.spin_modes) as f64;
        pass.reasons.extend(reasons.iter());
        pass.components.push(object([
            ("id", id.as_str().into()),
            ("status", status_name(outcome.status).into()),
            ("resultsValid", solution.is_some().into()),
            ("reasonCodes", strings(reasons.iter().cloned())),
            ("nodeIds", strings(nodes.iter().map(|n| model.nodes[*n].id.as_str()))),
            ("memberIds", strings(members.iter().map(|m| model.members[*m].id.as_str()))),
            (
                "flags",
                object([
                    ("unsupported", has("unsupported").into()),
                    ("mechanism", has("mechanism").into()),
                    ("loadInducedInstability", has("loadInducedInstability").into()),
                    ("nearMechanism", has("nearMechanism").into()),
                    ("excessiveDeformation", has("excessiveDeformation").into()),
                    ("strengthExceeded", strength_exceeded.into()),
                ]),
            ),
            (
                "counts",
                object([
                    ("freeDofs", sys.neq.into()),
                    ("unusedDofs", sys.unused_dofs.into()),
                    ("mechanisms", outcome.mechanisms.into()),
                    ("rigidBodyModes", outcome.rigid_body_modes.into()),
                    ("internalMechanisms", internal.into()),
                    ("spinModes", outcome.spin_modes.into()),
                    ("staticIndeterminacy", determinacy.into()),
                ]),
            ),
            (
                "convergence",
                object([
                    ("converged", outcome.converged.into()),
                    ("iterations", (outcome.iterations as usize).into()),
                    ("loadFractionReached", outcome.load_fraction_reached.into()),
                    ("residual", outcome.residual.into()),
                    ("forceImbalance", outcome.force_imbalance.into()),
                    ("momentImbalance", outcome.moment_imbalance.into()),
                ]),
            ),
            ("criticalLoadFactor", outcome.critical_load_factor.into()),
            ("minPivot", outcome.min_pivot.into()),
            ("maxDisplacement", outcome.max_displacement.into()),
            ("appliedForce", applied.into()),
            ("reactionForce", if solution.is_some() { reaction.into() } else { Json::Null }),
            ("unstableNodeIds", strings(unstable_nodes)),
            ("modes", Json::Arr(modes)),
        ]));
    }
    pass
}

fn note_overload(best: &mut Option<Overload>, check: Option<(f64, &'static str)>, member: usize, end: Option<usize>) {
    if let Some((ratio, limit_state)) = check {
        // Strictly greater: on a tie the first object in id order fails.
        if ratio > 1.0 && best.as_ref().map_or(true, |b| ratio > b.ratio) {
            *best = Some(Overload { ratio, limit_state, member, end });
        }
    }
}

/// Analyse one structure under several load cases.
///
/// Returns `{"cases": [{"id": ..., "result": ...}]}` in request order. Each
/// result is exactly what [`analyze`] gives for the model with that case's
/// loads and options, so a case can be rejected (`invalid`) on its own, for
/// example for a load on an unknown node, while the others are analysed.
///
/// The gain over separate calls is the request: the model is sent, parsed
/// and decoded once. Each case is still solved from scratch; stiffness
/// factorisations are not shared between cases.
pub fn analyze_cases(model: &Model, options: &Options, cases: &[LoadCase]) -> Json {
    let results = cases
        .iter()
        .map(|case| {
            let mut case_model = model.clone();
            if let Some(loads) = &case.loads {
                case_model.loads = loads.clone();
            }
            if let Some(loads) = &case.member_loads {
                case_model.member_loads = loads.clone();
            }
            let mut case_options = options.clone();
            if let Some(factor) = case.load_factor {
                case_options.load_factor = factor;
            }
            if case.gravity.is_some() {
                case_options.gravity = case.gravity;
            }
            if !case.self_weight {
                case_options.gravity = None;
            }
            object([("id", case.id.as_str().into()), ("result", analyze(&case_model, &case_options))])
        })
        .collect();
    object([("cases", Json::Arr(results))])
}

/// Analyse a validated model. Never fails: every outcome is a result.
pub fn analyze(input: &Model, options: &Options) -> Json {
    let issues = validate(input, options);
    if !issues.is_empty() {
        return invalid(input.version.as_deref(), &issues);
    }
    // Work on a copy sorted by id, so the numerical path, and therefore the
    // result, does not depend on the order the caller listed things in.
    let mut model = input.clone();
    model.nodes.sort_by(|a, b| a.id.cmp(&b.id));
    model.members.sort_by(|a, b| a.id.cmp(&b.id));
    model.sections.sort_by(|a, b| a.id.cmp(&b.id));
    model.foundations.sort_by(|a, b| a.id.cmp(&b.id));
    model.loads.sort_by(|a, b| a.id.cmp(&b.id));
    model.member_loads.sort_by(|a, b| a.id.cmp(&b.id));

    let mut failed: BTreeSet<String> = BTreeSet::new();
    let mut events: Vec<Json> = Vec::new();
    let mut iterations = 0;
    let mut event_limit_hit = false;
    let mut remaining = options.max_request_iterations;
    let pass = loop {
        let pass = analyse_once(&Index::new(&model), options, &failed, &mut remaining);
        iterations += pass.iterations;
        let Some(overload) = pass.overload.clone().filter(|_| options.failure == FailureMode::Remove) else { break pass };
        if events.len() >= options.max_failure_events as usize {
            event_limit_hit = true;
            break pass;
        }
        // One deterministic event: the most overloaded object fails.
        let member_id = model.members[overload.member].id.clone();
        let release = overload.end.filter(|_| model.members[overload.member].kind == MemberKind::Beam);
        events.push(object([
            ("sequence", (events.len() + 1).into()),
            ("object", if overload.end.is_some() { "connection" } else { "member" }.into()),
            ("memberId", member_id.as_str().into()),
            ("end", overload.end.map(|e| if e == 0 { "start" } else { "end" }).into()),
            ("limitState", overload.limit_state.into()),
            ("utilization", overload.ratio.into()),
            ("action", if release.is_some() { "connectionReleased" } else { "memberRemoved" }.into()),
        ]));
        match release {
            Some(end) => {
                let member = &mut model.members[overload.member];
                let connection = if end == 0 { &mut member.start } else { &mut member.end };
                connection.laws = [Law::Free; 6];
                connection.capacity = None;
            }
            None => {
                model.members.remove(overload.member);
                failed.insert(member_id);
            }
        }
    };

    let mut reasons = pass.reasons;
    if event_limit_hit {
        reasons.insert("failureEventLimit");
    }
    let to_object = |map: BTreeMap<String, Json>| Json::Obj(map.into_iter().collect());
    object([
        (
            "analysis",
            object([
                ("solverVersion", SOLVER_VERSION.into()),
                ("modelVersion", input.version.clone().into()),
                ("units", "SI".into()),
                ("status", "ok".into()),
                ("fidelity", if options.fidelity == Fidelity::Linear { "linear" } else { "nonlinear" }.into()),
                ("loadFactor", options.load_factor.into()),
                ("iterations", (iterations as usize).into()),
                ("reasonCodes", strings(reasons)),
                ("diagnostics", Json::Arr(Vec::new())),
            ]),
        ),
        ("components", Json::Arr(pass.components)),
        ("nodes", to_object(pass.nodes)),
        ("members", to_object(pass.members)),
        ("foundations", to_object(pass.foundations)),
        ("failureEvents", Json::Arr(events)),
    ])
}
