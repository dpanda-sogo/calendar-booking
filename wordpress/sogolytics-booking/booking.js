/**
 * Sogolytics Demo Booking — WordPress widget JS
 *
 * API endpoints are WordPress REST routes (/wp-json/sgbk/v1/*)
 * injected via wp_localize_script as window.sgbkConfig.apiBase
 *
 * Flow with Contact Form 7:
 *  1. Widget: date strip + slot grid
 *  2. Slot click → pre-fills CF7 hidden fields, scrolls form into view
 *  3. CF7 submit → wpcf7mailsent fires → POST /wp-json/sgbk/v1/book
 *  4. Confirmation panel shown
 */

(function () {
  'use strict';

  // ── Config (injected by wp_localize_script) ───────────────────────────────
  var API_BASE = (window.sgbkConfig && window.sgbkConfig.apiBase) || '/wp-json/sgbk/v1';
  var WP_NONCE = (window.sgbkConfig && window.sgbkConfig.nonce)   || '';

  // ── State ─────────────────────────────────────────────────────────────────
  var _region       = 'row';
  var _country      = '';
  var _timezone     = 'UTC';
  var _selectedDate = '';
  var _selectedSlot = null;
  var _email        = '';

  // ── Widget root ───────────────────────────────────────────────────────────
  var widget = document.querySelector('.sgbk-widget');
  if (!widget) return;

  var CF7_ID = parseInt(widget.dataset.cf7Id || '0', 10);

  // ── DOM helpers ───────────────────────────────────────────────────────────
  var $w = function (id) { return document.getElementById(id); };
  var show = function (el) { if (el) el.hidden = false; };
  var hide = function (el) { if (el) el.hidden = true; };

  var elSpinner   = $w('sgbkSpinner');
  var elCalendar  = $w('sgbkCalendar');
  var elDateStrip = $w('sgbkDateStrip');
  var elSlotLoad  = $w('sgbkSlotLoading');
  var elSlotGrid  = $w('sgbkSlotGrid');
  var elSummary   = $w('sgbkSlotSummary');
  var elBtnBack   = $w('sgbkBtnBack');
  var elConfirm   = $w('sgbkConfirm');
  var elConfTime  = $w('sgbkConfirmTime');
  var elConfMsg   = $w('sgbkConfirmMsg');
  var elTeams     = $w('sgbkTeamsLink');
  var elAlertAmb  = $w('sgbkAlertAmber');
  var elAlertRed  = $w('sgbkAlertRed');
  var elDemoBadge = $w('sgbkDemoBadge');

  function showAlert(el, msg) { el.textContent = msg; show(el); }
  function hideAlert(el) { el.textContent = ''; hide(el); }

  // ── CF7 helpers ───────────────────────────────────────────────────────────
  function getCF7Wrapper() {
    if (CF7_ID) {
      var el = document.querySelector('.wpcf7[data-id="' + CF7_ID + '"]');
      if (el) return el;
    }
    return document.querySelector('.wpcf7');
  }
  function cf7Field(name) {
    var w = getCF7Wrapper();
    return w ? w.querySelector('[name="' + name + '"]') : null;
  }

  // ── Date utilities ────────────────────────────────────────────────────────
  function getNext14Weekdays() {
    var days = [], d = new Date();
    d.setHours(0, 0, 0, 0);
    while (days.length < 14) {
      if (d.getDay() !== 0 && d.getDay() !== 6) days.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return days;
  }
  function toYMD(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function pillLabel(d) {
    return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()] + ' ' + d.getDate();
  }

  // ── Date strip ────────────────────────────────────────────────────────────
  function buildDateStrip() {
    var weekdays = getNext14Weekdays();
    elDateStrip.innerHTML = '';
    weekdays.forEach(function (d, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sgbk-date-pill' + (i === 0 ? ' is-active' : '');
      btn.textContent = pillLabel(d);
      btn.dataset.date = toYMD(d);
      btn.addEventListener('click', function () {
        elDateStrip.querySelectorAll('.sgbk-date-pill').forEach(function (p) {
          p.classList.remove('is-active');
        });
        btn.classList.add('is-active');
        _selectedDate = btn.dataset.date;
        clearSlotSelection();
        fetchSlots(_selectedDate);
      });
      elDateStrip.appendChild(btn);
    });
    _selectedDate = toYMD(weekdays[0]);
  }

  // ── Fetch slots from WP REST API ──────────────────────────────────────────
  function fetchSlots(date) {
    elSlotGrid.innerHTML = '';
    show(elSlotLoad);
    hideAlert(elAlertRed);
    hideAlert(elAlertAmb);

    var tz  = encodeURIComponent(_timezone);
    var url = API_BASE + '/availability?region=' + _region + '&date=' + date + '&timezone=' + tz;

    fetch(url, { headers: { 'X-WP-Nonce': WP_NONCE } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        hide(elSlotLoad);
        if (data.demo) show(elDemoBadge);
        if (data.code) { // WP_Error returns { code, message }
          elSlotGrid.innerHTML = '<div class="sgbk-avail-error">Unable to load availability. Please refresh the page.</div>';
          return;
        }
        renderSlots(data.slots || []);
      })
      .catch(function () {
        hide(elSlotLoad);
        elSlotGrid.innerHTML = '<div class="sgbk-avail-error">Unable to load availability. Please refresh the page.</div>';
      });
  }

  function renderSlots(slots) {
    elSlotGrid.innerHTML = '';
    if (!slots.length) {
      elSlotGrid.innerHTML = '<div class="sgbk-no-slots">No availability on this date. Please try another day.</div>';
      return;
    }
    slots.forEach(function (slot) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sgbk-slot-btn';
      var parts = slot.display.split('·');
      btn.textContent = parts.length > 1 ? parts[1].trim() : slot.display;
      btn.addEventListener('click', function () { selectSlot(slot, btn); });
      elSlotGrid.appendChild(btn);
    });
  }

  // ── Slot selection → pre-fill CF7 hidden fields ───────────────────────────
  function selectSlot(slot, btn) {
    elSlotGrid.querySelectorAll('.sgbk-slot-btn').forEach(function (b) {
      b.classList.remove('is-selected');
    });
    btn.classList.add('is-selected');
    _selectedSlot = slot;

    var fSlot    = cf7Field('booking-slot');
    var fRegion  = cf7Field('booking-region');
    var fTz      = cf7Field('booking-timezone');
    var fCountry = cf7Field('booking-country');
    if (fSlot)    fSlot.value    = slot.iso;
    if (fRegion)  fRegion.value  = _region;
    if (fTz)      fTz.value      = _timezone;
    if (fCountry) fCountry.value = _country;

    elSummary.innerHTML = '&#128197; <strong>' + slot.display +
      '</strong> <span style="font-weight:400;opacity:0.6">(your local time)</span>';
    show(elSummary);
    show(elBtnBack);

    var wrapper = getCF7Wrapper();
    if (wrapper) {
      setTimeout(function () {
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 60);
    }
  }

  function clearSlotSelection() {
    _selectedSlot = null;
    hide(elSummary);
    hide(elBtnBack);
    elSlotGrid.querySelectorAll('.sgbk-slot-btn').forEach(function (b) {
      b.classList.remove('is-selected');
    });
    ['booking-slot','booking-region','booking-timezone','booking-country'].forEach(function (n) {
      var f = cf7Field(n); if (f) f.value = '';
    });
  }

  elBtnBack.addEventListener('click', function () {
    clearSlotSelection();
    hideAlert(elAlertAmb);
    hideAlert(elAlertRed);
    widget.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  // ── CF7 mailsent → POST /wp-json/sgbk/v1/book ────────────────────────────
  document.addEventListener('wpcf7mailsent', function (event) {
    if (CF7_ID && event.detail.contactFormId !== CF7_ID) return;

    var inputs = {};
    (event.detail.inputs || []).forEach(function (inp) {
      inputs[inp.name] = inp.value;
    });

    var slot = inputs['booking-slot'];
    if (!slot) return;

    _email = inputs['your-email'] || inputs['email'] || '';

    fetch(API_BASE + '/book', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-WP-Nonce':   WP_NONCE,
      },
      body: JSON.stringify({
        region:      inputs['booking-region']   || _region,
        slot:        slot,
        firstName:   inputs['first-name']        || '',
        lastName:    inputs['last-name']         || '',
        email:       _email,
        phone:       inputs['your-phone']        || '',
        projectType: inputs['project-type']      || '',
        timezone:    inputs['booking-timezone']  || _timezone,
        country:     inputs['booking-country']   || _country,
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.code === 'slot_taken') {
          clearSlotSelection();
          showAlert(elAlertAmb, data.message || 'That slot was just taken — please pick another time.');
          fetchSlots(_selectedDate);
          return;
        }
        if (data.success) {
          showConfirmation(data);
        } else {
          showAlert(elAlertRed, 'Booking failed. Please email demos@sogolytics.com');
        }
      })
      .catch(function () {
        showAlert(elAlertRed, 'Something went wrong. Please email demos@sogolytics.com');
      });
  }, false);

  // ── Confirmation ──────────────────────────────────────────────────────────
  function showConfirmation(data) {
    hide(elCalendar);
    var wrapper = getCF7Wrapper();
    if (wrapper) hide(wrapper);

    elConfTime.textContent = _selectedSlot ? _selectedSlot.display : '';
    elConfMsg.textContent  = 'A calendar invite has been sent to ' + _email;

    if (data.meetingLink) {
      var a = document.createElement('a');
      a.href = data.meetingLink;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.className = 'sgbk-btn-teams';
      a.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none">' +
        '<rect x="2" y="5" width="8" height="6" rx="1.5" stroke="#fff" stroke-width="1.4"/>' +
        '<path d="M10 7l4-2v6l-4-2V7z" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>' +
        '</svg> Join Teams call';
      elTeams.innerHTML = '';
      elTeams.appendChild(a);
    }
    show(elConfirm);
    widget.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ── IP detection ──────────────────────────────────────────────────────────
  function initCalendar() {
    hide(elSpinner);
    show(elCalendar);
    buildDateStrip();
    fetchSlots(_selectedDate);
  }

  var ipTimer = setTimeout(initCalendar, 2000);

  fetch('https://ipapi.co/json/')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      clearTimeout(ipTimer);
      _country  = d.country_code || '';
      _timezone = d.timezone     || 'UTC';
      _region   = (_country === 'US' || _country === 'CA') ? 'us' : 'row';
      initCalendar();
    })
    .catch(function () {
      clearTimeout(ipTimer);
      initCalendar();
    });

})();
