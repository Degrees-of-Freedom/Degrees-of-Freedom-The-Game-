//! Strength checks and the optional failure sequence (criteria section 4 and
//! the overload and redundant-member acceptance row).

mod common;
use common::*;
use dof_solver::model::*;

fn capacity() -> SectionCapacity {
    SectionCapacity::default()
}

/// Demand over capacity, the governing limit state, and the fact that
/// strength exceedance is reported separately from instability.
#[test]
fn overloaded_member_reports_its_governing_limit_state() {
    let (l, p) = (3.0, 1.0e3);
    let mut b = Build::linear();
    b.model.sections[0].capacity = Some(SectionCapacity { moment_y: Some(0.5 * p * l), shear: Some(4.0 * p), ..capacity() });
    b.node("a", [0.0; 3]).node("b", [l, 0.0, 0.0]);
    b.beam("m", "a", "b");
    b.support("a", FIXED).load("b", [0.0, 0.0, -p]);
    let r = b.run();
    // Overstressed, but still a stable equilibrium with valid results.
    assert_eq!(r.status(0), "stable");
    assert!(r.reasons(0).contains(&"strengthExceeded"));
    assert_eq!(r.component(0).get("flags").unwrap().get("strengthExceeded").unwrap().as_bool(), Some(true));
    close(r.member("m", "utilization").as_f64().unwrap(), 2.0, 1e-9);
    assert_eq!(r.member("m", "governingLimitState").as_str(), Some("bending"));
    assert!(r.at(&["failureEvents"]).as_array().unwrap().is_empty());

    // Shear governs once the bending capacity is generous.
    b.model.sections[0].capacity = Some(SectionCapacity { moment_y: Some(10.0 * p * l), shear: Some(0.8 * p), ..capacity() });
    let r = b.run();
    close(r.member("m", "utilization").as_f64().unwrap(), 1.25, 1e-9);
    assert_eq!(r.member("m", "governingLimitState").as_str(), Some("shear"));

    // No capacity given: utilisation is unavailable, not zero.
    b.model.sections[0].capacity = None;
    assert_eq!(b.run().member("m", "utilization"), &dof_solver::json::Json::Null);
}

/// Axial force and bending combine linearly: N/Nc + M/Mc.
#[test]
fn axial_and_bending_interact() {
    let (l, n, h) = (2.0, 8.0e4, 3.0e3);
    let mut b = Build::linear();
    b.model.sections[0].capacity = Some(SectionCapacity { compression: Some(4.0e5), tension: Some(8.0e5), moment_y: Some(2.4e4), moment_z: Some(2.4e4), ..capacity() });
    b.node("a", [0.0; 3]).node("b", [0.0, 0.0, l]);
    b.beam("m", "a", "b");
    b.support("a", FIXED).load("b", [h, 0.0, -n]);
    let r = b.run();
    close(r.member("m", "utilization").as_f64().unwrap(), n / 4.0e5 + h * l / 2.4e4, 1e-9);
    assert_eq!(r.member("m", "governingLimitState").as_str(), Some("axialBending"));

    b.model.loads.clear();
    b.load("b", [0.0, 0.0, n]);
    let r = b.run();
    close(r.member("m", "utilization").as_f64().unwrap(), n / 8.0e5, 1e-9);
    assert_eq!(r.member("m", "governingLimitState").as_str(), Some("tension"));
}

#[test]
fn overloaded_connection_is_reported_on_its_end() {
    let (l, p) = (3.0, 1.0e3);
    let mut b = Build::linear();
    b.node("a", [0.0; 3]).node("b", [l, 0.0, 0.0]);
    b.beam("m", "a", "b").start.capacity = Some(ConnectionCapacity { moment: Some(p * l / 1.6), shear: Some(10.0 * p), axial: None });
    b.support("a", FIXED).load("b", [0.0, 0.0, -p]);
    let r = b.run();
    close(r.at(&["members", "m", "connections", "start", "utilization"]).as_f64().unwrap(), 1.6, 1e-9);
    assert_eq!(r.at(&["members", "m", "connections", "start", "governingLimitState"]).as_str(), Some("connectionMoment"));
    assert_eq!(r.at(&["members", "m", "connections", "end", "utilization"]), &dof_solver::json::Json::Null);
    assert!(r.reasons(0).contains(&"strengthExceeded"));

    // With failure enabled the connection is released, and the cantilever,
    // now attached to nothing that holds moment, becomes a mechanism.
    b.options.failure = FailureMode::Remove;
    let r = b.run();
    let events = r.at(&["failureEvents"]).as_array().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].get("object").unwrap().as_str(), Some("connection"));
    assert_eq!(events[0].get("action").unwrap().as_str(), Some("connectionReleased"));
    assert_eq!(r.component_of("b").get("status").unwrap().as_str(), Some("unstable"));
}

/// Three hangers of different stiffness share one load.
fn hangers(capacities: [f64; 3]) -> Build {
    let mut b = Build::linear();
    b.node("load", [0.0; 3]);
    for (i, limit) in capacities.into_iter().enumerate() {
        let mut section = steel(&format!("h{i}"));
        section.a = A * (i + 1) as f64;
        section.capacity = Some(SectionCapacity { tension: Some(limit), ..capacity() });
        b.model.sections.push(section);
        b.node(&format!("top{i}"), [0.0, 0.0, 2.0 + 1e-9 * i as f64]);
        b.brace(&format!("hanger{i}"), "load", &format!("top{i}")).section_id = format!("h{i}");
        b.support(&format!("top{i}"), PINNED);
    }
    b.support("load", [true, true, false, false, false, false]);
    b
}

/// Removing an overloaded redundant member redistributes its load to the
/// others by stiffness, in a fixed and repeatable order.
#[test]
fn redundant_member_removal_redistributes_deterministically() {
    let p = 6.0e4;
    let mut b = hangers([2.0 * p, 2.0 * p, 0.4 * p]);
    b.load("load", [0.0, 0.0, -p]);

    // Reporting only: the stiffest hanger attracts half the load.
    let r = b.run();
    close(r.forces("hanger2", "start")[0], p / 2.0, 1e-8);
    close(r.member("hanger2", "utilization").as_f64().unwrap(), 1.25, 1e-8);
    assert!(r.at(&["failureEvents"]).as_array().unwrap().is_empty());

    b.options.failure = FailureMode::Remove;
    let r = b.run();
    let events = r.at(&["failureEvents"]).as_array().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].get("memberId").unwrap().as_str(), Some("hanger2"));
    assert_eq!(events[0].get("limitState").unwrap().as_str(), Some("tension"));
    close(events[0].get("utilization").unwrap().as_f64().unwrap(), 1.25, 1e-8);
    assert_eq!(r.member("hanger2", "state").as_str(), Some("failed"));
    assert_eq!(r.member("hanger2", "forces"), &dof_solver::json::Json::Null);
    assert_eq!(r.status(0), "stable");
    close(r.forces("hanger0", "start")[0], p / 3.0, 1e-8);
    close(r.forces("hanger1", "start")[0], 2.0 * p / 3.0, 1e-8);
    close(r.reaction("top0")[2] + r.reaction("top1")[2], p, 1e-8);
    assert_eq!(b.run().0.to_json_string(), r.0.to_json_string());

    // A cascade: each failure overloads the next, until nothing holds the
    // load. The order is by utilisation, and the end state is unstable.
    let mut b = hangers([0.9 * p, 0.6 * p, 0.4 * p]);
    b.load("load", [0.0, 0.0, -p]);
    b.options.failure = FailureMode::Remove;
    let r = b.run();
    let order: Vec<&str> = r.at(&["failureEvents"]).as_array().unwrap().iter().map(|e| e.get("memberId").unwrap().as_str().unwrap()).collect();
    assert_eq!(order, ["hanger2", "hanger1", "hanger0"]);
    assert_eq!(r.status(0), "unstable");
    assert_eq!(r.at(&["nodes", "load", "displacement"]), &dof_solver::json::Json::Null);

    // The event limit stops the sequence and says so.
    b.options.max_failure_events = 1;
    let r = b.run();
    assert_eq!(r.at(&["failureEvents"]).as_array().unwrap().len(), 1);
    let codes: Vec<&str> = r.at(&["analysis", "reasonCodes"]).as_array().unwrap().iter().map(|c| c.as_str().unwrap()).collect();
    assert!(codes.contains(&"failureEventLimit"));
}

/// Equally overloaded members fail in id order, one per event.
#[test]
fn ties_break_by_id() {
    let p = 1.0e4;
    let mut b = Build::linear();
    b.options.failure = FailureMode::Remove;
    b.model.sections[0].capacity = Some(SectionCapacity { tension: Some(0.4 * p), ..capacity() });
    b.node("load", [0.0; 3]);
    for name in ["zeta", "alpha"] {
        b.node(&format!("top-{name}"), [0.0, 0.0, 2.0]);
        b.brace(name, "load", &format!("top-{name}"));
        b.support(&format!("top-{name}"), PINNED);
    }
    b.support("load", [true, true, false, false, false, false]).load("load", [0.0, 0.0, -p]);
    let r = b.run();
    let events = r.at(&["failureEvents"]).as_array().unwrap();
    assert_eq!(events[0].get("memberId").unwrap().as_str(), Some("alpha"));
    assert_eq!(events[1].get("memberId").unwrap().as_str(), Some("zeta"));
}
