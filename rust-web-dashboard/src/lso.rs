//! Read-only access to the DCS-gRPC-lso greenie board history.
//!
//! The LSO client (`lso.exe run -o <dir>`) writes one row per completed pass
//! to `<dir>/lso.db` and a trap-sheet PNG pair (`<timestamp>.png`,
//! `<timestamp>-pattern.png`) next to it. This module opens that database
//! read-only and serves rows and charts to the dashboard's LSO page.
//!
//! It deliberately makes **no DCS-gRPC calls**: the board must add zero load on
//! the DCS server (see `docs/src/lso_greenie_board_plan.md`).
//!
//! Schema contract (LSO repo `docs/DATA_CONTRACTS.md`): SQLite migrations are
//! additive only and consumers may ignore unknown fields. Columns are therefore
//! read by name and tolerated when absent, so a dashboard newer than the LSO
//! client (or a legacy `lso.db`) still lists. The `pilot_ucid` column is a
//! private identity key: it is read only to group passes by pilot and is
//! never serialised or logged.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use regex::Regex;
use rusqlite::types::FromSql;
use rusqlite::{params, Connection, OpenFlags, Row};
use serde::Serialize;
use utoipa::ToSchema;

/// Database file name inside the LSO output directory.
pub const DB_FILE: &str = "lso.db";
/// Rows returned by `/api/lso/passes` when no `limit` is given.
pub const DEFAULT_LIMIT: usize = 200;
/// Upper bound for `limit`.
pub const MAX_LIMIT: usize = 2000;

#[derive(Debug, thiserror::Error)]
pub enum LsoError {
    #[error("LSO_DIR is not configured")]
    NotConfigured,
    #[error("{DB_FILE} not found in {}", .0.display())]
    DbMissing(PathBuf),
    #[error("pass {0} not found")]
    PassNotFound(i64),
    #[error("chart file not found for this pass")]
    ChartMissing,
    #[error("lso.db query failed: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

/// One recorded pass, mirroring the LSO client's `StoredPass` minus
/// `pilot_ucid`. Field names match `/api/passes` of the LSO client so the page
/// logic ports one to one.
#[derive(Debug, Serialize, ToSchema)]
pub struct LsoPass {
    pub id: i64,
    /// File stem of the pass artifacts, `LSO-<date>-<pilot>-<recovery-id>`.
    pub timestamp: String,
    pub pilot_name: String,
    pub aircraft_id: Option<i64>,
    pub pass_grade: String,
    pub wire: Option<i64>,
    pub spot: Option<String>,
    pub spot_grade: Option<String>,
    pub spot_distance_m: Option<f64>,
    pub intended_spot: Option<String>,
    pub actual_nearest_spot: Option<String>,
    pub distance_to_intended_spot_m: Option<f64>,
    pub dcs_grading: Option<String>,
    pub aircraft_type: Option<String>,
    pub map_name: Option<String>,
    /// Plain-English translation of `dcs_grading`, computed at query time.
    pub lso_notes: Option<String>,
    pub grade_date: String,
    pub grade_points: Option<f64>,
    pub points_awarded: Option<bool>,
    pub mission_datetime: String,
    pub outcome: String,
    pub recovery_id: Option<String>,
    pub pilot_kind: Option<String>,
    pub carrier_id: Option<i64>,
    pub carrier_name: Option<String>,
    pub carrier_type: Option<String>,
    pub recovery_mode: Option<String>,
    pub session_id: Option<i64>,
    pub generation: Option<i64>,
    pub completeness: Option<String>,
    pub max_sample_gap_ms: Option<f64>,
    pub max_scoring_sample_gap_ms: Option<f64>,
    pub max_skew_ms: Option<f64>,
    pub telemetry_health: Option<String>,
    pub wire_estimated: Option<i64>,
    pub wire_dcs: Option<i64>,
    pub wire_divergent: Option<bool>,
    pub confidence: Option<String>,
    pub cause: Option<String>,
    pub grading_version: Option<String>,
    pub wire_estimation_confidence: Option<String>,
    pub grading_availability: Option<String>,
    pub arrest_evidence: Option<String>,
    pub hook_state: Option<String>,
}

/// `/api/lso/passes` payload.
#[derive(Debug, Serialize, ToSchema)]
pub struct LsoPassesResponse {
    /// Newest first.
    pub passes: Vec<LsoPass>,
    /// Total rows in `lso.db`, independent of `limit`/`since_id`.
    pub total: i64,
}

/// One pilot's slice of the board for `/api/lso/pilots`.
///
/// Pilots are identified by their DCS UCID when the rows carry one, so a pilot
/// who renames keeps a single history; rows without a UCID (legacy databases,
/// AI pilots) are grouped by name. The UCID itself never leaves the server.
#[derive(Debug, Serialize, ToSchema)]
pub struct LsoPilot {
    /// Name on the pilot's newest pass.
    pub pilot_name: String,
    /// Other names seen on this pilot's earlier passes (same UCID).
    pub aliases: Vec<String>,
    /// Every pass on record for this pilot, independent of the per-pilot limit.
    pub total_passes: i64,
    /// Passes that carry a project score (`points_awarded` not false).
    pub graded_passes: i64,
    /// Mean project score over `graded_passes`, or null when none were scored.
    pub avg_points: Option<f64>,
    /// `grade_date` (UTC) of the pilot's newest pass.
    pub last_pass_at: String,
    /// Newest first, truncated to the requested per-pilot limit.
    pub passes: Vec<LsoPass>,
}

/// `/api/lso/pilots` payload. Pilots are ordered by their newest pass.
#[derive(Debug, Serialize, ToSchema)]
pub struct LsoPilotsResponse {
    pub pilots: Vec<LsoPilot>,
    /// Per-pilot cap that was applied; null means every pass was returned.
    pub per_pilot_limit: Option<usize>,
    pub total_passes: i64,
}

/// `/api/lso/status` payload.
#[derive(Debug, Serialize, ToSchema)]
pub struct LsoStatus {
    /// `LSO_DIR` is set.
    pub configured: bool,
    /// `lso.db` exists inside `LSO_DIR`.
    pub db_present: bool,
    pub db_path: Option<String>,
    pub pass_count: i64,
    /// `grade_date` of the newest pass.
    pub last_pass_at: Option<String>,
}

/// Which of the two PNGs the LSO client writes per pass.
#[derive(Debug, Clone, Copy)]
pub enum ChartKind {
    /// Final-approach trap sheet, `<timestamp>.png`.
    Approach,
    /// Overhead pattern chart, `<timestamp>-pattern.png`.
    Pattern,
}

/// Open `<dir>/lso.db` for reading only.
///
/// A read-only connection is preferred. Under WAL, SQLite needs the `-shm`
/// sidecar (or a writable directory to create it); when that fails, fall back
/// to a read-write handle that is still fenced with `PRAGMA query_only`.
pub fn open_read_only(dir: &Path) -> Result<Connection, LsoError> {
    let path = dir.join(DB_FILE);
    if !path.is_file() {
        return Err(LsoError::DbMissing(dir.to_path_buf()));
    }
    let read_only = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = match Connection::open_with_flags(&path, read_only) {
        Ok(conn) => conn,
        Err(err) => {
            tracing::debug!(%err, "read-only open of lso.db failed; retrying read-write");
            Connection::open_with_flags(
                &path,
                OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )?
        }
    };
    conn.busy_timeout(Duration::from_secs(2))?;
    conn.pragma_update(None, "query_only", true)?;
    Ok(conn)
}

/// Board status for the page header and its "not configured" state.
pub fn status(dir: Option<&Path>) -> Result<LsoStatus, LsoError> {
    let Some(dir) = dir else {
        return Ok(LsoStatus {
            configured: false,
            db_present: false,
            db_path: None,
            pass_count: 0,
            last_pass_at: None,
        });
    };
    let db_path = dir.join(DB_FILE);
    let conn = match open_read_only(dir) {
        Ok(conn) => conn,
        Err(LsoError::DbMissing(_)) => {
            return Ok(LsoStatus {
                configured: true,
                db_present: false,
                db_path: Some(db_path.display().to_string()),
                pass_count: 0,
                last_pass_at: None,
            })
        }
        Err(err) => return Err(err),
    };
    let pass_count = count_passes(&conn)?;
    let last_pass_at: Option<String> = conn
        .query_row(
            "SELECT grade_date FROM passes ORDER BY id DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .map(Some)
        .or_else(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;
    Ok(LsoStatus {
        configured: true,
        db_present: true,
        db_path: Some(db_path.display().to_string()),
        pass_count,
        last_pass_at,
    })
}

/// List passes newest first. `since_id` returns only rows with a larger id,
/// which lets a client poll incrementally.
pub fn list_passes(
    conn: &Connection,
    limit: usize,
    since_id: Option<i64>,
) -> Result<LsoPassesResponse, LsoError> {
    let limit = limit.clamp(1, MAX_LIMIT) as i64;
    let total = count_passes(conn)?;
    let passes = match since_id {
        Some(since) => query_passes(
            conn,
            "SELECT * FROM passes WHERE id > ?2 ORDER BY id DESC LIMIT ?1",
            params![limit, since],
        )?,
        None => query_passes(
            conn,
            "SELECT * FROM passes ORDER BY id DESC LIMIT ?1",
            params![limit],
        )?,
    };
    Ok(LsoPassesResponse { passes, total })
}

/// Group every pass by pilot, newest pilot first, keeping at most `per_pilot`
/// passes each (`None` keeps them all). Stats always cover the full history.
///
/// The whole table is read in one pass: `lso.db` grows by one row per trap, so
/// even a busy server stays at a few thousand rows.
pub fn list_by_pilot(
    conn: &Connection,
    per_pilot: Option<usize>,
) -> Result<LsoPilotsResponse, LsoError> {
    let rows = query_keyed_passes(conn, "SELECT * FROM passes ORDER BY id DESC", params![])?;
    let total_passes = rows.len() as i64;

    // Names that belong to exactly one UCID: a legacy row without a UCID but
    // with such a name joins that pilot instead of forming a second group.
    let mut name_to_ucid: HashMap<String, Option<String>> = HashMap::new();
    for row in &rows {
        if let Some(ucid) = row.ucid.as_deref() {
            name_to_ucid
                .entry(row.pass.pilot_name.clone())
                .and_modify(|known| {
                    if known.as_deref() != Some(ucid) {
                        *known = None; // ambiguous: several UCIDs used this name
                    }
                })
                .or_insert_with(|| Some(ucid.to_owned()));
        }
    }

    let mut pilots: Vec<LsoPilot> = Vec::new();
    let mut index: HashMap<GroupKey, usize> = HashMap::new();
    let mut point_sums: Vec<f64> = Vec::new();

    for KeyedPass { ucid, pass } in rows {
        let key = match ucid {
            Some(ucid) => GroupKey::Ucid(ucid),
            None => match name_to_ucid.get(pass.pilot_name.as_str()) {
                Some(Some(ucid)) => GroupKey::Ucid(ucid.clone()),
                _ => GroupKey::Name(pass.pilot_name.clone()),
            },
        };
        let slot = match index.get(&key) {
            Some(&slot) => slot,
            None => {
                index.insert(key, pilots.len());
                pilots.push(LsoPilot {
                    pilot_name: pass.pilot_name.clone(),
                    aliases: Vec::new(),
                    total_passes: 0,
                    graded_passes: 0,
                    avg_points: None,
                    // Rows arrive newest first, so the first row is the last pass.
                    last_pass_at: pass.grade_date.clone(),
                    passes: Vec::new(),
                });
                point_sums.push(0.0);
                pilots.len() - 1
            }
        };
        let pilot = &mut pilots[slot];
        if pass.pilot_name != pilot.pilot_name && !pilot.aliases.contains(&pass.pilot_name) {
            pilot.aliases.push(pass.pilot_name.clone());
        }
        pilot.total_passes += 1;
        if let Some(points) = pass_points(&pass) {
            pilot.graded_passes += 1;
            point_sums[slot] += points;
        }
        if per_pilot.map_or(true, |cap| pilot.passes.len() < cap) {
            pilot.passes.push(pass);
        }
    }

    for (pilot, sum) in pilots.iter_mut().zip(point_sums) {
        if pilot.graded_passes > 0 {
            pilot.avg_points = Some(sum / pilot.graded_passes as f64);
        }
    }

    Ok(LsoPilotsResponse {
        pilots,
        per_pilot_limit: per_pilot,
        total_passes,
    })
}

/// Project score of a pass, mirroring the board's display rule: an explicit
/// `points_awarded = false` means no score, otherwise the stored value, and
/// for rows older than migration 3 the legacy per-grade table.
fn pass_points(pass: &LsoPass) -> Option<f64> {
    if pass.points_awarded == Some(false) {
        return None;
    }
    if let Some(points) = pass.grade_points {
        return Some(points);
    }
    match pass.pass_grade.as_str() {
        "_OK_" => Some(5.0),
        "OK" => Some(4.0),
        "(OK)" => Some(3.0),
        "--" => Some(2.0),
        "C" => Some(0.0),
        "B" => Some(2.5),
        "WO" => Some(1.0),
        _ => None,
    }
}

/// How passes are grouped into one pilot on `/api/lso/pilots`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum GroupKey {
    Ucid(String),
    Name(String),
}

/// A pass plus the private UCID of its row. The UCID stays inside this
/// module: it drives grouping and is dropped before anything is serialised.
struct KeyedPass {
    ucid: Option<String>,
    pass: LsoPass,
}

/// Run a `SELECT * FROM passes ...` statement and map every row, tolerating
/// columns this build knows about but the database does not have yet.
fn query_passes(
    conn: &Connection,
    sql: &str,
    params: &[&dyn rusqlite::ToSql],
) -> rusqlite::Result<Vec<LsoPass>> {
    Ok(query_keyed_passes(conn, sql, params)?
        .into_iter()
        .map(|keyed| keyed.pass)
        .collect())
}

fn query_keyed_passes(
    conn: &Connection,
    sql: &str,
    params: &[&dyn rusqlite::ToSql],
) -> rusqlite::Result<Vec<KeyedPass>> {
    let mut stmt = conn.prepare(sql)?;
    let columns: HashSet<String> = stmt
        .column_names()
        .into_iter()
        .map(str::to_owned)
        .collect();
    let rows = stmt
        .query_map(params, |row| {
            let ucid: Option<String> = col(row, &columns, "pilot_ucid")?
                .filter(|value: &String| !value.trim().is_empty());
            Ok(KeyedPass {
                ucid,
                pass: row_to_pass(row, &columns)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Read the PNG bytes for a pass. The file name is derived from the row's own
/// `timestamp` column, never from client input, and validated before use.
pub fn chart_bytes(dir: &Path, id: i64, kind: ChartKind) -> Result<Vec<u8>, LsoError> {
    let conn = open_read_only(dir)?;
    let timestamp: String = conn
        .query_row("SELECT timestamp FROM passes WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .or_else(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => Err(LsoError::PassNotFound(id)),
            other => Err(LsoError::Sqlite(other)),
        })?;
    let path = chart_path(dir, &timestamp, kind).ok_or(LsoError::ChartMissing)?;
    std::fs::read(&path).map_err(|err| {
        tracing::debug!(path = %path.display(), %err, "LSO chart not readable");
        LsoError::ChartMissing
    })
}

/// Build `<dir>/<timestamp>.png` or `<dir>/<timestamp>-pattern.png`.
///
/// Returns `None` unless `timestamp` is a plain `LSO-...` file stem: letters,
/// digits, `_`, `-` and single dots. Anything that could escape `dir` is
/// rejected even though the value comes from the database, so a tampered
/// `lso.db` cannot turn this into a file-read primitive.
pub fn chart_path(dir: &Path, timestamp: &str, kind: ChartKind) -> Option<PathBuf> {
    static STEM: OnceLock<Regex> = OnceLock::new();
    let stem = STEM.get_or_init(|| Regex::new(r"^LSO-[A-Za-z0-9_.-]+$").expect("static regex"));
    if !stem.is_match(timestamp) || timestamp.contains("..") {
        return None;
    }
    let file = match kind {
        ChartKind::Approach => format!("{timestamp}.png"),
        ChartKind::Pattern => format!("{timestamp}-pattern.png"),
    };
    Some(dir.join(file))
}

fn count_passes(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM passes", [], |row| row.get(0))
}

/// Read a nullable column by name, yielding `None` when the column does not
/// exist in this database's schema.
fn col<T: FromSql>(
    row: &Row<'_>,
    columns: &HashSet<String>,
    name: &str,
) -> rusqlite::Result<Option<T>> {
    if !columns.contains(name) {
        return Ok(None);
    }
    row.get::<_, Option<T>>(name)
}

fn row_to_pass(row: &Row<'_>, columns: &HashSet<String>) -> rusqlite::Result<LsoPass> {
    let dcs_grading: Option<String> = col(row, columns, "dcs_grading")?;
    let lso_notes = dcs_grading
        .as_deref()
        .map(crate::lso_notation::to_english)
        .filter(|notes| !notes.is_empty());
    Ok(LsoPass {
        id: row.get("id")?,
        timestamp: col::<String>(row, columns, "timestamp")?.unwrap_or_default(),
        pilot_name: col::<String>(row, columns, "pilot_name")?.unwrap_or_default(),
        aircraft_id: col(row, columns, "aircraft_id")?,
        pass_grade: col::<String>(row, columns, "pass_grade")?.unwrap_or_default(),
        wire: col(row, columns, "wire")?,
        spot: col(row, columns, "spot")?,
        spot_grade: col(row, columns, "spot_grade")?,
        spot_distance_m: col(row, columns, "spot_distance_m")?,
        intended_spot: col(row, columns, "intended_spot")?,
        actual_nearest_spot: col(row, columns, "actual_nearest_spot")?,
        distance_to_intended_spot_m: col(row, columns, "distance_to_intended_spot_m")?,
        dcs_grading,
        aircraft_type: col(row, columns, "aircraft_type")?,
        map_name: col(row, columns, "map_name")?,
        lso_notes,
        grade_date: col::<String>(row, columns, "grade_date")?.unwrap_or_default(),
        grade_points: col(row, columns, "grade_points")?,
        points_awarded: col(row, columns, "points_awarded")?,
        mission_datetime: col::<String>(row, columns, "mission_datetime")?.unwrap_or_default(),
        outcome: col::<String>(row, columns, "outcome")?.unwrap_or_default(),
        recovery_id: col(row, columns, "recovery_id")?,
        pilot_kind: col(row, columns, "pilot_kind")?,
        carrier_id: col(row, columns, "carrier_id")?,
        carrier_name: col(row, columns, "carrier_name")?,
        carrier_type: col(row, columns, "carrier_type")?,
        recovery_mode: col(row, columns, "recovery_mode")?,
        session_id: col(row, columns, "session_id")?,
        generation: col(row, columns, "generation")?,
        completeness: col(row, columns, "completeness")?,
        max_sample_gap_ms: col(row, columns, "max_sample_gap_ms")?,
        max_scoring_sample_gap_ms: col(row, columns, "max_scoring_sample_gap_ms")?,
        max_skew_ms: col(row, columns, "max_skew_ms")?,
        telemetry_health: col(row, columns, "telemetry_health")?,
        wire_estimated: col(row, columns, "wire_estimated")?,
        wire_dcs: col(row, columns, "wire_dcs")?,
        wire_divergent: col(row, columns, "wire_divergent")?,
        confidence: col(row, columns, "confidence")?,
        cause: col(row, columns, "cause")?,
        grading_version: col(row, columns, "grading_version")?,
        wire_estimation_confidence: col(row, columns, "wire_estimation_confidence")?,
        grading_availability: col(row, columns, "grading_availability")?,
        arrest_evidence: col(row, columns, "arrest_evidence")?,
        hook_state: col(row, columns, "hook_state")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Unique scratch directory holding one `lso.db`; removed on drop.
    struct TempLsoDir(PathBuf);

    impl TempLsoDir {
        fn new(tag: &str) -> Self {
            let unique = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!(
                "dashboard-lso-{tag}-{}-{unique}",
                std::process::id()
            ));
            std::fs::create_dir_all(&dir).expect("create temp dir");
            Self(dir)
        }

        fn path(&self) -> &Path {
            &self.0
        }

        fn writer(&self) -> Connection {
            Connection::open(self.0.join(DB_FILE)).expect("create test database")
        }
    }

    impl Drop for TempLsoDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// The version-1 schema the LSO client's own migration test starts from.
    fn create_legacy_schema(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE passes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                pilot_name TEXT NOT NULL,
                pass_grade TEXT NOT NULL,
                wire INTEGER,
                dcs_grading TEXT
            );",
        )
        .expect("legacy schema");
    }

    /// The columns the current LSO client writes, including the private UCID.
    fn create_current_schema(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE passes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                pilot_name TEXT NOT NULL,
                pilot_ucid TEXT,
                aircraft_id INTEGER,
                pass_grade TEXT NOT NULL,
                wire INTEGER,
                spot TEXT,
                dcs_grading TEXT,
                aircraft_type TEXT,
                map_name TEXT,
                grade_date TEXT NOT NULL DEFAULT '',
                grade_points REAL NOT NULL DEFAULT 0.0,
                mission_datetime TEXT NOT NULL DEFAULT '',
                outcome TEXT NOT NULL DEFAULT '',
                completeness TEXT,
                wire_divergent INTEGER NOT NULL DEFAULT 0,
                points_awarded INTEGER NOT NULL DEFAULT 1,
                arrest_evidence TEXT,
                hook_state TEXT
            );",
        )
        .expect("current schema");
    }

    #[test]
    fn missing_database_is_reported_not_configured_or_absent() {
        assert!(!status(None).unwrap().configured);

        let dir = TempLsoDir::new("absent");
        let st = status(Some(dir.path())).unwrap();
        assert!(st.configured);
        assert!(!st.db_present);
        assert_eq!(st.pass_count, 0);
        assert!(matches!(
            open_read_only(dir.path()),
            Err(LsoError::DbMissing(_))
        ));
    }

    #[test]
    fn legacy_schema_lists_with_missing_columns_as_none() {
        let dir = TempLsoDir::new("legacy");
        {
            let conn = dir.writer();
            create_legacy_schema(&conn);
            conn.execute(
                "INSERT INTO passes(timestamp, pilot_name, pass_grade, wire, dcs_grading)
                 VALUES ('LSO-legacy', 'Legacy Pilot', 'OK', 3, '(LO)IM WIRE# 3')",
                [],
            )
            .unwrap();
        }
        let conn = open_read_only(dir.path()).unwrap();
        let page = list_passes(&conn, DEFAULT_LIMIT, None).unwrap();
        assert_eq!(page.total, 1);
        let pass = &page.passes[0];
        assert_eq!(pass.pilot_name, "Legacy Pilot");
        assert_eq!(pass.wire, Some(3));
        assert_eq!(pass.grade_date, "");
        assert_eq!(pass.points_awarded, None);
        assert_eq!(pass.arrest_evidence, None);
        assert!(pass
            .lso_notes
            .as_deref()
            .unwrap_or_default()
            .contains("low"));
    }

    #[test]
    fn ucid_is_never_serialised_and_points_awarded_round_trips() {
        let dir = TempLsoDir::new("current");
        {
            let conn = dir.writer();
            create_current_schema(&conn);
            conn.execute(
                "INSERT INTO passes(timestamp, pilot_name, pilot_ucid, pass_grade, wire, grade_date,
                                    grade_points, points_awarded, outcome, completeness)
                 VALUES ('LSO-20260825-031018-Pilot-s1-g1-p2-c3-t4', 'Pilot', 'secret-ucid', '--', NULL,
                         '2026-08-25 03:10:18', 0.0, 0, 'Incomplete', 'partial')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO passes(timestamp, pilot_name, pass_grade, wire, grade_date, grade_points,
                                    points_awarded, outcome, completeness)
                 VALUES ('LSO-second', 'Pilot', 'OK', 3, '2026-08-25 03:20:00', 4.0, 1, 'Arrested', 'complete')",
                [],
            )
            .unwrap();
        }
        let conn = open_read_only(dir.path()).unwrap();
        let page = list_passes(&conn, DEFAULT_LIMIT, None).unwrap();
        assert_eq!(page.total, 2);
        assert_eq!(page.passes[0].id, 2, "newest first");
        assert_eq!(page.passes[1].points_awarded, Some(false));
        assert_eq!(page.passes[0].points_awarded, Some(true));

        let json = serde_json::to_string(&page).unwrap();
        assert!(!json.contains("ucid"), "UCID must never leave the server: {json}");

        let incremental = list_passes(&conn, DEFAULT_LIMIT, Some(1)).unwrap();
        assert_eq!(incremental.passes.len(), 1);
        assert_eq!(incremental.passes[0].id, 2);

        // The connection is read-only: an insert must be refused.
        assert!(conn
            .execute("INSERT INTO passes(timestamp, pilot_name, pass_grade) VALUES ('x','y','z')", [])
            .is_err());
    }

    #[test]
    fn pilots_are_grouped_newest_first_with_full_history_stats() {
        let dir = TempLsoDir::new("pilots");
        {
            let conn = dir.writer();
            create_current_schema(&conn);
            for (pilot, grade, points, awarded, date) in [
                ("Alpha", "OK", 4.0, 1, "2026-09-01 10:00:00"),
                ("Bravo", "--", 2.0, 1, "2026-09-01 10:05:00"),
                ("Alpha", "NC", 0.0, 0, "2026-09-01 10:10:00"),
                ("Alpha", "(OK)", 3.0, 1, "2026-09-01 10:15:00"),
                ("Alpha", "B", 2.5, 1, "2026-09-01 10:20:00"),
            ] {
                conn.execute(
                    "INSERT INTO passes(timestamp, pilot_name, pass_grade, grade_points, points_awarded, grade_date)
                     VALUES ('LSO-x', ?1, ?2, ?3, ?4, ?5)",
                    params![pilot, grade, points, awarded, date],
                )
                .unwrap();
            }
        }
        let conn = open_read_only(dir.path()).unwrap();

        let limited = list_by_pilot(&conn, Some(2)).unwrap();
        assert_eq!(limited.total_passes, 5);
        assert_eq!(limited.per_pilot_limit, Some(2));
        assert_eq!(limited.pilots.len(), 2);
        let alpha = &limited.pilots[0];
        assert_eq!(alpha.pilot_name, "Alpha", "pilot with the newest pass comes first");
        assert_eq!(alpha.total_passes, 4);
        assert_eq!(alpha.graded_passes, 3, "the NC pass carries no points");
        assert!((alpha.avg_points.unwrap() - (4.0 + 3.0 + 2.5) / 3.0).abs() < 1e-9);
        assert_eq!(alpha.last_pass_at, "2026-09-01 10:20:00");
        assert_eq!(alpha.passes.len(), 2, "capped per pilot");
        assert_eq!(alpha.passes[0].pass_grade, "B", "newest first");
        assert_eq!(limited.pilots[1].pilot_name, "Bravo");
        assert_eq!(limited.pilots[1].passes.len(), 1);

        let all = list_by_pilot(&conn, None).unwrap();
        assert_eq!(all.per_pilot_limit, None);
        assert_eq!(all.pilots[0].passes.len(), 4);
    }

    #[test]
    fn pilots_are_keyed_by_ucid_without_exposing_it() {
        let dir = TempLsoDir::new("ucid");
        {
            let conn = dir.writer();
            create_current_schema(&conn);
            for (pilot, ucid, grade, date) in [
                // Legacy row without UCID, same name as a UCID pilot below: joins it.
                ("Viper", None, "OK", "2026-08-01 10:00:00"),
                ("Viper", Some("ucid-A"), "(OK)", "2026-08-02 10:00:00"),
                ("Hawk", Some("ucid-B"), "B", "2026-08-03 10:00:00"),
                // Same UCID as Viper after a rename: one pilot, name from the newest row.
                ("Viper | 501st", Some("ucid-A"), "OK", "2026-08-04 10:00:00"),
                // Name without UCID that nobody with a UCID uses: its own group.
                ("AI Wingman", None, "--", "2026-08-05 10:00:00"),
            ] {
                conn.execute(
                    "INSERT INTO passes(timestamp, pilot_name, pilot_ucid, pass_grade, grade_points, points_awarded, grade_date)
                     VALUES ('LSO-x', ?1, ?2, ?3, 1.0, 1, ?4)",
                    params![pilot, ucid, grade, date],
                )
                .unwrap();
            }
        }
        let conn = open_read_only(dir.path()).unwrap();
        let result = list_by_pilot(&conn, None).unwrap();

        let names: Vec<&str> = result.pilots.iter().map(|p| p.pilot_name.as_str()).collect();
        assert_eq!(names, ["AI Wingman", "Viper | 501st", "Hawk"], "newest pilot first");
        let viper = &result.pilots[1];
        assert_eq!(viper.total_passes, 3, "rename and legacy row merged into one pilot");
        assert_eq!(viper.aliases, vec!["Viper".to_string()]);
        assert_eq!(result.pilots[0].aliases, Vec::<String>::new());

        let json = serde_json::to_string(&result).unwrap();
        assert!(!json.contains("ucid"), "UCID must never leave the server: {json}");
    }

    #[test]
    fn chart_bytes_follow_the_row_timestamp() {
        let dir = TempLsoDir::new("chart");
        {
            let conn = dir.writer();
            create_legacy_schema(&conn);
            conn.execute(
                "INSERT INTO passes(timestamp, pilot_name, pass_grade) VALUES ('LSO-20260825-031018-Pilot-s1-g1-p2-c3-t4', 'Pilot', 'OK')",
                [],
            )
            .unwrap();
        }
        std::fs::write(
            dir.path().join("LSO-20260825-031018-Pilot-s1-g1-p2-c3-t4.png"),
            b"PNG-approach",
        )
        .unwrap();
        assert_eq!(
            chart_bytes(dir.path(), 1, ChartKind::Approach).unwrap(),
            b"PNG-approach"
        );
        assert!(matches!(
            chart_bytes(dir.path(), 1, ChartKind::Pattern),
            Err(LsoError::ChartMissing)
        ));
        assert!(matches!(
            chart_bytes(dir.path(), 99, ChartKind::Approach),
            Err(LsoError::PassNotFound(99))
        ));
    }

    #[test]
    fn chart_path_rejects_anything_that_could_escape_the_directory() {
        let dir = Path::new("C:/LSO/recordings");
        assert_eq!(
            chart_path(dir, "LSO-20260825-031018-Pilot-s1-g1-p2-c3-t4", ChartKind::Pattern),
            Some(dir.join("LSO-20260825-031018-Pilot-s1-g1-p2-c3-t4-pattern.png"))
        );
        for bad in [
            "../secret",
            "LSO-../secret",
            "LSO-a/b",
            "LSO-a\\b",
            "LSO-..",
            "C:/LSO/x",
            "",
            "lso-lowercase",
        ] {
            assert!(chart_path(dir, bad, ChartKind::Approach).is_none(), "{bad:?}");
        }
    }
}
