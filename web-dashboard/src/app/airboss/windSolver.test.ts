import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  SHIP_DEFAULTS,
  apparentWind,
  headingDiff,
  normalizeHeadingDeg,
  solveIntoWind,
  type SolverInput,
  type SolverRegime,
} from './windSolver.ts';

interface FixtureCase {
  name: string;
  input: SolverInput;
  expected: { headingDeg: number; speedKt: number; regime: SolverRegime };
}

const fixturePath = fileURLToPath(new URL('../../../../docs/src/fixtures/wind_solver_cases.json', import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { cases: FixtureCase[] };

test('fixture covers every solver branch', () => {
  const regimes = new Set(fixture.cases.map((c) => c.expected.regime));
  for (const regime of ['optimal', 'vmax_limited', 'vmin_limited', 'low_wind', 'weak_wind']) {
    assert.ok(regimes.has(regime as SolverRegime), `fixture has no ${regime} case`);
  }
});

test('solver replays the shared fixture (same numbers as the Lua controller)', () => {
  for (const c of fixture.cases) {
    const solved = solveIntoWind(c.input);
    assert.ok(
      headingDiff(solved.headingDeg, c.expected.headingDeg) <= 0.05,
      `${c.name}: heading ${solved.headingDeg} != ${c.expected.headingDeg}`,
    );
    assert.ok(
      Math.abs(solved.speedKt - c.expected.speedKt) <= 0.05,
      `${c.name}: speed ${solved.speedKt} != ${c.expected.speedKt}`,
    );
    assert.equal(solved.regime, c.expected.regime, `${c.name}: regime`);
  }
});

test('optimal solutions put the target wind straight down the angled deck', () => {
  for (const c of fixture.cases) {
    const solved = solveIntoWind(c.input);
    const apparent = apparentWind(
      c.input.windFromDeg,
      c.input.windSpeedKt,
      solved.headingDeg,
      solved.speedKt,
      c.input.deckOffsetDeg,
    );
    if (solved.regime === 'optimal') {
      assert.ok(Math.abs(apparent.deckAngleDeg) < 0.2, `${c.name}: ${apparent.deckAngleDeg} deg off the deck axis`);
      assert.ok(Math.abs(apparent.speedKt - c.input.targetWodKt) < 0.2, `${c.name}: apparent ${apparent.speedKt} kt`);
    } else if (solved.regime === 'vmax_limited') {
      assert.equal(solved.speedKt, c.input.maxSpeedKt, c.name);
    } else if (solved.regime === 'vmin_limited') {
      assert.equal(solved.speedKt, c.input.minSpeedKt, c.name);
    }
  }
});

test('defaults match the Lua controller defaults used by the fixture', () => {
  const luaDefaultCase = fixture.cases.find((c) => c.name === 'optimal_030_8kt');
  assert.ok(luaDefaultCase);
  assert.equal(luaDefaultCase.input.deckOffsetDeg, SHIP_DEFAULTS.deckOffsetDeg);
  assert.equal(luaDefaultCase.input.minSpeedKt, SHIP_DEFAULTS.minSpeedKt);
  assert.equal(luaDefaultCase.input.maxSpeedKt, SHIP_DEFAULTS.maxSpeedKt);
  assert.equal(luaDefaultCase.input.angledDeckMinWindKt, SHIP_DEFAULTS.angledDeckMinWindKt);
  assert.equal(luaDefaultCase.input.targetWodKt, SHIP_DEFAULTS.targetWodKt);
});

test('headwind defaults from the wind geometry when not supplied', () => {
  // 2.5 kt from dead astern of a 090 course: weak wind, keep course, add 2.5 kt.
  const solved = solveIntoWind({ ...SHIP_DEFAULTS, windFromDeg: 270, windSpeedKt: 2.5, headingDeg: 90 });
  assert.equal(solved.regime, 'weak_wind');
  assert.equal(solved.headingDeg, 90);
  assert.ok(Math.abs(solved.speedKt - 26.5) < 1e-9);
});

test('heading helpers wrap correctly', () => {
  assert.equal(normalizeHeadingDeg(-10), 350);
  assert.equal(normalizeHeadingDeg(370), 10);
  assert.equal(headingDiff(359, 1), 2);
  assert.equal(headingDiff(90, 270), 180);
});
