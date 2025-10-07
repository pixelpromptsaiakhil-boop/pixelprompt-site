// script.js - PixelPrompt (revised, minimal edits)
// Kept firebase-compat style; minimal changes: add local demo persistence, badges,
// toggle-safe like/save behavior, migration to Firestore on login, fetch counts.

/* --- guard against double-load --- */
if (window.PixelPrompt && window.PixelPrompt._initialized) {
  console.warn('PixelPrompt script already initialized — skipping duplicate load.');
} else {
  window.PixelPrompt = window.PixelPrompt || {};
  window.PixelPrompt._initialized = true;
}

/* -------------------------
   Optional Firebase init (compat)
   ------------------------- */
(function initFirebaseCompatSafely(){
  if (window.firebaseConfig && typeof window.firebase !== 'undefined') {
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.firebaseConfig);
      window._pp = window._pp || {};
      window._pp.auth = firebase.auth();
      window._pp.db = firebase.firestore();
      window._pp.storage = firebase.storage();
      console.log('Firebase initialized (compat) — project:', window.firebaseConfig.projectId);
    } catch (err) {
      console.warn('Firebase init error (compat):', err);
    }
  } else {
    if (!window.firebaseConfig) console.warn('firebase-config.js not loaded or firebaseConfig missing. Running in DEMO mode.');
  }
})();

/* -------------------------
   Small DOM helpers
   ------------------------- */
function qs(sel, ctx = document) { try { return ctx.querySelector(sel); } catch(e){ return null; } }
function qsa(sel, ctx = document) { try { return Array.from((ctx || document).querySelectorAll(sel)); } catch(e){ return []; } }
function safeSetText(el, text) { if (el) el.textContent = text; }

/* -------------------------
   App state
   ------------------------- */
const state = {
  theme: localStorage.getItem('theme') || 'light',
  user: null,
  isBackend: (typeof window.firebase !== 'undefined') && !!(window.firebase && firebase.apps && firebase.apps.length),
  pageSize: 10,
  lastVisible: null,
  isFetching: false,
  currentFilter: 'All',
  heroInterval: null,
  slideIndex: 0,
  _redirectProcessed: false // internal: ensure redirect handled once
};

/* -------------------------
   Theme & icons
   ------------------------- */
const body = document.body;
const themeToggleBtn = qs('#theme-toggle');
const themeIcon = qs('#theme-icon');

function updateIconsForTheme(theme) {
  const mode = theme === 'dark' ? 'dark' : 'light';
  const logoFull = qs('#logo-full');
  const logoIcon = qs('#logo-icon');
  const smallLogo = qs('.logo-icon-small-top');

  if (logoFull) logoFull.src = `assets/${mode}/logo-full.svg`;
  if (logoIcon) logoIcon.src = `assets/${mode}/logo-icon.svg`;
  if (smallLogo) smallLogo.src = `assets/${mode}/logo-icon.svg`;

  qsa('img.icon, img.icon-small, .header-logo img').forEach(img => {
    if (img && img.id !== 'theme-icon') {
      const file = (img.getAttribute('src') || '').split('/').pop();
      if (file) img.src = `assets/${mode}/${file}`;
    }
  });

  if (themeIcon) {
    themeIcon.src = theme === 'dark' ? 'assets/dark/sun.svg' : 'assets/light/moon.svg';
  }
}

function setTheme(theme) {
  state.theme = theme;
  body.classList.remove('theme-light', 'theme-dark');
  body.classList.add(`theme-${theme}`);
  localStorage.setItem('theme', theme);
  updateIconsForTheme(theme);
}
function toggleTheme(){ setTheme(state.theme === 'dark' ? 'light' : 'dark'); }

/* -------------------------
   Firebase helpers (compat)
   ------------------------- */
function firebaseReady(){ return typeof window.firebase !== 'undefined' && !!(window.firebase && firebase.apps && firebase.apps.length); }
function getAuthCompat(){ return firebaseReady() ? firebase.auth() : null; }
function getDBCompat(){ return firebaseReady() ? firebase.firestore() : null; }
function getStorageCompat(){ return firebaseReady() ? firebase.storage() : null; }

/* -------------------------
   Demo images fallback
   ------------------------- */
const demoImages = [
  { id:'demo1', title:'Cyberpunk Alley', prompt:'A cinematic rainy cyberpunk alley, neon.', views:120, likesCount:45, filter:'Trending', tags:['cyberpunk','city'], storagePath:'https://placehold.co/800x500/4a0553/a8a29e?text=Cyberpunk', creditsLink:'https://example.com' },
  { id:'demo2', title:'Forest Spirit', prompt:'Mysterious forest spirit, vibrant forest.', views:98, likesCount:30, filter:'People', tags:['fantasy','spirit'], storagePath:'https://placehold.co/800x500/035921/a8a29e?text=Forest', creditsLink:'https://example.com' },
  { id:'demo3', title:'Abstract Nebula', prompt:'Abstract nebula, vibrant colors.', views:210, likesCount:88, filter:'Design', tags:['abstract','space'], storagePath:'https://placehold.co/800x500/223769/a8a29e?text=Abstract', creditsLink:'https://example.com' },
  { id:'demo4', title:'Funny Dog Astronaut', prompt:'Pug in an astronaut suit.', views:150, likesCount:75, filter:'Funny', tags:['funny','animal'], storagePath:'https://placehold.co/800x500/7a2741/a8a29e?text=Pug', creditsLink:'https://example.com' },
  { id:'demo5', title:'Couple at Sunset', prompt:'Silhouette couple on a beach.', views:110, likesCount:40, filter:'Couples', tags:['couple','sunset'], storagePath:'https://placehold.co/800x500/4a2c5a/a8a29e?text=Couple', creditsLink:'https://example.com' }
];

/* -------------------------
   DOM refs (cached)
   ------------------------- */
const imageGallery = qs('#image-gallery');
const top5Panel = qs('#top5-panel');
const filterChipsContainer = qs('#filter-chips');
const loadingIndicator = qs('#loading-indicator');
const heroSlider = qs('#hero-slider');
const sliderDotsContainer = qs('.slider-dots');
const imageModal = qs('#image-modal');
const modalCloseBtn = qs('#modal-close-btn');
const modalImage = qs('#modal-image');
const modalTitle = qs('#modal-title');
const modalPrompt = qs('#modal-prompt');
const modalViews = qs('#modal-views');
const modalCredits = qs('#modal-credits');
const modalTags = qs('#modal-tags');
const modalSuggestionsList = qs('#modal-suggestions-list');
const copyPromptBtn = qs('#copy-prompt-btn');
const likeBtn = qs('#like-btn');
const likeIcon = qs('#like-icon');
const likeCountSpan = qs('#like-count');
const saveBtn = qs('#save-btn');
const saveIcon = qs('#save-icon');
const commentForm = qs('#comment-form');
const commentInput = qs('#comment-input');
const commentsList = qs('#modal-comments-list');
const commentsCountSpan = qs('#comments-count');
const loginModal = qs('#login-modal');
const googleLoginBtn = qs('#google-login-btn');

const loginBtn = qs('#login-btn');
const notificationsBtn = qs('#notificationsBtn');
const notificationsPanel = qs('#notifications-panel');
const closeNotifsBtn = qs('#close-notifs');
const notificationsList = qs('#notifications-list');

const loginModalCloseBtn = qs('#login-modal-close-btn'); // new handler

/* -------------------------
   LocalStorage keys & helpers (demo mode)
   ------------------------- */
const LS_KEYS = {
  liked: 'pp_liked_ids',
  saved: 'pp_saved_ids'
};

function getLocalLiked(){
  try { return JSON.parse(localStorage.getItem(LS_KEYS.liked) || '[]'); } catch(e){ return []; }
}
function setLocalLiked(arr){ localStorage.setItem(LS_KEYS.liked, JSON.stringify(Array.from(new Set(arr)))); }

function getLocalSaved(){
  try { return JSON.parse(localStorage.getItem(LS_KEYS.saved) || '[]'); } catch(e){ return []; }
}
function setLocalSaved(arr){ localStorage.setItem(LS_KEYS.saved, JSON.stringify(Array.from(new Set(arr)))); }

/* -------------------------
   Header badge helpers (small badges added via JS; no CSS changes required)
   ------------------------- */
function updateHeaderBadges(){
  // liked badge -> nav-left link to liked.html
  const likedNav = qs('.nav-left a[href="liked.html"]');
  const collNav = qs('.nav-left a[href="collections.html"]');

  const likedCount = firebaseReady() && state.user ? _pp_user_like_count || 0 : getLocalLiked().length;
  const savedCount = firebaseReady() && state.user ? _pp_user_saved_count || 0 : getLocalSaved().length;

  setBadgeOnNav(likedNav, likedCount, '#ef4444'); // red for likes
  setBadgeOnNav(collNav, savedCount, '#0ea5e9');   // blue for saved
}

function setBadgeOnNav(navEl, count, bg){
  if(!navEl) return;
  navEl.style.position = navEl.style.position || 'relative';
  let existing = navEl.querySelector('.pp-badge');
  if(!existing){
    existing = document.createElement('span');
    existing.className = 'pp-badge';
    existing.style.cssText = 'position:absolute;top:6px;right:6px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:#fff;font-weight:700;';
    navEl.appendChild(existing);
  }
  existing.style.background = bg || '#333';
  existing.textContent = (count > 99) ? '99+' : (count > 0 ? String(count) : '');
  existing.style.display = (count && count > 0) ? 'inline-flex' : 'none';
}

/* keep server counts cached for header use */
let _pp_user_like_count = 0;
let _pp_user_saved_count = 0;

/* -------------------------
   Migrate local demo likes/saves into Firestore on first login
   ------------------------- */
async function migrateLocalToFirestore(uid){
  if(!firebaseReady() || !uid) return;
  try{
    const db = getDBCompat();
    const localLiked = getLocalLiked();
    const localSaved = getLocalSaved();

    // Likes migration: create per-user like docs and increment images.likesCount where needed.
    for(const imageId of localLiked){
      const likeDocRef = db.collection('imageLikes').doc(`${imageId}_${uid}`);
      const snap = await likeDocRef.get();
      if(!snap.exists || !snap.data().liked){
        // set liked doc
        await likeDocRef.set({ liked:true, userId: uid, imageId, createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
        // increment image like count (best-effort)
        try { await db.collection('images').doc(imageId).update({ likesCount: firebase.firestore.FieldValue.increment(1) }); } catch(e){ /* ignore */ }
      }
    }

    // Saved migration: write into users/{uid}/saved/{imageId}
    for(const imageId of localSaved){
      const saveRef = db.collection('users').doc(uid).collection('saved').doc(imageId);
      const snap = await saveRef.get();
      if(!snap.exists || !snap.data().saved){
        await saveRef.set({ saved:true, createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true });
      }
    }

    // After migration we can optionally clear local storages (keep for safety)
    // setLocalLiked([]); setLocalSaved([]);
    console.log('Local demo data migrated to Firestore for user:', uid);
  }catch(err){ console.error('Migration error:', err); }
}

/* -------------------------
   Fetch per-user saved & like counts from Firestore (for header badges)
   ------------------------- */
async function fetchUserSavedAndLikedCounts(uid){
  if(!firebaseReady() || !uid) return;
  try{
    const db = getDBCompat();
    // saved count
    const savedSnap = await db.collection('users').doc(uid).collection('saved').where('saved','==',true).get();
    _pp_user_saved_count = savedSnap.size || 0;

    // like count (imageLikes where userId == uid and liked == true)
    const likesSnap = await db.collection('imageLikes').where('userId','==',uid).where('liked','==',true).get();
    _pp_user_like_count = likesSnap.size || 0;

    updateHeaderBadges();
  }catch(err){ console.error('fetch user saved/likes error:', err); }
}

/* -------------------------
   Helpers to swap icons when toggled
   ------------------------- */
function setLikeIconVisual(isLiked){
  // modal icon
  if(likeIcon){
    likeIcon.src = isLiked ? (state.theme === 'dark' ? 'assets/dark/heart-filled.svg' : 'assets/light/heart-filled.svg') : (state.theme === 'dark' ? 'assets/dark/heart-outline.svg' : 'assets/light/heart-outline.svg');
  }
  // left nav heart icon (if present)
  const navHeartImg = qs('.nav-left a[href="liked.html"] img');
  if(navHeartImg){
    const srcTail = isLiked ? 'heart-filled.svg' : 'heart-outline.svg';
    navHeartImg.src = `assets/${state.theme === 'dark' ? 'dark' : 'light'}/${srcTail}`;
  }
}

function setSaveIconVisual(isSaved){
  if(saveIcon){
    saveIcon.src = isSaved ? (state.theme === 'dark' ? 'assets/dark/save-filled.svg' : 'assets/light/save-filled.svg') : (state.theme === 'dark' ? 'assets/dark/save-outline.svg' : 'assets/light/save-outline.svg');
  }
  const navCollImg = qs('.nav-left a[href="collections.html"] img');
  if(navCollImg){
    const srcTail = isSaved ? 'collections-filled.svg' : 'collections.svg';
    // if you don't have collections-filled.svg fallback to collections.svg (non-filled)
    navCollImg.src = `assets/${state.theme === 'dark' ? 'dark' : 'light'}/${srcTail}`;
  }
}

/* -------------------------
   Programmatic modal opener helper
   ------------------------- */
function openImageModalWithData(imageData = {}) {
  if (!imageModal) return;
  // populate and show
  populateModal(imageData);
  imageModal.classList.add('active');
  imageModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(()=> {
    const scroll = qs('.modal-body-scroll');
    if(scroll) scroll.scrollTop = 0;
  }, 50);
}

/* -------------------------
   Hero fetch & render
   ------------------------- */
async function fetchHeroFromFirestore(){
  if(!getDBCompat()){
    // fallback demo heroes
    renderHeroSlides([ demoImages[0], demoImages[1], demoImages[2] ]);
    setupHeroSlider();
    return;
  }
  try{
    const db = getDBCompat();
    const snap = await db.collection('images').where('hero','==',true).orderBy('createdAt','desc').limit(3).get();
    const arr = [];
    snap.forEach(d=>arr.push({id:d.id,...d.data()}));
    if(arr.length===0){
      renderHeroSlides([ demoImages[0], demoImages[1], demoImages[2] ]);
    } else {
      renderHeroSlides(arr);
    }
    setupHeroSlider();
  }catch(err){
    console.error('fetchHeroFromFirestore error', err);
    renderHeroSlides([ demoImages[0], demoImages[1], demoImages[2] ]);
    setupHeroSlider();
  }
}

function renderHeroSlides(images=[]){
  if(!heroSlider) return;
  heroSlider.innerHTML='';
  images.forEach((img, idx)=>{
    const slide=document.createElement('div');
    slide.className='slide';
    if(img.id) slide.dataset.id = img.id;
    /* NOTE: prompt intentionally NOT rendered in hero overlay
       -- only title should show (as requested) */
    slide.innerHTML=`
      <img src="${img.storagePath || ''}" alt="Hero ${idx+1}">
      <div class="slide-overlay">
        <h2 class="slide-title">${img.title || ''}</h2>
      </div>
    `;
    slide.addEventListener('click', async (e) => {
      e.stopPropagation();
      if(state.isBackend && img.id && getDBCompat()){
        try{
          const db = getDBCompat();
          const docRef = db.collection('images').doc(img.id);
          const snap = await docRef.get();
          if(!snap.exists){
            openImageModalWithData(img);
            return;
          }
          const data = Object.assign({id: snap.id}, snap.data());
          openImageModalWithData(data);
          docRef.update({ views: firebase.firestore.FieldValue.increment(1) }).catch(()=>{});
          subscribeComments(img.id);
        }catch(err){ console.error('Error opening hero slide doc:', err); openImageModalWithData(img); }
      } else {
        openImageModalWithData(img);
      }
    });
    heroSlider.appendChild(slide);
  });
}

/* -------------------------
   Hero slider
   ------------------------- */
function setupHeroSlider(){
  if(!heroSlider) return;
  const slides = qsa('#hero-slider .slide'); if(!slides.length) return;
  if (sliderDotsContainer) sliderDotsContainer.innerHTML = '';
  slides.forEach((s,i)=> {
    const b = document.createElement('button'); b.className='dot'; b.title=`Slide ${i+1}`;
    b.addEventListener('click', ()=>{ gotoSlide(i); resetHeroAutoplay(); });
    sliderDotsContainer && sliderDotsContainer.appendChild(b);
  });

  function gotoSlide(i){
    state.slideIndex = ((i % slides.length) + slides.length) % slides.length;
    heroSlider.style.transform = `translateX(-${state.slideIndex * 100}%)`;
    qsa('.slider-dots .dot').forEach((d,idx)=> d.classList.toggle('active', idx===state.slideIndex));
  }
  function nextSlide(){ gotoSlide(state.slideIndex + 1); }
  function startAutoplay(){ stopAutoplay(); state.heroInterval = setInterval(nextSlide, 5000); }
  function stopAutoplay(){ if(state.heroInterval){ clearInterval(state.heroInterval); state.heroInterval = null; } }
  function resetHeroAutoplay(){ stopAutoplay(); startAutoplay(); }

  qs('.slider-prev')?.addEventListener('click', ()=>{ gotoSlide(state.slideIndex-1); resetHeroAutoplay(); });
  qs('.slider-next')?.addEventListener('click', ()=>{ gotoSlide(state.slideIndex+1); resetHeroAutoplay(); });
  heroSlider.parentElement?.addEventListener('mouseenter', stopAutoplay);
  heroSlider.parentElement?.addEventListener('mouseleave', startAutoplay);

  gotoSlide(0);
  startAutoplay();
}

/* -------------------------
   Render helpers
   ------------------------- */
function createCardElement(item){
  const card = document.createElement('div'); card.className='card'; card.dataset.id=item.id; card.dataset.filter=item.filter||'All';
  const img = document.createElement('img'); img.src = item.storagePath || item.thumbUrl || ''; img.alt = item.title || 'Image';
  card.appendChild(img); card.addEventListener('click', handleCardClick); return card;
}
function renderGallery(items=[], append=true){
  if(!imageGallery) return;
  if(!append) imageGallery.innerHTML='';
  items.forEach(it => imageGallery.appendChild(createCardElement(it)));
  // Masonry layout is handled by CSS (column-count) in styles.css.
}
function renderTop5(images=[]){
  if(!top5Panel) return;
  top5Panel.innerHTML=''; images.forEach(img => top5Panel.appendChild(createCardElement(img)));
}

/* -------------------------
   Modal populate
   ------------------------- */
function populateModal(imageData = {}){
  if(!imageModal) return;
  imageModal.dataset.imageId = imageData.id || '';
  if(modalImage) modalImage.src = imageData.storagePath || imageData.thumbUrl || '';
  safeSetText(modalTitle, imageData.title || 'Untitled');
  if(modalPrompt) modalPrompt.textContent = imageData.prompt || '';
  safeSetText(modalViews, imageData.views || 0);

  // credits: support clickable link if provided
  if(modalCredits){
    if(imageData.creditsLink){
      modalCredits.innerHTML = `Credits: <a href="${imageData.creditsLink}" target="_blank" rel="noopener noreferrer">${imageData.creditsText || 'Generated by PixelPrompt'}</a>`;
    } else {
      modalCredits.innerHTML = `Credits: <span>${imageData.creditsText || 'Generated by PixelPrompt'}</span>`;
    }
  }

  if(likeCountSpan) likeCountSpan.textContent = imageData.likesCount || 0;

  // tags
  if(modalTags){
    modalTags.innerHTML = '';
    (imageData.tags || []).forEach(t=>{
      const span = document.createElement('span'); span.className='modal-tag'; span.textContent = t; modalTags.appendChild(span);
    });
  }

  // suggestions
  if(modalSuggestionsList){
    modalSuggestionsList.innerHTML = '';
    (imageData.suggestions || ['Increase contrast','Try 35mm film look','Add a cinematic light']).forEach(s=>{
      const li = document.createElement('li'); li.textContent = s; modalSuggestionsList.appendChild(li);
    });
  }

  if(commentsList) commentsList.innerHTML = '';

  // Set visual state of like/save when modal opens
  const imageId = imageData.id || '';
  let isLiked = false, isSaved = false;
  if(state.isBackend && state.user && firebaseReady()){
    // in backend mode we will rely on server fetch in fetchUserSavedAndLikedCounts
    // but for the modal, try quick check:
    (async ()=>{
      try{
        const db = getDBCompat();
        if(state.user && imageId){
          const likeDoc = await db.collection('imageLikes').doc(`${imageId}_${state.user.uid}`).get();
          isLiked = !!(likeDoc.exists && likeDoc.data().liked);
          const saveDoc = await db.collection('users').doc(state.user.uid).collection('saved').doc(imageId).get();
          isSaved = !!(saveDoc.exists && saveDoc.data().saved);
          setLikeIconVisual(isLiked);
          setSaveIconVisual(isSaved);
        }
      }catch(err){ /* ignore */ }
    })();
  } else {
    isLiked = getLocalLiked().includes(imageId);
    isSaved = getLocalSaved().includes(imageId);
    setLikeIconVisual(isLiked);
    setSaveIconVisual(isSaved);
  }
}

/* -------------------------
   Card click: open modal (backend or demo)
   ------------------------- */
async function handleCardClick(e){
  const card = e.currentTarget || e.target.closest('.card');
  if(!card) return;
  const id = card.dataset.id;

  // prevent background page scroll while modal open
  function openModalAndLock(){
    if(!imageModal) return;
    imageModal.classList.add('active');
    imageModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    // focus first element in details for accessibility
    setTimeout(()=> {
      const scroll = qs('.modal-body-scroll');
      if(scroll) scroll.scrollTop = 0;
    }, 50);
  }

  if(state.isBackend && getDBCompat()){
    try{
      const db = getDBCompat();
      const docRef = db.collection('images').doc(id);
      const snap = await docRef.get();
      if(!snap.exists){ console.warn('Image doc not found:', id); return; }
      const data = Object.assign({id: snap.id}, snap.data());
      populateModal(data);
      openModalAndLock();
      // increment views (best-effort)
      docRef.update({ views: firebase.firestore.FieldValue.increment(1) }).catch(()=>{});
      subscribeComments(id);
    }catch(err){ console.error('Error fetching image doc:', err); }
  } else {
    const demo = demoImages.find(d=>d.id===id) || demoImages[0];
    populateModal(demo);
    openModalAndLock();
  }
}

/* -------------------------
   Close image modal helper
   ------------------------- */
function closeImageModal(){
  if(!imageModal) return;
  imageModal.classList.remove('active');
  imageModal.style.display = 'none';
  document.body.style.overflow = '';
  // un-subscribe comments if any (compat)
  if(typeof currentCommentsUnsub === 'function'){ currentCommentsUnsub(); currentCommentsUnsub = null; }
}

/* -------------------------
   Comments realtime (compat)
   ------------------------- */
let currentCommentsUnsub = null;
function subscribeComments(imageId){
  if(!getDBCompat()) return;
  if(currentCommentsUnsub) currentCommentsUnsub();
  const commentsRef = getDBCompat().collection('images').doc(imageId).collection('comments').orderBy('createdAt','desc');
  currentCommentsUnsub = commentsRef.onSnapshot(snap=>{
    if(!commentsList) return;
    commentsList.innerHTML = ''; commentsCountSpan && (commentsCountSpan.textContent = `(${snap.size})`);
    snap.forEach(doc=>{
      const d = doc.data();
      const li = document.createElement('li'); li.innerHTML = `<strong>${d.userName || 'User'}:</strong> ${d.text}`; commentsList.appendChild(li);
    });
  }, err => console.error('Comments snapshot error:', err));
}

/* -------------------------
   Post comment
   ------------------------- */
async function postComment(event){
  event && event.preventDefault && event.preventDefault();
  if(!commentInput) return;
  const text = commentInput.value.trim(); if(!text) return;
  if(state.isBackend && !state.user){ if(loginModal) { loginModal.style.display='flex'; loginModal.classList.add('active'); document.body.style.overflow='hidden'; } return; }
  const imageId = imageModal?.dataset?.imageId; if(!imageId) return;
  if(state.isBackend && getDBCompat()){
    try{
      await getDBCompat().collection('images').doc(imageId).collection('comments').add({
        userId: state.user.uid,
        userName: state.user.displayName || (state.user.email||'').split('@')[0],
        text, createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      commentInput.value='';
    }catch(err){ console.error('Error posting comment:', err); alert('Failed to post comment.'); }
  } else {
    const li = document.createElement('li'); li.innerHTML = `<strong>You:</strong> ${text}`; commentsList.insertBefore(li, commentsList.firstChild); commentInput.value='';
  }
}

/* -------------------------
   Like & Save toggles (enhanced)
   ------------------------- */
async function toggleLikeClicked(e){
  e && e.stopPropagation && e.stopPropagation();
  const imageId = e?.currentTarget?.dataset?.imageId || imageModal?.dataset?.imageId; if(!imageId) return;

  // disable button briefly to avoid rapid double clicks
  if(likeBtn) likeBtn.disabled = true;
  setTimeout(()=> { if(likeBtn) likeBtn.disabled = false; }, 700);

  if(state.isBackend){
    // backend: require login to like (show login modal)
    if(!state.user){
      if(loginModal){
        loginModal.style.display='flex';
        loginModal.classList.add('active');
        document.body.style.overflow='hidden';
      } else {
        alert('Please log in to like images.');
      }
      return;
    }
    try{
      const db = getDBCompat();
      const likeDoc = db.collection('imageLikes').doc(`${imageId}_${state.user.uid}`);
      const docSnap = await likeDoc.get();
      const currentlyLiked = !!(docSnap.exists && docSnap.data().liked);
      if(currentlyLiked){
        // UNLIKE: set liked:false and decrement count
        await likeDoc.set({liked:false},{merge:true});
        await db.collection('images').doc(imageId).update({ likesCount: firebase.firestore.FieldValue.increment(-1) });
        setLikeIconVisual(false);
      } else {
        // LIKE
        await likeDoc.set({liked:true,userId:state.user.uid,imageId,createdAt: firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
        await db.collection('images').doc(imageId).update({ likesCount: firebase.firestore.FieldValue.increment(1) });
        setLikeIconVisual(true);
      }
      // refresh server-side per-user counts for badges
      await fetchUserSavedAndLikedCounts(state.user.uid);
      updateHeaderBadges();
    }catch(err){ console.error('Like toggle error:', err); }
  } else {
    // demo local mode
    const liked = getLocalLiked();
    const idx = liked.indexOf(imageId);
    if(idx !== -1){
      // already liked -> UNLIKE: remove and decrement UI count
      liked.splice(idx,1);
      setLocalLiked(liked);
      // decrement displayed like count but never below 0
      let cur = parseInt(likeCountSpan?.textContent || '0', 10);
      if(isNaN(cur)) cur = 0;
      const newVal = Math.max(0, cur - 1);
      if(likeCountSpan) likeCountSpan.textContent = newVal;
      setLikeIconVisual(false);
    } else {
      // add like
      liked.push(imageId);
      setLocalLiked(liked);
      let cur = parseInt(likeCountSpan?.textContent || '0', 10);
      if(isNaN(cur)) cur = 0;
      const newVal = cur + 1;
      if(likeCountSpan) likeCountSpan.textContent = newVal;
      setLikeIconVisual(true);
    }
    // update badges
    updateHeaderBadges();
  }
}

async function toggleSaveClicked(e){
  e && e.stopPropagation && e.stopPropagation();
  const imageId = e?.currentTarget?.dataset?.imageId || imageModal?.dataset?.imageId; if(!imageId) return;

  // disable briefly to avoid rapid double clicks
  if(saveBtn) saveBtn.disabled = true;
  setTimeout(()=> { if(saveBtn) saveBtn.disabled = false; }, 700);

  if(state.isBackend){
    if(!state.user){ if(loginModal) { loginModal.style.display='flex'; loginModal.classList.add('active'); document.body.style.overflow='hidden'; } return; }
    try{
      const db = getDBCompat();
      const saveRef = db.collection('users').doc(state.user.uid).collection('saved').doc(imageId);
      const snap = await saveRef.get();
      if(snap.exists && snap.data().saved){
        // remove saved
        await saveRef.set({saved:false},{merge:true});
        setSaveIconVisual(false);
        alert('Removed from collections');
      } else {
        await saveRef.set({saved:true,createdAt: firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
        setSaveIconVisual(true);
        alert('Saved to collections');
      }
      // update header saved count
      await fetchUserSavedAndLikedCounts(state.user.uid);
      updateHeaderBadges();
    }catch(err){ console.error('Save toggle error:', err); }
  } else {
    // demo local mode: toggle in localStorage
    const saved = getLocalSaved();
    const idx = saved.indexOf(imageId);
    if(idx !== -1){
      saved.splice(idx,1);
      setLocalSaved(saved);
      setSaveIconVisual(false);
      alert('Removed from collections');
    } else {
      saved.push(imageId);
      setLocalSaved(saved);
      setSaveIconVisual(true);
      alert('Saved to collections');
    }
    updateHeaderBadges();
  }
}

/* -------------------------
   Fetch top five + gallery (same behavior)
   ------------------------- */
async function fetchTopFiveFromFirestore(){
  if(!getDBCompat()) return renderTop5(demoImages.slice(0,5));
  try{
    const db = getDBCompat();
    const q = db.collection('images').orderBy('likesCount','desc').limit(5);
    const snap = await q.get(); const arr = [];
    snap.forEach(d=>arr.push({id:d.id,...d.data()}));
    renderTop5(arr);
  }catch(err){ console.error('fetchTopFive error', err); renderTop5(demoImages.slice(0,5)); }
}

async function fetchGalleryFromFirestore(reset=false){
  if(!getDBCompat()){ if(reset && imageGallery) imageGallery.innerHTML=''; renderGallery(demoImages,true); return; }
  if(state.isFetching) return;
  state.isFetching = true; loadingIndicator && (loadingIndicator.style.display='block');
  try{
    const db = getDBCompat();
    let q = db.collection('images').orderBy('createdAt','desc').limit(state.pageSize);
    if(state.currentFilter && state.currentFilter !== 'All') q = db.collection('images').where('filter','==', state.currentFilter).orderBy('createdAt','desc').limit(state.pageSize);
    if(!reset && state.lastVisible) q = q.startAfter(state.lastVisible);
    const snap = await q.get(); const arr = [];
    snap.forEach(d=> arr.push({id:d.id, ...d.data()}));
    if(reset && imageGallery) imageGallery.innerHTML='';
    renderGallery(arr, true);
    state.lastVisible = snap.docs[snap.docs.length - 1] || null;
  }catch(err){ console.error('fetchGalleryFromFirestore error', err); if(reset && imageGallery){ imageGallery.innerHTML=''; renderGallery(demoImages); } }
  finally{ state.isFetching=false; loadingIndicator && (loadingIndicator.style.display='none'); }
}

/* -------------------------
   Search (demo/local quick filter)
   ------------------------- */
if (qs('#search-input')) {
  qs('#search-input').addEventListener('input', (ev) => {
    const q = (ev.target.value || '').trim().toLowerCase();
    if(!q){
      // reload starting set
      if(getDBCompat()) fetchGalleryFromFirestore(true);
      else renderGallery(demoImages, true);
      return;
    }
    // Client-side demo filter
    if(!getDBCompat()){
      const filtered = demoImages.filter(i =>
        (i.title||'').toLowerCase().includes(q) ||
        (i.filter||'').toLowerCase().includes(q) ||
        (i.tags||[]).join(',').toLowerCase().includes(q)
      );
      renderGallery(filtered, true);
    } else {
      // For backend: we fallback to client-side filtering after fetch (simple) - or you can implement server queries
      fetchGalleryFromFirestore(true).then(()=> {
        const nodes = qsa('#image-gallery .card');
        nodes.forEach(n => {
          const title = (n.querySelector('img')?.alt || '').toLowerCase();
          n.style.display = title.includes(q) ? '' : 'none';
        });
      });
    }
  });
}

/* -------------------------
   Filter chip behaviors
   ------------------------- */
function setupFilters(){
  if(!filterChipsContainer) return;
  filterChipsContainer.addEventListener('click', async (ev) => {
    const chip = ev.target.closest('.filter-chip');
    if(!chip) return;
    qsa('.filter-chip').forEach(c=>c.classList.remove('active'));
    chip.classList.add('active');
    state.currentFilter = chip.dataset.filter || 'All';
    const container = filterChipsContainer;
    const scrollLeft = chip.offsetLeft - (container.clientWidth / 2) + (chip.clientWidth / 2);
    container.scrollTo({ left: scrollLeft, behavior: 'smooth' });
    state.lastVisible = null;
    await fetchGalleryFromFirestore(true);
  });
}

/* -------------------------
   Infinite scroll
   ------------------------- */
function setupInfiniteScroll(){
  window.addEventListener('scroll', () => {
    if(state.isFetching) return;
    if((window.innerHeight + window.scrollY) >= (document.body.offsetHeight - 700)){
      fetchGalleryFromFirestore(false);
    }
  });
}

/* -------------------------
   Auth helpers (compat)
   ------------------------- */
function updateAuthUI(user){
  if(!loginBtn) return;
  if(user){
    const name = user.displayName || (user.email||'').split('@')[0] || 'Account';
    loginBtn.textContent = `Hi, ${name}`;
    loginBtn.title = 'Click to sign out';
    loginBtn.classList.add('logged-in');
  } else { loginBtn.textContent = 'Log in'; loginBtn.title = 'Sign in'; loginBtn.classList.remove('logged-in'); }
}

function setupAuth(){
  if(!firebaseReady()) return;
  const auth = getAuthCompat(); if(!auth) return;

  auth.onAuthStateChanged(async (user) => {
    console.log('onAuthStateChanged fired. user:', user ? user.uid : null);
    state.user = user || null;
    updateAuthUI(state.user);
    if(user && loginModal){
      loginModal.style.display='none';
      loginModal.classList.remove('active');
      document.body.style.overflow='';
    }

    // when a user signs in, migrate local demo data to Firestore and fetch counts for badges
    if(user){
      try{
        await migrateLocalToFirestore(user.uid);
        await fetchUserSavedAndLikedCounts(user.uid);
        updateHeaderBadges();
      }catch(err){ console.error('Error during post-login sync:', err); }
    } else {
      // logged out: reset server cached counts and revert to local counts
      _pp_user_like_count = 0; _pp_user_saved_count = 0;
      updateHeaderBadges();
    }
  });
}

async function handleGoogleSignIn(){
  if(!firebaseReady()){ alert('Backend not configured.'); return; }
  try{
    const provider = new firebase.auth.GoogleAuthProvider();
    console.log('Starting signInWithRedirect (user) ...');
    await firebase.auth().signInWithRedirect(provider);
    console.log('signInWithRedirect invoked (user).');
  } catch(err){
    console.error('Google sign-in (redirect) failed', err);
    alert('Sign-in failed. See console.');
  }
}

/* getRedirectResult should run once after init (race-safe) */
async function handleRedirectResult(){
  if(!firebaseReady()) return;
  if(state._redirectProcessed) {
    console.log('Redirect result already processed - skipping.');
    return;
  }
  state._redirectProcessed = true;
  try{
    const result = await firebase.auth().getRedirectResult();
    if(result && result.user){
      console.log('Redirect sign-in succeeded (user):', result.user.uid);
      state.user = result.user;
      updateAuthUI(state.user);
      if(loginModal){ loginModal.style.display='none'; loginModal.classList.remove('active'); document.body.style.overflow=''; }
      // post-login sync
      try{ await migrateLocalToFirestore(state.user.uid); await fetchUserSavedAndLikedCounts(state.user.uid); updateHeaderBadges(); } catch(e){ /* ignore */ }
    } else {
      console.log('No redirect sign-in result (user).');
    }
  }
  catch(err){
    console.error('Redirect sign-in result error:', err);
  }
}

/* -------------------------
   Modal & UI handlers wiring
   ------------------------- */
function setupModalHandlers(){
  // image modal close
  if(modalCloseBtn) modalCloseBtn.addEventListener('click', closeImageModal);
  // click outside content closes modal
  if(imageModal) imageModal.addEventListener('click', (e) => { if(e.target === imageModal) closeImageModal(); });

  // copy prompt button (placed under prompt box)
  if(copyPromptBtn) copyPromptBtn.addEventListener('click', () => {
    const text = modalPrompt?.textContent || '';
    if(!text) return alert('No prompt to copy.');
    navigator.clipboard.writeText(text).then(()=>{
      const prev = copyPromptBtn.textContent;
      copyPromptBtn.textContent = 'Copied';
      setTimeout(()=> copyPromptBtn.textContent = prev, 1200);
    }).catch(()=> alert('Failed to copy'));
  });

  if(likeBtn) likeBtn.addEventListener('click', toggleLikeClicked);
  if(saveBtn) saveBtn.addEventListener('click', toggleSaveClicked);
  if(commentForm) commentForm.addEventListener('submit', postComment);
  if(googleLoginBtn) googleLoginBtn.addEventListener('click', handleGoogleSignIn);

  // login modal close (new) - ensure it hides and restores body scroll
  if (loginModalCloseBtn) loginModalCloseBtn.addEventListener('click', () => {
    if(!loginModal) return;
    loginModal.style.display = 'none';
    loginModal.classList.remove('active');
    document.body.style.overflow = '';
  });

  // also clicking outside login modal content should close it when active
  if(loginModal) loginModal.addEventListener('click', (e) => {
    if(e.target === loginModal){
      loginModal.style.display='none';
      loginModal.classList.remove('active');
      document.body.style.overflow='';
    }
  });
}

/* -------------------------
   Login button behavior
   ------------------------- */
if(loginBtn){
  loginBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if(state.user){
      if(!firebaseReady()){ alert('No backend configured.'); return; }
      try{ await firebase.auth().signOut(); state.user = null; updateAuthUI(null); alert('Signed out.'); } catch(err){ console.error('Sign out failed', err); alert('Failed to sign out.'); }
    } else {
      if(loginModal){ loginModal.style.display='flex'; loginModal.classList.add('active'); document.body.style.overflow='hidden'; }
    }
  });
}

/* -------------------------
   Notifications toggle
   ------------------------- */
if(notificationsBtn){
  notificationsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if(!notificationsPanel) return;
    const wasActive = notificationsPanel.classList.contains('active');
    if(wasActive){
      notificationsPanel.classList.remove('active'); notificationsPanel.setAttribute('aria-hidden','true');
    } else {
      if(notificationsList){ notificationsList.innerHTML=''; const li=document.createElement('div'); li.className='notif-item'; li.textContent='No new notifications'; notificationsList.appendChild(li); }
      notificationsPanel.classList.add('active'); notificationsPanel.setAttribute('aria-hidden','false');
    }
  });
}
if(closeNotifsBtn) closeNotifsBtn.addEventListener('click', ()=> { if(notificationsPanel){ notificationsPanel.classList.remove('active'); notificationsPanel.setAttribute('aria-hidden','true'); } });

/* -------------------------
   More dropdown placement under "More" chip
   ------------------------- */
const moreBtn = qs('#more-tags');
const moreDropdown = qs('#more-tags-dropdown');
if(moreBtn && moreDropdown){
  const extraTags = ['Nature','Sci-Fi','Fantasy','Art','Vehicles','Animals','Food'];
  function populateExtra(tags=[]){
    moreDropdown.innerHTML = '';
    tags.forEach(tag => {
      const div = document.createElement('div');
      div.className = 'filter-chip';
      div.dataset.filter = tag;
      div.textContent = tag;
      moreDropdown.appendChild(div);
    });
  }
  populateExtra(extraTags);

  // position dropdown directly under the More button
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    moreDropdown.classList.toggle('active');
    // compute coordinates relative to container
    const rect = moreBtn.getBoundingClientRect();
    const parentRect = moreBtn.offsetParent ? moreBtn.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
    // place dropdown below the button and align left edge
    moreDropdown.style.left = (rect.left - parentRect.left) + 'px';
    moreDropdown.style.top  = (rect.bottom - parentRect.top + 8) + 'px';
  });

  // clicking anywhere else hides it
  document.addEventListener('click', ()=> moreDropdown.classList.remove('active'));
  // allow clicking inside dropdown to act as filter (re-use filter handler)
  moreDropdown.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.filter-chip');
    if(!chip) return;
    qsa('.filter-chip').forEach(c=>c.classList.remove('active'));
    chip.classList.add('active');
    state.currentFilter = chip.dataset.filter || 'All';
    state.lastVisible = null;
    fetchGalleryFromFirestore(true);
    moreDropdown.classList.remove('active');
  });
}

/* -------------------------
   Notifications: show latest 5 admin posts
   ------------------------- */
async function fetchNotifications(){
  if(!notificationsList) return;

  if(getDBCompat()){
    try{
      const db = getDBCompat();
      const snap = await db.collection('images')
        .orderBy('createdAt','desc')
        .limit(5).get();
      notificationsList.innerHTML = '';
      snap.forEach(doc => {
        const d = doc.data();
        const li = document.createElement('div');
        li.className = 'notif-item';
        li.textContent = d.title || 'Untitled image';
        li.addEventListener('click', ()=> openImageModalWithData({id:doc.id, ...d}));
        notificationsList.appendChild(li);
      });
    }catch(err){
      console.error('fetchNotifications error', err);
    }
  } else {
    // demo fallback
    notificationsList.innerHTML = '';
    demoImages.slice(0,5).forEach(d=>{
      const li = document.createElement('div');
      li.className='notif-item';
      li.textContent = d.title;
      li.addEventListener('click', ()=> openImageModalWithData(d));
      notificationsList.appendChild(li);
    });
  }
}

/* -------------------------
   More menu modals
   ------------------------- */
const aboutModal = qs('#about-modal');
const termsModal = qs('#terms-modal');
const newsModal = qs('#news-modal');
const learnLinkAnchor = qs('#learn-link-anchor'); // hidden anchor for redirect

function setupMoreMenu(){
  if(!moreDropdown) return;

  // Add event handlers for new options
  moreDropdown.addEventListener('click', async (ev)=>{
    const txt = ev.target.textContent.trim();
    if(txt === 'About us'){
      openAboutModal();
    } else if(txt === 'Terms and conditions'){
      openTermsModal();
    } else if(txt === 'Learn prompting'){
      await openLearnLink();
    } else if(txt === 'News'){
      await openNewsModal();
    }
  });
}

// About us modal
async function openAboutModal(){
  if(!aboutModal) return;
  // static text
  qs('#about-text').innerHTML = `
    <p><strong>About Us:</strong></p>
    <p>PixelPrompt was started by <b>K Sai Swaroop</b> and his brother <b>Akhil</b>.</p>
  `;
  // fetch socials from DB
  if(getDBCompat()){
    try{
      const db = getDBCompat();
      const snap = await db.collection('siteConfig').doc('about').get();
      if(snap.exists){
        const data = snap.data();
        const socials = qs('#about-socials');
        socials.innerHTML = '';
        (data.socials || []).forEach(s=>{
          const a = document.createElement('a');
          a.href = s.link;
          a.target='_blank'; a.rel='noopener';
          a.textContent = s.name;
          socials.appendChild(a);
          socials.appendChild(document.createElement('br'));
        });
      }
    }catch(err){ console.error('about socials fetch error', err); }
  }
  aboutModal.style.display='flex';
  aboutModal.classList.add('active');
}

// Terms modal
function openTermsModal(){
  if(!termsModal) return;
  qs('#terms-text').innerHTML = `
    <p><strong>Terms and Conditions:</strong></p>
    <ul>
      <li>Do not directly use images without credit.</li>
      <li>Be cautious when uploading personal photos.</li>
      <li>This website may shut down at any time.</li>
      <li>Basic AI usage terms apply.</li>
    </ul>
  `;
  termsModal.style.display='flex';
  termsModal.classList.add('active');
}

// Learn prompting
async function openLearnLink(){
  if(getDBCompat()){
    try{
      const db = getDBCompat();
      const snap = await db.collection('siteConfig').doc('learn').get();
      if(snap.exists && snap.data().url){
        window.open(snap.data().url, '_blank');
        return;
      }
    }catch(err){ console.error('learn link fetch error', err); }
  }
  // fallback link
  window.open('https://youtube.com/', '_blank');
}

// News modal (top 50 latest)
async function openNewsModal(){
  if(!newsModal) return;
  const list = qs('#news-list');
  list.innerHTML = '';
  if(getDBCompat()){
    try{
      const db = getDBCompat();
      const snap = await db.collection('images').orderBy('createdAt','desc').limit(50).get();
      snap.forEach(doc=>{
        const d = doc.data();
        const li = document.createElement('div');
        li.className='news-item';
        li.textContent = d.title || 'Untitled';
        li.addEventListener('click', ()=> openImageModalWithData({id:doc.id,...d}));
        list.appendChild(li);
      });
    }catch(err){ console.error('news fetch error', err); }
  } else {
    demoImages.slice(0,50).forEach(d=>{
      const li=document.createElement('div');
      li.className='news-item';
      li.textContent=d.title;
      li.addEventListener('click',()=>openImageModalWithData(d));
      list.appendChild(li);
    });
  }
  newsModal.style.display='flex';
  newsModal.classList.add('active');
}

// Modal close helpers
function setupMoreModals(){
  [aboutModal, termsModal, newsModal].forEach(m=>{
    if(!m) return;
    m.addEventListener('click',(e)=>{ if(e.target===m){ m.style.display='none'; m.classList.remove('active'); } });
  });
}

/* -------------------------
   Init flow
   ------------------------- */
function init(){
  setTheme(state.theme);
  if(themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);

  fetchHeroFromFirestore();
  setupFilters();
  setupModalHandlers();
  setupInfiniteScroll();
  setupMoreMenu();
  setupMoreModals();

  updateHeaderBadges();

  if(firebaseReady()){
    try{
      setupAuth();
      // process any redirect sign-in result (this must run after setupAuth so onAuthStateChanged can respond)
      handleRedirectResult();
      fetchTopFiveFromFirestore();
      fetchGalleryFromFirestore(true);
      fetchNotifications();
    }catch(err){
      console.error('Error initializing Firebase-backed flows:', err);
      renderTop5(demoImages.slice(0,5));
      renderGallery(demoImages, false);
      fetchNotifications();
    }
  } else {
    renderTop5(demoImages.slice(0,5));
    renderGallery(demoImages, false);
    fetchNotifications();
  }
}

/* -------------------------
   Expose simple helpers for debugging
   ------------------------- */
window.PixelPrompt = Object.assign(window.PixelPrompt || {}, {
  state,
  fetchTopFiveFromFirestore,
  fetchGalleryFromFirestore,
  setTheme,
  closeImageModal,
  // helper exports for debugging/demo:
  _getLocalLiked: getLocalLiked,
  _getLocalSaved: getLocalSaved,
  _updateHeaderBadges: updateHeaderBadges
});

/* -------------------------
   DOM ready
   ------------------------- */
document.addEventListener('DOMContentLoaded', init);