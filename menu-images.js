// Picks a matching photo for every menu item from its name, e.g.
// "Beef and rice" -> rice with beef stew, "Coke 350ml" -> a glass of cola.
// Photos live in public/menu-images/ (free licences, credited on
// /image-credits.html). On startup, items still using an old placeholder photo
// are switched to their matching photo; images set some other way are kept.
const { all, run } = require('./db');

const DRINK_RULES = [
  [/water/, 'drink-water'],
  [/smoothie/, 'drink-smoothie'],
  [/pepsi/, 'drink-pepsi'],
  [/coca.?cola|coke/, 'drink-cola'],
  [/stoney|ginger/, 'drink-stoney'],
  [/schweppes/, 'drink-schweppes'],
  [/cream soda/, 'drink-cream-soda'],
  [/cherry/, 'drink-berry-juice'],
  [/grape/, 'drink-grape-soda'],
  [/sprite/, 'drink-sprite'],
  [/fanta/, 'drink-fanta'],
  [/mi[rn]?anda orange|mirinda orange/, 'drink-mirinda'],
  [/mi[rn]?anda|mirinda/, 'drink-mirinda-mix'],
  [/lemon/, 'drink-lemon-soda'],
  [/berry/, 'drink-berry-juice'],
  [/mango/, 'drink-mango-juice'],
  [/pineapple/, 'drink-pineapple-juice'],
  [/apple/, 'drink-apple-juice'],
  [/orange/, 'drink-orange-juice'],
  [/./, 'drink-mixed-juice']
];

const MEAL_RULES = [
  [/chicken wrap/, 'chicken-wrap'],
  [/burger.*chips|chips.*burger/, 'burger-chips'],
  [/cheese ?burger/, 'cheeseburger'],
  [/burger/, 'burger'],
  [/hot ?dog/, 'hotdog'],
  [/boerewors/, 'boerewors'],
  [/russian/, 'sausage-chips'],
  [/fish.*chips/, 'fish-chips'],
  [/fish.*sadza|sadza.*fish/, 'sadza-fish'],
  [/fish/, 'fried-fish'],
  [/haifiridzi/, 'kapenta'],
  [/guru|tripe/, 'tripe'],
  [/offal/, 'offals'],
  [/t-? ?bone/, 'tbone'],
  [/sadza.*chicken|chicken.*sadza/, 'sadza-chicken'],
  [/chicken curry|curry/, 'chicken-curry'],
  [/chicken stir ?fry/, 'chicken-stirfry'],
  [/stir ?fry/, 'beef-stirfry'],
  [/meatball/, 'spaghetti-meatballs'],
  [/(spaghetti|pasta).*chicken|chicken pasta/, 'pasta-chicken'],
  [/spaghetti|pasta/, 'spaghetti-mince'],
  [/noodles/, 'noodles'],
  [/^sadza$/, 'sadza-greens'],
  [/sadza/, 'sadza-beef'],
  [/rice.*beans|beans.*rice/, 'rice-beans'],
  [/rice.*mince|mince.*rice/, 'mince'],
  [/rice.*chicken|chicken.*rice/, 'rice-chicken'],
  [/rice.*pork|pork.*rice/, 'rice-pork'],
  [/rice.*(beef|stew|mince|bones)|(beef|stew|mince).*rice/, 'rice-beef'],
  [/^rice$/, 'rice-plain'],
  [/chicken.*wedges/, 'quarter-chicken'],
  [/chicken.*chips|chips.*chicken|quarter chicken and chips/, 'chips-chicken'],
  [/chicken/, 'quarter-chicken'],
  [/pork bones|trotters/, 'pork-bones'],
  [/pork/, 'pork'],
  [/beef/, 'beef-stew'],
  [/mince/, 'mince'],
  [/beans/, 'beans'],
  [/coleslaw/, 'coleslaw'],
  [/salad/, 'salad'],
  [/wedges/, 'wedges'],
  [/chips/, 'chips'],
  [/cake/, 'cake'],
  [/cheese/, 'cheese'],
  [/./, 'rice-beef']
];

function imageKeyFor(item) {
  const name = String(item.name || '').toLowerCase().replace(/[&+]/g, ' and ').replace(/\s+/g, ' ').trim();
  const isDrink = /drink/i.test(String(item.category || ''));
  const rules = isDrink ? DRINK_RULES : MEAL_RULES;
  return rules.find(([pattern]) => pattern.test(name))[1];
}

function imageFor(item) {
  return `/menu-images/${imageKeyFor(item)}.jpg`;
}

function isPlaceholderImage(image) {
  const value = String(image || '');
  return !value || value === '/drinks-assortment.jpg' || value.startsWith('https://images.unsplash.com/');
}

async function applyMenuImages() {
  const items = await all('SELECT id, name, category, image FROM menu_items');
  let updated = 0;
  for (const item of items) {
    if (!isPlaceholderImage(item.image)) continue;
    const image = imageFor(item);
    if (image === item.image) continue;
    await run('UPDATE menu_items SET image = ? WHERE id = ?', [image, item.id]);
    updated += 1;
  }
  if (updated) console.log(`Menu photos: matched ${updated} item(s) to their photos.`);
  return updated;
}

module.exports = { imageFor, imageKeyFor, applyMenuImages, isPlaceholderImage };
