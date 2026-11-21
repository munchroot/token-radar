// Token Launch Radar dashboard. Reads window.RADAR (written beside dashboard/ by main.ts)
// and renders three views from it: the ranked board, one protocol's detail, and the
// calibration the model was priced from. No network: every byte shown is in data.js.
// The view state lives in the location hash (#/, #/p/<slug>, #/calibration, with the
// board's filters as a query) so every view is a link and a screenshot address.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !DATA.rows) {
    app.innerHTML = '<p class="empty">No radar data: run main.ts first so data.js sits beside this page.</p>';
    return;
  }
  var C = DATA.constants;
  var bySlug = {};
  DATA.rows.forEach(function (r) { bySlug[r.slug] = r; });
  var maxImplied = DATA.rows.length ? DATA.rows[0].implied_value_usd : 1;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function usd(n) {
    if (n == null) return '-';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n == null) return '<span class="num">-</span>';
    var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
    return '<span class="num ' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function mult(n) { return 'x' + Number(n).toFixed(3); }
  function ageLabel(days) {
    if (days == null) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }
  function chainLabel(chains) {
    if (!chains.length) return '-';
    var head = chains.slice(0, 2).join(', ');
    return esc(head) + (chains.length > 2 ? ' <span class="num">+' + (chains.length - 2) + '</span>' : '');
  }

  function header() {
    return '' +
    '<header class="masthead">' +
      '<div class="kicker">Token Launch Radar</div>' +
      '<h1>Pre-token protocols, ranked by what their launch would be worth</h1>' +
      '<p class="lede">Every protocol in the snapshot whose token does not exist yet, priced by the ' +
      'market\'s own record: the <strong>market cap / TVL multiples of the protocols that already launched</strong>, ' +
      'taken per category from this same snapshot - then adjusted for 7-day growth, for how long each ' +
      'protocol has run with no token, and for how many chains it runs on. Each row carries the steps to farm it.</p>' +
      '<div class="stats">' +
        '<div class="stat"><div class="v">' + DATA.board_size + '</div><div class="k">protocols ranked</div></div>' +
        '<div class="stat"><div class="v">' + DATA.watchlist_size + '</div><div class="k">watchlist, all covered</div></div>' +
        '<div class="stat"><div class="v">' + DATA.tokenised_count + '</div><div class="k">launched peers priced</div></div>' +
        '<div class="stat"><div class="v">' + mult(DATA.global_median) + '</div><div class="k">global median mcap/TVL</div></div>' +
        '<div class="stat"><div class="v">' + esc(DATA.as_of) + '</div><div class="k">snapshot date</div></div>' +
      '</div>' +
      '<section class="model"><h2>How the implied value is set<span class="tag">model ' + esc(DATA.model_version) + '</span></h2>' +
        '<ol>' +
          '<li><strong>Comps base.</strong> A category with at least ' + C.min_category_sample + ' launched peers is priced at its own median mcap/TVL; ' +
          'any other category falls back to the global median ' + mult(DATA.global_median) + '. No multiple passes ' + mult(C.multiple_cap) + '.</li>' +
          '<li><strong>Growth.</strong> The 7-day TVL change, clamped to ' + C.growth_floor + '%..+' + C.growth_cap + '%, moves the value by half its size.</li>' +
          '<li><strong>Maturity.</strong> A protocol earns the full comps value after ' + (C.maturity_days / 365) + ' years with no token; ' +
          'a new one keeps ' + Math.round(C.maturity_floor * 100) + '%. Unknown listing dates are scored at ' + (C.unknown_age_days / 365) + ' year.</li>' +
          '<li><strong>Reach.</strong> +' + Math.round(C.chain_bonus * 100) + '% per extra chain beyond the first, up to 5.</li>' +
        '</ol>' +
        '<div class="formula">implied value = TVL x category multiple x growth x maturity x reach</div>' +
      '</section>' +
    '</header>';
  }

  function parseHash() {
    var h = location.hash.replace(/^#/, '') || '/';
    var q = {};
    var qi = h.indexOf('?');
    if (qi >= 0) {
      h.slice(qi + 1).split('&').forEach(function (kv) {
        var p = kv.split('=');
        if (p.length === 2) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1]);
      });
      h = h.slice(0, qi);
    }
    return { path: h, q: q };
  }
  function boardHash(st) {
    var parts = [];
    if (st.q) parts.push('q=' + encodeURIComponent(st.q));
    if (st.cat) parts.push('cat=' + encodeURIComponent(st.cat));
    if (st.chain) parts.push('chain=' + encodeURIComponent(st.chain));
    if (st.watch) parts.push('watch=1');
    if (st.sort && st.sort !== 'rank') parts.push('sort=' + encodeURIComponent(st.sort));
    return '#/' + (parts.length ? '?' + parts.join('&') : '');
  }

  function boardView(st) {
    var cats = [];
    var chains = [];
    DATA.rows.forEach(function (r) {
      if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
      r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
    });
    cats.sort(); chains.sort();
    var rows = DATA.rows.filter(function (r) {
      if (st.watch && !r.on_watchlist) return false;
      if (st.cat && r.category !== st.cat) return false;
      if (st.chain && r.chains.indexOf(st.chain) < 0) return false;
      if (st.q && r.name.toLowerCase().indexOf(st.q.toLowerCase()) < 0 && r.slug.indexOf(st.q.toLowerCase()) < 0) return false;
      return true;
    });
    var sorters = {
      rank: function (a, b) { return a.rank - b.rank; },
      implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d == null ? -1e9 : b.change_7d) - (a.change_7d == null ? -1e9 : a.change_7d); },
      age: function (a, b) { return (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days); }
    };
    rows = rows.slice().sort(sorters[st.sort] || sorters.rank);
    function opts(list, cur, allLabel) {
      var s = '<option value="">' + allLabel + '</option>';
      list.forEach(function (v) { s += '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'; });
      return s;
    }
    function sortOpts() {
      var defs = [['rank', 'Model rank'], ['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7d growth'], ['age', 'Time tokenless']];
      return defs.map(function (d) { return '<option value="' + d[0] + '"' + (st.sort === d[0] ? ' selected' : '') + '>' + d[1] + '</option>'; }).join('');
    }
    var body = rows.map(function (r) {
      var w = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100));
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) +
          (r.on_watchlist ? '<span class="badge watch">WATCHLIST</span>' : '') +
          '<span class="sub">' + esc(r.category || 'Uncategorised') + ' - ' + chainLabel(r.chains) + '</span></td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td>' + pct(r.change_7d) + '</td>' +
        '<td class="num hide-s">' + ageLabel(r.age_days) + '</td>' +
        '<td class="num hide-s">' + mult(r.base_multiple) +
          (r.multiple_source === 'category'
            ? '<span class="badge cat">n=' + r.category_sample + '</span>'
            : '<span class="badge glob">global</span>') + '</td>' +
        '<td class="implied">' + usd(r.implied_value_usd) + '<div class="bar"><i style="width:' + w + '%"></i></div></td>' +
      '</tr>';
    }).join('');
    return header() +
    '<nav class="tabs"><button aria-selected="true">The board</button>' +
      '<button data-nav="calibration" aria-selected="false">Calibration</button></nav>' +
    '<form class="controls" id="controls">' +
      '<label>Search<input type="search" name="q" placeholder="Protocol name" value="' + esc(st.q || '') + '"></label>' +
      '<label>Category<select name="cat">' + opts(cats, st.cat, 'All categories') + '</select></label>' +
      '<label>Chain<select name="chain">' + opts(chains, st.chain, 'All chains') + '</select></label>' +
      '<label>Sort by<select name="sort">' + sortOpts() + '</select></label>' +
      '<label class="check"><input type="checkbox" name="watch"' + (st.watch ? ' checked' : '') + '> Watchlist only</label>' +
      '<span class="count"><strong>' + rows.length + '</strong> of ' + DATA.board_size + ' shown</span>' +
    '</form>' +
    (rows.length
      ? '<table class="board"><thead><tr><th>#</th><th>Protocol</th><th>TVL</th><th>7d</th><th class="hide-s">Tokenless</th><th class="hide-s">Multiple</th><th>Implied value</th></tr></thead><tbody>' + body + '</tbody></table>'
      : '<p class="empty">No protocol matches those filters. Loosen one and the radar sweeps again.</p>') +
    footer();
  }

  function detailView(r) {
    var steps = r.farm_steps.map(function (s) {
      var m = s.match(/^(.*?)\s*Cost:\s*(.*?)\.\s*Time:\s*(.*?)\.?$/);
      if (!m) return '<li>' + esc(s) + '</li>';
      return '<li>' + esc(m[1]) + '<br><strong>Cost:</strong> ' + esc(m[2]) + '. <strong>Time:</strong> ' + esc(m[3]) + '.</li>';
    }).join('');
    function factor(k, v, d) {
      return '<div class="factor"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="d">' + d + '</div></div>';
    }
    return header() +
    '<p><button class="back" data-nav="board">&larr; Back to the board</button></p>' +
    '<section class="detail-head"><h2>' + esc(r.name) +
      (r.on_watchlist ? '<span class="badge watch">WATCHLIST</span>' : '') + '</h2>' +
      '<div class="meta">' + esc(r.category || 'Uncategorised') + ' - runs on ' + (r.chains.length ? esc(r.chains.join(', ')) : 'one chain') +
      ' - rank #' + r.rank + ' of ' + DATA.board_size + '</div></section>' +
    '<div class="factors">' +
      factor('Implied launch value', usd(r.implied_value_usd), 'What a token would be worth at this record, under model ' + esc(DATA.model_version) + '.') +
      factor('TVL', usd(r.tvl_usd), 'Locked in the protocol on the snapshot date, ' + esc(DATA.as_of) + '.') +
      factor('Category multiple', mult(r.base_multiple), r.multiple_source === 'category'
        ? 'Median mcap/TVL of the ' + r.category_sample + ' launched ' + esc(r.category || '') + ' peers in this snapshot.'
        : 'Too few launched peers in this category (' + r.category_sample + '), so the global median applies.') +
      factor('Growth factor', 'x' + r.growth_multiplier.toFixed(3), 'From the 7-day TVL change of ' + (r.change_7d == null ? 'n/a (scored as 0%)' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + ', clamped and halved.') +
      factor('Maturity factor', 'x' + r.maturity_multiplier.toFixed(3), 'Running with no token for ' + ageLabel(r.age_days) + (r.age_days == null ? ' (listing date unknown, scored at ' + (C.unknown_age_days / 365) + ' year)' : '') + '.') +
      factor('Reach factor', 'x' + r.chain_multiplier.toFixed(3), r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ' at +' + Math.round(C.chain_bonus * 100) + '% per extra chain.') +
    '</div>' +
    '<section class="plan"><h3>Farm plan - before any token exists</h3><ol>' + steps + '</ol></section>' +
    footer();
  }

  function calibrationView() {
    var catRows = DATA.categories.map(function (c) {
      return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.sample + '</td>' +
        '<td class="num">' + (c.median_multiple == null ? '-' : mult(c.median_multiple)) + '</td>' +
        '<td class="num">' + mult(c.applied_multiple) + '</td>' +
        '<td>' + (c.source === 'category' ? '<span class="badge cat">category</span>' : '<span class="badge glob">global fallback</span>') + '</td></tr>';
    }).join('');
    var liveRows = DATA.live.map(function (p) {
      return '<tr><td class="name">' + esc(p.name) + '<span class="sub">' + esc(p.category || '') + '</span></td>' +
        '<td class="num">' + usd(p.tvl_usd) + '</td><td class="num">' + usd(p.mcap_usd) + '</td><td class="num">' + mult(p.multiple) + '</td></tr>';
    }).join('');
    return header() +
    '<nav class="tabs"><button data-nav="board" aria-selected="false">The board</button>' +
      '<button aria-selected="true">Calibration</button></nav>' +
    '<section class="calib"><h3>Where the multiples come from</h3>' +
      '<p>Every multiple on the board is read off this snapshot: the ' + DATA.tokenised_count + ' protocols that already ' +
      'trade a token, grouped by category. A category median is used only at ' + C.min_category_sample + ' or more launched peers; ' +
      'below that the category\'s own median is noise (one snapshot category has a single peer at x400), so the global median ' +
      mult(DATA.global_median) + ' applies instead, and every multiple is capped at ' + mult(C.multiple_cap) + '. Protocols whose record ' +
      'carries a token symbol or a CoinGecko id already have a token - they calibrate the model, they are never ranked by it.</p>' +
      '<table><thead><tr><th>Category</th><th>Launched peers</th><th>Median mcap/TVL</th><th>Applied</th><th>Source</th></tr></thead><tbody>' + catRows + '</tbody></table>' +
      '<h3 style="margin-top:22px">The largest launched protocols, at the market\'s own prices</h3>' +
      '<table><thead><tr><th>Protocol</th><th>TVL</th><th>Market cap</th><th>Actual mcap/TVL</th></tr></thead><tbody>' + liveRows + '</tbody></table>' +
    '</section>' + footer();
  }

  function footer() {
    return '<footer>Built from the sealed DefiLlama snapshot of ' + esc(DATA.as_of) + ' (' + esc(DATA.source) + '): ' +
      DATA.board_size + ' pre-token protocols ranked, ' + DATA.watchlist_size + ' watchlist protocols covered, ' +
      DATA.live_size + ' launched protocols shown for calibration. An implied value is this entry\'s own claim ' +
      'under model ' + esc(DATA.model_version) + ', not a prediction that a token will be issued. MIT licensed.</footer>';
  }

  function render() {
    var route = parseHash();
    app.setAttribute('aria-busy', 'false');
    if (route.path.indexOf('/p/') === 0) {
      var r = bySlug[decodeURIComponent(route.path.slice(3))];
      app.innerHTML = r ? detailView(r) : boardView({});
      window.scrollTo(0, 0);
    } else if (route.path === '/calibration') {
      app.innerHTML = calibrationView();
      window.scrollTo(0, 0);
    } else {
      app.innerHTML = boardView({
        q: route.q.q || '', cat: route.q.cat || '', chain: route.q.chain || '',
        watch: route.q.watch === '1', sort: route.q.sort || 'rank'
      });
      var form = document.getElementById('controls');
      if (form) {
        form.addEventListener('change', function () {
          var fd = new FormData(form);
          location.hash = boardHash({
            q: String(fd.get('q') || ''), cat: String(fd.get('cat') || ''),
            chain: String(fd.get('chain') || ''), watch: fd.get('watch') === 'on',
            sort: String(fd.get('sort') || 'rank')
          });
        });
        form.addEventListener('submit', function (e) { e.preventDefault(); });
        var search = form.querySelector('input[type="search"]');
        var t = null;
        search.addEventListener('input', function () {
          clearTimeout(t);
          t = setTimeout(function () {
            var fd = new FormData(form);
            location.hash = boardHash({
              q: search.value, cat: String(fd.get('cat') || ''),
              chain: String(fd.get('chain') || ''), watch: fd.get('watch') === 'on',
              sort: String(fd.get('sort') || 'rank')
            });
            var el = document.querySelector('input[type="search"]');
            if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
          }, 350);
        });
      }
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (el) {
      el.addEventListener('click', function () {
        location.hash = el.getAttribute('data-nav') === 'calibration' ? '#/calibration' : '#/';
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () {
        location.hash = '#/p/' + encodeURIComponent(tr.getAttribute('data-slug'));
      });
    });
  }
  window.addEventListener('hashchange', render);
  render();
})();
