--[[
  CarrierRecovery: stand-alone "turn into wind" controller for DCS World.

  Ported from the Foothold `zoneCommander.lua` BattleCommander:_carrierRecovery*
  functions (updated copy with the angled-deck minimum-wind rule). This file has
  no dependency on Foothold, MOOSE or MIST. It is embedded in the DCS Web
  Dashboard binary and injected into the running mission through DCS-gRPC
  CustomService.Eval, and it can also be loaded by a mission with a
  DO SCRIPT FILE trigger to get the F10 menu (call CarrierRecovery.installMenus).

  Public API (all group names are Mission Editor group names):
    CarrierRecovery.VERSION
    CarrierRecovery.solve(params)              pure solver, no DCS calls
    CarrierRecovery.windData(groupName)        live ship + wind + solution
    CarrierRecovery.start(groupName, groupId)  -> ok, message
    CarrierRecovery.restore(reason, groupName, groupId) -> ok, message
    CarrierRecovery.status(groupName, groupId) -> table
    CarrierRecovery.installMenus(groupName)

  When the Foothold BattleCommander global `bc` exists and manages the group
  (today only "CVN-72"), start and restore are delegated to it so Foothold
  missions keep their navigation-lane behaviour.
]]

CarrierRecovery = CarrierRecovery or {}
local M = CarrierRecovery

M.VERSION = "1.0.0"

-- Active recoveries keyed by group name. Preserved across a re-injection of a
-- newer module version so a running recovery is not orphaned.
M.active = M.active or {}
M.generation = M.generation or 0
M.captured = M.captured or {}

local KNOTS_PER_MPS = 1.94384449
local MPS_PER_KNOT = 0.514444
local METERS_PER_NM = 1852

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------

-- Same names, same defaults as `Foothold Config.lua`.
M.defaults = {
  enabled = true,
  targetWodKt = 24,
  durationSec = 1800,
  turnDelaySec = 60,
  safetyReserveSec = 300,
  landClearanceNm = 2,
  minSpeedKt = 10,
  maxSpeedKt = 30,
  headingToleranceDeg = 5,
  alignmentTimeoutSec = 300,
  alignmentStableSec = 15,
  angledDeckMinWindKt = 3,
  angledDeckOffsetDeg = 9.14,
  -- Unit type name patterns (string.find, plain) that identify a straight deck.
  straightDeckTypes = { "Tarawa", "LHA", "Type_071", "Juan_Carlos", "L61" },
}

-- Global names read from the mission (Foothold config compatibility).
local FOOTHOLD_GLOBALS = {
  enabled = "CarrierRecoveryIntoWindEnabled",
  targetWodKt = "CarrierRecoveryTargetWodKt",
  durationSec = "CarrierRecoveryDurationSec",
  turnDelaySec = "CarrierRecoveryTurnDelaySec",
  safetyReserveSec = "CarrierRecoverySafetyReserveSec",
  landClearanceNm = "CarrierRecoveryLandClearanceNm",
  minSpeedKt = "CarrierRecoveryMinSpeedKt",
  maxSpeedKt = "CarrierRecoveryMaxSpeedKt",
  headingToleranceDeg = "CarrierRecoveryHeadingToleranceDeg",
  alignmentTimeoutSec = "CarrierRecoveryAlignmentTimeoutSec",
  alignmentStableSec = "CarrierRecoveryAlignmentStableSec",
  angledDeckMinWindKt = "CarrierRecoveryAngledDeckMinWindKt",
}

-- Mission-side overrides: set `CarrierRecoveryConfig = { targetWodKt = 25 }`
-- before this file loads, or assign CarrierRecovery.overrides at runtime.
M.overrides = M.overrides or {}

--- Effective configuration, resolved on every call so runtime changes apply.
function M.config()
  local cfg = {}
  for key, value in pairs(M.defaults) do cfg[key] = value end
  for key, globalName in pairs(FOOTHOLD_GLOBALS) do
    local value = _G[globalName]
    if value ~= nil then
      if key == "enabled" then
        cfg.enabled = value ~= false
      else
        cfg[key] = tonumber(value) or cfg[key]
      end
    end
  end
  local missionOverrides = _G.CarrierRecoveryConfig
  if type(missionOverrides) == "table" then
    for key, value in pairs(missionOverrides) do cfg[key] = value end
  end
  for key, value in pairs(M.overrides) do cfg[key] = value end
  return cfg
end

--- Angled-deck offset for a unit type name, in degrees (0 for straight decks).
function M.deckOffsetForType(typeName, cfg)
  cfg = cfg or M.config()
  local name = tostring(typeName or "")
  for _, pattern in ipairs(cfg.straightDeckTypes or {}) do
    if name:find(pattern, 1, true) then return 0 end
  end
  return tonumber(cfg.angledDeckOffsetDeg) or 9.14
end

-- ---------------------------------------------------------------------------
-- Messages (English strings from Foothold_Localization.lua)
-- ---------------------------------------------------------------------------

M.messages = M.messages or {
  WARNING = "%s will turn into wind in %d seconds.",
  TURNING = "%s is turning into wind: course %03d°, speed %d kt.",
  ACTIVE = "%s is established into wind. The %d-minute recovery window has started.",
  RESUMED = "%s is resuming its normal circuit.",
  ABORTED = "%s recovery course aborted for navigation safety. Normal circuit is resuming.",
  COMPLETE = "%s recovery window is over. Normal circuit is resuming.",
  RETURN_FAILED = "%s could not resume its normal circuit.",
  UNSAFE = "Unable to turn into wind: less than %d minutes plus %d minutes safety reserve is available with %.1f NM land clearance.",
  DISABLED = "%s recovery course control is disabled.",
  ALREADY_ACTIVE = "A %s recovery course is already pending or active.",
  NOT_ACTIVE = "%s is not in recovery-course mode.",
  GROUP_UNAVAILABLE = "%s is not available.",
  STATE_NORMAL = "normal circuit",
  STATE_PENDING = "turn pending",
  STATE_ALIGNING = "turning into wind",
  STATE_ACTIVE = "recovery active",
  STATUS = "%s recovery status: %s\nCourse: %03.0f°\nNatural wind: from %03.0f° at %.1f kt\nHeadwind component: %.1f kt\nWind over deck: %.1f kt\nShip speed: %.1f kt\nTime remaining: %02d:%02d",
  MENU_ROOT = "Carrier Recovery",
  MENU_START = "Turn %s into wind",
  MENU_RESUME = "Resume normal %s circuit",
  MENU_STATUS = "%s recovery status",
}

local function fmt(key, ...)
  local template = M.messages[key] or key
  local ok, text = pcall(string.format, template, ...)
  if ok then return text end
  return template
end

-- ---------------------------------------------------------------------------
-- Geometry helpers (ported verbatim from the Foothold local functions)
-- ---------------------------------------------------------------------------

function M.normalizeHeadingDeg(heading)
  local h = tonumber(heading)
  if not h then return nil end
  h = h % 360
  if h < 0 then h = h + 360 end
  return h
end

function M.headingDiff(a, b)
  if not a or not b then return 360 end
  return math.abs((a - b + 180) % 360 - 180)
end

function M.headingFromUnit(unit)
  local pos = unit and unit.getPosition and unit:getPosition() or nil
  if not pos or not pos.x then return nil end
  return M.normalizeHeadingDeg(math.deg(math.atan2(pos.x.z, pos.x.x)))
end

local function waypoint(point, speedMps, task)
  return {
    alt = 0,
    type = "Turning Point",
    alt_type = "BARO",
    formation_template = "",
    y = point.z,
    x = point.x,
    ETA_locked = false,
    speed = speedMps,
    action = "Turning Point",
    task = task or { id = "ComboTask", params = { tasks = {} } },
    speed_locked = true,
  }
end
M.waypoint = waypoint

-- ---------------------------------------------------------------------------
-- Solver
-- ---------------------------------------------------------------------------

--- Pure turn-into-wind solver. `params`:
---   windFromDeg, windSpeedKt      natural wind (true, "from")
---   targetWodKt                    wanted wind over the angled deck
---   deckOffsetDeg                  angled-deck offset (0 = straight deck)
---   minSpeedKt, maxSpeedKt         ship speed limits
---   angledDeckMinWindKt            below this wind the ship keeps its course
---   headingDeg                     current ship course (weak-wind fallback)
---   naturalHeadwindKt              headwind component on the current course
--- Returns { headingDeg, speedKt, regime } with regime one of
--- "optimal", "vmax_limited", "vmin_limited", "low_wind", "weak_wind".
function M.solve(params)
  local windFromDeg = M.normalizeHeadingDeg(params.windFromDeg) or 0
  local windSpeedKt = tonumber(params.windSpeedKt) or 0
  local targetWod = tonumber(params.targetWodKt) or 24
  local minSpeed = tonumber(params.minSpeedKt) or 10
  local maxSpeed = tonumber(params.maxSpeedKt) or 30
  local angledDeckMinWindKt = tonumber(params.angledDeckMinWindKt) or 3
  local offset = tonumber(params.deckOffsetDeg) or 9.14
  local headingDeg = M.normalizeHeadingDeg(params.headingDeg) or windFromDeg
  local naturalHeadwindKt = tonumber(params.naturalHeadwindKt) or 0

  local recoveryHeadingDeg = windFromDeg
  local recoverySpeedKt = targetWod - windSpeedKt
  local regime = "optimal"

  if windSpeedKt >= angledDeckMinWindKt then
    local windto = (windFromDeg + 180) % 360
    local alpha = math.rad(offset)

    local C = math.sqrt((math.cos(alpha) ^ 2) / (math.sin(alpha) ^ 2) + 1)
    local vdeckMax = windSpeedKt + math.cos(alpha) * maxSpeed
    local vdeckMin = windSpeedKt + math.cos(alpha) * minSpeed

    local v = 0
    local theta = 0

    if targetWod > vdeckMax then
      v = maxSpeed
      local arg = v / (windSpeedKt * C)
      if arg > 1 then arg = 1 elseif arg < -1 then arg = -1 end
      theta = math.asin(arg) - math.asin(-1 / C)
      regime = "vmax_limited"
    elseif targetWod < vdeckMin then
      v = minSpeed
      local arg = v / (windSpeedKt * C)
      if arg > 1 then arg = 1 elseif arg < -1 then arg = -1 end
      theta = math.asin(arg) - math.asin(-1 / C)
      regime = "vmin_limited"
    elseif targetWod * math.sin(alpha) > windSpeedKt then
      theta = math.pi / 2
      local sq = targetWod ^ 2 - windSpeedKt ^ 2
      v = math.sqrt(sq > 0 and sq or 0)
      regime = "low_wind"
    else
      theta = math.asin((targetWod * math.sin(alpha)) / windSpeedKt)
      v = targetWod * math.cos(alpha) - windSpeedKt * math.cos(theta)
      regime = "optimal"
    end

    recoveryHeadingDeg = (540 + windto + math.deg(theta)) % 360
    recoverySpeedKt = v
  else
    -- With weak wind, trying to align the relative airflow with the angled
    -- deck can demand a large, operationally pointless course change. Keep
    -- the current course and compensate only with ship speed, using the
    -- actual headwind component (negative when the natural wind is astern).
    recoveryHeadingDeg = headingDeg
    recoverySpeedKt = targetWod - naturalHeadwindKt
    regime = "weak_wind"
  end
  if recoverySpeedKt < minSpeed then recoverySpeedKt = minSpeed end
  if recoverySpeedKt > maxSpeed then recoverySpeedKt = maxSpeed end

  return {
    headingDeg = M.normalizeHeadingDeg(recoveryHeadingDeg),
    speedKt = recoverySpeedKt,
    regime = regime,
  }
end

--- Apparent wind that results from a ship course and speed in a natural
--- wind. Returns { fromDeg, speedKt, deckAngleDeg } where deckAngleDeg is the
--- angle between the apparent wind and the angled deck axis (0 = straight
--- down the deck). Used by the tests as an independent oracle.
function M.apparentWind(windFromDeg, windSpeedKt, shipHeadingDeg, shipSpeedKt, deckOffsetDeg)
  local wx = windSpeedKt * math.sin(math.rad(windFromDeg))
  local wy = windSpeedKt * math.cos(math.rad(windFromDeg))
  local sx = shipSpeedKt * math.sin(math.rad(shipHeadingDeg))
  local sy = shipSpeedKt * math.cos(math.rad(shipHeadingDeg))
  local ax, ay = wx + sx, wy + sy
  local speed = math.sqrt(ax * ax + ay * ay)
  local fromDeg = M.normalizeHeadingDeg(math.deg(math.atan2(ax, ay))) or 0
  local deckHeading = M.normalizeHeadingDeg(shipHeadingDeg - (deckOffsetDeg or 0))
  local diff = (fromDeg - deckHeading + 540) % 360 - 180
  return { fromDeg = fromDeg, speedKt = speed, deckAngleDeg = diff }
end

-- ---------------------------------------------------------------------------
-- Live data
-- ---------------------------------------------------------------------------

local function leadUnit(groupName)
  local group = Group.getByName(groupName)
  if not group or not group:isExist() or group:getSize() == 0 then return nil end
  local lead = group:getUnit(1)
  if not lead or not lead:isExist() then return nil end
  return group, lead
end

--- Ship state, natural wind at deck height and the recovery solution.
function M.windData(groupName)
  local group, lead = leadUnit(groupName)
  if not group then return nil end
  local point = lead:getPoint()
  local pos = lead:getPosition()
  if not point or not pos or not pos.x then return nil end

  local cfg = M.config()
  local wind = atmosphere.getWind({ x = point.x, y = (point.y or 0) + 18, z = point.z }) or { x = 0, y = 0, z = 0 }
  local headingDeg = M.headingFromUnit(lead) or 0
  local windSpeedKt = math.sqrt(((wind.x or 0) ^ 2) + ((wind.z or 0) ^ 2)) * KNOTS_PER_MPS
  -- With virtually no natural wind, every heading is equivalent. Keeping the
  -- current course avoids an arbitrary turn caused by atan2(0, 0).
  local windFromDeg = headingDeg
  if windSpeedKt >= 0.5 then
    windFromDeg = M.normalizeHeadingDeg(math.deg(math.atan2(-(wind.z or 0), -(wind.x or 0)))) or headingDeg
  end
  local velocity = lead:getVelocity() or { x = 0, y = 0, z = 0 }
  local shipSpeedKt = math.sqrt(((velocity.x or 0) ^ 2) + ((velocity.z or 0) ^ 2)) * KNOTS_PER_MPS
  local naturalHeadwindKt = (-(wind.x or 0) * pos.x.x - (wind.z or 0) * pos.x.z) * KNOTS_PER_MPS
  local windOnDeckKt = shipSpeedKt + naturalHeadwindKt
  local typeName = lead.getTypeName and lead:getTypeName() or ""
  local deckOffsetDeg = M.deckOffsetForType(typeName, cfg)

  local solved = M.solve({
    windFromDeg = windFromDeg,
    windSpeedKt = windSpeedKt,
    targetWodKt = cfg.targetWodKt,
    deckOffsetDeg = deckOffsetDeg,
    minSpeedKt = cfg.minSpeedKt,
    maxSpeedKt = cfg.maxSpeedKt,
    angledDeckMinWindKt = cfg.angledDeckMinWindKt,
    headingDeg = headingDeg,
    naturalHeadwindKt = naturalHeadwindKt,
  })

  return {
    group = group,
    lead = lead,
    point = point,
    groupName = groupName,
    typeName = typeName,
    coalition = group.getCoalition and group:getCoalition() or 2,
    headingDeg = headingDeg,
    windFromDeg = windFromDeg,
    windSpeedKt = windSpeedKt,
    naturalHeadwindKt = naturalHeadwindKt,
    windOnDeckKt = windOnDeckKt,
    shipSpeedKt = shipSpeedKt,
    recoveryHeadingDeg = solved.headingDeg,
    recoverySpeedKt = math.floor(solved.speedKt + 0.5),
    regime = solved.regime,
    deckOffsetDeg = deckOffsetDeg,
    targetWodKt = cfg.targetWodKt,
    minSpeedKt = cfg.minSpeedKt,
    maxSpeedKt = cfg.maxSpeedKt,
    angledDeckMinWindKt = cfg.angledDeckMinWindKt,
  }
end

--- Plain-data version of windData for transport over DCS-gRPC (no userdata).
function M.windReport(groupName)
  local data = M.windData(groupName)
  if not data then return { error = fmt("GROUP_UNAVAILABLE", groupName) } end
  return {
    carrier_name = groupName,
    type_name = data.typeName,
    carrier_u = data.point.x,
    carrier_v = data.point.z,
    brc = data.headingDeg,
    ship_spd = data.shipSpeedKt,
    tw_dir = data.windFromDeg,
    tw_spd = data.windSpeedKt,
    headwind = data.naturalHeadwindKt,
    wod = data.windOnDeckKt,
    target_wod = data.targetWodKt,
    recovery_heading = data.recoveryHeadingDeg,
    recovery_speed = data.recoverySpeedKt,
    regime = data.regime,
    deck_offset = data.deckOffsetDeg,
    min_speed = data.minSpeedKt,
    max_speed = data.maxSpeedKt,
    angled_deck_min_wind = data.angledDeckMinWindKt,
    backend = M.backend(groupName),
  }
end

-- ---------------------------------------------------------------------------
-- Navigation safety and routing
-- ---------------------------------------------------------------------------

function M.straightCourseIsSafe(startPoint, headingDeg, distanceMeters, cfg)
  if not startPoint or not headingDeg or not distanceMeters or distanceMeters <= 0 then return false end
  cfg = cfg or M.config()
  local headingRad = math.rad(headingDeg)
  local forwardX, forwardZ = math.cos(headingRad), math.sin(headingRad)
  local sideX, sideZ = -forwardZ, forwardX
  local clearance = (tonumber(cfg.landClearanceNm) or 2) * METERS_PER_NM
  local step = math.min(500, math.max(100, clearance / 4))
  local lateralStep = math.min(0.5 * METERS_PER_NM, math.max(100, clearance / 4))
  local water = land.SurfaceType.WATER
  local shallow = land.SurfaceType.SHALLOW_WATER
  local function crossSectionIsWater(travelled)
    local cx = startPoint.x + forwardX * travelled
    local cz = startPoint.z + forwardZ * travelled
    local lateral = -clearance
    while lateral <= clearance do
      local sType = land.getSurfaceType({ x = cx + sideX * lateral, y = cz + sideZ * lateral })
      if sType ~= water and sType ~= shallow then
        return false
      end
      lateral = lateral + lateralStep
    end
    return true
  end
  local travelled = 0
  while travelled < distanceMeters do
    if not crossSectionIsWater(travelled) then return false end
    travelled = travelled + step
  end
  return crossSectionIsWater(distanceMeters)
end

function M.buildRoute(data, requiredSec, cfg)
  if not data or not data.point then return nil end
  local speedMps = data.recoverySpeedKt * MPS_PER_KNOT
  local distance = speedMps * requiredSec
  local activeHeading = data.recoveryHeadingDeg or data.windFromDeg
  local headingRad = math.rad(activeHeading)
  local startPoint = { x = data.point.x, z = data.point.z }
  if not M.straightCourseIsSafe(startPoint, activeHeading, distance, cfg) then return nil end
  local endPoint = {
    x = startPoint.x + math.cos(headingRad) * distance,
    z = startPoint.z + math.sin(headingRad) * distance,
  }
  return { waypoint(startPoint, speedMps), waypoint(endPoint, speedMps) }
end

function M.setRoute(group, routePoints)
  group:getController():setTask({
    id = "Mission",
    params = { route = { points = routePoints } },
  })
end

local function requiredSeconds(cfg)
  return (tonumber(cfg.durationSec) or 1800) + (tonumber(cfg.safetyReserveSec) or 300)
end

-- ---------------------------------------------------------------------------
-- "Normal circuit" capture for missions without Foothold
-- ---------------------------------------------------------------------------

local function dictValue(value)
  if type(value) == "string" and env and env.getValueDictByKey then
    local ok, resolved = pcall(env.getValueDictByKey, value)
    if ok and type(resolved) == "string" then return resolved end
  end
  return value
end

--- Mission Editor route of a ship group, read from `env.mission`. Returns a
--- list of { x, z, speed (m/s), task } or nil when the group is not found.
function M.editorRoute(groupName)
  local mission = env and env.mission or nil
  if type(mission) ~= "table" or type(mission.coalition) ~= "table" then return nil end
  for _, side in pairs(mission.coalition) do
    for _, country in pairs(type(side.country) == "table" and side.country or {}) do
      local ships = type(country.ship) == "table" and country.ship.group or nil
      for _, group in pairs(type(ships) == "table" and ships or {}) do
        if dictValue(group.name) == groupName then
          local points = {}
          local route = type(group.route) == "table" and group.route.points or nil
          for _, wp in ipairs(type(route) == "table" and route or {}) do
            points[#points + 1] = {
              x = wp.x,
              z = wp.y,
              speed = tonumber(wp.speed) or 0,
              task = wp.task,
            }
          end
          return points
        end
      end
    end
  end
  return nil
end

local function distance2D(a, b)
  local dx, dz = (b.x or 0) - (a.x or 0), (b.z or 0) - (a.z or 0)
  return math.sqrt(dx * dx + dz * dz)
end

--- Snapshot of what the ship was doing before the recovery started.
function M.captureNormalCircuit(data)
  local editor = M.editorRoute(data.groupName)
  return {
    startPoint = { x = data.point.x, z = data.point.z },
    headingDeg = data.headingDeg,
    speedKt = data.shipSpeedKt,
    editorRoute = editor,
    strategy = (editor and #editor >= 2) and "editorRoute" or "returnToStart",
  }
end

--- Route that brings the ship back to its normal circuit from `current`.
function M.normalCircuitRoute(snapshot, current, cfg)
  cfg = cfg or M.config()
  local minMps = (tonumber(cfg.minSpeedKt) or 10) * MPS_PER_KNOT
  if snapshot.strategy == "editorRoute" and snapshot.editorRoute and #snapshot.editorRoute >= 2 then
    local points = snapshot.editorRoute
    -- Rejoin at the closest waypoint after the first one, then continue.
    local bestIndex, bestDistance = 2, math.huge
    for index = 2, #points do
      local d = distance2D(current, points[index])
      if d < bestDistance then bestIndex, bestDistance = index, d end
    end
    local rejoinSpeed = math.max(points[bestIndex].speed or 0, minMps)
    local route = { waypoint(current, rejoinSpeed) }
    for index = bestIndex, #points do
      local wp = points[index]
      route[#route + 1] = waypoint(wp, math.max(wp.speed or 0, minMps), wp.task)
    end
    return route
  end
  local speedMps = math.max((tonumber(snapshot.speedKt) or 0) * MPS_PER_KNOT, minMps)
  return { waypoint(current, speedMps), waypoint(snapshot.startPoint, speedMps) }
end

-- ---------------------------------------------------------------------------
-- Foothold delegation
-- ---------------------------------------------------------------------------

--- "foothold" when the Foothold BattleCommander manages this group, else
--- "standalone".
function M.backend(groupName)
  local bc = _G.bc
  if type(bc) == "table" and bc._carrierRecoveryStart and bc._carrierRecoveryRestore and groupName == "CVN-72" then
    return "foothold"
  end
  return "standalone"
end

-- Foothold reports failures only through outTextForGroup; capture that text
-- so the dashboard can show the reason.
local function callFootholdCapturing(callback)
  local captured
  local original = trigger.action.outTextForGroup
  trigger.action.outTextForGroup = function(_, text, _)
    captured = text
  end
  local ok, result = pcall(callback)
  trigger.action.outTextForGroup = original
  if not ok then return false, tostring(result) end
  return result, captured
end

-- ---------------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------------

local function say(coalitionId, text, seconds)
  if trigger and trigger.action and trigger.action.outTextForCoalition then
    trigger.action.outTextForCoalition(coalitionId, text, seconds or 15)
  end
end

local function sayToGroup(groupId, text, seconds)
  if groupId and trigger and trigger.action and trigger.action.outTextForGroup then
    trigger.action.outTextForGroup(groupId, text, seconds or 10)
  end
end

-- ---------------------------------------------------------------------------
-- State machine
-- ---------------------------------------------------------------------------

function M.start(groupName, groupId)
  groupName = groupName or "CVN-72"
  local cfg = M.config()
  if M.backend(groupName) == "foothold" then
    local group = Group.getByName(groupName)
    local id = groupId or (group and group:getID()) or 0
    local ok, text = callFootholdCapturing(function() return bc:_carrierRecoveryStart(id) end)
    if ok then return true, "ok" end
    return false, text or "failed to start"
  end

  if not cfg.enabled then
    local text = fmt("DISABLED", groupName)
    sayToGroup(groupId, text)
    return false, text
  end
  if M.active[groupName] then
    local text = fmt("ALREADY_ACTIVE", groupName)
    sayToGroup(groupId, text)
    return false, text
  end
  local data = M.windData(groupName)
  if not data then
    local text = fmt("GROUP_UNAVAILABLE", groupName)
    sayToGroup(groupId, text)
    return false, text
  end
  if not M.buildRoute(data, requiredSeconds(cfg), cfg) then
    local text = fmt("UNSAFE",
      math.floor((tonumber(cfg.durationSec) or 1800) / 60),
      math.floor((tonumber(cfg.safetyReserveSec) or 300) / 60),
      tonumber(cfg.landClearanceNm) or 2)
    sayToGroup(groupId, text, 15)
    return false, text
  end

  M.generation = M.generation + 1
  local recovery = {
    groupName = groupName,
    coalition = data.coalition,
    generation = M.generation,
    phase = "pending",
    executeAt = timer.getTime() + (tonumber(cfg.turnDelaySec) or 60),
    previous = M.captureNormalCircuit(data),
  }
  M.active[groupName] = recovery
  say(data.coalition, fmt("WARNING", groupName, tonumber(cfg.turnDelaySec) or 60), 15)
  timer.scheduleFunction(function(param, time)
    return CarrierRecovery.monitor(param, time)
  end, { groupName = groupName, generation = recovery.generation }, timer.getTime() + 5)
  return true, "ok"
end

function M.restore(reason, groupName, groupId)
  groupName = groupName or "CVN-72"
  if M.backend(groupName) == "foothold" then
    local group = Group.getByName(groupName)
    local id = groupId or (group and group:getID()) or 0
    local ok, text = callFootholdCapturing(function() return bc:_carrierRecoveryRestore(reason or "manual", id) end)
    if ok then return true, "ok" end
    return false, text or "failed to resume"
  end

  local recovery = M.active[groupName]
  if not recovery then
    local text = fmt("NOT_ACTIVE", groupName)
    sayToGroup(groupId, text)
    return false, text
  end
  local cfg = M.config()
  local group, lead = leadUnit(groupName)
  local current = lead and lead:getPoint() or nil
  if group and current then
    local ok = pcall(function()
      M.setRoute(group, M.normalCircuitRoute(recovery.previous, { x = current.x, z = current.z }, cfg))
    end)
    if ok then
      M.active[groupName] = nil
      recovery.generation = recovery.generation + 1
      local key = "RESUMED"
      if reason == "unsafe" then key = "ABORTED" elseif reason == "complete" then key = "COMPLETE" end
      say(recovery.coalition, fmt(key, groupName), 15)
      return true, "ok"
    end
  end
  local now = timer.getTime()
  if not recovery.lastRestoreFailureAt or now - recovery.lastRestoreFailureAt >= 30 then
    recovery.lastRestoreFailureAt = now
    say(recovery.coalition, fmt("RETURN_FAILED", groupName), 15)
  end
  return false, fmt("RETURN_FAILED", groupName)
end

function M.monitor(param, time)
  local groupName = param.groupName
  local recovery = M.active[groupName]
  if not recovery or recovery.generation ~= param.generation then return nil end
  local cfg = M.config()
  local data = M.windData(groupName)
  if not data then
    if M.restore("unsafe", groupName) then return nil end
    return time + 15
  end
  local requiredSec = requiredSeconds(cfg)
  local tolerance = tonumber(cfg.headingToleranceDeg) or 5

  if recovery.phase == "pending" then
    if time < recovery.executeAt then return time + 5 end
    local route = M.buildRoute(data, requiredSec, cfg)
    if not route then
      if M.restore("unsafe", groupName) then return nil end
      return time + 15
    end
    M.setRoute(data.group, route)
    recovery.phase = "aligning"
    recovery.commandedHeadingDeg = data.recoveryHeadingDeg or data.windFromDeg
    recovery.commandedSpeedKt = data.recoverySpeedKt
    recovery.alignmentDeadline = time + (tonumber(cfg.alignmentTimeoutSec) or 300)
    say(recovery.coalition, fmt("TURNING", groupName,
      math.floor((data.recoveryHeadingDeg or data.windFromDeg) + 0.5) % 360, data.recoverySpeedKt), 15)
    return time + 5
  end

  if recovery.phase == "aligning" then
    if recovery.alignmentDeadline and time >= recovery.alignmentDeadline then
      if M.restore("unsafe", groupName) then return nil end
      return time + 15
    end
    -- Dynamic weather may move while the ship is still turning. Retarget
    -- before the recovery window starts, never after deck operations begin.
    if M.headingDiff(data.recoveryHeadingDeg or data.windFromDeg, recovery.commandedHeadingDeg) > tolerance then
      local route = M.buildRoute(data, requiredSec, cfg)
      if not route then
        if M.restore("unsafe", groupName) then return nil end
        return time + 15
      end
      M.setRoute(data.group, route)
      recovery.commandedHeadingDeg = data.recoveryHeadingDeg or data.windFromDeg
      recovery.commandedSpeedKt = data.recoverySpeedKt
      recovery.alignmentStableSince = nil
    end

    if M.headingDiff(data.headingDeg, recovery.commandedHeadingDeg) <= tolerance then
      recovery.alignmentStableSince = recovery.alignmentStableSince or time
      if time - recovery.alignmentStableSince < (tonumber(cfg.alignmentStableSec) or 15) then
        return time + 5
      end
      local route = M.buildRoute(data, requiredSec, cfg)
      if not route then
        if M.restore("unsafe", groupName) then return nil end
        return time + 15
      end
      M.setRoute(data.group, route)
      recovery.phase = "active"
      recovery.activeUntil = time + (tonumber(cfg.durationSec) or 1800)
      say(recovery.coalition, fmt("ACTIVE", groupName, math.floor((tonumber(cfg.durationSec) or 1800) / 60)), 15)
    else
      recovery.alignmentStableSince = nil
    end
    return time + 5
  end

  if recovery.phase == "active" then
    if time >= recovery.activeUntil then
      if M.restore("complete", groupName) then return nil end
      return time + 15
    end
    -- Guard against simulator path deviations: always preserve the agreed
    -- five-minute escape margin ahead of the live ship position.
    local reserveSec = tonumber(cfg.safetyReserveSec) or 300
    local reserveDistance = (recovery.commandedSpeedKt or data.recoverySpeedKt) * MPS_PER_KNOT * reserveSec
    local livePoint = { x = data.point.x, z = data.point.z }
    if not M.straightCourseIsSafe(livePoint, recovery.commandedHeadingDeg or data.windFromDeg, reserveDistance, cfg) then
      if M.restore("unsafe", groupName) then return nil end
      return time + 15
    end
    return time + 15
  end
  return nil
end

--- Structured status. Also prints the classic status text to `groupId` when
--- given (F10 menu use).
function M.status(groupName, groupId)
  groupName = groupName or "CVN-72"
  local data = M.windData(groupName)
  if not data then
    local text = fmt("GROUP_UNAVAILABLE", groupName)
    sayToGroup(groupId, text)
    return { error = text, carrier_name = groupName }
  end
  local backend = M.backend(groupName)
  local phase, activeUntil = nil, nil
  if backend == "foothold" then
    local recovery = bc.carrierRecoveryIntoWind
    if recovery then
      phase = recovery.phase or "active"
      activeUntil = recovery.activeUntil
    end
  else
    local recovery = M.active[groupName]
    if recovery then
      phase = recovery.phase or "active"
      activeUntil = recovery.activeUntil
    end
  end
  local stateKey = phase and ("STATE_" .. string.upper(phase)) or "STATE_NORMAL"
  local state = M.messages[stateKey] or M.messages.STATE_NORMAL
  local remaining = activeUntil and math.max(0, activeUntil - timer.getTime()) or 0
  local text = fmt("STATUS", groupName, state, data.headingDeg, data.windFromDeg, data.windSpeedKt,
    data.naturalHeadwindKt, data.windOnDeckKt, data.shipSpeedKt,
    math.floor(remaining / 60), math.floor(remaining % 60))
  sayToGroup(groupId, text, 20)
  return {
    carrier_name = groupName,
    backend = backend,
    phase = phase or "normal",
    state = state,
    course = data.headingDeg,
    wind_from = data.windFromDeg,
    wind_speed = data.windSpeedKt,
    headwind = data.naturalHeadwindKt,
    wod = data.windOnDeckKt,
    ship_speed = data.shipSpeedKt,
    recovery_heading = data.recoveryHeadingDeg,
    recovery_speed = data.recoverySpeedKt,
    regime = data.regime,
    remaining_sec = remaining,
    text = text,
  }
end

-- ---------------------------------------------------------------------------
-- Optional in-game F10 menu (missions that load this file themselves)
-- ---------------------------------------------------------------------------

M.menus = M.menus or {}

function M.installMenus(groupName)
  groupName = groupName or "CVN-72"
  if M.menus[groupName] then return M.menus[groupName] end
  local group = Group.getByName(groupName)
  local coalitionId = group and group.getCoalition and group:getCoalition() or 2
  M.menus.root = M.menus.root or {}
  local root = M.menus.root[coalitionId]
  if not root then
    root = missionCommands.addSubMenuForCoalition(coalitionId, M.messages.MENU_ROOT)
    M.menus.root[coalitionId] = root
  end
  local menu = missionCommands.addSubMenuForCoalition(coalitionId, groupName, root)
  missionCommands.addCommandForCoalition(coalitionId, fmt("MENU_START", groupName), menu, function()
    local ok, text = M.start(groupName)
    if not ok then say(coalitionId, text, 10) end
  end)
  missionCommands.addCommandForCoalition(coalitionId, fmt("MENU_RESUME", groupName), menu, function()
    local ok, text = M.restore("manual", groupName)
    if not ok then say(coalitionId, text, 10) end
  end)
  missionCommands.addCommandForCoalition(coalitionId, fmt("MENU_STATUS", groupName), menu, function()
    local report = M.status(groupName)
    say(coalitionId, report.text or report.error or "Status unavailable", 20)
  end)
  M.menus[groupName] = menu
  return menu
end

if env and env.info then
  env.info("[CarrierRecovery] module " .. M.VERSION .. " loaded")
end

return M
