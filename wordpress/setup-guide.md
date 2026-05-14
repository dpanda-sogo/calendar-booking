# WordPress Setup Guide — Sogolytics Demo Booking

## Architecture

Everything runs inside WordPress — no Vercel, no external hosting needed.

```
[WordPress Page]
  ├── [sogolytics_booking cf7_id="123"]    ← date picker + slot grid (shortcode)
  └── [contact-form-7 id="123"]            ← CF7 form

[WordPress REST API]  (inside the plugin — same server)
  ├── GET  /wp-json/sgbk/v1/availability   ← fetches free slots
  └── POST /wp-json/sgbk/v1/book           ← creates calendar event

[PHP inside the plugin]
  ├── → Microsoft Graph API (Outlook calendar + Teams link)
  └── → Salesforce REST API (Lead creation, optional)
```

**Visitor flow:**
1. Page loads → IP detected silently → correct calendar region selected
2. Visitor picks a date → slot grid loads (PHP calls MS Graph)
3. Visitor clicks a slot → CF7 form scrolls into view, hidden fields pre-filled
4. Visitor fills + submits CF7 form → CF7 validates, sends admin email, saves entry
5. On CF7's `wpcf7mailsent` JS event → plugin calls `/wp-json/sgbk/v1/book`
6. PHP creates Outlook calendar event with Teams link + Salesforce lead
7. Confirmation panel replaces the widget

---

## Step 1 — Install the plugin

1. Zip the folder `wordpress/sogolytics-booking/`
2. In WP Admin go to **Plugins → Add New → Upload Plugin** and upload the zip
3. Click **Activate**

**Or** copy the folder via FTP/SSH directly to:
```
wp-content/plugins/sogolytics-booking/
```

---

## Step 2 — Enter credentials

Go to **Settings → Demo Booking** in WP Admin.

Fill in the following fields:

| Field | Where to find it |
|-------|-----------------|
| Azure Tenant ID | Azure Portal → Azure AD → App registrations → your app → Directory (tenant) ID |
| Azure Client ID | Same page → Application (client) ID |
| Azure Client Secret | App → Certificates & secrets → New client secret → copy Value |
| US Calendar | Email of the US demo calendar mailbox (default: us-demos@sogolytics.com) |
| RoW Calendar | Email of the RoW demo calendar mailbox (default: row-demos@sogolytics.com) |
| Salesforce fields | All optional — booking works without them |

> The settings page shows a status badge: **Live mode** (green) when Azure is
> configured, **Demo mode** (yellow) when not. In demo mode, realistic mock
> slots are generated and booking simulates success — the widget is fully
> usable for testing.

**Azure permissions required** (Application permissions, not Delegated):
- `Calendars.Read`
- `Calendars.ReadWrite`
- `User.Read.All`
Grant admin consent after adding them.

---

## Step 3 — Create the Contact Form 7 form

1. **Contact → Add New**
2. Name it e.g. "Demo Booking Form"
3. Replace the default form body with the content from `wordpress/cf7-form-template.txt`
4. In the **Mail** tab fill in subject and message body (templates in same file)
5. Click the gear icon → **Additional CSS class name**, add:
   ```
   sgbk-cf7-form
   ```
   This applies the dark-teal input styling from the plugin's CSS.
6. Save and note the **Form ID** (shown in the CF7 forms list, e.g. 123)

---

## Step 4 — Add shortcodes to the page

Edit your WordPress page (e.g. the NPS/CSAT product page). Replace the
existing lead-form block with:

```
[sogolytics_booking cf7_id="123"]

[contact-form-7 id="123"]
```

Replace `123` with your actual CF7 form ID in both places.

> Both shortcodes go in the same column. The CF7 form is always present
> in the DOM (CF7 needs this for its own JS); the booking widget scrolls it
> into view only after a slot is selected.

---

## Step 5 — Test the full flow

1. Open the page in a browser
2. Spinner → slot grid appears (DEMO badge if no Azure credentials)
3. Click a date pill → slots reload
4. Click a time slot → CF7 form scrolls into view, green summary shown
5. Fill the form → Submit
6. CF7 shows its success message → booking API fires
7. Confirmation panel: "You're booked!" with the selected time

**With live Azure credentials:** Outlook calendar event is created with Teams
link; the confirmation panel shows a "Join Teams call" button.

---

## CF7 hidden field reference

These four hidden fields must be present in the CF7 form. The widget JS
pre-fills them when a slot is selected:

| CF7 field name      | Content                               |
|---------------------|---------------------------------------|
| `booking-slot`      | ISO timestamp of selected slot (UTC)  |
| `booking-region`    | `us` or `row`                         |
| `booking-timezone`  | IANA timezone e.g. `Asia/Kolkata`     |
| `booking-country`   | ISO country code e.g. `IN`            |

Visible CF7 field names (must match exactly for the booking API to read them):

| CF7 field name  | Maps to         |
|-----------------|-----------------|
| `first-name`    | firstName        |
| `last-name`     | lastName         |
| `your-email`    | email            |
| `your-phone`    | phone (optional) |
| `project-type`  | projectType      |

---

## REST API endpoints

Both endpoints are public (no authentication required — they only read/write
to the configured calendars). They are protected against CSRF via WP nonce.

```
GET /wp-json/sgbk/v1/availability
  ?region=us|row
  &date=YYYY-MM-DD
  &timezone=America%2FNew_York

POST /wp-json/sgbk/v1/book
Content-Type: application/json
{ region, slot, firstName, lastName, email, phone, projectType, timezone, country }
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Slots never load | Check WP permalink structure is not set to "Plain" (REST API needs pretty permalinks). Go to Settings → Permalinks → save any non-plain option. |
| CF7 form not found | Confirm `cf7_id` in shortcode matches the form's post ID |
| Booking API not called | Open browser console — check `wpcf7mailsent` fires; check hidden `booking-slot` has a value |
| 403 on REST calls | Plugin may not be activated; check REST API is not disabled by a security plugin |
| DEMO badge shows | Azure credentials not entered in Settings → Demo Booking |
| Teams link missing | Confirm the Azure app has `Calendars.ReadWrite` with admin consent granted |
