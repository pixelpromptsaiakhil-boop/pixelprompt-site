// js/admin.js
// Admin dashboard logic (compat Firebase SDK assumed loaded on page)

/* -------------------------
   Firebase init (admin)
   ------------------------- */
if (!window.firebaseConfig) {
  console.error('firebaseConfig missing - ensure js/firebase-config.js is included and sets window.firebaseConfig');
} else {
  if (!firebase.apps.length) {
    firebase.initializeApp(window.firebaseConfig);
    console.log('Firebase initialized (admin) —', window.firebaseConfig.projectId);
  }
}

const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

/* -------------------------
   DOM refs
   ------------------------- */
const authStatus = document.getElementById('auth-status');
const googleLoginBtn = document.getElementById('google-login-btn');
const adminSignout = document.getElementById('admin-signout');

const uploadForm = document.getElementById('upload-form');
const fileInput = document.getElementById('file-input');
const titleInput = document.getElementById('title');
const promptInput = document.getElementById('prompt');
const suggestionsInput = document.getElementById('suggestions'); // NEW
const tagsInput = document.getElementById('tags');
const filterInput = document.getElementById('filter');
const creditsInput = document.getElementById('credits');
const uploadStatus = document.getElementById('upload-status');
const cancelEditBtn = document.getElementById('cancel-edit');
const docIdInput = document.getElementById('doc-id');

const imageRows = document.getElementById('image-rows');
const searchBar = document.getElementById('searchBar');
const refreshBtn = document.getElementById('refresh-btn');
const filterSelect = document.getElementById('filter-select');
const filePreview = document.getElementById('file-preview');

/* -------------------------
   Local state (client-side)
   ------------------------- */
let imagesCache = [];         // will hold array of docs { id, data... }
let selectedFilter = 'All';   // 'All' | 'Hero' | other filter names
let sortField = 'createdAt';  // field to sort by (client-side)
let sortDir = 'desc';         // 'asc' or 'desc'

/* -------------------------
   Quick storage bucket check (helps debugging)
   ------------------------- */
try {
  const configuredBucket = window.firebaseConfig && window.firebaseConfig.storageBucket;
  const runtimeBucket = firebase.app().options && firebase.app().options.storageBucket;
  if (configuredBucket && runtimeBucket && configuredBucket !== runtimeBucket) {
    console.warn('Configured storageBucket != runtime storageBucket:', configuredBucket, runtimeBucket);
  }
} catch (e) {
  /* ignore */
}

/* -------------------------
   File preview
   ------------------------- */
fileInput.addEventListener('change', () => {
  const f = fileInput.files[0];
  if (!f) {
    filePreview.src = '';
    filePreview.classList.add('hidden');
    return;
  }
  const url = URL.createObjectURL(f);
  filePreview.src = url;
  filePreview.classList.remove('hidden');
});

/* -------------------------
   Utility helpers
   ------------------------- */
function uidFromUser(user) { return user && user.uid ? user.uid : null; }
function el(tag, attrs = {}) { const e = document.createElement(tag); Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v)); return e; }
function safeText(s) { return s == null ? '' : String(s); }
function clearForm() {
  uploadForm.reset();
  docIdInput.value = '';
  uploadStatus.textContent = '';
  document.getElementById('form-title').textContent = 'Upload new image';
  cancelEditBtn.classList.add('hidden');
  filePreview.src = '';
  filePreview.classList.add('hidden');
}

/* -------------------------
   Admin check: presence of admins/{uid}
   ------------------------- */
/* -------------------------
   Admin check: prefer custom claim, fallback to admins/{uid}
   ------------------------- */
async function isAdmin(uid) {
  if (!uid) return false;

  // Try to detect claim from currentUser token
  try {
    if (auth.currentUser && auth.currentUser.uid === uid) {
      const tokenResult = await auth.currentUser.getIdTokenResult(true); // force refresh
      if (tokenResult.claims && tokenResult.claims.admin === true) {
        return true;
      }
    }
  } catch (err) {
    console.warn('Token claim check failed:', err);
  }

  // Fallback to Firestore document check
  try {
    const doc = await db.collection('admins').doc(uid).get();
    return !!doc.exists;
  } catch (err) {
    console.error('admin check failed (firestore):', err);
    return false;
  }
}
/* -------------------------
   Auth flows
   ------------------------- */
googleLoginBtn.addEventListener('click', async () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    // use redirect to avoid popup window.close COOP issue
    await auth.signInWithRedirect(provider);
  } catch (e) {
    alert('Login error: ' + (e.message || e));
  }
});

// handle redirect result at load-time (add somewhere near top of admin.js init)
auth.getRedirectResult().then(result => {
  // result.user will be present if redirected back and successful
  if (result && result.user) {
    console.log('Redirect sign-in result:', result.user.uid);
    // onAuthStateChanged will handle loading admin UI
  }
}).catch(err => {
  console.error('Redirect sign-in error:', err);
});
adminSignout.addEventListener('click', () => auth.signOut());

/* Reactive auth UI */
auth.onAuthStateChanged(async user => {
  if (user) {
    authStatus.textContent = `Signed in as ${user.email || user.displayName || user.uid}`;
    adminSignout.classList.remove('hidden');
    googleLoginBtn.classList.add('hidden');

    // verify admin
    if (await isAdmin(user.uid)) {
      document.getElementById('uploader').classList.remove('hidden');
      document.getElementById('admin-table').classList.remove('hidden');
      await loadImages();          // load and render
      await populateFilterSelect();
    } else {
      alert('Access denied — your account is not listed as an admin. Add your UID under Firestore collection: admins/{uid} = {role: "admin"}');
      document.getElementById('uploader').classList.add('hidden');
      document.getElementById('admin-table').classList.add('hidden');
    }
  } else {
    authStatus.textContent = 'Not signed in';
    adminSignout.classList.add('hidden');
    googleLoginBtn.classList.remove('hidden');
    document.getElementById('uploader').classList.add('hidden');
    document.getElementById('admin-table').classList.add('hidden');
  }
});

/* -------------------------
   Upload / Update handler
   - ensures hero:false by default
   ------------------------- */
uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  uploadStatus.textContent = 'Working...';
  const file = fileInput.files[0];
  const title = titleInput.value.trim();
  const prompt = promptInput.value.trim();
  const suggestions = (suggestionsInput && suggestionsInput.value) ? suggestionsInput.value.split(',').map(s => s.trim()).filter(Boolean) : [];
  const tags = tagsInput.value.split(',').map(t=>t.trim()).filter(Boolean);
  const filterVal = filterInput.value.trim() || 'Uncategorized';
  const credits = creditsInput.value.trim();
  const docId = docIdInput.value || null;

  try {
    let storageRefPath = null;
    let downloadURL = null;

    // if file chosen, upload to storage (wrapped for friendlier error messages)
    if (file) {
      const fileName = `${Date.now()}_${file.name.replace(/\s+/g,'_')}`;
      const refPath = `images/${fileName}`;
      const ref = storage.ref(refPath);
      try {
        await ref.put(file);
        downloadURL = await ref.getDownloadURL();
        storageRefPath = refPath;
      } catch (uploadErr) {
        console.error('Storage upload error:', uploadErr);
        // give a helpful message for typical causes (CORS / auth / rules)
        uploadStatus.textContent = 'Error uploading file: ' + (uploadErr.message || uploadErr);
        if (uploadErr?.code === 'storage/unauthorized' || uploadErr?.code === 'storage/forbidden' || /401|403|unauthor/i.test(uploadErr.message || '')) {
          uploadStatus.textContent += ' — check Firebase Storage rules and auth/login.';
        }
        throw uploadErr;
      }
    }

    if (docId) {
      // update doc
      const update = {
        title, prompt, suggestions, tags, filter: filterVal, credits, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (downloadURL) { update.storagePath = downloadURL; update.storageRef = storageRefPath; }
      await db.collection('images').doc(docId).update(update);
      uploadStatus.textContent = 'Updated';
    } else {
      // create new doc - default hero:false
      await db.collection('images').add({
        title, prompt, suggestions, tags, filter: filterVal, credits,
        storagePath: downloadURL || '',
        storageRef: storageRefPath || '',
        views: 0,
        likesCount: 0,
        hero: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      uploadStatus.textContent = 'Uploaded';
    }

    clearForm();
    await loadImages();
    await populateFilterSelect();
  } catch (err) {
    console.error(err);
    uploadStatus.textContent = 'Error: ' + (err.message || err);
  } finally {
    setTimeout(()=> { uploadStatus.textContent = ''; }, 2500);
  }
});

/* -------------------------
   Fetch all images (once), then filter & sort client-side
   ------------------------- */
async function loadImages() {
  imageRows.innerHTML = 'Loading...';
  try {
    const snap = await db.collection('images').get(); // fetch all (small/medium datasets are fine)
    imagesCache = [];
    snap.forEach(doc => {
      const d = doc.data() || {};
      imagesCache.push({ id: doc.id, ...d });
    });

    renderImages(); // apply current filter & sort
  } catch (err) {
    console.error('loadImages error', err);
    imageRows.innerHTML = `<tr><td colspan="7">Failed to load — ${err.message || err}</td></tr>`;
  }
}

/* -------------------------
   Render images in table from imagesCache using selectedFilter, searchBar, and sort
   ------------------------- */
function renderImages() {
  const q = (searchBar.value || '').trim().toLowerCase();
  let arr = imagesCache.slice(); // clone

  // Filtering by select
  if (selectedFilter && selectedFilter !== 'All') {
    if (selectedFilter === 'Hero') {
      arr = arr.filter(i => i.hero === true);
    } else {
      arr = arr.filter(i => String(i.filter || '').toLowerCase() === selectedFilter.toLowerCase());
    }
  }

  // search filter
  if (q) {
    arr = arr.filter(i => {
      return (i.title || '').toLowerCase().includes(q)
        || (i.tags || []).join(', ').toLowerCase().includes(q)
        || (i.filter || '').toLowerCase().includes(q);
    });
  }

  // sort client-side
  arr.sort((a,b) => {
    let av = a[sortField], bv = b[sortField];
    // normalize undefined
    if (av === undefined) av = null;
    if (bv === undefined) bv = null;

    // if createdAt is a Firestore timestamp object, convert to number
    if (av && av.toDate) av = av.toDate().getTime();
    if (bv && bv.toDate) bv = bv.toDate().getTime();

    // compare numbers or strings
    if (typeof av === 'number' && typeof bv === 'number') {
      return sortDir === 'asc' ? av - bv : bv - av;
    }
    const sa = String(av || '').toLowerCase();
    const sb = String(bv || '').toLowerCase();
    if (sa < sb) return sortDir === 'asc' ? -1 : 1;
    if (sa > sb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  // render
  imageRows.innerHTML = '';
  if (!arr.length) {
    imageRows.innerHTML = `<tr><td colspan="7">No images</td></tr>`;
    return;
  }

  arr.forEach(d => {
    // tags snippet
    const tagsText = (d.tags || []).slice(0,5).join(', ');
    const created = d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toLocaleString() : '';

    // hero toggle markup
    const heroChecked = d.hero ? 'checked' : '';
    const heroToggleHtml = `
      <label class="hero-toggle" title="Toggle hero">
        <input type="checkbox" data-id="${d.id}" class="hero-checkbox" ${heroChecked} />
        <span class="track"></span>
        <span class="hero-slider"></span>
      </label>
    `;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="min-width:160px;"><strong>${safeText(d.title)}</strong><div style="font-size:0.85rem;color:#6b7280">${created}</div></td>
      <td>${safeText(d.filter)}</td>
      <td>${safeText(d.views || 0)}</td>
      <td>${safeText(d.likesCount || 0)}</td>
      <td>${safeText(tagsText)}</td>
      <td style="text-align:center;">${heroToggleHtml}</td>
      <td class="actions">
        <button type="button" class="small-btn" data-id="${d.id}" data-action="edit">Edit</button>
        <button type="button" class="small-btn" data-id="${d.id}" data-action="delete" data-ref="${d.storageRef || ''}">Delete</button>
      </td>
    `;
    imageRows.appendChild(tr);
  });

  // hook hero checkbox events
  imageRows.querySelectorAll('.hero-checkbox').forEach(cb => {
    cb.removeEventListener('change', onHeroToggle);
    cb.addEventListener('change', onHeroToggle);
  });
}

/* -------------------------
   Hero toggle handler
   - enforce max 3 hero images
   ------------------------- */
async function onHeroToggle(e) {
  const cb = e.currentTarget;
  const imageId = cb.dataset.id;
  const enabling = cb.checked;

  // optimistic UI: keep checked state until we confirm / revert
  cb.disabled = true;

  try {
    // refresh local cache to ensure latest
    await loadImagesCacheOnly();

    const currentHeroes = imagesCache.filter(i => i.hero === true && i.id !== imageId);
    if (enabling) {
      if (currentHeroes.length >= 3) {
        // show list and ask to confirm demotion of oldest
        const oldest = currentHeroes.slice().sort((a,b) => {
          const at = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0;
          const bt = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0;
          return at - bt;
        })[0];

        const ok = confirm(
          `There are already ${currentHeroes.length} hero images.\n` +
          `If you proceed the oldest hero "${oldest.title || oldest.id}" will be removed from Hero and this image will be promoted.\n\nProceed?`
        );
        if (!ok) {
          // revert
          cb.checked = false;
          cb.disabled = false;
          return;
        }

        // demote oldest
        await db.collection('images').doc(oldest.id).update({ hero: false }).catch(()=>{});
      }
      // set this image hero:true
      await db.collection('images').doc(imageId).update({ hero: true });
    } else {
      // disabling hero
      await db.collection('images').doc(imageId).update({ hero: false });
    }
    // refresh view
    await loadImages();
  } catch (err) {
    console.error('Hero toggle error', err);
    alert('Failed to update hero status.');
    // revert
    cb.checked = !enabling;
  } finally {
    cb.disabled = false;
  }
}

/* helper to refresh only the cache without re-render side-effects */
async function loadImagesCacheOnly() {
  try {
    const snap = await db.collection('images').get();
    imagesCache = [];
    snap.forEach(doc => imagesCache.push({ id: doc.id, ...doc.data() }));
  } catch (err) {
    console.error('cache reload failed', err);
  }
}

/* -------------------------
   Populate filter-select (unique filters) - puts 'Hero' at top
   ------------------------- */
async function populateFilterSelect() {
  await loadImagesCacheOnly(); // ensure cache
  const selects = new Set();
  imagesCache.forEach(i => {
    if (i.filter) selects.add(i.filter);
  });

  // clear except 'All' and 'Hero'
  filterSelect.innerHTML = `<option value="All">All</option><option value="Hero">Hero</option>`;

  Array.from(selects).sort((a,b)=> a.localeCompare(b)).forEach(f => {
    const opt = document.createElement('option');
    opt.value = f; opt.textContent = f;
    filterSelect.appendChild(opt);
  });

  // restore selection
  try { filterSelect.value = selectedFilter || 'All'; } catch(e){}
}

/* -------------------------
   Click handler for edit/delete & sorting header clicks
   ------------------------- */
imageRows.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;

  if (action === 'edit') {
    const snap = await db.collection('images').doc(id).get();
    if (!snap.exists) return alert('Document missing');
    const d = snap.data();
    docIdInput.value = id;
    titleInput.value = d.title || '';
    promptInput.value = d.prompt || '';
    suggestionsInput.value = (d.suggestions || []).join(', ');
    tagsInput.value = (d.tags||[]).join(', ');
    filterInput.value = d.filter || '';
    creditsInput.value = d.credits || '';
    document.getElementById('form-title').textContent = 'Edit image';
    cancelEditBtn.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (action === 'delete') {
    if (!confirm('Delete this image?')) return;
    try {
      await db.collection('images').doc(id).delete();
      const refPath = btn.dataset.ref;
      if (refPath) {
        await storage.ref(refPath).delete().catch(()=>{});
      }
      await loadImages();
      await populateFilterSelect();
    } catch (err) {
      console.error('delete error', err);
      alert('Delete failed: ' + (err.message || err));
    }
  }
});

/* cancel edit */
cancelEditBtn.addEventListener('click', () => clearForm());

/* refresh */
refreshBtn.addEventListener('click', async () => {
  await loadImages();
  await populateFilterSelect();
});

/* search input */
searchBar.addEventListener('input', () => {
  renderImages();
});

/* filter select change */
filterSelect.addEventListener('change', () => {
  selectedFilter = filterSelect.value || 'All';
  renderImages();
});

/* table header sorting */
document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const f = th.dataset.field || 'createdAt';
    if (sortField === f) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortField = f;
      sortDir = 'asc';
    }
    // update header classes
    document.querySelectorAll('th.sortable').forEach(h => h.classList.remove('sort-asc','sort-desc'));
    th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    renderImages();
  });
});

/* -------------------------
   Initial load (only when user is admin triggered by auth listener)
   ------------------------- */
(async function bootstrap() {
  // nothing to do here immediately — auth listener will call loadImages when admin
})();