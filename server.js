require('dotenv').config();

console.log('current folder:', process.cwd());
console.log('Has ROSTER_USERNAME:', !!process.env.ROSTER_USERNAME);
console.log('Has ROSTER_PASSWORD:', !!process.env.ROSTER_PASSWORD);
console.log('ROSTER_URL from server startup:', process.env.ROSTER_URL || '(missing)');
console.log('PARTNER_NAME from server startup:', process.env.PARTNER_NAME || '(missing)');
console.log('LIZ_NAME from server startup:', process.env.LIZ_NAME || '(missing)');

const express = require('express');
const { scrapeShifts } = require('./scraper');
const { shiftsToICS } = require('./icsGenerator');

const app = express();
const PORT = process.env.PORT || 3000;

let cachedICS = null;
let cachedScrapeResult = null;
let cachedMeta = null;
let lastRefreshAt = 0;
let refreshPromise = null;

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function runRefresh() {
  console.log('Refreshing roster cache...');

  const result = await scrapeShifts();
  const shifts = result.shifts || [];
  const ics = shiftsToICS(shifts);

  cachedScrapeResult = result;
  cachedICS = ics;
  cachedMeta = {
    count: shifts.length,
    lizShiftCount: result.lizShifts?.length || 0,
    overlapCount: result.overlaps?.length || 0,
    personName: result.personName || process.env.PARTNER_NAME || null,
    lizName: result.lizName || process.env.LIZ_NAME || null,
    refreshedAt: new Date().toISOString()
  };
  lastRefreshAt = Date.now();

  console.log('Cache refreshed successfully:', cachedMeta);

  return {
    refreshed: true,
    cacheMeta: cachedMeta
  };
}

async function refreshCache(force = false) {
  const now = Date.now();

  if (!force && cachedICS && cachedScrapeResult && now - lastRefreshAt < CACHE_TTL_MS) {
    return {
      refreshed: false,
      cacheMeta: cachedMeta,
      reason: 'cache-still-fresh'
    };
  }

  if (refreshPromise) {
    console.log('Refresh already in progress, waiting for existing refresh...');
    await refreshPromise;
    return {
      refreshed: false,
      cacheMeta: cachedMeta,
      reason: 'used-existing-refresh'
    };
  }

  refreshPromise = runRefresh();

  try {
    return await refreshPromise;
  } catch (error) {
    console.error('CACHE REFRESH ERROR:', error);

    if (!cachedICS || !cachedScrapeResult) {
      throw error;
    }

    return {
      refreshed: false,
      cacheMeta: cachedMeta,
      warning: error.message,
      reason: 'refresh-failed-using-existing-cache'
    };
  } finally {
    refreshPromise = null;
  }
}

app.get('/', (req, res) => {
  res.send(`
    <h1>HRS Shift Sync</h1>
    <p><a href="/health">Health check</a></p>
    <p><a href="/refresh">Force refresh cache</a></p>
    <p><a href="/roster.ics">Download ICS feed</a></p>
    <p><a href="/liz-overlaps">Liz overlap JSON</a></p>
    <p><a href="/liz-debug">Liz debug JSON</a></p>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    hasRosterUsername: !!process.env.ROSTER_USERNAME,
    hasRosterPassword: !!process.env.ROSTER_PASSWORD,
    hasRosterUrl: !!process.env.ROSTER_URL,
    partnerName: process.env.PARTNER_NAME || null,
    lizName: process.env.LIZ_NAME || null,
    cacheReady: !!cachedICS,
    hasCachedScrapeResult: !!cachedScrapeResult,
    cacheMeta: cachedMeta,
    refreshInProgress: !!refreshPromise
  });
});

app.get('/refresh', async (req, res) => {
  try {
    const result = await refreshCache(true);
    res.json({
      ok: true,
      message: 'Cache refresh attempted',
      ...result
    });
  } catch (error) {
    console.error('REFRESH ERROR:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.get('/roster.ics', async (req, res) => {
  try {
    if (!cachedICS) {
      await refreshCache(true);
    } else {
      await refreshCache(false);
    }

    if (!cachedICS) {
      throw new Error('ICS cache is empty');
    }

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="roster.ics"');
    res.send(cachedICS);
  } catch (error) {
    console.error('ICS ERROR:', error);
    res.status(500).send(`Failed to generate ICS. Error: ${error.message}`);
  }
});

app.get('/liz-overlaps', async (req, res) => {
  try {
    if (!cachedScrapeResult) {
      await refreshCache(true);
    } else {
      await refreshCache(false);
    }

    if (!cachedScrapeResult) {
      throw new Error('Cached scrape result is empty');
    }

    res.json({
      ok: true,
      bashName: cachedScrapeResult.personName,
      lizName: cachedScrapeResult.lizName,
      overlapCount: cachedScrapeResult.overlaps?.length || 0,
      overlaps: cachedScrapeResult.overlaps || []
    });
  } catch (error) {
    console.error('LIZ OVERLAPS ERROR:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.get('/liz-debug', async (req, res) => {
  try {
    if (!cachedScrapeResult) {
      await refreshCache(true);
    } else {
      await refreshCache(false);
    }

    if (!cachedScrapeResult) {
      throw new Error('Cached scrape result is empty');
    }

    res.json({
      ok: true,
      lizName: cachedScrapeResult.lizName,
      lizShiftCount: cachedScrapeResult.lizShifts?.length || 0,
      lizShifts: cachedScrapeResult.lizShifts || []
    });
  } catch (error) {
    console.error('LIZ DEBUG ERROR:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Server running on port ${PORT}`);

  try {
    await refreshCache(true);
  } catch (error) {
    console.error('Initial cache warm failed:', error.message);
  }

  setInterval(async () => {
    try {
      await refreshCache(true);
    } catch (error) {
      console.error('Scheduled cache refresh failed:', error.message);
    }
  }, CACHE_TTL_MS);
});