// Scrapes menus from nutrition.umd.edu and works out which meal is being served now.
const cheerio = require('cheerio');

const BASE = 'https://nutrition.umd.edu/';
const TZ = 'America/New_York';

const HALLS = [
  { id: '16', name: 'South Campus' },
  { id: '19', name: 'Yahentamitsi' },
  { id: '51', name: '251 North' },
];

// Approximate serving windows in minutes after midnight (Eastern time).
// Real hours vary by hall and semester; adjust here if needed.
const MEAL_HOURS = {
  Breakfast: [7 * 60, 11 * 60],
  Brunch: [10 * 60, 15 * 60],
  Lunch: [11 * 60, 16 * 60],
  Dinner: [16 * 60, 21 * 60],
};

const CACHE_MS = 30 * 60 * 1000;
const cache = new Map();

// Current date/time in Eastern, regardless of the server's timezone.
function easternNow(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
    }).formatToParts(d).map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.month}/${parts.day}/${parts.year}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function parseMenu(html) {
  const $ = cheerio.load(html);
  const meals = [];
  $('.nav-tabs .nav-link').each((_, tab) => {
    const name = $(tab).text().trim();
    const pane = $($(tab).attr('href'));
    const stations = [];
    pane.find('.card').each((_, card) => {
      const station = $(card).find('.card-title').first().text().trim();
      const items = [];
      $(card).find('.menu-item-row').each((_, row) => {
        const link = $(row).find('a.menu-item-name');
        const href = link.attr('href') || '';
        const rec = (href.match(/RecNumAndPort=([^*&]+)/) || [])[1];
        if (!rec) return;
        items.push({
          id: rec,
          name: link.text().trim(),
          tags: $(row).find('img.nutri-icon').map((_, i) => $(i).attr('alt')).get(),
          labelUrl: BASE + href,
        });
      });
      if (items.length) stations.push({ name: station, items });
    });
    meals.push({ name, stations });
  });
  return meals;
}

async function getMenu(hallId, date) {
  const key = `${hallId}|${date}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.meals;

  const url = `${BASE}?locationNum=${encodeURIComponent(hallId)}&dtdate=${encodeURIComponent(date)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'TerpBites student menu app' } });
  if (!res.ok) throw new Error(`UMD site returned ${res.status}`);
  const meals = parseMenu(await res.text());
  cache.set(key, { at: Date.now(), meals });
  return meals;
}

// Picks the meal being served now; if between meals, the next one ("upcoming").
async function currentMeal(hallId) {
  const now = easternNow();
  const meals = await getMenu(hallId, now.date);
  const names = meals.map((m) => m.name);
  for (const name of names) {
    const [start, end] = MEAL_HOURS[name] || [0, 0];
    if (now.minutes < start) return { date: now.date, meal: name, status: 'upcoming' };
    if (now.minutes < end) return { date: now.date, meal: name, status: 'open' };
  }
  // After the last meal of the day: show tomorrow's first meal.
  const tomorrow = easternNow(1).date;
  const next = await getMenu(hallId, tomorrow);
  return { date: tomorrow, meal: next[0]?.name, status: 'upcoming' };
}

module.exports = { HALLS, MEAL_HOURS, getMenu, currentMeal, easternNow };
