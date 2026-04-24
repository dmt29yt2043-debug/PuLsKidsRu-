'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { ChatMessage, FilterState, Event, UserProfile, ChildProfile } from '@/lib/types';
import ChatMessages from './ChatMessages';
import type { MultiSelectState, EmailAskState } from './ChatMessages';
import {
  trackChatMessageSent,
  trackChatResponseReceived,
  trackError,
  track,
  identifyUser,
  trackAutoBroadened,
} from '@/lib/analytics';

/**
 * source argument on onFiltersChange is critical for analytics:
 *   'chat'  — filters came from the AI chat response (natural language query)
 *   'ui'    — filters came from onboarding chip clicks (manual setup)
 *   'reset' — profile reset: clear everything
 * page.tsx forwards this to trackFilterApplied() with the correct source.
 */
interface ChatSidebarProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState, source: 'chat' | 'ui' | 'reset') => void;
  onEventClick: (event: Event) => void;
}

type OnboardingStep =
  | 'q1_children'
  | 'q1_confirm'
  | 'q2_interests'
  | 'q2_summary'
  | 'q3_neighborhoods'
  | 'q4_budget'
  | 'q5_special'
  | 'q6_email'
  | 'ready'
  | 'done';

// Suppression keys so we never re-ask a user who already acted.
//   subscribed → never ask again on this device.
//   declined   → honour "Not now" for 30 days, then soft re-ask.
const EMAIL_SUBSCRIBED_KEY = 'pulseup_email_subscribed';
const EMAIL_DECLINED_KEY = 'pulseup_email_declined_at';
const EMAIL_DECLINED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hasSubscribedEmail(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(EMAIL_SUBSCRIBED_KEY) === '1';
}

function wasEmailRecentlyDeclined(): boolean {
  if (typeof localStorage === 'undefined') return false;
  const raw = localStorage.getItem(EMAIL_DECLINED_KEY);
  if (!raw) return false;
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < EMAIL_DECLINED_TTL_MS;
}

const INTEREST_OPTIONS = ['Активные', 'Творческие', 'Развивающие', 'Шоу', 'На улице', 'Игры', 'Приключения', 'Книги', 'Общение'];
const NEIGHBORHOOD_OPTIONS = ['ЦАО', 'САО', 'СВАО', 'ВАО', 'ЮВАО', 'ЮАО', 'ЮЗАО', 'ЗАО', 'СЗАО', 'Вся Москва'];
const BUDGET_OPTIONS = ['Бесплатно', 'До 500 ₽', 'До 1000 ₽', 'До 2000 ₽', 'До 3000 ₽', 'Любой бюджет'];

const INTEREST_TO_CATEGORIES: Record<string, string[]> = {
  'Активные':     ['sports', 'outdoors'],
  'Творческие':   ['arts'],
  'Развивающие': ['education', 'books'],
  'Шоу':          ['theater'],
  'На улице':    ['outdoors', 'attractions'],
  'Игры':         ['family'],
  'Приключения': ['attractions', 'outdoors'],
  'Книги':        ['books'],
  'Общение':     ['family', 'community'],
};

// Slugи квиза (внешний контракт — остаются на English) → категории в RU-базе.
// Дизайн-правило: минимум — только самые специфичные категории.
// Пустые категории лучше, чем шумные: auto-broaden в чате добьёт пробелы.
const QUIZ_INTEREST_TO_CATEGORIES: Record<string, string[]> = {
  outdoor:     ['outdoors'],
  playgrounds: ['outdoors', 'family'],
  museums:     ['attractions', 'arts'],
  classes:     ['education', 'arts'],
  arts_crafts: ['arts'],
  sports:      ['sports'],
  science:     ['science', 'education'],
  animals:     ['outdoors', 'attractions'],
  indoor_play: ['family', 'attractions'],
  // Legacy / alternate labels
  theater: ['theater'],
  music:   ['music'],
  play:    ['family'],
};

// Квиз присылает slugи округов. Маппинг на названия из NEIGHBORHOOD_BOUNDS (lib/db.ts).
const BOROUGH_TO_NEIGHBORHOODS: Record<string, string[]> = {
  // ЦАО
  cao: ['ЦАО'], tsao: ['ЦАО'], center: ['ЦАО'], центр: ['ЦАО'], центральный: ['ЦАО'],
  // САО
  sao: ['САО'], north: ['САО'], север: ['САО'], северный: ['САО'],
  // СВАО
  svao: ['СВАО'], northeast: ['СВАО'], 'северо-восток': ['СВАО'],
  // ВАО
  vao: ['ВАО'], east: ['ВАО'], восток: ['ВАО'],
  // ЮВАО
  uvao: ['ЮВАО'], yuvao: ['ЮВАО'], southeast: ['ЮВАО'], 'юго-восток': ['ЮВАО'],
  // ЮАО
  uao: ['ЮАО'], yuao: ['ЮАО'], south: ['ЮАО'], юг: ['ЮАО'], южный: ['ЮАО'],
  // ЮЗАО
  uzao: ['ЮЗАО'], yuzao: ['ЮЗАО'], southwest: ['ЮЗАО'], 'юго-запад': ['ЮЗАО'],
  // ЗАО
  zao: ['ЗАО'], west: ['ЗАО'], запад: ['ЗАО'], западный: ['ЗАО'],
  // СЗАО
  szao: ['СЗАО'], northwest: ['СЗАО'], 'северо-запад': ['СЗАО'],
  // Общее / другое
  other: [],
  anywhere: [],
  all: [],
};

function genderEmoji(gender: string): string {
  return gender === 'girl' ? '\uD83D\uDC67' : gender === 'boy' ? '\uD83D\uDC66' : '\uD83E\uDDD2';
}

function getStoredProfile(): UserProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem('pulseup_profile');
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if ('attendees' in parsed && !('children' in parsed)) {
      localStorage.removeItem('pulseup_profile');
      return null;
    }
    return parsed as UserProfile;
  } catch {
    return null;
  }
}

function storeProfile(profile: UserProfile) {
  try {
    localStorage.setItem('pulseup_profile', JSON.stringify(profile));
  } catch { /* ignore */ }
}

export default function ChatSidebar({ filters, onFiltersChange, onEventClick }: ChatSidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>('q1_children');
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Onboarding state
  const [parsedChildren, setParsedChildren] = useState<ChildProfile[]>([]);
  const [currentChildIndex, setCurrentChildIndex] = useState(0);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [parsingChildren, setParsingChildren] = useState(false);
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);

  const partialProfileRef = useRef<Partial<UserProfile>>({});

  // Apply profile to filters
  const applyProfileFilters = useCallback((p: Partial<UserProfile>) => {
    const newFilters: FilterState = {};

    if (p.children && p.children.length > 0) {
      newFilters.ageMax = Math.max(...p.children.map((c) => c.age));
      // Propagate all children to filterChildren so WhoFilter shows them all.
      // 'unknown' gender falls back to 'boy' (matches WhoFilter's own fallback).
      newFilters.filterChildren = p.children.map((c) => ({
        age: c.age,
        gender: (c.gender === 'boy' || c.gender === 'girl' ? c.gender : 'boy') as 'boy' | 'girl',
      }));

      // Profile interests are used for chat context only — don't auto-apply
      // categories so the "What" filter stays at the default "Activities".
    }

    if (p.neighborhoods && p.neighborhoods.length > 0 && !p.neighborhoods.includes('Вся Москва')) {
      newFilters.neighborhoods = p.neighborhoods;
    }

    if (p.budget) {
      if (p.budget === 'Бесплатно') newFilters.isFree = true;
      else if (p.budget === 'До 500 ₽')  newFilters.priceMax = 500;
      else if (p.budget === 'До 1000 ₽') newFilters.priceMax = 1000;
      else if (p.budget === 'До 2000 ₽') newFilters.priceMax = 2000;
      else if (p.budget === 'До 3000 ₽') newFilters.priceMax = 3000;
    }

    // Onboarding chips are manual user clicks → tag as 'ui'
    onFiltersChange(newFilters, 'ui');
  }, [onFiltersChange]);

  // On mount — check for quiz params first, then fallback to stored profile
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const source = params.get('source');

      if (source === 'quiz') {
        // --- Parse per docs/quiz-url-contract.md -----------------------------
        // child_age: new format = exact number "7"; legacy = range "3-5" / "16+"
        const childAge    = params.get('child_age') || '8';
        const genderLegacy = params.get('gender');               // back-compat
        const childrenRaw = params.get('children');              // multi-child
        const borough     = (params.get('borough') || '').toLowerCase();
        const customArea  = params.get('custom_area') || '';
        const interests   = (params.get('interests') || '').split(',').map(s => s.trim()).filter(Boolean);
        const pain        = params.get('pain') || '';

        // Parse age string → exact number.
        // New format: "7" → 7. Legacy: "3-5" → 5 (max), "16+" → 18.
        const parseChildAge = (ageStr: string): number => {
          if (!ageStr) return 8;
          if (ageStr.includes('+')) return 18;
          if (!ageStr.includes('-')) return Number(ageStr) || 8; // exact number
          const parts = ageStr.split('-').map(Number);
          return parts[parts.length - 1] || 8;                   // range → take max
        };

        // Parse `children` param.
        // New format: "boy:7,girl:3" (exact ages)
        // Legacy:     "boy:3-5,girl:9-12" (ranges)
        // Falls back to single-child `gender`+`child_age`.
        const quizChildren: ChildProfile[] = (() => {
          const interestLabels = interests.map(i => i.replace(/_/g,' ')).map(i => i.charAt(0).toUpperCase() + i.slice(1));
          if (childrenRaw) {
            const parsed = childrenRaw.split(',').map(s => s.trim()).filter(Boolean).map((piece) => {
              const [g, ageStr] = piece.split(':');
              if (!ageStr) return null;
              const gender = (g === 'boy' || g === 'girl' ? g : 'unknown') as ChildProfile['gender'];
              return { age: parseChildAge(ageStr), gender, interests: interestLabels };
            }).filter((x): x is ChildProfile => x !== null);
            if (parsed.length > 0) return parsed;
          }
          const g = (genderLegacy === 'boy' || genderLegacy === 'girl' ? genderLegacy : 'unknown') as ChildProfile['gender'];
          return [{ age: parseChildAge(childAge), gender: g, interests: interestLabels }];
        })();

        // ageMax = widest upper bound across all children (so feed includes
        // activities for any of them).
        const ageMax = Math.max(...quizChildren.map(c => c.age));

        // Map quiz interests → API categories
        const cats = new Set<string>();
        interests.forEach(i => {
          (QUIZ_INTEREST_TO_CATEGORIES[i.toLowerCase()] || []).forEach(c => cats.add(c));
        });

        // Map borough → neighborhoods (empty for 'other' — no geo filter).
        const neighborhoods = BOROUGH_TO_NEIGHBORHOODS[borough] || [];

        // Build STRICT filters — with categories applied (may be too narrow)
        const strictFilters: FilterState = {
          ageMax,
          filterChildren: quizChildren.map((c) => ({
            age: c.age,
            gender: (c.gender === 'boy' || c.gender === 'girl' ? c.gender : 'boy') as 'boy' | 'girl',
          })),
        };
        if (cats.size > 0) strictFilters.categories = [...cats];
        if (neighborhoods.length > 0) strictFilters.neighborhoods = neighborhoods;
        if (pain === 'too_expensive') strictFilters.isFree = true;

        // Build profile & store (synchronous — no need to wait)
        const quizProfile: UserProfile = {
          children: quizChildren,
          neighborhoods,
          budget: pain === 'too_expensive' ? 'Бесплатно' : 'Любой бюджет',
          specialNeeds: borough === 'other' && customArea ? `Район: ${customArea}` : undefined,
        };
        setProfile(quizProfile);
        storeProfile(quizProfile);
        setOnboardingDone(true);
        setOnboardingStep('done');

        // Build welcome message summary data (reused for both branches below).
        // Если ни один округ не выбран — показываем "Вся Москва".
        const boroughLabel = borough === 'other' && customArea
          ? customArea
          : neighborhoods.length > 0
            ? neighborhoods.join(', ')
            : 'Вся Москва';
        const childSummary = quizChildren.map(c => {
          const emoji = c.gender === 'girl' ? '\uD83D\uDC67' : c.gender === 'boy' ? '\uD83D\uDC66' : '\uD83E\uDDD2';
          return `${emoji} ${c.age} лет`;
        }).join(' · ');
        const interestLabels = interests.map(i => i.replace(/_/g,' ')).map(i => i.charAt(0).toUpperCase() + i.slice(1));

        // ── Preflight auto-broaden ─────────────────────────────────────────
        // Data-scarce boroughs (Queens/Bronx) + multiple quiz-derived category
        // filters often collapse to 0-1 events. Check total first; if the
        // strict combo is too narrow, silently drop categories so the user
        // lands on a populated feed instead of a ghost page.
        //
        // We still save interests to profile.children[].interests so the chat
        // ranking and prompts can use them — just not as a hard filter.
        const MIN_EVENTS = 5;
        const buildCountParams = (f: FilterState): string => {
          const qs = new URLSearchParams();
          if (f.categories?.length) qs.set('categories', f.categories.join(','));
          if (f.ageMax !== undefined) qs.set('age', String(f.ageMax));
          if (f.neighborhoods?.length) qs.set('neighborhoods', f.neighborhoods.join(','));
          if (f.isFree) qs.set('is_free', 'true');
          qs.set('page_size', '1');
          return qs.toString();
        };

        (async () => {
          let finalFilters: FilterState = strictFilters;
          let wasBroadened = false;

          // Only broaden if categories are the likely culprit
          if (strictFilters.categories && strictFilters.categories.length > 0) {
            try {
              const res = await fetch(`/api/events?${buildCountParams(strictFilters)}`);
              if (res.ok) {
                const data = await res.json();
                const total = Number(data.total) || 0;
                if (total < MIN_EVENTS) {
                  const broadened: FilterState = { ...strictFilters };
                  delete broadened.categories;
                  finalFilters = broadened;
                  wasBroadened = true;
                  // Track every silent broaden as a signal: if this event fires a
                  // lot we know our DB is under-populated for common quiz combos
                  // (critical for Queens/Bronx/Staten Island coverage).
                  trackAutoBroadened({
                    strict_count: total,
                    dropped: ['categories'],
                    source: 'quiz',
                    borough,
                  });
                }
              }
            } catch {
              // Network error — fall back to strict filters, user can adjust manually
            }
          }

          // Quiz onboarding → 'ui' (came via quiz URL, effectively manual setup)
          onFiltersChange(finalFilters, 'ui');

          const broadenedNote = wasBroadened
            ? `\n\nЯ ослабила фильтр категорий, чтобы в ${boroughLabel} было больше вариантов. Нажмите «Что», чтобы сузить.`
            : '';
          setMessages([{
            role: 'assistant',
            content: `Отличные подборки для вашей семьи! Вот что я нашла:\n\n${childSummary}\n\uD83D\uDCCD ${boroughLabel}\n\u2B50 ${interestLabels.join(', ')}\n\nСобытия уже отфильтрованы. Спрашивайте что угодно, чтобы уточнить!${broadenedNote}`,
          }]);

          // Clean URL without reload
          window.history.replaceState({}, '', '/');
        })();

        return;
      }
    }

    const stored = getStoredProfile();
    if (stored) {
      setProfile(stored);
      setOnboardingDone(true);
      setOnboardingStep('done');
      // Only auto-apply profile filters once per page load — not on remounts
      // triggered by the global Reset button.
      const w = window as unknown as { __pulseup_profile_filters_applied?: boolean };
      if (!w.__pulseup_profile_filters_applied) {
        applyProfileFilters(stored);
        w.__pulseup_profile_filters_applied = true;
      }
      setMessages([{ role: 'assistant', content: 'С возвращением! Я помню ваши предпочтения. Спрашивайте что угодно про события!' }]);
    } else {
      setMessages([{ role: 'assistant', content: "Привет! Я помощник по мероприятиям в Москве. Расскажите про ваших детей \u2014 возраст и сколько их. Например: \u00abдочка 6 и сын 3\u00bb" }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedItems]);

  // Parse children via LLM
  const parseChildren = useCallback(async (text: string) => {
    setParsingChildren(true);
    setLoading(true);
    setMessages((prev) => [...prev, { role: 'user', content: text }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'parse_children', message: text }),
      });
      if (!res.ok) throw new Error('Failed to parse');
      const data = await res.json();
      const children = (data.children || []) as ChildProfile[];

      if (children.length === 0) {
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: "Не поняла. Опишите, пожалуйста, ваших детей. Например: \u00abдочка 6 и сын 3\u00bb",
        }]);
        return;
      }

      setParsedChildren(children);
      partialProfileRef.current.children = children;
      applyProfileFilters(partialProfileRef.current);
      setCurrentChildIndex(0);
      setSelectedItems(new Set());
      setOnboardingStep('q2_interests');
      const child = children[0];
      const label = child.name || (child.gender === 'girl' ? `вашу ${child.age}-летнюю дочку` : child.gender === 'boy' ? `вашего ${child.age}-летнего сына` : `вашего ${child.age}-летнего ребёнка`);
      setMessages((prev) => [...prev, { role: 'assistant', content: `Отлично! Что нравится ${label}?` }]);
    } catch {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: 'Что-то пошло не так. Попробуйте ещё раз \u2014 расскажите про детей.',
      }]);
    } finally {
      setParsingChildren(false);
      setLoading(false);
    }
  }, []);

  // Reset
  const resetProfile = useCallback(() => {
    localStorage.removeItem('pulseup_profile');
    setProfile(null);
    setOnboardingDone(false);
    setOnboardingStep('q1_children');
    setParsedChildren([]);
    setCurrentChildIndex(0);
    setSelectedItems(new Set());
    partialProfileRef.current = {};
    // Profile reset wipes filters too
    onFiltersChange({}, 'reset');
    setMessages([{ role: 'assistant', content: "Привет! Я помощник по мероприятиям в Москве. Расскажите про ваших детей \u2014 возраст и сколько их. Например: \u00abдочка 6 и сын 3\u00bb" }]);
  }, [onFiltersChange]);

  // Handle multi-select toggle
  const handleToggle = useCallback((item: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (onboardingStep === 'q3_neighborhoods') {
        if (item === 'Вся Москва') {
          return next.has(item) ? new Set() : new Set([item]);
        } else {
          next.delete('Вся Москва');
          if (next.has(item)) next.delete(item);
          else next.add(item);
          return next;
        }
      }
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  }, [onboardingStep]);

  // Handle multi-select Done
  const handleMultiDone = useCallback(() => {
    const selected = [...selectedItems];
    if (selected.length === 0) return;

    if (onboardingStep === 'q2_interests') {
      const updatedChildren = [...parsedChildren];
      updatedChildren[currentChildIndex] = { ...updatedChildren[currentChildIndex], interests: selected };
      setParsedChildren(updatedChildren);

      setMessages((prev) => [...prev, { role: 'user', content: selected.join(', ') }]);
      setSelectedItems(new Set());

      const nextIdx = currentChildIndex + 1;
      if (nextIdx < parsedChildren.length) {
        setCurrentChildIndex(nextIdx);
        const child = parsedChildren[nextIdx];
        const label = child.name || (child.gender === 'girl' ? `вашей ${child.age}-летней дочке` : child.gender === 'boy' ? `вашему ${child.age}-летнему сыну` : `вашему ${child.age}-летнему ребёнку`);
        setMessages((prev) => [...prev, { role: 'assistant', content: `Что нравится ${label}?` }]);
      } else {
        partialProfileRef.current.children = updatedChildren;
        applyProfileFilters(partialProfileRef.current);
        setOnboardingStep('q3_neighborhoods');
        setMessages((prev) => [...prev, { role: 'assistant', content: 'Какие округа Москвы вам интересны?' }]);
      }
    } else if (onboardingStep === 'q3_neighborhoods') {
      partialProfileRef.current.neighborhoods = selected;
      applyProfileFilters(partialProfileRef.current);
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: selected.join(', ') },
        { role: 'assistant', content: 'Какой у вас бюджет?', quickReplies: BUDGET_OPTIONS },
      ]);
      setSelectedItems(new Set());
      setOnboardingStep('q4_budget');
    }
  }, [selectedItems, onboardingStep, parsedChildren, currentChildIndex, applyProfileFilters]);

  // Handle skip (Q5)
  const handleSkip = useCallback(() => {
    partialProfileRef.current.specialNeeds = '';
    finishOnboarding();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Builds the final UserProfile from whatever we've collected. Called by
  // both email-step handlers (submit & skip) and the skip path when we decide
  // not to show the email ask at all.
  const buildFinalProfile = useCallback((): UserProfile => ({
    children: partialProfileRef.current.children || parsedChildren,
    neighborhoods: partialProfileRef.current.neighborhoods || [],
    budget: partialProfileRef.current.budget || 'Любой бюджет',
    specialNeeds: partialProfileRef.current.specialNeeds,
  }), [parsedChildren]);

  // Renders the "Готово! Вот ваш профиль…" summary and moves to `done`.
  // Split out of finishOnboarding so we can run it either straight after
  // q5_special (when email ask is suppressed) or after the q6_email step.
  const emitFinalSummary = useCallback((finalProfile: UserProfile) => {
    setOnboardingStep('done');
    const childrenDesc = finalProfile.children.map((c) =>
      `${genderEmoji(c.gender)} ${c.name || `${c.age} лет`} \u2014 ${c.interests.join(', ')}`
    ).join('\n');
    setMessages((prev) => [...prev, {
      role: 'assistant',
      content: `Готово! Вот ваш профиль:\n\n${childrenDesc}\n\uD83D\uDCCD ${finalProfile.neighborhoods.length ? finalProfile.neighborhoods.join(', ') : 'Вся Москва'}\n\uD83D\uDCB0 ${finalProfile.budget}${finalProfile.specialNeeds ? `\n\uD83D\uDCDD ${finalProfile.specialNeeds}` : ''}\n\nСпрашивайте что угодно про события!`,
    }]);
  }, []);

  // Called when the user finishes q5_special. Locks in the profile + filters
  // (so the feed is usable regardless of what they do next), then either
  // shows the email-ask step or jumps straight to the final summary when
  // suppressed (already subscribed on this device, or recently declined).
  const finishOnboarding = useCallback(() => {
    const finalProfile = buildFinalProfile();
    setProfile(finalProfile);
    storeProfile(finalProfile);
    setOnboardingDone(true);
    track('onboarding_completed', {
      children_count: finalProfile.children.length,
      neighborhoods_count: finalProfile.neighborhoods.length,
    });
    applyProfileFilters(finalProfile);

    // Skip email ask entirely for users who already acted on a previous visit.
    if (hasSubscribedEmail() || wasEmailRecentlyDeclined()) {
      emitFinalSummary(finalProfile);
      return;
    }

    // Personalized copy — use first child's name when provided, else describe
    // by age + gender. Falls back to "your family" if something odd happened.
    const first = finalProfile.children[0];
    const who = first?.name
      ? first.name
      : first
        ? `${first.gender === 'girl' ? 'вашей ' + first.age + '-летней дочки' : first.gender === 'boy' ? 'вашего ' + first.age + '-летнего сына' : 'вашего ' + first.age + '-летнего ребёнка'}`
        : 'вашей семьи';
    const where = finalProfile.neighborhoods.length > 0 && !finalProfile.neighborhoods.includes('Вся Москва')
      ? finalProfile.neighborhoods.join(', ')
      : 'Москвы';
    const content = `Последнее \u2014 присылать 10 свежих подборок для ${who} каждый четверг?\n\n\uD83D\uDCCD Подобрано под ${where} \u00B7 ${finalProfile.budget}\n\nОтписаться можно в любой момент.`;

    setOnboardingStep('q6_email');
    track('email_ask_shown', {
      source: 'chat_onboarding',
      has_child_name: !!first?.name,
    });
    setMessages((prev) => [...prev, { role: 'assistant', content }]);
  }, [buildFinalProfile, applyProfileFilters, emitFinalSummary]);

  // Email step — submit. POSTs to /api/subscribe, shows thank-you message,
  // then emits the final summary. Stays in q6_email on failure so the user
  // can retry without losing their place.
  const handleEmailSubmit = useCallback(async (email: string) => {
    setEmailSubmitting(true);
    setEmailError(undefined);
    const finalProfile = buildFinalProfile();
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          source: 'chat_onboarding',
          profile: finalProfile,
          referrer_url: typeof window !== 'undefined' ? window.location.href : undefined,
        }),
      });
      const data = await res.json().catch(() => ({ ok: false, error: 'Bad response' }));
      if (!res.ok || !data.ok) {
        setEmailError(data.error || 'Не удалось сохранить email. Попробовать ещё раз?');
        setEmailSubmitting(false);
        return;
      }
      try { localStorage.setItem(EMAIL_SUBSCRIBED_KEY, '1'); } catch { /* ignore */ }
      track('email_ask_submitted', {
        source: 'chat_onboarding',
        already_subscribed: data.created === false,
      });
      // Bind the anonymous PostHog user to a durable email-based identity.
      // This stitches their past anonymous events to the subscriber record so
      // we can build "signed-up users" cohorts, retention funnels, and
      // cross-device tracking.
      identifyUser(email.trim(), {
        already_subscribed: data.created === false,
        source: 'chat_onboarding',
      });
      // Show the user a brief confirmation echo, then the final summary.
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: email },
        { role: 'assistant', content: '\u2728 Готово \u2014 первая подборка придёт в четверг.' },
      ]);
      emitFinalSummary(finalProfile);
    } catch (err) {
      setEmailError('Сетевая ошибка. Попробовать ещё раз?');
      trackError({
        type: 'email_subscribe_failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setEmailSubmitting(false);
    }
  }, [buildFinalProfile, emitFinalSummary]);

  // Email step — skip. Record declined-at so we don't re-ask soon.
  const handleEmailSkip = useCallback(() => {
    try { localStorage.setItem(EMAIL_DECLINED_KEY, String(Date.now())); } catch { /* ignore */ }
    track('email_ask_skipped', { source: 'chat_onboarding' });
    const finalProfile = buildFinalProfile();
    emitFinalSummary(finalProfile);
  }, [buildFinalProfile, emitFinalSummary]);

  // Handle quick reply
  const handleQuickReply = useCallback((reply: string) => {
    if (onboardingStep === 'q4_budget') {
      partialProfileRef.current.budget = reply;
      applyProfileFilters(partialProfileRef.current);
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: reply },
        { role: 'assistant', content: 'Есть особые предпочтения? (аллергии, доступность, крытое/уличное и т.д.)', showSkip: true },
      ]);
      setOnboardingStep('q5_special');
    } else if (onboardingDone) {
      sendMessage(reply);
    }
  }, [onboardingStep, parsedChildren, applyProfileFilters, onboardingDone]);

  // Send message
  const sendMessage = useCallback(async (text?: string) => {
    const msgText = (text || input).trim();
    if (!msgText || loading) return;

    if (msgText.toLowerCase() === 'reset' || msgText.toLowerCase() === '/start') {
      setInput('');
      resetProfile();
      return;
    }

    if (onboardingStep === 'q1_children') {
      setInput('');
      await parseChildren(msgText);
      return;
    }

    if (onboardingStep === 'q5_special') {
      setInput('');
      setMessages((prev) => [...prev, { role: 'user', content: msgText }]);
      partialProfileRef.current.specialNeeds = msgText;
      finishOnboarding();
      return;
    }

    if (!onboardingDone) {
      setInput('');
      return;
    }

    const userMessage: ChatMessage = { role: 'user', content: msgText };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    trackChatMessageSent({
      message_length: msgText.length,
      has_active_filters: !!(filters && Object.keys(filters).length),
    });
    const __recsStart = Date.now();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msgText,
          history: newMessages.map((m) => ({ role: m.role, content: m.content })),
          profile,
        }),
      });

      if (!res.ok) throw new Error('Chat request failed');

      const data = await res.json();
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: data.message || 'I found some events for you.',
        events: data.events,
        filters: data.filters,
      }]);

      trackChatResponseReceived({
        query: msgText,
        events_count: (data.events?.length ?? data.total) || 0,
        latency_ms: Date.now() - __recsStart,
      });

      if (data.filters && Object.keys(data.filters).length > 0) {
        // AI-generated filters → tag as 'chat'
        onFiltersChange(data.filters, 'chat');
      }
    } catch (err) {
      trackError({ type: 'chat_request_failed', message: err instanceof Error ? err.message : String(err) });
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Извините, что-то пошло не так. Попробуйте ещё раз.' }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, filters, onFiltersChange, profile, onboardingDone, onboardingStep, parseChildren, finishOnboarding, resetProfile]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Multi-select state to pass to ChatMessages
  const multiSelectState: MultiSelectState | null = useMemo(() => {
    if (onboardingStep === 'q2_interests') {
      return {
        options: INTEREST_OPTIONS,
        selected: selectedItems,
        onToggle: handleToggle,
        onDone: handleMultiDone,
        doneLabel: 'Готово',
      };
    }
    if (onboardingStep === 'q3_neighborhoods') {
      return {
        options: NEIGHBORHOOD_OPTIONS,
        selected: selectedItems,
        onToggle: handleToggle,
        onDone: handleMultiDone,
        doneLabel: 'Готово',
      };
    }
    return null;
  }, [onboardingStep, selectedItems, handleToggle, handleMultiDone]);

  // Email-ask state — active only during q6_email.
  const emailAskState: EmailAskState | null = useMemo(() => {
    if (onboardingStep !== 'q6_email') return null;
    return {
      submitting: emailSubmitting,
      error: emailError,
      onSubmit: handleEmailSubmit,
      onSkip: handleEmailSkip,
    };
  }, [onboardingStep, emailSubmitting, emailError, handleEmailSubmit, handleEmailSkip]);

  // Placeholder text
  const placeholder = useMemo(() => {
    if (onboardingStep === 'q1_children') return 'например: «дочка 6 и сын 3»';
    if (onboardingStep === 'q5_special') return 'например: «нет орехов, доступно для коляски»';
    if (onboardingDone) return 'Спросите что угодно';
    return '';
  }, [onboardingStep, onboardingDone]);

  // Show input only for free-text steps and post-onboarding. Hide during
  // q6_email so the inline email input in the message is the only focus.
  const showInput =
    (onboardingStep === 'q1_children' ||
      onboardingStep === 'q5_special' ||
      onboardingDone) &&
    onboardingStep !== 'q6_email';

  const chatContent = (
    <div className="chat-sidebar-inner">
      {/* data-ph-no-capture: PostHog Session Replay will mask this area.
          It contains children's names/ages typed by the user and echoed
          in the AI chat, which counts as PII we never want recorded. */}
      <div className="chat-sidebar-messages" data-ph-no-capture>
        <ChatMessages
          messages={messages}
          isLoading={loading || parsingChildren}
          onEventClick={onEventClick}
          onQuickReply={handleQuickReply}
          multiSelectState={multiSelectState}
          emailAskState={emailAskState}
          onSkip={handleSkip}
        />
        <div ref={messagesEndRef} />
      </div>

      {showInput && (
        <div className="chat-sidebar-input">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              rows={2}
              data-ph-no-capture
              className="flex-1 resize-none px-3 py-2 border border-[rgba(255,255,255,0.15)] rounded-xl text-sm focus:outline-none focus:border-[#e91e63] max-h-32 bg-[#2a2760] text-white placeholder-gray-400"
              style={{ minHeight: 58 }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full text-white disabled:opacity-40 transition-opacity"
              style={{ backgroundColor: '#e91e63' }}
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <span className="text-lg leading-none">&uarr;</span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop: render inline (parent handles layout) */}
      <div className="hidden md:flex flex-col flex-1 min-h-0">{chatContent}</div>

      {/* Mobile: FAB + slide-up panel */}
      <button onClick={() => setMobileOpen(true)} className="chat-mobile-fab" style={{ backgroundColor: '#e91e63' }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {messages.length > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-white text-[#e91e63] text-xs font-bold rounded-full flex items-center justify-center">
            {messages.length}
          </span>
        )}
      </button>

      {mobileOpen && (
        <>
          <div className="chat-mobile-backdrop" onClick={() => setMobileOpen(false)} />
          <div className="chat-mobile-panel">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.08)]">
              <span className="font-semibold text-sm text-white">Pulse AI assistant</span>
              <button
                onClick={() => setMobileOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-white hover:bg-[rgba(255,255,255,0.06)]"
              >
                &#10005;
              </button>
            </div>
            {chatContent}
          </div>
        </>
      )}
    </>
  );
}
