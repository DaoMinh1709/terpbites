// Scrapes menus from nutrition.umd.edu and works out which meal is being served now.
const cheerio = require('cheerio');

const BASE = 'https://nutrition.umd.edu/';
const TZ = 'America/New_York';

const HALLS = [
  { id: '16', name: 'South Campus' },
  { id: '19', name: 'Yahentamitsi' },
  { id: '51', name: '251 North' },
];

// Serving windows in minutes after midnight (Eastern), per hall and day of week (0 = Sunday).
// Source: dining.umd.edu/hours/dining-halls (Fall 2025). Update here when hours change.
const t = (h, m = 0) => h * 60 + m;

const SOUTH_HILL_HOURS = (day) => (day === 0 || day === 6
  ? { Brunch: [t(10), t(16)], Dinner: [t(16), t(21)] }
  : { Breakfast: [t(7), t(10, 30)], Lunch: [t(10, 30), t(16)], Dinner: [t(16), t(21)] });

const MEAL_HOURS = {
  '16': SOUTH_HILL_HOURS, // South Campus
  '19': SOUTH_HILL_HOURS, // Yahentamitsi
  '51': (day) => ({ // 251 North: open until 10 PM Mon-Thu, 7 PM Fri-Sun
    Breakfast: [t(8), t(10, 30)],
    Lunch: [t(10, 30), t(16)],
    Dinner: [t(16), day >= 1 && day <= 4 ? t(22) : t(19)],
  }),
};

const CACHE_MS = 30 * 60 * 1000;
const cache = new Map();

// Current date/time in Eastern, regardless of the server's timezone.
function easternNow(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short',
    }).formatToParts(d).map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.month}/${parts.day}/${parts.year}`,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
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
async function currentMeal(hallId, now = easternNow()) {
  const meals = await getMenu(hallId, now.date);
  const hours = MEAL_HOURS[hallId](now.weekday);
  for (const { name } of meals) {
    const [start, end] = hours[name] || [0, 0];
    if (now.minutes < start) return { date: now.date, meal: name, status: 'upcoming' };
    if (now.minutes < end) return { date: now.date, meal: name, status: 'open' };
  }
  // After the last meal of the day: show tomorrow's first meal.
  const tomorrow = easternNow(1).date;
  const next = await getMenu(hallId, tomorrow);
  return { date: tomorrow, meal: next[0]?.name, status: 'upcoming' };
}

module.exports = { HALLS, MEAL_HOURS, getMenu, currentMeal, easternNow };
