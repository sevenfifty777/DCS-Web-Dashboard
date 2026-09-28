// Column registry for the LSO tables (greenie board and per-pilot tables).
//
// Every column the two tables can show is declared once here with its header,
// cell and sort key; each table then lists the columns it offers, in default
// order, and which of them start hidden. The user's order, hidden set and sort
// live in `columnPrefs.ts`.

import type { ReactNode } from 'react';
import styles from './page.module.css';
import type { SortValue, TableSpec } from './columnPrefs';
import {
  caseRank,
  cell,
  formatPoints,
  gradeClass,
  gradeNotation,
  gradeRank,
  notesText,
  points,
  recoveryCase,
  recoveryCaseDetail,
  serviceBranch,
  shortTimestamp,
  technicalStatus,
  wireOrSpot,
  type LsoPass,
} from './lsoGrades';
import { ServiceBadge } from './ServiceBadge';

/** Per-row context the table supplies: the pass number shown in the `#` column. */
export interface RowContext {
  index: number;
}

export interface LsoColumn {
  id: string;
  label: string;
  /** Header tooltip. */
  title?: string;
  /** Class for the `<td>`. */
  cellClass?: (pass: LsoPass) => string | undefined;
  /** Tooltip for the `<td>`. */
  cellTitle?: (pass: LsoPass) => string | undefined;
  render: (pass: LsoPass, ctx: RowContext) => ReactNode;
  sortValue: (pass: LsoPass, ctx: RowContext) => SortValue;
}

/** Text key, with the empty/`-` placeholders treated as "no value" so they sort last. */
function text(value: string | null | undefined): SortValue {
  return value == null || value === '' || value === '-' ? null : value;
}

export const LSO_COLUMNS: Record<string, LsoColumn> = {
  index: {
    id: 'index',
    label: '#',
    cellClass: () => styles.index,
    render: (_p, ctx) => ctx.index,
    sortValue: (_p, ctx) => ctx.index,
  },
  timestamp: {
    id: 'timestamp',
    label: 'Timestamp (server local)',
    title: "Recording time on the LSO server's local clock",
    cellClass: () => styles.stamp,
    cellTitle: (p) => p.timestamp,
    render: (p) => shortTimestamp(p.timestamp),
    sortValue: (p) => text(shortTimestamp(p.timestamp)),
  },
  gradeDate: {
    id: 'gradeDate',
    label: 'Grade Date (UTC)',
    title: 'Recovery time in UTC',
    cellClass: () => styles.gdate,
    render: (p) => cell(p.grade_date),
    sortValue: (p) => text(p.grade_date),
  },
  missionTime: {
    id: 'missionTime',
    label: 'Mission Time',
    cellClass: () => styles.gdate,
    render: (p) => cell(p.mission_datetime),
    sortValue: (p) => text(p.mission_datetime),
  },
  lso: {
    id: 'lso',
    label: 'LSO',
    title: 'LSO community: USMC STOVL for the Harrier, US Navy otherwise',
    cellClass: () => styles.badgeCell,
    render: (p) => <ServiceBadge aircraftType={p.aircraft_type} />,
    sortValue: (p) => serviceBranch(p.aircraft_type),
  },
  pilot: {
    id: 'pilot',
    label: 'Pilot',
    render: (p) => cell(p.pilot_name),
    sortValue: (p) => text(p.pilot_name),
  },
  aircraft: {
    id: 'aircraft',
    label: 'Aircraft',
    render: (p) => cell(p.aircraft_type),
    sortValue: (p) => text(p.aircraft_type),
  },
  carrier: {
    id: 'carrier',
    label: 'Carrier',
    render: (p) => cell(p.carrier_name ?? p.carrier_type),
    sortValue: (p) => text(p.carrier_name ?? p.carrier_type),
  },
  map: {
    id: 'map',
    label: 'Map',
    render: (p) => cell(p.map_name),
    sortValue: (p) => text(p.map_name),
  },
  case: {
    id: 'case',
    label: 'Case',
    title: "Recovery case DCS's Marshal orders from the weather (ED rule); hover a cell for details",
    cellClass: () => styles.case,
    cellTitle: (p) => recoveryCaseDetail(p),
    render: (p) => recoveryCase(p),
    sortValue: (p) => caseRank(p),
  },
  grade: {
    id: 'grade',
    label: 'Grade',
    title: 'Sorts worst to best: C, WO, B, --, (OK), OK, _OK_',
    cellClass: (p) => {
      const gc = gradeClass(p.pass_grade);
      return `${styles.grade} ${gc ? styles[gc] : ''}`;
    },
    render: (p) => cell(p.pass_grade),
    sortValue: (p) => gradeRank(p.pass_grade) ?? text(p.pass_grade),
  },
  pts: {
    id: 'pts',
    label: 'Pts',
    cellClass: () => styles.pts,
    render: (p) => formatPoints(p),
    sortValue: (p) => points(p) ?? null,
  },
  wire: {
    id: 'wire',
    label: 'Wire/Spot',
    render: (p) => wireOrSpot(p),
    sortValue: (p) => p.spot ?? p.wire ?? null,
  },
  outcome: {
    id: 'outcome',
    label: 'Outcome',
    render: (p) => cell(p.outcome),
    sortValue: (p) => text(p.outcome),
  },
  technical: {
    id: 'technical',
    label: 'Technical status',
    render: (p) => technicalStatus(p),
    sortValue: (p) => technicalStatus(p),
  },
  dcsGrade: {
    id: 'dcsGrade',
    label: 'DCS Grade',
    cellClass: () => styles.wrap,
    render: (p) => <div className={styles.gradeText}>{gradeNotation(p)}</div>,
    sortValue: (p) => text(gradeNotation(p)),
  },
  notes: {
    id: 'notes',
    label: 'LSO Notes',
    cellClass: () => `${styles.notes} ${styles.wrap}`,
    render: (p) => <div className={styles.notesText}>{notesText(p)}</div>,
    sortValue: (p) => text(p.lso_notes),
  },
};

/** The all-passes greenie board. Carrier is available but off by default. */
export const BOARD_TABLE: TableSpec = {
  storageKey: 'dashboard:lso-columns:board:v1',
  columns: [
    'index', 'timestamp', 'gradeDate', 'missionTime', 'lso', 'pilot', 'aircraft', 'carrier', 'map',
    'case', 'grade', 'pts', 'wire', 'outcome', 'technical', 'dcsGrade', 'notes',
  ],
  defaultHidden: ['carrier'],
};

/** The per-pilot tables: one setting shared by every pilot section. */
export const PILOTS_TABLE: TableSpec = {
  storageKey: 'dashboard:lso-columns:pilots:v1',
  columns: [
    'index', 'timestamp', 'gradeDate', 'missionTime', 'lso', 'aircraft', 'carrier', 'map',
    'case', 'grade', 'pts', 'wire', 'outcome', 'technical', 'dcsGrade', 'notes',
  ],
  defaultHidden: ['timestamp', 'map'],
};
