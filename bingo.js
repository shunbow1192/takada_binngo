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
    adminUid: 'ここに管理者UID'
  };
  // ===================================================

  const IS_ADMIN = new URLSearchParams(location.search).has('admin');
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
