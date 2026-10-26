const $ = id => document.getElementById(id);
const api = async (path, opt) => {
  const response = await fetch(path, opt);
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Kesalahan server');
  return data;
};

let selectedFile = null, device = 'auto', activeJob = null, polling = null, currentResult = 'text', waveURL = null;

const toast = msg => {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
};

function wave(target, count = 120) {
  const el = $(target);
  if (!el) return;
  el.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const bar = document.createElement('i');
    const x = i / count;
    const amp = Math.pow(Math.sin(x * Math.PI), 0.95);
    const height = 10 + Math.random() * 85 * amp + 4 * Math.random();
    bar.style.setProperty('--h', height + '%');
    bar.style.setProperty('--delay', (-Math.random() * 2) + 's');
    el.appendChild(bar);
  }
}
wave('heroWave', 180); wave('audioBars', 90);

function activateView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('.nav-btn').forEach(btn => { const active = btn.dataset.view === name; btn.classList.toggle('active', active); if (active) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current'); });
}

document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => activateView(btn.dataset.view)));
document.querySelectorAll('[data-jump]').forEach(btn => btn.addEventListener('click', () => activateView(btn.dataset.jump)));

function selectFile(file) {
  if (!file) return;
  const allowed = ['mp3','wav','m4a','flac','mp4','mov','aac','ogg','webm','mkv','wma','opus'];
  if (!allowed.includes(file.name.split('.').pop().toLowerCase())) return toast('Format belum didukung.');
  if (file.size > 290 * 1024 * 1024) return toast('Maksimal file 290 MB.');
  selectedFile = file;
  $('filePreview').hidden = false;
  $('fileName').textContent = file.name;
  $('fileSize').textContent = (file.size / 1024 / 1024).toFixed(2) + ' MB';
  $('latestFile').textContent = file.name;
  $('latestState').textContent = 'File siap diproses';
  $('startBtn').disabled = false;
  if (waveURL) URL.revokeObjectURL(waveURL);
  waveURL = URL.createObjectURL(file);
  $('audioPlayer').src = waveURL;
  toast('File siap diproses.');
}

const drop = $('dropzone');
drop.addEventListener('click', () => $('fileInput').click());
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); } });
['dragenter','dragover'].forEach(evt => drop.addEventListener(evt, e => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave','drop'].forEach(evt => drop.addEventListener(evt, e => { e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop', e => selectFile(e.dataTransfer.files[0]));
$('fileInput').addEventListener('change', e => selectFile(e.target.files[0]));
$('clearFile').onclick = () => {
  selectedFile = null;
  $('filePreview').hidden = true;
  $('fileInput').value = '';
  $('audioPlayer').removeAttribute('src');
  $('audioPlayer').load();
  $('startBtn').disabled = true;
  $('latestFile').textContent = 'Belum ada file aktif';
  $('latestState').textContent = 'Menunggu input';
};

document.querySelectorAll('[data-device]').forEach(button => button.addEventListener('click', () => {
  device = button.dataset.device;
  document.querySelectorAll('[data-device]').forEach(b => b.classList.toggle('selected', b === button));
}));

async function system() {
  try {
    const data = await api('/api/system');
    const g = data.device;
    $('systemBadge').textContent = g.gpu_available ? '● GPU CUDA terdeteksi' : '● CPU mode aktif';
    $('deviceState').textContent = g.gpu_available ? 'GPU Ready' : 'CPU Ready';
    $('deviceNote').textContent = g.gpu_available ? g.gpu_name : 'GPU belum tersedia';
    $('toolDeviceSummary').textContent = g.gpu_available ? 'GPU CUDA siap dipakai' : 'CPU siap dipakai';
    $('toolDeviceDetail').textContent = g.gpu_available ? g.gpu_name + ' • CUDA ' + (g.cuda_version || '?') : 'CUDA belum tersedia. Pilih mode CPU atau Auto.';
    $('systemDetails').innerHTML = `<b>${g.gpu_available ? 'GPU tersedia' : 'CPU siap dipakai'}</b><br>${escapeHTML(g.gpu_name)}<br>${g.cuda_version ? 'CUDA ' + escapeHTML(g.cuda_version) : 'Sistem otomatis memakai CPU bila CUDA tidak tersedia.'}`;
    if (!g.gpu_available) { $('gpuButton').disabled = true; $('gpuButton').title = 'CUDA NVIDIA tidak terdeteksi'; }
  } catch (e) {
    $('toolDeviceSummary').textContent = 'Tidak dapat membaca perangkat';
    $('toolDeviceDetail').textContent = 'Pastikan server.py sedang berjalan.';
    $('systemBadge').textContent = '● Server tidak terhubung';
    $('systemDetails').textContent = 'Gagal membaca status perangkat.';
  }
}

function escapeHTML(text) {
  return String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

$('startBtn').onclick = async () => {
  if (!selectedFile) return;
  const form = new FormData();
  form.append('file', selectedFile);
  form.append('model', $('model').value);
  form.append('language', $('language').value);
  form.append('device', device);
  $('startBtn').disabled = true;
  $('statusLabel').textContent = 'MENGUNGGAH…';
  $('statusMessage').textContent = 'Mengirim file ke server lokal…';
  $('latestState').textContent = 'Mengunggah file…';
  activateView('studio');
  try {
    const job = await api('/api/transcribe', { method: 'POST', body: form });
    activeJob = job.id;
    $('stopBtn').disabled = false;
    renderJob(job);
    beginPoll();
    toast('Whisper memulai pekerjaan.');
  } catch (e) {
    toast(e.message);
    $('statusMessage').textContent = e.message;
    $('startBtn').disabled = false;
  }
};

$('stopBtn').onclick = async () => {
  if (!activeJob) return;
  try {
    await api('/api/jobs/' + activeJob + '/cancel', { method: 'POST' });
    toast('Permintaan penghentian dikirim.');
  } catch (e) {
    toast(e.message);
  }
};

function beginPoll() { clearInterval(polling); polling = setInterval(poll, 1400); poll(); }
async function poll() {
  if (!activeJob) return;
  try {
    const job = await api('/api/jobs/' + activeJob);
    renderJob(job);
    if (['done','error','cancelled'].includes(job.status)) {
      clearInterval(polling); polling = null;
      $('stopBtn').disabled = true;
      $('startBtn').disabled = !selectedFile;
      refreshHistory();
      if (job.status === 'done') toast('Transkripsi selesai!');
    }
  } catch (e) { console.error(e); }
}

function renderJob(job) {
  $('statusLabel').textContent = ({queued:'MENUNGGU',running:'SEDANG DIPROSES',done:'SELESAI',error:'GAGAL',cancelled:'DIBATALKAN'})[job.status] || job.status.toUpperCase();
  $('statusMessage').textContent = job.message;
  $('statusTime').textContent = job.model + ' · ' + job.device.toUpperCase();
  $('latestFile').textContent = job.filename || 'Tanpa nama';
  $('latestState').textContent = job.message || job.status;
  $('progressFill').className = job.status === 'running' ? 'running' : '';
  $('progressFill').style.width = job.status === 'done' ? '100%' : job.status === 'running' ? '40%' : job.status === 'error' ? '100%' : '0%';
  $('jobLog').textContent = (job.logs || []).join('\n') || 'Proses sedang dimulai…';
  const done = job.status === 'done';
  document.querySelectorAll('[data-export],#copyBtn').forEach(button => button.disabled = !done);
  if (done) {
    $('wordCount').textContent = (job.text || '').trim().split(/\s+/).filter(Boolean).length;
    $('segmentCount').textContent = (job.segments || []).length;
    $('detectedLanguage').textContent = (job.detected_language || job.language || '?').toUpperCase();
    renderTranscript(job);
  } else if (job.status === 'error') {
    $('transcript').textContent = 'Proses gagal. Buka log diagnostik untuk detail.';
  }
}

function renderTranscript(job) {
  const target = $('transcript');
  target.replaceChildren();
  if (currentResult === 'segments' && job.segments?.length) {
    job.segments.forEach(s => {
      const div = document.createElement('div'); div.className = 'seg';
      const label = document.createElement('span'); label.className = 'time';
      label.textContent = formatTime(s.start) + ' → ' + formatTime(s.end);
      div.append(label, document.createTextNode(s.text));
      target.append(div);
    });
  } else {
    target.textContent = job.text || 'Tidak ada transkrip yang dihasilkan.';
  }
}

function formatTime(seconds) {
  const s = Math.floor(seconds || 0);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':');
}

document.querySelectorAll('.result-tab').forEach(b => b.onclick = async () => {
  currentResult = b.dataset.result;
  document.querySelectorAll('.result-tab').forEach(x => x.classList.toggle('active', x === b));
  if (activeJob) {
    try { renderTranscript(await api('/api/jobs/' + activeJob)); } catch {}
  }
});

$('copyBtn').onclick = async () => {
  try {
    const job = await api('/api/jobs/' + activeJob);
    await navigator.clipboard.writeText(job.text || '');
    toast('Transkrip disalin.');
  } catch (e) {
    toast('Salin tidak berhasil: ' + e.message);
  }
};

document.querySelectorAll('[data-export]').forEach(button => button.onclick = () => { if (activeJob) window.location.href = '/api/jobs/' + activeJob + '/download/' + button.dataset.export; });

async function refreshHistory() {
  try {
    const { jobs } = await api('/api/jobs');
    const target = $('history');
    target.replaceChildren();
    $('totalJobs').textContent = jobs.length;
    $('doneJobs').textContent = jobs.filter(j => j.status === 'done').length;
    if (!jobs.length) {
      target.innerHTML = '<div class="history-empty">Belum ada sesi pada server ini.</div>';
      return;
    }
    const latest = jobs[0];
    $('latestFile').textContent = latest.filename || 'Tanpa nama';
    $('latestState').textContent = latest.message || latest.status;
    jobs.forEach(job => {
      const card = document.createElement('article'); card.className = 'history-card';
      const status = document.createElement('span'); status.className = 'history-status'; status.textContent = job.status.toUpperCase();
      const title = document.createElement('b'); title.textContent = job.filename;
      const details = document.createElement('p'); details.textContent = job.created_at.replace('T', ' ') + ' · ' + job.model + ' · ' + job.device;
      const btn = document.createElement('button'); btn.textContent = 'Buka pekerjaan';
      btn.onclick = () => {
        activeJob = job.id; renderJob(job); activateView('studio');
        if (!['done','error','cancelled'].includes(job.status)) beginPoll();
      };
      card.append(status, title, details, btn); target.append(card);
    });
  } catch (e) { console.error(e); }
}

$('checkDeviceBtn').addEventListener('click', () => { system(); toast('Status perangkat diperbarui.'); });
system();
refreshHistory();


// Native <select> menus on Windows ignore dark CSS. Build a genuine, accessible
// HTML listbox instead and retain the original selects as values for Whisper.
(function initDarkSelects() {
  let expanded = null;
  for (const original of document.querySelectorAll('.select-host > select')) {
    const host = original.parentElement;
    const items = Array.from(original.options);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cs-trigger';
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', host.dataset.selectName || 'Pilih opsi');
    button.dataset.open = 'false';
    const valueEl = document.createElement('span');
    valueEl.className = 'cs-value';
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrow.setAttribute('viewBox', '0 0 24 24');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.setAttribute('fill', 'none');
    arrow.setAttribute('stroke', 'currentColor');
    arrow.setAttribute('stroke-width', '2.2');
    arrow.classList.add('cs-chevron');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm6 9 6 6 6-6');
    arrow.appendChild(path);
    button.append(valueEl, arrow);
    host.appendChild(button);

    const menu = document.createElement('div');
    menu.id = `dropdown-${original.id}`;
    menu.className = 'cs-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', host.dataset.selectName || 'Pilihan');
    menu.hidden = true;
    button.setAttribute('aria-controls', menu.id);
    document.body.appendChild(menu);

    const optionBtns = items.map((opt, index) => {
      const entry = document.createElement('button');
      entry.type = 'button';
      entry.className = 'cs-option';
      entry.setAttribute('role', 'option');
      entry.id = `${menu.id}-option-${index}`;
      entry.setAttribute('aria-selected', opt.selected ? 'true' : 'false');
      const text = document.createElement('span');
      text.textContent = opt.textContent;
      const check = document.createElement('span');
      check.className = 'cs-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = '✓';
      entry.append(text, check);
      entry.addEventListener('click', () => choose(index));
      menu.appendChild(entry);
      return entry;
    });

    function sync() {
      valueEl.textContent = original.options[original.selectedIndex]?.textContent || 'Pilih opsi';
      optionBtns.forEach((el, index) => el.setAttribute('aria-selected', String(index === original.selectedIndex)));
    }
    original.addEventListener('change', sync);
    sync();

    function place() {
      if (menu.hidden) return;
      const rect = button.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 14;
      const above = rect.top - 14;
      const contentHeight = menu.scrollHeight;
      const openAbove = below < Math.min(contentHeight, 240) && above > below;
      const space = Math.max(94, openAbove ? above - 8 : below - 8);
      const height = Math.min(300, contentHeight, space);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8));
      menu.style.width = `${Math.min(rect.width, window.innerWidth - 16)}px`;
      menu.style.maxHeight = `${height}px`;
      menu.style.left = `${left}px`;
      menu.style.top = `${openAbove ? Math.max(8, rect.top - height - 8) : rect.bottom + 8}px`;
    }

    function close(refocus = false) {
      if (menu.hidden) return;
      menu.hidden = true;
      button.dataset.open = 'false';
      button.setAttribute('aria-expanded', 'false');
      if (expanded?.menu === menu) expanded = null;
      if (refocus) button.focus();
    }
    function open() {
      if (expanded && expanded.menu !== menu) expanded.close();
      menu.hidden = false;
      button.dataset.open = 'true';
      button.setAttribute('aria-expanded', 'true');
      expanded = { menu, close };
      place();
      optionBtns[original.selectedIndex]?.focus({ preventScroll: true });
    }
    function choose(index) {
      original.selectedIndex = index;
      original.dispatchEvent(new Event('input', { bubbles: true }));
      original.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
      close(true);
    }

    button.addEventListener('click', () => menu.hidden ? open() : close());
    button.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        open();
        const index = e.key === 'Home' ? 0 : e.key === 'End' ? optionBtns.length - 1 :
          Math.max(0, Math.min(optionBtns.length - 1, original.selectedIndex + (e.key === 'ArrowDown' ? 1 : -1)));
        optionBtns[index]?.focus({ preventScroll: true });
      } else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    });
    menu.addEventListener('keydown', e => {
      const current = optionBtns.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        let next = current;
        if (e.key === 'ArrowDown') next = (current + 1) % optionBtns.length;
        if (e.key === 'ArrowUp') next = (current - 1 + optionBtns.length) % optionBtns.length;
        if (e.key === 'Home') next = 0;
        if (e.key === 'End') next = optionBtns.length - 1;
        optionBtns[next]?.focus({ preventScroll: true });
      } else if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'Tab') close();
    });
    document.addEventListener('pointerdown', e => {
      if (!host.contains(e.target) && !menu.contains(e.target)) close();
    });
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    document.querySelectorAll('.nav-btn').forEach(tab => tab.addEventListener('click', () => close()));
  }
})();
