# WordPress Setup Guide — Sogolytics Demo Booking

## Architecture

```
[WordPress Page]
  ├── [sogolytics_booking api_url="..." cf7_id="123"]   ← date picker + slots
  └── [contact-form-7 id="123"]                         ← CF7 form (existing plugin)

[Vercel]
  ├── /api/availability  ← called by the widget JS to fetch free slots
  └── /api/book          ← called after CF7 mailsent to create calendar event
```

**Flow:**
1. Visitor lands on page → IP detected silently → correct calendar loaded
2. Visitor picks a date → slot grid loads
3. Visitor clicks a slot → CF7 form scrolls into view, hidden fields pre-filled
4. Visitor fills + submits CF7 form → CF7 validates, sends admin email, saves entry
5. On `wpcf7mailsent` event → widget calls Vercel `/api/book`
6. Vercel creates Outlook calendar event + Teams link + Salesforce lead
7. Confirmation panel replaces widget

---

## Step 1 — Deploy the Vercel API

1. Push this repo to GitHub (already done)
2. Import the repo at vercel.com → New Project
3. Add all environment variables from `.env.example` in Vercel dashboard
4. Deploy → note your deployment URL e.g. `https://sogolytics-demo.vercel.app`

---

## Step 2 — Install the WordPress plugin

1. In your WordPress admin go to **Plugins → Add New → Upload Plugin**
2. Zip the folder `wordpress/sogolytics-booking/` and upload it
3. Activate **Sogolytics Demo Booking**

**Or** copy the folder directly to `wp-content/plugins/sogolytics-booking/` via FTP/SSH.

---

## Step 3 — Create the Contact Form 7 form

1. Go to **Contact → Add New**
2. Give it a name e.g. "Demo Booking Form"
3. Replace the default form body with the content from `wordpress/cf7-form-template.txt`
4. In the **Mail** tab fill in the subject and message body (templates in the same file)
5. In the form settings gear icon → **Additional CSS class name** add:
   ```
   sgbk-cf7-form
   ```
6. Save the form and note the **Form ID** (visible in the CF7 forms list, e.g. 123)

---

## Step 4 — Add shortcodes to your page

Edit the WordPress page where you want the booking widget (e.g. the NPS/CSAT product page).

Replace the existing lead form section with two shortcodes:

```
<!-- Date picker + slot grid -->
[sogolytics_booking api_url="https://sogolytics-demo.vercel.app" cf7_id="123"]

<!-- CF7 form — place directly below, stays hidden until a slot is picked -->
[contact-form-7 id="123"]
```

> **Tip:** Both shortcodes can live inside the same column/block. The CF7 form
> is always present in the DOM so CF7's JS loads correctly — the widget JS
> scrolls it into view when a slot is selected.

---

## Step 5 — Style the CF7 form to match

The plugin ships `booking.css` which styles CF7 inputs to match the Sogolytics
dark-teal theme when you add the `sgbk-cf7-form` CSS class (Step 3).

If your theme overrides styles, add this to your **Additional CSS** (Appearance → Customize):

```css
.sgbk-cf7-form input[type="text"],
.sgbk-cf7-form input[type="email"],
.sgbk-cf7-form input[type="tel"],
.sgbk-cf7-form select {
  background: rgba(255,255,255,0.95) !important;
  border-radius: 8px !important;
  color: #1a1a1a !important;
}
.sgbk-cf7-form input[type="submit"] {
  background: #F5E03C !important;
  border-radius: 999px !important;
  font-weight: 700 !important;
}
```

---

## Step 6 — Test the full flow

1. Open the page in a browser
2. Watch spinner → slots appear
3. Click a slot → CF7 form scrolls into view, slot summary shown in green
4. Fill the form → click submit
5. CF7 confirms mail sent → widget calls Vercel API
6. Confirmation panel shows booked time + Teams link (if live credentials set)

**Without Vercel credentials (demo mode):**
- Slots are generated from mock data
- Booking returns a fake success
- DEMO badge appears in the widget corner
- Full UI flow still works end-to-end

---

## CF7 field name reference

| CF7 field name     | Purpose                              |
|--------------------|--------------------------------------|
| `booking-slot`     | ISO timestamp of selected slot (UTC) |
| `booking-region`   | `us` or `row`                        |
| `booking-timezone` | IANA timezone e.g. `Asia/Kolkata`    |
| `booking-country`  | ISO country code e.g. `IN`           |
| `first-name`       | Visitor first name                   |
| `last-name`        | Visitor last name                    |
| `your-email`       | Work email                           |
| `your-phone`       | Phone (optional)                     |
| `project-type`     | Dropdown selection                   |

> Field names must match exactly — the booking widget JS reads them by name
> from the `wpcf7mailsent` event detail.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Slots never load | Check `api_url` has no trailing slash; check CORS on Vercel |
| CF7 form not found | Confirm `cf7_id` matches the form's post ID in WP admin |
| Booking API not called after CF7 submit | Confirm `wpcf7mailsent` fires (check browser console); confirm hidden `booking-slot` field is present in the CF7 form |
| "Something went wrong" after CF7 | Check Vercel function logs; Vercel URL may be wrong |
| DEMO badge shows | Azure credentials not set in Vercel env vars |
