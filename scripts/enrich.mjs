/**
 * Enrichment script for SIH 2026 software problem statements.
 *
 * Reads  ../sih_problems_data.json (raw scraped data)
 * Writes src/data/enriched_problems.json
 *
 * Per problem it derives:
 *   difficulty, requiredSkills (from canonical list), techStack,
 *   estimatedCompetition, problemSummary, workedExample
 *
 * All heuristics are keyword rules over the cleaned `description` field so the
 * enrichment is fully re-runnable and auditable.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "sih_problems_data.json"), "utf8")
);

/* ------------------------------------------------------------------ */
/* 1. Text cleaning — fix mojibake from scraping ("â€¢" -> "•", etc.) */
/* ------------------------------------------------------------------ */
const MOJIBAKE = [
  [/â€¢/g, "\u2022"],
  [/â€“/g, "\u2013"],
  [/â€”/g, "\u2014"],
  [/â€™/g, "'"],
  [/â€œ|â€\u009d/g, '"'],
  [/Â/g, ""],
];
function clean(s) {
  let out = s;
  for (const [re, rep] of MOJIBAKE) out = out.replace(re, rep);
  return out.replace(/[ \t]+/g, " ").trim();
}

/* ------------------------------------------------------------------ */
/* 2. Canonical skill list + detection rules                          */
/* ------------------------------------------------------------------ */
const CANONICAL_SKILLS = [
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

const SKILL_RULES = [
  ["Machine Learning / AI", /\bai\b|\ba\.?i\.?\b|artificial intelligence|\bml\b|machine learning|deep learning|predictive|forecast|anomaly|recommendation|classification|intelligent|optimi[sz]ation solver/i],
  ["Deep Learning / Computer Vision", /\bimage\b|imagery|computer vision|\bvideo\b|camera|\bocr\b|facial|object detection|visual|lidar|3d model|super resolution|depth/i],
  ["NLP / LLMs", /chatbot|conversational|nlp|natural language|\bllm|large language|translation|multilingual|voice|speech|\btts\b|\bstt\b|text analysis|document understanding|\brag\b|gen.?ai|generative|assistant/i],
  ["GIS / Geospatial", /\bgis\b|geospatial|mapping|\bmaps?\b|satellite|remote sensing|cadastral|land record|geo.?coded|spatial|ulpin|watershed|terrain|survey/i],
  ["Blockchain", /blockchain|block chain|distributed ledger|smart contract|crypto/i],
  ["Cybersecurity", /cyber|forensic|threat|attack|encryption|malware|phishing|vulnerab|intrusion|de.?anonymization|security posture|penetration/i],
  ["Data Engineering / Big Data", /big data|data integration|harmoni[sz]ation|etl|pipeline|data lake|multi.?source|analytics platform|data processing|pre.?processing/i],
  ["Cloud/DevOps", /cloud|scalable architecture|\bsaas\b|self.?host|on.?premise/i],
  ["Mobile Development", /mobile|android|\bios\b|smartphone|app.?based|field reporting app|mobile application/i],
  ["IoT / Embedded Systems", /sensor|\biot\b|embedded|edge device|microcontroller|\baws?\b station|telemetry/i],
  ["Robotics/Drones", /robot|drone|\buav\b|autonomous vehicle|\bamr\b|quadruped|unmanned/i],
  ["AR/VR", /augmented reality|virtual reality|\bar[- ]based|\bvr\b|simulator/i],
  ["Data Visualization", /dashboard|visualization|heatmap|charts?\b|\bkpis?\b/i],
  ["API Integration", /\bapi\b|integration with|interoperab|webhook/i],
];

// Base skills every software project implicitly needs
const BASE_SKILLS = [
  "Frontend Development",
  "Backend Development",
  "Database Design",
  "UI/UX Design",
  "Product/Domain Research",
];

function detectSkills(text) {
  const extra = [];
  for (const [skill, re] of SKILL_RULES) {
    if (re.test(text)) extra.push(skill);
  }
  return [...BASE_SKILLS, ...extra.slice(0, 3)]; // cap at 8 total
}

/* ------------------------------------------------------------------ */
/* 3. Difficulty heuristic                                            */
/* ------------------------------------------------------------------ */
const HARD_RE = /sensor|\biot\b|embedded|satellite|drone|radar|sonar|lidar|real.?time|offline sync|low.?network|clinical trial|cadastral|digital twin|robotics|autonomous|hardware|edge device|signal processing|fuze|antenna|infrasound|underwater|on-device|quadruped/i;
const EASY_RE = /portal|dashboard|website|content management|informational|catalog|repository|learning management|\bcms\b|archive/i;
const AIML_RE = /\bai\b|\bml\b|machine learning|predictive|blockchain|intelligent|deep learning/i;

function detectDifficulty(text) {
  if (HARD_RE.test(text)) return "Hard";
  if (EASY_RE.test(text) && !AIML_RE.test(text)) return "Easy";
  return "Medium";
}

/* ------------------------------------------------------------------ */
/* 4. Estimated competition                                           */
/* ------------------------------------------------------------------ */
const LOW_COMP_ORG = /DRDO|NTRO|ISRO|Earth Sciences|Qualcomm|Oil India|Bharat Electronics|MRPL|Egreen Quanta|Defence/i;
const LOW_COMP_KW = /sonar|antarctic|polar|\buav engine|artillery|infrasound|dark web|de.?anonymization|forensic|satellite imagery|quantum|chandrayaan|cryptographic|ipsec|vpn protocol/i;
const HIGH_THEMES = new Set(["Miscellaneous", "Smart Automation", "Smart Education"]);
const HIGH_KW = /chatbot|marketplace|placement|job portal|catalog|student innovation|gig services|scheme matching/i;

function detectCompetition(p) {
  const text = `${p.title} ${p.description}`;
  if (LOW_COMP_ORG.test(p.organization) || LOW_COMP_KW.test(text)) return "Low";
  if (HIGH_THEMES.has(p.theme) || HIGH_KW.test(text)) return "High";
  return "Medium";
}

/* ------------------------------------------------------------------ */
/* 5. Tech stack suggestions derived from detected skills             */
/* ------------------------------------------------------------------ */
const STACK_FOR_SKILL = {
  "Machine Learning / AI": "Python (scikit-learn / XGBoost)",
  "Deep Learning / Computer Vision": "PyTorch / OpenCV",
  "NLP / LLMs": "HuggingFace Transformers / LangChain + open-weight LLM",
  "GIS / Geospatial": "PostGIS + Leaflet/MapLibre, QGIS",
  Blockchain: "Solidity / Hyperledger Fabric",
  Cybersecurity: "Python (scapy), Wireshark, ELK stack",
  "Data Engineering / Big Data": "Apache Spark / Airflow pipelines",
  "Cloud/DevOps": "Docker + AWS/GCP",
  "Mobile Development": "Flutter or React Native",
  "IoT / Embedded Systems": "ESP32/Raspberry Pi + MQTT",
  "Robotics/Drones": "ROS2 + NVIDIA Jetson",
  "AR/VR": "Unity + AR Foundation",
  "Data Visualization": "Recharts / D3.js",
  "API Integration": "REST APIs (FastAPI), third-party gov APIs",
};

function buildTechStack(skills) {
  const stack = ["React + Tailwind CSS frontend", "FastAPI or Node.js backend", "PostgreSQL / MongoDB"];
  for (const s of skills) if (STACK_FOR_SKILL[s]) stack.push(STACK_FOR_SKILL[s]);
  return [...new Set(stack)];
}

/* ------------------------------------------------------------------ */
/* 6. problemSummary generation                                       */
/* ------------------------------------------------------------------ */
function firstSentences(text, n) {
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  return sentences.slice(0, n).join(" ");
}

function requirementPhrases(desc) {
  // Use only the "Description:" section; pull clauses containing "should"
  let scope = desc;
  const dm = desc.match(/description:([\s\S]*?)(?:expected solution|$)/i);
  if (dm) scope = dm[1];
  const reqs = [];
  for (let sent of scope.split(/(?<=[.;])\s+/)) {
    sent = sent
      .replace(/^\s*[a-z][.)]\s*/, "") // strip enumeration "a. "
      .replace(/\s+/g, " ")
      .trim();
    if (!/\bshould\b|\bmust\b|allow|integrate|provide|generate/i.test(sent)) continue;
    if (/:\s*$/.test(sent) || sent.length < 30 || sent.length > 160) continue;
    reqs.push(sent.replace(/[.;]$/, ""));
    if (reqs.length >= 3) break;
  }
  return reqs;
}

function orgShort(org) {
  const acronym = org.match(/\(([^)]+)\)/);
  if (acronym && acronym[1].length <= 12) return acronym[1];
  return org.replace(/^Ministry of /, "").trim();
}

function makeSummary(p) {
  const org = orgShort(p.organization);
  const reqs = requirementPhrases(clean(p.description));
  const core = p.title.replace(/\.$/, "");
  let s = `${org} needs a software solution: "${core}".`;
  if (reqs.length) {
    const bullets = reqs
      .map((r) => r.charAt(0).toLowerCase() + r.slice(1))
      .join("; ");
    s += ` Key requirements: ${bullets}.`;
  }
  s += ` Theme: ${p.theme}.`;
  return s;
}

/* ------------------------------------------------------------------ */
/* 7. Worked example generation (domain-aware scenarios)              */
/* ------------------------------------------------------------------ */
function pickScenarioDomain(p) {
  const t = `${p.title} ${p.theme}`;
  if (/disaster|flood|landslide|cyclone|earthquake|heatwave|thunderstorm|lightning|nowcast|warning/i.test(t)) return "disaster";
  if (/health|medtech|disease|patient|clinical|mental|stress|medical|dementia|osteoarthritis|retinopathy/i.test(t)) return "health";
  if (/agri|crop|farm|livestock|dairy|fisher|mastitis|silage|honey|onion/i.test(t)) return "agri";
  if (/education|learning|skilling|pedagog|training|quiz/i.test(t)) return "education";
  if (/cyber|forensic|threat|crypto|blockchain|attack|malware|dark web|vpn|signature/i.test(t)) return "cyber";
  if (/land record|cadastral|ulpin|parcel|survey|acquisition|gis/i.test(t)) return "land";
  if (/logistics|freight|traffic|transport|vessel|parcel delivery|fleet|anpr/i.test(t)) return "logistics";
  if (/energy|solar|power grid|fuel/i.test(t)) return "energy";
  if (/weather|ocean|climate|sea.?ice|monsoon/i.test(t)) return "weather";
  if (/defen[cs]e|border|surveillance|mine|explosive|narcotic/i.test(t)) return "defense";
  return "governance";
}

const SCENARIOS = {
  disaster: (p) =>
    `A district officer in a hilly block receives heavy-rainfall alerts overnight. The platform ingests IMD nowcast data plus past-48h rainfall and flags three villages as high-risk on the GIS heatmap. It auto-sends SMS warnings in the local language to ward members, who mark two families as evacuated via the mobile app; the control-room dashboard shows live evacuation status and routes the remaining response team to the third village.`,

  health: (p) =>
    `A community health worker screens a 58-year-old patient during a village camp using the app on her tablet. The patient's symptoms and vitals are captured offline; when connectivity returns, the ML model scores the case as moderate-risk, explains the top contributing factors in plain language, books a teleconsultation slot with the district hospital, and schedules an automated follow-up reminder in the patient's language.`,

  agri: (p) =>
    `A dairy farmer photographs his cow's udder and uploads a milk sample reading through the mobile app before dawn milking. Offline-first sync pushes the data once he reaches network range; the model returns a low-grade mastitis risk within seconds and recommends a specific treatment, logging it to his herd history. The FPO dashboard aggregates such cases to warn neighbouring farmers in the same cattle route.`,

  education: (p) =>
    `A primary-school teacher in a tribal-language region uploads this week's textbook chapter. The platform generates a bilingual lesson plan, auto-builds a 10-question quiz aligned to the chapter, and reads questions aloud in the students' mother tongue. The teacher sees a heatmap of which concepts most students answered wrongly and assigns targeted practice for the next class.`,

  cyber: (p) =>
    `An analyst pastes a suspicious email header and attachment hash into the console. The pipeline extracts IOCs, enriches them against threat feeds, and correlates the sender's infrastructure with two previously reported fraud cases. Within a minute the tool produces a timeline view and a ready-to-file report that the forensic team exports as PDF for escalation.`,

  land: (p) =>
    `A surveyor uploads drone imagery of a village parcel. The system detects plot boundaries, matches them against existing cadastral records, and highlights three parcels whose recorded area deviates beyond tolerance. A revenue inspector reviews flagged overlaps side-by-side, corrects one polygon, and the change is versioned into the land-records database with full audit trail.`,

  logistics: (p) =>
    `A transport controller enters next week's cargo forecast. The optimizer simulates vessel/route allocations under cost and delay constraints and proposes a chartering plan 12% cheaper than manual planning. When a port congestion alert arrives, the ETA model recomputes arrival predictions and suggests a swap that the controller approves in one click.`,

  energy: (p) =>
    `A plant operator opens the morning dashboard: overnight sensor readings show a conveyor drive drawing abnormal current. The predictive model estimates failure probability within 14 days, ranks maintenance tasks by risk-cost tradeoff, and generates a work order. Post-maintenance, actual readings confirm the anomaly was caught before rupture, avoiding downtime.`,

  weather: (p) =>
    `At 05:30 a forecaster reviews the overnight model run. The system blends NWP outputs with radar composites, detects a convective cluster forming off the coast, and issues a 4-hour nowcast for three coastal blocks with confidence intervals. Fishermen in those blocks receive voice alerts in the local language before leaving harbour.`,

  defense: (p) =>
    `A patrol unit's mounted camera streams footage to the edge-AI box in their vehicle. The system detects a person approaching a fenced sector at night, cross-references movement patterns to classify it as unusual, and raises a graded alert with a snapshot to the command post — all without sending raw video off-device, preserving bandwidth and privacy.`,

  governance: (p) =>
    `A citizen opens the portal, answers five guided questions, and the rule engine instantly lists every scheme she qualifies for with required documents. She picks one, uploads documents from her phone; the workflow routes her application to the right officer, and both she and the district dashboard track its status until disbursement.`,
};

function makeWorkedExample(p) {
  const domain = pickScenarioDomain(p);
  return SCENARIOS[domain](p);
}

/* ------------------------------------------------------------------ */
/* 8. Assemble                                                        */
/* ------------------------------------------------------------------ */
const enriched = RAW.map((p) => {
  const description = clean(p.description);
  const requiredSkills = detectSkills(`${p.title} ${description}`);
  return {
    id: p.id,
    title: clean(p.title),
    organization: p.organization,
    theme: p.theme,
    deadline: p.deadline,
    description,
    difficulty: detectDifficulty(`${p.title} ${description}`),
    requiredSkills,
    techStack: buildTechStack(requiredSkills),
    problemSummary: makeSummary(p),
    workedExample: makeWorkedExample(p),
    estimatedCompetition: detectCompetition(p),
  };
});

const OUT = join(__dirname, "..", "src", "data", "enriched_problems.json");
writeFileSync(OUT, JSON.stringify(enriched, null, 2));

// quick stats
const count = (fn) => enriched.filter(fn).length;
console.log(`Enriched ${enriched.length} problems -> ${OUT}`);
console.log("Difficulty:", {
  Easy: count((p) => p.difficulty === "Easy"),
  Medium: count((p) => p.difficulty === "Medium"),
  Hard: count((p) => p.difficulty === "Hard"),
});
console.log("Competition:", {
  Low: count((p) => p.estimatedCompetition === "Low"),
  Medium: count((p) => p.estimatedCompetition === "Medium"),
  High: count((p) => p.estimatedCompetition === "High"),
});
