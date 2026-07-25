const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const logger = require('../utils/logger');
const { getQrToken } = require('../services/qrTokens');

/**
 * GET /qr/:token.png
 * Public, no api-key/tenant resolution — same reasoning as /webhook:
 * this is the URL WhatsApp's own servers fetch to download the image,
 * which can't carry an x-api-key header. The token itself (minted by
 * services/qrTokens.js's createQrToken) is the only thing gating what
 * gets served; an unknown or expired one is a 404, not a 401/403, since
 * there's no caller identity to reject here in the first place.
 */
router.get('/:token.png', async (req, res) => {
  const text = getQrToken(req.params.token);
  if (!text) {
    return res.status(404).send('QR code not found or expired');
  }

  try {
    const buffer = await QRCode.toBuffer(text, { type: 'png', width: 400 });
    res.set('Content-Type', 'image/png');
    return res.send(buffer);
  } catch (err) {
    logger.error('QR code generation failed:', err);
    return res.status(500).send('Could not generate QR code');
  }
});

module.exports = router;
