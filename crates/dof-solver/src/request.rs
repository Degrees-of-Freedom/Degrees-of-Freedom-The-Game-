//! JSON request parsing.
//!
//! Unknown fields are rejected, so a caller cannot believe a feature was
//! analysed when the solver never read it.

use crate::json::Json;
use crate::model::*;

type Parsed<T> = Result<T, String>;

struct Fields<'a> {
    path: String,
    fields: &'a [(String, Json)],
    used: Vec<bool>,
}

impl<'a> Fields<'a> {
    fn new(value: &'a Json, path: &str) -> Parsed<Self> {
        match value {
            Json::Obj(fields) => Ok(Self { path: path.to_string(), fields, used: vec![false; fields.len()] }),
            _ => Err(format!("{path} must be an object.")),
        }
    }
    /// Field value, treating an explicit `null` as absent.
    fn opt(&mut self, key: &str) -> Option<&'a Json> {
        let index = self.fields.iter().position(|(k, _)| k == key)?;
        self.used[index] = true;
        match &self.fields[index].1 {
            Json::Null => None,
            value => Some(value),
        }
    }
    fn req(&mut self, key: &str) -> Parsed<&'a Json> {
        let path = self.at(key);
        self.opt(key).ok_or(format!("{path} is required."))
    }
    fn at(&self, key: &str) -> String {
        format!("{}.{key}", self.path)
    }
    fn done(self) -> Parsed<()> {
        match self.used.iter().position(|u| !u) {
            Some(index) => Err(format!("{} has an unknown field \"{}\".", self.path, self.fields[index].0)),
            None => Ok(()),
        }
    }
    fn num(&mut self, key: &str) -> Parsed<Option<f64>> {
        let path = self.at(key);
        self.opt(key).map(|v| v.as_f64().ok_or(format!("{path} must be a number."))).transpose()
    }
    fn req_num(&mut self, key: &str) -> Parsed<f64> {
        let path = self.at(key);
        self.num(key)?.ok_or(format!("{path} is required."))
    }
    fn num_or(&mut self, key: &str, default: f64) -> Parsed<f64> {
        Ok(self.num(key)?.unwrap_or(default))
    }
    fn count(&mut self, key: &str) -> Parsed<Option<u32>> {
        let path = self.at(key);
        match self.num(key)? {
            None => Ok(None),
            Some(v) if (0.0..=1e9).contains(&v) && v.fract() == 0.0 => Ok(Some(v as u32)),
            Some(_) => Err(format!("{path} must be a non-negative whole number.")),
        }
    }
    fn flag_or(&mut self, key: &str, default: bool) -> Parsed<bool> {
        let path = self.at(key);
        match self.opt(key) {
            None => Ok(default),
            Some(v) => v.as_bool().ok_or(format!("{path} must be a boolean.")),
        }
    }
    fn text(&mut self, key: &str) -> Parsed<Option<String>> {
        let path = self.at(key);
        self.opt(key).map(|v| v.as_str().map(str::to_string).ok_or(format!("{path} must be a string."))).transpose()
    }
    fn req_text(&mut self, key: &str) -> Parsed<String> {
        let path = self.at(key);
        self.text(key)?.ok_or(format!("{path} is required."))
    }
    fn vec3(&mut self, key: &str) -> Parsed<Option<Vec3>> {
        let path = self.at(key);
        self.opt(key).map(|v| numbers::<3>(v, &path)).transpose()
    }
    fn list<T>(&mut self, key: &str, parse: impl Fn(&'a Json, &str) -> Parsed<T>) -> Parsed<Vec<T>> {
        let path = self.at(key);
        let Some(value) = self.opt(key) else {
            return Ok(Vec::new());
        };
        let items = value.as_array().ok_or(format!("{path} must be an array."))?;
        items.iter().enumerate().map(|(i, item)| parse(item, &format!("{path}[{i}]"))).collect()
    }
}

fn numbers<const N: usize>(value: &Json, path: &str) -> Parsed<[f64; N]> {
    let error = || format!("{path} must be an array of {N} numbers.");
    let items = value.as_array().filter(|a| a.len() == N).ok_or_else(error)?;
    let mut out = [0.0; N];
    for (slot, item) in out.iter_mut().zip(items) {
        *slot = item.as_f64().ok_or_else(error)?;
    }
    Ok(out)
}

fn parse_law(value: &Json, path: &str) -> Parsed<Law> {
    match value {
        Json::Str(s) if s == "rigid" => Ok(Law::Rigid),
        Json::Str(s) if s == "free" => Ok(Law::Free),
        Json::Obj(fields) if fields.len() == 1 && fields[0].0 == "elastic" => {
            fields[0].1.as_f64().map(Law::Elastic).ok_or(format!("{path}.elastic must be a number."))
        }
        _ => Err(format!("{path} must be \"rigid\", \"free\" or {{\"elastic\": stiffness}}.")),
    }
}

fn parse_connection(value: Option<&Json>, path: &str) -> Parsed<Connection> {
    let Some(value) = value else {
        return Ok(Connection::default());
    };
    let mut f = Fields::new(value, path)?;
    let mut connection = Connection::default();
    if let Some(laws) = f.opt("laws") {
        let items = laws.as_array().filter(|a| a.len() == 6).ok_or(format!("{path}.laws must be an array of 6 laws."))?;
        for (i, item) in items.iter().enumerate() {
            connection.laws[i] = parse_law(item, &format!("{path}.laws[{i}]"))?;
        }
    }
    if let Some(capacity) = f.opt("capacity") {
        let mut c = Fields::new(capacity, &format!("{path}.capacity"))?;
        connection.capacity = Some(ConnectionCapacity { axial: c.num("axial")?, shear: c.num("shear")?, moment: c.num("moment")? });
        c.done()?;
    }
    f.done()?;
    Ok(connection)
}

fn parse_section(value: &Json, path: &str) -> Parsed<Section> {
    let mut f = Fields::new(value, path)?;
    let mut section = Section {
        id: f.req_text("id")?,
        e: f.req_num("E")?,
        g: f.num_or("G", 0.0)?,
        a: f.req_num("A")?,
        iy: f.num_or("Iy", 0.0)?,
        iz: f.num_or("Iz", 0.0)?,
        j: f.num_or("J", 0.0)?,
        shear_area_y: f.num("shearAreaY")?,
        shear_area_z: f.num("shearAreaZ")?,
        density: f.num_or("density", 0.0)?,
        capacity: None,
    };
    if let Some(capacity) = f.opt("capacity") {
        let mut c = Fields::new(capacity, &format!("{path}.capacity"))?;
        section.capacity = Some(SectionCapacity {
            tension: c.num("tension")?,
            compression: c.num("compression")?,
            shear: c.num("shear")?,
            torsion: c.num("torsion")?,
            moment_y: c.num("momentY")?,
            moment_z: c.num("momentZ")?,
        });
        c.done()?;
    }
    f.done()?;
    Ok(section)
}

fn parse_member(value: &Json, path: &str) -> Parsed<Member> {
    let mut f = Fields::new(value, path)?;
    let kind = match f.text("kind")?.as_deref() {
        None | Some("beam") => MemberKind::Beam,
        Some("brace") => MemberKind::Brace,
        Some("cable") => MemberKind::Cable,
        Some(other) => return Err(format!("{path}.kind \"{other}\" is not beam, brace or cable.")),
    };
    let member = Member {
        id: f.req_text("id")?,
        kind,
        start_node_id: f.req_text("startNodeId")?,
        end_node_id: f.req_text("endNodeId")?,
        section_id: f.req_text("sectionId")?,
        orientation: f.vec3("orientation")?,
        start: parse_connection(f.opt("start"), &format!("{path}.start"))?,
        end: parse_connection(f.opt("end"), &format!("{path}.end"))?,
        rest_length: f.num("restLength")?,
        initial_strain: f.num("initialStrain")?,
        parent_id: f.text("parentId")?,
        subdivisions: f.count("subdivisions")?,
    };
    f.done()?;
    Ok(member)
}

fn parse_node(value: &Json, path: &str) -> Parsed<Node> {
    let mut f = Fields::new(value, path)?;
    let node = Node { id: f.req_text("id")?, position: numbers::<3>(f.req("position")?, &format!("{path}.position"))? };
    f.done()?;
    Ok(node)
}

fn parse_foundation(value: &Json, path: &str) -> Parsed<Foundation> {
    let mut f = Fields::new(value, path)?;
    let error = format!("{path}.restrained must be an array of 6 booleans.");
    let flags = f.req("restrained")?.as_array().filter(|a| a.len() == 6).ok_or(error.clone())?;
    let mut restrained = [false; 6];
    for (slot, flag) in restrained.iter_mut().zip(flags) {
        *slot = flag.as_bool().ok_or(error.clone())?;
    }
    let foundation = Foundation { id: f.req_text("id")?, node_id: f.req_text("nodeId")?, restrained };
    f.done()?;
    Ok(foundation)
}

fn parse_load(value: &Json, path: &str) -> Parsed<Load> {
    let mut f = Fields::new(value, path)?;
    let load = Load {
        id: f.req_text("id")?,
        node_id: f.req_text("nodeId")?,
        force: f.vec3("force")?.unwrap_or_default(),
        moment: f.vec3("moment")?.unwrap_or_default(),
    };
    f.done()?;
    Ok(load)
}

fn parse_model(value: &Json) -> Parsed<Model> {
    let mut f = Fields::new(value, "model")?;
    let model = Model {
        version: f.text("version")?,
        nodes: f.list("nodes", parse_node)?,
        sections: f.list("sections", parse_section)?,
        members: f.list("members", parse_member)?,
        foundations: f.list("foundations", parse_foundation)?,
        loads: f.list("loads", parse_load)?,
    };
    f.done()?;
    Ok(model)
}

fn parse_options(value: Option<&Json>) -> Parsed<Options> {
    let d = Options::default();
    let Some(value) = value else {
        return Ok(d);
    };
    let mut f = Fields::new(value, "options")?;
    let options = Options {
        fidelity: match f.text("fidelity")?.as_deref() {
            None | Some("nonlinear") => Fidelity::Nonlinear,
            Some("linear") => Fidelity::Linear,
            Some(other) => return Err(format!("options.fidelity \"{other}\" is not linear or nonlinear.")),
        },
        gravity: f.vec3("gravity")?,
        load_factor: f.num_or("loadFactor", d.load_factor)?,
        subdivisions: f.count("subdivisions")?.unwrap_or(d.subdivisions),
        tolerance: f.num_or("tolerance", d.tolerance)?,
        residual_gate: f.num_or("residualGate", d.residual_gate)?,
        max_iterations: f.count("maxIterations")?.unwrap_or(d.max_iterations),
        max_total_iterations: f.count("maxTotalIterations")?.unwrap_or(d.max_total_iterations),
        excessive_displacement_ratio: f.num_or("excessiveDisplacementRatio", d.excessive_displacement_ratio)?,
        critical_load_search: f.flag_or("criticalLoadSearch", d.critical_load_search)?,
        stability_margin: f.num_or("stabilityMargin", d.stability_margin)?,
        failure: match f.text("failure")?.as_deref() {
            None | Some("report") => FailureMode::Report,
            Some("remove") => FailureMode::Remove,
            Some(other) => return Err(format!("options.failure \"{other}\" is not report or remove.")),
        },
        max_failure_events: f.count("maxFailureEvents")?.unwrap_or(d.max_failure_events),
        max_modes: f.count("maxModes")?.unwrap_or(d.max_modes),
    };
    f.done()?;
    Ok(options)
}

/// Parse a request of the form `{"model": {...}, "options": {...}}`.
pub fn parse_request(text: &str) -> Result<(Model, Options), String> {
    let document = crate::json::parse(text)?;
    let mut f = Fields::new(&document, "request")?;
    let model = parse_model(f.req("model")?)?;
    let options = parse_options(f.opt("options"))?;
    f.done()?;
    Ok((model, options))
}
