/* Pure logic of the playground, ported from the Python package (src/nsm). No DOM, no network:
   tests/test_playground.py runs it under Node and compares the results with the Python functions.

   metrics.tokenize / compute_metrics / leaks_term     -> tokenize, metrics, leaksTerm
   codec/encode.clean_explication                      -> cleanExplication
   llm/client.extract_json, analyze/judge._flatten     -> extractJson, flatten
   codec/decode.normalize, codec/score.string_hit_rank -> normalize, stringHitRank
   analyze/judge.composite_fitness, classify_beyond_nsm -> composite, classify  */
(function (root) {
  "use strict";

  const WORD_RE = /[a-ząćęłńóśźż]+/giu;

  function tokenize(text) {
    return (String(text || "").match(WORD_RE) || []).map((t) => t.toLowerCase());
  }

  function stripDiacritics(text) {
    return String(text || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  }

  function metrics(explication, data) {
    const table = data.surface_to_lemma, fw = new Set(data.function_words);
    const tokens = tokenize(explication);
    const used = [], nonNsm = [];
    let func = 0;
    for (const t of tokens) {
      if (Object.prototype.hasOwnProperty.call(table, t)) used.push(table[t]);
      else if (fw.has(t)) func += 1;
      else nonNsm.push(t);
    }
    const n = tokens.length;
    return {
      token_count: n,
      primitive_token_count: used.length,
      function_word_count: func,
      non_nsm_token_count: nonNsm.length,
      non_nsm_unique: [...new Set(nonNsm)].sort(),
      used_primitives: data.primes.filter((p) => used.includes(p)),
      in_nsm_share: n ? 1 - nonNsm.length / n : 0,
    };
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function wholeWord(word, text) {
    return new RegExp("(?<![\\p{L}\\p{N}_])" + escapeRe(word) + "(?![\\p{L}\\p{N}_])", "u").test(text);
  }

  function leaksTerm(explication, term, minStem = 4) {
    const hits = new Set();
    const exNorm = stripDiacritics(explication);
    for (let piece of String(term).split(/[\s/,\-–]+/)) {
      piece = piece.trim().toLowerCase();
      if (!piece) continue;
      if (/^\d+$/.test(piece)) {
        if (wholeWord(piece, explication)) hits.add(piece);
        continue;
      }
      let stem = stripDiacritics(piece);
      if (stem.length < minStem) {
        if (wholeWord(stem, exNorm)) hits.add(piece);
        continue;
      }
      stem = stem.slice(0, Math.max(minStem, Math.min(stem.length - 2, 5)));
      for (const tok of exNorm.match(/[a-z0-9]+/g) || []) if (tok.startsWith(stem)) hits.add(tok);
    }
    return [...hits].sort();
  }

  function leaksAll(explication, forms) {
    const out = new Set();
    for (const f of forms) for (const h of leaksTerm(explication, f)) out.add(h);
    return [...out].sort();
  }

  function cleanExplication(text) {
    const out = [];
    for (let ln of String(text || "").trim().split(/\r?\n/)) {
      ln = ln.trim().replace(/^`+|`+$/g, "").trimEnd();
      const low = ln.toLowerCase();
      if (!ln || ["eksplikacja", "explication", "nsm:", "```"].some((p) => low.startsWith(p))) continue;
      out.push(ln);
    }
    return out.join("\n");
  }

  function extractJson(text) {
    const cleaned = String(text || "").replace(/```(?:json)?\s*|\s*```/gi, "");
    const start = cleaned.indexOf("{");
    if (start < 0) throw new Error("brak obiektu JSON w odpowiedzi");
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
      }
    }
    throw new Error("niedomknięty obiekt JSON w odpowiedzi");
  }

  function flatten(raw) {
    const out = Object.assign({}, raw);
    const stack = Object.values(raw).filter((v) => v && typeof v === "object" && !Array.isArray(v));
    while (stack.length) {
      const d = stack.pop();
      for (const [k, v] of Object.entries(d)) {
        if (v && typeof v === "object" && !Array.isArray(v)) stack.push(v);
        else if (!(k in out)) out[k] = v;
      }
    }
    return out;
  }

  function normalize(text) {
    let t = String(text || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/ł/g, "l");
    t = t.replace(/’/g, "'").replace(/`/g, "'");
    return t.replace(/[^a-z0-9' ]+/g, " ").trim();
  }

  function stringHitRank(guesses, forms) {
    const fs = new Set(forms.filter(Boolean).map(normalize));
    for (let i = 0; i < guesses.length; i++) {
      const ng = normalize(guesses[i].term);
      if (fs.has(ng)) return i + 1;
      for (const f of fs) if (f && (f.includes(ng) || ng.includes(f)) && f.length >= 4) return i + 1;
    }
    return null;
  }

  function num(v) {
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string" && ["true", "false", "tak", "nie"].includes(v.trim().toLowerCase()))
      return ["true", "tak"].includes(v.trim().toLowerCase()) ? 1 : 0;
    const x = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(x) ? x : null;
  }

  function scores(raw, dims) {
    const flat = flatten(raw), out = {};
    for (const d of dims) {
      const v = num(flat[d.key]);
      out[d.key] = v === null ? null : Math.min(Math.max(v, d.lo), d.hi);
    }
    return out;
  }

  function composite(sc, category, rule) {
    const cat = String(category || "").toLowerCase();
    const social = cat.includes("social") || cat.includes("spolecz") || cat.includes("społecz");
    let total = 0;
    for (const [key, w] of Object.entries(rule.weights || {})) {
      let v = sc[key];
      if (key === "emotional_loading") v = social ? v : 0;
      if (v === null || v === undefined) return null;
      if (key === "conceptual_distance" || key === "cognitive_load") v = 100 - v * 10;
      else if (key === "developmental_age") v = 100 - v * 14;
      else if (key === "polysemy_risk" || key === "metaphorical_complexity") v = 100 - v;
      total += w * v;
    }
    return Math.min(100, Math.max(0, total));
  }

  function classify(sc, rule) {
    const diff = sc.nsm_difficulty, def = sc.definability;
    if (diff === null || diff === undefined || def === null || def === undefined) return "unclassified";
    const b = rule.beyond || {}, w = rule.within || {};
    if (diff > (b.nsm_difficulty_gt ?? 70) && def < (b.definability_lt ?? 30)) return "beyond";
    if (diff < (w.nsm_difficulty_lt ?? 50) && def > (w.definability_gt ?? 60)) return "within";
    const [lo, hi] = (rule.borderline || {}).nsm_difficulty_between || [50, 70];
    if (lo <= diff && diff <= hi) return "borderline";
    return "unclassified";
  }

  /* Substitute {name} placeholders; every other brace stays as it is (the templates contain JSON). */
  function fill(template, vars) {
    return template.replace(/\{([a-z_]+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }

  function shuffled(items, rand = Math.random) {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const NSM = { tokenize, stripDiacritics, metrics, leaksTerm, leaksAll, cleanExplication, extractJson,
                flatten, normalize, stringHitRank, scores, composite, classify, fill, shuffled };
  if (typeof module !== "undefined" && module.exports) module.exports = NSM;
  else root.NSM = NSM;
})(typeof window !== "undefined" ? window : globalThis);
