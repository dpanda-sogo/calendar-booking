const fetch = require('node-fetch');
const { DateTime } = require('luxon');

const CAL_TIMEZONES = {
  us: 'America/New_York',
  row: 'Asia/Kolkata',
};

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
    console.error('[availability] getGraphToken failed', res.status, text);
    throw Object.assign(new Error('auth_failed'), { status: res.status });
  }
  const data = await res.json();
  return data.access_token;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { region = 'row', date, timezone = 'UTC' } = req.query;

  if (!date) {
    return res.status(400).json({ error: 'missing_date' });
  }

  const calEmail =
    region === 'us' ? process.env.CAL_US : process.env.CAL_ROW;
  const calTz = CAL_TIMEZONES[region] || CAL_TIMEZONES.row;

  let token;
  try {
    token = await getGraphToken();
  } catch (err) {
    return res.status(500).json({ error: 'auth_failed' });
  }

  let scheduleData;
  try {
    const body = {
      schedules: [calEmail],
      startTime: { dateTime: `${date}T00:00:00`, timeZone: 'UTC' },
      endTime: { dateTime: `${date}T23:59:59`, timeZone: 'UTC' },
      availabilityViewInterval: 30,
    };
    const graphRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(calEmail)}/calendar/getSchedule`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!graphRes.ok) {
      const text = await graphRes.text();
      console.error('[availability] getSchedule failed', graphRes.status, text);
      return res.status(500).json({ error: 'calendar_unavailable' });
    }
    scheduleData = await graphRes.json();
  } catch (err) {
    console.error('[availability] getSchedule error', err.message);
    return res.status(500).json({ error: 'calendar_unavailable' });
  }

  const scheduleItem = scheduleData.value && scheduleData.value[0];
  const availabilityView = scheduleItem ? scheduleItem.availabilityView : '';

  const slots = [];

  for (let i = 0; i < availabilityView.length; i++) {
    if (availabilityView[i] !== '0') continue;

    const slotUtc = DateTime.fromISO(`${date}T00:00:00`, { zone: 'UTC' }).plus({
      minutes: i * 30,
    });

    // Check weekday (ISO weekday: 1=Mon … 7=Sun)
    if (slotUtc.weekday >= 6) continue;

    // Check working hours in calendar owner's timezone
    const slotCal = slotUtc.setZone(calTz);
    const hour = slotCal.hour;
    const minute = slotCal.minute;
    const totalMinutes = hour * 60 + minute;
    // 9:00 AM = 540 min, 5:00 PM = 1020 min (slot must start before 17:00)
    if (totalMinutes < 540 || totalMinutes >= 1020) continue;

    // Convert to user's timezone for display
    const slotUser = slotUtc.setZone(timezone);
    const display =
      slotUser.toFormat("cccc, LLLL d · h:mm a");

    slots.push({
      iso: slotUtc.toISO(),
      display,
    });
  }

  return res.status(200).json({
    slots,
    timezone,
    calRegion: region,
  });
};
