//! Model builder and result accessors shared by the acceptance tests.
#![allow(dead_code)]

use dof_solver::json::Json;
use dof_solver::model::*;

/// Steel 200 x 200 x 10 mm square hollow section, the same properties the
/// OpenSees service uses, so results can be compared between backends.
pub const E: f64 = 210e9;
pub const G: f64 = 81e9;
pub const A: f64 = 7.49e-3;
pub const I: f64 = 4.47e-5;
pub const J: f64 = 7.03e-5;

pub const FIXED: [bool; 6] = [true; 6];
pub const PINNED: [bool; 6] = [true, true, true, false, false, false];
/// Ball joint: all three rotations released.
pub const BALL: [Law; 6] = [Law::Rigid, Law::Rigid, Law::Rigid, Law::Free, Law::Free, Law::Free];
/// Bending released, torsion held.
pub const HINGE: [Law; 6] = [Law::Rigid, Law::Rigid, Law::Rigid, Law::Rigid, Law::Free, Law::Free];

pub fn steel(id: &str) -> Section {
    Section { id: id.into(), e: E, g: G, a: A, iy: I, iz: I, j: J, shear_area_y: None, shear_area_z: None, density: 0.0, capacity: None }
}

#[derive(Clone)]
pub struct Build {
    pub model: Model,
    pub options: Options,
}

impl Build {
    pub fn new() -> Self {
        let mut model = Model::default();
        model.sections.push(steel("s"));
        Self { model, options: Options::default() }
    }
    pub fn linear() -> Self {
        let mut b = Self::new();
        b.options.fidelity = Fidelity::Linear;
        b
    }
    pub fn node(&mut self, id: &str, position: [f64; 3]) -> &mut Self {
        self.model.nodes.push(Node { id: id.into(), position });
        self
    }
    pub fn member(&mut self, id: &str, kind: MemberKind, a: &str, b: &str) -> &mut Member {
        self.model.members.push(Member {
            id: id.into(),
            kind,
            start_node_id: a.into(),
            end_node_id: b.into(),
            section_id: "s".into(),
            orientation: None,
            start: Connection::default(),
            end: Connection::default(),
            rest_length: None,
            initial_strain: None,
            parent_id: None,
            subdivisions: None,
        });
        self.model.members.last_mut().unwrap()
    }
    pub fn beam(&mut self, id: &str, a: &str, b: &str) -> &mut Member {
        self.member(id, MemberKind::Beam, a, b)
    }
    pub fn brace(&mut self, id: &str, a: &str, b: &str) -> &mut Member {
        self.member(id, MemberKind::Brace, a, b)
    }
    pub fn cable(&mut self, id: &str, a: &str, b: &str) -> &mut Member {
        self.member(id, MemberKind::Cable, a, b)
    }
    pub fn support(&mut self, node: &str, restrained: [bool; 6]) -> &mut Self {
        self.model.foundations.push(Foundation { id: format!("f-{node}"), node_id: node.into(), restrained });
        self
    }
    pub fn load(&mut self, node: &str, force: [f64; 3]) -> &mut Self {
        let id = format!("l{}", self.model.loads.len());
        self.model.loads.push(Load { id, node_id: node.into(), force, moment: [0.0; 3] });
        self
    }
    pub fn moment(&mut self, node: &str, moment: [f64; 3]) -> &mut Self {
        let id = format!("l{}", self.model.loads.len());
        self.model.loads.push(Load { id, node_id: node.into(), force: [0.0; 3], moment });
        self
    }
    pub fn run(&self) -> Run {
        Run(dof_solver::analyze(&self.model, &self.options))
    }
}

pub struct Run(pub Json);

fn six(value: &Json) -> [f64; 6] {
    let items = value.as_array().unwrap_or_else(|| panic!("expected six numbers, got {value:?}"));
    std::array::from_fn(|i| items[i].as_f64().unwrap())
}

impl Run {
    pub fn at(&self, path: &[&str]) -> &Json {
        path.iter().fold(&self.0, |v, key| v.get(key).unwrap_or_else(|| panic!("no field {key} in {}", v.to_json_string())))
    }
    pub fn component(&self, index: usize) -> &Json {
        &self.at(&["components"]).as_array().unwrap()[index]
    }
    pub fn components(&self) -> usize {
        self.at(&["components"]).as_array().unwrap().len()
    }
    /// Component that contains the given node.
    pub fn component_of(&self, node: &str) -> &Json {
        let id = self.at(&["nodes", node, "componentId"]).as_str().unwrap();
        self.at(&["components"]).as_array().unwrap().iter().find(|c| c.get("id").unwrap().as_str() == Some(id)).unwrap()
    }
    pub fn status(&self, index: usize) -> &str {
        self.component(index).get("status").unwrap().as_str().unwrap()
    }
    pub fn reasons(&self, index: usize) -> Vec<&str> {
        self.component(index).get("reasonCodes").unwrap().as_array().unwrap().iter().map(|r| r.as_str().unwrap()).collect()
    }
    pub fn count(&self, index: usize, name: &str) -> f64 {
        self.component(index).get("counts").unwrap().get(name).unwrap().as_f64().unwrap()
    }
    pub fn number(&self, index: usize, name: &str) -> f64 {
        self.component(index).get(name).unwrap().as_f64().unwrap_or_else(|| panic!("{name} is not a number"))
    }
    pub fn displacement(&self, node: &str) -> [f64; 6] {
        six(self.at(&["nodes", node, "displacement"]))
    }
    pub fn reaction(&self, node: &str) -> [f64; 6] {
        six(self.at(&["foundations", &format!("f-{node}"), "reaction"]))
    }
    pub fn forces(&self, member: &str, end: &str) -> [f64; 6] {
        six(self.at(&["members", member, "forces", end]))
    }
    pub fn member(&self, member: &str, field: &str) -> &Json {
        self.at(&["members", member, field])
    }
    pub fn residual(&self, index: usize) -> f64 {
        self.component(index).get("convergence").unwrap().get("residual").unwrap().as_f64().unwrap()
    }
}

/// Assert `actual` matches a non-zero `expected` to a relative tolerance.
#[track_caller]
pub fn close(actual: f64, expected: f64, relative: f64) {
    assert!((actual - expected).abs() <= relative * expected.abs(), "expected {expected}, got {actual} (relative error {:e})", (actual - expected).abs() / expected.abs());
}

/// Assert an expected zero is zero relative to a characteristic `scale`.
#[track_caller]
pub fn zero(actual: f64, scale: f64) {
    assert!(actual.abs() <= 1e-9 * scale.abs(), "expected zero (scale {scale}), got {actual}");
}
