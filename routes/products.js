const express = require('express');
const router = express.Router();
const { pool } = require('../services/db-mysql');
const { requireAdmin } = require('../middleware/adminAuth');
const logger = require('../utils/logger');

const TIER_FIELDS = ['tier_name', 'tier_order', 'setup_fee', 'monthly_price', 'is_active'];

/**
 * Fetches active products with their active tiers nested as
 * `tiers: [...]`, ordered by tier_order. Optionally scoped to one slug.
 */
async function fetchProductsWithTiers(slug) {
  const params = [];
  let where = 'p.is_active = TRUE';
  if (slug) {
    where += ' AND p.product_slug = ?';
    params.push(slug);
  }

  const [rows] = await pool.query(
    `SELECT
       p.product_slug, p.product_name, p.category, p.trial_days, p.is_active AS product_active,
       t.id AS tier_id, t.tier_slug, t.tier_name, t.tier_order, t.setup_fee, t.monthly_price
     FROM bot_products p
     LEFT JOIN bot_product_tiers t ON t.product_slug = p.product_slug AND t.is_active = TRUE
     WHERE ${where}
     ORDER BY p.category, p.product_slug, t.tier_order`,
    params
  );

  const products = new Map();
  for (const row of rows) {
    if (!products.has(row.product_slug)) {
      products.set(row.product_slug, {
        product_slug: row.product_slug,
        product_name: row.product_name,
        category: row.category,
        trial_days: row.trial_days,
        tiers: [],
      });
    }
    if (row.tier_id !== null) {
      products.get(row.product_slug).tiers.push({
        tier_slug: row.tier_slug,
        tier_name: row.tier_name,
        tier_order: row.tier_order,
        setup_fee: Number(row.setup_fee),
        monthly_price: Number(row.monthly_price),
      });
    }
  }
  return Array.from(products.values());
}

/**
 * GET /api/products
 * Public — the website calls this directly to render pricing, no auth.
 * Each product includes its active tiers nested as tiers: [...].
 */
router.get('/', async (req, res) => {
  try {
    const products = await fetchProductsWithTiers();
    res.json({ ok: true, count: products.length, products });
  } catch (err) {
    logger.error('Failed to list products:', err);
    res.status(500).json({ ok: false, error: 'Failed to load products' });
  }
});

/**
 * GET /api/products/:slug
 * Public — single active product with its tiers.
 */
router.get('/:slug', async (req, res) => {
  try {
    const products = await fetchProductsWithTiers(req.params.slug);
    if (!products.length) {
      return res.status(404).json({ ok: false, error: 'Product not found' });
    }
    res.json({ ok: true, product: products[0] });
  } catch (err) {
    logger.error(`Failed to load product ${req.params.slug}:`, err);
    res.status(500).json({ ok: false, error: 'Failed to load product' });
  }
});

/**
 * PUT /api/products/:slug/tiers/:tierSlug
 * Admin-only — updates an existing tier's pricing/fields. Only
 * whitelisted fields are writable; unknown body keys are silently
 * ignored, so partial updates (e.g. just { monthly_price: 649 }) work
 * without resending every field.
 */
router.put('/:slug/tiers/:tierSlug', requireAdmin, async (req, res) => {
  const updates = {};
  for (const field of TIER_FIELDS) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ ok: false, error: `No updatable fields provided. Allowed: ${TIER_FIELDS.join(', ')}` });
  }

  const setClause = Object.keys(updates).map((f) => `${f} = ?`).join(', ');
  const values = [...Object.values(updates), req.params.slug, req.params.tierSlug];

  try {
    const [result] = await pool.execute(
      `UPDATE bot_product_tiers SET ${setClause} WHERE product_slug = ? AND tier_slug = ?`,
      values
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, error: 'Tier not found' });
    }
    const [rows] = await pool.query('SELECT * FROM bot_product_tiers WHERE product_slug = ? AND tier_slug = ?', [
      req.params.slug,
      req.params.tierSlug,
    ]);
    logger.info(`Tier updated: ${req.params.slug}/${req.params.tierSlug} -> ${JSON.stringify(updates)}`);
    res.json({ ok: true, tier: rows[0] });
  } catch (err) {
    logger.error(`Failed to update tier ${req.params.slug}/${req.params.tierSlug}:`, err);
    res.status(500).json({ ok: false, error: 'Failed to update tier' });
  }
});

/**
 * POST /api/products/:slug/tiers
 * Admin-only — adds a new tier to an existing product (e.g. a new plan
 * launched later). Body: { tier_slug, tier_name, tier_order, setup_fee,
 * monthly_price } — tier_slug/tier_name/setup_fee/monthly_price required,
 * tier_order defaults to 1 past the current highest tier for this product.
 */
router.post('/:slug/tiers', requireAdmin, async (req, res) => {
  const { tier_slug, tier_name, setup_fee, monthly_price } = req.body;
  let { tier_order } = req.body;

  if (!tier_slug || !tier_name || setup_fee === undefined || monthly_price === undefined) {
    return res
      .status(400)
      .json({ ok: false, error: 'tier_slug, tier_name, setup_fee and monthly_price are required' });
  }

  try {
    const [products] = await pool.query('SELECT 1 FROM bot_products WHERE product_slug = ?', [req.params.slug]);
    if (!products.length) {
      return res.status(404).json({ ok: false, error: 'Product not found' });
    }

    if (tier_order === undefined) {
      const [[{ maxOrder }]] = await pool.query(
        'SELECT COALESCE(MAX(tier_order), -1) AS maxOrder FROM bot_product_tiers WHERE product_slug = ?',
        [req.params.slug]
      );
      tier_order = maxOrder + 1;
    }

    await pool.execute(
      `INSERT INTO bot_product_tiers (product_slug, tier_slug, tier_name, tier_order, setup_fee, monthly_price)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.params.slug, tier_slug, tier_name, tier_order, setup_fee, monthly_price]
    );

    const [rows] = await pool.query('SELECT * FROM bot_product_tiers WHERE product_slug = ? AND tier_slug = ?', [
      req.params.slug,
      tier_slug,
    ]);
    logger.info(`Tier added: ${req.params.slug}/${tier_slug}`);
    res.status(201).json({ ok: true, tier: rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, error: `Tier '${tier_slug}' already exists for this product` });
    }
    logger.error(`Failed to add tier to ${req.params.slug}:`, err);
    res.status(500).json({ ok: false, error: 'Failed to add tier' });
  }
});

module.exports = router;
