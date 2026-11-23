/*
 * 高田同窓会ビンゴ大会
 * 参加者用: bingo.html          → 閲覧のみ
 * 幹事用:   bingo.html?admin=1  → Googleログイン後に編集
 *
 * Firebase Consoleで取得した値を下の CONFIG に入力してください。
 * 管理者の制限はJSだけでなく、必ずFirestoreのセキュリティルールでも行います。
 */
(() => {
  'use strict';

  // ===== ここを自分のFirebaseプロジェクトの値に変更 =====
  const CONFIG = {
    firebase: {
      apiKey: 'AIzaSyAIb9hrN0w3RyXDQjNLrlLzckRiqlQfgIA',
      authDomain: 'takada-bingo.firebaseapp.com',
      projectId: 'takada-bingo',
      appId: '1:837777597491:web:869cef6cf186f869daef46'
    },
    adminUid: '1uIoMXPsjSWpkM6wTH5rHpSgLtD3'
  };
  // ===================================================

  const IS_ADMIN = new URLSearchParams(location.search).has('admin');
  
  window.TAKADA_FINALE_SETTINGS = {
    firebase: CONFIG.firebase,
    adminUid: CONFIG.adminUid,
    isAdmin: IS_ADMIN
  };

  const LETTERS = ['B', 'I', 'N', 'G', 'O'];
  const DEMO_DRAWN = [11, 28, 53, 62, 6, 40, 75, 22, 14, 49, 57, 33, 3, 70, 18, 45, 26, 54];
  const byId = id => document.getElementById(id);
  const groupFor = n => LETTERS[Math.floor((n - 1) / 15)];
  const isNumber = n => Number.isInteger(n) && n >= 1 && n <= 75;
  const validValue = v => typeof v === 'string' && v.trim() !== '' && !v.includes('ここに');
  const configured = Object.values(CONFIG.firebase).every(validValue);
  const adminConfigured = validValue(CONFIG.adminUid);

  let drawn = [];
  let selected = null;
  let firebaseConnected = false;
  let currentUser = null;
  let loading = false;
  let firestore = null;
  let documentRef = null;
  let firestoreFns = null;
  let auth = null;
  let authFns = null;

  function normalize(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(Number).filter(isNumber))];
  }

  function setStatus(type, label) {
    byId('statusPill').className = `status-pill is-${type}`;
    byId('statusLabel').textContent = label;
  }

  function showError(message) {
    const el = byId('errorNotice');
    el.textContent = `⚠️ ${message}`;
    el.hidden = false;
  }

  function clearError() { byId('errorNotice').hidden = true; }

  function setInputMessage(text, error = false) {
    if (!IS_ADMIN) return;
    const el = byId('inputMessage');
    el.textContent = text;
    el.style.color = error ? '#ba3352' : '#7d6a89';
  }

  function canEdit() {
    return IS_ADMIN && firebaseConnected && !loading &&
      adminConfigured && currentUser && currentUser.uid === CONFIG.adminUid;
  }

  function renderBoard() {
    const board = byId('numberBoard');
    const marked = new Set(drawn);
    board.replaceChildren();

    for (let col = 0; col < 5; col++) {
      const letter = LETTERS[col];
      const column = document.createElement('section');
      column.className = 'number-column';
      column.dataset.letter = letter;

      const heading = document.createElement('div');
      heading.className = 'column-label';
      const title = document.createElement('strong');
      title.textContent = letter;
      const range = document.createElement('small');
      range.textContent = `${col * 15 + 1}–${col * 15 + 15}`;
      heading.append(title, range);
      column.appendChild(heading);

      const cells = document.createElement('div');
      cells.className = 'column-numbers';
      for (let n = col * 15 + 1; n <= col * 15 + 15; n++) {
        const markedNumber = marked.has(n);
        const el = document.createElement(IS_ADMIN ? 'button' : 'div');
        el.className = 'number-cell' +
          (markedNumber ? ' is-drawn' : '') +
          (IS_ADMIN ? ' is-admin' : '') +
          (IS_ADMIN && selected === n && !markedNumber ? ' is-selected' : '');
        el.textContent = n;
        el.setAttribute('aria-label', `${letter}-${n} ${markedNumber ? '抽選済み' : '未抽選'}`);
        if (IS_ADMIN) {
          el.type = 'button';
          el.disabled = !canEdit() || markedNumber;
          el.setAttribute('aria-pressed', selected === n && !markedNumber ? 'true' : 'false');
          el.addEventListener('click', () => {
            selected = n;
            byId('numberInput').value = String(n);
            setInputMessage(`${letter}-${n} を選択中。「番号を追加」を押して確定してください。`);
            renderBoard();
            byId('numberInputTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        }
        cells.appendChild(el);
      }
      column.appendChild(cells);
      board.appendChild(column);
    }
  }

  function renderHistory() {
    const list = byId('historyList');
    list.replaceChildren();
    if (!drawn.length) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = 'まだ番号は出ていません。抽選開始をお楽しみに！';
      list.appendChild(empty);
      return;
    }
    for (const n of [...drawn].reverse()) {
      const chip = document.createElement('span');
      chip.className = 'history-chip';
      chip.dataset.letter = groupFor(n);
      const small = document.createElement('small');
      small.textContent = groupFor(n);
      chip.append(small, document.createTextNode(String(n)));
      list.appendChild(chip);
    }
  }

  function render() {
    const count = drawn.length;
    const latest = count ? drawn[count - 1] : null;
    byId('drawCount').textContent = count;
    byId('historyCount').textContent = `${count}個`;
    byId('progressTrack').setAttribute('aria-valuenow', String(count));
    byId('progressBar').style.width = `${(count / 75) * 100}%`;
    byId('latestNumber').textContent = latest ?? '—';
    byId('latestLetter').textContent = latest ? groupFor(latest) : '?';
    byId('latestBall').classList.toggle('is-empty', !latest);
    byId('latestHelp').textContent = latest
      ? `最新は ${groupFor(latest)} - ${latest} だよ！`
      : '抽選スタートをお楽しみに！';
    if (IS_ADMIN) byId('adminDrawCount').textContent = `${count} / 75`;
    renderBoard();
    renderHistory();
    updateControls();
  }

  function updateControls() {
    if (!IS_ADMIN) return;
    const editable = Boolean(canEdit());
    byId('numberInput').disabled = !editable || drawn.length === 75;
    byId('addBtn').disabled = !editable || drawn.length === 75;
    byId('undoBtn').disabled = !editable || drawn.length === 0;
    byId('resetBtn').disabled = !editable || drawn.length === 0;
  }

  function updateAccount() {
    if (!IS_ADMIN) return;
    byId('loginBtn').hidden = Boolean(currentUser);
    byId('logoutBtn').hidden = !currentUser;
    byId('accountBox').hidden = !currentUser;
    if (currentUser) {
      byId('accountEmail').textContent = currentUser.email || 'Googleアカウント';
      byId('accountUid').textContent = currentUser.uid;
      byId('authMessage').textContent = !adminConfigured
        ? 'このUIDを bingo.js の adminUid と、Firestoreのセキュリティルールに登録してください。'
        : currentUser.uid === CONFIG.adminUid
          ? '✅ 管理者として登録されています。'
          : 'このGoogleアカウントには編集権限がありません。';
    }
    renderBoard();
    updateControls();
  }

  function explain(error) {
    const code = String(error?.code || '');
    if (code.includes('permission-denied')) return 'Firestoreの権限がありません。セキュリティルールと管理者UIDを確認してください。';
    if (code.includes('unauthorized-domain')) return 'Firebase Authenticationの承認済みドメインに公開サイトのドメインを追加してください。';
    if (code.includes('popup-blocked')) return 'ログイン用ポップアップを許可してください。';
    if (code.includes('popup-closed-by-user')) return 'Googleログインがキャンセルされました。';
    if (code.includes('unavailable')) return 'ネットワークに接続できません。';
    return error?.message || 'Firebaseの接続を確認してください。';
  }

  async function addNumber() {
    if (!canEdit()) return;
    const input = byId('numberInput');
    const value = input.value.trim();
    const n = Number(value);
    if (!value || !isNumber(n)) return setInputMessage('1〜75の整数を入力してください。', true);
    if (drawn.includes(n)) return setInputMessage(`${n}番は登録済みです。`, true);

    loading = true;
    updateControls();
    try {
      const added = await firestoreFns.runTransaction(firestore, async transaction => {
        const snapshot = await transaction.get(documentRef);
        const oldNumbers = normalize(snapshot.exists() ? snapshot.data().drawn : []);
        if (oldNumbers.includes(n) || oldNumbers.length >= 75) return false;
        transaction.set(documentRef, {
          drawn: [...oldNumbers, n],
          updatedAt: firestoreFns.serverTimestamp()
        });
        return true;
      });
      if (!added) return setInputMessage(`${n}番はすでに登録済みです。`, true);
      input.value = '';
      selected = null;
      setInputMessage(`✅ ${groupFor(n)} - ${n} を登録しました！`);
      clearError();
    } catch (error) {
      setInputMessage(explain(error), true);
      showError(explain(error));
    } finally {
      loading = false;
      updateControls();
      renderBoard();
    }
  }

  async function undoLast() {
    if (!canEdit() || !drawn.length) return;
    const latest = drawn[drawn.length - 1];
    if (!confirm(`最後の番号 ${groupFor(latest)}-${latest} を取り消しますか？`)) return;
    loading = true;
    updateControls();
    try {
      await firestoreFns.runTransaction(firestore, async transaction => {
        const snapshot = await transaction.get(documentRef);
        const oldNumbers = normalize(snapshot.exists() ? snapshot.data().drawn : []);
        if (oldNumbers.length === 0) return;
        transaction.set(documentRef, {
          drawn: oldNumbers.slice(0, -1),
          updatedAt: firestoreFns.serverTimestamp()
        });
      });
      setInputMessage('最後の番号を取り消しました。');
    } catch (error) {
      showError(explain(error));
    } finally {
      loading = false;
      updateControls();
    }
  }

  async function resetAll() {
    if (!canEdit() || !drawn.length) return;
    if (!confirm('すべての番号を削除します。参加者画面からも消えます。よろしいですか？')) return;
    if (!confirm('最終確認：本当に全番号をリセットしますか？')) return;
    loading = true;
    updateControls();
    try {
      await firestoreFns.runTransaction(firestore, async transaction => {
        await transaction.get(documentRef);
        transaction.set(documentRef, { drawn: [], updatedAt: firestoreFns.serverTimestamp() });
      });
      setInputMessage('全番号をリセットしました。');
    } catch (error) {
      showError(explain(error));
    } finally {
      loading = false;
      updateControls();
    }
  }

  function initAdminUI() {
    if (!IS_ADMIN) return;
    byId('adminArea').hidden = false;
    byId('adminLinkWrap').hidden = false;
    byId('loginBtn').disabled = !configured;
    document.title = '高田同窓会ビンゴ大会 | 幹事用';

    byId('addBtn').addEventListener('click', addNumber);
    byId('numberInput').addEventListener('keydown', event => {
      if (event.key === 'Enter') addNumber();
    });
    byId('numberInput').addEventListener('input', () => {
      selected = isNumber(Number(byId('numberInput').value)) ? Number(byId('numberInput').value) : null;
      renderBoard();
    });
    byId('undoBtn').addEventListener('click', undoLast);
    byId('resetBtn').addEventListener('click', resetAll);

    byId('loginBtn').addEventListener('click', async () => {
      if (!auth) return;
      try {
        clearError();
        await authFns.signInWithPopup(auth, new authFns.GoogleAuthProvider());
      } catch (error) {
        showError(explain(error));
      }
    });
    byId('logoutBtn').addEventListener('click', async () => {
      if (!auth) return;
      try {
        await authFns.signOut(auth);
      } catch (error) {
        showError(explain(error));
      }
    });
    byId('copyUidBtn').addEventListener('click', async () => {
      if (!currentUser) return;
      try {
        await navigator.clipboard.writeText(currentUser.uid);
        byId('copyUidBtn').textContent = 'コピー済み';
      } catch (_) {
        byId('copyUidBtn').textContent = 'UIDを手動でコピー';
      }
    });
  }

  async function start() {
    if (!configured) {
      drawn = DEMO_DRAWN;
      byId('demoNotice').hidden = false;
      setStatus('demo', 'デモ表示');
      render();
      return;
    }
    setStatus('sync', '読み込み中');
    try {
      // Firebase JavaScript SDK v13.4.0（CDNから読み込み）
      const base = 'https://www.gstatic.com/firebasejs/13.4.0/';
      const [appFns, dbFns, authenticationFns] = await Promise.all([
        import(base + 'firebase-app.js'),
        import(base + 'firebase-firestore.js'),
        IS_ADMIN ? import(base + 'firebase-auth.js') : Promise.resolve(null)
      ]);
      const app = appFns.initializeApp(CONFIG.firebase);
      firestoreFns = dbFns;
      firestore = dbFns.getFirestore(app);
      documentRef = dbFns.doc(firestore, 'bingo', 'current');

      if (IS_ADMIN) {
        authFns = authenticationFns;
        auth = authFns.getAuth(app);
        authFns.onAuthStateChanged(auth, user => {
          currentUser = user;
          updateAccount();
        });
      }

      dbFns.onSnapshot(documentRef, { includeMetadataChanges: true }, snapshot => {
        drawn = normalize(snapshot.exists() ? snapshot.data().drawn : []);
        firebaseConnected = navigator.onLine !== false && !snapshot.metadata.fromCache;
        setStatus(firebaseConnected ? 'live' : 'sync', firebaseConnected ? 'リアルタイム接続中' : '再接続中');
        clearError();
        render();
      }, error => {
        firebaseConnected = false;
        setStatus('error', '取得エラー');
        showError('番号を読み取れません。' + explain(error));
        updateControls();
        renderBoard();
      });
      window.addEventListener('offline', () => {
        firebaseConnected = false;
        setStatus('sync', 'オフライン');
        updateControls();
        renderBoard();
      });
    } catch (error) {
      firebaseConnected = false;
      setStatus('error', '接続エラー');
      showError('Firebaseを初期化できません。' + explain(error));
    }
  }

  initAdminUI();
  render();
  start();
})();

/* ===== 高田同窓会・最後の特別抽選（カード裏面のコード：A〜E + 1〜75） =====
   既存の bingo.js の最後の `})();` より後に、丸ごと追加してください。
   また、既存の `const IS_ADMIN = ...;` 直後に設定を渡す1行が必要です。
*/
(() => {
  'use strict';
  const settings = window.TAKADA_FINALE_SETTINGS;
  if (!settings) {
    console.warn('特別抽選の設定がありません。bingo.js 冒頭の設定受け渡し行を確認してください。');
    return;
  }

  const $ = id => document.getElementById(id);
  const LETTERS = ['A', 'B', 'C', 'D', 'E'];
  const isAdmin = settings.isAdmin;
  const validConfig = value => typeof value === 'string' && !!value.trim() && !value.includes('ここに');
  const configured = Object.values(settings.firebase).every(validConfig);
  const validDraw = item => !!item && LETTERS.includes(item.letter) &&
    Number.isInteger(item.number) && item.number >= 1 && item.number <= 75;
  const cleanDraws = items => Array.isArray(items)
    ? items.filter(validDraw).slice(0, 100) : [];
  const formatDraw = item => `${item.letter}-${item.number}`;

  let db, fs, controlRef, finaleRef;
  let user = null;
  let selectedLetter = null;
  let control = { revealed: false };
  let state = { prize: '', draws: [], winner: '', winnerCode: '' };
  let controlLoaded = false;
  let finaleLoaded = false;
  let busy = false;
  let unwatchFinale = null;
  let generation = 0;

  function adminReady() {
    return isAdmin && configured && controlLoaded && finaleLoaded && !busy &&
      !!user && user.uid === settings.adminUid && navigator.onLine !== false;
  }
  function say(message, error = false) {
    if (!isAdmin) return;
    const node = $('finaleAdminMsg');
    node.textContent = message;
    node.style.color = error ? '#ba3352' : '#66547a';
  }
  function render() {
    const owner = isAdmin && !!user && user.uid === settings.adminUid;
    const ready = adminReady();
    if (isAdmin) $('finaleAdminPanel').hidden = !owner;
    const visible = control.revealed || owner;
    $('finaleSection').hidden = !visible;
    const draws = visible && finaleLoaded ? state.draws : [];
    const latest = draws.length ? draws[draws.length - 1] : null;
    $('finaleLatestLetter').textContent = latest ? latest.letter : '？';
    $('finaleLatestNumber').textContent = latest ? String(latest.number) : '？';
    $('finaleCount').textContent = `抽選 ${draws.length}回`;
    $('finalePrize').textContent = visible && finaleLoaded ? state.prize : '';

    const history = $('finaleHistory');
    history.replaceChildren();
    if (!draws.length) {
      history.textContent = 'まだ抽選されていません';
    } else {
      for (const item of [...draws].reverse()) {
        const chip = document.createElement('span');
        chip.className = 'finale-history-chip';
        chip.textContent = formatDraw(item);
        history.appendChild(chip);
      }
    }
    const won = visible && finaleLoaded && !!state.winnerCode;
    $('finaleWinCodeBox').hidden = !won;
    $('finaleWinningCode').textContent = won ? state.winnerCode : '';
    const showWinner = won && !!state.winner.trim();
    $('finaleWinnerBox').hidden = !showWinner;
    $('finaleWinnerName').textContent = showWinner ? state.winner : '';

    if (!isAdmin) return;
    $('finaleAdminBadge').textContent = control.revealed ? '公開中' : '非公開';
    $('finaleAdminBadge').classList.toggle('is-public', control.revealed);
    $('finaleRevealText').textContent = control.revealed ? '現在：参加者に公開中' : '現在：参加者には非表示';
    $('finaleRevealBtn').textContent = control.revealed ? '🔒 非公開に戻す' : '🎉 参加者に公開する';
    $('finaleRevealBtn').disabled = !ready || (!control.revealed && !state.prize.trim());
    $('finalePrizeInput').disabled = !ready;
    $('finalePrizeSaveBtn').disabled = !ready;
    $('finaleWinnerInput').disabled = !ready || !state.winnerCode;
    $('finaleWinnerSaveBtn').disabled = !ready || !state.winnerCode;
    $('finaleNumberInput').disabled = !ready || !!state.winnerCode;
    const numberRaw = $('finaleNumberInput').value.trim();
    const number = Number(numberRaw);
    const numberOK = numberRaw !== '' && Number.isInteger(number) && number >= 1 && number <= 75;
    const existing = selectedLetter && numberOK &&
      draws.some(item => item.letter === selectedLetter && item.number === number);
    $('finaleAddBtn').disabled = !ready || !!state.winnerCode || !selectedLetter || !numberOK || draws.length >= 100 || Boolean(existing);
    $('finaleUndoBtn').disabled = !ready || draws.length === 0;
    $('finaleResetBtn').disabled = !ready || (draws.length === 0 && !state.winner && !state.winnerCode);
    $('finaleConfirmBtn').disabled = !ready || (!state.winnerCode && draws.length === 0);
    $('finaleConfirmBtn').textContent = state.winnerCode ? '↶ 当選確定を取り消す' : '🏆 最新コードを当選確定';
    $('finaleAdminLetters').querySelectorAll('button[data-letter]').forEach(button => {
      button.disabled = !ready || !!state.winnerCode || draws.length >= 100;
      const isSelected = selectedLetter === button.dataset.letter;
      button.classList.toggle('is-selected', isSelected);
      button.setAttribute('aria-pressed', String(isSelected));
    });
    if (finaleLoaded && document.activeElement !== $('finalePrizeInput')) {
      $('finalePrizeInput').value = state.prize;
    }
    if (finaleLoaded && document.activeElement !== $('finaleWinnerInput')) {
      $('finaleWinnerInput').value = state.winner;
    }
  }

  function unwatch() {
    generation += 1;
    if (unwatchFinale) unwatchFinale();
    unwatchFinale = null;
    finaleLoaded = false;
    state = { prize: '', draws: [], winner: '', winnerCode: '' };
  }
  function watch() {
    if (unwatchFinale || !fs) return;
    const current = ++generation;
    unwatchFinale = fs.onSnapshot(finaleRef, snapshot => {
      if (current !== generation) return;
      const value = snapshot.exists() ? snapshot.data() : {};
      state = {
        prize: typeof value.prize === 'string' ? value.prize : '',
        draws: cleanDraws(value.draws),
        winner: typeof value.winner === 'string' ? value.winner : '',
        winnerCode: typeof value.winnerCode === 'string' ? value.winnerCode : ''
      };
      finaleLoaded = true;
      render();
    }, error => {
      if (current !== generation) return;
      say('特別抽選のデータ取得に失敗しました: ' + error.message, true);
      unwatch();
      render();
    });
  }
  function syncListener() {
    const permitted = control.revealed || (isAdmin && user?.uid === settings.adminUid);
    if (permitted) watch();
    else unwatch();
    render();
  }
  async function save(operation, success) {
    if (!adminReady()) return;
    busy = true;
    render();
    try {
      await operation();
      say(success);
    } catch (error) {
      say('保存エラー: ' + error.message, true);
    } finally {
      busy = false;
      render();
    }
  }

  function initAdminEvents() {
    if (!isAdmin) return;
    $('finaleAdminLetters').addEventListener('click', event => {
      const button = event.target.closest('button[data-letter]');
      if (!button || button.disabled || !adminReady()) return;
      selectedLetter = button.dataset.letter;
      render();
    });
    $('finaleNumberInput').addEventListener('input', render);
    $('finaleNumberInput').addEventListener('keydown', event => {
      if (event.key === 'Enter') $('finaleAddBtn').click();
    });
    $('finalePrizeSaveBtn').addEventListener('click', () => {
      const prize = $('finalePrizeInput').value.trim();
      if (!prize) return say('景品名を入力してください。', true);
      save(() => fs.setDoc(finaleRef, {prize, updatedAt: fs.serverTimestamp()}, {merge:true}),
        '景品名を保存しました。');
    });
    $('finaleRevealBtn').addEventListener('click', () => {
      const revealed = !control.revealed;
      if (revealed && !state.prize.trim()) return say('先に景品名を保存してください。', true);
      if (!confirm(revealed ? '参加者に特別抽選と景品名を公開します。よろしいですか？' : '参加者から特別抽選を非表示に戻しますか？')) return;
      save(() => fs.setDoc(controlRef, {revealed, updatedAt:fs.serverTimestamp()}, {merge:true}),
        revealed ? '特別抽選を公開しました！' : '特別抽選を非公開に戻しました。');
    });
    $('finaleAddBtn').addEventListener('click', () => {
      const raw = $('finaleNumberInput').value.trim();
      const number = Number(raw);
      if (!selectedLetter || raw === '' || !Number.isInteger(number) || number < 1 || number > 75) {
        return say('A〜Eの文字と1〜75の整数を選択してください。', true);
      }
      const item = {letter:selectedLetter, number};
      if (state.winnerCode) return say('当選確定済みです。続ける場合は当選確定を取り消してください。', true);
      if (state.draws.some(x => formatDraw(x) === formatDraw(item))) {
        return say('同じ組み合わせは登録済みです。', true);
      }
      if (!confirm(`${formatDraw(item)} を追加しますか？`)) return;
      save(async () => {
        await fs.runTransaction(db, async transaction => {
          const snap = await transaction.get(finaleRef);
          const previous = cleanDraws(snap.exists() ? snap.data().draws : []);
          if (previous.length >= 100) throw new Error('100回を超える抽選は登録できません。');
          if (previous.some(x => formatDraw(x) === formatDraw(item))) throw new Error('登録済みの組み合わせです。');
          transaction.set(finaleRef, {
            draws: [...previous, item], updatedAt: fs.serverTimestamp()
          }, {merge:true});
        });
        $('finaleNumberInput').value = '';
        selectedLetter = null;
      }, `${formatDraw(item)} を登録しました！`);
    });
    $('finaleUndoBtn').addEventListener('click', () => {
      const last = state.draws.at(-1);
      if (!last || !confirm(`最後の ${formatDraw(last)} を取り消しますか？`)) return;
      save(() => fs.runTransaction(db, async transaction => {
        const snap = await transaction.get(finaleRef);
        const previous = cleanDraws(snap.exists() ? snap.data().draws : []);
        transaction.set(finaleRef, {draws: previous.slice(0, -1), winnerCode:'', winner:'', updatedAt:fs.serverTimestamp()}, {merge:true});
      }), '最後の組み合わせを取り消しました。');
    });
    $('finaleResetBtn').addEventListener('click', () => {
      if (!confirm('特別抽選の履歴と当選者表示をリセットしますか？（通常ビンゴは消えません）')) return;
      if (!confirm('最終確認：本当にリセットしますか？')) return;
      save(() => fs.setDoc(finaleRef, {draws:[], winner:'', winnerCode:'',updatedAt:fs.serverTimestamp()}, {merge:true}),
        '特別抽選の履歴をリセットしました。');
    });
    $('finaleConfirmBtn').addEventListener('click', () => {
      const last = state.draws.at(-1);
      if (state.winnerCode) {
        if (!confirm('当選確定を取り消しますか？当選者名も消えます。')) return;
        save(() => fs.setDoc(finaleRef, { winnerCode:'', winner:'', updatedAt:fs.serverTimestamp() }, {merge:true}),
          '当選確定を取り消しました。');
        return;
      }
      if (!last) return say('まだ抽選コードが登録されていません。', true);
      const code = formatDraw(last);
      if (!confirm(`カード裏面に ${code} と書かれた人が確認できましたか？\n確認できた場合のみ当選確定してください。`)) return;
      save(() => fs.setDoc(finaleRef, { winnerCode:code, updatedAt:fs.serverTimestamp() }, {merge:true}),
        `${code} を当選コードとして確定しました！`);
    });
    $('finaleWinnerSaveBtn').addEventListener('click', () => {
      const winner = $('finaleWinnerInput').value.trim();
      save(() => fs.setDoc(finaleRef, {winner, updatedAt:fs.serverTimestamp()}, {merge:true}),
        winner ? '当選者名を保存しました。' : '当選者表示を消しました。');
    });
  }

  async function start() {
    initAdminEvents();
    render();
    if (!configured) return;
    try {
      const root = 'https://www.gstatic.com/firebasejs/13.4.0/';
      const [appApi, firestoreApi, authApi] = await Promise.all([
        import(root + 'firebase-app.js'),
        import(root + 'firebase-firestore.js'),
        isAdmin ? import(root + 'firebase-auth.js') : Promise.resolve(null)
      ]);
      const app = appApi.getApps().length ? appApi.getApp() : appApi.initializeApp(settings.firebase);
      fs = firestoreApi;
      db = fs.getFirestore(app);
      controlRef = fs.doc(db, 'bingo', 'finaleControl');
      finaleRef = fs.doc(db, 'bingo', 'finaleData');
      fs.onSnapshot(controlRef, {includeMetadataChanges:true}, snapshot => {
        control = { revealed: snapshot.exists() && snapshot.data().revealed === true };
        controlLoaded = !snapshot.metadata.fromCache;
        syncListener();
      }, error => {
        control = {revealed:false};
        controlLoaded = false;
        say('公開状態の確認に失敗: ' + error.message, true);
        syncListener();
      });
      if (isAdmin) {
        const auth = authApi.getAuth(app);
        authApi.onAuthStateChanged(auth, next => {
          user = next;
          syncListener();
        });
      }
    } catch (error) {
      say('特別抽選の初期化に失敗: ' + error.message, true);
    }
  }
  start();
})();

