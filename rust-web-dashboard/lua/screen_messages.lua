-- ScreenMessages: records every on-screen text message issued from the DCS
-- mission scripting environment so the web dashboard can show them.
--
-- DCS has no server-side event for "text shown on a player's screen". All
-- scripted messages, however, go through `trigger.action.outText*` (Foothold,
-- CTLD, MOOSE, the dashboard's own announcements via DCS-gRPC) or through the
-- Mission Editor trigger actions `a_out_text_delay*`. This module wraps those
-- functions, keeps a ring buffer of what passed through, and serves it by
-- cursor to `GET /api/screen-messages`.
--
-- Injected on demand by the dashboard (see `src/screen_messages.rs`), so it
-- must be safe to load repeatedly and to upgrade in place: wrapping is done
-- once per function (the originals are remembered across upgrades) and the
-- buffer survives an upgrade. The mission scripting state is reset on every
-- mission (re)start, at which point the wrappers are simply gone until the
-- dashboard polls again.

local VERSION = "1.0.0"

local previous = ScreenMessages
local M = {
  VERSION = VERSION,
  -- Oldest entries are dropped past this many.
  MAX_BUFFER = 300,
  buffer = (previous and previous.buffer) or {},
  nextId = (previous and previous.nextId) or 1,
  originals = (previous and previous.originals) or {},
}

local function absTime()
  local ok, t = pcall(timer.getAbsTime)
  if ok and type(t) == "number" then return t end
  return 0
end

-- Append one message. `scope` is one of all/coalition/country/group/unit and
-- `target` the matching coalition id, country id, group id or unit id.
function M.record(scope, target, text, duration, clearView)
  local id = M.nextId
  M.nextId = id + 1
  M.buffer[#M.buffer + 1] = {
    id = id,
    time = absTime(),
    scope = scope,
    target = tonumber(target),
    text = tostring(text or ""),
    duration = tonumber(duration) or 0,
    clear_view = clearView == true,
  }
  while #M.buffer > M.MAX_BUFFER do
    table.remove(M.buffer, 1)
  end
end

-- Messages with an id above `fromId`, oldest first, plus the cursor for the
-- next call. A cursor ahead of the buffer (the mission restarted and ids
-- started over) is treated as 0 so the caller gets everything again.
function M.since(fromId)
  fromId = tonumber(fromId) or 0
  local last = M.nextId - 1
  if fromId > last then fromId = 0 end
  local out = {}
  for _, m in ipairs(M.buffer) do
    if m.id > fromId then out[#out + 1] = m end
  end
  return { messages = out, last = last }
end

-- Replace `holder[name]` with a wrapper that records then forwards. The
-- original is remembered in `M.originals[key]` the first time only, so an
-- upgrade re-wraps the original and never the previous wrapper.
local function wrap(holder, name, key, recordArgs)
  if holder == nil or type(holder[name]) ~= "function" then return end
  local original = M.originals[key] or holder[name]
  M.originals[key] = original
  holder[name] = function(...)
    local ok, err = pcall(recordArgs, ...)
    if not ok then env.warning("[ScreenMessages] record failed: " .. tostring(err)) end
    return original(...)
  end
end

-- Mission scripting API. Signatures per the DCS scripting docs:
--   outText(text, displayTime, clearView)
--   outTextForCoalition(coalitionId, text, displayTime, clearView)
--   outTextForCountry(countryId, text, displayTime, clearView)
--   outTextForGroup(groupId, text, displayTime, clearView)
--   outTextForUnit(unitId, text, displayTime, clearView)
local action = trigger and trigger.action
wrap(action, "outText", "trigger.outText", function(text, duration, clearView)
  M.record("all", nil, text, duration, clearView)
end)
wrap(action, "outTextForCoalition", "trigger.outTextForCoalition", function(target, text, duration, clearView)
  M.record("coalition", target, text, duration, clearView)
end)
wrap(action, "outTextForCountry", "trigger.outTextForCountry", function(target, text, duration, clearView)
  M.record("country", target, text, duration, clearView)
end)
wrap(action, "outTextForGroup", "trigger.outTextForGroup", function(target, text, duration, clearView)
  M.record("group", target, text, duration, clearView)
end)
wrap(action, "outTextForUnit", "trigger.outTextForUnit", function(target, text, duration, clearView)
  M.record("unit", target, text, duration, clearView)
end)

-- Mission Editor trigger actions (MESSAGE TO ALL / COALITION MSG / ...). Field
-- order per MissionEditor/modules/me_trigrules.lua:
--   a_out_text_delay(text, seconds, clearview, startDelay)
--   a_out_text_delay_s(coalition, text, seconds, clearview, startDelay)
--   a_out_text_delay_c(country, text, seconds, clearview, startDelay)
--   a_out_text_delay_g(group, text, seconds, clearview, startDelay)
--   a_out_text_delay_u(unit, text, seconds, clearview, startDelay)
wrap(_G, "a_out_text_delay", "me.a_out_text_delay", function(text, seconds, clearView)
  M.record("all", nil, text, seconds, clearView)
end)
wrap(_G, "a_out_text_delay_s", "me.a_out_text_delay_s", function(target, text, seconds, clearView)
  M.record("coalition", target, text, seconds, clearView)
end)
wrap(_G, "a_out_text_delay_c", "me.a_out_text_delay_c", function(target, text, seconds, clearView)
  M.record("country", target, text, seconds, clearView)
end)
wrap(_G, "a_out_text_delay_g", "me.a_out_text_delay_g", function(target, text, seconds, clearView)
  M.record("group", target, text, seconds, clearView)
end)
wrap(_G, "a_out_text_delay_u", "me.a_out_text_delay_u", function(target, text, seconds, clearView)
  M.record("unit", target, text, seconds, clearView)
end)

ScreenMessages = M
