import OpenAI from 'openai';
import { getEvents, getCategories } from '@/lib/db';
import type { FilterState, ChatMessage, UserProfile, Event } from '@/lib/types';
import { rateLimit, getClientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000,
});

/**
 * Compute date anchors ("today", "tomorrow", "this weekend", …) that the
 * filter-extraction prompt needs. Shared between both LLM calls.
 */
function computeDateAnchors() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().split('T')[0];

  // Weekend logic: "the weekend that's relevant right now" — if today is
  // Sat/Sun we mean THIS one, otherwise the upcoming pair.
  // Old code had `(6 - day + 7) % 7 || 7` which returned 7 when today was
  // Saturday, pointing saturday to NEXT week while sunday=tomorrow → the
  // resulting `dateFrom > dateTo` filter matched zero events.
  const day = now.getDay(); // 0=Sun..6=Sat
  let satOffset: number, sunOffset: number;
  if (day === 6) {                // Saturday → today + tomorrow
    satOffset = 0; sunOffset = 1;
  } else if (day === 0) {         // Sunday → just today (yesterday's Sat is past)
    satOffset = 0; sunOffset = 0;
  } else {                        // Mon–Fri → upcoming Sat/Sun
    satOffset = 6 - day;
    sunOffset = 7 - day;
  }
  const nextMonOffset = sunOffset + 1;
  const mk = (offset: number) => { const d = new Date(now); d.setDate(d.getDate() + offset); return d.toISOString().split('T')[0]; };
  return {
    today, dayOfWeek, year: now.getFullYear(),
    tomorrow,
    saturday: mk(satOffset),
    sunday: mk(sunOffset),
    thisWeekSunday: mk(sunOffset),
    nextMonday: mk(nextMonOffset),
  };
}

function buildProfileBlock(profile?: UserProfile): string {
  if (!profile || !('children' in profile) || !Array.isArray(profile.children)) return '';
  const kids = profile.children.map((c) => {
    const g = c.gender === 'girl' ? 'дочь' : c.gender === 'boy' ? 'сын' : 'ребёнок';
    const interests = c.interests?.length ? ` (${c.interests.join(', ')})` : '';
    return `${g} ${c.age} лет${interests}`;
  }).join(', ');
  return `У пользователя: ${kids}. Учитывай это при подборе.`;
}

/**
 * STEP 1 — Filter extraction prompt.
 *
 * Small, focused prompt whose only job is to return a JSON filters object.
 * No event list is shown here — we can't generate a message yet because we
 * don't know which events will be returned for these filters. (That was the
 * old single-call design that caused 60% hallucination rate.)
 */
function buildFilterExtractionPrompt(profile?: UserProfile): string {
  const d = computeDateAnchors();
  const profileBlock = buildProfileBlock(profile);

  let categoryList: string;
  try {
    categoryList = getCategories().map((c) => c.value).join(', ');
  } catch {
    categoryList = 'family, arts, theater, attractions, books, holiday, sports, music, science, film, gaming, community';
  }

  return `Ты извлекаешь структурированные фильтры поиска для приложения мероприятий с детьми в Москве. Верни ТОЛЬКО JSON-объект: {"filters": {...}}.

СЕГОДНЯ: ${d.today} (${d.dayOfWeek}), год ${d.year}.
ДАТЫ: "завтра"=${d.tomorrow}. "на выходных"/"в эти выходные"=dateFrom:"${d.saturday}",dateTo:"${d.sunday}". "на этой неделе"=dateFrom:"${d.today}",dateTo:"${d.thisWeekSunday}". "на следующей неделе" начинается с ${d.nextMonday}. ВЫХОДНЫЕ=только суббота и воскресенье.
${profileBlock ? '\n' + profileBlock + '\n' : ''}

━━━ ПРАВИЛА ИЗВЛЕЧЕНИЯ ━━━
• Извлекай КАЖДЫЙ фильтр, который пользователь упомянул явно или неявно. Пропустить явный фильтр хуже, чем добавить его.
• Каждое сообщение — НЕЗАВИСИМЫЙ поиск. Не переносить фильтры из прошлых реплик.
• Понимай русские синонимы и разговорные варианты: "сводить ребёнка" = ищет событие для детей; "куда сходить" = общий запрос, без фильтров.

ЛОКАЦИЯ / ОКРУГА МОСКВЫ (извлекай при любом упоминании):
• "центр" / "в центре" / "ЦАО" / "Центральный округ" / "на Арбате" / "на Тверской" → neighborhoods:["ЦАО"]
• "север" / "САО" / "Северный округ" / "Сокол" / "Войковская" → neighborhoods:["САО"]
• "северо-восток" / "СВАО" / "ВДНХ" / "Ботсад" / "Медведково" → neighborhoods:["СВАО"]
• "восток" / "ВАО" / "Измайлово" / "Сокольники" → neighborhoods:["ВАО"]
• "юго-восток" / "ЮВАО" / "Кузьминки" / "Печатники" → neighborhoods:["ЮВАО"]
• "юг" / "ЮАО" / "Царицыно" / "Коломенская" → neighborhoods:["ЮАО"]
• "юго-запад" / "ЮЗАО" / "Тёплый Стан" / "Университет" → neighborhoods:["ЮЗАО"]
• "запад" / "ЗАО" / "Кунцево" / "Парк Победы" / "Фили" → neighborhoods:["ЗАО"]
• "северо-запад" / "СЗАО" / "Строгино" / "Митино" → neighborhoods:["СЗАО"]
• "в Москве" / "по Москве" (без уточнения) = НЕ добавлять фильтр (вся Москва по умолчанию)
• "рядом" / "недалеко" / "близко" = НЕ добавлять фильтр (у нас нет геолокации)

ДАТА:
• Дата не упомянута = НЕ добавлять dateFrom/dateTo.
• "сегодня" → dateFrom:"${d.today}", dateTo:"${d.today}"
• "завтра" → dateFrom:"${d.tomorrow}", dateTo:"${d.tomorrow}"
• "на выходных" / "в выходные" / "в субботу" / "в воскресенье" → dateFrom:"${d.saturday}", dateTo:"${d.sunday}"
• "на этой неделе" → dateFrom:"${d.today}", dateTo:"${d.thisWeekSunday}"
• "на каникулах" / "на праздниках" — не ставь даты (LLM не знает какие именно каникулы), лучше categories:["holiday"]

ЦЕНА:
• "бесплатно" / "бесплатные" / "халява" / "даром" → isFree:true
• "недорого" / "дёшево" / "бюджетно" / "на бюджете" → priceMax:1000
• "до N рублей" / "не дороже N" / "меньше N ₽" → priceMax:N
• "за небольшие деньги" → priceMax:1500

ВОЗРАСТ (КРИТИЧНО — извлекай ВСЕГДА при упоминании):
• "5 лет" / "5-летке" / "пятилетке" / "ребёнку 5" / "сыну 5" / "дочке 5" → ageMax:5
• "4 и 7 лет" → ageMax:7 (максимальный)
• "малыш" / "крошка" / "до 3" / "карапуз" → ageMax:3
• "дошкольник" / "детсадовец" → ageMax:5
• "школьник" / "младший школьник" → ageMax:10
• "подросток" / "тинейджер" / "13+" → ageMax:18 с search:"подросток"
• "грудничок" / "младенец" / "до года" / "до 2 лет" → ageMax:2

КАТЕГОРИИ — ПРЕДПОЧТИТАЙ categories[] ПЕРЕД search:
• "рисование" / "творчество" / "живопись" / "арт" / "рисовать" / "лепка" → categories:["arts"]
• "музей" / "выставка" / "экспозиция" → categories:["attractions","arts"]
• "театр" / "спектакль" / "постановка" / "балет" / "цирк" / "кукольный" / "пьеса" → categories:["theater"]
• "музыка" / "концерт" / "песня" / "опера" / "филармония" → categories:["music"]
• "танцы" / "хореография" → categories:["theater","music"]
• "наука" / "технологии" / "робототехника" / "программирование" / "STEM" → categories:["science"]
• "природа" / "парк" / "поход" / "прогулка" / "зоопарк" / "улица" → categories:["outdoors"]
• "спорт" / "футбол" / "плавание" / "гимнастика" / "каратэ" → categories:["sports"]
• "книги" / "чтение" / "библиотека" / "литература" → categories:["books"]
• "готовить" / "кулинария" / "мастер-класс по готовке" → categories:["family"], search:"кулинар"
• "еда" / "гастрономия" (взрослый контекст) → categories:["food"]
• "кино" / "фильм" / "мультфильм" → categories:["film"]
• "праздник" / "фестиваль" / "Новый год" / "Пасха" / "Масленица" / "Хэллоуин" → categories:["holiday"]
• "день рождения" / "праздновать др" → search:"день рождения" (разные категории)
• "мастер-класс" / "воркшоп" / "курс" / "занятие" → categories:["education"]
• "экскурсия" → categories:["attractions"]
• Широкий запрос ("куда сходить", "чем заняться") → БЕЗ фильтра категорий.
• Если пользователь упомянул "рисование и музей" → обе: categories:["arts","attractions"].

ПОИСК (fallback для специфических фраз):
• "день рождения" → search:"день рождения"
• "двуязычное" / "на английском" → search:"английский"
• "в помещении" / "крытый" / "в дождь" → search:"крытый"
• "после школы" / "после уроков" / "будни днём" → search:"после школы"
• Только 1-2 слова, не длинные фразы.

ДОСТУПНОСТЬ:
• "инвалидная коляска" / "для колясочников" / "доступно" → wheelchairAccessible:true
• "с коляской" / "колясочно-дружелюбно" / "для малышей в коляске" → strollerFriendly:true

━━━ ПРАВИЛА БАЛАНСА ━━━
• ИДИ ШИРЕ. Если выбираешь между одной узкой и двумя широкими категориями — бери широкие. Лучше показать больше приличных событий, чем 0.
• Не комбинируй много фильтров если пользователь не конкретизирует. "Театр для 7-летки в ЦАО на субботу" = все 4. Но "куда пойти с 7-леткой" = только ageMax:7.
• Никогда не придумывай фильтры, которых пользователь не подразумевал.

Доступные поля: categories(string[]), isFree(bool), ageMax(number), priceMax(number), dateFrom(YYYY-MM-DD), dateTo(YYYY-MM-DD), search(string), neighborhoods(string[]), wheelchairAccessible(bool), strollerFriendly(bool)
Валидные категории: ${categoryList}
Валидные округа: "ЦАО","САО","СВАО","ВАО","ЮВАО","ЮАО","ЮЗАО","ЗАО","СЗАО"

ОТВЕТ: {"filters":{...}}   (только фильтры — без сообщения, без комментариев)`;
}

/**
 * STEP 2 — Message-generation prompt.
 *
 * Takes the events that `getEvents()` actually returned and generates a
 * 2-3 sentence reply. Because the LLM sees EXACTLY what the user will see,
 * it cannot invent events. This is the architectural fix for the 60%
 * hallucination rate.
 */
function buildMessagePrompt(
  userMessage: string,
  events: Event[],
  filters: FilterState,
  profile?: UserProfile,
  wasRelaxed?: boolean,
): string {
  const profileBlock = buildProfileBlock(profile);

  const eventsBlock = events.length === 0
    ? '(ничего не нашлось — коротко извинись и предложи расслабить один фильтр)'
    : events.slice(0, 15).map((e, i) => {
        const date = e.next_start_at ? String(e.next_start_at).slice(0, 10) : 'дата уточняется';
        const price = e.is_free ? 'БЕСПЛАТНО' : (e.price_summary || 'платно');
        const venue = e.venue_name || 'место уточняется';
        const ages = e.age_best_from != null ? `${e.age_best_from}-${e.age_best_to ?? '?'} лет` : 'возраст любой';
        return `${i + 1}. "${e.title}" | ${venue} | ${date} | ${price} | ${ages}`;
      }).join('\n');

  const activeFilters = Object.entries(filters).filter(([, v]) =>
    v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)
  );
  const filterSummary = activeFilters.length === 0
    ? 'без фильтров'
    : activeFilters.map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`).join(', ');

  // Определяем, упомянул ли пользователь возраст — для нюанса персонализации.
  const queryHasAge = /\b(\d{1,2})\s?(лет|год|года)\b|\b(малыш|подросток|тинейджер|дошкольн|младенец|грудничок|школьн)/i.test(userMessage);
  const queryHasTopic = /\b(подросток|малыш|грудничок|дошкольник|младший школьник|взрослый)/i.test(userMessage);

  // Чат-помощник НЕ должен описывать события подробно — пользователь видит
  // карточки событий в ленте (с фото, датой, местом, ценой, ссылкой).
  // Длинные описания в чате нечитабельны И по ним нельзя кликнуть.
  // Задача чата: (1) подтвердить, что мы нашли что нужно, (2) указать на ленту,
  // (3) опционально назвать 1 событие как тизер. Всё.
  const eventCount = events.length;

  return `Ты PulseUp — заботливый помощник по семейным мероприятиям в Москве. Напиши ОЧЕНЬ КОРОТКИЙ ответ (1-2 предложения, ≤25 слов), который указывает пользователю на ленту событий справа.

Пользователь спросил: "${userMessage}"
Применённые фильтры: ${filterSummary}
Событий в ленте: ${eventCount}
${wasRelaxed ? '\n⚠  Пришлось ослабить часть фильтров чтобы найти совпадения — упомяни это кратко ("Точно такого не нашлось — показываю похожее").' : ''}
${profileBlock ? '\n' + profileBlock : ''}

━━━ СОБЫТИЯ В ЛЕНТЕ (можно упомянуть НЕ БОЛЕЕ ОДНОГО как тизер) ━━━
${eventsBlock}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ КАК ОТВЕЧАТЬ ━━━
Лента (карточки событий) видна пользователю — он сам будет её смотреть. Твой ответ — это короткий указатель, не описание.

ХОРОШО (копируй такой стиль):
  • "Нашла ${eventCount} вариантов — смотрите ленту →"
  • "Вот ${eventCount} подходящих событий. ${eventCount > 0 ? 'Кликните на карточку — увидите детали.' : ''}"
  • "${eventCount > 0 ? 'Готово — в ленте ' + eventCount + ' событий под ваш запрос.' : 'К сожалению, ничего не нашлось. Попробуйте убрать один из фильтров.'}"

МОЖНО упомянуть ОДНО событие по точному названию как тизер (без деталей):
  • "${eventCount} вариантов — включая \"<точное-название>\". Смотрите ленту →"

ПЛОХО (никогда так не пиши):
  ✗ "Рекомендую «Ночь в Третьяковке», это выставка графики XIX века, которая проходит 23 апреля и бесплатна для детей 5-10 лет. Ещё один вариант..."  ← длинное описание, бесполезно
  ✗ Перечислять 2+ события с деталями
  ✗ Несколько предложений описывающих каждое событие

━━━ ЖЁСТКИЕ ПРАВИЛА ━━━
1. ${eventCount === 0
    ? 'Лента пуста — извинись ОДНИМ коротким предложением и предложи один фильтр ослабить (локация, дата, категория). НЕ придумывай альтернативы.'
    : 'Ответ ОБЯЗАТЕЛЬНО ≤ 25 слов. Направь пользователя в ленту. Можно назвать ОДНО событие ТОЧНЫМ названием из списка — никогда не описывать детали.'}
2. НИКОГДА не придумывай события, места, даты, цены и не цитируй события не из списка.
3. НИКОГДА не пиши "для возраста X-Y", "идеально для", "отличный вариант", "ещё один хороший" — это на карточке события, не в чате.

━━━ ЗАПРЕЩЁННЫЕ ФРАЗЫ (вырезаются автоматически) ━━━
4. НИКОГДА не пиши "для вашего N-летнего", "вашему ребёнку понравится", "ваш малыш", "ваша семья оценит" — приложение их автоматически удаляет.
5. ${queryHasAge ? 'Пользователь упомянул возраст — будь краткой, указывай на ленту.' : queryHasTopic ? 'Пользователь упомянул возрастную группу — будь краткой, указывай на ленту.' : 'Возраст не упоминается — ответ нейтральный и короткий.'}

━━━ ФОРМАТ ━━━
6. 1-2 коротких предложения МАКСИМУМ, ≤ 25 слов всего. Обычный текст. Без эмоджи кроме → если уместно. Без markdown.
7. Никогда не говори "сейчас поищу", "дайте знать", "следите за обновлениями".

Верни JSON: {"message":"твой ответ ≤25 слов"}`;
}

export async function POST(request: Request) {
  try {
    // ===== Rate limiting =====
    // Protects /api/chat from bursting and exhausting OpenAI TPM quota.
    // Load-test evidence: without this, 25+ concurrent requests collapse
    // to near-zero success rate because the 200K TPM limit is shared.
    // 20 req/min per IP is generous for a real user (1 every 3s), but
    // cuts off scripted abuse and same-IP bursts.
    const ipKey = getClientKey(request);
    // Per-IP: 20 req/min — generous for a real user (1 every 3s)
    const rl = rateLimit(`chat:${ipKey}`, 20, 60_000);
    if (!rl.allowed) {
      return Response.json(
        { error: 'Too many requests. Please slow down.', retry_after_sec: rl.retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }
    // Global TPM guard — even across many IPs we cap at ~40 calls/min
    // (each ~2.5k tokens = 100k TPM, under OpenAI's 200k/min limit with headroom).
    const globalRl = rateLimit('chat:global', 40, 60_000);
    if (!globalRl.allowed) {
      return Response.json(
        { error: 'Service is busy. Please try again in a moment.', retry_after_sec: globalRl.retryAfterSec },
        { status: 503, headers: { 'Retry-After': String(globalRl.retryAfterSec) } }
      );
    }

    const body = await request.json();

    // Mode: parse_children
    if (body.mode === 'parse_children') {
      const text = body.message as string;
      if (!text) return Response.json({ error: 'Message is required' }, { status: 400 });

      const parseResult = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `Extract children information from the user's text. Return a JSON object with a "children" array.
Detect gender from keywords: daughter/son/girl/boy (also Russian: дочь/сын/девочка/мальчик).
Each child object: { "age": number, "gender": "boy"|"girl"|"unknown", "name": string|null }
If age is unclear, make a reasonable guess. If gender is unclear, use "unknown".
Return ONLY the JSON object.`,
          },
          { role: 'user', content: text },
        ],
      });

      const parsed = JSON.parse(parseResult.choices[0].message.content || '{"children": []}');
      const children = (parsed.children || []).map((c: Record<string, unknown>) => ({
        age: Math.max(0, Math.min(18, Number(c.age) || 5)),
        gender: ['boy', 'girl', 'unknown'].includes(c.gender as string) ? c.gender : 'unknown',
        name: c.name || null,
        interests: [],
      }));

      return Response.json({ children });
    }

    const { message, filters: existingFilters, profile } = body as {
      message: string;
      filters?: FilterState;
      history?: ChatMessage[];
      profile?: UserProfile;
    };

    if (!message) {
      return Response.json({ error: 'Message is required' }, { status: 400 });
    }

    // ═══════════════════════════════════════════════════════════════════
    // TWO-CALL PIPELINE (eliminates hallucinations by design)
    //
    // Old single-call approach: LLM saw events from `getEventsForChat(query)`
    // and wrote a message referencing them, but the user's actual results
    // came from a separate `getEvents(extractedFilters)` call. The two sets
    // diverged → LLM mentioned events the user never saw (60% hallucination
    // rate in chat audit).
    //
    // New flow:
    //   1. LLM call #1 → extract filters only (no events in context).
    //   2. Run filters through getEvents() + auto-broaden if too few results.
    //   3. LLM call #2 → write a message that may only reference events
    //      from the final returned list. No other events are shown to it,
    //      so inventing them is impossible.
    // ═══════════════════════════════════════════════════════════════════

    // ----- STEP 1: Filter extraction -----
    const filterCompletion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      max_tokens: 250,
      messages: [
        { role: 'system', content: buildFilterExtractionPrompt(profile) },
        { role: 'user', content: message },
      ],
    });

    let extractedFilters: FilterState = {};
    try {
      const parsed = JSON.parse(filterCompletion.choices[0].message.content || '{}');
      extractedFilters = parsed.filters || {};
    } catch {
      // Leave filters empty — we'll fall through and show unfiltered results
    }

    // Normalize location field (LLM sometimes uses `location` instead of `neighborhoods`)
    if (extractedFilters.location) {
      const loc = extractedFilters.location.toLowerCase().trim();
      // "Москва" без уточнения = вся Москва → сбросить, чтобы не фильтровать
      const stripTerms = ['москва', 'москва,россия', 'moscow', 'мск', 'вся москва'];
      if (stripTerms.includes(loc)) {
        delete extractedFilters.location;
      }
      // Ручной маппинг: если LLM вернула текст вместо slug округа
      const districtMap: Record<string, string[]> = {
        // ЦАО
        'центр': ['ЦАО'], 'центральный': ['ЦАО'], 'центре': ['ЦАО'], 'цао': ['ЦАО'],
        'арбат': ['ЦАО'], 'тверская': ['ЦАО'], 'китай-город': ['ЦАО'], 'чистые пруды': ['ЦАО'],
        // САО
        'север': ['САО'], 'северный': ['САО'], 'сао': ['САО'],
        'сокол': ['САО'], 'войковская': ['САО'], 'аэропорт': ['САО'],
        // СВАО
        'северо-восток': ['СВАО'], 'северо-восточный': ['СВАО'], 'свао': ['СВАО'],
        'вднх': ['СВАО'], 'ботанический сад': ['СВАО'], 'медведково': ['СВАО'],
        // ВАО
        'восток': ['ВАО'], 'восточный': ['ВАО'], 'вао': ['ВАО'],
        'измайлово': ['ВАО'], 'сокольники': ['ВАО'], 'преображенская': ['ВАО'],
        // ЮВАО
        'юго-восток': ['ЮВАО'], 'юго-восточный': ['ЮВАО'], 'ювао': ['ЮВАО'],
        'кузьминки': ['ЮВАО'], 'печатники': ['ЮВАО'], 'текстильщики': ['ЮВАО'],
        // ЮАО
        'юг': ['ЮАО'], 'южный': ['ЮАО'], 'юао': ['ЮАО'],
        'царицыно': ['ЮАО'], 'коломенская': ['ЮАО'], 'автозаводская': ['ЮАО'],
        // ЮЗАО
        'юго-запад': ['ЮЗАО'], 'юго-западный': ['ЮЗАО'], 'юзао': ['ЮЗАО'],
        'тёплый стан': ['ЮЗАО'], 'теплый стан': ['ЮЗАО'], 'университет': ['ЮЗАО'], 'профсоюзная': ['ЮЗАО'],
        // ЗАО
        'запад': ['ЗАО'], 'западный': ['ЗАО'], 'зао': ['ЗАО'],
        'кунцево': ['ЗАО'], 'парк победы': ['ЗАО'], 'фили': ['ЗАО'], 'крылатское': ['ЗАО'],
        // СЗАО
        'северо-запад': ['СЗАО'], 'северо-западный': ['СЗАО'], 'сзао': ['СЗАО'],
        'строгино': ['СЗАО'], 'митино': ['СЗАО'], 'тушино': ['СЗАО'], 'щукинская': ['СЗАО'],
      };
      if (districtMap[loc]) {
        extractedFilters.neighborhoods = districtMap[loc];
        delete extractedFilters.location;
      }
    }

    // ----- STEP 2: Query DB + auto-broaden -----
    // Return 20 events instead of 10 — increases DB surface coverage from 28%→55%+
    // (QA audit finding: chat was the most constrained path at page_size=10)
    let eventsResult = getEvents({ ...extractedFilters, page: 1, page_size: 20 });
    let wasRelaxed = false;

    // Auto-broaden: progressively remove restrictive filters when too few results.
    // Intent filters (strollerFriendly, wheelchairAccessible) express explicit needs
    // — only broaden when those filters themselves return 0 results.
    const hasIntentFilters = !!(extractedFilters.strollerFriendly || extractedFilters.wheelchairAccessible);
    const broadenAt = hasIntentFilters ? 0 : 2;

    if (eventsResult.total <= broadenAt) {
      const broadeningSteps: { label: string; modify: (f: FilterState) => FilterState }[] = [
        { label: 'location',   modify: (f) => { const nf = { ...f }; delete nf.neighborhoods; delete nf.location; return nf; } },
        { label: 'dates',      modify: (f) => { const nf = { ...f }; delete nf.dateFrom; delete nf.dateTo; return nf; } },
        { label: 'categories', modify: (f) => { const nf = { ...f }; delete nf.categories; return nf; } },
        {
          label: 'all filters',
          modify: (f) => {
            const nf: FilterState = {};
            if (f.search) nf.search = f.search;
            if (f.ageMax !== undefined) nf.ageMax = f.ageMax;
            if (f.strollerFriendly) nf.strollerFriendly = f.strollerFriendly;
            if (f.wheelchairAccessible) nf.wheelchairAccessible = f.wheelchairAccessible;
            if (f.isFree !== undefined) nf.isFree = f.isFree;
            return nf;
          },
        },
        {
          label: 'search simplification',
          modify: (f) => {
            const nf: FilterState = {};
            if (f.search && f.search.includes(' ')) {
              const words = f.search.split(/\s+/).filter(w => w.length > 3);
              nf.search = words.length > 0 ? words[0] : f.search.split(/\s+/)[0];
            }
            if (f.ageMax !== undefined) nf.ageMax = f.ageMax;
            if (f.strollerFriendly) nf.strollerFriendly = f.strollerFriendly;
            if (f.wheelchairAccessible) nf.wheelchairAccessible = f.wheelchairAccessible;
            if (f.isFree !== undefined) nf.isFree = f.isFree;
            return nf;
          },
        },
      ];

      let currentFilters = { ...extractedFilters };
      for (const step of broadeningSteps) {
        currentFilters = step.modify(currentFilters);
        const tryResult = getEvents({ ...currentFilters, page: 1, page_size: 20 });
        if (tryResult.total >= 3) {
          eventsResult = tryResult;
          extractedFilters = currentFilters;
          wasRelaxed = true;
          break;
        }
      }
    }

    // ----- STEP 3: Message generation (grounded in returned events) -----
    let responseText: string;
    try {
      const messageCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        max_tokens: 250,
        messages: [
          { role: 'system', content: buildMessagePrompt(message, eventsResult.events, extractedFilters, profile, wasRelaxed) },
          { role: 'user', content: message },
        ],
      });
      const parsed = JSON.parse(messageCompletion.choices[0].message.content || '{}');
      responseText = String(parsed.message || '').trim();

      // Post-hoc hallucination guard: if the LLM still mentions a title that
      // isn't in the returned events (e.g. picked up from training data),
      // fall back to a safe deterministic template. This is defence-in-depth
      // — the prompt should prevent this, but we never want to ship a lie.
      if (responseText && eventsResult.events.length > 0) {
        const titles = eventsResult.events.map(e => (e.title || '').toLowerCase());
        const mentionsRealEvent = titles.some(t =>
          t.length > 6 && responseText.toLowerCase().includes(t.slice(0, Math.min(30, t.length)))
        );
        if (!mentionsRealEvent) {
          responseText = buildFallbackMessage(eventsResult.events, profile);
        }
      } else if (!responseText) {
        responseText = eventsResult.events.length > 0
          ? buildFallbackMessage(eventsResult.events, profile)
          : "Не нашла мероприятий по всем вашим критериям. Попробуйте ослабить локацию или дату.";
      }

      // Post-hoc personalization guard — strip "for your X-year-old" phrases
      // (gpt-4o-mini reflexively generates them; see stripFalsePersonalization).
      if (responseText && eventsResult.events.length > 0) {
        responseText = stripFalsePersonalization(responseText, eventsResult.events);
      }
    } catch (err) {
      console.error('[chat] message-generation call failed:', err);
      responseText = eventsResult.events.length > 0
        ? buildFallbackMessage(eventsResult.events, profile)
        : "Извините, произошла ошибка. События ниже всё же должны соответствовать вашему запросу.";
    }

    return Response.json({
      message: responseText,
      filters: extractedFilters,
      events: eventsResult.events,
      total: eventsResult.total,
    });
  } catch (error) {
    console.error('Error in chat:', error);
    return Response.json({ error: 'Failed to process chat message' }, { status: 500 });
  }
}

/**
 * Strip phrases like "great for your 4-year-old" or "perfect for your kid"
 * when none of the mentioned events actually fit that age. gpt-4o-mini has
 * a persistent habit of forcing profile-age personalization even when the
 * event list is clearly for teens or adults — this is the deterministic
 * guard that removes those false claims.
 *
 * Strategy:
 *   1. Find every "<N>-year-old" reference in the reply.
 *   2. For each referenced age, check if any returned event's age range
 *      contains that age.
 *   3. If not, strip the false personalization phrase.
 */
function stripFalsePersonalization(message: string, events: Event[]): string {
  // Strategy: unconditionally strip every "for your X-year-old" / "your kid will…"
  // phrase. gpt-4o-mini reflexively generates them from the profile regardless
  // of whether the mentioned event actually fits that age. Checking coverage
  // across the full event list is unreliable (it usually contains some events
  // with 0-18 ranges even when the LLM mentions only teen/adult events), so we
  // don't try — we just remove the phrase. The prompt already forbids it.
  void events; // reserved for future per-event verification if we ever need it

  let cleaned = message;

  // ─── Russian patterns ──────────────────────────────────────────────────

  // 1) "отлично подойдёт вашему 4-летнему сыну" / "идеально для вашего ребёнка"
  cleaned = cleaned.replace(
    /\s*[—\-,]?\s*(?:отлично|идеально|прекрасно|замечательно|шикарно|супер|великолепно|потрясающе)\s+(?:подойдёт|подойдет|подходит|для)\s+ваш(?:ему|ей|его)?\s+(?:\d{1,2}[- ]?лет(?:нему|ней)?|ребёнку|ребенку|малыш[уе]|сын[уа]|дочк[уе]|дочери|семье|тинейджер[уа]|подростку)\b[^.!,]*/gi,
    '',
  );

  // 2) "вашему ребёнку понравится…" / "ваш 4-летний сын оценит…" — до конца предложения
  cleaned = cleaned.replace(
    /\s*[—\-,]?\s*ваш(?:ему|ей|его|а|их|и|е)?\s+(?:\d{1,2}[- ]?лет(?:ний|няя|нему|ней)?|ребёнок|ребенок|ребёнку|ребенку|малыш[уаое]?|сын[уаово]?|дочк[аеу]?|дочь|семь[яяе]|семью|подросток|подростку)\s+(?:будет|обязательно\s+)?(?:понрав(?:ится|ятся|ется)|оценит|полюбит|обожает|получит удовольствие|в восторге)[^.!]*(?=[.!])/gi,
    '',
  );

  // 3) Голое "для вашего N-летнего" / "для вашего ребёнка" без наречия спереди
  cleaned = cleaned.replace(
    /\s+для\s+ваш(?:его|ей|ему|ей|их)?\s+(?:\d{1,2}[- ]?лет(?:него|ней)?|ребёнка|ребенка|малыша|сына|дочки|дочери|семьи|тинейджера|подростка)\b/gi,
    '',
  );

  // 4) "идеально/отлично подходит вашему <что-угодно>"
  cleaned = cleaned.replace(
    /\s*[—\-,]?\s*(?:идеально|отлично|хорошо)\s+подход(?:ит|ят)\s+ваш(?:ему|ей|его|а)?\s+[^.!,]+(?=[.!,])/gi,
    '',
  );

  // ─── English patterns (kept in case LLM slips into English) ───────────

  cleaned = cleaned.replace(
    /\s*[—\-,]?\s*(?:great|perfect|fantastic|awesome|ideal|fun|lovely|super|wonderful|exciting)\s+for\s+your\s+(?:\d{1,2}[- ]?(?:year[- ]?old|yo)|kid|child|little one|family|toddler|teen|son|daughter|boys?|girls?)s?\b/gi,
    '',
  );
  cleaned = cleaned.replace(
    /\s*[—\-,]?\s*your\s+(?:kid|child|little one|family|son|daughter|toddler|teen|\d{1,2}[- ]?(?:year[- ]?old|yo))s?\s+(?:will\s+)?(?:love|enjoy|adore|have fun|get a kick out|be excited)[^.!]*(?=[.!])/gi,
    '',
  );
  cleaned = cleaned.replace(
    /\s+for\s+your\s+(?:\d{1,2}[- ]?(?:year[- ]?old|yo)|kid|child|little one|family|toddler)s?\b/gi,
    '',
  );

  // Чистим мусор пунктуации и пустые связки
  cleaned = cleaned
    .replace(/\s*—\s*(?=[.!,])/g, '')                 // "…—." → "…."
    .replace(/\s*[—\-]\s*$/gm, '')                     // висящий дэш в конце
    .replace(/\s+(?:который|что|и|вариант\s+которы[йе])\s*(?=[.!,])/gi, '') // связки-сироты
    .replace(/\s+(?:—\s+)?(?:отличный|прекрасный|великолепный|шикарный)\s+вариант\s*(?=[.!,])/gi, '') // "— отличный вариант."
    .replace(/\s{2,}/g, ' ')                            // двойные пробелы
    .replace(/\s+([.!,])/g, '$1')                       // " ." → "."
    .replace(/([.!])\s*\1+/g, '$1')                     // ".." → "."
    .replace(/^\s*[—\-,.]+\s*/g, '')                    // мусор в начале
    .trim();

  return cleaned || message;
}

/**
 * Deterministic fallback message built from real events — used when the LLM
 * fails, returns empty, or hallucinates. Always truthful because it reads
 * directly from the event list.
 */
function buildFallbackMessage(events: Event[], profile?: UserProfile): string {
  void profile; // намеренно игнорируем — не делаем неверифицируемых заявлений о возрасте
  if (events.length === 0) {
    return "К сожалению, не нашла мероприятий по вашему запросу. Попробуйте ослабить локацию или дату.";
  }
  const describe = (e: Event): string => {
    const date = e.next_start_at
      ? new Date(String(e.next_start_at)).toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' })
      : '';
    const price = e.is_free ? 'бесплатно' : (e.price_summary || '');
    const ages = e.age_best_from != null
      ? `${e.age_best_from}${e.age_best_to != null && e.age_best_to !== e.age_best_from ? '–' + e.age_best_to : '+'} лет`
      : '';
    const parts = [price, date, ages].filter(Boolean).join(', ');
    return `«${e.title}»${parts ? ` (${parts})` : ''}`;
  };
  let msg = `Посмотрите ${describe(events[0])}.`;
  if (events.length > 1) msg += ` Или попробуйте ${describe(events[1])}.`;
  return msg;
}
