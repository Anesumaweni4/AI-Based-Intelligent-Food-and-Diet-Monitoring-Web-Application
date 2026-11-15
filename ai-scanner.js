// AI meal photo scanner.
//
// A student takes a photo of their plate; Claude (vision) recognises each food,
// estimates the portion and its nutrition, and writes one short tip based on
// what the student still needs today. The student checks the result and adds
// it to their food diary in one tap.
//
// Needs ANTHROPIC_API_KEY. Without it the scanner reports that it is not set
// up and the rest of the site works as before.
const crypto = require('crypto');
const { z } = require('zod');
const AnthropicModule = require('@anthropic-ai/sdk');
const { betaZodOutputFormat } = require('@anthropic-ai/sdk/helpers/beta/zod');
const dietService = require('./diet-service');

const Anthropic = AnthropicModule.default || AnthropicModule;
const MODEL = process.env.AI_SCANNER_MODEL || 'claude-opus-5-5';
const DAILY_LIMIT = Math.max(1, Number(process.env.AI_SCANS_PER_DAY) || 15);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const SCAN_TTL_MS = 30 * 60 * 1000;
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const FoodItem = z.object({
  name: z.string().describe('Short everyday name, e.g. "Sadza", "Beef stew", "Covo (greens)"'),
  portion: z.string().describe('Visible portion in everyday words, e.g. "2 cups", "1 medium piece"'),
  grams: z.number().describe('Estimated weight in grams'),
  calories: z.number().describe('kcal for this portion'),
  protein: z.number().describe('grams'),
  carbohydrates: z.number().describe('grams'),
  fat: z.number().describe('grams'),
  fiber: z.number().describe('grams'),
  sugar: z.number().describe('grams'),
  is_drink: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low'])
});

const ScanResult = z.object({
  is_food: z.boolean().describe('false if the photo does not show food or drink'),
  meal_name: z.string().describe('Name for the whole plate, e.g. "Sadza with beef stew and covo"'),
  items: z.array(FoodItem),
  balance: z.enum(['balanced', 'needs_vegetables', 'needs_protein', 'high_fat', 'high_sugar', 'light_snack', 'not_food']),
  tip: z.string().describe('One friendly sentence (max 30 words) for this student, using their remaining targets'),
  notes: z.string().describe('Brief note on anything uncertain, or empty string')
});

const SYSTEM_PROMPT = `You are the nutrition assistant inside THE KITCHEN, a food ordering and diet monitoring app for university students living in accommodation in Zimbabwe.

You receive one photo of a meal or drink. Identify every distinct food and drink you can see and estimate the portion and nutrition of each, as eaten.

Know Zimbabwean and Southern African food well: sadza (stiff maize meal porridge), nyama (beef/goat stew), huku (chicken), muriwo/covo/rape/spinach greens, matemba/kapenta (small dried fish), beans, rice, chips, boerewors, russians, mazhanje, maputi, bread, porridge, mabhanzi, Mazoe orange crush, Coke, Fanta, Stoney, Maheu.

Estimating:
- Judge portion size from the plate, cutlery and hands in the photo. A standard dinner plate is about 26 cm across.
- Use typical home or canteen recipes (oil used in stews and greens counts).
- Give nutrition for the portion in the photo, not per 100 g.
- Combine identical pieces into one item ("3 pieces of chicken"); keep sauces with their dish.
- Set confidence low when the food is hidden, blurry or ambiguous, and explain briefly in notes.
- If there is no food or drink in the photo, set is_food false, return no items, balance "not_food", and use the tip to ask for a clearer photo of the meal.

The tip must be practical for a student on a budget and refer to what they still need today when that is useful (for example more vegetables, protein or water). Do not give medical advice.`;

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

// ---------------------------------------------------------------------------
// Per-student daily limit (keeps API costs predictable) and short-lived scans
// ---------------------------------------------------------------------------
const usage = new Map(); // `${userId}:${day}` -> count
const scans = new Map(); // scanId -> { userId, result, createdAt }

function usedToday(userId) {
  return usage.get(`${userId}:${dietService.todayKey()}`) || 0;
}

function countScan(userId) {
  const key = `${userId}:${dietService.todayKey()}`;
  usage.set(key, (usage.get(key) || 0) + 1);
  if (usage.size > 5000) {
    const today = dietService.todayKey();
    for (const entry of usage.keys()) if (!entry.endsWith(today)) usage.delete(entry);
  }
}

function refundScan(userId) {
  const key = `${userId}:${dietService.todayKey()}`;
  if (usage.get(key) > 0) usage.set(key, usage.get(key) - 1);
}

function pruneScans() {
  const now = Date.now();
  for (const [id, scan] of scans) if (now - scan.createdAt > SCAN_TTL_MS) scans.delete(id);
}

function parseImage(dataUrl) {
  const match = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match || !MEDIA_TYPES.has(match[1])) return { error: 'Please send a JPEG, PNG or WebP photo.' };
  const bytes = Math.floor(match[2].length * 3 / 4);
  if (bytes > MAX_IMAGE_BYTES) return { error: 'That photo is too large. Please try again (the app shrinks photos automatically).' };
  if (bytes < 2000) return { error: 'That photo is too small to read.' };
  return { mediaType: match[1], data: match[2] };
}

const clamp = (value, max) => Math.round(Math.min(max, Math.max(0, Number(value) || 0)) * 10) / 10;

function cleanResult(raw) {
  const items = (raw.is_food ? raw.items : []).slice(0, 12).map((item) => ({
    name: String(item.name || 'Food').slice(0, 60),
    portion: String(item.portion || '').slice(0, 40),
    grams: Math.round(clamp(item.grams, 2000)),
    calories: Math.round(clamp(item.calories, 3000)),
    protein: clamp(item.protein, 250),
    carbohydrates: clamp(item.carbohydrates, 500),
    fat: clamp(item.fat, 250),
    fiber: clamp(item.fiber, 100),
    sugar: clamp(item.sugar, 300),
    isDrink: Boolean(item.is_drink),
    confidence: ['high', 'medium', 'low'].includes(item.confidence) ? item.confidence : 'medium'
  }));
  const totals = items.reduce((sum, item) => {
    for (const key of ['calories', 'protein', 'carbohydrates', 'fat', 'fiber', 'sugar']) sum[key] += item[key];
    return sum;
  }, { calories: 0, protein: 0, carbohydrates: 0, fat: 0, fiber: 0, sugar: 0 });
  for (const key of Object.keys(totals)) totals[key] = Math.round(totals[key] * 10) / 10;
  return {
    isFood: Boolean(raw.is_food) && items.length > 0,
    mealName: String(raw.meal_name || 'Your meal').slice(0, 80),
    items,
    totals,
    balance: raw.balance,
    tip: String(raw.tip || '').slice(0, 300),
    notes: String(raw.notes || '').slice(0, 300)
  };
}

function contextText(snapshot) {
  if (!snapshot) return 'No diary data for this student yet.';
  const { today, targets } = snapshot;
  const left = (target, done) => Math.max(0, Math.round(target - done));
  return [
    `Student's progress so far today (before this meal):`,
    `- Energy: ${Math.round(today.calories)} of ${targets.calories} kcal`,
    `- Protein: ${Math.round(today.protein)} of ${targets.protein} g (${left(targets.protein, today.protein)} g to go)`,
    `- Fibre: ${Math.round(today.fiber)} of ${targets.fiber} g (${left(targets.fiber, today.fiber)} g to go)`,
    `- Sugar: ${Math.round(today.sugar)} g (limit ${targets.sugarLimit} g)`,
    `- Water: ${Math.round(snapshot.waterMl / 250)} of ${Math.round(snapshot.waterTarget / 250)} glasses`
  ].join('\n');
}

async function scanMeal(userId, { image, note }) {
  if (!isConfigured()) {
    return { status: 503, message: 'The AI meal scanner is not set up on this server yet (ANTHROPIC_API_KEY is missing).' };
  }
  if (usedToday(userId) >= DAILY_LIMIT) {
    return { status: 429, message: `You have used all ${DAILY_LIMIT} photo scans for today. Log other meals from the list, or try again tomorrow.` };
  }
  const parsed = parseImage(image);
  if (parsed.error) return { status: 400, message: parsed.error };

  const snapshot = (await dietService.reminderSnapshots([userId])).get(Number(userId));
  const userNote = String(note || '').trim().slice(0, 200);
  countScan(userId);

  let response;
  try {
    response = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(ScanResult) },
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: parsed.mediaType, data: parsed.data } },
          {
            type: 'text',
            text: `${contextText(snapshot)}\n\n${userNote ? `The student says: "${userNote}"\n\n` : ''}Identify the foods in this photo and estimate their nutrition.`
          }
        ]
      }]
    });
  } catch (error) {
    refundScan(userId); // a failed call does not use up one of the student's scans
    if (error instanceof Anthropic.RateLimitError) {
      return { status: 503, message: 'The AI is busy right now. Please try again in a minute.' };
    }
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      console.error('AI scanner: the Anthropic API key was rejected.');
      return { status: 503, message: 'The AI meal scanner is not set up correctly. Please tell the admin.' };
    }
    if (error instanceof Anthropic.BadRequestError) {
      console.error('AI scanner bad request:', error.message);
      return { status: 400, message: 'The AI could not read that photo. Please try another one.' };
    }
    if (error instanceof Anthropic.APIError) {
      console.error(`AI scanner API error ${error.status}:`, error.message);
      return { status: 502, message: 'The AI could not be reached. Please try again.' };
    }
    throw error;
  }

  if (response.stop_reason === 'refusal') {
    refundScan(userId);
    return { status: 422, message: 'The AI could not analyse this photo. Please take a photo of just your meal.' };
  }
  if (!response.parsed_output) {
    refundScan(userId);
    console.error('AI scanner: no parsed output, stop_reason =', response.stop_reason);
    return { status: 502, message: 'The AI gave an incomplete answer. Please try again.' };
  }

  const result = cleanResult(response.parsed_output);
  pruneScans();
  const scanId = crypto.randomBytes(12).toString('hex');
  scans.set(scanId, { userId: Number(userId), result, createdAt: Date.now() });
  return {
    status: 200,
    scanId,
    ...result,
    scansLeft: Math.max(0, DAILY_LIMIT - usedToday(userId)),
    model: response.model
  };
}

// Adds the chosen items of a scan to the diary. Nutrition comes from the
// stored scan, not from the browser.
async function logScan(userId, { scanId, items, servings, slot, day }) {
  const scan = scans.get(String(scanId || ''));
  if (!scan || scan.userId !== Number(userId)) {
    return { status: 404, message: 'This scan has expired. Please take the photo again.' };
  }
  const indexes = Array.isArray(items) ? [...new Set(items.map(Number))].filter((i) => Number.isInteger(i) && scan.result.items[i]) : [];
  if (!indexes.length) return { status: 400, message: 'Choose at least one food to add.' };
  const portion = Number(servings);
  if (!Number.isFinite(portion) || portion < 0.25 || portion > 4) return { status: 400, message: 'Choose how much of the meal you ate.' };

  const ids = [];
  for (const index of indexes) {
    const item = scan.result.items[index];
    const result = await dietService.logCustomFood(userId, {
      name: `${item.name}${item.portion ? ` (${item.portion})` : ''}`.slice(0, 120),
      nutrition: item,
      servings: portion,
      slot,
      day,
      source: 'ai-photo',
      isDrink: item.isDrink
    });
    if (result.status !== 201) return result;
    ids.push(result.id);
  }
  scans.delete(String(scanId));
  return { status: 201, message: `${indexes.length} food${indexes.length === 1 ? '' : 's'} added to your diary.`, ids };
}

function status(userId) {
  return { configured: isConfigured(), dailyLimit: DAILY_LIMIT, scansLeft: Math.max(0, DAILY_LIMIT - usedToday(userId)) };
}

module.exports = { scanMeal, logScan, status, isConfigured, _internal: { cleanResult, parseImage, ScanResult, scans } };
