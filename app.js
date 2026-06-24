// ── PROMPTS ────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es l'assistant repas de Franck. Aide-le à planifier ses repas de la semaine.

PROFIL
- 26 ans, musculation et skate, apprend à cuisiner
- Mange seul, 1 personne
- Équipement : 2 plaques, 2 casseroles, 2 poêles (dont une à crêpes). Pas de four, pas de micro-ondes.
- Objectif : arrêter de sauter des repas, découvrir des plats simples

DÉROULEMENT — 3 questions dans l'ordre, une par une :
1. Budget courses cette semaine (en €)
2. Affiche l'inventaire fourni, demande s'il y a autre chose
3. Aliments à éviter cette semaine

Ensuite réponds UNIQUEMENT avec un JSON valide (pas de texte, pas de backticks) :
{
  "semaine": "Semaine du [lundi JJ/MM] au [dimanche JJ/MM]",
  "couleur": "#[hex chaud/naturel différent chaque semaine]",
  "jours": [
    {
      "jour": "Lundi", "plat": "Nom", "flemme": false, "temps": "25 min",
      "ingredients": [{"nom": "Poulet", "quantite": "200g", "dans_inventaire": true}],
      "etapes": ["Étape 1.", "Étape 2."],
      "conseil": "Astuce ou ordre de cuisson"
    }
  ],
  "courses": [{"rayon": "Viandes", "items": [{"nom": "Poulet", "prix": "3.50€"}]}],
  "total": "45€"
}

RÈGLES ABSOLUES
- 7 jours : Lundi, Mardi, Mercredi, Jeudi, Vendredi, Samedi, Dimanche
- 1-2 repas flemme max (5-10 min), autres 20-40 min
- Uniquement plaque/poêle/casserole
- PRIORITÉ INVENTAIRE : utilise ce que Franck a déjà, dans_inventaire:true si c'est le cas
- Courses = seulement ce qui manque
- Légumes de saison, plats variés, langage simple`;

const SINGLE_DAY_PROMPT = `Génère UN repas de remplacement pour Franck (26 ans, 1 personne, 2 plaques/poêles/casseroles, pas de four).
Réponds UNIQUEMENT avec un JSON valide (pas de backticks) :
{"plat":"Nom","flemme":false,"temps":"20 min","ingredients":[{"nom":"...","quantite":"...","dans_inventaire":false}],"etapes":["..."],"conseil":"..."}
Règles : plat différent de l'actuel, utilise l'inventaire en priorité, 20-40 min ou 5-10 min si flemme.`;

const COACH_PROMPT = `Tu es Franck le Cuisto, un ami sympa qui aide à cuisiner. Tu expliques une étape de recette de façon simple et encourageante, comme si t'étais à côté dans la cuisine.
Réponds en 2-4 phrases max, langage familier et bienveillant, des conseils concrets et pratiques. Si on te pose une question précise, réponds directement à cette question.
Contexte : recette en cours, étape spécifique fournie.`;

const TONIGHT_PROMPT = `Franck a la flemme ce soir. Propose UN repas ultra-rapide (5-15 min max) avec ce qu'il a en inventaire.
Réponds UNIQUEMENT avec un JSON valide (pas de backticks) :
{"plat":"Nom","temps":"10 min","ingredients":[{"nom":"...","quantite":"..."}],"etapes":["..."],"conseil":"..."}`;

const PARSE_PROMPT = `Extrait chaque ingrédient/aliment de ce texte. Normalise les noms (ex: "lhuile dolive" → "huile d'olive").
Réponds UNIQUEMENT avec un tableau JSON valide (pas de backticks) :
[{"nom": "riz", "qty": "1 sachet"}, {"nom": "huile d'olive", "qty": "—"}]
Si pas de quantité précise, mets "—".`;

// ── STATE ──────────────────────────────────────────────────────
let step = 0, answers = {}, conversationHistory = [], currentData = null;
let inventaire = [], historique = [], ratings = {}, repaisFaits = {}, streak = 0;
let allergenes = [], aimepas = [];

// ── LOADING ────────────────────────────────────────────────────
const MSGS = ["🐀 En train d'appâter Ratatouille...","🍅 Récolte des tomates...","🔪 Julienne de carottes...","🧅 Les oignons font pleurer...","🫕 Mijotage à feu doux...","🧄 Négociation avec l'ail...","🌿 Cueillette des herbes...","🍳 Chauffage de la poêle...","🥄 Goûtage qualité...","🧑‍🍳 Consultation des grimoires...","🛒 Passage au marché...","🥚 Comptage des œufs..."];
let loadingInterval = null;
function startLoading(txt) {
  let i = 0;
  const el = document.getElementById('loading-text');
  el.textContent = txt || MSGS[0];
  loadingInterval = setInterval(() => { i = (i+1)%MSGS.length; el.textContent = MSGS[i]; }, 2000);
}
function stopLoading() { if (loadingInterval) { clearInterval(loadingInterval); loadingInterval = null; } }

// ── SCREENS ────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  el.classList.add('active');
}

function addMsg(text, type) {
  const wrap = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `msg ${type}`;
  div.textContent = text;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

// ── API ────────────────────────────────────────────────────────
async function callAPI(messages, system) {
  const res = await fetch('/api?action=chat', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ system: system||SYSTEM_PROMPT, messages })
  });
  console.log('📡 Status:', res.status);
  const text = await res.text();
  console.log('📦 Réponse:', text.slice(0,200));
  const data = JSON.parse(text);
  return data.content?.[0]?.text || '';
}

function parseJSON(str) {
  let clean = str.trim().replace(/^```[a-z]*\n?/,'').replace(/```$/,'').trim();
  return JSON.parse(clean);
}

// ── GIST ───────────────────────────────────────────────────────
async function saveToGist(payload) {
  try {
    await fetch('/api?action=save', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ data: payload })
    });
    console.log('💾 Sauvegardé');
  } catch(e) { console.log('❌ Save error:', e); }
}

async function loadFromGist() {
  try {
    const res = await fetch('/api?action=load');
    return JSON.parse(await res.text());
  } catch(e) { return null; }
}

async function persistAll() {
  await saveToGist({ planning: currentData, inventaire, historique, ratings, repaisFaits, streak, allergenes, aimepas });
}

// ── INVENTAIRE ─────────────────────────────────────────────────
function renderInventaire() {
  const el = document.getElementById('inventaire-list');
  if (!inventaire.length) { el.innerHTML = '<p class="inv-empty">Aucun article. Ajoute ce que tu as !</p>'; return; }
  el.innerHTML = inventaire.map((item, i) => `
    <div class="inv-item">
      <span class="inv-nom">${item.nom}</span>
      <input class="inv-qty-input" value="${item.qty}" onchange="updateInvQty(${i}, this.value)" title="Cliquer pour modifier" />
      <button class="inv-btn del" onclick="deleteInvItem(${i})">✕</button>
    </div>
  `).join('');
}

function updateInvQty(i, val) {
  inventaire[i].qty = val;
  persistAll();
}

function deleteInvItem(i) {
  inventaire.splice(i,1);
  renderInventaire();
  persistAll();
}

function clearInventaire() {
  if (!confirm('Vider tout l\'inventaire ?')) return;
  inventaire = [];
  renderInventaire();
  persistAll();
}

function addInvItem() {
  const nom = document.getElementById('inv-nom').value.trim();
  const qty = document.getElementById('inv-qty').value.trim();
  if (!nom) return;
  if (!inventaire.find(i => i.nom.toLowerCase()===nom.toLowerCase())) inventaire.push({nom, qty: qty||'—'});
  document.getElementById('inv-nom').value = '';
  document.getElementById('inv-qty').value = '';
  renderInventaire();
  persistAll();
}

function inventaireToText() {
  if (!inventaire.length) return 'Aucun article.';
  return inventaire.map(i => `- ${i.nom} : ${i.qty}`).join('\n');
}

async function parseInventaireWithClaude(text) {
  if (!text || text.trim().length < 2) return [];
  try {
    const reply = await callAPI([{role:'user', content:`Texte : "${text.replace(/"/g,"'")}"`}], PARSE_PROMPT);
    const parsed = parseJSON(reply);
    const nouveaux = [];
    parsed.forEach(item => {
      if (!item.nom || item.nom.length < 2) return;
      if (!inventaire.find(i => i.nom.toLowerCase()===item.nom.toLowerCase())) {
        inventaire.push({nom: item.nom, qty: item.qty||'—'});
        nouveaux.push(item.nom);
      }
    });
    return nouveaux;
  } catch(e) { console.error('❌ Parse error:', e); return []; }
}

// ── COURSES ────────────────────────────────────────────────────
function toggleCourseItem(nom, checked) {
  if (checked) {
    if (!inventaire.find(i => i.nom.toLowerCase()===nom.toLowerCase()))
      inventaire.push({nom, qty:'✓ acheté'});
  } else {
    const idx = inventaire.findIndex(i => i.nom.toLowerCase()===nom.toLowerCase() && i.qty==='✓ acheté');
    if (idx!==-1) inventaire.splice(idx,1);
  }
  renderInventaire();
  persistAll();
}

function renderCourses(courses, total) {
  const el = document.getElementById('courses-content');
  el.innerHTML = '';
  courses.forEach(rayon => {
    const block = document.createElement('div');
    block.className = 'rayon-block';
    block.innerHTML = `<div class="rayon-title">${rayon.rayon}</div>`;
    rayon.items.forEach(item => {
      const bought = inventaire.find(i => i.nom.toLowerCase()===item.nom.toLowerCase());
      const row = document.createElement('div');
      row.className = `course-item${bought?' done':''}`;
      const id = `chk-${item.nom.replace(/\s+/g,'-').replace(/[^a-zA-Z0-9-]/g,'')}`;
      row.innerHTML = `
        <label class="course-label" for="${id}">
          <input type="checkbox" id="${id}" class="course-check" ${bought?'checked':''} />
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

// ── RATINGS ────────────────────────────────────────────────────
function setRating(jourNom, platNom, value) {
  const key = `${jourNom}__${platNom}`;
  ratings[key] = value;
  persistAll();
  renderAgenda(currentData);
}

function getRating(jourNom, platNom) {
  return ratings[`${jourNom}__${platNom}`] || null;
}

// ── HISTORIQUE ─────────────────────────────────────────────────
function saveToHistorique(data) {
  if (!data) return;
  const exists = historique.find(h => h.semaine === data.semaine);
  if (!exists) historique.unshift({ semaine: data.semaine, jours: data.jours.map(j => ({jour: j.jour, plat: j.plat})) });
  if (historique.length > 10) historique = historique.slice(0,10);
}

function deleteHistorique(idx) {
  historique.splice(idx, 1);
  renderHistorique();
  persistAll();
}

function clearHistorique() {
  if (!confirm('Supprimer tout l\'historique ?')) return;
  historique = [];
  renderHistorique();
  persistAll();
}

function renderHistorique() {
  const el = document.getElementById('historique-list');
  if (!historique.length) { el.innerHTML = '<p class="hist-empty">Aucun historique pour l\'instant.</p>'; return; }
  el.innerHTML = `
    <div class="hist-toolbar">
      <span class="hist-count">${historique.length} semaine${historique.length>1?'s':''}</span>
      <button class="btn-danger-sm" onclick="clearHistorique()">Tout supprimer</button>
    </div>
    ${historique.map((h, idx) => `
      <div class="hist-card">
        <div class="hist-header">
          <span class="hist-semaine">${h.semaine}</span>
          <button class="hist-delete-btn" onclick="deleteHistorique(${idx})" title="Supprimer">✕</button>
        </div>
        <div class="hist-plats">
          ${h.jours.map(j => {
            const r = getRating(j.jour, j.plat);
            const cls = r===1?' liked':r===-1?' disliked':'';
            return `<span class="hist-plat${cls}">${r===1?'👍 ':r===-1?'👎 ':''}${j.plat}</span>`;
          }).join('')}
        </div>
      </div>
    `).join('')}
  `;
}

// ── AGENDA ─────────────────────────────────────────────────────
function getTodayDay() {
  const days = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  return days[new Date().getDay()];
}

function getWeekDays() {
  const dayNames = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const ordered = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
  const today = new Date();
  const todayName = dayNames[today.getDay()];
  const startIdx = ordered.indexOf(todayName);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const name = ordered[(startIdx + i) % 7];
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    days.push({ jour: name, date: `${dd}/${mm}`, full: d });
  }
  return days;
}

function getWeekLabel() {
  const days = getWeekDays();
  return `Semaine du ${days[0].date} au ${days[6].date}`;
}

function getWeekPromptText() {
  const days = getWeekDays();
  const lines = days.map(d => `- ${d.jour} ${d.date}`).join('\n');
  return `La semaine à planifier est :\n${lines}\nUtilise EXACTEMENT ces jours et ces dates dans le JSON.`;
}

function getDayNum(jourNom, semaine) {
  try {
    // Cherche toutes les dates dans la semaine "du JJ/MM au JJ/MM"
    const matches = semaine.match(/(\d{2}\/\d{2})/g);
    if (!matches || matches.length < 2) return '';
    const days = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
    // Trouver le jour de départ depuis le label
    const startParts = matches[0].split('/');
    const startDate = new Date();
    startDate.setDate(parseInt(startParts[0]));
    startDate.setMonth(parseInt(startParts[1])-1);
    const startDayName = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'][startDate.getDay()];
    const startIdx = days.indexOf(startDayName);
    const jourIdx = days.indexOf(jourNom);
    if (startIdx === -1 || jourIdx === -1) return '';
    const offset = (jourIdx - startIdx + 7) % 7;
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + offset);
    return String(d.getDate()).padStart(2,'0');
  } catch(e) { return ''; }
}

function renderAgenda(data) {
  const el = document.getElementById('agenda');
  const today = getTodayDay();
  el.innerHTML = '';
  data.jours.forEach((jour, i) => {
    const isToday = jour.jour === today;
    const isFait = isRepaisFait(jour.jour, jour.plat);
    const rating = getRating(jour.jour, jour.plat);
    const allInStock = jour.ingredients && jour.ingredients.every(ing => ing.dans_inventaire);
    const dayNum = getDayNum(jour.jour, data.semaine);
    const row = document.createElement('div');
    row.className = 'agenda-row';
    row.innerHTML = `
      <div class="agenda-day${isToday?' today':''}">
        <span class="agenda-day-name">${jour.jour.slice(0,3)}</span>
        <span class="agenda-day-num">${dayNum}</span>
      </div>
      <div class="agenda-content">
        <div class="agenda-meal">
          <div class="agenda-meal-name">${jour.plat}</div>
          <div class="agenda-badges">
            <span class="badge badge-time">⏱ ${jour.temps}</span>
            ${jour.flemme?'<span class="badge badge-flemme">⚡ flemme</span>':''}
            ${allInStock?'<span class="badge badge-stock">✓ tout en stock</span>':''}
            ${isFait?'<span class="badge badge-stock">✓ fait</span>':''}
            ${rating===1?'<span class="badge badge-rating-good">👍 aimé</span>':rating===-1?'<span class="badge badge-rating-bad">👎 pas aimé</span>':''}
          </div>
        </div>
        <div class="agenda-actions">
          <button class="agenda-done-btn${isFait?' active':''}" onclick="event.stopPropagation(); toggleRepaisFait('${jour.jour}','${jour.plat}')">${isFait?'✓ Fait':'✓ Fait ?'}</button>
          <button class="agenda-change-btn" data-idx="${i}" onclick="event.stopPropagation(); changeDay(${i})">↺</button>
          <div class="agenda-rating">
            <button class="rating-btn${rating===1?' active':''}" onclick="event.stopPropagation(); setRating('${jour.jour}','${jour.plat}',1)" title="J'ai aimé">👍</button>
            <button class="rating-btn${rating===-1?' active':''}" onclick="event.stopPropagation(); setRating('${jour.jour}','${jour.plat}',-1)" title="Pas aimé">👎</button>
          </div>
          <span class="agenda-arrow">›</span>
        </div>
      </div>
    `;
    row.querySelector('.agenda-content').addEventListener('click', () => openRecipe(jour));
    el.appendChild(row);
  });
}

// ── CHANGER 1 JOUR ─────────────────────────────────────────────
async function changeDay(idx) {
  const jour = currentData.jours[idx];
  const btn = document.querySelector(`[data-idx="${idx}"]`);
  if (btn) { btn.textContent = '...'; btn.disabled = true; }
  try {
    const msg = `Inventaire:\n${inventaireToText()}\nRemplace le repas du ${jour.jour} (actuellement: ${jour.plat}). Plat différent, utilise l'inventaire en priorité.`;
    const reply = await callAPI([{role:'user',content:msg}], SINGLE_DAY_PROMPT);
    const newJour = parseJSON(reply);
    newJour.jour = jour.jour;
    currentData.jours[idx] = newJour;
    await persistAll();
    renderAgenda(currentData);
    renderCourses(currentData.courses, currentData.total);
    console.log('✅ Jour changé:', jour.jour, '→', newJour.plat);
  } catch(e) {
    console.error('❌ Erreur changeDay:', e);
    if (btn) { btn.textContent = '↺ changer'; btn.disabled = false; }
  }
}

// ── CE SOIR ────────────────────────────────────────────────────
function openTonightModal() {
  document.getElementById('tonight-result').innerHTML = '';
  document.getElementById('tonight-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

async function generateTonight() {
  const btn = document.getElementById('tonight-generate-btn');
  btn.textContent = '⏳ En cours...';
  btn.disabled = true;
  try {
    const msg = `Inventaire de Franck:\n${inventaireToText()}\nPropose un repas ultra-rapide avec ce qu'il a.`;
    const reply = await callAPI([{role:'user',content:msg}], TONIGHT_PROMPT);
    const recipe = parseJSON(reply);
    document.getElementById('tonight-result').innerHTML = `
      <div class="tonight-recipe">
        <div class="tonight-recipe-name">${recipe.plat} — ${recipe.temps}</div>
        <div class="modal-section-title" style="margin-top:1rem">Ingrédients</div>
        <ul class="ingredients-list">${recipe.ingredients.map(i=>`<li><span>${i.nom}</span><span class="ing-qty">${i.quantite}</span></li>`).join('')}</ul>
        <div class="modal-section-title">Préparation</div>
        <ol class="steps-list">${recipe.etapes.map(e=>`<li>${e}</li>`).join('')}</ol>
        ${recipe.conseil?`<div class="tip-box">💡 ${recipe.conseil}</div>`:''}
      </div>
    `;
    btn.textContent = '↺ Autre idée';
    btn.disabled = false;
  } catch(e) {
    console.error('❌ Tonight error:', e);
    btn.textContent = 'Réessayer';
    btn.disabled = false;
  }
}

// ── RECIPE MODAL ───────────────────────────────────────────────
function openRecipe(jour) {
  const modal = document.getElementById('recipe-modal');
  const rating = getRating(jour.jour, jour.plat);
  document.getElementById('modal-content').innerHTML = `
    <div class="modal-day">${jour.jour}</div>
    <div class="modal-title">${jour.plat}</div>
    <div class="agenda-badges" style="margin-bottom:1.25rem">
      <span class="badge badge-time">⏱ ${jour.temps}</span>
      ${jour.flemme?'<span class="badge badge-flemme">⚡ flemme</span>':''}
    </div>
    <div class="modal-section-title">Ingrédients</div>
    <ul class="ingredients-list">${jour.ingredients.map(i=>`
      <li><span>${i.nom}${i.dans_inventaire?'<span class="ing-stock">✓ stock</span>':''}</span><span class="ing-qty">${i.quantite}</span></li>
    `).join('')}</ul>
    <div class="modal-section-title">Préparation</div>
    <ol class="steps-list">${jour.etapes.map((e,i)=>`
      <li>
        <span class="step-text">${e}</span>
        <button class="step-help-btn" onclick="event.stopPropagation(); toggleStepCoach(this, '${jour.plat.replace(/'/g,"\\'")}', ${i}, \`${e.replace(/`/g,"\\`").replace(/'/g,"\\'")}  \`)">?</button>
        <div class="step-coach hidden">
          <div class="step-coach-messages"></div>
          <div class="step-coach-input">
            <input type="text" placeholder="Pose ta question à Franck..." class="step-coach-field" />
            <button class="step-coach-send" onclick="askCoach(this)">↑</button>
          </div>
        </div>
      </li>
    `).join('')}</ol>
    ${jour.conseil?`<div class="tip-box">💡 ${jour.conseil}</div>`:''}
    <div class="modal-rating">
      <span class="modal-rating-label">Ce plat ?</span>
      <div class="modal-rating-btns">
        <button class="rating-modal-btn good${rating===1?' active':''}" onclick="setRating('${jour.jour}','${jour.plat}',1); updateModalRating(this, 'good')">👍 J'ai aimé</button>
        <button class="rating-modal-btn bad${rating===-1?' active':''}" onclick="setRating('${jour.jour}','${jour.plat}',-1); updateModalRating(this, 'bad')">👎 Pas aimé</button>
      </div>
    </div>
  `;
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function updateModalRating(btn, type) {
  document.querySelectorAll('.rating-modal-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ── PRÉFÉRENCES ────────────────────────────────────────────────
function renderPrefs() {
  renderPrefList('allergenes-list', allergenes, 'allergenes');
  renderPrefList('aimepas-list', aimepas, 'aimepas');
}

function renderPrefList(elId, list, type) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!list.length) {
    el.innerHTML = `<p class="prefs-empty">Aucun élément. Ajoute ce que tu veux éviter !</p>`;
    return;
  }
  el.innerHTML = list.map((item, i) => `
    <div class="prefs-item">
      <span class="prefs-item-name">${item}</span>
      <button class="inv-btn del" onclick="deletePref('${type}', ${i})">✕</button>
    </div>
  `).join('');
}

function addPref(type) {
  const inputId = type === 'allergenes' ? 'allergene-input' : 'aimepas-input';
  const input = document.getElementById(inputId);
  const val = input.value.trim();
  if (!val) return;
  const list = type === 'allergenes' ? allergenes : aimepas;
  if (!list.includes(val.toLowerCase())) list.push(val.toLowerCase());
  input.value = '';
  renderPrefs();
  persistAll();
}

function deletePref(type, i) {
  if (type === 'allergenes') allergenes.splice(i, 1);
  else aimepas.splice(i, 1);
  renderPrefs();
  persistAll();
}

function prefsToPromptText() {
  let txt = '';
  if (allergenes.length) txt += `\nALLERGÈNES (JAMAIS dans aucune recette) : ${allergenes.join(', ')}`;
  if (aimepas.length) txt += `\nN'AIME PAS (à éviter autant que possible) : ${aimepas.join(', ')}`;
  return txt;
}

// ── REPAS FAITS & STREAK ───────────────────────────────────────
function toggleRepaisFait(jourNom, platNom) {
  const key = `${jourNom}__${platNom}`;
  repaisFaits[key] = !repaisFaits[key];
  recalcStreak();
  persistAll();
  renderAgenda(currentData);
  renderStats();
}

function isRepaisFait(jourNom, platNom) {
  return !!repaisFaits[`${jourNom}__${platNom}`];
}

function recalcStreak() {
  if (!currentData) return;
  const days = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
  const today = getTodayDay();
  const todayIdx = days.indexOf(today);
  let count = 0;
  for (let i = 0; i <= todayIdx; i++) {
    const jour = currentData.jours[i];
    if (jour && isRepaisFait(jour.jour, jour.plat)) count++;
    else if (i < todayIdx) { count = 0; } // trou dans le streak
  }
  streak = count;
  const el = document.getElementById('streak-count');
  if (el) el.textContent = streak;
}

// ── STATS ───────────────────────────────────────────────────────
function renderStats() {
  const el = document.getElementById('stats-content');
  if (!el) return;

  const totalFaits = Object.values(repaisFaits).filter(Boolean).length;
  const totalSemaines = historique.length;
  const platsLikes = Object.entries(ratings).filter(([,v])=>v===1).length;
  const platsDislike = Object.entries(ratings).filter(([,v])=>v===-1).length;

  // Top plats aimés
  const topPlats = Object.entries(ratings)
    .filter(([,v])=>v===1)
    .map(([k])=>k.split('__')[1])
    .slice(0,5);

  // Ingrédients inventaire les plus utilisés
  const invCount = inventaire.length;

  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">🔥</div>
        <div class="stat-value">${streak}</div>
        <div class="stat-label">Streak actuel</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">✅</div>
        <div class="stat-value">${totalFaits}</div>
        <div class="stat-label">Repas faits cette semaine</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">📅</div>
        <div class="stat-value">${totalSemaines}</div>
        <div class="stat-label">Semaines planifiées</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">📦</div>
        <div class="stat-value">${invCount}</div>
        <div class="stat-label">Articles en stock</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">👍</div>
        <div class="stat-value">${platsLikes}</div>
        <div class="stat-label">Plats aimés</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">👎</div>
        <div class="stat-value">${platsDislike}</div>
        <div class="stat-label">Plats pas aimés</div>
      </div>
    </div>
    ${topPlats.length ? `
      <div class="stats-section">
        <div class="stats-section-title">Tes plats préférés</div>
        <div class="stats-plats">${topPlats.map(p=>`<span class="hist-plat liked">👍 ${p}</span>`).join('')}</div>
      </div>
    ` : ''}
  `;
}

// ── MODE MARCHÉ ─────────────────────────────────────────────────
function openMarcheMode() {
  if (!currentData) return;
  const modal = document.getElementById('marche-modal');
  const content = document.getElementById('marche-content');
  content.innerHTML = `
    <div class="marche-header">
      <h2 class="marche-title">🛒 Liste de courses</h2>
      <p class="marche-week">${currentData.semaine}</p>
    </div>
    ${currentData.courses.map(rayon => `
      <div class="marche-rayon">
        <div class="marche-rayon-title">${rayon.rayon}</div>
        ${rayon.items.map(item => {
          const bought = inventaire.find(i => i.nom.toLowerCase()===item.nom.toLowerCase());
          const id = `m-${item.nom.replace(/\s+/g,'-').replace(/[^a-zA-Z0-9-]/g,'')}`;
          return `
            <label class="marche-item${bought?' done':''}" for="${id}">
              <input type="checkbox" id="${id}" ${bought?'checked':''} onchange="toggleMarcheItem('${item.nom.replace(/'/g,"\\'")}', this.checked, this)" />
              <span class="marche-check-box"></span>
              <span class="marche-nom">${item.nom}</span>
              <span class="marche-prix">${item.prix}</span>
            </label>
          `;
        }).join('')}
      </div>
    `).join('')}
    <div class="marche-total">
      <span>Total</span><span>${currentData.total}</span>
    </div>
  `;
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function toggleMarcheItem(nom, checked, input) {
  toggleCourseItem(nom, checked);
  const label = input.closest('.marche-item');
  label.classList.toggle('done', checked);
  // Sync avec l'onglet courses
  renderCourses(currentData.courses, currentData.total);
}

// ── PARTAGE PLANNING ────────────────────────────────────────────
async function shareePlanning() {
  if (!currentData) return;
  const btn = document.getElementById('share-btn');
  btn.textContent = '⏳ Génération...';
  btn.disabled = true;

  try {
    // Créer un canvas avec le planning
    const canvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 800 * dpr;
    canvas.height = 900 * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Fond
    ctx.fillStyle = '#FAF7F0';
    ctx.fillRect(0, 0, 800, 900);

    // Header
    ctx.fillStyle = '#D4611A';
    ctx.fillRect(0, 0, 800, 80);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 28px serif';
    ctx.textAlign = 'center';
    ctx.fillText('🍳 Franck le Cuisto', 400, 38);
    ctx.font = '16px monospace';
    ctx.fillText(currentData.semaine, 400, 62);

    // Jours
    const days = currentData.jours;
    const colW = 800 / 7;
    ctx.textAlign = 'center';

    days.forEach((jour, i) => {
      const x = i * colW;
      const isToday = jour.jour === getTodayDay();

      // Bg colonne
      ctx.fillStyle = isToday ? '#FDF0E4' : (i%2===0 ? '#FFFCF5' : '#FAF7F0');
      ctx.fillRect(x, 80, colW, 820);

      // Bordure
      ctx.strokeStyle = '#DDD0B8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 80);
      ctx.lineTo(x, 900);
      ctx.stroke();

      // Jour
      ctx.fillStyle = isToday ? '#D4611A' : '#9A8060';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(jour.jour.slice(0,3).toUpperCase(), x + colW/2, 105);

      // Plat (wrap text)
      ctx.fillStyle = '#2C1F0E';
      ctx.font = 'bold 13px serif';
      const words = jour.plat.split(' ');
      let line = '', lines = [], y = 140;
      words.forEach(w => {
        const test = line + w + ' ';
        if (ctx.measureText(test).width > colW - 12) { lines.push(line); line = w + ' '; }
        else line = test;
      });
      lines.push(line);
      lines.slice(0,3).forEach((l,li) => {
        ctx.fillText(l.trim(), x + colW/2, y + li*18);
      });

      // Temps
      ctx.fillStyle = '#9A8060';
      ctx.font = '11px monospace';
      ctx.fillText('⏱ ' + jour.temps, x + colW/2, 210);

      // Flemme badge
      if (jour.flemme) {
        ctx.fillStyle = '#C49020';
        ctx.font = 'bold 10px monospace';
        ctx.fillText('⚡ flemme', x + colW/2, 228);
      }
    });

    // Footer
    ctx.fillStyle = '#E8E0CC';
    ctx.fillRect(0, 860, 800, 40);
    ctx.fillStyle = '#9A8060';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Généré avec Franck le Cuisto 🍳', 400, 885);

    // Export
    canvas.toBlob(async blob => {
      try {
        if (navigator.share && navigator.canShare({files:[new File([blob],'planning.png',{type:'image/png'})]})) {
          await navigator.share({
            title: 'Mon planning repas',
            text: currentData.semaine,
            files: [new File([blob], 'planning.png', {type:'image/png'})]
          });
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = 'planning-semaine.png';
          a.click();
          URL.revokeObjectURL(url);
        }
      } catch(e) { console.log('Share cancelled'); }
      btn.textContent = '📤 Partager';
      btn.disabled = false;
    }, 'image/png');

  } catch(e) {
    console.error('Share error:', e);
    btn.textContent = '📤 Partager';
    btn.disabled = false;
  }
}

// ── COACH PAR ÉTAPE ────────────────────────────────────────────
async function toggleStepCoach(btn, platNom, stepIdx, stepText) {
  const coachEl = btn.nextElementSibling;
  const isOpen = !coachEl.classList.contains('hidden');
  if (isOpen) { coachEl.classList.add('hidden'); btn.classList.remove('active'); return; }
  coachEl.classList.remove('hidden');
  btn.classList.add('active');
  // Si pas encore de message, générer l'explication initiale
  const messagesEl = coachEl.querySelector('.step-coach-messages');
  if (!messagesEl.children.length) {
    await generateCoachMsg(messagesEl, platNom, stepText, null);
  }
  coachEl.querySelector('.step-coach-field').focus();
}

async function askCoach(sendBtn) {
  const coachEl = sendBtn.closest('.step-coach');
  const input = coachEl.querySelector('.step-coach-field');
  const question = input.value.trim();
  if (!question) return;
  const messagesEl = coachEl.querySelector('.step-coach-messages');
  const li = sendBtn.closest('li');
  const stepText = li.querySelector('.step-text').textContent;
  const platNom = document.querySelector('.modal-title')?.textContent || '';
  // Afficher la question
  const qDiv = document.createElement('div');
  qDiv.className = 'coach-msg user';
  qDiv.textContent = question;
  messagesEl.appendChild(qDiv);
  input.value = '';
  await generateCoachMsg(messagesEl, platNom, stepText, question);
}

async function generateCoachMsg(messagesEl, platNom, stepText, question) {
  const loadEl = document.createElement('div');
  loadEl.className = 'coach-msg bot loading';
  loadEl.textContent = '🍳 Franck réfléchit...';
  messagesEl.appendChild(loadEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  try {
    const userMsg = question
      ? `Recette : ${platNom}\nÉtape : ${stepText}\nQuestion : ${question}`
      : `Recette : ${platNom}\nÉtape : ${stepText}\nExplique cette étape simplement pour un débutant.`;
    const reply = await callAPI([{role:'user', content:userMsg}], COACH_PROMPT);
    loadEl.className = 'coach-msg bot';
    loadEl.textContent = reply;
  } catch(e) {
    loadEl.className = 'coach-msg bot error';
    loadEl.textContent = 'Oups, réessaie !';
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function closeModal(id) {
  document.getElementById(id||'recipe-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

// ── COPY COURSES ───────────────────────────────────────────────
function copyCourses() {
  if (!currentData) return;
  let text = `🛒 ${currentData.semaine}\n\n`;
  currentData.courses.forEach(r => {
    text += `${r.rayon.toUpperCase()}\n`;
    r.items.forEach(i => { text += `• ${i.nom} — ${i.prix}\n`; });
    text += '\n';
  });
  text += `TOTAL : ${currentData.total}`;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copy-courses-btn');
    btn.textContent = '✅ Copié !';
    setTimeout(() => { btn.textContent = '📋 Copier la liste'; }, 2000);
  });
}

// ── RENDER PLANNING ────────────────────────────────────────────
function renderPlanning(data) {
  currentData = data;
  if (data.couleur) document.documentElement.style.setProperty('--warm', data.couleur);
  document.getElementById('week-label').textContent = data.semaine||'Semaine en cours';
  renderAgenda(data);
  renderCourses(data.courses, data.total);
  renderInventaire();
  renderHistorique();
  recalcStreak();
  showScreen('planning-screen');
}

// ── HANDLE SEND ────────────────────────────────────────────────
async function handleSend() {
  const input = document.getElementById('chat-input');
  const val = input.value.trim();
  if (!val) return;
  input.value = '';
  addMsg(val, 'user');
  conversationHistory.push({role:'user', content:val});

  if (step===0) {
    answers.budget = val; step++;
    const invText = inventaireToText();
    const q2 = inventaire.length
      ? `Voilà ton inventaire :\n${invText}\n\nJe vais tout utiliser en priorité. Tu as autre chose ?`
      : 'Tu as quelque chose dans les placards ou le frigo ?';
    setTimeout(() => addMsg(q2,'bot'), 400);
    conversationHistory.push({role:'assistant', content:q2});

  } else if (step===1) {
    answers.placards = val; step++;
    const tmpMsg = addMsg('⏳ J\'analyse ce que tu as...', 'bot');
    parseInventaireWithClaude(val).then(nouveaux => {
      tmpMsg.remove();
      if (nouveaux.length) {
        addMsg(`✅ Ajouté : ${nouveaux.join(', ')}`, 'bot');
        renderInventaire(); persistAll();
      }
      setTimeout(() => addMsg('Des aliments que tu veux éviter cette semaine ?', 'bot'), 300);
      conversationHistory.push({role:'assistant', content:'Des aliments que tu veux éviter ?'});
    });

  } else if (step===2) {
    answers.eviter = val; step++;
    showScreen('loading-screen');
    startLoading();
    try {
      const badRatings = Object.entries(ratings).filter(([,v])=>v===-1).map(([k])=>k.split('__')[1]);
      const ratingHint = badRatings.length ? `\nPlats que Franck n'a pas aimés (à éviter) : ${badRatings.join(', ')}` : '';
      const prefsHint = prefsToPromptText();
      const weekText = getWeekPromptText();
      const finalMsg = `${weekText}\n\nBudget: ${answers.budget}\nInventaire:\n${inventaireToText()}\nAutre: ${answers.placards}\nÀ éviter cette semaine: ${answers.eviter}${prefsHint}${ratingHint}\n\nGénère le planning JSON.`;
      conversationHistory.push({role:'user',content:finalMsg});
      const reply = await callAPI(conversationHistory);
      const data = parseJSON(reply);
      currentData = data;
      saveToHistorique(data);
      await persistAll();
      stopLoading();
      renderPlanning(data);
      console.log('🎉 Planning prêt !');
    } catch(e) {
      stopLoading();
      showScreen('chat-screen');
      addMsg("Oups, une erreur s'est produite. Réessaie !", 'bot');
      step=2;
      console.error('❌', e);
    }
  }
}

// ── RESET / START ───────────────────────────────────────────────
function resetWeek() {
  if (!confirm("Recommencer le planning ? L'inventaire reste intact.")) return;
  if (currentData) saveToHistorique(currentData);
  currentData = null;
  saveToGist({planning:null, inventaire, historique, ratings});
  startChat();
}

function startChat() {
  step=0; answers={}; conversationHistory=[];
  document.getElementById('chat-messages').innerHTML='';
  showScreen('chat-screen');
  setTimeout(() => {
    addMsg("Salut ! On planifie ta semaine 🍳", 'bot');
    conversationHistory.push({role:'assistant',content:"Salut !"});
    setTimeout(() => {
      addMsg("Quel est ton budget courses cette semaine ? (en €)", 'bot');
      conversationHistory.push({role:'assistant',content:"Budget ?"});
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
    if (saved.historique) historique = saved.historique;
    if (saved.ratings) ratings = saved.ratings;
    if (saved.repaisFaits) repaisFaits = saved.repaisFaits;
    if (saved.streak) streak = saved.streak;
    if (saved.allergenes) allergenes = saved.allergenes;
    if (saved.aimepas) aimepas = saved.aimepas;
    const planning = saved.planning || (saved.jours ? saved : null);
    if (planning?.jours?.length === 7) { renderPlanning(planning); return; }
  }
  renderInventaire();
  renderPrefs();
  showScreen('setup-screen');
}

// ── EVENTS ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  init();
  document.getElementById('start-btn').addEventListener('click', startChat);
  document.getElementById('new-week-btn').addEventListener('click', startChat);
  document.getElementById('reset-week-btn').addEventListener('click', resetWeek);
  document.getElementById('tonight-btn').addEventListener('click', openTonightModal);
  document.getElementById('marche-btn').addEventListener('click', openMarcheMode);
  document.getElementById('marche-modal').addEventListener('click', e => { if(e.target.id==='marche-modal') closeModal('marche-modal'); });
  document.getElementById('tonight-generate-btn').addEventListener('click', generateTonight);
  document.getElementById('tonight-modal-close').addEventListener('click', () => closeModal('tonight-modal'));
  document.getElementById('tonight-modal').addEventListener('click', e => { if (e.target.id==='tonight-modal') closeModal('tonight-modal'); });
  document.getElementById('chat-send').addEventListener('click', handleSend);
  document.getElementById('chat-input').addEventListener('keydown', e => { if(e.key==='Enter') handleSend(); });
  document.getElementById('modal-close').addEventListener('click', () => closeModal('recipe-modal'));
  document.getElementById('recipe-modal').addEventListener('click', e => { if(e.target.id==='recipe-modal') closeModal('recipe-modal'); });
  document.getElementById('copy-courses-btn').addEventListener('click', copyCourses);
  document.getElementById('inv-add-btn').addEventListener('click', addInvItem);
  document.getElementById('inv-clear-btn').addEventListener('click', clearInventaire);
  document.getElementById('inv-qty').addEventListener('keydown', e => { if(e.key==='Enter') addInvItem(); });
  document.getElementById('allergene-add-btn').addEventListener('click', () => addPref('allergenes'));
  document.getElementById('aimepas-add-btn').addEventListener('click', () => addPref('aimepas'));
  document.getElementById('allergene-input').addEventListener('keydown', e => { if(e.key==='Enter') addPref('allergenes'); });
  document.getElementById('aimepas-input').addEventListener('keydown', e => { if(e.key==='Enter') addPref('aimepas'); });

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
      if (tab.dataset.tab==='historique') renderHistorique();
      if (tab.dataset.tab==='stats') { renderStats(); recalcStreak(); }
      if (tab.dataset.tab==='prefs') renderPrefs();
    });
  });
});
