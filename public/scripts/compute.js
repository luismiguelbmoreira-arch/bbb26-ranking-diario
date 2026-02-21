// scripts/compute.js
// Node.js 18+
// Gera public/data.json a partir de inputs/daily_snapshots.json

import fs from "node:fs";
import path from "node:path";

const INPUT = path.resolve("inputs/daily_snapshots.json");
const OUTPUT_DIR = path.resolve("public");
const OUTPUT = path.resolve("public/data.json");

function nowBRT() {
  // Aproximação simples: o runner do GitHub usa UTC; aqui só formatamos.
  const d = new Date();
  const iso = d.toISOString().slice(0,16).replace("T"," ");
  return `${iso} UTC`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function normalizeTo100(map) {
  const entries = Object.entries(map).filter(([,v]) => Number.isFinite(v));
  const sum = entries.reduce((a,[,v]) => a + v, 0);
  if (sum <= 0) return map;

  const out = {};
  for (const [k,v] of entries) out[k] = (v / sum) * 100;
  // keep other keys as 0 if present
  for (const k of Object.keys(map)) if (!(k in out)) out[k] = 0;
  return out;
}

function weightedCombine(sources, weights) {
  // sources: [{name, values:{person: pct}}]
  // weights: {name: w}
  const acc = {};
  const people = new Set();

  for (const s of sources) {
    const w = Number(weights[s.name] ?? 0);
    if (w <= 0) continue;

    for (const [person, pct] of Object.entries(s.values || {})) {
      const v = Number(pct);
      if (!Number.isFinite(v)) continue;
      people.add(person);
      acc[person] = (acc[person] ?? 0) + (v * w);
    }
  }

  // If no weights matched, fallback equal weight among provided sources
  const used = sources.filter(s => Number(weights[s.name] ?? 0) > 0);
  if (used.length === 0 && sources.length > 0) {
    const w = 1 / sources.length;
    for (const s of sources) {
      for (const [person, pct] of Object.entries(s.values || {})) {
        const v = Number(pct);
        if (!Number.isFinite(v)) continue;
        people.add(person);
        acc[person] = (acc[person] ?? 0) + (v * w);
      }
    }
  }

  // Normalize and round
  const normalized = normalizeTo100(acc);
  for (const k of Object.keys(normalized)) normalized[k] = round2(normalized[k]);

  return { percent: normalized, people: Array.from(people) };
}

function percentToPositions(percentMap) {
  // higher percent = better (position 1)
  const rows = Object.entries(percentMap)
    .map(([name,p]) => ({ name, p: Number(p) }))
    .filter(x => Number.isFinite(x.p))
    .sort((a,b) => b.p - a.p);

  // Dense ranking: if tie, same position; next position increments
  const pos = {};
  let currentPos = 0;
  let lastVal = null;
  for (let i=0;i<rows.length;i++){
    const v = rows[i].p;
    if (lastVal === null || v !== lastVal) currentPos = i + 1;
    pos[rows[i].name] = currentPos;
    lastVal = v;
  }
  return pos;
}

function computeDeltas(posToday, posYesterday) {
  // delta: positive means moved up (better rank) => yesterdayPos - todayPos
  const deltas = {};
  for (const name of Object.keys(posToday)) {
    const t = posToday[name];
    const y = posYesterday ? posYesterday[name] : undefined;
    if (!Number.isFinite(t) || !Number.isFinite(y)) continue;
    deltas[name] = y - t;
  }
  return deltas;
}

function main() {
  const raw = fs.readFileSync(INPUT, "utf-8");
  const input = JSON.parse(raw);

  const weights = input?.config?.sourceWeights || {};
  const daysIn = (input?.days || []).slice().sort((a,b) => String(a.date).localeCompare(String(b.date)));

  const days = [];
  const allPeople = new Set();
  const positionsByDay = {};
  const deltasByDay = {};
  const metaByDay = {};
  const newsByDay = {};

  let prevPositions = null;

  for (const day of daysIn) {
    const date = String(day.date);
    days.push(date);

    const sources = Array.isArray(day.sources) ? day.sources : [];
    const { percent, people } = weightedCombine(sources, weights);

    for (const p of Object.keys(percent)) allPeople.add(p);
    for (const p of people) allPeople.add(p);

    const pos = percentToPositions(percent);
    positionsByDay[date] = pos;

    const deltas = computeDeltas(pos, prevPositions);
    deltasByDay[date] = deltas;

    metaByDay[date] = {
      sources: sources.length,
      votesLabel: day.votesLabel || ""
    };

    if (Array.isArray(day.news)) newsByDay[date] = day.news;

    prevPositions = pos;
  }

  const out = {
    updatedAt: nowBRT(),
    days,
    people: Array.from(allPeople).sort((a,b)=>a.localeCompare(b,"pt-BR")),
    positionsByDay,
    deltasByDay,
    metaByDay,
    newsByDay
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2), "utf-8");
  console.log("Generated:", OUTPUT);
}

main();
