(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const legacy = window.KYOTO_DATA || { spots: [], geometry: {} };
  const additions = window.KYOTO_PLACES || {};
  const defaults = [
    ['lightup', 'ライトアップ', '#9a3c2d'], ['temple', '社寺・庭園', '#657743'],
    ['cafe', 'カフェ・甘味', '#aa4772'],
    ['food', '食事', '#b36d36'], ['walk', '街歩き・買い物', '#497d83']
  ].map(([id, label, color]) => ({ id, label, color }));
  const categories = Array.isArray(additions.categories) && additions.categories.length
    ? additions.categories : defaults;
  const categoryById = new Map(categories.map(c => [c.id, c]));
  const byId = new Map();
  (legacy.spots || []).forEach(d => byId.set(Number(d.id), { ...d, categories: d.categories || ['lightup'] }));
  (additions.spots || []).forEach(d => byId.set(Number(d.id), { ...byId.get(Number(d.id)), ...d }));
  const fallbackAreas = { 19: 'south', 20: 'west', 21: 'west', 22: 'station', 23: 'central' };
  const spots = [...byId.values()].map(d => ({
    ...d, ...(window.KYOTO_PHOTOS || {})[d.id], id: Number(d.id),
    categories: Array.isArray(d.categories) ? d.categories : (d.id <= 23 ? ['lightup'] : []),
    areaKey: d.areaKey || fallbackAreas[d.id] || (d.id <= 7 ? 'north' : d.id <= 14 ? 'east' : d.id <= 18 ? 'station' : 'central')
  })).filter(d => Number.isFinite(d.id)).sort((a, b) => a.id - b.id);
  const geometry = window.KYOTO_BASEMAP || legacy.geometry || {};
  const rawLabels = Array.isArray(geometry.labels) ? geometry.labels : (geometry.labels && geometry.labels.features) || [];
  const seenLabels = new Set();
  const labels = rawLabels.map(d => ({ ...d, name: d.name || (d.properties && (d.properties.name || d.properties.knj)) }))
    .filter(d => d.name && d.geometry && d.geometry.type === 'Point' && !seenLabels.has(d.name) && seenLabels.add(d.name));
  const svg = d3.select('#map');
  const pane = $('.map-pane');
  const select = $('#spot-select');
  const areaSelect = $('#area-select');
  const filterDialog = $('#filter-dialog');
  const clusterDialog = $('#cluster-dialog');
  const detailsDialog = $('#details-dialog');
  const photoDialog = $('#photo-dialog');
  const photo = $('#spot-photo');
  const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300;
  const MAX_ZOOM = 32;
  const STORAGE_KEY = 'kyoto-dec1-genres-v1';
  const shortNames = { 2: 'もみじのトンネル', 12: '知恩院', 19: '醍醐寺', 21: 'トロッコ嵯峨駅' };
  const majorLabels = new Set(['京都駅', '出町柳駅', '嵯峨嵐山駅', '八瀬比叡山口駅', '山科駅', '二条駅', '宇治駅', '長岡京駅', '稲荷駅']);
  let active = new Set(['lightup']), hideClosed = false, draft = new Set(), draftHideClosed = false;
  let visible = [], selected = null, current = null, width = 0, height = 0;
  let photoIndex = 0, gallery = [];
  let projection, zoom, world, transform = d3.zoomIdentity, renderFrame = 0, currentArea = 'all';

  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (stored && Array.isArray(stored.categories)) {
      active = new Set(stored.categories.map(id => ['sweets','machiya','heritage','wagashi','retro','tea'].includes(id) ? 'cafe' : id).filter(id => categoryById.has(id)));
      hideClosed = stored.hideClosedTuesday === true;
    }
  } catch (_) { /* Filters work when storage is unavailable. */ }

  const hasPosition = d => Number.isFinite(d.lat) && Number.isFinite(d.lon);
  const positionSpots = spots.filter(hasPosition);
  function closedFor(d, set) {
    return d.dayView && !set.has('lightup') && typeof d.dayView.closedTuesday === 'boolean'
      ? d.dayView.closedTuesday : d.closedTuesday;
  }
  function filtered(set, hide) {
    return spots.filter(d => d.categories.some(id => set.has(id)) && !(hide && closedFor(d, set) === true));
  }
  function displaySpot(d) {
    if (d.dayView && !active.has('lightup')) {
      return { ...d, ...d.dayView, eventURL: d.dayView.eventURL || '', visitNote: d.dayView.visitNote || '', locationNote: d.dayView.locationNote || '' };
    }
    return d;
  }
  function categoryFor(d) {
    if (active.has('lightup') && d.categories.includes('lightup')) return categoryById.get('lightup') || defaults[0];
    return categories.find(c => active.has(c.id) && d.categories.includes(c.id))
      || categories.find(c => d.categories.includes(c.id)) || defaults[0];
  }
  function externalURL(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch (_) { return ''; }
  }
  function link(el, url, label) {
    const href = externalURL(url);
    el.hidden = !href;
    if (href) el.href = href; else el.removeAttribute('href');
    if (label) el.textContent = label;
  }
  function paragraph(id, value) {
    const el = $(id);
    el.textContent = value || '';
    el.hidden = !value;
  }
  function makeLink(href, text, className) {
    const a = document.createElement('a');
    a.href = href; a.textContent = text; a.target = '_blank'; a.rel = 'noopener noreferrer';
    if (className) a.className = className;
    return a;
  }
  function showDialog(dialog) {
    if (!dialog.open) dialog.showModal();
  }
  function setArea(key) {
    currentArea = key || 'custom';
    areaSelect.value = currentArea;
  }
  function saveFilters() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ categories: [...active], hideClosedTuesday: hideClosed }));
    } catch (_) { /* Private browsing must not block selection. */ }
  }

  function renderFilters() {
    const list = $('#category-list');
    list.replaceChildren();
    categories.forEach(c => {
      const row = document.createElement('div'); row.className = 'category-row';
      const label = document.createElement('label');
      const check = document.createElement('input'); check.type = 'checkbox'; check.value = c.id; check.checked = draft.has(c.id);
      check.addEventListener('change', () => {
        if (check.checked) draft.add(c.id); else draft.delete(c.id);
        updateDraftCount();
      });
      const swatch = document.createElement('span'); swatch.className = 'category-swatch'; swatch.style.setProperty('--category-color', c.color);
      const name = document.createElement('span'); name.className = 'category-label'; name.textContent = c.label;
      const count = document.createElement('span'); count.className = 'category-count'; count.dataset.category = c.id;
      label.append(check, swatch, name, count);
      const only = document.createElement('button'); only.type = 'button'; only.className = 'category-only'; only.textContent = 'のみ';
      only.setAttribute('aria-label', c.label + 'のみ表示');
      only.addEventListener('click', () => { draft = new Set([c.id]); applyDraft(); });
      row.append(label, only); list.append(row);
    });
    $('#hide-closed').checked = draftHideClosed;
    updateDraftCount();
  }
  function updateDraftCount() {
    $('#apply-filters').textContent = filtered(draft, draftHideClosed).length + '件を表示';
    document.querySelectorAll('.category-count').forEach(el => {
      el.textContent = spots.filter(d => d.categories.includes(el.dataset.category) && !(draftHideClosed && closedFor(d, draft) === true)).length;
    });
  }
  function openFilters() {
    draft = new Set(active); draftHideClosed = hideClosed;
    renderFilters(); showDialog(filterDialog);
  }
  function applyDraft() {
    active = new Set(draft); hideClosed = draftHideClosed;
    saveFilters(); filterDialog.close(); setArea('all'); refreshVisible();
  }
  function refreshVisible() {
    visible = filtered(active, hideClosed);
    select.replaceChildren();
    visible.forEach(d => {
      const option = document.createElement('option'); option.value = d.id;
      option.textContent = String(d.id).padStart(2, '0') + '　' + d.name;
      select.append(option);
    });
    select.disabled = visible.length === 0;
    $('#filter-count').textContent = visible.length + '件';
    $('#filters-open').setAttribute('aria-label', 'ジャンルを選ぶ。現在' + visible.length + '件を表示');
    $('#reset-map').setAttribute('aria-label', '現在の' + visible.length + '件が見える全体図に戻す');
    [...areaSelect.options].forEach(option => {
      if (!['all', 'custom'].includes(option.value)) option.disabled = !visible.some(d => d.areaKey === option.value && hasPosition(d));
    });
    $('#map-empty').hidden = visible.length !== 0;

    $('#details-open').disabled = !visible.length;
    if (visible.length) choose(visible.some(d => d.id === selected) ? selected : visible[0].id, { redraw: false });
    else clearSelection();
    draw({ reset: true });
  }
  function clearSelection() {
    selected = null; current = null; gallery = [];
    $('#gallery-controls').hidden = true; $('#prev-photo').hidden = true; $('#next-photo').hidden = true;
    photo.hidden = true; photo.removeAttribute('src'); photo.alt = '';
    $('#photo-open').disabled = true; $('.photo-expand').hidden = true;
    $('#photo-empty').hidden = false; $('#photo-empty').textContent = '表示する場所がありません';
    $('#photo-warning').hidden = true; $('#selection-status').textContent = '表示する場所がありません';
  }

  function renderPhoto() {
    const item = gallery[photoIndex];
    const available = !!(item && item.image);
    photo.hidden = !available;
    $('#photo-open').disabled = !available;
    $('.photo-expand').hidden = !available;
    $('#photo-empty').hidden = available;
    $('#photo-empty').textContent = '写真は準備中です';
    $('#gallery-controls').hidden = !available;
    $('#prev-photo').hidden = gallery.length < 2;
    $('#next-photo').hidden = gallery.length < 2;
    if (!available) { photo.removeAttribute('src'); return; }
    photo.src = item.image;
    photo.alt = current.name + 'の写真 ' + (photoIndex + 1) + '／' + gallery.length;
    $('#photo-open').setAttribute('aria-label', photo.alt + 'を全画面で表示');
    $('#photo-count').textContent = (photoIndex + 1) + ' / ' + gallery.length;
    const dots = $('#photo-dots'); dots.replaceChildren();
    gallery.forEach((p, i) => {
      const b = document.createElement('button'); b.type = 'button';
      b.setAttribute('aria-label', '写真' + (i + 1) + 'を表示');
      b.setAttribute('aria-pressed', String(i === photoIndex));
      b.addEventListener('click', () => { photoIndex = i; renderPhoto(); });
      dots.append(b);
    });
    paragraph('#photo-note', item.note || '施設・店舗の参考写真です。現在の季節や商品内容とは異なる場合があります。');
    paragraph('#photo-credit', item.credit);
    link($('#photo-source'), item.source);
    link($('#photo-license'), item.licenseURL, item.license || '写真のライセンス ↗');
    $('#large-photo').src = item.image; $('#large-photo').alt = photo.alt;
    $('#large-title').textContent = current.name + ' · ' + (photoIndex + 1) + ' / ' + gallery.length;
    $('#large-caption').textContent = item.note || '';
    $('#large-prev').hidden = gallery.length < 2; $('#large-next').hidden = gallery.length < 2;
    $('#photo-status').textContent = photo.alt;
  }
  function stepPhoto(direction) {
    if (gallery.length < 2) return;
    photoIndex = (photoIndex + direction + gallery.length) % gallery.length;
    renderPhoto();
  }

  function choose(id, { pan = false, redraw = true } = {}) {
    const base = visible.find(d => d.id === Number(id));
    if (!base) return;
    selected = base.id; current = displaySpot(base);
    const d = current, category = categoryFor(base);
    const night = active.has('lightup') && base.categories.includes('lightup');
    select.value = String(d.id);
    $('#selection-status').textContent = d.id + '：' + d.name;
    $('#spot-number').textContent = String(d.id).padStart(2, '0');
    $('#spot-number').style.color = category.color;
    $('#spot-name').textContent = d.name;
    $('#spot-area').textContent = [d.area, category.label].filter(Boolean).join(' · ');
    gallery = Array.isArray(d.photos) && d.photos.length ? d.photos : (d.image ? [{ image: d.image, source: d.photoSource, note: d.photoNote, credit: d.photoCredit, license: d.photoLicense, licenseURL: d.photoLicenseURL }] : []);
    photoIndex = 0;
    $('#photo-warning').hidden = d.closedTuesday !== true;
    paragraph('#spot-summary', d.summary);
    const summaryText = String(d.summary || '').trim();
    const notes = [...new Set([d.visitNote, d.locationNote, d.scheduleNote]
      .filter(Boolean).map(note => String(note).trim()).filter(note => note && note !== summaryText))];
    paragraph('#spot-location', notes.join('\n'));
    paragraph('#spot-address', d.address);
    $('#google-map').href = 'https://www.google.com/maps/search/?api=1&query='
      + encodeURIComponent(d.mapQuery || [d.name, d.address || '京都'].join(' '));
    link($('#event-link'), d.eventURL, '開催案内・予約 ↗');
    link($('#official-link'), d.officialURL && d.officialURL !== d.eventURL ? d.officialURL : '', '公式サイト ↗');
    paragraph('#coordinate-note', d.coordinateNote);
    $('#historic-photo-note').hidden = !night;
    renderPhoto();
    link($('#location-source'), d.sourceURL);
    const urls = [...new Set([d.sourceURL, ...(Array.isArray(d.sourceURLs) ? d.sourceURLs : [])].map(externalURL).filter(Boolean))];
    const refs = $('#reference-links'); refs.replaceChildren();
    const extras = $('#additional-sources'); extras.replaceChildren();
    const used = new Set([d.photoSource, d.sourceURL, d.officialURL, d.eventURL].map(externalURL).filter(Boolean));
    const tabelogSeen = new Set();
    urls.forEach(url => {
      const parsed = new URL(url);
      if (/(^|\.)tabelog\.com$/.test(parsed.hostname)) {
        const match = parsed.pathname.match(/^\/[^/]+\/A\d+\/A\d+\/\d+\//);
        const key = match ? parsed.origin + match[0] : url;
        if (!tabelogSeen.has(key)) { refs.append(makeLink(url, '食べログで見る ↗')); tabelogSeen.add(key); }
      } else if (!used.has(url)) {
        extras.append(makeLink(url, parsed.hostname.replace(/^www\./, '') + ' ↗', 'additional-source'));
      }
    });
    $('#availability-note').textContent = night
      ? '2026年12月1日のライトアップ候補です。予約・開催状況は公式案内をご確認ください。'
      : '街歩きの候補です。12月1日の営業・拝観や予約は各公式案内をご確認ください。';
    if (projection && redraw) { drawPins(); if (pan) focusSpot(base); }
  }

  function overlaps(a, b) {
    return a.x < b.x + b.w + 4 && a.x + a.w + 4 > b.x && a.y < b.y + b.h + 3 && a.y + a.h + 3 > b.y;
  }
  function controlRects() {
    const r = pane.getBoundingClientRect();
    const rects = [...pane.querySelectorAll('.filter-toggle,.area-picker,.map-controls,.map-credit')].map(el => {
      const b = el.getBoundingClientRect();
      return { left: b.left - r.left - 3, right: b.right - r.left + 3, top: b.top - r.top - 3, bottom: b.bottom - r.top + 3 };
    });
    rects.push({ left: 8, right: 112, top: height - 49, bottom: height - 21 });
    return rects;
  }
  function clusterNodes(points) {
    const groups = [];
    points.forEach(point => {
      let nearest = null, distance = 46;
      if (visible.length > 28) {
        groups.forEach(group => {
          const gap = Math.hypot(point.ax - group.ax, point.ay - group.ay);
          if (gap < distance) { distance = gap; nearest = group; }
        });
      }
      if (nearest) {
        const n = nearest.members.length;
        nearest.ax = (nearest.ax * n + point.ax) / (n + 1);
        nearest.ay = (nearest.ay * n + point.ay) / (n + 1);
        nearest.members.push(point.spot);
      } else groups.push({ ax: point.ax, ay: point.ay, members: [point.spot] });
    });
    return groups.map(group => {
      const counts = new Map();
      group.members.forEach(d => { const c = categoryFor(d); counts.set(c.id, (counts.get(c.id) || 0) + 1); });
      const leading = [...counts].sort((a, b) => b[1] - a[1])[0];
      const category = categoryById.get(leading && leading[0]) || defaults[0];
      return {
        ...group, x: group.ax, y: group.ay,
        key: group.members.map(d => d.id).join('-'),
        cluster: group.members.length > 1, hit: group.members.length > 1 ? 26 : 22,
        color: category.color, selected: group.members.some(d => d.id === selected)
      };
    });
  }
  function placeNodes(nodes, obstacles) {
    const simulation = d3.forceSimulation(nodes)
      .force('x', d3.forceX(d => d.ax).strength(.32))
      .force('y', d3.forceY(d => d.ay).strength(.32))
      .force('collide', d3.forceCollide(d => d.hit + 1).iterations(4)).stop();
    for (let i = 0; i < 65; i++) {
      simulation.tick();
      nodes.forEach(d => {
        const minX = d.hit + 1, maxX = width - d.hit - 1, minY = d.hit + 2, maxY = height - d.hit - 4;
        d.x = Math.max(minX, Math.min(maxX, d.x));
        d.y = Math.max(minY, Math.min(maxY, d.y));
        obstacles.forEach(rect => {
          const r = { left: rect.left - d.hit, right: rect.right + d.hit, top: rect.top - d.hit, bottom: rect.bottom + d.hit };
          if (d.x <= r.left || d.x >= r.right || d.y <= r.top || d.y >= r.bottom) return;
          const choices = [{ x: r.left, y: d.y }, { x: r.right, y: d.y }, { x: d.x, y: r.top }, { x: d.x, y: r.bottom }]
            .filter(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)
            .sort((a, b) => Math.hypot(a.x - d.x, a.y - d.y) - Math.hypot(b.x - d.x, b.y - d.y));
          if (choices.length) { d.x = choices[0].x; d.y = choices[0].y; }
        });
      });
    }
  }
  function drawPins() {
    if (!projection || !world) return;
    const points = visible.filter(hasPosition).map(spot => {
      const p = transform.apply(projection([spot.lon, spot.lat]));
      return { spot, ax: p[0], ay: p[1] };
    }).filter(d => d.ax > 10 && d.ax < width - 10 && d.ay > 16 && d.ay < height - 16);
    const obstacles = controlRects();
    const nodes = clusterNodes(points);
    placeNodes(nodes, obstacles);
    svg.select('.leaders').selectAll('path').data(nodes, d => d.key).join('path').attr('class', 'leader')
      .attr('stroke', d => d.color).attr('d', d => 'M' + d.ax + ',' + d.ay + 'L' + d.x + ',' + d.y);
    svg.select('.locations').selectAll('circle').data(points, d => d.spot.id).join('circle').attr('class', 'location-dot')
      .attr('cx', d => d.ax).attr('cy', d => d.ay).attr('r', 1.6).style('fill', d => categoryFor(d.spot).color);
    const pins = svg.select('.pins').selectAll('g').data(nodes, d => d.key).join(enter => {
      const g = enter.append('g');
      g.append('circle').attr('class', 'pin-ring');
      g.append('circle').attr('class', 'pin-face');
      g.append('text').attr('class', 'pin-number');
      g.append('circle').attr('class', 'pin-hit');
      return g;
    });
    function activate(event, d) {
      event.stopPropagation();
      if (d.cluster) openCluster(d); else choose(d.members[0].id);
    }
    pins.attr('class', d => 'map-pin' + (d.cluster ? ' cluster-pin' : '') + (d.selected ? ' is-selected' : ''))
      .attr('transform', d => 'translate(' + d.x + ',' + d.y + ')')
      .style('--pin-color', d => d.color).attr('role', 'button').attr('tabindex', 0)
      .attr('aria-label', d => d.cluster ? d.members.length + '件の場所を拡大して見る' : d.members[0].id + '. ' + d.members[0].name + 'の写真を見る')
      .attr('aria-pressed', d => String(d.selected))
      .attr('data-spot-id', d => d.cluster ? null : d.members[0].id)
      .attr('data-cluster-count', d => d.cluster ? d.members.length : null)
      .on('click', activate).on('keydown', (event, d) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(event, d); }
      });
    pins.select('.pin-ring').attr('r', d => d.hit);
    pins.select('.pin-face').attr('r', d => d.cluster ? 23 : 16);
    pins.select('.pin-hit').attr('r', d => d.hit);
    pins.select('.pin-number').text(d => d.cluster ? d.members.length + '件' : d.members[0].id);
    pins.filter(d => d.selected).raise();
    const used = nodes.map(d => ({ x: d.x - d.hit, y: d.y - d.hit, w: d.hit * 2, h: d.hit * 2 }));
    obstacles.forEach(r => used.push({ x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top }));
    const text = [];
    for (const node of [...nodes].filter(d => !d.cluster).sort((a, b) => Number(b.selected) - Number(a.selected))) {
      if (!node.selected && transform.k < 1.8) continue;
      const spot = node.members[0];
      const full = shortNames[spot.id] || spot.name, name = full.length > 18 ? full.slice(0, 17) + '…' : full;
      const w = name.length * 11 + 4, h = 16;
      const options = [
        { x: node.x + 24, y: node.y - 8, w, h }, { x: node.x - w - 24, y: node.y - 8, w, h },
        { x: node.x - w / 2, y: node.y + 25, w, h }, { x: node.x - w / 2, y: node.y - 40, w, h }
      ];
      const box = options.find(b => b.x > 5 && b.x + b.w < width - 5 && b.y > 5 && b.y + b.h < height - 18 && !used.some(u => overlaps(b, u)));
      if (box) { used.push(box); text.push({ ...box, text: name, selected: node.selected, color: node.color }); }
    }
    svg.select('.place-labels').selectAll('text').data(text).join('text').attr('class', d => 'place-label' + (d.selected ? ' selected' : ''))
      .attr('x', d => d.x).attr('y', d => d.y + 12).style('fill', d => d.selected ? d.color : null).text(d => d.text);
    const base = [];
    for (const d of [...labels].sort((a, b) => Number(b.name === '京都駅') - Number(a.name === '京都駅'))) {
      if (transform.k < 2 && !majorLabels.has(d.name)) continue;
      const p = transform.apply(projection(d.geometry.coordinates));
      const box = { x: p[0] - d.name.length * 5.5, y: p[1] - 7, w: d.name.length * 11, h: 14 };
      if (box.x > 8 && box.x + box.w < width - 8 && box.y > 15 && box.y + box.h < height - 25 && !used.some(u => overlaps(box, u))) {
        base.push({ name: d.name, x: p[0], y: p[1] }); used.push(box);
      }
    }
    svg.select('.base-labels').selectAll('text').data(base).join('text').attr('class', 'base-label')
      .attr('x', d => d.x).attr('y', d => d.y).attr('text-anchor', 'middle').text(d => d.name);
    drawScale();
  }
  function drawScale() {
    const center = projection.invert(transform.invert([width / 2, height / 2]));
    const a = projection(center), b = projection([center[0] + 1 / (111.32 * Math.cos(center[1] * Math.PI / 180)), center[1]]);
    const pixels = Math.abs(b[0] - a[0]) * transform.k;
    const options = [.02, .05, .1, .2, .5, 1, 2, 5, 10, 20, 50];
    const km = options.reduce((best, candidate) => Math.abs(candidate * pixels - 65) < Math.abs(best * pixels - 65) ? candidate : best, 1);
    const len = km * pixels, x = 14, y = height - 28;
    svg.select('.scale-line').attr('d', 'M' + x + ',' + (y - 4) + 'V' + y + 'H' + (x + len) + 'V' + (y - 4));
    svg.select('.scale-label').attr('x', x + len / 2).attr('y', y - 7).text(km < 1 ? Math.round(km * 1000) + ' m' : km + ' km');
  }
  function schedulePins() {
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => { renderFrame = 0; drawPins(); });
  }
  function viewport() {
    return { left: 34, right: width - 34, top: Math.min(78, height * .25), bottom: height - Math.min(86, height * .25) };
  }
  function fitTransform(list, maxZoom = 18) {
    const pts = list.filter(hasPosition).map(d => projection([d.lon, d.lat]));
    if (!pts.length) return d3.zoomIdentity;
    const r = viewport(), x0 = d3.min(pts, p => p[0]), x1 = d3.max(pts, p => p[0]);
    const y0 = d3.min(pts, p => p[1]), y1 = d3.max(pts, p => p[1]);
    const k = Math.min(maxZoom, Math.max(1, Math.min((r.right - r.left) / Math.max(x1 - x0, 1), (r.bottom - r.top) / Math.max(y1 - y0, 1))));
    return d3.zoomIdentity.translate((r.left + r.right) / 2 - (x0 + x1) * k / 2, (r.top + r.bottom) / 2 - (y0 + y1) * k / 2).scale(k);
  }
  function move(t, animate = true) {
    if (!zoom) return;
    svg.interrupt();
    if (animate && duration) svg.transition().duration(duration).call(zoom.transform, t);
    else svg.call(zoom.transform, t);
  }
  function focusSpot(d) {
    if (!hasPosition(d)) return;
    const q = projection([d.lon, d.lat]), p = transform.apply(q), r = viewport();
    if (p[0] > r.left && p[0] < r.right && p[1] > r.top && p[1] < r.bottom) return;
    const k = transform.k;
    move(d3.zoomIdentity.translate((r.left + r.right) / 2 - q[0] * k, (r.top + r.bottom) / 2 - q[1] * k).scale(k));
    setArea(null);
  }
  function focusArea(key, animate = true) {
    const list = key === 'all' ? visible : visible.filter(d => d.areaKey === key);
    if (!list.length) return;
    move(fitTransform(list), animate); setArea(key);
  }
  function openCluster(node) {
    const pts = node.members.map(d => transform.apply(projection([d.lon, d.lat])));
    const span = Math.max(d3.max(pts, p => p[0]) - d3.min(pts, p => p[0]), d3.max(pts, p => p[1]) - d3.min(pts, p => p[1]));
    if (transform.k >= MAX_ZOOM * .98 || span < 1) { showClusterList(node.members); return; }
    const fitted = fitTransform(node.members, MAX_ZOOM);
    const k = Math.min(MAX_ZOOM, Math.max(transform.k * 2.2, fitted.k));
    if (k < transform.k * 1.08) { showClusterList(node.members); return; }
    const r = viewport(), center = [d3.mean(node.members, d => projection([d.lon, d.lat])[0]), d3.mean(node.members, d => projection([d.lon, d.lat])[1])];
    move(d3.zoomIdentity.translate((r.left + r.right) / 2 - center[0] * k, (r.top + r.bottom) / 2 - center[1] * k).scale(k));
    setArea(null);
  }
  function showClusterList(members) {
    const list = $('#cluster-list'); list.replaceChildren();
    $('#cluster-count').textContent = members.length + '件から選択';
    [...members].sort((a, b) => a.id - b.id).forEach(d => {
      const button = document.createElement('button'); button.type = 'button';
      button.className = 'cluster-choice' + (d.id === selected ? ' is-selected' : '');
      button.style.setProperty('--category-color', categoryFor(d).color);
      const number = document.createElement('span'); number.className = 'choice-number'; number.textContent = d.id;
      const text = document.createElement('span'); text.className = 'choice-text'; text.textContent = d.name;
      if (closedFor(d, active) === true) { const note = document.createElement('span'); note.className = 'choice-note'; note.textContent = '火曜定休'; text.append(note); }
      button.append(number, text);
      button.addEventListener('click', () => { clusterDialog.close(); choose(d.id, { pan: true }); });
      list.append(button);
    });
    showDialog(clusterDialog);
  }

  function draw({ reset = false } = {}) {
    const rect = pane.getBoundingClientRect(), w = Math.round(rect.width), h = Math.round(rect.height);
    if (w < 1 || h < 1) return;
    svg.interrupt();
    const priorCenter = projection ? projection.invert(transform.invert([width / 2, height / 2])) : null;
    const priorZoom = transform.k;
    width = w; height = h; svg.attr('viewBox', '0 0 ' + width + ' ' + height);
    const r = viewport();
    let positions = positionSpots.map(d => [d.lon, d.lat]);
    if (positions.length < 2) positions = [[135.72, 34.98], [135.80, 35.06]];
    const collection = { type: 'FeatureCollection', features: positions.map(coordinates => ({ type: 'Feature', geometry: { type: 'Point', coordinates } })) };
    projection = d3.geoMercator().fitExtent([[r.left, r.top], [r.right, r.bottom]], collection);
    const path = d3.geoPath(projection);
    svg.selectAll('*').remove();
    world = svg.append('g').attr('class', 'world');
    for (const [layer, cls] of [['WA', 'water'], ['AdmBdry', 'boundary'], ['RdCL', 'road'], ['RailCL', 'rail'], ['RvrCL', 'river']]) {
      const data = geometry.layers && geometry.layers[layer];
      if (data) world.append('path').datum(data).attr('class', cls).attr('d', path).attr('vector-effect', 'non-scaling-stroke');
    }
    ['base-labels', 'leaders', 'locations', 'pins', 'place-labels'].forEach(cls => svg.append('g').attr('class', cls));
    svg.append('path').attr('class', 'scale-line'); svg.append('text').attr('class', 'scale-label');
    zoom = d3.zoom().scaleExtent([1, MAX_ZOOM]).translateExtent([[-width, -height], [width * 2, height * 2]])
      .extent([[0, 0], [width, height]]).filter(e => e.type === 'wheel' || !e.button)
      .on('zoom', e => {
        transform = e.transform; world.attr('transform', transform); schedulePins();
        if (e.sourceEvent) setArea(null);
      });
    svg.call(zoom).on('dblclick.zoom', null);
    if (!reset && currentArea === 'custom' && priorCenter) {
      const p = projection(priorCenter);
      move(d3.zoomIdentity.translate(width / 2 - p[0] * priorZoom, height / 2 - p[1] * priorZoom).scale(priorZoom), false);
    } else {
      const group = currentArea === 'all' || currentArea === 'custom' ? visible : visible.filter(d => d.areaKey === currentArea);
      move(fitTransform(group), false);
    }
    drawPins();
  }

  $('#filters-open').addEventListener('click', openFilters);
  $('#empty-filters-open').addEventListener('click', openFilters);
  $('#filters-close').addEventListener('click', () => filterDialog.close());
  $('#filter-all').addEventListener('click', () => { draft = new Set(categories.map(c => c.id)); renderFilters(); });
  $('#filter-none').addEventListener('click', () => { draft.clear(); renderFilters(); });
  $('#hide-closed').addEventListener('change', e => { draftHideClosed = e.target.checked; updateDraftCount(); });
  $('#apply-filters').addEventListener('click', applyDraft);
  $('#cluster-close').addEventListener('click', () => clusterDialog.close());
  select.addEventListener('change', () => choose(select.value, { pan: true }));
  $('#prev-photo').addEventListener('click', () => stepPhoto(-1));
  $('#next-photo').addEventListener('click', () => stepPhoto(1));
  $('#large-prev').addEventListener('click', () => stepPhoto(-1));
  $('#large-next').addEventListener('click', () => stepPhoto(1));
  $('#zoom-in').addEventListener('click', () => { if (zoom) { svg.interrupt().transition().duration(duration).call(zoom.scaleBy, 1.65); setArea(null); } });
  $('#zoom-out').addEventListener('click', () => { if (zoom) { svg.interrupt().transition().duration(duration).call(zoom.scaleBy, 1 / 1.65); setArea(null); } });
  $('#reset-map').addEventListener('click', () => focusArea('all'));
  areaSelect.addEventListener('change', () => focusArea(areaSelect.value));
  $('#details-open').addEventListener('click', () => { if (current) showDialog(detailsDialog); });
  $('#details-close').addEventListener('click', () => detailsDialog.close());
  $('#photo-open').addEventListener('click', () => {
    if (!current || !gallery.length) return;
    renderPhoto();
    showDialog(photoDialog);
  });

  [$('#photo-open'), photoDialog].forEach(el => {
    let start = null, swiped = false;
    el.addEventListener('pointerdown', e => { start = {x:e.clientX,y:e.clientY}; swiped = false; });
    el.addEventListener('pointerup', e => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y; start = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        swiped = true; stepPhoto(dx < 0 ? 1 : -1);
      }
    });
    el.addEventListener('pointercancel', () => { start = null; });
    el.addEventListener('click', e => { if (swiped) { e.preventDefault(); e.stopImmediatePropagation(); swiped = false; } }, true);
    el.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault(); stepPhoto(e.key === 'ArrowRight' ? 1 : -1);
      }
    });
  });

  $('#photo-close').addEventListener('click', () => photoDialog.close());
  [detailsDialog, filterDialog, clusterDialog, photoDialog].forEach(dialog => {
    dialog.addEventListener('click', e => {
      const r = dialog.getBoundingClientRect();
      if (e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dialog.close();
    });
  });
  photo.addEventListener('error', () => {
    photo.hidden = true; $('#photo-open').disabled = true; $('.photo-expand').hidden = true;
    $('#photo-empty').hidden = false; $('#photo-empty').textContent = '写真を読み込めませんでした';
  });
  refreshVisible();
  let resizeTimer;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const r = pane.getBoundingClientRect();
      if (Math.abs(r.width - width) > 2 || Math.abs(r.height - height) > 2) draw();
    }, 80);
  }).observe(pane);
})();
