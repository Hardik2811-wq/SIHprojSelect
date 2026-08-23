# SIH 2026 Team Skill-Match & Ranking Web App

Ranks all **172 SIH 2026 software problem statements** by how well your team's
combined skillset fits each problem, so you can pick the best PS before the
**20 September 2026** deadline.

Built with React + Tailwind CSS (Vite). No backend — everything runs client-side
against a bundled enriched dataset.

## Run it

```bash
cd webapp
npm install
npm run dev        # dev server at http://localhost:5173
npm run build      # production build in dist/
```

## Data pipeline

```
../../sih_problems_data.json   raw scraped data (172 software PSs)
        │
        ▼  npm run enrich  (scripts/enrich.mjs)
src/data/enriched_problems.json   cleaned + enriched data used by the app
```

The enrichment script:
- Fixes scraping mojibake (`â€¢` → `•`)
- Derives per problem: `difficulty`, `requiredSkills` (from the canonical
  20-skill list), `techStack`, `estimatedCompetition`, `problemSummary`,
  `workedExample`
- Re-runnable: edit the keyword rules / heuristics in `scripts/enrich.mjs` and
  run `npm run enrich` again.

## How scoring works (not a black box)

For each problem:

1. For every `requiredSkill`, find the **best expertise** any member has in it.
2. `skillCoverageRatio` = (# required skills covered at expertise ≥ 2) ÷ (total required skills)
3. `avgExpertiseOnMatchedSkills` = avg expertise (1–5) across matched skills ÷ 5
4. **Team Fit Score = round(100 × (0.6 × coverageRatio + 0.4 × avgExpertise))**
5. If coverage is 0, score is capped at **15** so total mismatches sink to the bottom.

Ties break by lower estimated competition.

## Risk/Reward quadrants

| Difficulty | Competition | Quadrant |
|---|---|---|
| Hard | Low | 🟢 High risk, high reward |
| Hard | Medium/High | 🟠 High risk, low reward |
| Easy/Medium | High | 🟡 Low risk, low reward |
| Easy/Medium | Low/Medium | 🔵 Low risk, high reward |

"Risk" = execution difficulty; "Reward" = differentiation odds (inverse of how
many teams will attempt it).

## Competition estimate rule

- **Low**: niche org/domain keywords (DRDO, NTRO, ISRO, polar/sonar/forensics/satellite…)
- **High**: themes Miscellaneous / Smart Automation / Smart Education, or generic chatbot/marketplace/portal problems
- **Medium**: everything else

## Difficulty heuristic

- **Hard**: hardware/sensor integration, satellite/drone imagery, real-time or offline-sync systems, specialized domain modeling
- **Easy**: CRUD platforms/dashboards/portals with no ML or hardware dependency
- **Medium**: everything else

## App features

- 6-member onboarding panel (name + skill chips + 1–5 expertise sliders), collapsible
- Live "Team Skill Coverage" strip (max expertise & member count per skill)
- Filters (Theme / Difficulty / Risk-Reward): AND across categories, OR within;
  filtering **re-ranks** so #1 = best fit among visible rows
- Flip cards: front = rank/badges/score ring, back = summary, skill-by-skill
  coverage with covering member names, tech stack, worked example, full description
- Keyboard accessible flip cards (Enter/Space)
- Export current ranked shortlist as CSV; export/import team as JSON
