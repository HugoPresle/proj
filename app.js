const SYSTEM_PROMPT = `Tu es l'assistant repas de Franck. Ton rôle : l'aider à planifier ses repas de la semaine.

PROFIL DE FRANCK
- 26 ans, musculation et skate
- Ne cuisinait pas du tout avant, apprend progressivement
- Mange seul, pour 1 personne
- Équipement : 2 plaques, 2 casseroles, 2 poêles (dont une poêle à crêpes). Pas de four, pas de micro-ondes.
- Objectif : arrêter de sauter des repas, découvrir des plats simples et bons

DÉROULEMENT
Tu dois poser 3 questions dans l'ordre, une par une, en attendant la réponse à chaque fois :
1. "Quel est ton budget courses cette semaine ? (en €)"
2. "Qu'est-ce que tu as déjà dans les placards ou le frigo ?"
3. "Des aliments que tu n'aimes pas ou veux éviter cette semaine ?"

Une fois les 3 réponses obtenues, réponds UNIQUEMENT avec un objet JSON valide (pas de texte avant ou après, pas de backticks) avec cette structure exacte :

{
  "semaine": "Semaine du [date samedi] au [date vendredi]",
  "couleur": "#[couleur hex vive et différente chaque semaine]",
  "jours": [
    {
      "jour": "Samedi",
      "plat": "Nom du plat",
      "flemme": false,
      "temps": "25 min",
      "ingredients": [
        { "nom": "Poulet", "quantite": "200g" }
      ],
      "etapes": [
        "Couper le poulet en morceaux.",
        "Faire chauffer la poêle à feu moyen."
      ],
      "conseil": "Astuce ou ordre de cuisson si besoin"
    }
  ],
  "courses": [
    {
      "rayon": "Viandes & poissons",
      "items": [
        { "nom": "Blanc de poulet", "prix": "3.50€" }
      ]
    }
  ],
  "total": "45€"
}

RÈGLES ABSOLUES
- Exactement 7 jours : Samedi, Dimanche, Lundi, Mardi, Mercredi, Jeudi, Vendredi
- 1 à 2 repas flemme max (flemme: true), temps 5-10 min
- Autres repas : 20 à 40 min
- Légumes de saison
- Varier les plats, jamais les mêmes deux semaines de suite
- Langage simple, pas de termes de chef
- Ne jamais supposer que Franck sait déjà faire un plat
- Uniquement cuisson sur plaque/poêle/casserole
- Chaque semaine une couleur dominante différente et vive pour le design`;

const CHAT_INTRO = "Salut ! Je suis Franck le Cuisto, ton assistant repas 🍳 On va planifier ta semaine ensemble. Pour commencer :";
const Q1 = "Quel est ton budget courses cette semaine ? (en €)";
const Q2 = "Qu'est-ce que tu as déjà dans les placards ou le frigo ?";
const Q3 = "Des aliments que tu n'aimes pas ou veux éviter cette semaine ?";

let step = 0;
let answers = {};
let conversationHistory = [];
let currentData = null;

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
}

async function callAPI(messages) {
  const res = await fetch('/api?action=chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system: SYSTEM_PROMPT, messages })
  });
  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Réponse brute:', text);
  const data = JSON.parse(text);
  return data.content?.[0]?.text || '';
}

async function saveToGist(data) {
  try {
    await fetch('/api?action=save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data })
    });
  } catch (e) {
    console.log('Erreur sauvegarde gist:', e);
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

function getWeekLabel(data) {
  return data.semaine || 'Semaine en cours';
}

function renderPlanning(data) {
  currentData = data;

  if (data.couleur) {
    document.documentElement.style.setProperty('--accent', data.couleur);
    const hex = data.couleur.replace('#','');
    const r = parseInt(hex.substr(0,2),16);
    const g = parseInt(hex.substr(2,2),16);
    const b = parseInt(hex.substr(4,2),16);
    document.documentElement.style.setProperty('--accent-light', `rgba(${r},${g},${b},0.1)`);
  }

  document.getElementById('week-label').textContent = getWeekLabel(data);

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
        ${jour.flemme ? '<span class="badge badge-flemme">⚡ Flemme</span>' : ''}
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
    <div class="day-meta" style="margin-bottom:1rem">
      <span class="badge badge-time">⏱ ${jour.temps}</span>
      ${jour.flemme ? '<span class="badge badge-flemme">⚡ Flemme</span>' : ''}
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

function copyCourses() {
  if (!currentData) return;
  let text = `🛒 Liste de courses — ${currentData.semaine}\n\n`;
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
    setTimeout(() => addMsg(Q2, 'bot'), 400);
    conversationHistory.push({ role: 'assistant', content: Q2 });
  } else if (step === 1) {
    answers.placards = val;
    step++;
    setTimeout(() => addMsg(Q3, 'bot'), 400);
    conversationHistory.push({ role: 'assistant', content: Q3 });
  } else if (step === 2) {
    answers.eviter = val;
    step++;

    showScreen('loading-screen');

    try {
      const finalMsg = `Budget: ${answers.budget}\nPlacards/frigo: ${answers.placards}\nÀ éviter: ${answers.eviter}\n\nGénère maintenant le planning JSON.`;
      conversationHistory.push({ role: 'user', content: finalMsg });

      const reply = await callAPI(conversationHistory);

      let clean = reply.trim();
      if (clean.startsWith('```')) {
        clean = clean.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();
      }

      const data = JSON.parse(clean);
      await saveToGist(data);
      renderPlanning(data);
    } catch (err) {
      showScreen('chat-screen');
      addMsg("Oups, une erreur s'est produite. Réessaie !", 'bot');
      step = 2;
      console.error(err);
    }
  }
}

async function init() {
  showScreen('loading-screen');
  document.getElementById('loading-text').textContent = 'Chargement...';

  const saved = await loadFromGist();
  if (saved && saved.jours && saved.jours.length === 7) {
    renderPlanning(saved);
  } else {
    showScreen('setup-screen');
  }

  document.getElementById('start-btn').addEventListener('click', () => {
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
      }, 600);
    }, 200);
  });

  document.getElementById('chat-send').addEventListener('click', handleSend);
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSend();
  });

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('recipe-modal').addEventListener('click', e => {
    if (e.target.id === 'recipe-modal') closeModal();
  });

  document.getElementById('copy-courses-btn').addEventListener('click', copyCourses);

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });

  document.getElementById('new-week-btn').addEventListener('click', () => {
    step = 0;
    answers = {};
    conversationHistory = [];
    document.getElementById('chat-messages').innerHTML = '';
    showScreen('chat-screen');
    setTimeout(() => {
      addMsg("On repart pour une nouvelle semaine ! 🍳", 'bot');
      conversationHistory.push({ role: 'assistant', content: "On repart pour une nouvelle semaine ! 🍳" });
      setTimeout(() => {
        addMsg(Q1, 'bot');
        conversationHistory.push({ role: 'assistant', content: Q1 });
      }, 600);
    }, 200);
  });
}

document.addEventListener('DOMContentLoaded', init);
