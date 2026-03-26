const dotenvResult = require('dotenv').config();
console.log('dotenv result:', dotenvResult);
console.log('current folder:', process.cwd());
console.log('ROSTER_URL from server startup:', process.env.ROSTER_URL);

const express = require('express');
const { scrapeShifts } = require('./scraper');
const { shiftsToICS } = require('./icsGenerator');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send(`
    <h1>HRS Shift Sync</h1>
    <p><a href="/health">Health check</a></p>
    <p><a href="/test-scrape">Run scrape test</a></p>
    <p><a href="/roster.ics">Download ICS feed</a></p>
  `);
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/test-scrape', async (req, res) => {
  try {
    const result = await scrapeShifts();
    res.json({ ok: true, result });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get('/roster.ics', async (req, res) => {
  try {
    const result = await scrapeShifts();
    const ics = shiftsToICS(result.shifts || []);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="roster.ics"');
    res.send(ics);
  } catch (error) {
    console.error(error);
    res.status(500).send(`Failed to generate ICS: ${error.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});