// Reverse geocoding for check-in/check-out confirmation messages — a
// human-readable place name is a nice-to-have enrichment, never a
// requirement, so any failure here (network issue, BigDataCloud being
// down, an unexpected response shape) must return null rather than
// throw, same defensive principle as services/email.js's
// never-block-the-core-flow welcome email.

async function getPlaceName(lat, lng) {
  try {
    const response = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`);
    const data = await response.json();
    if (data.city) return `${data.city}, ${data.principalSubdivision || data.countryName}`;
    return null;
  } catch (err) {
    console.error('getPlaceName failed:', err.message);
    return null;
  }
}

module.exports = { getPlaceName };
