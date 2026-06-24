// ── SYSTEM PROMPT ──────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es l'assistant repas de Franck. Ton rôle : l'aider à planifier ses repas de la semaine.

PROFIL DE FRANCK
- 26 ans, musculation et skate
- Ne cuisinait pas avant, apprend progressivement
- Mange seul, pour 1 personne
- Équipement : 2 plaques, 2 casseroles, 2 poêles (dont une poêle à crêpes). Pas de four, pas de micro-ondes.
- Objectif : arrêter de sauter des repas, découvrir des plats simples et bons

DÉROULEMENT
Pose ces 3 questions dans l'ordre, une par une :
1. "Quel est ton budget courses cette semaine ? (en €)"
2. Lis l'inventaire fourni ci-dessous et dis à Franck ce qu'il a déjà. Puis demande : "Tu as autre chose dans le frigo ou les placards ?"
3. "Des aliments que tu n'aimes pas ou veux éviter cette semaine ?"

Une fois les 3 réponses, réponds UNIQUEMENT avec un objet JSON valide (pas de texte, pas de backticks) :

{
  "semaine": "Semaine du [date samedi] au [date vendredi]",
  "couleur": "#[couleur hex vive différente chaque semaine]",
  "jours": [
    {
      "jour": "Samedi",
      "plat": "Nom du plat",
      "flemme": false,
      "temps": "25 min",
      "ingredients": [{ "nom": "Poulet", "quantite": "200g" }],
      "etapes": ["Couper le poulet en morceaux.", "Faire chauffer la poêle."],
      "conseil": "Astuce si besoin"
    }
  ],
  "courses": [
    {
      "rayon": "Viandes & poissons",
      "items": [{ "nom": "Blanc de poulet", "prix": "3.50€" }]
    }
  ],
  "total": "45€"
}

RÈGLES
- Exactement 7 jours : Samedi, Dimanche, Lundi, Mardi, Mercredi, Jeudi, Vendredi
- 1 à 2 repas flemme max (flemme: true), 5-10 min
- Autres : 20-40 min, uniquement plaque/poêle/casserole
- Légumes de saison, plats variés d'une semaine à l'autre
- Langage simple, ne jamais supposer que Franck sait faire un plat
- La liste de courses ne contient PAS ce que Franck a déjà en inventaire (sauf si quantité insuffisante)
- Couleur hex vive et différente chaque semaine`;

const CHAT_INTRO = "Salut ! On planifie ta semaine 🍳";
const Q1 = "Quel est ton budget courses cette semaine ? (en €)";
const Q2_SUFFIX = "\nTu as autre chose dans le frigo ou les placards en plus ?";
const Q3 = "Des aliments que tu n'aimes pas ou veux éviter cette semaine ?";

// ── STATE ──────────────────────────────────────────────────────
let step = 0;
let answers = {};
let conversationHistory = [];
let currentData = null;
let inventaire = [];

// ── LOADING ────────────────────────────────────────────────────
const LOADING_MESSAGES = [
  "🐀 En train d'appâter Ratatouille...",
  "🍅 Récolte des tomates du jardin...",
  "🔪 Julienne de carottes en cours...",
  "🧅 Les oignons font pleurer le chef...",
  "🫕 Mijotage à feu doux...",
  "🧄 Négociation avec l'ail...",
  "🌿 Cueillette des herbes fraîches...",
  "🍳 Chauffage de la poêle à crêpes...",
  "🥄 Goûtage qualité en cours...",
  "🧑‍🍳 Le chef consulte ses grimoires...",
  "🛒 Passage au marché du quartier...",
  "🥚 Comptage des œufs...",
];
let loadingInterval = null;

function startLoadingMessages() {
  let i = 0;
  const el = document.getElementById('loading-text');
  el.textContent = LOADING_MESSAGES[0];
  loadingInterval = setInterval(() => {
    i = (i + 1) % LOADING_MESSAGES.length;
    el.textContent = LOADING_MESSAGES[i];
  }, 2000);
}

function stopLoadingMessages() {
  if (loadingInterval) { clearInterval(loadingInterval); loadingInterval = null; }
}

// ── SCREENS ────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  el.classList.add('active');
}

// ── CHAT ───────────────────────────────────────────────────────
function addMsg(text, type) {
  const wrap = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `msg ${type}`;
  div.textContent = text;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

// ── API ────────────────────────────────────────────────────────
async function callAPI(messages) {
  console.log('🍳 [Franck] Envoi requête à Claude...');
  const res = await fetch('/api?action=chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system: SYSTEM_PROMPT, messages })
  });
  console.log('📡 [Franck] Status:', res.status);
  const text = await res.text();
  console.log('📦 [Franck] Réponse brute:', text.slice(0, 300) + (text.length > 300 ? '...' : ''));
  const data = JSON.parse(text);
  console.log('✅ [Franck] Réponse OK');
  return data.content?.[0]?.text || '';
}

// ── GIST ───────────────────────────────────────────────────────
async function saveToGist(payload) {
  try {
    await fetch('/api?action=save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: payload })
    });
    console.log('💾 [Franck] Sauvegardé sur Gist');
  } catch (e) {
    console.log('❌ Erreur sauvegarde gist:', e);
  }
}

async function loadFromGist() {
  try {
    const res = await fetch('/api?action=load');
    const text = await res.text();
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

// ── INVENTAIRE ─────────────────────────────────────────────────
function renderInventaire() {
  const list = document.getElementById('inventaire-list');
  if (!inventaire.length) {
    list.innerHTML = '<p class="inv-empty">Aucun article. Ajoute ce que tu as chez toi !</p>';
    return;
  }
  list.innerHTML = inventaire.map((item, i) => `
    <div class="inv-item">
      <span class="inv-nom">${item.nom}</span>
      <span class="inv-qty">${item.qty}</span>
      <div class="inv-actions">
        <button class="inv-btn del" onclick="deleteInvItem(${i})">✕</button>
      </div>
    </div>
  `).join('');
}

function deleteInvItem(i) {
  inventaire.splice(i, 1);
  renderInventaire();
  persistAll();
}

function addInvItem() {
  const nom = document.getElementById('inv-nom').value.trim();
  const qty = document.getElementById('inv-qty').value.trim();
  if (!nom) return;
  inventaire.push({ nom, qty: qty || '—' });
  document.getElementById('inv-nom').value = '';
  document.getElementById('inv-qty').value = '';
  renderInventaire();
  persistAll();
}

function inventaireToText() {
  if (!inventaire.length) return 'Aucun article en stock.';
  return inventaire.map(i => `- ${i.nom} : ${i.qty}`).join('\n');
}

// Quand les courses sont générées, proposer d'ajouter à l'inventaire
function addCoursesToInventaire(courses) {
  courses.forEach(rayon => {
    rayon.items.forEach(item => {
      const exists = inventaire.find(i => i.nom.toLowerCase() === item.nom.toLowerCase());
      if (!exists) {
        inventaire.push({ nom: item.nom, qty: '—' });
      }
    });
  });
  renderInventaire();
  persistAll();
}

// ── PERSIST ────────────────────────────────────────────────────
async function persistAll() {
  const payload = { planning: currentData, inventaire };
  await saveToGist(payload);
}

// ── PLANNING RENDER ────────────────────────────────────────────
function renderPlanning(data) {
  currentData = data;

  if (data.couleur) {
    document.documentElement.style.setProperty('--accent', data.couleur);
  }

  document.getElementById('week-label').textContent = data.semaine || 'Semaine en cours';

  const grid = document.getElementById('days-grid');
  grid.innerHTML = '';
  data.jours.forEach(jour => {
    const card = document.createElement('div');
    card.className = `day-card${jour.flemme ? ' flemme' : ''}`;
    card.innerHTML = `
      <div class="day-label">${jour.jour}</div>
      <div class="day-meal">${jour.plat}</div>
      <div class="day-meta">
        <span class="badge badge-time">⏱ ${jour.temps}</span>
        ${jour.flemme ? '<span class="badge badge-flemme">⚡ flemme</span>' : ''}
      </div>
      <span class="day-arrow">→</span>
    `;
    card.addEventListener('click', () => openRecipe(jour));
    grid.appendChild(card);
  });

  const coursesEl = document.getElementById('courses-content');
  coursesEl.innerHTML = '';
  data.courses.forEach(rayon => {
    const block = document.createElement('div');
    block.className = 'rayon-block';
    block.innerHTML = `<div class="rayon-title">${rayon.rayon}</div>`;
    rayon.items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'course-item';
      row.innerHTML = `<span>${item.nom}</span><span class="course-price">${item.prix}</span>`;
      block.appendChild(row);
    });
    coursesEl.appendChild(block);
  });

  const total = document.createElement('div');
  total.className = 'courses-total';
  total.innerHTML = `<span>Total estimé</span><span>${data.total}</span>`;
  coursesEl.appendChild(total);

  showScreen('planning-screen');
}

// ── RECIPE MODAL ───────────────────────────────────────────────
function openRecipe(jour) {
  const modal = document.getElementById('recipe-modal');
  const content = document.getElementById('modal-content');

  const ings = jour.ingredients.map(i =>
    `<li><span>${i.nom}</span><span class="ing-qty">${i.quantite}</span></li>`
  ).join('');

  const steps = jour.etapes.map(e => `<li>${e}</li>`).join('');

  content.innerHTML = `
    <div class="modal-day">${jour.jour}</div>
    <div class="modal-title">${jour.plat}</div>
    <div class="day-meta" style="margin-bottom:1.25rem">
      <span class="badge badge-time">⏱ ${jour.temps}</span>
      ${jour.flemme ? '<span class="badge badge-flemme">⚡ flemme</span>' : ''}
    </div>
    <div class="modal-section-title">Ingrédients</div>
    <ul class="ingredients-list">${ings}</ul>
    <div class="modal-section-title">Préparation</div>
    <ol class="steps-list">${steps}</ol>
    ${jour.conseil ? `<div class="tip-box">💡 ${jour.conseil}</div>` : ''}
  `;

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('recipe-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

// ── COPY COURSES ───────────────────────────────────────────────
function copyCourses() {
  if (!currentData) return;
  let text = `🛒 ${currentData.semaine}\n\n`;
  currentData.courses.forEach(rayon => {
    text += `${rayon.rayon.toUpperCase()}\n`;
    rayon.items.forEach(item => { text += `• ${item.nom} — ${item.prix}\n`; });
    text += '\n';
  });
  text += `TOTAL : ${currentData.total}`;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copy-courses-btn');
    btn.textContent = '✅ Copié !';
    setTimeout(() => { btn.textContent = '📋 Copier la liste'; }, 2000);
  });
}

// ── HANDLE SEND ────────────────────────────────────────────────
async function handleSend() {
  const input = document.getElementById('chat-input');
  const val = input.value.trim();
  if (!val) return;
  input.value = '';

  addMsg(val, 'user');
  conversationHistory.push({ role: 'user', content: val });

  if (step === 0) {
    answers.budget = val;
    step++;
    // Q2 : affiche l'inventaire + pose la question
    const invText = inventaireToText();
    const q2msg = inventaire.length
      ? `D'après ton inventaire, tu as :\n${invText}${Q2_SUFFIX}`
      : "Tu as quelque chose dans le frigo ou les placards ?";
    setTimeout(() => addMsg(q2msg, 'bot'), 400);
    conversationHistory.push({ role: 'assistant', content: q2msg });

  } else if (step === 1) {
    answers.placards = val;
    step++;
    setTimeout(() => addMsg(Q3, 'bot'), 400);
    conversationHistory.push({ role: 'assistant', content: Q3 });

  } else if (step === 2) {
    answers.eviter = val;
    step++;

    showScreen('loading-screen');
    startLoadingMessages();
    console.log('🚀 [Franck] Génération du planning...');

    try {
      const finalMsg = `Budget: ${answers.budget}\nInventaire: ${inventaireToText()}\nPlacards/frigo en plus: ${answers.placards}\nÀ éviter: ${answers.eviter}\n\nGénère maintenant le planning JSON.`;
      conversationHistory.push({ role: 'user', content: finalMsg });

      const reply = await callAPI(conversationHistory);
      let clean = reply.trim();
      if (clean.startsWith('```')) {
        clean = clean.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();
      }

      console.log('🗓️ [Franck] Parsing du planning...');
      const data = JSON.parse(clean);

      // Ajouter les courses à l'inventaire
      addCoursesToInventaire(data.courses);

      await persistAll();
      // persistAll sauvegarde planning+inventaire ensemble
      currentData = data;

      console.log('🎉 [Franck] Planning prêt !');
      stopLoadingMessages();
      renderPlanning(data);
    } catch (err) {
      stopLoadingMessages();
      showScreen('chat-screen');
      addMsg("Oups, une erreur s'est produite. Réessaie !", 'bot');
      step = 2;
      console.error('❌ [Franck] Erreur:', err);
    }
  }
}

// ── INIT ───────────────────────────────────────────────────────
async function init() {
  showScreen('loading-screen');
  document.getElementById('loading-text').textContent = 'Chargement...';

  const saved = await loadFromGist();

  if (saved) {
    if (saved.inventaire) {
      inventaire = saved.inventaire;
    }
    if (saved.planning && saved.planning.jours && saved.planning.jours.length === 7) {
      renderPlanning(saved.planning);
      renderInventaire();
      return;
    }
    // Ancien format sans wrapper
    if (saved.jours && saved.jours.length === 7) {
      renderPlanning(saved);
      renderInventaire();
      return;
    }
  }

  renderInventaire();
  showScreen('setup-screen');

  // ── Events ──
  document.getElementById('start-btn').addEventListener('click', startChat);
  document.getElementById('new-week-btn').addEventListener('click', startChat);
  document.getElementById('chat-send').addEventListener('click', handleSend);
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSend();
  });
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('recipe-modal').addEventListener('click', e => {
    if (e.target.id === 'recipe-modal') closeModal();
  });
  document.getElementById('copy-courses-btn').addEventListener('click', copyCourses);
  document.getElementById('inv-add-btn').addEventListener('click', addInvItem);
  document.getElementById('inv-qty').addEventListener('keydown', e => {
    if (e.key === 'Enter') addInvItem();
  });
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

function startChat() {
  step = 0;
  answers = {};
  conversationHistory = [];
  document.getElementById('chat-messages').innerHTML = '';
  showScreen('chat-screen');

  // Re-bind events si pas encore fait
  document.getElementById('chat-send').onclick = handleSend;
  document.getElementById('chat-input').onkeydown = e => { if (e.key === 'Enter') handleSend(); };

  setTimeout(() => {
    addMsg(CHAT_INTRO, 'bot');
    conversationHistory.push({ role: 'assistant', content: CHAT_INTRO });
    setTimeout(() => {
      addMsg(Q1, 'bot');
      conversationHistory.push({ role: 'assistant', content: Q1 });
    }, 500);
  }, 150);
}

document.addEventListener('DOMContentLoaded', init);
