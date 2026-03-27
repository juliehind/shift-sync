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

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateStr, delta) {
  const date = new Date(`${dateStr}T00:00:00`);
  date.setDate(date.getDate() + delta);
  return formatDate(date);
}

function getWeekdayShort(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString('en-AU', { weekday: 'short' });
}

function isDaySpanLine(line) {
  return /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*\/\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/i.test(line.trim());
}

function normalizeDaySpan(line) {
  const match = line.trim().match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*\/\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/i);
  if (!match) return null;
  return {
    firstDay: match[1].slice(0, 1).toUpperCase() + match[1].slice(1, 3).toLowerCase(),
    secondDay: match[2].slice(0, 1).toUpperCase() + match[2].slice(1, 3).toLowerCase()
  };
}

function resolveOvernightStartDate(pageDate, nearbyDaySpan) {
  if (!nearbyDaySpan) {
    return pageDate;
  }

  const normalized = normalizeDaySpan(nearbyDaySpan);
  if (!normalized) {
    return pageDate;
  }

  const pageWeekday = getWeekdayShort(pageDate);

  // If the page weekday matches the SECOND day in "Thu / Fri",
  // the overnight shift likely started the previous day.
  if (normalized.secondDay === pageWeekday) {
    return addDays(pageDate, -1);
  }

  // If the page weekday matches the FIRST day in "Fri / Sat",
  // the overnight shift likely starts on the page date.
  if (normalized.firstDay === pageWeekday) {
    return pageDate;
  }

  return pageDate;
}

function extractNearbyDaySpan(lines, nameIndex) {
  for (let j = nameIndex - 1; j >= 0 && j >= nameIndex - 6; j--) {
    if (isDaySpanLine(lines[j])) {
      return lines[j].trim();
    }
  }

  for (let j = nameIndex + 1; j <= nameIndex + 4 && j < lines.length; j++) {
    if (isDaySpanLine(lines[j])) {
      return lines[j].trim();
    }
  }

  return '';
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
      const nearbyDaySpan = extractNearbyDaySpan(lines, i);

      const timeMatch = shiftLine.match(/\((\d{4})-(\d{4})\)/);

      let team = '';
      for (let j = i - 1; j >= 0 && j >= i - 8; j--) {
        if (/\(\d+\)$/.test(lines[j]) || /Team|Zone|STTA|Medical|Blue|Red|Green|Purple/i.test(lines[j])) {
          team = lines[j];
          break;
        }
      }

      let actualDate = billboardDate;
      let startTime = timeMatch ? timeMatch[1] : '';
      let endTime = timeMatch ? timeMatch[2] : '';

      const isOvernight = startTime && endTime && endTime <= startTime;
      if (isOvernight) {
        actualDate = resolveOvernightStartDate(billboardDate, nearbyDaySpan);
      }

      results.push({
        date: actualDate,
        sourcePageDate: billboardDate,
        nearbyDaySpan,
        name,
        team,
        role,
        shiftLine,
        startTime,
        endTime,
        context: lines.slice(Math.max(0, i - 4), i + 7)
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
    const key = [
      shift.date,
      shift.startTime,
      shift.endTime
    ].join('|');

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function toMinutes(timeStr) {
  const hour = parseInt(timeStr.slice(0, 2), 10);
  const minute = parseInt(timeStr.slice(2, 4), 10);
  return hour * 60 + minute;
}

function getShiftRange(shift) {
  let start = toMinutes(shift.startTime);
  let end = toMinutes(shift.endTime);

  if (end <= start) {
    end += 24 * 60;
  }

  return { start, end };
}

function shiftsOverlap(a, b) {
  const rangeA = getShiftRange(a);
  const rangeB = getShiftRange(b);

  return rangeA.start < rangeB.end && rangeB.start < rangeA.end;
}

function findOverlaps(bashShifts, lizShifts) {
  const overlaps = [];

  for (const bash of bashShifts) {
    for (const liz of lizShifts) {
      if (bash.date === liz.date && shiftsOverlap(bash, liz)) {
        overlaps.push({
          date: bash.date,
          bashShift: bash.shiftLine,
          bashStartTime: bash.startTime,
          bashEndTime: bash.endTime,
          lizShift: liz.shiftLine,
          lizStartTime: liz.startTime,
          lizEndTime: liz.endTime,
          bashTeam: bash.team || '',
          lizTeam: liz.team || ''
        });
      }
    }
  }

  return overlaps;
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

  const bashName = process.env.PARTNER_NAME || 'GARBA, Bashirr';
  const lizName = process.env.LIZ_NAME || 'LEAROYD, Lizzie';

  const timestamps = getFutureDayTimestamps(56);
  const bashAllShifts = [];
  const lizAllShifts = [];

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

        const bashShifts = extractShiftsForPerson(bodyText, bashName, fallbackDate);
        const lizShifts = extractShiftsForPerson(bodyText, lizName, fallbackDate);

        bashAllShifts.push(...bashShifts);
        lizAllShifts.push(...lizShifts);
      } catch (dayError) {
        console.error(`DAY SCRAPE ERROR for ${fallbackDate}:`, dayError.message);
      }
    }

    const bashDeduped = dedupeShifts(bashAllShifts).sort((a, b) => {
      const aKey = `${a.date}${a.startTime}`;
      const bKey = `${b.date}${b.startTime}`;
      return aKey.localeCompare(bKey);
    });

    const lizDeduped = dedupeShifts(lizAllShifts).sort((a, b) => {
      const aKey = `${a.date}${a.startTime}`;
      const bKey = `${b.date}${b.startTime}`;
      return aKey.localeCompare(bKey);
    });

    const overlaps = findOverlaps(bashDeduped, lizDeduped);

    return {
      personName: bashName,
      lizName,
      shifts: bashDeduped,
      lizShifts: lizDeduped,
      overlaps,
      count: bashDeduped.length
    };
  } catch (error) {
    console.error('SCRAPER ERROR:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeShifts };