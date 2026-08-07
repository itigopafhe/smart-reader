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
let currentChapterId = null;
let readerWordCounts = { articleId: null, chapterId: null, chapter: 0, book: 0 };
let pendingImportedDocument = null;
let importReviewState = null;
let importReviewActiveIndex = 0;
let importReviewTempSequence = 0;
let importReviewSearchState = {
    query: '',
    scope: 'current',
    caseSensitive: false,
    currentIndex: -1,
    matches: []
};
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

    document.addEventListener('click', event => {
        const navigation = document.getElementById('chapter-navigation');
        if (navigation && !navigation.contains(event.target)) closeChapterDropdown();
    });

    setupImportReviewControls();
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
function setFileImportStatus(message, isError = false) {
    const status = document.getElementById('file-import-message');
    if (!status) return;
    status.textContent = message || '';
    status.classList.toggle('is-error', !!isError);
}

function getImportedDocumentText(documentData) {
    if (!documentData) return '';
    if (!Array.isArray(documentData.chapters) || documentData.chapters.length === 0) {
        return typeof documentData.content === 'string' ? documentData.content : '';
    }
    return documentData.chapters
        .map(chapter => typeof chapter.content === 'string' ? chapter.content : '')
        .filter(Boolean)
        .join('\n\n');
}

function createImportReviewState(documentData) {
    const sourceName = documentData?.sourceName || 'document';
    const rawChapters = Array.isArray(documentData?.chapters) ? documentData.chapters : [];
    const chapters = rawChapters.length ? rawChapters : [{
        title: '本文',
        content: typeof documentData?.content === 'string' ? documentData.content : '',
        order: 0
    }];
    return {
        mode: 'import',
        articleId: null,
        title: String(documentData?.title || '').trim() || '無題',
        sourceType: documentData?.sourceType || 'text',
        sourceName,
        warnings: Array.isArray(documentData?.warnings) ? documentData.warnings.slice() : [],
        chapters: chapters.map((chapter, index) => ({
            ...chapter,
            id: chapter.id !== undefined && chapter.id !== null && String(chapter.id).trim()
                ? String(chapter.id)
                : 'review-temp-' + (++importReviewTempSequence),
            title: String(chapter.title || '').trim() || '本文',
            content: typeof chapter.content === 'string' ? chapter.content : '',
            order: index
        }))
    };
}

function createSavedBookEditorState(article) {
    const rawChapters = Array.isArray(article?.chapters) ? article.chapters : [];
    const chapters = rawChapters
        .filter(chapter => chapter && typeof chapter === 'object')
        .sort((a, b) => {
            const aOrder = Number.isFinite(Number(a.order)) ? Number(a.order) : 0;
            const bOrder = Number.isFinite(Number(b.order)) ? Number(b.order) : 0;
            return aOrder - bOrder;
        })
        .map((chapter, index) => ({
            ...chapter,
            id: chapter.id !== undefined && chapter.id !== null && String(chapter.id).trim()
                ? chapter.id
                : `chapter-${index + 1}`,
            title: String(chapter.title || '').trim() || `Chapter ${index + 1}`,
            content: typeof chapter.content === 'string' ? chapter.content : '',
            order: index
        }));

    return {
        mode: 'saved',
        articleId: article?.id,
        title: String(article?.name || '').trim() || '無題',
        sourceType: article?.sourceType || '',
        sourceName: article?.sourceName || '',
        warnings: [],
        readingPositionRedirects: {},
        chapters
    };
}

function isSavedBookEditor() {
    return !!(importReviewState && importReviewState.mode === 'saved');
}

function resetImportReviewSearch() {
    importReviewSearchState = {
        query: '',
        scope: 'current',
        caseSensitive: false,
        currentIndex: -1,
        matches: []
    };
    const input = document.getElementById('import-review-search-input');
    const scope = document.getElementById('import-review-search-scope');
    const caseSensitive = document.getElementById('import-review-search-case-sensitive');
    if (input) input.value = '';
    if (scope) scope.value = 'current';
    if (caseSensitive) caseSensitive.checked = false;
    updateImportReviewSearch(false);
}

function openImportReview(documentData) {
    importReviewState = createImportReviewState(documentData);
    importReviewActiveIndex = 0;
    pendingImportedDocument = documentData;
    resetImportReviewSearch();
    const titleInput = document.getElementById('text-title');
    const bodyInput = document.getElementById('text-input');
    if (titleInput) titleInput.value = importReviewState.title;
    if (bodyInput) {
        bodyInput.value = getImportedDocumentText(importReviewState);
        bodyInput.readOnly = true;
    }
    hideAllSections();
    const review = document.getElementById('import-review-area');
    if (review) review.style.display = 'flex';
    renderImportReview();
    setImportReviewStatus(
        importReviewState.chapters.length + '章を保存前に確認・修正できます。'
        + (importReviewState.warnings.length ? ' ' + importReviewState.warnings.join(' ') : '')
    );
}

function openSavedBookEditor(article) {
    if (!article || !hasStoredChapters(article)) return;
    flushReadingPositionSave();
    editingId = null;
    pendingImportedDocument = null;
    importReviewState = createSavedBookEditorState(article);
    const currentIndex = importReviewState.chapters.findIndex(chapter =>
        String(chapter.id) === String(currentChapterId)
    );
    importReviewActiveIndex = currentIndex >= 0 ? currentIndex : 0;
    resetImportReviewSearch();
    hideAllSections();
    const review = document.getElementById('import-review-area');
    if (review) review.style.display = 'flex';
    renderImportReview();
    setImportReviewStatus('保存済み書籍を編集しています。既存chapter IDと登録データは保護されます。');
}

function setImportReviewStatus(message, isError = false) {
    const status = document.getElementById('import-review-status');
    if (!status) return;
    status.textContent = message || '';
    status.classList.toggle('is-error', !!isError);
}

function finalizeImportReviewDocument() {
    if (!importReviewState) return null;
    const sourceType = importReviewState.sourceType || 'text';
    const sourceName = importReviewState.sourceName || 'document';
    const chapters = importReviewState.chapters.map((chapter, index) => {
        const title = String(chapter.title || '').trim() || '本文';
        const sourceKey = chapter.sourceKey || sourceName + '|review-' + index;
        const id = SmartReaderImporters.generateStableChapterId({
            sourceType,
            sourceKey,
            index,
            title
        });
        return {
            ...chapter,
            id,
            title,
            content: typeof chapter.content === 'string' ? chapter.content : '',
            order: index
        };
    });
    return {
        title: String(importReviewState.title || '').trim() || '無題',
        sourceType,
        sourceName,
        content: chapters.map(chapter => chapter.content).filter(Boolean).join('\n\n'),
        chapters,
        warnings: importReviewState.warnings.slice()
    };
}

function finalizeSavedBookEditorDocument() {
    if (!importReviewState || !isSavedBookEditor()) return null;
    syncImportReviewEditor();
    const chapters = importReviewState.chapters.map((chapter, index) => ({
        ...chapter,
        id: chapter.id,
        title: String(chapter.title || '').trim() || `Chapter ${index + 1}`,
        content: typeof chapter.content === 'string' ? chapter.content : '',
        order: index
    }));
    return {
        title: String(importReviewState.title || '').trim() || '無題',
        sourceType: importReviewState.sourceType,
        sourceName: importReviewState.sourceName,
        content: chapters.map(chapter => chapter.content).filter(Boolean).join('\n\n'),
        chapters
    };
}

async function saveImportReviewDocument() {
    if (!importReviewState) return;
    syncImportReviewEditor();
    const finalized = finalizeImportReviewDocument();
    if (!finalized) return;
    pendingImportedDocument = finalized;
    const titleInput = document.getElementById('text-title');
    const bodyInput = document.getElementById('text-input');
    if (titleInput) titleInput.value = finalized.title;
    if (bodyInput) bodyInput.value = finalized.content;
    importReviewState = null;
    resetImportReviewSearch();
    await saveNewArticle();
}

async function saveSavedBookEditor() {
    if (!importReviewState || !isSavedBookEditor()) return;
    const finalized = finalizeSavedBookEditorDocument();
    if (!finalized) return;
    const article = libraryItems.find(item => String(item.id) === String(importReviewState.articleId));
    if (!article) {
        setImportReviewStatus('保存対象の記事が見つかりません。', true);
        return;
    }

    applySavedReadingPositionResets(article, importReviewState.readingPositionRedirects);
    article.name = finalized.title;
    article.content = finalized.content;
    article.chapters = finalized.chapters;
    if (finalized.sourceType) article.sourceType = finalized.sourceType;
    if (finalized.sourceName) article.sourceName = finalized.sourceName;

    await saveToDB();
    importReviewState = null;
    resetImportReviewSearch();
    openArticle(article.id);
}

async function saveChapterEditor() {
    if (isSavedBookEditor()) await saveSavedBookEditor();
    else await saveImportReviewDocument();
}

async function saveReviewedImport() {
    await saveChapterEditor();
}

function cancelChapterEditor() {
    const savedArticleId = isSavedBookEditor() ? importReviewState.articleId : null;
    importReviewState = null;
    pendingImportedDocument = null;
    resetImportReviewSearch();
    if (savedArticleId !== null && savedArticleId !== undefined) openArticle(savedArticleId);
    else showInputArea();
}

function cancelImportReview() {
    cancelChapterEditor();
}

function setupImportReviewControls() {
    const input = document.getElementById('import-review-search-input');
    const scope = document.getElementById('import-review-search-scope');
    const caseSensitive = document.getElementById('import-review-search-case-sensitive');
    const previous = document.getElementById('import-review-search-prev');
    const next = document.getElementById('import-review-search-next');

    if (input) input.oninput = () => updateImportReviewSearch(true, true);
    if (scope) scope.onchange = () => updateImportReviewSearch(true, true);
    if (caseSensitive) caseSensitive.onchange = () => updateImportReviewSearch(true, true);
    if (previous) previous.onclick = () => navigateImportReviewSearch(-1);
    if (next) next.onclick = () => navigateImportReviewSearch(1);
}

function normalizeImportReviewOrders() {
    if (!importReviewState || !Array.isArray(importReviewState.chapters)) return;
    importReviewState.chapters.forEach((chapter, index) => { chapter.order = index; });
}

function getImportReviewChapter(index = importReviewActiveIndex) {
    if (!importReviewState || !Array.isArray(importReviewState.chapters)) return null;
    return importReviewState.chapters[index] || null;
}

function getSavedChapterReferenceCounts(article, chapterIds) {
    const ids = new Set((chapterIds || []).map(id => String(id)));
    const countItems = items => Array.isArray(items)
        ? items.filter(item => item && item.chapterId !== undefined && item.chapterId !== null && ids.has(String(item.chapterId))).length
        : 0;
    let readingPositions = 0;
    if (article?.readingPosition?.chapterId !== undefined && ids.has(String(article.readingPosition.chapterId))) {
        readingPositions += 1;
    }
    if (article?.readingPositions && typeof article.readingPositions === 'object') {
        readingPositions += Object.keys(article.readingPositions)
            .filter(id => ids.has(String(id))).length;
    }
    return {
        words: countItems(article?.words),
        notes: countItems(article?.notes),
        bookmarks: countItems(article?.bookmarks),
        readingPositions
    };
}

function ensureSavedChapterStructureEditAllowed(chapterIndexes, operation) {
    if (!isSavedBookEditor()) return true;
    const article = libraryItems.find(item => String(item.id) === String(importReviewState.articleId));
    const chapters = (chapterIndexes || [])
        .map(index => importReviewState.chapters[index])
        .filter(Boolean);
    if (!article || chapters.length === 0) return false;

    const counts = getSavedChapterReferenceCounts(article, chapters.map(chapter => chapter.id));
    const protectedDataCount = counts.words + counts.notes + counts.bookmarks;
    if (protectedDataCount === 0) return true;

    const message = [
        'この章には登録済みデータがあります。',
        '',
        `単語: ${counts.words}`,
        `ノート: ${counts.notes}`,
        `しおり: ${counts.bookmarks}`,
        `読書位置: ${counts.readingPositions}`,
        '',
        `データとの関連を保護するため、現在はこの章を${operation}できません。`,
        '本文や章タイトルの編集は可能です。'
    ].join('\n');
    setImportReviewStatus(message, true);
    alert(message);
    return false;
}

function queueSavedReadingPositionReset(chapterIds, replacementChapterId = null) {
    if (!isSavedBookEditor()) return false;
    const article = libraryItems.find(item => String(item.id) === String(importReviewState.articleId));
    if (!article) return false;
    const ids = new Set((chapterIds || []).map(id => String(id)));
    const redirects = importReviewState.readingPositionRedirects || {};
    let changed = false;

    if (article.readingPosition?.chapterId !== undefined && ids.has(String(article.readingPosition.chapterId))) {
        changed = true;
    }
    if (article.readingPositions && typeof article.readingPositions === 'object') {
        Object.keys(article.readingPositions).forEach(id => {
            if (ids.has(String(id))) changed = true;
        });
    }
    if (!changed) return false;

    const replacement = replacementChapterId === null || replacementChapterId === undefined
        ? null
        : String(replacementChapterId);
    ids.forEach(id => { redirects[id] = replacement; });
    importReviewState.readingPositionRedirects = redirects;
    return true;
}

function createResetReadingPosition(chapterId) {
    return {
        chapterId: String(chapterId),
        paragraphIndex: 0,
        paragraphOffset: 0,
        scrollRatio: 0,
        updatedAt: Date.now()
    };
}

function applySavedReadingPositionResets(article, redirects = {}) {
    if (!article || !redirects || typeof redirects !== 'object') return;
    const latest = article.readingPosition;
    if (latest?.chapterId !== undefined) {
        const target = redirects[String(latest.chapterId)];
        if (Object.prototype.hasOwnProperty.call(redirects, String(latest.chapterId))) {
            if (target === null || target === undefined) delete article.readingPosition;
            else article.readingPosition = createResetReadingPosition(target);
        }
    }

    if (!article.readingPositions || typeof article.readingPositions !== 'object') return;
    const replacements = new Set();
    Object.keys(article.readingPositions).forEach(id => {
        if (!Object.prototype.hasOwnProperty.call(redirects, String(id))) return;
        const target = redirects[String(id)];
        delete article.readingPositions[id];
        if (target !== null && target !== undefined) replacements.add(String(target));
    });
    replacements.forEach(id => {
        article.readingPositions[id] = createResetReadingPosition(id);
    });
}

function createChapterEditorNewId() {
    if (!isSavedBookEditor()) return 'review-temp-' + (++importReviewTempSequence);
    const articleId = importReviewState.articleId ?? 'book';
    const existing = new Set(importReviewState.chapters.map(chapter => String(chapter.id)));
    let candidate = '';
    do {
        candidate = `chapter-${articleId}-new-${Date.now()}-${++importReviewTempSequence}`;
    } while (existing.has(candidate));
    return candidate;
}

function syncImportReviewEditor() {
    const chapter = getImportReviewChapter();
    if (!chapter) return;
    const titleInput = document.getElementById('import-review-chapter-title');
    const contentInput = document.getElementById('import-review-chapter-content');
    if (titleInput) chapter.title = titleInput.value;
    if (contentInput) chapter.content = contentInput.value;
    normalizeImportReviewOrders();
}

function renderImportReviewChapterList() {
    const list = document.getElementById('import-review-chapter-list');
    if (!list || !importReviewState) return;
    list.textContent = '';

    importReviewState.chapters.forEach((chapter, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'import-review-chapter-option' +
            (index === importReviewActiveIndex ? ' is-current' : '');
        button.setAttribute('aria-current', index === importReviewActiveIndex ? 'true' : 'false');
        button.title = chapter.title || '本文';
        button.textContent = `${index + 1}. ${chapter.title || '本文'}`;
        button.onclick = () => selectImportReviewChapter(index);
        list.appendChild(button);
    });
}

function renderImportReviewEditor() {
    const chapter = getImportReviewChapter();
    if (!chapter) return;
    const label = document.getElementById('import-review-current-label');
    const titleInput = document.getElementById('import-review-chapter-title');
    const contentInput = document.getElementById('import-review-chapter-content');
    if (label) label.textContent = `Chapter ${importReviewActiveIndex + 1} / ${importReviewState.chapters.length}`;
    if (titleInput) {
        titleInput.value = chapter.title || '';
        titleInput.oninput = () => {
            chapter.title = titleInput.value;
            renderImportReviewChapterList();
        };
    }
    if (contentInput) {
        contentInput.value = chapter.content || '';
        contentInput.oninput = () => {
            chapter.content = contentInput.value;
            if (importReviewSearchState.query) updateImportReviewSearch(false, false);
        };
    }
}

function renderImportReview() {
    if (!importReviewState) return;
    normalizeImportReviewOrders();
    const heading = document.getElementById('chapter-editor-heading');
    const saveButton = document.getElementById('chapter-editor-save');
    const titleInput = document.getElementById('import-review-title');
    const source = document.getElementById('import-review-source');
    if (heading) heading.textContent = isSavedBookEditor() ? 'Book Editor' : 'Import Review';
    if (saveButton) saveButton.textContent = isSavedBookEditor() ? '変更を保存' : '保存して読む';
    if (titleInput) {
        titleInput.value = importReviewState.title || '';
        titleInput.oninput = () => { importReviewState.title = titleInput.value; };
    }
    if (source) source.textContent = isSavedBookEditor()
        ? '保存済み書籍'
        : `${importReviewState.sourceType || 'text'} · ${importReviewState.sourceName || 'document'}`;
    renderImportReviewChapterList();
    renderImportReviewEditor();
    updateImportReviewSearch(false, false);
}

function selectImportReviewChapter(index) {
    if (!importReviewState || index < 0 || index >= importReviewState.chapters.length) return;
    syncImportReviewEditor();
    importReviewActiveIndex = index;
    renderImportReviewChapterList();
    renderImportReviewEditor();
    const isCurrentScope = importReviewSearchState.scope === 'current';
    updateImportReviewSearch(isCurrentScope, false);
}

function getImportReviewSearchMatches() {
    if (!importReviewState || !importReviewSearchState.query) return [];
    const query = importReviewSearchState.caseSensitive
        ? importReviewSearchState.query
        : importReviewSearchState.query.toLocaleLowerCase();
    const chapters = importReviewSearchState.scope === 'all'
        ? importReviewState.chapters
        : [getImportReviewChapter()].filter(Boolean);
    const matches = [];

    chapters.forEach(chapter => {
        const chapterIndex = importReviewState.chapters.indexOf(chapter);
        const content = typeof chapter.content === 'string' ? chapter.content : '';
        const haystack = importReviewSearchState.caseSensitive ? content : content.toLocaleLowerCase();
        if (!query || !haystack) return;
        let from = 0;
        while (from <= haystack.length) {
            const start = haystack.indexOf(query, from);
            if (start < 0) break;
            matches.push({ chapterIndex, start, end: start + query.length });
            from = start + Math.max(query.length, 1);
        }
    });
    return matches;
}

function updateImportReviewSearch(resetIndex = true, shouldFocus = false) {
    const count = document.getElementById('import-review-search-count');
    const previous = document.getElementById('import-review-search-prev');
    const next = document.getElementById('import-review-search-next');
    if (!importReviewState) {
        importReviewSearchState.matches = [];
        importReviewSearchState.currentIndex = -1;
        if (count) count.textContent = '0 / 0';
        if (previous) previous.disabled = true;
        if (next) next.disabled = true;
        return;
    }

    const input = document.getElementById('import-review-search-input');
    const scope = document.getElementById('import-review-search-scope');
    const caseSensitive = document.getElementById('import-review-search-case-sensitive');
    if (input) importReviewSearchState.query = input.value.trim();
    if (scope) importReviewSearchState.scope = scope.value === 'all' ? 'all' : 'current';
    if (caseSensitive) importReviewSearchState.caseSensitive = !!caseSensitive.checked;

    const oldIndex = importReviewSearchState.currentIndex;
    importReviewSearchState.matches = getImportReviewSearchMatches();
    if (importReviewSearchState.matches.length === 0) {
        importReviewSearchState.currentIndex = -1;
    } else if (resetIndex || oldIndex < 0) {
        importReviewSearchState.currentIndex = 0;
    } else {
        importReviewSearchState.currentIndex = Math.min(oldIndex, importReviewSearchState.matches.length - 1);
    }

    const displayIndex = importReviewSearchState.currentIndex >= 0
        ? importReviewSearchState.currentIndex + 1
        : 0;
    if (count) count.textContent = `${displayIndex} / ${importReviewSearchState.matches.length}`;
    if (previous) previous.disabled = importReviewSearchState.matches.length === 0;
    if (next) next.disabled = importReviewSearchState.matches.length === 0;
    if (shouldFocus && importReviewSearchState.currentIndex >= 0) focusImportReviewSearchMatch();
}

function focusImportReviewSearchMatch() {
    const match = importReviewSearchState.matches[importReviewSearchState.currentIndex];
    if (!match || !importReviewState) return;

    if (match.chapterIndex !== importReviewActiveIndex) {
        syncImportReviewEditor();
        importReviewActiveIndex = match.chapterIndex;
        renderImportReviewChapterList();
        renderImportReviewEditor();
    }

    const textarea = document.getElementById('import-review-chapter-content');
    if (!textarea) return;
    const apply = () => {
        textarea.focus();
        textarea.setSelectionRange(match.start, match.end);
        const maxScroll = Math.max(0, textarea.scrollHeight - textarea.clientHeight);
        const ratio = textarea.value.length > 0 ? match.start / textarea.value.length : 0;
        textarea.scrollTop = maxScroll * ratio;
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
    else setTimeout(apply, 0);
}

function navigateImportReviewSearch(direction) {
    if (!importReviewSearchState.matches.length) return;
    const length = importReviewSearchState.matches.length;
    const current = importReviewSearchState.currentIndex < 0 ? 0 : importReviewSearchState.currentIndex;
    importReviewSearchState.currentIndex = (current + direction + length) % length;
    const count = document.getElementById('import-review-search-count');
    if (count) count.textContent = `${importReviewSearchState.currentIndex + 1} / ${length}`;
    focusImportReviewSearchMatch();
}

function addImportReviewChapter() {
    if (!importReviewState) return;
    syncImportReviewEditor();
    const index = importReviewActiveIndex + 1;
    importReviewState.chapters.splice(index, 0, {
        id: createChapterEditorNewId(),
        title: '新しい章',
        content: '',
        order: index,
        ...(isSavedBookEditor() ? {} : { sourceKey: 'review-add-' + importReviewTempSequence })
    });
    importReviewActiveIndex = index;
    normalizeImportReviewOrders();
    renderImportReview();
    setImportReviewStatus('新しいchapterを追加しました。');
    const titleInput = document.getElementById('import-review-chapter-title');
    if (titleInput) { titleInput.focus(); titleInput.select(); }
}

function deleteImportReviewChapter() {
    if (!importReviewState) return;
    if (importReviewState.chapters.length <= 1) {
        alert('最後のchapterは削除できません。');
        return;
    }
    if (!ensureSavedChapterStructureEditAllowed([importReviewActiveIndex], '削除')) return;
    if (typeof window.confirm === 'function' && !window.confirm('このchapterを削除しますか？')) return;
    syncImportReviewEditor();
    const deletedChapterId = importReviewState.chapters[importReviewActiveIndex].id;
    const replacementChapterId = importReviewState.chapters[importReviewActiveIndex - 1]?.id
        ?? importReviewState.chapters[importReviewActiveIndex + 1]?.id
        ?? null;
    const readingPositionReset = queueSavedReadingPositionReset([deletedChapterId], replacementChapterId);
    importReviewState.chapters.splice(importReviewActiveIndex, 1);
    importReviewActiveIndex = Math.min(importReviewActiveIndex, importReviewState.chapters.length - 1);
    normalizeImportReviewOrders();
    renderImportReview();
    setImportReviewStatus(readingPositionReset
        ? 'chapterを削除しました。対象chapterの読書位置を安全な位置へリセットします。'
        : 'chapterを削除しました。');
}

function moveImportReviewChapter(direction) {
    if (!importReviewState) return;
    const target = importReviewActiveIndex + direction;
    if (target < 0 || target >= importReviewState.chapters.length) return;
    syncImportReviewEditor();
    const chapters = importReviewState.chapters;
    [chapters[importReviewActiveIndex], chapters[target]] = [chapters[target], chapters[importReviewActiveIndex]];
    importReviewActiveIndex = target;
    normalizeImportReviewOrders();
    renderImportReview();
}

function combineImportReviewContent(left, right) {
    const first = String(left || '').replace(/\s+$/u, '');
    const second = String(right || '').replace(/^\s+/u, '');
    if (!first) return second;
    if (!second) return first;
    return `${first}\n\n${second}`;
}

function mergeImportReviewChapter(direction) {
    if (!importReviewState) return;
    const target = importReviewActiveIndex + direction;
    if (target < 0 || target >= importReviewState.chapters.length) return;
    if (!ensureSavedChapterStructureEditAllowed([importReviewActiveIndex, target], '結合')) return;
    syncImportReviewEditor();
    const chapters = importReviewState.chapters;
    const retainedChapterId = direction < 0 ? chapters[target].id : chapters[importReviewActiveIndex].id;
    const removedChapterId = direction < 0 ? chapters[importReviewActiveIndex].id : chapters[target].id;
    const readingPositionReset = queueSavedReadingPositionReset(
        [retainedChapterId, removedChapterId],
        retainedChapterId
    );
    if (direction < 0) {
        chapters[target].content = combineImportReviewContent(chapters[target].content, chapters[importReviewActiveIndex].content);
        importReviewState.chapters.splice(importReviewActiveIndex, 1);
        importReviewActiveIndex = target;
    } else {
        chapters[importReviewActiveIndex].content = combineImportReviewContent(chapters[importReviewActiveIndex].content, chapters[target].content);
        importReviewState.chapters.splice(target, 1);
    }
    normalizeImportReviewOrders();
    renderImportReview();
    setImportReviewStatus(readingPositionReset
        ? 'chapterを結合しました。対象chapterの読書位置をリセットします。'
        : 'chapterを結合しました。');
}

function splitImportReviewChapter() {
    const chapter = getImportReviewChapter();
    const textarea = document.getElementById('import-review-chapter-content');
    if (!chapter || !textarea) return;
    if (!ensureSavedChapterStructureEditAllowed([importReviewActiveIndex], '分割')) return;
    const originalChapterId = chapter.id;
    syncImportReviewEditor();
    const position = Number.isInteger(textarea.selectionStart) ? textarea.selectionStart : 0;
    if (position <= 0 || position >= chapter.content.length) {
        alert('本文の途中にカーソルを置いてください。');
        return;
    }
    const left = chapter.content.slice(0, position).replace(/\s+$/u, '');
    const right = chapter.content.slice(position).replace(/^\s+/u, '');
    if (!left || !right) {
        alert('空のchapterにならない位置を指定してください。');
        return;
    }
    const newIndex = importReviewActiveIndex + 1;
    const newChapter = {
        id: createChapterEditorNewId(),
        title: `Chapter ${newIndex + 1}`,
        content: right,
        order: newIndex,
        ...(isSavedBookEditor()
            ? {}
            : { sourceKey: (chapter.sourceKey || chapter.id || 'chapter') + '|split-' + importReviewTempSequence })
    };
    chapter.content = left;
    importReviewState.chapters.splice(newIndex, 0, newChapter);
    importReviewActiveIndex = newIndex;
    const readingPositionReset = queueSavedReadingPositionReset([originalChapterId], originalChapterId);
    normalizeImportReviewOrders();
    renderImportReview();
    setImportReviewStatus(readingPositionReset
        ? 'chapterを分割しました。対象chapterの読書位置は先頭へリセットします。'
        : 'chapterを分割しました。タイトルを確認してください。');
    const titleInput = document.getElementById('import-review-chapter-title');
    if (titleInput) { titleInput.focus(); titleInput.select(); }
}

function joinImportReviewWrappedLines() {
    const chapter = getImportReviewChapter();
    if (!chapter) return;
    syncImportReviewEditor();
    const paragraphs = String(chapter.content || '')
        .replace(/\r\n?/gu, '\n')
        .split(/\n\s*\n/gu)
        .map(paragraph => paragraph.split('\n').map(line => line.trim()).filter(Boolean).join(' '))
        .filter(Boolean);
    chapter.content = paragraphs.join('\n\n');
    renderImportReview();
    setImportReviewStatus('現在chapterの折り返し改行を結合しました。');
}

function normalizeImportReviewParagraphSpacing() {
    const chapter = getImportReviewChapter();
    if (!chapter) return;
    syncImportReviewEditor();
    chapter.content = String(chapter.content || '')
        .replace(/\r\n?/gu, '\n')
        .split('\n')
        .map(line => line.replace(/[ \t]+/gu, ' ').replace(/\s+$/u, ''))
        .join('\n')
        .replace(/\n{3,}/gu, '\n\n')
        .trim();
    renderImportReview();
    setImportReviewStatus('現在chapterの段落間隔を整理しました。');
}

async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const titleInput = document.getElementById('text-title');
    const bodyInput = document.getElementById('text-input');
    const label = document.getElementById('file-label-text');

    if (label) label.innerText = "⏳ 読み込み中...";
    setFileImportStatus('');

    try {
        const documentData = await SmartReaderImporters.parseImportedFile(file);
        pendingImportedDocument = documentData;
        if (!titleInput.value) titleInput.value = documentData.title || file.name.replace(/\.[^/.]+$/, "");
        bodyInput.value = getImportedDocumentText(documentData);
        bodyInput.readOnly = true;
        if (label) label.innerText = "✅ 読み込み完了！";
        openImportReview(documentData);
    } catch (e) {
        console.error(e);
        pendingImportedDocument = null;
        const message = e?.message || 'ファイルの読み込みに失敗しました。';
        alert(message);
        bodyInput.readOnly = false;
        if (label) label.innerText = "📄 EPUB / PDF / HTML / TXT ファイルを読み込む";
        setFileImportStatus(message, true);
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
    const documentData = await SmartReaderImporters.parsePdfImport(file);
    return getImportedDocumentText(documentData);
}


// --- 本棚・ライブラリ管理 (参考サイトのカードデザイン再現) ---
function showLibrary() {
    flushReadingPositionSave();
    hideAllSections();
    editingId = null; // 本棚に戻る際は編集IDをリセット
    pendingImportedDocument = null;
    importReviewState = null;
    resetImportReviewSearch();
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
    editingId = null;
    pendingImportedDocument = null;
    importReviewState = null;
    resetImportReviewSearch();
    document.getElementById('input-title-label').innerText = "記事を登録";
    document.getElementById('text-title').value = ""; 
    document.getElementById('text-url').value = ""; 
    document.getElementById('text-input').value = "";
    document.getElementById('text-input').readOnly = false;
    document.getElementById('input-area').style.display = 'block';
    document.getElementById('file-input').value = ""; 
    setFileImportStatus('');
}

function editCurrentArticle() { 
    if(!currentArticle) return; 
    if (hasStoredChapters(currentArticle)) {
        openSavedBookEditor(currentArticle);
        return;
    }
    flushReadingPositionSave();
    editingId = currentArticle.id; 
    hideAllSections(); 
    document.getElementById('input-title-label').innerText = "記事を編集";
    document.getElementById('text-title').value = currentArticle.name; 
    document.getElementById('text-url').value = currentArticle.url || ""; 
    document.getElementById('text-input').value = typeof currentArticle.content === 'string' && currentArticle.content
        ? currentArticle.content
        : getArticleFullText(currentArticle);
    document.getElementById('text-input').readOnly = false;
    document.getElementById('input-area').style.display = 'block'; 
}

async function saveNewArticle() {
    const name = document.getElementById('text-title').value || "無題";
    const content = document.getElementById('text-input').value;
    const url = document.getElementById('text-url').value;
    const imported = pendingImportedDocument;
    const importedContent = getImportedDocumentText(imported);
    if (!imported && !content) return alert("本文を入力してください");

    if (editingId) {
        const art = libraryItems.find(i => i.id === editingId);
        if (art) {
            if (hasStoredChapters(art)) {
                alert("章構造の記事は本文を平坦化して編集できません。");
                return;
            }
            art.name = name;
            art.content = imported ? importedContent : content;
            art.url = url;
            if (imported) {
                art.chapters = imported.chapters;
                art.sourceType = imported.sourceType;
                art.sourceName = imported.sourceName;
            }
        }
    } else {
        const newArt = { 
            id: Date.now(),
            type: 'article',
            name: imported?.title && name === "無題" ? imported.title : name,
            parentId: currentFolderId,
            content: imported ? importedContent : content,
            url,
            words: [], notes: [], bookmarks: [] 
        };
        if (imported) {
            newArt.chapters = imported.chapters;
            newArt.sourceType = imported.sourceType;
            newArt.sourceName = imported.sourceName;
        }
        libraryItems.push(newArt);
        editingId = newArt.id;
    }
    pendingImportedDocument = null;
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
        const searchableContent = getArticleSearchableText(item);
        const hitContent = searchableContent.toLowerCase().includes(q);
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
            const searchableContent = getArticleSearchableText(item);
            // 1. タイトルヒット
            if(item.name.toLowerCase().includes(q)) {
                snippetHtml += `
                    <div class="match-row" onclick="event.stopPropagation(); openArticle(${item.id})">
                        <span class="match-tag title-tag">タイトル</span>
                        <div class="match-text">${highlight(item.name)}</div>
                    </div>`;
            }
            // 2. 本文ヒット
            if(searchableContent && searchableContent.toLowerCase().includes(q)) {
                const idx = searchableContent.toLowerCase().indexOf(q);
                const start = Math.max(0, idx - 15);
                // ★修正: 切り出したテキストを highlight 関数に通す（中でエスケープされる）
                const rawText = searchableContent.substring(start, idx + q.length + 20);
                
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
// --- 章データ互換レイヤー ---
// 既存記事はarticle.contentを仮想的な1章として扱い、LocalForageの保存形式は変更しない。
function getArticleChapters(article) {
    if (!article) return [];

    if (Array.isArray(article.chapters) && article.chapters.length > 0) {
        const chapters = article.chapters
            .filter(chapter => chapter && typeof chapter === 'object')
            .map((chapter, index) => ({
                id: chapter.id !== undefined && chapter.id !== null && String(chapter.id).trim()
                    ? String(chapter.id)
                    : `chapter-${index + 1}`,
                title: typeof chapter.title === 'string' && chapter.title.trim()
                    ? chapter.title
                    : `Chapter ${index + 1}`,
                content: typeof chapter.content === 'string' ? chapter.content : '',
                order: Number.isFinite(Number(chapter.order)) ? Number(chapter.order) : index
            }));
        if (chapters.length > 0) return chapters.sort((a, b) => a.order - b.order);
    }

    return [{
        id: 'legacy-main',
        title: '本文',
        content: typeof article.content === 'string' ? article.content : '',
        order: 0,
        isVirtual: true
    }];
}

function hasStoredChapters(article = currentArticle) {
    return !!(article && Array.isArray(article.chapters) && article.chapters.length > 0 && getArticleChapters(article).length > 0);
}

function getCurrentChapters() { return getArticleChapters(currentArticle); }

function getCurrentChapter() {
    const chapters = getCurrentChapters();
    return chapters.find(chapter => String(chapter.id) === String(currentChapterId)) || chapters[0] || null;
}

function getCurrentChapterContent() {
    const chapter = getCurrentChapter();
    return chapter ? chapter.content : '';
}

function getCurrentChapterId() {
    const chapter = getCurrentChapter();
    return chapter ? String(chapter.id) : 'legacy-main';
}

function getInitialChapterId(article) {
    const chapters = getArticleChapters(article);
    const savedId = article?.readingPosition?.chapterId;
    const savedChapter = chapters.find(chapter => savedId !== undefined && String(chapter.id) === String(savedId));
    return savedChapter ? savedChapter.id : (chapters[0] ? chapters[0].id : null);
}

function getSavedPositionForChapter(article, chapterId) {
    if (!article) return null;
    const key = String(chapterId);
    const positions = article.readingPositions;
    if (positions && typeof positions === 'object' && positions[key]) return positions[key];

    const latest = article.readingPosition;
    if (!latest) return null;
    if (latest.chapterId === undefined || latest.chapterId === null) {
        return key === 'legacy-main' ? latest : null;
    }
    return String(latest.chapterId) === key ? latest : null;
}

function closeChapterDropdown() {
    const dropdown = document.getElementById('chapter-dropdown');
    const titleButton = document.getElementById('chapter-title-btn');
    if (dropdown) dropdown.classList.remove('is-open');
    if (titleButton) titleButton.setAttribute('aria-expanded', 'false');
}

function toggleChapterDropdown(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('chapter-dropdown');
    const titleButton = document.getElementById('chapter-title-btn');
    if (!dropdown || !titleButton || getCurrentChapters().length <= 1) return;
    const isOpen = dropdown.classList.toggle('is-open');
    titleButton.setAttribute('aria-expanded', String(isOpen));
}

function renderChapterNavigation() {
    const navigation = document.getElementById('chapter-navigation');
    const title = document.getElementById('chapter-title');
    const previous = document.getElementById('chapter-prev-btn');
    const next = document.getElementById('chapter-next-btn');
    const dropdown = document.getElementById('chapter-dropdown');
    if (!navigation || !title || !previous || !next || !dropdown) return;

    const chapters = getCurrentChapters();
    const currentIndex = chapters.findIndex(chapter => String(chapter.id) === String(getCurrentChapterId()));
    const currentChapter = chapters[currentIndex >= 0 ? currentIndex : 0];
    const showNavigation = chapters.length > 1;
    navigation.style.display = showNavigation ? 'flex' : 'none';
    closeChapterDropdown();
    if (!currentChapter) return;

    title.textContent = currentChapter.title;
    previous.disabled = !showNavigation || currentIndex <= 0;
    next.disabled = !showNavigation || currentIndex >= chapters.length - 1;
    dropdown.innerHTML = '';

    if (!showNavigation) return;
    chapters.forEach(chapter => {
        const option = document.createElement('button');
        const isCurrent = String(chapter.id) === String(currentChapter.id);
        option.type = 'button';
        option.className = `chapter-option${isCurrent ? ' is-current' : ''}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(isCurrent));
        const label = document.createElement('span');
        label.textContent = chapter.title;
        option.appendChild(label);
        if (isCurrent) {
            const check = document.createElement('span');
            check.className = 'chapter-option-check';
            check.textContent = '✓';
            check.setAttribute('aria-hidden', 'true');
            option.appendChild(check);
        }
        option.onclick = () => {
            closeChapterDropdown();
            void switchToChapter(chapter.id);
        };
        dropdown.appendChild(option);
    });
}

async function switchToChapter(chapterId) {
    if (!currentArticle) return;
    const target = getCurrentChapters().find(chapter => String(chapter.id) === String(chapterId));
    if (!target) return;
    const targetId = String(target.id);
    if (targetId === String(getCurrentChapterId())) {
        closeChapterDropdown();
        return;
    }

    // 章移動前に、移動元の章と書籍全体の最新位置を保存する。
    rememberReadingPosition();
    await saveToDB();

    currentChapterId = target.id;
    resetReaderSearch();
    renderChapterNavigation();
    renderArticleText();
    renderList(currentTab, document.getElementById('list-search')?.value || '');
    renderBookmarks();

    const savedPosition = getSavedPositionForChapter(currentArticle, targetId);
    const targetPosition = savedPosition
        ? { ...savedPosition, chapterId: targetId, updatedAt: Date.now() }
        : { chapterId: targetId, paragraphIndex: 0, paragraphOffset: 0, scrollRatio: 0, updatedAt: Date.now() };
    currentArticle.readingPosition = targetPosition;
    if (hasStoredChapters(currentArticle)) {
        if (!currentArticle.readingPositions || typeof currentArticle.readingPositions !== 'object') currentArticle.readingPositions = {};
        currentArticle.readingPositions[targetId] = targetPosition;
    }
    await saveToDB();
    restoreReadingPosition(savedPosition);
}

function goToPreviousChapter() {
    const chapters = getCurrentChapters();
    const index = chapters.findIndex(chapter => String(chapter.id) === String(getCurrentChapterId()));
    if (index > 0) void switchToChapter(chapters[index - 1].id);
}

function goToNextChapter() {
    const chapters = getCurrentChapters();
    const index = chapters.findIndex(chapter => String(chapter.id) === String(getCurrentChapterId()));
    if (index >= 0 && index < chapters.length - 1) void switchToChapter(chapters[index + 1].id);
}

function openArticle(id) {
    const nextArticle = libraryItems.find(i => i.id === id);
    if (!nextArticle) return;

    // 記事を切り替える前に、現在の記事の自動読書位置を確定する。
    if (currentArticle && currentArticle.id !== nextArticle.id) flushReadingPositionSave();

    currentArticle = nextArticle;
    ensureArticleCollections(currentArticle);
    if (!currentArticle) return;
    currentChapterId = getInitialChapterId(currentArticle);
    hideAllSections();
    document.getElementById('reader-wrapper').style.display = 'flex';
    document.getElementById('back-to-library').style.display = 'inline-block';
    document.getElementById('article-meta').style.display = 'flex';
    document.getElementById('display-url').href = currentArticle.url || '#';
    document.getElementById('display-url').style.display = currentArticle.url ? 'inline' : 'none';

    resetReaderSearch();
    renderChapterNavigation();
    renderArticleText();
    renderList('words');
    renderBookmarks();
    restoreReadingPosition(getSavedPositionForChapter(currentArticle, currentChapterId));
}

function renderArticleText() {
    if(!currentArticle) return;
    ensureArticleCollections(currentArticle);
    const display = document.getElementById('text-display');
    const content = getCurrentChapterContent();
    const currentChapterIdForHighlight = getCurrentChapterId();
    let html = content.split('\n').filter(p => p.trim()).map(p => `<p>${escapeHtml(p)}</p>`).join('');
    
    // ハイライト置換 (ノート > 単語 の順で処理)
    const sn = [...currentArticle.notes].sort((a,b) => String(b.originalText || '').length - String(a.originalText || '').length);
    sn.forEach(n => {
        if (n.chapterId !== undefined && n.chapterId !== null && String(n.chapterId) !== currentChapterIdForHighlight) return;
        if (typeof n.originalText !== 'string' || n.originalText.length < 2) return;
        const escaped = escapeRegExp(escapeHtml(n.originalText));
        html = html.replace(new RegExp(`(${escaped})`, 'gi'), `<span class="note-highlight" data-jump-id="${n.id}" data-type="note">$1</span>`);
    });

    const sw = [...currentArticle.words].sort((a,b) => String(b.word || '').length - String(a.word || '').length);
    sw.forEach(w => {
        if (w.chapterId !== undefined && w.chapterId !== null && String(w.chapterId) !== currentChapterIdForHighlight) return;
        if (typeof w.word !== 'string' || w.word.length < 2) return;
        const escaped = escapeRegExp(escapeHtml(w.word));
        html = html.replace(new RegExp(`(?<!>)${escaped}(?!<)`, 'gi'), `<span class="word-highlight" data-jump-id="${w.id}" data-type="word">$&</span>`);
    });

    display.innerHTML = html;
    updateProgress(null, true);
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
    const bookmark = { id: Date.now(), pIndex: targetIdx, label: name };
    if (hasStoredChapters(currentArticle)) bookmark.chapterId = getCurrentChapterId();
    currentArticle.bookmarks.push(bookmark);
    await saveToDB();
    renderBookmarks();
    restoreReadingPosition(position);
}

// chapterId付きのしおりは対象章へ切り替えてから位置へ移動する。
// 既存しおりはchapterIdがないため、現在章のしおりとして従来通り扱う。
function renderBookmarks() {
    const container = document.getElementById('bookmark-list');
    if (!container || !currentArticle) return;
    container.innerHTML = '';
    (currentArticle.bookmarks || []).forEach(bk => {
        const item = document.createElement('div');
        item.style = "background: white; border: 1px solid #ddd; padding: 6px 12px; border-radius: 20px; font-size: 0.75em; cursor: pointer; display: flex; align-items: center; gap: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);";
        const jump = document.createElement('span');
        jump.textContent = `\u{1F4CD} ${bk.label || ''}`;
        jump.onclick = () => void jumpToBookmark(bk.pIndex, bk.chapterId);
        const remove = document.createElement('span');
        remove.textContent = '\u00D7';
        remove.style = 'color:#ccc; border-left:1px solid #eee; padding-left:4px;';
        remove.onclick = event => {
            event.stopPropagation();
            void deleteBookmark(bk.id);
        };
        item.appendChild(jump);
        item.appendChild(remove);
        container.appendChild(item);
    });
}

async function jumpToBookmark(pIdx, chapterId) {
    if (chapterId !== undefined && chapterId !== null && String(chapterId) !== String(getCurrentChapterId())) {
        await switchToChapter(chapterId);
    }
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
    if (!currentArticle) return;
    const readingPosition = rememberReadingPosition();
    try {
        if (currentModalType === 'word') {
            const activeChapterId = getActiveChapterIdForItem();
            const w = { id: editingId || Date.now(), word: document.getElementById('input-word-text').value, meaning: document.getElementById('input-word-meaning').value, memo: document.getElementById('input-word-memo').value, memorized: false };
            if (editingId) {
                const old = currentArticle.words.find(i => i.id === editingId);
                if (old) w.memorized = old.memorized;
                if (old?.chapterId !== undefined && old?.chapterId !== null) w.chapterId = old.chapterId;
                else if (activeChapterId) w.chapterId = activeChapterId;
                currentArticle.words = currentArticle.words.map(i => i.id === editingId ? w : i);
            } else {
                if (activeChapterId) w.chapterId = activeChapterId;
                currentArticle.words.push(w);
            }
        } else {
            const activeChapterId = getActiveChapterIdForItem();
            const n = { id: editingId || Date.now(), originalText: document.getElementById('input-note-eng').value, translation: document.getElementById('input-note-trans').value, extra: document.getElementById('input-note-extra').value };
            if (editingId) {
                const old = currentArticle.notes.find(i => i.id === editingId);
                if (old?.chapterId !== undefined && old?.chapterId !== null) n.chapterId = old.chapterId;
                else if (activeChapterId) n.chapterId = activeChapterId;
                currentArticle.notes = currentArticle.notes.map(i => i.id === editingId ? n : i);
            } else {
                if (activeChapterId) n.chapterId = activeChapterId;
                currentArticle.notes.push(n);
            }
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
function ensureArticleCollections(article) {
    if (!article) return;
    if (!Array.isArray(article.words)) article.words = [];
    if (!Array.isArray(article.notes)) article.notes = [];
    if (!Array.isArray(article.bookmarks)) article.bookmarks = [];
}

function getActiveChapterIdForItem() {
    return hasStoredChapters(currentArticle) ? getCurrentChapterId() : null;
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

function getReaderElementTop(element, container) {
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    return elementRect.top - containerRect.top + container.scrollTop;
}

function storeReadingPosition(position) {
    if (!position || !currentArticle) return;
    currentArticle.readingPosition = position;
    if (hasStoredChapters(currentArticle)) {
        const chapterId = position.chapterId || getCurrentChapterId();
        if (!currentArticle.readingPositions || typeof currentArticle.readingPositions !== 'object') currentArticle.readingPositions = {};
        currentArticle.readingPositions[String(chapterId)] = position;
    }
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

    const position = {
        paragraphIndex,
        paragraphOffset: display.scrollTop - paragraphTop,
        scrollRatio: maxScroll > 0 ? display.scrollTop / maxScroll : 0,
        updatedAt: Date.now()
    };
    if (hasStoredChapters(currentArticle)) position.chapterId = getCurrentChapterId();
    return position;
}

function rememberReadingPosition() {
    const position = captureReadingPosition();
    storeReadingPosition(position);
    return position;
}

function restoreReadingPosition(position) {
    const display = document.getElementById('text-display');
    if (!display) return;

    const articleId = currentArticle && currentArticle.id;
    const restoreToken = ++readingPositionRestoreToken;
    const apply = () => {
        if (!display || restoreToken !== readingPositionRestoreToken || (currentArticle && currentArticle.id !== articleId)) return;
        if (position?.chapterId !== undefined && String(position.chapterId) !== String(getCurrentChapterId())) return;

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
    storeReadingPosition(position);
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
function hideAllSections() { ['library-section', 'input-area', 'import-review-area', 'reader-wrapper', 'back-to-library', 'article-meta'].forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; }); }
function closeModal() { document.getElementById('unified-modal-overlay').classList.remove('show'); editingId = null; }
function togglePanel() { document.getElementById('side-panel').classList.toggle('is-open'); }
function countEnglishWords(text) {
    const matches = String(text ?? '').match(/[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+(?:['’][A-Za-z]+)*)*/g);
    return matches ? matches.length : 0;
}

function getArticleFullText(article) {
    if (!article) return '';
    if (hasStoredChapters(article)) return getArticleChapters(article).map(chapter => chapter.content).join('\n\n');
    return typeof article.content === 'string' ? article.content : '';
}

function getArticleSearchableText(article) {
    return getArticleFullText(article);
}

function getReaderWordCounts(article = currentArticle) {
    const chapterText = article === currentArticle ? getCurrentChapterContent() : getArticleChapters(article)[0]?.content || '';
    return {
        chapter: countEnglishWords(chapterText),
        book: countEnglishWords(getArticleFullText(article))
    };
}

function updateProgress(event, forceWordCount = false) {
    const d = document.getElementById('text-display');
    if(!d || !currentArticle) return;
    const content = getCurrentChapterContent();
    const chapterId = getCurrentChapterId();
    if (forceWordCount || readerWordCounts.articleId !== currentArticle.id || readerWordCounts.chapterId !== chapterId) {
        const counts = getReaderWordCounts(currentArticle);
        readerWordCounts = { articleId: currentArticle.id, chapterId, ...counts };
        const statusBar = document.getElementById('reading-status-bar');
        if (statusBar) {
            statusBar.dataset.chapterWordCount = String(readerWordCounts.chapter);
            statusBar.dataset.bookWordCount = String(readerWordCounts.book);
        }
    }
    const wordCount = document.getElementById('word-count');
    if (wordCount) wordCount.innerText = `${readerWordCounts.chapter.toLocaleString()} words`;
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
