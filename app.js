/* NSM playground: page logic and OpenRouter calls. Pure logic lives in nsm.js; prompts, primes and
   dimensions come from data.json, exported from the repo configs (nsm playground --export). */
(function () {
  "use strict";
  const API = "https://openrouter.ai/api/v1";
  const $ = (id) => document.getElementById(id);
  const state = { data: null, models: null, cost: 0, calls: 0, explication: "", decodes: [] };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const status = (id, msg, kind = "") => { const el = $(id); el.textContent = msg; el.className = "status " + kind; };

  // ---- key ---------------------------------------------------------------------------------
  function key() { return $("key").value.trim(); }
  function initKey() {
    try { const k = sessionStorage.getItem("nsm_key"); if (k) { $("key").value = k; $("remember").checked = true; } } catch (e) { /* storage blocked */ }
    const save = () => { try { if ($("remember").checked && key()) sessionStorage.setItem("nsm_key", key()); else sessionStorage.removeItem("nsm_key"); } catch (e) { /* ignore */ } };
    $("key").addEventListener("input", save); $("remember").addEventListener("change", save);
  }

  // ---- models: checked against OpenRouter's public list ------------------------------------
  async function loadModels() {
    try {
      const r = await fetch(API + "/models");
      const j = await r.json();
      state.models = new Map((j.data || []).map((m) => [m.id, m]));
    } catch (e) { state.models = null; }
  }
  function modelInfo(input) {
    const info = document.querySelector('.model-info[data-for="' + input.id + '"]') || input.parentElement.querySelector(".model-info");
    if (!info) return;
    const id = input.value.trim();
    if (!id) { info.textContent = ""; return; }
    if (!state.models) { info.textContent = "Nie udało się pobrać listy modeli; identyfikator zostanie sprawdzony przy wywołaniu."; return; }
    const m = state.models.get(id);
    if (!m) { info.innerHTML = '<span class="bad">Nie ma takiego modelu na OpenRouter.</span> Sprawdź identyfikator na <a href="https://openrouter.ai/models" target="_blank" rel="noopener">openrouter.ai/models</a>.'; return; }
    const p = m.pricing || {}, per = (x) => (parseFloat(x || 0) * 1e6).toFixed(2);
    info.innerHTML = '<span class="good">✓</span> ' + esc(m.name || id) + " · $" + per(p.prompt) + " / $" + per(p.completion) + " za milion tokenów (wejście / wyjście)";
  }
  function watchModel(input) { input.addEventListener("change", () => modelInfo(input)); input.addEventListener("blur", () => modelInfo(input)); }
  function requireModel(input) {
    const id = input.value.trim();
    if (!id) throw new Error("Podaj identyfikator modelu.");
    if (state.models && !state.models.has(id)) throw new Error("Nie ma modelu " + id + " na OpenRouter.");
    return id;
  }

  // ---- one chat call, with the study's retry rules -----------------------------------------
  async function chat(model, prompt, { json = false } = {}) {
    if (!key()) throw new Error("Najpierw wklej klucz OpenRouter (krok 0).");
    const d = state.data.defaults;
    const body = { model, messages: [{ role: "user", content: prompt }], max_tokens: parseInt($("max-tokens").value, 10) || d.max_tokens, usage: { include: true } };
    const t = parseFloat($("temperature").value); if (Number.isFinite(t)) body.temperature = t;
    const eff = $("effort").value;
    if (eff === "none") body.reasoning = { enabled: false }; else if (eff) body.reasoning = { effort: eff, exclude: true };
    if (json) body.response_format = { type: "json_object" };
    let last = null;
    for (let attempt = 0; attempt <= d.empty_retries; attempt++) {
      let r = await post(body);
      if (!r.ok && json && /response_format/i.test(r.error || "")) { delete body.response_format; r = await post(body); }
      if (!r.ok) throw new Error(r.error);
      last = r;
      if (r.text.trim() && r.finish !== "length") return r;
    }
    return last;
  }
  async function post(body) {
    const res = await fetch(API + "/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key(), "Content-Type": "application/json", "X-Title": "NSM plac zabaw" },
      body: JSON.stringify(body),
    });
    let j = null;
    try { j = await res.json(); } catch (e) { /* not JSON */ }
    state.calls += 1;
    const cost = j && j.usage && j.usage.cost; if (cost) state.cost += cost;
    $("cost").textContent = "$" + state.cost.toFixed(4); $("calls").textContent = state.calls;
    if (!res.ok || !j || !j.choices) {
      const msg = (j && j.error && (j.error.message || j.error)) || ("HTTP " + res.status);
      return { ok: false, error: res.status === 401 ? "Klucz OpenRouter jest nieprawidłowy." : res.status === 402 ? "Brak środków na koncie OpenRouter." : String(msg) };
    }
    const c = j.choices[0] || {};
    let text = c.message && c.message.content;
    if (Array.isArray(text)) text = text.map((p) => p.text || "").join("");
    return { ok: true, text: text || "", finish: c.finish_reason, provider: j.provider || "" };
  }

  // ---- step 1: term ------------------------------------------------------------------------
  function initTerms() {
    const sel = $("term-pick");
    sel.innerHTML = '<option value="">— wybierz jedno z 31 haseł z badania albo wpisz własne poniżej —</option>';
    const groups = {};
    for (const t of state.data.terms) (groups[t.cluster] = groups[t.cluster] || []).push(t);
    for (const [g, ts] of Object.entries(groups)) {
      const og = document.createElement("optgroup"); og.label = g;
      for (const t of ts) { const o = document.createElement("option"); o.value = t.id; o.textContent = t.term; og.appendChild(o); }
      sel.appendChild(og);
    }
    sel.addEventListener("change", () => {
      const t = state.data.terms.find((x) => x.id === sel.value); if (!t) return;
      $("term").value = t.term; $("definition").value = t.definition; $("example").value = t.example || "";
      renderHighlight();
    });
    $("term").addEventListener("input", renderHighlight);
  }
  function currentTerm() {
    const term = $("term").value.trim();
    if (!term) throw new Error("Wpisz albo wybierz słowo (krok 1).");
    const known = state.data.terms.find((x) => x.term.toLowerCase() === term.toLowerCase());
    return { term, definition: $("definition").value.trim(), example: $("example").value.trim(),
             forms: [term, ...((known && known.aliases) || [])], cluster: (known && known.cluster) || "" };
  }

  // ---- step 2: encode ----------------------------------------------------------------------
  function encodePrompt(t) {
    return NSM.fill(state.data.prompts.encode, {
      term: t.term,
      definition_block: t.definition ? "DEFINICJA: " + t.definition + "\n" : "",
      example_block: t.example ? "PRZYKŁAD UŻYCIA: " + t.example + "\n" : "",
    });
  }
  async function doEncode() {
    try {
      const t = currentTerm(), model = requireModel($("coder"));
      const base = encodePrompt(t), d = state.data.defaults, seen = [];
      let prompt = base, expl = "";
      for (let round = 0; round <= d.leak_retries; round++) {
        status("encode-status", round ? "Eksplikacja zawierała słowo-hasło; prośba o nową wersję (" + (round + 1) + ")…" : "Model pisze eksplikację…", "busy");
        const r = await chat(model, prompt);
        expl = NSM.cleanExplication(r.text);
        if (!expl) throw new Error("Model nie zwrócił eksplikacji (często: cały limit tokenów zużyty na reasoning). Spróbuj ponownie albo zwiększ limit w ustawieniach.");
        const leaks = NSM.leaksAll(expl, t.forms);
        if (!leaks.length) break;
        leaks.forEach((l) => { if (!seen.includes(l)) seen.push(l); });
        if (round === d.leak_retries) { status("encode-status", "Po " + (d.leak_retries + 1) + " próbach eksplikacja nadal zawiera: " + seen.join(", ") + ". W badaniu taka eksplikacja zostałaby odrzucona.", "warn"); $("explication").value = expl; renderHighlight(); return; }
        prompt = base + NSM.fill(state.data.prompts.encode_leak_retry, { leaks: seen.join(", "), attempt: round + 2 });
      }
      $("explication").value = expl; renderHighlight();
      status("encode-status", "Gotowe.", "ok");
    } catch (e) { status("encode-status", e.message, "bad"); }
  }
  function renderHighlight() {
    const text = $("explication").value, data = state.data;
    let forms = [];
    try { forms = currentTerm().forms; } catch (e) { /* no term yet */ }
    const leakSet = new Set(text ? NSM.leaksAll(text, forms) : []);
    const fw = new Set(data.function_words);
    const html = esc(text).replace(/[a-ząćęłńóśźż]+/giu, (w) => {
      const lw = w.toLowerCase(), norm = NSM.stripDiacritics(lw);
      if ([...leakSet].some((l) => norm.startsWith(NSM.stripDiacritics(l)) || lw === l)) return '<span class="w-leak">' + w + "</span>";
      if (Object.prototype.hasOwnProperty.call(data.surface_to_lemma, lw)) return '<span class="w-prime">' + w + "</span>";
      if (fw.has(lw)) return '<span class="w-func">' + w + "</span>";
      return '<span class="w-other">' + w + "</span>";
    });
    $("highlight").innerHTML = html.replace(/\n/g, "<br>");
    if (!text.trim()) { $("metrics").textContent = ""; return; }
    const m = NSM.metrics(text, data);
    $("metrics").textContent = "Wyrazy: " + m.token_count + " · prymitywy i ich formy: " + m.primitive_token_count +
      " · wyrazy funkcyjne: " + m.function_word_count + " · spoza listy: " + m.non_nsm_token_count +
      " (" + Math.round(100 * m.in_nsm_share) + "% zgodności) · użyte prymitywy: " + m.used_primitives.length + " z " + data.primes.length +
      (leakSet.size ? " · UWAGA: eksplikacja zawiera słowo-hasło" : "");
  }

  // ---- step 3: decode + judge --------------------------------------------------------------
  function addDecoder(value = "") {
    const row = document.createElement("div"); row.className = "row decoder";
    const inp = document.createElement("input"); inp.className = "model"; inp.setAttribute("list", "model-list");
    inp.placeholder = "model odgadujący"; inp.value = value; inp.id = "dec-" + Math.random().toString(36).slice(2, 8);
    const rm = document.createElement("button"); rm.className = "secondary"; rm.textContent = "usuń"; rm.onclick = () => row.remove();
    const info = document.createElement("p"); info.className = "model-info"; info.dataset.for = inp.id;
    row.append(inp, rm); $("decoders").append(row, info); watchModel(inp);
    if (value) modelInfo(inp);
  }
  async function doDecode() {
    try {
      const t = currentTerm(), expl = $("explication").value.trim();
      if (!expl) throw new Error("Najpierw napisz eksplikację (krok 2).");
      const models = [...document.querySelectorAll("#decoders input.model")].map((i) => requireModel(i)).filter(Boolean);
      if (!models.length) throw new Error("Dodaj co najmniej jeden model odgadujący.");
      const closed = $("v-closed").checked, open = $("v-open").checked;
      if (!closed && !open) throw new Error("Zaznacz co najmniej jeden wariant.");
      const judge = open ? requireModel($("judge")) : null;
      let cands = state.data.terms.map((x) => x.term);
      if (!cands.some((c) => c.toLowerCase() === t.term.toLowerCase())) cands.push(t.term);
      cands = NSM.shuffled(cands);
      status("decode-status", "Modele odgadują…", "busy");
      const rows = await Promise.all(models.map(async (m) => {
        const row = { model: m };
        if (closed) {
          try {
            const r = await chat(m, NSM.fill(state.data.prompts.decode_closed, { explication: expl, candidates: cands.map((c) => "- " + c).join("\n") }), { json: true });
            const p = NSM.extractJson(r.text); row.choice = String(p.choice || ""); row.reason = String(p.reason || "");
            row.correct = NSM.normalize(row.choice) === NSM.normalize(t.term);
          } catch (e) { row.closedError = e.message; }
        }
        if (open) {
          try {
            const r = await chat(m, NSM.fill(state.data.prompts.decode_open, { explication: expl }), { json: true });
            const p = NSM.extractJson(r.text);
            row.guesses = (Array.isArray(p.guesses) ? p.guesses : []).map((g) => (typeof g === "string" ? { term: g, definition: "" } : { term: String(g.term || ""), definition: String(g.definition || "") }));
            const top = row.guesses[0] || { term: "", definition: "" };
            if (NSM.stringHitRank(row.guesses, t.forms) === 1) { row.score = 1; row.judgeReason = "dokładne trafienie (bez sędziego)"; }
            else if (top.term) {
              const jr = await chat(judge, NSM.fill(state.data.prompts.judge, { term: t.term, definition: t.definition, guess_term: top.term, guess_definition: top.definition }), { json: true });
              const jp = NSM.extractJson(jr.text); row.score = Math.min(1, Math.max(0, parseFloat(jp.score) || 0)); row.judgeReason = String(jp.reason || "");
            } else { row.score = 0; row.judgeReason = "brak propozycji"; }
          } catch (e) { row.openError = e.message; }
        }
        return row;
      }));
      renderDecodes(rows, closed, open);
      status("decode-status", "Gotowe.", "ok");
    } catch (e) { status("decode-status", e.message, "bad"); }
  }
  function renderDecodes(rows, closed, open) {
    let h = '<table><tr><th>Model</th>' + (closed ? "<th>Zamknięty: wybór</th>" : "") + (open ? "<th>Otwarty: propozycje</th><th>Ocena</th><th>Uzasadnienie sędziego</th>" : "") + "</tr>";
    for (const r of rows) {
      h += "<tr><td>" + esc(r.model) + "</td>";
      if (closed) h += "<td>" + (r.closedError ? '<span class="bad">' + esc(r.closedError) + "</span>" : (r.correct ? '<span class="good">✓</span> ' : '<span class="bad">✗</span> ') + esc(r.choice)) + "</td>";
      if (open) {
        if (r.openError) h += '<td colspan="3"><span class="bad">' + esc(r.openError) + "</span></td>";
        else h += "<td>" + (r.guesses || []).map((g, i) => (i ? "" : "<b>") + esc(g.term) + (i ? "" : "</b>") + (g.definition ? ' <span class="small">(' + esc(g.definition) + ")</span>" : "")).join("<br>") +
          "</td><td>" + String(r.score).replace(".", ",") + "</td><td class=\"small\">" + esc(r.judgeReason) + "</td>";
      }
      h += "</tr>";
    }
    $("decode-results").innerHTML = h + "</table>";
  }

  // ---- step 4: 22 dimensions ---------------------------------------------------------------
  async function doEval() {
    try {
      const t = currentTerm(), expl = $("explication").value.trim();
      if (!expl) throw new Error("Najpierw napisz eksplikację (krok 2).");
      const model = requireModel($("evaluator"));
      status("eval-status", "Model ocenia eksplikację w 22 wymiarach…", "busy");
      const prompt = NSM.fill(state.data.prompts.evaluate, {
        concept: t.term, category: t.cluster || "nieznana",
        definition_block: t.definition ? "DEFINICJA SŁOWNIKOWA: " + t.definition + "\n" : "", explication: expl,
      });
      const r = await chat(model, prompt, { json: true });
      const raw = NSM.extractJson(r.text);
      renderEval(raw, NSM.scores(raw, state.data.dimensions), t);
      status("eval-status", "Gotowe.", "ok");
    } catch (e) { status("eval-status", e.message, "bad"); }
  }
  function renderEval(raw, sc, t) {
    const data = state.data, fit = NSM.composite(sc, t.cluster, data.composite), cls = NSM.classify(sc, data.beyond_nsm);
    const clsPl = { beyond: "poza NSM", borderline: "na granicy", within: "w zasięgu NSM", unclassified: "nie do sklasyfikowania" }[cls];
    const band = fit === null ? "" : ((data.composite.bands || []).find((b) => fit >= b[0] && fit <= b[1] + 0.999) || [, , ""])[2];
    let h = '<div class="summary"><div><span class="big">' + (fit === null ? "–" : Math.round(fit)) + '</span><span class="small">ogólne dopasowanie (0–100)' + (band ? ": " + esc(band) : "") + '</span></div><div><span class="big">' + esc(clsPl) + '</span><span class="small">klasyfikacja według progów z pracy (trudność i definiowalność)</span></div></div>';
    h += "<table><tr><th>Wymiar</th><th>Wynik</th><th></th></tr>";
    for (const d of data.dimensions) {
      const v = sc[d.key], share = v === null ? 0 : (v - d.lo) / (d.hi - d.lo || 1);
      const val = v === null ? "–" : d.kind === "bool" ? (v ? "tak" : "nie") : (Math.round(v * 10) / 10).toString().replace(".", ",") + " <span class=\"small\">(" + d.lo + "–" + d.hi + ")</span>";
      h += '<tr><td title="' + esc(d.description) + '">' + d.n + ". " + esc(d.label) + '</td><td class="r">' + val + '</td><td class="barcell"><div class="bar"><div style="width:' + Math.round(100 * share) + '%"></div></div></td></tr>';
    }
    h += "</table>";
    const list = (title, xs) => (Array.isArray(xs) && xs.length ? "<h3>" + title + "</h3><ul>" + xs.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "");
    h += list("Główne problemy", raw.key_problems) + list("Sugestie", raw.improvements);
    if (raw.overall_assessment) h += "<h3>Podsumowanie</h3><p>" + esc(raw.overall_assessment) + "</p>";
    $("eval-results").innerHTML = h;
  }

  // ---- start -------------------------------------------------------------------------------
  async function init() {
    try { state.data = await (await fetch("data.json")).json(); }
    catch (e) { document.querySelector("main").innerHTML = '<p class="bad">Nie udało się wczytać data.json. Otwórz stronę przez serwer (nsm playground) albo z GitHub Pages, nie bezpośrednio z pliku.</p>'; return; }
    $("version").textContent = state.data.source_commit ? "· dane z repozytorium, wersja " + state.data.source_commit : "";
    const dl = $("model-list"), sm = state.data.suggested_models;
    [...new Set([...(sm.coders || []), sm.judge, sm.evaluator].filter(Boolean))].forEach((id) => { const o = document.createElement("option"); o.value = id; dl.appendChild(o); });
    initKey(); initTerms();
    $("coder").value = (sm.coders || [])[0] || ""; $("judge").value = sm.judge || ""; $("evaluator").value = sm.evaluator || "";
    ["coder", "judge", "evaluator"].forEach((id) => watchModel($(id)));
    (sm.coders || []).slice(1, 3).forEach((id) => addDecoder(id));
    $("explication").addEventListener("input", renderHighlight);
    $("btn-encode").onclick = doEncode; $("btn-decode").onclick = doDecode; $("btn-eval").onclick = doEval;
    $("btn-add-decoder").onclick = () => addDecoder("");
    await loadModels();
    ["coder", "judge", "evaluator"].forEach((id) => modelInfo($(id)));
    document.querySelectorAll("#decoders input.model").forEach(modelInfo);
  }
  init();
})();
