# Sogolytics Demo Booking Widget — Complete Setup Guide

**Version:** 2.0  
**Audience:** IT Administrators · WordPress Developers  
**Last updated:** May 2026

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Prerequisites Checklist](#2-prerequisites-checklist)
3. [Azure AD App Registration](#3-azure-ad-app-registration)
4. [WordPress Plugin Installation](#4-wordpress-plugin-installation)
5. [Contact Form 7 Setup](#5-contact-form-7-setup)
6. [Plugin Credentials & Settings](#6-plugin-credentials--settings)
7. [Adding the Widget to a Page](#7-adding-the-widget-to-a-page)
8. [Salesforce Connected App Setup](#8-salesforce-connected-app-setup)
9. [Pardot Email Automation](#9-pardot-email-automation)
10. [Testing the Full Flow](#10-testing-the-full-flow)
11. [Troubleshooting](#11-troubleshooting)
12. [Field Reference](#12-field-reference)

---

## 1. System Overview

The Sogolytics Demo Booking Widget replaces a static lead form with an interactive calendar that lets website visitors book a 30-minute Teams demo call directly on a Sogolytics team calendar — without any back-and-forth email.

### How it works end to end

```
┌─────────────────────────────────────────────────────────────┐
│  VISITOR (Browser)                                          │
│                                                             │
│  1. Lands on page → IP detected → correct region assigned   │
│  2. Picks date + time slot                                  │
│  3. Fills Contact Form 7 fields → submits                   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  WORDPRESS (Plugin: Sogolytics Demo Booking)                │
│                                                             │
│  REST API: /wp-json/sgbk/v1/book                            │
│  • Calls Microsoft Graph API → creates Outlook event        │
│  • Attaches Teams meeting link                              │
│  • Creates Salesforce Lead record                           │
└────────────┬──────────────────────────┬─────────────────────┘
             │                          │
             ▼                          ▼
┌────────────────────────┐  ┌───────────────────────────────┐
│  MICROSOFT 365         │  │  SALESFORCE + PARDOT          │
│                        │  │                               │
│  • Calendar event      │  │  • Lead created               │
│    added to mailbox    │  │  • Pardot automation fires    │
│  • Teams link          │  │  • Branded confirmation email │
│    generated           │  │    sent to visitor            │
│  • Calendar invite     │  │  • Internal alert to sales    │
│    sent to visitor     │  │  • Lead enrolled in nurture   │
└────────────────────────┘  └───────────────────────────────┘
```

### Calendar routing by geography

| Visitor country | Calendar mailbox used |
|---|---|
| United States, Canada | `us-demos@sogolytics.com` (Eastern Time, 9 AM–5 PM ET) |
| All other countries | `row-demos@sogolytics.com` (India Time, 9 AM–5 PM IST) |

Routing is automatic and silent — the visitor never sees it.

### Demo mode

If Azure credentials are not yet configured, the widget runs in **Demo Mode** — it generates realistic mock time slots and simulates a successful booking so the UI can be tested end-to-end with no live credentials.

---

## 2. Prerequisites Checklist

Before starting, confirm the following are in place:

### IT / Microsoft 365
- [ ] Access to **Azure Portal** (portal.azure.com) with Global Administrator or Application Administrator role
- [ ] Two shared calendar mailboxes exist in Exchange Online:
  - `us-demos@sogolytics.com`
  - `row-demos@sogolytics.com`
- [ ] Microsoft Teams is enabled for the organisation (for Teams meeting links)

### Salesforce / Pardot
- [ ] Salesforce org with API access enabled
- [ ] A dedicated API user (System Administrator profile or custom profile with API access)
- [ ] Pardot (Account Engagement) enabled and connected to Salesforce
- [ ] A custom Lead field `Project_Type__c` (Text, 255) exists on the Lead object

### WordPress
- [ ] WordPress 5.8 or later
- [ ] **Contact Form 7** plugin installed and active
- [ ] PHP 7.4 or later (PHP 8.x recommended)
- [ ] HTTPS enabled on the site (required for Microsoft Graph API calls)
- [ ] Pretty permalinks enabled (Settings → Permalinks → any option other than Plain)

---

## 3. Azure AD App Registration

This gives the WordPress plugin permission to read and write to the demo calendar mailboxes.

### 3.1 Create the app registration

1. Go to [portal.azure.com](https://portal.azure.com) and sign in as a Global Administrator.
2. Search for **Azure Active Directory** in the top search bar and open it.
3. In the left sidebar click **App registrations → New registration**.
4. Fill in:
   - **Name:** `Sogolytics Demo Booking`
   - **Supported account types:** Accounts in this organizational directory only
   - **Redirect URI:** Leave blank
5. Click **Register**.

### 3.2 Note your IDs

On the app overview page, copy and save:
- **Application (client) ID** → this becomes `AZURE_CLIENT_ID`
- **Directory (tenant) ID** → this becomes `AZURE_TENANT_ID`

### 3.3 Add API permissions

1. In the left sidebar click **API permissions → Add a permission**.
2. Select **Microsoft Graph → Application permissions**.
3. Search for and add:
   - `Calendars.Read`
   - `Calendars.ReadWrite`
   - `User.Read.All`
4. Click **Add permissions**.
5. Click **Grant admin consent for [your organisation]** and confirm.

> ⚠️ **Admin consent is required.** Without it the API calls will return 403 Forbidden.
> Only a Global Administrator can grant admin consent.

### 3.4 Create a client secret

1. In the left sidebar click **Certificates & secrets → New client secret**.
2. Description: `demo-booking-wp`
3. Expiry: 24 months (set a reminder to rotate before it expires)
4. Click **Add**.
5. **Copy the Value immediately** — it is only shown once. This becomes `AZURE_CLIENT_SECRET`.

---

## 4. WordPress Plugin Installation

### 4.1 Upload the plugin

**Option A — via WP Admin (recommended):**
1. Obtain the plugin zip file: `sogolytics-booking.zip`
   (Zip the folder `wordpress/sogolytics-booking/` from the repository)
2. Go to **WP Admin → Plugins → Add New → Upload Plugin**
3. Choose the zip file and click **Install Now**
4. Click **Activate Plugin**

**Option B — via FTP/SSH:**
```
Copy the folder:
  wordpress/sogolytics-booking/

To:
  /wp-content/plugins/sogolytics-booking/
```
Then go to **WP Admin → Plugins** and activate **Sogolytics Demo Booking**.

### 4.2 Verify activation

After activating, confirm:
- The plugin appears as **Active** in the plugins list
- A new menu item **Settings → Demo Booking** appears in WP Admin

---

## 5. Contact Form 7 Setup

### 5.1 Create a new CF7 form

1. Go to **WP Admin → Contact → Add New**
2. Name it: `Demo Booking Form`
3. Delete the default form content and paste the following:

```
[hidden booking-slot ""]
[hidden booking-region ""]
[hidden booking-timezone ""]
[hidden booking-country ""]

<div class="sgbk-form-row sgbk-form-row--half">
  <div>
    <label>First name</label>
    [text* first-name placeholder "First name"]
  </div>
  <div>
    <label>Last name</label>
    [text* last-name placeholder "Last name"]
  </div>
</div>

<div class="sgbk-form-row">
  <label>Business email address</label>
  [email* your-email placeholder "jane@company.com"]
</div>

<div class="sgbk-form-row">
  <label>Phone <span style="opacity:.6">(optional)</span></label>
  [tel your-phone placeholder "Phone (optional)"]
</div>

<div class="sgbk-form-row">
  <label>What kind of projects do you plan to do?</label>
  [select* project-type "Customer Experience (CX)" "Employee Experience (EX)" "Market Research" "Other"]
</div>

[submit "Request a Demo →"]
```

> **Important:** The four `[hidden ...]` fields at the top are mandatory. The booking widget JS pre-fills them when a visitor selects a time slot. Without them, the calendar event will not be created.

### 5.2 Configure the Mail tab

Click the **Mail** tab and set:

**Subject:**
```
Demo request from [first-name] [last-name]
```

**Message body:**
```
A new demo has been booked via the website.

Name:          [first-name] [last-name]
Email:         [your-email]
Phone:         [your-phone]
Project type:  [project-type]

Booked slot (UTC): [booking-slot]
Region:            [booking-region]
Timezone:          [booking-timezone]
Country:           [booking-country]
```

### 5.3 Add the CSS class

1. Click the **gear icon** (⚙) in the form editor toolbar
2. In the **Additional CSS class name** field enter:
   ```
   sgbk-cf7-form
   ```
   This applies the dark-teal input styling and yellow submit button to match the Sogolytics brand.

### 5.4 Save and note the Form ID

Click **Save**. The form ID is displayed in the CF7 forms list (e.g. **123**). You will need this ID in Step 7.

---

## 6. Plugin Credentials & Settings

Go to **WP Admin → Settings → Demo Booking**.

### 6.1 Microsoft Azure AD

| Field | Value |
|---|---|
| Tenant ID | Directory (tenant) ID from Azure AD |
| Client ID | Application (client) ID from Azure AD |
| Client Secret | Secret value from Step 3.4 |

### 6.2 Calendar mailboxes

| Field | Default value |
|---|---|
| US Calendar (US + Canada visitors) | `us-demos@sogolytics.com` |
| RoW Calendar (all other countries) | `row-demos@sogolytics.com` |

Change these only if the mailbox addresses are different.

### 6.3 Salesforce (optional — booking works without it)

| Field | Value |
|---|---|
| Login URL | `https://login.salesforce.com` |
| Client ID | Salesforce Connected App Consumer Key (see Section 8) |
| Client Secret | Salesforce Connected App Consumer Secret |
| Username | API user email address |
| Password | API user password |
| Security Token | API user security token |

### 6.4 Status indicator

After saving, the top of the settings page shows:
- 🟢 **Live mode** — Azure credentials are valid, real calendar slots will load
- 🟡 **Demo mode** — Azure not configured, mock slots shown (safe for testing)

---

## 7. Adding the Widget to a Page

### 7.1 Edit the target page

Open the WordPress page where you want the booking widget (e.g. the NPS/CSAT product page). Using the Block Editor (Gutenberg), add two **Shortcode** blocks in the column where the existing lead form is:

**Block 1 — the booking widget (date picker + slot grid):**
```
[sogolytics_booking cf7_id="123"]
```

**Block 2 — the CF7 form (place directly below):**
```
[contact-form-7 id="123"]
```

Replace `123` with your actual CF7 form ID from Step 5.4.

> The CF7 form is always present in the page DOM — CF7 requires this for its own JavaScript to load. The booking widget automatically scrolls the form into view when a visitor selects a time slot; it is not visible until then.

### 7.2 Layout recommendation

The widget card is `max-width: 500px` — the same width as the original lead form on the Sogolytics product pages. Place both shortcodes in the right column of the existing two-column hero layout to drop straight into the existing design.

---

## 8. Salesforce Connected App Setup

### 8.1 Create the Connected App

1. In Salesforce Setup, search for **App Manager** and open it.
2. Click **New Connected App**.
3. Fill in:
   - **Connected App Name:** `Demo Booking Widget`
   - **API Name:** auto-fills
   - **Contact Email:** your admin email
4. Under **API (Enable OAuth Settings):**
   - Check **Enable OAuth Settings**
   - **Callback URL:** `https://login.salesforce.com/services/oauth2/success`
   - **Selected OAuth Scopes:** Add:
     - `Access and manage your data (api)`
     - `Perform requests at any time (refresh_token, offline_access)`
5. Click **Save**. Wait 2–10 minutes for the app to propagate.

### 8.2 Get the credentials

After the app is saved, click **Manage Consumer Details**:
- **Consumer Key** → `SF_CLIENT_ID`
- **Consumer Secret** → `SF_CLIENT_SECRET`

### 8.3 Get the API user's security token

1. Log in as the API user
2. Go to **Avatar → Settings → My Personal Information → Reset My Security Token**
3. Check email for the new token → `SF_SECURITY_TOKEN`

### 8.4 Create the custom Lead field

If `Project_Type__c` does not exist:
1. Setup → **Object Manager → Lead → Fields & Relationships → New**
2. Data type: **Text**, length 255
3. Field Label: `Project Type`, Field Name: `Project_Type__c`
4. Make it visible to all profiles and save.

---

## 9. Pardot Email Automation

This section explains how to send **branded confirmation emails via Pardot** (Salesforce Account Engagement) when a demo is booked — the same mechanism used by tools like Chili Piper.

### How Chili Piper does it (and how we replicate it)

Chili Piper triggers Pardot emails by:
1. Creating or updating a Salesforce Lead on booking
2. That Lead creation syncs to Pardot (via the SF–Pardot connector)
3. A Pardot Automation Rule fires based on the Lead Source
4. Pardot sends a branded email from your company domain

We already create a Salesforce Lead on every booking (`LeadSource = "Web Demo Booking"`). The steps below wire up Pardot to act on that.

---

### 9.1 Verify the Salesforce–Pardot sync

1. In Pardot (Account Engagement), go to **Admin → Connectors**
2. Confirm the Salesforce connector is **Active**
3. Go to **Admin → Salesforce Sync → Sync Settings**
4. Ensure **Lead** object is set to sync

> Leads created by the booking widget have `LeadSource = "Web Demo Booking"`. Pardot will automatically create a matching **Prospect** record when the Lead syncs.

---

### 9.2 Create the confirmation email template

1. In Pardot go to **Content → Emails → New Email**
2. Choose **Text + HTML** template
3. Name it: `Demo Booking Confirmation`
4. Build the email with the following content (customise as needed):

**Subject line:**
```
You're confirmed! Your Sogolytics demo is booked
```

**HTML body (key sections):**
```html
<p>Hi {{Recipient.FirstName}},</p>

<p>Your 30-minute Sogolytics demo is confirmed. Here are your details:</p>

<table>
  <tr><td><strong>Date & Time:</strong></td><td>{{Lead.Custom_Field_Booked_Slot}}</td></tr>
  <tr><td><strong>Format:</strong></td><td>Microsoft Teams call</td></tr>
  <tr><td><strong>Duration:</strong></td><td>30 minutes</td></tr>
</table>

<p>A calendar invite has been sent to this email address. 
   You can also add it to your calendar using the link below.</p>

<p>See you soon,<br>The Sogolytics Team</p>
```

> **Note:** To show the exact booked time in the Pardot email, you need to sync the `booking-slot` value from Salesforce into a custom Pardot Prospect field. See Step 9.5 for this optional enhancement.

---

### 9.3 Create the Automation Rule

Automation Rules fire when a Prospect matches defined criteria.

1. In Pardot go to **Automations → Automation Rules → Add Automation Rule**
2. **Name:** `Demo Booking — Send Confirmation Email`
3. **Match type:** Match ALL

**Rule criteria:**
| Field | Operator | Value |
|---|---|---|
| Lead Source | is | Web Demo Booking |
| Created At | in the last | 5 minutes |

4. Under **Actions → Add Action:**
   - Action: **Send email**
   - Email: `Demo Booking Confirmation` (created in Step 9.2)

5. **Repeat rule for same prospect:** Yes (so it fires on every booking, not just the first)
6. Save and **Activate** the rule.

---

### 9.4 Create the internal sales notification

Repeat Step 9.3 to create a second Automation Rule for the sales team:

1. **Name:** `Demo Booking — Internal Sales Alert`
2. Same criteria as above
3. **Action:** Send email
4. Create a separate internal email template:

**Subject:**
```
New demo booked — {{Lead.FirstName}} {{Lead.LastName}} ({{Lead.Company}})
```

**Body:**
```
A new demo has been booked via the website.

Name:         {{Lead.FirstName}} {{Lead.LastName}}
Email:        {{Lead.Email}}
Phone:        {{Lead.Phone}}
Project type: {{Lead.Project_Type__c}}
Country:      {{Lead.Country}}
Lead source:  {{Lead.LeadSource}}

View in Salesforce: {{Lead.CRM_URL}}
```

5. Set **Send to:** a static distribution list or individual sales email addresses
6. Save and Activate.

---

### 9.5 (Optional) Sync the booked time slot into Pardot

To include the exact booked date and time in Pardot emails:

**Step A — Create a custom Salesforce Lead field:**
1. Setup → Object Manager → Lead → Fields & Relationships → New
2. Data type: **DateTime**
3. Field Label: `Booked Slot`, Field Name: `Booked_Slot__c`

**Step B — Map the field to Pardot:**
1. Pardot → Admin → Configure Fields → Prospect Fields → Add Field
2. Field name: `Booked Slot`
3. Salesforce field mapping: `Booked_Slot__c`

**Step C — Populate the field from the plugin:**

In `wordpress/sogolytics-booking/includes/api-book.php`, add `Booked_Slot__c` to the Salesforce lead payload:

```php
// Inside the sgbk_create_sf_lead() function, add to the body array:
'Booked_Slot__c' => $lead['slot'] ?? '',
```

Also pass `slot` through from the handler:
```php
sgbk_create_sf_lead( $opts, [
    'firstName'   => $first_name,
    'lastName'    => $last_name,
    'email'       => $email,
    'phone'       => $phone,
    'projectType' => $project,
    'country'     => $country,
    'slot'        => $slot,   // ← add this line
] );
```

Now `{{Lead.Booked_Slot__c}}` (or the mapped Pardot field variable) can be used in email templates.

---

### 9.6 Pardot email sending domain

To ensure confirmation emails are sent **from your domain** (e.g. `demos@sogolytics.com`) rather than a Pardot subdomain:

1. Pardot → **Admin → Domain Management → Add Domain**
2. Add `sogolytics.com`
3. Your IT team needs to add these DNS records:

| Type | Host | Value |
|---|---|---|
| CNAME | `go.sogolytics.com` | `go.pardot.com` |
| TXT | `@` | Pardot-provided SPF record |
| CNAME | `info.sogolytics.com` | Pardot tracking domain |

4. Back in Pardot, click **Verify** once DNS propagates (allow 24–48 hours)

> Once verified, all Pardot emails for this account send from `@sogolytics.com` addresses and pass SPF/DKIM checks — exactly how Chili Piper confirmation emails appear to come from your own domain.

---

### 9.7 Summary — Pardot email flow

```
Visitor books demo
       │
       ▼
WordPress plugin creates Salesforce Lead
  LeadSource = "Web Demo Booking"
       │
       ▼ (Salesforce → Pardot sync, ~2 min)
Pardot Prospect created / updated
       │
       ├──▶ Automation Rule fires
       │         │
       │         ├──▶ Send "Demo Booking Confirmation" to visitor
       │         │    (branded, from demos@sogolytics.com)
       │         │
       │         └──▶ Send internal alert to sales team
       │
       └──▶ Enrol Prospect in demo nurture program (optional)
```

---

## 10. Testing the Full Flow

### 10.1 Demo mode test (no credentials needed)

1. Place the shortcodes on any WP page (see Section 7)
2. Load the page — the DEMO badge should appear in the widget corner
3. Browse dates, click a time slot
4. Fill in the CF7 form with a test email
5. Submit → confirm the "You're booked!" confirmation panel appears
6. Check WP Admin → Contact → CF7 entries to confirm the entry was saved

### 10.2 Live mode test (after entering Azure credentials)

1. Enter credentials in Settings → Demo Booking and save
2. DEMO badge should disappear
3. Repeat the booking flow
4. Check the calendar mailbox — a new event should appear with a Teams link
5. Check the test email inbox — a calendar invite should arrive from Outlook
6. Check Salesforce — a new Lead should exist with `LeadSource = "Web Demo Booking"`
7. Check Pardot — a Prospect should exist; allow 2–5 minutes for the automation email to send

### 10.3 Pardot email test

1. Use your own email address for the test booking
2. Wait up to 5 minutes
3. Check your inbox for the Pardot confirmation email
4. Verify sender domain, subject line, and booked time in the body
5. Check the sales notification inbox

---

## 11. Troubleshooting

### WordPress / Plugin

| Symptom | Likely cause | Fix |
|---|---|---|
| Slots never load, spinning indefinitely | REST API blocked or pretty permalinks off | Settings → Permalinks → save with any non-Plain option. Check security plugins (Wordfence etc.) for REST API blocks. |
| "Unable to load availability" error | Azure credentials wrong or admin consent not granted | Re-check credentials in Settings → Demo Booking. Re-grant admin consent in Azure portal. |
| CF7 form not visible after slot click | Wrong `cf7_id` in shortcode | Find the correct form ID in Contact → Contact Forms and update the shortcode. |
| Booking fires but no calendar event | Graph API permission missing | Confirm `Calendars.ReadWrite` has admin consent in Azure portal. |
| DEMO badge showing despite credentials saved | Tenant ID field is empty or whitespace | Re-enter all three Azure fields and save. |
| 403 error on REST endpoint | Security plugin blocking | Whitelist `/wp-json/sgbk/*` in your security plugin's REST API settings. |

### Salesforce

| Symptom | Fix |
|---|---|
| Leads not appearing | Check API user has "API Enabled" permission. Check SF credentials in plugin settings. WP error log will contain `[sgbk book] SF` entries. |
| `Project_Type__c` error in SF | Create the custom field (Section 8.4). |
| "Invalid grant" SF auth error | Security token may have been reset — re-enter in plugin settings. |

### Pardot

| Symptom | Fix |
|---|---|
| Automation rule not firing | Check that Salesforce–Pardot sync is active. Check that Lead Source value matches exactly (`Web Demo Booking`). |
| Confirmation email not received | Check Pardot → Reports → Emails for sends and bounces. Check spam folder. |
| Email sending from `@pardot.com` domain | Complete the domain verification in Section 9.6. |
| Booked time shows blank in email | Complete the optional Step 9.5 for field sync. |

---

## 12. Field Reference

### Plugin shortcode

```
[sogolytics_booking cf7_id="FORM_ID"]
```

| Attribute | Required | Description |
|---|---|---|
| `cf7_id` | Yes | Post ID of the Contact Form 7 form |

### REST API endpoints (called automatically by the widget JS)

```
GET  /wp-json/sgbk/v1/availability?region=us&date=YYYY-MM-DD&timezone=America%2FNew_York
POST /wp-json/sgbk/v1/book
     { region, slot, firstName, lastName, email, phone, projectType, timezone, country }
```

### CF7 field names (must match exactly)

| Field name in CF7 | Data | Required |
|---|---|---|
| `booking-slot` | ISO 8601 UTC timestamp of selected slot | Auto-filled |
| `booking-region` | `us` or `row` | Auto-filled |
| `booking-timezone` | IANA timezone string | Auto-filled |
| `booking-country` | ISO 3166-1 alpha-2 country code | Auto-filled |
| `first-name` | Visitor first name | Yes |
| `last-name` | Visitor last name | Yes |
| `your-email` | Work email address | Yes |
| `your-phone` | Phone number | Optional |
| `project-type` | Dropdown selection | Yes |

### Salesforce Lead fields written on booking

| SF field | Value |
|---|---|
| `FirstName` | Visitor first name |
| `LastName` | Visitor last name |
| `Email` | Work email |
| `Phone` | Phone (empty string if not provided) |
| `Company` | `Unknown` |
| `LeadSource` | `Web Demo Booking` |
| `Project_Type__c` | Selected project type |
| `Country` | ISO country code from IP detection |

---

*For questions about this setup, contact the Sogolytics development team.*
