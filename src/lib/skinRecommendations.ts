import { Recommendation, SkinAnalysisRecord, SkincareRoutine, SkincareRoutineItem } from '../types';

export interface NaturalWellnessProtocol {
  hydrationTarget: string;
  dietAdvice: string;
  sleepHygiene: string;
  stressManagement: string;
  skinCareHabit: string;
}

export const CATALOG_PRODUCTS: Record<string, Recommendation> = {
  minimalist_salicylic_acid: {
    id: 'minimalist_salicylic_acid',
    name: 'Minimalist 2% Salicylic Acid Face Serum (30ml)',
    brand: 'Minimalist',
    description: 'Dermatologically tested BHA serum that deeply penetrates pores to clear active acne, blackheads, and excess sebum.',
    image: '/product-images/minimalist-salicylic-acid.jpg',
    targetIssue: 'Acne & Sebum Control',
    price: '₹549',
    activeIngredients: ['2% Salicylic Acid', 'LHA', 'Aloe Vera Juice'],
    productUrl: 'https://beminimalist.co/products/salicylic-acid-2',
    whyRecommended: 'Targeted BHA formula to reduce active acne severity and unclog congested pores safely.',
    usageInstructions: 'Apply 2-3 drops to clean face every evening before moisturizing.'
  },
  minimalist_niacinamide: {
    id: 'minimalist_niacinamide',
    name: 'Minimalist 10% Niacinamide Face Serum with Matmarine + Zinc (30ml)',
    brand: 'Minimalist',
    description: 'Nourishing serum that reduces dark spots, balances oiliness, and strengthens the natural dermal moisture barrier.',
    image: '/product-images/minimalist-niacinamide.jpg',
    targetIssue: 'Oiliness & Blemish Reduction',
    price: '₹599',
    activeIngredients: ['10% Niacinamide', '1% Zinc PCA', 'Aloe Vera'],
    productUrl: 'https://www.nykaa.com/minimalist-10percent-niacinamide-face-serum-with-matmarine-zinc-for-reducing-oil-blemishes/p/15022069',
    whyRecommended: 'Selected to balance excess sebum and fade post-acne blemishes gently.',
    usageInstructions: 'Massage 2-3 drops gently into face morning and night.'
  },
  dot_key_cica_gel: {
    id: 'dot_key_cica_gel',
    name: 'Dot & Key Cica Calming Night Gel (Niacinamide + Green Tea) (60ml)',
    brand: 'Dot & Key',
    description: 'Ultra-lightweight oil-free night gel with Cica and Tea Tree to soothe active breakouts and hydrate without clogging pores.',
    image: '/product-images/dot-key-cica-night-gel.jpg',
    targetIssue: 'Acne Relief & Light Hydration',
    price: '₹396',
    activeIngredients: ['Cica (Centella)', 'Niacinamide', 'Tea Tree Oil'],
    productUrl: 'https://www.dotandkey.com/products/cica-calming-skin-renewing-night-gel',
    whyRecommended: 'Calms skin irritation while providing non-greasy nocturnal hydration.',
    usageInstructions: 'Apply a small amount evenly across face as final night routine step.'
  },
  cetaphil_gentle_cleanser: {
    id: 'cetaphil_gentle_cleanser',
    name: 'Cetaphil Gentle Skin Cleanser for Dry/Sensitive Skin (125ml)',
    brand: 'Cetaphil',
    description: 'Dermatologist recommended non-foaming hydrating cleanser for sensitive, normal, and dry skin types.',
    image: '/product-images/cetaphil-gentle-cleanser.png',
    targetIssue: 'Gentle Cleansing & Moisture Lock',
    price: '₹365',
    activeIngredients: ['Niacinamide', 'Panthenol (Vitamin B5)', 'Glycerin'],
    productUrl: 'https://www.nykaa.com/cetaphil-cleansing-lotion/p/22032',
    whyRecommended: 'Cleanses thoroughly without stripping essential natural lipids.',
    usageInstructions: 'Apply generously to face, massage gently, and rinse with lukewarm water.'
  },
  dot_key_ceramide_moisturizer: {
    id: 'dot_key_ceramide_moisturizer',
    name: 'Dot & Key Ceramides & Hyaluronic Barrier Repair Moisturizer (100g)',
    brand: 'Dot & Key',
    description: 'Rich barrier repair cream packed with 5 essential ceramides and hyaluronic acid for deep moisture relief.',
    image: '/product-images/dot-key-ceramide-moisturizer.jpg',
    targetIssue: 'Dryness & Barrier Restoration',
    price: '₹352',
    activeIngredients: ['5 Essential Ceramides', 'Probiotic Rice Water', 'Hyaluronic Acid'],
    productUrl: 'https://www.dotandkey.com/products/dot-key-ceramides-hyaluronic-hydrating-face-cream-i-repairs-skin-barrier-intense-moisturization-sensitive-dry-skin-fragrance-free',
    whyRecommended: 'Restores skin barrier integrity when dry skin or hydration deficit is detected.',
    usageInstructions: 'Smooth over face and neck morning and night.'
  },
  requil_dry_touch_sunscreen: {
    id: 'requil_dry_touch_sunscreen',
    name: "Re'equil Ultra Matte Dry Touch Sunscreen Gel SPF 50 (50g)",
    brand: "Re'equil",
    description: 'Dermatologically tested mineral sunscreen offering broad spectrum PA++++ UVA/UVB defense with a comfortable matte finish.',
    image: '/product-images/reequil-dry-touch-sunscreen.webp',
    targetIssue: 'UV Defense & Photo-Aging Protection',
    price: '₹613',
    activeIngredients: ['Zinc Oxide', 'Titanium Dioxide', 'Tocopheryl Acetate'],
    productUrl: 'https://www.reequil.com/products/ultra-matte-dry-touch-sunscreen-gel-spf-50-pa',
    whyRecommended: 'Provides essential broad-spectrum sun defense against UV damage and premature photo-aging.',
    usageInstructions: 'Apply 15 minutes before sun exposure as final morning step.'
  },
  foxtale_retinol_night_serum: {
    id: 'foxtale_retinol_night_serum',
    name: 'Foxtale 0.15% Encapsulated Retinol Night Serum (30ml)',
    brand: 'Foxtale',
    description: 'Gentle anti-aging serum boosting collagen production, refining skin texture, and reducing fine lines and wrinkles.',
    image: '/product-images/foxtale-retinol-night-serum.jpg',
    targetIssue: 'Texture & Wrinkle Reduction',
    price: '₹599',
    activeIngredients: ['0.15% Encapsulated Retinol', 'Allantoin', 'Betaine'],
    productUrl: 'https://foxtale.in/products/retinol-anti-ageing-night-serum',
    whyRecommended: 'Accelerates cellular turnover to smooth texture irregularities and refine fine lines.',
    usageInstructions: 'Apply 2-3 drops at night twice weekly, gradually increasing frequency.'
  },
  plum_green_tea_toner: {
    id: 'plum_green_tea_toner',
    name: 'Plum Green Tea Alcohol-Free Pore Tightening Face Toner (200ml)',
    brand: 'Plum',
    description: 'Refreshingly light green tea toner with glycolic acid that tightens open pores and prevents breakouts.',
    image: '/product-images/plum-green-tea-toner.jpg',
    targetIssue: 'Pore Tightening & Balancing',
    price: '₹336',
    activeIngredients: ['Green Tea Extracts', 'Glycolic Acid'],
    productUrl: 'https://plumgoodness.com/products/green-tea-alcohol-free-pore-tightening-face-toner-for-oily-acne-prone-skin-1',
    whyRecommended: 'Helps balance pore clarity and oiliness while refreshing skin naturally.',
    usageInstructions: 'Dab gently onto clean face using fingertips or cotton pad.'
  },
  derma_co_vitamin_c: {
    id: 'derma_co_vitamin_c',
    name: 'The Derma Co 10% Vitamin C Face Serum with Niacinamide (30ml)',
    brand: 'The Derma Co',
    description: 'Potent antioxidant serum targeting dark spots, dullness, and early photo-aging for radiant skin.',
    image: '/product-images/derma-co-vitamin-c.jpg',
    targetIssue: 'Pigmentation & Radiance Boost',
    price: '₹649',
    activeIngredients: ['10% Vitamin C', '5% Niacinamide', 'Hyaluronic Acid'],
    productUrl: 'https://thedermaco.com/products/10-vitamin-c-face-serum-with-niacinamide-hyaluronic-acid-for-skin-radiance-50ml',
    whyRecommended: 'Fades pigmentation and shields skin against oxidative environmental stress.',
    usageInstructions: 'Apply 3-4 drops in the morning before moisturizer and sunscreen.'
  },
  minimalist_alpha_arbutin: {
    id: 'minimalist_alpha_arbutin',
    name: 'Minimalist 2% Alpha Arbutin Serum for Dark Spots & Pigmentation (30ml)',
    brand: 'Minimalist',
    description: 'Advanced hyper-pigmentation serum with Hyaluronic Acid to even skin tone and reduce melanin spots.',
    image: '/product-images/minimalist-alpha-arbutin.jpg',
    targetIssue: 'Dark Spots & Pigmentation Repair',
    price: '₹549',
    activeIngredients: ['2% Alpha Arbutin', '1% Hyaluronic Acid', 'Aloe Vera'],
    productUrl: 'https://beminimalist.co/products/alpha-arbutin-2',
    whyRecommended: 'Targets uneven pigmentation and post-acne blemishes gently and effectively.',
    usageInstructions: 'Apply 2-3 drops morning and evening to cleansed face.'
  },
  bioderma_atoderm_baume: {
    id: 'bioderma_atoderm_baume',
    name: 'Minimalist 0.3% Ceramides + Madecassoside Barrier Cream (50g)',
    brand: 'Minimalist',
    description: 'Dermatological intensive soothing balm that repairs dry, sensitive, or compromised moisture barriers.',
    image: '/product-images/bioderma-atoderm-baume.jpg',
    targetIssue: 'Intensive Sensitivity & Dryness Relief',
    price: '₹599',
    activeIngredients: ['0.3% Ceramides', 'Madecassoside', 'Centella Asiatica'],
    productUrl: 'https://beminimalist.co/products/ceramides-0-3-madecassoside',
    whyRecommended: 'Deeply calms dryness, sensitivity, and barrier disruption.',
    usageInstructions: 'Apply once or twice daily to cleansed skin.'
  },
  derma_co_salicylic_cleanser: {
    id: 'derma_co_salicylic_cleanser',
    name: 'The Derma Co 1% Salicylic Acid Gel Face Wash (100ml)',
    brand: 'The Derma Co',
    description: 'Exfoliating gel cleanser designed to clear pimples, active breakouts, and excess sebum without drying.',
    image: '/product-images/derma-co-salicylic-cleanser.jpg',
    targetIssue: 'Active Pimple & Acne Control Wash',
    price: '₹299',
    activeIngredients: ['1% Salicylic Acid', 'Witch Hazel', 'Willow Bark'],
    productUrl: 'https://thedermaco.com/products/1-salicylic-acid-gel-face-wash-with-salicylic-acid-witch-hazel-100ml',
    whyRecommended: 'Deeply cleanses congested pores and combats active pimple formation.',
    usageInstructions: 'Massage a small amount onto damp face, lather, and rinse thoroughly.'
  }
};

const DEFAULT_PRODUCT_IMAGE = '/product-images/cetaphil-gentle-cleanser.png';

function cleanProductId(id: unknown): string {
  return String(id || '').trim().toLowerCase();
}

export function normalizeRecommendation(rec: Partial<Recommendation> | null | undefined): Recommendation | null {
  if (!rec) return null;
  const catalogProduct = CATALOG_PRODUCTS[cleanProductId(rec.id)];
  if (catalogProduct) {
    return {
      ...catalogProduct,
      whyRecommended: rec.whyRecommended || catalogProduct.whyRecommended,
      usageInstructions: rec.usageInstructions || catalogProduct.usageInstructions
    };
  }

  return {
    id: String(rec.id || 'custom-rec'),
    name: rec.name || 'Recommended Product',
    brand: rec.brand || 'Care Recommendation',
    description: rec.description || 'Targeted skincare recommendation selected for your skin needs.',
    image: rec.image || DEFAULT_PRODUCT_IMAGE,
    targetIssue: rec.targetIssue || 'Skin Support',
    price: rec.price || '₹599',
    activeIngredients: rec.activeIngredients || [],
    productUrl: rec.productUrl || '',
    whyRecommended: rec.whyRecommended || 'Recommended for your current skin profile.',
    usageInstructions: rec.usageInstructions || 'Follow the product label and patch test before regular use.',
  };
}

export function normalizeRecommendations(recommendations: Array<Partial<Recommendation>> = []): Recommendation[] {
  const normalized = recommendations
    .map(normalizeRecommendation)
    .filter((rec): rec is Recommendation => Boolean(rec));

  return Array.from(new Map(normalized.map(rec => [rec.id, rec])).values());
}

export function getCatalogRecommendationsByIds(
  productIds: unknown[] = [],
  fallbackRecommendations: Recommendation[] = []
): Recommendation[] {
  const selected = productIds
    .map(cleanProductId)
    .map(id => CATALOG_PRODUCTS[id])
    .filter((rec): rec is Recommendation => Boolean(rec));

  return normalizeRecommendations([...selected, ...fallbackRecommendations]);
}

/**
 * Generates genuinely personalized recommendations based on the user's full skin profile
 * (acne severity, oiliness, dryness, redness/sensitivity, pigmentation/UV, texture/wrinkles).
 * Incorporates deterministic hashing to ensure consistent results for the same user & skin condition.
 */
export function getStableRecommendations(metrics: Partial<SkinAnalysisRecord>, userId?: string): Recommendation[] {
  const skinType = (metrics.finalSkinType || metrics.classification || 'Normal').toLowerCase();
  const acneSev = (metrics.acneSeverity || 'Not Detected').toLowerCase();
  const hydration = metrics.hydration ?? 80;
  const texture = metrics.texture ?? 80;
  const uvDamage = (metrics.uvDamage || 'Low').toLowerCase();
  const topThree = metrics.topThreeClasses || [];
  const isAcneDetected = metrics.acneDetected === true || (acneSev !== 'clear' && acneSev !== 'not detected');

  // Detect primary skin profile traits with clear hierarchy
  const isAcneProfile = skinType.includes('acne') || isAcneDetected || (topThree.length > 0 && topThree[0].className === 'acne');
  const isWrinkleProfile = skinType.includes('wrinkle') || texture < 70 || (topThree.length > 0 && topThree[0].className === 'wrinkles');
  const isOilyProfile = skinType.includes('oily') || (topThree.length > 0 && topThree[0].className === 'oily');
  const isDryProfile = skinType.includes('dry') || hydration < 65 || (topThree.length > 0 && topThree[0].className === 'dry');
  const isSensitiveProfile = skinType.includes('sensitive');
  const isUvProfile = uvDamage === 'high' || uvDamage === 'moderate' || (metrics.uvScore ?? 0) > 30;
  const isNormalProfile = skinType.includes('normal') || skinType.includes('healthy') || (!isAcneProfile && !isWrinkleProfile && !isOilyProfile && !isDryProfile);

  // Score candidate catalog products based on suitability
  const productScores: Record<string, number> = {};

  for (const prodId of Object.keys(CATALOG_PRODUCTS)) {
    let score = 0;

    // 1. ACNE PROFILE MATCHES
    if (isAcneProfile) {
      if (prodId === 'minimalist_salicylic_acid') score += 160;
      if (prodId === 'derma_co_salicylic_cleanser') score += 150;
      if (prodId === 'dot_key_cica_gel') score += 140;
      if (prodId === 'minimalist_niacinamide') score += 120;
    }

    // 2. WRINKLE / TEXTURE PROFILE MATCHES
    if (isWrinkleProfile) {
      if (prodId === 'foxtale_retinol_night_serum') score += 160;
      if (prodId === 'derma_co_vitamin_c') score += 140;
      if (prodId === 'dot_key_ceramide_moisturizer') score += 130;
      if (prodId === 'minimalist_niacinamide') score += 115;
    }

    // 3. OILY SKIN PROFILE MATCHES
    if (isOilyProfile) {
      if (prodId === 'minimalist_niacinamide') score += 160;
      if (prodId === 'plum_green_tea_toner') score += 145;
      if (prodId === 'requil_dry_touch_sunscreen') score += 135;
      if (prodId === 'dot_key_cica_gel') score += 120;
    }

    // 4. DRY SKIN PROFILE MATCHES
    if (isDryProfile) {
      if (prodId === 'dot_key_ceramide_moisturizer') score += 160;
      if (prodId === 'cetaphil_gentle_cleanser') score += 145;
      if (prodId === 'bioderma_atoderm_baume') score += 135;
    }

    // 5. SENSITIVE / REDNESS PROFILE MATCHES
    if (isSensitiveProfile) {
      if (prodId === 'cetaphil_gentle_cleanser') score += 150;
      if (prodId === 'dot_key_cica_gel') score += 140;
      if (prodId === 'bioderma_atoderm_baume') score += 130;
    }

    // 6. PIGMENTATION / UV DAMAGE MATCHES
    if (isUvProfile) {
      if (prodId === 'requil_dry_touch_sunscreen') score += 150;
      if (prodId === 'minimalist_alpha_arbutin') score += 140;
      if (prodId === 'derma_co_vitamin_c') score += 135;
    }

    // 7. NORMAL / HEALTHY PROFILE MATCHES
    if (isNormalProfile) {
      if (prodId === 'requil_dry_touch_sunscreen') score += 140;
      if (prodId === 'cetaphil_gentle_cleanser') score += 135;
      if (prodId === 'dot_key_ceramide_moisturizer') score += 130;
      if (prodId === 'derma_co_vitamin_c') score += 120;
    }

    productScores[prodId] = score;
  }

  // Deterministic Hash Seed for consistent results on identical metrics
  const seedString = `${userId || 'user'}_${metrics.score || 0}_${metrics.hydration || 0}_${metrics.texture || 0}_${metrics.acneSeverity || ''}_${metrics.classification || ''}`;
  let hash = 0;
  for (let i = 0; i < seedString.length; i++) {
    hash = (hash << 5) - hash + seedString.charCodeAt(i);
    hash |= 0;
  }
  const deterministicOffset = Math.abs(hash);

  // Sort products primarily by profile match score, deterministically broken by hash
  const sortedIds = Object.keys(CATALOG_PRODUCTS).sort((a, b) => {
    const scoreA = productScores[a] || 0;
    const scoreB = productScores[b] || 0;
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
    const tieA = (a.charCodeAt(0) + deterministicOffset) % 100;
    const tieB = (b.charCodeAt(0) + deterministicOffset) % 100;
    return tieB - tieA;
  });

  return sortedIds.slice(0, 5).map(id => CATALOG_PRODUCTS[id]);
}

/**
 * Generates personalized natural lifestyle wellness habits based on skin profile metrics.
 */
export function generateNaturalWellnessProtocol(metrics: Partial<SkinAnalysisRecord>): NaturalWellnessProtocol {
  const skinType = (metrics.finalSkinType || metrics.classification || 'Normal').toLowerCase();
  const acneSev = (metrics.acneSeverity || 'Not Detected').toLowerCase();
  const hydration = metrics.hydration ?? 80;
  const texture = metrics.texture ?? 80;
  const isAcneProne = skinType.includes('acne') || (acneSev !== 'clear' && acneSev !== 'not detected') || metrics.acneDetected === true;
  const isDry = skinType.includes('dry') || hydration < 75;
  const isOily = skinType.includes('oily');
  const isWrinkle = skinType.includes('wrinkle') || texture < 70;
  const uvDamage = (metrics.uvDamage || 'Low').toLowerCase();
  const isUvDamaged = uvDamage === 'high' || uvDamage === 'moderate';

  // Hydration — concise & specific
  let hydrationTarget: string;
  if (hydration < 65) {
    hydrationTarget = 'Hydration boost: 500ml water upon waking + water-rich fruits (cucumber, watermelon) to restore skin turgor.';
  } else {
    hydrationTarget = 'Maintain steady hydration: carry a 750ml bottle and sip consistently throughout morning activities.';
  }

  // Diet — concise, condition-specific without repetitive pumpkin seeds filler
  let dietAdvice: string;
  if (isAcneProne) {
    dietAdvice = 'Anti-inflammatory focus: Add green tea and turmeric roasted chickpeas; limit high-glycemic dairy & sugary snacks.';
  } else if (isDry) {
    dietAdvice = 'Lipid barrier nourishment: Include walnuts, avocado slices, or chia seeds rich in essential fatty acids.';
  } else if (isOily) {
    dietAdvice = 'Sebum balance: Fresh leafy greens and citrus fruits rich in vitamin B6; avoid deep-fried foods.';
  } else if (isWrinkle) {
    dietAdvice = 'Collagen support: Vitamin C-rich amla, kiwi, or bell peppers with antioxidant-rich berries.';
  } else {
    dietAdvice = 'Balanced nutrition: Fresh seasonal fruit and antioxidant-rich greens to support natural skin radiance.';
  }

  // Sleep & Recovery
  let sleepHygiene: string;
  if (isAcneProne) {
    sleepHygiene = 'Clean rest: Sleep 7-8h and change pillowcase every 2-3 days to minimize overnight bacterial contact.';
  } else if (isDry || isWrinkle) {
    sleepHygiene = 'Barrier recovery: 7-8h restorative sleep; keep room cool (19-21°C) with humidity above 45%.';
  } else {
    sleepHygiene = 'Restorative sleep: Aim for 7-8 hours; avoid bright screens 30 minutes before sleep for optimal melatonin release.';
  }

  // Stress management
  let stressManagement: string;
  if (isAcneProne || isOily) {
    stressManagement = 'Cortisol regulation: 20-min brisk walk or light stretching to keep stress hormones and sebum in check.';
  } else {
    stressManagement = 'Stress relief: 15-20 min light walk or 5 min deep diaphragmatic breathing before evening routine.';
  }

  // Skincare habit
  const skinCareHabit = isAcneProne
    ? 'Wash with cool or lukewarm water for 30 seconds. Pat dry gently with a clean towel; avoid aggressive rubbing.'
    : isDry
    ? 'Rinse with lukewarm water only. Apply moisturizer within 60 seconds to lock in hydration.'
    : 'Rinse with lukewarm water; pat dry softly and avoid touching face during the day.';

  return {
    hydrationTarget,
    dietAdvice,
    sleepHygiene,
    stressManagement,
    skinCareHabit
  };
}

/**
 * Generates a dynamic skincare routine tailored to the specific skin condition (Acne, Wrinkle, Oily, Dry, Normal).
 */
export function generateDynamicRoutine(metrics: Partial<SkinAnalysisRecord>, userId?: string): SkincareRoutine {
  const skinType = (metrics.finalSkinType || metrics.classification || 'Normal').toLowerCase();
  const acneSev = (metrics.acneSeverity || 'Not Detected').toLowerCase();
  const hydration = metrics.hydration ?? 80;
  const texture = metrics.texture ?? 80;

  const isAcneProne = skinType.includes('acne') || (acneSev !== 'clear' && acneSev !== 'not detected') || metrics.acneDetected === true;
  const isWrinkleProne = skinType.includes('wrinkle') || texture < 75;
  const isDry = skinType.includes('dry') || hydration < 75;
  const isOily = skinType.includes('oily');
  const uvDamage = (metrics.uvDamage || 'Low').toLowerCase();
  const isUvDamaged = uvDamage === 'high' || uvDamage === 'moderate';

  // ── Generate natural wellness advice tailored to this profile ──
  const wellness = generateNaturalWellnessProtocol(metrics);

  // ── Select products ONLY when necessary for the detected condition ──
  const cleanser = isAcneProne
    ? CATALOG_PRODUCTS.derma_co_salicylic_cleanser
    : CATALOG_PRODUCTS.cetaphil_gentle_cleanser;

  const needsAmSerum = isAcneProne || isWrinkleProne || isOily || isDry || isUvDamaged;
  const amSerum = isAcneProne
    ? CATALOG_PRODUCTS.minimalist_salicylic_acid
    : isWrinkleProne
    ? CATALOG_PRODUCTS.derma_co_vitamin_c
    : isOily
    ? CATALOG_PRODUCTS.minimalist_niacinamide
    : isDry
    ? CATALOG_PRODUCTS.minimalist_alpha_arbutin
    : CATALOG_PRODUCTS.derma_co_vitamin_c;

  const needsSunscreen = true; // sunscreen is always essential
  const sunscreen = CATALOG_PRODUCTS.requil_dry_touch_sunscreen;

  const needsPmTreatment = isWrinkleProne || isAcneProne || isOily;
  const pmTreatment = isWrinkleProne
    ? CATALOG_PRODUCTS.foxtale_retinol_night_serum
    : isAcneProne
    ? CATALOG_PRODUCTS.minimalist_salicylic_acid
    : isOily
    ? CATALOG_PRODUCTS.plum_green_tea_toner
    : CATALOG_PRODUCTS.minimalist_niacinamide;

  const needsPmMoisturizer = isDry || isAcneProne || isOily || hydration < 80;
  const pmMoisturizer = isAcneProne || isOily
    ? CATALOG_PRODUCTS.dot_key_cica_gel
    : isDry
    ? CATALOG_PRODUCTS.bioderma_atoderm_baume
    : CATALOG_PRODUCTS.dot_key_ceramide_moisturizer;

  // ── Build morning routine: Skincare steps first, at most 1 concise lifestyle step ──
  const morning: SkincareRoutineItem[] = [];
  let amStep = 1;

  // Product Step 1: Cleanser
  morning.push({
    id: 'am_cleanser',
    step: amStep++,
    title: 'Morning Cleanse',
    category: 'cleanser',
    productName: cleanser.name,
    reason: cleanser.whyRecommended,
    completed: false,
    timeOfDay: 'am',
    catalogProductId: cleanser.id
  });

  // Product Step 2: Targeted Serum (if needed)
  if (needsAmSerum) {
    morning.push({
      id: 'am_serum',
      step: amStep++,
      title: 'Targeted Serum Treatment',
      category: 'serum',
      productName: amSerum.name,
      reason: amSerum.whyRecommended,
      completed: false,
      timeOfDay: 'am',
      catalogProductId: amSerum.id
    });
  }

  // Product Step 3: Sunscreen (always essential)
  morning.push({
    id: 'am_sunscreen',
    step: amStep++,
    title: 'Daily Broad-Spectrum Sunscreen',
    category: 'sunscreen',
    productName: sunscreen.name,
    reason: sunscreen.whyRecommended,
    completed: false,
    timeOfDay: 'am',
    catalogProductId: sunscreen.id
  });

  // Lifestyle / Nutrition recommendation 1 of 2 (max 1 in AM)
  morning.push({
    id: 'am_lifestyle',
    step: amStep++,
    title: 'Morning Nutritional Support',
    category: 'lifestyle',
    productName: wellness.dietAdvice,
    reason: 'Provides essential dietary micronutrients to support epidermal resilience.',
    completed: false,
    timeOfDay: 'am'
  });

  // ── Build night routine: Skincare steps first, at most 1 concise recovery/sleep step ──
  const night: SkincareRoutineItem[] = [];
  let pmStep = 1;

  // Product Step 1: Evening Cleanser
  night.push({
    id: 'pm_cleanser',
    step: pmStep++,
    title: 'Evening Deep Cleanse',
    category: 'cleanser',
    productName: cleanser.name,
    reason: 'Removes accumulated sebum, micro-pollutants, and daytime sunscreen.',
    completed: false,
    timeOfDay: 'pm',
    catalogProductId: cleanser.id
  });

  // Product Step 2: Night Treatment (if needed)
  if (needsPmTreatment) {
    night.push({
      id: 'pm_treatment',
      step: pmStep++,
      title: 'Nocturnal Active Repair',
      category: 'treatment',
      productName: pmTreatment.name,
      reason: pmTreatment.whyRecommended,
      completed: false,
      timeOfDay: 'pm',
      catalogProductId: pmTreatment.id
    });
  }

  // Product Step 3: Night Moisturizer
  if (needsPmMoisturizer) {
    night.push({
      id: 'pm_moisturizer',
      step: pmStep++,
      title: 'Barrier Hydration Seal',
      category: 'moisturizer',
      productName: pmMoisturizer.name,
      reason: pmMoisturizer.whyRecommended,
      completed: false,
      timeOfDay: 'pm',
      catalogProductId: pmMoisturizer.id
    });
  }

  // Lifestyle / Nutrition recommendation 2 of 2 (max 1 in PM)
  night.push({
    id: 'pm_lifestyle',
    step: pmStep++,
    title: 'Overnight Recovery & Rest',
    category: 'lifestyle',
    productName: wellness.sleepHygiene,
    reason: 'Restorative sleep lowers nocturnal cortisol and supports cellular renewal.',
    completed: false,
    timeOfDay: 'pm'
  });

  return {
    lastUpdated: new Date().toISOString(),
    morning,
    night
  };
}

/**
 * Extract ONLY the exact products used in routine steps via their catalogProductId.
 * Recommended Products = exactly the products in the daily routine. Nothing extra.
 */
export function syncRecommendationsFromRoutine(routine?: SkincareRoutine, _metrics?: Partial<SkinAnalysisRecord>, _userId?: string): Recommendation[] {
  const matched: Recommendation[] = [];
  const allSteps = routine ? [...(routine.morning || []), ...(routine.night || [])] : [];

  for (const step of allSteps) {
    // Skip lifestyle steps (no purchasable product)
    if (step.category === 'lifestyle') continue;

    // Use exact catalogProductId for precise matching — no fuzzy text matching
    if (step.catalogProductId && CATALOG_PRODUCTS[step.catalogProductId]) {
      const prod = CATALOG_PRODUCTS[step.catalogProductId];
      if (!matched.some(p => p.id === prod.id)) {
        matched.push(prod);
      }
    }
  }

  // Fallback only if routine has zero products (shouldn't happen)
  if (matched.length === 0) {
    matched.push(
      CATALOG_PRODUCTS.cetaphil_gentle_cleanser,
      CATALOG_PRODUCTS.requil_dry_touch_sunscreen
    );
  }

  return matched;
}

