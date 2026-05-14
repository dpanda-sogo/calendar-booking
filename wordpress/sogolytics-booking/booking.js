/**
 * Sogolytics Demo Booking — WordPress widget JS
 *
 * How it works with Contact Form 7:
 *  1. Widget renders date strip + slot grid
 *  2. User picks a slot → hidden CF7 fields are pre-filled,
 *     CF7 form wrapper scrolls into view
 *  3. User fills + submits the CF7 form
 *  4. On CF7's `wpcf7mailsent` event → POST /api/book on Vercel
 *  5. Booking API creates Outlook event + Salesforce lead
 *  6. Confirmation panel replaces the widget
 */

(function () {
  'use strict';

  // ── Globals ──────────────────────────────────────────────────────────────
  var _region   = 'row';
  var _country  = '';
  var _timezone = 'UTC';
  var _selectedDate = '';
  var _selectedSlot = null; // { iso, display }
  var _email = '';          // captured from CF7 inputs on submit

  // ── Find widget on page ───────────────────────────────────────────────────
  var widget = document.querySelector('.sgbk-widget');
  if (!widget) return;

  var API_URL = widget.dataset.apiUrl || '';
  var CF7_ID  = parseInt(widget.dataset.cf7Id || '0', 10);

  // ── DOM helpers ───────────────────────────────────────────────────────────
  function $w(id) { return document.getElementById(id); }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }

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

  function showAlert(el, msg) {
    el.textContent = msg;
    show(el);
  }
  function hideAlert(el) { el.textContent = ''; hide(el); }

  // ── Find CF7 form container ───────────────────────────────────────────────
  // Looks for a .wpcf7 on the page matching cf7_id, or the first one found.
  function getCF7Wrapper() {
    if (CF7_ID) {
      var el = document.querySelector('.wpcf7[data-id="' + CF7_ID + '"]');
      if (el) return el;
    }
    return document.querySelector('.wpcf7');
  }

  // Get a hidden input inside the CF7 form by field name
  function cf7Field(name) {
    var wrapper = getCF7Wrapper();
    return wrapper ? wrapper.querySelector('[name="' + name + '"]') : null;
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

  // ── Build date strip ──────────────────────────────────────────────────────
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

  // ── Fetch slots from Vercel API ───────────────────────────────────────────
  function fetchSlots(date) {
    elSlotGrid.innerHTML = '';
    show(elSlotLoad);
    hideAlert(elAlertRed);
    hideAlert(elAlertAmb);

    var tz  = encodeURIComponent(_timezone);
    var url = API_URL + '/api/availability?region=' + _region + '&date=' + date + '&timezone=' + tz;

    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        hide(elSlotLoad);
        if (data.demo) show(elDemoBadge);
        if (data.error) {
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

    // Pre-fill CF7 hidden fields
    var fSlot    = cf7Field('booking-slot');
    var fRegion  = cf7Field('booking-region');
    var fTz      = cf7Field('booking-timezone');
    var fCountry = cf7Field('booking-country');
    if (fSlot)    fSlot.value    = slot.iso;
    if (fRegion)  fRegion.value  = _region;
    if (fTz)      fTz.value      = _timezone;
    if (fCountry) fCountry.value = _country;

    // Show summary above form
    elSummary.innerHTML = '&#128197; <strong>' + slot.display +
      '</strong> <span style="font-weight:400;opacity:0.6">(your local time)</span>';
    show(elSummary);
    show(elBtnBack);

    // Scroll CF7 form into view
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
    // Clear hidden fields
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

  // ── Listen to CF7 mailsent → call Vercel booking API ─────────────────────
  document.addEventListener('wpcf7mailsent', function (event) {
    // Filter by form ID if specified
    if (CF7_ID && event.detail.contactFormId !== CF7_ID) return;

    // Extract field values from CF7 event detail
    var inputs = {};
    (event.detail.inputs || []).forEach(function (inp) {
      inputs[inp.name] = inp.value;
    });

    var slot = inputs['booking-slot'];
    if (!slot) return; // not a booking form submission

    _email = inputs['your-email'] || inputs['email'] || '';

    fetch(API_URL + '/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
        if (data.error === 'slot_taken') {
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

  // ── Confirmation panel ────────────────────────────────────────────────────
  function showConfirmation(data) {
    // Hide the calendar section and any CF7 wrapper
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

  // ── IP detection → init calendar ──────────────────────────────────────────
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
