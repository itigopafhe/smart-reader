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
    },
    {
        id: 1003,
        type: 'article',
        name: "🍅 The Pomodoro Technique",
        parentId: 1001, // 「チュートリアル」フォルダに入ります
        content: "The Pomodoro Technique is a time management method developed by Francesco Cirillo in the late 1980s.\n\nIt uses a timer to break work into intervals, traditionally 25 minutes in length, separated by short breaks. Each interval is known as a pomodoro, from the Italian word for 'tomato', after the tomato-shaped kitchen timer that Cirillo used as a university student.\n\nThe method is simple: choose a task, set the timer for 25 minutes, and work until the timer rings. Then, take a short break (about 5 minutes). After four pomodoros, take a longer break.",
        url: "https://en.wikipedia.org/wiki/Pomodoro_Technique",
        words: [
            { id: 2002, word: "interval", meaning: "間隔、合間", memo: "発音: íntervəl", memorized: false },
            { id: 2003, word: "traditionally", meaning: "伝統的に、慣例として", memo: "traditional (形容詞) の副詞形", memorized: false },
            { id: 2004, word: "separated", meaning: "分けられた、離れた", memo: "separate (動詞/形容詞) の過去分詞形", memorized: false }
        ],
        notes: [
            { 
                id: 3002, 
                originalText: "It uses a timer to break work into intervals, traditionally 25 minutes in length, separated by short breaks.", 
                translation: "この手法ではタイマーを使い、作業を短い休憩で区切られた（通常は25分間の）「間隔」へと分割します。", 
                extra: "「separated by short breaks」は前の「intervals」を詳しく説明する過去分詞の後置修飾です。" 
            },
            { 
                id: 3003, 
                originalText: "Each interval is known as a pomodoro, from the Italian word for 'tomato'", 
                translation: "各インターバルは「ポモドーロ」として知られており、これはイタリア語で「トマト」を意味します。", 
                extra: "「be known as ～」＝「～として知られている」という重要表現が含まれています。" 
            }
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
let readingPositionSaveTimer = null;
let suppressReadingPositionSave = false;
let readingPositionRestoreToken = 0;
let readerSearchState = {
    query: '',
    wholeWord: false,
    caseSensitive: false,
    currentIndex: -1,
    matches: []
};
let globalVocabularyEditRef = null;
let globalVocabularyState = {
    entries: [],
    query: '',
    exact: false,
    status: 'all',
    sourceId: 'all',
    chapterId: 'all',
    sort: 'newest',
    ankiMode: false,
    ankiTarget: 'both',
    expandedKey: null
};

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
    flushReadingPositionSave();
    hideAllSections();
    document.getElementById('side-panel')?.classList.remove('is-open');
    document.getElementById('add-btn').style.display = '';
    document.getElementById('fab-toggle').style.display = '';
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
    flushReadingPositionSave();
    hideAllSections();
    document.getElementById('add-btn').style.display = '';
    document.getElementById('fab-toggle').style.display = '';
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
    flushReadingPositionSave();
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
    const inputQ = document.getElementById('global-search-input').value;
    const q = inputQ.toLowerCase(); 
    const l = document.getElementById('library-list'); 
    l.innerHTML = ''; 
    
    if (!q) { showLibrary(); return; }

    // ★追加: HTMLタグを無害化する関数
    const escapeHtml = (str) => {
        if(!str) return '';
        return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
    };

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
        card.onclick = () => item.type === 'folder' ? goToFolder(item.id) : openArticle(item.id); 
        
        let snippetHtml = "";
        
        // ★修正: エスケープしてからハイライトタグを付与する
        const highlight = (t) => {
            const escaped = escapeHtml(t);
            // エスケープ後の文字列に対して、検索語(q)をハイライトタグで囲む
            // ※検索語自体もエスケープが必要な文字を含まない前提の簡易実装
            return escaped.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<span class="search-highlight">$1</span>');
        };

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
                // ★修正: 切り出したテキストを highlight 関数に通す（中でエスケープされる）
                const rawText = item.content.substring(start, idx + q.length + 20);
                
                // ★修正: クリック時に openArticleAndSearch を呼び出すように変更
                // inputQ (元の検索語) を渡す
                snippetHtml += `
                    <div class="match-row" onclick="event.stopPropagation(); openArticleAndSearch(${item.id}, '${inputQ.replace(/'/g, "\\'")}')">
                        <span class="match-tag content-tag">本文</span>
                        <div class="match-text">${highlight(rawText)}...</div>
                    </div>`;
            }
            // 3. 単語ヒット
            item.words?.forEach(w => {
                if ((w.word + w.meaning + (w.memo||"")).toLowerCase().includes(q)) {
                    snippetHtml += `
                        <div class="match-row" onclick="event.stopPropagation(); openArticleAndJump(${item.id}, ${w.id}, 'word')">
                            <span class="match-tag word-tag">単語</span>
                            <div class="match-text">${highlight(w.word)}: ${highlight(w.meaning)}</div>
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

// ★追加: 本文ヒット時に記事を開いてハイライト検索を実行する関数
function openArticleAndSearch(articleId, query) {
    openArticle(articleId);
    
    // 記事が開いた直後に検索を実行
    setTimeout(() => {
        const searchInput = document.getElementById('reader-search-input');
        if(searchInput) {
            searchInput.value = query; // 検索ボックスに値を入れる
            searchInText();            // 本文内検索を実行（これで黄色くなります）
        }
    }, 100);
}

// 検索結果から単語・ノートへ直接ジャンプする関数
function openArticleAndJump(articleId, itemId, type) {
    openArticle(articleId);
    // サイドパネルが開くのを少し待ってからジャンプ
    setTimeout(() => {
        jumpToResult(itemId, type);
    }, 100);
}


// --- リーダー機能 ---
function openArticle(id) {
    const nextArticle = libraryItems.find(i => i.id === id);
    if (!nextArticle) return;

    // 記事を切り替える前に、現在の記事の自動読書位置を確定する。
    if (currentArticle && currentArticle.id !== nextArticle.id) flushReadingPositionSave();

    currentArticle = nextArticle;
    ensureArticleCollections(currentArticle);
    if (!currentArticle) return;
    hideAllSections();
    document.getElementById('add-btn').style.display = '';
    document.getElementById('fab-toggle').style.display = '';
    document.getElementById('reader-wrapper').style.display = 'flex';
    document.getElementById('back-to-library').style.display = 'inline-block';
    document.getElementById('article-meta').style.display = 'flex';
    document.getElementById('display-url').href = currentArticle.url || '#';
    document.getElementById('display-url').style.display = currentArticle.url ? 'inline' : 'none';

    resetReaderSearch();
    renderArticleText();
    renderList('words');
    renderBookmarks();
    restoreReadingPosition(currentArticle.readingPosition);
}

function renderArticleText() {
    if(!currentArticle) return;
    ensureArticleCollections(currentArticle);
    const display = document.getElementById('text-display');
    const content = typeof currentArticle.content === 'string' ? currentArticle.content : '';
    let html = content.split('\n').filter(p => p.trim()).map(p => `<p>${escapeHtml(p)}</p>`).join('');
    
    // ハイライト置換 (ノート > 単語 の順で処理)
    const sn = [...currentArticle.notes].sort((a,b) => String(b.originalText || '').length - String(a.originalText || '').length);
    sn.forEach(n => {
        if (typeof n.originalText !== 'string' || n.originalText.length < 2) return;
        const escaped = escapeRegExp(escapeHtml(n.originalText));
        html = html.replace(new RegExp(`(${escaped})`, 'gi'), `<span class="note-highlight" data-jump-id="${n.id}" data-type="note">$1</span>`);
    });

    const sw = [...currentArticle.words].sort((a,b) => String(b.word || '').length - String(a.word || '').length);
    sw.forEach(w => {
        if (typeof w.word !== 'string' || w.word.length < 2) return;
        const escaped = escapeRegExp(escapeHtml(w.word));
        html = html.replace(new RegExp(`(?<!>)${escaped}(?!<)`, 'gi'), `<span class="word-highlight" data-jump-id="${w.id}" data-type="word">$&</span>`);
    });

    display.innerHTML = html;
    updateProgress();
}

function handleReaderClick(e) {
    const target = e.target.closest ? e.target.closest('[data-jump-id]') : e.target;
    if (target && target.dataset && target.dataset.jumpId) {
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
    const position = rememberReadingPosition();
    const targetIdx = position ? position.paragraphIndex : 0;

    const progress = Math.round((d.scrollTop / (d.scrollHeight - d.clientHeight)) * 100) || 0;
    let name = prompt("しおりの名前", `${progress}% 付近`);
    if (name === null) return;
    if (!name.trim()) name = `${progress}% 付近`;

    if (!currentArticle.bookmarks) currentArticle.bookmarks = [];
    currentArticle.bookmarks.push({ id: Date.now(), pIndex: targetIdx, label: name });
    await saveToDB();
    renderBookmarks();
    restoreReadingPosition(position);
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

    applyAnkiMaskClass(container, type === 'words' && isAnkiMode, document.getElementById('anki-target-select')?.value);

    let list = type === 'words' ? [...currentArticle.words] : [...currentArticle.notes];
    if (type === 'words' && document.getElementById('hide-memorized-check')?.checked) list = list.filter(i => !i.memorized);

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
    if (globalVocabularyEditRef) {
        await saveGlobalVocabularyWordFromModal();
        return;
    }
    if (!currentArticle) return;
    const readingPosition = rememberReadingPosition();
    try {
        if (currentModalType === 'word') {
            const values = {
                word: document.getElementById('input-word-text').value,
                meaning: document.getElementById('input-word-meaning').value,
                memo: document.getElementById('input-word-memo').value
            };
            if (editingId) {
                const old = currentArticle.words.find(i => i.id === editingId);
                if (old) currentArticle.words = currentArticle.words.map(i => i.id === editingId ? Object.assign({}, i, values) : i);
            } else {
                currentArticle.words.push(Object.assign({ id: Date.now(), memorized: false, createdAt: Date.now() }, values));
            }
        } else {
            const n = { id: editingId || Date.now(), originalText: document.getElementById('input-note-eng').value, translation: document.getElementById('input-note-trans').value, extra: document.getElementById('input-note-extra').value };
            if (editingId) currentArticle.notes = currentArticle.notes.map(i => i.id === editingId ? n : i);
            else currentArticle.notes.push(n);
        }
        await saveToDB();
        closeModal();
        rerenderReaderAtPosition(readingPosition);
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
    globalVocabularyEditRef = null;
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
    globalVocabularyEditRef = null;
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
function ensureArticleCollections(article) {
    if (!article) return;
    if (!Array.isArray(article.words)) article.words = [];
    if (!Array.isArray(article.notes)) article.notes = [];
    if (!Array.isArray(article.bookmarks)) article.bookmarks = [];
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[char]));
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyAnkiMaskClass(container, active, target) {
    if (!container) return;
    container.classList.remove('anki-mask-both', 'anki-mask-word', 'anki-mask-meaning');
    if (active) container.classList.add('anki-mask-' + (target || 'both'));
}

function getReaderElementTop(element, container) {
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    return elementRect.top - containerRect.top + container.scrollTop;
}

function captureReadingPosition() {
    const display = document.getElementById('text-display');
    if (!display || !currentArticle) return null;

    const maxScroll = Math.max(0, display.scrollHeight - display.clientHeight);
    const paragraphs = Array.from(display.querySelectorAll('p'));
    let paragraphIndex = 0;

    paragraphs.forEach((paragraph, index) => {
        if (getReaderElementTop(paragraph, display) <= display.scrollTop + 1) paragraphIndex = index;
    });

    const paragraphTop = paragraphs[paragraphIndex]
        ? getReaderElementTop(paragraphs[paragraphIndex], display)
        : display.scrollTop;

    return {
        paragraphIndex,
        paragraphOffset: display.scrollTop - paragraphTop,
        scrollRatio: maxScroll > 0 ? display.scrollTop / maxScroll : 0,
        updatedAt: Date.now()
    };
}

function rememberReadingPosition() {
    const position = captureReadingPosition();
    if (position && currentArticle) currentArticle.readingPosition = position;
    return position;
}

function restoreReadingPosition(position) {
    const display = document.getElementById('text-display');
    if (!display) return;

    const articleId = currentArticle && currentArticle.id;
    const restoreToken = ++readingPositionRestoreToken;
    const apply = () => {
        if (!display || restoreToken !== readingPositionRestoreToken || (currentArticle && currentArticle.id !== articleId)) return;

        suppressReadingPositionSave = true;
        const maxScroll = Math.max(0, display.scrollHeight - display.clientHeight);
        let targetScroll = 0;

        if (position) {
            const paragraphs = Array.from(display.querySelectorAll('p'));
            const paragraph = Number.isInteger(position.paragraphIndex)
                ? paragraphs[position.paragraphIndex]
                : null;

            if (paragraph) {
                const paragraphTop = getReaderElementTop(paragraph, display);
                if (Number.isFinite(position.paragraphOffset)) {
                    targetScroll = paragraphTop + position.paragraphOffset;
                } else if (Number.isFinite(position.scrollRatio)) {
                    targetScroll = maxScroll * Math.max(0, Math.min(1, position.scrollRatio));
                } else {
                    targetScroll = paragraphTop;
                }
            } else if (Number.isFinite(position.scrollTop)) {
                targetScroll = position.scrollTop;
            } else if (Number.isFinite(position.scrollRatio)) {
                targetScroll = maxScroll * Math.max(0, Math.min(1, position.scrollRatio));
            }
        }

        display.scrollTop = Math.max(0, Math.min(maxScroll, targetScroll));
        updateProgress();
        suppressReadingPositionSave = false;
    };

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
    else setTimeout(apply, 0);
}

function rerenderReaderAtPosition(position) {
    const previousSearchIndex = readerSearchState.currentIndex;
    renderArticleText();

    if (readerSearchState.query) {
        applySearchHighlights();
        if (readerSearchState.matches.length > 0) {
            const index = Math.max(0, Math.min(
                previousSearchIndex >= 0 ? previousSearchIndex : 0,
                readerSearchState.matches.length - 1
            ));
            setActiveSearchResult(index, false);
        }
    } else {
        readerSearchState.matches = [];
        readerSearchState.currentIndex = -1;
        updateSearchCount();
    }

    restoreReadingPosition(position);
}

async function saveCurrentReadingPosition() {
    if (!currentArticle || !document.getElementById('text-display')) return;
    const position = captureReadingPosition();
    if (!position) return;
    currentArticle.readingPosition = position;
    await saveToDB();
}

function scheduleReadingPositionSave() {
    if (!currentArticle || suppressReadingPositionSave) return;
    clearTimeout(readingPositionSaveTimer);
    const articleId = currentArticle.id;
    readingPositionSaveTimer = setTimeout(() => {
        if (currentArticle && currentArticle.id === articleId) void saveCurrentReadingPosition();
    }, 500);
}

function flushReadingPositionSave() {
    clearTimeout(readingPositionSaveTimer);
    readingPositionSaveTimer = null;
    if (currentArticle) void saveCurrentReadingPosition();
}

async function saveToDB() { await db.setItem('library_items', libraryItems); }
function hideAllSections() { ['library-section', 'vocabulary-section', 'input-area', 'reader-wrapper', 'back-to-library', 'article-meta'].forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; }); }
function closeModal() { document.getElementById('unified-modal-overlay').classList.remove('show'); editingId = null; globalVocabularyEditRef = null; }
function togglePanel() { document.getElementById('side-panel').classList.toggle('is-open'); }
function countEnglishWords(text) {
    const matches = String(text ?? '').match(/[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+(?:['’][A-Za-z]+)*)*/g);
    return matches ? matches.length : 0;
}

function updateProgress(event) {
    const d = document.getElementById('text-display');
    if(!d || !currentArticle) return;
    const content = typeof currentArticle.content === 'string' ? currentArticle.content : '';
    const wordCount = document.getElementById('word-count');
    if (wordCount) wordCount.innerText = `${countEnglishWords(content).toLocaleString()} words`;
    document.getElementById('char-count').innerText = `${content.length.toLocaleString()}文字`;
    const progress = Math.round((d.scrollTop / Math.max(1, d.scrollHeight - d.clientHeight)) * 100) || 0;
    document.getElementById('read-progress').innerText = `${progress}%`;
    if (event && event.type === 'scroll') scheduleReadingPositionSave();
}
function handleListSearch() { renderList(currentTab, document.getElementById('list-search').value); }
async function toggleMemorized(id, e) {
    if (e) e.stopPropagation();
    const w = currentArticle.words.find(i => i.id === id);
    if (!w) return;
    const readingPosition = rememberReadingPosition();
    w.memorized = !w.memorized;
    await saveToDB();
    renderList('words', document.getElementById('list-search').value);
    restoreReadingPosition(readingPosition);
}
function speakWord(t) { if ('speechSynthesis' in window) { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'en-US'; speechSynthesis.speak(u); } }
function applySettings() { document.documentElement.style.setProperty('--reader-font-size', readerSettings.fontSize+'px'); document.documentElement.style.setProperty('--reader-line-height', readerSettings.lineHeight); }
function renderSettingsUI(c) { c.innerHTML = `<div class="settings-group"><p>文字: ${readerSettings.fontSize}px</p><input type="range" min="14" max="30" value="${readerSettings.fontSize}" oninput="updateSetting('font', this.value)"><p>行間: ${readerSettings.lineHeight}</p><input type="range" min="1.2" max="2.5" step="0.1" value="${readerSettings.lineHeight}" oninput="updateSetting('line', this.value)"></div>`; }
function updateSetting(t, v) { if (t==='font') readerSettings.fontSize=v; else readerSettings.lineHeight=v; applySettings(); db.setItem('reader_settings', readerSettings); renderList('settings'); }
function createNewFolder() { const n = prompt("フォルダ名"); if(n){ libraryItems.push({id:Date.now(), type:'folder', name:n, parentId:currentFolderId}); saveToDB(); showLibrary(); } }
async function deleteLibraryItem(id) { if(confirm("削除しますか？")){ libraryItems = libraryItems.filter(i=>i.id!==id); await saveToDB(); showLibrary(); } }
async function deleteListItem(id, type) {
    if (!confirm("消去しますか？")) return;
    const readingPosition = rememberReadingPosition();
    if (type === 'words') currentArticle.words = currentArticle.words.filter(i => i.id !== id);
    else currentArticle.notes = currentArticle.notes.filter(i => i.id !== id);
    await saveToDB();
    renderList(type);
    rerenderReaderAtPosition(readingPosition);
}
function switchTab(t) { currentTab=t; document.getElementById('anki-wrapper').style.display=(t==='settings'?'none':'block'); document.querySelectorAll('.tab-btn').forEach((b,i)=>b.classList.toggle('active',(i===0&&t==='words') || (i===1&&t==='notes') || (i===2&&t==='settings'))); renderList(t); }
function openMoveModal(id) { movingItemId = id; const item = libraryItems.find(i => i.id === id); if(!item) return; document.getElementById('move-target-name').innerText = item.name; const s = document.getElementById('move-select'); s.innerHTML = '<option value="">🏠 Root</option>'; libraryItems.filter(i=>i.type==='folder'&&i.id!==id).forEach(f=>{ const o=document.createElement('option'); o.value=f.id; o.innerText=f.name; s.appendChild(o); }); document.getElementById('move-modal-overlay').classList.add('show'); }
async function submitMove() { if(!movingItemId) return; const val = document.getElementById('move-select').value; const pid = val?parseInt(val):null; const item = libraryItems.find(i=>i.id===movingItemId); if(item){ item.parentId=pid; await saveToDB(); document.getElementById('move-modal-overlay').classList.remove('show'); showLibrary(); } }
function exportToCSV() { if (!currentArticle || currentArticle.words.length === 0) { alert("データなし"); return; } let csv = "Word,Meaning,Memo\n"; currentArticle.words.forEach(i => { const e=t=>t?`"${t.replace(/"/g, '""')}"`:""; csv+=`${e(i.word)},${e(i.meaning)},${e(i.memo)}\n`; }); const b = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv' }); const l = document.createElement("a"); l.href=URL.createObjectURL(b); l.download="words.csv"; l.click(); }

function resetReaderSearch() {
    readerSearchState = {
        query: '',
        wholeWord: false,
        caseSensitive: false,
        currentIndex: -1,
        matches: []
    };
    const input = document.getElementById('reader-search-input');
    const wholeWord = document.getElementById('search-whole-word');
    const caseSensitive = document.getElementById('search-case-sensitive');
    if (input) input.value = '';
    if (wholeWord) wholeWord.checked = false;
    if (caseSensitive) caseSensitive.checked = false;
    updateSearchCount();
}

function updateSearchCount() {
    const count = document.getElementById('search-count');
    const total = readerSearchState.matches.length;
    const current = total > 0 && readerSearchState.currentIndex >= 0
        ? readerSearchState.currentIndex + 1
        : 0;
    if (count) count.innerText = `${current} / ${total}`;

    const previous = document.getElementById('search-prev-btn');
    const next = document.getElementById('search-next-btn');
    if (previous) previous.disabled = total === 0;
    if (next) next.disabled = total === 0;
}

function isSearchWordCharacter(char) {
    return !!char && /[A-Za-z]/.test(char);
}

function findSearchMatches(text, query, wholeWord, caseSensitive) {
    const haystack = caseSensitive ? text : text.toLocaleLowerCase();
    const needle = caseSensitive ? query : query.toLocaleLowerCase();
    const matches = [];
    if (!needle) return matches;

    let start = 0;
    while (start < haystack.length) {
        const index = haystack.indexOf(needle, start);
        if (index === -1) break;
        const before = text[index - 1];
        const after = text[index + needle.length];
        if (!wholeWord || (!isSearchWordCharacter(before) && !isSearchWordCharacter(after))) {
            matches.push({ index, length: needle.length });
        }
        start = index + Math.max(needle.length, 1);
    }
    return matches;
}

function applySearchHighlights() {
    const display = document.getElementById('text-display');
    if (!display || !readerSearchState.query) {
        readerSearchState.matches = [];
        readerSearchState.currentIndex = -1;
        updateSearchCount();
        return;
    }

    const walker = document.createTreeWalker(display, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);

    const matches = [];
    textNodes.forEach(textNode => {
        const text = textNode.nodeValue;
        const hits = findSearchMatches(
            text,
            readerSearchState.query,
            readerSearchState.wholeWord,
            readerSearchState.caseSensitive
        );
        if (hits.length === 0) return;

        const fragment = document.createDocumentFragment();
        let cursor = 0;
        hits.forEach(hit => {
            if (hit.index > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, hit.index)));
            const span = document.createElement('span');
            span.className = 'search-match';
            span.textContent = text.slice(hit.index, hit.index + hit.length);
            fragment.appendChild(span);
            matches.push(span);
            cursor = hit.index + hit.length;
        });
        if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
        textNode.parentNode.replaceChild(fragment, textNode);
    });

    readerSearchState.matches = matches;
    if (readerSearchState.currentIndex >= matches.length) readerSearchState.currentIndex = -1;
    updateSearchCount();
}

function setActiveSearchResult(index, shouldScroll = true) {
    const matches = readerSearchState.matches;
    if (matches.length === 0) {
        readerSearchState.currentIndex = -1;
        updateSearchCount();
        return;
    }

    matches.forEach(match => match.classList.remove('current-search-match'));
    readerSearchState.currentIndex = (index + matches.length) % matches.length;
    const match = matches[readerSearchState.currentIndex];
    match.classList.add('current-search-match');
    if (shouldScroll) match.scrollIntoView({ behavior: 'smooth', block: 'center' });
    updateSearchCount();
}

function nextSearchResult() {
    if (readerSearchState.matches.length === 0) return;
    setActiveSearchResult(readerSearchState.currentIndex + 1);
}

function previousSearchResult() {
    if (readerSearchState.matches.length === 0) return;
    setActiveSearchResult(readerSearchState.currentIndex < 0
        ? readerSearchState.matches.length - 1
        : readerSearchState.currentIndex - 1);
}

function searchInText() {
    const input = document.getElementById('reader-search-input');
    const wholeWord = document.getElementById('search-whole-word');
    const caseSensitive = document.getElementById('search-case-sensitive');
    const position = captureReadingPosition();
    const query = input ? input.value.trim() : '';

    readerSearchState.query = query;
    readerSearchState.wholeWord = !!wholeWord?.checked;
    readerSearchState.caseSensitive = !!caseSensitive?.checked;
    readerSearchState.currentIndex = -1;
    readerSearchState.matches = [];

    renderArticleText();
    if (!query) {
        updateSearchCount();
        restoreReadingPosition(position);
        return;
    }

    applySearchHighlights();
    if (readerSearchState.matches.length > 0) setActiveSearchResult(0);
    else restoreReadingPosition(position);
}

window.addEventListener('pagehide', flushReadingPositionSave);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushReadingPositionSave();
});

window.onload = init;

// --- Global Vocabulary ----------------------------------------------------
// Global VocabularyはLocalForageに専用コピーを作らず、libraryItems内の
// 各article.wordsから都度作る表示用view modelだけを保持する。
function globalIdsEqual(left, right) {
    return String(left) === String(right);
}

function getGlobalArticleTitle(article) {
    return String(article?.name || article?.title || '無題');
}

function getGlobalChapterInfo(article, word) {
    if (!word || word.chapterId === undefined || word.chapterId === null || word.chapterId === '') {
        return { id: '', title: '' };
    }

    const chapterId = word.chapterId;
    const chapters = Array.isArray(article?.chapters) ? article.chapters : [];
    const chapter = chapters.find(item => globalIdsEqual(item.id, chapterId));
    return {
        id: chapterId,
        title: String(chapter?.title || chapterId)
    };
}

function collectGlobalVocabulary() {
    let sequence = 0;
    const entries = [];

    libraryItems
        .filter(item => item && item.type === 'article')
        .forEach(article => {
            ensureArticleCollections(article);
            article.words.forEach((word, wordIndex) => {
                const chapter = getGlobalChapterInfo(article, word);
                const wordKey = word?.id !== undefined && word?.id !== null
                    ? word.id
                    : wordIndex;
                entries.push({
                    key: String(article.id) + '::' + String(wordKey) + '::' + String(wordIndex),
                    articleId: article.id,
                    articleTitle: getGlobalArticleTitle(article),
                    chapterId: chapter.id,
                    chapterTitle: chapter.title,
                    wordId: word?.id,
                    wordIndex,
                    word,
                    wordText: String(word?.word || ''),
                    meaning: String(word?.meaning || ''),
                    memo: String(word?.memo || ''),
                    context: word?.context,
                    memorized: !!word?.memorized,
                    createdAt: word?.createdAt,
                    sequence: sequence++
                });
            });
        });

    return entries;
}

function findGlobalEntry(key) {
    return globalVocabularyState.entries.find(entry => entry.key === String(key)) || null;
}

function getGlobalEntrySource(entry) {
    if (!entry) return null;
    const article = libraryItems.find(item => item.type === 'article' && globalIdsEqual(item.id, entry.articleId));
    if (!article) return null;
    ensureArticleCollections(article);

    let index = Number.isInteger(entry.wordIndex) ? entry.wordIndex : -1;
    if (index < 0 || !article.words[index] || (entry.wordId !== undefined && !globalIdsEqual(article.words[index].id, entry.wordId))) {
        index = article.words.findIndex(word => entry.wordId !== undefined && globalIdsEqual(word.id, entry.wordId));
    }
    if (index < 0 || !article.words[index]) return null;
    return { article, word: article.words[index], index };
}

function getGlobalCreatedTimestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value instanceof Date) return value.getTime();
    if (value) {
        const parsed = Date.parse(String(value));
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
}

function globalVocabularyFieldMatches(value, query, exact) {
    const normalizedValue = String(value ?? '').toLocaleLowerCase();
    const normalizedQuery = String(query ?? '').toLocaleLowerCase();
    return exact ? normalizedValue === normalizedQuery : normalizedValue.includes(normalizedQuery);
}

function getFilteredGlobalVocabulary() {
    const state = globalVocabularyState;
    const query = String(state.query || '').trim();
    let entries = state.entries.filter(entry => {
        if (state.status === 'memorized' && !entry.memorized) return false;
        if (state.status === 'unmemorized' && entry.memorized) return false;
        if (state.sourceId !== 'all' && String(entry.articleId) !== String(state.sourceId)) return false;
        if (state.chapterId !== 'all' && String(entry.chapterId) !== String(state.chapterId)) return false;

        if (!query) return true;
        return [
            entry.wordText,
            entry.meaning,
            entry.memo,
            entry.articleTitle,
            entry.chapterTitle
        ].some(value => globalVocabularyFieldMatches(value, query, state.exact));
    });

    entries.sort((left, right) => {
        if (state.sort === 'az' || state.sort === 'za') {
            const direction = state.sort === 'az' ? 1 : -1;
            const wordCompare = left.wordText.localeCompare(right.wordText, undefined, { sensitivity: 'base' });
            if (wordCompare !== 0) return wordCompare * direction;
            return left.sequence - right.sequence;
        }

        const leftTime = getGlobalCreatedTimestamp(left.createdAt);
        const rightTime = getGlobalCreatedTimestamp(right.createdAt);
        if (leftTime !== rightTime) {
            return state.sort === 'oldest' ? leftTime - rightTime : rightTime - leftTime;
        }
        // createdAtを持たないlegacy word同士も安定して並べる。
        return state.sort === 'oldest'
            ? left.sequence - right.sequence
            : right.sequence - left.sequence;
    });

    return entries;
}

function renderGlobalVocabularyControls() {
    const state = globalVocabularyState;
    const sourceSelect = document.getElementById('global-vocab-source');
    const chapterSelect = document.getElementById('global-vocab-chapter');
    if (!sourceSelect || !chapterSelect) return;

    const articles = [];
    state.entries.forEach(entry => {
        if (!articles.some(article => globalIdsEqual(article.id, entry.articleId))) {
            articles.push({ id: entry.articleId, title: entry.articleTitle });
        }
    });

    sourceSelect.innerHTML = '';
    const allSources = document.createElement('option');
    allSources.value = 'all';
    allSources.textContent = 'すべての記事・書籍';
    sourceSelect.appendChild(allSources);
    articles.forEach(article => {
        const option = document.createElement('option');
        option.value = String(article.id);
        option.textContent = article.title;
        sourceSelect.appendChild(option);
    });
    if (!articles.some(article => String(article.id) === String(state.sourceId))) state.sourceId = 'all';
    sourceSelect.value = String(state.sourceId);

    const chapters = [];
    state.entries
        .filter(entry => state.sourceId === 'all' || String(entry.articleId) === String(state.sourceId))
        .forEach(entry => {
            if (!entry.chapterId) return;
            const key = String(entry.articleId) + '::' + String(entry.chapterId);
            if (!chapters.some(chapter => chapter.key === key)) {
                chapters.push({
                    key,
                    id: entry.chapterId,
                    title: entry.chapterTitle || String(entry.chapterId)
                });
            }
        });

    chapterSelect.innerHTML = '';
    const allChapters = document.createElement('option');
    allChapters.value = 'all';
    allChapters.textContent = 'すべての章';
    chapterSelect.appendChild(allChapters);
    chapters.forEach(chapter => {
        const option = document.createElement('option');
        option.value = String(chapter.id);
        option.textContent = chapter.title;
        chapterSelect.appendChild(option);
    });
    if (!chapters.some(chapter => String(chapter.id) === String(state.chapterId))) state.chapterId = 'all';
    chapterSelect.value = String(state.chapterId);
    chapterSelect.style.display = chapters.length > 0 ? '' : 'none';

    const queryInput = document.getElementById('global-vocab-search');
    const exactInput = document.getElementById('global-vocab-exact');
    const statusSelect = document.getElementById('global-vocab-status');
    const sortSelect = document.getElementById('global-vocab-sort');
    const ankiInput = document.getElementById('global-vocab-anki');
    const ankiTarget = document.getElementById('global-vocab-anki-target');
    if (queryInput) queryInput.value = state.query;
    if (exactInput) exactInput.checked = state.exact;
    if (statusSelect) statusSelect.value = state.status;
    if (sortSelect) sortSelect.value = state.sort;
    if (ankiInput) ankiInput.checked = state.ankiMode;
    if (ankiTarget) ankiTarget.value = state.ankiTarget;
}

function addGlobalVocabularyDetail(container, label, value) {
    if (value === undefined || value === null || String(value) === '') return;
    const row = document.createElement('div');
    row.className = 'global-vocabulary-detail-row';
    const labelElement = document.createElement('span');
    labelElement.className = 'global-vocabulary-detail-label';
    labelElement.textContent = label;
    const valueElement = document.createElement('span');
    valueElement.className = 'global-vocabulary-detail-value';
    valueElement.textContent = String(value);
    row.append(labelElement, valueElement);
    container.appendChild(row);
}

function formatGlobalVocabularyDate(value) {
    const timestamp = getGlobalCreatedTimestamp(value);
    return timestamp > 0 ? new Date(timestamp).toLocaleDateString('ja-JP') : '';
}

function createGlobalVocabularyCard(entry) {
    const card = document.createElement('article');
    card.className = 'note-card compact-card global-vocabulary-card' + (entry.memorized ? ' memorized-item' : '');
    card.addEventListener('click', event => {
        if (event.target.closest('button, input, select, a')) return;
        if (globalVocabularyState.ankiMode) {
            card.classList.toggle('revealed');
            return;
        }
        globalVocabularyState.expandedKey = globalVocabularyState.expandedKey === entry.key ? null : entry.key;
        renderGlobalVocabulary();
    });

    const summary = document.createElement('div');
    summary.className = 'word-row global-vocabulary-summary';
    const left = document.createElement('div');
    left.className = 'word-left';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = entry.memorized;
    check.title = '暗記済み';
    check.addEventListener('click', event => event.stopPropagation());
    check.addEventListener('change', event => toggleGlobalMemorized(entry.key, event));
    const speaker = document.createElement('span');
    speaker.textContent = '🔊';
    speaker.title = '発音';
    speaker.addEventListener('click', event => {
        event.stopPropagation();
        speakWord(entry.wordText);
    });
    const word = document.createElement('span');
    word.className = 'word-text';
    word.textContent = entry.wordText;
    left.append(check, speaker, word);
    const meaning = document.createElement('div');
    meaning.className = 'meaning-right';
    meaning.textContent = entry.meaning;
    summary.append(left, meaning);
    card.appendChild(summary);

    if (!globalVocabularyState.ankiMode && globalVocabularyState.expandedKey === entry.key) {
        const details = document.createElement('div');
        details.className = 'global-vocabulary-details';
        addGlobalVocabularyDetail(details, '出典', entry.articleTitle);
        if (entry.chapterTitle) addGlobalVocabularyDetail(details, '章', entry.chapterTitle);
        if (entry.memo) addGlobalVocabularyDetail(details, 'Memo', entry.memo);
        if (entry.context) addGlobalVocabularyDetail(details, 'Context', entry.context);
        if (entry.createdAt) addGlobalVocabularyDetail(details, '登録日', formatGlobalVocabularyDate(entry.createdAt));

        const actions = document.createElement('div');
        actions.className = 'global-vocabulary-actions';
        const editButton = document.createElement('button');
        editButton.className = 'small-btn';
        editButton.textContent = '編集';
        editButton.addEventListener('click', event => {
            event.stopPropagation();
            openGlobalVocabularyWordEditor(entry.key);
        });
        const deleteButton = document.createElement('button');
        deleteButton.className = 'small-btn del';
        deleteButton.textContent = '削除';
        deleteButton.addEventListener('click', event => {
            event.stopPropagation();
            deleteGlobalVocabularyWord(entry.key);
        });
        const openButton = document.createElement('button');
        openButton.className = 'small-btn';
        openButton.textContent = '本文で開く';
        openButton.addEventListener('click', event => {
            event.stopPropagation();
            openGlobalVocabularyEntry(entry.key);
        });
        actions.append(editButton, deleteButton, openButton);
        details.appendChild(actions);
        card.appendChild(details);
    }

    return card;
}

function renderGlobalVocabulary() {
    const container = document.getElementById('global-vocabulary-list');
    if (!container) return;

    renderGlobalVocabularyControls();
    const entries = getFilteredGlobalVocabulary();
    const total = globalVocabularyState.entries.length;
    const count = document.getElementById('global-vocab-count');
    if (count) {
        count.textContent = entries.length === total
            ? total.toLocaleString() + ' words'
            : entries.length.toLocaleString() + ' / ' + total.toLocaleString() + ' words';
    }

    applyAnkiMaskClass(container, globalVocabularyState.ankiMode, globalVocabularyState.ankiTarget);
    container.innerHTML = '';
    if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'global-vocabulary-empty';
        empty.textContent = total === 0 ? '登録された単語はありません。' : '条件に一致する単語はありません。';
        container.appendChild(empty);
        return;
    }
    entries.forEach(entry => container.appendChild(createGlobalVocabularyCard(entry)));
}

function showGlobalVocabulary() {
    flushReadingPositionSave();
    hideAllSections();
    document.getElementById('side-panel')?.classList.remove('is-open');
    document.getElementById('add-btn').style.display = 'none';
    document.getElementById('fab-toggle').style.display = 'none';
    const section = document.getElementById('vocabulary-section');
    if (!section) return;
    section.style.display = 'block';
    globalVocabularyState.entries = collectGlobalVocabulary();
    renderGlobalVocabulary();
}

function updateGlobalVocabulary(field, value) {
    if (field === 'query') globalVocabularyState.query = String(value || '');
    if (field === 'exact') globalVocabularyState.exact = !!value;
    if (field === 'status') globalVocabularyState.status = value;
    if (field === 'sourceId') {
        globalVocabularyState.sourceId = value;
        globalVocabularyState.chapterId = 'all';
    }
    if (field === 'chapterId') globalVocabularyState.chapterId = value;
    if (field === 'sort') globalVocabularyState.sort = value;
    renderGlobalVocabulary();
}

function toggleGlobalAnkiMode() {
    const checkbox = document.getElementById('global-vocab-anki');
    globalVocabularyState.ankiMode = !!checkbox?.checked;
    renderGlobalVocabulary();
}

function updateGlobalAnkiTarget(value) {
    globalVocabularyState.ankiTarget = value || 'both';
    renderGlobalVocabulary();
}

async function toggleGlobalMemorized(key, event) {
    if (event) event.stopPropagation();
    const entry = findGlobalEntry(key);
    const source = getGlobalEntrySource(entry);
    if (!source) return;
    source.word.memorized = !source.word.memorized;
    await saveToDB();
    globalVocabularyState.entries = collectGlobalVocabulary();
    renderGlobalVocabulary();
}

function openGlobalVocabularyWordEditor(key) {
    const entry = findGlobalEntry(key);
    const source = getGlobalEntrySource(entry);
    if (!entry || !source) return;
    globalVocabularyEditRef = {
        articleId: source.article.id,
        wordId: source.word.id,
        wordIndex: source.index
    };
    editingId = source.word.id;
    switchModalType('word');
    document.getElementById('input-word-text').value = source.word.word || '';
    document.getElementById('input-word-meaning').value = source.word.meaning || '';
    document.getElementById('input-word-memo').value = source.word.memo || '';
    document.getElementById('unified-modal-overlay').classList.add('show');
}

async function saveGlobalVocabularyWordFromModal() {
    const reference = globalVocabularyEditRef;
    if (!reference) return;
    const article = libraryItems.find(item => item.type === 'article' && globalIdsEqual(item.id, reference.articleId));
    if (!article) {
        closeModal();
        return;
    }
    ensureArticleCollections(article);
    let wordIndex = reference.wordIndex;
    if (wordIndex < 0 || !article.words[wordIndex] || !globalIdsEqual(article.words[wordIndex].id, reference.wordId)) {
        wordIndex = article.words.findIndex(word => globalIdsEqual(word.id, reference.wordId));
    }
    const oldWord = article.words[wordIndex];
    if (!oldWord) {
        closeModal();
        return;
    }

    article.words[wordIndex] = Object.assign({}, oldWord, {
        word: document.getElementById('input-word-text').value,
        meaning: document.getElementById('input-word-meaning').value,
        memo: document.getElementById('input-word-memo').value
    });
    await saveToDB();
    closeModal();
    globalVocabularyState.entries = collectGlobalVocabulary();
    renderGlobalVocabulary();
}

async function deleteGlobalVocabularyWord(key) {
    const entry = findGlobalEntry(key);
    const source = getGlobalEntrySource(entry);
    if (!source) return;
    if (!confirm('この単語を削除しますか？')) return;
    source.article.words.splice(source.index, 1);
    await saveToDB();
    globalVocabularyState.expandedKey = null;
    globalVocabularyState.entries = collectGlobalVocabulary();
    renderGlobalVocabulary();
}

function getGlobalWordPosition(word) {
    if (!word) return null;
    if (word.position && typeof word.position === 'object') return word.position;
    if (word.readingPosition && typeof word.readingPosition === 'object') return word.readingPosition;
    if (Number.isInteger(word.paragraphIndex)) {
        return {
            paragraphIndex: word.paragraphIndex,
            paragraphOffset: Number.isFinite(word.paragraphOffset) ? word.paragraphOffset : 0,
            scrollRatio: Number.isFinite(word.scrollRatio) ? word.scrollRatio : 0
        };
    }
    return null;
}

function openGlobalVocabularyEntry(key) {
    const entry = findGlobalEntry(key);
    const source = getGlobalEntrySource(entry);
    if (!entry || !source) return;

    // chapters/chapterIdがPhase 2統合後に存在する場合は、将来の章遷移hookを優先できる。
    if (entry.chapterId && typeof window.openArticleAtChapter === 'function') {
        window.openArticleAtChapter(entry.articleId, entry.chapterId, entry.wordId);
        return;
    }

    openArticle(entry.articleId);
    setTimeout(() => {
        const position = getGlobalWordPosition(source.word);
        if (position) restoreReadingPosition(position);

        const display = document.getElementById('text-display');
        const target = display
            ? Array.from(display.querySelectorAll('[data-jump-id]')).find(element =>
                globalIdsEqual(element.dataset.jumpId, source.word.id) &&
                element.dataset.type === 'word')
            : null;
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
}

function globalCsvValue(value) {
    const text = String(value ?? '');
    return '"' + text.replace(/"/g, '""') + '"';
}

function downloadGlobalVocabularyCsv(csv, filename) {
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportGlobalVocabularyCSV() {
    const entries = collectGlobalVocabulary();
    if (entries.length === 0) {
        alert('データなし');
        return;
    }
    const header = ['Word', 'Meaning', 'Memo', 'Article', 'Chapter', 'Memorized'];
    const rows = entries.map(entry => [
        entry.wordText,
        entry.meaning,
        entry.memo,
        entry.articleTitle,
        entry.chapterTitle,
        entry.memorized ? 'true' : 'false'
    ]);
    const csv = [header, ...rows].map(row => row.map(globalCsvValue).join(',')).join('\r\n') + '\r\n';
    downloadGlobalVocabularyCsv(csv, 'global-vocabulary.csv');
}
