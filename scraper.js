const { chromium } = require('playwright');

function parseBillboardDate(text) {
  const match = text.match(/(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/);
  if (!match) return '';

  const raw = match[1];
  const [day, mon, year] = raw.split(' ');

  const months = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12'
  };

  const month = months[mon];
  if (!month) return '';

  return `${year}-${month}-${day.padStart(2, '0')}`;
}

function extractShiftsForPerson(text, personName, fallbackDate) {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const results = [];
  const upperName = personName.toUpperCase();

  const billboardDate = parseBillboardDate(text) || fallbackDate;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toUpperCase() === upperName) {
      const name = lines[i];
      const role = lines[i + 1] || '';
      const shiftLine = lines[i + 2] || '';

      const timeMatch = shiftLine.match(/\((\d{4})-(\d{4})\)/);

      let team = '';
      for (let j = i - 1; j >= 0 && j >= i - 8; j--) {
        if (/\(\d+\)$/.test(lines[j]) || /Team|Zone|STTA|Medical|Blue|Red|Green|Purple/i.test(lines[j])) {
          team = lines[j];
          break;
        }
      }

      results.push({
        date: billboardDate,
        name,
        team,
        role,
        shiftLine,
        startTime: timeMatch ? timeMatch[1] : '',
        endTime: timeMatch ? timeMatch[2] : '',
        context: lines.slice(Math.max(0, i - 3), i + 6)
      });
    }
  }

  return results;
}

function buildBillboardUrl(baseUrl, timestamp) {
  const parts = baseUrl.split('/');
  parts[parts.length - 1] = String(timestamp);
  return parts.join('/');
}

function getFutureDayTimestamps(days = 56) {
  const timestamps = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + i);
    timestamps.push(date.getTime());
  }

  return timestamps;
}

function dedupeShifts(shifts) {
    const seen = new Set();
  
    return shifts.filter((shift) => {
      const normalizedShiftLine = (shift.shiftLine || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
  
      const key = [
        shift.date,
        (shift.name || '').trim().toUpperCase(),
        shift.startTime,
        shift.endTime,
        normalizedShiftLine
      ].join('|');
  
      if (seen.has(key)) {
        return false;
      }
  
      seen.add(key);
      return true;
    });
  }

async function performLogin(page) {
  await page.goto(process.env.ROSTER_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  await page.waitForTimeout(2000);

  const usernameSelectors = [
    'input[name="username"]',
    'input[name="email"]',
    'input[type="email"]',
    'input[type="text"]',
    '#username',
    '#email',
    '#UserName',
    '#Email'
  ];

  const passwordSelectors = [
    'input[name="password"]',
    'input[type="password"]',
    '#password',
    '#Password'
  ];

  let usernameFilled = false;
  for (const selector of usernameSelectors) {
    const el = await page.$(selector);
    if (el) {
      await page.fill(selector, process.env.ROSTER_USERNAME || '');
      usernameFilled = true;
      break;
    }
  }

  let passwordFilled = false;
  for (const selector of passwordSelectors) {
    const el = await page.$(selector);
    if (el) {
      await page.fill(selector, process.env.ROSTER_PASSWORD || '');
      passwordFilled = true;
      break;
    }
  }

  if (!usernameFilled || !passwordFilled) {
    throw new Error('Could not find username or password field');
  }

  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]'
  ];

  let submitted = false;
  for (const selector of submitSelectors) {
    const el = await page.$(selector);
    if (el) {
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => null),
        page.click(selector)
      ]);
      submitted = true;
      break;
    }
  }

  if (!submitted) {
    throw new Error('Could not find login submit button');
  }

  await page.waitForTimeout(4000);
}

async function scrapeShifts() {
  if (!process.env.ROSTER_URL) {
    throw new Error('ROSTER_URL is missing');
  }

  if (!process.env.ROSTER_USERNAME) {
    throw new Error('ROSTER_USERNAME is missing');
  }

  if (!process.env.ROSTER_PASSWORD) {
    throw new Error('ROSTER_PASSWORD is missing');
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  const page = await browser.newPage();
  const personName = process.env.PARTNER_NAME || 'GARBA, Bashirr';
  const timestamps = getFutureDayTimestamps(56);
  const allShifts = [];

  try {
    await performLogin(page);

    for (const timestamp of timestamps) {
      const dayUrl = buildBillboardUrl(process.env.ROSTER_URL, timestamp);
      const fallbackDate = new Date(timestamp).toISOString().slice(0, 10);

      try {
        await page.goto(dayUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });

        await page.waitForTimeout(1500);

        const bodyText = await page.locator('body').innerText().catch(() => '');
        const shifts = extractShiftsForPerson(bodyText, personName, fallbackDate);

        allShifts.push(...shifts);
      } catch (dayError) {
        console.error(`DAY SCRAPE ERROR for ${fallbackDate}:`, dayError.message);
      }
    }

    const deduped = dedupeShifts(allShifts).sort((a, b) => {
      const aKey = `${a.date}${a.startTime}`;
      const bKey = `${b.date}${b.startTime}`;
      return aKey.localeCompare(bKey);
    });

    return {
      personName,
      shifts: deduped,
      count: deduped.length
    };
  } catch (error) {
    console.error('SCRAPER ERROR:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeShifts };