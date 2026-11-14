//! Structural reference solver for Degrees of Freedom.
//!
//! The solver evaluates physics only. It receives an immutable analytical
//! model and analysis options and returns a result document; it knows nothing
//! about cards, players, turns or scoring.
//!
//! * [`model`] defines the input and its unit, axis and sign conventions.
//! * [`report`] runs the analysis and defines the result conventions.
//! * [`solve`] holds the stability classification and equilibrium solution of
//!   one structural component; [`system`] and [`element`] the discretisation.
//!
//! The same code builds natively (for tests) and to WebAssembly. The
//! WebAssembly module has no imports: the host passes a JSON request in
//! linear memory and reads a JSON result back; see [`dof_analyze`].

pub mod ad;
pub mod element;
pub mod json;
pub mod math;
pub mod model;
pub mod report;
pub mod request;
pub mod skyline;
pub mod solve;
pub mod system;

use json::Json;

/// Analyse a model and return the result document.
pub fn analyze(model: &model::Model, options: &model::Options) -> Json {
    report::analyze(model, options)
}

fn reject(code: &'static str, message: String) -> String {
    report::invalid(None, &[model::Issue { code, message, ids: Vec::new() }]).to_json_string()
}

fn analyze_request(request: &str) -> String {
    match request::parse_request(request) {
        Ok((model, options)) => analyze(&model, &options).to_json_string(),
        Err(message) => reject("invalidInput", message),
    }
}

/// Analyse a JSON request `{"model": ..., "options": ...}` and return the
/// result as JSON. Malformed input gives a result with status `invalid`.
///
/// Natively a panic inside the solver is caught and reported as an
/// `internalError` result. WebAssembly aborts on panic instead, which the host
/// sees as a trap; the host adapter turns that into the same kind of result.
pub fn analyze_json(request: &str) -> String {
    #[cfg(not(target_arch = "wasm32"))]
    {
        std::panic::catch_unwind(|| analyze_request(request))
            .unwrap_or_else(|_| reject("internalError", "The solver failed unexpectedly.".into()))
    }
    #[cfg(target_arch = "wasm32")]
    {
        analyze_request(request)
    }
}

/// Allocate `len` bytes in the module's memory for the host to write into.
#[no_mangle]
pub extern "C" fn dof_alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}

/// Free a buffer obtained from [`dof_alloc`] or [`dof_analyze`].
///
/// # Safety
/// `ptr` and `len` must describe exactly one such buffer, freed once.
#[no_mangle]
pub unsafe extern "C" fn dof_free(ptr: *mut u8, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}

/// Analyse the UTF-8 JSON request at `ptr`/`len`.
///
/// Returns a buffer holding the result length as a little-endian `u32`
/// followed by that many bytes of UTF-8 JSON. The host frees it with
/// [`dof_free`], passing the length plus four.
///
/// # Safety
/// `ptr` and `len` must describe readable memory.
#[no_mangle]
pub unsafe extern "C" fn dof_analyze(ptr: *const u8, len: usize) -> *mut u8 {
    let bytes = std::slice::from_raw_parts(ptr, len);
    let result = match std::str::from_utf8(bytes) {
        Ok(text) => analyze_json(text),
        Err(_) => reject("invalidInput", "The request is not valid UTF-8.".into()),
    };
    let mut out = Vec::with_capacity(result.len() + 4);
    out.extend_from_slice(&(result.len() as u32).to_le_bytes());
    out.extend_from_slice(result.as_bytes());
    Box::into_raw(out.into_boxed_slice()) as *mut u8
}
