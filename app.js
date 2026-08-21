
/* FOURNIX DIAG v1
   Local-first PWA. Project data is encrypted with AES-GCM.
*/
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const DB_NAME = 'fournix-diagnostic-db';
  const DB_VERSION = 1;
  const AUTH_ID = 'auth';
  const AUTO_LOCK_MS = 10 * 60 * 1000;
  const MAX_PDF_PIXELS = 18000000;
  const MAX_ZOOM = 20;

  let db = null;
  let cryptoKey = null;
  let activeProject = null;
  let projects = [];
  let autoLockTimer = null;

  let currentFile = null;
  let currentFileBuffer = null;
  let currentPdf = null;
  let currentPage = 1;
  let totalPages = 1;
  let currentCadSvg = null;

  let baseW = 1000;
  let baseH = 1400;
  let zoom = 1;
  let panX = 20;
  let panY = 20;
  let activeTool = 'pan';
  let pointerDown = false;
  let pointerStart = null;
  let currentDraft = null;
  let drawPoints = [];
  let undoStack = [];
  let pendingPoint = null;
  let pendingObsPhoto = null;
  let pendingCrack = null;
  let currentMediaRecorder = null;
  let currentAudioChunks = [];
  let currentAudioBlob = null;
  let audioTimerInt = null;
  let audioStartedAt = 0;
  let localTranscriber = null;
  let pinchState = null;
  const pointers = new Map();

  const checklistDefaults = [
    'Documents disponibles et plans existants vérifiés',
    'Système porteur principal identifié',
    'Sens de portée et appuis principaux repérés',
    'Fissures et ouvertures relevées',
    'Déformations / flèches / faux aplombs observés',
    'État du béton, maçonnerie, acier ou bois vérifié',
    'Corrosion, armatures apparentes ou épaufrures repérées',
    'Humidité, infiltrations ou traces d’eau repérées',
    'Sondages / mesures / prélèvements nécessaires notés',
    'Photos générales et photos de détail réalisées',
    'Zones non accessibles ou incertitudes notées',
    'Points à approfondir au bureau listés'
  ];

  const pathologyColors = {
    'Fissure':'#d11a2a',
    'Épaufrure':'#e36b11',
    'Corrosion':'#8c4b18',
    'Armature apparente':'#6b3f1c',
    'Infiltration / humidité':'#1475cf',
    'Déformation':'#7c3aed',
    'Décollement':'#c026d3',
    'Dégradation du béton':'#be123c',
    'Dégradation de maçonnerie':'#9a3412',
    'Autre':'#374151'
  };

  const visitQuestionTemplate = [
    {id:'year_confirm',group:'Bâtiment',q:'Quelle est l’année de construction ou, à défaut, la période de construction ?',type:'text',why:'Utile pour cadrer les matériaux possibles, la réglementation et les techniques constructives.'},
    {id:'plans',group:'Documents',q:'Avez-vous les plans existants : structure, coffrage, ferraillage, architecture ou DOE ?',type:'yn',why:'Demander les plans avant ou pendant la visite.'},
    {id:'studies',group:'Documents',q:'Existe-t-il des rapports de diagnostic, notes de calcul, expertises ou études antérieures ?',type:'yn'},
    {id:'works_history',group:'Historique',q:'Quels travaux, transformations, ouvertures, surélévations ou changements d’usage ont déjà été réalisés ?',type:'text'},
    {id:'disorders_history',group:'Historique',q:'Depuis quand les désordres sont-ils connus et ont-ils évolué ?',type:'text'},
    {id:'incident',group:'Historique',q:'Y a-t-il eu un sinistre, choc, incendie, dégât des eaux, vibration ou événement particulier ?',type:'text'},
    {id:'dta',group:'Risques avant sondages',q:'Le DTA / dossier amiante et les repérages disponibles peuvent-ils être transmis ?',type:'yn',condition:'amiante',why:'À vérifier avant sondages destructifs ou travaux susceptibles d’impacter des matériaux.'},
    {id:'raat',group:'Risques avant sondages',q:'Un repérage amiante avant travaux couvrant précisément les zones de sondage est-il disponible ?',type:'yn',condition:'amiante'},
    {id:'lead',group:'Risques avant sondages',q:'Un diagnostic ou repérage plomb est-il disponible ou nécessaire pour les zones concernées ?',type:'yn',condition:'plomb',why:'Pertinent notamment pour les bâtiments anciens et les revêtements susceptibles d’être affectés.'},
    {id:'other_hazards',group:'Risques avant sondages',q:'D’autres matériaux ou risques particuliers sont-ils connus : fibres, produits chimiques, locaux techniques, contamination ?',type:'text'},
    {id:'power',group:'Moyens sur site',q:'Une alimentation électrique 230 V utilisable est-elle disponible à proximité des sondages ?',type:'yn',why:'Pour les équipements de sondage et de mesure.'},
    {id:'water',group:'Moyens sur site',q:'Un point d’eau est-il disponible si les sondages le nécessitent ?',type:'yn'},
    {id:'access',group:'Accès',q:'Toutes les zones à diagnostiquer seront-elles accessibles le jour de l’intervention ?',type:'yn'},
    {id:'height',group:'Accès',q:'Faut-il prévoir escabeau, nacelle, échafaudage ou autre moyen d’accès en hauteur ?',type:'text'},
    {id:'occupied',group:'Exploitation',q:'Le bâtiment sera-t-il occupé pendant l’intervention ?',type:'yn'},
    {id:'noise_dust',group:'Exploitation',q:'Y a-t-il des contraintes de bruit, poussière, horaires ou maintien d’activité ?',type:'text'},
    {id:'network',group:'Sondages',q:'Les réseaux encastrés ou zones à éviter sont-ils repérés avant percement / ouverture ?',type:'yn'},
    {id:'destructive_auth',group:'Sondages',q:'Le client autorise-t-il les sondages destructifs prévus et la remise en état est-elle définie ?',type:'yn'},
    {id:'survey_scope',group:'Mission',q:'Quelles zones, éléments ou pathologies doivent être traités en priorité ?',type:'text'},
    {id:'expected_output',group:'Mission',q:'Quel livrable est attendu : avis, diagnostic, rapport, préconisations, note de calcul, chiffrage ?',type:'text'},
    {id:'contact_site',group:'Organisation',q:'Qui sera présent sur site et qui pourra ouvrir les locaux / donner les autorisations ?',type:'text'},
    {id:'photos_auth',group:'Organisation',q:'La prise de photos et vidéos techniques est-elle autorisée dans les zones visitées ?',type:'yn'},
    {id:'deadline',group:'Organisation',q:'Y a-t-il une échéance ou une contrainte de planning à respecter ?',type:'text'}
  ];


  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  function uuid(prefix='id') {
    if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function b64(bytes) {
    let s = '';
    const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const chunk = 0x8000;
    for (let i=0;i<a.length;i+=chunk) s += String.fromCharCode(...a.subarray(i,i+chunk));
    return btoa(s);
  }
  function unb64(s) {
    const bin = atob(s);
    const a = new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  function showToast(msg, ms=2200) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), ms);
  }

  function safeName(s='fichier') {
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-zA-Z0-9._-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,80) || 'fichier';
  }

  function fmtDate(s) {
    if (!s) return '';
    try { return new Intl.DateTimeFormat('fr-FR').format(new Date(s + (s.length===10?'T12:00:00':''))); }
    catch { return s; }
  }

  async function openDB() {
    db = await new Promise((resolve,reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', {keyPath:'id'});
        if (!d.objectStoreNames.contains('records')) {
          const s = d.createObjectStore('records', {keyPath:'id'});
          s.createIndex('kind','kind',{unique:false});
          s.createIndex('projectId','projectId',{unique:false});
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function txGet(store,id) {
    return new Promise((resolve,reject) => {
      const r = db.transaction(store,'readonly').objectStore(store).get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  }
  function txPut(store,obj) {
    return new Promise((resolve,reject) => {
      const r = db.transaction(store,'readwrite').objectStore(store).put(obj);
      r.onsuccess = () => resolve(obj);
      r.onerror = () => reject(r.error);
    });
  }
  function txDelete(store,id) {
    return new Promise((resolve,reject) => {
      const r = db.transaction(store,'readwrite').objectStore(store).delete(id);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  }
  function txGetAll(store) {
    return new Promise((resolve,reject) => {
      const r = db.transaction(store,'readonly').objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  }

  async function deriveKey(pin, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      {name:'PBKDF2', salt, iterations:250000, hash:'SHA-256'},
      base,
      {name:'AES-GCM', length:256},
      false,
      ['encrypt','decrypt']
    );
  }

  async function encryptBytes(bytes, key=cryptoKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({name:'AES-GCM',iv}, key, bytes);
    return {iv:b64(iv), data};
  }
  async function decryptBytes(rec, key=cryptoKey) {
    const iv = unb64(rec.iv);
    return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv}, key, rec.data));
  }
  async function encryptJSON(obj, key=cryptoKey) {
    return encryptBytes(enc.encode(JSON.stringify(obj)), key);
  }
  async function decryptJSON(rec, key=cryptoKey) {
    const bytes = await decryptBytes(rec,key);
    return JSON.parse(dec.decode(bytes));
  }

  async function getAuth() { return txGet('settings',AUTH_ID); }

  async function setupAuth(pin) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(pin,salt);
    const verifier = await encryptBytes(enc.encode('FOURNIX-DIAGNOSTIC-OK'),key);
    await txPut('settings',{id:AUTH_ID,salt:b64(salt),iv:verifier.iv,data:verifier.data,createdAt:new Date().toISOString()});
    cryptoKey = key;
  }

  async function unlock(pin) {
    const auth = await getAuth();
    if (!auth) throw new Error('NO_AUTH');
    const key = await deriveKey(pin,unb64(auth.salt));
    const bytes = await decryptBytes(auth,key);
    if (dec.decode(bytes) !== 'FOURNIX-DIAGNOSTIC-OK') throw new Error('BAD_PIN');
    cryptoKey = key;
  }

  async function putSecureJSON(id, kind, projectId, obj) {
    const crypt = await encryptJSON(obj);
    await txPut('records',{id,kind,projectId:projectId||null,iv:crypt.iv,data:crypt.data});
  }
  async function putSecureBinary(id, kind, projectId, bytes) {
    const crypt = await encryptBytes(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    await txPut('records',{id,kind,projectId:projectId||null,iv:crypt.iv,data:crypt.data});
  }
  async function getSecureJSON(id) {
    const rec = await txGet('records',id);
    if (!rec) return null;
    return decryptJSON(rec);
  }
  async function getSecureBinary(id) {
    const rec = await txGet('records',id);
    if (!rec) return null;
    return decryptBytes(rec);
  }

  async function loadProjects() {
    const rows = await txGetAll('records');
    const projectRows = rows.filter(r => r.kind === 'project');
    const out = [];
    for (const r of projectRows) {
      try { out.push(await decryptJSON(r)); } catch {}
    }
    projects = out.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
    renderProjectList();
  }

  function defaultProject() {
    return {
      id: uuid('project'),
      name:'', client:'', site:'',
      visitDate:new Date().toISOString().slice(0,10),
      contact:'', missionType:'previsite', buildingYear:'',
      createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
      files:[], annotations:{}, calibrations:{}, notes:'',
      visitAnswers:{},
      report:{people:'',zones:'',access:'',tests:'',findings:'',limits:'',actions:'',next:''},
      checklist: checklistDefaults.map((label,i)=>({id:i,label,done:false}))
    };
  }

  async function saveProject(project=activeProject) {
    if (!project) return;
    project.updatedAt = new Date().toISOString();
    await putSecureJSON(project.id,'project',project.id,project);
    const ix = projects.findIndex(p => p.id === project.id);
    if (ix >= 0) projects[ix] = JSON.parse(JSON.stringify(project));
    else projects.unshift(JSON.parse(JSON.stringify(project)));
  }

  function renderProjectList() {
    const box = $('projectList');
    if (!projects.length) {
      box.innerHTML = '<div class="card empty">Aucun projet. Crée ton premier dossier de visite.</div>';
      return;
    }
    box.innerHTML = projects.map(p => `
      <article class="project-card">
        <h3>${escapeHtml(p.name || 'Projet sans nom')}</h3>
        <div class="meta">${escapeHtml(p.client || '')}${p.client && p.site ? '<br>' : ''}${escapeHtml(p.site || '')}</div>
        <div class="small muted">${fmtDate(p.visitDate)} · ${p.files?.length || 0} plan(s)</div>
        <div class="project-card-actions">
          <button class="primary" data-open-project="${p.id}">Ouvrir</button>
          <button class="secondary" data-edit-project="${p.id}">Modifier</button>
        </div>
      </article>`).join('');
    box.querySelectorAll('[data-open-project]').forEach(b => b.onclick = () => openProject(b.dataset.openProject));
    box.querySelectorAll('[data-edit-project]').forEach(b => b.onclick = () => editProject(b.dataset.editProject));
  }

  function escapeHtml(s='') {
    return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  }

  function ensureProjectV2(p){
    if(!p.visitAnswers) p.visitAnswers={};
    if(!p.report) p.report={people:'',zones:'',access:'',tests:'',findings:'',limits:'',actions:'',next:''};
    if(!p.missionType) p.missionType='previsite';
    if(p.buildingYear==null) p.buildingYear='';
    if(!p.annotations) p.annotations={};
    if(!p.calibrations) p.calibrations={};
    if(!p.files) p.files=[];
    if(!p.checklist?.length) p.checklist=checklistDefaults.map((label,i)=>({id:i,label,done:false}));
  }

  function fillReportFields(){
    if(!activeProject) return;
    ensureProjectV2(activeProject);
    const r=activeProject.report;
    $('reportPeople').value=r.people||'';
    $('reportZones').value=r.zones||'';
    $('reportAccess').value=r.access||'';
    $('reportTests').value=r.tests||'';
    $('reportFindings').value=r.findings||'';
    $('reportLimits').value=r.limits||'';
    $('reportActions').value=r.actions||'';
    $('reportNext').value=r.next||'';
  }

  async function saveReportFields(){
    if(!activeProject) return;
    activeProject.report={
      people:$('reportPeople').value, zones:$('reportZones').value, access:$('reportAccess').value,
      tests:$('reportTests').value, findings:$('reportFindings').value, limits:$('reportLimits').value,
      actions:$('reportActions').value, next:$('reportNext').value
    };
    await saveProject();
  }

  async function openProject(id) {
    activeProject = await getSecureJSON(id);
    if (!activeProject) return;
    $('homeView').classList.remove('active');
    $('projectView').classList.add('active');
    $('projectTitle').textContent = activeProject.name || 'Projet';
    $('projectMetaLine').textContent = [activeProject.client,activeProject.site,fmtDate(activeProject.visitDate)].filter(Boolean).join(' · ');
    ensureProjectV2(activeProject);
    $('visitNotes').value = activeProject.notes || '';
    fillReportFields();
    $('visitType').value = activeProject.missionType || 'previsite';
    $('buildingYear').value = activeProject.buildingYear || '';
    renderVisitQuestions();
    renderPlans();
    renderObservations();
    renderChecklist();
    setProjectTab('plans');
    resetAutoLock();
  }

  function closeProject() {
    activeProject = null;
    $('projectView').classList.remove('active');
    $('homeView').classList.add('active');
    loadProjects();
  }

  function showProjectDialog(project=null) {
    const p = project ? JSON.parse(JSON.stringify(project)) : defaultProject();
    $('projectDialogTitle').textContent = project ? 'Modifier le projet' : 'Nouveau projet';
    $('projectIdField').value = p.id;
    $('projectName').value = p.name || '';
    $('projectClient').value = p.client || '';
    $('projectSite').value = p.site || '';
    $('projectDate').value = p.visitDate || new Date().toISOString().slice(0,10);
    $('projectContact').value = p.contact || '';
    $('projectMission').value = p.missionType || 'previsite';
    $('projectDialog').showModal();
  }

  async function saveProjectForm(e) {
    e.preventDefault();
    const id = $('projectIdField').value;
    let p = projects.find(x=>x.id===id);
    if (p) p = await getSecureJSON(id);
    else p = defaultProject();
    p.id = id || p.id;
    p.name = $('projectName').value.trim() || 'Projet sans nom';
    p.client = $('projectClient').value.trim();
    p.site = $('projectSite').value.trim();
    p.visitDate = $('projectDate').value;
    p.contact = $('projectContact').value.trim();
    p.missionType = $('projectMission').value || p.missionType || 'previsite';
    await saveProject(p);
    $('projectDialog').close();
    await loadProjects();
    if (activeProject?.id === p.id) await openProject(p.id);
    showToast('Projet enregistré');
  }

  function editProject(id) {
    const p = projects.find(x=>x.id===id);
    if (p) showProjectDialog(p);
  }

  function setProjectTab(name) {
    document.querySelectorAll('[data-project-tab]').forEach(b=>b.classList.toggle('active',b.dataset.projectTab===name));
    document.querySelectorAll('.project-tab').forEach(s=>s.classList.remove('active'));
    $('projectTab' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active');
    if (name==='visite') renderVisitQuestions();
    if (name==='observations') renderObservations();
    if (name==='notes') fillReportFields();
    if (name==='checklist') renderChecklist();
  }

  function conditionVisible(q){
    const y=Number(activeProject?.buildingYear||0);
    if(q.condition==='amiante') return !y || y < 1997;
    if(q.condition==='plomb') return !y || y < 1949;
    return true;
  }

  function renderRegulatoryHints(){
    if(!activeProject) return;
    const y=Number(activeProject.buildingYear||0);
    const hints=[];
    if(!y){hints.push('<div class="reg-hint">Renseigne l’année de construction pour afficher les rappels amiante / plomb adaptés.</div>')}
    if(y && y < 1997) hints.push('<div class="reg-hint amiante"><strong>Amiante :</strong> bâtiment antérieur à 1997. Vérifie le DTA et surtout le repérage amiante couvrant les zones de sondage avant toute intervention destructive.</div>');
    if(y && y < 1949) hints.push('<div class="reg-hint plomb"><strong>Plomb :</strong> bâtiment antérieur à 1949. Vérifie les informations ou repérages plomb pertinents avant d’altérer d’anciens revêtements.</div>');
    $('regulatoryHints').innerHTML=hints.join('');
  }

  function renderVisitQuestions(){
    if(!activeProject || !$('visitQuestionsBox')) return;
    ensureProjectV2(activeProject);
    $('visitType').value=activeProject.missionType||'previsite';
    $('buildingYear').value=activeProject.buildingYear||'';
    renderRegulatoryHints();
    const visible=visitQuestionTemplate.filter(conditionVisible);
    let last='';
    const html=[];
    for(const q of visible){
      if(q.group!==last){html.push(`<div class="question-group-title">${escapeHtml(q.group)}</div>`);last=q.group}
      const ans=activeProject.visitAnswers[q.id]||{value:'',note:''};
      const control=q.type==='yn' ? `<select data-q-value="${q.id}"><option value="">—</option><option value="oui" ${ans.value==='oui'?'selected':''}>Oui</option><option value="non" ${ans.value==='non'?'selected':''}>Non</option><option value="na" ${ans.value==='na'?'selected':''}>N/A</option></select>` : `<input data-q-value="${q.id}" value="${escapeHtml(ans.value||'')}" placeholder="Réponse">`;
      html.push(`<div class="question-card"><h4>${escapeHtml(q.q)}${ans.value?'<span class="answer-status">renseigné</span>':''}</h4><div class="question-answer">${control}<input data-q-note="${q.id}" value="${escapeHtml(ans.note||'')}" placeholder="Note / détail"></div>${q.why?`<div class="why">${escapeHtml(q.why)}</div>`:''}</div>`);
    }
    $('visitQuestionsBox').innerHTML=html.join('');
    const saveAnswer=async id=>{
      const v=document.querySelector(`[data-q-value="${id}"]`)?.value||'';
      const n=document.querySelector(`[data-q-note="${id}"]`)?.value||'';
      activeProject.visitAnswers[id]={value:v,note:n};
      await saveProject();updateVisitProgress();
    };
    document.querySelectorAll('[data-q-value]').forEach(el=>el.addEventListener('change',()=>saveAnswer(el.dataset.qValue)));
    document.querySelectorAll('[data-q-note]').forEach(el=>el.addEventListener('change',()=>saveAnswer(el.dataset.qNote)));
    updateVisitProgress();
  }

  function updateVisitProgress(){
    const qs=visitQuestionTemplate.filter(conditionVisible);
    const done=qs.filter(q=>activeProject?.visitAnswers?.[q.id]?.value).length;
    $('visitProgress').textContent=qs.length?Math.round(done/qs.length*100)+' %':'0 %';
  }

  async function generateReportSummary(){
    if(!activeProject) return;
    const obs=allObservations();
    const path=obs.filter(o=>o.type==='pathology'||o.type==='crack');
    const zones=activeProject.visitAnswers?.survey_scope?.value||'';
    const limits=[];
    if(activeProject.visitAnswers?.access?.value==='non') limits.push('Certaines zones ne sont pas accessibles.');
    if(activeProject.visitAnswers?.plans?.value==='non') limits.push('Plans existants non disponibles lors de la visite.');
    if(activeProject.visitAnswers?.dta?.value==='non') limits.push('Documents amiante non disponibles ou non confirmés.');
    if(!$('reportZones').value && zones) $('reportZones').value=zones;
    if(!$('reportFindings').value && path.length){
      const by={};path.forEach(o=>{const k=o.pathology||'Observation';by[k]=(by[k]||0)+1});
      $('reportFindings').value=Object.entries(by).map(([k,v])=>`${v} ${k.toLowerCase()}${v>1?'s':''} repéré${v>1?'s':''} sur les plans.`).join('\n');
    }
    if(!$('reportLimits').value && limits.length) $('reportLimits').value=limits.join('\n');
    if(!$('reportNext').value) $('reportNext').value=activeProject.visitAnswers?.expected_output?.value||'';
    await saveReportFields();showToast('Compte rendu pré-rempli');
  }

  async function importPlan(file) {
    if (!activeProject || !file) return;
    const ext = (file.name.split('.').pop()||'').toLowerCase();
    const allowed = ['pdf','dwg','dxf','png','jpg','jpeg','webp'];
    if (!allowed.includes(ext)) {
      showToast('Format non pris en charge');
      return;
    }
    showToast('Import du document…',5000);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileId = uuid('file');
    await putSecureBinary(fileId,'file',activeProject.id,bytes);
    let kind = ext === 'pdf' ? 'pdf' : (ext === 'dwg' || ext === 'dxf' ? 'cad' : 'image');
    let pageCount = 1;
    if (kind === 'pdf') {
      try {
        const pdf = await pdfjsLib.getDocument({data:bytes.slice().buffer}).promise;
        pageCount = pdf.numPages;
        pdf.destroy();
      } catch {}
    }
    activeProject.files.push({
      id:fileId,
      name:file.name,
      ext,
      mime:file.type || '',
      kind,
      pageCount,
      size:file.size,
      addedAt:new Date().toISOString()
    });
    await saveProject();
    renderPlans();
    showToast('Document ajouté');
  }

  function renderPlans() {
    const box = $('planList');
    const files = activeProject?.files || [];
    if (!files.length) {
      box.innerHTML = '<div class="empty">Importe un PDF, une image, un DWG ou un DXF.</div>';
      return;
    }
    box.innerHTML = files.map(f => `
      <div class="plan-row">
        <div class="plan-row-main">
          <div>
            <h4>${escapeHtml(f.name)}</h4>
            <p>${f.kind==='pdf' ? `${f.pageCount||1} page(s)` : f.kind==='cad' ? 'Plan CAO · lecture locale bêta' : 'Image'} · ${Math.round((f.size||0)/1024)} Ko</p>
          </div>
          <span class="badge">${escapeHtml((f.ext||'').toUpperCase())}</span>
        </div>
        <div class="row-actions">
          <button class="primary" data-open-file="${f.id}">Ouvrir et annoter</button>
          <button class="secondary" data-download-file="${f.id}">Original</button>
          <button class="secondary" data-delete-file="${f.id}">Supprimer</button>
        </div>
      </div>`).join('');
    box.querySelectorAll('[data-open-file]').forEach(b=>b.onclick=()=>openViewer(b.dataset.openFile));
    box.querySelectorAll('[data-download-file]').forEach(b=>b.onclick=()=>downloadOriginal(b.dataset.downloadFile));
    box.querySelectorAll('[data-delete-file]').forEach(b=>b.onclick=()=>deletePlan(b.dataset.deleteFile));
  }

  async function deletePlan(id) {
    if (!confirm('Supprimer ce plan et ses annotations ?')) return;
    activeProject.files = activeProject.files.filter(f=>f.id!==id);
    for (const k of Object.keys(activeProject.annotations||{})) if (k.startsWith(id+':')) delete activeProject.annotations[k];
    for (const k of Object.keys(activeProject.calibrations||{})) if (k.startsWith(id+':')) delete activeProject.calibrations[k];
    await txDelete('records',id);
    await saveProject();
    renderPlans();
  }

  async function downloadOriginal(id) {
    const f = activeProject.files.find(x=>x.id===id);
    const bytes = await getSecureBinary(id);
    if (!f || !bytes) return;
    downloadBlob(new Blob([bytes],{type:f.mime||'application/octet-stream'}),f.name);
  }

  function pageKey() { return currentFile ? `${currentFile.id}:${currentPage}` : ''; }
  function currentAnnotations() {
    const k = pageKey();
    if (!activeProject.annotations[k]) activeProject.annotations[k] = [];
    return activeProject.annotations[k];
  }

  async function openViewer(fileId, page=1) {
    currentFile = activeProject.files.find(f=>f.id===fileId);
    if (!currentFile) return;
    currentFileBuffer = await getSecureBinary(fileId);
    if (!currentFileBuffer) return;
    currentPage = Math.max(1,page);
    currentPdf = null;
    currentCadSvg = null;
    undoStack = [];
    $('viewerFileName').textContent = currentFile.name;
    $('viewer').classList.remove('hidden');
    $('viewerLoading').classList.remove('hidden');
    resetView();

    try {
      if (currentFile.kind === 'pdf') {
        currentPdf = await pdfjsLib.getDocument({data:currentFileBuffer.slice().buffer}).promise;
        totalPages = currentPdf.numPages;
        currentPage = Math.min(currentPage,totalPages);
        await renderPdfPage();
      } else if (currentFile.kind === 'image') {
        totalPages = 1;
        await renderImage();
      } else {
        totalPages = 1;
        await renderCad();
      }
      updatePageInfo();
      renderAnnotations();
      fitToScreen();
    } catch (err) {
      console.error(err);
      showToast('Impossible d’ouvrir ce document',3500);
    } finally {
      $('viewerLoading').classList.add('hidden');
    }
  }

  function closeViewer() {
    $('viewer').classList.add('hidden');
    clearBaseLayers();
    currentFile = null;
    currentFileBuffer = null;
    currentPdf = null;
    currentCadSvg = null;
    renderObservations();
  }

  function clearBaseLayers() {
    $('pdfCanvas').style.display='none';
    $('imageBase').style.display='none';
    $('cadBase').style.display='none';
    $('cadBase').innerHTML='';
  }

  async function renderPdfPage() {
    clearBaseLayers();
    const page = await currentPdf.getPage(currentPage);
    const vp1 = page.getViewport({scale:1});
    baseW = vp1.width;
    baseH = vp1.height;
    setContentSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.2);
    let renderScale = Math.max(1,Math.min(zoom,8)) * dpr;
    let vp = page.getViewport({scale:renderScale});
    const pixels=vp.width*vp.height;
    if(pixels>MAX_PDF_PIXELS){renderScale*=Math.sqrt(MAX_PDF_PIXELS/pixels);vp=page.getViewport({scale:renderScale});}
    const canvas = $('pdfCanvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = baseW+'px';
    canvas.style.height = baseH+'px';
    canvas.style.display='block';
    await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
  }

  async function renderImage() {
    clearBaseLayers();
    const blob = new Blob([currentFileBuffer],{type:currentFile.mime||'image/jpeg'});
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url});
    const maxBase = 1400;
    const scale = Math.min(1,maxBase/img.naturalWidth);
    baseW = img.naturalWidth*scale;
    baseH = img.naturalHeight*scale;
    setContentSize();
    const el = $('imageBase');
    el.src=url;
    el.style.display='block';
  }

  async function renderCad() {
    clearBaseLayers();
    $('viewerLoading').textContent='Lecture du DWG / DXF…';
    const mod = await import('https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web/dist/libredwg-web.js');
    const lib = await mod.LibreDwg.create();
    const type = currentFile.ext==='dxf' ? mod.Dwg_File_Type.DXF : mod.Dwg_File_Type.DWG;
    const dwg = lib.dwg_read_data(currentFileBuffer.slice().buffer,type);
    const dbObj = lib.convert(dwg);
    const svgString = lib.dwg_to_svg(dbObj);
    try { lib.dwg_free(dwg); } catch {}
    currentCadSvg = svgString;
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString,'image/svg+xml');
    const svg = doc.documentElement;
    let ratio = 0.75;
    const vb = (svg.getAttribute('viewBox')||'').split(/\s+/).map(Number);
    if (vb.length===4 && vb[2]>0 && vb[3]>0) ratio = vb[3]/vb[2];
    baseW = 1200;
    baseH = Math.max(500,Math.min(1800,baseW*ratio));
    setContentSize();
    svg.setAttribute('width','100%');
    svg.setAttribute('height','100%');
    svg.setAttribute('preserveAspectRatio','xMidYMid meet');
    const box = $('cadBase');
    box.innerHTML='';
    box.appendChild(document.importNode(svg,true));
    box.style.display='block';
  }

  function setContentSize() {
    const c = $('planContent');
    c.style.width = baseW+'px';
    c.style.height = baseH+'px';
    const svg = $('annotationLayer');
    svg.setAttribute('viewBox',`0 0 ${baseW} ${baseH}`);
  }

  function resetView() {
    zoom = 1; panX = 20; panY = 20;
    updateTransform();
  }

  function fitToScreen() {
    const st = $('viewerStage').getBoundingClientRect();
    zoom = Math.min((st.width-24)/baseW,(st.height-24)/baseH);
    zoom = Math.max(.08,Math.min(zoom,4));
    panX = (st.width-baseW*zoom)/2;
    panY = (st.height-baseH*zoom)/2;
    updateTransform();
    if (currentFile?.kind==='pdf') debouncePdfRender();
  }

  function updateTransform() {
    $('planContent').style.transform=`translate(${panX}px,${panY}px) scale(${zoom})`;
    $('fitBtn').textContent=Math.round(zoom*100)+'%';
  }

  let pdfRenderTimer = null;
  function debouncePdfRender() {
    if (currentFile?.kind!=='pdf' || !currentPdf) return;
    clearTimeout(pdfRenderTimer);
    pdfRenderTimer=setTimeout(()=>renderPdfPage().catch(console.error),180);
  }

  function setZoom(next, center=null) {
    const old=zoom;
    next=Math.max(.08,Math.min(next,MAX_ZOOM));
    if (center) {
      const st=$('viewerStage').getBoundingClientRect();
      const sx=center.x-st.left, sy=center.y-st.top;
      const wx=(sx-panX)/old, wy=(sy-panY)/old;
      panX=sx-wx*next; panY=sy-wy*next;
    }
    zoom=next;
    updateTransform();
    debouncePdfRender();
  }

  function updatePageInfo() {
    $('pageInfo').textContent=`${currentPage} / ${totalPages}`;
    $('prevPageBtn').disabled=currentPage<=1;
    $('nextPageBtn').disabled=currentPage>=totalPages;
  }

  async function changePage(delta) {
    if (!currentPdf) return;
    const n=currentPage+delta;
    if(n<1||n>totalPages) return;
    currentPage=n;
    $('viewerLoading').classList.remove('hidden');
    await renderPdfPage();
    renderAnnotations();
    updatePageInfo();
    fitToScreen();
    $('viewerLoading').classList.add('hidden');
  }

  function screenToPlan(clientX,clientY) {
    const st=$('viewerStage').getBoundingClientRect();
    return {x:(clientX-st.left-panX)/zoom,y:(clientY-st.top-panY)/zoom};
  }

  function pushUndo() {
    undoStack.push(JSON.stringify(currentAnnotations()));
    if (undoStack.length>25) undoStack.shift();
  }

  async function undo() {
    const prev=undoStack.pop();
    if(!prev) return;
    activeProject.annotations[pageKey()]=JSON.parse(prev);
    await saveProject();
    renderAnnotations();
  }

  function svgEl(name,attrs={}) {
    const e=document.createElementNS('http://www.w3.org/2000/svg',name);
    Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,String(v)));
    return e;
  }

  function renderAnnotations() {
    const layer=$('annotationLayer');
    layer.innerHTML='';
    const anns=currentAnnotations();
    for(const a of anns) layer.appendChild(annotationElement(a));
  }

  function pathologySymbol(a){
    const g=svgEl('g'); const c=a.color||pathologyColors[a.pathology]||'#d11a2a'; const s=15;
    if(a.pathology==='Fissure'){
      g.appendChild(svgEl('path',{d:`M ${a.x-s*.8} ${a.y-s*.7} L ${a.x-s*.2} ${a.y-s*.15} L ${a.x-s*.55} ${a.y+s*.05} L ${a.x+s*.05} ${a.y+s*.65} L ${a.x+s*.65} ${a.y+s*.05}`,fill:'none',stroke:c,'stroke-width':3,'vector-effect':'non-scaling-stroke'}));
    } else if(a.pathology==='Épaufrure'){
      g.appendChild(svgEl('polygon',{points:`${a.x-s},${a.y-s*.2} ${a.x-s*.45},${a.y-s} ${a.x+s*.2},${a.y-s*.7} ${a.x+s},${a.y-s*.25} ${a.x+s*.7},${a.y+s*.75} ${a.x-s*.5},${a.y+s}`,fill:'none',stroke:c,'stroke-width':2,'vector-effect':'non-scaling-stroke'}));
    } else if(a.pathology==='Corrosion'){
      g.appendChild(svgEl('circle',{cx:a.x,cy:a.y,r:s*.75,fill:'none',stroke:c,'stroke-width':2,'vector-effect':'non-scaling-stroke'}));
      g.appendChild(svgEl('line',{x1:a.x-s*.55,y1:a.y-s*.55,x2:a.x+s*.55,y2:a.y+s*.55,stroke:c,'stroke-width':2,'vector-effect':'non-scaling-stroke'}));
      g.appendChild(svgEl('line',{x1:a.x+s*.55,y1:a.y-s*.55,x2:a.x-s*.55,y2:a.y+s*.55,stroke:c,'stroke-width':2,'vector-effect':'non-scaling-stroke'}));
    } else if(a.pathology==='Armature apparente'){
      for(let i=-1;i<=1;i++) g.appendChild(svgEl('line',{x1:a.x-s,y1:a.y+i*6,x2:a.x+s,y2:a.y+i*6,stroke:c,'stroke-width':2,'vector-effect':'non-scaling-stroke'}));
    } else if(a.pathology==='Infiltration / humidité'){
      g.appendChild(svgEl('path',{d:`M ${a.x} ${a.y-s} C ${a.x+s} ${a.y} ${a.x+s*.65} ${a.y+s} ${a.x} ${a.y+s} C ${a.x-s*.65} ${a.y+s} ${a.x-s} ${a.y} ${a.x} ${a.y-s} Z`,fill:'none',stroke:c,'stroke-width':2,'vector-effect':'non-scaling-stroke'}));
    } else if(a.pathology==='Déformation'){
      g.appendChild(svgEl('path',{d:`M ${a.x-s} ${a.y} Q ${a.x} ${a.y+s} ${a.x+s} ${a.y}`,fill:'none',stroke:c,'stroke-width':3,'vector-effect':'non-scaling-stroke'}));
      g.appendChild(svgEl('line',{x1:a.x-s,y1:a.y-s*.45,x2:a.x-s,y2:a.y+s*.45,stroke:c,'stroke-width':2,'vector-effect':'non-scaling-stroke'}));
      g.appendChild(svgEl('line',{x1:a.x+s,y1:a.y-s*.45,x2:a.x+s,y2:a.y+s*.45,stroke:c,'stroke-width':2,'vector-effect':'non-scaling-stroke'}));
    } else if(a.pathology==='Décollement'){
      g.appendChild(svgEl('rect',{x:a.x-s,y:a.y-s*.7,width:s*1.5,height:s*1.4,fill:'none',stroke:c,'stroke-width':2,'vector-effect':'non-scaling-stroke'}));
      g.appendChild(svgEl('rect',{x:a.x-s*.5,y:a.y-s,width:s*1.5,height:s*1.4,fill:'none',stroke:c,'stroke-width':2,'vector-effect':'non-scaling-stroke'}));
    } else if(a.pathology==='Dégradation de maçonnerie'){
      for(const [x1,y1,x2,y2] of [[-1,-.8,1,-.8],[-1,0,1,0],[-1,.8,1,.8],[0,-.8,0,0],[-.5,0,-.5,.8],[.5,0,.5,.8]]) g.appendChild(svgEl('line',{x1:a.x+x1*s,y1:a.y+y1*s,x2:a.x+x2*s,y2:a.y+y2*s,stroke:c,'stroke-width':2,'vector-effect':'non-scaling-stroke'}));
    } else if(a.pathology==='Dégradation du béton'){
      g.appendChild(svgEl('polygon',{points:`${a.x},${a.y-s} ${a.x+s*.85},${a.y-s*.4} ${a.x+s*.75},${a.y+s*.65} ${a.x},${a.y+s} ${a.x-s*.8},${a.y+s*.45} ${a.x-s*.75},${a.y-s*.55}`,fill:'none',stroke:c,'stroke-width':2,'vector-effect':'non-scaling-stroke'}));
    } else {
      g.appendChild(svgEl('polygon',{points:`${a.x},${a.y-s} ${a.x+s},${a.y+s} ${a.x-s},${a.y+s}`,fill:'none',stroke:c,'stroke-width':2,'vector-effect':'non-scaling-stroke'}));
      const t=svgEl('text',{x:a.x,y:a.y+s*.55,fill:c,'font-size':13,'text-anchor':'middle'});t.textContent='!';g.appendChild(t);
    }
    return g;
  }

  function annotationElement(a) {
    const color=a.color || '#d11a2a'; const width=a.width || 3; let el;
    if(a.type==='freehand'||a.type==='handwriting'||a.type==='crack'){
      const pts=a.points||[]; const d=pts.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ');
      const g=svgEl('g');
      if(a.type==='crack') g.appendChild(svgEl('path',{d,fill:'none',stroke:'#ffffff','stroke-width':Math.max(width+3,5),'stroke-linecap':'round','stroke-linejoin':'round','vector-effect':'non-scaling-stroke',opacity:.92}));
      g.appendChild(svgEl('path',{d,fill:'none',stroke:a.type==='handwriting'?'#113a65':color,'stroke-width':a.type==='crack'?Math.max(width,2):width,'stroke-linecap':'round','stroke-linejoin':'round','vector-effect':'non-scaling-stroke'})); el=g;
    } else if(a.type==='line' || a.type==='measure' || a.type==='calibration'){
      const g=svgEl('g'); g.appendChild(svgEl('line',{x1:a.x1,y1:a.y1,x2:a.x2,y2:a.y2,stroke:color,'stroke-width':width,'vector-effect':'non-scaling-stroke'}));
      if(a.label){const tx=(a.x1+a.x2)/2,ty=(a.y1+a.y2)/2-8;const t=svgEl('text',{x:tx,y:ty,fill:color,'font-size':14,'text-anchor':'middle',class:'marker-label'});t.textContent=a.label;g.appendChild(t)} el=g;
    } else if(a.type==='arrow'){
      const g=svgEl('g'); g.appendChild(svgEl('line',{x1:a.x1,y1:a.y1,x2:a.x2,y2:a.y2,stroke:color,'stroke-width':width,'vector-effect':'non-scaling-stroke'}));
      const ang=Math.atan2(a.y2-a.y1,a.x2-a.x1),len=16; const p1={x:a.x2-len*Math.cos(ang-Math.PI/6),y:a.y2-len*Math.sin(ang-Math.PI/6)},p2={x:a.x2-len*Math.cos(ang+Math.PI/6),y:a.y2-len*Math.sin(ang+Math.PI/6)};
      g.appendChild(svgEl('polyline',{points:`${p1.x},${p1.y} ${a.x2},${a.y2} ${p2.x},${p2.y}`,fill:'none',stroke:color,'stroke-width':width,'vector-effect':'non-scaling-stroke'}));el=g;
    } else if(a.type==='rect'){
      el=svgEl('rect',{x:Math.min(a.x1,a.x2),y:Math.min(a.y1,a.y2),width:Math.abs(a.x2-a.x1),height:Math.abs(a.y2-a.y1),fill:'none',stroke:color,'stroke-width':width,'vector-effect':'non-scaling-stroke'});
    } else if(a.type==='ellipse'){
      el=svgEl('ellipse',{cx:a.cx,cy:a.cy,rx:a.rx,ry:a.ry,fill:'none',stroke:color,'stroke-width':width,'vector-effect':'non-scaling-stroke'});
    } else if(a.type==='polygon'){
      el=svgEl('polygon',{points:(a.points||[]).map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:color,'stroke-width':width,'vector-effect':'non-scaling-stroke'});
    } else if(a.type==='text'){
      el=svgEl('text',{x:a.x,y:a.y,fill:color,'font-size':a.fontSize||18,class:'marker-label'});el.textContent=a.text||'Texte';
    } else if(a.type==='pathology'){
      const g=svgEl('g',{'data-ann-id':a.id}); g.appendChild(pathologySymbol(a));
      const t=svgEl('text',{x:a.x+22,y:a.y+4,fill:a.color||'#d11a2a','font-size':12,class:'marker-label'});t.textContent=a.pathology||'Observation';g.appendChild(t);el=g;
    } else if(['photo','video','audio'].includes(a.type)){
      const g=svgEl('g',{'data-ann-id':a.id}); const s=24;
      const fill=a.type==='photo'?'#0f2038':a.type==='video'?'#7c3aed':'#0f766e';
      g.appendChild(svgEl('rect',{x:a.x-s/2,y:a.y-s/2,width:s,height:s,rx:5,fill,stroke:'#fff','stroke-width':2,'vector-effect':'non-scaling-stroke'}));
      const t=svgEl('text',{x:a.x,y:a.y+4,fill:'#fff','font-size':10,'text-anchor':'middle'});t.textContent=a.type==='photo'?'P':a.type==='video'?'▶':'A';g.appendChild(t);el=g;g.style.cursor='pointer';
      g.addEventListener('click',e=>{e.stopPropagation();if(a.type==='photo')viewPhotoAnnotation(a);else viewMediaAnnotation(a)});
    } else {el=svgEl('g')}
    el.dataset.annId=a.id||''; return el;
  }

  function makeBaseAnn(type) {
    return {id:uuid('ann'),type,color:$('drawColor').value,width:Number($('drawWidth').value),createdAt:new Date().toISOString()};
  }

  async function commitAnnotation(a) {
    pushUndo();
    currentAnnotations().push(a);
    await saveProject();
    renderAnnotations();
  }

  function setTool(tool) {
    activeTool=tool;
    document.querySelectorAll('#viewerTools [data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));
    $('viewerStage').style.cursor=tool==='pan'?'grab':'crosshair';
  }

  function pointDistance(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
  function simplifyRDP(points,epsilon){
    if(points.length<3)return points.slice();
    const first=points[0],last=points[points.length-1]; let max=0,idx=0;
    const dx=last.x-first.x,dy=last.y-first.y,len2=dx*dx+dy*dy||1;
    for(let i=1;i<points.length-1;i++){
      const p=points[i],t=Math.max(0,Math.min(1,((p.x-first.x)*dx+(p.y-first.y)*dy)/len2));
      const x=first.x+t*dx,y=first.y+t*dy,d=Math.hypot(p.x-x,p.y-y);if(d>max){max=d;idx=i}
    }
    if(max>epsilon){const a=simplifyRDP(points.slice(0,idx+1),epsilon),b=simplifyRDP(points.slice(idx),epsilon);return a.slice(0,-1).concat(b)}
    return [first,last];
  }

  function recognizeSmartShape(points){
    if(points.length<5)return {...makeBaseAnn('freehand'),points};
    const xs=points.map(p=>p.x),ys=points.map(p=>p.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const w=maxX-minX,h=maxY-minY,diag=Math.hypot(w,h)||1,closed=pointDistance(points[0],points[points.length-1])<diag*.25;
    if(!closed)return {...makeBaseAnn('freehand'),points:simplifyRDP(points,diag*.012)};
    const cx=(minX+maxX)/2,cy=(minY+maxY)/2;
    const radii=points.map(p=>Math.hypot((p.x-cx)/(w||1),(p.y-cy)/(h||1))); const avg=radii.reduce((a,b)=>a+b,0)/radii.length;
    const variance=Math.sqrt(radii.reduce((s,r)=>s+(r-avg)*(r-avg),0)/radii.length)/(avg||1);
    if(variance<.20){showToast('Cercle / ellipse reconnu');return {...makeBaseAnn('ellipse'),cx,cy,rx:w/2,ry:h/2}}
    let corners=simplifyRDP(points,diag*.075); if(pointDistance(corners[0],corners[corners.length-1])<diag*.25) corners=corners.slice(0,-1);
    if(corners.length===3){showToast('Triangle reconnu');return {...makeBaseAnn('polygon'),points:corners}}
    if(corners.length>=4&&corners.length<=6){showToast('Rectangle reconnu');return {...makeBaseAnn('rect'),x1:minX,y1:minY,x2:maxX,y2:maxY}}
    return {...makeBaseAnn('freehand'),points:simplifyRDP(points,diag*.018)};
  }

  function pointerStartHandler(e) {
    resetAutoLock(); pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===2){const pts=[...pointers.values()];pinchState={dist:Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y),zoom,center:{x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2}};pointerDown=false;return}
    pointerDown=true;pointerStart={clientX:e.clientX,clientY:e.clientY,plan:screenToPlan(e.clientX,e.clientY),panX,panY};const p=pointerStart.plan;
    if(['freehand','assist','handwrite','crack'].includes(activeTool)){
      drawPoints=[p]; currentDraft=makeBaseAnn(activeTool==='handwrite'?'handwriting':activeTool==='crack'?'crack':'freehand'); currentDraft.points=drawPoints; currentDraft._assist=activeTool==='assist';
    } else if(['line','arrow','rect','calibrate','measure'].includes(activeTool)){
      currentDraft=makeBaseAnn(activeTool==='calibrate'?'calibration':activeTool);Object.assign(currentDraft,{x1:p.x,y1:p.y,x2:p.x,y2:p.y});
    } else if(activeTool==='text'){
      const txt=prompt('Texte à placer :');if(txt)commitAnnotation({...makeBaseAnn('text'),x:p.x,y:p.y,text:txt,fontSize:18});pointerDown=false;
    } else if(activeTool==='pathology'){
      pendingPoint=p;pendingCrack=null;$('obsDescription').value='';$('obsOpening').value='';$('obsLocation').value='';$('obsPhotoInput').value='';pendingObsPhoto=null;$('obsDialogTitle').textContent='Observation';$('observationDialog').showModal();pointerDown=false;
    } else if(activeTool==='photo'){
      pendingPoint=p;$('photoInput').value='';$('photoDescription').value='';$('photoDialog').showModal();pointerDown=false;
    } else if(activeTool==='video'){
      pendingPoint=p;$('videoInput').value='';$('videoDescription').value='';$('videoDialog').showModal();pointerDown=false;
    } else if(activeTool==='audio'){
      pendingPoint=p;resetAudioDialog();$('audioDialog').showModal();pointerDown=false;
    } else if(activeTool==='erase'){eraseNearest(p);pointerDown=false}
  }

  function pointerMoveHandler(e) {
    if(pointers.has(e.pointerId))pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===2&&pinchState){const pts=[...pointers.values()],dist=Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y),center={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};setZoom(pinchState.zoom*(dist/pinchState.dist),center);return}
    if(!pointerDown||!pointerStart)return;
    if(activeTool==='pan'){panX=pointerStart.panX+(e.clientX-pointerStart.clientX);panY=pointerStart.panY+(e.clientY-pointerStart.clientY);updateTransform();return}
    const p=screenToPlan(e.clientX,e.clientY);
    if(currentDraft?.points){const last=drawPoints[drawPoints.length-1];if(!last||pointDistance(last,p)>Math.max(.45,1.2/zoom)){drawPoints.push(p);currentDraft.points=drawPoints;renderDraft()}}
    else if(currentDraft){currentDraft.x2=p.x;currentDraft.y2=p.y;renderDraft()}
  }

  function pointerEndHandler(e) {
    pointers.delete(e.pointerId);if(pointers.size<2)pinchState=null;if(!pointerDown)return;pointerDown=false;if(activeTool==='pan')return;
    const d=currentDraft;currentDraft=null;removeDraft();if(!d)return;
    if(d._assist){const shape=recognizeSmartShape(d.points||[]);commitAnnotation(shape);return}
    if(d.type==='crack'){
      if((d.points?.length||0)<2)return;const xs=d.points.map(p=>p.x),ys=d.points.map(p=>p.y),diag=Math.hypot(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));d.points=simplifyRDP(d.points,Math.max(.4,diag*.006));pendingCrack=d;pendingPoint=null;$('pathologyType').value='Fissure';$('obsDialogTitle').textContent='Fissure tracée';$('obsDescription').value='';$('obsOpening').value='';$('obsLocation').value='';$('obsPhotoInput').value='';$('observationDialog').showModal();return;
    }
    if(d.type==='freehand'||d.type==='handwriting'){
      if((d.points?.length||0)<2)return;const xs=d.points.map(p=>p.x),ys=d.points.map(p=>p.y),diag=Math.hypot(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));d.points=simplifyRDP(d.points,Math.max(.25,diag*.004));commitAnnotation(d);return;
    }
    if(d.type==='calibration'){
      const px=Math.hypot(d.x2-d.x1,d.y2-d.y1);if(px<2)return;const real=prompt('Longueur réelle de cette ligne :');if(!real)return;const val=parseFloat(String(real).replace(',','.'));if(!val||val<=0)return;const unit=prompt('Unité (m, cm, mm) :','m')||'m';activeProject.calibrations[pageKey()]={unitPerPx:val/px,unit};d.label=`Calibration ${val} ${unit}`;commitAnnotation(d);showToast('Échelle calibrée');
    } else if(d.type==='measure'){
      const cal=activeProject.calibrations[pageKey()];if(!cal){showToast('Calibre d’abord le plan');return}const px=Math.hypot(d.x2-d.x1,d.y2-d.y1);d.label=`${(px*cal.unitPerPx).toFixed(2)} ${cal.unit}`;commitAnnotation(d);
    } else commitAnnotation(d);
  }

  function renderDraft() {
    renderAnnotations();
    if(!currentDraft) return;
    const e=annotationElement(currentDraft);
    e.id='draftAnn';
    e.setAttribute('opacity','.75');
    $('annotationLayer').appendChild(e);
  }
  function removeDraft() {
    $('draftAnn')?.remove();
  }

  async function eraseNearest(p) {
    const anns=currentAnnotations();
    if(!anns.length) return;
    let best=-1, dist=Infinity;
    anns.forEach((a,i)=>{
      let cx=0,cy=0;
      if(a.x!=null){cx=a.x;cy=a.y}
      else if(a.x1!=null){cx=(a.x1+a.x2)/2;cy=(a.y1+a.y2)/2}
      else if(a.points?.length){cx=a.points[Math.floor(a.points.length/2)].x;cy=a.points[Math.floor(a.points.length/2)].y}
      const d=Math.hypot(cx-p.x,cy-p.y);
      if(d<dist){dist=d;best=i}
    });
    if(best>=0 && dist < 60/Math.max(zoom,.2)){
      pushUndo();
      const [removed]=anns.splice(best,1);
      if(removed?.photoId) await txDelete('records',removed.photoId);
      await saveProject();
      renderAnnotations();
    }
  }

  async function compressImageFile(file,max=2200,quality=.84){
    if(!file?.type?.startsWith('image/'))return new Uint8Array(await file.arrayBuffer());
    try{
      const url=URL.createObjectURL(file),img=new Image();await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=url});
      const scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));c.getContext('2d').drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);
      const blob=await new Promise(res=>c.toBlob(res,'image/jpeg',quality));return new Uint8Array(await blob.arrayBuffer());
    }catch{return new Uint8Array(await file.arrayBuffer())}
  }

  async function saveObservation() {
    if(!pendingPoint&&!pendingCrack)return;const type=$('pathologyType').value;
    const ann=pendingCrack ? {...pendingCrack,type:'crack'} : {...makeBaseAnn('pathology'),x:pendingPoint.x,y:pendingPoint.y};
    ann.pathology=type;ann.severity=$('severity').value;ann.description=$('obsDescription').value.trim();ann.opening=$('obsOpening').value;ann.locationDetail=$('obsLocation').value.trim();ann.color=pathologyColors[type]||$('drawColor').value;
    const f=$('obsPhotoInput').files?.[0];if(f){const photoId=uuid('photo');await putSecureBinary(photoId,'photo',activeProject.id,await compressImageFile(f));ann.photoId=photoId;ann.photoMime='image/jpeg';ann.photoName=(f.name||'photo').replace(/\.[^.]+$/,'')+'.jpg'}
    await commitAnnotation(ann);pendingPoint=null;pendingCrack=null;$('observationDialog').close();showToast('Observation placée');
  }

  async function savePhotoAnnotation() {
    if(!pendingPoint)return;const f=$('photoInput').files?.[0];if(!f){showToast('Choisis une photo');return}
    const photoId=uuid('photo');await putSecureBinary(photoId,'photo',activeProject.id,await compressImageFile(f));
    const ann={...makeBaseAnn('photo'),x:pendingPoint.x,y:pendingPoint.y,photoId,photoMime:'image/jpeg',photoName:(f.name||'photo').replace(/\.[^.]+$/,'')+'.jpg',description:$('photoDescription').value.trim()};
    await commitAnnotation(ann);pendingPoint=null;$('photoDialog').close();showToast('Photo placée');
  }

  async function saveVideoAnnotation(){
    if(!pendingPoint)return;const f=$('videoInput').files?.[0];if(!f){showToast('Choisis une vidéo');return}
    if(f.size>250*1024*1024&&!confirm('Cette vidéo dépasse 250 Mo et prendra beaucoup de stockage. Continuer ?'))return;
    const id=uuid('video');await putSecureBinary(id,'video',activeProject.id,new Uint8Array(await f.arrayBuffer()));
    await commitAnnotation({...makeBaseAnn('video'),x:pendingPoint.x,y:pendingPoint.y,mediaId:id,mediaMime:f.type||'video/mp4',mediaName:f.name||'video.mp4',description:$('videoDescription').value.trim()});pendingPoint=null;$('videoDialog').close();showToast('Vidéo placée');
  }

  function resetAudioDialog(){
    currentAudioBlob=null;currentAudioChunks=[];$('audioTranscript').value='';$('audioPreview').classList.add('hidden');$('audioPreview').removeAttribute('src');$('startAudioBtn').disabled=false;$('stopAudioBtn').disabled=true;$('transcribeAudioBtn').disabled=true;$('audioTimer').textContent='00:00';$('audioTranscriptionStatus').textContent='';
  }
  async function startAudioRecording(){
    try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});currentAudioChunks=[];currentMediaRecorder=new MediaRecorder(stream);currentMediaRecorder.ondataavailable=e=>{if(e.data.size)currentAudioChunks.push(e.data)};currentMediaRecorder.onstop=()=>{currentAudioBlob=new Blob(currentAudioChunks,{type:currentMediaRecorder.mimeType||'audio/webm'});const url=URL.createObjectURL(currentAudioBlob);$('audioPreview').src=url;$('audioPreview').classList.remove('hidden');$('transcribeAudioBtn').disabled=false;stream.getTracks().forEach(t=>t.stop());clearInterval(audioTimerInt)};currentMediaRecorder.start();audioStartedAt=Date.now();audioTimerInt=setInterval(()=>{const s=Math.floor((Date.now()-audioStartedAt)/1000);$('audioTimer').textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')},500);$('startAudioBtn').disabled=true;$('stopAudioBtn').disabled=false;showToast('Enregistrement audio en cours')}catch(e){console.error(e);showToast('Microphone non disponible')}
  }
  function stopAudioRecording(){if(currentMediaRecorder&&currentMediaRecorder.state!=='inactive')currentMediaRecorder.stop();$('startAudioBtn').disabled=false;$('stopAudioBtn').disabled=true}

  async function audioTo16k(blob){
    const ab=await blob.arrayBuffer(),ctx=new (window.AudioContext||window.webkitAudioContext)(),buf=await ctx.decodeAudioData(ab.slice(0));const src=buf.getChannelData(0),rate=buf.sampleRate;if(rate===16000){await ctx.close();return new Float32Array(src)}const len=Math.round(src.length*16000/rate),out=new Float32Array(len);for(let i=0;i<len;i++){const x=i*rate/16000,j=Math.floor(x),f=x-j;out[i]=(src[j]||0)*(1-f)+(src[Math.min(j+1,src.length-1)]||0)*f}await ctx.close();return out;
  }
  async function transcribeAudioLocal(){
    if(!currentAudioBlob)return;$('audioTranscriptionStatus').textContent='Chargement du modèle de transcription locale…';$('transcribeAudioBtn').disabled=true;
    try{if(!localTranscriber){const mod=await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');mod.env.allowLocalModels=false;mod.env.useBrowserCache=true;localTranscriber=await mod.pipeline('automatic-speech-recognition','Xenova/whisper-tiny',{quantized:true})}$('audioTranscriptionStatus').textContent='Transcription en cours sur cet appareil…';const audio=await audioTo16k(currentAudioBlob);const r=await localTranscriber(audio,{language:'french',task:'transcribe',chunk_length_s:25,stride_length_s:5});$('audioTranscript').value=(r.text||'').trim();$('audioTranscriptionStatus').textContent='Transcription terminée.'}catch(e){console.error(e);$('audioTranscriptionStatus').textContent='Transcription locale indisponible sur ce téléphone. Tu peux saisir le texte manuellement.'}finally{$('transcribeAudioBtn').disabled=false}
  }
  async function saveAudioAnnotation(){
    if(!pendingPoint||!currentAudioBlob){showToast('Enregistre d’abord un audio');return}const id=uuid('audio');await putSecureBinary(id,'audio',activeProject.id,new Uint8Array(await currentAudioBlob.arrayBuffer()));await commitAnnotation({...makeBaseAnn('audio'),x:pendingPoint.x,y:pendingPoint.y,mediaId:id,mediaMime:currentAudioBlob.type||'audio/webm',mediaName:'note-audio.webm',description:$('audioTranscript').value.trim(),transcript:$('audioTranscript').value.trim()});pendingPoint=null;$('audioDialog').close();showToast('Audio placé');
  }

  async function viewPhotoAnnotation(a) {
    if(!a.photoId)return;const bytes=await getSecureBinary(a.photoId);if(!bytes)return;const blob=new Blob([bytes],{type:a.photoMime||'image/jpeg'}),url=URL.createObjectURL(blob);$('photoViewerImg').src=url;$('photoViewerCaption').textContent=[a.pathology,a.locationDetail,a.opening?`Ouverture : ${a.opening} mm`:'',a.description].filter(Boolean).join(' · ');$('photoViewerDialog').showModal();
  }
  async function viewMediaAnnotation(a){
    if(!a.mediaId)return;const bytes=await getSecureBinary(a.mediaId);if(!bytes)return;const url=URL.createObjectURL(new Blob([bytes],{type:a.mediaMime||'application/octet-stream'}));$('mediaViewerVideo').classList.add('hidden');$('mediaViewerAudio').classList.add('hidden');if(a.type==='video'){$('mediaViewerVideo').src=url;$('mediaViewerVideo').classList.remove('hidden')}else{$('mediaViewerAudio').src=url;$('mediaViewerAudio').classList.remove('hidden')}$('mediaViewerCaption').textContent=a.description||a.transcript||'';$('mediaViewerDialog').showModal();
  }

  async function handwritingToText(){
    const anns=currentAnnotations(),hand=anns.filter(a=>a.type==='handwriting');if(!hand.length){showToast('Écris d’abord avec l’outil Écriture');return}
    const pts=hand.flatMap(a=>a.points||[]);const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),pad=25,w=Math.max(60,maxX-minX+pad*2),h=Math.max(40,maxY-minY+pad*2),scale=3;
    const c=document.createElement('canvas');c.width=Math.ceil(w*scale);c.height=Math.ceil(h*scale);const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.scale(scale,scale);ctx.translate(-minX+pad,-minY+pad);ctx.strokeStyle='black';ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';for(const a of hand){ctx.beginPath();(a.points||[]).forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke()}
    showToast('Reconnaissance de l’écriture…',8000);
    try{const r=await Tesseract.recognize(c,'fra');let text=(r.data.text||'').trim();text=prompt('Texte reconnu. Corrige si besoin :',text)||'';if(!text)return;pushUndo();activeProject.annotations[pageKey()]=anns.filter(a=>a.type!=='handwriting');activeProject.annotations[pageKey()].push({...makeBaseAnn('text'),x:minX,y:minY+18,text,fontSize:18});await saveProject();renderAnnotations();showToast('Écriture convertie en texte')}catch(e){console.error(e);showToast('Reconnaissance impossible. Essaie avec une écriture plus lisible.')}
  }

  function allObservations() {
    const out=[];for(const [key,anns] of Object.entries(activeProject?.annotations||{})){const [fileId,pageStr]=key.split(':'),file=activeProject.files.find(f=>f.id===fileId);for(const a of anns){if(['pathology','crack','photo','video','audio'].includes(a.type))out.push({...a,fileId,page:Number(pageStr),fileName:file?.name||'Plan'})}}return out.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  }
  function renderObservations() {
    if(!activeProject)return;const filter=$('obsFilter')?.value||'all';let obs=allObservations();if(filter!=='all')obs=obs.filter(o=>o.type===filter||(filter==='pathology'&&o.type==='pathology'));
    const box=$('observationList');if(!obs.length){box.innerHTML='<div class="empty">Aucune observation enregistrée.</div>';return}
    const title=o=>o.type==='pathology'?(o.pathology||'Pathologie'):o.type==='crack'?'Fissure tracée':o.type==='photo'?'Photo':o.type==='video'?'Vidéo':'Audio';
    box.innerHTML=obs.map(o=>`<div class="obs-row"><div class="obs-row-main"><div><h4>${escapeHtml(title(o))}</h4><p>${escapeHtml([o.locationDetail,o.opening?`ouverture ${o.opening} mm`:'',o.description].filter(Boolean).join(' · ')||'Sans commentaire')}</p><p>${escapeHtml(o.fileName)} · page ${o.page}${o.severity?' · '+escapeHtml(o.severity):''}</p></div><span class="badge">${escapeHtml(o.type)}</span></div><div class="row-actions"><button class="primary" data-goto-obs="${o.id}" data-file="${o.fileId}" data-page="${o.page}">Voir sur plan</button>${o.photoId?`<button class="secondary" data-photo-obs="${o.id}">Photo</button>`:''}${o.mediaId?`<button class="secondary" data-media-obs="${o.id}">${o.type==='video'?'Vidéo':'Audio'}</button>`:''}</div></div>`).join('');
    box.querySelectorAll('[data-goto-obs]').forEach(b=>b.onclick=()=>openViewer(b.dataset.file,Number(b.dataset.page)));box.querySelectorAll('[data-photo-obs]').forEach(b=>b.onclick=()=>{const o=obs.find(x=>x.id===b.dataset.photoObs);if(o)viewPhotoAnnotation(o)});box.querySelectorAll('[data-media-obs]').forEach(b=>b.onclick=()=>{const o=obs.find(x=>x.id===b.dataset.mediaObs);if(o)viewMediaAnnotation(o)});
  }

  function renderChecklist() {
    if(!activeProject) return;
    if(!activeProject.checklist?.length) activeProject.checklist=checklistDefaults.map((label,i)=>({id:i,label,done:false}));
    $('checklistBox').innerHTML=activeProject.checklist.map((x,i)=>`
      <label class="check-item">
        <input type="checkbox" data-check="${i}" ${x.done?'checked':''}>
        <span>${escapeHtml(x.label)}</span>
      </label>`).join('');
    $('checklistBox').querySelectorAll('[data-check]').forEach(cb=>cb.onchange=async()=>{
      activeProject.checklist[Number(cb.dataset.check)].done=cb.checked;
      await saveProject();
    });
  }

  async function exportCurrentPagePdf() {
    if(!currentFile) return;
    showToast('Création du PDF annoté…',5000);
    const scale=2.2;
    const out=document.createElement('canvas');
    out.width=Math.round(baseW*scale);
    out.height=Math.round(baseH*scale);
    const ctx=out.getContext('2d');
    ctx.fillStyle='white';ctx.fillRect(0,0,out.width,out.height);

    if(currentFile.kind==='pdf'){
      const page=await currentPdf.getPage(currentPage);
      const vp=page.getViewport({scale});
      const temp=document.createElement('canvas');temp.width=vp.width;temp.height=vp.height;
      await page.render({canvasContext:temp.getContext('2d'),viewport:vp}).promise;
      ctx.drawImage(temp,0,0);
    } else if(currentFile.kind==='image'){
      const bytes=currentFileBuffer;
      const url=URL.createObjectURL(new Blob([bytes],{type:currentFile.mime||'image/jpeg'}));
      const img=new Image(); await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=url});
      ctx.drawImage(img,0,0,out.width,out.height);URL.revokeObjectURL(url);
    } else if(currentCadSvg){
      await drawSvgStringToCanvas(currentCadSvg,ctx,out.width,out.height);
    }

    const overlay=serializeAnnotationSvg();
    await drawSvgStringToCanvas(overlay,ctx,out.width,out.height);
    const imgData=out.toDataURL('image/jpeg',.92);
    const {jsPDF}=window.jspdf;
    const orientation=baseW>=baseH?'landscape':'portrait';
    const doc=new jsPDF({orientation,unit:'px',format:[baseW,baseH]});
    doc.addImage(imgData,'JPEG',0,0,baseW,baseH,undefined,'FAST');
    const blob=doc.output('blob');
    downloadBlob(blob,`${safeName(currentFile.name.replace(/\.[^.]+$/,''))}_page_${currentPage}_annotee.pdf`);
    showToast('PDF annoté téléchargé');
  }

  function serializeAnnotationSvg() {
    const clone=$('annotationLayer').cloneNode(true);
    clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
    clone.setAttribute('width',baseW);
    clone.setAttribute('height',baseH);
    clone.setAttribute('viewBox',`0 0 ${baseW} ${baseH}`);
    return new XMLSerializer().serializeToString(clone);
  }

  async function drawSvgStringToCanvas(svgString,ctx,w,h) {
    return new Promise((resolve,reject)=>{
      const blob=new Blob([svgString],{type:'image/svg+xml'});
      const url=URL.createObjectURL(blob);
      const img=new Image();
      img.onload=()=>{ctx.drawImage(img,0,0,w,h);URL.revokeObjectURL(url);resolve()};
      img.onerror=e=>{URL.revokeObjectURL(url);reject(e)};
      img.src=url;
    });
  }

  async function exportVisit() {
    if(!activeProject)return;showToast('Préparation du dossier de visite…',8000);const zip=new JSZip(),root=zip.folder(`FOURNIX_DIAG_${safeName(activeProject.name)}`);
    root.file('projet.json',JSON.stringify({name:activeProject.name,client:activeProject.client,site:activeProject.site,visitDate:activeProject.visitDate,contact:activeProject.contact,missionType:activeProject.missionType,buildingYear:activeProject.buildingYear},null,2));
    root.file('questions_client.json',JSON.stringify(activeProject.visitAnswers||{},null,2));
    const qrows=[['Groupe','Question','Réponse','Note']];for(const q of visitQuestionTemplate.filter(conditionVisible)){const a=activeProject.visitAnswers?.[q.id]||{};qrows.push([q.group,q.q,a.value||'',a.note||''])}root.file('questions_client.csv','\ufeff'+qrows.map(r=>r.map(csvEsc).join(';')).join('\n'));
    root.file('compte_rendu.json',JSON.stringify(activeProject.report||{},null,2));root.file('notes_visite.txt',activeProject.notes||'');root.file('checklist.json',JSON.stringify(activeProject.checklist||[],null,2));
    const plans=root.folder('plans_originaux');for(const f of activeProject.files){const bytes=await getSecureBinary(f.id);if(bytes)plans.file(f.name,bytes)}
    const obs=allObservations(),rows=[['Type','Pathologie','Importance','Ouverture_mm','Localisation','Description','Plan','Page','Fichier_media']],photos=root.folder('photos'),videos=root.folder('videos'),audios=root.folder('audios');
    for(const o of obs){let media='';if(o.photoId){const bytes=await getSecureBinary(o.photoId);media=`photo_${o.id.slice(-8)}.jpg`;if(bytes)photos.file(media,bytes)}if(o.mediaId){const bytes=await getSecureBinary(o.mediaId),ext=(o.mediaName||'bin').split('.').pop(),name=`${o.type}_${o.id.slice(-8)}.${ext}`;media=name;if(bytes)(o.type==='video'?videos:audios).file(name,bytes)}rows.push([o.type,o.pathology||'',o.severity||'',o.opening||'',o.locationDetail||'',o.description||o.transcript||'',o.fileName,o.page,media])}
    root.file('observations.csv','\ufeff'+rows.map(r=>r.map(csvEsc).join(';')).join('\n'));root.file('annotations.json',JSON.stringify(activeProject.annotations||{},null,2));
    const blob=await zip.generateAsync({type:'blob'});downloadBlob(blob,`FOURNIX_DIAG_${safeName(activeProject.name)}_${activeProject.visitDate||'visite'}.zip`);showToast('Dossier de visite téléchargé');
  }

  function csvEsc(v){return `"${String(v??'').replace(/"/g,'""')}"`}

  async function encryptedBackup() {
    if(!activeProject) return;
    const password=prompt('Mot de passe pour cette sauvegarde chiffrée :');
    if(!password || password.length<6){showToast('Mot de passe trop court');return}
    showToast('Création de la sauvegarde…',6000);
    const zip=new JSZip();
    zip.file('project.json',JSON.stringify(activeProject));
    for(const f of activeProject.files){
      const bytes=await getSecureBinary(f.id);
      if(bytes) zip.file(`files/${f.id}`,bytes);
    }
    const mediaIds=new Set();
    allObservations().forEach(o=>{if(o.photoId)mediaIds.add(o.photoId);if(o.mediaId)mediaIds.add(o.mediaId)});
    for(const id of mediaIds){const bytes=await getSecureBinary(id);if(bytes)zip.file(`media/${id}`,bytes);}
    const raw=new Uint8Array(await (await zip.generateAsync({type:'blob'})).arrayBuffer());
    const salt=crypto.getRandomValues(new Uint8Array(16));
    const key=await deriveKey(password,salt);
    const crypt=await encryptBytes(raw,key);
    const envelope={
      format:'FOURNIXDIAG',
      version:2,
      salt:b64(salt),
      iv:crypt.iv,
      data:b64(new Uint8Array(crypt.data))
    };
    downloadBlob(new Blob([JSON.stringify(envelope)],{type:'application/json'}),`${safeName(activeProject.name)}.fournixdiag`);
    showToast('Sauvegarde chiffrée créée');
  }

  async function restoreBackup(file) {
    if(!file)return;
    const password=prompt('Mot de passe de la sauvegarde :');
    if(!password)return;
    showToast('Restauration…',6000);
    try{
      const env=JSON.parse(await file.text());
      if(env.format!=='FOURNIXDIAG') throw new Error('FORMAT');
      const key=await deriveKey(password,unb64(env.salt));
      const bytes=await decryptBytes({iv:env.iv,data:unb64(env.data).buffer},key);
      const zip=await JSZip.loadAsync(bytes);
      const project=JSON.parse(await zip.file('project.json').async('text'));
      const oldId=project.id;
      project.id=uuid('project');
      project.name=(project.name||'Projet')+' - restauré';
      const fileMap={};
      for(const f of project.files||[]){
        const src=zip.file(`files/${f.id}`);
        if(!src)continue;
        const newId=uuid('file');fileMap[f.id]=newId;
        await putSecureBinary(newId,'file',project.id,new Uint8Array(await src.async('arraybuffer')));
        f.id=newId;
      }
      const newAnnotations={};
      const newCal={};
      for(const [keyName,anns] of Object.entries(project.annotations||{})){
        const [fid,page]=keyName.split(':');
        const nf=fileMap[fid]; if(!nf)continue;
        for(const a of anns){
          if(a.photoId){
            const src=zip.file(`media/${a.photoId}`)||zip.file(`photos/${a.photoId}`);
            if(src){
              const np=uuid('photo');
              await putSecureBinary(np,'photo',project.id,new Uint8Array(await src.async('arraybuffer')));
              a.photoId=np;
            }
          }
          if(a.mediaId){const src=zip.file(`media/${a.mediaId}`);if(src){const nm=uuid(a.type==='video'?'video':'audio');await putSecureBinary(nm,a.type,project.id,new Uint8Array(await src.async('arraybuffer')));a.mediaId=nm;}}
        }
        newAnnotations[`${nf}:${page}`]=anns;
      }
      for(const [keyName,val] of Object.entries(project.calibrations||{})){
        const [fid,page]=keyName.split(':'); const nf=fileMap[fid];
        if(nf)newCal[`${nf}:${page}`]=val;
      }
      project.annotations=newAnnotations;project.calibrations=newCal;
      project.createdAt=new Date().toISOString();project.updatedAt=project.createdAt;
      await putSecureJSON(project.id,'project',project.id,project);
      await loadProjects();
      showToast('Projet restauré');
    }catch(e){
      console.error(e);showToast('Sauvegarde ou mot de passe invalide',3500);
    }
  }

  function downloadBlob(blob,name){
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2500);
  }

  function resetAutoLock() {
    clearTimeout(autoLockTimer);
    if(cryptoKey) autoLockTimer=setTimeout(lockApp,AUTO_LOCK_MS);
  }

  function lockApp() {
    cryptoKey=null;
    activeProject=null;
    closeViewer();
    $('app').classList.add('hidden');
    $('lockScreen').classList.remove('hidden');
    $('setupBox').classList.add('hidden');
    $('unlockBox').classList.remove('hidden');
    $('unlockPin').value='';
    $('authText').textContent='Application verrouillée.';
  }

  async function requestPersistentStorage() {
    try{
      if(navigator.storage?.persist) await navigator.storage.persist();
    }catch{}
  }

  async function initAuthUI() {
    const auth=await getAuth();
    if(auth){
      $('unlockBox').classList.remove('hidden');
      $('setupBox').classList.add('hidden');
      $('authText').textContent='Déverrouille tes dossiers de visite.';
    }else{
      $('setupBox').classList.remove('hidden');
      $('unlockBox').classList.add('hidden');
      $('authText').textContent='Crée ton code PIN pour chiffrer les données locales.';
    }
  }

  async function enterApp() {
    $('lockScreen').classList.add('hidden');
    $('app').classList.remove('hidden');
    await requestPersistentStorage();
    await loadProjects();
    resetAutoLock();
  }

  // Events
  $('setupBtn').onclick=async()=>{
    const p1=$('setupPin').value,p2=$('setupPin2').value;
    if(p1.length<4){$('authStatus').textContent='Choisis au moins 4 chiffres.';return}
    if(p1!==p2){$('authStatus').textContent='Les deux codes ne correspondent pas.';return}
    try{await setupAuth(p1);await enterApp()}catch(e){console.error(e);$('authStatus').textContent='Impossible d’activer le chiffrement.'}
  };
  $('unlockBtn').onclick=async()=>{
    try{await unlock($('unlockPin').value);$('authStatus').textContent='';await enterApp()}
    catch(e){$('authStatus').textContent='Code PIN incorrect.'}
  };
  $('unlockPin').addEventListener('keydown',e=>{if(e.key==='Enter')$('unlockBtn').click()});
  $('lockBtn').onclick=lockApp;
  $('newProjectBtn').onclick=()=>showProjectDialog();
  $('backHomeBtn').onclick=closeProject;
  $('editProjectBtn').onclick=()=>showProjectDialog(activeProject);
  $('projectForm').addEventListener('submit',saveProjectForm);
  $('saveProjectBtn').onclick=saveProjectForm;
  document.querySelectorAll('[data-project-tab]').forEach(b=>b.onclick=()=>setProjectTab(b.dataset.projectTab));
  $('planInput').onchange=async e=>{const f=e.target.files?.[0];e.target.value='';if(f)await importPlan(f)};
  $('obsFilter').onchange=renderObservations;
  $('visitType').onchange=async()=>{if(activeProject){activeProject.missionType=$('visitType').value;await saveProject()}};
  $('buildingYear').onchange=async()=>{if(activeProject){activeProject.buildingYear=$('buildingYear').value;await saveProject();renderVisitQuestions()}};
  $('generateSummaryBtn').onclick=generateReportSummary;
  $('saveNotesBtn').onclick=async()=>{activeProject.notes=$('visitNotes').value;await saveReportFields();showToast('Compte rendu enregistré')};
  ['reportPeople','reportZones','reportAccess','reportTests','reportFindings','reportLimits','reportActions','reportNext'].forEach(id=>$(id).addEventListener('change',saveReportFields));
  let notesTimer=null;
  $('visitNotes').addEventListener('input',()=>{clearTimeout(notesTimer);notesTimer=setTimeout(async()=>{if(activeProject){activeProject.notes=$('visitNotes').value;await saveProject()}},800)});
  $('exportVisitBtn').onclick=exportVisit;
  $('backupProjectBtn').onclick=encryptedBackup;
  $('restoreProjectInput').onchange=async e=>{const f=e.target.files?.[0];e.target.value='';if(f)await restoreBackup(f)};

  $('closeViewerBtn').onclick=closeViewer;
  $('zoomInBtn').onclick=()=>setZoom(zoom*1.3,{x:innerWidth/2,y:innerHeight/2});
  $('zoomOutBtn').onclick=()=>setZoom(zoom/1.3,{x:innerWidth/2,y:innerHeight/2});
  $('fitBtn').onclick=fitToScreen;
  $('prevPageBtn').onclick=()=>changePage(-1);
  $('nextPageBtn').onclick=()=>changePage(1);
  $('exportPageBtn').onclick=exportCurrentPagePdf;
  document.querySelectorAll('#viewerTools [data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
  $('undoBtn').onclick=undo;

  const stage=$('viewerStage');
  stage.addEventListener('pointerdown',e=>{stage.setPointerCapture?.(e.pointerId);pointerStartHandler(e)});
  stage.addEventListener('pointermove',pointerMoveHandler);
  stage.addEventListener('pointerup',pointerEndHandler);
  stage.addEventListener('pointercancel',pointerEndHandler);

  $('saveObservationBtn').onclick=async e=>{e.preventDefault();await saveObservation()};
  $('savePhotoBtn').onclick=async e=>{e.preventDefault();await savePhotoAnnotation()};
  $('saveVideoBtn').onclick=async e=>{e.preventDefault();await saveVideoAnnotation()};
  $('startAudioBtn').onclick=startAudioRecording;
  $('stopAudioBtn').onclick=stopAudioRecording;
  $('transcribeAudioBtn').onclick=transcribeAudioLocal;
  $('saveAudioBtn').onclick=async e=>{e.preventDefault();await saveAudioAnnotation()};
  $('handwritingToTextBtn').onclick=handwritingToText;
  $('closePhotoViewerBtn').onclick=()=>{$('photoViewerDialog').close();$('photoViewerImg').src=''};
  $('closeMediaViewerBtn').onclick=()=>{$('mediaViewerDialog').close();$('mediaViewerVideo').pause();$('mediaViewerAudio').pause();$('mediaViewerVideo').removeAttribute('src');$('mediaViewerAudio').removeAttribute('src')};

  ['pointerdown','keydown','touchstart'].forEach(ev=>document.addEventListener(ev,resetAutoLock,{passive:true}));

  window.addEventListener('resize',()=>{if(!$('viewer').classList.contains('hidden'))fitToScreen()});

  // Init
  (async()=>{
    await openDB();
    await initAuthUI();
    if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  })();
})();
