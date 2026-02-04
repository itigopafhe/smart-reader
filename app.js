/* --- サンプルデータの定義 --- */
const SAMPLE_DATA = [
    {
        id: 1001,
        type: 'folder',
        name: "📚 チュートリアル",
        parentId: null
    },
    {
        id: 1002,
        type: 'article',
        name: "Smart Readerの使い方",
        parentId: 1001, // 「チュートリアル」フォルダの中に入れる
        content: "Smart Readerへようこそ！\n\nこのアプリは、英文を読みながら気になった単語やフレーズを素早く保存できるツールです。\n\n右下の「📋」ボタンでサイドパネルを開き、単語やノートを確認できます。また、「＋」ボタンで新しい単語を追加できます。\n\nサンプル単語の「Collaborator」がこの文章の中にあります。クリックしてみてください。",
        url: "https://example.com",
        words: [
            { id: 2001, word: "Collaborator", meaning: "協力者、共同制作者", memo: "発音注意：kəlǽbəreitər", memorized: false }
        ],
        notes: [
            { id: 3001, originalText: "Welcome to Smart Reader!", translation: "Smart Readerへようこそ！", extra: "基本の挨拶フレーズです。" }
        ],
        bookmarks: []
    }
];


const db = localforage.createInstance({ name: "ProjectA_DB_v3" });

let libraryItems = [], currentFolderId = null, currentArticle = null;
let currentTab = 'words', isAnkiMode = false, selectedText = "", editingId = null;
let readerSettings = { fontSize: 18, lineHeight: 1.8 };
let movingItemId = null;
let currentModalType = 'word';

// --- 初期化関数 (1つに統合) ---
async function init() {
    // DBからデータを取得
    libraryItems = await db.getItem('library_items') || [];

    // データが空ならサンプルを投入
    if (libraryItems.length === 0) {
        libraryItems = SAMPLE_DATA; // SAMPLE_DATAが定義されている前提
        await db.setItem('library_items', libraryItems);
    }

    const savedSet = await db.getItem('reader_settings');
    if (savedSet) { 
        readerSettings = savedSet; 
        applySettings(); 
    }
    
    showLibrary(); 
    renderList('words');
    setupEventListeners(); // リスナー設定を呼び出す
}

// --- イベントリスナー設定 ---
function setupEventListeners() {
    const bookmarkBtn = document.getElementById('bookmark-btn');
    if (bookmarkBtn) {
        // HTML側にも onclick="addBookmark()" がある場合は、二重登録にならないよう注意
        bookmarkBtn.onclick = addBookmark; 
    }
    
    // +ボタン (単語・ノート追加)
    const addBtn = document.getElementById('add-btn');
    if (addBtn) {
        addBtn.onclick = openUnifiedModal; 
    }
    
    const textDisplay = document.getElementById('text-display');
    if (textDisplay) {
        textDisplay.onscroll = updateProgress;
    }
}

// --- 新規追加: 暗記モードの切り替え ---
function toggleAnkiMode() {
    const check = document.getElementById('anki-mode-check');
    isAnkiMode = check ? check.checked : false;
    
    // 画面を更新してマスクを適用
    renderList(currentTab, document.getElementById('list-search').value);
}

// 選択テキスト保持
document.addEventListener('selectionchange', () => {
    const sel = window.getSelection().toString().trim();
    if (sel) selectedText = sel;
});

// --- ファイル読み込み関連 ---
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const titleInput = document.getElementById('text-title');
    const bodyInput = document.getElementById('text-input');
    const label = document.getElementById('file-label-text');

    label.innerText = "⏳ 読み込み中...";
    if (!titleInput.value) titleInput.value = file.name.replace(/\.[^/.]+$/, "");

    try {
        let text = file.type === "application/pdf" ? await readPDF(file) : await readText(file);
        bodyInput.value = text;
        label.innerText = "✅ 読み込み完了！";
    } catch (e) {
        console.error(e);
        alert("読み込み失敗");
        label.innerText = "📄 PDF / TXT ファイルを読み込む";
    }
}

function readText(file) { 
    return new Promise((r, j) => { 
        const rd = new FileReader(); 
        rd.onload = e => r(e.target.result); 
        rd.onerror = j; 
        rd.readAsText(file); 
    }); 
}

async function readPDF(file) {
    const ab = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
    let full = "";

    for (let i = 1; i <= pdf.numPages; i++) {
        const p = await pdf.getPage(i);
        const tc = await p.getTextContent();
        
        let lastY = -1;
        let pageText = "";

        tc.items.forEach(item => {
            // item.transform[5] はテキストの垂直位置（Y座標）
            const currentY = item.transform[5];

            // 前のテキストと高さが変わったら改行とみなす
            // 閾値（5など）を設けることで微細なズレでの改行を防ぐ
            if (lastY !== -1 && Math.abs(lastY - currentY) > 5) {
                pageText += "\n";
            } else if (lastY !== -1) {
                // 同じ行内であれば、単語間のスペースを補完（PDFの構造による）
                pageText += " "; 
            }

            pageText += item.str;
            lastY = currentY;
        });

        full += pageText + "\n\n"; // ページ区切りに空行を入れる
    }
    return full;
}


// --- 本棚・ライブラリ管理 (参考サイトのカードデザイン再現) ---
function showLibrary() {
    hideAllSections();
    editingId = null; // 本棚に戻る際は編集IDをリセット
    document.getElementById('library-section').style.display = 'block';
    const list = document.getElementById('library-list');
    const bc = document.getElementById('breadcrumbs');
    list.innerHTML = '';

    let path = [], tempId = currentFolderId;
    while(tempId) {
        let f = libraryItems.find(i => i.id === tempId);
        if(f) { path.unshift(f); tempId = f.parentId; } else break;
    }
    let html = `<span onclick="goToFolder(null)">🏠 本棚</span>`;
    path.forEach((f, idx) => {
        if(idx === path.length -1) html += ` > <b>${f.name}</b>`;
        else html += ` > <span onclick="goToFolder(${f.id})">${f.name}</span>`;
    });
    bc.innerHTML = html;

    libraryItems.filter(i => i.parentId === currentFolderId).forEach(item => {
        const card = document.createElement('div');
        card.className = `item-card ${item.type === 'folder' ? 'folder-icon' : 'article-icon'}`;
        card.onclick = () => item.type === 'folder' ? goToFolder(item.id) : openArticle(item.id);
        card.innerHTML = `
            <h3>${item.name || "無題"}</h3>
            <div class="card-actions">
                <button class="small-btn move" onclick="event.stopPropagation(); openMoveModal(${item.id})">移動</button>
                <button class="small-btn del" onclick="event.stopPropagation(); deleteLibraryItem(${item.id})">削除</button>
            </div>
        `;
        list.appendChild(card);
    });
}

function goToFolder(id) { currentFolderId = id; showLibrary(); }

// --- 記事の作成・編集保存 (★重要: 反応しなかった部分を修復) ---
function showInputArea() {
    hideAllSections();
    editingId = null;
    document.getElementById('input-title-label').innerText = "記事を登録";
    document.getElementById('text-title').value = ""; 
    document.getElementById('text-url').value = ""; 
    document.getElementById('text-input').value = "";
    document.getElementById('input-area').style.display = 'block';
    document.getElementById('file-input').value = ""; 
}

function editCurrentArticle() { 
    if(!currentArticle) return; 
    editingId = currentArticle.id; 
    hideAllSections(); 
    document.getElementById('input-title-label').innerText = "記事を編集";
    document.getElementById('text-title').value = currentArticle.name; 
    document.getElementById('text-url').value = currentArticle.url || ""; 
    document.getElementById('text-input').value = currentArticle.content; 
    document.getElementById('input-area').style.display = 'block'; 
}

async function saveNewArticle() {
    const name = document.getElementById('text-title').value || "無題";
    const content = document.getElementById('text-input').value;
    const url = document.getElementById('text-url').value;
    if (!content) return alert("本文を入力してください");

    if (editingId) {
        const art = libraryItems.find(i => i.id === editingId);
        if (art) {
            art.name = name; art.content = content; art.url = url;
        }
    } else {
        const newArt = { 
            id: Date.now(), type: 'article', name, parentId: currentFolderId, content, url, 
            words: [], notes: [], bookmarks: [] 
        };
        libraryItems.push(newArt);
        editingId = newArt.id;
    }
    await saveToDB(); 
    openArticle(editingId);
}

// --- 検索システム (スニペット表示) ---
// --- 検索システム (スニペット表示・ジャンプ機能付き) ---
function performGlobalSearch() { 
    const q = document.getElementById('global-search-input').value.toLowerCase(); 
    const l = document.getElementById('library-list'); 
    l.innerHTML = ''; 
    if (!q) { showLibrary(); return; }

    const results = libraryItems.filter(item => {
        if (item.type === 'folder') return item.name.toLowerCase().includes(q);
        const hitTitle = item.name.toLowerCase().includes(q);
        const hitContent = item.content && item.content.toLowerCase().includes(q);
        const hitWords = item.words?.some(w => (w.word + w.meaning + (w.memo||"")).toLowerCase().includes(q));
        const hitNotes = item.notes?.some(n => (n.originalText + n.translation + (n.extra||"")).toLowerCase().includes(q));
        return hitTitle || hitContent || hitWords || hitNotes;
    });

    results.forEach(item => { 
        const card = document.createElement('div'); 
        card.className = `item-card ${item.type === 'folder' ? 'folder-icon' : 'article-icon'}`; 
        // カード自体のクリックは通常通り記事を開く
        card.onclick = () => item.type === 'folder' ? goToFolder(item.id) : openArticle(item.id); 
        
        let snippetHtml = "";
        const highlight = (t) => t.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<span class="search-highlight">$1</span>');

        if(item.type === 'article') {
            // 1. タイトルヒット
            if(item.name.toLowerCase().includes(q)) {
                snippetHtml += `
                    <div class="match-row" onclick="event.stopPropagation(); openArticle(${item.id})">
                        <span class="match-tag title-tag">タイトル</span>
                        <div class="match-text">${highlight(item.name)}</div>
                    </div>`;
            }
            // 2. 本文ヒット
            if(item.content && item.content.toLowerCase().includes(q)) {
                const idx = item.content.toLowerCase().indexOf(q);
                const start = Math.max(0, idx - 15);
                snippetHtml += `
                    <div class="match-row" onclick="event.stopPropagation(); openArticle(${item.id})">
                        <span class="match-tag content-tag">本文</span>
                        <div class="match-text">${highlight(item.content.substring(start, idx + q.length + 20))}...</div>
                    </div>`;
            }
            // 3. 単語ヒット
            item.words?.forEach(w => {
                if ((w.word + w.meaning + (w.memo||"")).toLowerCase().includes(q)) {
                    snippetHtml += `
                        <div class="match-row" onclick="event.stopPropagation(); openArticleAndJump(${item.id}, ${w.id}, 'word')">
                            <span class="match-tag word-tag">単語</span>
                            <div class="match-text">${highlight(w.word)}: ${w.meaning}</div>
                        </div>`;
                }
            });
            // 4. ノートヒット
            item.notes?.forEach(n => {
                if ((n.originalText + n.translation + (n.extra||"")).toLowerCase().includes(q)) {
                    snippetHtml += `
                        <div class="match-row" onclick="event.stopPropagation(); openArticleAndJump(${item.id}, ${n.id}, 'note')">
                            <span class="match-tag note-tag">ノート</span>
                            <div class="match-text">${highlight(n.originalText)}</div>
                        </div>`;
                }
            });
        }
        
        card.innerHTML = `
            <h3>${item.name || "無題"}</h3>
            <div class="search-snippets">${snippetHtml}</div>
            <div class="card-actions">
                <button class="small-btn move" onclick="event.stopPropagation(); openMoveModal(${item.id})">移動</button>
                <button class="small-btn del" onclick="event.stopPropagation(); deleteLibraryItem(${item.id})">削除</button>
            </div>`; 
        l.appendChild(card); 
    }); 
}

// 検索結果から直接ジャンプするための補助関数
function openArticleAndJump(articleId, itemId, type) {
    openArticle(articleId);
    // サイドパネルが開くのを少し待ってからジャンプ
    setTimeout(() => {
        jumpToResult(itemId, type);
    }, 100);
}

// --- リーダー機能 ---
function openArticle(id) {
    currentArticle = libraryItems.find(i => i.id === id);
    if (!currentArticle) return;
    hideAllSections();
    document.getElementById('reader-wrapper').style.display = 'flex';
    document.getElementById('back-to-library').style.display = 'inline-block';
    document.getElementById('article-meta').style.display = 'flex';
    document.getElementById('display-url').href = currentArticle.url || '#';
    document.getElementById('display-url').style.display = currentArticle.url ? 'inline' : 'none';

    renderArticleText();
    renderList('words');
    renderBookmarks();
}

function renderArticleText() {
    if(!currentArticle) return;
    const display = document.getElementById('text-display');
    let html = currentArticle.content.split('\n').filter(p => p.trim()).map(p => `<p>${p}</p>`).join('');
    
    // ハイライト置換 (ノート > 単語 の順で処理)
    const sn = [...currentArticle.notes].sort((a,b) => b.originalText.length - a.originalText.length);
    sn.forEach(n => {
        if (!n.originalText || n.originalText.length < 2) return;
        const escaped = n.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        html = html.replace(new RegExp(`(${escaped})`, 'gi'), `<span class="note-highlight" data-jump-id="${n.id}" data-type="note">$1</span>`);
    });

    const sw = [...currentArticle.words].sort((a,b) => b.word.length - a.word.length);
    sw.forEach(w => {
        if (!w.word || w.word.length < 2) return;
        const escaped = w.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        html = html.replace(new RegExp(`(?<!>)${escaped}(?!<)`, 'gi'), `<span class="word-highlight" data-jump-id="${w.id}" data-type="word">$&</span>`);
    });

    display.innerHTML = html;
    
    // しおり復元
    const bks = currentArticle.bookmarks || [];
    if(bks.length > 0) {
        setTimeout(() => jumpToBookmark(bks[bks.length-1].pIndex), 100);
    }
    updateProgress();
}

function handleReaderClick(e) {
    const target = e.target;
    if (target.dataset.jumpId) {
        jumpToResult(parseInt(target.dataset.jumpId), target.dataset.type);
    }
}

function jumpToResult(id, type) {
    const tab = type === 'word' ? 'words' : 'notes';
    switchTab(tab);
    document.getElementById('side-panel').classList.add('is-open');
    setTimeout(() => {
        const cardId = `${type}-card-${id}`;
        const card = document.getElementById(cardId);
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.classList.add('flash-card');
            setTimeout(() => card.classList.remove('flash-card'), 2000);
        }
    }, 300);
}

// --- しおり機能 (段落インデックス方式) ---
async function addBookmark() {
    if (!currentArticle) return;
    const d = document.getElementById('text-display');
    const ps = d.querySelectorAll('p');
    let targetIdx = 0;
    for (let i = 0; i < ps.length; i++) {
        if (ps[i].offsetTop >= d.scrollTop) { targetIdx = i; break; }
    }

    const progress = Math.round((d.scrollTop / (d.scrollHeight - d.clientHeight)) * 100) || 0;
    let name = prompt("しおりの名前", `${progress}% 付近`);
    if (name === null) return;
    if (!name.trim()) name = `${progress}% 付近`;

    if (!currentArticle.bookmarks) currentArticle.bookmarks = [];
    currentArticle.bookmarks.push({ id: Date.now(), pIndex: targetIdx, label: name });
    await saveToDB();
    renderBookmarks();
}

function renderBookmarks() {
    const container = document.getElementById('bookmark-list');
    if (!container || !currentArticle) return;
    container.innerHTML = '';
    (currentArticle.bookmarks || []).forEach(bk => {
        const item = document.createElement('div');
        item.style = "background: white; border: 1px solid #ddd; padding: 6px 12px; border-radius: 20px; font-size: 0.75em; cursor: pointer; display: flex; align-items: center; gap: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);";
        item.innerHTML = `<span onclick="jumpToBookmark(${bk.pIndex})">📍 ${bk.label}</span><span onclick="deleteBookmark(${bk.id})" style="color:#ccc; border-left:1px solid #eee; padding-left:4px;">✕</span>`;
        container.appendChild(item);
    });
}

function jumpToBookmark(pIdx) {
    const ps = document.getElementById('text-display').querySelectorAll('p');
    if (ps[pIdx]) ps[pIdx].scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteBookmark(id) {
    currentArticle.bookmarks = currentArticle.bookmarks.filter(b => b.id !== id);
    await saveToDB();
    renderBookmarks();
}

// --- 単語・ノートリスト制御 ---
function renderList(type, filter = '') {
    const container = document.getElementById('panel-content');
    if (!container || !currentArticle) return;
    container.innerHTML = '';

    if (type === 'settings') { renderSettingsUI(container); return; }

    container.classList.remove('anki-mask-both', 'anki-mask-word', 'anki-mask-meaning');
    if (type === 'words' && isAnkiMode) container.classList.add(`anki-mask-${document.getElementById('anki-target-select').value}`);

    let list = type === 'words' ? [...currentArticle.words] : [...currentArticle.notes];
    if (type === 'words' && document.getElementById('filter-unmemorized')?.checked) list = list.filter(i => !i.memorized);

    if (filter) {
        const q = filter.toLowerCase();
        list = list.filter(i => type === 'words' ? (i.word+i.meaning+(i.memo||"")).toLowerCase().includes(q) : (i.originalText+i.translation+(i.extra||"")).toLowerCase().includes(q));
    }

    list.forEach(item => {
        const card = document.createElement('div');
        const highlight = (t) => filter ? t.replace(new RegExp(`(${filter})`, 'gi'), '<span class="text-highlight">$1</span>') : t;
        if (type === 'words') {
            card.id = `word-card-${item.id}`;
            card.className = `note-card compact-card ${item.memorized ? 'memorized-item' : ''}`;
            card.onclick = () => isAnkiMode && card.classList.toggle('revealed');
            card.innerHTML = `
                <div class="word-row">
                    <div class="word-left">
                        <input type="checkbox" onchange="toggleMemorized(${item.id}, event)" onclick="event.stopPropagation()" ${item.memorized ? 'checked' : ''}>
                        <span onclick="event.stopPropagation(); speakWord('${item.word.replace(/'/g, "\\'")}')">🔊</span>
                        <span class="word-text">${highlight(item.word)}</span>
                    </div>
                    <div class="meaning-right">${highlight(item.meaning)}</div>
                </div>
                ${item.memo ? `<div class="memo-row">${highlight(item.memo)}</div>` : ''}
                <div class="action-group"><button onclick="event.stopPropagation(); editItem(${item.id}, 'word')">編</button><button onclick="event.stopPropagation(); deleteListItem(${item.id}, 'words')">消</button></div>`;
        } else {
            card.id = `note-card-${item.id}`;
            card.className = 'note-block-card';
            card.innerHTML = `
                <div class="block-english">${highlight(item.originalText)}</div>
                <hr class="note-divider"><div class="block-memo">${highlight(item.translation)}</div>
                ${item.extra ? `<div class="block-extra">💡 ${highlight(item.extra)}</div>` : ''}
                <div class="note-footer"><button onclick="editItem(${item.id}, 'note')">編</button><button onclick="deleteListItem(${item.id}, 'notes')">消</button></div>`;
        }
        container.appendChild(card);
    });
}

// --- 単語・ノート保存ロジック (モーダル内) ---
async function handleUnifiedSave(e) {
    e.preventDefault();
    if (!currentArticle) return;
    try {
        if (currentModalType === 'word') {
            const w = { id: editingId || Date.now(), word: document.getElementById('input-word-text').value, meaning: document.getElementById('input-word-meaning').value, memo: document.getElementById('input-word-memo').value, memorized: false };
            if (editingId) {
                const old = currentArticle.words.find(i => i.id === editingId);
                if (old) w.memorized = old.memorized;
                currentArticle.words = currentArticle.words.map(i => i.id === editingId ? w : i);
            } else currentArticle.words.push(w);
        } else {
            const n = { id: editingId || Date.now(), originalText: document.getElementById('input-note-eng').value, translation: document.getElementById('input-note-trans').value, extra: document.getElementById('input-note-extra').value };
            if (editingId) currentArticle.notes = currentArticle.notes.map(i => i.id === editingId ? n : i);
            else currentArticle.notes.push(n);
        }
        await saveToDB();
        closeModal();
        renderArticleText();
        renderList(currentTab, document.getElementById('list-search').value);
    } catch (err) { console.error(err); }
}

function switchModalType(type) {
    currentModalType = type;
    const isW = (type === 'word');
    document.getElementById('form-word-section').style.display = isW ? 'block' : 'none';
    document.getElementById('form-note-section').style.display = isW ? 'none' : 'block';
    document.getElementById('input-word-text').required = isW;
    document.getElementById('input-word-meaning').required = isW;
    document.getElementById('input-note-eng').required = !isW;
    const r = document.querySelector(`input[name="modal-type"][value="${type}"]`);
    if (r) r.checked = true;
}

function editItem(id, type) {
    editingId = id; switchModalType(type);
    const item = type === 'word' ? currentArticle.words.find(i => i.id === id) : currentArticle.notes.find(i => i.id === id);
    if (!item) return;
    if (type === 'word') {
        document.getElementById('input-word-text').value = item.word;
        document.getElementById('input-word-meaning').value = item.meaning;
        document.getElementById('input-word-memo').value = item.memo || '';
    } else {
        document.getElementById('input-note-eng').value = item.originalText;
        document.getElementById('input-note-trans').value = item.translation;
        document.getElementById('input-note-extra').value = item.extra || '';
    }
    document.getElementById('unified-modal-overlay').classList.add('show');
}

// --- ＋ボタンを押した時にモーダルを新規状態で開く ---
function openUnifiedModal() {
    if (!currentArticle) {
        alert("記事を開いてから追加してください");
        return;
    }
    editingId = null; // 編集ではなく新規作成モードにする
    
    // 入力欄をリセット（選択テキストがあれば自動入力）
    document.getElementById('input-word-text').value = selectedText || "";
    document.getElementById('input-word-meaning').value = "";
    document.getElementById('input-word-memo').value = "";
    document.getElementById('input-note-eng').value = selectedText || "";
    document.getElementById('input-note-trans').value = "";
    document.getElementById('input-note-extra').value = "";

    // デフォルトで「単語」タブを選択状態にする
    switchModalType('word');

    // モーダルを表示
    document.getElementById('unified-modal-overlay').classList.add('show');
}


// --- 共通ユーティリティ ---
async function saveToDB() { await db.setItem('library_items', libraryItems); }
function hideAllSections() { ['library-section', 'input-area', 'reader-wrapper', 'back-to-library', 'article-meta'].forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; }); }
function closeModal() { document.getElementById('unified-modal-overlay').classList.remove('show'); editingId = null; }
function togglePanel() { document.getElementById('side-panel').classList.toggle('is-open'); }
function updateProgress() {
    const d = document.getElementById('text-display');
    if(!d || !currentArticle) return;
    document.getElementById('char-count').innerText = `${currentArticle.content.length.toLocaleString()}文字`;
    const progress = Math.round((d.scrollTop / (d.scrollHeight - d.clientHeight)) * 100) || 0;
    document.getElementById('read-progress').innerText = `${progress}%`;
}
function handleListSearch() { renderList(currentTab, document.getElementById('list-search').value); }
async function toggleMemorized(id, e) { if(e) e.stopPropagation(); const w = currentArticle.words.find(i=>i.id===id); if(w){ w.memorized=!w.memorized; await saveToDB(); renderList('words', document.getElementById('list-search').value); } }
function speakWord(t) { if ('speechSynthesis' in window) { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'en-US'; speechSynthesis.speak(u); } }
function applySettings() { document.documentElement.style.setProperty('--reader-font-size', readerSettings.fontSize+'px'); document.documentElement.style.setProperty('--reader-line-height', readerSettings.lineHeight); }
function renderSettingsUI(c) { c.innerHTML = `<div class="settings-group"><p>文字: ${readerSettings.fontSize}px</p><input type="range" min="14" max="30" value="${readerSettings.fontSize}" oninput="updateSetting('font', this.value)"><p>行間: ${readerSettings.lineHeight}</p><input type="range" min="1.2" max="2.5" step="0.1" value="${readerSettings.lineHeight}" oninput="updateSetting('line', this.value)"></div>`; }
function updateSetting(t, v) { if (t==='font') readerSettings.fontSize=v; else readerSettings.lineHeight=v; applySettings(); db.setItem('reader_settings', readerSettings); renderList('settings'); }
function createNewFolder() { const n = prompt("フォルダ名"); if(n){ libraryItems.push({id:Date.now(), type:'folder', name:n, parentId:currentFolderId}); saveToDB(); showLibrary(); } }
async function deleteLibraryItem(id) { if(confirm("削除しますか？")){ libraryItems = libraryItems.filter(i=>i.id!==id); await saveToDB(); showLibrary(); } }
async function deleteListItem(id, type) { if(confirm("消去しますか？")){ if(type==='words') currentArticle.words=currentArticle.words.filter(i=>i.id!==id); else currentArticle.notes=currentArticle.notes.filter(i=>i.id!==id); await saveToDB(); renderList(type); renderArticleText(); } }
function switchTab(t) { currentTab=t; document.getElementById('anki-wrapper').style.display=(t==='settings'?'none':'block'); document.querySelectorAll('.tab-btn').forEach((b,i)=>b.classList.toggle('active',(i===0&&t==='words') || (i===1&&t==='notes') || (i===2&&t==='settings'))); renderList(t); }
function openMoveModal(id) { movingItemId = id; const item = libraryItems.find(i => i.id === id); if(!item) return; document.getElementById('move-target-name').innerText = item.name; const s = document.getElementById('move-select'); s.innerHTML = '<option value="">🏠 Root</option>'; libraryItems.filter(i=>i.type==='folder'&&i.id!==id).forEach(f=>{ const o=document.createElement('option'); o.value=f.id; o.innerText=f.name; s.appendChild(o); }); document.getElementById('move-modal-overlay').classList.add('show'); }
async function submitMove() { if(!movingItemId) return; const val = document.getElementById('move-select').value; const pid = val?parseInt(val):null; const item = libraryItems.find(i=>i.id===movingItemId); if(item){ item.parentId=pid; await saveToDB(); document.getElementById('move-modal-overlay').classList.remove('show'); showLibrary(); } }
function exportToCSV() { if (!currentArticle || currentArticle.words.length === 0) { alert("データなし"); return; } let csv = "Word,Meaning,Memo\n"; currentArticle.words.forEach(i => { const e=t=>t?`"${t.replace(/"/g, '""')}"`:""; csv+=`${e(i.word)},${e(i.meaning)},${e(i.memo)}\n`; }); const b = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv' }); const l = document.createElement("a"); l.href=URL.createObjectURL(b); l.download="words.csv"; l.click(); }
function searchInText() { const q = document.getElementById('reader-search-input').value; const d = document.getElementById('text-display'); const c = document.getElementById('search-count'); if(!q){ renderArticleText(); if(c)c.innerText="0件"; return; } try { let html = d.innerHTML; const r = new RegExp(`(${q})`, "gi"); const matches = html.match(r); if(c) c.innerText = (matches?matches.length:0)+"件"; d.innerHTML = html.replace(r, '<span class="search-match">$1</span>'); const f=document.querySelector('.search-match'); if(f)f.scrollIntoView({behavior:"smooth",block:"center"}); } catch(e){ console.log(e); } }

window.onload = init;
