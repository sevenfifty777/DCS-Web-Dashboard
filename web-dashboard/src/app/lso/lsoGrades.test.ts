import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cell,
  formatPoints,
  gradeClass,
  matchesPilot,
  points,
  shortTimestamp,
  technicalStatus,
  wireOrSpot,
} from './lsoGrades.ts';

test('maps every NAVAIR grade label to the CSS class of the original board', () => {
  assert.equal(gradeClass('_OK_'), 'uni');
  assert.equal(gradeClass('OK'), 'ok');
  assert.equal(gradeClass('(OK)'), 'okp');
  assert.equal(gradeClass('--'), 'ng');
  assert.equal(gradeClass('C'), 'cut');
  assert.equal(gradeClass('B'), 'muted');
  assert.equal(gradeClass('WO'), 'muted');
  assert.equal(gradeClass('NC'), '');
  assert.equal(gradeClass(null), '');
});

test('an incomplete pass with points_awarded=false shows no points even when zero is stored', () => {
  assert.equal(points({ pass_grade: '--', grade_points: 0, points_awarded: false }), undefined);
  assert.equal(formatPoints({ pass_grade: '--', grade_points: 0, points_awarded: false, spot: null }), '-');
});

test('stored grade_points win over the legacy table', () => {
  assert.equal(points({ pass_grade: 'OK', grade_points: 3.5, points_awarded: true }), 3.5);
  assert.equal(points({ pass_grade: 'OK', grade_points: 0, points_awarded: true }), 0);
});

test('legacy rows without grade_points fall back to the grade table', () => {
  assert.equal(points({ pass_grade: '_OK_', grade_points: null, points_awarded: null }), 5);
  assert.equal(points({ pass_grade: 'B', grade_points: null, points_awarded: null }), 2.5);
  assert.equal(points({ pass_grade: 'NC', grade_points: null, points_awarded: null }), undefined);
});

test('points use two decimals for spot landings and one for wires', () => {
  assert.equal(formatPoints({ pass_grade: 'OK', grade_points: 4, points_awarded: true, spot: null }), '4.0');
  assert.equal(formatPoints({ pass_grade: 'OK', grade_points: 3.75, points_awarded: true, spot: '7.5' }), '3.75');
});

test('wire/spot column prefers the V/STOL spot, then the wire, then a dash', () => {
  assert.equal(wireOrSpot({ wire: 3, spot: '7.5' }), '7.5');
  assert.equal(wireOrSpot({ wire: 3, spot: null }), '3');
  assert.equal(wireOrSpot({ wire: null, spot: null }), '-');
});

test('technical status reads Available only for complete observations', () => {
  assert.equal(technicalStatus({ completeness: 'complete' }), 'Available');
  assert.equal(technicalStatus({ completeness: 'partial' }), 'Unavailable — partial');
  assert.equal(technicalStatus({ completeness: null }), 'Unavailable — -');
});

test('timestamp column shows the date and time from the file stem', () => {
  assert.equal(
    shortTimestamp('LSO-20260903-123104-Ghost72TT-s1788429469-g1-p9-c5-t2101520'),
    '2026-09-03 12:31:04',
  );
  assert.equal(shortTimestamp('LSO-20260804-234613-Meteor86Phenex'), '2026-08-04 23:46:13');
  assert.equal(shortTimestamp('LSO-20260804-234613'), '2026-08-04 23:46:13');
  assert.equal(shortTimestamp('LSO-test'), 'LSO-test');
  assert.equal(shortTimestamp(''), '');
});

test('cell renders nulls as a dash and numbers as text', () => {
  assert.equal(cell(null), '-');
  assert.equal(cell(undefined), '-');
  assert.equal(cell(0), '0');
  assert.equal(cell('Caucasus'), 'Caucasus');
});

test('pilot filter is case-insensitive and ignores surrounding whitespace', () => {
  assert.equal(matchesPilot({ pilot_name: 'Meteor 8-6 | Phenex' }, '  phenex '), true);
  assert.equal(matchesPilot({ pilot_name: 'Meteor 8-6 | Phenex' }, 'viper'), false);
  assert.equal(matchesPilot({ pilot_name: 'Anyone' }, ''), true);
  assert.equal(matchesPilot({ pilot_name: 'Viper | 501st', aliases: ['Viper', 'Old Callsign'] }, 'old call'), true);
  assert.equal(matchesPilot({ pilot_name: 'Viper | 501st', aliases: [] }, 'old call'), false);
});
