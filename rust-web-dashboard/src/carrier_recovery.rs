//! Stand-alone carrier "turn into wind" controller.
//!
//! The controller itself is Lua (`lua/carrier_recovery.lua`), ported from the
//! Foothold `zoneCommander.lua` recovery functions so the heading and speed
//! solution stays identical. This module embeds that file, builds the
//! DCS-gRPC `CustomService.Eval` payloads that inject it on demand and call
//! it, and hosts the Lua test-suite that pins the solver to the shared fixture
//! in `docs/src/fixtures/wind_solver_cases.json`.
//!
//! Injection model: every call comes as a pair of scripts. The `probe` is a
//! few lines that run the call when the module is present at the expected
//! version and otherwise return `{ needs_install = true }`. Only then does the
//! backend send the `install` script, which carries the full module source
//! followed by the same call. DCS therefore compiles the module once per
//! mission (re)start instead of on every 2-second telemetry poll.

/// The Lua controller source, embedded at compile time.
pub const LUA_MODULE: &str = include_str!("../lua/carrier_recovery.lua");

/// Must match `CarrierRecovery.VERSION` in the Lua file (checked by a test).
pub const MODULE_VERSION: &str = "1.1.0";

/// Default carrier group when the client does not name one.
pub const DEFAULT_GROUP: &str = "CVN-72";

/// Accepted range for a per-carrier target wind over deck, knots. The Lua
/// module clamps to the same bounds (`TARGET_WOD_MIN_KT` / `MAX`).
pub const TARGET_WOD_MIN_KT: f64 = 10.0;
pub const TARGET_WOD_MAX_KT: f64 = 45.0;

/// Upper bound on the number of carriers one batched telemetry request may
/// name; each costs a `windData` call inside the single Eval.
pub const MAX_BATCH_GROUPS: usize = 16;

pub fn is_valid_target_wod(value: f64) -> bool {
    value.is_finite() && (TARGET_WOD_MIN_KT..=TARGET_WOD_MAX_KT).contains(&value)
}

/// Split the `names` query parameter (comma-separated group names) into a
/// de-duplicated, validated list. Empty entries are ignored; an invalid name
/// or an empty result is an error carrying a user-facing message.
pub fn parse_group_names(raw: &str) -> Result<Vec<String>, String> {
    let mut names: Vec<String> = Vec::new();
    for part in raw.split(',') {
        let name = part.trim();
        if name.is_empty() {
            continue;
        }
        if !is_valid_group_name(name) {
            return Err(format!("Invalid carrier group name: {name}"));
        }
        if !names.iter().any(|n| n == name) {
            names.push(name.to_string());
        }
    }
    if names.is_empty() {
        return Err("No carrier group name given".to_string());
    }
    if names.len() > MAX_BATCH_GROUPS {
        return Err(format!("At most {MAX_BATCH_GROUPS} carriers per request"));
    }
    Ok(names)
}

/// Carrier actions exposed by `POST /api/airboss/action`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Start,
    Resume,
    Status,
}

impl Action {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "start" => Some(Action::Start),
            "resume" => Some(Action::Resume),
            "status" => Some(Action::Status),
            _ => None,
        }
    }
}

/// Group names are embedded in Lua source as a double-quoted literal, so only
/// a conservative character set is accepted. This also rejects anything that
/// could break out of the literal.
pub fn is_valid_group_name(name: &str) -> bool {
    let len = name.chars().count();
    (1..=64).contains(&len)
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '_' | '.' | '-'))
}

/// Key of the marker table the probe returns when the module must be installed.
pub const NEEDS_INSTALL_KEY: &str = "needs_install";

/// A controller call as the pair of Eval payloads described in the module docs.
#[derive(Clone, Debug)]
pub struct Scripts {
    /// Runs the call if the module is installed at [`MODULE_VERSION`], else
    /// returns `{ needs_install = true }`.
    pub probe: String,
    /// Installs (or upgrades) the module, then runs the call.
    pub install: String,
}

fn version_check() -> String {
    format!("CarrierRecovery and CarrierRecovery.VERSION == \"{MODULE_VERSION}\"")
}

fn scripts_for(call: &str) -> Scripts {
    let probe = format!(
        "if {check} then\n{call}\nelse\nreturn {{ {key} = true }}\nend",
        check = version_check(),
        key = NEEDS_INSTALL_KEY,
    );
    let install = format!(
        "if not ({check}) then\n(function()\n{module}\nend)()\nend\n{call}",
        check = version_check(),
        module = LUA_MODULE,
    );
    Scripts { probe, install }
}

/// Scripts for a carrier action. The group name must already have passed
/// [`is_valid_group_name`].
pub fn action_scripts(action: Action, group: &str) -> Scripts {
    debug_assert!(is_valid_group_name(group));
    let call = match action {
        Action::Start => format!(
            "local ok, message = CarrierRecovery.start(\"{group}\")\nreturn {{ ok = ok == true, message = message }}"
        ),
        Action::Resume => format!(
            "local ok, message = CarrierRecovery.restore(\"manual\", \"{group}\")\nreturn {{ ok = ok == true, message = message }}"
        ),
        Action::Status => format!("return CarrierRecovery.status(\"{group}\")"),
    };
    scripts_for(&call)
}

/// Scripts for the telemetry poll behind `GET /api/airboss?name=`.
pub fn wind_report_scripts(group: &str) -> Scripts {
    debug_assert!(is_valid_group_name(group));
    scripts_for(&format!("return CarrierRecovery.windReport(\"{group}\")"))
}

/// Scripts for the batched poll behind `GET /api/airboss?names=a,b`: one Eval
/// returns `{ reports = { [name] = report } }` for every listed group.
pub fn wind_reports_scripts(groups: &[String]) -> Scripts {
    debug_assert!(groups.iter().all(|g| is_valid_group_name(g)));
    let list: Vec<String> = groups.iter().map(|g| format!("\"{g}\"")).collect();
    scripts_for(&format!("return CarrierRecovery.windReports({{ {} }})", list.join(", ")))
}

/// Scripts for `GET /api/airboss/carriers`: every carrier-type ship group in
/// the mission with its deck classification.
pub fn list_carriers_scripts() -> Scripts {
    scripts_for("return CarrierRecovery.listCarriers()")
}

/// Scripts for `POST /api/airboss/config`: set this group's target wind over
/// deck. The value must already have passed [`is_valid_target_wod`].
pub fn group_config_scripts(group: &str, target_wod_kt: f64) -> Scripts {
    debug_assert!(is_valid_group_name(group));
    debug_assert!(is_valid_target_wod(target_wod_kt));
    scripts_for(&format!(
        "return CarrierRecovery.setGroupOverrides(\"{group}\", {{ targetWodKt = {target_wod_kt} }})"
    ))
}

/// Did the probe ask for an install?
pub fn needs_install(value: &serde_json::Value) -> bool {
    value.get(NEEDS_INSTALL_KEY).and_then(|v| v.as_bool()) == Some(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mlua::{Lua, Table, Value};

    const FIXTURE: &str = include_str!("../../docs/src/fixtures/wind_solver_cases.json");

    /// Minimal fake of the DCS mission scripting environment: one default ship
    /// group (`Sim.ship`, named by `Sim.groupName`) plus any number of extra
    /// ships added with `Sim.addShip`, a wind field, a surface-type function,
    /// a manual clock with a scheduler, and message capture. Everything is
    /// reachable through the `Sim` table.
    const SIM: &str = r#"
Sim = {
  time = 0,
  wind = { x = 0, y = 0, z = 0 },
  landAt = function(x, z) return 3 end,
  scheduled = {},
  texts = {},
  routes = {},
  groupName = "CVN-71",
  ship = {
    x = 0, z = 0, headingDeg = 0, speedKt = 0, typeName = "CVN_71", exists = true, coalition = 2,
    attributes = { ["Ships"] = true, ["AircraftCarrier"] = true, ["AircraftCarrier With Catapult"] = true,
                   ["AircraftCarrier With Arresting Gear"] = true },
  },
  fleet = {},
  dict = {},
}

land = {
  SurfaceType = { LAND = 1, SHALLOW_WATER = 2, WATER = 3, ROAD = 4, RUNWAY = 5 },
  getSurfaceType = function(p) return Sim.landAt(p.x, p.y) end,
}
atmosphere = { getWind = function(p) return Sim.wind end }
timer = {
  getTime = function() return Sim.time end,
  scheduleFunction = function(fn, param, at)
    table.insert(Sim.scheduled, { fn = fn, param = param, at = at })
  end,
}
trigger = { action = {
  outTextForCoalition = function(c, text, s) table.insert(Sim.texts, { coalition = c, text = text }) end,
  outTextForGroup = function(g, text, s) table.insert(Sim.texts, { group = g, text = text }) end,
} }
env = {
  info = function() end,
  mission = { coalition = {} },
  getValueDictByKey = function(k) return Sim.dict[k] or k end,
}
missionCommands = {
  addSubMenuForCoalition = function(c, name, parent) return { name = name, parent = parent } end,
  addCommandForCoalition = function(c, name, parent, fn) return { name = name, parent = parent, fn = fn } end,
}

-- Build a DCS-like group/unit pair whose behaviour is read live from `spec`.
local function makeShip(spec)
  local unit = {}
  function unit:isExist() return spec.exists ~= false end
  function unit:getPoint() return { x = spec.x or 0, y = 0, z = spec.z or 0 } end
  function unit:getPosition()
    local h = math.rad(spec.headingDeg or 0)
    return { p = self:getPoint(), x = { x = math.cos(h), y = 0, z = math.sin(h) } }
  end
  function unit:getVelocity()
    local h = math.rad(spec.headingDeg or 0)
    local mps = (spec.speedKt or 0) * 0.514444
    return { x = math.cos(h) * mps, y = 0, z = math.sin(h) * mps }
  end
  function unit:getTypeName() return spec.typeName end
  function unit:getName() return spec.unitName or ((spec.groupName or Sim.groupName) .. "-1") end
  function unit:getDesc() return { typeName = spec.typeName, attributes = spec.attributes or {} } end

  local controller = { setTask = function(_, task) table.insert(Sim.routes, task) end }
  local group = {}
  function group:isExist() return spec.exists ~= false end
  function group:getSize() return spec.exists ~= false and 1 or 0 end
  function group:getUnit(i) return unit end
  function group:getID() return spec.id or 7 end
  function group:getName() return spec.groupName or Sim.groupName end
  function group:getCoalition() return spec.coalition or 2 end
  function group:getController() return controller end
  return group
end

local defaultGroup = makeShip(Sim.ship)

-- Add another ship group: { groupName=, typeName=, attributes=, coalition=, x=, z=, headingDeg=, speedKt= }.
function Sim.addShip(spec)
  spec.exists = spec.exists ~= false
  Sim.fleet[spec.groupName] = { spec = spec, group = makeShip(spec) }
  return Sim.fleet[spec.groupName].group
end

Group = {
  Category = { AIRPLANE = 0, HELICOPTER = 1, GROUND = 2, SHIP = 3, TRAIN = 4 },
  getByName = function(name)
    if name == Sim.groupName then
      if Sim.ship.exists then return defaultGroup end
      return nil
    end
    local entry = Sim.fleet[name]
    if entry and entry.spec.exists then return entry.group end
    return nil
  end,
}

coalition = {
  side = { NEUTRAL = 0, RED = 1, BLUE = 2 },
  getGroups = function(side, category)
    local out = {}
    if category ~= Group.Category.SHIP then return out end
    if Sim.ship.exists and (Sim.ship.coalition or 2) == side then out[#out + 1] = defaultGroup end
    local names = {}
    for name in pairs(Sim.fleet) do names[#names + 1] = name end
    table.sort(names)
    for _, name in ipairs(names) do
      local entry = Sim.fleet[name]
      if entry.spec.exists and (entry.spec.coalition or 2) == side then out[#out + 1] = entry.group end
    end
    return out
  end,
}

-- Wind blowing FROM `fromDeg` at `kt` knots, as the DCS "to" vector.
function Sim.setWind(fromDeg, kt)
  local to = math.rad((fromDeg + 180) % 360)
  local mps = kt * 0.514444
  Sim.wind = { x = math.cos(to) * mps, y = 0, z = math.sin(to) * mps }
end

-- Advance the clock, firing due scheduled functions in time order.
function Sim.run(untilTime)
  while true do
    local nextIndex, nextAt = nil, nil
    for i, entry in ipairs(Sim.scheduled) do
      if entry.at <= untilTime and (not nextAt or entry.at < nextAt) then
        nextIndex, nextAt = i, entry.at
      end
    end
    if not nextIndex then break end
    local entry = table.remove(Sim.scheduled, nextIndex)
    Sim.time = entry.at
    local again = entry.fn(entry.param, Sim.time)
    if type(again) == "number" then
      table.insert(Sim.scheduled, { fn = entry.fn, param = entry.param, at = again })
    end
  end
  Sim.time = untilTime
end

function Sim.lastRoute()
  local task = Sim.routes[#Sim.routes]
  return task and task.params.route.points or nil
end

function Sim.hasText(needle)
  for _, t in ipairs(Sim.texts) do
    if t.text:find(needle, 1, true) then return true end
  end
  return false
end
"#;

    fn world() -> Lua {
        let lua = Lua::new();
        lua.load(SIM).exec().expect("sim stub loads");
        lua.load(LUA_MODULE).exec().expect("module loads");
        lua
    }

    fn eval<T: mlua::FromLuaMulti>(lua: &Lua, code: &str) -> T {
        lua.load(code).eval::<T>().unwrap_or_else(|e| panic!("{code}\n{e}"))
    }

    fn lua_literal(value: &serde_json::Value) -> String {
        match value {
            serde_json::Value::Null => "nil".into(),
            serde_json::Value::Bool(b) => b.to_string(),
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::String(s) => format!("{s:?}"),
            serde_json::Value::Array(items) => {
                let inner: Vec<String> = items.iter().map(lua_literal).collect();
                format!("{{{}}}", inner.join(", "))
            }
            serde_json::Value::Object(map) => {
                let inner: Vec<String> = map
                    .iter()
                    .map(|(k, v)| format!("[{k:?}] = {}", lua_literal(v)))
                    .collect();
                format!("{{{}}}", inner.join(", "))
            }
        }
    }

    fn num(table: &Table, key: &str) -> f64 {
        table.get::<f64>(key).unwrap_or_else(|e| panic!("field {key}: {e}"))
    }

    fn text(table: &Table, key: &str) -> String {
        table.get::<String>(key).unwrap_or_else(|e| panic!("field {key}: {e}"))
    }

    fn heading_close(a: f64, b: f64, tol: f64) -> bool {
        ((a - b + 540.0).rem_euclid(360.0) - 180.0).abs() <= tol
    }

    #[test]
    fn lua_version_matches_rust_constant() {
        let needle = format!("M.VERSION = \"{MODULE_VERSION}\"");
        assert!(LUA_MODULE.contains(&needle), "Lua VERSION must be {MODULE_VERSION}");
    }

    #[test]
    fn module_loads_and_exposes_api() {
        let lua = world();
        let api: Table = eval(&lua, "return CarrierRecovery");
        for name in [
            "solve", "windData", "windReport", "windReports", "listCarriers", "classifyDeck",
            "setGroupOverrides", "start", "restore", "status", "monitor", "installMenus",
        ] {
            assert!(
                !matches!(api.get::<Value>(name).unwrap(), Value::Nil),
                "CarrierRecovery.{name} missing"
            );
        }
        assert_eq!(text(&api, "VERSION"), MODULE_VERSION);
    }

    #[test]
    fn probe_then_install_round_trip() {
        let lua = Lua::new();
        lua.load(SIM).exec().unwrap();
        lua.load("Sim.setWind(30, 8)").exec().unwrap();
        let scripts = wind_report_scripts("CVN-71");
        assert!(!scripts.probe.contains("M.VERSION ="), "probe must not carry the module source");
        assert!(scripts.install.contains("M.VERSION ="), "install must carry the module source");

        // Fresh mission: the probe asks for an install, the install script answers.
        let probe: Table = eval(&lua, &scripts.probe);
        assert!(probe.get::<bool>(NEEDS_INSTALL_KEY).unwrap());
        let installed: Table = eval(&lua, &scripts.install);
        assert_eq!(text(&installed, "carrier_name"), "CVN-71");
        assert_eq!(text(&installed, "backend"), "standalone");

        // Installed: the probe answers directly and the module keeps its state.
        lua.load("CarrierRecovery.active.marker = true").exec().unwrap();
        let again: Table = eval(&lua, &scripts.probe);
        assert_eq!(text(&again, "carrier_name"), "CVN-71");
        let _: Table = eval(&lua, &scripts.install);
        assert!(eval::<bool>(&lua, "return CarrierRecovery.active.marker == true"), "reinstalled at same version");

        // Outdated module: both scripts detect it, install upgrades it.
        lua.load("CarrierRecovery.VERSION = '0.0.1'").exec().unwrap();
        let stale: Table = eval(&lua, &scripts.probe);
        assert!(stale.get::<bool>(NEEDS_INSTALL_KEY).unwrap());
        let _: Table = eval(&lua, &scripts.install);
        assert_eq!(eval::<String>(&lua, "return CarrierRecovery.VERSION"), MODULE_VERSION);
        assert!(eval::<bool>(&lua, "return CarrierRecovery.active.marker == true"), "state survives an upgrade");

        // Every action pair must be valid Lua.
        for action in [Action::Start, Action::Resume, Action::Status] {
            let s = action_scripts(action, "CVN-71");
            lua.load(&s.probe).into_function().expect("probe compiles");
            lua.load(&s.install).into_function().expect("install compiles");
        }
        assert!(needs_install(&serde_json::json!({ "needs_install": true })));
        assert!(!needs_install(&serde_json::json!({ "ok": true })));
    }

    #[test]
    fn group_name_validation() {
        assert!(is_valid_group_name("CVN-72"));
        assert!(is_valid_group_name("USS Abraham Lincoln"));
        assert!(is_valid_group_name("Carrier.Group_1"));
        assert!(!is_valid_group_name(""));
        assert!(!is_valid_group_name("CVN\"); os.exit() --"));
        assert!(!is_valid_group_name("CVN\n72"));
        assert!(!is_valid_group_name("Ünicode"));
        assert!(!is_valid_group_name(&"x".repeat(65)));
    }

    #[test]
    fn solver_replays_fixture() {
        let lua = world();
        let fixture: serde_json::Value = serde_json::from_str(FIXTURE).expect("fixture parses");
        let cases = fixture["cases"].as_array().expect("cases array");
        assert!(cases.len() >= 10, "fixture should cover every solver branch");
        for case in cases {
            let name = case["name"].as_str().unwrap_or("?");
            let code = format!("return CarrierRecovery.solve({})", lua_literal(&case["input"]));
            let solved: Table = eval(&lua, &code);
            let expected = &case["expected"];
            let heading = num(&solved, "headingDeg");
            let speed = num(&solved, "speedKt");
            let regime = text(&solved, "regime");
            assert!(
                heading_close(heading, expected["headingDeg"].as_f64().unwrap(), 0.05),
                "{name}: heading {heading} != {}",
                expected["headingDeg"]
            );
            assert!(
                (speed - expected["speedKt"].as_f64().unwrap()).abs() <= 0.05,
                "{name}: speed {speed} != {}",
                expected["speedKt"]
            );
            assert_eq!(regime, expected["regime"].as_str().unwrap(), "{name}: regime");
        }
    }

    /// Independent check: the solved course and speed must actually produce
    /// the target wind straight down the angled deck (optimal regime), or the
    /// commanded speed limit (limited regimes).
    #[test]
    fn solver_solutions_satisfy_forward_check() {
        let lua = world();
        let fixture: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        for case in fixture["cases"].as_array().unwrap() {
            let name = case["name"].as_str().unwrap_or("?");
            let input = &case["input"];
            let code = format!(
                "local s = CarrierRecovery.solve({p})\nlocal a = CarrierRecovery.apparentWind({wf}, {ws}, s.headingDeg, s.speedKt, {off})\nreturn {{ regime = s.regime, speedKt = s.speedKt, deckAngleDeg = a.deckAngleDeg, apparentKt = a.speedKt }}",
                p = lua_literal(input),
                wf = input["windFromDeg"],
                ws = input["windSpeedKt"],
                off = input["deckOffsetDeg"],
            );
            let result: Table = eval(&lua, &code);
            let regime = text(&result, "regime");
            let target = input["targetWodKt"].as_f64().unwrap();
            match regime.as_str() {
                "optimal" => {
                    let angle = num(&result, "deckAngleDeg");
                    let apparent = num(&result, "apparentKt");
                    assert!(angle.abs() < 0.2, "{name}: apparent wind {angle} deg off the deck axis");
                    assert!((apparent - target).abs() < 0.2, "{name}: apparent {apparent} kt != target {target}");
                }
                "vmax_limited" => assert_eq!(num(&result, "speedKt"), input["maxSpeedKt"].as_f64().unwrap(), "{name}"),
                "vmin_limited" => assert_eq!(num(&result, "speedKt"), input["minSpeedKt"].as_f64().unwrap(), "{name}"),
                "low_wind" | "weak_wind" => {}
                other => panic!("{name}: unknown regime {other}"),
            }
        }
    }

    /// Regenerates the fixture's expected values from the Lua solver. Run with
    /// `cargo test print_wind_solver_fixture -- --ignored --nocapture` after a
    /// deliberate solver change, then paste the output over the fixture file.
    #[test]
    #[ignore]
    fn print_wind_solver_fixture() {
        let lua = world();
        let mut fixture: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        for case in fixture["cases"].as_array_mut().unwrap() {
            let code = format!("return CarrierRecovery.solve({})", lua_literal(&case["input"]));
            let solved: Table = eval(&lua, &code);
            case["expected"] = serde_json::json!({
                "headingDeg": (num(&solved, "headingDeg") * 1000.0).round() / 1000.0,
                "speedKt": (num(&solved, "speedKt") * 1000.0).round() / 1000.0,
                "regime": text(&solved, "regime"),
            });
        }
        println!("{}", serde_json::to_string_pretty(&fixture).unwrap());
    }

    #[test]
    fn wind_data_reads_dcs_conventions() {
        let lua = world();
        lua.load("Sim.setWind(30, 8); Sim.ship.headingDeg = 90; Sim.ship.speedKt = 12").exec().unwrap();
        let data: Table = eval(&lua, "return CarrierRecovery.windData('CVN-71')");
        assert!(heading_close(num(&data, "windFromDeg"), 30.0, 0.01));
        assert!((num(&data, "windSpeedKt") - 8.0).abs() < 0.01);
        assert!(heading_close(num(&data, "headingDeg"), 90.0, 0.01));
        // Headwind on a 090 course from a 030 wind: 8 * cos(60) = 4 kt.
        assert!((num(&data, "naturalHeadwindKt") - 4.0).abs() < 0.01);
        assert!((num(&data, "windOnDeckKt") - 16.0).abs() < 0.01);
        assert_eq!(num(&data, "deckOffsetDeg"), 9.14);
        assert_eq!(text(&data, "regime"), "optimal");
        // The plain-data report carries the same numbers under the API names.
        let report: Table = eval(&lua, "return CarrierRecovery.windReport('CVN-71')");
        assert!((num(&report, "tw_spd") - 8.0).abs() < 0.01);
        assert!(heading_close(num(&report, "recovery_heading"), num(&data, "recoveryHeadingDeg"), 0.001));
        assert_eq!(num(&report, "target_wod"), 24.0);
    }

    #[test]
    fn weak_wind_keeps_course_and_uses_speed() {
        let lua = world();
        // 2.6 kt from dead astern of a 090 course: headwind is -2.6 kt.
        lua.load("Sim.setWind(270, 2.6); Sim.ship.headingDeg = 90; Sim.ship.speedKt = 10").exec().unwrap();
        let data: Table = eval(&lua, "return CarrierRecovery.windData('CVN-71')");
        assert_eq!(text(&data, "regime"), "weak_wind");
        assert!(heading_close(num(&data, "recoveryHeadingDeg"), 90.0, 0.01));
        assert!((num(&data, "naturalHeadwindKt") + 2.6).abs() < 0.01);
        assert_eq!(num(&data, "recoverySpeedKt"), 27.0, "24 target + 2.6 tailwind, rounded");
    }

    #[test]
    fn straight_deck_types_use_zero_offset() {
        let lua = world();
        lua.load("Sim.setWind(30, 8); Sim.ship.typeName = 'LHA_Tarawa'").exec().unwrap();
        let data: Table = eval(&lua, "return CarrierRecovery.windData('CVN-71')");
        assert_eq!(num(&data, "deckOffsetDeg"), 0.0);
        assert!(heading_close(num(&data, "recoveryHeadingDeg"), 30.0, 0.01), "straight deck steers into the wind");
        assert_eq!(num(&data, "recoverySpeedKt"), 16.0);
    }

    #[test]
    fn foothold_config_globals_apply() {
        let lua = world();
        lua.load("CarrierRecoveryTargetWodKt = 28; CarrierRecoveryMaxSpeedKt = 25; CarrierRecoveryIntoWindEnabled = false")
            .exec()
            .unwrap();
        let cfg: Table = eval(&lua, "return CarrierRecovery.config()");
        assert_eq!(num(&cfg, "targetWodKt"), 28.0);
        assert_eq!(num(&cfg, "maxSpeedKt"), 25.0);
        assert!(!cfg.get::<bool>("enabled").unwrap());
        // Runtime overrides win over mission globals.
        lua.load("CarrierRecovery.overrides.targetWodKt = 20").exec().unwrap();
        let cfg: Table = eval(&lua, "return CarrierRecovery.config()");
        assert_eq!(num(&cfg, "targetWodKt"), 20.0);
    }

    #[test]
    fn land_check_rejects_legs_that_cross_land() {
        let lua = world();
        lua.load("Sim.landAt = function(x, z) if x > 5000 then return 1 end return 3 end").exec().unwrap();
        let safe: bool = eval(&lua, "return CarrierRecovery.straightCourseIsSafe({x=0,z=0}, 0, 3000)");
        let unsafe_: bool = eval(&lua, "return CarrierRecovery.straightCourseIsSafe({x=0,z=0}, 0, 10000)");
        let away: bool = eval(&lua, "return CarrierRecovery.straightCourseIsSafe({x=0,z=0}, 180, 10000)");
        assert!(safe);
        assert!(!unsafe_);
        assert!(away);
        // Lateral clearance also counts: a leg parallel to the coast within 2 NM fails.
        let shore_hugging: bool = eval(&lua, "return CarrierRecovery.straightCourseIsSafe({x=3000,z=0}, 90, 5000)");
        assert!(!shore_hugging);
    }

    #[test]
    fn start_refuses_unsafe_leg_without_touching_the_ship() {
        let lua = world();
        lua.load("Sim.setWind(0, 10); Sim.landAt = function(x, z) if x > 2000 then return 1 end return 3 end").exec().unwrap();
        let (ok, message): (bool, String) = eval(&lua, "return CarrierRecovery.start('CVN-71')");
        assert!(!ok);
        assert!(message.starts_with("Unable to turn into wind"), "{message}");
        let routes: usize = eval(&lua, "return #Sim.routes");
        assert_eq!(routes, 0);
        let active: bool = eval(&lua, "return CarrierRecovery.active['CVN-71'] ~= nil");
        assert!(!active);
    }

    #[test]
    fn full_recovery_cycle_returns_to_start_point() {
        let lua = world();
        lua.load("Sim.setWind(30, 8); Sim.ship.headingDeg = 120; Sim.ship.speedKt = 12; Sim.ship.x = 1000; Sim.ship.z = 2000")
            .exec()
            .unwrap();
        let (ok, message): (bool, String) = eval(&lua, "return CarrierRecovery.start('CVN-71')");
        assert!(ok, "{message}");
        let phase: String = eval(&lua, "return CarrierRecovery.active['CVN-71'].phase");
        assert_eq!(phase, "pending");
        assert!(eval::<bool>(&lua, "return Sim.hasText('will turn into wind in 60 seconds')"));
        let (ok, message): (bool, String) = eval(&lua, "return CarrierRecovery.start('CVN-71')");
        assert!(!ok);
        assert!(message.contains("already pending or active"), "{message}");

        // Turn delay elapses: route pushed, phase aligning.
        lua.load("Sim.run(70)").exec().unwrap();
        assert_eq!(eval::<String>(&lua, "return CarrierRecovery.active['CVN-71'].phase"), "aligning");
        assert_eq!(eval::<usize>(&lua, "return #Sim.routes"), 1);
        let commanded: f64 = eval(&lua, "return CarrierRecovery.active['CVN-71'].commandedHeadingDeg");
        let route_len: usize = eval(&lua, "return #Sim.lastRoute()");
        assert_eq!(route_len, 2);
        assert!(eval::<bool>(&lua, "return Sim.hasText('is turning into wind')"));

        // Ship still turning: stays aligning.
        lua.load("Sim.run(100)").exec().unwrap();
        assert_eq!(eval::<String>(&lua, "return CarrierRecovery.active['CVN-71'].phase"), "aligning");

        // Ship on the commanded course for the stable period: active.
        lua.load(&format!("Sim.ship.headingDeg = {commanded}; Sim.run(130)")).exec().unwrap();
        assert_eq!(eval::<String>(&lua, "return CarrierRecovery.active['CVN-71'].phase"), "active");
        assert_eq!(eval::<usize>(&lua, "return #Sim.routes"), 2);
        assert!(eval::<bool>(&lua, "return Sim.hasText('recovery window has started')"));

        // Status reports the active window with remaining time.
        let status: Table = eval(&lua, "return CarrierRecovery.status('CVN-71')");
        assert_eq!(text(&status, "phase"), "active");
        assert!(num(&status, "remaining_sec") > 1700.0);
        assert!(text(&status, "text").contains("recovery active"));

        // Window ends: normal circuit restored, ship sent back to its start point.
        lua.load("Sim.run(130 + 1800 + 20)").exec().unwrap();
        assert!(eval::<bool>(&lua, "return CarrierRecovery.active['CVN-71'] == nil"));
        assert_eq!(eval::<usize>(&lua, "return #Sim.routes"), 3);
        let last: Table = eval(&lua, "local r = Sim.lastRoute() return r[#r]");
        assert_eq!(num(&last, "x"), 1000.0);
        assert_eq!(num(&last, "y"), 2000.0);
        assert!(eval::<bool>(&lua, "return Sim.hasText('recovery window is over')"));
        // No further monitor ticks are scheduled once the recovery is over.
        lua.load("Sim.run(9999)").exec().unwrap();
        assert_eq!(eval::<usize>(&lua, "return #Sim.routes"), 3);
    }

    #[test]
    fn manual_resume_and_resume_when_idle() {
        let lua = world();
        lua.load("Sim.setWind(30, 8)").exec().unwrap();
        let (ok, message): (bool, String) = eval(&lua, "return CarrierRecovery.restore('manual', 'CVN-71')");
        assert!(!ok);
        assert!(message.contains("not in recovery-course mode"), "{message}");
        let _: (bool, String) = eval(&lua, "return CarrierRecovery.start('CVN-71')");
        lua.load("Sim.run(70)").exec().unwrap();
        let (ok, _): (bool, String) = eval(&lua, "return CarrierRecovery.restore('manual', 'CVN-71')");
        assert!(ok);
        assert!(eval::<bool>(&lua, "return CarrierRecovery.active['CVN-71'] == nil"));
        assert!(eval::<bool>(&lua, "return Sim.hasText('resuming its normal circuit')"));
        let status: Table = eval(&lua, "return CarrierRecovery.status('CVN-71')");
        assert_eq!(text(&status, "phase"), "normal");
    }

    #[test]
    fn alignment_timeout_aborts_and_restores() {
        let lua = world();
        lua.load("Sim.setWind(30, 8); Sim.ship.headingDeg = 200").exec().unwrap();
        let _: (bool, String) = eval(&lua, "return CarrierRecovery.start('CVN-71')");
        // Ship never turns: after the alignment timeout the recovery is aborted.
        lua.load("Sim.run(60 + 300 + 30)").exec().unwrap();
        assert!(eval::<bool>(&lua, "return CarrierRecovery.active['CVN-71'] == nil"));
        assert!(eval::<bool>(&lua, "return Sim.hasText('aborted for navigation safety')"));
    }

    #[test]
    fn editor_route_is_used_to_resume() {
        let lua = world();
        lua.load(
            r#"
            Sim.dict["DictKey_GroupName_5"] = "CVN-71"
            env.mission.coalition = { blue = { country = { { ship = { group = { {
              name = "DictKey_GroupName_5",
              route = { points = {
                { x = 0, y = 0, speed = 10, task = { id = "ComboTask", params = { tasks = { { id = "WrappedAction" } } } } },
                { x = 20000, y = 0, speed = 12 },
                { x = 20000, y = 20000, speed = 12 },
                { x = 0, y = 20000, speed = 12 },
              } },
            } } } } } } }
            Sim.setWind(30, 8)
            Sim.ship.x = 19000; Sim.ship.z = 18000
            "#,
        )
        .exec()
        .unwrap();
        let points: usize = eval(&lua, "return #CarrierRecovery.editorRoute('CVN-71')");
        assert_eq!(points, 4);
        let _: (bool, String) = eval(&lua, "return CarrierRecovery.start('CVN-71')");
        assert_eq!(eval::<String>(&lua, "return CarrierRecovery.active['CVN-71'].previous.strategy"), "editorRoute");
        lua.load("Sim.run(70)").exec().unwrap();
        let (ok, _): (bool, String) = eval(&lua, "return CarrierRecovery.restore('manual', 'CVN-71')");
        assert!(ok);
        // Current point, then rejoin at the closest editor waypoint (20000, 20000) and continue.
        let route: Table = eval(&lua, "return Sim.lastRoute()");
        assert_eq!(route.len().unwrap(), 3);
        let second: Table = route.get(2).unwrap();
        assert_eq!(num(&second, "x"), 20000.0);
        assert_eq!(num(&second, "y"), 20000.0);
        assert!((num(&second, "speed") - 12.0).abs() < 1e-9, "editor speed kept in m/s");
        let third: Table = route.get(3).unwrap();
        assert_eq!(num(&third, "x"), 0.0);
        assert_eq!(num(&third, "y"), 20000.0);
    }

    #[test]
    fn delegates_to_foothold_when_bc_manages_the_group() {
        let lua = world();
        lua.load(
            r#"
            Sim.groupName = "CVN-72"
            Sim.setWind(30, 8)
            bc = {
              carrierRecoveryIntoWind = nil,
              _carrierRecoveryStart = function(self, id)
                trigger.action.outTextForGroup(id, "A CVN-72 recovery course is already pending or active.", 10)
                return false
              end,
              _carrierRecoveryRestore = function(self, reason, id)
                self.restoredWith = reason
                return true
              end,
            }
            "#,
        )
        .exec()
        .unwrap();
        assert_eq!(eval::<String>(&lua, "return CarrierRecovery.backend('CVN-72')"), "foothold");
        assert_eq!(eval::<String>(&lua, "return CarrierRecovery.backend('CVN-71')"), "standalone");
        let (ok, message): (bool, String) = eval(&lua, "return CarrierRecovery.start('CVN-72')");
        assert!(!ok);
        assert!(message.contains("already pending or active"), "{message}");
        // The capture hook must be removed afterwards.
        assert!(eval::<bool>(&lua, "trigger.action.outTextForGroup(1, 'x', 1) return Sim.texts[#Sim.texts].text == 'x'"));
        let (ok, _): (bool, String) = eval(&lua, "return CarrierRecovery.restore('manual', 'CVN-72')");
        assert!(ok);
        assert_eq!(eval::<String>(&lua, "return bc.restoredWith"), "manual");
        // Status reads Foothold's state table.
        lua.load("bc.carrierRecoveryIntoWind = { phase = 'active', activeUntil = 900 }").exec().unwrap();
        let status: Table = eval(&lua, "return CarrierRecovery.status('CVN-72')");
        assert_eq!(text(&status, "backend"), "foothold");
        assert_eq!(text(&status, "phase"), "active");
        assert_eq!(num(&status, "remaining_sec"), 900.0);
    }

    #[test]
    fn install_menus_is_idempotent() {
        let lua = world();
        let first: Table = eval(&lua, "return CarrierRecovery.installMenus('CVN-71')");
        let second: Table = eval(&lua, "return CarrierRecovery.installMenus('CVN-71')");
        assert_eq!(text(&first, "name"), "CVN-71");
        assert_eq!(text(&second, "name"), "CVN-71");
        assert!(eval::<bool>(&lua, "return CarrierRecovery.menus.root[2] ~= nil"));
    }

    // --- multi-carrier (detection, batching, per-group overrides) -----------

    /// A fleet with one of everything: the default CVN, a Tarawa, a Kuznetsov,
    /// a destroyer, a modded hull with odd attributes and a red carrier.
    fn fleet_world() -> Lua {
        let lua = world();
        lua.load(
            r#"
            Sim.setWind(30, 8)
            Sim.addShip({ groupName = "Tarawa", typeName = "LHA_Tarawa", coalition = 2, headingDeg = 90,
              attributes = { ["Ships"] = true, ["HelicopterCarrier"] = true, ["Heavy armed ships"] = true } })
            Sim.addShip({ groupName = "Kuznetsov", typeName = "KUZNECOW", coalition = 1,
              attributes = { ["Ships"] = true, ["AircraftCarrier"] = true, ["AircraftCarrier With Arresting Gear"] = true } })
            Sim.addShip({ groupName = "Escort", typeName = "USS_Arleigh_Burke_IIa", coalition = 2,
              attributes = { ["Ships"] = true, ["Frigates"] = true } })
            Sim.addShip({ groupName = "HMS Invincible", typeName = "hms_invincible_mod", coalition = 2,
              attributes = { ["Ships"] = true, ["Heavy armed ships"] = true } })
            Sim.addShip({ groupName = "Sunk", typeName = "CVN_73", coalition = 2, exists = false,
              attributes = { ["AircraftCarrier With Catapult"] = true } })
            "#,
        )
        .exec()
        .unwrap();
        lua
    }

    #[test]
    fn classify_deck_from_attributes_and_type_hints() {
        let lua = world();
        let class = |desc: &str, type_name: &str| -> Option<String> {
            eval::<Option<String>>(&lua, &format!("return (CarrierRecovery.classifyDeck({desc}, {type_name:?}))"))
        };
        assert_eq!(class(r#"{ attributes = { ["AircraftCarrier With Catapult"] = true } }"#, "CVN_72").as_deref(), Some("catobar"));
        assert_eq!(class(r#"{ attributes = { ["AircraftCarrier"] = true, ["AircraftCarrier With Arresting Gear"] = true } }"#, "KUZNECOW").as_deref(), Some("stobar"));
        assert_eq!(class(r#"{ attributes = { ["AircraftCarrier"] = true } }"#, "Forrestal").as_deref(), Some("stobar"));
        assert_eq!(class(r#"{ attributes = { ["HelicopterCarrier"] = true } }"#, "LHA_Tarawa").as_deref(), Some("vstol"));
        assert_eq!(class(r#"{ attributes = { "Ships", "Landing Ships" } }"#, "Type_071").as_deref(), Some("vstol"), "list-form attributes");
        // A VSTOL hull that also claims AircraftCarrier stays vstol.
        assert_eq!(class(r#"{ attributes = { ["AircraftCarrier"] = true, ["HelicopterCarrier"] = true } }"#, "L61").as_deref(), Some("vstol"));
        assert_eq!(class(r#"{ attributes = { ["Ships"] = true } }"#, "hms_invincible").as_deref(), Some("unknown"));
        assert_eq!(class(r#"{ attributes = { ["Ships"] = true, ["Frigates"] = true } }"#, "USS_Arleigh_Burke_IIa"), None);
        assert_eq!(class("nil", "CVN_75").as_deref(), Some("unknown"), "no desc at all falls back to the type hint");
        // Matched attributes are reported for the dashboard header.
        let matched: Vec<String> = eval(&lua, r#"local _, m = CarrierRecovery.classifyDeck({ attributes = { ["AircraftCarrier With Catapult"] = true, ["AircraftCarrier With Arresting Gear"] = true } }, "CVN_71") return m"#);
        assert_eq!(matched, vec!["AircraftCarrier With Catapult", "AircraftCarrier With Arresting Gear"]);
    }

    #[test]
    fn list_carriers_finds_every_hull_and_skips_the_rest() {
        let lua = fleet_world();
        let result: Table = eval(&lua, "return CarrierRecovery.listCarriers()");
        let carriers: Table = result.get("carriers").unwrap();
        let mut rows: Vec<(String, String, String, i64, f64, String)> = Vec::new();
        for row in carriers.sequence_values::<Table>() {
            let row = row.unwrap();
            rows.push((
                text(&row, "group"),
                text(&row, "type"),
                text(&row, "deck_class"),
                row.get::<i64>("coalition").unwrap(),
                num(&row, "deck_offset"),
                text(&row, "backend"),
            ));
        }
        assert_eq!(
            rows,
            vec![
                ("CVN-71".into(), "CVN_71".into(), "catobar".into(), 2, 9.14, "standalone".into()),
                ("HMS Invincible".into(), "hms_invincible_mod".into(), "unknown".into(), 2, 9.14, "standalone".into()),
                ("Kuznetsov".into(), "KUZNECOW".into(), "stobar".into(), 1, 9.14, "standalone".into()),
                ("Tarawa".into(), "LHA_Tarawa".into(), "vstol".into(), 2, 0.0, "standalone".into()),
            ]
        );
        // The Escort (no carrier attribute, no type hint) and the sunk CVN are absent.
        let first: Table = carriers.get(1).unwrap();
        assert_eq!(text(&first, "unit"), "CVN-71-1");
        assert_eq!(num(&first, "target_wod"), 24.0);
        assert_eq!(text(&first, "recovery_phase"), "normal");
        // The scripts the backend sends compile and answer the same.
        let scripts = list_carriers_scripts();
        let via_probe: Table = eval(&lua, &scripts.probe);
        assert_eq!(via_probe.get::<Table>("carriers").unwrap().len().unwrap(), 4);
    }

    #[test]
    fn deck_class_drives_the_solver_offset() {
        let lua = fleet_world();
        // The Tarawa has no straight-deck type pattern hit needed: HelicopterCarrier is enough.
        lua.load("CarrierRecovery.overrides.straightDeckTypes = {}").exec().unwrap();
        let tarawa: Table = eval(&lua, "return CarrierRecovery.windReport('Tarawa')");
        assert_eq!(num(&tarawa, "deck_offset"), 0.0);
        assert_eq!(text(&tarawa, "deck_class"), "vstol");
        assert!(heading_close(num(&tarawa, "recovery_heading"), 30.0, 0.01));
        let cvn: Table = eval(&lua, "return CarrierRecovery.windReport('CVN-71')");
        assert_eq!(num(&cvn, "deck_offset"), 9.14);
        assert_eq!(text(&cvn, "deck_class"), "catobar");
        assert_eq!(cvn.get::<i64>("coalition").unwrap(), 2);
    }

    #[test]
    fn batched_reports_keyed_by_name_with_missing_ship() {
        let lua = fleet_world();
        let scripts = wind_reports_scripts(&["CVN-71".to_string(), "Tarawa".to_string(), "Ghost".to_string()]);
        assert!(scripts.probe.contains(r#"windReports({ "CVN-71", "Tarawa", "Ghost" })"#));
        let result: Table = eval(&lua, &scripts.install);
        let reports: Table = result.get("reports").unwrap();
        let cvn: Table = reports.get("CVN-71").unwrap();
        let tarawa: Table = reports.get("Tarawa").unwrap();
        let ghost: Table = reports.get("Ghost").unwrap();
        assert_eq!(text(&cvn, "carrier_name"), "CVN-71");
        assert!((num(&cvn, "tw_spd") - 8.0).abs() < 0.01);
        assert!(heading_close(num(&tarawa, "brc"), 90.0, 0.01));
        assert!(text(&ghost, "error").contains("Ghost is not available"));
        // Escort is a ship but not a carrier: it still reports (the page may add it by name).
        let only_escort: Table = eval(&lua, "return CarrierRecovery.windReports({ 'Escort' }).reports.Escort");
        assert_eq!(text(&only_escort, "carrier_name"), "Escort");
        assert!(matches!(only_escort.get::<Value>("deck_class").unwrap(), Value::Nil));
    }

    #[test]
    fn group_override_changes_one_ship_only() {
        let lua = fleet_world();
        let scripts = group_config_scripts("CVN-71", 28.0);
        assert!(scripts.probe.contains(r#"setGroupOverrides("CVN-71", { targetWodKt = 28 })"#));
        let set: Table = eval(&lua, &scripts.install);
        assert_eq!(num(&set, "target_wod"), 28.0);
        assert_eq!(text(&set, "carrier_name"), "CVN-71");

        let cvn: Table = eval(&lua, "return CarrierRecovery.windReport('CVN-71')");
        let tarawa: Table = eval(&lua, "return CarrierRecovery.windReport('Tarawa')");
        assert_eq!(num(&cvn, "target_wod"), 28.0);
        assert_eq!(num(&tarawa, "target_wod"), 24.0, "other ships keep the default");
        // 8 kt wind, 9.14 deg deck: optimal regime, speed follows the target.
        let baseline: Table = eval(&lua, "CarrierRecovery.groupOverrides['CVN-71'] = nil return CarrierRecovery.windReport('CVN-71')");
        assert!(num(&cvn, "recovery_speed") > num(&baseline, "recovery_speed"));
        assert_eq!(num(&baseline, "target_wod"), 24.0);
        // The Foothold global is untouched for a stand-alone group.
        assert!(eval::<bool>(&lua, "return CarrierRecoveryTargetWodKt == nil"));

        // Clamping, mission globals ordering and clearing.
        let clamped: Table = eval(&lua, "return CarrierRecovery.setGroupOverrides('Tarawa', { targetWodKt = 99 })");
        assert_eq!(num(&clamped, "target_wod"), 45.0);
        lua.load("CarrierRecoveryTargetWodKt = 26").exec().unwrap();
        assert_eq!(eval::<f64>(&lua, "return CarrierRecovery.config('Tarawa').targetWodKt"), 45.0, "group override beats the mission global");
        assert_eq!(eval::<f64>(&lua, "return CarrierRecovery.config('Kuznetsov').targetWodKt"), 26.0);
        assert_eq!(eval::<f64>(&lua, "return CarrierRecovery.config().targetWodKt"), 26.0);
        let cleared: Table = eval(&lua, "return CarrierRecovery.setGroupOverrides('Tarawa', { clearTargetWodKt = true })");
        assert_eq!(num(&cleared, "target_wod"), 26.0);
        assert!(eval::<bool>(&lua, "return CarrierRecovery.groupOverrides['Tarawa'] == nil"));
        let bad: Table = eval(&lua, "return CarrierRecovery.setGroupOverrides('Tarawa', { targetWodKt = 'fast' })");
        assert!(text(&bad, "error").contains("must be a number"));
        // Status reports the effective target for the panel table.
        let status: Table = eval(&lua, "return CarrierRecovery.status('Kuznetsov')");
        assert_eq!(num(&status, "target_wod"), 26.0);
    }

    #[test]
    fn group_override_is_used_by_a_running_recovery() {
        let lua = world();
        lua.load("Sim.setWind(30, 8); Sim.ship.headingDeg = 120; Sim.ship.speedKt = 12").exec().unwrap();
        lua.load("CarrierRecovery.setGroupOverrides('CVN-71', { targetWodKt = 30 })").exec().unwrap();
        let (ok, message): (bool, String) = eval(&lua, "return CarrierRecovery.start('CVN-71')");
        assert!(ok, "{message}");
        lua.load("Sim.run(70)").exec().unwrap();
        let commanded: f64 = eval(&lua, "return CarrierRecovery.active['CVN-71'].commandedSpeedKt");
        let expected: f64 = eval(&lua, "return CarrierRecovery.windData('CVN-71').recoverySpeedKt");
        assert_eq!(commanded, expected);
        let default_speed: f64 = eval(&lua, "return CarrierRecovery.solve({ windFromDeg = 30, windSpeedKt = 8, targetWodKt = 24, deckOffsetDeg = 9.14, minSpeedKt = 10, maxSpeedKt = 30, angledDeckMinWindKt = 3 }).speedKt");
        assert!(commanded > default_speed + 4.0, "30 kt target orders more speed than the 24 kt default ({commanded} vs {default_speed})");
        // The turning message carries the higher speed too.
        assert!(eval::<bool>(&lua, &format!("return Sim.hasText('speed {} kt')", commanded as i64)));
    }

    #[test]
    fn foothold_group_override_writes_the_global() {
        let lua = fleet_world();
        lua.load(
            r#"
            Sim.groupName = "CVN-72"
            bc = { _carrierRecoveryStart = function() return true end, _carrierRecoveryRestore = function() return true end }
            "#,
        )
        .exec()
        .unwrap();
        let set: Table = eval(&lua, "return CarrierRecovery.setGroupOverrides('CVN-72', { targetWodKt = 27.5 })");
        assert_eq!(text(&set, "backend"), "foothold");
        assert_eq!(num(&set, "target_wod"), 27.5);
        assert_eq!(eval::<f64>(&lua, "return CarrierRecoveryTargetWodKt"), 27.5, "Foothold's solver reads this global");
        // A stand-alone ship's override does not touch it.
        lua.load("CarrierRecovery.setGroupOverrides('Tarawa', { targetWodKt = 20 })").exec().unwrap();
        assert_eq!(eval::<f64>(&lua, "return CarrierRecoveryTargetWodKt"), 27.5);
        assert_eq!(eval::<f64>(&lua, "return CarrierRecovery.config('Tarawa').targetWodKt"), 20.0);
        // The delegated ship's report shows the Foothold phase.
        lua.load("bc.carrierRecoveryIntoWind = { phase = 'aligning' }").exec().unwrap();
        let report: Table = eval(&lua, "return CarrierRecovery.windReport('CVN-72')");
        assert_eq!(text(&report, "recovery_phase"), "aligning");
        assert_eq!(text(&report, "backend"), "foothold");
    }

    #[test]
    fn straight_deck_target_twenty_knots() {
        let lua = world();
        // Straight deck (offset 0) with a 20 kt target in a 12 kt wind: steer
        // into the wind at 8 kt, clamped up to the 10 kt minimum.
        let solved: Table = eval(&lua, "return CarrierRecovery.solve({ windFromDeg = 200, windSpeedKt = 12, targetWodKt = 20, deckOffsetDeg = 0, minSpeedKt = 10, maxSpeedKt = 30, angledDeckMinWindKt = 3 })");
        assert!(heading_close(num(&solved, "headingDeg"), 200.0, 0.01));
        assert_eq!(num(&solved, "speedKt"), 10.0);
        assert_eq!(text(&solved, "regime"), "vmin_limited");
        let solved: Table = eval(&lua, "return CarrierRecovery.solve({ windFromDeg = 200, windSpeedKt = 6, targetWodKt = 20, deckOffsetDeg = 0, minSpeedKt = 10, maxSpeedKt = 30, angledDeckMinWindKt = 3 })");
        assert!(heading_close(num(&solved, "headingDeg"), 200.0, 0.01));
        assert!((num(&solved, "speedKt") - 14.0).abs() < 1e-6);
        assert_eq!(text(&solved, "regime"), "optimal");
    }

    #[test]
    fn batch_name_parsing_and_target_validation() {
        assert_eq!(parse_group_names("CVN-72, CVN-74,,Tarawa").unwrap(), vec!["CVN-72", "CVN-74", "Tarawa"]);
        assert_eq!(parse_group_names("CVN-72,CVN-72").unwrap(), vec!["CVN-72"], "duplicates collapse");
        assert!(parse_group_names("").is_err());
        assert!(parse_group_names(" , ").is_err());
        assert!(parse_group_names("CVN-72,bad\"name").unwrap_err().contains("Invalid carrier group name"));
        let many: Vec<String> = (0..MAX_BATCH_GROUPS + 1).map(|i| format!("Ship{i}")).collect();
        assert!(parse_group_names(&many.join(",")).unwrap_err().contains("At most"));
        assert!(is_valid_target_wod(10.0));
        assert!(is_valid_target_wod(24.5));
        assert!(is_valid_target_wod(45.0));
        assert!(!is_valid_target_wod(9.99));
        assert!(!is_valid_target_wod(45.01));
        assert!(!is_valid_target_wod(f64::NAN));
        assert!(!is_valid_target_wod(f64::INFINITY));
    }
}
