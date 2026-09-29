"""Sports research: scores, schedules, odds, standings, injuries, team form, player game logs (this season and past
ones) and pick checks for PrizePicks / Underdog style player props.

Free public data, no account or key: ESPN's public site API. Needs internet.

None of this predicts the future. It shows how often something has really happened and who's hurt, so picks are made on facts instead of vibes.
"""
from __future__ import annotations

import re
import statistics
import time
from datetime import date, datetime, timedelta
from typing import Any

import httpx

SITE = "https://site.api.espn.com/apis/site/v2/sports"
WEB = "https://site.web.api.espn.com/apis"
STANDINGS = "https://site.api.espn.com/apis/v2/sports"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AthenaAI/1.0", "Accept": "application/json"}

# name people use -> (ESPN sport, ESPN league, label)
LEAGUES: dict[str, tuple[str, str, str]] = {
    "nba": ("basketball", "nba", "NBA"), "wnba": ("basketball", "wnba", "WNBA"),
    "ncaab": ("basketball", "mens-college-basketball", "college basketball"),
    "cbb": ("basketball", "mens-college-basketball", "college basketball"),
    "college basketball": ("basketball", "mens-college-basketball", "college basketball"),
    "ncaaw": ("basketball", "womens-college-basketball", "women's college basketball"),
    "nfl": ("football", "nfl", "NFL"), "ncaaf": ("football", "college-football", "college football"),
    "cfb": ("football", "college-football", "college football"),
    "college football": ("football", "college-football", "college football"),
    "mlb": ("baseball", "mlb", "MLB"), "nhl": ("hockey", "nhl", "NHL"),
    "mls": ("soccer", "usa.1", "MLS"), "epl": ("soccer", "eng.1", "Premier League"),
    "premier league": ("soccer", "eng.1", "Premier League"), "la liga": ("soccer", "esp.1", "La Liga"),
    "laliga": ("soccer", "esp.1", "La Liga"), "serie a": ("soccer", "ita.1", "Serie A"),
    "bundesliga": ("soccer", "ger.1", "Bundesliga"), "ligue 1": ("soccer", "fra.1", "Ligue 1"),
    "champions league": ("soccer", "uefa.champions", "Champions League"), "ucl": ("soccer", "uefa.champions", "Champions League"),
    "ufc": ("mma", "ufc", "UFC"), "mma": ("mma", "ufc", "UFC"),
}
MAIN = ("nba", "nfl", "mlb", "nhl", "wnba")  # searched when no league is given
# ESPN ids inside "uid" strings (s:40~l:46~a:1966 = basketball / NBA / athlete 1966)
UID_LEAGUES = {"46": "nba", "59": "wnba", "41": "ncaab", "28": "nfl", "23": "ncaaf", "10": "mlb", "90": "nhl"}

_cache: dict[str, tuple[float, Any]] = {}


class SportsError(Exception):
    pass


def league_info(name: str | None) -> tuple[str, str, str] | None:
    key = re.sub(r"[^a-z0-9 ]", "", (name or "").lower()).strip()
    if not key:
        return None
    if key in LEAGUES:
        return LEAGUES[key]
    for alias, info in LEAGUES.items():
        if info[1] == key:
            return info
    return None


def _key(sport: str, league: str) -> str:
    return next((k for k, v in LEAGUES.items() if v[:2] == (sport, league)), league)


async def _get(client: httpx.AsyncClient, url: str, params: dict[str, Any] | None = None, ttl: float = 60) -> Any:
    ck = url + "?" + "&".join(f"{k}={v}" for k, v in sorted((params or {}).items()))
    hit = _cache.get(ck)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    try:
        r = await client.get(url, params=params, headers=HEADERS, timeout=15)
    except httpx.HTTPError as exc:
        raise SportsError(f"Couldn't reach the sports data ({exc.__class__.__name__}). Is the internet on?") from exc
    if r.status_code == 404:
        raise SportsError("Not found")
    if r.status_code != 200:
        raise SportsError(f"The sports data site answered HTTP {r.status_code}")
    try:
        data = r.json()
    except ValueError as exc:
        raise SportsError("The sports data site sent something unreadable") from exc
    if len(_cache) > 400:
        _cache.clear()
    _cache[ck] = (time.time(), data)
    return data


def _num(v: Any) -> float | None:
    """'27' -> 27, '10-19' (made-attempted) -> 10, '52.6' -> 52.6, '--' -> None."""
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v or "").strip()
    m = re.match(r"^(-?\d+(?:\.\d+)?)(?:-\d+)?$", s)
    return float(m.group(1)) if m else None


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _when(value: str) -> str:
    """YYYYMMDD for ESPN from 'today', 'tomorrow', 'yesterday', '2025-01-31', '1/31'."""
    v = (value or "").strip().lower()
    today = date.today()
    if not v or v == "today":
        return today.strftime("%Y%m%d")
    if v in ("tomorrow", "tmrw"):
        return (today + timedelta(days=1)).strftime("%Y%m%d")
    if v == "yesterday":
        return (today - timedelta(days=1)).strftime("%Y%m%d")
    if re.fullmatch(r"\d{8}", v):
        return v
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%m-%d-%Y"):
        try:
            return datetime.strptime(v, fmt).strftime("%Y%m%d")
        except ValueError:
            pass
    m = re.fullmatch(r"(\d{1,2})[/-](\d{1,2})", v)
    if m:
        return date(today.year, int(m.group(1)), int(m.group(2))).strftime("%Y%m%d")
    raise SportsError(f"Couldn't read the date '{value}'. Use today, tomorrow, yesterday or 2025-01-31.")


def _day(iso: str) -> str:
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone().strftime("%a %b %d")
    except ValueError:
        return str(iso)[:10]


def _local(iso: str) -> str:
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone().strftime("%a %b %d, %I:%M %p").replace(" 0", " ")
    except ValueError:
        return str(iso)


# ------------------------------------------------------------------ teams

async def _teams(client: httpx.AsyncClient, sport: str, league: str) -> list[dict[str, Any]]:
    data = await _get(client, f"{SITE}/{sport}/{league}/teams", {"limit": 1000}, ttl=86400)
    out = []
    for lg in (data.get("sports") or [{}])[0].get("leagues") or []:
        for item in lg.get("teams") or []:
            t = item.get("team") or item
            out.append({"id": str(t.get("id")), "abbr": t.get("abbreviation", ""), "name": t.get("displayName", ""),
                        "short": t.get("shortDisplayName", ""), "nickname": t.get("name", ""), "location": t.get("location", "")})
    return out


def _team_score(t: dict[str, Any], q: str) -> int:
    nq = _norm(q)
    if not nq:
        return 0
    if nq == _norm(t["abbr"]):
        return 100
    if nq in (_norm(t["name"]), _norm(t["nickname"])):
        return 95
    if nq in (_norm(t["short"]), _norm(t["location"])):
        return 80
    if nq in _norm(t["name"]) and len(nq) >= 4:
        return 60
    words = [w for w in re.findall(r"[a-z0-9]+", q.lower()) if len(w) > 2]
    return 40 if words and all(w in t["name"].lower() for w in words) else 0


async def find_team(client: httpx.AsyncClient, team: str, league: str | None = None) -> tuple[dict[str, Any], tuple[str, str, str], list[str]]:
    """The best match for a team name, its league, and other leagues where the name also matched."""
    leagues = [league_info(league)] if league_info(league) else [LEAGUES[k] for k in MAIN]
    found: list[tuple[int, dict[str, Any], tuple[str, str, str]]] = []
    for info in leagues:
        try:
            for t in await _teams(client, info[0], info[1]):
                if (s := _team_score(t, team)) > 0:
                    found.append((s, t, info))
        except SportsError:
            continue
    if not found:
        raise SportsError(f"Couldn't find a team called '{team}'" + (f" in the {leagues[0][2]}" if league_info(league) else "")
                          + ". Try the full name, or say the league.")
    found.sort(key=lambda x: -x[0])
    best = found[0]
    others = sorted({f"{t['name']} ({info[2]})" for s, t, info in found[1:] if s >= best[0] - 10 and info != best[2]})
    return best[1], best[2], others


# ------------------------------------------------------------------ games / scores / odds

def _competitor_score(c: dict[str, Any]) -> str:
    s = c.get("score")
    if isinstance(s, dict):
        return str(s.get("displayValue") or s.get("value") or "")
    return str(s or "")


def _game(ev: dict[str, Any]) -> dict[str, Any]:
    comp = (ev.get("competitions") or [{}])[0]
    status = (comp.get("status") or ev.get("status") or {}).get("type") or {}
    teams = {c.get("homeAway"): c for c in comp.get("competitors") or []}
    home, away = teams.get("home") or {}, teams.get("away") or {}
    name = lambda c: (c.get("team") or {}).get("displayName") or (c.get("athlete") or {}).get("displayName") or "?"  # noqa: E731
    rec = lambda c: next((r.get("summary") for r in c.get("records") or [] if r.get("summary")), None)  # noqa: E731
    g: dict[str, Any] = {"game": f"{name(away)} at {name(home)}", "when": _local(ev.get("date", "")),
                         "status": status.get("shortDetail") or status.get("description") or ""}
    if status.get("state") in ("in", "post") or status.get("completed"):
        g["score"] = f"{name(away)} {_competitor_score(away)}, {name(home)} {_competitor_score(home)}"
    if rec(home) or rec(away):
        g["records"] = f"{name(away)} {rec(away) or '?'}, {name(home)} {rec(home) or '?'}"
    odds = (comp.get("odds") or [{}])[0] if comp.get("odds") else {}
    if odds:
        line = {"spread": odds.get("details"), "total": odds.get("overUnder"),
                "home_moneyline": (odds.get("homeTeamOdds") or {}).get("moneyLine"),
                "away_moneyline": (odds.get("awayTeamOdds") or {}).get("moneyLine"),
                "from": (odds.get("provider") or {}).get("name")}
        g["odds"] = {k: v for k, v in line.items() if v not in (None, "")}
    if comp.get("broadcasts"):
        nets = [n for b in comp["broadcasts"] for n in b.get("names") or []]
        if nets:
            g["tv"] = ", ".join(nets[:3])
    return g


async def games(client: httpx.AsyncClient, league: str = "", day: str = "", team: str = "") -> dict[str, Any]:
    info = league_info(league)
    if not info and team:
        _t, info, _o = await find_team(client, team)
    if not info:
        raise SportsError("Which league? (NBA, NFL, MLB, NHL, WNBA, college football, college basketball, MLS, EPL, UFC…)")
    when = _when(day)
    params: dict[str, Any] = {"dates": when}
    if info[1] in ("mens-college-basketball", "womens-college-basketball", "college-football"):
        params["groups"] = "50" if "basketball" in info[1] else "80"  # all Division I games, not just the top 25
        params["limit"] = 400
    data = await _get(client, f"{SITE}/{info[0]}/{info[1]}/scoreboard", params, ttl=45)
    items = [_game(ev) for ev in data.get("events") or []]
    if team:
        words = [w for w in re.findall(r"[a-z0-9]+", team.lower()) if len(w) > 2] or [team.lower()]
        items = [g for g in items if all(w in g["game"].lower() for w in words)] or \
                [g for g in items if any(w in g["game"].lower() for w in words)]
    day_label = datetime.strptime(when, "%Y%m%d").strftime("%A %B %d, %Y")
    out: dict[str, Any] = {"league": info[2], "date": day_label, "games": items[:40]}
    if not items:
        out["note"] = f"No {info[2]} games" + (f" for {team}" if team else "") + f" on {day_label}."
    return out


# ------------------------------------------------------------------ team report

async def _schedule(client: httpx.AsyncClient, info: tuple[str, str, str], team_id: str, season: int | None) -> list[dict[str, Any]]:
    params = {"season": season} if season else {}
    data = await _get(client, f"{SITE}/{info[0]}/{info[1]}/teams/{team_id}/schedule", params, ttl=900)
    out = []
    for ev in data.get("events") or []:
        comp = (ev.get("competitions") or [{}])[0]
        st = (comp.get("status") or {}).get("type") or {}
        me = next((c for c in comp.get("competitors") or [] if str((c.get("team") or {}).get("id")) == str(team_id)), None)
        opp = next((c for c in comp.get("competitors") or [] if c is not me), None)
        if not me or not opp:
            continue
        row = {"date": ev.get("date", ""), "opponent": (opp.get("team") or {}).get("displayName", "?"),
               "opp_abbr": (opp.get("team") or {}).get("abbreviation", ""), "home": me.get("homeAway") == "home",
               "done": bool(st.get("completed"))}
        if row["done"]:
            mine, theirs = _num(_competitor_score(me)), _num(_competitor_score(opp))
            won = me.get("winner")
            if won is None and mine is not None and theirs is not None:
                won = mine > theirs
            row.update(won=bool(won), score=f"{_competitor_score(me)}-{_competitor_score(opp)}", pf=mine, pa=theirs)
        out.append(row)
    return out


def _season_now(info: tuple[str, str, str]) -> int:
    """ESPN's season number: the year the season ends for winter sports (2025-26 NBA = 2026)."""
    today = date.today()
    if info[1] == "wnba":
        return today.year
    if info[0] in ("basketball", "hockey") and today.month >= 10:  # the new season starts in October
        return today.year + 1
    if info[0] == "football" and today.month <= 2:
        return today.year - 1
    return today.year


def _game_line(g: dict[str, Any]) -> str:
    where = "vs" if g["home"] else "@"
    if g.get("done"):
        return f"{_day(g['date'])}: {'W' if g['won'] else 'L'} {g['score']} {where} {g['opponent']}"
    return f"{_local(g['date'])}: {where} {g['opponent']}"


async def injuries(client: httpx.AsyncClient, info: tuple[str, str, str], team_name: str = "") -> list[dict[str, Any]]:
    try:
        data = await _get(client, f"{SITE}/{info[0]}/{info[1]}/injuries", ttl=600)
    except SportsError:
        return []
    out = []
    for team in data.get("injuries") or []:
        tname = team.get("displayName") or (team.get("team") or {}).get("displayName") or ""
        if team_name and _norm(team_name) not in _norm(tname) and _norm(tname) not in _norm(team_name):
            continue
        for inj in team.get("injuries") or []:
            ath = inj.get("athlete") or {}
            out.append({"team": tname, "player": ath.get("displayName", "?"),
                        "position": (ath.get("position") or {}).get("abbreviation", ""), "status": inj.get("status", ""),
                        "detail": inj.get("shortComment") or (inj.get("details") or {}).get("type") or "",
                        "return": (inj.get("details") or {}).get("returnDate", "")})
    return out


async def team_report(client: httpx.AsyncClient, team: str, league: str = "", opponent: str = "", season: int | None = None) -> dict[str, Any]:
    t, info, others = await find_team(client, team, league)
    now = _season_now(info)
    season = int(season) if season else now
    out: dict[str, Any] = {"team": t["name"], "league": info[2], "season": season}
    if others:
        out["also_matches"] = others  # "Giants": NFL or MLB
    try:
        detail = (await _get(client, f"{SITE}/{info[0]}/{info[1]}/teams/{t['id']}", ttl=1800)).get("team") or {}
        items = (detail.get("record") or {}).get("items") or []
        if items and season == now:
            out["record"] = "; ".join(f"{i.get('description') or i.get('type')}: {i.get('summary')}" for i in items[:3] if i.get("summary"))
        if detail.get("standingSummary") and season == now:
            out["standing"] = detail["standingSummary"]
    except SportsError:
        pass
    sched = await _schedule(client, info, t["id"], season)
    done = [g for g in sched if g.get("done")]
    upcoming = [g for g in sched if not g.get("done")]
    if done:
        wins = sum(1 for g in done if g["won"])
        home = [g for g in done if g["home"]]
        away = [g for g in done if not g["home"]]
        rec = lambda gs: f"{sum(1 for g in gs if g['won'])}-{sum(1 for g in gs if not g['won'])}"  # noqa: E731
        out["results"] = {"record": f"{wins}-{len(done) - wins}", "home": rec(home), "away": rec(away),
                          "last_10": rec(done[-10:]), "last_games": [_game_line(g) for g in done[-8:][::-1]]}
        pf = [g["pf"] for g in done if g.get("pf") is not None]
        pa = [g["pa"] for g in done if g.get("pa") is not None]
        if pf and pa:
            out["results"]["avg_score"] = f"{sum(pf) / len(pf):.1f} scored, {sum(pa) / len(pa):.1f} allowed"
    if upcoming:
        out["next_games"] = [_game_line(g) for g in upcoming[:4]]
    if opponent:
        opp_words = [w for w in re.findall(r"[a-z0-9]+", opponent.lower()) if len(w) > 1]
        vs = lambda gs: [g for g in gs if g.get("done") and (_norm(opponent) == _norm(g["opp_abbr"]) or  # noqa: E731
                                                             all(w in g["opponent"].lower() for w in opp_words))]
        h2h = vs(sched)
        try:
            h2h = vs(await _schedule(client, info, t["id"], season - 1)) + h2h
        except SportsError:
            pass
        out["head_to_head"] = {"games": [_game_line(g) for g in h2h[::-1]][:10],
                               "record": f"{sum(1 for g in h2h if g['won'])}-{sum(1 for g in h2h if not g['won'])}"
                               } if h2h else f"No games against {opponent} in {season - 1} or {season}."
    if season == now:
        hurt = await injuries(client, info, t["name"])
        out["injuries"] = hurt[:12] or "No injuries reported."
        try:
            news = await _get(client, f"{SITE}/{info[0]}/{info[1]}/news", {"team": t["id"], "limit": 5}, ttl=900)
            out["news"] = [a.get("headline") for a in (news.get("articles") or [])[:4] if a.get("headline")]
        except SportsError:
            pass
    return out


async def standings(client: httpx.AsyncClient, league: str, season: int | None = None) -> dict[str, Any]:
    info = league_info(league)
    if not info:
        raise SportsError("Which league's standings?")
    data = await _get(client, f"{STANDINGS}/{info[0]}/{info[1]}/standings", {"season": season} if season else {}, ttl=1800)
    groups = []

    def walk(node: dict[str, Any]) -> None:
        entries = (node.get("standings") or {}).get("entries") or []
        if entries:
            rows = []
            for e in entries:
                stats = {s.get("name") or s.get("type"): s.get("displayValue") for s in e.get("stats") or []}
                rows.append(f"{(e.get('team') or {}).get('displayName', '?')} {stats.get('wins', '?')}-{stats.get('losses', '?')}"
                            + (f"-{stats['ties']}" if stats.get("ties") not in (None, "0") and info[1] == "nfl" else "")
                            + (f" (OTL {stats['otLosses']})" if stats.get("otLosses") else "")
                            + (f", {stats['gamesBehind']} GB" if stats.get("gamesBehind") not in (None, "-", "0") else "")
                            + (f", streak {stats['streak']}" if stats.get("streak") else ""))
            groups.append({"group": node.get("name") or node.get("abbreviation") or info[2], "teams": rows})
        for child in node.get("children") or []:
            walk(child)

    walk(data)
    return {"league": info[2], "standings": groups[:12]}


# ------------------------------------------------------------------ players

def _walk(node: Any):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def _candidate(d: dict[str, Any]) -> dict[str, Any] | None:
    name = d.get("displayName") or d.get("name")
    if not isinstance(name, str) or not name:
        return None
    uid = str(d.get("uid") or "")
    link = str((d.get("link") or {}).get("web") if isinstance(d.get("link"), dict) else d.get("link") or "")
    if not link and isinstance(d.get("links"), list):
        link = next((str(x.get("href")) for x in d["links"] if isinstance(x, dict) and "player" in str(x.get("href"))), "")
    aid = None
    if m := re.search(r"~a:(\d+)", uid):
        aid = m.group(1)
    elif m := re.search(r"/player/(?:_/)?id/(\d+)", link):
        aid = m.group(1)
    elif str(d.get("type", "")).lower() in ("player", "athlete") and str(d.get("id", "")).isdigit():
        aid = str(d["id"])
    if not aid:
        return None
    lg = None
    if m := re.search(r"~l:(\d+)", uid):
        lg = UID_LEAGUES.get(m.group(1))
    if not lg and (m := re.search(r"espn\.com/([a-z-]+)/player", link)):
        lg = {"mens-college-basketball": "ncaab", "college-football": "ncaaf"}.get(m.group(1), m.group(1))
    lg = lg or str(d.get("defaultLeagueSlug") or d.get("league") or "").lower() or None
    if lg and not league_info(lg):
        return None
    return {"id": aid, "name": name, "league": lg, "team": d.get("description") or d.get("subtitle") or ""}


async def find_player(client: httpx.AsyncClient, player: str, league: str = "") -> dict[str, Any]:
    want = league_info(league)
    found: dict[str, dict[str, Any]] = {}
    for url, params in ((f"{WEB}/common/v3/search", {"query": player, "limit": 10, "type": "player"}),
                        (f"{WEB}/search/v2", {"query": player, "limit": 10})):
        try:
            data = await _get(client, url, params, ttl=86400)
        except SportsError:
            continue
        for d in _walk(data):
            c = _candidate(d)
            if c and c["league"] and c["id"] not in found:
                found[c["id"]] = c
        if found:
            break
    items = list(found.values())
    if want:
        items = [c for c in items if league_info(c["league"]) == want]
    if not items:
        raise SportsError(f"Couldn't find a player called '{player}'" + (f" in the {want[2]}" if want else "")
                          + ". Check the spelling, or say the league.")
    target = _norm(player)
    items.sort(key=lambda c: (_norm(c["name"]) != target, target not in _norm(c["name"]),
                              (c["league"] or "") not in MAIN))
    return items[0]


# stat asked for -> the names ESPN uses for it (game log "names" and "labels", lowercased, letters only)
STATS: dict[str, list[str]] = {
    "points": ["points", "pts"], "rebounds": ["totalrebounds", "rebounds", "reb"], "assists": ["assists", "ast", "a"],
    "steals": ["steals", "stl"], "blocks": ["blocks", "blk"], "turnovers": ["turnovers", "to"],
    "threes": ["threepointfieldgoalsmadethreepointfieldgoalsattempted", "threepointfieldgoalsmade", "3pt", "3pm"],
    "minutes": ["minutes", "min"], "field goals": ["fieldgoalsmadefieldgoalsattempted", "fg"],
    "free throws": ["freethrowsmadefreethrowsattempted", "ft"],
    "passing yards": ["passingyards"], "passing tds": ["passingtouchdowns"], "completions": ["completions", "cmp"],
    "pass attempts": ["passingattempts"], "interceptions": ["interceptions", "int"],
    "rushing yards": ["rushingyards"], "rush attempts": ["rushingattempts", "car"], "rushing tds": ["rushingtouchdowns"],
    "receiving yards": ["receivingyards"], "receptions": ["receptions", "rec"], "targets": ["receivingtargets", "tgts"],
    "receiving tds": ["receivingtouchdowns"],
    "hits": ["hits", "h"], "home runs": ["homeruns", "hr"], "rbis": ["rbis", "rbi"], "runs": ["runs", "r"],
    "doubles": ["doubles", "2b"], "triples": ["triples", "3b"], "walks": ["walks", "bb"], "stolen bases": ["stolenbases", "sb"],
    "strikeouts": ["strikeouts", "k", "so"], "earned runs": ["earnedruns", "er"], "hits allowed": ["hits", "h"],
    "innings": ["innings", "inningspitched", "ip"],
    "goals": ["goals", "g"], "shots": ["shotstotal", "shots", "sog", "s"], "saves": ["saves", "sv"],
    "hockey points": ["points", "pts", "p"],
}
COMBOS: dict[str, list[str]] = {
    "pra": ["points", "rebounds", "assists"], "points+rebounds": ["points", "rebounds"], "points+assists": ["points", "assists"],
    "rebounds+assists": ["rebounds", "assists"], "blocks+steals": ["blocks", "steals"],
    "rush+rec yards": ["rushing yards", "receiving yards"], "pass+rush yards": ["passing yards", "rushing yards"],
    "hits+runs+rbis": ["hits", "runs", "rbis"],
}
# how people write a stat -> one of the names above
SAY = [
    (r"fantasy|fpts|\bfs\b", "fantasy"), (r"total bases|\btb\b", "total bases"),
    (r"p\s*\+?\s*r\s*\+?\s*a|pra|pts\s*\+\s*reb\s*\+\s*ast|points,? rebounds,? (?:and )?assists", "pra"),
    (r"p\s*\+\s*r\b|pts\s*\+\s*reb|points\s*(?:\+|and|&)\s*rebounds", "points+rebounds"),
    (r"p\s*\+\s*a\b|pts\s*\+\s*ast|points\s*(?:\+|and|&)\s*assists", "points+assists"),
    (r"r\s*\+\s*a\b|reb\s*\+\s*ast|rebounds\s*(?:\+|and|&)\s*assists", "rebounds+assists"),
    (r"blk\s*\+\s*stl|stl\s*\+\s*blk|blocks\s*(?:\+|and|&)\s*steals|steals\s*(?:\+|and|&)\s*blocks|stocks", "blocks+steals"),
    (r"rush\w*\s*(?:\+|and|&)\s*rec\w*", "rush+rec yards"), (r"pass\w*\s*(?:\+|and|&)\s*rush\w*", "pass+rush yards"),
    (r"h\s*\+\s*r\s*\+\s*rbi|hits\s*\+\s*runs\s*\+\s*rbi|\bhrr\b", "hits+runs+rbis"),
    (r"pass(?:ing)?\s*(?:yds|yards)", "passing yards"), (r"pass(?:ing)?\s*(?:tds?|touchdowns)", "passing tds"),
    (r"rush(?:ing)?\s*(?:yds|yards)", "rushing yards"), (r"rush(?:ing)?\s*(?:att|attempts)|carries", "rush attempts"),
    (r"rush(?:ing)?\s*(?:tds?|touchdowns)", "rushing tds"), (r"rec(?:eiving)?\s*(?:yds|yards)", "receiving yards"),
    (r"receptions|catches|\brec\b", "receptions"), (r"targets", "targets"), (r"rec(?:eiving)?\s*(?:tds?|touchdowns)", "receiving tds"),
    (r"completions|\bcmp\b", "completions"), (r"pass(?:ing)?\s*att", "pass attempts"), (r"interceptions|\bints?\b", "interceptions"),
    (r"3\s*-?\s*(?:pt|pointers?)|threes|3pm|\b3s\b|three pointers?", "threes"),
    (r"rebounds|\breb|boards", "rebounds"), (r"assists|\bast\b|dimes", "assists"), (r"steals|\bstl\b", "steals"),
    (r"blocks|\bblk\b", "blocks"), (r"turnovers|\bto\b", "turnovers"), (r"minutes|\bmin\b", "minutes"),
    (r"home ?runs?|\bhrs?\b", "home runs"), (r"\brbis?\b|runs batted", "rbis"), (r"stolen bases?|\bsb\b", "stolen bases"),
    (r"pitcher strikeouts|strikeouts|\bks?\b|\bso\b", "strikeouts"), (r"earned runs|\ber\b", "earned runs"),
    (r"hits allowed", "hits allowed"), (r"\bhits\b", "hits"), (r"\bruns\b", "runs"), (r"walks|\bbb\b", "walks"),
    (r"shots on goal|\bsog\b|shots", "shots"), (r"saves", "saves"), (r"goals", "goals"), (r"points|pts", "points"),
]


def stat_name(text: str, sport: str = "") -> str | None:
    low = (text or "").lower()
    for pattern, name in SAY:
        if re.search(pattern, low):
            if name == "points" and sport == "hockey":
                return "hockey points"
            return name
    return None


def _value(stats: dict[str, float | None], stat: str, sport: str) -> float | None:
    def one(name: str) -> float | None:
        for k in STATS.get(name, [_norm(name)]):
            if k in stats and stats[k] is not None:
                return stats[k]
        return None
    if stat in COMBOS:
        parts = [one(p) for p in COMBOS[stat]]
        return None if any(p is None for p in parts) else sum(parts)  # type: ignore[arg-type]
    if stat == "fantasy":  # PrizePicks / Underdog basketball scoring
        p, r, a, b, s, t = (one(x) for x in ("points", "rebounds", "assists", "blocks", "steals", "turnovers"))
        if None in (p, r, a):
            return None
        return p + 1.2 * r + 1.5 * a + 3 * (b or 0) + 3 * (s or 0) - (t or 0)  # type: ignore[operator]
    if stat == "total bases":
        h, d, t, hr = (one(x) for x in ("hits", "doubles", "triples", "home runs"))
        return None if h is None else h + (d or 0) + 2 * (t or 0) + 3 * (hr or 0)
    return one(stat)


async def game_log(client: httpx.AsyncClient, info: tuple[str, str, str], athlete_id: str, season: int | None) -> list[dict[str, Any]]:
    """Every game the player played that season, newest first: date, opponent, home/away, result and all stats."""
    params = {"season": season} if season else {}
    data = await _get(client, f"{WEB}/common/v3/sports/{info[0]}/{info[1]}/athletes/{athlete_id}/gamelog", params, ttl=1200)
    top_names = data.get("names") or []
    top_labels = data.get("labels") or []
    details = data.get("events") if isinstance(data.get("events"), dict) else {}
    seen: set[str] = set()
    out = []
    for st in data.get("seasonTypes") or []:
        kind = str(st.get("displayName") or st.get("name") or "")
        if "preseason" in kind.lower():
            continue
        for cat in st.get("categories") or []:
            names = cat.get("names") or top_names
            labels = cat.get("labels") or top_labels
            for ev in cat.get("events") or []:
                eid = str(ev.get("eventId") or ev.get("id") or "")
                if not eid or eid in seen or not isinstance(ev.get("stats"), list):
                    continue
                seen.add(eid)
                stats: dict[str, float | None] = {}
                for i, v in enumerate(ev["stats"]):
                    for key in (names[i] if i < len(names) else None, labels[i] if i < len(labels) else None):
                        if key:
                            stats.setdefault(_norm(key), _num(v))
                d = details.get(eid) or {}
                opp = d.get("opponent") or {}
                at = str(d.get("atVs") or "")
                mine = d.get("homeTeamId") if at and at.lower() != "@" else d.get("awayTeamId") if at else None
                out.append({"id": eid, "date": d.get("gameDate") or d.get("date") or "", "opp": opp.get("abbreviation") or opp.get("displayName") or "?",
                            "opp_name": opp.get("displayName") or "", "home": at.lower() != "@" if at else None,
                            "result": f"{d.get('gameResult', '')} {d.get('score', '')}".strip(), "postseason": "post" in kind.lower(),
                            "team_id": str(mine) if mine else "", "stats": stats})
    out.sort(key=lambda g: g["date"], reverse=True)
    return out


def _rate(values: list[float], line: float) -> dict[str, Any]:
    over = sum(1 for v in values if v > line)
    under = sum(1 for v in values if v < line)
    push = len(values) - over - under
    r = {"games": len(values), "over": over, "under": under, "over_pct": round(100 * over / len(values)) if values else None}
    if push:
        r["push"] = push
    if values:
        r["average"] = round(sum(values) / len(values), 1)
    return r


async def _next_game(client: httpx.AsyncClient, info: tuple[str, str, str], team_id: str) -> dict[str, Any] | None:
    if not team_id:
        return None
    try:
        sched = await _schedule(client, info, team_id, None)
    except SportsError:
        return None
    nxt = next((g for g in sched if not g.get("done")), None)
    return {"when": _local(nxt["date"]), "opponent": nxt["opponent"], "opp_abbr": nxt["opp_abbr"], "home": nxt["home"]} if nxt else None


async def player_report(client: httpx.AsyncClient, player: str, league: str = "", stat: str = "", line: Any = None,
                        opponent: str = "", season: int | None = None, side: str = "") -> dict[str, Any]:
    """A player's recent games and averages; with a stat and a line, how often they've gone over / under it."""
    p = await find_player(client, player, league)
    info = league_info(p["league"]) or league_info(league)
    if not info:
        raise SportsError(f"Found {p['name']}, but not their league. Say the league (NBA, NFL, MLB, NHL…).")
    if info[0] not in ("basketball", "football", "baseball", "hockey"):
        raise SportsError(f"Game-by-game stats aren't available for {info[2]} players.")
    now = _season_now(info)
    season = int(season) if season else now
    log = await game_log(client, info, p["id"], season)
    prev: list[dict[str, Any]] = []
    if season == now and len(log) < 15:  # early in a season: last season too, for a real sample
        try:
            prev = await game_log(client, info, p["id"], season - 1)
        except SportsError:
            prev = []
    out: dict[str, Any] = {"player": p["name"], "team": p.get("team") or "", "league": info[2], "season": season}
    if not log and not prev:
        out["note"] = f"No games found for {p['name']} in {season}."
        return out
    wanted = stat_name(stat, info[0]) if stat else None
    if stat and not wanted:
        keys = sorted({k for g in (log or prev)[:1] for k in g["stats"]})
        raise SportsError(f"Not sure which stat '{stat}' means. This player's game log has: {', '.join(keys)}")
    def played(gs: list[dict[str, Any]]) -> list[dict[str, Any]]:  # skip games they sat out (0 minutes)
        return [g for g in gs if (m := _value(g["stats"], "minutes", info[0])) is None or m > 0]
    log, prev = played(log), played(prev)
    if not wanted:  # no pick to check: averages and the last few games
        keys = ["points", "rebounds", "assists", "threes", "minutes"] if info[0] == "basketball" else \
            ["passing yards", "rushing yards", "receptions", "receiving yards"] if info[0] == "football" else \
            ["hits", "home runs", "rbis", "runs", "strikeouts"] if info[0] == "baseball" else ["goals", "hockey points", "shots"]
        avg = {}
        for k in keys:
            vals = [v for g in log if (v := _value(g["stats"], k, info[0])) is not None]
            if vals:
                avg[k] = round(sum(vals) / len(vals), 1)
        out["season_averages"] = avg
        out["games_played"] = len(log)
        out["last_games"] = [{"date": _day(g["date"]), "vs": ("vs " if g["home"] else "@ ") + g["opp"], "result": g["result"],
                              **{k: _value(g["stats"], k, info[0]) for k in keys}} for g in log[:8]]
        return out
    try:
        line_f = float(str(line).replace("½", ".5"))
    except (TypeError, ValueError):
        raise SportsError("What's the line? (e.g. 24.5)") from None
    series = [(g, v) for g in log if (v := _value(g["stats"], wanted, info[0])) is not None]
    older = [(g, v) for g in prev if (v := _value(g["stats"], wanted, info[0])) is not None]
    if not series and not older:
        raise SportsError(f"No {wanted} numbers in {p['name']}'s game log.")
    vals = [v for _g, v in series]
    report: dict[str, Any] = {"stat": wanted, "line": line_f}
    if vals:
        report["last_5"] = _rate(vals[:5], line_f)
        report["last_10"] = _rate(vals[:10], line_f)
        report["this_season"] = _rate(vals, line_f)
        report["median_this_season"] = statistics.median(vals)
        home = [v for g, v in series if g["home"]]
        away = [v for g, v in series if g["home"] is False]
        if home and away:
            report["home"] = _rate(home, line_f)
            report["away"] = _rate(away, line_f)
    if older:
        report["last_season"] = _rate([v for _g, v in older], line_f)
    nxt = await _next_game(client, info, next((g["team_id"] for g in log if g.get("team_id")), ""))
    if nxt:
        report["next_game"] = f"{nxt['when']} {'vs' if nxt['home'] else '@'} {nxt['opponent']}"
    opp = opponent or (nxt or {}).get("opp_abbr", "")
    if opp:
        match = lambda g: _norm(opp) in (_norm(g["opp"]), _norm(g["opp_name"])) or (len(_norm(opp)) > 3 and _norm(opp) in _norm(g["opp_name"]))  # noqa: E731
        vs = [v for g, v in series + older if match(g)]
        report["vs_opponent"] = {**_rate(vs, line_f), "opponent": opponent or (nxt or {}).get("opponent")} if vs else \
            f"No games against {opponent or nxt['opponent']} this season or last."  # type: ignore[index]
    report["recent_games"] = [f"{_day(g['date'])} {'vs' if g['home'] else '@'} {g['opp']}: {v:g}"
                              f" {'✓ over' if v > line_f else '✗ under' if v < line_f else '= push'}"
                              + (f" ({_value(g['stats'], 'minutes', info[0]):g} min)" if info[0] == "basketball" and _value(g['stats'], 'minutes', info[0]) else "")
                              for g, v in series[:10]]
    if info[0] == "basketball" and len(log) >= 8:
        mins = [m for g in log if (m := _value(g["stats"], "minutes", info[0]))]
        if mins:
            report["minutes"] = f"{sum(mins[:5]) / len(mins[:5]):.1f} a game lately, {sum(mins) / len(mins):.1f} this season"
    # A simple lean from history only: recent form counts more, a bigger sample counts more
    parts = [(report[k]["over_pct"], w * min(1.0, report[k]["games"] / (5 if k == "last_5" else 10)))
             for k, w in (("this_season", 0.45), ("last_10", 0.3), ("last_5", 0.15), ("last_season", 0.1))
             if isinstance(report.get(k), dict) and report[k].get("over_pct") is not None]
    if parts and sum(w for _p, w in parts):
        est = sum(p * w for p, w in parts) / sum(w for _p, w in parts)
        report["history_over_chance"] = f"{est:.0f}%"
        report["history_lean"] = ("over" if est >= 58 else "under" if est <= 42 else "no clear edge") + \
            " (from past games only; not a prediction)"
    hurt = [i for i in await injuries(client, info) if _norm(i["player"]) == _norm(p["name"])]
    if hurt:
        report["injury"] = f"{hurt[0]['status']}: {hurt[0]['detail']}".strip(": ")
    if side:
        report["your_pick"] = side
    out.update(report)
    return out
