/**
 * Static Cloudinary demo assets for evidence photos, inspection signature, and signed discharge scan.
 * C10: Placeholders used until real Cloudinary URLs are provided.
 */

const DEMO_ASSET_URLS = Object.freeze({
  damageFront: {
    url: 'https://res.cloudinary.com/insurflow/image/upload/PLACEHOLDER_damage_front.jpg',
    publicId: 'sawn/demo/evidence/PLACEHOLDER_damage_front',
  },
  damageRear: {
    url: 'https://res.cloudinary.com/insurflow/image/upload/PLACEHOLDER_damage_rear.jpg',
    publicId: 'sawn/demo/evidence/PLACEHOLDER_damage_rear',
  },
  damageSide: {
    url: 'https://res.cloudinary.com/insurflow/image/upload/PLACEHOLDER_damage_side.jpg',
    publicId: 'sawn/demo/evidence/PLACEHOLDER_damage_side',
  },
  damageCloseup1: {
    url: 'https://res.cloudinary.com/insurflow/image/upload/PLACEHOLDER_damage_closeup1.jpg',
    publicId: 'sawn/demo/evidence/PLACEHOLDER_damage_closeup1',
  },
  damageCloseup2: {
    url: 'https://res.cloudinary.com/insurflow/image/upload/PLACEHOLDER_damage_closeup2.jpg',
    publicId: 'sawn/demo/evidence/PLACEHOLDER_damage_closeup2',
  },
  damageCloseup3: {
    url: 'https://res.cloudinary.com/insurflow/image/upload/PLACEHOLDER_damage_closeup3.jpg',
    publicId: 'sawn/demo/evidence/PLACEHOLDER_damage_closeup3',
  },
  signature: {
    url: 'https://res.cloudinary.com/insurflow/image/upload/PLACEHOLDER_signature.png',
    publicId: 'sawn/demo/signatures/PLACEHOLDER_signature',
  },
  dischargeScan: {
    url: 'https://res.cloudinary.com/insurflow/image/upload/PLACEHOLDER_discharge_scan.jpg',
    publicId: 'sawn/demo/discharges/PLACEHOLDER_discharge_scan',
  },
});

const isPlaceholderAsset = (url) => {
  return typeof url !== 'string' || url.includes('PLACEHOLDER') || url.includes('placeholder');
};

const validateDemoAssets = (assetUrls = DEMO_ASSET_URLS) => {
  for (const [key, asset] of Object.entries(assetUrls)) {
    if (!asset || isPlaceholderAsset(asset.url)) {
      throw new Error(`Demo asset "${key}" has a placeholder URL ("${asset?.url}"). Real Cloudinary URL is required.`);
    }
  }
  return true;
};

module.exports = {
  DEMO_ASSET_URLS,
  validateDemoAssets,
  isPlaceholderAsset,
};
