/* app.js - TenTest + Firebase auth (simple credentials) + daily login check
   NOTE: O'zgartirishingiz kerak bo'lgan joylar: ADMIN_KEY (admin sahifa uchun maxfiy kalit).
*/

/* ====== Firebase konfiguratsiya (siz berganini shu yerga qo'ydim) ====== */
const firebaseConfig = {
  apiKey: "AIzaSyAEVEg_7meQP9Y7X2mDX781Kn6tbT-CMDg",
  authDomain: "mynewtentest.firebaseapp.com",
  projectId: "mynewtentest",
  storageBucket: "mynewtentest.firebasestorage.app",
  messagingSenderId: "1008038835527",
  appId: "1:1008038835527:web:a2f8d0878cd135342b8862",
  measurementId: "G-7D94P63KLB"
};

// Initialize Firebase (compat)
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

/* ====== ADMIN KEY (Iltimos bu qiymatni o'zgartiring va maxfiy saqlang) ======
   Administrator sahifasiga kirib yangi login/parol yaratish uchun kerak bo'ladi.
   Siz uni admin.html yoki admin.js ichida ham tekshirasiz.
*/
const ADMIN_KEY = "200027"; // <-- BU YERNI O'ZGARTIRING !!!

/* ====== Sizning asli quiz kodlaringiz (meningiz bergan kodni shu yerga joyladim)
   - Men asl kodni biroz tuzatdim, va oxiriga QUESTIONS massivini qo'shdim.
   - Pastdagi kod ingl. yoki o'zbek tilida izohlangan.
*/

/* ====== Konfiguratsiya ====== */
const SESSION_SIZE = 10;
const USED_KEY = 'logic_used_v1';
const STATS_KEY = 'logic_stats_v1';
const THEME_KEY = 'logic_theme_v1';

/* ====== Elementlar ====== */
const screenStart = document.getElementById('screen-start');
const screenQuiz = document.getElementById('screen-quiz');
const screenResult = document.getElementById('screen-result');

const startBtn = document.getElementById('startBtn');
const resetBankBtn = document.getElementById('resetBankBtn');
const themeToggle = document.getElementById('themeToggle');

const lifetimeStatsEl = document.getElementById('lifetimeStats');
const yearEl = document.getElementById('year');

const progressBar = document.getElementById('progressBar');
const counterEl = document.getElementById('counter');
const questionText = document.getElementById('questionText');
const optionsList = document.getElementById('optionsList');

const checkBtn = document.getElementById('checkBtn');
const nextBtn = document.getElementById('nextBtn');

const scoreBadge = document.getElementById('scoreBadge');
const scoreMessage = document.getElementById('scoreMessage');
const withdrawMessage = document.getElementById('withdrawMessage');
const againBtn = document.getElementById('againBtn');
const endSessionBtn = document.getElementById('endSessionBtn');
const retryBtn = document.getElementById('retryBtn');
const nextSessionBtn = document.getElementById('nextSessionBtn');
const reviewBtn = document.getElementById('reviewBtn');
const reviewList = document.getElementById('reviewList');

const fxLayer = document.getElementById('fxLayer');

/* ====== Login modal elements ====== */
const loginOverlay = document.getElementById('loginOverlay');
const loginUsername = document.getElementById('loginUsername');
const loginPassword = document.getElementById('loginPassword');
const doLoginBtn = document.getElementById('doLoginBtn');
const buyBtn = document.getElementById('buyBtn');
const loginMsg = document.getElementById('loginMsg');

const callModal = document.getElementById('callModal');
const callClose = document.getElementById('callClose');

callClose && callClose.addEventListener('click', () => {
  callModal.classList.add('hidden');
});

/* ====== Holat ====== */
let usedIds = loadUsed();
let stats = loadStats();
let session = {
  queue: [],
  index: 0,
  correct: 0,
  selection: null,
  shuffled: [],
  review: []
};

/* ====== Utils: localStorage helper ====== */
function loadUsed() {
  try { return new Set(JSON.parse(localStorage.getItem(USED_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveUsed() {
  localStorage.setItem(USED_KEY, JSON.stringify([...usedIds]));
}
function loadStats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATS_KEY) || '{"answered":0,"correct":0,"sessions":0,"totalPrize":0}');
    return {
      answered: saved.answered || 0,
      correct: saved.correct || 0,
      sessions: saved.sessions || 0,
      totalPrize: Number(saved.totalPrize) || 0
    };
  } catch {
    return { answered: 0, correct: 0, sessions: 0, totalPrize: 0 };
  }
}
function saveStats() {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

/* ====== Date helpers ====== */
function todayISODate() {
  const d = new Date();
  return d.toISOString().slice(0,10); // YYYY-MM-DD
}

/* ====== PASSWORD HASH (SHA-256) ====== */
async function sha256Hex(str) {
  const enc = new TextEncoder();
  const data = enc.encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const h = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
  return h;
}

/* ====== FIRESTORE helpers for credentials ======
Collection: credentials
Document ID: username (lowercased)
Fields:
  - passwordHash: string (sha256 hex)
  - createdAt: timestamp (Firestore Timestamp)
  - expiresAt: timestamp
*/
const CRED_COLLECTION = 'credentials';

async function fetchCredential(username) {
  if (!username) return null;
  const id = username.trim().toLowerCase();
  try {
    const doc = await db.collection(CRED_COLLECTION).doc(id).get();
    if (!doc.exists) return null;
    return doc.data();
  } catch (e) {
    console.error('fetchCredential err', e);
    return null;
  }
}

async function createCredential(username, password, days = 30) {
  const id = username.trim().toLowerCase();
  const passwordHash = await sha256Hex(password);
  const now = firebase.firestore.Timestamp.fromDate(new Date());
  const expires = firebase.firestore.Timestamp.fromDate(new Date(Date.now() + days * 24*3600*1000));
  await db.collection(CRED_COLLECTION).doc(id).set({
    passwordHash,
    createdAt: now,
    expiresAt: expires
  });
  return true;
}

async function deleteCredential(username) {
  const id = username.trim().toLowerCase();
  await db.collection(CRED_COLLECTION).doc(id).delete();
}

/* ====== LOGIN FLOW (daily check + expiry) ====== */
function shouldAskLogin() {
  // Agar hali login qilinmagan yoki oxirgi login bugungi kundan oldingi bo'lsa => talab qilinadi
  const last = localStorage.getItem('lastLoginDate'); // YYYY-MM-DD
  if (!last) return true;
  return last !== todayISODate();
}

function showLogin(msg) {
  loginMsg.textContent = msg || '';
  loginOverlay.classList.remove('hidden');
  loginOverlay.setAttribute('aria-hidden', 'false');
  // fokusni login inputga qo'yish
  setTimeout(() => loginUsername && loginUsername.focus(), 120);
}
function hideLogin() {
  loginOverlay.classList.add('hidden');
  loginOverlay.setAttribute('aria-hidden', 'true');
  loginMsg.textContent = '';
}

async function handleLogin() {
  const un = loginUsername.value && loginUsername.value.trim();
  const pw = loginPassword.value || '';
  if (!un || !pw) { loginMsg.textContent = 'Iltimos, login va parolni toʻldiring.'; return; }

  loginMsg.textContent = 'Tekshirilmoqda...';
  const cred = await fetchCredential(un);
  if (!cred) {
    loginMsg.textContent = 'Bunday login topilmadi. Iltimos, obuna sotib oling yoki admin bilan bogʻlaning.';
    return;
  }
  // check expiry
  const nowMs = Date.now();
  const expiresAt = cred.expiresAt ? cred.expiresAt.toDate().getTime() : 0;
  if (expiresAt <= nowMs) {
    loginMsg.textContent = 'Bu loginning muddati tugagan. Yangi obuna olishingiz kerak.';
    return;
  }
  const h = await sha256Hex(pw);
  if (h !== cred.passwordHash) {
    loginMsg.textContent = 'Parol noto‘g‘ri.';
    return;
  }

  // muvaffaqiyatli login
  localStorage.setItem('lastLoginDate', todayISODate());
  localStorage.setItem('loggedUser', un.trim().toLowerCase());
  hideLogin();
  loginUsername.value = '';
  loginPassword.value = '';
  loginMsg.textContent = '';
  // davom etish: hozirgi ekranni qoldirishga ruxsat
}

/* ====== Buy button (phone call modal) ====== */
buyBtn.addEventListener('click', () => {
  callModal.classList.remove('hidden');
  callModal.setAttribute('aria-hidden','false');
});

/* ====== Login button ====== */
doLoginBtn.addEventListener('click', () => {
  handleLogin();
});

/* Shortcuts: Enter in password triggers login */
loginPassword.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleLogin();
});

/* ====== On page load: check daily login ====== */
window.addEventListener('load', () => {
  // agar login kerak bo'lsa, ko'rsatamiz
  if (shouldAskLogin()) {
    showLogin('Dasturga kirish uchun login va parol kiriting.');
  }
})
// ✅ Sessiyani yakunlash — bosh sahifaga qaytaradi
endSessionBtn.addEventListener('click', () => {
  setScreen(screenStart);
});

// ✅ Sessiyani qayta topshirish — hozirgi sessiya savollarini qayta boshlaydi
retryBtn.addEventListener('click', () => {
  if (session.queue.length > 0) {
    session.index = 0;
    session.correct = 0;
    session.selection = null;
    session.review = [];
    setScreen(screenQuiz);
    loadQuestion();
    setProgress(0, session.queue.length);
  }
});

// ✅ Keyingi sessiya — yangi 10 ta savol oladi va boshlaydi
nextSessionBtn.addEventListener('click', () => {
  const nextSet = pickRemaining(SESSION_SIZE);
  if (!nextSet) {
    alert("Yangi sessiya uchun yetarli savol qolmagan.");
    return;
  }
  session.queue = nextSet;
  session.index = 0;
  session.correct = 0;
  session.selection = null;
  session.review = [];
  setScreen(screenQuiz);
  loadQuestion();
  setProgress(0, session.queue.length);
});

;

/* ====== FX (konfetti) ====== */
function confetti(duration = 1400, count = 140) {
  const ctx = fxLayer.getContext('2d');
  const { width, height } = fxLayer.getBoundingClientRect();
  fxLayer.width = width * devicePixelRatio;
  fxLayer.height = height * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);

  const colors = ['#7c3aed', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444'];
  const parts = Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: -20 - Math.random() * 40,
    vx: -1 + Math.random() * 2,
    vy: 2 + Math.random() * 3,
    size: 4 + Math.random() * 6,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * Math.PI,
    vr: -0.2 + Math.random() * 0.4
  }));

  let start = performance.now();
  (function frame(t) {
    const elapsed = t - start;
    if (elapsed > duration) {
      ctx.clearRect(0, 0, width, height);
      return;
    }
    ctx.clearRect(0, 0, width, height);
    parts.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    });
    requestAnimationFrame(frame);
  })(start);
}

/* ====== Quiz oqimi ======
   Quyidagi kod siz bergan original mantiqni asos qilib oldi.
*/

function pickRemaining(n) {
  const remaining = QUESTIONS.filter(q => !usedIds.has(q.id));
  if (remaining.length < n) return null;
  const arr = shuffle([...remaining]).slice(0, n);
  return arr;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function setScreen(id) {
  [screenStart, screenQuiz, screenResult].forEach(s => s.classList.remove('active'));
  id.classList.add('active');
}

function setProgress(i, total) {
  const pct = Math.round((i / total) * 100);
  progressBar.style.width = `${pct}%`;
  counterEl.textContent = `${i} / ${total}`;
}

function updateLifetimeStats() {
  const prize = Number(stats.totalPrize) || 0;
  lifetimeStatsEl.textContent = `Jami: ${stats.answered} savol | To‘g‘ri: ${stats.correct} | Sessiya: ${stats.sessions} | Yutuq: ${prize} soom`;
}

function formatExplain(q, chosenIdx, correctIdx, shuffledOptions) {
  const chosen = chosenIdx != null ? shuffledOptions[chosenIdx] : null;
  const correct = shuffledOptions[correctIdx];
  const chosenTxt = chosen != null ? q.options[chosen] : 'tanlanmagan';
  const correctTxt = q.options[correct];
  return {
    title: q.q,
    chosen: chosenTxt,
    correct: correctTxt,
    explain: q.explain
  };
}

/* Tema */
function applyTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light') document.documentElement.classList.add('light');
  else document.documentElement.classList.remove('light');
}
function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light');
  localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark');
}

/* ====== Quiz core ====== */
function startSession() {
  // Agar login so'ralsa, kirish tugallanmaguncha bloklanadi
  if (shouldAskLogin()) {
    showLogin('Saytga kirish uchun login va parol kiriting.');
    return;
  }

  const picked = pickRemaining(SESSION_SIZE);
  if (!picked) {
    alert("Savollar tugadi! Iltimos, 'Boshidan' tugmasi orqali qayta boshlang.");
    return;
  }

  session.queue = picked;
  session.index = 0;
  session.correct = 0;
  session.selection = null;
  session.shuffled = [];
  session.review = [];

  setScreen(screenQuiz);
  renderCurrent();
  setProgress(0, SESSION_SIZE);
}

function renderCurrent() {
  const q = session.queue[session.index];
  const map = shuffle(q.options.map((_, i) => i));
  session.shuffled[session.index] = map;

  questionText.textContent = q.q;
  optionsList.innerHTML = '';
  map.forEach((origIdx, idx) => {
    const li = document.createElement('li');
    li.className = 'option';
    li.setAttribute('role', 'option');
    li.setAttribute('tabindex', '0');
    li.dataset.idx = idx;

    li.innerHTML = `
      <span class="bullet"></span>
      <span class="text">${q.options[origIdx]}</span>
    `;

    const select = () => selectOption(idx);

    li.addEventListener('click', select);
    li.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); }
    });

    optionsList.appendChild(li);
  });

  checkBtn.disabled = true;
  nextBtn.disabled = true;

  updateCounterBar();
}

function selectOption(idx) {
  session.selection = idx;
  [...optionsList.children].forEach(li => li.classList.remove('selected'));
  const li = optionsList.querySelector(`[data-idx="${idx}"]`);
  if (li) li.classList.add('selected');
  checkBtn.disabled = false;
}

function checkAnswer() {
  const q = session.queue[session.index];
  if (session.selection == null) return;
  const map = session.shuffled[session.index];

  const correctOrig = q.answer;
  const correctShuffledIndex = map.findIndex(orig => orig === correctOrig);

  [...optionsList.children].forEach((li, idx) => {
    li.classList.toggle('correct', idx === correctShuffledIndex);
    if (idx === session.selection && session.selection !== correctShuffledIndex) {
      li.classList.add('incorrect');
    }
  });

  const isCorrect = session.selection === correctShuffledIndex;
  if (isCorrect) session.correct++;

  session.review.push({
    qid: q.id,
    ...formatExplain(q, session.selection, correctShuffledIndex, map)
  });

  usedIds.add(q.id);
  saveUsed();

  checkBtn.disabled = true;
  nextBtn.disabled = false;

  setProgress(session.index + 1, SESSION_SIZE);
}

function nextQuestion() {
  session.index++;
  session.selection = null;

  if (session.index >= SESSION_SIZE) {
    finishSession();
  } else {
    renderCurrent();
  }
}

function finishSession() {
  stats.sessions++;
  stats.answered += SESSION_SIZE;
  stats.correct += session.correct;
  let perfectSession = session.correct === SESSION_SIZE;
  if (perfectSession) {
    stats.totalPrize += 5000;
  }
  saveStats();
  updateLifetimeStats();

  setScreen(screenResult);
  scoreBadge.textContent = `${session.correct} / ${SESSION_SIZE}`;
  if (perfectSession) {
    scoreMessage.textContent = "Ideal natija! Mantiqiy fokus zo‘r! +5000 soom yutuq! Yutuq miqdori 5000000 soomdan oshganda, yutuqni haqiqiy pulga almashtirish uchun murojaat qilishingiz mumkin.";
    confetti();
  } else if (session.correct >= 7) {
    scoreMessage.textContent = "Zo‘r ishladingiz! Yana ozroq diqqat — mukofot sizniki.";
  } else {
    scoreMessage.textContent = "Harakat davom etadi. Mantiq mashqi — kuch!";
  }

  if (stats.totalPrize >= 5000000) {
    withdrawMessage.classList.remove('hidden');
  } else {
    withdrawMessage.classList.add('hidden');
  }

  renderReview(false);
}

function renderReview(expand) {
  if (!expand) {
    reviewList.classList.add('hidden');
    return;
  }
  reviewList.innerHTML = '';
  session.review.forEach((r, i) => {
    const div = document.createElement('div');
    div.className = 'review-item';
    div.innerHTML = `
      <h4>${i + 1}. ${r.title}</h4>
      <p><strong>Siz tanladingiz:</strong> ${r.chosen}</p>
      <p><strong>To‘g‘ri javob:</strong> ${r.correct}</p>
      <p class="explain">${r.explain}</p>
    `;
    reviewList.appendChild(div);
  });
  reviewList.classList.remove('hidden');
}

/* ====== Eventlar ====== */
startBtn.addEventListener('click', () => {
  startSession();
});

checkBtn.addEventListener('click', () => {
  checkAnswer();
});

nextBtn.addEventListener('click', () => {
  nextQuestion();
});

againBtn.addEventListener('click', () => {
  setScreen(screenStart);
});

reviewBtn.addEventListener('click', () => {
  const isHidden = reviewList.classList.contains('hidden');
  renderReview(isHidden);
  reviewBtn.textContent = isHidden ? 'Yopish' : 'Savollarni ko‘rish';
});

resetBankBtn.addEventListener('click', () => {
  if (confirm("Savollar bankini to‘liq qayta o'rnatamizmi? (Oldingi ishlatilgan savollar yana qaytariladi)")) {
    usedIds = new Set();
    saveUsed();
    alert("Savollar banki to‘liq qayta o'rnatildi. Endi savollar yana yangilanadi.");
  }
});

themeToggle.addEventListener('click', toggleTheme);

function updateCounterBar() {
  counterEl.textContent = `${session.index + 1} / ${SESSION_SIZE}`;
}

yearEl.textContent = new Date().getFullYear();

/* ====== Init ====== */
applyTheme();
updateLifetimeStats();

/* Klaviatura qisqacha qulayliklar */
document.addEventListener('keydown', (e) => {
  const onQuiz = screenQuiz.classList.contains('active');
  if (!onQuiz) return;
  if (e.key >= '1' && e.key <= '9') {
    const idx = parseInt(e.key, 10) - 1;
    const li = optionsList.children[idx];
    if (li) li.click();
  } else if (e.key === 'Enter') {
    if (!checkBtn.disabled) checkBtn.click();
    else if (!nextBtn.disabled) nextBtn.click();
  }
});

/* ====== QUESTIONS (data included here) ====== */
const QUESTIONS = [
  { id: 1, q: "Choose the correct form: She ___ to school every day.", options: ["go", "goes", "going", "gone"], answer: 1, explain: "Present simple, third person singular: She goes." },
  { id: 2, q: "Translate into English: 'kitob' ", options: ["book","pen","desk","page"], answer: 0, explain: "'Kitob' means 'book'." },
  { id: 3, q: "Choose the correct sentence.", options: ["He can to swim.","He cans swim.","He can swim.","He can swims."], answer: 2, explain: "The correct form is 'He can swim.' without 'to' or 's'." },
  { id: 4, q: "Translate into English: 'qalam' ", options: ["page","pen","bag","chair"], answer: 1, explain: "'Qalam' means 'pen'." },
  { id: 5, q: "Choose the correct word: My father ___ a doctor.", options: ["is","are","am","be"], answer: 0, explain: "Singular subject 'my father' → 'is'." },
  { id: 6, q: "Translate into English: 'stol' ", options: ["table","school","board","room"], answer: 0, explain: "'Stol' means 'table'." },
  { id: 7, q: "Choose the correct sentence.", options: ["I doesn’t like tea.","I don’t likes tea.","I don’t like tea.","I not like tea."], answer: 2, explain: "Correct negative form: I don’t like tea." },
  { id: 8, q: "Translate into English: 'o‘qituvchi' ", options: ["teacher","student","driver","worker"], answer: 0, explain: "'O‘qituvchi' means 'teacher'." },
  { id: 9, q: "Choose the correct form: They ___ very happy yesterday.", options: ["is","are","were","was"], answer: 2, explain: "Past tense plural → 'were'." },
  { id: 10, q: "Translate into English: 'o‘quvchi' ", options: ["student","teacher","pupil","both 1 and 3"], answer: 3, explain: "'O‘quvchi' can be 'student' or 'pupil'." },
  { id: 11, q: "Choose the correct sentence.", options: ["There is many books.","There are many books.","There was many books.","There am many books."], answer: 1, explain: "Plural noun 'books' → 'There are many books'." },
  { id: 12, q: "Translate into English: 'deraza' ", options: ["door","window","wall","roof"], answer: 1, explain: "'Deraza' means 'window'." },
  { id: 13, q: "Choose the correct form: She ___ her homework now.", options: ["do","does","is doing","did"], answer: 2, explain: "Present continuous → 'is doing'." },
  { id: 14, q: "Translate into English: 'eshik' ", options: ["roof","floor","door","window"], answer: 2, explain: "'Eshik' means 'door'." },
  { id: 15, q: "Choose the correct word: I have ___ apple.", options: ["a","an","the","some"], answer: 1, explain: "Before a vowel sound → 'an apple'." },
  { id: 16, q: "Translate into English: 'uy' ", options: ["house","flat","room","home"], answer: 0, explain: "'Uy' usually means 'house'." },
  { id: 17, q: "Choose the correct sentence.", options: ["He don’t play football.","He doesn’t plays football.","He doesn’t play football.","He not play football."], answer: 2, explain: "Correct: He doesn’t play football." },
  { id: 18, q: "Translate into English: 'maktab' ", options: ["school","college","university","classroom"], answer: 0, explain: "'Maktab' means 'school'." },
  { id: 19, q: "Choose the correct form: We ___ English every day.", options: ["study","studies","studying","studied"], answer: 0, explain: "Present simple plural → 'study'." },
  { id: 20, q: "Translate into English: 'telefon' ", options: ["radio","phone","TV","computer"], answer: 1, explain: "'Telefon' means 'phone'." },
  { id: 21, q: "Choose the correct word: They ___ at the park now.", options: ["is","are","am","was"], answer: 1, explain: "Plural subject + present continuous → 'They are at the park now'." },
  { id: 22, q: "Translate into English: 'oila' ", options: ["family","friend","team","group"], answer: 0, explain: "'Oila' means 'family'." },
  { id: 23, q: "Choose the correct sentence.", options: ["We is students.","We are students.","We am students.","We be students."], answer: 1, explain: "Correct plural form is 'We are students'." },
  { id: 24, q: "Translate into English: 'do‘st' ", options: ["enemy","teacher","friend","classmate"], answer: 2, explain: "'Do‘st' means 'friend'." },
  { id: 25, q: "Choose the correct form: She ___ TV yesterday.", options: ["watch","is watching","watched","watching"], answer: 2, explain: "Past simple → 'She watched TV yesterday'." },
  { id: 26, q: "Translate into English: 'yil' ", options: ["month","week","day","year"], answer: 3, explain: "'Yil' means 'year'." },
  { id: 27, q: "Choose the correct sentence.", options: ["Does he likes pizza?","Do he like pizza?","Does he like pizza?","He does like pizza?"], answer: 2, explain: "Question form → 'Does he like pizza?'" },
  { id: 28, q: "Translate into English: 'hafta' ", options: ["day","month","week","year"], answer: 2, explain: "'Hafta' means 'week'." },
  { id: 29, q: "Choose the correct word: My brother ___ football very well.", options: ["play","plays","playing","played"], answer: 1, explain: "Third person singular → 'plays'." },
  { id: 30, q: "Translate into English: 'kun' ", options: ["night","day","time","week"], answer: 1, explain: "'Kun' means 'day'." },
  { id: 31, q: "Choose the correct sentence.", options: ["I am go to school.","I goes to school.","I am going to school.","I going school."], answer: 2, explain: "Present continuous → 'I am going to school'." },
  { id: 32, q: "Translate into English: 'kecha' ", options: ["today","tomorrow","yesterday","tonight"], answer: 2, explain: "'Kecha' means 'yesterday'." },
  { id: 33, q: "Choose the correct form: There ___ a book on the table.", options: ["is","are","were","be"], answer: 0, explain: "Singular subject → 'There is a book'." },
  { id: 34, q: "Translate into English: 'bugun' ", options: ["tomorrow","today","yesterday","now"], answer: 1, explain: "'Bugun' means 'today'." },
  { id: 35, q: "Choose the correct sentence.", options: ["She don’t like milk.","She doesn’t like milk.","She doesn’t likes milk.","She no like milk."], answer: 1, explain: "Correct negative → 'She doesn’t like milk'." },
  { id: 36, q: "Translate into English: 'ertalab' ", options: ["morning","evening","afternoon","night"], answer: 0, explain: "'Ertalab' means 'morning'." },
  { id: 37, q: "Choose the correct word: My parents ___ teachers.", options: ["is","are","was","am"], answer: 1, explain: "Plural subject → 'are'." },
  { id: 38, q: "Translate into English: 'kechqurun' ", options: ["morning","night","evening","afternoon"], answer: 2, explain: "'Kechqurun' means 'evening'." },
  { id: 39, q: "Choose the correct sentence.", options: ["They can plays chess.","They can play chess.","They cans play chess.","They can to play chess."], answer: 1, explain: "Correct → 'They can play chess'." },
  { id: 40, q: "Translate into English: 'tun' ", options: ["evening","night","day","morning"], answer: 1, explain: "'Tun' means 'night'." },
  { id: 41, q: "Choose the correct form: We ___ to the park last Sunday.", options: ["go","goes","went","going"], answer: 2, explain: "Past simple → 'went'." },
  { id: 42, q: "Translate into English: 'soat' ", options: ["hour","minute","time","clock"], answer: 3, explain: "'Soat' usually means 'clock'." },
  { id: 43, q: "Choose the correct sentence.", options: ["I was play football.","I were playing football.","I was playing football.","I am played football."], answer: 2, explain: "Past continuous → 'I was playing football'." },
  { id: 44, q: "Translate into English: 'daqiqa' ", options: ["second","minute","hour","time"], answer: 1, explain: "'Daqiqa' means 'minute'." },
  { id: 45, q: "Choose the correct form: He ___ already finished his work.", options: ["have","has","had","having"], answer: 1, explain: "Present perfect third person singular → 'has finished'." },
  { id: 46, q: "Translate into English: 'sekund' ", options: ["hour","time","minute","second"], answer: 3, explain: "'Sekund' means 'second'." },
  { id: 47, q: "Choose the correct sentence.", options: ["We was at home yesterday.","We were at home yesterday.","We are at home yesterday.","We am at home yesterday."], answer: 1, explain: "Correct past plural form → 'We were at home'." },
  { id: 48, q: "Translate into English: 'oy' ", options: ["year","month","week","day"], answer: 1, explain: "'Oy' means 'month'." },
  { id: 49, q: "Choose the correct word: They ___ in London for two years.", options: ["live","lives","are living","have lived"], answer: 3, explain: "Present perfect → 'They have lived'." },
  { id: 50, q: "Translate into English: 'quyosh' ", options: ["sun","moon","star","sky"], answer: 0, explain: "'Quyosh' means 'sun'." },
  { id: 51, q: "Choose the correct form: She ___ never been to London.", options: ["has","have","was","is"], answer: 0, explain: "Present perfect singular → 'She has never been'." },
  { id: 52, q: "Translate into English: 'oyna' ", options: ["mirror","glass","window","bottle"], answer: 0, explain: "'Oyna' means 'mirror'." },
  { id: 53, q: "Choose the correct sentence.", options: ["Does they play football?","Do they play football?","Do they plays football?","They does play football?"], answer: 1, explain: "Plural subject → 'Do they play football?'" },
  { id: 54, q: "Translate into English: 'osmon' ", options: ["ground","earth","sky","air"], answer: 2, explain: "'Osmon' means 'sky'." },
  { id: 55, q: "Choose the correct word: We ___ dinner at 7 p.m. every day.", options: ["have","has","having","had"], answer: 0, explain: "Present simple plural → 'We have dinner'." },
  { id: 56, q: "Translate into English: 'oy' (osmonda) ", options: ["sun","moon","star","planet"], answer: 1, explain: "'Oy' in the sky means 'moon'." },
  { id: 57, q: "Choose the correct sentence.", options: ["I musts go now.","I must go now.","I must to go now.","I must going now."], answer: 1, explain: "Correct modal verb form: 'I must go now'." },
  { id: 58, q: "Translate into English: 'yulduz' ", options: ["planet","sun","star","moon"], answer: 2, explain: "'Yulduz' means 'star'." },
  { id: 59, q: "Choose the correct form: He ___ a car last year.", options: ["buy","buys","bought","buying"], answer: 2, explain: "Past simple → 'bought'." },
  { id: 60, q: "Translate into English: 'daraxt' ", options: ["tree","flower","leaf","forest"], answer: 0, explain: "'Daraxt' means 'tree'." },
  { id: 61, q: "Choose the correct sentence.", options: ["She is taller than me.","She is more tall than me.","She taller than me.","She is tallest than me."], answer: 0, explain: "Correct comparative → 'taller than'." },
  { id: 62, q: "Translate into English: 'gulli' ", options: ["tree","flower","leaf","grass"], answer: 1, explain: "'Gul' means 'flower'." },
  { id: 63, q: "Choose the correct form: They ___ football when it started to rain.", options: ["played","were playing","plays","are playing"], answer: 1, explain: "Past continuous → 'were playing'." },
  { id: 64, q: "Translate into English: 'o‘t' ", options: ["grass","tree","flower","forest"], answer: 0, explain: "'O‘t' means 'grass'." },
  { id: 65, q: "Choose the correct sentence.", options: ["There are a pen on the table.","There is a pen on the table.","There were a pen on the table.","There am a pen on the table."], answer: 1, explain: "Singular → 'There is a pen'." },
  { id: 66, q: "Translate into English: 'barg' ", options: ["branch","leaf","root","stem"], answer: 1, explain: "'Barg' means 'leaf'." },
  { id: 67, q: "Choose the correct form: I ___ my homework yet.", options: ["didn’t finished","haven’t finished","don’t finish","not finished"], answer: 1, explain: "Present perfect negative → 'haven’t finished'." },
  { id: 68, q: "Translate into English: 'meva' ", options: ["vegetable","fruit","flower","seed"], answer: 1, explain: "'Meva' means 'fruit'." },
  { id: 69, q: "Choose the correct sentence.", options: ["He is the most tall in the class.","He is tallest in the class.","He is the tallest in the class.","He is more tallest in the class."], answer: 2, explain: "Superlative → 'the tallest'." },
  { id: 70, q: "Translate into English: 'sabzavot' ", options: ["vegetable","fruit","leaf","seed"], answer: 0, explain: "'Sabzavot' means 'vegetable'." },
  { id: 71, q: "Choose the correct form: We ___ to the cinema tomorrow.", options: ["go","goes","are going","went"], answer: 2, explain: "Future plan → 'are going'." },
  { id: 72, q: "Translate into English: 'kartoshka' ", options: ["tomato","onion","potato","cabbage"], answer: 2, explain: "'Kartoshka' means 'potato'." },
  { id: 73, q: "Choose the correct sentence.", options: ["She can sings.","She can sing.","She cans sing.","She can to sing."], answer: 1, explain: "Correct modal form: 'can + verb' → 'She can sing'." },
  { id: 74, q: "Translate into English: 'piyoz' ", options: ["potato","onion","carrot","cabbage"], answer: 1, explain: "'Piyoz' means 'onion'." },
  { id: 75, q: "Choose the correct form: I ___ my keys yesterday.", options: ["lose","lost","loses","losing"], answer: 1, explain: "Past simple → 'lost'." },
  { id: 76, q: "Translate into English: 'sabzi' ", options: ["carrot","potato","cucumber","apple"], answer: 0, explain: "'Sabzi' means 'carrot'." },
  { id: 77, q: "Choose the correct sentence.", options: ["They doesn’t like fish.","They don’t like fish.","They not like fish.","They no like fish."], answer: 1, explain: "Plural negative → 'They don’t like fish'." },
  { id: 78, q: "Translate into English: 'bodring' ", options: ["potato","carrot","cucumber","pepper"], answer: 2, explain: "'Bodring' means 'cucumber'." },
  { id: 79, q: "Choose the correct form: She ___ English for five years.", options: ["learns","is learning","has learned","learn"], answer: 2, explain: "Present perfect → 'has learned'." },
  { id: 80, q: "Translate into English: 'qalampir' ", options: ["cabbage","pepper","potato","apple"], answer: 1, explain: "'Qalampir' means 'pepper'." },
  { id: 81, q: "Choose the correct sentence.", options: ["I am knowing the answer.","I know the answer.","I knowing the answer.","I knows the answer."], answer: 1, explain: "Stative verbs are not used in continuous → 'I know'." },
  { id: 82, q: "Translate into English: 'olma' ", options: ["pear","apple","peach","plum"], answer: 1, explain: "'Olma' means 'apple'." },
  { id: 83, q: "Choose the correct form: By 2020, he ___ in New York for 10 years.", options: ["lives","lived","has lived","had lived"], answer: 3, explain: "Past perfect → 'had lived'." },
  { id: 84, q: "Translate into English: 'nok' ", options: ["apple","pear","peach","plum"], answer: 1, explain: "'Nok' means 'pear'." },
  { id: 85, q: "Choose the correct sentence.", options: ["She speak English well.","She speaks English well.","She speaking English well.","She is speak English well."], answer: 1, explain: "Third person singular → 'She speaks'." },
  { id: 86, q: "Translate into English: 'shaftoli' ", options: ["plum","peach","apple","grape"], answer: 1, explain: "'Shaftoli' means 'peach'." },
  { id: 87, q: "Choose the correct form: I ___ my grandmother next week.", options: ["visit","will visit","visited","visits"], answer: 1, explain: "Future simple → 'will visit'." },
  { id: 88, q: "Translate into English: 'uzum' ", options: ["melon","grape","pear","plum"], answer: 1, explain: "'Uzum' means 'grape'." },
  { id: 89, q: "Choose the correct sentence.", options: ["Did you saw him?","Do you saw him?","Did you see him?","You did see him?"], answer: 2, explain: "Past simple question → 'Did you see him?'" },
  { id: 90, q: "Translate into English: 'anor' ", options: ["pomegranate","cherry","peach","plum"], answer: 0, explain: "'Anor' means 'pomegranate'." },
  { id: 91, q: "Choose the correct form: If it ___ tomorrow, we will stay home.", options: ["rains","rain","rained","is raining"], answer: 0, explain: "First conditional → 'If it rains'." },
  { id: 92, q: "Translate into English: 'gilos' ", options: ["cherry","plum","apple","grape"], answer: 0, explain: "'Gilos' means 'cherry'." },
  { id: 93, q: "Choose the correct sentence.", options: ["She didn’t went to school.","She didn’t go to school.","She doesn’t went to school.","She don’t go school."], answer: 1, explain: "Correct past negative → 'didn’t go'." },
  { id: 94, q: "Translate into English: 'o‘rik' ", options: ["plum","apricot","peach","pear"], answer: 1, explain: "'O‘rik' means 'apricot'." },
  { id: 95, q: "Choose the correct form: This book is ___ than that one.", options: ["good","better","best","more good"], answer: 1, explain: "Comparative form → 'better'." },
  { id: 96, q: "Translate into English: 'qovun' ", options: ["melon","watermelon","pumpkin","pear"], answer: 0, explain: "'Qovun' means 'melon'." },
  { id: 97, q: "Choose the correct sentence.", options: ["There is two apples.","There are two apples.","There was two apples.","There am two apples."], answer: 1, explain: "Plural subject → 'There are'." },
  { id: 98, q: "Translate into English: 'tarvuz' ", options: ["melon","pear","watermelon","pumpkin"], answer: 2, explain: "'Tarvuz' means 'watermelon'." },
  { id: 99, q: "Choose the correct form: She ___ her homework when I called her.", options: ["do","did","was doing","does"], answer: 2, explain: "Past continuous → 'was doing'." },
  { id: 100, q: "Translate into English: 'banan' ", options: ["banana","apple","pear","melon"], answer: 0, explain: "'Banan' means 'banana'." },
  { id: 101, q: "Choose the correct sentence.", options: ["He don’t work here.","He doesn’t work here.","He not work here.","He isn’t work here."], answer: 1, explain: "Correct negative → 'He doesn’t work here'." },
  { id: 102, q: "Translate into English: 'apelsin' ", options: ["orange","apple","pear","plum"], answer: 0, explain: "'Apelsin' means 'orange'." },
  { id: 103, q: "Choose the correct form: I ___ breakfast at 8 every morning.", options: ["have","has","having","had"], answer: 0, explain: "First person singular → 'have'." },
  { id: 104, q: "Translate into English: 'limon' ", options: ["lemon","lime","orange","apple"], answer: 0, explain: "'Limon' means 'lemon'." },
  { id: 105, q: "Choose the correct sentence.", options: ["They goes to school every day.","They go to school every day.","They going to school every day.","They are goes to school every day."], answer: 1, explain: "Plural subject → 'They go'." },
  { id: 106, q: "Translate into English: 'shaftoli' (takror) ", options: ["plum","peach","pear","cherry"], answer: 1, explain: "'Shaftoli' means 'peach'." },
  { id: 107, q: "Choose the correct form: By the time I arrived, they ___ dinner.", options: ["finish","finished","had finished","finishing"], answer: 2, explain: "Past perfect → 'had finished'." },
  { id: 108, q: "Translate into English: 'olcha' ", options: ["sour cherry","pear","plum","apple"], answer: 0, explain: "'Olcha' means 'sour cherry'." },
  { id: 109, q: "Choose the correct sentence.", options: ["Is you a student?","Are you a student?","You are a student?","You is a student?"], answer: 1, explain: "Correct question form → 'Are you a student?'" },
  { id: 110, q: "Translate into English: 'behi' ", options: ["quince","peach","plum","pear"], answer: 0, explain: "'Behi' means 'quince'." },
  { id: 111, q: "Choose the correct form: They ___ here since morning.", options: ["are","have been","was","is"], answer: 1, explain: "Present perfect continuous meaning → 'have been'." },
  { id: 112, q: "Translate into English: 'anjir' ", options: ["fig","date","plum","grape"], answer: 0, explain: "'Anjir' means 'fig'." },
  { id: 113, q: "Choose the correct sentence.", options: ["He speak French.","He speaking French.","He speaks French.","He is speaks French."], answer: 2, explain: "Third person singular → 'He speaks'." },
  { id: 114, q: "Translate into English: 'xurmo' ", options: ["fig","date","plum","peach"], answer: 1, explain: "'Xurmo' means 'date'." },
  { id: 115, q: "Choose the correct form: I ___ my homework before dinner yesterday.", options: ["finish","finished","had finished","finishing"], answer: 1, explain: "Past simple → 'finished'." },
  { id: 116, q: "Translate into English: 'limonad' ", options: ["lemonade","juice","tea","water"], answer: 0, explain: "'Limonad' means 'lemonade'." },
  { id: 117, q: "Choose the correct sentence.", options: ["There is some apples.","There are some apples.","There was some apples.","There am some apples."], answer: 1, explain: "Plural → 'There are some apples'." },
  { id: 118, q: "Translate into English: 'sharbat' ", options: ["juice","water","tea","milk"], answer: 0, explain: "'Sharbat' means 'juice'." },
  { id: 119, q: "Choose the correct form: I ___ in Tashkent last summer.", options: ["am","is","was","were"], answer: 2, explain: "Past simple singular → 'was'." },
  { id: 120, q: "Translate into English: 'sut' ", options: ["milk","cream","butter","yogurt"], answer: 0, explain: "'Sut' means 'milk'." },
  { id: 121, q: "Choose the correct sentence.", options: ["He not at home.","He isn’t at home.","He doesn’t at home.","He no at home."], answer: 1, explain: "Correct negative form → 'He isn’t at home'." },
  { id: 122, q: "Translate into English: 'qaymoq' ", options: ["butter","cream","yogurt","cheese"], answer: 1, explain: "'Qaymoq' means 'cream'." },
  { id: 123, q: "Choose the correct form: They ___ to the party last night.", options: ["go","goes","went","going"], answer: 2, explain: "Past simple → 'went'." },
  { id: 124, q: "Translate into English: 'pishloq' ", options: ["bread","butter","cheese","cream"], answer: 2, explain: "'Pishloq' means 'cheese'." },
  { id: 125, q: "Choose the correct sentence.", options: ["We didn’t went there.","We didn’t go there.","We doesn’t go there.","We no go there."], answer: 1, explain: "Correct past negative → 'didn’t go'." },
  { id: 126, q: "Translate into English: 'non' ", options: ["bread","cake","cookie","rice"], answer: 0, explain: "'Non' means 'bread'." },
  { id: 127, q: "Choose the correct form: He ___ English when he was a child.", options: ["learned","learns","learn","learning"], answer: 0, explain: "Past simple → 'learned'." },
  { id: 128, q: "Translate into English: 'shakar' ", options: ["salt","sugar","flour","oil"], answer: 1, explain: "'Shakar' means 'sugar'." },
  { id: 129, q: "Choose the correct sentence.", options: ["Are there some water?","Is there some water?","There are some water.","There is any water?"], answer: 1, explain: "Uncountable noun → 'Is there some water?'" },
  { id: 130, q: "Translate into English: 'tuz' ", options: ["flour","sugar","salt","bread"], answer: 2, explain: "'Tuz' means 'salt'." },
  { id: 131, q: "Choose the correct form: I ___ a letter yesterday.", options: ["write","writes","wrote","writing"], answer: 2, explain: "Past simple → 'wrote'." },
  { id: 132, q: "Translate into English: 'guruch' ", options: ["bread","rice","corn","pasta"], answer: 1, explain: "'Guruch' means 'rice'." },
  { id: 133, q: "Choose the correct sentence.", options: ["She is never late.","She never is late.","She late never is.","She is late never."], answer: 0, explain: "Correct word order → 'She is never late'." },
  { id: 134, q: "Translate into English: 'makaron' ", options: ["pasta","bread","rice","cake"], answer: 0, explain: "'Makaron' means 'pasta'." },
  { id: 135, q: "Choose the correct form: They ___ already eaten lunch.", options: ["have","has","had","having"], answer: 0, explain: "Present perfect plural → 'have eaten'." },
  { id: 136, q: "Translate into English: 'tuxum' ", options: ["egg","meat","bread","fish"], answer: 0, explain: "'Tuxum' means 'egg'." },
  { id: 137, q: "Choose the correct sentence.", options: ["Does she likes tea?","Does she like tea?","Do she like tea?","She does like tea?"], answer: 1, explain: "Correct form → 'Does she like tea?'" },
  { id: 138, q: "Translate into English: 'go‘sht' ", options: ["meat","fish","egg","bread"], answer: 0, explain: "'Go‘sht' means 'meat'." },
  { id: 139, q: "Choose the correct form: She ___ to Paris twice.", options: ["was","is","has been","had been"], answer: 2, explain: "Present perfect → 'has been'." },
  { id: 140, q: "Translate into English: 'baliq' ", options: ["egg","fish","meat","bread"], answer: 1, explain: "'Baliq' means 'fish'." },
  { id: 141, q: "Choose the correct sentence.", options: ["He is cleverest in the group.","He is the most clever in the group.","He is cleverer in the group.","He is more cleverest in the group."], answer: 1, explain: "Superlative with long adjectives → 'the most clever'." },
  { id: 142, q: "Translate into English: 'sut mahsuloti' ", options: ["meat product","milk product","dairy product","bread product"], answer: 2, explain: "'Sut mahsuloti' means 'dairy product'." },
  { id: 143, q: "Choose the correct form: She ___ TV when the phone rang.", options: ["was watching","watched","is watching","watching"], answer: 0, explain: "Past continuous → 'was watching'." },
  { id: 144, q: "Translate into English: 'asal' ", options: ["honey","jam","sugar","cream"], answer: 0, explain: "'Asal' means 'honey'." },
  { id: 145, q: "Choose the correct sentence.", options: ["He is more taller than me.","He is taller than me.","He taller than me.","He is tallest than me."], answer: 1, explain: "Correct comparative → 'taller than'." },
  { id: 146, q: "Translate into English: 'murabbo' ", options: ["jam","juice","syrup","cream"], answer: 0, explain: "'Murabbo' means 'jam'." },
  { id: 147, q: "Choose the correct form: I ___ lunch when you arrived.", options: ["am having","have","was having","had"], answer: 2, explain: "Past continuous → 'was having'." },
  { id: 148, q: "Translate into English: 'shokolad' ", options: ["chocolate","cake","cookie","candy"], answer: 0, explain: "'Shokolad' means 'chocolate'." },
  { id: 149, q: "Choose the correct sentence.", options: ["There is much people here.","There are much people here.","There are many people here.","There is many people here."], answer: 2, explain: "Correct plural form → 'There are many people'." },
  { id: 150, q: "Translate into English: 'konfet' ", options: ["cake","candy","cookie","bread"], answer: 1, explain: "'Konfet' means 'candy'." },
  { id: 151, q: "Choose the correct form: He ___ a new car this month.", options: ["buys","is buying","buy","bought"], answer: 1, explain: "Present continuous for current action → 'is buying'." },
  { id: 152, q: "Translate into English: 'pishiriq' ", options: ["candy","cake","cookie","jam"], answer: 1, explain: "'Pishiriq' means 'cake'." },
  { id: 153, q: "Choose the correct sentence.", options: ["I was sleep when you called.","I was sleeping when you called.","I sleeping when you called.","I slept when you are calling."], answer: 1, explain: "Past continuous → 'I was sleeping'." },
  { id: 154, q: "Translate into English: 'pechene' ", options: ["cookie","cake","bread","jam"], answer: 0, explain: "'Pechene' means 'cookie'." },
  { id: 155, q: "Choose the correct form: By next year, we ___ in this city for 10 years.", options: ["will live","will have lived","live","lived"], answer: 1, explain: "Future perfect → 'will have lived'." },
  { id: 156, q: "Translate into English: 'muzqaymoq' ", options: ["ice","ice cream","cream","yogurt"], answer: 1, explain: "'Muzqaymoq' means 'ice cream'." },
  { id: 157, q: "Choose the correct sentence.", options: ["She has just finish her homework.","She has just finished her homework.","She just has finished her homework.","She have just finished her homework."], answer: 1, explain: "Correct present perfect → 'has finished'." },
  { id: 158, q: "Translate into English: 'ichimlik' ", options: ["drink","food","meal","water"], answer: 0, explain: "'Ichimlik' means 'drink'." },
  { id: 159, q: "Choose the correct form: We ___ here since 2015.", options: ["live","lives","are living","have lived"], answer: 3, explain: "Present perfect → 'have lived'." },
  { id: 160, q: "Translate into English: 'ovqat' ", options: ["food","meal","dish","lunch"], answer: 0, explain: "'Ovqat' means 'food'." },
  { id: 161, q: "Choose the correct sentence.", options: ["She can speaks English.","She cans speak English.","She can speak English.","She can to speaks English."], answer: 2, explain: "Correct modal verb → 'can + verb'." },
  { id: 162, q: "Translate into English: 'tushlik' ", options: ["dinner","breakfast","lunch","meal"], answer: 2, explain: "'Tushlik' means 'lunch'." },
  { id: 163, q: "Choose the correct form: I ___ my keys. Can you help me?", options: ["lose","lost","have lost","am losing"], answer: 2, explain: "Present perfect → 'have lost'." },
  { id: 164, q: "Translate into English: 'ertalabki nonushta' ", options: ["breakfast","lunch","dinner","meal"], answer: 0, explain: "'Nonushta' means 'breakfast'." },
  { id: 165, q: "Choose the correct sentence.", options: ["She didn’t finished it.","She hasn’t finish it.","She didn’t finish it.","She don’t finished it."], answer: 2, explain: "Correct past simple negative → 'didn’t finish'." },
  { id: 166, q: "Translate into English: 'kechki ovqat' ", options: ["dinner","breakfast","lunch","meal"], answer: 0, explain: "'Kechki ovqat' means 'dinner'." },
  { id: 167, q: "Choose the correct form: They ___ when I saw them.", options: ["are working","were working","work","worked"], answer: 1, explain: "Past continuous → 'were working'." },
  { id: 168, q: "Translate into English: 'taom' ", options: ["meal","food","dish","snack"], answer: 2, explain: "'Taom' means 'dish'." },
  { id: 169, q: "Choose the correct sentence.", options: ["Do you can swim?","Can you swim?","You can swim?","Can swim you?"], answer: 1, explain: "Correct modal question form → 'Can you swim?'" },
  { id: 170, q: "Translate into English: 'gazak' ", options: ["snack","meal","dish","dinner"], answer: 0, explain: "'Gazak' means 'snack'." },
  { id: 171, q: "Choose the correct form: While I ___ TV, the lights went out.", options: ["watch","was watching","watched","am watching"], answer: 1, explain: "Past continuous → 'was watching'." },
  { id: 172, q: "Translate into English: 'osh' ", options: ["bread","meal","pilaf","soup"], answer: 2, explain: "'Osh' means 'pilaf' (plov)." },
  { id: 173, q: "Choose the correct sentence.", options: ["There are a cat on the roof.","There is a cat on the roof.","There was cats on the roof.","There are cat on the roof."], answer: 1, explain: "Singular subject → 'There is a cat'." },
  { id: 174, q: "Translate into English: 'sho‘rva' ", options: ["bread","soup","porridge","pilaf"], answer: 1, explain: "'Sho‘rva' means 'soup'." },
  { id: 175, q: "Choose the correct form: We ___ football every Sunday.", options: ["play","plays","played","playing"], answer: 0, explain: "Present simple plural → 'play'." },
  { id: 176, q: "Translate into English: 'bo‘tqa' ", options: ["soup","porridge","pilaf","meal"], answer: 1, explain: "'Bo‘tqa' means 'porridge'." },
  { id: 177, q: "Choose the correct sentence.", options: ["He don’t like coffee.","He doesn’t like coffee.","He no like coffee.","He isn’t like coffee."], answer: 1, explain: "Correct negative → 'He doesn’t like coffee'." },
  { id: 178, q: "Translate into English: 'salat' ", options: ["salad","soup","bread","meal"], answer: 0, explain: "'Salat' means 'salad'." },
  { id: 179, q: "Choose the correct form: She ___ already done her homework.", options: ["have","has","had","having"], answer: 1, explain: "Present perfect singular → 'has done'." },
  { id: 180, q: "Translate into English: 'tovuq go‘shti' ", options: ["beef","chicken","mutton","fish"], answer: 1, explain: "'Tovuq go‘shti' means 'chicken'." },
  { id: 181, q: "Choose the correct sentence.", options: ["She is married with a doctor.","She married to a doctor.","She is married to a doctor.","She is marry a doctor."], answer: 2, explain: "Correct collocation → 'married to'." },
  { id: 182, q: "Translate into English: 'mol go‘shti' ", options: ["beef","mutton","pork","chicken"], answer: 0, explain: "'Mol go‘shti' means 'beef'." },
  { id: 183, q: "Choose the correct form: They ___ dinner when I arrived.", options: ["were having","have","has","had"], answer: 0, explain: "Past continuous → 'were having'." },
  { id: 184, q: "Translate into English: 'qo‘y go‘shti' ", options: ["mutton","beef","chicken","fish"], answer: 0, explain: "'Qo‘y go‘shti' means 'mutton'." },
  { id: 185, q: "Choose the correct sentence.", options: ["He is afraid from dogs.","He afraid of dogs.","He is afraid of dogs.","He afraid from dogs."], answer: 2, explain: "Correct preposition → 'afraid of'." },
  { id: 186, q: "Translate into English: 'cho‘chqa go‘shti' ", options: ["mutton","beef","pork","chicken"], answer: 2, explain: "'Cho‘chqa go‘shti' means 'pork'." },
  { id: 187, q: "Choose the correct form: By 2025, I ___ in this city for 20 years.", options: ["will live","will have lived","lived","live"], answer: 1, explain: "Future perfect → 'will have lived'." },
  { id: 188, q: "Translate into English: 'ovqatlanmoq' ", options: ["to eat","to drink","to cook","to feed"], answer: 0, explain: "'Ovqatlanmoq' means 'to eat'." },
  { id: 189, q: "Choose the correct sentence.", options: ["He is interesting in history.","He is interested in history.","He interested history.","He interests in history."], answer: 1, explain: "Correct adjective form → 'interested in'." },
  { id: 190, q: "Translate into English: 'ichmoq' ", options: ["to drink","to eat","to cook","to make"], answer: 0, explain: "'Ichmoq' means 'to drink'." },
  { id: 191, q: "Choose the correct form: I ___ my phone yesterday.", options: ["lose","lost","loses","losing"], answer: 1, explain: "Past simple → 'lost'." },
  { id: 192, q: "Translate into English: 'pishirmoq' ", options: ["to boil","to fry","to bake","to cook"], answer: 3, explain: "'Pishirmoq' means 'to cook'." },
  { id: 193, q: "Choose the correct sentence.", options: ["She good at dancing.","She is good at dancing.","She is good dancing.","She is good to dancing."], answer: 1, explain: "Correct phrase → 'good at'." },
  { id: 194, q: "Translate into English: 'qovurmoq' ", options: ["to fry","to boil","to bake","to roast"], answer: 0, explain: "'Qovurmoq' means 'to fry'." },
  { id: 195, q: "Choose the correct form: She ___ English every day.", options: ["study","studies","studied","studying"], answer: 1, explain: "Present simple with 'she' → 'studies'." },
  { id: 196, q: "Translate into English: 'qaynatmoq' ", options: ["to fry","to bake","to boil","to cook"], answer: 2, explain: "'Qaynatmoq' means 'to boil'." },
  { id: 197, q: "Choose the correct sentence.", options: ["He usually is late.","He is usually late.","Usually he late is.","He late usually is."], answer: 1, explain: "Correct word order → 'He is usually late'." },
  { id: 198, q: "Translate into English: 'dimlamoq' ", options: ["to fry","to steam","to boil","to roast"], answer: 1, explain: "'Dimlamoq' means 'to steam'." },
  { id: 199, q: "Choose the correct form: They ___ football now.", options: ["play","are playing","plays","played"], answer: 1, explain: "Present continuous → 'are playing'." },
  { id: 200, q: "Translate into English: 'kesmoq' ", options: ["to cut","to chop","to slice","to break"], answer: 0, explain: "'Kesmoq' means 'to cut'." },
  { id: 201, q: "Choose the correct sentence.", options: ["I have been knowing him for years.","I have known him for years.","I know him since years.","I knew him since years."], answer: 1, explain: "Correct perfect usage → 'I have known him for years'." },
  { id: 202, q: "Translate into English: 'to‘g‘ramoq' ", options: ["to cut","to chop","to mix","to boil"], answer: 1, explain: "'To‘g‘ramoq' means 'to chop'." },
  { id: 203, q: "Choose the correct form: While they ___ dinner, I called them.", options: ["have","had","were having","are having"], answer: 2, explain: "Past continuous → 'were having'." },
  { id: 204, q: "Translate into English: 'aralashtirmoq' ", options: ["to cut","to stir","to mix","to boil"], answer: 2, explain: "'Aralashtirmoq' means 'to mix'." },
  { id: 205, q: "Choose the correct sentence.", options: ["There is a lot of books.","There are a lot of books.","There is many books.","There are much books."], answer: 1, explain: "Correct plural form → 'There are a lot of books'." },
  { id: 206, q: "Translate into English: 'tandir' ", options: ["oven","stove","furnace","grill"], answer: 0, explain: "'Tandir' means 'oven'." },
  { id: 207, q: "Choose the correct form: By the time you arrive, I ___ my homework.", options: ["will finish","will have finished","finish","finished"], answer: 1, explain: "Future perfect → 'will have finished'." },
  { id: 208, q: "Translate into English: 'qozon' ", options: ["pan","pot","kettle","bowl"], answer: 1, explain: "'Qozon' means 'pot'." },
  { id: 209, q: "Choose the correct sentence.", options: ["She works hardly.","She hardly works.","She work hardly.","She hardly working."], answer: 1, explain: "Correct adverb placement → 'She hardly works'." },
  { id: 210, q: "Translate into English: 'skovorodka' ", options: ["pot","pan","dish","plate"], answer: 1, explain: "'Skovorodka' means 'pan'." },
  { id: 211, q: "Choose the correct form: He ___ when I saw him.", options: ["run","was running","runs","ran"], answer: 1, explain: "Past continuous → 'was running'." },
  { id: 212, q: "Translate into English: 'choynak' ", options: ["teacup","teapot","kettle","cup"], answer: 2, explain: "'Choynak' means 'kettle'." },
  { id: 213, q: "Choose the correct sentence.", options: ["She is good in singing.","She is good at singing.","She good at sing.","She is good on singing."], answer: 1, explain: "Correct phrase → 'good at'." },
  { id: 214, q: "Translate into English: 'lagan' ", options: ["dish","bowl","plate","tray"], answer: 3, explain: "'Lagan' means 'tray'." },
  { id: 215, q: "Choose the correct form: They ___ English since 2020.", options: ["study","are studying","have studied","studied"], answer: 2, explain: "Present perfect → 'have studied'." },
  { id: 216, q: "Translate into English: 'kosacha' ", options: ["cup","bowl","glass","plate"], answer: 1, explain: "'Kosacha' means 'bowl'." },
  { id: 217, q: "Choose the correct sentence.", options: ["I am used to get up early.","I am used to getting up early.","I used to getting up early.","I used getting up early."], answer: 1, explain: "Correct structure → 'be used to + V-ing'." },
  { id: 218, q: "Translate into English: 'stakan' ", options: ["cup","bottle","glass","jar"], answer: 2, explain: "'Stakan' means 'glass'." },
  { id: 219, q: "Choose the correct form: He ___ never been to London.", options: ["has","have","is","was"], answer: 0, explain: "Present perfect singular → 'has been'." },
  { id: 220, q: "Translate into English: 'idish-tovoq' ", options: ["dishes","tools","pots","kitchen"], answer: 0, explain: "'Idish-tovoq' means 'dishes'." },
  { id: 221, q: "Choose the correct sentence.", options: ["She is interested about music.","She is interested in music.","She interested in music.","She is interest in music."], answer: 1, explain: "Correct phrase → 'interested in'." },
  { id: 222, q: "Translate into English: 'choy qoshiq' ", options: ["knife","teaspoon","tablespoon","fork"], answer: 1, explain: "'Choy qoshiq' means 'teaspoon'." },
  { id: 223, q: "Choose the correct form: By 2030, he ___ 10 books.", options: ["writes","wrote","will write","will have written"], answer: 3, explain: "Future perfect → 'will have written'." },
  { id: 224, q: "Translate into English: 'osh qoshiq' ", options: ["fork","tablespoon","teaspoon","knife"], answer: 1, explain: "'Osh qoshiq' means 'tablespoon'." },
  { id: 225, q: "Choose the correct sentence.", options: ["She is married to a teacher.","She married with a teacher.","She is marry with a teacher.","She is married for a teacher."], answer: 0, explain: "Correct collocation → 'married to'." },
  { id: 226, q: "Translate into English: 'pichoq' ", options: ["spoon","knife","fork","plate"], answer: 1, explain: "'Pichoq' means 'knife'." },
  { id: 227, q: "Choose the correct form: I ___ him yesterday.", options: ["see","saw","seen","seeing"], answer: 1, explain: "Past simple → 'saw'." },
  { id: 228, q: "Translate into English: 'vilka' ", options: ["fork","spoon","knife","plate"], answer: 0, explain: "'Vilka' means 'fork'." },
  { id: 229, q: "Choose the correct sentence.", options: ["She is afraid from spiders.","She afraid of spiders.","She is afraid of spiders.","She is afraid by spiders."], answer: 2, explain: "Correct usage → 'afraid of'." },
  { id: 230, q: "Translate into English: 'qoshiq' ", options: ["knife","fork","spoon","plate"], answer: 2, explain: "'Qoshiq' means 'spoon'." },
  { id: 231, q: "Choose the correct form: They ___ when I arrived.", options: ["work","worked","were working","working"], answer: 2, explain: "Past continuous → 'were working'." },
  { id: 232, q: "Translate into English: 'idish' ", options: ["plate","pot","dish","bowl"], answer: 2, explain: "'Idish' means 'dish'." },
  { id: 233, q: "Choose the correct sentence.", options: ["There is a lot of people here.","There are a lot of people here.","There is many people here.","There are much people here."], answer: 1, explain: "Correct → 'There are a lot of people'." },
  { id: 234, q: "Translate into English: 'tovoq' ", options: ["plate","pan","tray","dish"], answer: 0, explain: "'Tovoq' means 'plate'." },
  { id: 235, q: "Choose the correct form: He ___ in London for 5 years.", options: ["lives","is living","has lived","lived"], answer: 2, explain: "Present perfect → 'has lived'." },
  { id: 236, q: "Translate into English: 'stol' ", options: ["chair","table","desk","bench"], answer: 1, explain: "'Stol' means 'table'." },
  { id: 237, q: "Choose the correct sentence.", options: ["She can sings.","She cans sing.","She can sing.","She can to sing."], answer: 2, explain: "Correct modal form → 'can + verb'." },
  { id: 238, q: "Translate into English: 'stul' ", options: ["desk","chair","bench","sofa"], answer: 1, explain: "'Stul' means 'chair'." },
  { id: 239, q: "Choose the correct form: We ___ a new house last year.", options: ["buy","bought","buys","buying"], answer: 1, explain: "Past simple → 'bought'." },
  { id: 240, q: "Translate into English: 'karavot' ", options: ["sofa","chair","bed","table"], answer: 2, explain: "'Karavot' means 'bed'." },
  { id: 241, q: "Choose the correct sentence.", options: ["She is good on dancing.","She is good at dancing.","She is good to dance.","She good at dancing."], answer: 1, explain: "Correct collocation → 'good at'." },
  { id: 242, q: "Translate into English: 'divan' ", options: ["sofa","chair","table","desk"], answer: 0, explain: "'Divan' means 'sofa'." },
  { id: 243, q: "Choose the correct form: While he ___, I called him.", options: ["sleep","sleeps","was sleeping","is sleeping"], answer: 2, explain: "Past continuous → 'was sleeping'." },
  { id: 244, q: "Translate into English: 'gilam' ", options: ["blanket","curtain","carpet","sheet"], answer: 2, explain: "'Gilam' means 'carpet'." },
  { id: 245, q: "Choose the correct sentence.", options: ["She has just finish it.","She has just finished it.","She just has finished it.","She have just finished it."], answer: 1, explain: "Correct form → 'has finished'." },
  { id: 246, q: "Translate into English: 'pardalar' ", options: ["carpets","sheets","curtains","blankets"], answer: 2, explain: "'Pardalar' means 'curtains'." },
  { id: 247, q: "Choose the correct form: I ___ my phone yesterday.", options: ["lose","lost","loses","losing"], answer: 1, explain: "Past simple → 'lost'." },
  { id: 248, q: "Translate into English: 'ko‘rpa' ", options: ["sheet","blanket","carpet","pillow"], answer: 1, explain: "'Ko‘rpa' means 'blanket'." },
  { id: 249, q: "Choose the correct sentence.", options: ["He is interested for art.","He interested in art.","He is interested in art.","He interests in art."], answer: 2, explain: "Correct → 'interested in'." },
  { id: 250, q: "Translate into English: 'yostiq' ", options: ["sheet","blanket","carpet","pillow"], answer: 3, explain: "'Yostiq' means 'pillow'." },
  { id: 251, q: "Choose the correct form: They ___ already done their work.", options: ["have","has","had","having"], answer: 0, explain: "Present perfect plural → 'have done'." },
  { id: 252, q: "Translate into English: 'choyshab' ", options: ["carpet","sheet","blanket","pillow"], answer: 1, explain: "'Choyshab' means 'sheet'." },
  { id: 253, q: "Choose the correct sentence.", options: ["He is good in math.","He is good at math.","He good at math.","He is good to math."], answer: 1, explain: "Correct collocation → 'good at'." },
  { id: 254, q: "Translate into English: 'deraza' ", options: ["wall","door","window","roof"], answer: 2, explain: "'Deraza' means 'window'." },
  { id: 255, q: "Choose the correct form: They ___ to school every day.", options: ["go","goes","going","went"], answer: 0, explain: "Present simple plural → 'go'." },
  { id: 256, q: "Translate into English: 'eshik' ", options: ["roof","wall","window","door"], answer: 3, explain: "'Eshik' means 'door'." },
  { id: 257, q: "Choose the correct sentence.", options: ["There is much apples.","There are many apples.","There is many apples.","There are much apples."], answer: 1, explain: "Correct → 'There are many apples'." },
  { id: 258, q: "Translate into English: 'tom' ", options: ["roof","wall","floor","door"], answer: 0, explain: "'Tom' means 'roof'." },
  { id: 259, q: "Choose the correct form: She ___ a teacher last year.", options: ["was","is","has been","will be"], answer: 0, explain: "Past simple → 'was'." },
  { id: 260, q: "Translate into English: 'devor' ", options: ["floor","roof","wall","ceiling"], answer: 2, explain: "'Devor' means 'wall'." },
  { id: 261, q: "Choose the correct sentence.", options: ["She doesn’t likes apples.","She don’t like apples.","She doesn’t like apples.","She not like apples."], answer: 2, explain: "Correct → 'doesn’t like'." },
  { id: 262, q: "Translate into English: 'pol' ", options: ["wall","floor","ceiling","roof"], answer: 1, explain: "'Pol' means 'floor'." },
  { id: 263, q: "Choose the correct form: He ___ never been abroad.", options: ["is","was","has","have"], answer: 2, explain: "Present perfect singular → 'has been'." },
  { id: 264, q: "Translate into English: 'shift' ", options: ["floor","roof","wall","ceiling"], answer: 3, explain: "'Shift' means 'ceiling'." },
  { id: 265, q: "Choose the correct sentence.", options: ["He is married with her.","He is married to her.","He married for her.","He married with her."], answer: 1, explain: "Correct → 'married to'." },
  { id: 266, q: "Translate into English: 'hovli' ", options: ["garden","yard","park","field"], answer: 1, explain: "'Hovli' means 'yard'." },
  { id: 267, q: "Choose the correct form: I ___ my homework already.", options: ["did","done","have done","was doing"], answer: 2, explain: "Present perfect → 'have done'." },
  { id: 268, q: "Translate into English: 'bog‘' ", options: ["field","yard","garden","forest"], answer: 2, explain: "'Bog‘' means 'garden'." },
  { id: 269, q: "Choose the correct sentence.", options: ["He is good at play football.","He is good at playing football.","He good in playing football.","He is good to play football."], answer: 1, explain: "Correct form → 'good at + V-ing'." },
  { id: 270, q: "Translate into English: 'o‘rmon' ", options: ["forest","garden","field","park"], answer: 0, explain: "'O‘rmon' means 'forest'." },
  { id: 271, q: "Choose the correct form: We ___ a new car next month.", options: ["buy","bought","are buying","buys"], answer: 2, explain: "Present continuous for future → 'are buying'." },
  { id: 272, q: "Translate into English: 'dala' ", options: ["park","forest","field","yard"], answer: 2, explain: "'Dala' means 'field'." },
  { id: 273, q: "Choose the correct sentence.", options: ["Can you to help me?","Can you help me?","You can help me?","Can help you me?"], answer: 1, explain: "Correct modal form → 'Can you help me?'" },
  { id: 274, q: "Translate into English: 'park' ", options: ["park","field","yard","forest"], answer: 0, explain: "'Park' means 'park'." },
  { id: 275, q: "Choose the correct form: By 2026, I ___ in this city for 10 years.", options: ["will live","will have lived","lived","live"], answer: 1, explain: "Future perfect → 'will have lived'." },
  { id: 276, q: "Translate into English: 'ko‘cha' ", options: ["street","road","lane","avenue"], answer: 0, explain: "'Ko‘cha' means 'street'." },
  { id: 277, q: "Choose the correct sentence.", options: ["There is two cats.","There are two cats.","There are cat.","There is cats."], answer: 1, explain: "Correct plural → 'There are two cats'." },
  { id: 278, q: "Translate into English: 'yo‘l' ", options: ["street","road","way","path"], answer: 1, explain: "'Yo‘l' means 'road'." },
  { id: 279, q: "Choose the correct form: He ___ in the park yesterday.", options: ["is walking","was walking","walk","walked"], answer: 3, explain: "Past simple → 'walked'." },
  { id: 280, q: "Translate into English: 'yo‘lak' ", options: ["lane","street","road","corridor"], answer: 0, explain: "'Yo‘lak' means 'lane'." },
  { id: 281, q: "Choose the correct sentence.", options: ["He is afraid of snakes.","He afraid from snakes.","He is afraid snakes.","He is afraid by snakes."], answer: 0, explain: "Correct phrase → 'afraid of'." },
  { id: 282, q: "Translate into English: 'shahar' ", options: ["village","city","town","capital"], answer: 1, explain: "'Shahar' means 'city'." },
  { id: 283, q: "Choose the correct form: She ___ to London twice.", options: ["was","is","has been","had been"], answer: 2, explain: "Present perfect → 'has been'." },
  { id: 284, q: "Translate into English: 'qishloq' ", options: ["city","village","town","district"], answer: 1, explain: "'Qishloq' means 'village'." },
  { id: 285, q: "Choose the correct sentence.", options: ["He is more taller than me.","He is taller than me.","He taller than me.","He is tallest than me."], answer: 1, explain: "Correct → 'taller than'." },
  { id: 286, q: "Translate into English: 'tuman' ", options: ["district","region","village","province"], answer: 0, explain: "'Tuman' means 'district'." },
  { id: 287, q: "Choose the correct form: I ___ my keys. Can you help me?", options: ["lose","lost","have lost","am losing"], answer: 2, explain: "Present perfect → 'have lost'." },
  { id: 288, q: "Translate into English: 'viloyat' ", options: ["district","province","region","state"], answer: 1, explain: "'Viloyat' means 'province'." },
  { id: 289, q: "Choose the correct sentence.", options: ["She doesn’t goes to school.","She don’t go to school.","She doesn’t go to school.","She not go to school."], answer: 2, explain: "Correct → 'doesn’t go'." },
  { id: 290, q: "Translate into English: 'mamlakat' ", options: ["village","country","state","province"], answer: 1, explain: "'Mamlakat' means 'country'." },
  { id: 291, q: "Choose the correct form: They ___ to the cinema last night.", options: ["go","goes","went","going"], answer: 2, explain: "Past simple → 'went'." },
  { id: 292, q: "Translate into English: 'davlat' ", options: ["government","state","country","province"], answer: 1, explain: "'Davlat' means 'state'." },
  { id: 293, q: "Choose the correct sentence.", options: ["She can to dance well.","She can dance well.","She cans dance well.","She dance can well."], answer: 1, explain: "Correct modal usage → 'can + verb'." },
  { id: 294, q: "Translate into English: 'poytaxt' ", options: ["capital","center","main city","province"], answer: 0, explain: "'Poytaxt' means 'capital'." },
  { id: 295, q: "Choose the correct form: They ___ here since 2010.", options: ["live","lives","are living","have lived"], answer: 3, explain: "Present perfect → 'have lived'." },
  { id: 296, q: "Translate into English: 'xalq' ", options: ["people","population","nation","citizens"], answer: 0, explain: "'Xalq' means 'people'." },
  { id: 297, q: "Choose the correct sentence.", options: ["There are much books on the table.","There are many books on the table.","There is many books on the table.","There is much books on the table."], answer: 1, explain: "Correct → 'many books'." },
  { id: 298, q: "Translate into English: 'fuqaro' ", options: ["citizen","people","nation","public"], answer: 0, explain: "'Fuqaro' means 'citizen'." },
  { id: 299, q: "Choose the correct form: She ___ TV when I called.", options: ["watches","watched","was watching","is watching"], answer: 2, explain: "Past continuous → 'was watching'." },
  { id: 300, q: "Translate into English: 'xalqaro' ", options: ["national","international","local","global"], answer: 1, explain: "'Xalqaro' means 'international'." },
  { id: 301, q: "Choose the correct sentence.", options: ["I have visited Paris last year.","I visited Paris last year.","I have visit Paris last year.","I visit Paris last year."], answer: 1, explain: "Past simple with time expression → 'visited'." },
  { id: 302, q: "Translate into English: 'mahalla' ", options: ["neighborhood","city","village","district"], answer: 0, explain: "'Mahalla' means 'neighborhood'." },
  { id: 303, q: "Choose the correct form: If I ___ you, I would study harder.", options: ["am","was","were","be"], answer: 2, explain: "Second conditional → 'were'." },
  { id: 304, q: "Translate into English: 'urush' ", options: ["fight","battle","war","conflict"], answer: 2, explain: "'Urush' means 'war'." },
  { id: 305, q: "Choose the correct sentence.", options: ["He suggested to go to the park.","He suggested going to the park.","He suggested go to the park.","He suggested that going to the park."], answer: 1, explain: "Correct → 'suggested going'." },
  { id: 306, q: "Translate into English: 'tinchlik' ", options: ["war","peace","calm","quiet"], answer: 1, explain: "'Tinchlik' means 'peace'." },
  { id: 307, q: "Choose the correct form: She ___ English very well.", options: ["speak","speaks","speaking","spoken"], answer: 1, explain: "Present simple, third person → 'speaks'." },
  { id: 308, q: "Translate into English: 'ozodlik' ", options: ["freedom","independence","peace","justice"], answer: 0, explain: "'Ozodlik' means 'freedom'." },
  { id: 309, q: "Choose the correct sentence.", options: ["He is tired to work.","He tired for work.","He is tired of working.","He tired to working."], answer: 2, explain: "Correct phrase → 'tired of doing'." },
  { id: 310, q: "Translate into English: 'mustaqillik' ", options: ["freedom","independence","liberty","separation"], answer: 1, explain: "'Mustaqillik' means 'independence'." },
  { id: 311, q: "Choose the correct form: They ___ already left.", options: ["have","has","had","having"], answer: 0, explain: "Present perfect plural → 'have left'." },
  { id: 312, q: "Translate into English: 'adolat' ", options: ["justice","law","rule","truth"], answer: 0, explain: "'Adolat' means 'justice'." },
  { id: 313, q: "Choose the correct sentence.", options: ["He is responsible of this project.","He responsible for this project.","He is responsible for this project.","He responsible this project."], answer: 2, explain: "Correct → 'responsible for'." },
  { id: 314, q: "Translate into English: 'haqiqat' ", options: ["justice","truth","fact","law"], answer: 1, explain: "'Haqiqat' means 'truth'." },
  { id: 315, q: "Choose the correct form: They ___ when I entered the room.", options: ["talk","talked","were talking","talks"], answer: 2, explain: "Past continuous → 'were talking'." },
  { id: 316, q: "Translate into English: 'yolg‘on' ", options: ["truth","lie","false","wrong"], answer: 1, explain: "'Yolg‘on' means 'lie'." },
  { id: 317, q: "Choose the correct sentence.", options: ["She is married with a doctor.","She married for a doctor.","She is married to a doctor.","She married with doctor."], answer: 2, explain: "Correct collocation → 'married to'." },
  { id: 318, q: "Translate into English: 'sadoqat' ", options: ["loyalty","faith","honesty","justice"], answer: 0, explain: "'Sadoqat' means 'loyalty'." },
  { id: 319, q: "Choose the correct form: We ___ here for two hours.", options: ["are","were","have been","was"], answer: 2, explain: "Present perfect continuous → 'have been'." },
  { id: 320, q: "Translate into English: 'halollik' ", options: ["truth","justice","honesty","fairness"], answer: 2, explain: "'Halollik' means 'honesty'." },
  { id: 321, q: "Choose the correct sentence.", options: ["He is good on math.","He is good at math.","He good at math.","He is good to math."], answer: 1, explain: "Correct collocation → 'good at'." },
  { id: 322, q: "Translate into English: 'xalqaro til' ", options: ["national language","local language","international language","foreign language"], answer: 2, explain: "'Xalqaro til' means 'international language'." },
  { id: 323, q: "Choose the correct form: He ___ never seen such a thing.", options: ["has","have","is","was"], answer: 0, explain: "Present perfect → 'has seen'." },
  { id: 324, q: "Translate into English: 'ona til' ", options: ["native language","foreign language","official language","national language"], answer: 0, explain: "'Ona til' means 'native language'." },
  { id: 325, q: "Choose the correct sentence.", options: ["He succeeded in pass the exam.","He succeeded pass the exam.","He succeeded in passing the exam.","He succeed in passing the exam."], answer: 2, explain: "Correct usage → 'succeeded in + V-ing'." },
  { id: 326, q: "Translate into English: 'chet tili' ", options: ["foreign language","international language","native language","second language"], answer: 0, explain: "'Chet tili' means 'foreign language'." },
  { id: 327, q: "Choose the correct form: While she ___, the baby cried.", options: ["cooked","was cooking","cooks","cooking"], answer: 1, explain: "Past continuous → 'was cooking'." },
  { id: 328, q: "Translate into English: 'rasm' ", options: ["drawing","photo","picture","painting"], answer: 2, explain: "'Rasm' means 'picture'." },
  { id: 329, q: "Choose the correct sentence.", options: ["He is capable to solve this.","He is capable of solving this.","He capable for solving this.","He is capable in solve this."], answer: 1, explain: "Correct usage → 'capable of + V-ing'." },
  { id: 330, q: "Translate into English: 'kitob' ", options: ["book","notebook","magazine","journal"], answer: 0, explain: "'Kitob' means 'book'." },
  { id: 331, q: "Choose the correct form: She ___ a letter now.", options: ["writes","is writing","write","wrote"], answer: 1, explain: "Present continuous → 'is writing'." },
  { id: 332, q: "Translate into English: 'daftar' ", options: ["notebook","book","journal","paper"], answer: 0, explain: "'Daftar' means 'notebook'." },
  { id: 333, q: "Choose the correct sentence.", options: ["He is keen in football.","He is keen on football.","He keen for football.","He is keen to football."], answer: 1, explain: "Correct collocation → 'keen on'." },
  { id: 334, q: "Translate into English: 'qalam' ", options: ["pen","pencil","marker","chalk"], answer: 1, explain: "'Qalam' means 'pencil'." },
  { id: 335, q: "Choose the correct form: I ___ breakfast every morning.", options: ["has","had","have","having"], answer: 2, explain: "Present simple plural → 'have'." },
  { id: 336, q: "Translate into English: 'ruchka' ", options: ["pen","pencil","chalk","marker"], answer: 0, explain: "'Ruchka' means 'pen'." },
  { id: 337, q: "Choose the correct sentence.", options: ["He is afraid from dogs.","He afraid dogs.","He is afraid of dogs.","He afraid by dogs."], answer: 2, explain: "Correct phrase → 'afraid of'." },
  { id: 338, q: "Translate into English: 'darslik' ", options: ["textbook","notebook","journal","article"], answer: 0, explain: "'Darslik' means 'textbook'." },
  { id: 339, q: "Choose the correct form: They ___ to school yesterday.", options: ["go","going","went","gone"], answer: 2, explain: "Past simple → 'went'." },
  { id: 340, q: "Translate into English: 'gazeta' ", options: ["journal","newspaper","magazine","book"], answer: 1, explain: "'Gazeta' means 'newspaper'." },
  { id: 341, q: "Choose the correct sentence.", options: ["He is good at play the piano.","He is good at playing the piano.","He good playing piano.","He is good to play piano."], answer: 1, explain: "Correct → 'good at + V-ing'." },
  { id: 342, q: "Translate into English: 'jurnal' ", options: ["journal","notebook","magazine","newspaper"], answer: 2, explain: "'Jurnal' often means 'magazine'." },
  { id: 343, q: "Choose the correct form: By 2025, I ___ this book.", options: ["finish","finished","will finish","will have finished"], answer: 3, explain: "Future perfect → 'will have finished'." },
  { id: 344, q: "Translate into English: 'maqola' ", options: ["book","text","article","essay"], answer: 2, explain: "'Maqola' means 'article'." },
  { id: 345, q: "Choose the correct sentence.", options: ["She suggested to meet early.","She suggested meeting early.","She suggested meet early.","She suggest meeting early."], answer: 1, explain: "Correct form → 'suggested + V-ing'." },
  { id: 346, q: "Translate into English: 'qissa' ", options: ["poem","tale","story","article"], answer: 2, explain: "'Qissa' means 'story'." },
  { id: 347, q: "Choose the correct form: He ___ already finished his homework.", options: ["has","have","had","having"], answer: 0, explain: "Present perfect singular → 'has finished'." },
  { id: 348, q: "Translate into English: 'she’r' ", options: ["essay","poem","story","novel"], answer: 1, explain: "'She’r' means 'poem'." },
  { id: 349, q: "Choose the correct sentence.", options: ["She is interested about history.","She is interested in history.","She interested in history.","She is interest in history."], answer: 1, explain: "Correct phrase → 'interested in'." },
  { id: 350, q: "Translate into English: 'roman' ", options: ["novel","story","article","poem"], answer: 0, explain: "'Roman' means 'novel'." },
  { id: 351, q: "Choose the correct form: They ___ dinner when we arrived.", options: ["eat","ate","were eating","eating"], answer: 2, explain: "Past continuous → 'were eating'." },
  { id: 352, q: "Translate into English: 'doston' ", options: ["epic","story","poem","novel"], answer: 0, explain: "'Doston' means 'epic'." },
  { id: 353, q: "Choose the correct sentence.", options: ["She is good in singing.","She is good at singing.","She good singing.","She is good to singing."], answer: 1, explain: "Correct → 'good at'." },
  { id: 354, q: "Translate into English: 'hikoya' ", options: ["tale","story","article","novel"], answer: 1, explain: "'Hikoya' means 'story'." },
  { id: 355, q: "Choose the correct form: He ___ here for 3 years.", options: ["lives","is living","has lived","lived"], answer: 2, explain: "Present perfect → 'has lived'." },
  { id: 356, q: "Translate into English: 'ertak' ", options: ["story","legend","fairy tale","epic"], answer: 2, explain: "'Ertak' means 'fairy tale'." },
  { id: 357, q: "Choose the correct sentence.", options: ["She is afraid from snakes.","She afraid snakes.","She is afraid of snakes.","She afraid by snakes."], answer: 2, explain: "Correct → 'afraid of'." },
  { id: 358, q: "Translate into English: 'afsona' ", options: ["myth","legend","fairy tale","tale"], answer: 1, explain: "'Afsona' means 'legend'." },
  { id: 359, q: "Choose the correct form: They ___ soccer every Sunday.", options: ["plays","play","played","playing"], answer: 1, explain: "Present simple plural → 'play'." },
  { id: 360, q: "Translate into English: 'rivoyat' ", options: ["tale","legend","story","fairy tale"], answer: 3, explain: "'Rivoyat' means 'fairy tale/legend' depending on context." },
  { id: 361, q: "Choose the correct sentence.", options: ["He is capable for doing this.","He is capable of doing this.","He capable to do this.","He capable in doing this."], answer: 1, explain: "Correct → 'capable of'." },
  { id: 362, q: "Translate into English: 'xalq og‘zaki ijodi' ", options: ["folk song","folk art","folklore","folk tale"], answer: 2, explain: "'Xalq og‘zaki ijodi' means 'folklore'." },
  { id: 363, q: "Choose the correct form: I ___ to Tashkent next week.", options: ["go","went","am going","going"], answer: 2, explain: "Future plan → 'am going'." },
  { id: 364, q: "Translate into English: 'maqol' ", options: ["saying","proverb","poem","tale"], answer: 1, explain: "'Maqol' means 'proverb'." },
  { id: 365, q: "Choose the correct sentence.", options: ["She suggested go shopping.","She suggested going shopping.","She suggested to going shopping.","She suggest going shopping."], answer: 1, explain: "Correct → 'suggested + V-ing'." },
  { id: 366, q: "Translate into English: 'matol' ", options: ["saying","proverb","riddle","phrase"], answer: 2, explain: "'Matol' means 'riddle'." },
  { id: 367, q: "Choose the correct form: They ___ football when it started to rain.", options: ["play","played","were playing","plays"], answer: 2, explain: "Past continuous → 'were playing'." },
  { id: 368, q: "Translate into English: 'topishmoq' ", options: ["proverb","poem","riddle","saying"], answer: 2, explain: "'Topishmoq' means 'riddle'." },
  { id: 369, q: "Choose the correct sentence.", options: ["He is good at swim.","He is good at swimming.","He good swimming.","He is good to swimming."], answer: 1, explain: "Correct form → 'good at + V-ing'." },
  { id: 370, q: "Translate into English: 'tez aytish' ", options: ["riddle","tongue twister","poem","legend"], answer: 1, explain: "'Tez aytish' means 'tongue twister'." },
  { id: 371, q: "Translate into English: 'uyqu' ", options: ["dream","rest","sleep","nap"], answer: 2, explain: "'Uyqu' means 'sleep'." },
  { id: 372, q: "Choose the correct sentence.", options: ["She don't like tea.","She doesn't like tea.","She not like tea.","She didn't likes tea."], answer: 1, explain: "Correct negative present simple → 'She doesn't like tea'." },
  { id: 373, q: "Translate into English: 'uyg‘onmoq' ", options: ["to dream","to wake up","to sleep","to relax"], answer: 1, explain: "'Uyg‘onmoq' means 'to wake up'." },
  { id: 374, q: "Choose the correct form: I ___ TV when he arrived.", options: ["watched","was watching","watch","am watching"], answer: 1, explain: "Past continuous → 'was watching'." },
  { id: 375, q: "Translate into English: 'tush ko‘rmoq' ", options: ["to dream","to sleep","to nap","to imagine"], answer: 0, explain: "'Tush ko‘rmoq' means 'to dream'." },
  { id: 376, q: "Choose the correct sentence.", options: ["He has a bath every morning.","He have a bath every morning.","He haves a bath every morning.","He having a bath every morning."], answer: 0, explain: "Correct simple present → 'He has a bath every morning'." },
  { id: 377, q: "Translate into English: 'ertalab' ", options: ["afternoon","evening","morning","night"], answer: 2, explain: "'Ertalab' means 'morning'." },
  { id: 378, q: "Choose the correct form: They ___ already finished the project.", options: ["has","have","having","are"], answer: 1, explain: "Present perfect plural → 'have finished'." },
  { id: 379, q: "Translate into English: 'kechqurun' ", options: ["night","evening","morning","afternoon"], answer: 1, explain: "'Kechqurun' means 'evening'." },
  { id: 380, q: "Choose the correct sentence.", options: ["We go often shopping.","We often go shopping.","Often we go shopping.","We go shopping oftenly."], answer: 1, explain: "Correct word order → 'We often go shopping'." },
  { id: 381, q: "Translate into English: 'tun' ", options: ["morning","night","day","evening"], answer: 1, explain: "'Tun' means 'night'." },
  { id: 382, q: "Choose the correct form: If I ___ rich, I would travel the world.", options: ["am","was","were","be"], answer: 2, explain: "Second conditional → 'If I were rich'." },
  { id: 383, q: "Translate into English: 'kunduzi' ", options: ["in the day","at night","at morning","in evening"], answer: 0, explain: "'Kunduzi' means 'in the day'." },
  { id: 384, q: "Choose the correct sentence.", options: ["She is afraid from spiders.","She afraid of spiders.","She is afraid of spiders.","She is afraid on spiders."], answer: 2, explain: "Correct preposition → 'afraid of'." },
  { id: 385, q: "Translate into English: 'kechasi' ", options: ["at night","at evening","at day","at morning"], answer: 0, explain: "'Kechasi' means 'at night'." },
  { id: 386, q: "Choose the correct form: How long ___ you lived here?", options: ["do","have","are","did"], answer: 1, explain: "Present perfect → 'How long have you lived here?'." },
  { id: 387, q: "Translate into English: 'ertalabki nonushta' ", options: ["breakfast","lunch","dinner","supper"], answer: 0, explain: "'Ertalabki nonushta' means 'breakfast'." },
  { id: 388, q: "Choose the correct sentence.", options: ["She is married with a doctor.","She is married to a doctor.","She married with a doctor.","She married to a doctor."], answer: 1, explain: "Correct phrase → 'married to'." },
  { id: 389, q: "Translate into English: 'tushlik' ", options: ["lunch","dinner","breakfast","snack"], answer: 0, explain: "'Tushlik' means 'lunch'." },
  { id: 390, q: "Choose the correct form: We ___ to London next summer.", options: ["go","are going","goes","will going"], answer: 1, explain: "Planned future → 'are going'." },
  { id: 391, q: "Translate into English: 'kechki ovqat' ", options: ["lunch","dinner","supper","breakfast"], answer: 1, explain: "'Kechki ovqat' means 'dinner'." },
  { id: 392, q: "Choose the correct sentence.", options: ["She suggested to go to the cinema.","She suggested going to the cinema.","She suggested go to the cinema.","She suggested goes to the cinema."], answer: 1, explain: "Correct gerund → 'suggested going'." },
  { id: 393, q: "Translate into English: 'meva' ", options: ["vegetable","fruit","meal","food"], answer: 1, explain: "'Meva' means 'fruit'." },
  { id: 394, q: "Choose the correct form: He ___ his leg yesterday.", options: ["breaks","broke","broken","breaking"], answer: 1, explain: "Past simple → 'broke'." },
  { id: 395, q: "Translate into English: 'sabzavot' ", options: ["fruit","meat","vegetable","salad"], answer: 2, explain: "'Sabzavot' means 'vegetable'." },
  { id: 396, q: "Choose the correct sentence.", options: ["I am interesting in history.","I am interested in history.","I interested in history.","I interest in history."], answer: 1, explain: "Correct form → 'interested in'." },
  { id: 397, q: "Translate into English: 'gosht' ", options: ["meat","fish","vegetable","bread"], answer: 0, explain: "'Go‘sht' means 'meat'." },
  { id: 398, q: "Choose the correct form: By 2025, they ___ in Paris for 10 years.", options: ["live","lived","will have lived","are living"], answer: 2, explain: "Future perfect → 'will have lived'." },
  { id: 399, q: "Translate into English: 'baliq' ", options: ["fish","meat","chicken","egg"], answer: 0, explain: "'Baliq' means 'fish'." },
  { id: 400, q: "Choose the correct sentence.", options: ["She made me to cry.","She made me cry.","She made me crying.","She makes me to cry."], answer: 1, explain: "Correct causative verb → 'made me cry'." },
  { id: 401, q: "Translate into English: 'tovuq' ", options: ["duck","chicken","fish","turkey"], answer: 1, explain: "'Tovuq' means 'chicken'." },
  { id: 402, q: "Choose the correct sentence.", options: ["He is used to get up early.","He used to getting up early.","He is used to getting up early.","He used getting up early."], answer: 2, explain: "Correct form → 'be used to + V-ing'." },
  { id: 403, q: "Translate into English: 'tuxum' ", options: ["egg","milk","meat","bread"], answer: 0, explain: "'Tuxum' means 'egg'." },
  { id: 404, q: "Choose the correct form: If it ___ tomorrow, we will stay home.", options: ["rain","rains","raining","will rain"], answer: 1, explain: "First conditional → 'If it rains…'." },
  { id: 405, q: "Translate into English: 'sut' ", options: ["milk","water","cream","yogurt"], answer: 0, explain: "'Sut' means 'milk'." },
  { id: 406, q: "Choose the correct sentence.", options: ["I am looking forward to see you.","I am looking forward to seeing you.","I look forward seeing you.","I look forward see you."], answer: 1, explain: "Correct structure → 'look forward to + V-ing'." },
  { id: 407, q: "Translate into English: 'qaymoq' ", options: ["cream","butter","cheese","yogurt"], answer: 0, explain: "'Qaymoq' means 'cream'." },
  { id: 408, q: "Choose the correct form: They ___ in New York for five years.", options: ["live","lives","have lived","are live"], answer: 2, explain: "Present perfect → 'have lived'." },
  { id: 409, q: "Translate into English: 'pishloq' ", options: ["cream","cheese","yogurt","butter"], answer: 1, explain: "'Pishloq' means 'cheese'." },
  { id: 410, q: "Choose the correct sentence.", options: ["She is interested on art.","She interested in art.","She is interested in art.","She is interesting in art."], answer: 2, explain: "Correct phrase → 'interested in'." },
  { id: 411, q: "Translate into English: 'yog‘' ", options: ["fat","oil","butter","grease"], answer: 1, explain: "'Yog‘' means 'oil'." },
  { id: 412, q: "Choose the correct form: He ___ breakfast at 8 every day.", options: ["have","has","having","had"], answer: 1, explain: "Present simple with 'he' → 'has'." },
  { id: 413, q: "Translate into English: 'saryog‘' ", options: ["cream","oil","butter","cheese"], answer: 2, explain: "'Saryog‘' means 'butter'." },
  { id: 414, q: "Choose the correct sentence.", options: ["She suggested to stay home.","She suggested staying home.","She suggested stay home.","She suggested stayed home."], answer: 1, explain: "Correct → 'suggested + V-ing'." },
  { id: 415, q: "Translate into English: 'yogurt' ", options: ["cream","yogurt","milk","cheese"], answer: 1, explain: "'Yogurt' means 'yogurt'." },
  { id: 416, q: "Choose the correct form: While I ___, the phone rang.", options: ["cooked","was cooking","cooks","am cooking"], answer: 1, explain: "Past continuous → 'was cooking'." },
  { id: 417, q: "Translate into English: 'shakar' ", options: ["salt","sugar","flour","spice"], answer: 1, explain: "'Shakar' means 'sugar'." },
  { id: 418, q: "Choose the correct sentence.", options: ["He musts go now.","He must go now.","He must to go now.","He must going now."], answer: 1, explain: "Correct modal verb → 'must go'." },
  { id: 419, q: "Translate into English: 'tuz' ", options: ["sugar","salt","spice","pepper"], answer: 1, explain: "'Tuz' means 'salt'." },
  { id: 420, q: "Choose the correct form: I ___ my keys yesterday.", options: ["lose","loses","lost","losing"], answer: 2, explain: "Past simple → 'lost'." },
  { id: 421, q: "Translate into English: 'un' ", options: ["sugar","flour","rice","grain"], answer: 1, explain: "'Un' means 'flour'." },
  { id: 422, q: "Choose the correct sentence.", options: ["She is afraid from snakes.","She is afraid of snakes.","She afraid of snakes.","She is afraid on snakes."], answer: 1, explain: "Correct → 'afraid of'." },
  { id: 423, q: "Translate into English: 'guruch' ", options: ["rice","flour","grain","pasta"], answer: 0, explain: "'Guruch' means 'rice'." },
  { id: 424, q: "Choose the correct form: He ___ to the cinema last week.", options: ["go","went","goes","going"], answer: 1, explain: "Past simple → 'went'." },
  { id: 425, q: "Translate into English: 'makaron' ", options: ["bread","noodles","pasta","rice"], answer: 2, explain: "'Makaron' means 'pasta'." },
  { id: 426, q: "Choose the correct sentence.", options: ["I am used to play tennis.","I am used to playing tennis.","I used to playing tennis.","I used playing tennis."], answer: 1, explain: "Correct → 'be used to + V-ing'." },
  { id: 427, q: "Translate into English: 'non' ", options: ["bread","cake","cookie","bun"], answer: 0, explain: "'Non' means 'bread'." },
  { id: 428, q: "Choose the correct form: By the time she comes, we ___ dinner.", options: ["will finish","will have finished","finished","finishing"], answer: 1, explain: "Future perfect → 'will have finished'." },
  { id: 429, q: "Translate into English: 'pishiriq' ", options: ["meal","dessert","snack","dish"], answer: 1, explain: "'Pishiriq' means 'dessert'." },
  { id: 430, q: "Choose the correct sentence.", options: ["She made me to laugh.","She made me laugh.","She made me laughing.","She makes me to laugh."], answer: 1, explain: "Correct causative → 'made me laugh'." },
  { id: 431, q: "Translate into English: 'shorva' ", options: ["soup","stew","sauce","salad"], answer: 0, explain: "'Shorva' means 'soup'." },
  { id: 432, q: "Choose the correct form: They ___ dinner when we arrived.", options: ["have","had","were having","are having"], answer: 2, explain: "Past continuous → 'were having'." },
  { id: 433, q: "Translate into English: 'salat' ", options: ["salad","soup","sauce","snack"], answer: 0, explain: "'Salat' means 'salad'." },
  { id: 434, q: "Choose the correct sentence.", options: ["He is good in football.","He is good at football.","He good at football.","He is good on football."], answer: 1, explain: "Correct phrase → 'good at'." },
  { id: 435, q: "Translate into English: 'osh' ", options: ["pilaf","rice","meal","food"], answer: 0, explain: "'Osh' means 'pilaf'." },
  { id: 436, q: "Choose the correct form: We ___ English when she called.", options: ["study","were studying","studies","studied"], answer: 1, explain: "Past continuous → 'were studying'." },
  { id: 437, q: "Translate into English: 'ichimlik' ", options: ["drink","juice","beverage","water"], answer: 2, explain: "'Ichimlik' means 'beverage'." },
  { id: 438, q: "Choose the correct sentence.", options: ["There is much people here.","There are many people here.","There are much people here.","There is many people here."], answer: 1, explain: "Correct → 'many people'." },
  { id: 439, q: "Translate into English: 'suv' ", options: ["juice","milk","water","drink"], answer: 2, explain: "'Suv' means 'water'." },
  { id: 440, q: "Choose the correct form: I ___ my phone yesterday.", options: ["lose","lost","loses","losing"], answer: 1, explain: "Past simple → 'lost'." },
  { id: 441, q: "Translate into English: 'choy' ", options: ["tea","coffee","juice","milk"], answer: 0, explain: "'Choy' means 'tea'." },
  { id: 442, q: "Choose the correct sentence.", options: ["She is capable in doing it.","She is capable of doing it.","She capable of doing it.","She is capable to doing it."], answer: 1, explain: "Correct → 'capable of'." },
  { id: 443, q: "Translate into English: 'qahva' ", options: ["coffee","tea","milk","juice"], answer: 0, explain: "'Qahva' means 'coffee'." },
  { id: 444, q: "Choose the correct form: She ___ in London last year.", options: ["lives","lived","living","live"], answer: 1, explain: "Past simple → 'lived'." },
  { id: 445, q: "Translate into English: 'sharbat' ", options: ["juice","water","drink","tea"], answer: 0, explain: "'Sharbat' means 'juice'." },
  { id: 446, q: "Choose the correct sentence.", options: ["He is married with a teacher.","He is married to a teacher.","He married with a teacher.","He married to a teacher."], answer: 1, explain: "Correct phrase → 'married to'." },
  { id: 447, q: "Translate into English: 'gazlangan ichimlik' ", options: ["mineral water","soda","sparkling juice","lemonade"], answer: 1, explain: "'Gazlangan ichimlik' means 'soda'." },
  { id: 448, q: "Choose the correct form: We ___ already seen that movie.", options: ["have","has","are","was"], answer: 0, explain: "Correct plural present perfect → 'have seen'." },
  { id: 449, q: "Translate into English: 'limonad' ", options: ["lemonade","juice","soda","sparkling water"], answer: 0, explain: "'Limonad' means 'lemonade'." },
  { id: 450, q: "Choose the correct sentence.", options: ["She asked me what was my name.","She asked me what my name was.","She asked me what my name is.","She asked me what is my name."], answer: 1, explain: "Reported speech → 'what my name was'." },
  { id: 451, q: "Translate into English: 'limon' ", options: ["lime","lemon","orange","grape"], answer: 1, explain: "'Limon' means 'lemon'." },
  { id: 452, q: "Choose the correct sentence.", options: ["She said me that she was busy.","She told me that she was busy.","She told that she was busy me.","She said that me she was busy."], answer: 1, explain: "Correct reporting → 'She told me…'." },
  { id: 453, q: "Translate into English: 'olma' ", options: ["pear","apple","peach","plum"], answer: 1, explain: "'Olma' means 'apple'." },
  { id: 454, q: "Choose the correct form: By next year, I ___ my degree.", options: ["will finish","will have finished","finished","finish"], answer: 1, explain: "Future perfect → 'will have finished'." },
  { id: 455, q: "Translate into English: 'anor' ", options: ["grape","pomegranate","cherry","peach"], answer: 1, explain: "'Anor' means 'pomegranate'." },
  { id: 456, q: "Choose the correct sentence.", options: ["She asked me where do I live.","She asked me where I live.","She asked me where I lived.","She asked me where lived I."], answer: 2, explain: "Reported speech (past) → 'where I lived'." },
  { id: 457, q: "Translate into English: 'uzum' ", options: ["cherry","grape","peach","pear"], answer: 1, explain: "'Uzum' means 'grape'." },
  { id: 458, q: "Choose the correct form: I ___ lunch when you called.", options: ["have","was having","had","am having"], answer: 1, explain: "Past continuous → 'was having'." },
  { id: 459, q: "Translate into English: 'behi' ", options: ["peach","pear","quince","plum"], answer: 2, explain: "'Behi' means 'quince'." },
  { id: 460, q: "Choose the correct sentence.", options: ["He explained me the rules.","He explained the rules to me.","He explained to me the rules.","He explained me to the rules."], answer: 1, explain: "Correct structure → 'explain sth to sb'." },
  { id: 461, q: "Translate into English: 'nok' ", options: ["pear","apple","plum","peach"], answer: 0, explain: "'Nok' means 'pear'." },
  { id: 462, q: "Choose the correct form: If I ___ you, I would apologize.", options: ["am","was","were","be"], answer: 2, explain: "Second conditional → 'If I were you'." },
  { id: 463, q: "Translate into English: 'shaftoli' ", options: ["peach","plum","pear","cherry"], answer: 0, explain: "'Shaftoli' means 'peach'." },
  { id: 464, q: "Choose the correct sentence.", options: ["They said me to wait.","They told me to wait.","They told to wait me.","They said to me wait."], answer: 1, explain: "Correct → 'told me to wait'." },
  { id: 465, q: "Translate into English: 'gilos' ", options: ["cherry","grape","plum","peach"], answer: 0, explain: "'Gilos' means 'cherry'." },
  { id: 466, q: "Choose the correct form: While he ___, it started to rain.", options: ["run","ran","was running","running"], answer: 2, explain: "Past continuous → 'was running'." },
  { id: 467, q: "Translate into English: 'olcha' ", options: ["sour cherry","cherry","plum","apricot"], answer: 0, explain: "'Olcha' means 'sour cherry'." },
  { id: 468, q: "Choose the correct sentence.", options: ["I look forward to see you.","I look forward to seeing you.","I look forward see you.","I look forward seeing you."], answer: 1, explain: "Correct → 'look forward to + V-ing'." },
  { id: 469, q: "Translate into English: 'o‘rik' ", options: ["plum","apricot","peach","quince"], answer: 1, explain: "'O‘rik' means 'apricot'." },
  { id: 470, q: "Choose the correct form: She ___ already left when we arrived.", options: ["has","have","had","having"], answer: 2, explain: "Past perfect → 'had left'." },
  { id: 471, q: "Translate into English: 'olxo‘ri' ", options: ["plum","peach","pear","apple"], answer: 0, explain: "'Olxo‘ri' means 'plum'." },
  { id: 472, q: "Choose the correct sentence.", options: ["She said she is tired.","She said she was tired.","She said me she was tired.","She told that she was tired."], answer: 1, explain: "Reported speech (past) → 'was tired'." },
  { id: 473, q: "Translate into English: 'banan' ", options: ["pear","banana","peach","melon"], answer: 1, explain: "'Banan' means 'banana'." },
  { id: 474, q: "Choose the correct form: He ___ a lot of money last year.", options: ["earn","earns","earned","earning"], answer: 2, explain: "Past simple → 'earned'." },
  { id: 475, q: "Translate into English: 'anjir' ", options: ["fig","pear","plum","peach"], answer: 0, explain: "'Anjir' means 'fig'." },
  { id: 476, q: "Choose the correct sentence.", options: ["She prevented me to go there.","She prevented me from going there.","She prevented from me going there.","She prevented me going to there."], answer: 1, explain: "Correct phrase → 'prevent sb from doing'." },
  { id: 477, q: "Translate into English: 'tarvuz' ", options: ["melon","watermelon","pumpkin","cucumber"], answer: 1, explain: "'Tarvuz' means 'watermelon'." },
  { id: 478, q: "Choose the correct form: By 2030, people ___ on Mars.", options: ["live","will live","will have lived","will be living"], answer: 3, explain: "Future continuous → 'will be living'." },
  { id: 479, q: "Translate into English: 'qovun' ", options: ["melon","pumpkin","watermelon","pear"], answer: 0, explain: "'Qovun' means 'melon'." },
  { id: 480, q: "Choose the correct sentence.", options: ["It depends from the weather.","It depends in the weather.","It depends on the weather.","It depends to the weather."], answer: 2, explain: "Correct preposition → 'depends on'." },
  { id: 481, q: "Translate into English: 'xurmo' ", options: ["date","fig","pear","plum"], answer: 0, explain: "'Xurmo' means 'date'." },
  { id: 482, q: "Choose the correct form: He ___ never seen such a thing before.", options: ["has","have","is","was"], answer: 0, explain: "Present perfect singular → 'has seen'." },
  { id: 483, q: "Translate into English: 'anjir quritilgan' ", options: ["raisin","prune","dried fig","date"], answer: 2, explain: "'Anjir quritilgan' means 'dried fig'." },
  { id: 484, q: "Choose the correct sentence.", options: ["She asked me if I can help her.","She asked me if I could help her.","She asked me if could I help her.","She asked me if I may help her."], answer: 1, explain: "Reported speech → 'could help'." },
  { id: 485, q: "Translate into English: 'mayiz' ", options: ["raisin","prune","date","fig"], answer: 0, explain: "'Mayiz' means 'raisin'." },
  { id: 486, q: "Choose the correct form: I ___ my homework before dinner yesterday.", options: ["finish","finished","finishes","finishing"], answer: 1, explain: "Past simple → 'finished'." },
  { id: 487, q: "Translate into English: 'quritilgan olxo‘ri' ", options: ["prune","raisin","dried apricot","date"], answer: 0, explain: "'Quritilgan olxo‘ri' means 'prune'." },
  { id: 488, q: "Choose the correct sentence.", options: ["He said that he will come.","He said that he would come.","He said me that he would come.","He told that he will come."], answer: 1, explain: "Reported speech future → 'would come'." },
  { id: 489, q: "Translate into English: 'quritilgan o‘rik' ", options: ["raisin","dried apricot","prune","date"], answer: 1, explain: "'Quritilgan o‘rik' means 'dried apricot'." },
  { id: 490, q: "Choose the correct form: When I was young, I ___ play football a lot.", options: ["used to","use to","was used to","am used to"], answer: 0, explain: "Correct phrase → 'used to'." },
  { id: 491, q: "Translate into English: 'behi murabbo' ", options: ["pear jam","quince jam","apple jam","peach jam"], answer: 1, explain: "'Behi murabbo' means 'quince jam'." },
  { id: 492, q: "Choose the correct sentence.", options: ["She has married with him.","She is married to him.","She is married with him.","She married to him."], answer: 1, explain: "Correct → 'married to'." },
  { id: 493, q: "Translate into English: 'asal' ", options: ["honey","syrup","jam","sugar"], answer: 0, explain: "'Asal' means 'honey'." },
  { id: 494, q: "Choose the correct form: They ___ to Paris last summer.", options: ["go","went","gone","going"], answer: 1, explain: "Past simple → 'went'." },
  { id: 495, q: "Translate into English: 'murabbo' ", options: ["jam","honey","syrup","sugar"], answer: 0, explain: "'Murabbo' means 'jam'." },
  { id: 496, q: "Choose the correct sentence.", options: ["She asked me what do I want.","She asked me what I wanted.","She asked me what I want.","She asked me what wanted I."], answer: 1, explain: "Reported speech → 'what I wanted'." },
  { id: 497, q: "Translate into English: 'sirka' ", options: ["salt","vinegar","sauce","oil"], answer: 1, explain: "'Sirka' means 'vinegar'." },
  { id: 498, q: "Choose the correct form: He ___ working here since 2015.", options: ["is","was","has been","have been"], answer: 2, explain: "Present perfect continuous → 'has been working'." },
  { id: 499, q: "Translate into English: 'ziravor' ", options: ["spice","sauce","salt","pepper"], answer: 0, explain: "'Ziravor' means 'spice'." },
  { id: 500, q: "Choose the correct sentence.", options: ["If it will rain, we will stay at home.","If it rains, we will stay at home.","If it raining, we will stay at home.","If it rained, we will stay at home."], answer: 1, explain: "First conditional → 'If it rains, we will stay at home'." },
  { id: 501, q: "Translate into English: 'tuz' ", options: ["sugar","salt","spice","pepper"], answer: 1, explain: "'Tuz' means 'salt'." },
  { id: 502, q: "Choose the correct sentence.", options: ["She suggested me to go.","She suggested going.","She suggested to go me.","She suggested to going."], answer: 1, explain: "Correct → 'suggest + V-ing'." },
  { id: 503, q: "Translate into English: 'shakar' ", options: ["sugar","salt","jam","syrup"], answer: 0, explain: "'Shakar' means 'sugar'." },
  { id: 504, q: "Choose the correct form: While I ___ TV, the phone rang.", options: ["watch","watched","was watching","am watching"], answer: 2, explain: "Past continuous → 'was watching'." },
  { id: 505, q: "Translate into English: 'qalampir' ", options: ["pepper","carrot","spice","onion"], answer: 0, explain: "'Qalampir' means 'pepper'." },
  { id: 506, q: "Choose the correct sentence.", options: ["She told me where was she.","She told me where she was.","She told me where she is.","She told me where is she."], answer: 1, explain: "Reported speech → 'where she was'." },
  { id: 507, q: "Translate into English: 'piyoz' ", options: ["garlic","onion","carrot","cabbage"], answer: 1, explain: "'Piyoz' means 'onion'." },
  { id: 508, q: "Choose the correct form: I ___ in this city since 2010.", options: ["live","lived","have lived","am living"], answer: 2, explain: "Present perfect → 'have lived'." },
  { id: 509, q: "Translate into English: 'sabzi' ", options: ["cucumber","cabbage","carrot","tomato"], answer: 2, explain: "'Sabzi' means 'carrot'." },
  { id: 510, q: "Choose the correct sentence.", options: ["She said that she can sing.","She said that she could sing.","She said me that she could sing.","She told that she can sing."], answer: 1, explain: "Reported speech → 'could sing'." },
  { id: 511, q: "Translate into English: 'bodring' ", options: ["cabbage","cucumber","pumpkin","tomato"], answer: 1, explain: "'Bodring' means 'cucumber'." },
  { id: 512, q: "Choose the correct form: If I ___ more money, I would buy a car.", options: ["have","had","has","having"], answer: 1, explain: "Second conditional → 'If I had…'." },
  { id: 513, q: "Translate into English: 'karam' ", options: ["cabbage","carrot","onion","cucumber"], answer: 0, explain: "'Karam' means 'cabbage'." },
  { id: 514, q: "Choose the correct sentence.", options: ["He made me to laugh.","He made me laugh.","He made laugh me.","He made to laugh me."], answer: 1, explain: "Correct → 'make sb do sth'." },
  { id: 515, q: "Translate into English: 'pomidor' ", options: ["cucumber","cabbage","tomato","carrot"], answer: 2, explain: "'Pomidor' means 'tomato'." },
  { id: 516, q: "Choose the correct form: I ___ him yesterday at the market.", options: ["see","saw","seen","seeing"], answer: 1, explain: "Past simple → 'saw'." },
  { id: 517, q: "Translate into English: 'baqlajon' ", options: ["cabbage","eggplant","pumpkin","carrot"], answer: 1, explain: "'Baqlajon' means 'eggplant'." },
  { id: 518, q: "Choose the correct sentence.", options: ["He is interested on music.","He is interested about music.","He is interested in music.","He is interested at music."], answer: 2, explain: "Correct preposition → 'interested in'." },
  { id: 519, q: "Translate into English: 'qovoq' ", options: ["pumpkin","melon","squash","cucumber"], answer: 0, explain: "'Qovoq' means 'pumpkin'." },
  { id: 520, q: "Choose the correct form: She ___ in London when she met him.", options: ["was living","lived","lives","live"], answer: 0, explain: "Past continuous → 'was living'." },
  { id: 521, q: "Translate into English: 'sarimsoq' ", options: ["onion","ginger","garlic","spice"], answer: 2, explain: "'Sarimsoq' means 'garlic'." },
  { id: 522, q: "Choose the correct sentence.", options: ["She reminded me to post the letter.","She reminded to post the letter me.","She reminded me post the letter.","She reminded to me post the letter."], answer: 0, explain: "Correct → 'remind sb to do sth'." },
  { id: 523, q: "Translate into English: 'kartoshka' ", options: ["carrot","cabbage","potato","cucumber"], answer: 2, explain: "'Kartoshka' means 'potato'." },
  { id: 524, q: "Choose the correct form: We ___ for two hours before they arrived.", options: ["waited","have waited","had been waiting","were waiting"], answer: 2, explain: "Past perfect continuous → 'had been waiting'." },
  { id: 525, q: "Translate into English: 'qalampir achchiq' ", options: ["hot pepper","green pepper","black pepper","sweet pepper"], answer: 0, explain: "'Qalampir achchiq' means 'hot pepper'." },
  { id: 526, q: "Choose the correct sentence.", options: ["She explained me the problem.","She explained the problem to me.","She explained to me the problem.","She explained me to the problem."], answer: 1, explain: "Correct → 'explain sth to sb'." },
  { id: 527, q: "Translate into English: 'ismaloq' ", options: ["spinach","cabbage","carrot","lettuce"], answer: 0, explain: "'Ismaloq' means 'spinach'." },
  { id: 528, q: "Choose the correct form: I ___ when she called me.", options: ["drive","drove","was driving","driving"], answer: 2, explain: "Past continuous → 'was driving'." },
  { id: 529, q: "Translate into English: 'salat' ", options: ["dish","salad","sandwich","soup"], answer: 1, explain: "'Salat' means 'salad'." },
  { id: 530, q: "Choose the correct sentence.", options: ["She is good in singing.","She is good at singing.","She is good on singing.","She is good to singing."], answer: 1, explain: "Correct preposition → 'good at'." },
  { id: 531, q: "Translate into English: 'shorva' ", options: ["soup","salad","bread","dish"], answer: 0, explain: "'Shorva' means 'soup'." },
  { id: 532, q: "Choose the correct form: They ___ each other for many years.", options: ["know","knew","have known","knows"], answer: 2, explain: "Present perfect → 'have known'." },
  { id: 533, q: "Translate into English: 'tuxum' ", options: ["egg","milk","cheese","yogurt"], answer: 0, explain: "'Tuxum' means 'egg'." },
  { id: 534, q: "Choose the correct sentence.", options: ["She told that she is hungry.","She said that she was hungry.","She told me that she hungry.","She said me that she was hungry."], answer: 1, explain: "Correct reported speech → 'said that she was hungry'." },
  { id: 535, q: "Translate into English: 'sut' ", options: ["egg","milk","cheese","butter"], answer: 1, explain: "'Sut' means 'milk'." },
  { id: 536, q: "Choose the correct form: He ___ here since last year.", options: ["is working","works","has been working","worked"], answer: 2, explain: "Present perfect continuous → 'has been working'." },
  { id: 537, q: "Translate into English: 'pishloq' ", options: ["yogurt","milk","butter","cheese"], answer: 3, explain: "'Pishloq' means 'cheese'." },
  { id: 538, q: "Choose the correct sentence.", options: ["I am looking forward see you.","I am looking forward to see you.","I am looking forward to seeing you.","I am looking forward seeing you."], answer: 2, explain: "Correct → 'look forward to + V-ing'." },
  { id: 539, q: "Translate into English: 'qaymoq' ", options: ["cream","butter","milk","yogurt"], answer: 0, explain: "'Qaymoq' means 'cream'." },
  { id: 540, q: "Choose the correct form: I ___ to the cinema tomorrow.", options: ["go","going","will go","gone"], answer: 2, explain: "Future simple → 'will go'." },
  { id: 541, q: "Translate into English: 'yog‘' ", options: ["oil","butter","cream","milk"], answer: 0, explain: "'Yog‘' means 'oil'." },
  { id: 542, q: "Choose the correct sentence.", options: ["He suggested to go to the park.","He suggested going to the park.","He suggested me going to the park.","He suggested that going to the park."], answer: 1, explain: "Correct → 'suggest + V-ing'." },
  { id: 543, q: "Translate into English: 'sariyog‘' ", options: ["oil","cream","butter","cheese"], answer: 2, explain: "'Sariyog‘' means 'butter'." },
  { id: 544, q: "Choose the correct form: By the time we arrived, they ___ already eaten.", options: ["has","have","had","having"], answer: 2, explain: "Past perfect → 'had eaten'." },
  { id: 545, q: "Translate into English: 'qatiq' ", options: ["yogurt","cream","cheese","milk"], answer: 0, explain: "'Qatiq' means 'yogurt'." },
  { id: 546, q: "Choose the correct sentence.", options: ["She let me to go.","She let me go.","She let to me go.","She let go me."], answer: 1, explain: "Correct → 'let sb do sth'." },
  { id: 547, q: "Translate into English: 'non' ", options: ["cake","bread","cookie","bun"], answer: 1, explain: "'Non' means 'bread'." },
  { id: 548, q: "Choose the correct form: We ___ in Tashkent last year.", options: ["live","lived","living","lives"], answer: 1, explain: "Past simple → 'lived'." },
  { id: 549, q: "Translate into English: 'shirinlik' ", options: ["salty","dessert","bread","fruit"], answer: 1, explain: "'Shirinlik' means 'dessert'." },
  { id: 550, q: "Choose the correct sentence.", options: ["She is married with a doctor.","She is married to a doctor.","She married with a doctor.","She married to a doctor."], answer: 1, explain: "Correct → 'married to'." },
  { id: 551, q: "Translate into English: 'pitsa' ", options: ["bread","pie","pizza","cake"], answer: 2, explain: "'Pitsa' means 'pizza'." },
  { id: 552, q: "Choose the correct form: She ___ her homework before dinner.", options: ["finish","finishes","finished","finishing"], answer: 2, explain: "Past simple → 'finished'." },
  { id: 553, q: "Translate into English: 'shokolad' ", options: ["candy","chocolate","cake","cookie"], answer: 1, explain: "'Shokolad' means 'chocolate'." },
  { id: 554, q: "Choose the correct sentence.", options: ["She asked me where do I work.","She asked me where I work.","She asked me where I worked.","She asked me where worked I."], answer: 2, explain: "Reported speech → 'where I worked'." },
  { id: 555, q: "Translate into English: 'kofe' ", options: ["tea","juice","coffee","milk"], answer: 2, explain: "'Kofe' means 'coffee'." },
  { id: 556, q: "Choose the correct form: If she ___ earlier, she would not be late.", options: ["leave","leaves","left","leaving"], answer: 2, explain: "Second conditional → 'If she left…'." },
  { id: 557, q: "Translate into English: 'choy' ", options: ["milk","coffee","juice","tea"], answer: 3, explain: "'Choy' means 'tea'." },
  { id: 558, q: "Choose the correct sentence.", options: ["She told that she likes books.","She said that she liked books.","She said me that she liked books.","She told me that she likes books."], answer: 1, explain: "Reported speech → 'said that she liked…'." },
  { id: 559, q: "Translate into English: 'sharbat' ", options: ["juice","water","milk","tea"], answer: 0, explain: "'Sharbat' means 'juice'." },
  { id: 560, q: "Choose the correct form: They ___ to Italy many times.", options: ["go","went","gone","have gone"], answer: 3, explain: "Present perfect → 'have gone'." },
  { id: 561, q: "Translate into English: 'gazli suv' ", options: ["mineral water","juice","soda water","sparkling water"], answer: 3, explain: "'Gazli suv' means 'sparkling water'." },
  { id: 562, q: "Choose the correct sentence.", options: ["He prevented me go.","He prevented me to go.","He prevented me from going.","He prevented from going me."], answer: 2, explain: "Correct phrase → 'prevent sb from doing'." },
  { id: 563, q: "Translate into English: 'limonad' ", options: ["soda","juice","lemonade","tea"], answer: 2, explain: "'Limonad' means 'lemonade'." },
  { id: 564, q: "Choose the correct form: She ___ never been to London before.", options: ["has","have","was","is"], answer: 0, explain: "Present perfect singular → 'has never been'." },
  { id: 565, q: "Translate into English: 'tort' ", options: ["pie","cake","cookie","bread"], answer: 1, explain: "'Tort' means 'cake'." },
  { id: 566, q: "Choose the correct sentence.", options: ["He said he will help.","He said he would help.","He said me he would help.","He told he will help."], answer: 1, explain: "Reported future → 'would help'." },
  { id: 567, q: "Translate into English: 'pechenye' ", options: ["bread","cookie","cake","biscuit"], answer: 1, explain: "'Pechenye' means 'cookie' or 'biscuit'." },
  { id: 568, q: "Choose the correct form: While they ___ football, it started to rain.", options: ["play","played","were playing","are playing"], answer: 2, explain: "Past continuous → 'were playing'." },
  { id: 569, q: "Translate into English: 'pirog' ", options: ["bread","pie","cake","cookie"], answer: 1, explain: "'Pirog' means 'pie'." },
  { id: 570, q: "Choose the correct sentence.", options: ["I am good in English.","I am good at English.","I am good on English.","I am good of English."], answer: 1, explain: "Correct → 'good at'." },
  { id: 571, q: "Translate into English: 'sendvich' ", options: ["pie","sandwich","cake","biscuit"], answer: 1, explain: "'Sendvich' means 'sandwich'." },
  { id: 572, q: "Choose the correct form: She ___ in Moscow last year.", options: ["study","studies","studied","studying"], answer: 2, explain: "Past simple → 'studied'." },
  { id: 573, q: "Translate into English: 'makaron' ", options: ["bread","pasta","noodle","pie"], answer: 1, explain: "'Makaron' means 'pasta'." },
  { id: 574, q: "Choose the correct sentence.", options: ["She explained me the answer.","She explained the answer to me.","She explained to me the answer.","She explained me to the answer."], answer: 1, explain: "Correct → 'explain sth to sb'." },
  { id: 575, q: "Translate into English: 'guruch' ", options: ["rice","barley","oats","corn"], answer: 0, explain: "'Guruch' means 'rice'." },
  { id: 576, q: "Choose the correct form: If it ___ tomorrow, we will stay at home.", options: ["rain","rains","rained","raining"], answer: 1, explain: "First conditional → 'If it rains…'." },
  { id: 577, q: "Translate into English: 'joxori' ", options: ["corn","rice","barley","bean"], answer: 0, explain: "'Joxori' means 'corn'." },
  { id: 578, q: "Choose the correct sentence.", options: ["She let me to help her.","She let me help her.","She let help me her.","She let her help me."], answer: 1, explain: "Correct → 'let sb do sth'." },
  { id: 579, q: "Translate into English: 'mosh' ", options: ["peas","bean","lentil","barley"], answer: 1, explain: "'Mosh' means 'bean'." },
  { id: 580, q: "Choose the correct form: They ___ TV when I came.", options: ["watch","watched","were watching","watching"], answer: 2, explain: "Past continuous → 'were watching'." },
  { id: 581, q: "Translate into English: 'no‘xat' ", options: ["pea","bean","lentil","barley"], answer: 0, explain: "'No‘xat' means 'pea'." },
  { id: 582, q: "Choose the correct sentence.", options: ["She is married with him.","She is married to him.","She married to him.","She married with him."], answer: 1, explain: "Correct → 'married to'." },
  { id: 583, q: "Translate into English: 'loviya' ", options: ["bean","pea","corn","barley"], answer: 0, explain: "'Loviya' means 'bean'." },
  { id: 584, q: "Choose the correct form: By next year, they ___ their house.", options: ["finish","finished","will have finished","finishing"], answer: 2, explain: "Future perfect → 'will have finished'." },
  { id: 585, q: "Translate into English: 'grechka' ", options: ["buckwheat","barley","oat","corn"], answer: 0, explain: "'Grechka' means 'buckwheat'." },
  { id: 586, q: "Choose the correct sentence.", options: ["I look forward to see you.","I look forward seeing you.","I look forward to seeing you.","I look forward see you."], answer: 2, explain: "Correct → 'look forward to + V-ing'." },
  { id: 587, q: "Translate into English: 'arpa' ", options: ["corn","barley","oat","bean"], answer: 1, explain: "'Arpa' means 'barley'." },
  { id: 588, q: "Choose the correct form: He ___ working here since 2018.", options: ["is","was","has been","have been"], answer: 2, explain: "Present perfect continuous → 'has been working'." },
  { id: 589, q: "Translate into English: 'jo‘xori yormasi' ", options: ["semolina","oatmeal","corn grits","barley"], answer: 2, explain: "'Jo‘xori yormasi' means 'corn grits'." },
  { id: 590, q: "Choose the correct sentence.", options: ["She asked me if I can come.","She asked me if I could come.","She asked me if could I come.","She asked me if I may come."], answer: 1, explain: "Reported question → 'if I could…'." },
  { id: 591, q: "Translate into English: 'yorma' ", options: ["groats","grits","oatmeal","rice"], answer: 0, explain: "'Yorma' means 'groats'." },
  { id: 592, q: "Choose the correct form: They ___ the letter when I arrived.", options: ["write","wrote","were writing","writing"], answer: 2, explain: "Past continuous → 'were writing'." },
  { id: 593, q: "Translate into English: 'qaynatma' ", options: ["jam","boil","stew","broth"], answer: 3, explain: "'Qaynatma' means 'broth'." },
  { id: 594, q: "Choose the correct sentence.", options: ["He said he is tired.","He said he was tired.","He said me he was tired.","He told he is tired."], answer: 1, explain: "Reported speech (past) → 'was tired'." },
  { id: 595, q: "Translate into English: 'dimlama' ", options: ["fried","stew","soup","boil"], answer: 1, explain: "'Dimlama' means 'stew'." },
  { id: 596, q: "Choose the correct form: She ___ to Paris last month.", options: ["go","goes","went","gone"], answer: 2, explain: "Past simple → 'went'." },
  { id: 597, q: "Translate into English: 'qovurdoq' ", options: ["fried meat","stew","roast","grilled meat"], answer: 0, explain: "'Qovurdoq' means 'fried meat'." },
  { id: 598, q: "Choose the correct sentence.", options: ["He explained me the task.","He explained the task to me.","He explained to me the task.","He explained me to the task."], answer: 1, explain: "Correct → 'explain sth to sb'." },
  { id: 599, q: "Translate into English: 'somsa' ", options: ["pie","samosa","cake","cookie"], answer: 1, explain: "'Somsa' means 'samosa'." },
  { id: 600, q: "Choose the correct form: By 2025, I ___ English well.", options: ["speak","spoke","will speak","will have spoken"], answer: 3, explain: "Future perfect → 'will have spoken'." },
  { id: 601, q: "Translate into English: 'osh' ", options: ["soup","rice pilaf","bread","cake"], answer: 1, explain: "'Osh' means 'rice pilaf'." },
  { id: 602, q: "Choose the correct form: She ___ already finished her homework.", options: ["has","have","was","is"], answer: 0, explain: "Present perfect singular → 'has finished'." },
  { id: 603, q: "Translate into English: 'sho‘rva' ", options: ["soup","stew","broth","salad"], answer: 0, explain: "'Sho‘rva' means 'soup'." },
  { id: 604, q: "Choose the correct sentence.", options: ["I suggested him to go.","I suggested to him going.","I suggested going to him.","I suggested that he go."], answer: 3, explain: "Correct → 'I suggested that he go'." },
  { id: 605, q: "Translate into English: 'salat' ", options: ["soup","bread","salad","sauce"], answer: 2, explain: "'Salat' means 'salad'." },
  { id: 606, q: "Choose the correct form: They ___ football every Sunday.", options: ["plays","play","played","playing"], answer: 1, explain: "Present simple plural → 'play'." },
  { id: 607, q: "Translate into English: 'non' ", options: ["bread","pie","cake","cookie"], answer: 0, explain: "'Non' means 'bread'." },
  { id: 608, q: "Choose the correct sentence.", options: ["He is interested on history.","He is interested at history.","He is interested in history.","He is interested for history."], answer: 2, explain: "Correct → 'interested in'." },
  { id: 609, q: "Translate into English: 'qatiq' ", options: ["milk","yogurt","cream","cheese"], answer: 1, explain: "'Qatiq' means 'yogurt'." },
  { id: 610, q: "Choose the correct form: She ___ TV when the phone rang.", options: ["watch","watched","was watching","is watching"], answer: 2, explain: "Past continuous → 'was watching'." },
  { id: 611, q: "Translate into English: 'sut' ", options: ["milk","cream","butter","cheese"], answer: 0, explain: "'Sut' means 'milk'." },
  { id: 612, q: "Choose the correct sentence.", options: ["She said me that she is tired.","She said that she was tired.","She told that she is tired.","She said me she was tired."], answer: 1, explain: "Reported speech (past) → 'was tired'." },
  { id: 613, q: "Translate into English: 'tvorog' ", options: ["cottage cheese","cream","butter","yogurt"], answer: 0, explain: "'Tvorog' means 'cottage cheese'." },
  { id: 614, q: "Choose the correct form: If I ___ you, I would study harder.", options: ["was","were","am","be"], answer: 1, explain: "Second conditional → 'If I were you'." },
  { id: 615, q: "Translate into English: 'pishloq' ", options: ["cream","milk","cheese","butter"], answer: 2, explain: "'Pishloq' means 'cheese'." },
  { id: 616, q: "Choose the correct sentence.", options: ["I want that you help me.","I want you help me.","I want you to help me.","I want you helping me."], answer: 2, explain: "Correct → 'I want you to help me'." },
  { id: 617, q: "Translate into English: 'smetana' ", options: ["cream","milk","butter","cheese"], answer: 0, explain: "'Smetana' means 'cream'." },
  { id: 618, q: "Choose the correct form: They ___ here since Monday.", options: ["are","were","have been","has been"], answer: 2, explain: "Present perfect → 'have been'." },
  { id: 619, q: "Translate into English: 'qaymoq' ", options: ["cream","butter","milk","cheese"], answer: 0, explain: "'Qaymoq' means 'cream'." },
  { id: 620, q: "Choose the correct sentence.", options: ["He denied to go.","He denied going.","He denied go.","He denied gone."], answer: 1, explain: "Correct → 'denied going'." },
  { id: 621, q: "Translate into English: 'yog‘' ", options: ["oil","butter","fat","cream"], answer: 1, explain: "'Yog‘' means 'butter'." },
  { id: 622, q: "Choose the correct form: She ___ shopping yesterday.", options: ["go","goes","went","gone"], answer: 2, explain: "Past simple → 'went'." },
  { id: 623, q: "Translate into English: 'saryog‘' ", options: ["butter","oil","cream","cheese"], answer: 0, explain: "'Saryog‘' means 'butter'." },
  { id: 624, q: "Choose the correct sentence.", options: ["He suggested to take a taxi.","He suggested taking a taxi.","He suggested take a taxi.","He suggested taken a taxi."], answer: 1, explain: "Correct → 'suggest doing sth'." },
  { id: 625, q: "Translate into English: 'o‘simlik yog‘i' ", options: ["oil","butter","cream","milk"], answer: 0, explain: "'O‘simlik yog‘i' means 'oil'." },
  { id: 626, q: "Choose the correct form: While I ___ home, I met my friend.", options: ["walk","walked","was walking","am walking"], answer: 2, explain: "Past continuous → 'was walking'." },
  { id: 627, q: "Translate into English: 'go‘sht' ", options: ["fish","chicken","meat","beef"], answer: 2, explain: "'Go‘sht' means 'meat'." },
  { id: 628, q: "Choose the correct sentence.", options: ["I am looking forward to meet you.","I am looking forward meeting you.","I am looking forward to meeting you.","I am looking forward meet you."], answer: 2, explain: "Correct → 'look forward to + V-ing'." },
  { id: 629, q: "Translate into English: 'mol go‘shti' ", options: ["beef","pork","mutton","lamb"], answer: 0, explain: "'Mol go‘shti' means 'beef'." },
  { id: 630, q: "Choose the correct form: He ___ his car since 2010.", options: ["has","have","is having","was"], answer: 0, explain: "Present perfect → 'has had'." },
  { id: 631, q: "Translate into English: 'qo‘y go‘shti' ", options: ["beef","pork","mutton","chicken"], answer: 2, explain: "'Qo‘y go‘shti' means 'mutton'." },
  { id: 632, q: "Choose the correct sentence.", options: ["She is used to wake up early.","She is used waking up early.","She is used to waking up early.","She is used wake up early."], answer: 2, explain: "Correct → 'used to + V-ing'." },
  { id: 633, q: "Translate into English: 'cho‘chqa go‘shti' ", options: ["beef","pork","chicken","lamb"], answer: 1, explain: "'Cho‘chqa go‘shti' means 'pork'." },
  { id: 634, q: "Choose the correct form: If it ___, we will not go outside.", options: ["rain","rains","rained","raining"], answer: 1, explain: "First conditional → 'If it rains…'." },
  { id: 635, q: "Translate into English: 'tovuq go‘shti' ", options: ["fish","chicken","pork","duck"], answer: 1, explain: "'Tovuq go‘shti' means 'chicken'." },
  { id: 636, q: "Choose the correct sentence.", options: ["She explained me how to do it.","She explained me to do it.","She explained how to do it to me.","She explained me how do it."], answer: 2, explain: "Correct → 'explain sth to sb'." },
  { id: 637, q: "Translate into English: 'baliq' ", options: ["fish","meat","pork","duck"], answer: 0, explain: "'Baliq' means 'fish'." },
  { id: 638, q: "Choose the correct form: She ___ in London since 2015.", options: ["lives","is living","has lived","was living"], answer: 2, explain: "Present perfect → 'has lived'." },
  { id: 639, q: "Translate into English: 'qiyma' ", options: ["minced meat","fish","steak","cutlet"], answer: 0, explain: "'Qiyma' means 'minced meat'." },
  { id: 640, q: "Choose the correct sentence.", options: ["She told me go home.","She told me to go home.","She said me to go home.","She said me go home."], answer: 1, explain: "Correct → 'told me to go'." },
  { id: 641, q: "Translate into English: 'kolbasa' ", options: ["ham","sausage","salami","bacon"], answer: 1, explain: "'Kolbasa' means 'sausage'." },
  { id: 642, q: "Choose the correct form: They ___ to the park yesterday.", options: ["go","goes","went","gone"], answer: 2, explain: "Past simple → 'went'." },
  { id: 643, q: "Translate into English: 'tovuq oyog‘i' ", options: ["chicken wing","chicken drumstick","duck leg","turkey leg"], answer: 1, explain: "'Tovuq oyog‘i' means 'chicken drumstick'." },
  { id: 644, q: "Choose the correct sentence.", options: ["He admitted to steal the money.","He admitted stealing the money.","He admitted stolen the money.","He admitted steal the money."], answer: 1, explain: "Correct → 'admitted doing sth'." },
  { id: 645, q: "Translate into English: 'qanot' ", options: ["wing","leg","arm","hand"], answer: 0, explain: "'Qanot' means 'wing'." },
  { id: 646, q: "Choose the correct form: When I ___, she was cooking dinner.", options: ["arrive","arrived","arrives","am arriving"], answer: 1, explain: "Past simple → 'arrived'." },
  { id: 647, q: "Translate into English: 'jigar' ", options: ["heart","kidney","liver","lung"], answer: 2, explain: "'Jigar' means 'liver'." },
  { id: 648, q: "Choose the correct sentence.", options: ["She is keen of music.","She is keen on music.","She is keen for music.","She is keen at music."], answer: 1, explain: "Correct → 'keen on'." },
  { id: 649, q: "Translate into English: 'til' (go‘sht qismi)", options: ["tongue","lip","cheek","chin"], answer: 0, explain: "'Til' (meat) means 'tongue'." },
  { id: 650, q: "Choose the correct form: They ___ working hard when I saw them.", options: ["are","was","were","be"], answer: 2, explain: "Past continuous plural → 'were working'." },
  { id: 651, q: "Translate into English: 'buyrak' ", options: ["liver","kidney","lung","heart"], answer: 1, explain: "'Buyrak' means 'kidney'." },
  { id: 652, q: "Choose the correct form: He ___ already done his work.", options: ["has","have","was","is"], answer: 0, explain: "Present perfect singular → 'has done'." },
  { id: 653, q: "Translate into English: 'o‘pka' ", options: ["heart","lung","kidney","liver"], answer: 1, explain: "'O‘pka' means 'lung'." },
  { id: 654, q: "Choose the correct sentence.", options: ["He suggested to go for a walk.","He suggested going for a walk.","He suggested go for a walk.","He suggested gone for a walk."], answer: 1, explain: "Correct → 'suggest doing'." },
  { id: 655, q: "Translate into English: 'yurak' ", options: ["heart","lung","liver","kidney"], answer: 0, explain: "'Yurak' means 'heart'." },
  { id: 656, q: "Choose the correct form: If I ___ rich, I would buy a car.", options: ["am","was","were","be"], answer: 2, explain: "Second conditional → 'If I were rich…'." },
  { id: 657, q: "Translate into English: 'mushak' ", options: ["muscle","bone","skin","nerve"], answer: 0, explain: "'Mushak' means 'muscle'." },
  { id: 658, q: "Choose the correct sentence.", options: ["She told me that she will come.","She told me that she would come.","She said me that she would come.","She told that she will come."], answer: 1, explain: "Reported speech (future) → 'would come'." },
  { id: 659, q: "Translate into English: 'suyak' ", options: ["muscle","skin","bone","nerve"], answer: 2, explain: "'Suyak' means 'bone'." },
  { id: 660, q: "Choose the correct form: They ___ TV when I entered.", options: ["watch","watched","were watching","are watching"], answer: 2, explain: "Past continuous → 'were watching'." },
  { id: 661, q: "Translate into English: 'teri' ", options: ["bone","skin","muscle","flesh"], answer: 1, explain: "'Teri' means 'skin'." },
  { id: 662, q: "Choose the correct sentence.", options: ["I look forward to see you soon.","I look forward to seeing you soon.","I look forward see you soon.","I look forward seeing you soon."], answer: 1, explain: "Correct → 'look forward to + V-ing'." },
  { id: 663, q: "Translate into English: 'asab' ", options: ["muscle","nerve","bone","brain"], answer: 1, explain: "'Asab' means 'nerve'." },
  { id: 664, q: "Choose the correct form: She ___ her leg yesterday.", options: ["break","broke","broken","breaks"], answer: 1, explain: "Past simple → 'broke'." },
  { id: 665, q: "Translate into English: 'miya' ", options: ["heart","brain","nerve","lung"], answer: 1, explain: "'Miya' means 'brain'." },
  { id: 666, q: "Choose the correct sentence.", options: ["She married with him.","She married to him.","She married him.","She is married him."], answer: 2, explain: "Correct → 'She married him'." },
  { id: 667, q: "Translate into English: 'ko‘krak' ", options: ["chest","stomach","back","neck"], answer: 0, explain: "'Ko‘krak' means 'chest'." },
  { id: 668, q: "Choose the correct form: They ___ in Tashkent since 2010.", options: ["lived","have lived","are living","live"], answer: 1, explain: "Present perfect → 'have lived'." },
  { id: 669, q: "Translate into English: 'qorin' ", options: ["back","neck","stomach","chest"], answer: 2, explain: "'Qorin' means 'stomach'." },
  { id: 670, q: "Choose the correct sentence.", options: ["He is good in maths.","He is good on maths.","He is good at maths.","He is good for maths."], answer: 2, explain: "Correct → 'good at'." },
  { id: 671, q: "Translate into English: 'bel' ", options: ["back","waist","chest","stomach"], answer: 1, explain: "'Bel' means 'waist'." },
  { id: 672, q: "Choose the correct form: She ___ a letter when I entered.", options: ["write","writes","was writing","is writing"], answer: 2, explain: "Past continuous → 'was writing'." },
  { id: 673, q: "Translate into English: 'yelkа' ", options: ["shoulder","neck","arm","back"], answer: 0, explain: "'Yelkа' means 'shoulder'." },
  { id: 674, q: "Choose the correct sentence.", options: ["She is interested on art.","She is interested in art.","She is interested at art.","She is interested for art."], answer: 1, explain: "Correct → 'interested in'." },
  { id: 675, q: "Translate into English: 'bo‘yin' ", options: ["back","neck","waist","arm"], answer: 1, explain: "'Bo‘yin' means 'neck'." },
  { id: 676, q: "Choose the correct form: If he ___ earlier, he would not miss the bus.", options: ["leave","left","leaves","leaving"], answer: 1, explain: "Second conditional → 'If he left…'." },
  { id: 677, q: "Translate into English: 'orqa' ", options: ["back","waist","neck","chest"], answer: 0, explain: "'Orqa' means 'back'." },
  { id: 678, q: "Choose the correct sentence.", options: ["He told me go.","He told me to go.","He said me to go.","He told to me go."], answer: 1, explain: "Correct → 'told me to go'." },
  { id: 679, q: "Translate into English: 'oyoq' ", options: ["hand","foot","leg","toe"], answer: 2, explain: "'Oyoq' means 'leg'." },
  { id: 680, q: "Choose the correct form: They ___ a new house last year.", options: ["buy","buys","bought","buying"], answer: 2, explain: "Past simple → 'bought'." },
  { id: 681, q: "Translate into English: 'qo‘l' ", options: ["hand","arm","finger","shoulder"], answer: 0, explain: "'Qo‘l' means 'hand'." },
  { id: 682, q: "Choose the correct sentence.", options: ["I am used to wake up early.","I am used waking up early.","I am used to waking up early.","I am used wake up early."], answer: 2, explain: "Correct → 'used to + V-ing'." },
  { id: 683, q: "Translate into English: 'barmoq' ", options: ["finger","hand","toe","arm"], answer: 0, explain: "'Barmoq' means 'finger'." },
  { id: 684, q: "Choose the correct form: By next week, I ___ this book.", options: ["finish","finished","will finish","will have finished"], answer: 3, explain: "Future perfect → 'will have finished'." },
  { id: 685, q: "Translate into English: 'oyoq panjasi' ", options: ["heel","toe","foot","sole"], answer: 2, explain: "'Oyoq panjasi' means 'foot'." },
  { id: 686, q: "Choose the correct sentence.", options: ["She prevented me to go.","She prevented me go.","She prevented me from going.","She prevented from me going."], answer: 2, explain: "Correct → 'prevent sb from doing'." },
  { id: 687, q: "Translate into English: 'tizza' ", options: ["knee","ankle","heel","toe"], answer: 0, explain: "'Tizza' means 'knee'." },
  { id: 688, q: "Choose the correct form: He ___ here since Monday.", options: ["is","was","has been","have been"], answer: 2, explain: "Present perfect → 'has been'." },
  { id: 689, q: "Translate into English: 'tovon' ", options: ["knee","heel","ankle","toe"], answer: 1, explain: "'Tovon' means 'heel'." },
  { id: 690, q: "Choose the correct sentence.", options: ["She explained me the problem.","She explained the problem to me.","She explained me to the problem.","She explained to me problem."], answer: 1, explain: "Correct → 'explain sth to sb'." },
  { id: 691, q: "Translate into English: 'to‘piq' ", options: ["heel","ankle","toe","knee"], answer: 1, explain: "'To‘piq' means 'ankle'." },
  { id: 692, q: "Choose the correct form: When I ___ him, he was reading a book.", options: ["see","saw","seen","seeing"], answer: 1, explain: "Past simple → 'saw'." },
  { id: 693, q: "Translate into English: 'panja' ", options: ["toe","finger","hand","foot"], answer: 0, explain: "'Panja' means 'toe'." },
  { id: 694, q: "Choose the correct sentence.", options: ["She admitted steal the money.","She admitted to steal the money.","She admitted stealing the money.","She admitted stolen the money."], answer: 2, explain: "Correct → 'admitted doing sth'." },
  { id: 695, q: "Translate into English: 'tirnoq' ", options: ["tooth","nail","claw","finger"], answer: 1, explain: "'Tirnoq' means 'nail'." },
  { id: 696, q: "Choose the correct form: They ___ their work when I arrived.", options: ["finish","finished","were finishing","finishing"], answer: 2, explain: "Past continuous → 'were finishing'." },
  { id: 697, q: "Translate into English: 'soch' ", options: ["hair","fur","wool","thread"], answer: 0, explain: "'Soch' means 'hair'." },
  { id: 698, q: "Choose the correct sentence.", options: ["He said that he is busy.","He said that he was busy.","He said me that he was busy.","He told that he is busy."], answer: 1, explain: "Reported speech (past) → 'was busy'." },
  { id: 699, q: "Translate into English: 'qosh' ", options: ["eyelash","eyebrow","lid","mustache"], answer: 1, explain: "'Qosh' means 'eyebrow'." },
  { id: 700, q: "Choose the correct form: I ___ my keys yesterday.", options: ["lose","lost","losing","loses"], answer: 1, explain: "Past simple → 'lost'." },
  { id: 701, q: "Translate into English: 'kiprik' ", options: ["eyebrow","eyelash","lid","mustache"], answer: 1, explain: "'Kiprik' means 'eyelash'." },
  { id: 702, q: "Choose the correct form: I ___ my homework before dinner.", options: ["finished","had finished","finish","was finishing"], answer: 1, explain: "Past perfect → 'had finished before'." },
  { id: 703, q: "Translate into English: 'lab' ", options: ["lip","tongue","mouth","tooth"], answer: 0, explain: "'Lab' means 'lip'." },
  { id: 704, q: "Choose the correct sentence.", options: ["He denied to steal the money.","He denied stealing the money.","He denied stole the money.","He denied stolen the money."], answer: 1, explain: "Correct → 'denied doing'." },
  { id: 705, q: "Translate into English: 'til' ", options: ["tongue","lip","tooth","mouth"], answer: 0, explain: "'Til' means 'tongue'." },
  { id: 706, q: "Choose the correct form: I ___ to the USA last year.", options: ["go","gone","went","going"], answer: 2, explain: "Past simple → 'went'." },
  { id: 707, q: "Translate into English: 'tish' ", options: ["lip","tongue","tooth","gum"], answer: 2, explain: "'Tish' means 'tooth'." },
  { id: 708, q: "Choose the correct sentence.", options: ["She suggested to take a taxi.","She suggested taking a taxi.","She suggested take a taxi.","She suggested took a taxi."], answer: 1, explain: "Correct → 'suggest doing'." },
  { id: 709, q: "Translate into English: 'og‘iz' ", options: ["mouth","lip","tongue","throat"], answer: 0, explain: "'Og‘iz' means 'mouth'." },
  { id: 710, q: "Choose the correct form: He ___ for 2 hours before I came.", options: ["worked","was working","had been working","works"], answer: 2, explain: "Past perfect continuous → 'had been working'." },
  { id: 711, q: "Translate into English: 'bo‘g‘iz' ", options: ["neck","throat","chest","waist"], answer: 1, explain: "'Bo‘g‘iz' means 'throat'." },
  { id: 712, q: "Choose the correct sentence.", options: ["I avoid to eat fast food.","I avoid eat fast food.","I avoid eating fast food.","I avoid eats fast food."], answer: 2, explain: "Correct → 'avoid doing'." },
  { id: 713, q: "Translate into English: 'qon' ", options: ["flesh","blood","vein","skin"], answer: 1, explain: "'Qon' means 'blood'." },
  { id: 714, q: "Choose the correct form: While I ___, he was cooking.", options: ["study","studied","was studying","studies"], answer: 2, explain: "Past continuous." },
  { id: 715, q: "Translate into English: 'jigar' ", options: ["kidney","lung","liver","heart"], answer: 2, explain: "'Jigar' means 'liver'." },
  { id: 716, q: "Choose the correct sentence.", options: ["She explained me the rules.","She explained the rules to me.","She explained to me rules.","She explained rules me."], answer: 1, explain: "Correct → 'explain sth to sb'." },
  { id: 717, q: "Translate into English: 'tomir' ", options: ["nerve","vein","artery","muscle"], answer: 1, explain: "'Tomir' means 'vein'." },
  { id: 718, q: "Choose the correct form: They ___ already left when we arrived.", options: ["have","has","had","having"], answer: 2, explain: "Past perfect → 'had left'." },
  { id: 719, q: "Translate into English: 'arteriya' ", options: ["artery","vein","nerve","muscle"], answer: 0, explain: "'Arteriya' means 'artery'." },
  { id: 720, q: "Choose the correct sentence.", options: ["He accused me stealing.","He accused me to steal.","He accused me of stealing.","He accused me from stealing."], answer: 2, explain: "Correct → 'accused sb of doing'." },
  { id: 721, q: "Translate into English: 'qon bosimi' ", options: ["blood sugar","blood pressure","blood flow","pulse"], answer: 1, explain: "'Qon bosimi' means 'blood pressure'." },
  { id: 722, q: "Choose the correct form: She ___ never seen such a film before.", options: ["was","is","has","had"], answer: 2, explain: "Present perfect → 'has seen'." },
  { id: 723, q: "Translate into English: 'nafas olish' ", options: ["breathing","coughing","sneezing","yawning"], answer: 0, explain: "'Nafas olish' means 'breathing'." },
  { id: 724, q: "Choose the correct sentence.", options: ["She insisted to pay.","She insisted on paying.","She insisted for paying.","She insisted in paying."], answer: 1, explain: "Correct → 'insist on doing'." },
  { id: 725, q: "Translate into English: 'yo‘tаl' ", options: ["sneeze","cough","breath","hiccup"], answer: 1, explain: "'Yo‘tаl' means 'cough'." },
  { id: 726, q: "Choose the correct form: When I was young, I ___ swim very well.", options: ["can","could","am able to","was able"], answer: 1, explain: "Past ability → 'could'." },
  { id: 727, q: "Translate into English: 'aksirish' ", options: ["cough","sneeze","hiccup","breathe"], answer: 1, explain: "'Aksirish' means 'sneeze'." },
  { id: 728, q: "Choose the correct sentence.", options: ["He congratulated me for passing.","He congratulated me on passing.","He congratulated me to pass.","He congratulated me of passing."], answer: 1, explain: "Correct → 'congratulate sb on doing'." },
  { id: 729, q: "Translate into English: 'hijqiriq' ", options: ["cough","hiccup","sneeze","yawn"], answer: 1, explain: "'Hijqiriq' means 'hiccup'." },
  { id: 730, q: "Choose the correct form: He ___ a book now.", options: ["reads","is reading","read","was reading"], answer: 1, explain: "Present continuous." },
  { id: 731, q: "Translate into English: 'yo‘tаl qilish' ", options: ["to sneeze","to cough","to hiccup","to yawn"], answer: 1, explain: "'Yo‘tаl qilish' means 'to cough'." },
  { id: 732, q: "Choose the correct sentence.", options: ["She is used to get up early.","She is used getting up early.","She is used to getting up early.","She is used get up early."], answer: 2, explain: "Correct → 'be used to + V-ing'." },
  { id: 733, q: "Translate into English: 'uyqu' ", options: ["dream","rest","nap","sleep"], answer: 3, explain: "'Uyqu' means 'sleep'." },
  { id: 734, q: "Choose the correct form: The train ___ at 6 p.m. yesterday.", options: ["leave","leaves","left","leaving"], answer: 2, explain: "Past simple → 'left'." },
  { id: 735, q: "Translate into English: 'tush' ", options: ["dream","nap","rest","sleep"], answer: 0, explain: "'Tush' means 'dream'." },
  { id: 736, q: "Choose the correct sentence.", options: ["She succeeded to win.","She succeeded in winning.","She succeeded at winning.","She succeeded on winning."], answer: 1, explain: "Correct → 'succeed in doing'." },
  { id: 737, q: "Translate into English: 'uyqu bosishi' ", options: ["sleep attack","sleep pressure","sleepiness","insomnia"], answer: 2, explain: "'Uyqu bosishi' means 'sleepiness'." },
  { id: 738, q: "Choose the correct form: They ___ to London tomorrow.", options: ["fly","flies","are flying","will fly"], answer: 3, explain: "Future simple → 'will fly'." },
  { id: 739, q: "Translate into English: 'uyqusizlik' ", options: ["insomnia","sleepiness","nap","rest"], answer: 0, explain: "'Uyqusizlik' means 'insomnia'." },
  { id: 740, q: "Choose the correct sentence.", options: ["She apologized for being late.","She apologized of being late.","She apologized to being late.","She apologized with being late."], answer: 0, explain: "Correct → 'apologize for doing'." },
  { id: 741, q: "Translate into English: 'dam olish' ", options: ["dream","rest","sleep","nap"], answer: 1, explain: "'Dam olish' means 'rest'." },
  { id: 742, q: "Choose the correct form: He ___ in Tashkent now.", options: ["live","lives","living","is live"], answer: 1, explain: "Present simple → 'lives'." },
  { id: 743, q: "Translate into English: 'uxlab qolmoq' ", options: ["to rest","to sleep","to nap","to fall asleep"], answer: 3, explain: "'Uxlab qolmoq' means 'to fall asleep'." },
  { id: 744, q: "Choose the correct sentence.", options: ["She admitted to cheat.","She admitted cheat.","She admitted cheating.","She admitted cheated."], answer: 2, explain: "Correct → 'admit doing'." },
  { id: 745, q: "Translate into English: 'ko‘z yoshi' ", options: ["tear","drop","cry","weep"], answer: 0, explain: "'Ko‘z yoshi' means 'tear'." },
  { id: 746, q: "Choose the correct form: He ___ home by the time I arrived.", options: ["left","had left","leaves","was leaving"], answer: 1, explain: "Past perfect → 'had left'." },
  { id: 747, q: "Translate into English: 'kulgi' ", options: ["cry","smile","laugh","fun"], answer: 2, explain: "'Kulgi' means 'laugh'." },
  { id: 748, q: "Choose the correct sentence.", options: ["He reminded me call her.","He reminded me to call her.","He reminded to me call her.","He reminded me calling her."], answer: 1, explain: "Correct → 'remind sb to do'." },
  { id: 749, q: "Translate into English: 'tabassum' ", options: ["laugh","fun","smile","cry"], answer: 2, explain: "'Tabassum' means 'smile'." },
  { id: 750, q: "Choose the correct form: They ___ when the rain started.", options: ["play","played","were playing","plays"], answer: 2, explain: "Past continuous → 'were playing'." },
  { id: 751, q: "Translate into English: 'xursand' ", options: ["happy","sad","angry","tired"], answer: 0, explain: "'Xursand' means 'happy'." },
  { id: 752, q: "Choose the correct sentence.", options: ["He prevented me go.","He prevented me to go.","He prevented me from going.","He prevented me going."], answer: 2, explain: "Correct → 'prevent sb from doing'." },
  { id: 753, q: "Translate into English: 'xafa' ", options: ["sad","angry","happy","tired"], answer: 0, explain: "'Xafa' means 'sad'." },
  { id: 754, q: "Choose the correct form: While I ___, she was reading.", options: ["study","studied","was studying","studies"], answer: 2, explain: "Past continuous → 'was studying'." },
  { id: 755, q: "Translate into English: 'jahldor' ", options: ["calm","happy","angry","sad"], answer: 2, explain: "'Jahldor' means 'angry'." },
  { id: 756, q: "Choose the correct sentence.", options: ["He promised helping me.","He promised help me.","He promised to help me.","He promised helps me."], answer: 2, explain: "Correct → 'promise to do'." },
  { id: 757, q: "Translate into English: 'charchagan' ", options: ["happy","sad","angry","tired"], answer: 3, explain: "'Charchagan' means 'tired'." },
  { id: 758, q: "Choose the correct form: They ___ to the party yesterday.", options: ["go","goes","went","going"], answer: 2, explain: "Past simple → 'went'." },
  { id: 759, q: "Translate into English: 'hayron' ", options: ["angry","surprised","sad","calm"], answer: 1, explain: "'Hayron' means 'surprised'." },
  { id: 760, q: "Choose the correct sentence.", options: ["He warned me not to go.","He warned me to not go.","He warned me don't go.","He warned me no go."], answer: 0, explain: "Correct → 'warn sb not to do'." },
  { id: 761, q: "Translate into English: 'quvonch' ", options: ["joy","anger","sadness","fear"], answer: 0, explain: "'Quvonch' means 'joy'." },
  { id: 762, q: "Choose the correct form: I ___ lunch when he called.", options: ["have","was having","had","am having"], answer: 1, explain: "Past continuous → 'was having'." },
  { id: 763, q: "Translate into English: 'qo‘rqinch' ", options: ["joy","anger","fear","sadness"], answer: 2, explain: "'Qo‘rqinch' means 'fear'." },
  { id: 764, q: "Choose the correct sentence.", options: ["She refused to help.","She refused helping.","She refused help.","She refused helps."], answer: 0, explain: "Correct → 'refuse to do'." },
  { id: 765, q: "Translate into English: 'sevinmoq' ", options: ["to be sad","to be happy","to be angry","to be afraid"], answer: 1, explain: "'Sevinmoq' means 'to be happy'." },
  { id: 766, q: "Choose the correct form: They ___ tennis every Sunday.", options: ["play","plays","played","playing"], answer: 0, explain: "Present simple → 'play'." },
  { id: 767, q: "Translate into English: 'achchiqlanmoq' ", options: ["to be happy","to be angry","to be sad","to be surprised"], answer: 1, explain: "'Achchiqlanmoq' means 'to be angry'." },
  { id: 768, q: "Choose the correct sentence.", options: ["She can't help to laugh.","She can't help laughing.","She can't help laugh.","She can't help laughed."], answer: 1, explain: "Correct → 'can't help doing'." },
  { id: 769, q: "Translate into English: 'afsuslanmoq' ", options: ["to regret","to enjoy","to believe","to remember"], answer: 0, explain: "'Afsuslanmoq' means 'to regret'." },
  { id: 770, q: "Choose the correct form: He ___ English since 2010.", options: ["studies","has studied","is studying","studied"], answer: 1, explain: "Present perfect → 'has studied'." },
  { id: 771, q: "Translate into English: 'umid' ", options: ["hope","fear","anger","joy"], answer: 0, explain: "'Umid' means 'hope'." },
  { id: 772, q: "Choose the correct sentence.", options: ["I can't stand waiting.","I can't stand to wait.","I can't stand wait.","I can't stand waited."], answer: 0, explain: "Correct → 'can't stand doing'." },
  { id: 773, q: "Translate into English: 'ishonch' ", options: ["confidence","fear","anger","sadness"], answer: 0, explain: "'Ishonch' means 'confidence'." },
  { id: 774, q: "Choose the correct form: I ___ here for 2 hours already.", options: ["wait","waiting","have waited","am wait"], answer: 2, explain: "Present perfect → 'have waited'." },
  { id: 775, q: "Translate into English: 'shubha' ", options: ["doubt","belief","hope","joy"], answer: 0, explain: "'Shubha' means 'doubt'." },
  { id: 776, q: "Choose the correct sentence.", options: ["She kept talk.","She kept to talk.","She kept talking.","She kept talks."], answer: 2, explain: "Correct → 'keep doing'." },
  { id: 777, q: "Translate into English: 'xotirjam' ", options: ["calm","angry","sad","tired"], answer: 0, explain: "'Xotirjam' means 'calm'." },
  { id: 778, q: "Choose the correct form: She ___ her keys yesterday.", options: ["lose","lost","loses","losing"], answer: 1, explain: "Past simple → 'lost'." },
  { id: 779, q: "Translate into English: 'hayajon' ", options: ["excitement","anger","fear","joy"], answer: 0, explain: "'Hayajon' means 'excitement'." },
  { id: 780, q: "Choose the correct sentence.", options: ["He delayed to answer.","He delayed answer.","He delayed answering.","He delayed answers."], answer: 2, explain: "Correct → 'delay doing'." },
  { id: 781, q: "Translate into English: 'o‘ziga ishonch' ", options: ["self-doubt","self-confidence","self-esteem","self-control"], answer: 1, explain: "'O‘ziga ishonch' means 'self-confidence'." },
  { id: 782, q: "Choose the correct form: I ___ dinner when you called.", options: ["have","had","was having","am having"], answer: 2, explain: "Past continuous → 'was having'." },
  { id: 783, q: "Translate into English: 'qo‘rqmoq' ", options: ["to fear","to hope","to smile","to trust"], answer: 0, explain: "'Qo‘rqmoq' means 'to fear'." },
  { id: 784, q: "Choose the correct sentence.", options: ["I miss to play football.","I miss playing football.","I miss play football.","I miss played football."], answer: 1, explain: "Correct → 'miss doing'." },
  { id: 785, q: "Translate into English: 'ishonmoq' ", options: ["to doubt","to hope","to believe","to fear"], answer: 2, explain: "'Ishonmoq' means 'to believe'." },
  { id: 786, q: "Choose the correct form: He ___ in Samarkand for five years.", options: ["lived","has lived","live","living"], answer: 1, explain: "Present perfect → 'has lived'." },
  { id: 787, q: "Translate into English: 'o‘ylamoq' ", options: ["to doubt","to think","to believe","to hope"], answer: 1, explain: "'O‘ylamoq' means 'to think'." },
  { id: 788, q: "Choose the correct sentence.", options: ["She can't afford buying a car.","She can't afford to buy a car.","She can't afford buy a car.","She can't afford bought a car."], answer: 1, explain: "Correct → 'afford to do'." },
  { id: 789, q: "Translate into English: 'o‘qimoq' ", options: ["to read","to write","to think","to listen"], answer: 0, explain: "'O‘qimoq' means 'to read'." },
  { id: 790, q: "Choose the correct form: She ___ her work yet.", options: ["didn't finish","hasn't finished","haven't finished","not finished"], answer: 1, explain: "Present perfect negative." },
  { id: 791, q: "Translate into English: 'yozmoq' ", options: ["to read","to write","to say","to draw"], answer: 1, explain: "'Yozmoq' means 'to write'." },
  { id: 792, q: "Choose the correct sentence.", options: ["He practiced to speak English.","He practiced speaking English.","He practiced speak English.","He practiced spoke English."], answer: 1, explain: "Correct → 'practice doing'." },
  { id: 793, q: "Translate into English: 'tinglamoq' ", options: ["to listen","to read","to write","to draw"], answer: 0, explain: "'Tinglamoq' means 'to listen'." },
  { id: 794, q: "Choose the correct form: We ___ dinner when the phone rang.", options: ["have","had","were having","having"], answer: 2, explain: "Past continuous → 'were having'." },
  { id: 795, q: "Translate into English: 'gapirmoq' ", options: ["to talk","to listen","to write","to read"], answer: 0, explain: "'Gapirmoq' means 'to talk'." },
  { id: 796, q: "Choose the correct sentence.", options: ["He enjoyed to swim.","He enjoyed swimming.","He enjoyed swim.","He enjoyed swam."], answer: 1, explain: "Correct → 'enjoy doing'." },
  { id: 797, q: "Translate into English: 'eshitmoq' ", options: ["to hear","to listen","to say","to read"], answer: 0, explain: "'Eshitmoq' means 'to hear'." },
  { id: 798, q: "Choose the correct form: They ___ TV all evening yesterday.", options: ["watched","were watching","watch","watching"], answer: 1, explain: "Past continuous." },
  { id: 799, q: "Translate into English: 'ko‘rmoq' ", options: ["to see","to look","to watch","to read"], answer: 0, explain: "'Ko‘rmoq' means 'to see'." },
  { id: 800, q: "Choose the correct sentence.", options: ["He decided go home.","He decided to go home.","He decided going home.","He decided goes home."], answer: 1, explain: "Correct → 'decide to do'." },
  { id: 801, q: "Translate into English: 'tomosha qilmoq' ", options: ["to see","to look","to watch","to hear"], answer: 2, explain: "'Tomosha qilmoq' means 'to watch'." },
  { id: 802, q: "Choose the correct sentence.", options: ["She hopes to win.","She hopes winning.","She hopes win.","She hopes wins."], answer: 0, explain: "Correct → 'hope to do'." },
  { id: 803, q: "Translate into English: 'qaramoq' ", options: ["to watch","to look","to read","to hear"], answer: 1, explain: "'Qaramoq' means 'to look'." },
  { id: 804, q: "Choose the correct form: I ___ this book twice.", options: ["read","reads","have read","am read"], answer: 2, explain: "Present perfect → 'have read'." },
  { id: 805, q: "Translate into English: 'yugurmoq' ", options: ["to jump","to swim","to walk","to run"], answer: 3, explain: "'Yugurmoq' means 'to run'." },
  { id: 806, q: "Choose the correct sentence.", options: ["He agreed to help.","He agreed helping.","He agreed help.","He agreed helps."], answer: 0, explain: "Correct → 'agree to do'." },
  { id: 807, q: "Translate into English: 'suzmoq' ", options: ["to run","to walk","to swim","to fly"], answer: 2, explain: "'Suzmoq' means 'to swim'." },
  { id: 808, q: "Choose the correct form: She ___ to music now.", options: ["listens","is listening","listen","listened"], answer: 1, explain: "Present continuous → 'is listening'." },
  { id: 809, q: "Translate into English: 'uchmoq' ", options: ["to run","to swim","to walk","to fly"], answer: 3, explain: "'Uchmoq' means 'to fly'." },
  { id: 810, q: "Choose the correct sentence.", options: ["She admitted to steal.","She admitted stealing.","She admitted steal.","She admitted steals."], answer: 1, explain: "Correct → 'admit doing'." },
  { id: 811, q: "Translate into English: 'o‘ynamoq' ", options: ["to play","to work","to study","to watch"], answer: 0, explain: "'O‘ynamoq' means 'to play'." },
  { id: 812, q: "Choose the correct form: I ___ my homework yesterday.", options: ["do","did","does","done"], answer: 1, explain: "Past simple → 'did'." },
  { id: 813, q: "Translate into English: 'yig‘lamoq' ", options: ["to laugh","to smile","to cry","to sleep"], answer: 2, explain: "'Yig‘lamoq' means 'to cry'." },
  { id: 814, q: "Choose the correct sentence.", options: ["She considered to go.","She considered going.","She considered go.","She considered goes."], answer: 1, explain: "Correct → 'consider doing'." },
  { id: 815, q: "Translate into English: 'kulmoq' ", options: ["to cry","to laugh","to smile","to talk"], answer: 1, explain: "'Kulmoq' means 'to laugh'." },
  { id: 816, q: "Choose the correct form: They ___ TV right now.", options: ["watch","watched","are watching","watches"], answer: 2, explain: "Present continuous → 'are watching'." },
  { id: 817, q: "Translate into English: 'uxlamoq' ", options: ["to eat","to sleep","to drink","to play"], answer: 1, explain: "'Uxlamoq' means 'to sleep'." },
  { id: 818, q: "Choose the correct sentence.", options: ["I finished to read the book.","I finished reading the book.","I finished read the book.","I finished reads the book."], answer: 1, explain: "Correct → 'finish doing'." },
  { id: 819, q: "Translate into English: 'uyg‘onmoq' ", options: ["to sleep","to wake up","to go","to walk"], answer: 1, explain: "'Uyg‘onmoq' means 'to wake up'." },
  { id: 820, q: "Choose the correct form: He ___ to school every day.", options: ["go","goes","went","going"], answer: 1, explain: "Present simple → 'goes'." },
  { id: 821, q: "Translate into English: 'turmoq' ", options: ["to sit","to stand","to sleep","to lie"], answer: 1, explain: "'Turmoq' means 'to stand'." },
  { id: 822, q: "Choose the correct sentence.", options: ["She suggested to go.","She suggested going.","She suggested go.","She suggested goes."], answer: 1, explain: "Correct → 'suggest doing'." },
  { id: 823, q: "Translate into English: 'o‘tirmoq' ", options: ["to stand","to sit","to walk","to sleep"], answer: 1, explain: "'O‘tirmoq' means 'to sit'." },
  { id: 824, q: "Choose the correct form: He ___ to music yesterday.", options: ["listen","listened","listens","listening"], answer: 1, explain: "Past simple → 'listened'." },
  { id: 825, q: "Translate into English: 'yotmoq' ", options: ["to stand","to sit","to lie","to sleep"], answer: 2, explain: "'Yotmoq' means 'to lie'." },
  { id: 826, q: "Choose the correct sentence.", options: ["I can't imagine to live there.","I can't imagine living there.","I can't imagine live there.","I can't imagine lives there."], answer: 1, explain: "Correct → 'imagine doing'." },
  { id: 827, q: "Translate into English: 'o‘qitmoq' ", options: ["to learn","to teach","to study","to explain"], answer: 1, explain: "'O‘qitmoq' means 'to teach'." },
  { id: 828, q: "Choose the correct form: He ___ his car last week.", options: ["sells","sold","sell","selling"], answer: 1, explain: "Past simple → 'sold'." },
  { id: 829, q: "Translate into English: 'o‘rganmoq' ", options: ["to learn","to teach","to explain","to read"], answer: 0, explain: "'O‘rganmoq' means 'to learn'." },
  { id: 830, q: "Choose the correct sentence.", options: ["He avoided to answer.","He avoided answering.","He avoided answer.","He avoided answers."], answer: 1, explain: "Correct → 'avoid doing'." },
  { id: 831, q: "Translate into English: 'yemoq' ", options: ["to drink","to eat","to cook","to taste"], answer: 1, explain: "'Yemoq' means 'to eat'." },
  { id: 832, q: "Choose the correct form: She ___ breakfast now.", options: ["has","is having","had","having"], answer: 1, explain: "Present continuous → 'is having'." },
  { id: 833, q: "Translate into English: 'ichmoq' ", options: ["to eat","to drink","to cook","to sleep"], answer: 1, explain: "'Ichmoq' means 'to drink'." },
  { id: 834, q: "Choose the correct sentence.", options: ["He denied to cheat.","He denied cheating.","He denied cheat.","He denied cheats."], answer: 1, explain: "Correct → 'deny doing'." },
  { id: 835, q: "Translate into English: 'pishirmoq' ", options: ["to eat","to cook","to drink","to sleep"], answer: 1, explain: "'Pishirmoq' means 'to cook'." },
  { id: 836, q: "Choose the correct form: I ___ coffee every morning.", options: ["drink","drinks","drank","drinking"], answer: 0, explain: "Present simple → 'drink'." },
  { id: 837, q: "Translate into English: 'ichimlik' ", options: ["drink","food","meal","dish"], answer: 0, explain: "'Ichimlik' means 'drink'." },
  { id: 838, q: "Choose the correct sentence.", options: ["She mentioned to go.","She mentioned going.","She mentioned go.","She mentioned goes."], answer: 1, explain: "Correct → 'mention doing'." },
  { id: 839, q: "Translate into English: 'ovqat' ", options: ["meal","drink","snack","dish"], answer: 0, explain: "'Ovqat' means 'meal'." },
  { id: 840, q: "Choose the correct form: We ___ dinner at 7 yesterday.", options: ["have","had","has","having"], answer: 1, explain: "Past simple → 'had'." },
  { id: 841, q: "Translate into English: 'taom' ", options: ["meal","dish","snack","drink"], answer: 1, explain: "'Taom' means 'dish'." },
  { id: 842, q: "Choose the correct sentence.", options: ["He can't resist to eat chocolate.","He can't resist eating chocolate.","He can't resist eat chocolate.","He can't resist eats chocolate."], answer: 1, explain: "Correct → 'resist doing'." },
  { id: 843, q: "Translate into English: 'nonushta' ", options: ["lunch","dinner","breakfast","supper"], answer: 2, explain: "'Nonushta' means 'breakfast'." },
  { id: 844, q: "Choose the correct form: She ___ lunch now.", options: ["is having","has","had","having"], answer: 0, explain: "Present continuous → 'is having'." },
  { id: 845, q: "Translate into English: 'tushlik' ", options: ["breakfast","lunch","dinner","meal"], answer: 1, explain: "'Tushlik' means 'lunch'." },
  { id: 846, q: "Choose the correct sentence.", options: ["I postponed to call him.","I postponed calling him.","I postponed call him.","I postponed calls him."], answer: 1, explain: "Correct → 'postpone doing'." },
  { id: 847, q: "Translate into English: 'kechki ovqat' ", options: ["breakfast","lunch","dinner","meal"], answer: 2, explain: "'Kechki ovqat' means 'dinner'." },
  { id: 848, q: "Choose the correct form: They ___ breakfast at 8 every day.", options: ["have","has","had","having"], answer: 0, explain: "Present simple → 'have'." },
  { id: 849, q: "Translate into English: 'shirinlik' ", options: ["snack","dessert","meal","dish"], answer: 1, explain: "'Shirinlik' means 'dessert'." },
  { id: 850, q: "Choose the correct sentence.", options: ["He risked to lose his job.","He risked losing his job.","He risked lose his job.","He risked loses his job."], answer: 1, explain: "Correct → 'risk doing'." },
  { id: 851, q: "Translate into English: 'qandolat' ", options: ["bakery","confectionery","grocery","butcher"], answer: 1, explain: "'Qandolat' means 'confectionery'." },
  { id: 852, q: "Choose the correct form: He ___ playing football when it started raining.", options: ["was","were","is","are"], answer: 0, explain: "Past continuous → 'was playing'." },
  { id: 853, q: "Translate into English: 'nonvoyxona' ", options: ["confectionery","bakery","restaurant","shop"], answer: 1, explain: "'Nonvoyxona' means 'bakery'." },
  { id: 854, q: "Choose the correct sentence.", options: ["She advised going there.","She advised to going there.","She advised go there.","She advised goes there."], answer: 0, explain: "Correct → 'advise doing'." },
  { id: 855, q: "Translate into English: 'do‘kon' ", options: ["shop","school","market","factory"], answer: 0, explain: "'Do‘kon' means 'shop'." },
  { id: 856, q: "Choose the correct form: We ___ to the park every weekend.", options: ["go","goes","going","went"], answer: 0, explain: "Present simple → 'go'." },
  { id: 857, q: "Translate into English: 'bozor' ", options: ["market","shop","supermarket","mall"], answer: 0, explain: "'Bozor' means 'market'." },
  { id: 858, q: "Choose the correct sentence.", options: ["He practiced to speak English.","He practiced speaking English.","He practiced speak English.","He practiced speaks English."], answer: 1, explain: "Correct → 'practice doing'." },
  { id: 859, q: "Translate into English: 'savdo markazi' ", options: ["mall","market","store","shop"], answer: 0, explain: "'Savdo markazi' means 'mall'." },
  { id: 860, q: "Choose the correct form: They ___ English very well.", options: ["speaks","speaking","speak","spoken"], answer: 2, explain: "Present simple plural → 'speak'." },
  { id: 861, q: "Translate into English: 'kitob do‘koni' ", options: ["library","bookshop","school","stationery"], answer: 1, explain: "'Kitob do‘koni' means 'bookshop'." },
  { id: 862, q: "Choose the correct sentence.", options: ["She admitted cheating.","She admitted to cheat.","She admitted cheat.","She admitted cheats."], answer: 0, explain: "Correct → 'admit doing'." },
  { id: 863, q: "Translate into English: 'dorixona' ", options: ["hospital","clinic","pharmacy","market"], answer: 2, explain: "'Dorixona' means 'pharmacy'." },
  { id: 864, q: "Choose the correct form: I ___ my keys yesterday.", options: ["lose","lost","loses","losing"], answer: 1, explain: "Past simple → 'lost'." },
  { id: 865, q: "Translate into English: 'kasalxona' ", options: ["hospital","pharmacy","clinic","school"], answer: 0, explain: "'Kasalxona' means 'hospital'." },
  { id: 866, q: "Choose the correct sentence.", options: ["He enjoys playing football.","He enjoys to play football.","He enjoys play football.","He enjoy playing football."], answer: 0, explain: "Correct → 'enjoy doing'." },
  { id: 867, q: "Translate into English: 'maktab' ", options: ["college","school","university","class"], answer: 1, explain: "'Maktab' means 'school'." },
  { id: 868, q: "Choose the correct form: She ___ to the cinema last night.", options: ["go","went","goes","gone"], answer: 1, explain: "Past simple → 'went'." },
  { id: 869, q: "Translate into English: 'universitet' ", options: ["school","college","academy","university"], answer: 3, explain: "'Universitet' means 'university'." },
  { id: 870, q: "Choose the correct sentence.", options: ["He finished writing the letter.","He finished to write the letter.","He finished write the letter.","He finished writes the letter."], answer: 0, explain: "Correct → 'finish doing'." },
  { id: 871, q: "Translate into English: 'kollej' ", options: ["school","college","academy","class"], answer: 1, explain: "'Kollej' means 'college'." },
  { id: 872, q: "Choose the correct form: They ___ playing when it started to rain.", options: ["was","were","are","is"], answer: 1, explain: "Past continuous plural → 'were playing'." },
  { id: 873, q: "Translate into English: 'akademiya' ", options: ["academy","school","college","university"], answer: 0, explain: "'Akademiya' means 'academy'." },
  { id: 874, q: "Choose the correct sentence.", options: ["She considered going abroad.","She considered to go abroad.","She considered go abroad.","She considered goes abroad."], answer: 0, explain: "Correct → 'consider doing'." },
  { id: 875, q: "Translate into English: 'kitobxona' ", options: ["library","bookshop","classroom","station"], answer: 0, explain: "'Kitobxona' means 'library'." },
  { id: 876, q: "Choose the correct form: He ___ a new job last month.", options: ["get","got","gets","getting"], answer: 1, explain: "Past simple → 'got'." },
  { id: 877, q: "Translate into English: 'kino teatr' ", options: ["museum","cinema","theatre","gallery"], answer: 1, explain: "'Kino teatr' means 'cinema'." },
  { id: 878, q: "Choose the correct sentence.", options: ["I postponed going to the dentist.","I postponed to go to the dentist.","I postponed go to the dentist.","I postponed goes to the dentist."], answer: 0, explain: "Correct → 'postpone doing'." },
  { id: 879, q: "Translate into English: 'muzey' ", options: ["museum","gallery","theatre","cinema"], answer: 0, explain: "'Muzey' means 'museum'." },
  { id: 880, q: "Choose the correct form: They ___ breakfast at 8 every morning.", options: ["have","has","had","having"], answer: 0, explain: "Present simple → 'have'." },
  { id: 881, q: "Translate into English: 'galereya' ", options: ["museum","gallery","cinema","theatre"], answer: 1, explain: "'Galereya' means 'gallery'." },
  { id: 882, q: "Choose the correct sentence.", options: ["He can't resist eating chocolate.","He can't resist to eat chocolate.","He can't resist eat chocolate.","He can't resist eats chocolate."], answer: 0, explain: "Correct → 'resist doing'." },
  { id: 883, q: "Translate into English: 'teatr' ", options: ["museum","gallery","cinema","theatre"], answer: 3, explain: "'Teatr' means 'theatre'." },
  { id: 884, q: "Choose the correct form: She ___ already done her homework.", options: ["has","have","having","is"], answer: 0, explain: "Present perfect → 'has done'." },
  { id: 885, q: "Translate into English: 'konsert' ", options: ["concert","song","music","show"], answer: 0, explain: "'Konsert' means 'concert'." },
  { id: 886, q: "Choose the correct sentence.", options: ["She risked losing her job.","She risked to lose her job.","She risked lose her job.","She risked loses her job."], answer: 0, explain: "Correct → 'risk doing'." },
  { id: 887, q: "Translate into English: 'qo‘shiq' ", options: ["song","concert","music","melody"], answer: 0, explain: "'Qo‘shiq' means 'song'." },
  { id: 888, q: "Choose the correct form: He ___ the guitar very well.", options: ["play","plays","played","playing"], answer: 1, explain: "Present simple → 'plays'." },
  { id: 889, q: "Translate into English: 'musiqa' ", options: ["song","concert","music","melody"], answer: 2, explain: "'Musiqa' means 'music'." },
  { id: 890, q: "Choose the correct sentence.", options: ["She admitted taking the money.","She admitted to take the money.","She admitted take the money.","She admitted takes the money."], answer: 0, explain: "Correct → 'admit doing'." },
  { id: 891, q: "Translate into English: 'ashula' ", options: ["music","song","melody","concert"], answer: 1, explain: "'Ashula' means 'song'." },
  { id: 892, q: "Choose the correct form: They ___ in Tashkent last year.", options: ["live","lived","lives","living"], answer: 1, explain: "Past simple → 'lived'." },
  { id: 893, q: "Translate into English: 'raqam' ", options: ["letter","word","digit","sound"], answer: 2, explain: "'Raqam' means 'digit' or 'number'." },
  { id: 894, q: "Choose the correct sentence.", options: ["She enjoys swimming.","She enjoys to swim.","She enjoys swim.","She enjoy swimming."], answer: 0, explain: "Correct → 'enjoy doing'." },
  { id: 895, q: "Translate into English: 'son' ", options: ["number","digit","letter","word"], answer: 0, explain: "'Son' means 'number'." },
  { id: 896, q: "Choose the correct form: I ___ my homework right now.", options: ["do","does","did","am doing"], answer: 3, explain: "Present continuous → 'am doing'." },
  { id: 897, q: "Translate into English: 'harf' ", options: ["letter","digit","word","sign"], answer: 0, explain: "'Harf' means 'letter'." },
  { id: 898, q: "Choose the correct sentence.", options: ["She suggested visiting the museum.","She suggested to visit the museum.","She suggested visit the museum.","She suggested visits the museum."], answer: 0, explain: "Correct → 'suggest doing'." },
  { id: 899, q: "Translate into English: 'so‘z' ", options: ["letter","word","digit","text"], answer: 1, explain: "'So‘z' means 'word'." },
  { id: 900, q: "Choose the correct form: We ___ English now.", options: ["learn","learns","are learning","learned"], answer: 2, explain: "Present continuous → 'are learning'." },
  { id: 901, q: "Translate into English: 'ishxona' ", options: ["school","office","hospital","bank"], answer: 1, explain: "'Ishxona' means 'office'." },
  { id: 902, q: "Choose the correct sentence.", options: ["She are my sister.","She is my sister.","She am my sister.","She be my sister."], answer: 1, explain: "Correct: 'She is my sister'." },
  { id: 903, q: "Translate into English: 'pul' ", options: ["money","coin","salary","gold"], answer: 0, explain: "'Pul' means 'money'." },
  { id: 904, q: "Choose the correct word: We ___ friends.", options: ["am","is","are","be"], answer: 2, explain: "Plural subject → 'are'." },
  { id: 905, q: "Translate into English: 'oyna' ", options: ["mirror","window","glass","all are possible"], answer: 3, explain: "'Oyna' can mean 'mirror', 'window', or 'glass' depending on context." },
  { id: 906, q: "Choose the correct sentence.", options: ["Do you speaks English?","Do you speak English?","Does you speak English?","You do speak English?"], answer: 1, explain: "Correct: 'Do you speak English?'." },
  { id: 907, q: "Translate into English: 'oshxona' ", options: ["kitchen","canteen","dining room","all are correct"], answer: 3, explain: "'Oshxona' can mean 'kitchen', 'canteen', or 'dining room'." },
  { id: 908, q: "Choose the correct form: She ___ to music every day.", options: ["listen","listens","listening","listened"], answer: 1, explain: "Third person singular → 'listens'." },
  { id: 909, q: "Translate into English: 'bog‘' ", options: ["forest","garden","park","yard"], answer: 1, explain: "'Bog‘' means 'garden'." },
  { id: 910, q: "Choose the correct word: They ___ at school now.", options: ["is","are","am","be"], answer: 1, explain: "Plural subject → 'are'." },
  { id: 911, q: "Translate into English: 'maydon' ", options: ["park","street","square","stadium"], answer: 2, explain: "'Maydon' means 'square'." },
  { id: 912, q: "Choose the correct sentence.", options: ["I don’t likes apples.","I not like apples.","I don’t like apples.","I doesn’t like apples."], answer: 2, explain: "Correct negative: 'I don’t like apples'." },
  { id: 913, q: "Translate into English: 'ko‘cha' ", options: ["road","street","avenue","lane"], answer: 1, explain: "'Ko‘cha' means 'street'." },
  { id: 914, q: "Choose the correct form: He ___ his homework yesterday.", options: ["do","did","does","doing"], answer: 1, explain: "Past simple → 'did'." },
  { id: 915, q: "Translate into English: 'yo‘l' ", options: ["way","road","path","all are correct"], answer: 3, explain: "'Yo‘l' can mean 'way', 'road', or 'path'." },
  { id: 916, q: "Choose the correct sentence.", options: ["There is three chairs.","There are three chairs.","There am three chairs.","There be three chairs."], answer: 1, explain: "Plural → 'There are'." },
  { id: 917, q: "Translate into English: 'bekat' ", options: ["station","stop","terminal","all are correct"], answer: 3, explain: "'Bekat' can mean 'station', 'stop', or 'terminal'." },
  { id: 918, q: "Choose the correct form: She ___ swimming now.", options: ["is","are","am","be"], answer: 0, explain: "Singular subject → 'is'." },
  { id: 919, q: "Translate into English: 'temir yo‘l' ", options: ["railway","highway","road","bridge"], answer: 0, explain: "'Temir yo‘l' means 'railway'." },
  { id: 920, q: "Choose the correct sentence.", options: ["He can swims.","He cans swim.","He can swim.","He swim can."], answer: 2, explain: "Correct modal verb form: 'He can swim'." },
  { id: 921, q: "Translate into English: 'poyezd' ", options: ["bus","car","train","tram"], answer: 2, explain: "'Poyezd' means 'train'." },
  { id: 922, q: "Choose the correct form: We ___ in Tashkent last year.", options: ["live","lived","lives","living"], answer: 1, explain: "Past simple → 'lived'." },
  { id: 923, q: "Translate into English: 'avtobus' ", options: ["bus","car","tram","train"], answer: 0, explain: "'Avtobus' means 'bus'." },
  { id: 924, q: "Choose the correct sentence.", options: ["Does he play football?","Do he play football?","Does he plays football?","He does play football?"], answer: 0, explain: "Correct question: 'Does he play football?'." },
  { id: 925, q: "Translate into English: 'tramvay' ", options: ["bus","tram","train","car"], answer: 1, explain: "'Tramvay' means 'tram'." },
  { id: 926, q: "Choose the correct form: I ___ at the library now.", options: ["is","are","am","be"], answer: 2, explain: "First person singular → 'am'." },
  { id: 927, q: "Translate into English: 'samolyot' ", options: ["plane","helicopter","rocket","ship"], answer: 0, explain: "'Samolyot' means 'plane'." },
  { id: 928, q: "Choose the correct sentence.", options: ["She don’t study English.","She doesn’t study English.","She not study English.","She doesn’t studies English."], answer: 1, explain: "Correct: 'She doesn’t study English'." },
  { id: 929, q: "Translate into English: 'kemа' ", options: ["car","ship","boat","plane"], answer: 1, explain: "'Kema' means 'ship'." },
  { id: 930, q: "Choose the correct form: They ___ at the park yesterday.", options: ["is","are","was","were"], answer: 3, explain: "Past plural → 'were'." },
  { id: 931, q: "Translate into English: 'qayiq' ", options: ["boat","ship","raft","yacht"], answer: 0, explain: "'Qayiq' means 'boat'." },
  { id: 932, q: "Choose the correct sentence.", options: ["We am friends.","We is friends.","We are friends.","We be friends."], answer: 2, explain: "Correct: 'We are friends'." },
  { id: 933, q: "Translate into English: 'velosiped' ", options: ["car","bike","bicycle","both 2 and 3"], answer: 3, explain: "'Velosiped' means 'bike' or 'bicycle'." },
  { id: 934, q: "Choose the correct form: She ___ her homework tomorrow.", options: ["do","does","did","will do"], answer: 3, explain: "Future simple → 'will do'." },
  { id: 935, q: "Translate into English: 'mashina' ", options: ["machine","car","bus","vehicle"], answer: 1, explain: "'Mashina' usually means 'car'." },
  { id: 936, q: "Choose the correct sentence.", options: ["There are a book on the desk.","There is a book on the desk.","There be a book on the desk.","There am a book on the desk."], answer: 1, explain: "Singular → 'There is a book'." },
  { id: 937, q: "Translate into English: 'yo‘lovchi' ", options: ["driver","passenger","tourist","walker"], answer: 1, explain: "'Yo‘lovchi' means 'passenger'." },
  { id: 938, q: "Choose the correct form: He ___ a teacher.", options: ["is","are","am","be"], answer: 0, explain: "Singular subject → 'is'." },
  { id: 939, q: "Translate into English: 'haydovchi' ", options: ["driver","teacher","pilot","worker"], answer: 0, explain: "'Haydovchi' means 'driver'." },
  { id: 940, q: "Choose the correct sentence.", options: ["I goes to school.","I go to school.","I going to school.","I gone to school."], answer: 1, explain: "Present simple: 'I go to school'." },
  { id: 941, q: "Translate into English: 'ustoz' ", options: ["student","teacher","worker","driver"], answer: 1, explain: "'Ustoz' means 'teacher'." },
  { id: 942, q: "Choose the correct form: They ___ lunch now.", options: ["is","are","am","be"], answer: 1, explain: "Plural subject → 'are'." },
  { id: 943, q: "Translate into English: 'dars' ", options: ["class","lesson","subject","study"], answer: 1, explain: "'Dars' means 'lesson'." },
  { id: 944, q: "Choose the correct sentence.", options: ["Does they live in London?","Do they lives in London?","Do they live in London?","They does live in London?"], answer: 2, explain: "Correct: 'Do they live in London?'." },
  { id: 945, q: "Translate into English: 'imtihon' ", options: ["test","exam","quiz","all are correct"], answer: 3, explain: "'Imtihon' can mean 'test', 'exam', or 'quiz'." },
  { id: 946, q: "Choose the correct form: She ___ a letter yesterday.", options: ["write","writes","wrote","writing"], answer: 2, explain: "Past simple → 'wrote'." },
  { id: 947, q: "Translate into English: 'savol' ", options: ["answer","question","test","reply"], answer: 1, explain: "'Savol' means 'question'." },
  { id: 948, q: "Choose the correct sentence.", options: ["There is five students in the class.","There are five students in the class.","There was five students in the class.","There am five students in the class."], answer: 1, explain: "Plural → 'There are five students'." },
  { id: 949, q: "Translate into English: 'javob' ", options: ["question","answer","exam","test"], answer: 1, explain: "'Javob' means 'answer'." },
  { id: 950, q: "Choose the correct form: We ___ football yesterday.", options: ["play","plays","played","playing"], answer: 2, explain: "Past simple → 'played'." },
  { id: 951, q: "Translate into English: 'do‘st' ", options: ["friend","teacher","brother","sister"], answer: 0, explain: "'Do‘st' means 'friend'." },
  { id: 952, q: "Choose the correct sentence.", options: ["She are at home.","She is at home.","She am at home.","She be at home."], answer: 1, explain: "Correct: 'She is at home'." },
  { id: 953, q: "Translate into English: 'aka' ", options: ["younger brother","older brother","friend","uncle"], answer: 1, explain: "'Aka' means 'older brother'." },
  { id: 954, q: "Choose the correct word: He ___ a book now.", options: ["read","reads","is reading","readed"], answer: 2, explain: "Present continuous → 'is reading'." },
  { id: 955, q: "Translate into English: 'uka' ", options: ["older brother","younger brother","friend","cousin"], answer: 1, explain: "'Uka' means 'younger brother'." },
  { id: 956, q: "Choose the correct sentence.", options: ["Do she like apples?","Does she like apples?","Does she likes apples?","She does like apples?"], answer: 1, explain: "Correct: 'Does she like apples?'." },
  { id: 957, q: "Translate into English: 'opa' ", options: ["younger sister","older sister","aunt","mother"], answer: 1, explain: "'Opa' means 'older sister'." },
  { id: 958, q: "Choose the correct form: I ___ to school every day.", options: ["go","goes","going","gone"], answer: 0, explain: "First person singular → 'go'." },
  { id: 959, q: "Translate into English: 'singil' ", options: ["older sister","younger sister","cousin","friend"], answer: 1, explain: "'Singil' means 'younger sister'." },
  { id: 960, q: "Choose the correct sentence.", options: ["There are a pen on the desk.","There is a pen on the desk.","There am a pen on the desk.","There be a pen on the desk."], answer: 1, explain: "Singular → 'There is a pen'." },
  { id: 961, q: "Translate into English: 'ota' ", options: ["father","mother","uncle","brother"], answer: 0, explain: "'Ota' means 'father'." },
  { id: 962, q: "Choose the correct form: She ___ her homework yesterday.", options: ["do","did","does","done"], answer: 1, explain: "Past simple → 'did'." },
  { id: 963, q: "Translate into English: 'ona' ", options: ["mother","father","aunt","sister"], answer: 0, explain: "'Ona' means 'mother'." },
  { id: 964, q: "Choose the correct word: They ___ to the cinema last week.", options: ["go","goes","went","gone"], answer: 2, explain: "Past simple → 'went'." },
  { id: 965, q: "Translate into English: 'bola' ", options: ["child","man","boy","girl"], answer: 0, explain: "'Bola' means 'child'." },
  { id: 966, q: "Choose the correct sentence.", options: ["He can to play football.","He can play football.","He cans play football.","He play can football."], answer: 1, explain: "Correct modal verb usage: 'He can play football'." },
  { id: 967, q: "Translate into English: 'o‘g‘il bola' ", options: ["girl","boy","child","friend"], answer: 1, explain: "'O‘g‘il bola' means 'boy'." },
  { id: 968, q: "Choose the correct form: She ___ at the park now.", options: ["is","are","am","be"], answer: 0, explain: "Singular subject → 'is'." },
  { id: 969, q: "Translate into English: 'qiz bola' ", options: ["boy","girl","woman","child"], answer: 1, explain: "'Qiz bola' means 'girl'." },
  { id: 970, q: "Choose the correct sentence.", options: ["We was happy yesterday.","We were happy yesterday.","We are happy yesterday.","We be happy yesterday."], answer: 1, explain: "Past simple plural → 'We were'." },
  { id: 971, q: "Translate into English: 'do‘konchi' ", options: ["teacher","driver","shopkeeper","farmer"], answer: 2, explain: "'Do‘konchi' means 'shopkeeper'." },
  { id: 972, q: "Choose the correct form: He ___ a doctor.", options: ["is","are","am","be"], answer: 0, explain: "Singular subject → 'is'." },
  { id: 973, q: "Translate into English: 'dehqon' ", options: ["farmer","worker","driver","teacher"], answer: 0, explain: "'Dehqon' means 'farmer'." },
  { id: 974, q: "Choose the correct word: They ___ English every day.", options: ["study","studies","studied","studying"], answer: 0, explain: "Plural subject → 'study'." },
  { id: 975, q: "Translate into English: 'ishchi' ", options: ["worker","driver","farmer","teacher"], answer: 0, explain: "'Ishchi' means 'worker'." },
  { id: 976, q: "Choose the correct sentence.", options: ["She doesn’t likes tea.","She don’t like tea.","She doesn’t like tea.","She not like tea."], answer: 2, explain: "Correct negative: 'She doesn’t like tea'." },
  { id: 977, q: "Translate into English: 'talaba' ", options: ["student","teacher","pupil","worker"], answer: 0, explain: "'Talaba' means 'student'." },
  { id: 978, q: "Choose the correct form: I ___ a new phone last week.", options: ["buy","buys","bought","buying"], answer: 2, explain: "Past simple → 'bought'." },
  { id: 979, q: "Translate into English: 'professor' ", options: ["teacher","professor","student","scientist"], answer: 1, explain: "'Professor' means 'professor'." },
  { id: 980, q: "Choose the correct sentence.", options: ["There are a cat under the table.","There is a cat under the table.","There am a cat under the table.","There be a cat under the table."], answer: 1, explain: "Singular → 'There is a cat'." },
  { id: 981, q: "Translate into English: 'olma' ", options: ["banana","apple","pear","peach"], answer: 1, explain: "'Olma' means 'apple'." },
  { id: 982, q: "Choose the correct form: We ___ in Samarkand last year.", options: ["live","lived","living","lives"], answer: 1, explain: "Past simple → 'lived'." },
  { id: 983, q: "Translate into English: 'anor' ", options: ["apple","pear","pomegranate","grape"], answer: 2, explain: "'Anor' means 'pomegranate'." },
  { id: 984, q: "Choose the correct word: She ___ tea every morning.", options: ["drink","drinks","drank","drinking"], answer: 1, explain: "Third person singular → 'drinks'." },
  { id: 985, q: "Translate into English: 'uzum' ", options: ["pear","grape","apple","cherry"], answer: 1, explain: "'Uzum' means 'grape'." },
  { id: 986, q: "Choose the correct sentence.", options: ["Do he work here?","Does he work here?","Does he works here?","He does work here?"], answer: 1, explain: "Correct question: 'Does he work here?'." },
  { id: 987, q: "Translate into English: 'nok' ", options: ["apple","pear","grape","peach"], answer: 1, explain: "'Nok' means 'pear'." },
  { id: 988, q: "Choose the correct form: I ___ a letter now.", options: ["write","writes","am writing","wrote"], answer: 2, explain: "Present continuous → 'am writing'." },
  { id: 989, q: "Translate into English: 'shaftoli' ", options: ["apple","peach","plum","cherry"], answer: 1, explain: "'Shaftoli' means 'peach'." },
  { id: 990, q: "Choose the correct sentence.", options: ["We was at home yesterday.","We were at home yesterday.","We are at home yesterday.","We be at home yesterday."], answer: 1, explain: "Past simple plural → 'We were'." },
  { id: 991, q: "Translate into English: 'olxo‘ri' ", options: ["cherry","pear","plum","peach"], answer: 2, explain: "'Olxo‘ri' means 'plum'." },
  { id: 992, q: "Choose the correct form: They ___ to the park every Sunday.", options: ["go","goes","went","gone"], answer: 0, explain: "Plural subject → 'go'." },
  { id: 993, q: "Translate into English: 'gilos' ", options: ["grape","cherry","apple","pear"], answer: 1, explain: "'Gilos' means 'cherry'." },
  { id: 994, q: "Choose the correct word: He ___ TV now.", options: ["watch","watches","is watching","watched"], answer: 2, explain: "Present continuous → 'is watching'." },
  { id: 995, q: "Translate into English: 'banan' ", options: ["banana","apple","pear","melon"], answer: 0, explain: "'Banan' means 'banana'." },
  { id: 996, q: "Choose the correct sentence.", options: ["There is some apples.","There are some apples.","There am some apples.","There be some apples."], answer: 1, explain: "Plural → 'There are some apples'." },
  { id: 997, q: "Translate into English: 'tarvuz' ", options: ["melon","watermelon","banana","pumpkin"], answer: 1, explain: "'Tarvuz' means 'watermelon'." },
  { id: 998, q: "Choose the correct form: I ___ my room yesterday.", options: ["clean","cleans","cleaned","cleaning"], answer: 2, explain: "Past simple → 'cleaned'." },
  { id: 999, q: "Translate into English: 'qovun' ", options: ["melon","watermelon","pumpkin","banana"], answer: 0, explain: "'Qovun' means 'melon'." },
  { id: 1000, q: "Choose the correct sentence.", options: ["She have a car.","She has a car.","She haves a car.","She having a car."], answer: 1, explain: "Correct form is 'She has a car'." },
  { id: 1001, q: "Translate into English: 'kitob' ", options: ["book","pen","copybook","notebook"], answer: 0, explain: "'Kitob' means 'book'." },
  { id: 1002, q: "Choose the correct form: They ___ football yesterday.", options: ["play","played","plays","playing"], answer: 1, explain: "Past simple → 'played'." },
  { id: 1003, q: "Translate into English: 'daftar' ", options: ["pen","notebook","board","book"], answer: 1, explain: "'Daftar' means 'notebook'." },
  { id: 1004, q: "Choose the correct sentence.", options: ["He am my friend.","He are my friend.","He is my friend.","He be my friend."], answer: 2, explain: "Correct: 'He is my friend'." },
  { id: 1005, q: "Translate into English: 'qalam' ", options: ["pen","pencil","ruler","eraser"], answer: 1, explain: "'Qalam' means 'pencil'." },
  { id: 1006, q: "Choose the correct form: I ___ TV every evening.", options: ["watch","watches","watching","watched"], answer: 0, explain: "First person singular → 'watch'." },
  { id: 1007, q: "Translate into English: 'ruchka' ", options: ["pen","pencil","book","board"], answer: 0, explain: "'Ruchka' means 'pen'." },
  { id: 1008, q: "Choose the correct sentence.", options: ["They doesn’t play football.","They don’t plays football.","They don’t play football.","They not play football."], answer: 2, explain: "Correct: 'They don’t play football'." },
  { id: 1009, q: "Translate into English: 'stol' ", options: ["chair","table","desk","sofa"], answer: 1, explain: "'Stol' means 'table'." },
  { id: 1010, q: "Choose the correct form: She ___ breakfast now.", options: ["eat","eats","is eating","ate"], answer: 2, explain: "Present continuous → 'is eating'." },
  { id: 1011, q: "Translate into English: 'stul' ", options: ["table","desk","chair","sofa"], answer: 2, explain: "'Stul' means 'chair'." },
  { id: 1012, q: "Choose the correct sentence.", options: ["We goes to school.","We go to school.","We going to school.","We gone to school."], answer: 1, explain: "Correct: 'We go to school'." },
  { id: 1013, q: "Translate into English: 'doska' ", options: ["board","pen","book","notebook"], answer: 0, explain: "'Doska' means 'board'." },
  { id: 1014, q: "Choose the correct form: He ___ at the library yesterday.", options: ["was","were","is","be"], answer: 0, explain: "Past simple singular → 'was'." },
  { id: 1015, q: "Translate into English: 'o‘qituvchi' ", options: ["teacher","student","pupil","professor"], answer: 0, explain: "'O‘qituvchi' means 'teacher'." },
  { id: 1016, q: "Choose the correct word: We ___ in Tashkent now.", options: ["live","lives","lived","living"], answer: 0, explain: "Present simple plural → 'live'." },
  { id: 1017, q: "Translate into English: 'o‘quvchi' ", options: ["pupil","teacher","professor","student"], answer: 0, explain: "'O‘quvchi' means 'pupil'." },
  { id: 1018, q: "Choose the correct sentence.", options: ["Does they like pizza?","Do they like pizza?","Do they likes pizza?","They does like pizza?"], answer: 1, explain: "Correct: 'Do they like pizza?'." },
  { id: 1019, q: "Translate into English: 'maktab' ", options: ["school","university","college","academy"], answer: 0, explain: "'Maktab' means 'school'." },
  { id: 1020, q: "Choose the correct form: She ___ to music every morning.", options: ["listen","listens","listened","listening"], answer: 1, explain: "Third person singular → 'listens'." },
  { id: 1021, q: "Translate into English: 'universitet' ", options: ["academy","college","university","school"], answer: 2, explain: "'Universitet' means 'university'." },
  { id: 1022, q: "Choose the correct sentence.", options: ["I doesn’t like tea.","I don’t like tea.","I not like tea.","I no like tea."], answer: 1, explain: "Correct: 'I don’t like tea'." },
  { id: 1023, q: "Translate into English: 'akademiya' ", options: ["college","academy","university","school"], answer: 1, explain: "'Akademiya' means 'academy'." },
  { id: 1024, q: "Choose the correct form: They ___ to school last Monday.", options: ["go","went","goes","going"], answer: 1, explain: "Past simple → 'went'." },
  { id: 1025, q: "Translate into English: 'kollej' ", options: ["academy","college","university","school"], answer: 1, explain: "'Kollej' means 'college'." },
  { id: 1026, q: "Choose the correct sentence.", options: ["We am happy.","We are happy.","We is happy.","We be happy."], answer: 1, explain: "Correct: 'We are happy'." },
  { id: 1027, q: "Translate into English: 'kitobxona' ", options: ["school","library","college","book"], answer: 1, explain: "'Kitobxona' means 'library'." },
  { id: 1028, q: "Choose the correct form: He ___ his homework yesterday.", options: ["do","did","done","doing"], answer: 1, explain: "Past simple → 'did'." },
  { id: 1029, q: "Translate into English: 'kinoteatr' ", options: ["cinema","theatre","library","museum"], answer: 0, explain: "'Kinoteatr' means 'cinema'." },
  { id: 1030, q: "Choose the correct sentence.", options: ["Does he plays football?","Does he play football?","Do he play football?","He does plays football?"], answer: 1, explain: "Correct: 'Does he play football?'." },
  { id: 1031, q: "Translate into English: 'teatr' ", options: ["museum","theatre","cinema","school"], answer: 1, explain: "'Teatr' means 'theatre'." },
  { id: 1032, q: "Choose the correct form: They ___ friends.", options: ["is","are","am","be"], answer: 1, explain: "Plural subject → 'are'." },
  { id: 1033, q: "Translate into English: 'muzey' ", options: ["museum","cinema","school","theatre"], answer: 0, explain: "'Muzey' means 'museum'." },
  { id: 1034, q: "Choose the correct word: She ___ a new car last year.", options: ["buy","buys","bought","buying"], answer: 2, explain: "Past simple → 'bought'." },
  { id: 1035, q: "Translate into English: 'kasalxona' ", options: ["clinic","hospital","pharmacy","school"], answer: 1, explain: "'Kasalxona' means 'hospital'." },
  { id: 1036, q: "Choose the correct sentence.", options: ["There is some books on the desk.","There are some books on the desk.","There am some books on the desk.","There be some books on the desk."], answer: 1, explain: "Plural → 'There are some books'." },
  { id: 1037, q: "Translate into English: 'dorixona' ", options: ["pharmacy","clinic","hospital","shop"], answer: 0, explain: "'Dorixona' means 'pharmacy'." },
  { id: 1038, q: "Choose the correct form: I ___ in the park now.", options: ["walk","walks","walking","am walking"], answer: 3, explain: "Present continuous → 'am walking'." },
  { id: 1039, q: "Translate into English: 'klinikа' ", options: ["pharmacy","hospital","clinic","museum"], answer: 2, explain: "'Klinika' means 'clinic'." },
  { id: 1040, q: "Choose the correct sentence.", options: ["He don’t like music.","He doesn’t like music.","He not like music.","He no like music."], answer: 1, explain: "Correct: 'He doesn’t like music'." },
  { id: 1041, q: "Translate into English: 'uy' ", options: ["flat","house","room","building"], answer: 1, explain: "'Uy' means 'house'." },
  { id: 1042, q: "Choose the correct form: They ___ very tired yesterday.", options: ["was","were","are","be"], answer: 1, explain: "Past simple plural → 'were'." },
  { id: 1043, q: "Translate into English: 'xonadon' ", options: ["flat","room","household","home"], answer: 3, explain: "'Xonadon' means 'home'." },
  { id: 1044, q: "Choose the correct sentence.", options: ["Is they students?","Are they students?","Am they students?","Be they students?"], answer: 1, explain: "Correct: 'Are they students?'." },
  { id: 1045, q: "Translate into English: 'xona' ", options: ["house","room","home","flat"], answer: 1, explain: "'Xona' means 'room'." },
  { id: 1046, q: "Choose the correct form: He ___ an engineer.", options: ["is","are","am","be"], answer: 0, explain: "Singular subject → 'is'." },
  { id: 1047, q: "Translate into English: 'hovli' ", options: ["garden","yard","park","street"], answer: 1, explain: "'Hovli' means 'yard'." },
  { id: 1048, q: "Choose the correct sentence.", options: ["They was happy.","They were happy.","They is happy.","They am happy."], answer: 1, explain: "Past plural → 'They were'." },
  { id: 1049, q: "Translate into English: 'bog‘' ", options: ["yard","park","garden","street"], answer: 2, explain: "'Bog‘' means 'garden'." },
  { id: 1050, q: "Choose the correct form: We ___ in the garden now.", options: ["are","is","am","be"], answer: 0, explain: "Plural subject → 'are'." },
  { id: 1051, q: "Translate into English: 'ko‘cha' ", options: ["street","road","avenue","square"], answer: 0, explain: "'Ko‘cha' means 'street'." },
  { id: 1052, q: "Choose the correct sentence.", options: ["She go to work every day.","She goes to work every day.","She going to work every day.","She gone to work every day."], answer: 1, explain: "Third person singular → 'goes'." },
  { id: 1053, q: "Translate into English: 'yo‘l' ", options: ["road","street","path","way"], answer: 1, explain: "'Yo‘l' means 'road'." },
  { id: 1054, q: "Choose the correct form: They ___ lunch yesterday.", options: ["have","had","has","having"], answer: 1, explain: "Past simple → 'had'." },
  { id: 1055, q: "Translate into English: 'daryo' ", options: ["sea","lake","river","stream"], answer: 2, explain: "'Daryo' means 'river'." },
  { id: 1056, q: "Choose the correct sentence.", options: ["Do she work here?","Does she work here?","Does she works here?","She does work here?"], answer: 1, explain: "Correct: 'Does she work here?'." },
  { id: 1057, q: "Translate into English: 'ko‘l' ", options: ["sea","lake","river","pool"], answer: 1, explain: "'Ko‘l' means 'lake'." },
  { id: 1058, q: "Choose the correct form: He ___ in Samarkand last year.", options: ["live","lives","lived","living"], answer: 2, explain: "Past simple → 'lived'." },
  { id: 1059, q: "Translate into English: 'dengiz' ", options: ["sea","ocean","lake","river"], answer: 0, explain: "'Dengiz' means 'sea'." },
  { id: 1060, q: "Choose the correct sentence.", options: ["There is two apples.","There are two apples.","There am two apples.","There be two apples."], answer: 1, explain: "Plural → 'There are two apples'." },
  { id: 1061, q: "Translate into English: 'okean' ", options: ["ocean","sea","river","lake"], answer: 0, explain: "'Okean' means 'ocean'." },
  { id: 1062, q: "Choose the correct form: I ___ my homework every day.", options: ["do","does","did","done"], answer: 0, explain: "Present simple → 'do'." },
  { id: 1063, q: "Translate into English: 'oromon' ", options: ["forest","park","place","garden"], answer: 0, explain: "'Oromon' means 'forest'." },
  { id: 1064, q: "Choose the correct sentence.", options: ["We was late yesterday.","We were late yesterday.","We is late yesterday.","We be late yesterday."], answer: 1, explain: "Past plural → 'We were'." },
  { id: 1065, q: "Translate into English: 'tog‘' ", options: ["hill","mountain","valley","rock"], answer: 1, explain: "'Tog‘' means 'mountain'." },
  { id: 1066, q: "Choose the correct form: She ___ tea now.", options: ["drink","drinks","is drinking","drank"], answer: 2, explain: "Present continuous → 'is drinking'." },
  { id: 1067, q: "Translate into English: 'vodiy' ", options: ["mountain","valley","plain","hill"], answer: 1, explain: "'Vodiy' means 'valley'." },
  { id: 1068, q: "Choose the correct sentence.", options: ["They doesn’t like coffee.","They don’t like coffee.","They not like coffee.","They no like coffee."], answer: 1, explain: "Correct: 'They don’t like coffee'." },
  { id: 1069, q: "Translate into English: 'cho‘l' ", options: ["forest","desert","valley","steppe"], answer: 1, explain: "'Cho‘l' means 'desert'." },
  { id: 1070, q: "Choose the correct form: He ___ football every Sunday.", options: ["play","plays","played","playing"], answer: 1, explain: "Third person singular → 'plays'." },
  { id: 1071, q: "Translate into English: 'dasht' ", options: ["forest","steppe","valley","mountain"], answer: 1, explain: "'Dasht' means 'steppe'." },
  { id: 1072, q: "Choose the correct sentence.", options: ["Is you a student?","Are you a student?","Am you a student?","Be you a student?"], answer: 1, explain: "Correct: 'Are you a student?'." },
  { id: 1073, q: "Translate into English: 'oromgoh' ", options: ["camp","hotel","park","village"], answer: 0, explain: "'Oromgoh' means 'camp'." },
  { id: 1074, q: "Choose the correct form: They ___ in the classroom now.", options: ["is","are","am","be"], answer: 1, explain: "Plural subject → 'are'." },
  { id: 1075, q: "Translate into English: 'qishloq' ", options: ["town","village","city","country"], answer: 1, explain: "'Qishloq' means 'village'." },
  { id: 1076, q: "Choose the correct sentence.", options: ["She don’t speak English.","She doesn’t speak English.","She not speak English.","She no speak English."], answer: 1, explain: "Correct: 'She doesn’t speak English'." },
  { id: 1077, q: "Translate into English: 'shahar' ", options: ["village","city","town","country"], answer: 1, explain: "'Shahar' means 'city'." },
  { id: 1078, q: "Choose the correct form: We ___ very busy yesterday.", options: ["was","were","are","be"], answer: 1, explain: "Past plural → 'were'." },
  { id: 1079, q: "Translate into English: 'tuman' ", options: ["region","district","province","area"], answer: 1, explain: "'Tuman' means 'district'." },
  { id: 1080, q: "Choose the correct sentence.", options: ["Does they play chess?","Do they play chess?","They does play chess?","Do they plays chess?"], answer: 1, explain: "Correct: 'Do they play chess?'." },
  { id: 1081, q: "Translate into English: 'viloyat' ", options: ["district","province","city","region"], answer: 1, explain: "'Viloyat' means 'province'." },
  { id: 1082, q: "Choose the correct form: He ___ at school last Monday.", options: ["was","were","is","be"], answer: 0, explain: "Past singular → 'was'." },
  { id: 1083, q: "Translate into English: 'respublika' ", options: ["republic","state","country","province"], answer: 0, explain: "'Respublika' means 'republic'." },
  { id: 1084, q: "Choose the correct sentence.", options: ["There is many people in the park.","There are many people in the park.","There am many people in the park.","There be many people in the park."], answer: 1, explain: "Plural → 'There are many people'." },
  { id: 1085, q: "Translate into English: 'davlat' ", options: ["state","country","government","nation"], answer: 0, explain: "'Davlat' means 'state'." },
  { id: 1086, q: "Choose the correct form: She ___ in London now.", options: ["live","lives","lived","living"], answer: 1, explain: "Third person singular → 'lives'." },
  { id: 1087, q: "Translate into English: 'mamlakat' ", options: ["state","province","country","district"], answer: 2, explain: "'Mamlakat' means 'country'." },
  { id: 1088, q: "Choose the correct sentence.", options: ["We goes shopping on Sundays.","We go shopping on Sundays.","We going shopping on Sundays.","We gone shopping on Sundays."], answer: 1, explain: "Correct: 'We go shopping on Sundays'." },
  { id: 1089, q: "Translate into English: 'xalq' ", options: ["nation","people","country","society"], answer: 1, explain: "'Xalq' means 'people'." },
  { id: 1090, q: "Choose the correct form: I ___ a letter yesterday.", options: ["write","writes","wrote","writing"], answer: 2, explain: "Past simple → 'wrote'." },
  { id: 1091, q: "Translate into English: 'millat' ", options: ["state","nation","people","country"], answer: 1, explain: "'Millat' means 'nation'." },
  { id: 1092, q: "Choose the correct sentence.", options: ["He don’t go to school.","He doesn’t go to school.","He not go to school.","He no go to school."], answer: 1, explain: "Correct: 'He doesn’t go to school'." },
  { id: 1093, q: "Translate into English: 'hukumat' ", options: ["state","government","province","district"], answer: 1, explain: "'Hukumat' means 'government'." },
  { id: 1094, q: "Choose the correct form: They ___ at the park last week.", options: ["is","are","was","were"], answer: 3, explain: "Past plural → 'were'." },
  { id: 1095, q: "Translate into English: 'qonun' ", options: ["law","rule","order","command"], answer: 0, explain: "'Qonun' means 'law'." },
  { id: 1096, q: "Choose the correct sentence.", options: ["Does you like football?","Do you like football?","Do you likes football?","You does like football?"], answer: 1, explain: "Correct: 'Do you like football?'." },
  { id: 1097, q: "Translate into English: 'qoidа' ", options: ["law","rule","command","right"], answer: 1, explain: "'Qoida' means 'rule'." },
  { id: 1098, q: "Choose the correct form: She ___ her room every Saturday.", options: ["clean","cleans","cleaned","cleaning"], answer: 1, explain: "Third person singular → 'cleans'." },
  { id: 1099, q: "Translate into English: 'huquq' ", options: ["law","order","right","rule"], answer: 2, explain: "'Huquq' means 'right'." },
  { id: 1100, q: "Choose the correct sentence.", options: ["We was happy yesterday.","We were happy yesterday.","We is happy yesterday.","We be happy yesterday."], answer: 1, explain: "Past plural → 'We were'." },
  { id: 1101, q: "Translate into English: 'mustaqillik' ", options: ["freedom","independence","liberty","self-rule"], answer: 1, explain: "'Mustaqillik' means 'independence'." },
  { id: 1102, q: "Choose the correct form: He ___ English well.", options: ["speak","speaks","spoke","speaking"], answer: 1, explain: "Third person singular → 'speaks'." },
  { id: 1103, q: "Translate into English: 'erkinlik' ", options: ["freedom","rule","independence","order"], answer: 0, explain: "'Erkinlik' means 'freedom'." },
  { id: 1104, q: "Choose the correct sentence.", options: ["Does she likes tea?","Does she like tea?","She does like tea?","She like tea?"], answer: 1, explain: "Correct: 'Does she like tea?'." },
  { id: 1105, q: "Translate into English: 'ozodlik' ", options: ["independence","liberty","rule","freedom"], answer: 1, explain: "'Ozodlik' means 'liberty'." },
  { id: 1106, q: "Choose the correct form: They ___ TV now.", options: ["watch","watches","are watching","watched"], answer: 2, explain: "Present continuous → 'are watching'." },
  { id: 1107, q: "Translate into English: 'xalqaro' ", options: ["national","international","foreign","global"], answer: 1, explain: "'Xalqaro' means 'international'." },
  { id: 1108, q: "Choose the correct sentence.", options: ["There is three books on the table.","There are three books on the table.","There am three books on the table.","There be three books on the table."], answer: 1, explain: "Plural → 'There are'." },
  { id: 1109, q: "Translate into English: 'milliy' ", options: ["national","international","native","public"], answer: 0, explain: "'Milliy' means 'national'." },
  { id: 1110, q: "Choose the correct form: She ___ a beautiful dress yesterday.", options: ["wear","wears","wore","wearing"], answer: 2, explain: "Past simple → 'wore'." },
  { id: 1111, q: "Translate into English: 'davr' ", options: ["time","century","period","era"], answer: 2, explain: "'Davr' means 'period'." },
  { id: 1112, q: "Choose the correct sentence.", options: ["He don’t know the answer.","He doesn’t know the answer.","He not know the answer.","He no know the answer."], answer: 1, explain: "Correct: 'He doesn’t know'." },
  { id: 1113, q: "Translate into English: 'asr' ", options: ["age","century","era","time"], answer: 1, explain: "'Asr' means 'century'." },
  { id: 1114, q: "Choose the correct form: They ___ to the museum last week.", options: ["go","goes","went","going"], answer: 2, explain: "Past simple → 'went'." },
  { id: 1115, q: "Translate into English: 'mingyillik' ", options: ["century","millennium","decade","era"], answer: 1, explain: "'Mingyillik' means 'millennium'." },
  { id: 1116, q: "Choose the correct sentence.", options: ["Do he live in Tashkent?","Does he live in Tashkent?","Does he lives in Tashkent?","He do live in Tashkent?"], answer: 1, explain: "Correct: 'Does he live in Tashkent?'." },
  { id: 1117, q: "Translate into English: 'o‘n yillik' ", options: ["decade","century","era","millennium"], answer: 0, explain: "'O‘n yillik' means 'decade'." },
  { id: 1118, q: "Choose the correct form: She ___ very tired now.", options: ["is","are","was","were"], answer: 0, explain: "Present singular → 'is'." },
  { id: 1119, q: "Translate into English: 'tarix' ", options: ["story","history","legend","tale"], answer: 1, explain: "'Tarix' means 'history'." },
  { id: 1120, q: "Choose the correct sentence.", options: ["They was at home yesterday.","They were at home yesterday.","They is at home yesterday.","They be at home yesterday."], answer: 1, explain: "Past plural → 'were'." },
  { id: 1121, q: "Translate into English: 'hodisa' ", options: ["event","situation","accident","incident"], answer: 0, explain: "'Hodisa' means 'event'." },
  { id: 1122, q: "Choose the correct form: I ___ my friend last night.", options: ["meet","meets","met","meeting"], answer: 2, explain: "Past simple → 'met'." },
  { id: 1123, q: "Translate into English: 'voqea' ", options: ["event","story","happening","incident"], answer: 3, explain: "'Voqea' means 'incident'." },
  { id: 1124, q: "Choose the correct sentence.", options: ["Do she speak Russian?","Does she speak Russian?","Does she speaks Russian?","She does speaks Russian?"], answer: 1, explain: "Correct: 'Does she speak Russian?'." },
  { id: 1125, q: "Translate into English: 'sarguzasht' ", options: ["tale","adventure","story","event"], answer: 1, explain: "'Sarguzasht' means 'adventure'." },
  { id: 1126, q: "Choose the correct form: They ___ football every Friday.", options: ["play","plays","played","playing"], answer: 0, explain: "Plural subject → 'play'." },
  { id: 1127, q: "Translate into English: 'afsona' ", options: ["legend","myth","tale","fairy tale"], answer: 0, explain: "'Afsona' means 'legend'." },
  { id: 1128, q: "Choose the correct sentence.", options: ["There is some students in the class.","There are some students in the class.","There am some students in the class.","There be some students in the class."], answer: 1, explain: "Plural → 'There are'." },
  { id: 1129, q: "Translate into English: 'rivoyat' ", options: ["legend","myth","story","narration"], answer: 1, explain: "'Rivoyat' means 'myth'." },
  { id: 1130, q: "Choose the correct form: He ___ to school by bus every day.", options: ["go","goes","went","going"], answer: 1, explain: "Third person singular → 'goes'." },
  { id: 1131, q: "Translate into English: 'ertak' ", options: ["story","fairy tale","legend","tale"], answer: 1, explain: "'Ertak' means 'fairy tale'." },
  { id: 1132, q: "Choose the correct sentence.", options: ["He don’t like music.","He doesn’t like music.","He not like music.","He no like music."], answer: 1, explain: "Correct: 'He doesn’t like music'." },
  { id: 1133, q: "Translate into English: 'she’r' ", options: ["poetry","verse","poem","song"], answer: 2, explain: "'She’r' means 'poem'." },
  { id: 1134, q: "Choose the correct form: They ___ at the cinema last Saturday.", options: ["is","are","was","were"], answer: 3, explain: "Past plural → 'were'." },
  { id: 1135, q: "Translate into English: 'maqola' ", options: ["article","essay","proverb","story"], answer: 0, explain: "'Maqola' means 'article'." },
  { id: 1136, q: "Choose the correct sentence.", options: ["Does they work in the office?","Do they work in the office?","They does work in the office?","Do they works in the office?"], answer: 1, explain: "Correct: 'Do they work in the office?'." },
  { id: 1137, q: "Translate into English: 'maqol' ", options: ["saying","proverb","expression","quote"], answer: 1, explain: "'Maqol' means 'proverb'." },
  { id: 1138, q: "Choose the correct form: I ___ breakfast at 7 o’clock yesterday.", options: ["have","has","had","having"], answer: 2, explain: "Past simple → 'had'." },
  { id: 1139, q: "Translate into English: 'hikoya' ", options: ["story","tale","novel","legend"], answer: 0, explain: "'Hikoya' means 'story'." },
  { id: 1140, q: "Choose the correct sentence.", options: ["We goes to school every day.","We go to school every day.","We going to school every day.","We gone to school every day."], answer: 1, explain: "Correct: 'We go to school every day'." },
  { id: 1141, q: "Translate into English: 'roman' ", options: ["story","novel","tale","poem"], answer: 1, explain: "'Roman' means 'novel'." },
  { id: 1142, q: "Choose the correct form: She ___ to the park last Sunday.", options: ["go","goes","went","going"], answer: 2, explain: "Past simple → 'went'." },
  { id: 1143, q: "Translate into English: 'doston' ", options: ["epic","story","poem","legend"], answer: 0, explain: "'Doston' means 'epic'." },
  { id: 1144, q: "Choose the correct sentence.", options: ["Does you study English?","Do you study English?","Do you studies English?","You does study English?"], answer: 1, explain: "Correct: 'Do you study English?'." },
  { id: 1145, q: "Translate into English: 'tragediya' ", options: ["comedy","tragedy","drama","story"], answer: 1, explain: "'Tragediya' means 'tragedy'." },
  { id: 1146, q: "Choose the correct form: They ___ swimming now.", options: ["is","are","am","be"], answer: 1, explain: "Plural present continuous → 'are'." },
  { id: 1147, q: "Translate into English: 'komediya' ", options: ["comedy","tragedy","drama","fun"], answer: 0, explain: "'Komediya' means 'comedy'." },
  { id: 1148, q: "Choose the correct sentence.", options: ["She don’t work here.","She doesn’t work here.","She not work here.","She no work here."], answer: 1, explain: "Correct: 'She doesn’t work here'." },
  { id: 1149, q: "Translate into English: 'drama' ", options: ["drama","tragedy","comedy","story"], answer: 0, explain: "'Drama' means 'drama'." },
  { id: 1150, q: "Choose the correct form: He ___ a new car last week.", options: ["buy","buys","bought","buying"], answer: 2, explain: "Past simple → 'bought'." },
  { id: 1151, q: "Translate into English: 'qahramon' ", options: ["hero","actor","character","fighter"], answer: 0, explain: "'Qahramon' means 'hero'." },
  { id: 1152, q: "Choose the correct sentence.", options: ["They has two children.","They have two children.","They having two children.","They hads two children."], answer: 1, explain: "Plural subject → 'They have'." },
  { id: 1153, q: "Translate into English: 'asosiy qahramon' ", options: ["main story","main hero","main character","main actor"], answer: 2, explain: "'Asosiy qahramon' means 'main character'." },
  { id: 1154, q: "Choose the correct form: We ___ to school every day.", options: ["go","goes","went","gone"], answer: 0, explain: "Plural present simple → 'go'." },
  { id: 1155, q: "Translate into English: 'yovuz qahramon' ", options: ["bad man","evil character","dark hero","villain"], answer: 3, explain: "'Yovuz qahramon' means 'villain'." },
  { id: 1156, q: "Choose the correct sentence.", options: ["He are a good student.","He is a good student.","He am a good student.","He be a good student."], answer: 1, explain: "Correct form → 'He is'." },
  { id: 1157, q: "Translate into English: 'mashhur' ", options: ["popular","famous","known","celebrated"], answer: 1, explain: "'Mashhur' means 'famous'." },
  { id: 1158, q: "Choose the correct form: I ___ breakfast now.", options: ["have","has","am having","had"], answer: 2, explain: "Present continuous → 'am having'." },
  { id: 1159, q: "Translate into English: 'shon-shuhrat' ", options: ["popularity","fame","glory","honor"], answer: 2, explain: "'Shon-shuhrat' means 'glory'." },
  { id: 1160, q: "Choose the correct sentence.", options: ["She doesn’t likes coffee.","She doesn’t like coffee.","She not likes coffee.","She no like coffee."], answer: 1, explain: "Correct: 'She doesn’t like coffee'." },
  { id: 1161, q: "Translate into English: 'obro‘' ", options: ["reputation","respect","status","honor"], answer: 0, explain: "'Obro‘' means 'reputation'." },
  { id: 1162, q: "Choose the correct form: They ___ tennis last Sunday.", options: ["play","plays","played","playing"], answer: 2, explain: "Past simple → 'played'." },
  { id: 1163, q: "Translate into English: 'hurmat' ", options: ["honor","respect","dignity","esteem"], answer: 1, explain: "'Hurmat' means 'respect'." },
  { id: 1164, q: "Choose the correct sentence.", options: ["I am go to the market.","I going to the market.","I am going to the market.","I goes to the market."], answer: 2, explain: "Present continuous → 'I am going'." },
  { id: 1165, q: "Translate into English: 'sha’n' ", options: ["status","reputation","dignity","honor"], answer: 2, explain: "'Sha’n' means 'dignity'." },
  { id: 1166, q: "Choose the correct form: She ___ to London next week.", options: ["go","goes","is going","going"], answer: 2, explain: "Planned future → 'is going'." },
  { id: 1167, q: "Translate into English: 'qadr-qimmat' ", options: ["value","price","honor","dignity"], answer: 3, explain: "'Qadr-qimmat' means 'dignity'." },
  { id: 1168, q: "Choose the correct sentence.", options: ["He don’t work on Sundays.","He doesn’t work on Sundays.","He not work on Sundays.","He no work on Sundays."], answer: 1, explain: "Correct: 'He doesn’t work'." },
  { id: 1169, q: "Translate into English: 'e’tibor' ", options: ["attention","respect","notice","focus"], answer: 0, explain: "'E’tibor' means 'attention'." },
  { id: 1170, q: "Choose the correct form: I ___ my homework now.", options: ["do","does","am doing","did"], answer: 2, explain: "Present continuous → 'am doing'." },
  { id: 1171, q: "Translate into English: 'ehtirom' ", options: ["respect","honor","esteem","regard"], answer: 0, explain: "'Ehtirom' means 'respect'." },
  { id: 1172, q: "Choose the correct sentence.", options: ["They doesn’t live here.","They don’t live here.","They no live here.","They not live here."], answer: 1, explain: "Correct plural negative → 'They don’t live here'." },
  { id: 1173, q: "Translate into English: 'ta’sir' ", options: ["effect","affect","influence","impact"], answer: 3, explain: "'Ta’sir' means 'impact'." },
  { id: 1174, q: "Choose the correct form: She ___ already finished her homework.", options: ["have","has","having","had"], answer: 1, explain: "Present perfect → 'has finished'." },
  { id: 1175, q: "Translate into English: 'ta’sir ko‘rsatmoq' ", options: ["to affect","to effect","to influence","to impact"], answer: 2, explain: "'Ta’sir ko‘rsatmoq' means 'to influence'." },
  { id: 1176, q: "Choose the correct sentence.", options: ["He have been to London.","He has been to London.","He is been to London.","He was been to London."], answer: 1, explain: "Correct: 'He has been to London'." },
  { id: 1177, q: "Translate into English: 'aqlli' ", options: ["intelligent","clever","smart","wise"], answer: 0, explain: "'Aqlli' means 'intelligent'." },
  { id: 1178, q: "Choose the correct form: We ___ in this city for 5 years.", options: ["live","lives","have lived","living"], answer: 2, explain: "Present perfect → 'have lived'." },
  { id: 1179, q: "Translate into English: 'donishmand' ", options: ["wise","clever","knowledgeable","learned"], answer: 0, explain: "'Donishmand' means 'wise'." },
  { id: 1180, q: "Choose the correct sentence.", options: ["She is married with a teacher.","She is married to a teacher.","She married with a teacher.","She married to a teacher."], answer: 1, explain: "Correct preposition → 'married to'." },
  { id: 1181, q: "Translate into English: 'farosatli' ", options: ["clever","intelligent","smart","wise"], answer: 2, explain: "'Farosatli' means 'smart'." },
  { id: 1182, q: "Choose the correct form: By next year, I ___ English for 3 years.", options: ["study","studies","will have studied","studying"], answer: 2, explain: "Future perfect → 'will have studied'." },
  { id: 1183, q: "Translate into English: 'zehnli' ", options: ["intelligent","clever","bright","wise"], answer: 2, explain: "'Zehnli' means 'bright'." },
  { id: 1184, q: "Choose the correct sentence.", options: ["I am boring in the class.","I am bored in the class.","I bored in the class.","I boring in the class."], answer: 1, explain: "Correct adjective → 'I am bored'." },
  { id: 1185, q: "Translate into English: 'nodon' ", options: ["foolish","stupid","ignorant","silly"], answer: 2, explain: "'Nodon' means 'ignorant'." },
  { id: 1186, q: "Choose the correct form: He ___ the letter tomorrow.", options: ["writes","wrote","is writing","will write"], answer: 3, explain: "Future simple → 'will write'." },
  { id: 1187, q: "Translate into English: 'ahmoq' ", options: ["stupid","foolish","silly","crazy"], answer: 0, explain: "'Ahmoq' means 'stupid'." },
  { id: 1188, q: "Choose the correct sentence.", options: ["She suggested to go to the park.","She suggested going to the park.","She suggested go to the park.","She suggested goes to the park."], answer: 1, explain: "Correct: 'suggested going'." },
  { id: 1189, q: "Translate into English: 'telba' ", options: ["mad","crazy","foolish","silly"], answer: 1, explain: "'Telba' means 'crazy'." },
  { id: 1190, q: "Choose the correct form: He ___ lunch when I called.", options: ["have","was having","has","had"], answer: 1, explain: "Past continuous → 'was having'." },
  { id: 1191, q: "Translate into English: 'tentak' ", options: ["foolish","silly","stupid","crazy"], answer: 1, explain: "'Tentak' means 'silly'." },
  { id: 1192, q: "Choose the correct sentence.", options: ["I have visited Paris last year.","I visited Paris last year.","I have visit Paris last year.","I visiting Paris last year."], answer: 1, explain: "Correct past simple → 'I visited Paris last year'." },
  { id: 1193, q: "Translate into English: 'aqldan ozgan' ", options: ["crazy","mad","insane","foolish"], answer: 2, explain: "'Aqldan ozgan' means 'insane'." },
  { id: 1194, q: "Choose the correct form: We ___ dinner by the time she arrives.", options: ["finish","finished","will have finished","finishing"], answer: 2, explain: "Future perfect → 'will have finished'." },
  { id: 1195, q: "Translate into English: 'odam' ", options: ["man","person","human","people"], answer: 1, explain: "'Odam' means 'person'." },
  { id: 1196, q: "Choose the correct sentence.", options: ["He is afraid from dogs.","He is afraid of dogs.","He is afraid at dogs.","He afraid dogs."], answer: 1, explain: "Correct preposition → 'afraid of'." },
  { id: 1197, q: "Translate into English: 'inson' ", options: ["human","person","people","man"], answer: 0, explain: "'Inson' means 'human'." },
  { id: 1198, q: "Choose the correct form: She ___ a new book recently.", options: ["buys","buy","has bought","buying"], answer: 2, explain: "Present perfect → 'has bought'." },
  { id: 1199, q: "Translate into English: 'xalq' ", options: ["people","nation","public","community"], answer: 0, explain: "'Xalq' means 'people'." },
  { id: 1200, q: "Choose the correct sentence.", options: ["I am agree with you.","I agree with you.","I agreeing with you.","I am agreeing with you."], answer: 1, explain: "Correct form → 'I agree with you'." },
  { id: 1201, q: "Translate into English: 'millat' ", options: ["nation","people","country","state"], answer: 0, explain: "'Millat' means 'nation'." },
  { id: 1202, q: "Choose the correct form: He ___ TV when the phone rang.", options: ["watch","was watching","watches","watched"], answer: 1, explain: "Past continuous → 'was watching'." },
  { id: 1203, q: "Translate into English: 'davlat' ", options: ["country","state","government","nation"], answer: 1, explain: "'Davlat' means 'state'." },
  { id: 1204, q: "Choose the correct sentence.", options: ["She is interested on music.","She is interested in music.","She interested in music.","She interested on music."], answer: 1, explain: "Correct preposition → 'interested in'." },
  { id: 1205, q: "Translate into English: 'hukumat' ", options: ["power","government","authority","rule"], answer: 1, explain: "'Hukumat' means 'government'." },
  { id: 1206, q: "Choose the correct form: We ___ our homework before dinner yesterday.", options: ["finish","finished","finishes","finishing"], answer: 1, explain: "Past simple → 'finished'." },
  { id: 1207, q: "Translate into English: 'rahbar' ", options: ["manager","director","leader","boss"], answer: 2, explain: "'Rahbar' means 'leader'." },
  { id: 1208, q: "Choose the correct sentence.", options: ["He married with Anna.","He married Anna.","He married to Anna.","He has married with Anna."], answer: 1, explain: "Correct form → 'married Anna'." },
  { id: 1209, q: "Translate into English: 'boshliq' ", options: ["leader","boss","head","chief"], answer: 1, explain: "'Boshliq' means 'boss'." },
  { id: 1210, q: "Choose the correct form: By 2025, she ___ her studies.", options: ["complete","completed","will have completed","completing"], answer: 2, explain: "Future perfect → 'will have completed'." },
  { id: 1211, q: "Translate into English: 'rahbarlik' ", options: ["guidance","management","leadership","control"], answer: 2, explain: "'Rahbarlik' means 'leadership'." },
  { id: 1212, q: "Choose the correct sentence.", options: ["He is good in playing chess.","He is good at playing chess.","He good at playing chess.","He is good on playing chess."], answer: 1, explain: "Correct preposition → 'good at'." },
  { id: 1213, q: "Translate into English: 'boshqaruv' ", options: ["control","rule","guidance","management"], answer: 3, explain: "'Boshqaruv' means 'management'." },
  { id: 1214, q: "Choose the correct form: She ___ to Paris many times.", options: ["go","goes","has gone","went"], answer: 2, explain: "Present perfect → 'has gone'." },
  { id: 1215, q: "Translate into English: 'hukmdor' ", options: ["leader","ruler","king","lord"], answer: 1, explain: "'Hukmdor' means 'ruler'." },
  { id: 1216, q: "Choose the correct sentence.", options: ["I look forward to see you.","I look forward to seeing you.","I am look forward to seeing you.","I look forward see you."], answer: 1, explain: "Correct: 'look forward to + V-ing'." },
  { id: 1217, q: "Translate into English: 'podsho' ", options: ["prince","lord","king","emperor"], answer: 2, explain: "'Podsho' means 'king'." },
  { id: 1218, q: "Choose the correct form: He ___ a doctor since 2010.", options: ["is","was","has been","have been"], answer: 2, explain: "Present perfect → 'has been'." },
  { id: 1219, q: "Translate into English: 'malika' ", options: ["queen","princess","lady","duchess"], answer: 1, explain: "'Malika' means 'princess'." },
  { id: 1220, q: "Choose the correct sentence.", options: ["She is good at cook.","She is good at cooking.","She good at cooking.","She is good in cooking."], answer: 1, explain: "Correct → 'good at cooking'." },
  { id: 1221, q: "Translate into English: 'qirolicha' ", options: ["queen","princess","lady","duchess"], answer: 0, explain: "'Qirolicha' means 'queen'." },
  { id: 1222, q: "Choose the correct form: We ___ dinner when she arrived.", options: ["have","had","were having","has"], answer: 2, explain: "Past continuous → 'were having'." },
  { id: 1223, q: "Translate into English: 'shoh' ", options: ["lord","king","prince","chief"], answer: 1, explain: "'Shoh' means 'king'." },
  { id: 1224, q: "Choose the correct sentence.", options: ["He is married with a doctor.","He is married to a doctor.","He married with a doctor.","He married to a doctor."], answer: 1, explain: "Correct preposition → 'married to'." },
  { id: 1225, q: "Translate into English: 'sulton' ", options: ["emperor","lord","sultan","king"], answer: 2, explain: "'Sulton' means 'sultan'." },
  { id: 1226, q: "Choose the correct form: She ___ English when she was a child.", options: ["learn","learns","learnt","learning"], answer: 2, explain: "Past simple → 'learnt'." },
  { id: 1227, q: "Translate into English: 'amir' ", options: ["prince","emir","lord","chief"], answer: 1, explain: "'Amir' means 'emir'." },
  { id: 1228, q: "Choose the correct sentence.", options: ["He is afraid to spiders.","He is afraid from spiders.","He is afraid of spiders.","He afraid spiders."], answer: 2, explain: "Correct preposition → 'afraid of'." },
  { id: 1229, q: "Translate into English: 'bek' ", options: ["lord","chief","prince","noble"], answer: 0, explain: "'Bek' means 'lord'." },
  { id: 1230, q: "Choose the correct form: I ___ this film before.", options: ["see","saw","have seen","seeing"], answer: 2, explain: "Present perfect → 'have seen'." },
  { id: 1231, q: "Translate into English: 'zodagon' ", options: ["noble","prince","royal","lord"], answer: 0, explain: "'Zodagon' means 'noble'." },
  { id: 1232, q: "Choose the correct sentence.", options: ["She suggest to go out.","She suggested going out.","She suggested to going out.","She suggested go out."], answer: 1, explain: "Correct: 'suggested going'." },
  { id: 1233, q: "Translate into English: 'saroy' ", options: ["palace","castle","fortress","court"], answer: 0, explain: "'Saroy' means 'palace'." },
  { id: 1234, q: "Choose the correct form: While she ___, I was cooking.", options: ["study","studies","was studying","studied"], answer: 2, explain: "Past continuous → 'was studying'." },
  { id: 1235, q: "Translate into English: 'qal’a' ", options: ["castle","fortress","palace","tower"], answer: 0, explain: "'Qal’a' means 'castle'." },
  { id: 1236, q: "Choose the correct sentence.", options: ["I look forward to hear from you.","I look forward to hearing from you.","I looking forward to hear from you.","I look forward hearing from you."], answer: 1, explain: "Correct: 'look forward to hearing'." },
  { id: 1237, q: "Translate into English: 'qo‘rg‘on' ", options: ["fortress","castle","palace","stronghold"], answer: 0, explain: "'Qo‘rg‘on' means 'fortress'." },
  { id: 1238, q: "Choose the correct form: He ___ the letter yet.", options: ["don’t write","hasn’t written","haven’t written","not written"], answer: 1, explain: "Negative present perfect → 'hasn’t written'." },
  { id: 1239, q: "Translate into English: 'minora' ", options: ["tower","pillar","building","castle"], answer: 0, explain: "'Minora' means 'tower'." },
  { id: 1240, q: "Choose the correct sentence.", options: ["I am tired with work.","I am tired of work.","I tired with work.","I am tiring of work."], answer: 1, explain: "Correct preposition → 'tired of'." },
  { id: 1241, q: "Translate into English: 'taxt' ", options: ["throne","chair","seat","crown"], answer: 0, explain: "'Taxt' means 'throne'." },
  { id: 1242, q: "Choose the correct form: He ___ already eaten lunch.", options: ["has","have","having","had"], answer: 0, explain: "Present perfect → 'has eaten'." },
  { id: 1243, q: "Translate into English: 'toj' ", options: ["crown","ring","throne","head"], answer: 0, explain: "'Toj' means 'crown'." },
  { id: 1244, q: "Choose the correct sentence.", options: ["He has gone to the shop yesterday.","He went to the shop yesterday.","He has went to the shop yesterday.","He gone to the shop yesterday."], answer: 1, explain: "Past simple → 'went yesterday'." },
  { id: 1245, q: "Translate into English: 'saltanat' ", options: ["kingdom","empire","sultanate","realm"], answer: 0, explain: "'Saltanat' means 'kingdom'." },
  { id: 1246, q: "Choose the correct form: We ___ never been to Rome.", options: ["have","has","having","had"], answer: 0, explain: "Present perfect plural → 'have been'." },
  { id: 1247, q: "Translate into English: 'imperiya' ", options: ["empire","kingdom","realm","sultanate"], answer: 0, explain: "'Imperiya' means 'empire'." },
  { id: 1248, q: "Choose the correct sentence.", options: ["I am interested to history.","I am interested in history.","I interested in history.","I am interested on history."], answer: 1, explain: "Correct: 'interested in'." },
  { id: 1249, q: "Translate into English: 'podsholik' ", options: ["kingdom","empire","realm","dynasty"], answer: 0, explain: "'Podsholik' means 'kingdom'." },
  { id: 1250, q: "Choose the correct form: He ___ football every weekend.", options: ["play","plays","played","playing"], answer: 1, explain: "Present simple third person → 'plays'." },
  { id: 1251, q: "Translate into English: 'sulola' ", options: ["dynasty","empire","kingdom","family"], answer: 0, explain: "'Sulola' means 'dynasty'." },
  { id: 1252, q: "Choose the correct sentence.", options: ["She can sings.","She cans sing.","She can sing.","She can to sing."], answer: 2, explain: "Modal verb + base verb → 'can sing'." },
  { id: 1253, q: "Translate into English: 'nasl' ", options: ["lineage","dynasty","generation","family"], answer: 0, explain: "'Nasl' means 'lineage'." },
  { id: 1254, q: "Choose the correct form: They ___ their house last year.", options: ["build","built","builded","building"], answer: 1, explain: "Past simple → 'built'." },
  { id: 1255, q: "Translate into English: 'avlod' ", options: ["descendant","generation","ancestor","successor"], answer: 1, explain: "'Avlod' means 'generation'." },
  { id: 1256, q: "Choose the correct sentence.", options: ["He don't like coffee.","He doesn't like coffee.","He not like coffee.","He don't likes coffee."], answer: 1, explain: "Correct negative present simple → 'doesn't like'." },
  { id: 1257, q: "Translate into English: 'bobokalon' ", options: ["ancestor","grandfather","forefather","old man"], answer: 0, explain: "'Bobokalon' means 'ancestor'." },
  { id: 1258, q: "Choose the correct form: We ___ English for two years.", options: ["study","studies","have studied","studied"], answer: 2, explain: "Present perfect → 'have studied'." },
  { id: 1259, q: "Translate into English: 'nevara' ", options: ["child","nephew","grandchild","cousin"], answer: 2, explain: "'Nevara' means 'grandchild'." },
  { id: 1260, q: "Choose the correct sentence.", options: ["She suggested go to the park.","She suggested going to the park.","She suggested to going to the park.","She suggested goes to the park."], answer: 1, explain: "Correct gerund form → 'suggested going'." },
  { id: 1261, q: "Translate into English: 'qabila' ", options: ["tribe","nation","clan","family"], answer: 0, explain: "'Qabila' means 'tribe'." },
  { id: 1262, q: "Choose the correct form: I ___ never been to New York.", options: ["has","have","had","having"], answer: 1, explain: "Correct form → 'I have never been'." },
  { id: 1263, q: "Translate into English: 'urug‘' ", options: ["seed","tribe","generation","family"], answer: 1, explain: "'Urug‘' in social context means 'tribe'." },
  { id: 1264, q: "Choose the correct sentence.", options: ["She is married to a teacher.","She is married with a teacher.","She married with a teacher.","She married to a teacher."], answer: 0, explain: "Correct preposition → 'married to'." },
  { id: 1265, q: "Translate into English: 'jamoa' ", options: ["crowd","group","team","society"], answer: 2, explain: "'Jamoa' means 'team'." },
  { id: 1266, q: "Choose the correct form: They ___ in London at the moment.", options: ["lives","live","are living","living"], answer: 2, explain: "Present continuous → 'are living'." },
  { id: 1267, q: "Translate into English: 'xalq' ", options: ["people","nation","society","population"], answer: 0, explain: "'Xalq' means 'people'." },
  { id: 1268, q: "Choose the correct sentence.", options: ["She is afraid of dogs.","She is afraid from dogs.","She afraid dogs.","She is afraid on dogs."], answer: 0, explain: "Correct phrase → 'afraid of'." },
  { id: 1269, q: "Translate into English: 'aholi' ", options: ["residents","people","citizens","population"], answer: 3, explain: "'Aholi' means 'population'." },
  { id: 1270, q: "Choose the correct form: They ___ this car in 2010.", options: ["buy","buys","bought","buyed"], answer: 2, explain: "Past simple → 'bought'." },
  { id: 1271, q: "Translate into English: 'odam' ", options: ["man","person","people","human"], answer: 1, explain: "'Odam' means 'person'." },
  { id: 1272, q: "Choose the correct sentence.", options: ["She is interested on art.","She is interested in art.","She interested in art.","She interested on art."], answer: 1, explain: "Correct → 'interested in'." },
  { id: 1273, q: "Translate into English: 'inson' ", options: ["man","person","human","people"], answer: 2, explain: "'Inson' means 'human'." },
  { id: 1274, q: "Choose the correct form: He ___ the letter yesterday.", options: ["writes","wrote","written","writing"], answer: 1, explain: "Past simple → 'wrote'." },
  { id: 1275, q: "Translate into English: 'shaxs' ", options: ["character","personality","individual","identity"], answer: 2, explain: "'Shaxs' means 'individual'." },
  { id: 1276, q: "Choose the correct sentence.", options: ["She can to swim.","She can swim.","She cans swim.","She can swims."], answer: 1, explain: "Correct modal structure → 'can swim'." },
  { id: 1277, q: "Translate into English: 'jamiyat' ", options: ["community","team","society","union"], answer: 2, explain: "'Jamiyat' means 'society'." },
  { id: 1278, q: "Choose the correct form: By next year, they ___ in Paris for 5 years.", options: ["live","will have lived","living","lives"], answer: 1, explain: "Future perfect → 'will have lived'." },
  { id: 1279, q: "Translate into English: 'xalqaro' ", options: ["domestic","international","national","foreign"], answer: 1, explain: "'Xalqaro' means 'international'." },
  { id: 1280, q: "Choose the correct sentence.", options: ["I look forward to meet you.","I look forward to meeting you.","I am looking forward to meet you.","I look forward meeting you."], answer: 1, explain: "Correct → 'look forward to meeting'." },
  { id: 1281, q: "Translate into English: 'ichki' ", options: ["external","inner","internal","inside"], answer: 2, explain: "'Ichki' means 'internal'." },
  { id: 1282, q: "Choose the correct form: He ___ to the USA three times.", options: ["go","went","has gone","goes"], answer: 2, explain: "Present perfect → 'has gone'." },
  { id: 1283, q: "Translate into English: 'tashqi' ", options: ["inner","outside","external","foreign"], answer: 2, explain: "'Tashqi' means 'external'." },
  { id: 1284, q: "Choose the correct sentence.", options: ["She suggested go shopping.","She suggested going shopping.","She suggested goes shopping.","She suggested to going shopping."], answer: 1, explain: "Correct gerund → 'suggested going'." },
  { id: 1285, q: "Translate into English: 'mahalliy' ", options: ["foreign","domestic","international","global"], answer: 1, explain: "'Mahalliy' means 'domestic' or 'local'." },
  { id: 1286, q: "Choose the correct form: She ___ a new phone last week.", options: ["buy","buys","bought","buyed"], answer: 2, explain: "Past simple → 'bought'." },
  { id: 1287, q: "Translate into English: 'xorijiy' ", options: ["foreign","external","international","outside"], answer: 0, explain: "'Xorijiy' means 'foreign'." },
  { id: 1288, q: "Choose the correct sentence.", options: ["He has went to school.","He went to school.","He gone to school.","He going to school."], answer: 1, explain: "Correct past simple → 'went'." },
  { id: 1289, q: "Translate into English: 'umumiy' ", options: ["common","general","shared","public"], answer: 0, explain: "'Umumiy' means 'common'." },
  { id: 1290, q: "Choose the correct form: I ___ my keys. Can you help me?", options: ["lose","loses","have lost","lost"], answer: 2, explain: "Present perfect → 'have lost'." },
  { id: 1291, q: "Translate into English: 'xususiy' ", options: ["personal","private","special","specific"], answer: 1, explain: "'Xususiy' means 'private'." },
  { id: 1292, q: "Choose the correct sentence.", options: ["She is good in drawing.","She is good at drawing.","She good at drawing.","She is good on drawing."], answer: 1, explain: "Correct → 'good at drawing'." },
  { id: 1293, q: "Translate into English: 'maxsus' ", options: ["personal","special","private","important"], answer: 1, explain: "'Maxsus' means 'special'." },
  { id: 1294, q: "Choose the correct form: They ___ dinner when she called.", options: ["had","have","were having","having"], answer: 2, explain: "Past continuous → 'were having'." },
  { id: 1295, q: "Translate into English: 'oddiy' ", options: ["ordinary","normal","usual","simple"], answer: 0, explain: "'Oddiy' means 'ordinary'." },
  { id: 1296, q: "Choose the correct sentence.", options: ["He suggested going to the museum.","He suggested go to the museum.","He suggested goes to the museum.","He suggested to going to the museum."], answer: 0, explain: "Correct → 'suggested going'." },
  { id: 1297, q: "Translate into English: 'murakkab' ", options: ["hard","complex","difficult","complicated"], answer: 1, explain: "'Murakkab' means 'complex'." },
  { id: 1298, q: "Choose the correct form: She ___ to the library yesterday.", options: ["go","goes","went","gone"], answer: 2, explain: "Past simple → 'went'." },
  { id: 1299, q: "Translate into English: 'oson' ", options: ["easy","light","simple","soft"], answer: 0, explain: "'Oson' means 'easy'." },
  { id: 1300, q: "Choose the correct form: She ___ English very well.", options: ["speak","speaks","speaking","spoken"], answer: 1, explain: "Present simple, third person singular → speaks." },
  { id: 1301, q: "Translate into English: 'osmon' ", options: ["sky","cloud","air","wind"], answer: 0, explain: "'Osmon' means 'sky'." },
  { id: 1302, q: "Choose the correct sentence.", options: ["They is happy.","They are happy.","They am happy.","They be happy."], answer: 1, explain: "Plural subject → They are happy." },
  { id: 1303, q: "Translate into English: 'tog‘' ", options: ["mountain","hill","valley","forest"], answer: 0, explain: "'Tog‘' means 'mountain'." },
  { id: 1304, q: "Choose the correct form: I ___ TV every evening.", options: ["watch","watches","watching","watched"], answer: 0, explain: "Present simple, first person → watch." },
  { id: 1305, q: "Translate into English: 'daryo' ", options: ["lake","river","sea","stream"], answer: 1, explain: "'Daryo' means 'river'." },
  { id: 1306, q: "Choose the correct sentence.", options: ["Does she goes to school?","Do she go to school?","Does she go to school?","She does go to school?"], answer: 2, explain: "Correct question form → Does she go to school?" },
  { id: 1307, q: "Translate into English: 'quyosh' ", options: ["sun","moon","star","light"], answer: 0, explain: "'Quyosh' means 'sun'." },
  { id: 1308, q: "Choose the correct form: We ___ in Tashkent last year.", options: ["live","lives","lived","living"], answer: 2, explain: "Past simple → lived." },
  { id: 1309, q: "Translate into English: 'oy' ", options: ["sun","moon","sky","cloud"], answer: 1, explain: "'Oy' means 'moon'." },
  { id: 1310, q: "Choose the correct word: There ___ two pens on the table.", options: ["is","are","was","be"], answer: 1, explain: "Plural noun → There are." },
  { id: 1311, q: "Translate into English: 'yulduz' ", options: ["star","planet","sky","moon"], answer: 0, explain: "'Yulduz' means 'star'." },
  { id: 1312, q: "Choose the correct sentence.", options: ["I am student.","I student.","I am a student.","I a student."], answer: 2, explain: "Correct form → I am a student." },
  { id: 1313, q: "Translate into English: 'maktab' ", options: ["school","college","classroom","teacher"], answer: 0, explain: "'Maktab' means 'school'." },
  { id: 1314, q: "Choose the correct form: She ___ her homework now.", options: ["do","does","is doing","did"], answer: 2, explain: "Present continuous → is doing." },
  { id: 1315, q: "Translate into English: 'kitob' ", options: ["pen","book","page","letter"], answer: 1, explain: "'Kitob' means 'book'." },
  { id: 1316, q: "Choose the correct sentence.", options: ["We was happy.","We were happy.","We is happy.","We are happy yesterday."], answer: 1, explain: "Past simple plural → We were happy." },
  { id: 1317, q: "Translate into English: 'qalam' ", options: ["pen","pencil","book","paper"], answer: 0, explain: "'Qalam' means 'pen'." },
  { id: 1318, q: "Choose the correct word: He ___ play football every Sunday.", options: ["don’t","doesn’t","isn’t","not"], answer: 1, explain: "Negative for he/she/it → doesn’t." },
  { id: 1319, q: "Translate into English: 'o‘quvchi' ", options: ["teacher","student","worker","driver"], answer: 1, explain: "'O‘quvchi' means 'student'." },
  { id: 1320, q: "Choose the correct form: We ___ dinner at the moment.", options: ["have","has","are having","had"], answer: 2, explain: "Present continuous → are having." },
  { id: 1321, q: "Translate into English: 'o‘qituvchi' ", options: ["student","teacher","driver","doctor"], answer: 1, explain: "'O‘qituvchi' means 'teacher'." },
  { id: 1322, q: "Choose the correct sentence.", options: ["I can to swim.","I can swim.","I cans swim.","I can swimming."], answer: 1, explain: "Correct form → I can swim." },
  { id: 1323, q: "Translate into English: 'daraxt' ", options: ["tree","flower","plant","bush"], answer: 0, explain: "'Daraxt' means 'tree'." },
  { id: 1324, q: "Choose the correct form: He ___ a car.", options: ["has","have","having","had"], answer: 0, explain: "He → has." },
  { id: 1325, q: "Translate into English: 'gul' ", options: ["tree","flower","grass","leaf"], answer: 1, explain: "'Gul' means 'flower'." },
  { id: 1326, q: "Choose the correct sentence.", options: ["There is many people.","There are many people.","There am many people.","There be many people."], answer: 1, explain: "Correct plural form → There are many people." },
  { id: 1327, q: "Translate into English: 'baliq' ", options: ["meat","fish","bird","cow"], answer: 1, explain: "'Baliq' means 'fish'." },
  { id: 1328, q: "Choose the correct word: We ___ to the park yesterday.", options: ["go","goes","went","gone"], answer: 2, explain: "Past simple → went." },
  { id: 1329, q: "Translate into English: 'qush' ", options: ["cat","dog","bird","fish"], answer: 2, explain: "'Qush' means 'bird'." },
  { id: 1330, q: "Choose the correct form: They ___ football every day.", options: ["play","plays","playing","played"], answer: 0, explain: "Present simple plural → play." },
  { id: 1331, q: "Translate into English: 'sigir' ", options: ["cow","horse","sheep","goat"], answer: 0, explain: "'Sigir' means 'cow'." },
  { id: 1332, q: "Choose the correct sentence.", options: ["My brother don’t like pizza.","My brother doesn’t like pizza.","My brother not like pizza.","My brother isn’t like pizza."], answer: 1, explain: "Correct form → My brother doesn’t like pizza." },
  { id: 1333, q: "Translate into English: 'ot' ", options: ["sheep","horse","goat","donkey"], answer: 1, explain: "'Ot' means 'horse'." },
  { id: 1334, q: "Choose the correct word: She ___ swimming now.", options: ["is","are","am","be"], answer: 0, explain: "Present continuous, third person singular → is." },
  { id: 1335, q: "Translate into English: 'qo‘y' ", options: ["cow","sheep","horse","goat"], answer: 1, explain: "'Qo‘y' means 'sheep'." },
  { id: 1336, q: "Choose the correct sentence.", options: ["Do she go to work?","Does she go to work?","She does goes to work?","She go to work?"], answer: 1, explain: "Correct question → Does she go to work?" },
  { id: 1337, q: "Translate into English: 'echki' ", options: ["cow","sheep","goat","camel"], answer: 2, explain: "'Echki' means 'goat'." },
  { id: 1338, q: "Choose the correct word: I ___ breakfast at 7 o’clock.", options: ["have","has","having","had"], answer: 0, explain: "Present simple, first person → have." },
  { id: 1339, q: "Translate into English: 'tuya' ", options: ["horse","donkey","camel","sheep"], answer: 2, explain: "'Tuya' means 'camel'." },
  { id: 1340, q: "Choose the correct sentence.", options: ["There is a lot of apples.","There are a lot of apples.","There am a lot of apples.","There was a lot of apples."], answer: 1, explain: "Correct plural form → There are a lot of apples." },
  { id: 1341, q: "Translate into English: 'it' ", options: ["cat","dog","wolf","fox"], answer: 1, explain: "'It' means 'dog'." },
  { id: 1342, q: "Choose the correct form: We ___ not at home yesterday.", options: ["was","were","are","be"], answer: 1, explain: "Past plural negative → were not." },
  { id: 1343, q: "Translate into English: 'mushuk' ", options: ["cat","dog","mouse","rabbit"], answer: 0, explain: "'Mushuk' means 'cat'." },
  { id: 1344, q: "Choose the correct word: He ___ his car every Sunday.", options: ["wash","washes","washing","washed"], answer: 1, explain: "Present simple, third person singular → washes." },
  { id: 1345, q: "Translate into English: 'quyon' ", options: ["rabbit","mouse","cat","dog"], answer: 0, explain: "'Quyon' means 'rabbit'." },
  { id: 1346, q: "Choose the correct sentence.", options: ["I am go to school.","I going to school.","I am going to school.","I go to school now."], answer: 2, explain: "Present continuous → I am going to school." },
  { id: 1347, q: "Translate into English: 'sichqon' ", options: ["cat","mouse","dog","wolf"], answer: 1, explain: "'Sichqon' means 'mouse'." },
  { id: 1348, q: "Choose the correct word: They ___ in Samarkand last summer.", options: ["is","are","was","were"], answer: 3, explain: "Past simple plural → were." },
  { id: 1349, q: "Translate into English: 'bo‘ri' ", options: ["dog","wolf","fox","bear"], answer: 1, explain: "'Bo‘ri' means 'wolf'." },
  { id: 1350, q: "Choose the correct sentence.", options: ["She like apples.","She likes apples.","She liking apples.","She is likes apples."], answer: 1, explain: "Present simple, third person singular → likes." },
  { id: 1351, q: "Translate into English: 'tulki' ", options: ["wolf","bear","fox","lion"], answer: 2, explain: "'Tulki' means 'fox'." },
  { id: 1352, q: "Choose the correct word: I ___ born in 2000.", options: ["am","was","were","be"], answer: 1, explain: "Past simple, first person → was born." },
  { id: 1353, q: "Translate into English: 'ayiq' ", options: ["tiger","bear","lion","wolf"], answer: 1, explain: "'Ayiq' means 'bear'." },
  { id: 1354, q: "Choose the correct sentence.", options: ["They doesn’t know.","They don’t know.","They not know.","They are don’t know."], answer: 1, explain: "Correct plural form → They don’t know." },
  { id: 1355, q: "Translate into English: 'sher' ", options: ["tiger","bear","lion","wolf"], answer: 2, explain: "'Sher' means 'lion'." },
  { id: 1356, q: "Choose the correct word: She ___ cooking now.", options: ["is","are","am","was"], answer: 0, explain: "Present continuous → She is cooking." },
  { id: 1357, q: "Translate into English: 'yo‘lbars' ", options: ["tiger","lion","bear","leopard"], answer: 0, explain: "'Yo‘lbars' means 'tiger'." },
  { id: 1358, q: "Choose the correct sentence.", options: ["He was at home tomorrow.","He is at home yesterday.","He was at home yesterday.","He at home yesterday."], answer: 2, explain: "Correct past tense → He was at home yesterday." },
  { id: 1359, q: "Translate into English: 'burgut' ", options: ["eagle","hawk","falcon","owl"], answer: 0, explain: "'Burgut' means 'eagle'." },
  { id: 1360, q: "Choose the correct word: We ___ English now.", options: ["learn","are learning","learning","learns"], answer: 1, explain: "Present continuous → are learning." },
  { id: 1361, q: "Translate into English: 'boyo‘g‘li' ", options: ["owl","eagle","parrot","duck"], answer: 0, explain: "'Boyo‘g‘li' means 'owl'." },
  { id: 1362, q: "Choose the correct sentence.", options: ["She don’t like coffee.","She doesn’t like coffee.","She not like coffee.","She is not like coffee."], answer: 1, explain: "Correct negative → She doesn’t like coffee." },
  { id: 1363, q: "Translate into English: 'to‘tiqush' ", options: ["sparrow","parrot","crow","dove"], answer: 1, explain: "'To‘tiqush' means 'parrot'." },
  { id: 1364, q: "Choose the correct word: I ___ my homework yesterday.", options: ["do","did","done","does"], answer: 1, explain: "Past simple → did." },
  { id: 1365, q: "Translate into English: 'kabutar' ", options: ["dove","crow","sparrow","parrot"], answer: 0, explain: "'Kabutar' means 'dove' or 'pigeon'." },
  { id: 1366, q: "Choose the correct form: He ___ not at home now.", options: ["is","are","was","were"], answer: 0, explain: "Present simple → He is not at home now." },
  { id: 1367, q: "Translate into English: 'qarg‘a' ", options: ["crow","dove","sparrow","eagle"], answer: 0, explain: "'Qarg‘a' means 'crow'." },
  { id: 1368, q: "Choose the correct sentence.", options: ["We doesn’t work.","We don’t work.","We not work.","We are don’t work."], answer: 1, explain: "Correct form → We don’t work." },
  { id: 1369, q: "Translate into English: 'chumchuq' ", options: ["sparrow","parrot","crow","eagle"], answer: 0, explain: "'Chumchuq' means 'sparrow'." },
  { id: 1370, q: "Choose the correct word: She ___ a doctor.", options: ["is","are","am","be"], answer: 0, explain: "Singular subject → She is." },
  { id: 1371, q: "Choose the correct form: They ___ in London now.", options: ["is","are","was","were"], answer: 1, explain: "Present simple plural → They are in London." },
  { id: 1372, q: "Translate into English: 'maktab doskasi' ", options: ["blackboard","notebook","paper","chalk"], answer: 0, explain: "'Maktab doskasi' means 'blackboard'." },
  { id: 1373, q: "Choose the correct sentence.", options: ["Do he play chess?","Does he play chess?","He does play chess?","He play chess?"], answer: 1, explain: "Correct form → Does he play chess?" },
  { id: 1374, q: "Translate into English: 'daftar' ", options: ["pen","notebook","paper","book"], answer: 1, explain: "'Daftar' means 'notebook'." },
  { id: 1375, q: "Choose the correct word: My parents ___ teachers.", options: ["is","are","am","be"], answer: 1, explain: "Plural subject → are." },
  { id: 1376, q: "Translate into English: 'qog‘oz' ", options: ["board","chalk","paper","page"], answer: 2, explain: "'Qog‘oz' means 'paper'." },
  { id: 1377, q: "Choose the correct sentence.", options: ["He have a car.","He has a car.","He haves a car.","He having a car."], answer: 1, explain: "Correct form → He has a car." },
  { id: 1378, q: "Translate into English: 'ruchka' ", options: ["pen","pencil","marker","chalk"], answer: 0, explain: "'Ruchka' means 'pen'." },
  { id: 1379, q: "Choose the correct form: We ___ in the park yesterday.", options: ["was","were","are","be"], answer: 1, explain: "Past tense plural → were." },
  { id: 1380, q: "Translate into English: 'qalamdon' ", options: ["schoolbag","pencil case","notebook","ruler"], answer: 1, explain: "'Qalamdon' means 'pencil case'." },
  { id: 1381, q: "Choose the correct sentence.", options: ["She don’t like tea.","She doesn’t like tea.","She not like tea.","She isn’t like tea."], answer: 1, explain: "Correct negative → She doesn’t like tea." },
  { id: 1382, q: "Translate into English: 'sinf xonasi' ", options: ["school","classroom","hall","room"], answer: 1, explain: "'Sinf xonasi' means 'classroom'." },
  { id: 1383, q: "Choose the correct form: I ___ a new phone last week.", options: ["buy","buys","bought","buying"], answer: 2, explain: "Past simple → bought." },
  { id: 1384, q: "Translate into English: 'parta' ", options: ["desk","table","chair","bench"], answer: 0, explain: "'Parta' means 'desk'." },
  { id: 1385, q: "Choose the correct word: They ___ football every day.", options: ["play","plays","playing","played"], answer: 0, explain: "Present simple plural → play." },
  { id: 1386, q: "Translate into English: 'kursi' ", options: ["table","desk","chair","sofa"], answer: 2, explain: "'Kursi' means 'chair'." },
  { id: 1387, q: "Choose the correct sentence.", options: ["Does we go to school?","Do we go to school?","We do go to school?","We goes to school?"], answer: 1, explain: "Correct plural question → Do we go to school?" },
  { id: 1388, q: "Translate into English: 'sumka' ", options: ["bag","pencil","case","pocket"], answer: 0, explain: "'Sumka' means 'bag'." },
  { id: 1389, q: "Choose the correct form: He ___ swimming at the moment.", options: ["is","are","am","be"], answer: 0, explain: "Present continuous → He is swimming." },
  { id: 1390, q: "Translate into English: 'soat' ", options: ["clock","watch","time","bell"], answer: 0, explain: "'Soat' means 'clock' or 'watch'." },
  { id: 1391, q: "Choose the correct sentence.", options: ["There is many books.","There are many books.","There am many books.","There was many books."], answer: 1, explain: "Plural noun → There are many books." },
  { id: 1392, q: "Translate into English: 'devor' ", options: ["roof","wall","floor","door"], answer: 1, explain: "'Devor' means 'wall'." },
  { id: 1393, q: "Choose the correct word: We ___ not at home yesterday.", options: ["was","were","are","be"], answer: 1, explain: "Past plural negative → were not." },
  { id: 1394, q: "Translate into English: 'pol' ", options: ["roof","floor","wall","door"], answer: 1, explain: "'Pol' means 'floor'." },
  { id: 1395, q: "Choose the correct form: She ___ breakfast every morning.", options: ["have","has","having","had"], answer: 1, explain: "Third person singular → has." },
  { id: 1396, q: "Translate into English: 'tom' ", options: ["wall","roof","floor","door"], answer: 1, explain: "'Tom' means 'roof'." },
  { id: 1397, q: "Choose the correct sentence.", options: ["They doesn’t work here.","They don’t work here.","They not work here.","They isn’t work here."], answer: 1, explain: "Correct negative plural → They don’t work here." },
  { id: 1398, q: "Translate into English: 'eshik' ", options: ["window","roof","door","wall"], answer: 2, explain: "'Eshik' means 'door'." },
  { id: 1399, q: "Choose the correct word: We ___ English now.", options: ["learn","are learning","learning","learns"], answer: 1, explain: "Present continuous → are learning." },
  { id: 1400, q: "Translate into English: 'deraza' ", options: ["wall","roof","window","floor"], answer: 2, explain: "'Deraza' means 'window'." },
  { id: 1401, q: "Choose the correct form: I ___ a letter yesterday.", options: ["write","wrote","written","writes"], answer: 1, explain: "Past simple → wrote." },
  { id: 1402, q: "Translate into English: 'xonadon' ", options: ["house","flat","home","room"], answer: 2, explain: "'Xonadon' means 'home'." },
  { id: 1403, q: "Choose the correct sentence.", options: ["She cans swim.","She can swims.","She can swim.","She can to swim."], answer: 2, explain: "Correct form → She can swim." },
  { id: 1404, q: "Translate into English: 'xonalar' ", options: ["houses","flats","rooms","schools"], answer: 2, explain: "'Xonalar' means 'rooms'." },
  { id: 1405, q: "Choose the correct word: We ___ to the cinema last week.", options: ["go","goes","went","gone"], answer: 2, explain: "Past simple → went." },
  { id: 1406, q: "Translate into English: 'oshxona' ", options: ["bedroom","kitchen","living room","bathroom"], answer: 1, explain: "'Oshxona' means 'kitchen'." },
  { id: 1407, q: "Choose the correct form: He ___ in Samarkand two years ago.", options: ["live","lives","lived","living"], answer: 2, explain: "Past simple → lived." },
  { id: 1408, q: "Translate into English: 'yotoqxona' ", options: ["bathroom","living room","bedroom","kitchen"], answer: 2, explain: "'Yotoqxona' means 'bedroom'." },
  { id: 1409, q: "Choose the correct sentence.", options: ["She is go to work now.","She going to work now.","She is going to work now.","She goes to work now."], answer: 2, explain: "Present continuous → She is going to work now." },
  { id: 1410, q: "Translate into English: 'mehmonxona' ", options: ["kitchen","living room","bedroom","school"], answer: 1, explain: "'Mehmonxona' means 'living room'." },
  { id: 1411, q: "Choose the correct word: They ___ not at home now.", options: ["is","are","was","be"], answer: 1, explain: "Present plural → are not." },
  { id: 1412, q: "Translate into English: 'hammom' ", options: ["bathroom","living room","bedroom","roof"], answer: 0, explain: "'Hammom' means 'bathroom'." },
  { id: 1413, q: "Choose the correct sentence.", options: ["There is three cats.","There are three cats.","There am three cats.","There was three cats."], answer: 1, explain: "Correct plural form → There are three cats." },
  { id: 1414, q: "Translate into English: 'bog‘' ", options: ["field","forest","garden","yard"], answer: 2, explain: "'Bog‘' means 'garden'." },
  { id: 1415, q: "Choose the correct form: He ___ his homework yesterday.", options: ["do","does","did","doing"], answer: 2, explain: "Past simple → did." },
  { id: 1416, q: "Translate into English: 'daraxtzor' ", options: ["garden","forest","tree","yard"], answer: 1, explain: "'Daraxtzor' means 'forest'." },
  { id: 1417, q: "Choose the correct sentence.", options: ["I am study now.","I studying now.","I am studying now.","I study now."], answer: 2, explain: "Present continuous → I am studying now." },
  { id: 1418, q: "Translate into English: 'dalа' ", options: ["garden","forest","field","yard"], answer: 2, explain: "'Dala' means 'field'." },
  { id: 1419, q: "Choose the correct word: He ___ his car every Sunday.", options: ["wash","washes","washing","washed"], answer: 1, explain: "Third person singular → washes." },
  { id: 1420, q: "Translate into English: 'o‘rmon' ", options: ["forest","garden","field","yard"], answer: 0, explain: "'O‘rmon' means 'forest'." },
  { id: 1421, q: "Choose the correct form: They ___ very happy yesterday.", options: ["is","are","was","were"], answer: 3, explain: "Past plural → were." },
  { id: 1422, q: "Translate into English: 'ko‘cha' ", options: ["street","road","square","yard"], answer: 0, explain: "'Ko‘cha' means 'street'." },
  { id: 1423, q: "Choose the correct sentence.", options: ["She don’t read books.","She doesn’t read books.","She not read books.","She is not read books."], answer: 1, explain: "Correct negative → She doesn’t read books." },
  { id: 1424, q: "Translate into English: 'yo‘l' ", options: ["street","road","bridge","yard"], answer: 1, explain: "'Yo‘l' means 'road'." },
  { id: 1425, q: "Choose the correct form: We ___ to the park every day.", options: ["go","goes","going","gone"], answer: 0, explain: "Plural subject → go." },
  { id: 1426, q: "Translate into English: 'ko‘prik' ", options: ["bridge","road","river","street"], answer: 0, explain: "'Ko‘prik' means 'bridge'." },
  { id: 1427, q: "Choose the correct word: He ___ born in 1990.", options: ["is","was","were","be"], answer: 1, explain: "Past simple → was born." },
  { id: 1428, q: "Translate into English: 'daryo' ", options: ["lake","river","sea","pond"], answer: 1, explain: "'Daryo' means 'river'." },
  { id: 1429, q: "Choose the correct sentence.", options: ["We was at home.","We were at home.","We are at home yesterday.","We at home yesterday."], answer: 1, explain: "Past simple plural → We were at home." },
  { id: 1430, q: "Translate into English: 'ko‘l' ", options: ["sea","lake","pond","river"], answer: 1, explain: "'Ko‘l' means 'lake'." },
  { id: 1431, q: "Choose the correct form: She ___ cooking now.", options: ["is","are","am","was"], answer: 0, explain: "Present continuous → is cooking." },
  { id: 1432, q: "Translate into English: 'dengiz' ", options: ["sea","lake","ocean","river"], answer: 0, explain: "'Dengiz' means 'sea'." },
  { id: 1433, q: "Choose the correct word: I ___ a new book yesterday.", options: ["buy","buys","bought","buying"], answer: 2, explain: "Past simple → bought." },
  { id: 1434, q: "Translate into English: 'okean' ", options: ["lake","sea","ocean","river"], answer: 2, explain: "'Okean' means 'ocean'." },
  { id: 1435, q: "Choose the correct sentence.", options: ["Does they play football?","Do they play football?","They does play football?","They play footballs?"], answer: 1, explain: "Correct question → Do they play football?" },
  { id: 1436, q: "Translate into English: 'orol' ", options: ["island","peninsula","lake","sea"], answer: 0, explain: "'Orol' means 'island'." },
  { id: 1437, q: "Choose the correct form: She ___ a letter now.", options: ["write","writes","is writing","wrote"], answer: 2, explain: "Present continuous → is writing." },
  { id: 1438, q: "Translate into English: 'yarim orol' ", options: ["island","peninsula","continent","village"], answer: 1, explain: "'Yarim orol' means 'peninsula'." },
  { id: 1439, q: "Choose the correct word: We ___ not busy today.", options: ["is","are","was","be"], answer: 1, explain: "Present plural → are not." },
  { id: 1440, q: "Translate into English: 'qit’a' ", options: ["continent","island","peninsula","country"], answer: 0, explain: "'Qit’a' means 'continent'." },
  { id: 1441, q: "Choose the correct sentence.", options: ["He don’t like coffee.","He doesn’t like coffee.","He not like coffee.","He isn’t like coffee."], answer: 1, explain: "Correct negative → He doesn’t like coffee." },
  { id: 1442, q: "Translate into English: 'davlat' ", options: ["state","country","region","city"], answer: 1, explain: "'Davlat' means 'country'." },
  { id: 1443, q: "Choose the correct form: They ___ a big house.", options: ["has","have","having","had"], answer: 1, explain: "Plural subject → have." },
  { id: 1444, q: "Translate into English: 'shahar' ", options: ["town","village","city","region"], answer: 2, explain: "'Shahar' means 'city'." },
  { id: 1445, q: "Choose the correct sentence.", options: ["She go to school every day.","She goes to school every day.","She going to school every day.","She is goes to school."], answer: 1, explain: "Third person singular → goes." },
  { id: 1446, q: "Translate into English: 'qishloq' ", options: ["village","city","town","country"], answer: 0, explain: "'Qishloq' means 'village'." },
  { id: 1447, q: "Choose the correct word: I ___ hungry now.", options: ["is","are","am","be"], answer: 2, explain: "First person singular → am." },
  { id: 1448, q: "Translate into English: 'mahalla' ", options: ["district","neighbourhood","region","area"], answer: 1, explain: "'Mahalla' means 'neighbourhood'." },
  { id: 1449, q: "Choose the correct form: They ___ tennis every weekend.", options: ["play","plays","playing","played"], answer: 0, explain: "Plural subject → play." },
  { id: 1450, q: "Translate into English: 'ko‘prik' ", options: ["bridge","road","street","river"], answer: 0, explain: "'Ko‘prik' means 'bridge'." },
  { id: 1451, q: "Choose the correct sentence.", options: ["We goes to the park.","We go to the park.","We going to the park.","We is go to the park."], answer: 1, explain: "Correct plural form → We go." },
  { id: 1452, q: "Translate into English: 'yo‘l' ", options: ["street","road","bridge","track"], answer: 1, explain: "'Yo‘l' means 'road'." },
  { id: 1453, q: "Choose the correct word: He ___ not at school yesterday.", options: ["is","are","was","were"], answer: 2, explain: "Past singular → was not." },
  { id: 1454, q: "Translate into English: 'ko‘cha' ", options: ["street","road","yard","park"], answer: 0, explain: "'Ko‘cha' means 'street'." },
  { id: 1455, q: "Choose the correct form: We ___ in Tashkent now.", options: ["is","are","was","were"], answer: 1, explain: "Present plural → are." },
  { id: 1456, q: "Translate into English: 'daryo' ", options: ["sea","river","lake","ocean"], answer: 1, explain: "'Daryo' means 'river'." },
  { id: 1457, q: "Choose the correct sentence.", options: ["He can sings well.","He cans sing well.","He can sing well.","He can to sing well."], answer: 2, explain: "Correct form → He can sing well." },
  { id: 1458, q: "Translate into English: 'dengiz' ", options: ["lake","river","sea","pond"], answer: 2, explain: "'Dengiz' means 'sea'." },
  { id: 1459, q: "Choose the correct word: They ___ breakfast every morning.", options: ["have","has","having","had"], answer: 0, explain: "Plural subject → have." },
  { id: 1460, q: "Translate into English: 'ko‘l' ", options: ["lake","river","sea","ocean"], answer: 0, explain: "'Ko‘l' means 'lake'." },
  { id: 1461, q: "Choose the correct form: She ___ in the park yesterday.", options: ["is","are","was","were"], answer: 2, explain: "Past singular → was." },
  { id: 1462, q: "Translate into English: 'okean' ", options: ["ocean","sea","lake","river"], answer: 0, explain: "'Okean' means 'ocean'." },
  { id: 1463, q: "Choose the correct sentence.", options: ["They doesn’t work.","They don’t work.","They not work.","They isn’t work."], answer: 1, explain: "Correct negative plural → They don’t work." },
  { id: 1464, q: "Translate into English: 'orol' ", options: ["island","peninsula","continent","village"], answer: 0, explain: "'Orol' means 'island'." },
  { id: 1465, q: "Choose the correct word: We ___ English now.", options: ["learn","learning","are learning","learns"], answer: 2, explain: "Present continuous → are learning." },
  { id: 1466, q: "Translate into English: 'yarim orol' ", options: ["island","peninsula","continent","region"], answer: 1, explain: "'Yarim orol' means 'peninsula'." },
  { id: 1467, q: "Choose the correct form: He ___ a doctor.", options: ["is","are","was","were"], answer: 0, explain: "Present singular → is." },
  { id: 1468, q: "Translate into English: 'qit’a' ", options: ["island","continent","peninsula","country"], answer: 1, explain: "'Qit’a' means 'continent'." },
  { id: 1469, q: "Choose the correct sentence.", options: ["I am study.","I study.","I studying.","I studies."], answer: 1, explain: "Correct present simple → I study." },
  { id: 1470, q: "Translate into English: 'davlat' ", options: ["state","country","city","region"], answer: 1, explain: "'Davlat' means 'country'." },
  { id: 1471, q: "Choose the correct word: He ___ in Samarkand two years ago.", options: ["live","lives","lived","living"], answer: 2, explain: "Past simple → lived." },
  { id: 1472, q: "Translate into English: 'shahar' ", options: ["city","village","town","region"], answer: 0, explain: "'Shahar' means 'city'." },
  { id: 1473, q: "Choose the correct form: We ___ to the park yesterday.", options: ["go","goes","went","going"], answer: 2, explain: "Past simple → went." },
  { id: 1474, q: "Translate into English: 'qishloq' ", options: ["town","village","city","country"], answer: 1, explain: "'Qishloq' means 'village'." },
  { id: 1475, q: "Choose the correct sentence.", options: ["She goes to school every day.","She go to school every day.","She going to school.","She is goes to school."], answer: 0, explain: "Correct singular form → goes." },
  { id: 1476, q: "Translate into English: 'mahalla' ", options: ["district","neighbourhood","region","area"], answer: 1, explain: "'Mahalla' means 'neighbourhood'." },
  { id: 1477, q: "Choose the correct word: I ___ very tired yesterday.", options: ["is","are","was","were"], answer: 2, explain: "Past singular → was." },
  { id: 1478, q: "Translate into English: 'ko‘prik' ", options: ["bridge","road","river","street"], answer: 0, explain: "'Ko‘prik' means 'bridge'." },
  { id: 1479, q: "Choose the correct form: They ___ at home now.", options: ["is","are","was","were"], answer: 1, explain: "Present plural → are." },
  { id: 1480, q: "Translate into English: 'yo‘l' ", options: ["road","street","bridge","track"], answer: 0, explain: "'Yo‘l' means 'road'." },
  { id: 1481, q: "Choose the correct sentence.", options: ["He don’t like tea.","He doesn’t like tea.","He not like tea.","He isn’t like tea."], answer: 1, explain: "Correct negative → He doesn’t like tea." },
  { id: 1482, q: "Translate into English: 'ko‘cha' ", options: ["street","road","yard","village"], answer: 0, explain: "'Ko‘cha' means 'street'." },
  { id: 1483, q: "Choose the correct word: She ___ shopping every weekend.", options: ["go","goes","going","gone"], answer: 1, explain: "Third person singular → goes." },
  { id: 1484, q: "Translate into English: 'daryo' ", options: ["river","sea","lake","pond"], answer: 0, explain: "'Daryo' means 'river'." },
  { id: 1485, q: "Choose the correct form: They ___ very happy yesterday.", options: ["is","are","was","were"], answer: 3, explain: "Past plural → were." },
  { id: 1486, q: "Translate into English: 'dengiz' ", options: ["sea","lake","river","ocean"], answer: 0, explain: "'Dengiz' means 'sea'." },
  { id: 1487, q: "Choose the correct sentence.", options: ["Does he likes football?","Do he like football?","Does he like football?","He does likes football."], answer: 2, explain: "Correct form → Does he like football?" },
  { id: 1488, q: "Translate into English: 'ko‘l' ", options: ["lake","sea","river","pond"], answer: 0, explain: "'Ko‘l' means 'lake'." },
  { id: 1489, q: "Choose the correct word: He ___ swimming now.", options: ["is","are","am","be"], answer: 0, explain: "Present continuous → is swimming." },
  { id: 1490, q: "Translate into English: 'okean' ", options: ["sea","lake","ocean","river"], answer: 2, explain: "'Okean' means 'ocean'." },
  { id: 1491, q: "Choose the correct form: We ___ at the cinema last week.", options: ["is","are","was","were"], answer: 3, explain: "Past plural → were." },
  { id: 1492, q: "Translate into English: 'orol' ", options: ["island","peninsula","continent","region"], answer: 0, explain: "'Orol' means 'island'." },
  { id: 1493, q: "Choose the correct sentence.", options: ["She can sings.","She cans sing.","She can sing.","She can to sings."], answer: 2, explain: "Correct modal form → She can sing." },
  { id: 1494, q: "Translate into English: 'yarim orol' ", options: ["island","peninsula","continent","country"], answer: 1, explain: "'Yarim orol' means 'peninsula'." },
  { id: 1495, q: "Choose the correct word: He ___ very clever.", options: ["is","are","was","were"], answer: 0, explain: "Present singular → is." },
  { id: 1496, q: "Translate into English: 'qit’a' ", options: ["continent","island","peninsula","region"], answer: 0, explain: "'Qit’a' means 'continent'." },
  { id: 1497, q: "Choose the correct form: They ___ not at home now.", options: ["is","are","was","were"], answer: 1, explain: "Present plural → are not." },
  { id: 1498, q: "Translate into English: 'davlat' ", options: ["state","country","region","city"], answer: 1, explain: "'Davlat' means 'country'." },
  { id: 1499, q: "Choose the correct sentence.", options: ["We was at school yesterday.","We were at school yesterday.","We are at school yesterday.","We at school yesterday."], answer: 1, explain: "Correct past plural → We were." },
  { id: 1500, q: "Translate into English: 'shahar' ", options: ["village","city","town","district"], answer: 1, explain: "'Shahar' means 'city'." },
  { id: 1501, q: "Choose the correct form: He ___ to the market yesterday.", options: ["go","goes","went","going"], answer: 2, explain: "Past simple → went." },
  { id: 1502, q: "Translate into English: 'qishloq' ", options: ["village","city","country","town"], answer: 0, explain: "'Qishloq' means 'village'." },
  { id: 1503, q: "Choose the correct word: I ___ a new book now.", options: ["read","am reading","reads","reading"], answer: 1, explain: "Present continuous → am reading." },
  { id: 1504, q: "Translate into English: 'mahalla' ", options: ["district","neighbourhood","region","area"], answer: 1, explain: "'Mahalla' means 'neighbourhood'." },
  { id: 1505, q: "Choose the correct form: We ___ very busy yesterday.", options: ["is","are","was","were"], answer: 3, explain: "Past plural → were." },
  { id: 1506, q: "Translate into English: 'ko‘prik' ", options: ["road","bridge","river","street"], answer: 1, explain: "'Ko‘prik' means 'bridge'." },
  { id: 1507, q: "Choose the correct sentence.", options: ["He go to work every day.","He goes to work every day.","He going to work every day.","He is goes to work."], answer: 1, explain: "Correct singular → goes." },
  { id: 1508, q: "Translate into English: 'yo‘l' ", options: ["street","road","path","track"], answer: 1, explain: "'Yo‘l' means 'road'." },
  { id: 1509, q: "Choose the correct word: They ___ not in Tashkent last year.", options: ["is","are","was","were"], answer: 3, explain: "Past plural → were not." },
  { id: 1510, q: "Translate into English: 'ko‘cha' ", options: ["street","road","yard","region"], answer: 0, explain: "'Ko‘cha' means 'street'." },
  { id: 1511, q: "Choose the correct form: She ___ very beautiful.", options: ["is","are","was","were"], answer: 0, explain: "Present singular → is." },
  { id: 1512, q: "Translate into English: 'daryo' ", options: ["river","lake","sea","pond"], answer: 0, explain: "'Daryo' means 'river'." },
  { id: 1513, q: "Choose the correct sentence.", options: ["They goes to school every day.","They go to school every day.","They is go to school every day.","They are go to school."], answer: 1, explain: "Correct plural form → go." },
  { id: 1514, q: "Translate into English: 'dengiz' ", options: ["lake","sea","river","ocean"], answer: 1, explain: "'Dengiz' means 'sea'." },
  { id: 1515, q: "Choose the correct word: He ___ not at home now.", options: ["is","are","was","were"], answer: 0, explain: "Present singular → is not." },
  { id: 1516, q: "Translate into English: 'ko‘l' ", options: ["lake","sea","river","ocean"], answer: 0, explain: "'Ko‘l' means 'lake'." },
  { id: 1517, q: "Choose the correct form: They ___ in Bukhara last summer.", options: ["is","are","was","were"], answer: 3, explain: "Past plural → were." },
  { id: 1518, q: "Translate into English: 'okean' ", options: ["sea","lake","river","ocean"], answer: 3, explain: "'Okean' means 'ocean'." },
  { id: 1519, q: "Choose the correct sentence.", options: ["She can plays piano.","She can play piano.","She cans play piano.","She can to play piano."], answer: 1, explain: "Correct modal → She can play piano." },
  { id: 1520, q: "Translate into English: 'orol' ", options: ["island","peninsula","continent","country"], answer: 0, explain: "'Orol' means 'island'." },
  { id: 1521, q: "Choose the correct option: They ___ very happy yesterday.", options: ["was","were","are","is"], answer: 1, explain: "Past tense plural → They were." },
  { id: 1522, q: "Translate into English: 'yoz' (fasl)", options: ["winter","autumn","summer","spring"], answer: 2, explain: "'Yoz' (fasl) means 'summer'." },
  { id: 1523, q: "Choose the correct sentence.", options: ["She don’t like tea.","She doesn’t like tea.","She not like tea.","She isn’t like tea."], answer: 1, explain: "Correct → She doesn’t like tea." },
  { id: 1524, q: "Translate into English: 'havo'", options: ["sky","air","cloud","wind"], answer: 1, explain: "'Havo' means 'air'." },
  { id: 1525, q: "Choose the correct option: My parents ___ at home now.", options: ["is","are","was","be"], answer: 1, explain: "Plural present → are." },
  { id: 1526, q: "Translate into English: 'do‘st'", options: ["enemy","friend","teacher","brother"], answer: 1, explain: "'Do‘st' means 'friend'." },
  { id: 1527, q: "Choose the correct form: She ___ playing piano at the moment.", options: ["is","are","am","be"], answer: 0, explain: "Present continuous singular → is." },
  { id: 1528, q: "Translate into English: 'bilim'", options: ["science","skill","knowledge","idea"], answer: 2, explain: "'Bilim' means 'knowledge'." },
  { id: 1529, q: "Choose the correct sentence.", options: ["He going to school now.","He goes to school now.","He is going to school now.","He go to school now."], answer: 2, explain: "Correct continuous → He is going to school now." },
  { id: 1530, q: "Translate into English: 'kitob'", options: ["book","pen","notebook","page"], answer: 0, explain: "'Kitob' means 'book'." },
  { id: 1531, q: "Choose the correct option: We ___ football every weekend.", options: ["play","plays","played","playing"], answer: 0, explain: "Present simple plural → We play." },
  { id: 1532, q: "Translate into English: 'o‘qituvchi'", options: ["teacher","student","doctor","worker"], answer: 0, explain: "'O‘qituvchi' means 'teacher'." },
  { id: 1533, q: "Choose the correct form: She ___ at the library yesterday.", options: ["is","are","was","were"], answer: 2, explain: "Past tense singular → She was." },
  { id: 1534, q: "Translate into English: 'talaba'", options: ["pupil","teacher","student","class"], answer: 2, explain: "'Talaba' means 'student'." },
  { id: 1535, q: "Choose the correct sentence.", options: ["They doesn’t work.","They don’t works.","They don’t work.","They not work."], answer: 2, explain: "Correct form → They don’t work." },
  { id: 1536, q: "Translate into English: 'hayot'", options: ["life","living","alive","soul"], answer: 0, explain: "'Hayot' means 'life'." },
  { id: 1537, q: "Choose the correct option: He ___ an engineer.", options: ["am","is","are","be"], answer: 1, explain: "Singular present → He is." },
  { id: 1538, q: "Translate into English: 'ota'", options: ["father","mother","brother","uncle"], answer: 0, explain: "'Ota' means 'father'." },
  { id: 1539, q: "Choose the correct form: They ___ busy last week.", options: ["was","were","are","is"], answer: 1, explain: "Plural past → They were." },
  { id: 1540, q: "Translate into English: 'ona'", options: ["sister","aunt","mother","girl"], answer: 2, explain: "'Ona' means 'mother'." },
  { id: 1541, q: "Choose the correct sentence.", options: ["I doesn’t know.","I don’t know.","I not know.","I isn’t know."], answer: 1, explain: "Correct → I don’t know." },
  { id: 1542, q: "Translate into English: 'aka'", options: ["uncle","brother","sister","friend"], answer: 1, explain: "'Aka' means 'brother'." },
  { id: 1543, q: "Choose the correct option: We ___ at the cinema last night.", options: ["is","was","were","are"], answer: 2, explain: "Past plural → We were." },
  { id: 1544, q: "Translate into English: 'singil'", options: ["younger sister","older sister","cousin","aunt"], answer: 0, explain: "'Singil' means 'younger sister'." },
  { id: 1545, q: "Choose the correct form: I ___ English every day.", options: ["study","studies","studied","studying"], answer: 0, explain: "Present simple → I study." },
  { id: 1546, q: "Translate into English: 'uy'", options: ["flat","house","room","building"], answer: 1, explain: "'Uy' means 'house'." },
  { id: 1547, q: "Choose the correct option: She ___ at school tomorrow.", options: ["is","was","will be","were"], answer: 2, explain: "Future tense → will be." },
  { id: 1548, q: "Translate into English: 'maktab'", options: ["class","school","college","academy"], answer: 1, explain: "'Maktab' means 'school'." },
  { id: 1549, q: "Choose the correct sentence.", options: ["They is my friends.","They are my friends.","They am my friends.","They be my friends."], answer: 1, explain: "Correct → They are my friends." },
  { id: 1550, q: "Translate into English: 'oila'", options: ["family","team","group","people"], answer: 0, explain: "'Oila' means 'family'." },
  { id: 1551, q: "Choose the correct form: He ___ breakfast at 8 o’clock every day.", options: ["have","has","having","had"], answer: 1, explain: "Present simple singular → He has." },
  { id: 1552, q: "Translate into English: 'ovqat'", options: ["food","meal","bread","rice"], answer: 0, explain: "'Ovqat' means 'food'." },
  { id: 1553, q: "Choose the correct option: I ___ to the park yesterday.", options: ["go","going","went","goes"], answer: 2, explain: "Past simple → I went." },
  { id: 1554, q: "Translate into English: 'non'", options: ["rice","meat","bread","cake"], answer: 2, explain: "'Non' means 'bread'." },
  { id: 1555, q: "Choose the correct sentence.", options: ["We was late.","We were late.","We is late.","We are late yesterday."], answer: 1, explain: "Correct past plural → We were late." },
  { id: 1556, q: "Translate into English: 'meva'", options: ["vegetable","fruit","apple","meal"], answer: 1, explain: "'Meva' means 'fruit'." },
  { id: 1557, q: "Choose the correct option: They ___ watching TV now.", options: ["is","are","were","be"], answer: 1, explain: "Present continuous plural → are." },
  { id: 1558, q: "Translate into English: 'sabzavot'", options: ["fruit","meat","vegetable","leaf"], answer: 2, explain: "'Sabzavot' means 'vegetable'." },
  { id: 1559, q: "Choose the correct form: She ___ very tired last night.", options: ["is","was","are","were"], answer: 1, explain: "Past simple singular → was." },
  { id: 1560, q: "Translate into English: 'suv'", options: ["water","milk","juice","tea"], answer: 0, explain: "'Suv' means 'water'." },
  { id: 1561, q: "Choose the correct sentence.", options: ["He live in London.","He lives in London.","He living in London.","He liveds in London."], answer: 1, explain: "Correct → He lives in London." },
  { id: 1562, q: "Translate into English: 'sut'", options: ["milk","water","tea","juice"], answer: 0, explain: "'Sut' means 'milk'." },
  { id: 1563, q: "Choose the correct option: We ___ to music every evening.", options: ["listens","listen","listened","listening"], answer: 1, explain: "Present simple plural → We listen." },
  { id: 1564, q: "Translate into English: 'choy'", options: ["coffee","tea","juice","milk"], answer: 1, explain: "'Choy' means 'tea'." },
  { id: 1565, q: "Choose the correct form: I ___ reading a book now.", options: ["am","is","are","be"], answer: 0, explain: "Present continuous → I am." },
  { id: 1566, q: "Translate into English: 'qahva'", options: ["tea","juice","coffee","water"], answer: 2, explain: "'Qahva' means 'coffee'." },
  { id: 1567, q: "Choose the correct option: They ___ at home tomorrow.", options: ["was","were","are","will be"], answer: 3, explain: "Future simple → will be." },
  { id: 1568, q: "Translate into English: 'shokolad'", options: ["sweet","chocolate","cake","sugar"], answer: 1, explain: "'Shokolad' means 'chocolate'." },
  { id: 1569, q: "Choose the correct sentence.", options: ["I goes to school every day.","I go to school every day.","I going to school every day.","I goed to school every day."], answer: 1, explain: "Correct → I go to school every day." },
  { id: 1570, q: "Translate into English: 'shakar'", options: ["salt","sugar","spice","sweet"], answer: 1, explain: "'Shakar' means 'sugar'." },
  { id: 1571, q: "Choose the correct form: She ___ her homework yesterday.", options: ["do","did","does","doing"], answer: 1, explain: "Past simple → did." },
  { id: 1572, q: "Translate into English: 'tuz'", options: ["sugar","salt","spice","pepper"], answer: 1, explain: "'Tuz' means 'salt'." },
  { id: 1573, q: "Choose the correct option: We ___ to the zoo last weekend.", options: ["go","went","goes","gone"], answer: 1, explain: "Past simple → went." },
  { id: 1574, q: "Translate into English: 'qor'", options: ["rain","snow","ice","storm"], answer: 1, explain: "'Qor' means 'snow'." },
  { id: 1575, q: "Choose the correct sentence.", options: ["He play football every day.","He plays football every day.","He playing football every day.","He played footballs every day."], answer: 1, explain: "Correct → He plays football every day." },
  { id: 1576, q: "Translate into English: 'yomg‘ir'", options: ["storm","snow","rain","wind"], answer: 2, explain: "'Yomg‘ir' means 'rain'." },
  { id: 1577, q: "Choose the correct form: They ___ English very well.", options: ["speaks","speak","speaking","spoken"], answer: 1, explain: "Plural present → speak." },
  { id: 1578, q: "Translate into English: 'shamol'", options: ["storm","air","wind","cloud"], answer: 2, explain: "'Shamol' means 'wind'." },
  { id: 1579, q: "Choose the correct option: She ___ tired now.", options: ["is","was","were","are"], answer: 0, explain: "Present simple singular → is." },
  { id: 1580, q: "Translate into English: 'bulut'", options: ["sky","wind","cloud","air"], answer: 2, explain: "'Bulut' means 'cloud'." },
  { id: 1581, q: "Choose the correct sentence.", options: ["They lives in Paris.","They living in Paris.","They live in Paris.","They liveds in Paris."], answer: 2, explain: "Correct → They live in Paris." },
  { id: 1582, q: "Translate into English: 'osmon'", options: ["air","sky","heaven","space"], answer: 1, explain: "'Osmon' means 'sky'." },
  { id: 1583, q: "Choose the correct option: He ___ at work yesterday.", options: ["was","were","is","are"], answer: 0, explain: "Past singular → was." },
  { id: 1584, q: "Translate into English: 'yulduz'", options: ["sun","moon","star","sky"], answer: 2, explain: "'Yulduz' means 'star'." },
  { id: 1585, q: "Choose the correct form: We ___ a new car last year.", options: ["buy","buys","bought","buying"], answer: 2, explain: "Past simple → bought." },
  { id: 1586, q: "Translate into English: 'quyosh'", options: ["sun","moon","star","planet"], answer: 0, explain: "'Quyosh' means 'sun'." },
  { id: 1587, q: "Choose the correct option: She ___ TV every evening.", options: ["watch","watches","watched","watching"], answer: 1, explain: "Present simple singular → watches." },
  { id: 1588, q: "Translate into English: 'oy' (osmondagi)", options: ["sun","moon","star","planet"], answer: 1, explain: "'Oy' (osmondagi) means 'moon'." },
  { id: 1589, q: "Choose the correct sentence.", options: ["We goes to work by bus.","We go to work by bus.","We going to work by bus.","We goed to work by bus."], answer: 1, explain: "Correct → We go to work by bus." },
  { id: 1590, q: "Translate into English: 'sayyora'", options: ["planet","star","moon","galaxy"], answer: 0, explain: "'Sayyora' means 'planet'." },
  { id: 1591, q: "Choose the correct form: I ___ my homework every evening.", options: ["does","do","did","done"], answer: 1, explain: "Present simple → I do." },
  { id: 1592, q: "Translate into English: 'galaktika'", options: ["star","galaxy","space","planet"], answer: 1, explain: "'Galaktika' means 'galaxy'." },
  { id: 1593, q: "Choose the correct option: They ___ at the park now.", options: ["was","is","are","were"], answer: 2, explain: "Present plural → are." },
  { id: 1594, q: "Translate into English: 'kosmos'", options: ["galaxy","space","planet","sky"], answer: 1, explain: "'Kosmos' means 'space'." },
  { id: 1595, q: "Choose the correct form: He ___ very busy every morning.", options: ["am","is","are","be"], answer: 1, explain: "Present simple singular → is." },
  { id: 1596, q: "Translate into English: 'yashin'", options: ["lightning","storm","flash","fire"], answer: 0, explain: "'Yashin' means 'lightning'." },
  { id: 1597, q: "Choose the correct option: They ___ in Tashkent last year.", options: ["live","lives","lived","living"], answer: 2, explain: "Past simple → lived." },
  { id: 1598, q: "Translate into English: 'chaqmoq'", options: ["thunder","flash","lightning","storm"], answer: 2, explain: "'Chaqmoq' means 'lightning'." },
  { id: 1599, q: "Choose the correct sentence.", options: ["He don’t play piano.","He doesn’t play piano.","He isn’t play piano.","He not play piano."], answer: 1, explain: "Correct → He doesn’t play piano." },
  { id: 1600, q: "Translate into English: 'momaqaldiroq'", options: ["lightning","thunder","storm","flash"], answer: 1, explain: "'Momaqaldiroq' means 'thunder'." },
  { id: 1601, q: "Choose the correct option: I ___ my homework yesterday.", options: ["do","did","does","doing"], answer: 1, explain: "Past simple → I did." },
  { id: 1602, q: "Translate into English: 'daraxt'", options: ["flower","tree","bush","leaf"], answer: 1, explain: "'Daraxt' means 'tree'." },
  { id: 1603, q: "Choose the correct form: They ___ football every Sunday.", options: ["play","plays","played","playing"], answer: 0, explain: "Present simple plural → play." },
  { id: 1604, q: "Translate into English: 'gul'", options: ["flower","leaf","grass","tree"], answer: 0, explain: "'Gul' means 'flower'." },
  { id: 1605, q: "Choose the correct sentence.", options: ["She go to school every day.","She goes to school every day.","She going to school every day.","She goed to school every day."], answer: 1, explain: "Correct → She goes to school every day." },
  { id: 1606, q: "Translate into English: 'barg'", options: ["tree","flower","leaf","grass"], answer: 2, explain: "'Barg' means 'leaf'." },
  { id: 1607, q: "Choose the correct option: We ___ in Samarkand last year.", options: ["live","lived","living","lives"], answer: 1, explain: "Past simple → lived." },
  { id: 1608, q: "Translate into English: 'o‘t' (o‘simlik)", options: ["wood","leaf","tree","grass"], answer: 3, explain: "'O‘t' (o‘simlik) means 'grass'." },
  { id: 1609, q: "Choose the correct form: He ___ reading a book now.", options: ["is","are","am","be"], answer: 0, explain: "Present continuous singular → is." },
  { id: 1610, q: "Translate into English: 'mehnat'", options: ["rest","work","holiday","job"], answer: 1, explain: "'Mehnat' means 'work'." },
  { id: 1611, q: "Choose the correct option: She ___ very kind.", options: ["is","are","was","were"], answer: 0, explain: "Present simple singular → is." },
  { id: 1612, q: "Translate into English: 'ta’til'", options: ["holiday","lesson","work","study"], answer: 0, explain: "'Ta’til' means 'holiday'." },
  { id: 1613, q: "Choose the correct sentence.", options: ["We doesn’t study.","We don’t study.","We not study.","We studying not."], answer: 1, explain: "Correct → We don’t study." },
  { id: 1614, q: "Translate into English: 'dars'", options: ["work","lesson","class","education"], answer: 1, explain: "'Dars' means 'lesson'." },
  { id: 1615, q: "Choose the correct option: He ___ in the garden yesterday.", options: ["is","are","was","were"], answer: 2, explain: "Past simple singular → was." },
  { id: 1616, q: "Translate into English: 'bog‘'", options: ["garden","park","yard","forest"], answer: 0, explain: "'Bog‘' means 'garden'." },
  { id: 1617, q: "Choose the correct form: We ___ to the cinema tomorrow.", options: ["go","going","will go","went"], answer: 2, explain: "Future simple → will go." },
  { id: 1618, q: "Translate into English: 'o‘rmon'", options: ["jungle","wood","forest","garden"], answer: 2, explain: "'O‘rmon' means 'forest'." },
  { id: 1619, q: "Choose the correct sentence.", options: ["She have two sisters.","She has two sisters.","She haves two sisters.","She having two sisters."], answer: 1, explain: "Correct → She has two sisters." },
  { id: 1620, q: "Translate into English: 'cho‘l'", options: ["valley","desert","hill","mountain"], answer: 1, explain: "'Cho‘l' means 'desert'." },
  { id: 1621, q: "Choose the correct option: They ___ dinner now.", options: ["has","having","have","are have"], answer: 2, explain: "Present simple plural → have." },
  { id: 1622, q: "Translate into English: 'tog‘'", options: ["mountain","hill","rock","valley"], answer: 0, explain: "'Tog‘' means 'mountain'." },
  { id: 1623, q: "Choose the correct form: I ___ at the library yesterday.", options: ["was","were","is","are"], answer: 0, explain: "Past simple singular → was." },
  { id: 1624, q: "Translate into English: 'vodiy'", options: ["mountain","hill","valley","river"], answer: 2, explain: "'Vodiy' means 'valley'." },
  { id: 1625, q: "Choose the correct sentence.", options: ["They was busy.","They were busy.","They is busy.","They are busy yesterday."], answer: 1, explain: "Correct → They were busy." },
  { id: 1626, q: "Translate into English: 'daryo'", options: ["lake","sea","river","canal"], answer: 2, explain: "'Daryo' means 'river'." },
  { id: 1627, q: "Choose the correct option: He ___ a letter last night.", options: ["write","writes","wrote","written"], answer: 2, explain: "Past simple → wrote." },
  { id: 1628, q: "Translate into English: 'kanal'", options: ["river","sea","canal","stream"], answer: 2, explain: "'Kanal' means 'canal'." },
  { id: 1629, q: "Choose the correct form: We ___ in Tashkent now.", options: ["was","were","are","is"], answer: 2, explain: "Present plural → are." },
  { id: 1630, q: "Translate into English: 'ko‘lmak'", options: ["lake","pond","sea","river"], answer: 1, explain: "'Ko‘lmak' means 'pond'." },
  { id: 1631, q: "Choose the correct sentence.", options: ["He going to work now.","He is going to work now.","He go to work now.","He goes work now."], answer: 1, explain: "Correct → He is going to work now." },
  { id: 1632, q: "Translate into English: 'jarlik'", options: ["hill","valley","cliff","rock"], answer: 2, explain: "'Jarlik' means 'cliff'." },
  { id: 1633, q: "Choose the correct option: She ___ a teacher.", options: ["am","is","are","was"], answer: 1, explain: "Present simple singular → is." },
  { id: 1634, q: "Translate into English: 'qoya'", options: ["rock","stone","cliff","hill"], answer: 0, explain: "'Qoya' means 'rock'." },
  { id: 1635, q: "Choose the correct form: They ___ breakfast yesterday.", options: ["has","had","have","having"], answer: 1, explain: "Past simple → had." },
  { id: 1636, q: "Translate into English: 'tosh'", options: ["stone","rock","pebble","sand"], answer: 0, explain: "'Tosh' means 'stone'." },
  { id: 1637, q: "Choose the correct sentence.", options: ["I doesn’t like milk.","I don’t like milk.","I not like milk.","I isn’t like milk."], answer: 1, explain: "Correct → I don’t like milk." },
  { id: 1638, q: "Translate into English: 'qum'", options: ["dust","sand","soil","earth"], answer: 1, explain: "'Qum' means 'sand'." },
  { id: 1639, q: "Choose the correct option: She ___ to music now.", options: ["is listening","listens","listen","listened"], answer: 0, explain: "Present continuous → is listening." },
  { id: 1640, q: "Translate into English: 'tuproq'", options: ["soil","sand","ground","earth"], answer: 0, explain: "'Tuproq' means 'soil'." },
  { id: 1641, q: "Choose the correct form: We ___ happy last week.", options: ["is","are","was","were"], answer: 3, explain: "Past plural → were." },
  { id: 1642, q: "Translate into English: 'yer'", options: ["earth","ground","land","soil"], answer: 0, explain: "'Yer' means 'earth'." },
  { id: 1643, q: "Choose the correct sentence.", options: ["They doesn’t play football.","They don’t play football.","They not play football.","They aren’t play football."], answer: 1, explain: "Correct → They don’t play football." },
  { id: 1644, q: "Translate into English: 'olov'", options: ["fire","light","heat","flame"], answer: 0, explain: "'Olov' means 'fire'." },
  { id: 1645, q: "Choose the correct option: She ___ her homework yesterday.", options: ["do","does","did","doing"], answer: 2, explain: "Past simple → did." },
  { id: 1646, q: "Translate into English: 'issiq'", options: ["hot","warm","heat","fire"], answer: 0, explain: "'Issiq' means 'hot'." },
  { id: 1647, q: "Choose the correct form: They ___ at home tomorrow.", options: ["was","were","are","will be"], answer: 3, explain: "Future simple → will be." },
  { id: 1648, q: "Translate into English: 'sovuq'", options: ["cold","cool","ice","chill"], answer: 0, explain: "'Sovuq' means 'cold'." },
  { id: 1649, q: "Choose the correct sentence.", options: ["He am a student.","He are a student.","He is a student.","He be a student."], answer: 2, explain: "Correct → He is a student." },
  { id: 1650, q: "Translate into English: 'yoqimli'", options: ["ugly","bad","nice","angry"], answer: 2, explain: "'Yoqimli' means 'nice'." },
  { id: 1651, q: "Choose the correct option: We ___ lunch at school every day.", options: ["have","has","had","having"], answer: 0, explain: "Present simple plural → have." },
  { id: 1652, q: "Translate into English: 'xunuk'", options: ["ugly","bad","dirty","poor"], answer: 0, explain: "'Xunuk' means 'ugly'." },
  { id: 1653, q: "Choose the correct form: I ___ at home yesterday.", options: ["is","are","was","were"], answer: 2, explain: "Past simple singular → was." },
  { id: 1654, q: "Translate into English: 'boy'", options: ["poor","rich","money","wealth"], answer: 1, explain: "'Boy' means 'rich'." },
  { id: 1655, q: "Choose the correct sentence.", options: ["She live in London.","She lives in London.","She living in London.","She liveds in London."], answer: 1, explain: "Correct → She lives in London." },
  { id: 1656, q: "Translate into English: 'kambag‘al'", options: ["rich","poor","weak","bad"], answer: 1, explain: "'Kambag‘al' means 'poor'." },
  { id: 1657, q: "Choose the correct option: They ___ to the park last Sunday.", options: ["go","goes","went","going"], answer: 2, explain: "Past simple → went." },
  { id: 1658, q: "Translate into English: 'kuchli'", options: ["weak","small","strong","hard"], answer: 2, explain: "'Kuchli' means 'strong'." },
  { id: 1659, q: "Choose the correct form: He ___ in the classroom now.", options: ["am","is","are","was"], answer: 1, explain: "Present simple singular → is." },
  { id: 1660, q: "Translate into English: 'zaif'", options: ["weak","slow","lazy","bad"], answer: 0, explain: "'Zaif' means 'weak'." },
  { id: 1661, q: "Choose the correct sentence.", options: ["I goes to school.","I goed to school.","I going to school.","I go to school."], answer: 3, explain: "Correct → I go to school." },
  { id: 1662, q: "Translate into English: 'tez'", options: ["slow","quick","late","early"], answer: 1, explain: "'Tez' means 'quick'." },
  { id: 1663, q: "Choose the correct option: She ___ very busy yesterday.", options: ["is","was","are","were"], answer: 1, explain: "Past simple singular → was." },
  { id: 1664, q: "Translate into English: 'sekin'", options: ["fast","slow","quiet","lazy"], answer: 1, explain: "'Sekin' means 'slow'." },
  { id: 1665, q: "Choose the correct form: We ___ happy now.", options: ["is","are","was","were"], answer: 1, explain: "Present simple plural → are." },
  { id: 1666, q: "Translate into English: 'erta'", options: ["late","early","soon","fast"], answer: 1, explain: "'Erta' means 'early'." },
  { id: 1667, q: "Choose the correct sentence.", options: ["They goes to school.","They goed to school.","They go to school.","They going to school."], answer: 2, explain: "Correct → They go to school." },
  { id: 1668, q: "Translate into English: 'kech'", options: ["early","soon","late","long"], answer: 2, explain: "'Kech' means 'late'." },
  { id: 1669, q: "Choose the correct option: She ___ very clever.", options: ["am","is","are","was"], answer: 1, explain: "Present simple singular → is." },
  { id: 1670, q: "Translate into English: 'aqlli'", options: ["foolish","clever","wise","smart"], answer: 1, explain: "'Aqlli' means 'clever'." },
  { id: 1671, q: "Choose the correct form: They ___ in the garden now.", options: ["is","are","was","were"], answer: 1, explain: "Present simple plural → are." },
  { id: 1672, q: "Translate into English: 'ahmoq'", options: ["foolish","clever","lazy","weak"], answer: 0, explain: "'Ahmoq' means 'foolish'." },
  { id: 1673, q: "Choose the correct sentence.", options: ["She studying now.","She studies now.","She is studying now.","She study now."], answer: 2, explain: "Correct → She is studying now." },
  { id: 1674, q: "Translate into English: 'dangasa'", options: ["hardworking","lazy","slow","weak"], answer: 1, explain: "'Dangasa' means 'lazy'." },
  { id: 1675, q: "Choose the correct option: I ___ tired yesterday.", options: ["is","was","are","were"], answer: 1, explain: "Past simple singular → was." },
  { id: 1676, q: "Translate into English: 'mehnatkash'", options: ["lazy","hardworking","busy","strong"], answer: 1, explain: "'Mehnatkash' means 'hardworking'." },
  { id: 1677, q: "Choose the correct form: We ___ English every day.", options: ["study","studies","studied","studying"], answer: 0, explain: "Present simple plural → study." },
  { id: 1678, q: "Translate into English: 'chiroyli'", options: ["beautiful","ugly","bad","handsome"], answer: 0, explain: "'Chiroyli' means 'beautiful'." },
  { id: 1679, q: "Choose the correct sentence.", options: ["He don’t speak English.","He doesn’t speaks English.","He doesn’t speak English.","He not speak English."], answer: 2, explain: "Correct → He doesn’t speak English." },
  { id: 1680, q: "Translate into English: 'yomon'", options: ["bad","good","ugly","poor"], answer: 0, explain: "'Yomon' means 'bad'." },
  { id: 1681, q: "Choose the correct option: She ___ in London now.", options: ["live","lives","living","lived"], answer: 1, explain: "Present simple singular → lives." },
  { id: 1682, q: "Translate into English: 'yaxshi'", options: ["bad","good","nice","great"], answer: 1, explain: "'Yaxshi' means 'good'." },
  { id: 1683, q: "Choose the correct form: They ___ to school yesterday.", options: ["go","went","going","gone"], answer: 1, explain: "Past simple → went." },
  { id: 1684, q: "Translate into English: 'katta'", options: ["small","large","big","tall"], answer: 2, explain: "'Katta' means 'big'." },
  { id: 1685, q: "Choose the correct sentence.", options: ["I am student.","I am a student.","I a student.","I student."], answer: 1, explain: "Correct → I am a student." },
  { id: 1686, q: "Translate into English: 'kichkina'", options: ["large","small","short","tiny"], answer: 1, explain: "'Kichkina' means 'small'." },
  { id: 1687, q: "Choose the correct option: They ___ football every day.", options: ["play","plays","playing","played"], answer: 0, explain: "Present simple plural → play." },
  { id: 1688, q: "Translate into English: 'uzun'", options: ["short","tall","long","big"], answer: 2, explain: "'Uzun' means 'long'." },
  { id: 1689, q: "Choose the correct form: He ___ TV yesterday evening.", options: ["watch","watched","watches","watching"], answer: 1, explain: "Past simple → watched." },
  { id: 1690, q: "Translate into English: 'qisqa'", options: ["short","small","tiny","little"], answer: 0, explain: "'Qisqa' means 'short'." },
  { id: 1691, q: "Choose the correct sentence.", options: ["We is happy.","We are happy.","We am happy.","We happy."], answer: 1, explain: "Correct → We are happy." },
  { id: 1692, q: "Translate into English: 'baland'", options: ["short","tall","high","big"], answer: 1, explain: "'Baland' means 'tall'." },
  { id: 1693, q: "Choose the correct option: I ___ a letter now.", options: ["write","writes","writing","am writing"], answer: 3, explain: "Present continuous → am writing." },
  { id: 1694, q: "Translate into English: 'past'", options: ["high","low","deep","short"], answer: 1, explain: "'Past' means 'low'." },
  { id: 1695, q: "Choose the correct form: She ___ English well.", options: ["speak","speaks","spoke","speaking"], answer: 1, explain: "Present simple singular → speaks." },
  { id: 1696, q: "Translate into English: 'chuqur'", options: ["deep","low","tall","long"], answer: 0, explain: "'Chuqur' means 'deep'." },
  { id: 1697, q: "Choose the correct sentence.", options: ["They was at home.","They were at home.","They is at home.","They be at home."], answer: 1, explain: "Correct → They were at home." },
  { id: 1698, q: "Translate into English: 'sayoz'", options: ["deep","shallow","low","short"], answer: 1, explain: "'Sayoz' means 'shallow'." },
  { id: 1699, q: "Choose the correct option: He ___ a new car last month.", options: ["buy","buys","bought","buying"], answer: 2, explain: "Past simple → bought." },
  { id: 1700, q: "Translate into English: 'qalin'", options: ["thick","thin","fat","heavy"], answer: 0, explain: "'Qalin' means 'thick'." },
  { id: 1701, q: "Choose the correct form: The sun ___ in the east.", options: ["rise","rises","rose","rising"], answer: 1, explain: "General truth → rises." },
  { id: 1702, q: "Translate into English: 'yupqa'", options: ["thin","narrow","slim","light"], answer: 0, explain: "'Yupqa' means 'thin'." },
  { id: 1703, q: "Choose the correct sentence.", options: ["She are clever.","She is clever.","She clever.","She was clever now."], answer: 1, explain: "Correct → She is clever." },
  { id: 1704, q: "Translate into English: 'og‘ir'", options: ["heavy","hard","strong","big"], answer: 0, explain: "'Og‘ir' means 'heavy'." },
  { id: 1705, q: "Choose the correct option: They ___ in Paris last year.", options: ["live","lives","lived","living"], answer: 2, explain: "Past simple → lived." },
  { id: 1706, q: "Translate into English: 'yengil'", options: ["light","easy","thin","soft"], answer: 0, explain: "'Yengil' means 'light'." },
  { id: 1707, q: "Choose the correct form: She ___ her homework every evening.", options: ["do","does","doing","did"], answer: 1, explain: "Present simple singular → does." },
  { id: 1708, q: "Translate into English: 'qattiq'", options: ["hard","soft","strong","heavy"], answer: 0, explain: "'Qattiq' means 'hard'." },
  { id: 1709, q: "Choose the correct sentence.", options: ["I is a doctor.","I am a doctor.","I a doctor.","I doctor."], answer: 1, explain: "Correct → I am a doctor." },
  { id: 1710, q: "Translate into English: 'yumshoq'", options: ["soft","hard","weak","light"], answer: 0, explain: "'Yumshoq' means 'soft'." },
  { id: 1711, q: "Choose the correct option: We ___ to the zoo tomorrow.", options: ["go","goes","will go","going"], answer: 2, explain: "Future simple → will go." },
  { id: 1712, q: "Translate into English: 'toza'", options: ["clean","dirty","fresh","pure"], answer: 0, explain: "'Toza' means 'clean'." },
  { id: 1713, q: "Choose the correct form: He ___ breakfast now.", options: ["has","have","having","had"], answer: 0, explain: "Present simple singular → has." },
  { id: 1714, q: "Translate into English: 'iflos'", options: ["clean","dirty","bad","ugly"], answer: 1, explain: "'Iflos' means 'dirty'." },
  { id: 1715, q: "Choose the correct sentence.", options: ["They not happy.","They don’t happy.","They are not happy.","They doesn’t happy."], answer: 2, explain: "Correct → They are not happy." },
  { id: 1716, q: "Translate into English: 'yangi'", options: ["old","new","fresh","modern"], answer: 1, explain: "'Yangi' means 'new'." },
  { id: 1717, q: "Choose the correct option: She ___ her bag yesterday.", options: ["lose","loses","lost","losing"], answer: 2, explain: "Past simple → lost." },
  { id: 1718, q: "Translate into English: 'eski'", options: ["old","new","ancient","past"], answer: 0, explain: "'Eski' means 'old'." },
  { id: 1719, q: "Choose the correct form: They ___ English every day.", options: ["study","studies","studied","studying"], answer: 0, explain: "Present simple plural → study." },
  { id: 1720, q: "Translate into English: 'tez-tez'", options: ["always","often","sometimes","never"], answer: 1, explain: "'Tez-tez' means 'often'." },
  { id: 1721, q: "Choose the correct sentence.", options: ["He don’t play football.","He doesn’t plays football.","He doesn’t play football.","He not play football."], answer: 2, explain: "Correct → He doesn’t play football." },
  { id: 1722, q: "Translate into English: 'ba’zan'", options: ["always","often","sometimes","never"], answer: 2, explain: "'Ba’zan' means 'sometimes'." },
  { id: 1723, q: "Choose the correct option: I ___ to music now.", options: ["listen","listens","listening","am listening"], answer: 3, explain: "Present continuous → am listening." },
  { id: 1724, q: "Translate into English: 'hech qachon'", options: ["always","often","sometimes","never"], answer: 3, explain: "'Hech qachon' means 'never'." },
  { id: 1725, q: "Choose the correct form: We ___ in the park yesterday.", options: ["is","are","was","were"], answer: 3, explain: "Past plural → were." },
  { id: 1726, q: "Translate into English: 'doimo'", options: ["always","often","sometimes","never"], answer: 0, explain: "'Doimo' means 'always'." },
  { id: 1727, q: "Choose the correct sentence.", options: ["She go to the cinema.","She goes to the cinema.","She going to the cinema.","She goed to the cinema."], answer: 1, explain: "Correct → She goes to the cinema." },
  { id: 1728, q: "Translate into English: 'har doim'", options: ["never","always","often","sometimes"], answer: 1, explain: "'Har doim' means 'always'." },
  { id: 1729, q: "Choose the correct option: They ___ dinner at 7 pm yesterday.", options: ["have","had","has","having"], answer: 1, explain: "Past simple → had." },
  { id: 1730, q: "Translate into English: 'kecha'", options: ["yesterday","today","tomorrow","tonight"], answer: 0, explain: "'Kecha' means 'yesterday'." },
  { id: 1731, q: "Choose the correct form: We ___ in class now.", options: ["is","are","was","were"], answer: 1, explain: "Present simple plural → are." },
  { id: 1732, q: "Translate into English: 'bugun'", options: ["today","yesterday","tomorrow","now"], answer: 0, explain: "'Bugun' means 'today'." },
  { id: 1733, q: "Choose the correct sentence.", options: ["They am tired.","They is tired.","They are tired.","They tired."], answer: 2, explain: "Correct → They are tired." },
  { id: 1734, q: "Translate into English: 'ertaga'", options: ["tomorrow","yesterday","today","future"], answer: 0, explain: "'Ertaga' means 'tomorrow'." },
  { id: 1735, q: "Choose the correct option: He ___ the guitar very well.", options: ["play","plays","played","playing"], answer: 1, explain: "Present simple singular → plays." },
  { id: 1736, q: "Translate into English: 'tong'", options: ["morning","night","dawn","evening"], answer: 2, explain: "'Tong' means 'dawn'." },
  { id: 1737, q: "Choose the correct form: We ___ to the market last Sunday.", options: ["go","goes","went","going"], answer: 2, explain: "Past simple → went." },
  { id: 1738, q: "Translate into English: 'ertalab'", options: ["afternoon","morning","evening","night"], answer: 1, explain: "'Ertalab' means 'morning'." },
  { id: 1739, q: "Choose the correct sentence.", options: ["She am at home.","She are at home.","She is at home.","She be at home."], answer: 2, explain: "Correct → She is at home." },
  { id: 1740, q: "Translate into English: 'tush'", options: ["morning","afternoon","evening","night"], answer: 1, explain: "'Tush' means 'afternoon'." },
  { id: 1741, q: "Choose the correct option: They ___ at school now.", options: ["is","are","was","were"], answer: 1, explain: "Present simple plural → are." },
  { id: 1742, q: "Translate into English: 'kechqurun'", options: ["afternoon","morning","evening","night"], answer: 2, explain: "'Kechqurun' means 'evening'." },
  { id: 1743, q: "Choose the correct form: He ___ a book last night.", options: ["read","reads","reading","reading"], answer: 0, explain: "Past simple → read (red)." },
  { id: 1744, q: "Translate into English: 'tun'", options: ["day","night","evening","dawn"], answer: 1, explain: "'Tun' means 'night'." },
  { id: 1745, q: "Choose the correct sentence.", options: ["We don’t studies English.","We doesn’t study English.","We don’t study English.","We not study English."], answer: 2, explain: "Correct → We don’t study English." },
  { id: 1746, q: "Translate into English: 'oy'", options: ["sun","moon","star","sky"], answer: 1, explain: "'Oy' means 'moon'." },
  { id: 1747, q: "Choose the correct option: The sun ___ in the west.", options: ["rise","rises","set","sets"], answer: 3, explain: "Correct → sets in the west." },
  { id: 1748, q: "Translate into English: 'quyosh'", options: ["moon","star","sun","sky"], answer: 2, explain: "'Quyosh' means 'sun'." },
  { id: 1749, q: "Choose the correct form: The stars ___ at night.", options: ["shine","shines","shone","shining"], answer: 0, explain: "Plural subject → shine." },
  { id: 1750, q: "Translate into English: 'yulduz'", options: ["star","sun","moon","planet"], answer: 0, explain: "'Yulduz' means 'star'." },
  { id: 1751, q: "Choose the correct sentence.", options: ["He were at school.","He was at school.","He is at school yesterday.","He be at school."], answer: 1, explain: "Correct → He was at school." },
  { id: 1752, q: "Translate into English: 'osmon'", options: ["sky","cloud","air","heaven"], answer: 0, explain: "'Osmon' means 'sky'." },
  { id: 1753, q: "Choose the correct option: The birds ___ in the trees.", options: ["sing","sings","sang","singing"], answer: 0, explain: "Plural subject → sing." },
  { id: 1754, q: "Translate into English: 'bulut'", options: ["rain","snow","cloud","fog"], answer: 2, explain: "'Bulut' means 'cloud'." },
  { id: 1755, q: "Choose the correct form: It ___ yesterday.", options: ["rain","rains","rained","raining"], answer: 2, explain: "Past simple → rained." },
  { id: 1756, q: "Translate into English: 'yomg‘ir'", options: ["rain","snow","cloud","storm"], answer: 0, explain: "'Yomg‘ir' means 'rain'." },
  { id: 1757, q: "Choose the correct sentence.", options: ["It snow yesterday.","It snowed yesterday.","It snows yesterday.","It is snow yesterday."], answer: 1, explain: "Correct → It snowed yesterday." },
  { id: 1758, q: "Translate into English: 'qor'", options: ["snow","rain","ice","frost"], answer: 0, explain: "'Qor' means 'snow'." },
  { id: 1759, q: "Choose the correct option: The wind ___ strongly yesterday.", options: ["blow","blows","blew","blowing"], answer: 2, explain: "Past simple → blew." },
  { id: 1760, q: "Translate into English: 'shamol'", options: ["storm","wind","rain","snow"], answer: 1, explain: "'Shamol' means 'wind'." },
  { id: 1761, q: "Choose the correct form: She ___ studying now.", options: ["is", "are", "am", "be"], answer: 0, explain: "Present continuous → She is studying." },
  { id: 1762, q: "Translate into English: 'yulduz'", options: ["moon", "star", "sky", "planet"], answer: 1, explain: "'Yulduz' means 'star'." },
  { id: 1763, q: "Choose the correct sentence.", options: ["He go to school every day.", "He goes to school every day.", "He going to school every day.", "He gone to school every day."], answer: 1, explain: "Correct simple present form is 'He goes to school every day'." },
  { id: 1764, q: "Translate into English: 'maktab'", options: ["school", "university", "college", "class"], answer: 0, explain: "'Maktab' means 'school'." },
  { id: 1765, q: "Choose the correct form: They ___ happy yesterday.", options: ["was", "were", "are", "be"], answer: 1, explain: "Past plural → They were." },
  { id: 1766, q: "Translate into English: 'kitob'", options: ["book", "pen", "copybook", "letter"], answer: 0, explain: "'Kitob' means 'book'." },
  { id: 1767, q: "Choose the correct form: I ___ to the park tomorrow.", options: ["go", "goes", "am going", "was going"], answer: 2, explain: "Future plan → I am going." },
  { id: 1768, q: "Translate into English: 'do‘st'", options: ["friend", "family", "brother", "sister"], answer: 0, explain: "'Do‘st' means 'friend'." },
  { id: 1769, q: "Choose the correct sentence.", options: ["She don’t like tea.", "She doesn’t likes tea.", "She doesn’t like tea.", "She not like tea."], answer: 2, explain: "Correct negative form is 'She doesn’t like tea'." },
  { id: 1770, q: "Translate into English: 'ota-onalar'", options: ["parents", "children", "brothers", "relatives"], answer: 0, explain: "'Ota-onalar' means 'parents'." },
  { id: 1771, q: "Choose the correct form: We ___ in Tashkent now.", options: ["is", "am", "are", "be"], answer: 2, explain: "Present plural → We are." },
  { id: 1772, q: "Translate into English: 'o‘qituvchi'", options: ["teacher", "student", "worker", "doctor"], answer: 0, explain: "'O‘qituvchi' means 'teacher'." },
  { id: 1773, q: "Choose the correct form: He ___ TV every evening.", options: ["watch", "watches", "watched", "watching"], answer: 1, explain: "Present simple with 'he' → watches." },
  { id: 1774, q: "Translate into English: 'daraxt'", options: ["tree", "flower", "grass", "leaf"], answer: 0, explain: "'Daraxt' means 'tree'." },
  { id: 1775, q: "Choose the correct form: I ___ not at home yesterday.", options: ["am", "is", "was", "were"], answer: 2, explain: "Past singular → I was not." },
  { id: 1776, q: "Translate into English: 'qush'", options: ["bird", "cat", "dog", "fish"], answer: 0, explain: "'Qush' means 'bird'." },
  { id: 1777, q: "Choose the correct sentence.", options: ["They is happy.", "They are happy.", "They am happy.", "They be happy."], answer: 1, explain: "Correct present plural → They are happy." },
  { id: 1778, q: "Translate into English: 'daryo'", options: ["river", "lake", "sea", "ocean"], answer: 0, explain: "'Daryo' means 'river'." },
  { id: 1779, q: "Choose the correct form: She ___ her homework yesterday.", options: ["do", "does", "did", "done"], answer: 2, explain: "Past simple → She did her homework." },
  { id: 1780, q: "Translate into English: 'uy'", options: ["house", "room", "building", "homework"], answer: 0, explain: "'Uy' means 'house'." },
  { id: 1781, q: "Choose the correct form: I ___ English every day.", options: ["study", "studies", "studied", "studying"], answer: 0, explain: "Present simple with 'I' → study." },
  { id: 1782, q: "Translate into English: 'yo‘l'", options: ["road", "car", "bus", "street"], answer: 0, explain: "'Yo‘l' means 'road'." },
  { id: 1783, q: "Choose the correct form: We ___ football tomorrow.", options: ["play", "plays", "are playing", "was playing"], answer: 2, explain: "Future plan → We are playing." },
  { id: 1784, q: "Translate into English: 'qalam'", options: ["pen", "book", "copybook", "pencil"], answer: 0, explain: "'Qalam' means 'pen'." },
  { id: 1785, q: "Choose the correct sentence.", options: ["She like music.", "She likes music.", "She liking music.", "She liked music now."], answer: 1, explain: "Correct present simple → She likes music." },
  { id: 1786, q: "Translate into English: 'quvonch'", options: ["happiness", "sadness", "fear", "anger"], answer: 0, explain: "'Quvonch' means 'happiness'." },
  { id: 1787, q: "Choose the correct form: He ___ to the cinema last week.", options: ["go", "goes", "went", "gone"], answer: 2, explain: "Past simple → He went." },
  { id: 1788, q: "Translate into English: 'yaxshi'", options: ["bad", "good", "happy", "small"], answer: 1, explain: "'Yaxshi' means 'good'." },
  { id: 1789, q: "Choose the correct form: We ___ students.", options: ["is", "am", "are", "be"], answer: 2, explain: "Plural subject → We are." },
  { id: 1790, q: "Translate into English: 'kecha'", options: ["yesterday", "today", "tomorrow", "morning"], answer: 0, explain: "'Kecha' means 'yesterday'." },
  { id: 1791, q: "Choose the correct form: She ___ reading a book now.", options: ["is", "are", "am", "was"], answer: 0, explain: "Present continuous → She is reading." },
  { id: 1792, q: "Translate into English: 'ertalab'", options: ["morning", "evening", "afternoon", "night"], answer: 0, explain: "'Ertalab' means 'morning'." },
  { id: 1793, q: "Choose the correct form: He ___ not at school yesterday.", options: ["was", "were", "is", "are"], answer: 0, explain: "Past singular → He was not." },
  { id: 1794, q: "Translate into English: 'o‘yin'", options: ["game", "work", "lesson", "task"], answer: 0, explain: "'O‘yin' means 'game'." },
  { id: 1795, q: "Choose the correct sentence.", options: ["I enjoys reading.", "I enjoy reading.", "I enjoyed reading now.", "I enjoying reading."], answer: 1, explain: "Correct form is 'I enjoy reading'." },
  { id: 1796, q: "Translate into English: 'osmon'", options: ["sky", "star", "cloud", "air"], answer: 0, explain: "'Osmon' means 'sky'." },
  { id: 1797, q: "Choose the correct form: They ___ at the party last night.", options: ["was", "were", "are", "be"], answer: 1, explain: "Past plural → They were." },
  { id: 1798, q: "Translate into English: 'suv'", options: ["water", "milk", "juice", "tea"], answer: 0, explain: "'Suv' means 'water'." },
  { id: 1799, q: "Choose the correct form: We ___ our homework every day.", options: ["do", "does", "did", "doing"], answer: 0, explain: "Present simple plural → We do." },
  { id: 1800, q: "Translate into English: 'kichkina'", options: ["big", "small", "long", "short"], answer: 1, explain: "'Kichkina' means 'small'." },
  { id: 1801, q: "Choose the correct form: She ___ a letter yesterday.", options: ["write", "writes", "wrote", "writing"], answer: 2, explain: "Past simple → She wrote." },
  { id: 1802, q: "Translate into English: 'katta'", options: ["big", "small", "long", "short"], answer: 0, explain: "'Katta' means 'big'." },
  { id: 1803, q: "Choose the correct sentence.", options: ["He want to eat.", "He wants to eat.", "He wanting to eat.", "He wanted to eat now."], answer: 1, explain: "Correct present simple → He wants to eat." },
  { id: 1804, q: "Translate into English: 'do‘kon'", options: ["shop", "market", "bazaar", "store"], answer: 0, explain: "'Do‘kon' means 'shop'." },
  { id: 1805, q: "Choose the correct form: They ___ in the park now.", options: ["is", "are", "was", "be"], answer: 1, explain: "Present plural → They are." },
  { id: 1806, q: "Translate into English: 'hafta'", options: ["week", "day", "month", "year"], answer: 0, explain: "'Hafta' means 'week'." },
  { id: 1807, q: "Choose the correct form: I ___ at the cinema last night.", options: ["was", "were", "is", "are"], answer: 0, explain: "Past singular → I was." },
  { id: 1808, q: "Translate into English: 'oyna'", options: ["window", "door", "wall", "roof"], answer: 0, explain: "'Oyna' means 'window'." },
  { id: 1809, q: "Choose the correct form: He ___ English very well.", options: ["speak", "speaks", "speaked", "speaking"], answer: 1, explain: "Present simple with 'he' → speaks." },
  { id: 1810, q: "Translate into English: 'ko‘ylak'", options: ["shirt", "dress", "skirt", "coat"], answer: 1, explain: "'Ko‘ylak' means 'dress'." },
  { id: 1811, q: "Choose the correct sentence.", options: ["We was late.", "We were late.", "We are late yesterday.", "We be late."], answer: 1, explain: "Correct past plural → We were late." },
  { id: 1812, q: "Translate into English: 'oyoq'", options: ["hand", "foot", "leg", "arm"], answer: 2, explain: "'Oyoq' means 'leg'." },
  { id: 1813, q: "Choose the correct form: She ___ not working now.", options: ["is", "are", "am", "be"], answer: 0, explain: "Present continuous negative → She is not working." },
  { id: 1814, q: "Translate into English: 'qo‘l'", options: ["hand", "head", "leg", "foot"], answer: 0, explain: "'Qo‘l' means 'hand'." },
  { id: 1815, q: "Choose the correct form: They ___ their homework yesterday.", options: ["do", "did", "does", "done"], answer: 1, explain: "Past simple → They did." },
  { id: 1816, q: "Translate into English: 'bola'", options: ["child", "man", "woman", "boy"], answer: 0, explain: "'Bola' means 'child'." },
  { id: 1817, q: "Choose the correct sentence.", options: ["It raining now.", "It rains now.", "It is raining now.", "It rain now."], answer: 2, explain: "Correct present continuous → It is raining now." },
  { id: 1818, q: "Translate into English: 'tong'", options: ["night", "day", "morning", "dawn"], answer: 3, explain: "'Tong' means 'dawn'." },
  { id: 1819, q: "Choose the correct form: We ___ in the room yesterday.", options: ["is", "are", "was", "were"], answer: 3, explain: "Past plural → We were." },
  { id: 1820, q: "Translate into English: 'non'", options: ["bread", "rice", "cake", "flour"], answer: 0, explain: "'Non' means 'bread'." },
  { id: 1821, q: "Choose the correct form: She ___ cooking dinner now.", options: ["is", "are", "am", "be"], answer: 0, explain: "Present continuous → She is cooking." },
  { id: 1822, q: "Translate into English: 'osh'", options: ["rice", "bread", "plov", "soup"], answer: 2, explain: "'Osh' means 'plov'." },
  { id: 1823, q: "Choose the correct sentence.", options: ["They doesn’t like football.", "They don’t likes football.", "They don’t like football.", "They no like football."], answer: 2, explain: "Correct plural negative → They don’t like football." },
  { id: 1824, q: "Translate into English: 'gullar'", options: ["trees", "flowers", "leaves", "plants"], answer: 1, explain: "'Gullar' means 'flowers'." },
  { id: 1825, q: "Choose the correct form: He ___ in the office yesterday.", options: ["is", "was", "are", "were"], answer: 1, explain: "Past singular → He was." },
  { id: 1826, q: "Translate into English: 'meva'", options: ["fruit", "vegetable", "seed", "leaf"], answer: 0, explain: "'Meva' means 'fruit'." },
  { id: 1827, q: "Choose the correct form: I ___ happy now.", options: ["is", "am", "are", "be"], answer: 1, explain: "Present singular → I am." },
  { id: 1828, q: "Translate into English: 'sut'", options: ["milk", "water", "yogurt", "cream"], answer: 0, explain: "'Sut' means 'milk'." },
  { id: 1829, q: "Choose the correct sentence.", options: ["She are a teacher.", "She is a teacher.", "She am a teacher.", "She be a teacher."], answer: 1, explain: "Correct singular present → She is a teacher." },
  { id: 1830, q: "Translate into English: 'ish'", options: ["game", "work", "play", "task"], answer: 1, explain: "'Ish' means 'work'." },
  { id: 1831, q: "Choose the correct form: They ___ at home now.", options: ["is", "am", "are", "be"], answer: 2, explain: "Plural present → They are." },
  { id: 1832, q: "Translate into English: 'uyqu'", options: ["dream", "sleep", "rest", "nap"], answer: 1, explain: "'Uyqu' means 'sleep'." },
  { id: 1833, q: "Choose the correct form: He ___ breakfast yesterday.", options: ["eat", "eats", "ate", "eaten"], answer: 2, explain: "Past simple → He ate breakfast." },
  { id: 1834, q: "Translate into English: 'oila'", options: ["family", "parents", "friends", "children"], answer: 0, explain: "'Oila' means 'family'." },
  { id: 1835, q: "Choose the correct sentence.", options: ["We goes to school.", "We go to school.", "We going to school.", "We gone to school."], answer: 1, explain: "Correct present simple → We go to school." },
  { id: 1836, q: "Translate into English: 'oyna'", options: ["mirror", "window", "glass", "door"], answer: 1, explain: "'Oyna' means 'window'." },
  { id: 1837, q: "Choose the correct form: I ___ not hungry now.", options: ["is", "are", "am", "be"], answer: 2, explain: "Correct singular → I am not." },
  { id: 1838, q: "Translate into English: 'bog‘'", options: ["garden", "park", "forest", "yard"], answer: 0, explain: "'Bog‘' means 'garden'." },
  { id: 1839, q: "Choose the correct sentence.", options: ["She play piano.", "She plays piano.", "She played piano now.", "She playing piano."], answer: 1, explain: "Correct present simple → She plays piano." },
  { id: 1840, q: "Translate into English: 'oyoq kiyim'", options: ["shirt", "trousers", "shoes", "hat"], answer: 2, explain: "'Oyoq kiyim' means 'shoes'." },
  { id: 1841, q: "Choose the correct form: They ___ at the cinema last night.", options: ["was", "were", "is", "are"], answer: 1, explain: "Past plural → They were." },
  { id: 1842, q: "Translate into English: 'baliq'", options: ["fish", "bird", "meat", "cow"], answer: 0, explain: "'Baliq' means 'fish'." },
  { id: 1843, q: "Choose the correct form: She ___ her homework every day.", options: ["do", "does", "did", "done"], answer: 1, explain: "Present simple with 'she' → does." },
  { id: 1844, q: "Translate into English: 'kitobxona'", options: ["library", "bookshop", "school", "class"], answer: 0, explain: "'Kitobxona' means 'library'." },
  { id: 1845, q: "Choose the correct sentence.", options: ["He don’t know.", "He doesn’t know.", "He doesn’t knows.", "He not know."], answer: 1, explain: "Correct negative → He doesn’t know." },
  { id: 1846, q: "Translate into English: 'o‘rmon'", options: ["forest", "garden", "park", "tree"], answer: 0, explain: "'O‘rmon' means 'forest'." },
  { id: 1847, q: "Choose the correct form: I ___ at school yesterday.", options: ["is", "am", "was", "were"], answer: 2, explain: "Past singular → I was." },
  { id: 1848, q: "Translate into English: 'shifokor'", options: ["doctor", "teacher", "engineer", "driver"], answer: 0, explain: "'Shifokor' means 'doctor'." },
  { id: 1849, q: "Choose the correct form: They ___ English very well.", options: ["speak", "speaks", "speaked", "speaking"], answer: 0, explain: "Plural subject → They speak." },
  { id: 1850, q: "Translate into English: 'ishchi'", options: ["worker", "teacher", "student", "doctor"], answer: 0, explain: "'Ishchi' means 'worker'." },
  { id: 1851, q: "Choose the correct sentence.", options: ["We was at the park.", "We were at the park.", "We are at the park yesterday.", "We be at the park."], answer: 1, explain: "Past plural → We were." },
  { id: 1852, q: "Translate into English: 'kuchuk'", options: ["dog", "cat", "cow", "horse"], answer: 0, explain: "'Kuchuk' means 'dog'." },
  { id: 1853, q: "Choose the correct form: She ___ a letter now.", options: ["write", "writes", "is writing", "wrote"], answer: 2, explain: "Present continuous → She is writing." },
  { id: 1854, q: "Translate into English: 'mashina'", options: ["car", "bus", "train", "truck"], answer: 0, explain: "'Mashina' means 'car'." },
  { id: 1855, q: "Choose the correct form: He ___ to the shop yesterday.", options: ["go", "goes", "went", "going"], answer: 2, explain: "Past simple → He went." },
  { id: 1856, q: "Translate into English: 'xonadon'", options: ["apartment", "house", "room", "flat"], answer: 1, explain: "'Xonadon' means 'house'." },
  { id: 1857, q: "Choose the correct sentence.", options: ["It is rains.", "It rains.", "It rain.", "It raining."], answer: 1, explain: "Correct present simple → It rains." },
  { id: 1858, q: "Translate into English: 'oshxona'", options: ["kitchen", "room", "bathroom", "living room"], answer: 0, explain: "'Oshxona' means 'kitchen'." },
  { id: 1859, q: "Choose the correct form: I ___ to the park yesterday.", options: ["go", "goes", "went", "gone"], answer: 2, explain: "Past simple → I went." },
  { id: 1860, q: "Translate into English: 'deraza'", options: ["window", "door", "wall", "roof"], answer: 0, explain: "'Deraza' means 'window'." },
  { id: 1861, q: "Choose the correct form: They ___ football every day.", options: ["play", "plays", "played", "playing"], answer: 0, explain: "Plural present simple → play." },
  { id: 1862, q: "Translate into English: 'sinfxona'", options: ["classroom", "library", "school", "hall"], answer: 0, explain: "'Sinfxona' means 'classroom'." },
  { id: 1863, q: "Choose the correct form: She ___ tea every morning.", options: ["drink", "drinks", "drank", "drunk"], answer: 1, explain: "Present simple with 'she' → drinks." },
  { id: 1864, q: "Translate into English: 'uy hayvoni'", options: ["wild animal", "pet", "cow", "horse"], answer: 1, explain: "'Uy hayvoni' means 'pet'." },
  { id: 1865, q: "Choose the correct sentence.", options: ["He am a student.", "He are a student.", "He is a student.", "He be a student."], answer: 2, explain: "Correct singular → He is a student." },
  { id: 1866, q: "Translate into English: 'qish'", options: ["summer", "autumn", "spring", "winter"], answer: 3, explain: "'Qish' means 'winter'." },
  { id: 1867, q: "Choose the correct form: We ___ not at home yesterday.", options: ["was", "were", "are", "be"], answer: 1, explain: "Past plural → We were not." },
  { id: 1868, q: "Translate into English: 'bahor'", options: ["summer", "winter", "spring", "autumn"], answer: 2, explain: "'Bahor' means 'spring'." },
  { id: 1869, q: "Choose the correct form: She ___ her homework yesterday.", options: ["do", "did", "does", "done"], answer: 1, explain: "Past simple → She did." },
  { id: 1870, q: "Translate into English: 'yoz fasli'", options: ["spring", "summer", "autumn", "winter"], answer: 1, explain: "'Yoz fasli' means 'summer'." },
  { id: 1871, q: "Choose the correct sentence.", options: ["They goes to work.", "They going to work.", "They go to work.", "They gone to work."], answer: 2, explain: "Correct plural present → They go to work." },
  { id: 1872, q: "Translate into English: 'kuz'", options: ["spring", "summer", "autumn", "winter"], answer: 2, explain: "'Kuz' means 'autumn'." },
  { id: 1873, q: "Choose the correct form: I ___ writing now.", options: ["is", "are", "am", "be"], answer: 2, explain: "Present continuous → I am writing." },
  { id: 1874, q: "Translate into English: 'hayvonot bog‘i'", options: ["farm", "zoo", "park", "forest"], answer: 1, explain: "'Hayvonot bog‘i' means 'zoo'." },
  { id: 1875, q: "Choose the correct form: She ___ to school tomorrow.", options: ["go", "goes", "is going", "went"], answer: 2, explain: "Future plan → is going." },
  { id: 1876, q: "Translate into English: 'kasalxona'", options: ["hospital", "clinic", "school", "university"], answer: 0, explain: "'Kasalxona' means 'hospital'." },
  { id: 1877, q: "Choose the correct sentence.", options: ["It is snowing now.", "It snow now.", "It snowing.", "It snows yesterday."], answer: 0, explain: "Correct present continuous → It is snowing now." },
  { id: 1878, q: "Translate into English: 'quyosh'", options: ["moon", "star", "sun", "sky"], answer: 2, explain: "'Quyosh' means 'sun'." },
  { id: 1879, q: "Choose the correct form: He ___ a student last year.", options: ["is", "was", "were", "be"], answer: 1, explain: "Past singular → He was." },
  { id: 1880, q: "Translate into English: 'oy (osmon)'", options: ["moon", "sun", "planet", "star"], answer: 0, explain: "'Oy' means 'moon'." },
  { id: 1881, q: "Choose the correct form: We ___ in Samarkand now.", options: ["is", "am", "are", "be"], answer: 2, explain: "Plural present → We are." },
  { id: 1882, q: "Translate into English: 'bulut'", options: ["sky", "cloud", "rain", "storm"], answer: 1, explain: "'Bulut' means 'cloud'." },
  { id: 1883, q: "Choose the correct sentence.", options: ["She don’t like coffee.", "She doesn’t like coffee.", "She doesn’t likes coffee.", "She no like coffee."], answer: 1, explain: "Correct negative → She doesn’t like coffee." },
  { id: 1884, q: "Translate into English: 'shamol'", options: ["rain", "snow", "wind", "storm"], answer: 2, explain: "'Shamol' means 'wind'." },
  { id: 1885, q: "Choose the correct form: I ___ not at home yesterday.", options: ["am", "is", "was", "were"], answer: 2, explain: "Past singular → I was not." },
  { id: 1886, q: "Translate into English: 'maktab o‘quvchisi'", options: ["student", "teacher", "child", "boy"], answer: 0, explain: "'Maktab o‘quvchisi' means 'student'." },
  { id: 1887, q: "Choose the correct form: They ___ not tired now.", options: ["is", "are", "am", "be"], answer: 1, explain: "Plural present → They are not." },
  { id: 1888, q: "Translate into English: 'qo‘shiq'", options: ["song", "poem", "music", "voice"], answer: 0, explain: "'Qo‘shiq' means 'song'." },
  { id: 1889, q: "Choose the correct form: She ___ a book yesterday.", options: ["read", "reads", "reading", "readed"], answer: 0, explain: "Past simple → She read." },
  { id: 1890, q: "Translate into English: 'tosh'", options: ["stone", "sand", "rock", "brick"], answer: 0, explain: "'Tosh' means 'stone'." },
  { id: 1891, q: "Choose the correct sentence.", options: ["We go yesterday.", "We gone yesterday.", "We went yesterday.", "We going yesterday."], answer: 2, explain: "Correct past simple → We went yesterday." },
  { id: 1892, q: "Translate into English: 'cho‘l'", options: ["forest", "desert", "field", "mountain"], answer: 1, explain: "'Cho‘l' means 'desert'." },
  { id: 1893, q: "Choose the correct form: He ___ in Tashkent now.", options: ["live", "lives", "living", "lived"], answer: 1, explain: "Present simple with 'he' → lives." },
  { id: 1894, q: "Translate into English: 'tog‘'", options: ["mountain", "valley", "hill", "plain"], answer: 0, explain: "'Tog‘' means 'mountain'." },
  { id: 1895, q: "Choose the correct form: They ___ playing football now.", options: ["is", "are", "am", "be"], answer: 1, explain: "Present continuous plural → They are playing." },
  { id: 1896, q: "Translate into English: 'dala'", options: ["valley", "field", "garden", "park"], answer: 1, explain: "'Dala' means 'field'." },
  { id: 1897, q: "Choose the correct form: She ___ her homework now.", options: ["does", "is doing", "do", "did"], answer: 1, explain: "Present continuous → She is doing." },
  { id: 1898, q: "Translate into English: 'qishloq'", options: ["village", "city", "town", "country"], answer: 0, explain: "'Qishloq' means 'village'." },
  { id: 1899, q: "Choose the correct form: I ___ reading a book now.", options: ["is", "are", "am", "be"], answer: 2, explain: "Present continuous → I am reading." },
  { id: 1900, q: "Translate into English: 'tepalik'", options: ["valley", "mountain", "hill", "rock"], answer: 2, explain: "'Tepalik' means 'hill'." },
  { id: 1901, q: "Choose the correct sentence.", options: ["He goes yesterday.", "He went yesterday.", "He going yesterday.", "He gone yesterday."], answer: 1, explain: "Correct past simple → He went yesterday." },
  { id: 1902, q: "Translate into English: 'sham'", options: ["candle", "lamp", "light", "fire"], answer: 0, explain: "'Sham' means 'candle'." },
  { id: 1903, q: "Choose the correct form: They ___ at school now.", options: ["is", "are", "am", "was"], answer: 1, explain: "Plural present → They are." },
  { id: 1904, q: "Translate into English: 'poyezd'", options: ["train", "car", "bus", "plane"], answer: 0, explain: "'Poyezd' means 'train'." },
  { id: 1905, q: "Choose the correct form: She ___ not happy yesterday.", options: ["is", "are", "was", "were"], answer: 2, explain: "Past singular → She was not." },
  { id: 1906, q: "Translate into English: 'samolyot'", options: ["ship", "train", "car", "plane"], answer: 3, explain: "'Samolyot' means 'plane'." },
  { id: 1907, q: "Choose the correct form: We ___ English every day.", options: ["study", "studies", "studied", "studying"], answer: 0, explain: "Plural present → We study." },
  { id: 1908, q: "Translate into English: 'daryo'", options: ["lake", "river", "sea", "ocean"], answer: 1, explain: "'Daryo' means 'river'." },
  { id: 1909, q: "Choose the correct form: He ___ football yesterday.", options: ["play", "plays", "played", "playing"], answer: 2, explain: "Past simple → He played." },
  { id: 1910, q: "Translate into English: 'ko‘l'", options: ["sea", "lake", "ocean", "pond"], answer: 1, explain: "'Ko‘l' means 'lake'." },
  { id: 1911, q: "Choose the correct sentence.", options: ["We is late.", "We am late.", "We are late.", "We be late."], answer: 2, explain: "Correct plural present → We are late." },
  { id: 1912, q: "Translate into English: 'ocean'", options: ["daryo", "okean", "ko‘l", "soy"], answer: 1, explain: "'Ocean' means 'okean'." },
  { id: 1913, q: "Choose the correct form: They ___ tired yesterday.", options: ["is", "are", "was", "were"], answer: 3, explain: "Past plural → They were." },
  { id: 1914, q: "Translate into English: 'oromgoh'", options: ["camp", "hotel", "school", "house"], answer: 0, explain: "'Oromgoh' means 'camp'." },
  { id: 1915, q: "Choose the correct form: I ___ my homework yesterday.", options: ["do", "does", "did", "done"], answer: 2, explain: "Past simple → I did." },
  { id: 1916, q: "Translate into English: 'muzlik'", options: ["ice", "glacier", "snow", "cold"], answer: 1, explain: "'Muzlik' means 'glacier'." },
  { id: 1917, q: "Choose the correct sentence.", options: ["She were happy.", "She was happy.", "She are happy.", "She be happy."], answer: 1, explain: "Correct past singular → She was happy." },
  { id: 1918, q: "Translate into English: 'ko‘prik'", options: ["bridge", "road", "street", "path"], answer: 0, explain: "'Ko‘prik' means 'bridge'." },
  { id: 1919, q: "Choose the correct form: We ___ English now.", options: ["study", "studies", "studying", "studied"], answer: 0, explain: "Present plural → We study." },
  { id: 1920, q: "Translate into English: 'ko‘cha'", options: ["road", "street", "way", "path"], answer: 1, explain: "'Ko‘cha' means 'street'." },
  { id: 1921, q: "Choose the correct form: He ___ not at home now.", options: ["is", "are", "was", "were"], answer: 0, explain: "Present singular → He is not." },
  { id: 1922, q: "Translate into English: 'shahar'", options: ["town", "city", "village", "country"], answer: 1, explain: "'Shahar' means 'city'." },
  { id: 1923, q: "Choose the correct sentence.", options: ["They be doctors.", "They are doctors.", "They is doctors.", "They am doctors."], answer: 1, explain: "Correct present plural → They are doctors." },
  { id: 1924, q: "Translate into English: 'davlat'", options: ["nation", "country", "state", "government"], answer: 2, explain: "'Davlat' means 'state'." },
  { id: 1925, q: "Choose the correct form: She ___ her room every day.", options: ["clean", "cleans", "cleaning", "cleaned"], answer: 1, explain: "Present simple with 'she' → cleans." },
  { id: 1926, q: "Translate into English: 'xalq'", options: ["people", "nation", "citizen", "country"], answer: 0, explain: "'Xalq' means 'people'." },
  { id: 1927, q: "Choose the correct form: They ___ in London last year.", options: ["live", "lived", "living", "lives"], answer: 1, explain: "Past simple → They lived." },
  { id: 1928, q: "Translate into English: 'xalq qo‘shig‘i'", options: ["folk song", "pop song", "rap song", "classic song"], answer: 0, explain: "'Xalq qo‘shig‘i' means 'folk song'." },
  { id: 1929, q: "Choose the correct sentence.", options: ["I am teacher.", "I a teacher.", "I am a teacher.", "I teacher."], answer: 2, explain: "Correct form → I am a teacher." },
  { id: 1930, q: "Translate into English: 'xalq raqsi'", options: ["folk dance", "ballet", "modern dance", "hip hop"], answer: 0, explain: "'Xalq raqsi' means 'folk dance'." },
  { id: 1931, q: "Choose the correct form: He ___ a letter tomorrow.", options: ["writes", "is writing", "will write", "wrote"], answer: 2, explain: "Future simple → He will write." },
  { id: 1932, q: "Translate into English: 'ilm'", options: ["knowledge", "education", "science", "learning"], answer: 2, explain: "'Ilm' means 'science'." },
  { id: 1933, q: "Choose the correct form: They ___ to the zoo next week.", options: ["go", "goes", "will go", "went"], answer: 2, explain: "Future simple → will go." },
  { id: 1934, q: "Translate into English: 'olim'", options: ["scientist", "teacher", "student", "professor"], answer: 0, explain: "'Olim' means 'scientist'." },
  { id: 1935, q: "Choose the correct form: We ___ a new car last month.", options: ["buy", "buys", "bought", "buying"], answer: 2, explain: "Past simple → bought." },
  { id: 1936, q: "Translate into English: 'bilim'", options: ["knowledge", "science", "wisdom", "education"], answer: 0, explain: "'Bilim' means 'knowledge'." },
  { id: 1937, q: "Choose the correct sentence.", options: ["She are busy.", "She am busy.", "She is busy.", "She be busy."], answer: 2, explain: "Correct singular present → She is busy." },
  { id: 1938, q: "Translate into English: 'kitob do‘koni'", options: ["library", "bookshop", "stationery", "market"], answer: 1, explain: "'Kitob do‘koni' means 'bookshop'." },
  { id: 1939, q: "Choose the correct form: He ___ his homework yesterday.", options: ["do", "did", "done", "does"], answer: 1, explain: "Past simple → did." },
  { id: 1940, q: "Translate into English: 'savol'", options: ["question", "answer", "test", "exam"], answer: 0, explain: "'Savol' means 'question'." },
  { id: 1941, q: "Choose the correct form: They ___ to the park now.", options: ["go", "goes", "are going", "went"], answer: 2, explain: "Present continuous → are going." },
  { id: 1942, q: "Translate into English: 'javob'", options: ["answer", "question", "reply", "test"], answer: 0, explain: "'Javob' means 'answer'." },
  { id: 1943, q: "Choose the correct form: She ___ her friend last week.", options: ["meet", "meets", "met", "meeting"], answer: 2, explain: "Past simple → met." },
  { id: 1944, q: "Translate into English: 'yozuvchi'", options: ["writer", "reader", "poet", "author"], answer: 0, explain: "'Yozuvchi' means 'writer'." },
  { id: 1945, q: "Choose the correct sentence.", options: ["They is at home.", "They are at home.", "They am at home.", "They be at home."], answer: 1, explain: "Correct plural present → They are at home." },
  { id: 1946, q: "Translate into English: 'shoir'", options: ["poet", "writer", "author", "singer"], answer: 0, explain: "'Shoir' means 'poet'." },
  { id: 1947, q: "Choose the correct form: I ___ football yesterday.", options: ["play", "plays", "played", "playing"], answer: 2, explain: "Past simple → played." },
  { id: 1948, q: "Translate into English: 'musiqa'", options: ["music", "song", "melody", "sound"], answer: 0, explain: "'Musiqa' means 'music'." },
  { id: 1949, q: "Choose the correct form: He ___ not at the meeting yesterday.", options: ["is", "are", "was", "were"], answer: 2, explain: "Past singular → He was not." },
  { id: 1950, q: "Translate into English: 'o‘yin'", options: ["play", "game", "match", "fun"], answer: 1, explain: "'O‘yin' means 'game'." },
  { id: 1951, q: "Choose the correct sentence.", options: ["We studying now.", "We studies now.", "We are studying now.", "We studied now."], answer: 2, explain: "Correct present continuous → We are studying now." },
  { id: 1952, q: "Translate into English: 'film'", options: ["cinema", "movie", "picture", "show"], answer: 1, explain: "'Film' means 'movie'." },
  { id: 1953, q: "Choose the correct form: They ___ their homework tomorrow.", options: ["do", "did", "does", "will do"], answer: 3, explain: "Future simple → will do." },
  { id: 1954, q: "Translate into English: 'teatr'", options: ["cinema", "theatre", "stadium", "hall"], answer: 1, explain: "'Teatr' means 'theatre'." },
  { id: 1955, q: "Choose the correct form: We ___ to the cinema last Sunday.", options: ["go", "goes", "went", "going"], answer: 2, explain: "Past simple → went." },
  { id: 1956, q: "Translate into English: 'qo‘g‘irchoq'", options: ["doll", "toy", "puppet", "teddy bear"], answer: 0, explain: "'Qo‘g‘irchoq' means 'doll'." },
  { id: 1957, q: "Choose the correct sentence.", options: ["She writing now.", "She writes now.", "She is writing now.", "She wrote now."], answer: 2, explain: "Correct present continuous → She is writing now." },
  { id: 1958, q: "Translate into English: 'ko‘ngil ochar o‘yin'", options: ["fun game", "entertainment", "hobby", "fun"], answer: 1, explain: "'Ko‘ngil ochar o‘yin' means 'entertainment'." },
  { id: 1959, q: "Choose the correct form: He ___ at the park yesterday.", options: ["was", "were", "is", "are"], answer: 0, explain: "Past singular → He was." },
  { id: 1960, q: "Translate into English: 'voqealar'", options: ["events", "news", "stories", "situations"], answer: 0, explain: "'Voqealar' means 'events'." },
  { id: 1961, q: "Choose the correct form: They ___ not busy now.", options: ["is", "are", "was", "were"], answer: 1, explain: "Present plural → They are not." },
  { id: 1962, q: "Translate into English: 'maqola'", options: ["magazine", "article", "book", "essay"], answer: 1, explain: "'Maqola' means 'article'." },
  { id: 1963, q: "Choose the correct sentence.", options: ["It rains every day.", "It rain every day.", "It raining every day.", "It rained every day."], answer: 0, explain: "Correct present simple → It rains every day." },
  { id: 1964, q: "Translate into English: 'gazeta'", options: ["newspaper", "journal", "book", "magazine"], answer: 0, explain: "'Gazeta' means 'newspaper'." },
  { id: 1965, q: "Choose the correct form: She ___ coffee every morning.", options: ["drinks", "drink", "drank", "drinking"], answer: 0, explain: "Present simple with 'she' → drinks." },
  { id: 1966, q: "Translate into English: 'jurnal'", options: ["newspaper", "journal", "article", "note"], answer: 1, explain: "'Jurnal' means 'journal'." },
  { id: 1967, q: "Choose the correct form: I ___ to music now.", options: ["listen", "listens", "am listening", "listened"], answer: 2, explain: "Present continuous → am listening." },
  { id: 1968, q: "Translate into English: 'roman'", options: ["novel", "story", "book", "essay"], answer: 0, explain: "'Roman' means 'novel'." },
  { id: 1969, q: "Choose the correct form: They ___ their parents tomorrow.", options: ["visit", "visited", "visiting", "will visit"], answer: 3, explain: "Future simple → will visit." },
  { id: 1970, q: "Translate into English: 'hikoya'", options: ["story", "novel", "tale", "poem"], answer: 0, explain: "'Hikoya' means 'story'." },
  { id: 1971, q: "Choose the correct sentence.", options: ["We is friends.", "We are friends.", "We am friends.", "We be friends."], answer: 1, explain: "Correct plural present → We are friends." },
  { id: 1972, q: "Translate into English: 'she’r'", options: ["poem", "song", "prose", "story"], answer: 0, explain: "'She’r' means 'poem'." },
  { id: 1973, q: "Choose the correct form: He ___ to school yesterday.", options: ["go", "went", "goes", "going"], answer: 1, explain: "Past simple → went." },
  { id: 1974, q: "Translate into English: 'adabiyot'", options: ["literature", "book", "poetry", "science"], answer: 0, explain: "'Adabiyot' means 'literature'." },
  { id: 1975, q: "Choose the correct form: They ___ their books every day.", options: ["reads", "read", "reading", "readed"], answer: 1, explain: "Present simple plural → read." },
  { id: 1976, q: "Translate into English: 'asar'", options: ["work", "creation", "book", "story"], answer: 0, explain: "'Asar' means 'work/creation'." },
  { id: 1977, q: "Choose the correct sentence.", options: ["She like apples.", "She likes apples.", "She liking apples.", "She liked apples."], answer: 1, explain: "Correct present simple with 'she' → likes." },
  { id: 1978, q: "Translate into English: 'xat'", options: ["letter", "note", "email", "paper"], answer: 0, explain: "'Xat' means 'letter'." },
  { id: 1979, q: "Choose the correct form: We ___ not in the classroom now.", options: ["is", "are", "was", "were"], answer: 1, explain: "Present plural → We are not." },
  { id: 1980, q: "Translate into English: 'telefon'", options: ["phone", "telephone", "mobile", "cell"], answer: 1, explain: "'Telefon' means 'telephone'." },
  { id: 1981, q: "Choose the correct form: They ___ football every weekend.", options: ["plays", "play", "playing", "played"], answer: 1, explain: "Present simple plural → play." },
  { id: 1982, q: "Translate into English: 'kompyuter'", options: ["computer", "laptop", "PC", "device"], answer: 0, explain: "'Kompyuter' means 'computer'." },
  { id: 1983, q: "Choose the correct form: She ___ not at school yesterday.", options: ["is", "was", "were", "are"], answer: 1, explain: "Past singular → was not." },
  { id: 1984, q: "Translate into English: 'darslik'", options: ["book", "textbook", "lesson", "note"], answer: 1, explain: "'Darslik' means 'textbook'." },
  { id: 1985, q: "Choose the correct sentence.", options: ["He have a car.", "He has a car.", "He haves a car.", "He having a car."], answer: 1, explain: "Correct present simple → He has a car." },
];
