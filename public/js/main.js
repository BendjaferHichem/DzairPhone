(function () {
  'use strict';

  /* ---------- Product gallery: switch main image via thumbnails ---------- */
  var mainImage = document.getElementById('mainImage');
  if (mainImage) {
    document.querySelectorAll('.thumb-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        mainImage.src = btn.dataset.img;
        document.querySelectorAll('.thumb-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });
  }

  /* ---------- Multi-photo picker with live preview + remove-before-save (seller listing form) ---------- */
  var photoInput = document.getElementById('photoInput');
  var photoWrapper = document.getElementById('photoUpload');
  if (photoInput && photoWrapper && window.DataTransfer) {
    var existingCount = parseInt(photoWrapper.dataset.existing || '0', 10);
    var maxImages = parseInt(photoWrapper.dataset.max || '3', 10);
    var previewsEl = document.getElementById('newPhotoPreviews');
    var countEl = document.getElementById('photoPreviewCount');
    var uploadLabel = document.getElementById('uploadBtnLabel');
    var stagedFiles = [];

    function refreshInputFiles() {
      var dt = new DataTransfer();
      stagedFiles.forEach(function (f) { dt.items.add(f); });
      photoInput.files = dt.files;
    }

    function renderPreviews() {
      previewsEl.innerHTML = '';
      stagedFiles.forEach(function (file, idx) {
        var url = URL.createObjectURL(file);
        var div = document.createElement('div');
        div.className = 'existing-photo';
        var img = document.createElement('img');
        img.src = url;
        img.alt = '';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'remove-photo';
        btn.title = 'Remove';
        btn.innerHTML = '&times;';
        btn.addEventListener('click', function () {
          stagedFiles.splice(idx, 1);
          refreshInputFiles();
          renderPreviews();
        });
        div.appendChild(img);
        div.appendChild(btn);
        previewsEl.appendChild(div);
      });
      var total = existingCount + stagedFiles.length;
      countEl.textContent = total ? total + ' / ' + maxImages + ' photos' : '';
      if (total >= maxImages) {
        uploadLabel.classList.add('disabled');
      } else {
        uploadLabel.classList.remove('disabled');
      }
    }

    uploadLabel.addEventListener('click', function (e) {
      var total = existingCount + stagedFiles.length;
      if (total >= maxImages) {
        e.preventDefault();
        alert('You can only add up to ' + maxImages + ' photos for this listing. Remove one first.');
      }
    });

    photoInput.addEventListener('change', function () {
      var incoming = Array.prototype.slice.call(photoInput.files || []);
      var remaining = maxImages - existingCount - stagedFiles.length;
      if (incoming.length > remaining) {
        alert('You can add ' + Math.max(remaining, 0) + ' more photo(s), the rest were not added.');
      }
      incoming.slice(0, Math.max(remaining, 0)).forEach(function (f) { stagedFiles.push(f); });
      refreshInputFiles();
      renderPreviews();
    });

    renderPreviews();
  }

  /* ---------- Mobile hamburger menu ---------- */
  var hamburger = document.getElementById('hamburgerBtn');
  var mobileMenu = document.getElementById('mobileMenu');
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', function () {
      var open = mobileMenu.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* ---------- Dropdowns: hover with a grace-period delay, plus click support on touch ---------- */
  var HIDE_DELAY = 550; // ms, enough time to move the mouse from the button into the menu
  document.querySelectorAll('.dd').forEach(function (dd) {
    var trigger = dd.querySelector('.dd-trigger');
    var menu = dd.querySelector('.dd-menu');
    if (!trigger || !menu) return;
    var hideTimer = null;

    function show() {
      clearTimeout(hideTimer);
      dd.classList.add('open');
    }
    function scheduleHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        dd.classList.remove('open');
      }, HIDE_DELAY);
    }

    dd.addEventListener('mouseenter', show);
    dd.addEventListener('mouseleave', scheduleHide);

    // Touch / click support (hover doesn't exist on phones).
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = dd.classList.contains('open');
      document.querySelectorAll('.dd.open').forEach(function (el) { el.classList.remove('open'); });
      if (!isOpen) show();
    });
    document.addEventListener('click', function (e) {
      if (!dd.contains(e.target)) {
        clearTimeout(hideTimer);
        dd.classList.remove('open');
      }
    });
  });

  /* ---------- Dark / light theme toggle ---------- */
  var themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var root = document.documentElement;
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('dzairphone-theme', next); } catch (e) {}
    });
  }

  /* ---------- Scroll reveal animation ---------- */
  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && revealEls.length) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry, i) {
          if (entry.isIntersecting) {
            var el = entry.target;
            setTimeout(function () { el.classList.add('in-view'); }, (i % 8) * 60);
            observer.unobserve(el);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    revealEls.forEach(function (el) { observer.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('in-view'); });
  }
})();
