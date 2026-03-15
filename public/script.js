(function () {
  'use strict';

  /* ═══════════════════════════════════════
     DOM REFS
     ═══════════════════════════════════════ */
  var feed = document.getElementById('feed');
  var filterBar = document.getElementById('filter-bar');
  var drawer = document.getElementById('drawer');
  var drawerList = document.getElementById('drawer-list');
  var menuToggle = document.getElementById('menu-toggle');
  var drawerClose = document.getElementById('drawer-close');
  var drawerOverlay = document.getElementById('drawer-overlay');
  var searchInput = document.getElementById('search-input');
  var searchClear = document.getElementById('search-clear');
  var searchLoader = document.getElementById('search-loader');
  var modalOverlay = document.getElementById('modal-overlay');
  var modalBody = document.getElementById('modal-body');
  var modalClose = document.getElementById('modal-close');
  var modelFilter = document.getElementById('model-filter');
  var sortTabs = document.getElementById('sort-tabs');
  var toastContainer = document.getElementById('toast-container');
  var bannerTrack = document.getElementById('banner-track');
  var bannerDots = document.getElementById('banner-dots');

  /* ═══════════════════════════════════════
     STATE
     ═══════════════════════════════════════ */
  var allPosts = [];
  var activeTag = null;
  var activeModel = 'all';
  var activeSort = 'newest';
  var searchQuery = '';
  var categories = [];
  var copyCountsKey = 'promptefy_copies';
  var totalCopies = 0;
  var currentUser = null;
  var currentBannerIndex = 0;
  var bannerInterval = null;

  /* ═══════════════════════════════════════
     FAKE REVIEWS
     ═══════════════════════════════════════ */
  var REVIEWS = [
    { name: 'Alex M.', text: 'Used this in my project, worked perfectly!', rating: 5 },
    { name: 'Sarah K.', text: 'Great prompt, saved me so much time.', rating: 5 },
    { name: 'Dev R.', text: 'Exactly what I was looking for.', rating: 4 },
    { name: 'Maya L.', text: 'Clean and well-structured.', rating: 5 },
    { name: 'Jordan P.', text: 'Genuinely useful, bookmarked.', rating: 4 },
    { name: 'Chris W.', text: 'Got amazing results first try.', rating: 5 },
    { name: 'Nina T.', text: 'Works great with Runway Gen-3!', rating: 5 },
    { name: 'Sam B.', text: 'Simple but effective.', rating: 4 },
    { name: 'Priya S.', text: 'Love how detailed this is.', rating: 5 },
    { name: 'Leo H.', text: 'Tested on Sora, impressive.', rating: 5 },
    { name: 'Emma D.', text: 'This prompt is a real gem.', rating: 4 },
    { name: 'Ryan G.', text: 'Been using this daily.', rating: 5 },
    { name: 'Aisha N.', text: 'Quality content!', rating: 5 },
    { name: 'Kai F.', text: 'Better than paid prompt packs.', rating: 4 },
    { name: 'Olivia R.', text: 'Shared with my whole team.', rating: 5 },
    { name: 'Mateo V.', text: 'Really clean output.', rating: 4 },
    { name: 'Zara J.', text: 'Easy to find with tags.', rating: 5 },
    { name: 'Tom C.', text: 'Promptefy is my go-to now.', rating: 5 },
    { name: 'Lily A.', text: 'Works across multiple models.', rating: 4 },
    { name: 'Noah K.', text: 'Copy-paste and it worked. 10/10.', rating: 5 },
  ];

  function getFakeReviews(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
    h = Math.abs(h);
    var c = (h % 3) + 1, r = [];
    for (var j = 0; j < c; j++) r.push(REVIEWS[(h + j * 7) % REVIEWS.length]);
    return r;
  }

  /* ═══════════════════════════════════════
     MODEL DETECTION
     ═══════════════════════════════════════ */
  var MODELS = {
    sora: ['sora'], runway: ['runway'], midjourney: ['midjourney', 'mj'],
    flux: ['flux'], chatgpt: ['chatgpt', 'gpt'], dalle: ['dall-e', 'dalle'],
    gemini: ['gemini'],
  };

  function detectModels(p) {
    var text = ((p.function || '') + ' ' + (p.prompt || '') + ' ' + (p.tags || []).join(' ') + ' ' + (p.software || '')).toLowerCase();
    var found = [];
    for (var k in MODELS) { for (var i = 0; i < MODELS[k].length; i++) { if (text.indexOf(MODELS[k][i]) > -1) { found.push(k); break; } } }
    return found.length ? found : ['generic'];
  }

  /* ═══════════════════════════════════════
     UTILS
     ═══════════════════════════════════════ */
  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function initials(n) { return n ? n.split(' ').map(function (w) { return w[0]; }).join('').toUpperCase().slice(0, 2) : '?'; }
  function timeAgo(d) { var m = Math.floor((Date.now() - new Date(d)) / 60000); return m < 60 ? m + 'm' : m < 1440 ? Math.floor(m / 60) + 'h' : Math.floor(m / 1440) + 'd'; }
  function getCopies() { try { return JSON.parse(localStorage.getItem(copyCountsKey)) || {}; } catch (e) { return {}; } }
  function addCopy(id) { var c = getCopies(); c[id] = (c[id] || 0) + 1; localStorage.setItem(copyCountsKey, JSON.stringify(c)); }

  function toast(msg) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    toastContainer.appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, 2500);
    setTimeout(function () { t.remove(); }, 2800);
  }

  function highlight(text, q) {
    if (!q) return esc(text);
    return esc(text).replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>');
  }

  /* ═══════════════════════════════════════
     AUTH & SUPABASE
     ═══════════════════════════════════════ */
  var supabase = null;
  function initAuth() {
    var signinBtn = document.getElementById('auth-signin-btn');
    var userMenu = document.getElementById('user-menu');
    var avatarBtn = document.getElementById('user-avatar-btn');
    var dropdown = document.getElementById('user-dropdown');
    var nameDisplay = document.getElementById('user-name-display');
    var signoutBtn = document.getElementById('signout-btn');
    var savedLink = document.getElementById('my-saved-link');

    avatarBtn.addEventListener('click', function (e) { e.stopPropagation(); dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none'; });
    document.addEventListener('click', function () { dropdown.style.display = 'none'; });
    signoutBtn.addEventListener('click', async function (e) { 
      e.preventDefault(); 
      if (supabase) await supabase.auth.signOut();
      currentUser = null; 
      localStorage.removeItem('pfy_user'); 
      showLoggedOut(); 
      toast('Signed out'); 
      render(); 
    });
    savedLink.addEventListener('click', function (e) { e.preventDefault(); dropdown.style.display = 'none'; if (!currentUser) return; searchQuery = '__saved__'; render(); toast('Showing saved'); });

    function showLoggedIn() { if(signinBtn) signinBtn.style.display = 'none'; userMenu.style.display = 'block'; avatarBtn.textContent = initials(currentUser.name); nameDisplay.textContent = currentUser.name; }
    function showLoggedOut() { if(signinBtn) signinBtn.style.display = 'block'; userMenu.style.display = 'none'; }

    // Init Supabase and Sync Session
    fetch('/api/config').then(function(res) { return res.json(); }).then(async function(config) {
      if (config.SUPABASE_URL && window.supabase) {
        supabase = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session) {
          // Sync with local backend
          var userMeta = session.user.user_metadata || {};
          fetch('/api/auth', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              action: 'sync_session', 
              uid: session.user.id, 
              email: session.user.email, 
              name: userMeta.full_name || session.user.email.split('@')[0], 
              token: session.access_token 
            })
          }).then(function(r) { return r.json(); }).then(function(d) {
            if (d.ok) {
              currentUser = d.user;
              localStorage.setItem('pfy_user', JSON.stringify(d.user));
              showLoggedIn();
              render();
            }
          });
        } else {
          // No active supabase session, clear local mock just in case
          localStorage.removeItem('pfy_user');
          showLoggedOut();
        }
        
        // Listen for auth changes (like Google OAuth redirect returning)
        supabase.auth.onAuthStateChange(function(evt, session) {
          if (evt === 'SIGNED_IN' && session) {
            var userMeta = session.user.user_metadata || {};
            fetch('/api/auth', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                action: 'sync_session', 
                uid: session.user.id, 
                email: session.user.email, 
                name: userMeta.full_name || session.user.email.split('@')[0], 
                token: session.access_token 
              })
            }).then(function(r) { return r.json(); }).then(function(d) {
              if (d.ok) {
                currentUser = d.user;
                localStorage.setItem('pfy_user', JSON.stringify(d.user));
                showLoggedIn();
                render();
              }
            });
          }
        });

      }
    });

    try { currentUser = JSON.parse(localStorage.getItem('pfy_user')); } catch (e) { currentUser = null; }
    if (currentUser) showLoggedIn(); else showLoggedOut();
  }

  function isLiked(id) { return currentUser && (currentUser.likes || []).indexOf(id) > -1; }
  function isSaved(id) { return currentUser && (currentUser.saved || []).indexOf(id) > -1; }

  function userAction(action, postId, cb) {
    if (!currentUser) { toast('Sign in first'); return; }
    fetch('/api/userdata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: currentUser.uid, action: action, postId: postId }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d.ok) { currentUser = d.user; localStorage.setItem('pfy_user', JSON.stringify(currentUser)); if (cb) cb(d); } });
  }

  /* ═══════════════════════════════════════
     BANNER CAROUSEL
     ═══════════════════════════════════════ */
  function initBanners() {
    fetch('/api/banners').then(function (r) { return r.json(); }).then(function (banners) {
      if (banners && banners.length > 0) {
        // Replace placeholders with real banners
        bannerTrack.innerHTML = '';
        bannerDots.innerHTML = '';
        banners.forEach(function (b, i) {
          var slide = document.createElement('div');
          slide.className = 'banner-slide' + (i === 0 ? ' active' : '');
          slide.style.backgroundImage = 'url(' + b.image + ')';
          slide.innerHTML = ''; // Static hero overlay used instead
          bannerTrack.appendChild(slide);
          var dot = document.createElement('button');
          dot.className = 'banner-dot' + (i === 0 ? ' active' : '');
          dot.dataset.idx = i;
          bannerDots.appendChild(dot);
        });
      }
      // Start rotation
      var slides = bannerTrack.querySelectorAll('.banner-slide');
      if (slides.length > 1) {
        bannerInterval = setInterval(function () { goToBanner((currentBannerIndex + 1) % slides.length); }, 4000);
      }
      bannerDots.addEventListener('click', function (e) {
        var dot = e.target.closest('.banner-dot');
        if (dot) goToBanner(parseInt(dot.dataset.idx));
      });
    }).catch(function () { /* keep placeholders */ startPlaceholderRotation(); });

    startPlaceholderRotation();
  }

  function startPlaceholderRotation() {
    var slides = bannerTrack.querySelectorAll('.banner-slide');
    if (slides.length > 1 && !bannerInterval) {
      bannerInterval = setInterval(function () { goToBanner((currentBannerIndex + 1) % slides.length); }, 4000);
    }
  }

  function goToBanner(idx) {
    currentBannerIndex = idx;
    bannerTrack.querySelectorAll('.banner-slide').forEach(function (s, i) { s.classList.toggle('active', i === idx); });
    bannerDots.querySelectorAll('.banner-dot').forEach(function (d, i) { d.classList.toggle('active', i === idx); });
  }

  /* ═══════════════════════════════════════
     DRAWER
     ═══════════════════════════════════════ */
  function toggleDrawer() { drawer.classList.toggle('open'); drawerOverlay.classList.toggle('open'); document.body.style.overflow = drawer.classList.contains('open') ? 'hidden' : ''; }
  menuToggle.addEventListener('click', toggleDrawer);
  drawerClose.addEventListener('click', toggleDrawer);
  drawerOverlay.addEventListener('click', toggleDrawer);

  /* ═══════════════════════════════════════
     SEARCH + FILTERS
     ═══════════════════════════════════════ */
  window.addEventListener('keydown', function (e) { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); searchInput.focus(); } if (e.key === 'Escape') closeModal(); });
  searchInput.addEventListener('input', function (e) { searchQuery = e.target.value.toLowerCase(); searchClear.classList.toggle('active', !!searchQuery); searchLoader.classList.add('active'); clearTimeout(window._st); window._st = setTimeout(function () { render(); searchLoader.classList.remove('active'); }, 250); });
  searchClear.addEventListener('click', function () { searchInput.value = ''; searchQuery = ''; searchClear.classList.remove('active'); render(); });

  modelFilter.addEventListener('click', function (e) { var c = e.target.closest('.model-chip'); if (!c) return; activeModel = c.dataset.model; modelFilter.querySelectorAll('.model-chip').forEach(function (x) { x.classList.toggle('active', x.dataset.model === activeModel); }); render(); });
  sortTabs.addEventListener('click', function (e) { var t = e.target.closest('.sort-tab'); if (!t) return; activeSort = t.dataset.sort; sortTabs.querySelectorAll('.sort-tab').forEach(function (x) { x.classList.toggle('active', x.dataset.sort === activeSort); }); render(); });

  /* ═══════════════════════════════════════
     IMAGE COMPARISON SLIDER
     ═══════════════════════════════════════ */
  function createSideBySide(beforeSrc, afterSrc) {
    var container = document.createElement('div');
    container.className = 'img-side-by-side';
    container.innerHTML =
      '<div class="img-side-half" style="background-image:url(' + beforeSrc + ')"><div class="img-side-label">Reference</div></div>' +
      '<div class="img-side-half" style="background-image:url(' + afterSrc + ')"><div class="img-side-label" style="left:auto;right:10px;">AI Output</div></div>';
    return container;
  }

  /* ═══════════════════════════════════════
     RENDER CARD
     ═══════════════════════════════════════ */
  function renderPost(post) {
    var card = document.createElement('article');
    var hasBefore = post.beforeImage || post.before_image;
    var hasAfter = post.afterImage || post.after_image;
    var hasBothImages = hasBefore && hasAfter;
    var hasImage = post.image || hasAfter;
    card.className = 'card' + (hasBothImages ? ' has-compare' : hasImage ? ' has-image' : '') + (post.pinned ? ' pinned' : '');

    var models = detectModels(post);
    var copies = getCopies()[post.id] || 0;
    var liked = isLiked(post.id);
    var saved = isSaved(post.id);
    var likes = post.likes || 0;

    var badges = models.map(function (m) { return '<span class="model-badge ' + m + '">' + (m === 'generic' ? 'AI' : m.charAt(0).toUpperCase() + m.slice(1)) + '</span>'; }).join('');

    var html = '';

    // Image comparison or single image
    if (hasBothImages) {
      // Slider will be inserted via DOM after
    } else if (hasImage) {
      html += '<div class="card-bg" style="background-image:url(' + (post.image || post.afterImage || post.after_image) + ')" aria-hidden="true"></div>';
    }

    html += '<div class="card-content">';
    if (post.pinned) html += '<div class="pin-badge">📌 Trending</div>';

    html += '<div class="card-header">' +
      '<div class="card-title-area"><h2 class="func-name">' + highlight(post.function || '', searchQuery) + '</h2><div class="card-models">' + badges + '</div></div>' +
      '<div class="card-actions">' +
        '<button class="action-btn like-btn' + (liked ? ' liked' : '') + '" data-id="' + post.id + '">♥<span class="like-count">' + (likes > 0 ? ' ' + likes : '') + '</span></button>' +
        '<button class="action-btn save-btn' + (saved ? ' saved' : '') + '" data-id="' + post.id + '">' + (saved ? '★' : '☆') + '</button>' +
        '<button class="copy-btn" data-id="' + post.id + '">Copy</button>' +
      '</div></div>' +
      '<div class="card-meta">' + (post.tags || []).map(function (t) { return '<span class="tag">' + highlight(t, searchQuery) + '</span>'; }).join('') + '</div>' +
      '<p class="card-prompt">' + highlight(post.prompt || '', searchQuery) + '</p>' +
      '<div class="card-footer"><div class="author"><div class="author-avatar">' + initials(post.author) + '</div><span class="author-name">' + (post.author || 'Anon') + '</span></div>' +
      '<span class="card-date">' + timeAgo(post.date) + '</span></div></div>';

    card.innerHTML = html;

    // Insert image comparison side-by-side before card-content
    if (hasBothImages) {
      var sbs = createSideBySide(post.beforeImage || post.before_image, post.afterImage || post.after_image);
      card.insertBefore(sbs, card.firstChild);
    }

    // Events
    card.querySelector('.copy-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      navigator.clipboard.writeText(post.prompt + '\n\n— via Promptefy');
      this.textContent = '✓'; var btn = this; setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
      addCopy(post.id); totalCopies++; updateStats(); toast('Copied');
    });

    card.querySelector('.like-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      userAction(liked ? 'unlike' : 'like', post.id, function (d) { post.likes = d.likeCount; render(); });
    });

    card.querySelector('.save-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      userAction(saved ? 'unsave' : 'save', post.id, function () { toast(saved ? 'Removed' : 'Saved'); render(); });
    });

    card.addEventListener('click', function () { openModal(post); });
    return card;
  }

  /* ═══════════════════════════════════════
     MODAL
     ═══════════════════════════════════════ */
  function openModal(post) {
    var models = detectModels(post);
    var saved = isSaved(post.id);
    var liked = isLiked(post.id);
    var likes = post.likes || 0;
    var reviews = getFakeReviews(post.id);
    var hasBothImages = (post.beforeImage || post.before_image) && (post.afterImage || post.after_image);

    var badges = models.map(function (m) { return '<span class="model-badge ' + m + '">' + (m === 'generic' ? 'AI' : m) + '</span>'; }).join('');
    var tags = (post.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');

    var reviewsHtml = reviews.map(function (r) { var s = ''; for (var i = 0; i < r.rating; i++) s += '★'; return '<div class="review-item"><div class="review-header"><span class="review-name">' + r.name + '</span><span class="review-stars">' + s + '</span></div><p class="review-text">' + r.text + '</p></div>'; }).join('');

    var related = allPosts.filter(function (p) { return p.id !== post.id; }).slice(0, 3);
    var relatedHtml = related.map(function (r) { return '<div class="related-card" data-id="' + r.id + '"><div class="author-avatar" style="width:24px;height:24px;font-size:0.55rem">' + initials(r.author) + '</div><div><div class="related-title">' + esc(r.function) + '</div></div></div>'; }).join('');

    modalBody.innerHTML =
      (hasBothImages ? '<div id="modal-slider-container"></div>' : '') +
      (post.pinned ? '<div class="pin-badge">📌 Trending</div>' : '') +
      '<div class="modal-meta"><div class="modal-author"><div class="modal-author-avatar">' + initials(post.author) + '</div><div class="modal-author-name">' + esc(post.author || 'Anon') + '</div></div><span class="modal-date">' + timeAgo(post.date) + '</span></div>' +
      '<h2 class="modal-prompt-title">' + esc(post.function) + '</h2>' +
      '<div class="modal-models">' + badges + '</div>' +
      '<div class="modal-tags">' + tags + '</div>' +
      '<div class="modal-prompt-text">' + esc(post.prompt) + '</div>' +
      '<div class="modal-actions">' +
        '<button class="modal-action-btn primary" id="m-copy">📋 Copy</button>' +
        '<button class="modal-action-btn" id="m-like">' + (liked ? '♥ Liked' : '♡ Like') + (likes > 0 ? ' (' + likes + ')' : '') + '</button>' +
        '<button class="modal-action-btn" id="m-save">' + (saved ? '★ Saved' : '☆ Save') + '</button>' +
        '<button class="modal-action-btn" id="m-share">↗ Share</button>' +
      '</div>' +
      '<div class="reviews-section"><h3 class="reviews-heading">Reviews</h3>' + reviewsHtml + '</div>' +
      '<div class="comments-section"><h3 class="comments-heading">Comments</h3><div id="comments-list" class="comments-list"><div style="color:#666;font-size:.75rem">Loading...</div></div>' +
      (currentUser ? '<div class="comment-form"><input type="text" id="comment-input" class="comment-input" placeholder="Add comment..." maxlength="500"><button id="comment-submit" class="comment-submit-btn">Post</button></div>' : '<p class="comment-signin-note">Sign in to comment</p>') +
      '</div>' +
      (related.length ? '<div class="modal-related"><h3>Related</h3>' + relatedHtml + '</div>' : '');

    // Insert modal slider
    if (hasBothImages) {
      var sliderContainer = document.getElementById('modal-slider-container');
      sliderContainer.appendChild(createSideBySide(post.beforeImage || post.before_image, post.afterImage || post.after_image));
    }

    document.getElementById('m-copy').addEventListener('click', function () {
      navigator.clipboard.writeText(post.prompt + '\n\n— via Promptefy');
      this.textContent = '✓ Copied'; var b = this; setTimeout(function () { b.textContent = '📋 Copy'; }, 1500);
      addCopy(post.id); toast('Copied');
    });

    document.getElementById('m-like').addEventListener('click', function () {
      var was = isLiked(post.id);
      userAction(was ? 'unlike' : 'like', post.id, function (d) {
        post.likes = d.likeCount;
        document.getElementById('m-like').textContent = (was ? '♡ Like' : '♥ Liked') + (d.likeCount > 0 ? ' (' + d.likeCount + ')' : '');
      });
    });

    document.getElementById('m-save').addEventListener('click', function () {
      var was = isSaved(post.id);
      userAction(was ? 'unsave' : 'save', post.id, function () {
        document.getElementById('m-save').textContent = was ? '☆ Save' : '★ Saved';
        toast(was ? 'Removed' : 'Saved');
      });
    });

    document.getElementById('m-share').addEventListener('click', function () {
      var url = location.origin + '/?prompt=' + post.id;
      if (navigator.share) navigator.share({ title: post.function, url: url });
      else { navigator.clipboard.writeText(url); toast('Link copied'); }
    });

    loadComments(post.id);
    if (currentUser) {
      document.getElementById('comment-submit').addEventListener('click', function () {
        var inp = document.getElementById('comment-input');
        if (inp.value.trim()) { submitComment(post.id, inp.value.trim()); inp.value = ''; }
      });
    }

    modalBody.querySelectorAll('.related-card').forEach(function (rc) {
      rc.addEventListener('click', function () { var p = allPosts.find(function (x) { return x.id === rc.dataset.id; }); if (p) openModal(p); });
    });

    modalOverlay.classList.add('open'); modalOverlay.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
  }

  function closeModal() { modalOverlay.classList.remove('open'); modalOverlay.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; }
  modalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', function (e) { if (e.target === modalOverlay) closeModal(); });

  /* ═══════════════════════════════════════
     COMMENTS
     ═══════════════════════════════════════ */
  function loadComments(pid) {
    fetch('/api/comments?post=' + pid).then(function (r) { return r.json(); }).then(function (comments) {
      var el = document.getElementById('comments-list'); if (!el) return;
      if (!comments.length) { el.innerHTML = '<div style="color:#666;font-size:.75rem">No comments yet</div>'; return; }
      el.innerHTML = comments.map(function (c) { return '<div class="comment-item"><div class="comment-header"><span class="comment-author">' + esc(c.name) + '</span><span class="comment-date">' + timeAgo(c.date) + '</span></div><p class="comment-text">' + esc(c.text) + '</p></div>'; }).join('');
    }).catch(function () { var el = document.getElementById('comments-list'); if (el) el.innerHTML = '<div style="color:#666;font-size:.75rem">—</div>'; });
  }

  function submitComment(pid, text) {
    fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: pid, uid: currentUser.uid, name: currentUser.name, text: text }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d.ok) { loadComments(pid); toast('Comment posted'); } });
  }

  /* ═══════════════════════════════════════
     FILTERS + RENDER
     ═══════════════════════════════════════ */
  function buildFilters(posts) {
    var tags = {};
    posts.forEach(function (p) { (p.tags || []).forEach(function (t) { tags[t] = (tags[t] || 0) + 1; }); });
    categories = Object.keys(tags).sort();

    filterBar.innerHTML = '<button class="filter-pill ' + (!activeTag ? 'active' : '') + '" data-tag="all">All</button>';
    categories.forEach(function (t) { filterBar.innerHTML += '<button class="filter-pill ' + (activeTag === t ? 'active' : '') + '" data-tag="' + t + '">' + t + '</button>'; });
    filterBar.querySelectorAll('.filter-pill').forEach(function (b) { b.addEventListener('click', function () { activeTag = b.dataset.tag === 'all' ? null : b.dataset.tag; render(); buildFilters(posts); }); });

    drawerList.innerHTML = '';
    categories.forEach(function (t) {
      var li = document.createElement('li'); li.className = 'drawer-item' + (activeTag === t ? ' active' : '');
      li.innerHTML = '<span>' + t + '</span><small>' + tags[t] + '</small>';
      li.addEventListener('click', function () { activeTag = t; toggleDrawer(); render(); });
      drawerList.appendChild(li);
    });
  }

  function render() {
    var filtered = allPosts.slice();

    if (searchQuery === '__saved__') {
      filtered = currentUser ? filtered.filter(function (p) { return (currentUser.saved || []).indexOf(p.id) > -1; }) : [];
    } else {
      if (activeTag) filtered = filtered.filter(function (p) { return (p.tags || []).indexOf(activeTag) > -1; });
      if (activeModel !== 'all') filtered = filtered.filter(function (p) { return detectModels(p).indexOf(activeModel) > -1; });
      if (searchQuery) {
        filtered = filtered.map(function (p) {
          var s = 0;
          if (p.function.toLowerCase().indexOf(searchQuery) > -1) s += 10;
          if ((p.tags || []).some(function (t) { return t.indexOf(searchQuery) > -1; })) s += 5;
          if (p.prompt.toLowerCase().indexOf(searchQuery) > -1) s += 1;
          return { p: p, s: s };
        }).filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; }).map(function (x) { return x.p; });
      }
    }

    var pinned = filtered.filter(function (p) { return p.pinned; });
    var unpinned = filtered.filter(function (p) { return !p.pinned; });
    var cc = getCopies();
    if (activeSort === 'newest') unpinned.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    else if (activeSort === 'trending') unpinned.sort(function (a, b) { return (b.likes || 0) + (cc[b.id] || 0) * 2 - (a.likes || 0) - (cc[a.id] || 0) * 2; });
    else if (activeSort === 'most-copied') unpinned.sort(function (a, b) { return (cc[b.id] || 0) - (cc[a.id] || 0); });
    filtered = pinned.concat(unpinned);

    feed.innerHTML = '';
    if (!filtered.length) { feed.innerHTML = '<div style="text-align:center;padding:4rem;color:#888"><p>No prompts found</p></div>'; }
    else filtered.forEach(function (p) { feed.appendChild(renderPost(p)); });
  }

  /* ═══════════════════════════════════════
     LEADERBOARD + STATS
     ═══════════════════════════════════════ */
  function buildLeaderboard(posts) {
    var a = {};
    posts.forEach(function (p) { var n = p.author || 'Anon'; if (!a[n]) a[n] = { name: n, count: 0 }; a[n].count++; });
    var sorted = Object.values(a).sort(function (x, y) { return y.count - x.count; });
    var el = document.getElementById('leaderboard'); if (!el) return;
    el.innerHTML = '';
    sorted.slice(0, 6).forEach(function (x, i) {
      var rank = i < 3 ? ['gold', 'silver', 'bronze'][i] : '';
      var card = document.createElement('div'); card.className = 'leader-card';
      card.innerHTML = '<span class="leader-rank ' + rank + '">#' + (i + 1) + '</span><div class="leader-avatar">' + initials(x.name) + '</div><div class="leader-name">' + esc(x.name) + '</div><div class="leader-count">' + x.count + ' prompts</div>';
      el.appendChild(card);
    });
  }

  function updateStats() {
    var ep = document.getElementById('stat-prompts'), ec = document.getElementById('stat-creators'), ecp = document.getElementById('stat-copies');
    var elv = document.getElementById('stat-total-prompts-live'), ereg = document.getElementById('stat-registered');
    
    if (ep) ep.textContent = allPosts.length;
    if (elv) elv.textContent = allPosts.length;
    if (ereg) ereg.textContent = '32+';

    if (ec) { var u = {}; allPosts.forEach(function (p) { if (p.author) u[p.author] = 1; }); ec.textContent = Object.keys(u).length; }
    if (ecp) ecp.textContent = totalCopies;

    // Start fluctuating online counter if not already running
    if (!window._onlineInterval) {
      var updateOnline = function() {
        var el = document.getElementById('stat-online');
        if (el) {
          el.textContent = Math.floor(Math.random() * (70 - 40 + 1)) + 40;
          el.classList.remove('pop-anim');
          void el.offsetWidth; // Trigger reflow
          el.classList.add('pop-anim');
        }
      };
      updateOnline();
      window._onlineInterval = setInterval(updateOnline, 5000);
    }
  }

  /* ═══════════════════════════════════════
     DEEP LINK
     ═══════════════════════════════════════ */
  function handleDeepLink() {
    var params = new URLSearchParams(location.search);
    var pid = params.get('prompt');
    if (pid) { var p = allPosts.find(function (x) { return x.id === pid; }); if (p) setTimeout(function () { openModal(p); }, 300); }
    var q = params.get('q');
    if (q) { searchInput.value = q; searchQuery = q.toLowerCase(); searchClear.classList.add('active'); }
  }

  /* ═══════════════════════════════════════
     INIT
     ═══════════════════════════════════════ */
  initAuth();
  initBanners();

  fetch('/api/posts').then(function (r) { return r.json(); }).then(function (posts) {
    allPosts = posts;
    var cc = getCopies(); for (var id in cc) totalCopies += cc[id];
    updateStats(); buildFilters(posts); buildLeaderboard(posts);
    render(); handleDeepLink();
  }).catch(function () { feed.innerHTML = '<div style="text-align:center;padding:4rem;color:#888">Failed to load</div>'; });
})();
