import React, { useMemo, useState, useEffect, useRef } from "react";
import PROBLEMS from "./data/enriched_problems.json";
import { isCloud } from "./lib/supabase.js";
import useTeamSync from "./hooks/useTeamSync.js";
import { useMarksSync } from "./hooks/useMarksSync.js";
import { usePresence } from "./hooks/usePresence.js";

/* ------------------------------------------------------------------ */
/* Canonical skill list — must match scripts/enrich.mjs               */
/* ------------------------------------------------------------------ */
const SKILLS = [
  "Frontend Development",
  "Backend Development",
  "Mobile Development",
  "Machine Learning / AI",
  "Deep Learning / Computer Vision",
  "NLP / LLMs",
  "Data Engineering / Big Data",
  "GIS / Geospatial",
  "Blockchain",
  "Cloud/DevOps",
  "Database Design",
  "UI/UX Design",
  "IoT / Embedded Systems",
  "Robotics/Drones",
  "Cybersecurity",
  "AR/VR",
  "Data Visualization",
  "API Integration",
  "DevOps/CI-CD",
  "Product/Domain Research",
];

const DIFFICULTIES = ["Easy", "Medium", "Hard"];
const COMPETITIONS = ["Low", "Medium", "High"];
const QUADRANTS = [
  { key: "hard-low", label: "🟢 High risk, high reward", cls: "bg-green-100 text-green-800 border-green-300" },
  { key: "hard-high", label: "🟠 High risk, low reward", cls: "bg-orange-100 text-orange-800 border-orange-300" },
  { key: "easy-high", label: "🟡 Low risk, low reward", cls: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  { key: "easy-low", label: "🔵 Low risk, high reward", cls: "bg-blue-100 text-blue-800 border-blue-300" },
];

function quadrantOf(p) {
  const hard = p.difficulty === "Hard";
  const lowComp = p.estimatedCompetition === "Low";
  if (hard && lowComp) return "hard-low";
  if (hard) return "hard-high";
  if (p.estimatedCompetition === "High") return "easy-high";
  return "easy-low";
}
const quadrantMeta = Object.fromEntries(QUADRANTS.map((q) => [q.key, q]));
// lower = better tie-break rank
const COMP_RANK = { Low: 0, Medium: 1, High: 2 };

/* ------------------------------------------------------------------ */
/* Scoring engine — transparent per spec Section 3                    */
/* ------------------------------------------------------------------ */
function scoreProblem(problem, members) {
  const details = problem.requiredSkills.map((skill) => {
    let best = null;
    for (const m of members) {
      const lvl = m.skills[skill] || 0;
      if (lvl > 0 && (!best || lvl > best.level)) best = { member: m.name || `Member ${m.idx + 1}`, level: lvl };
    }
    return { skill, covered: !!best && best.level >= 2, best }; // best may be null or {member, level}
  });
  const coveredCount = details.filter((d) => d.covered).length;
  const coverageRatio = coveredCount / details.length;
  const matchedLevels = details.filter((d) => d.best).map((d) => d.best.level);
  const avgExpertise = matchedLevels.length
    ? matchedLevels.reduce((a, b) => a + b, 0) / matchedLevels.length / 5
    : 0;
  let score = Math.round(100 * (0.6 * coverageRatio + 0.4 * avgExpertise));
  if (coverageRatio === 0) score = Math.min(score, 15); // total mismatch cap
  return { score, details, coverageRatio };
}

/* ------------------------------------------------------------------ */
/* Small components                                                   */
/* ------------------------------------------------------------------ */
function ScoreRing({ value }) {
  const R = 26;
  const C = 2 * Math.PI * R;
  const color = value >= 70 ? "#16a34a" : value >= 40 ? "#d97706" : "#dc2626";
  return (
    <div className="relative w-16 h-16 shrink-0">
      <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
        <circle cx="32" cy="32" r={R} fill="none" stroke="#e5e7eb" strokeWidth="6" />
        <circle
          cx="32" cy="32" r={R} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={C} strokeDashoffset={C * (1 - value / 100)}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-bold text-sm">{value}</div>
    </div>
  );
}

function MemberSlot({ idx, member, onChange, readOnly }) {
  const update = (patch) => onChange({ ...member, ...patch });
  const toggleSkill = (skill) => {
    if (readOnly) return;
    const skills = { ...member.skills };
    if (skills[skill]) delete skills[skill];
    else skills[skill] = 3;
    update({ skills });
  };

  if (readOnly) {
    const hasSkills = Object.keys(member.skills || {}).length > 0;
    return (
      <div className="border rounded-xl p-3 bg-gray-50/50 shadow-sm border-gray-200">
        <div className="font-bold text-sm text-gray-700 mb-2 truncate flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-gray-400"></span>
          {member.name || `Slot ${idx + 1} (Empty)`}
        </div>
        {hasSkills ? (
          <div className="flex flex-wrap gap-1">
            {Object.entries(member.skills).map(([skill, lvl]) => (
              <span
                key={skill}
                className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 font-medium"
                title={`${skill}: ${lvl}/5`}
              >
                {skill} · <b>{lvl}</b>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[11px] text-gray-400 italic">No skills selected</span>
        )}
      </div>
    );
  }

  return (
    <div className="border rounded-xl p-3 bg-white shadow-sm border-indigo-200 ring-1 ring-indigo-50/50">
      <div className="flex justify-between items-center mb-1">
        <label className="text-xs font-semibold text-indigo-700">Slot {idx + 1} (You)</label>
      </div>
      <input
        className="w-full border rounded px-2 py-1 text-sm mb-2 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
        placeholder={`Enter your name`}
        value={member.name}
        onChange={(e) => update({ name: e.target.value })}
      />
      <div className="flex flex-wrap gap-1 mb-2">
        {SKILLS.map((s) => {
          const has = member.skills && member.skills[s] != null;
          return (
            <button
              key={s}
              onClick={() => toggleSkill(s)}
              className={`text-[11px] px-2 py-0.5 rounded-full border transition ${
                has ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 hover:bg-gray-100"
              }`}
            >
              {s}
            </button>
          );
        })}
      </div>
      {Object.entries(member.skills || {}).map(([skill, lvl]) => (
        <div key={skill} className="flex items-center gap-2 text-xs mb-1">
          <span className="flex-1 truncate" title={skill}>{skill}</span>
          <input
            type="range" min="1" max="5" value={lvl}
            onChange={(e) => update({ skills: { ...member.skills, [skill]: Number(e.target.value) } })}
            className="w-24 accent-indigo-600"
          />
          <span className="w-4 text-center font-semibold">{lvl}</span>
        </div>
      ))}
    </div>
  );
}

function MultiSelect({ label, options, selected, setSelected }) {
  const allSelected = selected.size === options.length;
  return (
    <div className="relative inline-block">
      <details className="group">
        <summary className="cursor-pointer list-none border rounded-lg px-3 py-1.5 text-sm bg-white hover:bg-gray-50 select-none">
          {label}: {allSelected ? "All" : `${selected.size} selected`} ▾
        </summary>
        <div className="absolute z-20 mt-1 max-h-72 overflow-auto border rounded-lg bg-white shadow-lg p-2 w-64">
          {options.map((o) => (
            <label key={o} className="flex items-center gap-2 px-1 py-0.5 text-sm rounded hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(o)}
                onChange={() => {
                  const next = new Set(selected);
                  next.has(o) ? next.delete(o) : next.add(o);
                  setSelected(next);
                }}
              />
              {o}
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

function ProblemCard({ rank, p, scoring, mark = { votes: {}, our_pick: false, notes: "" }, myName, updateMark }) {
  const [flipped, setFlipped] = useState(false);
  const q = quadrantMeta[quadrantOf(p)];
  const diffCls =
    p.difficulty === "Hard" ? "bg-red-100 text-red-700" :
    p.difficulty === "Medium" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700";

  const isFocusedRef = useRef(false);

  const hasVoted = myName && mark.votes && mark.votes[myName];
  const voteCount = Object.values(mark.votes || {}).filter(Boolean).length;
  const voters = Object.keys(mark.votes || {}).filter(k => mark.votes[k]);

  const handleVote = (e) => {
    e.stopPropagation();
    if (!myName) return;
    const newVotes = { ...(mark.votes || {}) };
    if (hasVoted) {
      delete newVotes[myName];
    } else {
      newVotes[myName] = true;
    }
    updateMark(p.id, { votes: newVotes });
  };

  const handlePick = (e) => {
    e.stopPropagation();
    updateMark(p.id, { our_pick: e.target.checked });
  };

  const [localNotes, setLocalNotes] = useState(mark.notes || "");
  useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalNotes(mark.notes || "");
    }
  }, [p.id, mark.notes]);

  const timerRef = useRef(null);
  const handleNotesChange = (val) => {
    setLocalNotes(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      updateMark(p.id, { notes: val });
    }, 800);
  };

  const handleNotesBlur = () => {
    clearTimeout(timerRef.current);
    updateMark(p.id, { notes: localNotes });
  };

  return (
    <div
      className={`flip-card h-[340px] ${flipped ? "flipped" : ""}`}
      tabIndex={0}
      role="button"
      aria-label={`${p.id}: ${p.title}. Press Enter to flip`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFlipped((f) => !f); }
      }}
      onClick={(e) => {
        if (!flipped || !e.target.closest(".no-flip")) setFlipped((f) => !f);
      }}
      style={{ outline: "none" }}
    >
      <div className="flip-inner w-full h-full cursor-pointer focus-within:ring-2 ring-indigo-400 rounded-xl">
        {/* FRONT */}
        <div className="face absolute inset-0 bg-white border rounded-xl shadow-sm p-4 flex flex-col">
          <div className="flex justify-between items-start">
            <span className="font-bold text-indigo-700">#{rank} · {p.id}</span>
            <div className="flex items-center gap-1.5">
              {mark.our_pick && <span className="text-amber-500 font-bold text-sm" title="Our Pick">⭐</span>}
              {voteCount > 0 && (
                <span className="text-gray-500 text-[10px] font-semibold bg-gray-100 px-1.5 py-0.5 rounded-full" title={`Votes: ${voters.join(', ')}`}>
                  👍 {voteCount}
                </span>
              )}
              <span className="text-gray-300">⇄</span>
            </div>
          </div>
          <h3 className="mt-1 font-semibold text-sm leading-snug line-clamp-2">{p.title}</h3>
          <p className="text-xs text-gray-500 mt-1 truncate">{p.organization}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{p.theme}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${diffCls}`}>{p.difficulty}</span>
          </div>
          <div className="mt-auto flex items-center gap-3">
            <ScoreRing value={scoring.score} />
            <div className="min-w-0">
              <div className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${q.cls}`}>{q.label}</div>
              <p className="text-[11px] text-gray-400 mt-1">click to flip ↻</p>
            </div>
          </div>
        </div>

        {/* BACK */}
        <div className="face back-face absolute inset-0 bg-white border rounded-xl shadow-md p-3 flex flex-col text-xs overflow-hidden">
          <div className="flex justify-between items-start gap-2">
            <h4 className="font-semibold leading-snug line-clamp-2">{p.title}</h4>
            <button
              className="shrink-0 no-flip border rounded px-2 py-0.5 hover:bg-gray-100"
              onClick={(e) => { e.stopPropagation(); setFlipped(false); }}
            >✕</button>
          </div>
          <div className="overflow-y-auto mt-1 pr-1 flex-1 space-y-2">
            <p className="text-gray-600 italic">{p.problemSummary}</p>
            <div>
              <b>Skills:</b>{" "}
              {scoring.details.map((d) => (
                <span
                  key={d.skill}
                  title={d.best ? `${d.best.member} (${d.best.level}/5)` : d.covered ? "" : "not covered"}
                  className={`inline-block m-0.5 px-1.5 py-0.5 rounded-full ${
                    d.covered ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-500"
                  }`}
                >
                  {d.skill}{d.best ? ` ·${d.best.member}` : ""}
                </span>
              ))}
            </div>
            <div>
              <b>Tech stack:</b>
              <ul className="list-disc ml-4">
                {p.techStack.slice(0, 6).map((t) => <li key={t}>{t}</li>)}
              </ul>
            </div>
            <div className="bg-indigo-50 border-l-4 border-indigo-400 p-2 rounded">
              <b>Worked example:</b> {p.workedExample}
            </div>
            <div className="max-h-28 overflow-y-auto whitespace-pre-wrap text-gray-600 no-flip" onClick={(e) => e.stopPropagation()}>
              <b>Description:</b> {p.description}
            </div>
          </div>

          {/* Collaboration section */}
          <div className="border-t pt-2 mt-2 space-y-1.5 no-flip shrink-0" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-4">
              <button
                onClick={handleVote}
                disabled={!myName}
                className={`flex items-center gap-1 px-2 py-1 rounded border text-xs font-semibold transition ${
                  hasVoted
                    ? "bg-indigo-100 text-indigo-700 border-indigo-300"
                    : "bg-white hover:bg-gray-50 text-gray-600 border-gray-300 disabled:opacity-50"
                }`}
                title={!myName ? "Select your slot first to vote" : voters.length ? `Voters: ${voters.join(", ")}` : "Vote"}
              >
                <span>👍</span>
                <span>{voteCount > 0 ? `${voteCount} Vote${voteCount > 1 ? "s" : ""}` : "Vote"}</span>
              </button>

              <label className={`flex items-center gap-1.5 font-semibold select-none ${!myName ? "opacity-50 cursor-not-allowed" : "cursor-pointer text-gray-700"}`}>
                <input
                  type="checkbox"
                  disabled={!myName}
                  checked={mark.our_pick || false}
                  onChange={handlePick}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <span>⭐ Our Pick</span>
              </label>
            </div>

            <div>
              <textarea
                placeholder={myName ? "Add collaborative notes..." : "Select slot first to edit notes..."}
                disabled={!myName}
                value={localNotes}
                onFocus={() => { isFocusedRef.current = true; }}
                onChange={(e) => handleNotesChange(e.target.value)}
                onBlur={() => {
                  isFocusedRef.current = false;
                  handleNotesBlur();
                }}
                className="w-full border rounded p-1 text-[11px] h-10 resize-none focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main app                                                           */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Slot Picker Modal (on first load)                                  */
/* ------------------------------------------------------------------ */
function SlotPickerModal({ members, onSelect, refetch }) {
  const [name, setName] = useState("");
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");

  const handleSelect = async () => {
    if (selectedSlot === null || !name.trim() || joining) return;
    setJoining(true);
    setError("");

    try {
      // Re-fetch fresh state from DB to prevent race conditions
      const freshMembers = await refetch();
      const target = freshMembers.find(m => m.slot === selectedSlot);

      if (target && target.name && target.name.trim()) {
        // Slot was taken between when we loaded and when we clicked
        setError(`Slot ${selectedSlot + 1} was just taken by "${target.name}". Please pick another.`);
        setSelectedSlot(null);
        setJoining(false);
        return;
      }

      onSelect({ slot: selectedSlot, name: name.trim() });
    } catch (err) {
      setError("Connection error. Please try again.");
      setJoining(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-slate-100">
        <h2 className="text-xl font-bold text-indigo-900 flex items-center gap-2">
          <span>🤝</span> Realtime Team Sync
        </h2>
        <p className="text-xs text-gray-500 leading-relaxed">
          Please select an empty slot and enter your name to collaborate in real-time with your team.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg font-medium">
            ⚠️ {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {members.map((m) => {
            const occupied = !!(m.name && m.name.trim());
            const isSelected = selectedSlot === m.slot;
            return (
              <button
                key={m.slot}
                disabled={(occupied && !isSelected) || joining}
                onClick={() => { setSelectedSlot(m.slot); setError(""); }}
                className={`p-3 border rounded-xl text-left transition duration-200 flex flex-col justify-between h-20 ${
                  occupied
                    ? "bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed"
                    : isSelected
                    ? "border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500 shadow-sm"
                    : "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/10 cursor-pointer"
                }`}
              >
                <span className={`font-semibold text-sm ${isSelected ? "text-indigo-700" : "text-slate-700"}`}>
                  Slot {m.slot + 1}
                </span>
                <span className="text-xs text-slate-500 truncate w-full">
                  {occupied ? `👤 ${m.name}` : "✨ Available"}
                </span>
              </button>
            );
          })}
        </div>

        {selectedSlot !== null && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 block">Your Name</label>
            <input
              type="text"
              maxLength={30}
              disabled={joining}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-1 focus:ring-indigo-500 focus:outline-none disabled:bg-slate-50"
              placeholder="e.g. Alice"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSelect(); }}
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            disabled={selectedSlot === null || !name.trim() || joining}
            onClick={handleSelect}
            className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition duration-200 flex items-center justify-center gap-2"
          >
            {joining ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                Joining...
              </>
            ) : (
              "Join Team"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main app                                                           */
/* ------------------------------------------------------------------ */
export default function App() {
  const [showOnboarding, setShowOnboarding] = useState(true);

  // Load slot configuration from localStorage
  const [me, setMe] = useState(() => {
    try {
      const saved = localStorage.getItem("sih_me");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Use team synchronization hooks
  const { members, setMembers, saveSlot, saveSlotNow, refetch, ready: teamReady, dbError } = useTeamSync(me);
  const { marks, updateMark } = useMarksSync();
  const online = usePresence(me?.name);

  // If cloud is active, verify that our local slot matches what's in Supabase,
  // or handle slot ownership.
  useEffect(() => {
    if (isCloud && teamReady && me) {
      const mySlot = members.find((m) => m.slot === me.slot);
      if (mySlot && mySlot.name && mySlot.name !== me.name) {
        localStorage.removeItem("sih_me");
        setMe(null);
        alert(`Slot ${me.slot + 1} has been taken by "${mySlot.name}". Please pick another slot.`);
      } else if (mySlot && !mySlot.name) {
        saveSlotNow(me.slot, { name: me.name });
      }
    }
  }, [isCloud, teamReady, members, me, saveSlotNow]);

  const activeMembers = members.filter((m) => m.name.trim() || (m.skills && Object.keys(m.skills).length));

  const allThemes = useMemo(() => [...new Set(PROBLEMS.map((p) => p.theme))].sort(), []);
  const [themeSel, setThemeSel] = useState(() => new Set(allThemes));
  const [diffSel, setDiffSel] = useState(() => new Set(DIFFICULTIES));
  const [quadSel, setQuadSel] = useState(() => new Set(QUADRANTS.map((q) => q.key)));

  const scored = useMemo(
    () =>
      PROBLEMS.map((p) => ({ p, scoring: scoreProblem(p, activeMembers) })),
    [activeMembers]
  );

  // Filter (AND across categories, OR within), then re-rank the visible subset
  const visible = useMemo(() => {
    return scored
      .filter(({ p }) =>
        themeSel.has(p.theme) &&
        diffSel.has(p.difficulty) &&
        quadSel.has(quadrantOf(p))
      )
      .sort(
        (a, b) =>
          b.scoring.score - a.scoring.score ||
          COMP_RANK[a.p.estimatedCompetition] - COMP_RANK[b.p.estimatedCompetition]
      );
  }, [scored, themeSel, diffSel, quadSel]);

  // Team skill coverage strip
  const coverage = useMemo(() => {
    const map = new Map();
    for (const m of activeMembers) {
      if (!m.skills) continue;
      for (const [skill, lvl] of Object.entries(m.skills)) {
        const cur = map.get(skill) || { max: 0, count: 0 };
        cur.max = Math.max(cur.max, lvl);
        cur.count += 1;
        map.set(skill, cur);
      }
    }
    return map;
  }, [activeMembers]);

  const clearFilters = () => {
    setThemeSel(new Set(allThemes));
    setDiffSel(new Set(DIFFICULTIES));
    setQuadSel(new Set(QUADRANTS.map((q) => q.key)));
  };

  const exportTeam = () => {
    const blob = new Blob([JSON.stringify(members, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sih_team.json";
    a.click();
  };
  const importTeam = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then((t) => {
      try {
        const parsed = JSON.parse(t);
        const normalized = parsed.map((m, i) => ({
          slot: m.slot ?? m.idx ?? i,
          idx: m.slot ?? m.idx ?? i,
          name: m.name || "",
          skills: m.skills || {},
        }));
        setMembers(normalized);
        if (isCloud) {
          normalized.forEach((m) => {
            saveSlot(m.slot, { name: m.name, skills: m.skills });
          });
        }
      } catch {
        alert("Invalid team file");
      }
    });
  };

  const exportCSV = () => {
    const rows = [["Rank", "PS ID", "Title", "Theme", "Organization", "Difficulty", "Competition", "RiskReward", "TeamFitScore"]];
    visible.forEach(({ p, scoring }, i) => {
      rows.push([
        i + 1, p.id, `"${p.title.replace(/"/g, '""')}"`, p.theme,
        `"${p.organization}"`, p.difficulty, p.estimatedCompetition,
        `"${quadrantMeta[quadrantOf(p)].label}"`, scoring.score,
      ]);
    });
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sih_ranked_shortlist.csv";
    a.click();
  };

  const onChangeMember = (idx, nm) => {
    setMembers((prev) => prev.map((x, j) => (j === idx ? nm : x)));
    if (isCloud) {
      saveSlot(idx, { name: nm.name, skills: nm.skills });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Loading Overlay */}
      {isCloud && !teamReady && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 shadow-2xl space-y-4 max-w-sm w-full text-center">
            <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-sm font-semibold text-slate-700">Connecting to database...</p>
          </div>
        </div>
      )}

      {/* Slot Onboarding Picker Overlay */}
      {isCloud && teamReady && !dbError && !me && (
        <SlotPickerModal
          members={members}
          refetch={refetch}
          onSelect={async (chosen) => {
            const { error } = await saveSlotNow(chosen.slot, { name: chosen.name });
            if (error) {
              alert("Failed to claim slot. Please try again.");
              return;
            }
            localStorage.setItem("sih_me", JSON.stringify(chosen));
            setMe(chosen);
            // Also update local state immediately
            setMembers(prev => prev.map(m => m.slot === chosen.slot ? { ...m, name: chosen.name } : m));
          }}
        />
      )}

      {/* Database Error Banner */}
      {isCloud && dbError && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 shadow-2xl space-y-4 max-w-md w-full text-center">
            <div className="text-4xl">⚠️</div>
            <h2 className="text-lg font-bold text-red-700">Database Not Ready</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              Could not find the required tables. Please run the SQL schema in your Supabase Dashboard → SQL Editor:
            </p>
            <code className="block bg-slate-100 rounded-lg px-3 py-2 text-xs text-left overflow-x-auto whitespace-pre">supabase/schema.sql</code>
            <p className="text-xs text-gray-400">Error: {dbError}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition cursor-pointer"
            >
              Retry Connection
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-indigo-700 text-white px-4 py-3 flex flex-wrap items-center gap-3 sticky top-0 z-30 shadow">
        <div className="flex items-center gap-2">
          <h1 className="font-bold text-lg">SIH 2026 Skill-Match &amp; Ranking</h1>
          {!isCloud && (
            <span className="bg-amber-500/20 text-amber-200 text-[10px] px-2 py-0.5 rounded-full border border-amber-500/30">
              Offline Mode
            </span>
          )}
        </div>
        <span className="text-xs opacity-80">{PROBLEMS.length} software problems · deadline 20 Sep 2026</span>

        {/* Presence Indicator */}
        {isCloud && online.length > 0 && (
          <div className="flex items-center gap-1.5 ml-4">
            <span className="text-[10px] text-indigo-200 uppercase tracking-wider font-bold">Online:</span>
            <div className="flex flex-wrap gap-1">
              {online.map((name) => (
                <span key={name} className="flex items-center gap-1 bg-indigo-850 px-2 py-0.5 rounded-full text-[11px] font-medium border border-indigo-650/50">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="ml-auto flex items-center gap-3 text-xs">
          {/* Active Slot Profile */}
          {isCloud && me && (
            <div className="flex items-center gap-2 bg-indigo-800 px-3 py-1 rounded-lg border border-indigo-600">
              <span>👤 <b>{me.name}</b> (Slot {me.slot + 1})</span>
              <button
                onClick={async () => {
                  const slot = me.slot;
                  localStorage.removeItem("sih_me");
                  setMe(null);
                  setMembers(prev => prev.map(m => m.slot === slot ? { ...m, name: "", skills: {} } : m));
                  await saveSlotNow(slot, { name: "", skills: {} });
                }}
                className="underline hover:text-indigo-200 font-medium cursor-pointer"
              >
                Switch slot
              </button>
            </div>
          )}

          <button onClick={() => setShowOnboarding((v) => !v)} className="border rounded px-3 py-1 hover:bg-indigo-600 cursor-pointer">
            {showOnboarding ? "Hide team panel" : "Edit team"}
          </button>
          <button onClick={exportTeam} className="border rounded px-3 py-1 hover:bg-indigo-600 cursor-pointer">Export team</button>
          <label className="border rounded px-3 py-1 hover:bg-indigo-600 cursor-pointer">
            Import team<input type="file" accept=".json" hidden onChange={importTeam} />
          </label>
        </div>
      </header>

      {/* Cloud Status Banner */}
      {!isCloud && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-800 px-4 py-1.5 text-xs text-center font-medium shadow-sm">
          ⚠️ Running in Offline Mode. Configure <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to enable realtime collaboration.
        </div>
      )}

      <main className="max-w-7xl mx-auto p-4 space-y-4">
        {/* Onboarding */}
        {showOnboarding && (
          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {members.map((m, i) => (
              <MemberSlot
                key={i}
                idx={i}
                member={m}
                readOnly={isCloud && (!me || i !== me.slot)}
                onChange={(nm) => onChangeMember(i, nm)}
              />
            ))}
          </section>
        )}

        {/* Coverage strip */}
        <section className="bg-white border rounded-xl p-3 shadow-sm">
          <h2 className="text-sm font-semibold mb-2">Team Skill Coverage (max expertise · members)</h2>
          {coverage.size === 0 ? (
            <p className="text-xs text-gray-500">No skills entered yet — scores will use the mismatch cap until you add team skills.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {[...coverage.entries()].sort((a, b) => b[1].max - a[1].max).map(([skill, c]) => (
                <span key={skill} className="text-xs px-2 py-1 rounded-full bg-indigo-50 border border-indigo-200">
                  {skill} · <b>{c.max}/5</b> × {c.count}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Filters + legend */}
        <section className="flex flex-wrap items-center gap-2">
          <MultiSelect label="Theme" options={allThemes} selected={themeSel} setSelected={setThemeSel} />
          <MultiSelect label="Difficulty" options={DIFFICULTIES} selected={diffSel} setSelected={setDiffSel} />
          <MultiSelect label="Risk/Reward" options={QUADRANTS.map((q) => q.key)} selected={quadSel} setSelected={setQuadSel} />
          <button onClick={clearFilters} className="text-sm border rounded-lg px-3 py-1.5 bg-white hover:bg-gray-100 cursor-pointer">Clear filters</button>
          <button onClick={exportCSV} className="text-sm border rounded-lg px-3 py-1.5 bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer">⬇ Export CSV</button>
          <span className="text-sm text-gray-500 ml-auto">Showing {visible.length} of {PROBLEMS.length} problems</span>
        </section>

        {/* Quadrant legend */}
        <section className="flex flex-wrap gap-2 text-[11px]">
          {QUADRANTS.map((q) => (
            <span key={q.key} className={`px-2 py-0.5 rounded-full border ${q.cls}`}>{q.label}</span>
          ))}
        </section>

        {/* Results */}
        {visible.length === 0 ? (
          <div className="text-center py-16 text-gray-500 border rounded-xl bg-white">
            No problems match these filters — try widening your selection.
          </div>
        ) : (
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-10">
            {visible.map(({ p, scoring }, i) => (
              <ProblemCard
                key={p.id}
                rank={i + 1}
                p={p}
                scoring={scoring}
                mark={marks[p.id]}
                myName={me?.name}
                updateMark={updateMark}
              />
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
