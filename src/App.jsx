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

  const isClaimed = !!(member.name && member.name.trim());

  if (readOnly) {
    const hasSkills = Object.keys(member.skills || {}).length > 0;
    return (
      <div className="border border-slate-100 rounded-2xl p-4 bg-slate-50/40 shadow-sm transition hover:shadow-md duration-200 flex flex-col justify-between min-h-[140px]">
        <div>
          <div className="font-semibold text-xs text-slate-400 uppercase tracking-wider mb-1">
            Slot {idx + 1}
          </div>
          <div className="font-bold text-base text-slate-800 mb-3 truncate flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${isClaimed ? "bg-indigo-400 animate-pulse" : "bg-slate-300"}`}></span>
            {isClaimed ? member.name : "Available Slot"}
          </div>
        </div>
        {hasSkills ? (
          <div className="flex flex-wrap gap-1.5 mt-auto">
            {Object.entries(member.skills).map(([skill, lvl]) => (
              <span
                key={skill}
                className="text-[10px] px-2.5 py-1 rounded-lg bg-indigo-50/60 border border-indigo-100/50 text-indigo-700 font-semibold transition hover:bg-indigo-50"
                title={`${skill}: ${lvl}/5`}
              >
                {skill} · <span className="text-indigo-850 font-extrabold">{lvl}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs text-slate-400 italic mt-auto">No skills added yet</span>
        )}
      </div>
    );
  }

  return (
    <div className="border border-indigo-200 rounded-2xl p-5 bg-white shadow-md ring-2 ring-indigo-500/10 flex flex-col justify-between min-h-[180px]">
      <div>
        <div className="flex justify-between items-center mb-3">
          <span className="text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-lg uppercase tracking-wider">
            Slot {idx + 1} (You)
          </span>
          {isClaimed && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-lg">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Active Session
            </div>
          )}
        </div>
        
        {isClaimed ? (
          <div className="font-extrabold text-lg text-slate-800 tracking-tight truncate mb-4">
            {member.name}
          </div>
        ) : (
          <div className="mb-4">
            <label className="text-xs font-bold text-slate-500 block mb-1">Your Name</label>
            <input
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-slate-50/50 hover:bg-slate-50 focus:bg-white transition"
              placeholder="e.g. Alice"
              value={member.name}
              onChange={(e) => update({ name: e.target.value })}
            />
          </div>
        )}
      </div>

      <div>
        <label className="text-xs font-bold text-slate-500 block mb-2">My Skills & Expertise</label>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {SKILLS.map((s) => {
            const has = member.skills && member.skills[s] != null;
            return (
              <button
                key={s}
                onClick={() => toggleSkill(s)}
                className={`text-[11px] px-3 py-1 rounded-xl border font-medium transition cursor-pointer duration-150 ${
                  has
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-100"
                    : "bg-slate-50 text-slate-600 border-slate-200/80 hover:bg-slate-100"
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>

        {Object.entries(member.skills || {}).map(([skill, lvl]) => (
          <div key={skill} className="flex items-center gap-3 text-xs bg-slate-50/60 p-2.5 rounded-xl border border-slate-100 mb-2 transition hover:bg-slate-50">
            <span className="flex-1 font-semibold text-slate-700 truncate" title={skill}>{skill}</span>
            <input
              type="range" min="1" max="5" value={lvl}
              onChange={(e) => update({ skills: { ...member.skills, [skill]: Number(e.target.value) } })}
              className="w-28 accent-indigo-600 h-1.5 bg-slate-200 rounded-lg cursor-pointer"
            />
            <span className="w-5 text-center font-extrabold text-indigo-700">{lvl}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MultiSelect({ label, options, selected, setSelected }) {
  const allSelected = selected.size === options.length;
  return (
    <div className="relative inline-block text-left">
      <details className="group">
        <summary className="cursor-pointer list-none border border-slate-200/80 rounded-xl px-4 py-2 text-sm bg-white hover:bg-slate-50 focus:outline-none select-none transition duration-150 flex items-center gap-1.5 font-medium text-slate-700 shadow-sm">
          <span>{label}:</span>
          <span className="text-indigo-600 font-bold">
            {allSelected ? "All" : `${selected.size} Selected`}
          </span>
          <span className="text-xs text-slate-400 group-open:rotate-180 transition-transform duration-200 ml-0.5">▼</span>
        </summary>
        <div className="absolute z-20 mt-1.5 max-h-72 overflow-auto border border-slate-100 rounded-xl bg-white shadow-xl p-2 w-64 left-0 sm:left-auto right-0 max-w-[calc(100vw-2rem)] ring-1 ring-slate-900/5 divide-y divide-slate-50 animate-in fade-in slide-in-from-top-1 duration-150">
          {options.map((o) => (
            <label key={o} className="flex items-center gap-3 px-3 py-2 text-sm rounded-lg hover:bg-indigo-50/50 cursor-pointer transition text-slate-700 hover:text-indigo-900">
              <input
                type="checkbox"
                checked={selected.has(o)}
                className="w-4 h-4 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500 focus:ring-offset-0 cursor-pointer"
                onChange={() => {
                  const next = new Set(selected);
                  next.has(o) ? next.delete(o) : next.add(o);
                  setSelected(next);
                }}
              />
              <span className="font-medium truncate">{o}</span>
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

function ProblemCard({ rank, p, scoring, mark = { votes: {}, our_pick: false, notes: "" }, myName, updateMark, missingSkills, isComparing, onToggleCompare }) {
  const [flipped, setFlipped] = useState(false);
  const q = quadrantMeta[quadrantOf(p)];
  const diffCls =
    p.difficulty === "Hard" ? "bg-rose-50 text-rose-700 border-rose-100" :
    p.difficulty === "Medium" ? "bg-amber-50 text-amber-700 border-amber-100" : "bg-emerald-50 text-emerald-700 border-emerald-100";

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
      <div className="flip-inner w-full h-full cursor-pointer focus-within:ring-2 ring-indigo-400 rounded-2xl">
        {/* FRONT */}
        <div className="face absolute inset-0 bg-white border border-slate-100 rounded-2xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.03)] hover:shadow-md transition duration-300 p-5 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-indigo-600 bg-indigo-50/70 px-2 py-0.5 rounded-lg">#{rank} · {p.id}</span>
              <div className="flex items-center gap-1.5">
                {mark.our_pick && <span className="text-amber-500 text-sm" title="Our Pick">⭐</span>}
                {voteCount > 0 && (
                  <span className="text-slate-500 text-[10px] font-bold bg-slate-100/80 px-2 py-0.5 rounded-lg border border-slate-200/50" title={`Votes: ${voters.join(', ')}`}>
                    👍 {voteCount}
                  </span>
                )}
                <span className="text-slate-300 font-bold hover:text-slate-400 text-sm">⇄</span>
              </div>
            </div>
            <h3 className="font-extrabold text-sm text-slate-800 leading-snug line-clamp-2 tracking-tight">{p.title}</h3>
            <p className="text-[11px] font-semibold text-slate-400 mt-1 truncate uppercase tracking-wider">{p.organization}</p>
            
            <div className="mt-3 flex flex-wrap gap-1">
              <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-50 border border-slate-250/30 text-slate-500">{p.theme}</span>
              <span className={`text-[10px] font-bold px-2 py-1 rounded-lg border ${diffCls}`}>{p.difficulty}</span>
            </div>
            
            {missingSkills && missingSkills.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {missingSkills.slice(0, 2).map(s => (
                  <span key={s} className="text-[9px] font-extrabold px-2 py-0.5 rounded-lg bg-rose-50 text-rose-600 border border-rose-100" title={`No team member covers: ${s}`}>⚠ {s}</span>
                ))}
                {missingSkills.length > 2 && (
                  <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-lg bg-rose-100/50 text-rose-500 border border-rose-100">+{missingSkills.length - 2} gaps</span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 pt-3 border-t border-slate-50 mt-auto">
            <ScoreRing value={scoring.score} />
            <div className="min-w-0 flex-1">
              <div className={`inline-block text-[10px] font-extrabold px-2.5 py-1 rounded-lg border ${q.cls}`}>{q.label}</div>
              <p className="text-[10px] text-slate-400 mt-1 font-semibold">click to flip ↻</p>
            </div>
            <button
              className={`no-flip shrink-0 w-8 h-8 rounded-xl border flex items-center justify-center text-xs font-bold transition duration-200 cursor-pointer ${
                isComparing 
                  ? "bg-indigo-600 border-indigo-650 text-white shadow-sm shadow-indigo-100" 
                  : "bg-white border-slate-200 text-slate-400 hover:border-indigo-400 hover:text-indigo-600"
              }`}
              title={isComparing ? "Remove from comparison" : "Add to comparison"}
              onClick={(e) => { e.stopPropagation(); onToggleCompare(p.id); }}
            >
              {isComparing ? "✓" : "⇔"}
            </button>
          </div>
        </div>

        {/* BACK */}
        <div className="face back-face absolute inset-0 bg-white border border-slate-100 rounded-2xl shadow-lg p-4 flex flex-col justify-between text-xs overflow-hidden">
          <div className="flex justify-between items-start gap-3 mb-2">
            <h4 className="font-extrabold text-slate-800 leading-snug line-clamp-2 tracking-tight text-xs">{p.title}</h4>
            <button
              className="shrink-0 no-flip border border-slate-200 text-slate-400 hover:text-slate-600 rounded-lg w-6 h-6 flex items-center justify-center font-bold hover:bg-slate-50 transition cursor-pointer"
              onClick={(e) => { e.stopPropagation(); setFlipped(false); }}
            >✕</button>
          </div>
          
          <div className="overflow-y-auto pr-1 flex-1 space-y-3 custom-scrollbar text-[11px]">
            <p className="text-slate-500 italic leading-relaxed">{p.problemSummary}</p>
            
            <div>
              <div className="font-bold text-slate-700 mb-1">Required Skills:</div>
              <div className="flex flex-wrap gap-1">
                {scoring.details.map((d) => (
                  <span
                    key={d.skill}
                    title={d.best ? `${d.best.member} (${d.best.level}/5)` : d.covered ? "" : "not covered"}
                    className={`inline-block px-2 py-0.5 rounded-lg font-medium border text-[10px] ${
                      d.covered 
                        ? "bg-emerald-50 border-emerald-100 text-emerald-700" 
                        : "bg-slate-100 border-slate-200 text-slate-500"
                    }`}
                  >
                    {d.skill}{d.best ? ` · ${d.best.member}` : ""}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <div className="font-bold text-slate-700 mb-1">Tech Stack:</div>
              <div className="flex flex-wrap gap-1">
                {p.techStack.slice(0, 6).map((t) => (
                  <span key={t} className="px-2 py-0.5 rounded-lg bg-indigo-50 border border-indigo-100/50 text-indigo-700 text-[10px] font-semibold">{t}</span>
                ))}
              </div>
            </div>

            <div className="bg-indigo-50/50 border-l-4 border-indigo-500 p-2.5 rounded-r-xl">
              <span className="font-bold text-indigo-900 block mb-0.5">Worked Example:</span>
              <span className="text-indigo-950 block">{p.workedExample}</span>
            </div>

            <div className="whitespace-pre-wrap text-slate-500 no-flip" onClick={(e) => e.stopPropagation()}>
              <span className="font-bold text-slate-700 block mb-0.5">Full Description:</span>
              <span className="leading-relaxed">{p.description}</span>
            </div>
          </div>

          {/* Collaboration section */}
          <div className="border-t border-slate-100 pt-3 mt-3 space-y-2 no-flip shrink-0" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-4">
              <button
                onClick={handleVote}
                disabled={!myName}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition duration-150 cursor-pointer ${
                  hasVoted
                    ? "bg-indigo-600 border-indigo-600 text-white shadow-sm shadow-indigo-100"
                    : "bg-white hover:bg-slate-50 text-slate-600 border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                }`}
                title={!myName ? "Select your slot first to vote" : voters.length ? `Voters: ${voters.join(", ")}` : "Vote"}
              >
                <span>👍</span>
                <span>{voteCount > 0 ? `${voteCount} Vote${voteCount > 1 ? "s" : ""}` : "Vote"}</span>
              </button>

              <label className={`flex items-center gap-2 font-bold select-none text-xs ${!myName ? "opacity-50 cursor-not-allowed" : "cursor-pointer text-slate-700 hover:text-indigo-600"}`}>
                <input
                  type="checkbox"
                  disabled={!myName}
                  checked={mark.our_pick || false}
                  onChange={handlePick}
                  className="w-4 h-4 rounded text-indigo-600 border-slate-350 focus:ring-indigo-550 focus:ring-offset-0 cursor-pointer"
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
                className="w-full border border-slate-200 rounded-xl p-2 text-[11px] h-12 resize-none focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-slate-50/30 hover:bg-slate-50/80 focus:bg-white transition"
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
  const [pin, setPin] = useState("");
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");

  const targetSlot = members.find((m) => m.slot === selectedSlot);
  const isOccupied = !!(targetSlot && targetSlot.name && targetSlot.name.trim());

  const handleSlotClick = (m) => {
    setSelectedSlot(m.slot);
    setError("");
    setPin("");
    if (m.name && m.name.trim()) {
      setName(m.name);
    } else {
      setName("");
    }
  };

  const handleSelect = async () => {
    if (selectedSlot === null || joining) return;
    setJoining(true);
    setError("");

    try {
      // Re-fetch fresh state from DB to prevent race conditions
      const freshMembers = await refetch();
      const dbTarget = freshMembers.find((m) => m.slot === selectedSlot);
      const dbOccupied = !!(dbTarget && dbTarget.name && dbTarget.name.trim());

      if (isOccupied || dbOccupied) {
        // Re-claiming an occupied slot — verify password!
        const expectedPin = (dbTarget && dbTarget.pin) || "";
        if (expectedPin && pin.trim() !== expectedPin.trim()) {
          setError(`Incorrect password for ${dbTarget.name}'s slot.`);
          setJoining(false);
          return;
        }
        // Correct password -> Login into slot
        onSelect({ slot: selectedSlot, name: dbTarget.name, pin: expectedPin, isNew: false });
      } else {
        // Claiming an empty slot — require name and password!
        if (!name.trim()) {
          setError("Please enter your name.");
          setJoining(false);
          return;
        }
        if (!pin.trim()) {
          setError("Please set a password for your slot so you can access it later.");
          setJoining(false);
          return;
        }
        onSelect({ slot: selectedSlot, name: name.trim(), pin: pin.trim(), isNew: true });
      }
    } catch (err) {
      setError("Connection error. Please try again.");
      setJoining(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/70 flex items-center justify-center z-50 p-4 backdrop-blur-md">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-slate-100/80 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-lg text-indigo-600">
            👥
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-slate-800 tracking-tight">
              Realtime Team Sync
            </h2>
            <p className="text-[11px] text-slate-400 font-semibold tracking-wide uppercase">
              Smart India Hackathon 2026
            </p>
          </div>
        </div>
        
        <p className="text-xs text-slate-500 leading-relaxed font-medium">
          Select a slot to join. Empty slots require setting a password. Occupied slots require entering the slot password to access.
        </p>

        {error && (
          <div className="bg-rose-50 border border-rose-100 text-rose-700 text-xs px-3.5 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-sm">
            <span>⚠️</span> {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          {members.map((m) => {
            const occupied = !!(m.name && m.name.trim());
            const isSelected = selectedSlot === m.slot;
            return (
              <button
                key={m.slot}
                disabled={joining}
                onClick={() => handleSlotClick(m)}
                className={`p-3.5 border rounded-xl text-left transition duration-200 flex flex-col justify-between h-20 cursor-pointer shadow-sm ${
                  isSelected
                    ? "border-indigo-600 bg-indigo-50/40 ring-2 ring-indigo-500/20 shadow-sm"
                    : occupied
                    ? "border-slate-200/80 bg-slate-50/70 hover:border-slate-300 hover:bg-slate-50"
                    : "border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/10"
                }`}
              >
                <div className="flex justify-between items-center w-full">
                  <span className={`font-bold text-xs ${isSelected ? "text-indigo-700" : "text-slate-500"}`}>
                    Slot {m.slot + 1}
                  </span>
                  {occupied && (
                    <span className="text-[9px] bg-slate-200 text-slate-600 font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wider">
                      🔒 Secured
                    </span>
                  )}
                </div>
                <span className={`text-xs truncate w-full font-bold ${occupied ? "text-slate-700" : "text-slate-400 italic"}`}>
                  {occupied ? `👤 ${m.name}` : "✨ Available"}
                </span>
              </button>
            );
          })}
        </div>

        {selectedSlot !== null && (
          <div className="space-y-3 pt-3 border-t border-slate-100">
            {isOccupied ? (
              <div className="bg-indigo-50/50 border border-indigo-100/50 rounded-xl p-3.5 space-y-3 shadow-sm">
                <div className="text-xs font-bold text-indigo-900 flex items-center justify-between">
                  <span>Access Slot {selectedSlot + 1}</span>
                  <span className="text-indigo-600 font-extrabold uppercase bg-white border border-indigo-100 px-2 py-0.5 rounded">👤 {targetSlot.name}</span>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-500 block mb-1">Enter Password for {targetSlot.name}</label>
                  <input
                    type="password"
                    maxLength={30}
                    disabled={joining}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 focus:outline-none bg-white font-medium"
                    placeholder="Enter password..."
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSelect(); }}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Your Name</label>
                  <input
                    type="text"
                    maxLength={30}
                    disabled={joining}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 focus:outline-none font-medium"
                    placeholder="e.g. Alice"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Set Password (to protect your slot)</label>
                  <input
                    type="password"
                    maxLength={30}
                    disabled={joining}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 focus:outline-none font-medium"
                    placeholder="Set a slot password..."
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSelect(); }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            disabled={selectedSlot === null || (isOccupied ? !pin.trim() : (!name.trim() || !pin.trim())) || joining}
            onClick={handleSelect}
            className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-extrabold hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed transition duration-150 flex items-center justify-center gap-2 cursor-pointer shadow-sm hover:shadow"
          >
            {joining ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                Verifying...
              </>
            ) : isOccupied ? (
              `Unlock & Access Slot ${selectedSlot + 1}`
            ) : (
              `Claim & Protect Slot ${selectedSlot + 1}`
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
  const online = usePresence(me);

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
        localStorage.removeItem("sih_me");
        setMe(null);
      }
    }
  }, [isCloud, teamReady, members, me]);

  const activeMembers = members.filter((m) => m.name.trim() || (m.skills && Object.keys(m.skills).length));

  const allThemes = useMemo(() => [...new Set(PROBLEMS.map((p) => p.theme))].sort(), []);
  const [themeSel, setThemeSel] = useState(() => new Set(allThemes));
  const [diffSel, setDiffSel] = useState(() => new Set(DIFFICULTIES));
  const [quadSel, setQuadSel] = useState(() => new Set(QUADRANTS.map((q) => q.key)));
  const [searchQ, setSearchQ] = useState("");
  const [sortBy, setSortBy] = useState("score"); // "score" | "votes"
  const [compareIds, setCompareIds] = useState(new Set()); // for side-by-side comparison

  const scored = useMemo(
    () =>
      PROBLEMS.map((p) => ({ p, scoring: scoreProblem(p, activeMembers) })),
    [activeMembers]
  );

  // Filter (AND across categories, OR within), then re-rank the visible subset
  const visible = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return scored
      .filter(({ p }) =>
        themeSel.has(p.theme) &&
        diffSel.has(p.difficulty) &&
        quadSel.has(quadrantOf(p)) &&
        (!q || p.id.toLowerCase().includes(q) || p.title.toLowerCase().includes(q) || p.organization.toLowerCase().includes(q) || p.theme.toLowerCase().includes(q) || (p.techStack || []).some(t => t.toLowerCase().includes(q)) || (p.requiredSkills || []).some(s => s.toLowerCase().includes(q)))
      )
      .sort((a, b) => {
        if (sortBy === "votes") {
          const va = Object.values(marks[a.p.id]?.votes || {}).filter(Boolean).length;
          const vb = Object.values(marks[b.p.id]?.votes || {}).filter(Boolean).length;
          if (vb !== va) return vb - va;
        }
        return (
          b.scoring.score - a.scoring.score ||
          COMP_RANK[a.p.estimatedCompetition] - COMP_RANK[b.p.estimatedCompetition]
        );
      });
  }, [scored, themeSel, diffSel, quadSel, searchQ, sortBy, marks]);

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
    setSearchQ("");
    setSortBy("score");
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
        if (!Array.isArray(parsed)) throw new Error("Invalid format");
        const normalized = Array.from({ length: 6 }, (_, i) => {
          const item = parsed.find(x => (x && (x.slot === i || x.idx === i))) || parsed[i] || {};
          return {
            slot: i,
            idx: i,
            name: typeof item.name === "string" ? item.name.slice(0, 50) : "",
            skills: typeof item.skills === "object" && item.skills !== null ? item.skills : {},
          };
        });
        setMembers(normalized);
        if (isCloud) {
          normalized.forEach((m) => {
            saveSlotNow(m.slot, { name: m.name, skills: m.skills });
          });
        }
      } catch {
        alert("Invalid team file — must be a JSON array of member objects.");
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
      saveSlotNow(idx, { name: nm.name, skills: nm.skills });
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
            if (chosen.isNew) {
              const { error } = await saveSlotNow(chosen.slot, { name: chosen.name, pin: chosen.pin });
              if (error) {
                alert("Failed to claim slot. Please try again.");
                return;
              }
            }
            const meObj = { slot: chosen.slot, name: chosen.name };
            localStorage.setItem("sih_me", JSON.stringify(meObj));
            setMe(meObj);
            setMembers(prev => prev.map(m => m.slot === chosen.slot ? { ...m, name: chosen.name, pin: chosen.pin || m.pin } : m));
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
      <header className="bg-slate-900 border-b border-slate-800 text-white px-6 py-4 flex flex-wrap items-center gap-4 sticky top-0 z-30 shadow-md backdrop-blur-md bg-opacity-95">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center font-extrabold text-sm text-white shadow-md shadow-indigo-500/20">
            S
          </div>
          <div>
            <h1 className="font-extrabold text-base tracking-tight text-slate-100 flex items-center gap-2">
              SIH 2026 Skill-Match &amp; Ranking
              {!isCloud && (
                <span className="bg-amber-500/10 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-lg border border-amber-500/20">
                  Offline Mode
                </span>
              )}
            </h1>
            <p className="text-[11px] text-slate-400 font-semibold tracking-wide">
              {PROBLEMS.length} Software Problems · Deadline 20 Sep 2026
            </p>
          </div>
        </div>

        {/* Presence Indicator */}
        {isCloud && online.length > 0 && (
          <div className="hidden lg:flex items-center gap-2 ml-6 border-l border-slate-800 pl-6">
            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Online</span>
            <div className="flex flex-wrap gap-1.5">
              {online.map((name) => (
                <span key={name} className="flex items-center gap-1.5 bg-slate-800/80 px-2.5 py-1 rounded-xl text-xs font-semibold border border-slate-700/50 text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2.5 text-xs">
          {/* Active Slot Profile */}
          {isCloud && me && (
            <div className="flex items-center gap-3 bg-slate-800/90 border border-slate-750 px-3 py-1.5 rounded-xl shadow-sm">
              <span className="text-slate-300 font-medium flex items-center gap-1">
                <span className="text-slate-400 text-sm">👤</span> 
                <b>{me.name}</b> 
                <span className="text-slate-500 text-[10px] font-bold uppercase bg-slate-700 px-1.5 py-0.5 rounded">Slot {me.slot + 1}</span>
              </span>
              <button
                onClick={() => {
                  localStorage.removeItem("sih_me");
                  setMe(null);
                }}
                className="text-indigo-400 hover:text-indigo-300 font-semibold transition cursor-pointer hover:underline"
              >
                Switch slot
              </button>
            </div>
          )}

          <button 
            onClick={() => setShowOnboarding((v) => !v)} 
            className="border border-slate-700/60 rounded-xl px-3.5 py-2 font-bold hover:bg-slate-800 transition cursor-pointer text-slate-200"
          >
            {showOnboarding ? "Hide Team Panel" : "Edit Team"}
          </button>
          
          <button 
            onClick={exportTeam} 
            className="border border-slate-700/60 rounded-xl px-3.5 py-2 font-bold hover:bg-slate-800 transition cursor-pointer text-slate-200"
          >
            Export Team
          </button>
          
          <label className="border border-slate-700/60 rounded-xl px-3.5 py-2 font-bold hover:bg-slate-800 transition cursor-pointer text-slate-200 flex items-center gap-1.5">
            Import Team
            <input type="file" accept=".json" hidden onChange={importTeam} />
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
        <section className="bg-white border border-slate-200/60 rounded-2xl p-4 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.02)]">
          <h2 className="text-sm font-extrabold text-slate-700 mb-3 flex items-center gap-1.5 tracking-tight">
            <span>📊</span> Team Skill Coverage <span className="text-slate-400 font-semibold text-xs">(Max Expertise · Members)</span>
          </h2>
          {coverage.size === 0 ? (
            <p className="text-xs text-slate-400 italic">No skills entered yet — scores will use the mismatch cap until you add team skills.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {[...coverage.entries()].sort((a, b) => b[1].max - a[1].max).map(([skill, c]) => (
                <span key={skill} className="text-xs px-3 py-1.5 rounded-xl bg-indigo-50/60 border border-indigo-100/60 text-indigo-950 font-bold flex items-center gap-1.5 shadow-sm transition hover:bg-indigo-50">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                  {skill} · <span className="text-indigo-600">{c.max}/5</span> <span className="text-slate-400 font-medium">({c.count} {c.count > 1 ? "members" : "member"})</span>
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Search & Sort Controls */}
        <section className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-base">🔍</span>
            <input
              type="text"
              placeholder="Search by PS ID, title, organization, required skills, tech stack..."
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="w-full border border-slate-250/80 rounded-xl pl-10 pr-9 py-2.5 text-sm bg-white hover:border-slate-350 focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 focus:outline-none shadow-sm transition duration-150 font-medium text-slate-700 placeholder-slate-400"
            />
            {searchQ && (
              <button
                onClick={() => setSearchQ("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-extrabold text-xs cursor-pointer w-5 h-5 rounded-full hover:bg-slate-100 flex items-center justify-center transition"
              >✕</button>
            )}
          </div>
          
          <div className="flex items-center bg-white border border-slate-250/80 rounded-xl shadow-sm overflow-hidden p-1 shrink-0">
            <button
              onClick={() => setSortBy("score")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition duration-150 cursor-pointer ${
                sortBy === "score" 
                  ? "bg-indigo-600 text-white shadow-sm" 
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              Sort by Team Fit
            </button>
            <button
              onClick={() => setSortBy("votes")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition duration-150 cursor-pointer ${
                sortBy === "votes" 
                  ? "bg-indigo-600 text-white shadow-sm" 
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              Sort by Votes
            </button>
          </div>
        </section>

        {/* Filters & Export Actions */}
        <section className="flex flex-wrap items-center gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <MultiSelect label="Theme" options={allThemes} selected={themeSel} setSelected={setThemeSel} />
            <MultiSelect label="Difficulty" options={DIFFICULTIES} selected={diffSel} setSelected={setDiffSel} />
            <MultiSelect label="Risk/Reward" options={QUADRANTS.map((q) => q.key)} selected={quadSel} setSelected={setQuadSel} />
          </div>

          <div className="flex items-center gap-2 ml-auto sm:ml-0">
            <button 
              onClick={clearFilters} 
              className="text-xs border border-slate-200 rounded-xl px-4 py-2 bg-white hover:bg-slate-50 font-bold text-slate-600 transition shadow-sm cursor-pointer"
            >
              Clear Filters
            </button>
            
            <button 
              onClick={exportCSV} 
              className="text-xs rounded-xl px-4 py-2 bg-emerald-600 text-white hover:bg-emerald-700 font-bold transition shadow-sm hover:shadow duration-150 cursor-pointer flex items-center gap-1.5"
            >
              <span>⬇</span> Export CSV
            </button>
            
            {compareIds.size > 0 && (
              <button
                onClick={() => setCompareIds(new Set())}
                className="text-xs border border-rose-200 rounded-xl px-4 py-2 bg-rose-50 text-rose-600 hover:bg-rose-100 font-bold transition cursor-pointer"
              >
                Clear Compare ({compareIds.size})
              </button>
            )}
          </div>
          
          <span className="text-xs font-bold text-slate-400 ml-auto hidden md:inline-block">
            Showing {visible.length} of {PROBLEMS.length} Problems
          </span>
        </section>

        {/* Quadrant legend */}
        <section className="flex flex-wrap gap-2 text-[10px] font-bold">
          {QUADRANTS.map((q) => (
            <span key={q.key} className={`px-2.5 py-1 rounded-lg border ${q.cls} shadow-sm`}>{q.label}</span>
          ))}
        </section>

        {/* Results */}
        {visible.length === 0 ? (
          <div className="text-center py-16 text-gray-500 border rounded-xl bg-white">
            No problems match these filters — try widening your selection.
          </div>
        ) : (
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-10">
            {visible.map(({ p, scoring }, i) => {
              const missing = scoring.details.filter(d => !d.covered).map(d => d.skill);
              return (
                <ProblemCard
                  key={p.id}
                  rank={i + 1}
                  p={p}
                  scoring={scoring}
                  mark={marks[p.id]}
                  myName={me?.name}
                  updateMark={updateMark}
                  missingSkills={missing}
                  isComparing={compareIds.has(p.id)}
                  onToggleCompare={(id) => setCompareIds(prev => {
                    const next = new Set(prev);
                    next.has(id) ? next.delete(id) : next.add(id);
                    return next;
                  })}
                />
              );
            })}
          </section>
        )}
      </main>

      {/* Floating Compare Bar */}
      {compareIds.size >= 2 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-950/95 border border-slate-800/80 text-white px-5 py-3 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.3)] flex items-center gap-4 text-xs font-semibold backdrop-blur-md animate-in slide-in-from-bottom-6 duration-200">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
            {compareIds.size} Contenders Selected
          </span>
          <button
            onClick={() => document.getElementById("compare-modal").showModal()}
            className="bg-indigo-600 text-white font-extrabold px-4.5 py-2 rounded-xl hover:bg-indigo-700 hover:shadow-md transition duration-150 cursor-pointer flex items-center gap-1"
          >
            ⇔ Compare Side-by-Side
          </button>
          <button
            onClick={() => setCompareIds(new Set())}
            className="text-slate-400 hover:text-white underline cursor-pointer"
          >
            Clear
          </button>
        </div>
      )}

      {/* Comparison Modal */}
      <dialog id="compare-modal" className="w-[95vw] max-w-6xl max-h-[85vh] rounded-3xl shadow-2xl p-0 border border-slate-100 backdrop:bg-slate-950/40 backdrop:backdrop-blur-sm focus:outline-none">
        <div className="p-6 overflow-auto max-h-[85vh] custom-scrollbar">
          <div className="flex justify-between items-center mb-5 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="text-xl">⇔</span>
              <div>
                <h2 className="text-lg font-extrabold text-slate-800 tracking-tight">Side-by-Side Comparison</h2>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Evaluate &amp; Choose Your Target Problem Statement</p>
              </div>
            </div>
            <button
              onClick={() => document.getElementById("compare-modal").close()}
              className="text-slate-400 hover:text-slate-600 w-8 h-8 rounded-xl border border-slate-200 flex items-center justify-center font-extrabold hover:bg-slate-50 transition cursor-pointer"
            >✕</button>
          </div>
          {(() => {
            const items = scored.filter(({ p }) => compareIds.has(p.id));
            if (items.length < 2) return <p className="text-slate-400 italic text-sm text-center py-10">Select at least 2 problems to compare.</p>;
            return (
              <div className="overflow-x-auto rounded-2xl border border-slate-200/60 shadow-sm">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="text-left p-4 border-b border-slate-200/60 font-bold text-slate-500 w-44 uppercase tracking-wider">Attribute</th>
                      {items.map(({ p }) => (
                        <th key={p.id} className="text-left p-4 border-b border-slate-200/60 font-extrabold text-indigo-700 min-w-[240px] text-sm tracking-tight">{p.id}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr className="hover:bg-slate-50/50 transition"><td className="p-4 font-bold text-slate-500 bg-slate-50/20">Title</td>{items.map(({ p }) => <td key={p.id} className="p-4 font-extrabold text-slate-800 leading-snug">{p.title}</td>)}</tr>
                    <tr className="hover:bg-slate-50/50 transition"><td className="p-4 font-bold text-slate-500 bg-slate-50/20">Organization</td>{items.map(({ p }) => <td key={p.id} className="p-4 text-slate-500 font-medium">{p.organization}</td>)}</tr>
                    <tr className="hover:bg-slate-50/50 transition"><td className="p-4 font-bold text-slate-500 bg-slate-50/20">Theme</td>{items.map(({ p }) => <td key={p.id} className="p-4"><span className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-650 font-bold">{p.theme}</span></td>)}</tr>
                    <tr className="hover:bg-slate-50/50 transition"><td className="p-4 font-bold text-slate-500 bg-slate-50/20">Difficulty</td>{items.map(({ p }) => <td key={p.id} className="p-4"><span className={`px-2.5 py-1 rounded-lg border font-bold ${p.difficulty === "Hard" ? "bg-rose-50 text-rose-700 border-rose-100" : p.difficulty === "Medium" ? "bg-amber-50 text-amber-700 border-amber-100" : "bg-emerald-50 text-emerald-700 border-emerald-100"}`}>{p.difficulty}</span></td>)}</tr>
                    <tr className="hover:bg-slate-50/50 transition"><td className="p-4 font-bold text-slate-500 bg-slate-50/20">Competition</td>{items.map(({ p }) => <td key={p.id} className="p-4 font-semibold text-slate-700">{p.estimatedCompetition} Competition</td>)}</tr>
                    <tr className="bg-indigo-50/20 hover:bg-indigo-50/30 transition"><td className="p-4 font-extrabold text-indigo-700 bg-indigo-50/10">Team Fit Score</td>{items.map(({ p, scoring }) => <td key={p.id} className="p-4 font-black text-xl text-indigo-700">{scoring.score}%</td>)}</tr>
                    <tr className="hover:bg-slate-50/50 transition"><td className="p-4 font-bold text-slate-500 bg-slate-50/20">Team Votes</td>{items.map(({ p }) => { const v = Object.values(marks[p.id]?.votes || {}).filter(Boolean).length; return <td key={p.id} className="p-4 font-bold text-slate-700">{v > 0 ? `👍 ${v}` : "—"}</td>; })}</tr>
                    <tr className="hover:bg-slate-50/50 transition"><td className="p-4 font-bold text-slate-500 bg-slate-50/20">Required Skills</td>{items.map(({ p, scoring }) => <td key={p.id} className="p-4"><div className="flex flex-wrap gap-1">{scoring.details.map(d => <span key={d.skill} className={`text-[10px] px-2 py-0.5 rounded-lg border font-medium ${d.covered ? "bg-emerald-50 border-emerald-100 text-emerald-700" : "bg-rose-50 border-rose-100 text-rose-700"}`}>{d.covered ? "✓" : "⚠"} {d.skill}</span>)}</div></td>)}</tr>
                    <tr className="hover:bg-slate-50/50 transition"><td className="p-4 font-bold text-slate-500 bg-slate-50/20">Skill Gaps</td>{items.map(({ p, scoring }) => { const gaps = scoring.details.filter(d => !d.covered).map(d => d.skill); return <td key={p.id} className="p-4 font-bold">{gaps.length === 0 ? <span className="text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-100">✅ No Skill Gaps</span> : <span className="text-rose-600 bg-rose-50 px-2 py-0.5 rounded-lg border border-rose-100">{gaps.length} Missing</span>}</td>; })}</tr>
                    <tr className="hover:bg-slate-50/50 transition"><td className="p-4 font-bold text-slate-500 bg-slate-50/20">Tech Stack</td>{items.map(({ p }) => <td key={p.id} className="p-4"><div className="flex flex-wrap gap-1">{(p.techStack || []).slice(0, 6).map(t => <span key={t} className="text-[10px] px-2 py-0.5 rounded-lg bg-slate-100 border border-slate-200/50 text-slate-600 font-semibold">{t}</span>)}</div></td>)}</tr>
                    <tr className="hover:bg-slate-50/50 transition"><td className="p-4 font-bold text-slate-500 bg-slate-50/20">Summary</td>{items.map(({ p }) => <td key={p.id} className="p-4 text-slate-500 font-medium leading-relaxed max-w-sm whitespace-pre-wrap">{p.problemSummary}</td>)}</tr>
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      </dialog>
    </div>
  );
}
