require('dotenv').config();

console.log('current folder:', process.cwd());
console.log('Has ROSTER_USERNAME:', !!process.env.ROSTER_USERNAME);
console.log('Has ROSTER_PASSWORD:', !!process.env.ROSTER_PASSWORD);
console.log('ROSTER_URL from server startup:', process.env.ROSTER_URL || '(missing)');
console.log('PARTNER_NAME from server startup:', process.env.PARTNER_NAME || '(missing)');

const express = require('express');
const { scrapeShifts } = require('./scraper');
const { shiftsToICS } = require('./icsGenerator');

const app = express();
const PORT = process.env.PORT || 3000;

let cachedICS = null;
let cachedMeta = null;
let lastRefreshAt = 0;
let refreshInProgress = false;

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function refreshCache(force = false) {
  const now = Date.now();

  if (!force && cachedICS && now - lastRefreshAt < CACHE_TTL_MS) {
    return {
      refreshed: false,
      cacheMeta: cachedMeta
    };
  }

  if (refreshInProgress) {
    return {
      refreshed: false,
      cacheMeta: cachedMeta
    };
  }

  refreshInProgress = true;

  try {
    console.log('Refreshing roster cache...');

    const result = await scrapeShifts();
    const shifts = result.shifts || [];
    const ics = shiftsToICS(shifts);

    cachedICS = ics;
    cachedMeta = {
      count: shifts.length,
      personName: result.personName || process.env.PARTNER_NAME || null,
      refreshedAt: new Date().toISOString()
    };
    lastRefreshAt = Date.now();

    console.log('Cache refreshed successfully:', cachedMeta);

    return {
      refreshed: true,
      cacheMeta: cachedMeta
    };
  } catch (error) {
    console.error('CACHE REFRESH ERROR:', error);

    if (!cachedICS) {
      throw error;
    }

    return {
      refreshed: false,
      cacheMeta: cachedMeta,
      warning: error.message
    };
  } finally {
    refreshInProgress = false;
  }
}

app.get('/', (req, res) => {
  res.send(`
    <h1>HRS Shift Sync</h1>
    <p><a href="/health">Health check</a></p>
    <p><a href="/test-scrape">Run scrape test</a></p>
    <p><a href="/refresh">Force refresh cache</a></p>
    <p><a href="/roster.ics">Download ICS feed</a></p>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    hasRosterUsername: !!process.env.ROSTER_USERNAME,
    hasRosterPassword: !!process.env.ROSTER_PASSWORD,
    hasRosterUrl: !!process.env.ROSTER_URL,
    partnerName: process.env.PARTNER_NAME || null,
    cacheReady: !!cachedICS,
    cacheMeta: cachedMeta,
    refreshInProgress
  });
});

app.get('/test-scrape', async (req, res) => {
  try {
    const result = await scrapeShifts();
    res.json({ ok: true, result });
  } catch (error) {
    console.error('TEST SCRAPE ERROR:', error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
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
    await refreshCache(false);

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
      const result = await scrapeShifts();
  
      res.json({
        ok: true,
        bashName: result.personName,
        lizName: result.lizName,
        overlapCount: result.overlaps?.length || 0,
        overlaps: result.overlaps || []
      });
    } catch (error) {
      console.error('LIZ OVERLAPS ERROR:', error);
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
});