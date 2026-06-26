// ===== 资料编辑页逻辑 =====

const sessionId = location.pathname.split('/').pop();
let sessionData = null;
let materials = [];
let currentMindmapMd = '';
let mmInstance = null;
const tdService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
let saveTimer = null;

async function init() {
    const res = await fetch(`/api/session/${sessionId}/detail`);
    if (!res.ok) { document.getElementById('editor').innerHTML = '<p>会话不存在</p>'; return; }
    sessionData = await res.json();

    document.getElementById('backToCourse').href = `/course/${sessionData.course_id}`;

    const md = sessionData.notes_md || '';
    document.getElementById('editor').innerHTML = md ? marked.parse(md)
        : '<p style="color:#A0A096;">暂无 AI 总结内容，可在此添加…</p>';

    // 思维导图
    if (sessionData.mindmap_md) {
        currentMindmapMd = sessionData.mindmap_md;
        document.getElementById('mindmapBlock').style.display = 'block';
        renderMindmap(currentMindmapMd);
    }

    await loadMaterials();
    await loadModels();
    renderChat();

    document.getElementById('editor').addEventListener('input', scheduleSave);
}

// ---- 资料预览 ----
async function loadMaterials() {
    const res = await fetch(`/api/session/${sessionId}/materials`);
    const data = await res.json();
    materials = data.materials || [];

    const tabs = document.getElementById('fileTabs');
    if (materials.length === 0) {
        tabs.innerHTML = '';
        document.getElementById('previewArea').innerHTML =
            '<div class="preview-empty"><div class="ico">📂</div><div>该次整理没有原始文件</div></div>';
        return;
    }
    tabs.innerHTML = materials.map((m, i) =>
        `<div class="file-tab ${i === 0 ? 'active' : ''}" data-i="${i}" onclick="selectFile(${i})">${matIcon(m.kind)} ${escapeHtml(m.name)}</div>`
    ).join('');
    selectFile(0);
}

function selectFile(i) {
    document.querySelectorAll('.file-tab').forEach(t => t.classList.toggle('active', +t.dataset.i === i));
    const m = materials[i];
    const area = document.getElementById('previewArea');
    const kind = m.kind;
    const rawUrl = m.url;
    const previewUrl = `/api/preview/${sessionId}/${encodeURIComponent(m.name)}`;

    if (kind === 'image') {
        area.innerHTML = `<img src="${rawUrl}" alt="${escapeHtml(m.name)}">`;
    } else if (kind === 'audio') {
        area.innerHTML = `<div class="preview-empty"><div class="ico">🎤</div><div>${escapeHtml(m.name)}</div></div>
            <audio controls src="${rawUrl}"></audio>`;
    } else if (kind === 'pdf' || kind === 'text') {
        area.innerHTML = `<iframe src="${rawUrl}"></iframe>`;
    } else if (kind === 'ppt' || kind === 'word') {
        // 通过后端转 PDF 预览
        area.innerHTML = `<div class="preview-empty"><div class="ico">⏳</div><div>正在转换预览，请稍候…</div></div>`;
        fetch(previewUrl).then(async (r) => {
            const ct = r.headers.get('content-type') || '';
            if (ct.includes('application/pdf')) {
                area.innerHTML = `<iframe src="${previewUrl}"></iframe>`;
            } else {
                const data = await r.json().catch(() => ({}));
                if (data.text) {
                    area.innerHTML = `<div class="md-text">${marked.parse(data.text)}</div>`;
                } else {
                    area.innerHTML = `<div class="preview-empty"><div class="ico">${matIcon(kind)}</div>
                        <div>${escapeHtml(m.name)}</div>
                        <div class="preview-note">无法在线预览</div>
                        <a class="back-btn" style="margin-top:1rem;display:inline-block;" href="${rawUrl}" target="_blank">下载原文件</a></div>`;
                }
            }
        }).catch(() => {
            area.innerHTML = `<div class="preview-empty"><div class="ico">${matIcon(kind)}</div>
                <div>预览失败</div>
                <a class="back-btn" style="margin-top:1rem;display:inline-block;" href="${rawUrl}" target="_blank">下载原文件</a></div>`;
        });
    } else {
        area.innerHTML = `<div class="preview-empty"><div class="ico">${matIcon(kind)}</div>
            <div>${escapeHtml(m.name)}</div>
            <div class="preview-note">该格式无法在线预览</div>
            <a class="back-btn" style="margin-top:1rem;display:inline-block;" href="${rawUrl}" target="_blank">下载原文件</a></div>`;
    }
}

// ---- 编辑器格式化 ----
function exec(cmd) { document.execCommand(cmd, false, null); scheduleSave(); }
function hl(color) {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const span = document.createElement('span');
    span.className = 'hl-' + color;
    try { span.appendChild(sel.getRangeAt(0).extractContents()); sel.getRangeAt(0).insertNode(span); scheduleSave(); }
    catch (e) { console.error(e); }
}
function addNote() {
    const text = prompt('输入批注内容：');
    if (!text) return;
    const div = document.createElement('div');
    div.className = 'inline-note';
    div.textContent = '📝 ' + text;
    const sel = window.getSelection();
    if (sel.rangeCount) { const range = sel.getRangeAt(0); range.collapse(false); range.insertNode(div); }
    else { document.getElementById('editor').appendChild(div); }
    scheduleSave();
}

// ---- 自动保存 ----
function currentMarkdown() { return tdService.turndown(document.getElementById('editor').innerHTML); }
function scheduleSave() {
    const status = document.getElementById('saveStatus');
    status.textContent = '编辑中…'; status.className = 'save-status saving';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNotes, 1200);
}
async function saveNotes() {
    const status = document.getElementById('saveStatus');
    status.textContent = '保存中…'; status.className = 'save-status saving';
    try {
        await fetch(`/api/session/${sessionId}/notes`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes_md: currentMarkdown() }),
        });
        status.textContent = '✓ 已保存'; status.className = 'save-status saved';
    } catch (e) { status.textContent = '保存失败'; status.className = 'save-status'; }
}

// ---- 导出 Word ----
async function exportWord() {
    try {
        const res = await fetch('/api/export/docx', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes_md: currentMarkdown(), subject: sessionData.title || '课程笔记' }),
        });
        if (!res.ok) throw new Error('导出失败');
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${sessionData.title || '课程笔记'}.docx`;
        a.click();
        URL.revokeObjectURL(a.href);
    } catch (e) { alert('导出 Word 失败：' + e.message); }
}

// ---- 工具 ----
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
function matIcon(kind) {
    const s = (kind || '').toLowerCase();
    if (/audio/.test(s)) return '🎤';
    if (/pdf/.test(s)) return '📕';
    if (/ppt/.test(s)) return '📊';
    if (/word/.test(s)) return '📄';
    if (/image/.test(s)) return '🖼️';
    if (/text/.test(s)) return '📝';
    return '📄';
}

init();

// ===== AI 对话（真实接入 ModelScope） =====
let chatHistory = [];   // [{role:'user'|'assistant', content}]
let availableModels = [];

async function loadModels() {
    try {
        const res = await fetch('/api/models');
        const data = await res.json();
        availableModels = data.models || [];
        const sel = document.getElementById('modelSelect');
        sel.innerHTML = availableModels.map(m =>
            `<option value="${m.id}" ${m.id === data.default ? 'selected' : ''}>${m.label}</option>`
        ).join('');
    } catch (e) {
        document.getElementById('modelSelect').innerHTML = '<option>默认模型</option>';
    }
}

function chatKey() { return `chat_session_${sessionId}`; }
function renderChat() {
    const box = document.getElementById('chatLog');
    if (chatHistory.length === 0) {
        try { chatHistory = JSON.parse(localStorage.getItem(chatKey()) || '[]'); } catch { chatHistory = []; }
    }
    if (chatHistory.length === 0) {
        box.innerHTML = `<div class="chat-msg ai">你好，我是 AI 学习助手。可以问我关于这门课程的任何问题 😊</div>`;
        return;
    }
    box.innerHTML = chatHistory.map(m =>
        `<div class="chat-msg ${m.role === 'user' ? 'user' : 'ai'}">${m.role === 'assistant' ? marked.parse(m.content) : escapeHtml(m.content)}</div>`
    ).join('');
    box.scrollTop = box.scrollHeight;
}

async function sendChat() {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('chatSend');
    const msg = input.value.trim();
    if (!msg) return;

    chatHistory.push({ role: 'user', content: msg });
    input.value = '';
    renderChat();

    // 思考中占位
    const box = document.getElementById('chatLog');
    const thinking = document.createElement('div');
    thinking.className = 'chat-msg ai thinking';
    thinking.textContent = 'AI 正在思考…';
    box.appendChild(thinking);
    box.scrollTop = box.scrollHeight;
    sendBtn.disabled = true;

    try {
        const model = document.getElementById('modelSelect').value;
        const res = await fetch('/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: chatHistory,
                model,
                notes_context: currentMarkdown(),
            }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        chatHistory.push({ role: 'assistant', content: data.reply });
    } catch (e) {
        chatHistory.push({ role: 'assistant', content: '⚠️ 出错了：' + e.message });
    } finally {
        sendBtn.disabled = false;
        localStorage.setItem(chatKey(), JSON.stringify(chatHistory));
        renderChat();
    }
}

document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

// ===== 思维导图 =====
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

function exportMindmap(format) {
    const svg = document.getElementById('mindmap-svg');
    if (!svg || !currentMindmapMd) { alert('暂无思维导图可导出'); return; }
    const clone = svg.cloneNode(true);
    const bbox = svg.getBoundingClientRect();
    const w = Math.max(bbox.width, 800), h = Math.max(bbox.height, 600);
    clone.setAttribute('width', w); clone.setAttribute('height', h);
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', w); rect.setAttribute('height', h);
    rect.setAttribute('fill', format === 'png' ? 'transparent' : '#FFFFFF');
    clone.insertBefore(rect, clone.firstChild);
    const xml = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = w * scale; canvas.height = h * scale;
        const ctx = canvas.getContext('2d');
        if (format !== 'png') { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        const name = (sessionData && sessionData.title) || '思维导图';
        if (format === 'pdf') {
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF({ orientation: w > h ? 'l' : 'p', unit: 'px', format: [w, h] });
            pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, w, h);
            pdf.save(`${name}-思维导图.pdf`);
        } else {
            const a = document.createElement('a');
            a.download = `${name}-思维导图.${format}`;
            a.href = canvas.toDataURL(format === 'jpg' ? 'image/jpeg' : 'image/png', 0.95);
            a.click();
        }
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert('导出失败，请重试'); };
    img.src = url;
}

// ===== 三栏宽度拖拽调节 =====
function setupGutter(gutterId, leftSel, rightSel) {
    const gutter = document.getElementById(gutterId);
    const layout = document.getElementById('layout');
    let dragging = false;
    gutter.addEventListener('mousedown', () => {
        dragging = true; gutter.classList.add('dragging');
        document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const left = document.querySelector(leftSel);
        const rect = layout.getBoundingClientRect();
        if (gutterId === 'gutter1') {
            // 调节左栏宽度
            let w = e.clientX - left.getBoundingClientRect().left;
            w = Math.max(220, Math.min(w, rect.width - 500));
            left.style.flex = `0 0 ${w}px`;
        } else {
            // 调节右栏宽度
            let w = rect.right - e.clientX;
            w = Math.max(260, Math.min(w, rect.width - 500));
            document.querySelector(rightSel).style.flex = `0 0 ${w}px`;
        }
    });
    document.addEventListener('mouseup', () => {
        if (dragging) { dragging = false; gutter.classList.remove('dragging'); document.body.style.cursor = ''; document.body.style.userSelect = ''; }
    });
}
setupGutter('gutter1', '#colLeft', '#colRight');
setupGutter('gutter2', '#colLeft', '#colRight');
