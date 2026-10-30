/**
 * Static Cloudinary demo assets for evidence photos, inspection signature, and signed discharge scan.
 * C10: Placeholders used until real Cloudinary URLs are provided.
 */

const DEMO_ASSET_URLS = Object.freeze({
  damageFront: {
    url: 'https://res.cloudinary.com/yr5hpegk/image/upload/v1793348868/sawn/demo/b7ztusxuqohladv7laun.jpg',
    publicId: 'sawn/demo/b7ztusxuqohladv7laun',
  },
  damageRear: {
    url: 'https://res.cloudinary.com/yr5hpegk/image/upload/v1793348876/sawn/demo/edlqqzq4npqqzx16c3oq.jpg',
    publicId: 'sawn/demo/edlqqzq4npqqzx16c3oq',
  },
  damageSide: {
    url: 'https://res.cloudinary.com/yr5hpegk/image/upload/v1793348885/sawn/demo/elpsvbmlfctwbednhdgu.jpg',
    publicId: 'sawn/demo/elpsvbmlfctwbednhdgu',
  },
  damageCloseup1: {
    url: 'https://res.cloudinary.com/yr5hpegk/image/upload/v1793348895/sawn/demo/quxap6oroxhhcx3ltm9g.jpg',
    publicId: 'sawn/demo/quxap6oroxhhcx3ltm9g',
  },
  damageCloseup2: {
    url: 'https://res.cloudinary.com/yr5hpegk/image/upload/v1793348898/sawn/demo/zjsvu0rj0a8m9l0b918k.jpg',
    publicId: 'sawn/demo/zjsvu0rj0a8m9l0b918k',
  },
  damageCloseup3: {
    url: 'https://res.cloudinary.com/yr5hpegk/image/upload/v1793348903/sawn/demo/mqcjvhghgxgxm84zmhbj.jpg',
    publicId: 'sawn/demo/mqcjvhghgxgxm84zmhbj',
  },
  signature: {
    url: 'https://res.cloudinary.com/yr5hpegk/image/upload/v1793348904/sawn/demo/v0ykfuxez78ddsal1ky4.png',
    publicId: 'sawn/demo/v0ykfuxez78ddsal1ky4',
  },
  dischargeScan: {
    url: 'https://res.cloudinary.com/yr5hpegk/image/upload/v1793348909/sawn/demo/in3gcssbhhw2awmvxwtr.jpg',
    publicId: 'sawn/demo/in3gcssbhhw2awmvxwtr',
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
