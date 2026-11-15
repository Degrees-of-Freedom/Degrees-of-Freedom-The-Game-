//! Several load cases in one request.
//!
//! A multi-case request must give, for every case, exactly the result of a
//! separate single-case request with that case's loads and options.

use dof_solver::analyze_json;
use dof_solver::json::{parse, Json};

/// A pinned-base portal of one steel section, as request JSON without loads.
const MODEL: &str = r#"{
  "version": "portal-1",
  "nodes": [
    {"id": "a", "position": [0, 0, 0]}, {"id": "b", "position": [0, 0, 3]},
    {"id": "c", "position": [4, 0, 3]}, {"id": "d", "position": [4, 0, 0]}
  ],
  "sections": [{"id": "s", "E": 210e9, "G": 81e9, "A": 7.49e-3, "Iy": 4.47e-5, "Iz": 4.47e-5, "J": 7.03e-5, "density": 7850}],
  "members": [
    {"id": "left", "startNodeId": "a", "endNodeId": "b", "sectionId": "s"},
    {"id": "top", "startNodeId": "b", "endNodeId": "c", "sectionId": "s"},
    {"id": "right", "startNodeId": "c", "endNodeId": "d", "sectionId": "s"}
  ],
  "foundations": [
    {"id": "fa", "nodeId": "a", "restrained": [true, true, true, true, true, true]},
    {"id": "fd", "nodeId": "d", "restrained": [true, true, true, true, true, true]}
  ],
  "loads": LOADS
}"#;

const GRAVITY: &str = r#"{"fidelity": "linear", "gravity": [0, 0, -9.81]}"#;
const WIND: &str = r#"[{"id": "w", "nodeId": "b", "force": [5000, 0, 0]}]"#;
const PAYLOAD: &str = r#"[{"id": "p", "nodeId": "c", "force": [0, 0, -20000]}]"#;

fn model(loads: &str) -> String {
    MODEL.replace("LOADS", loads)
}

fn single(loads: &str, options: &str) -> String {
    analyze_json(&format!(r#"{{"model": {}, "options": {options}}}"#, model(loads)))
}

fn multi(cases: &str) -> Json {
    parse(&analyze_json(&format!(r#"{{"model": {}, "options": {GRAVITY}, "cases": {cases}}}"#, model(PAYLOAD)))).unwrap()
}

fn case_results(document: &Json) -> Vec<(String, String)> {
    let cases = document.get("cases").unwrap_or_else(|| panic!("no cases in {}", document.to_json_string())).as_array().unwrap();
    cases.iter().map(|c| (c.get("id").unwrap().as_str().unwrap().to_string(), c.get("result").unwrap().to_json_string())).collect()
}

/// Each case equals the separate analysis, character for character.
#[test]
fn each_case_matches_a_separate_call() {
    let document = multi(&format!(
        r#"[
          {{"id": "payload"}},
          {{"id": "wind", "loads": {WIND}}},
          {{"id": "factored", "loadFactor": 1.35}},
          {{"id": "bare", "loads": {WIND}, "selfWeight": false}},
          {{"id": "heavy", "gravity": [0, 0, -13.24]}}
        ]"#
    ));
    let results = case_results(&document);
    let expected = [
        ("payload", single(PAYLOAD, GRAVITY)),
        ("wind", single(WIND, GRAVITY)),
        ("factored", single(PAYLOAD, r#"{"fidelity": "linear", "gravity": [0, 0, -9.81], "loadFactor": 1.35}"#)),
        ("bare", single(WIND, r#"{"fidelity": "linear"}"#)),
        ("heavy", single(PAYLOAD, r#"{"fidelity": "linear", "gravity": [0, 0, -13.24]}"#)),
    ];
    assert_eq!(results.len(), expected.len());
    for ((id, text), (expected_id, expected_text)) in results.iter().zip(&expected) {
        assert_eq!(id, expected_id);
        // Round-trip the separate result through the parser so both texts
        // come from the same serialiser.
        assert_eq!(text, &parse(expected_text).unwrap().to_json_string(), "case {id}");
    }
    // The cases are different analyses, not one result repeated.
    assert_ne!(results[0].1, results[1].1);
}

/// A case that cannot be analysed is rejected on its own.
#[test]
fn an_invalid_case_does_not_spoil_the_others() {
    let document = multi(r#"[{"id": "ok"}, {"id": "stray", "loads": [{"id": "x", "nodeId": "nowhere", "force": [0, 0, -1]}]}]"#);
    let cases = document.get("cases").unwrap().as_array().unwrap();
    let status = |i: usize| cases[i].get("result").unwrap().get("analysis").unwrap().get("status").unwrap().as_str().unwrap().to_string();
    assert_eq!(status(0), "ok");
    assert_eq!(status(1), "invalid");
}

/// Malformed case lists are rejected as a whole, as a single invalid result.
#[test]
fn malformed_case_lists_are_rejected() {
    for cases in [r#"[]"#, r#"[{"id": "a"}, {"id": "a"}]"#, r#"[{"id": "a", "typo": 1}]"#, r#"[{"loads": []}]"#, r#"{"id": "a"}"#] {
        let document = multi(cases);
        let analysis = document.get("analysis").unwrap_or_else(|| panic!("{cases} was not rejected"));
        assert_eq!(analysis.get("status").unwrap().as_str(), Some("invalid"), "{cases}");
    }
    let too_many = format!("[{}]", (0..101).map(|i| format!(r#"{{"id": "c{i}"}}"#)).collect::<Vec<_>>().join(","));
    assert!(multi(&too_many).get("analysis").is_some());
}

/// An empty `loads` list is a case with self-weight only, not the model loads.
#[test]
fn empty_case_loads_replace_the_model_loads() {
    let document = multi(r#"[{"id": "own-weight", "loads": []}]"#);
    assert_eq!(case_results(&document)[0].1, parse(&single("[]", GRAVITY)).unwrap().to_json_string());
}
