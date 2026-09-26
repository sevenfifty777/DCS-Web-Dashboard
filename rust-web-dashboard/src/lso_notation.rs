//! Reader half of `src/lso_notation.rs` from the DCS-gRPC-lso repository
//! (sevenfifty777/DCS-gRPC-lso, glossary of 21 September 2026): `parse` and
//! `to_english`, without the episode writer and the grader comparison. Keep the
//! tables and phrasing in sync with the LSO client.
//!
//! Since LSO migration 8 the client stores the notes it sent to Discord in
//! `passes.lso_notes`, and the dashboard shows those. This translator only
//! serves rows written before that migration, so they read the same way.
//!
//! The vocabulary is the NAVAIR 00-80T-104 glossary (sections 11.4.1 to 11.4.3).
//! DCS writes it as:
//!
//! ```text
//! LSO: GRADE:C : _SLOX_  _TMRDAR_  (LURIM)  _DRIM_  WIRE# 2 _EGIW_ [BC]
//! LSO: GRADE:WO  _DRX_  _LURX_  LOIM  _LOIC_  WOFDIC [BC]
//! LSO: GRADE: NC : No proper communications
//! ```
//!
//! - each token is one or more glossary symbols followed by an optional position
//!   suffix (`X` start, `IM` middle, `IC` in close, `AR` ramp, `TL` to land,
//!   `IW` in the wires);
//! - parentheses mean "a little", plain text a moderate deviation, and
//!   underscores (the NATOPS underline) the gross deviation;
//! - `WO` inside the body carries the waveoff reason and position (`WO(AFU)IC`);
//!   after `WO` the parentheses group the reason, they do not mean "a little";
//! - `WIRE# n` names the wire; `[BC]` marks that the ball call was made.
//!
//! A token the glossary cannot read is rendered as "not understood", never dropped.

/// How strongly a deviation is marked: parentheses, plain, underline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Magnitude {
    ALittle,
    Moderate,
    Gross,
}

/// Descriptive symbols, NATOPS 11.4.2. The matcher tries the longest symbols first.
const SYMBOLS: &[(&str, &str)] = &[
    ("AA", "angling approach"),
    ("ACC", "accelerating"),
    ("AFU", "all fouled up"),
    ("B", "flat glideslope"),
    ("C", "climbing"),
    ("CB", "coming back to lineup"),
    ("CD", "coming down"),
    ("CH", "chased"),
    ("CO", "come-on"),
    ("CU", "cocked up"),
    ("DD", "deck down"),
    ("DEC", "decelerating"),
    ("DL", "drifted left"),
    ("DN", "dropped nose"),
    ("DR", "drifted right"),
    ("DU", "deck up"),
    ("EG", "eased gun"),
    ("F", "fast"),
    ("FD", "fouled deck"),
    ("GLI", "gliding approach"),
    ("H", "high"),
    ("HO", "hold off"),
    ("LIG", "long in the groove"),
    ("LL", "landed left"),
    ("LLU", "late lineup"),
    ("LO", "low"),
    ("LR", "landed right"),
    ("LTR", "left to right"),
    ("LU", "lineup"),
    ("LUL", "lined up left"),
    ("LUR", "lined up right"),
    ("LWD", "left wing down"),
    ("N", "nose"),
    ("ND", "nose down"),
    ("NEA", "not enough attitude"),
    ("NEP", "not enough power"),
    ("NERD", "not enough rate of descent"),
    ("NERR", "not enough right rudder"),
    ("NESA", "not enough straightaway"),
    ("NH", "no hook"),
    ("NSU", "not set up"),
    ("OR", "overrotated"),
    ("OS", "overshot"),
    ("OSCB", "overshot coming back"),
    ("P", "power"),
    ("PD", "pitching deck"),
    ("PNU", "pulled nose up"),
    ("ROT", "rotated"),
    ("RUD", "rudder"),
    ("RUF", "rough"),
    ("RWD", "right wing down"),
    ("RR", "right rudder"),
    ("RTL", "right to left"),
    ("S", "settling"),
    ("SD", "spotted the deck"),
    ("SHT", "ship's turn"),
    ("SKD", "skidded"),
    ("SLO", "slow"),
    ("SRD", "stopped rate of descent"),
    ("ST", "steep turn"),
    ("TCA", "too close abeam"),
    ("TMA", "too much attitude"),
    ("TMP", "too much power"),
    ("TMRD", "too much rate of descent"),
    ("TMRR", "too much right rudder"),
    ("TTL", "turned too late"),
    ("TTS", "turned too soon"),
    ("TWA", "too wide abeam"),
    ("W", "wings not level"),
    ("WU", "wrapped up"),
    ("XCTL", "cross-controlled"),
    ("LLWD", "landed left wing down"),
    ("LRWD", "landed right wing down"),
    ("LNF", "landed nose first"),
    ("3PTS", "landed three points"),
];

/// Position suffixes, NATOPS 11.4.3.
const SUFFIXES: &[(&str, &str)] = &[
    ("CCA", "on the carrier-controlled approach"),
    ("OT", "out of the turn"),
    ("BC", "at the ball call"),
    ("X", "at the start"),
    ("IM", "in the middle"),
    ("IC", "in close"),
    ("AR", "at the ramp"),
    ("TL", "to land"),
    ("IW", "in the wires"),
    ("AW", "all the way"),
];

/// Grade labels, NATOPS 11.4.1, as DCS writes them after `GRADE:`.
const GRADES: &[(&str, &str)] = &[
    ("_OK_", "perfect pass"),
    ("OK", "OK"),
    ("(OK)", "fair"),
    ("---", "no grade"),
    ("--", "no grade"),
    ("C", "cut"),
    ("WOP", "pattern waveoff"),
    ("OWO", "own waveoff"),
    ("WO", "waveoff"),
    ("B", "bolter"),
    ("NC", "no count"),
];

/// One deviation token: its glossary symbols, how strongly it was marked, and where.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Deviation {
    symbols: Vec<&'static str>,
    magnitude: Magnitude,
    suffix: Option<&'static str>,
    /// The token was a `WO` waveoff call; `symbols` then carry its reason.
    waveoff: bool,
}

/// A parsed LSO comment.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Notation {
    grade: Option<&'static str>,
    wire: Option<u8>,
    deviations: Vec<Deviation>,
    ball_call: bool,
    /// The free text after a `NC` (no count) label.
    free_text: Option<String>,
    /// Tokens the glossary could not read, verbatim.
    unknown: Vec<String>,
}

fn lookup(table: &[(&str, &'static str)], code: &str) -> &'static str {
    table
        .iter()
        .find(|(key, _)| *key == code)
        .map(|(_, meaning)| *meaning)
        .unwrap_or("")
}

/// Symbols sorted longest first, so the matcher never splits `LUL` into `LU` + `L`.
fn symbols_longest_first() -> Vec<&'static str> {
    let mut symbols: Vec<&'static str> = SYMBOLS.iter().map(|(code, _)| *code).collect();
    symbols.sort_by(|a, b| b.len().cmp(&a.len()).then(a.cmp(b)));
    symbols
}

/// Every way to cut `s` into glossary symbols. Inputs are a few letters long.
fn segmentations(s: &str, symbols: &[&'static str]) -> Vec<Vec<&'static str>> {
    if s.is_empty() {
        return vec![vec![]];
    }
    let mut out = Vec::new();
    for &symbol in symbols {
        if let Some(rest) = s.strip_prefix(symbol) {
            for mut tail in segmentations(rest, symbols) {
                tail.insert(0, symbol);
                out.push(tail);
            }
        }
    }
    out
}

/// Parse a DCS landing-quality-mark comment.
fn parse(comment: &str) -> Notation {
    let symbols = symbols_longest_first();
    let mut notation = Notation::default();
    let mut rest = comment.trim();
    if let Some(after) = rest.strip_prefix("LSO:") {
        rest = after.trim_start();
    }
    if let Some(after) = rest.strip_prefix("GRADE:") {
        let after = after.trim_start();
        let end = after.find(char::is_whitespace).unwrap_or(after.len());
        let label = &after[..end];
        match GRADES.iter().find(|(code, _)| *code == label) {
            Some((code, _)) => notation.grade = Some(code),
            None if !label.is_empty() => notation.unknown.push(format!("GRADE:{label}")),
            None => {}
        }
        rest = after[end..].trim_start();
        if let Some(after_colon) = rest.strip_prefix(':') {
            rest = after_colon.trim_start();
        }
    }
    if notation.grade == Some("NC") {
        notation.free_text = Some(rest.to_string());
        return notation;
    }

    let mut tokens = rest.split_whitespace().peekable();
    while let Some(token) = tokens.next() {
        if let Some(after) = token.strip_prefix("WIRE#") {
            // `WIRE# 3`, `WIRE# 3[BC]`, `WIRE#3`. The number must end the token or
            // be followed by `[`; `1foo` is not a wire.
            let number = if after.is_empty() {
                tokens.next().unwrap_or("")
            } else {
                after
            };
            let digits = number.bytes().take_while(u8::is_ascii_digit).count();
            let tail = &number[digits..];
            match number[..digits].parse::<u8>() {
                Ok(wire) if tail.is_empty() || tail.starts_with('[') => {
                    notation.wire = Some(wire);
                    if !tail.is_empty() {
                        parse_token(tail, &symbols, &mut notation);
                    }
                }
                _ => notation.unknown.push(format!("WIRE# {number}")),
            }
            continue;
        }
        parse_token(token, &symbols, &mut notation);
    }
    notation
}

fn parse_token(token: &str, symbols: &[&'static str], notation: &mut Notation) {
    if token == "[BC]" {
        notation.ball_call = true;
        return;
    }
    let mut core = token;
    let waveoff = core.starts_with("WO");
    if waveoff {
        core = &core[2..];
    }
    let mut magnitude = Magnitude::Moderate;
    let joined;
    if let Some(inner) = core.strip_prefix('(') {
        if let Some(close) = inner.find(')') {
            // `(LURIM)` is "a little"; `WO(AFU)IC` groups the waveoff reason.
            if !waveoff {
                magnitude = Magnitude::ALittle;
            }
            joined = format!("{}{}", &inner[..close], &inner[close + 1..]);
            core = joined.as_str();
        }
    }
    let stripped = core.trim_matches('_');
    if stripped.len() < core.len() {
        magnitude = Magnitude::Gross;
    }
    core = stripped;

    if core.is_empty() {
        if waveoff {
            notation.deviations.push(Deviation {
                symbols: Vec::new(),
                magnitude,
                suffix: None,
                waveoff: true,
            });
        } else if !token.is_empty() {
            notation.unknown.push(token.to_string());
        }
        return;
    }

    // Candidate readings: with each suffix the token ends with, and without a
    // suffix. Prefer a reading with a suffix, then the one with the fewest
    // symbols (longest matches).
    let mut candidates: Vec<(Option<&'static str>, Vec<&'static str>)> = Vec::new();
    for &(suffix, _) in SUFFIXES {
        if let Some(head) = core.strip_suffix(suffix) {
            for reading in segmentations(head, symbols) {
                if !reading.is_empty() || waveoff {
                    candidates.push((Some(suffix), reading));
                }
            }
        }
    }
    for reading in segmentations(core, symbols) {
        candidates.push((None, reading));
    }
    candidates.sort_by(|a, b| {
        b.0.is_some()
            .cmp(&a.0.is_some())
            .then(a.1.len().cmp(&b.1.len()))
    });
    match candidates.into_iter().next() {
        Some((suffix, reading)) => notation.deviations.push(Deviation {
            symbols: reading,
            magnitude,
            suffix,
            waveoff,
        }),
        None => notation.unknown.push(token.to_string()),
    }
}

impl Notation {
    /// Plain-English line, as the LSO client writes it. Empty when there is nothing to say.
    fn english(&self) -> String {
        if let Some(text) = &self.free_text {
            return capitalise(&match self.grade {
                Some(grade) => format!("{}: {text}", lookup(GRADES, grade)),
                None => text.clone(),
            });
        }
        let mut phrases: Vec<String> = self.deviations.iter().map(deviation_phrase).collect();
        if let Some(wire) = self.wire {
            phrases.push(format!("wire {wire}"));
        }
        if self.ball_call {
            phrases.push("ball call".to_string());
        }
        if !self.unknown.is_empty() {
            phrases.push(format!("not understood: {}", self.unknown.join(" ")));
        }
        capitalise(&phrases.join(", "))
    }
}

fn deviation_phrase(deviation: &Deviation) -> String {
    let mut words: Vec<String> = Vec::new();
    if deviation.waveoff {
        words.push("waveoff".to_string());
    }
    if deviation.magnitude == Magnitude::ALittle && !deviation.symbols.is_empty() {
        words.push("a little".to_string());
    }
    // Repeated identical symbols (`PPP`) are repeated calls.
    let meanings: Vec<&'static str> = deviation
        .symbols
        .iter()
        .map(|symbol| lookup(SYMBOLS, symbol))
        .collect();
    let mut index = 0;
    while index < meanings.len() {
        let meaning = meanings[index];
        let mut count = 1;
        while index + count < meanings.len() && meanings[index + count] == meaning {
            count += 1;
        }
        words.push(match count {
            1 => meaning.to_string(),
            2 => format!("{meaning} (two calls)"),
            3 => format!("{meaning} (three calls)"),
            n => format!("{meaning} ({n} calls)"),
        });
        index += count;
    }
    if let Some(suffix) = deviation.suffix {
        let meaning = lookup(SUFFIXES, suffix);
        if !meaning.is_empty() {
            words.push(meaning.to_string());
        }
    }
    let mut phrase = words.join(" ");
    if deviation.waveoff && deviation.symbols.is_empty() {
        phrase = "waveoff".to_string();
    } else if deviation.waveoff {
        phrase = phrase.replacen("waveoff ", "waveoff: ", 1);
    }
    if deviation.magnitude == Magnitude::Gross {
        phrase.push_str(" (gross)");
    }
    phrase
}

fn capitalise(s: &str) -> String {
    let mut result = s.to_string();
    if let Some(first) = result.get_mut(0..1) {
        first.make_ascii_uppercase();
    }
    result
}

/// Convert a DCS LSO notation string to a plain-English sentence. Returns an
/// empty string when the comment contains no recognisable tokens.
pub fn to_english(notation: &str) -> String {
    parse(notation).english()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn underline_is_gross_and_keeps_the_position() {
        assert_eq!(
            to_english("LSO: GRADE:C : _SLOX_  _TMRDAR_  _DRX_  (LURIM)  _DRIM_  WIRE# 2 _EGIW_ [BC]"),
            "Slow at the start (gross), too much rate of descent at the ramp (gross), \
             drifted right at the start (gross), a little lined up right in the middle, \
             drifted right in the middle (gross), eased gun in the wires (gross), wire 2, ball call"
        );
        assert_eq!(to_english("_LOAR_"), "Low at the ramp (gross)");
        assert_eq!(to_english("LOAR"), "Low at the ramp");
        assert_eq!(to_english("(LOAR)"), "A little low at the ramp");
    }

    #[test]
    fn waveoff_comments_read_like_the_lso_client() {
        // Board row #547 of 23 September 2026.
        assert_eq!(
            to_english("LSO: GRADE:WO  _SLOX_  _LULX_  _LULIM_  _LULIC_  WO(AFU)IC [BC]"),
            "Slow at the start (gross), lined up left at the start (gross), \
             lined up left in the middle (gross), lined up left in close (gross), \
             waveoff: all fouled up in close, ball call"
        );
        assert_eq!(
            to_english("LSO: GRADE:WO  WONSUX [BC]"),
            "Waveoff: not set up at the start, ball call"
        );
    }

    #[test]
    fn glossary_symbols_are_read_whole() {
        assert_eq!(to_english("(EGIW)"), "A little eased gun in the wires");
        assert_eq!(to_english("_PPPIC_"), "Power (three calls) in close (gross)");
    }

    #[test]
    fn no_count_keeps_the_free_text() {
        assert_eq!(
            to_english("LSO: GRADE: NC : No proper communications"),
            "No count: No proper communications"
        );
    }

    #[test]
    fn wire_and_unknown_tokens_are_reported() {
        assert_eq!(to_english("LSO: GRADE:_OK_ : WIRE# 3"), "Wire 3");
        assert_eq!(
            to_english("LSO: GRADE:C : _QQQX_  LOAR  WIRE# 1"),
            "Low at the ramp, wire 1, not understood: _QQQX_"
        );
    }
}
