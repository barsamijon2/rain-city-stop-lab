(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const data = window.STOPLAB_DATA;
  if (!data) {
    $('#app').innerHTML = '<p class="notice">The snapshot did not load. Reload the page to try again.</p>';
    return;
  }
  const { games, plays, history, league } = data;
  const gameById = Object.fromEntries(games.map(g => [g.id, g]));
  const zones = ['Backed up', 'Own 20–39', 'Midfield', 'SEA territory', 'SEA red zone'];
  const zone = p => Math.max(0, Math.min(4, Math.floor((100 - p.y) / 20)));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[m]));
  const signed = (n, digits = 2) => Number.isFinite(n) ? (Math.abs(n) < .5 * 10 ** -digits ? (0).toFixed(digits) : `${n < 0 ? '−' : '+'}${Math.abs(n).toFixed(digits)}`) : 'N/A';
  const mean = rows => rows.length ? rows.reduce((s, p) => s + p.e, 0) / rows.length : null;
  const rate = (a, n) => n ? `${(100 * a / n).toFixed(1)}%` : 'N/A';
  const byImpact = (a,b) => Math.abs(b.e) - Math.abs(a.e);
  const describe = p => p.text.replace(/^\s*\([^)]+\)\s*/, '');
  const position = p => p.y === 50 ? '50-yard line' : p.y < 50 ? `SEA ${p.y}` : `OPP ${100 - p.y}`;
  const key = p => `${p.g}:${p.v || p.id}`;
  const tag = p => p.it ? 'INT' : p.fl ? 'FUMBLE' : p.sk ? 'SACK' : p.td ? 'TD' : p.t === 'pass' ? 'PASS' : 'RUN';
  const app = $('#app');
  const db = new Map();
  for (const p of plays) {
    const k = key(p);
    if (!db.has(k)) db.set(k, []);
    db.get(k).push(p);
  }
  const info = k => {
    const seq = db.get(k), first = seq[0];
    const g = gameById[first.g];
    return {seq, first, g, label:`W${g.week} ${g.opp} · Drive ${first.v || '—'} · ${seq.at(-1).result || 'Outcome not recorded'}`};
  };
  const playerSummaries = rows => {
    const stats = new Map();
    const get = name => {
      if (!stats.has(name)) stats.set(name, {name, sacks:0, picks:0, events:[]});
      return stats.get(name);
    };
    for (const p of rows) {
      for (const [name, credit] of Object.entries(p.names)) {
        const a = get(name);
        a.sacks += credit;
        a.events.push(p);
      }
      if (p.pick) { const a = get(p.pick); a.picks++; a.events.push(p); }
    }
    return [...stats.values()].sort((a,b) => b.sacks + b.picks - a.sacks - a.picks || b.picks - a.picks || a.name.localeCompare(b.name));
  };
  const state = {view:'field',z:null,game:'',d:'',type:'',drive:null,frame:0,player:null,timer:null};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const toApp = () => app.scrollIntoView({behavior:reduced.matches ? 'instant' : 'smooth',block:'nearest'});
  const filtered = () => plays.filter(p => (!state.game || p.g === state.game) && situation(p));
  const situation = p => (!state.d || p.d === Number(state.d)) && (!state.type || p.t === state.type);
  const scope = g => `${g.home ? 'vs' : '@'} ${g.name}`;
  const gline = g => `W${String(g.week).padStart(2,'0')} · ${scope(g)}`;
  const metric = (label,value,sub) => `<div class="metric"><p class="mono">${label}</p><b>${value}</b><p>${sub}</p></div>`;
  const benchmark = z => {
    const rows = league.filter(([a,d,t]) => (z === null || a === z) && situation({d,t}));
    const n = rows.reduce((s,r) => s+r[3],0);
    return {n, value:n ? rows.reduce((s,r) => s+r[4],0)/n : null};
  };
  const compare = (label,value,n,max) => {
    const width = Math.min(50,Math.abs(value || 0)/max*50);
    return `<div class="compare-row"><span>${label} · n=${n.toLocaleString('en-US')}</span><b>${signed(value)}</b><div class="rail" aria-hidden="true">${value === null ? '' : `<span class="${value < 0 ? 'backwards' : ''}" style="left:${value < 0 ? 50-width : 50}%;width:${width}%"></span>`}</div></div>`;
  };
  const chip = p => `<b class="${p.e >= 0 ? 'gain' : 'loss'}">${signed(p.e)} EPA</b>`;
  const evidenceRow = p => {
    const g = gameById[p.g];
    return `<button class="play-row" type="button" data-open="${esc(key(p))}" data-play="${p.id}"><span class="tag">W${g.week} ${esc(g.opp)} · ${tag(p)}</span><span>${esc(describe(p))}</span>${chip(p)}</button>`;
  };
  function metricBar(rows) {
    const third = rows.filter(p => p.d === 3), gs = new Set(rows.map(p => p.g));
    $('#metrics').innerHTML = [
      metric('DEFENSIVE EPA / SNAP', signed(mean(rows)), 'Positive favors Seattle'),
      metric('POSITIVE EPA SNAPS', rate(rows.filter(p => p.e > 0).length,rows.length), `${rows.filter(p => p.e > 0).length} won snaps`),
      metric('THIRD-DOWN STOP RATE',rate(third.filter(p => !p.conv).length,third.length), `${third.length} eligible third downs`),
      metric('DEFENSIVE SNAPS',rows.length,`${gs.size} ${gs.size === 1 ? 'game' : 'games'} in selection`)
    ].join('');
  }
  function field(rows) {
    const picked = state.z;
    const visible = rows.filter(p => picked === null || zone(p) === picked);
    const hist = history.filter(p => (picked === null || zone(p) === picked) && situation(p));
    const peer = benchmark(picked), r = mean(visible), h = mean(hist);
    const max = Math.max(.4,Math.abs(r || 0),Math.abs(h || 0),Math.abs(peer.value || 0));
    const points = rows.map((p,i) => {
      const a = zone(p), pos = Math.max(2,Math.min(798, (100-p.y)*8 + ((i*17)%19-9)*.75));
      const px = Math.max(a*160+3, Math.min((a+1)*160-3,pos));
      const py = 45+(p.d-1)*37 + ((i*37+p.id*13)%31);
      const color = p.e > 0 ? '#c4f477' : '#f7a58b';
      const opacity = picked !== null && a !== picked ? .23 : .72;
      const size = Math.min(5,2.1+Math.sqrt(Math.abs(p.e))*1.4);
      return p.it || p.fl || p.td
        ? `<path d="M${px} ${py-5}l5 5-5 5-5-5Z" fill="${color}" stroke="#fbfaf5" stroke-width="1" opacity="${opacity}"/>`
        : `<circle cx="${px}" cy="${py}" r="${size.toFixed(2)}" fill="${color}" opacity="${opacity}"/>`;
    }).join('');
    return `<div class="split">
      <section class="map"><header class="board-head"><div><p class="eyebrow mono">01 / FIELD POSITION</p><h2>Every snap leaves a mark</h2></div><p class="mono">${rows.length} PLOTTED SNAPS<br>SELECT A ZONE ↓</p></header>
        <div class="pitch"><svg viewBox="0 0 800 211" preserveAspectRatio="none" aria-hidden="true">
          <path d="M80 0v211m160-211v211m160-211v211m160-211v211m160-211v211" stroke="#a0c0a5" stroke-opacity=".25" stroke-dasharray="3 5"/>
          <path d="M0 41h800M0 79h800M0 116h800M0 153h800M0 190h800" stroke="#9dbda6" stroke-opacity=".22"/>
          ${points}
        </svg><div class="zones" aria-label="Field position zones">${zones.map((z,i) => `<button type="button" data-zone="${i}" aria-pressed="${picked === i}" aria-label="${z}, ${rows.filter(p => zone(p) === i).length} snaps"><span>${z}</span></button>`).join('')}</div></div>
        <div class="yard"><span>OPP GOAL</span><span>← FIELD POSITION →</span><span>SEA GOAL</span></div>
        <div class="legend"><span><i></i>Seattle EPA gain</span><span><i class="negative"></i>Zero / negative</span><span><i class="event"></i>Turnover or TD</span><span>Rows: 1st → 4th down</span></div>
      </section>
      <section class="card"><p class="eyebrow mono">ZONE REPORT</p><h2>${picked === null ? 'Full field' : zones[picked]}</h2>
        <div class="zone-kpi"><div><b>${signed(r)}</b><br><span>Seattle defensive EPA / snap</span></div><span>${visible.length} snaps</span></div>
        <div class="compare">${compare('Seattle 2026',r,visible.length,max)}${compare('Seattle 2025',h,hist.length,max)}${compare('Rest of NFL 2026',peer.value,peer.n,max)}</div>
        <p class="small">Benchmarks: weeks 1–${data.week}. Bars show EPA around zero.</p>
        <div class="card-actions"><button class="text-link" id="clear-zone" type="button" ${picked === null ? 'disabled' : ''}>Clear zone</button><button type="button" class="solid" id="top-replay" ${visible.length ? '' : 'disabled'}>Replay biggest swing ↗</button></div>
      </section>
      </div><section class="card evidence"><div class="section-head"><h2>Biggest swings</h2><p class="mono">BY ABSOLUTE EPA</p></div>
      ${visible.length ? [...visible].sort(byImpact).slice(0,5).map(evidenceRow).join('') : '<p class="notice">No snaps match this zone and filter combination. Try another zone or reset the filters.</p>'}</section>`;
  }
  function replay(rows) {
    const available = [...new Set(rows.map(key))];
    if (!available.length) return '<p class="notice">No drives match these filters. Pick a different situation or reset the filters.</p>';
    if (!available.includes(state.drive)) {
      state.drive = key([...rows].sort(byImpact)[0]);
      state.frame = 0;
    }
    const {seq,g} = info(state.drive), p = seq[state.frame], end = state.frame === seq.length-1;
    const sums = [0];
    seq.forEach(q => sums.push(sums.at(-1)+q.e));
    const limit = Math.max(2,...sums.map(Math.abs)) * 1.07;
    const x = i => 28 + i * (702 / seq.length), y = v => 75 - v / limit * 57;
    const path = sums.map((v,i) => `${i ? 'L':'M'}${x(i)} ${y(v)}`).join('');
    const playedPath = sums.slice(0,state.frame+2).map((v,i) => `${i ? 'L':'M'}${x(i)} ${y(v)}`).join('');
    return `<div class="split"><section class="replay-board"><header class="board-head"><div><p class="eyebrow mono">02 / DRIVE REPLAY</p><h2>Week ${g.week} ${esc(scope(g))}</h2></div><p class="mono">DRIVE ${esc(p.v || '—')}<br>${esc(seq.at(-1).result || 'Unknown outcome')}</p></header>
      <svg class="trace" viewBox="0 0 760 150" preserveAspectRatio="none" role="img" aria-label="Cumulative defensive EPA through this drive. Current value ${signed(sums[state.frame+1])}, final value ${signed(sums.at(-1))}.">
      <path d="M28 75h702" stroke="#9cb6a9" stroke-dasharray="5 5"/><path d="${path}" fill="none" stroke="#779087" stroke-width="2" stroke-dasharray="5 4"/><path d="${playedPath}" fill="none" stroke="#c4f477" stroke-width="3" vector-effect="non-scaling-stroke"/><circle cx="${x(state.frame+1)}" cy="${y(sums[state.frame+1])}" r="5" fill="#c4f477"/><text x="28" y="146" fill="#c4d8ce" font-size="15" font-family="monospace">CUMULATIVE DEFENSIVE EPA</text></svg>
      <div class="replay-current" aria-live="polite"><p class="mono">SNAP ${state.frame+1}/${seq.length} · Q${p.q} ${esc(p.time)} · ${p.d}&amp;${p.to} · ${position(p)}</p><p>${esc(describe(p))}</p><p class="mono">${signed(p.e)} SNAP EPA &nbsp; / &nbsp; ${signed(sums[state.frame+1])} CUMULATIVE</p></div>
      <div class="replay-actions"><button type="button" id="prev" aria-label="Previous snap" ${state.frame===0 ? 'disabled':''}>←</button><button type="button" class="primary" id="autoplay">${state.timer ? 'Pause' : end ? 'Replay' : 'Play drive'}</button><button type="button" id="next" aria-label="Next snap" ${end ? 'disabled':''}>→</button></div>
      </section><section class="card drive-card"><label class="drive-select">OPPONENT DRIVE<select id="drive" aria-label="Opponent drive">${available.map(k => `<option value="${esc(k)}"${k === state.drive ? ' selected':''}>${esc(info(k).label)}</option>`).join('')}</select></label>
      <p class="divider">Eligible snaps in the full drive.</p>${seq.map((q,i) => `<button type="button" class="play-row" data-frame="${i}" aria-current="${i === state.frame}" aria-label="Snap ${i+1}, ${tag(q)}, ${signed(q.e)} defensive EPA"><span class="tag">${String(i+1).padStart(2,'0')}</span><span>${esc(describe(q))}</span>${chip(q)}</button>`).join('')}</section></div>`;
  }
  function players(rows) {
    const list = playerSummaries(rows);
    if (!list.length) return '<p class="notice">No player-attributed sacks or interceptions match these filters. Try a different game or reset filters.</p>';
    const a = list.find(s => state.player === s.name) || list[0];
    state.player = a.name;
    return `<div class="split"><section class="card"><p class="eyebrow mono">03 / EVENT LEADERS</p><h2 class="player-head">Sacks &amp; interceptions</h2><p class="small">Tap a player to see their recorded events.</p>
      ${list.map(s => `<button type="button" class="person" data-person="${esc(s.name)}" aria-pressed="${s.name === a.name}"><span>${esc(s.name)}</span><b>${s.sacks} SCK</b><b>${s.picks} INT</b></button>`).join('')}</section>
      <section class="card"><p class="eyebrow mono">PLAYMAKER LOG</p><h2>${esc(a.name)}</h2><p class="small">Event EPA belongs to the full play.</p>${[...a.events].sort(byImpact).map(evidenceRow).join('')}</section></div>`;
  }
  function render(focus) {
    const rows = filtered();
    metricBar(rows);
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
    app.innerHTML = state.view === 'field' ? field(rows) : state.view === 'drives' ? replay(rows) : players(rows);
    if (focus) {
      const target = $(focus);
      if (target && !target.disabled) target.focus({preventScroll:true});
    }
  }
  function stop() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.timer) { stop(); render(); }
  });
  function open(k,id) {
    stop();
    const seq = db.get(k);
    state.view = 'drives';
    state.drive = k;
    state.frame = Math.max(0,seq.findIndex(p => p.id === Number(id)));
    render('#autoplay');
    toApp();
  }
  function reset() {
    stop();
    state.z = null; state.game = ''; state.d = ''; state.type = ''; state.drive = null; state.player = null;
    $('#game').value = ''; $('#down').value = ''; $('#type').value = '';
  }
  $('#game').innerHTML = '<option value="">All Seattle games</option>' + games.map(g => `<option value="${g.id}">${esc(gline(g))}</option>`).join('');
  $('#snapshot').textContent = `REGULAR SEASON / W1–W${data.week} / ${games.length} SEA GAMES`;
  $('#snapshot-date').textContent = `Snapshot cut-off: ${data.snapshot}. Fixed build, not a live feed.`;
  const red = plays.filter(p => zone(p) === 4), openField = plays.filter(p => zone(p) !== 4);
  $('#insight-text').textContent = `Seattle averaged ${signed(mean(openField))} defensive EPA per snap outside its red zone, versus ${signed(mean(red))} inside it. See what changed in ${red.length} red-zone snaps.`;
  $('#story').addEventListener('click', () => { reset(); state.view = 'field'; state.z = 4; render('[data-zone="4"]'); toApp(); });
  $('.views').addEventListener('click', e => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    stop(); state.view = b.dataset.view; render();
  });
  for (const [id,k] of [['game','game'],['down','d'],['type','type']]) {
    $(`#${id}`).addEventListener('change', e => { stop(); state[k] = e.target.value; state.drive = null; render(); });
  }
  $('#reset').addEventListener('click', () => { reset(); render(); });
  app.addEventListener('change', e => {
    if (e.target.id === 'drive') { stop(); state.drive = e.target.value; state.frame = 0; render('#drive'); }
  });
  app.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-zone')) {
      const z = Number(b.dataset.zone);
      state.z = z === state.z ? null : z; render(`[data-zone="${z}"]`);
    } else if (b.dataset.open) {
      open(b.dataset.open,b.dataset.play);
    } else if (b.id === 'clear-zone') {
      state.z = null; render('[data-zone="0"]');
    } else if (b.id === 'top-replay') {
      const p = filtered().filter(q => state.z === null || zone(q) === state.z).sort(byImpact)[0];
      if (p) open(key(p),p.id);
    } else if (b.dataset.person) {
      state.player = b.dataset.person; render(); [...app.querySelectorAll('.person')].find(el => el.dataset.person === state.player)?.focus({preventScroll:true});
    } else if (b.hasAttribute('data-frame') || b.id === 'prev' || b.id === 'next') {
      stop();
      state.frame = b.hasAttribute('data-frame') ? Number(b.dataset.frame) : state.frame + (b.id === 'prev' ? -1 : 1);
      render(b.id ? `#${b.id}` : `[data-frame="${state.frame}"]`);
    } else if (b.id === 'autoplay') {
      if (state.timer) { stop(); render('#autoplay'); return; }
      const last = db.get(state.drive).length-1;
      if (state.frame >= last) state.frame = 0;
      if (last > 0) state.timer = setInterval(() => {
        const focused = document.activeElement?.id === 'autoplay';
        state.frame++;
        if (state.frame >= last) stop();
        render(focused ? '#autoplay' : null);
      }, 1050);
      render('#autoplay');
    }
  });
  render();
})();
