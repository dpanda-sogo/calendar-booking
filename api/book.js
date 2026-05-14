const fetch = require('node-fetch');
const { DateTime } = require('luxon');

// Demo mode: active when Azure credentials are not configured
function isDemoMode() {
  const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = process.env;
  return !AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET;
}

async function getGraphToken() {
  const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = process.env;
  const url = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: AZURE_CLIENT_ID,
    client_secret: AZURE_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
  });
  const res = await fetch(url, { method: 'POST', body: params });
  if (!res.ok) {
    const text = await res.text();
    console.error('[book] getGraphToken failed', res.status, text);
    throw Object.assign(new Error('auth_failed'), { status: res.status });
  }
  const data = await res.json();
  return data.access_token;
}

async function createSalesforceLead(lead) {
  const { SF_LOGIN_URL, SF_CLIENT_ID, SF_CLIENT_SECRET, SF_USERNAME, SF_PASSWORD, SF_SECURITY_TOKEN } =
    process.env;
  try {
    const tokenParams = new URLSearchParams({
      grant_type: 'password',
      client_id: SF_CLIENT_ID,
      client_secret: SF_CLIENT_SECRET,
      username: SF_USERNAME,
      password: SF_PASSWORD + SF_SECURITY_TOKEN,
    });
    const authRes = await fetch(`${SF_LOGIN_URL}/services/oauth2/token`, {
      method: 'POST',
      body: tokenParams,
    });
    if (!authRes.ok) {
      const text = await authRes.text();
      console.error('[book] SF auth failed', authRes.status, text);
      return;
    }
    const authData = await authRes.json();
    const { access_token, instance_url } = authData;

    const leadRes = await fetch(
      `${instance_url}/services/data/v58.0/sobjects/Lead/`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          FirstName: lead.firstName,
          LastName: lead.lastName,
          Email: lead.email,
          Phone: lead.phone || '',
          Company: 'Unknown',
          LeadSource: 'Web Demo Booking',
          Project_Type__c: lead.projectType,
          Country: lead.country || '',
        }),
      }
    );
    if (!leadRes.ok) {
      const text = await leadRes.text();
      console.error('[book] SF lead creation failed', leadRes.status, text);
    }
  } catch (err) {
    console.error('[book] SF createLead error', err.message);
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const {
    region = 'row',
    slot,
    firstName,
    lastName,
    email,
    phone,
    projectType,
    timezone = 'UTC',
    country = '',
  } = req.body || {};

  if (!slot || !firstName || !lastName || !email || !projectType) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  // ── Demo mode ────────────────────────────────────────────────────────────
  if (isDemoMode()) {
    console.log('[book] demo mode — simulating booking for', email, 'at', slot);
    // Simulate a short processing delay
    await new Promise(function (r) { setTimeout(r, 800); });
    return res.status(200).json({
      success: true,
      meetingLink: null,
      eventId: 'demo-' + Date.now(),
      bookedSlot: slot,
      demo: true,
    });
  }

  // ── Live mode ────────────────────────────────────────────────────────────
  const calEmail = region === 'us' ? process.env.CAL_US : process.env.CAL_ROW;

  let token;
  try {
    token = await getGraphToken();
  } catch (err) {
    return res.status(500).json({ error: 'auth_failed' });
  }

  const startDt = DateTime.fromISO(slot, { zone: 'UTC' });
  const endDt = startDt.plus({ minutes: 30 });

  const eventBody = {
    subject: `Sogolytics Demo — ${firstName} ${lastName}`,
    start: { dateTime: startDt.toISO(), timeZone: 'UTC' },
    end: { dateTime: endDt.toISO(), timeZone: 'UTC' },
    attendees: [
      {
        emailAddress: { address: email, name: `${firstName} ${lastName}` },
        type: 'required',
      },
    ],
    body: {
      contentType: 'HTML',
      content: `Demo booked via sogolytics.com<br><br>
<b>Name:</b> ${firstName} ${lastName}<br>
<b>Email:</b> ${email}<br>
<b>Phone:</b> ${phone || 'N/A'}<br>
<b>Project type:</b> ${projectType}<br>
<b>Country:</b> ${country}<br>
<b>Region bucket:</b> ${region}`,
    },
    isOnlineMeeting: true,
    onlineMeetingProvider: 'teamsForBusiness',
    reminderMinutesBeforeStart: 15,
  };

  let eventData;
  try {
    const eventRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(calEmail)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventBody),
      }
    );
    if (!eventRes.ok) {
      const text = await eventRes.text();
      console.error('[book] event creation failed', eventRes.status, text);
      if (eventRes.status === 409 || text.toLowerCase().includes('conflict')) {
        return res.status(500).json({
          error: 'slot_taken',
          message: 'This slot was just taken. Please pick another time.',
        });
      }
      return res.status(500).json({ error: 'booking_failed', detail: text });
    }
    eventData = await eventRes.json();
  } catch (err) {
    console.error('[book] event creation error', err.message);
    return res.status(500).json({ error: 'booking_failed', detail: err.message });
  }

  createSalesforceLead({ firstName, lastName, email, phone, projectType, country });

  const meetingLink =
    eventData.onlineMeeting && eventData.onlineMeeting.joinUrl
      ? eventData.onlineMeeting.joinUrl
      : null;

  return res.status(200).json({
    success: true,
    meetingLink: meetingLink || null,
    eventId: eventData.id,
    bookedSlot: slot,
  });
};
