//! Capture of on-screen text messages for the Chat page.
//!
//! DCS has no server-side event for text shown on a player's screen, and the
//! hook-environment GUI callbacks (`onTriggerMessage`, `onRadioMessage`,
//! `onShowMessage`) were verified live never to fire on a dedicated server.
//! Every *scripted* message, however, goes through `trigger.action.outText*`
//! or a Mission Editor `a_out_text_delay*` action in the mission scripting
//! environment. `lua/screen_messages.lua` wraps those, records each call with
//! its target into a ring buffer, and serves it by cursor. It is injected on
//! demand through `CustomService.Eval` with the probe/install pattern of
//! [`crate::carrier_recovery`].
//!
//! AI radio traffic (ATC, AWACS, tankers) is generated per client and is not
//! reachable from the server at all; it is out of scope here.

use crate::carrier_recovery::{Scripts, NEEDS_INSTALL_KEY};

/// Mission-side module source, embedded at compile time.
pub const LUA_MODULE: &str = include_str!("../lua/screen_messages.lua");
/// Must match `VERSION` in `screen_messages.lua` (checked by a test).
pub const MODULE_VERSION: &str = "1.0.0";

fn scripts_for(global: &str, version: &str, module: &str, call: &str) -> Scripts {
    let check = format!("{global} and {global}.VERSION == \"{version}\"");
    let probe = format!("if {check} then\n{call}\nelse\nreturn {{ {NEEDS_INSTALL_KEY} = true }}\nend");
    let install = format!("if not ({check}) then\n(function()\n{module}\nend)()\nend\n{call}");
    Scripts { probe, install }
}

/// Mission Eval pair behind `GET /api/screen-messages?from=N`.
pub fn since_scripts(from: u64) -> Scripts {
    scripts_for(
        "ScreenMessages",
        MODULE_VERSION,
        LUA_MODULE,
        &format!("return ScreenMessages.since({from})"),
    )
}

/// One scripted on-screen message.
#[derive(Debug, Clone, PartialEq, serde::Serialize, utoipa::ToSchema)]
pub struct ScreenMessage {
    /// Monotonic id within the current mission; restarts at 1 with the mission.
    pub id: u64,
    /// Mission absolute time in seconds (`timer.getAbsTime()`).
    pub time: f64,
    /// `all`, `coalition`, `country`, `group` or `unit`.
    pub scope: String,
    /// Coalition id (0 neutral, 1 red, 2 blue), country id, group id or unit
    /// id depending on `scope`; absent for `all`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<i64>,
    pub text: String,
    /// Requested display time, seconds.
    pub duration: f64,
    pub clear_view: bool,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, utoipa::ToSchema)]
pub struct ScreenMessagesResponse {
    /// Messages after the cursor, oldest first. When the cursor was ahead of
    /// the mission's log (mission restarted) this is the whole buffer.
    pub messages: Vec<ScreenMessage>,
    /// Cursor to pass as `from` next time.
    pub last: u64,
}

fn num_u64(value: Option<&serde_json::Value>) -> u64 {
    value.and_then(|v| v.as_f64()).map(|f| f.max(0.0) as u64).unwrap_or(0)
}

fn num_f64(value: Option<&serde_json::Value>) -> f64 {
    value.and_then(|v| v.as_f64()).unwrap_or(0.0)
}

fn str_of(value: Option<&serde_json::Value>) -> String {
    value.and_then(|v| v.as_str()).unwrap_or("").to_string()
}

/// Parse the table returned by `ScreenMessages.since`. Rows without an id
/// are skipped; a missing `last` leaves the caller's cursor unchanged.
pub fn parse_screen_messages(json: &serde_json::Value, from: u64) -> ScreenMessagesResponse {
    let messages = json
        .get("messages")
        .and_then(|m| m.as_array())
        .map(|rows| {
            rows.iter()
                .filter(|row| row.get("id").is_some())
                .map(|row| ScreenMessage {
                    id: num_u64(row.get("id")),
                    time: num_f64(row.get("time")),
                    scope: str_of(row.get("scope")),
                    target: row.get("target").and_then(|t| t.as_f64()).map(|t| t as i64),
                    text: str_of(row.get("text")),
                    duration: num_f64(row.get("duration")),
                    clear_view: row.get("clear_view").and_then(|c| c.as_bool()).unwrap_or(false),
                })
                .collect()
        })
        .unwrap_or_default();
    let last = json.get("last").map(|l| num_u64(Some(l))).unwrap_or(from);
    ScreenMessagesResponse { messages, last }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mlua::{Lua, Table, Value};

    /// Minimal fake of the mission scripting environment: a clock, the five
    /// `trigger.action.outText*` functions and the ME `a_out_text_delay*`
    /// actions, each appending to `Sim.calls` so forwarding can be asserted.
    const MISSION_SIM: &str = r#"
Sim = { time = 1000, calls = {}, warnings = {} }
timer = { getAbsTime = function() return Sim.time end }
env = { warning = function(msg) table.insert(Sim.warnings, msg) end }
local function fwd(name) return function(...) table.insert(Sim.calls, { name = name, args = { ... } }) return "ok-" .. name end end
trigger = { action = {
  outText = fwd("outText"),
  outTextForCoalition = fwd("outTextForCoalition"),
  outTextForCountry = fwd("outTextForCountry"),
  outTextForGroup = fwd("outTextForGroup"),
  outTextForUnit = fwd("outTextForUnit"),
} }
a_out_text_delay = fwd("a_out_text_delay")
a_out_text_delay_s = fwd("a_out_text_delay_s")
a_out_text_delay_g = fwd("a_out_text_delay_g")
a_out_text_delay_u = fwd("a_out_text_delay_u")
"#;

    fn lua_with(sim: &str) -> Lua {
        let lua = Lua::new();
        lua.load(sim).exec().expect("sim loads");
        lua
    }

    fn eval<T: mlua::FromLuaMulti>(lua: &Lua, code: &str) -> T {
        lua.load(code).eval::<T>().unwrap_or_else(|e| panic!("{code}\n{e}"))
    }

    fn to_json(lua: &Lua, code: &str) -> serde_json::Value {
        let value: Value = eval(lua, code);
        lua_to_json(&value)
    }

    /// Lua → JSON the way DCS's encoder does it: empty tables become `[]`,
    /// sequences become arrays, everything else an object.
    fn lua_to_json(value: &Value) -> serde_json::Value {
        match value {
            Value::Nil => serde_json::Value::Null,
            Value::Boolean(b) => serde_json::Value::Bool(*b),
            Value::Integer(i) => serde_json::json!(*i),
            Value::Number(n) => serde_json::json!(*n),
            Value::String(s) => serde_json::Value::String(s.to_str().unwrap().to_string()),
            Value::Table(t) => {
                let len = t.raw_len();
                if len > 0 || t.clone().pairs::<Value, Value>().next().is_none() {
                    let mut out = Vec::new();
                    for i in 1..=len {
                        out.push(lua_to_json(&t.raw_get::<Value>(i).unwrap()));
                    }
                    serde_json::Value::Array(out)
                } else {
                    let mut map = serde_json::Map::new();
                    for pair in t.clone().pairs::<String, Value>() {
                        let (k, v) = pair.unwrap();
                        map.insert(k, lua_to_json(&v));
                    }
                    serde_json::Value::Object(map)
                }
            }
            other => panic!("unsupported value {other:?}"),
        }
    }

    #[test]
    fn version_matches_the_lua_source() {
        assert!(LUA_MODULE.contains(&format!("local VERSION = \"{MODULE_VERSION}\"")));
    }

    #[test]
    fn scripts_probe_then_install() {
        let scripts = since_scripts(5);
        assert!(scripts.probe.contains("ScreenMessages.VERSION == \"1.0.0\""));
        assert!(scripts.probe.contains("return ScreenMessages.since(5)"));
        assert!(scripts.probe.contains(NEEDS_INSTALL_KEY));
        assert!(!scripts.probe.contains("local VERSION"));
        assert!(scripts.install.contains("local VERSION"));
        assert!(scripts.install.ends_with("return ScreenMessages.since(5)"));
    }

    #[test]
    fn mission_module_records_and_forwards_every_out_text_variant() {
        let lua = lua_with(MISSION_SIM);
        lua.load(LUA_MODULE).exec().expect("module loads");

        let r: String = eval(&lua, r#"return trigger.action.outText("hello all", 10, true)"#);
        assert_eq!(r, "ok-outText", "original is still called and its result returned");
        eval::<()>(&lua, r#"trigger.action.outTextForCoalition(2, "blue only", 15, false)"#);
        eval::<()>(&lua, r#"trigger.action.outTextForCountry(4, "country", 5)"#);
        eval::<()>(&lua, r#"trigger.action.outTextForGroup(77, "group text", 20)"#);
        eval::<()>(&lua, r#"trigger.action.outTextForUnit(9001, "unit text", 3, false)"#);
        eval::<()>(&lua, r#"a_out_text_delay("me all", 100, false, 0)"#);
        eval::<()>(&lua, r#"a_out_text_delay_s(1, "me red", 30, true, 0)"#);
        eval::<()>(&lua, r#"a_out_text_delay_g(12, "me group", 30, false, 0)"#);
        eval::<()>(&lua, r#"a_out_text_delay_u(34, "me unit", 30, false, 0)"#);

        let calls: Table = eval(&lua, "return Sim.calls");
        assert_eq!(calls.raw_len(), 9, "every call forwarded to the original");

        let parsed = parse_screen_messages(&to_json(&lua, "return ScreenMessages.since(0)"), 0);
        assert_eq!(parsed.last, 9);
        let summary: Vec<(u64, &str, Option<i64>, &str, f64, bool)> = parsed
            .messages
            .iter()
            .map(|m| (m.id, m.scope.as_str(), m.target, m.text.as_str(), m.duration, m.clear_view))
            .collect();
        assert_eq!(
            summary,
            vec![
                (1, "all", None, "hello all", 10.0, true),
                (2, "coalition", Some(2), "blue only", 15.0, false),
                (3, "country", Some(4), "country", 5.0, false),
                (4, "group", Some(77), "group text", 20.0, false),
                (5, "unit", Some(9001), "unit text", 3.0, false),
                (6, "all", None, "me all", 100.0, false),
                (7, "coalition", Some(1), "me red", 30.0, true),
                (8, "group", Some(12), "me group", 30.0, false),
                (9, "unit", Some(34), "me unit", 30.0, false),
            ]
        );
        assert!(parsed.messages.iter().all(|m| m.time == 1000.0));
    }

    #[test]
    fn mission_module_cursor_and_ring_buffer() {
        let lua = lua_with(MISSION_SIM);
        lua.load(LUA_MODULE).exec().unwrap();
        eval::<()>(&lua, "ScreenMessages.MAX_BUFFER = 3");
        for i in 1..=5 {
            eval::<()>(&lua, &format!(r#"trigger.action.outText("m{i}", 1)"#));
        }
        let all = parse_screen_messages(&to_json(&lua, "return ScreenMessages.since(0)"), 0);
        assert_eq!(all.last, 5);
        let ids: Vec<u64> = all.messages.iter().map(|m| m.id).collect();
        assert_eq!(ids, vec![3, 4, 5], "oldest entries dropped past MAX_BUFFER");

        let tail = parse_screen_messages(&to_json(&lua, "return ScreenMessages.since(4)"), 4);
        assert_eq!(tail.messages.len(), 1);
        assert_eq!(tail.messages[0].text, "m5");

        // A cursor from a previous mission (ahead of the log) yields everything.
        let reset = parse_screen_messages(&to_json(&lua, "return ScreenMessages.since(500)"), 500);
        assert_eq!(reset.messages.len(), 3);
        assert_eq!(reset.last, 5);

        // Nothing new: an empty Lua table serialises as `[]`.
        let none = parse_screen_messages(&to_json(&lua, "return ScreenMessages.since(5)"), 5);
        assert!(none.messages.is_empty());
        assert_eq!(none.last, 5);
    }

    #[test]
    fn mission_module_reload_and_upgrade_wrap_only_once() {
        let lua = lua_with(MISSION_SIM);
        lua.load(LUA_MODULE).exec().unwrap();
        eval::<()>(&lua, r#"trigger.action.outText("before", 1)"#);

        // Same version loaded again (what the install script does when the
        // probe raced a restart), then a pretend newer version.
        lua.load(LUA_MODULE).exec().unwrap();
        lua.load(&LUA_MODULE.replace("local VERSION = \"1.0.0\"", "local VERSION = \"9.9.9\""))
            .exec()
            .unwrap();
        let version: String = eval(&lua, "return ScreenMessages.VERSION");
        assert_eq!(version, "9.9.9");

        eval::<()>(&lua, r#"trigger.action.outText("after", 1)"#);
        let calls: Table = eval(&lua, "return Sim.calls");
        assert_eq!(calls.raw_len(), 2, "each message reaches the original exactly once");
        let parsed = parse_screen_messages(&to_json(&lua, "return ScreenMessages.since(0)"), 0);
        let texts: Vec<&str> = parsed.messages.iter().map(|m| m.text.as_str()).collect();
        assert_eq!(texts, vec!["before", "after"], "buffer survives the upgrade, no double records");
    }

    #[test]
    fn mission_module_tolerates_missing_functions() {
        let lua = lua_with(MISSION_SIM);
        eval::<()>(&lua, "trigger.action.outTextForCountry = nil; a_out_text_delay_u = nil");
        lua.load(LUA_MODULE).exec().expect("loads with absent functions");
        let missing: Value = eval(&lua, "return trigger.action.outTextForCountry");
        assert!(matches!(missing, Value::Nil), "absent functions are not invented");
    }

    #[test]
    fn parser_copes_with_garbage() {
        let empty = parse_screen_messages(&serde_json::Value::Null, 7);
        assert!(empty.messages.is_empty());
        assert_eq!(empty.last, 7);
    }
}
