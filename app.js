
/* FOURNIX Diagnostic v1
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
      name:'',
      client:'',
      site:'',
      visitDate:new Date().toISOString().slice(0,10),
      contact:'',
      createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString(),
      files:[],
      annotations:{},
      calibrations:{},
      notes:'',
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

  async function openProject(id) {
    activeProject = await getSecureJSON(id);
    if (!activeProject) return;
    $('homeView').classList.remove('active');
    $('projectView').classList.add('active');
    $('projectTitle').textContent = activeProject.name || 'Projet';
    $('projectMetaLine').textContent = [activeProject.client,activeProject.site,fmtDate(activeProject.visitDate)].filter(Boolean).join(' · ');
    $('visitNotes').value = activeProject.notes || '';
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
    if (name==='observations') renderObservations();
    if (name==='checklist') renderChecklist();
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
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const renderScale = Math.max(1,Math.min(zoom,6)) * dpr;
    const vp = page.getViewport({scale:renderScale});
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
    next=Math.max(.08,Math.min(next,12));
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

  function annotationElement(a) {
    const color=a.color || '#d11a2a';
    const width=a.width || 3;
    let el;
    if(a.type==='freehand'){
      const d=(a.points||[]).map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ');
      el=svgEl('path',{d,fill:'none',stroke:color,'stroke-width':width,'stroke-linecap':'round','stroke-linejoin':'round','vector-effect':'non-scaling-stroke'});
    } else if(a.type==='line' || a.type==='measure' || a.type==='calibration'){
      const g=svgEl('g');
      g.appendChild(svgEl('line',{x1:a.x1,y1:a.y1,x2:a.x2,y2:a.y2,stroke:color,'stroke-width':width,'vector-effect':'non-scaling-stroke'}));
      if(a.label){
        const tx=(a.x1+a.x2)/2, ty=(a.y1+a.y2)/2-8/Math.max(zoom,.2);
        const t=svgEl('text',{x:tx,y:ty,fill:color,'font-size':14/Math.max(zoom,.45),'text-anchor':'middle',class:'marker-label'});
        t.textContent=a.label; g.appendChild(t);
      }
      el=g;
    } else if(a.type==='arrow'){
      const g=svgEl('g');
      const line=svgEl('line',{x1:a.x1,y1:a.y1,x2:a.x2,y2:a.y2,stroke:color,'stroke-width':width,'vector-effect':'non-scaling-stroke'});
      g.appendChild(line);
      const ang=Math.atan2(a.y2-a.y1,a.x2-a.x1), len=18/Math.max(zoom,.4);
      const p1={x:a.x2-len*Math.cos(ang-Math.PI/6),y:a.y2-len*Math.sin(ang-Math.PI/6)};
      const p2={x:a.x2-len*Math.cos(ang+Math.PI/6),y:a.y2-len*Math.sin(ang+Math.PI/6)};
      g.appendChild(svgEl('polyline',{points:`${p1.x},${p1.y} ${a.x2},${a.y2} ${p2.x},${p2.y}`,fill:'none',stroke:color,'stroke-width':width,'vector-effect':'non-scaling-stroke'}));
      el=g;
    } else if(a.type==='rect'){
      el=svgEl('rect',{x:Math.min(a.x1,a.x2),y:Math.min(a.y1,a.y2),width:Math.abs(a.x2-a.x1),height:Math.abs(a.y2-a.y1),fill:'none',stroke:color,'stroke-width':width,'vector-effect':'non-scaling-stroke'});
    } else if(a.type==='text'){
      el=svgEl('text',{x:a.x,y:a.y,fill:color,'font-size':a.fontSize||18,class:'marker-label'});
      el.textContent=a.text||'Texte';
    } else if(a.type==='pathology'){
      const g=svgEl('g',{'data-ann-id':a.id});
      const r=10/Math.max(zoom,.45);
      g.appendChild(svgEl('circle',{cx:a.x,cy:a.y,r,fill:a.color||pathologyColors[a.pathology]||'#d11a2a',stroke:'#fff','stroke-width':2/Math.max(zoom,.45)}));
      const t=svgEl('text',{x:a.x+r+4/Math.max(zoom,.45),y:a.y+4/Math.max(zoom,.45),fill:a.color||'#d11a2a','font-size':12/Math.max(zoom,.45),class:'marker-label'});
      t.textContent=a.pathology || 'Observation'; g.appendChild(t); el=g;
    } else if(a.type==='photo'){
      const g=svgEl('g',{'data-photo-id':a.photoId,'data-ann-id':a.id});
      const s=22/Math.max(zoom,.45);
      g.appendChild(svgEl('rect',{x:a.x-s/2,y:a.y-s/2,width:s,height:s,rx:4/Math.max(zoom,.45),fill:'#111827',stroke:'#fff','stroke-width':2/Math.max(zoom,.45)}));
      const t=svgEl('text',{x:a.x,y:a.y+4/Math.max(zoom,.45),fill:'#fff','font-size':10/Math.max(zoom,.45),'text-anchor':'middle'});
      t.textContent='P'; g.appendChild(t); el=g;
      g.style.cursor='pointer';
      g.addEventListener('click',e=>{e.stopPropagation();viewPhotoAnnotation(a)});
    } else {
      el=svgEl('g');
    }
    el.dataset.annId=a.id||'';
    return el;
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

  function pointerStartHandler(e) {
    resetAutoLock();
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===2){
      const pts=[...pointers.values()];
      pinchState={
        dist:Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y),
        zoom,
        center:{x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2}
      };
      pointerDown=false;
      return;
    }
    pointerDown=true;
    pointerStart={clientX:e.clientX,clientY:e.clientY,plan:screenToPlan(e.clientX,e.clientY),panX,panY};
    const p=pointerStart.plan;

    if(activeTool==='freehand'){
      drawPoints=[p];
      currentDraft=makeBaseAnn('freehand');
      currentDraft.points=drawPoints;
    } else if(['line','arrow','rect','calibrate','measure'].includes(activeTool)){
      currentDraft=makeBaseAnn(activeTool==='calibrate'?'calibration':activeTool);
      Object.assign(currentDraft,{x1:p.x,y1:p.y,x2:p.x,y2:p.y});
    } else if(activeTool==='text'){
      const txt=prompt('Texte à placer :');
      if(txt) commitAnnotation({...makeBaseAnn('text'),x:p.x,y:p.y,text:txt,fontSize:18});
      pointerDown=false;
    } else if(activeTool==='pathology'){
      pendingPoint=p;
      $('obsDescription').value='';
      $('obsPhotoInput').value='';
      pendingObsPhoto=null;
      $('observationDialog').showModal();
      pointerDown=false;
    } else if(activeTool==='photo'){
      pendingPoint=p;
      $('photoInput').value='';
      $('photoDescription').value='';
      $('photoDialog').showModal();
      pointerDown=false;
    } else if(activeTool==='erase'){
      eraseNearest(p);
      pointerDown=false;
    }
  }

  function pointerMoveHandler(e) {
    if(pointers.has(e.pointerId)) pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===2 && pinchState){
      const pts=[...pointers.values()];
      const dist=Math.hypot(pts[1].x-pts[0].x,pts[1].y-pts[0].y);
      const center={x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2};
      setZoom(pinchState.zoom*(dist/pinchState.dist),center);
      return;
    }
    if(!pointerDown || !pointerStart) return;
    if(activeTool==='pan'){
      panX=pointerStart.panX+(e.clientX-pointerStart.clientX);
      panY=pointerStart.panY+(e.clientY-pointerStart.clientY);
      updateTransform();
      return;
    }
    const p=screenToPlan(e.clientX,e.clientY);
    if(activeTool==='freehand' && currentDraft){
      drawPoints.push(p);
      currentDraft.points=drawPoints;
      renderDraft();
    } else if(currentDraft){
      currentDraft.x2=p.x; currentDraft.y2=p.y;
      renderDraft();
    }
  }

  function pointerEndHandler(e) {
    pointers.delete(e.pointerId);
    if(pointers.size<2) pinchState=null;
    if(!pointerDown) return;
    pointerDown=false;
    if(activeTool==='pan') return;
    const d=currentDraft;
    currentDraft=null;
    removeDraft();
    if(!d) return;

    if(d.type==='calibration'){
      const px=Math.hypot(d.x2-d.x1,d.y2-d.y1);
      if(px<2) return;
      const real=prompt('Longueur réelle de cette ligne :');
      if(!real) return;
      const val=parseFloat(String(real).replace(',','.'));
      if(!val || val<=0) return;
      const unit=prompt('Unité (m, cm, mm) :','m') || 'm';
      activeProject.calibrations[pageKey()]={unitPerPx:val/px,unit};
      d.label=`Calibration ${val} ${unit}`;
      commitAnnotation(d);
      showToast('Échelle calibrée');
    } else if(d.type==='measure'){
      const cal=activeProject.calibrations[pageKey()];
      if(!cal){showToast('Calibre d’abord le plan');return}
      const px=Math.hypot(d.x2-d.x1,d.y2-d.y1);
      d.label=`${(px*cal.unitPerPx).toFixed(2)} ${cal.unit}`;
      commitAnnotation(d);
    } else {
      if(d.type==='freehand' && (d.points?.length||0)<2) return;
      commitAnnotation(d);
    }
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

  async function saveObservation() {
    if(!pendingPoint) return;
    const type=$('pathologyType').value;
    const ann={
      ...makeBaseAnn('pathology'),
      x:pendingPoint.x,y:pendingPoint.y,
      pathology:type,
      severity:$('severity').value,
      description:$('obsDescription').value.trim(),
      color:pathologyColors[type]||$('drawColor').value
    };
    const f=$('obsPhotoInput').files?.[0];
    if(f){
      const photoId=uuid('photo');
      await putSecureBinary(photoId,'photo',activeProject.id,new Uint8Array(await f.arrayBuffer()));
      ann.photoId=photoId;
      ann.photoMime=f.type||'image/jpeg';
      ann.photoName=f.name||'photo.jpg';
    }
    await commitAnnotation(ann);
    pendingPoint=null;
    $('observationDialog').close();
    showToast('Observation placée');
  }

  async function savePhotoAnnotation() {
    if(!pendingPoint) return;
    const f=$('photoInput').files?.[0];
    if(!f){showToast('Choisis une photo');return}
    const photoId=uuid('photo');
    await putSecureBinary(photoId,'photo',activeProject.id,new Uint8Array(await f.arrayBuffer()));
    const ann={
      ...makeBaseAnn('photo'),
      x:pendingPoint.x,y:pendingPoint.y,
      photoId,
      photoMime:f.type||'image/jpeg',
      photoName:f.name||'photo.jpg',
      description:$('photoDescription').value.trim()
    };
    await commitAnnotation(ann);
    pendingPoint=null;
    $('photoDialog').close();
    showToast('Photo placée');
  }

  async function viewPhotoAnnotation(a) {
    if(!a.photoId) return;
    const bytes=await getSecureBinary(a.photoId);
    if(!bytes) return;
    const blob=new Blob([bytes],{type:a.photoMime||'image/jpeg'});
    const url=URL.createObjectURL(blob);
    $('photoViewerImg').src=url;
    $('photoViewerCaption').textContent=a.description||a.pathology||'';
    $('photoViewerDialog').showModal();
  }

  function allObservations() {
    const out=[];
    for(const [key,anns] of Object.entries(activeProject?.annotations||{})){
      const [fileId,pageStr]=key.split(':');
      const file=activeProject.files.find(f=>f.id===fileId);
      for(const a of anns){
        if(a.type==='pathology'||a.type==='photo') out.push({...a,fileId,page:Number(pageStr),fileName:file?.name||'Plan'});
      }
    }
    return out.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  }

  function renderObservations() {
    if(!activeProject) return;
    const filter=$('obsFilter')?.value||'all';
    let obs=allObservations();
    if(filter==='pathology') obs=obs.filter(o=>o.type==='pathology');
    if(filter==='photo') obs=obs.filter(o=>o.type==='photo');
    const box=$('observationList');
    if(!obs.length){box.innerHTML='<div class="empty">Aucune observation enregistrée.</div>';return}
    box.innerHTML=obs.map(o=>`
      <div class="obs-row">
        <div class="obs-row-main">
          <div>
            <h4>${escapeHtml(o.type==='pathology' ? (o.pathology||'Pathologie') : 'Photo')}</h4>
            <p>${escapeHtml(o.description||'Sans commentaire')}</p>
            <p>${escapeHtml(o.fileName)} · page ${o.page}${o.severity?' · '+escapeHtml(o.severity):''}</p>
          </div>
          <span class="badge">${o.type==='pathology'?'Observation':'Photo'}</span>
        </div>
        <div class="row-actions">
          <button class="primary" data-goto-obs="${o.id}" data-file="${o.fileId}" data-page="${o.page}">Voir sur plan</button>
          ${o.photoId?`<button class="secondary" data-photo-obs="${o.id}">Voir photo</button>`:''}
        </div>
      </div>`).join('');
    box.querySelectorAll('[data-goto-obs]').forEach(b=>b.onclick=()=>openViewer(b.dataset.file,Number(b.dataset.page)));
    box.querySelectorAll('[data-photo-obs]').forEach(b=>b.onclick=()=>{
      const o=obs.find(x=>x.id===b.dataset.photoObs); if(o)viewPhotoAnnotation(o);
    });
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
    if(!activeProject) return;
    showToast('Préparation du dossier de visite…',6000);
    const zip=new JSZip();
    const root=zip.folder(`FOURNIX_Diagnostic_${safeName(activeProject.name)}`);
    root.file('projet.json',JSON.stringify({
      name:activeProject.name,client:activeProject.client,site:activeProject.site,
      visitDate:activeProject.visitDate,contact:activeProject.contact
    },null,2));
    root.file('notes_visite.txt',activeProject.notes||'');
    root.file('checklist.json',JSON.stringify(activeProject.checklist||[],null,2));

    const plans=root.folder('plans_originaux');
    for(const f of activeProject.files){
      const bytes=await getSecureBinary(f.id);
      if(bytes) plans.file(f.name,bytes);
    }

    const obs=allObservations();
    const rows=[['Type','Pathologie','Importance','Description','Plan','Page','Photo']];
    const photos=root.folder('photos');
    for(const o of obs){
      let photoName='';
      if(o.photoId){
        const bytes=await getSecureBinary(o.photoId);
        photoName=`${safeName(o.pathology||'photo')}_${o.id.slice(-8)}.${(o.photoName||'jpg').split('.').pop()}`;
        if(bytes) photos.file(photoName,bytes);
      }
      rows.push([o.type,o.pathology||'',o.severity||'',o.description||'',o.fileName,o.page,photoName]);
    }
    root.file('observations.csv','\ufeff'+rows.map(r=>r.map(csvEsc).join(';')).join('\n'));
    root.file('annotations.json',JSON.stringify(activeProject.annotations||{},null,2));

    const blob=await zip.generateAsync({type:'blob'});
    downloadBlob(blob,`FOURNIX_Diagnostic_${safeName(activeProject.name)}_${activeProject.visitDate||'visite'}.zip`);
    showToast('Dossier de visite téléchargé');
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
    const photoIds=new Set();
    allObservations().forEach(o=>{if(o.photoId)photoIds.add(o.photoId)});
    for(const id of photoIds){
      const bytes=await getSecureBinary(id);
      if(bytes) zip.file(`photos/${id}`,bytes);
    }
    const raw=new Uint8Array(await (await zip.generateAsync({type:'blob'})).arrayBuffer());
    const salt=crypto.getRandomValues(new Uint8Array(16));
    const key=await deriveKey(password,salt);
    const crypt=await encryptBytes(raw,key);
    const envelope={
      format:'FOURNIXDIAG',
      version:1,
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
            const src=zip.file(`photos/${a.photoId}`);
            if(src){
              const np=uuid('photo');
              await putSecureBinary(np,'photo',project.id,new Uint8Array(await src.async('arraybuffer')));
              a.photoId=np;
            }
          }
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
  $('saveNotesBtn').onclick=async()=>{activeProject.notes=$('visitNotes').value;await saveProject();showToast('Notes enregistrées')};
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
  $('closePhotoViewerBtn').onclick=()=>{$('photoViewerDialog').close();$('photoViewerImg').src=''};

  ['pointerdown','keydown','touchstart'].forEach(ev=>document.addEventListener(ev,resetAutoLock,{passive:true}));

  window.addEventListener('resize',()=>{if(!$('viewer').classList.contains('hidden'))fitToScreen()});

  // Init
  (async()=>{
    await openDB();
    await initAuthUI();
    if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  })();
})();
