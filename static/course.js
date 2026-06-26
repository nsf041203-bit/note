// ===== 课程主页逻辑 =====

const COLORS = {
    blue:'#4A90D9', green:'#4CAF82', yellow:'#E5B53A', orange:'#E08A3C',
    red:'#D9534F', purple:'#9B6FD0', gray:'#6B6B66',
};

const courseId = parseInt(location.pathname.split('/').pop(), 10);
let courseData = null;
let sessions = [];
let materials = [];
let currentMindmapMd = '';
let mmInstance = null;

async function loadCourse() {
    const res = await fetch(`/api/courses/id/${courseId}`);
    if (!res.ok) { document.getElementById('courseTitle').textContent = '课程不存在'; return; }
    const data = await res.json();
    courseData = data.course;
    sessions = data.sessions || [];
    materials = data.materials || [];

    const color = COLORS[courseData.color] || COLORS.blue;
    document.getElementById('courseBar').style.background = color;
    document.getElementById('courseTitle').textContent = courseData.name;
    document.getElementById('bcName').textContent = courseData.name;

    renderSessions();
    renderMaterials();

    // 默认加载最新（且未隐藏）会话的内容
    const firstVisible = sessions.find(s => !isHidden(s.id));
    if (firstVisible) loadSessionContent(firstVisible.id);
}

// ---- 隐藏状态管理（localStorage 持久化）----
function hiddenKey() { return `hidden_sessions_${courseId}`; }
function getHiddenSet() {
    try { return new Set(JSON.parse(localStorage.getItem(hiddenKey()) || '[]')); }
    catch { return new Set(); }
}
function isHidden(id) { return getHiddenSet().has(id); }
function toggleHidden(id, ev) {
    if (ev) ev.stopPropagation();
    const set = getHiddenSet();
    if (set.has(id)) set.delete(id); else set.add(id);
    localStorage.setItem(hiddenKey(), JSON.stringify([...set]));
    renderSessions();
}

// ---- 课程总结 / 会话列表 ----
function renderSessions() {
    const list = document.getElementById('sessionList');
    const visible = sessions.filter(s => !isHidden(s.id));

    if (sessions.length === 0) {
        list.innerHTML = `<div class="empty-mini"><div class="ico">📄</div><p>该课程还没有整理记录</p></div>`;
        document.getElementById('batchBar').classList.remove('active');
        return;
    }
    document.getElementById('batchBar').classList.add('active');

    const hiddenCount = sessions.length - visible.length;
    let html = visible.map(s => sessionRow(s, false)).join('');

    // 已隐藏的资料折叠在下方，仍可点眼睛恢复
    if (hiddenCount > 0) {
        html += `<div class="hidden-divider">已隐藏 ${hiddenCount} 项（点击 🙈 可恢复显示）</div>`;
        html += sessions.filter(s => isHidden(s.id)).map(s => sessionRow(s, true)).join('');
    }
    list.innerHTML = html;
}

function sessionRow(s, hidden) {
    return `
        <div class="session-row ${hidden ? 'hidden-row' : ''}" onclick="openEdit('${s.id}')">
            <div class="session-info" style="display:flex;align-items:center;gap:0.8rem;">
                <input type="checkbox" class="sess-cb" value="${s.id}"
                    onclick="event.stopPropagation()" onchange="updateSelCount()">
                <div>
                    <div class="title">${escapeHtml(s.title)}</div>
                    <div class="time">${fmt(s.created_at)} · ${s.materials_count || 0} 个资料</div>
                </div>
            </div>
            <div class="session-acts" onclick="event.stopPropagation()">
                <div class="icon-btn" title="${hidden ? '显示' : '隐藏'}" onclick="toggleHidden('${s.id}', event)">${hidden ? '🙈' : '👁️'}</div>
                <div class="icon-btn" title="编辑" onclick="openEdit('${s.id}')">✏️</div>
                <div class="icon-btn" title="删除" onclick="deleteSession('${s.id}')">🗑️</div>
            </div>
        </div>`;
}

// 点击资料 → 进入编辑页
function openEdit(sessionId) {
    window.location.href = `/edit/${sessionId}`;
}

async function loadSessionContent(sessionId) {
    const res = await fetch(`/api/session/${sessionId}/detail`);
    const s = await res.json();
    if (s.notes_md) {
        document.getElementById('summaryContent').innerHTML =
            `<div class="md-content">${marked.parse(s.notes_md)}</div>`;
    }
    if (s.mindmap_md) {
        currentMindmapMd = s.mindmap_md;
        document.getElementById('mindmapSection').style.display = 'block';
        renderMindmap(s.mindmap_md);
    } else {
        document.getElementById('mindmapSection').style.display = 'none';
    }
}

// ---- 删除单条 ----
async function deleteSession(id) {
    if (!confirm('确定删除这条整理记录吗？此操作无法恢复。')) return;
    await fetch(`/api/session/${id}`, { method: 'DELETE' });
    sessions = sessions.filter(s => s.id !== id);
    renderSessions();
    document.getElementById('summaryContent').innerHTML = '';
}

// ---- 批量删除 ----
function updateSelCount() {
    const n = document.querySelectorAll('.sess-cb:checked').length;
    document.getElementById('selCount').textContent = `已选 ${n} 项`;
}

document.getElementById('selectAll').addEventListener('change', (e) => {
    document.querySelectorAll('.sess-cb').forEach(cb => cb.checked = e.target.checked);
    updateSelCount();
});

async function batchDelete() {
    const ids = [...document.querySelectorAll('.sess-cb:checked')].map(cb => cb.value);
    if (ids.length === 0) { alert('请先勾选要删除的记录'); return; }
    if (!confirm(`确定删除选中的 ${ids.length} 条记录吗？此操作无法恢复。`)) return;
    await fetch('/api/sessions/batch_delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
    });
    sessions = sessions.filter(s => !ids.includes(s.id));
    renderSessions();
    document.getElementById('selectAll').checked = false;
    updateSelCount();
    document.getElementById('summaryContent').innerHTML = '';
}

// ---- 课堂资料：显示该课程下所有上传文件 ----
function renderMaterials() {
    const pane = document.getElementById('materials-pane');
    if (materials.length === 0) {
        pane.innerHTML = `<div class="empty-mini"><div class="ico">📂</div><p>暂无上传的课堂资料</p></div>`;
        return;
    }
    pane.innerHTML = `
        <div class="section-label" style="margin-bottom:1rem;">共 ${materials.length} 个资料</div>
        <div class="mat-grid">${materials.map((m, i) => `
            <div class="mat-card" onclick="previewMaterial(${i})">
                <div class="mat-icon">${matIcon(m.kind || m.name)}</div>
                <div class="mat-name">${escapeHtml(m.name || '未命名')}</div>
                <div class="mat-sub">${m.session_title ? escapeHtml(m.session_title) : ''} · ${fmtSize(m.size)}</div>
            </div>`).join('')}</div>`;
}

function previewMaterial(i) {
    const m = materials[i];
    if (!m) return;
    const modal = document.getElementById('previewModal');
    const body = document.getElementById('previewBody');
    document.getElementById('previewTitle').textContent = m.name || '预览';
    modal.classList.add('active');

    const kind = m.kind;
    const rawUrl = m.url;                                   // 原始文件
    const previewUrl = `/api/preview/${m.session_id}/${encodeURIComponent(m.name)}`;

    if (kind === 'image') {
        body.innerHTML = `<img src="${rawUrl}" alt="${escapeHtml(m.name)}">`;
    } else if (kind === 'audio') {
        body.innerHTML = `<audio controls src="${rawUrl}"></audio>`;
    } else if (kind === 'pdf') {
        body.innerHTML = `<iframe src="${rawUrl}"></iframe>`;
    } else if (kind === 'text') {
        body.innerHTML = `<iframe src="${rawUrl}"></iframe>`;
    } else if (kind === 'ppt' || kind === 'word') {
        // 通过后端转 PDF 预览，失败则回退文字
        body.innerHTML = `<div class="preview-loading">正在转换预览，请稍候…</div>`;
        fetch(previewUrl).then(async (r) => {
            const ct = r.headers.get('content-type') || '';
            if (ct.includes('application/pdf')) {
                body.innerHTML = `<iframe src="${previewUrl}"></iframe>`;
            } else {
                const data = await r.json().catch(() => ({}));
                if (data.text) {
                    body.innerHTML = `<div class="md-text">${marked.parse(data.text)}</div>`;
                } else {
                    body.innerHTML = `<div class="preview-loading">无法预览，<a href="${rawUrl}" target="_blank">下载原文件</a></div>`;
                }
            }
        }).catch(() => {
            body.innerHTML = `<div class="preview-loading">预览失败，<a href="${rawUrl}" target="_blank">下载原文件</a></div>`;
        });
    } else {
        body.innerHTML = `<div class="preview-loading">该格式无法在线预览，<a href="${rawUrl}" target="_blank">下载原文件</a></div>`;
    }
}

function closePreview(ev) {
    if (ev && ev.target.id !== 'previewModal' && ev.type === 'click' && ev.currentTarget.id !== 'previewModal') {
        // 仅在点击遮罩或关闭按钮时关闭
    }
    document.getElementById('previewModal').classList.remove('active');
    document.getElementById('previewBody').innerHTML = '';
}

function fmtSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// ---- 工具函数 ----
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
function fmt(ts) { if (!ts) return '—'; const d = new Date(ts.replace(' ','T')); return isNaN(d) ? ts : d.toLocaleString('zh-CN'); }
function matIcon(t) {
    const s = (t || '').toLowerCase();
    if (/audio|mp3|wav|m4a|ogg|flac/.test(s)) return '🎤';
    if (/pdf/.test(s)) return '📕';
    if (/ppt/.test(s)) return '📊';
    if (/word|doc/.test(s)) return '📄';
    if (/image|jpg|jpeg|png|webp|bmp|gif/.test(s)) return '🖼️';
    if (/text|txt|md|srt/.test(s)) return '📝';
    return '📄';
}

// ---- Tab 切换 ----
document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab + '-pane').classList.add('active');
        // 切回课程总结时若有思维导图则重新适配
        if (tab.dataset.tab === 'summary' && currentMindmapMd && mmInstance) {
            setTimeout(() => mmInstance.fit(), 100);
        }
    };
});

loadCourse();

// ===== 思维导图渲染与导出 =====
function renderMindmap(md) {
    if (!window.markmap || !md) return;
    try {
        const { Markmap, Transformer } = window.markmap;
        const transformer = new Transformer();
        const { root } = transformer.transform(md);
        const svg = document.getElementById('mindmap-svg');
        svg.innerHTML = '';
        mmInstance = Markmap.create('#mindmap-svg', null, root);
        setTimeout(() => { if (mmInstance) mmInstance.fit(); }, 100);
    } catch (e) { console.error('思维导图渲染失败:', e); }
}

// 将 SVG 转为 canvas，再导出为图片或 PDF
function exportMindmap(format) {
    const svg = document.getElementById('mindmap-svg');
    if (!svg || !currentMindmapMd) { alert('暂无思维导图可导出'); return; }

    const clone = svg.cloneNode(true);
    const bbox = svg.getBoundingClientRect();
    const w = Math.max(bbox.width, 800);
    const h = Math.max(bbox.height, 600);
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', w); rect.setAttribute('height', h);
    rect.setAttribute('fill', format === 'png' ? 'transparent' : '#FFFFFF');
    clone.insertBefore(rect, clone.firstChild);

    const xml = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
        const scale = 2; // 高清
        const canvas = document.createElement('canvas');
        canvas.width = w * scale; canvas.height = h * scale;
        const ctx = canvas.getContext('2d');
        if (format !== 'png') { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);

        const name = (courseData && courseData.name) || '思维导图';
        if (format === 'pdf') {
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF({ orientation: w > h ? 'l' : 'p', unit: 'px', format: [w, h] });
            pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, w, h);
            pdf.save(`${name}-思维导图.pdf`);
        } else {
            const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
            const a = document.createElement('a');
            a.download = `${name}-思维导图.${format}`;
            a.href = canvas.toDataURL(mime, 0.95);
            a.click();
        }
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert('导出失败，请重试'); };
    img.src = url;
}
