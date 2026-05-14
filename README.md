# Sogolytics Demo Booking App

## 1. Overview

A single-page demo-booking web app that lets visitors pick a 30-minute Teams call with the Sogolytics team. Visitors are silently routed to either the US (`us-demos@`) or Rest-of-World (`row-demos@`) calendar based on their IP address. Availability is read from Microsoft Outlook via the Graph API; booked appointments appear as calendar events with a Teams link attached. Every booking also creates a Lead record in Salesforce.

**Stack:**
- Frontend: plain `index.html` + vanilla JS — no build step, no framework
- Backend: two Vercel serverless functions (`/api/availability.js`, `/api/book.js`)
- Calendar: Microsoft Graph API (Outlook / Exchange Online)
- CRM: Salesforce REST API (username-password OAuth2 flow)
- IP detection: https://ipapi.co/json/ (no key required)
- Timezone conversion: [Luxon](https://moment.github.io/luxon/)

---

## 2. Azure AD App Registration

1. Go to [portal.azure.com](https://portal.azure.com) → **Azure Active Directory** → **App registrations**
2. Click **New registration**
   - Name: `Sogolytics Demo Booking`
   - Supported account types: *Accounts in this organizational directory only*
   - Redirect URI: leave blank
3. After creation, note the **Application (client) ID** and **Directory (tenant) ID** — these become `AZURE_CLIENT_ID` and `AZURE_TENANT_ID`.
4. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions**, then add:
   - `Calendars.Read`
   - `Calendars.ReadWrite`
   - `User.Read.All`
5. Click **Grant admin consent for [your org]** and confirm.
6. Go to **Certificates & secrets** → **New client secret**
   - Description: `demo-booking`
   - Expiry: choose an appropriate period
   - Copy the **Value** immediately (it will be hidden after you leave) — this becomes `AZURE_CLIENT_SECRET`.

---

## 3. Salesforce Connected App Setup

1. In Salesforce Setup, search for **App Manager** → **New Connected App**.
2. Fill in:
   - Connected App Name: `Demo Booking`
   - Contact Email: your admin email
   - Enable OAuth Settings: ✓
   - Callback URL: `https://login.salesforce.com/services/oauth2/success` (placeholder)
   - Selected OAuth Scopes: *Access and manage your data (api)*, *Perform requests on your behalf at any time (refresh_token, offline_access)*
3. Save, then wait a few minutes for the app to propagate.
4. Copy the **Consumer Key** → `SF_CLIENT_ID` and **Consumer Secret** → `SF_CLIENT_SECRET`.
5. Ensure the running user (`SF_USERNAME`) has the **API Enabled** permission and note their **Security Token** (reset via *Settings → My Personal Information → Reset My Security Token* if needed).
6. The `Project_Type__c` custom field must exist on the Lead object. Create it as a Text field if it doesn't.

---

## 4. Populate .env

Copy `.env.example` to `.env` and fill in every value:

```
AZURE_TENANT_ID=       # Directory (tenant) ID from Azure AD
AZURE_CLIENT_ID=       # Application (client) ID from Azure AD
AZURE_CLIENT_SECRET=   # Client secret value from Azure AD
CAL_US=us-demos@sogolytics.com
CAL_ROW=row-demos@sogolytics.com
SF_LOGIN_URL=https://login.salesforce.com
SF_CLIENT_ID=          # Salesforce Consumer Key
SF_CLIENT_SECRET=      # Salesforce Consumer Secret
SF_USERNAME=           # Salesforce API user email
SF_PASSWORD=           # Salesforce API user password
SF_SECURITY_TOKEN=     # Salesforce security token (appended to password)
```

> **Never commit `.env`** — it is listed in `.gitignore`.

When deploying to Vercel, add the same variables via **Project Settings → Environment Variables** in the Vercel dashboard.

---

## 5. Local Development

Install dependencies and start the local dev server:

```bash
npm install
npx vercel dev
```

The app will be available at `http://localhost:3000`. Vercel Dev reads `.env` automatically.

---

## 6. Deployment

```bash
npx vercel --prod
```

Make sure all environment variables are configured in the Vercel dashboard before deploying. The `vercel.json` file handles CORS headers and function runtime configuration automatically.

---

## 7. Changing the US / RoW Country List

The routing logic lives in `index.html` inside the `<script>` block. Look for this condition (near the end of the file, inside the `fetch('https://ipapi.co/json/')` handler):

```js
if (_country === 'US' || _country === 'CA') {
  _region = 'us';
} else {
  _region = 'row';
}
```

Add or remove ISO 3166-1 alpha-2 country codes to the `'us'` bucket as needed. All countries not listed default to `'row'`.

---

## 8. Adding More Calendar Regions in the Future

The current implementation supports two buckets (`us` / `row`). To add a third region (e.g. `emea`):

1. Add a new env var: `CAL_EMEA=emea-demos@sogolytics.com`
2. In `api/availability.js` and `api/book.js`, extend the `calEmail` selection:
   ```js
   const calEmail =
     region === 'us'   ? process.env.CAL_US   :
     region === 'emea' ? process.env.CAL_EMEA :
     process.env.CAL_ROW;
   ```
3. Add the calendar owner timezone in `api/availability.js`:
   ```js
   const CAL_TIMEZONES = {
     us:   'America/New_York',
     row:  'Asia/Kolkata',
     emea: 'Europe/London',
   };
   ```
4. Update the IP routing logic in `index.html` to set `_region = 'emea'` for the relevant country codes.
