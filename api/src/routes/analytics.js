const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/analytics/:shortCode', async (req, res) => {
  const { shortCode } = req.params;

  try {
    // Check if short code exists in urls table
    const urlCheck = await db.query(
      `SELECT short_code, original_url FROM urls WHERE short_code = $1`,
      [shortCode]
    );

    if (urlCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Short URL not found' });
    }

    const analyticsResult = await db.query(
      `SELECT hour, click_count 
       FROM analytics_hourly 
       WHERE short_code = $1 
       ORDER BY hour ASC`,
      [shortCode]
    );

    let totalClicks = 0;
    const history = analyticsResult.rows.map((row) => {
      const clicks = parseInt(row.click_count, 10);
      totalClicks += clicks;
      const formattedHour = new Date(row.hour).toISOString().replace('.000Z', 'Z');
      return {
        hour: formattedHour,
        clicks
      };
    });

    return res.status(200).json({
      total_clicks: totalClicks,
      history
    });
  } catch (err) {
    console.error('Error fetching analytics for shortCode:', shortCode, err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
