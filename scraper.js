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

function extractShiftsForPerson(text, personName, billboardDate) {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const results = [];
  const upperName = personName.toUpperCase();

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

async function scrapeShifts() {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 300,
  });

  const page = await browser.newPage();

  try {
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
        await page.fill(selector, process.env.ROSTER_USERNAME);
        usernameFilled = true;
        break;
      }
    }

    let passwordFilled = false;
    for (const selector of passwordSelectors) {
      const el = await page.$(selector);
      if (el) {
        await page.fill(selector, process.env.ROSTER_PASSWORD);
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

    await page.waitForTimeout(5000);

    const title = await page.title();
    const url = page.url();
    const bodyText = await page.locator('body').innerText().catch(() => '');

    const personName = process.env.PARTNER_NAME || 'GARBA, Bashirr';
    const billboardDate = parseBillboardDate(bodyText);
    const shifts = extractShiftsForPerson(bodyText, personName, billboardDate);

    return {
      title,
      url,
      personName,
      billboardDate,
      shifts,
      previewText: bodyText.slice(0, 1500)
    };
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeShifts };