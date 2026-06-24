// ── SYSTEM PROMPT ──────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es l'assistant repas de Franck. Ton rôle : l'aider à planifier ses repas de la semaine.

PROFIL DE FRANCK
- 26 ans, musculation et skate
- Apprend à cuisiner, niveau débutant
- Mange seul, pour 1 personne
- Équipement : 2 plaques, 2 casseroles, 2 poêles (dont une poêle à crêpes). Pas de four, pas de micro-ondes.
- Objectif : arrêter de sauter des repas, découvrir des plats simples

DÉROULEMENT
Pose ces 3 questions dans l'ordre, une par une :
1. "Quel est ton budget courses cette semaine ? (en €)"
2. Affiche l'inventaire fourni et demande : "Tu as autre chose ?"
3. "Des aliments que tu veux éviter cette semaine ?"

Une fois les 3 réponses, réponds UNIQUEMENT avec un objet JSON valide (pas de texte, pas de backticks) :

{
  "semaine": "Semaine du [date lundi] au [date dimanche]",
  "couleur": "#[couleur hex chaude/naturelle différente chaque semaine, tons verts oranges ambrés]",
  "jours": [
    {
      "jour": "Lundi",
      "plat": "Nom du plat",
      "flemme": false,
      "temps": "25 min",
      "ingredients": [{ "nom": "Poulet", "quantite": "200g", "dans_inventaire": true }],
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
- Exactement 7 jours : Lundi, Mardi, Mercredi, Jeudi, Vendredi, Samedi, Dimanche
- 1 à 2 repas flemme max (flemme: true), 5-10 min
- Autres : 20-40 min, uniquement plaque/poêle/casserole
- PRIORITÉ INVENTAIRE : utilise en priorité ce que Franck a déjà. dans_inventaire: true si l'ingrédient est dans l'inventaire fourni
- La liste de courses ne contient QUE ce qui manque (pas ce qui est en inventaire, sauf si quantité insuffisante)
- Légumes de saison, plats variés d'une semaine à l'autre
- Langage simple, ne jamais supposer que Franck sait faire un plat`;

const SINGLE_DAY_PROMPT = `Tu es l'assistant repas de Franck. Génère UN SEUL repas de remplacement.

PROFIL : 26 ans, 1 personne, 2 plaques/poêles/casseroles, pas de four ni micro-ondes, niveau débutant.

Réponds UNIQUEMENT avec un objet JSON (pas de texte, pas de backticks) :
{
  "plat": "Nom du plat",
  "flemme": false,
  "temps": "20 min",
  "ingredients": [{ "nom": "...", "quantite": "...", "dans_inventaire": false }],
  "etapes": ["..."],
  "conseil": "..."
}

RÈGLES : plat différent de celui remplacé, utilise l'inventaire fourni en priorité, 20-40 min ou 5-10 min si flemme, uniquement plaque/poêle/casserole.`;

const CHAT_INTRO = "Salut ! On planifie ta semaine 🍳";
const Q1 = "Quel est ton budget courses cette semaine ? (en €)";
const Q3 = "Des aliments que tu veux éviter cette semaine ?";

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
  "🛒 Passage au marché du coin...",
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

// ── PARSE INVENTAIRE DEPUIS TEXTE ──────────────────────────────
function parseInventaireFromText(text) {
  // Sépare par virgules, "et", "de", retours à la ligne
  const raw = text
    .replace(/\b(de l['']|du |de la |des |un |une |le |la |les )\b/gi, '')
    .split(/,|;|\bet\b|\n/i)
    .map(s => s.trim())
    .filter(s => s.length > 1);

  const nouveaux = [];
  raw.forEach(item => {
    // Extrait quantité si présente (ex: "500g de riz", "1 sachet de riz")
    const qtyMatch = item.match(/^([\d.,]+\s*(?:g|kg|ml|l|cl|sachet[s]?|boîte[s]?|pot[s]?|bouteille[s]?|paquet[s]?|tranche[s]?|œuf[s]?|oeuf[s]?)?)\s+(.+)/i)
                  || item.match(/^(\d+)\s+(.+)/i);
    let nom, qty;
    if (qtyMatch) {
      qty = qtyMatch[1].trim();
      nom = qtyMatch[2].trim();
    } else {
      nom = item.trim();
      qty = '—';
    }
    nom = nom.replace(/^(de |d'|du |de la |des )/i, '').trim();
    if (nom.length < 2) return;

    // Vérifie si déjà dans l'inventaire
    const exists = inventaire.find(i => i.nom.toLowerCase() === nom.toLowerCase());
    if (!exists) {
      inventaire.push({ nom, qty });
      nouveaux.push(nom);
    }
  });
  return nouveaux;
}

// ── API ────────────────────────────────────────────────────────
async function callAPI(messages, systemOverride) {
  console.log('🍳 [Franck] Envoi requête à Claude...');
  const res = await fetch('/api?action=chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system: systemOverride || SYSTEM_PROMPT, messages })
  });
  console.log('📡 [Franck] Status:', res.status);
  const text = await res.text();
  console.log('📦 [Franck] Réponse:', text.slice(0, 300) + (text.length > 300 ? '...' : ''));
  const data = JSON.parse(text);
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
    console.log('💾 [Franck] Sauvegardé');
  } catch (e) { console.log('❌ Gist save error:', e); }
}

async function loadFromGist() {
  try {
    const res = await fetch('/api?action=load');
    const text = await res.text();
    return JSON.parse(text);
  } catch (e) { return null; }
}

async function persistAll() {
  await saveToGist({ planning: currentData, inventaire });
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
      <button class="inv-btn del" onclick="deleteInvItem(${i})">✕</button>
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
  const exists = inventaire.find(i => i.nom.toLowerCase() === nom.toLowerCase());
  if (!exists) inventaire.push({ nom, qty: qty || '—' });
  document.getElementById('inv-nom').value = '';
  document.getElementById('inv-qty').value = '';
  renderInventaire();
  persistAll();
}

function inventaireToText() {
  if (!inventaire.length) return 'Aucun article en stock.';
  return inventaire.map(i => `- ${i.nom} : ${i.qty}`).join('\n');
}

// ── COURSES AVEC CHECKBOXES ────────────────────────────────────
function toggleCourseItem(nom, checked) {
  if (checked) {
    const exists = inventaire.find(i => i.nom.toLowerCase() === nom.toLowerCase());
    if (!exists) {
      inventaire.push({ nom, qty: '✓ acheté' });
      renderInventaire();
      persistAll();
    }
  } else {
    const idx = inventaire.findIndex(i => i.nom.toLowerCase() === nom.toLowerCase() && i.qty === '✓ acheté');
    if (idx !== -1) { inventaire.splice(idx, 1); renderInventaire(); persistAll(); }
  }
}

function renderCourses(courses, total) {
  const el = document.getElementById('courses-content');
  el.innerHTML = '';
  courses.forEach(rayon => {
    const block = document.createElement('div');
    block.className = 'rayon-block';
    block.innerHTML = `<div class="rayon-title">${rayon.rayon}</div>`;
    rayon.items.forEach(item => {
      const alreadyBought = inventaire.find(i => i.nom.toLowerCase() === item.nom.toLowerCase());
      const row = document.createElement('div');
      row.className = `course-item${alreadyBought ? ' done' : ''}`;
      const id = `chk-${item.nom.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '')}`;
      row.innerHTML = `
        <label class="course-label" for="${id}">
          <input type="checkbox" id="${id}" class="course-check" ${alreadyBought ? 'checked' : ''} />
          <span class="course-check-box"></span>
          <span class="course-nom">${item.nom}</span>
        </label>
        <span class="course-price">${item.prix}</span>
      `;
      row.querySelector('.course-check').addEventListener('change', e => {
        toggleCourseItem(item.nom, e.target.checked);
        row.classList.toggle('done', e.target.checked);
      });
      block.appendChild(row);
    });
    el.appendChild(block);
  });
  const tot = document.createElement('div');
  tot.className = 'courses-total';
  tot.innerHTML = `<span>Total estimé</span><span>${total}</span>`;
  el.appendChild(tot);
}

// ── CHANGER UN JOUR ────────────────────────────────────────────
async function changeDay(jourIndex) {
  const jour = currentData.jours[jourIndex];
  const btn = document.querySelector(`[data-change-idx="${jourIndex}"]`);
  if (btn) { btn.textContent = '...'; btn.disabled = true; }

  try {
    const msg = `Inventaire de Franck :\n${inventaireToText()}\n\nRemplace le repas du ${jour.jour} (actuellement : ${jour.plat}). Propose un plat différent en utilisant en priorité l'inventaire. JSON uniquement.`;
    const reply = await callAPI([{ role: 'user', content: msg }], SINGLE_DAY_PROMPT);
    let clean = reply.trim().replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();
    const newJour = JSON.parse(clean);
    newJour.jour = jour.jour;
    currentData.jours[jourIndex] = newJour;
    await persistAll();
    renderPlanning(currentData);
    console.log('✅ Jour changé:', jour.jour, '→', newJour.plat);
  } catch (err) {
    console.error('❌ Erreur changement jour:', err);
    if (btn) { btn.textContent = '↺'; btn.disabled = false; }
  }
}

// ── PLANNING RENDER ────────────────────────────────────────────
function renderPlanning(data) {
  currentData = data;

  if (data.couleur) {
    document.documentElement.style.setProperty('--orange', data.couleur);
  }

  document.getElementById('week-label').textContent = data.semaine || 'Semaine en cours';

  const grid = document.getElementById('days-grid');
  grid.innerHTML = '';
  data.jours.forEach((jour, i) => {
    const card = document.createElement('div');
    card.className = `day-card${jour.flemme ? ' flemme' : ''}`;
    card.innerHTML = `
      <div class="day-label">${jour.jour}</div>
      <div class="day-meal">${jour.plat}</div>
      <div class="day-meta">
        <span class="badge badge-time">⏱ ${jour.temps}</span>
        ${jour.flemme ? '<span class="badge badge-flemme">⚡ flemme</span>' : ''}
      </div>
      <div class="day-footer">
        <button class="day-change-btn" data-change-idx="${i}" onclick="event.stopPropagation(); changeDay(${i})">↺ changer</button>
        <span class="day-arrow">→</span>
      </div>
    `;
    card.addEventListener('click', () => openRecipe(jour));
    grid.appendChild(card);
  });

  renderCourses(data.courses, data.total);
  renderInventaire();
  showScreen('planning-screen');
}

// ── RECIPE MODAL ───────────────────────────────────────────────
function openRecipe(jour) {
  const modal = document.getElementById('recipe-modal');
  const content = document.getElementById('modal-content');
  const ings = jour.ingredients.map(i =>
    `<li><span>${i.nom}${i.dans_inventaire ? ' <span style="color:var(--green);font-size:0.7rem">✓ stock</span>' : ''}</span><span class="ing-qty">${i.quantite}</span></li>`
  ).join('');
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
    <ol class="steps-list">${jour.etapes.map(e => `<li>${e}</li>`).join('')}</ol>
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
    // Q2 : affiche inventaire + demande le reste
    const invText = inventaireToText();
    const q2msg = inventaire.length
      ? `Voilà ce que j'ai dans ton inventaire :\n${invText}\n\nJe vais tout utiliser en priorité. Tu as autre chose qui n'est pas dans cette liste ?`
      : "Tu as quelque chose dans les placards ou le frigo ?";
    setTimeout(() => addMsg(q2msg, 'bot'), 400);
    conversationHistory.push({ role: 'assistant', content: q2msg });

  } else if (step === 1) {
    answers.placards = val;
    // Parser ce que l'user a dit et l'ajouter à l'inventaire
    const nouveaux = parseInventaireFromText(val);
    if (nouveaux.length) {
      renderInventaire();
      persistAll();
      console.log('📦 [Franck] Ajouté à l\'inventaire:', nouveaux);
    }
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
      const finalMsg = `Budget: ${answers.budget}\nInventaire complet:\n${inventaireToText()}\nÀ éviter: ${answers.eviter}\n\nGénère maintenant le planning JSON.`;
      conversationHistory.push({ role: 'user', content: finalMsg });

      const reply = await callAPI(conversationHistory);
      let clean = reply.trim().replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();

      const data = JSON.parse(clean);
      currentData = data;
      await persistAll();

      stopLoadingMessages();
      renderPlanning(data);
      console.log('🎉 [Franck] Planning prêt !');
    } catch (err) {
      stopLoadingMessages();
      showScreen('chat-screen');
      addMsg("Oups, une erreur s'est produite. Réessaie !", 'bot');
      step = 2;
      console.error('❌ [Franck] Erreur:', err);
    }
  }
}

// ── RESET SEMAINE ──────────────────────────────────────────────
function resetWeek() {
  if (!confirm("Recommencer le planning ? L'inventaire reste intact.")) return;
  currentData = null;
  saveToGist({ planning: null, inventaire });
  startChat();
}

// ── START CHAT ─────────────────────────────────────────────────
function startChat() {
  step = 0;
  answers = {};
  conversationHistory = [];
  document.getElementById('chat-messages').innerHTML = '';
  showScreen('chat-screen');
  setTimeout(() => {
    addMsg(CHAT_INTRO, 'bot');
    conversationHistory.push({ role: 'assistant', content: CHAT_INTRO });
    setTimeout(() => {
      addMsg(Q1, 'bot');
      conversationHistory.push({ role: 'assistant', content: Q1 });
    }, 500);
  }, 150);
}

// ── INIT ───────────────────────────────────────────────────────
async function init() {
  showScreen('loading-screen');
  document.getElementById('loading-text').textContent = 'Chargement...';

  const saved = await loadFromGist();
  if (saved) {
    if (saved.inventaire) inventaire = saved.inventaire;
    const planning = saved.planning || (saved.jours ? saved : null);
    if (planning && planning.jours && planning.jours.length === 7) {
      renderPlanning(planning);
      return;
    }
  }
  renderInventaire();
  showScreen('setup-screen');
}

// ── EVENTS ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  init();
  document.getElementById('start-btn').addEventListener('click', startChat);
  document.getElementById('new-week-btn').addEventListener('click', startChat);
  document.getElementById('reset-week-btn').addEventListener('click', resetWeek);
  document.getElementById('chat-send').addEventListener('click', handleSend);
  document.getElementById('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') handleSend(); });
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('recipe-modal').addEventListener('click', e => { if (e.target.id === 'recipe-modal') closeModal(); });
  document.getElementById('copy-courses-btn').addEventListener('click', copyCourses);
  document.getElementById('inv-add-btn').addEventListener('click', addInvItem);
  document.getElementById('inv-qty').addEventListener('keydown', e => { if (e.key === 'Enter') addInvItem(); });
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
});
