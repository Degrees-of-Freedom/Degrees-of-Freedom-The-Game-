//! Minimal JSON reader and writer.
//!
//! The solver exchanges JSON with its host. This module keeps the crate free
//! of third-party dependencies; it supports exactly standard JSON and writes
//! non-finite numbers as `null`, so a result can never smuggle a NaN out.

use std::fmt::Write;

#[derive(Clone, Debug, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    /// Fields in insertion order.
    Obj(Vec<(String, Json)>),
}

/// Nesting deeper than this is rejected instead of risking the stack.
const MAX_DEPTH: usize = 64;

impl From<f64> for Json {
    fn from(v: f64) -> Self {
        Json::Num(v)
    }
}
impl From<usize> for Json {
    fn from(v: usize) -> Self {
        Json::Num(v as f64)
    }
}
impl From<bool> for Json {
    fn from(v: bool) -> Self {
        Json::Bool(v)
    }
}
impl From<&str> for Json {
    fn from(v: &str) -> Self {
        Json::Str(v.to_string())
    }
}
impl From<String> for Json {
    fn from(v: String) -> Self {
        Json::Str(v)
    }
}
impl<T: Into<Json>> From<Option<T>> for Json {
    fn from(v: Option<T>) -> Self {
        v.map_or(Json::Null, Into::into)
    }
}
impl<T: Into<Json>> From<Vec<T>> for Json {
    fn from(v: Vec<T>) -> Self {
        Json::Arr(v.into_iter().map(Into::into).collect())
    }
}
impl<const N: usize> From<[f64; N]> for Json {
    fn from(v: [f64; N]) -> Self {
        Json::Arr(v.iter().map(|x| Json::Num(*x)).collect())
    }
}

/// Build an object from `(key, value)` pairs.
pub fn object<const N: usize>(fields: [(&str, Json); N]) -> Json {
    Json::Obj(fields.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

impl Json {
    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Obj(fields) => fields.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Json::Num(v) => Some(*v),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::Str(v) => Some(v),
            _ => None,
        }
    }
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Json::Bool(v) => Some(*v),
            _ => None,
        }
    }
    pub fn as_array(&self) -> Option<&[Json]> {
        match self {
            Json::Arr(v) => Some(v),
            _ => None,
        }
    }

    pub fn to_json_string(&self) -> String {
        let mut out = String::new();
        self.write(&mut out);
        out
    }

    fn write(&self, out: &mut String) {
        match self {
            Json::Null => out.push_str("null"),
            Json::Bool(v) => out.push_str(if *v { "true" } else { "false" }),
            Json::Num(v) => {
                if !v.is_finite() {
                    out.push_str("null");
                } else if *v == 0.0 {
                    out.push('0');
                } else if v.abs() >= 1e-5 && v.abs() < 1e15 {
                    let _ = write!(out, "{v}");
                } else {
                    let _ = write!(out, "{v:e}");
                }
            }
            Json::Str(v) => write_string(v, out),
            Json::Arr(items) => {
                out.push('[');
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    item.write(out);
                }
                out.push(']');
            }
            Json::Obj(fields) => {
                out.push('{');
                for (i, (key, value)) in fields.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    write_string(key, out);
                    out.push(':');
                    value.write(out);
                }
                out.push('}');
            }
        }
    }
}

fn write_string(value: &str, out: &mut String) {
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

/// Parse a JSON document.
pub fn parse(text: &str) -> Result<Json, String> {
    let mut parser = Parser { bytes: text.as_bytes(), pos: 0 };
    let value = parser.value(0)?;
    parser.whitespace();
    if parser.pos != parser.bytes.len() {
        return Err(parser.error("unexpected text after the JSON value"));
    }
    Ok(value)
}

impl Parser<'_> {
    fn error(&self, what: &str) -> String {
        format!("Invalid JSON at byte {}: {what}.", self.pos)
    }
    fn whitespace(&mut self) {
        while matches!(self.bytes.get(self.pos), Some(b' ' | b'\n' | b'\r' | b'\t')) {
            self.pos += 1;
        }
    }
    fn literal(&mut self, word: &str, value: Json) -> Result<Json, String> {
        if self.bytes[self.pos..].starts_with(word.as_bytes()) {
            self.pos += word.len();
            Ok(value)
        } else {
            Err(self.error("unknown literal"))
        }
    }

    fn value(&mut self, depth: usize) -> Result<Json, String> {
        if depth > MAX_DEPTH {
            return Err(self.error("nesting too deep"));
        }
        self.whitespace();
        match self.bytes.get(self.pos) {
            None => Err(self.error("unexpected end of input")),
            Some(b'n') => self.literal("null", Json::Null),
            Some(b't') => self.literal("true", Json::Bool(true)),
            Some(b'f') => self.literal("false", Json::Bool(false)),
            Some(b'"') => self.string().map(Json::Str),
            Some(b'[') => {
                self.pos += 1;
                let mut items = Vec::new();
                self.whitespace();
                if self.bytes.get(self.pos) == Some(&b']') {
                    self.pos += 1;
                    return Ok(Json::Arr(items));
                }
                loop {
                    items.push(self.value(depth + 1)?);
                    self.whitespace();
                    match self.bytes.get(self.pos) {
                        Some(b',') => self.pos += 1,
                        Some(b']') => {
                            self.pos += 1;
                            return Ok(Json::Arr(items));
                        }
                        _ => return Err(self.error("expected ',' or ']'")),
                    }
                }
            }
            Some(b'{') => {
                self.pos += 1;
                let mut fields = Vec::new();
                self.whitespace();
                if self.bytes.get(self.pos) == Some(&b'}') {
                    self.pos += 1;
                    return Ok(Json::Obj(fields));
                }
                loop {
                    self.whitespace();
                    if self.bytes.get(self.pos) != Some(&b'"') {
                        return Err(self.error("expected a string key"));
                    }
                    let key = self.string()?;
                    self.whitespace();
                    if self.bytes.get(self.pos) != Some(&b':') {
                        return Err(self.error("expected ':'"));
                    }
                    self.pos += 1;
                    let value = self.value(depth + 1)?;
                    fields.push((key, value));
                    self.whitespace();
                    match self.bytes.get(self.pos) {
                        Some(b',') => self.pos += 1,
                        Some(b'}') => {
                            self.pos += 1;
                            return Ok(Json::Obj(fields));
                        }
                        _ => return Err(self.error("expected ',' or '}'")),
                    }
                }
            }
            Some(_) => self.number(),
        }
    }

    fn number(&mut self) -> Result<Json, String> {
        let start = self.pos;
        while matches!(self.bytes.get(self.pos), Some(b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E')) {
            self.pos += 1;
        }
        let token = std::str::from_utf8(&self.bytes[start..self.pos]).unwrap_or("");
        match token.parse::<f64>() {
            Ok(v) if !token.is_empty() => Ok(Json::Num(v)),
            _ => Err(self.error("expected a value")),
        }
    }

    fn hex4(&mut self) -> Result<u32, String> {
        let digits = self.bytes.get(self.pos..self.pos + 4).and_then(|d| std::str::from_utf8(d).ok());
        let code = digits.and_then(|d| u32::from_str_radix(d, 16).ok()).ok_or_else(|| self.error("bad \\u escape"))?;
        self.pos += 4;
        Ok(code)
    }

    fn string(&mut self) -> Result<String, String> {
        self.pos += 1;
        let mut out = Vec::new();
        loop {
            let Some(&b) = self.bytes.get(self.pos) else {
                return Err(self.error("unterminated string"));
            };
            self.pos += 1;
            match b {
                b'"' => return String::from_utf8(out).map_err(|_| self.error("invalid UTF-8")),
                b'\\' => {
                    let Some(&escape) = self.bytes.get(self.pos) else {
                        return Err(self.error("unterminated escape"));
                    };
                    self.pos += 1;
                    let c = match escape {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'b' => '\u{8}',
                        b'f' => '\u{c}',
                        b'n' => '\n',
                        b'r' => '\r',
                        b't' => '\t',
                        b'u' => {
                            let mut code = self.hex4()?;
                            if (0xD800..0xDC00).contains(&code) && self.bytes[self.pos..].starts_with(b"\\u") {
                                self.pos += 2;
                                let low = self.hex4()?;
                                code = 0x10000 + ((code - 0xD800) << 10) + (low.wrapping_sub(0xDC00) & 0x3FF);
                            }
                            char::from_u32(code).unwrap_or('\u{FFFD}')
                        }
                        _ => return Err(self.error("unknown escape")),
                    };
                    let mut buffer = [0u8; 4];
                    out.extend_from_slice(c.encode_utf8(&mut buffer).as_bytes());
                }
                b if b < 0x20 => return Err(self.error("control character in string")),
                b => out.push(b),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_document() {
        let text = r#"{"a":[1,-2.5e3,true,null],"b":{"c":"x\"y\né"},"d":1e-9}"#;
        let value = parse(text).unwrap();
        assert_eq!(value.get("a").unwrap().as_array().unwrap()[1], Json::Num(-2500.0));
        assert_eq!(value.get("b").unwrap().get("c").unwrap().as_str(), Some("x\"y\né"));
        assert_eq!(parse(&value.to_json_string()).unwrap(), value);
    }

    #[test]
    fn rejects_malformed_input_and_hides_non_finite_numbers() {
        for bad in ["", "{", "[1,]", "{\"a\" 1}", "nul", "1 2", "\"abc", "[1e999x]"] {
            assert!(parse(bad).is_err(), "{bad}");
        }
        assert!(parse(&"[".repeat(1000)).is_err());
        assert_eq!(Json::from([f64::NAN, f64::INFINITY, 1.0]).to_json_string(), "[null,null,1]");
    }
}
