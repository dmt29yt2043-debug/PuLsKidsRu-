/**
 * Chat Relevance Evaluation Script
 *
 * Tests 25 real-world NYC parent queries against the production chat API,
 * uses GPT-4o-mini as a judge to score relevance, and diagnoses whether
 * problems are in the database or the pipeline.
 *
 * Usage: npx tsx scripts/eval-chat.ts
 */

import OpenAI from 'openai';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

// ─── Config ───
const CHAT_API_URL = process.env.EVAL_CHAT_URL || 'https://pulseup-v2.srv1362562.hstgr.cloud/api/chat';
const SCENARIOS_PATH = path.join(process.cwd(), 'scripts', 'eval-scenarios.json');
const RESULTS_PATH = path.join(process.cwd(), 'reports', 'eval-results.json');
const SUMMARY_PATH = path.join(process.cwd(), 'reports', 'eval-summary.md');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Types ───
interface ChildProfile { age: number; gender: string; name?: string; interests: string[]; }
interface UserProfile { children: ChildProfile[]; neighborhoods: string[]; budget: string; specialNeeds?: string; }
interface Scenario { id: number; category: string; query: string; expectedIntent: string; }
interface ApiEvent { id: number; title: string; venue_name?: string; next_start_at?: string; is_free?: boolean; price_summary?: string; age_label?: string; category_l1?: string; }
interface ChatApiResponse { message: string; filters: Record<string, unknown>; events: ApiEvent[]; total?: number; }

interface EvalResult {
  id: number;
  category: string;
  query: string;
  expectedIntent: string;
  extractedFilters: Record<string, unknown>;
  eventsReturned: number;
  topEvents: string[];
  chatResponse: string;
  latencyMs: number;
  relevanceScore: number;
  completenessScore: number;
  ageFitScore: number;
  diagnosis: 'db_gap' | 'pipeline_issue' | 'good_match' | 'partial_match';
  judgeExplanation: string;
}

// ─── Chat API call ───
async function callChatApi(query: string, profile: UserProfile): Promise<{ data: ChatApiResponse; latencyMs: number }> {
  const start = Date.now();
  const res = await fetch(CHAT_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: query, profile }),
  });
  const latencyMs = Date.now() - start;
  if (!res.ok) throw new Error(`Chat API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as ChatApiResponse;
  return { data, latencyMs };
}

// ─── Broader search via the same API (no profile filters → wide net) ───
async function broaderSearch(query: string): Promise<ApiEvent[]> {
  try {
    const res = await fetch(CHAT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Show me anything related to: ${query}` }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as ChatApiResponse;
    return data.events || [];
  } catch {
    return [];
  }
}

// ─── Judge ───
async function judgeResult(
  scenario: Scenario,
  profile: UserProfile,
  result: ChatApiResponse,
  broaderEvents: ApiEvent[],
): Promise<{ relevanceScore: number; completenessScore: number; ageFitScore: number; diagnosis: 'db_gap' | 'pipeline_issue' | 'good_match' | 'partial_match'; explanation: string; }> {
  const eventList = (result.events || []).slice(0, 10).map((e) =>
    `- ${e.title} | ${e.venue_name || '?'} | ${e.next_start_at || '?'} | ${e.is_free ? 'Free' : e.price_summary || '?'} | ${e.age_label || 'no age info'}`
  ).join('\n') || '(no events returned)';

  const broaderList = broaderEvents.slice(0, 10).map((e) =>
    `- ${e.title} | ${e.category_l1 || 'uncategorized'} | ${e.age_label || 'no age'}`
  ).join('\n') || '(no broader events found)';

  const judgePrompt = `You are evaluating a family event discovery chatbot for NYC parents.

USER PROFILE:
- Children: ${profile.children.map((c) => `${c.name || 'child'} ${c.age}yo (${c.gender}), interests: ${c.interests.join(', ')}`).join('; ')}
- Neighborhoods: ${profile.neighborhoods.join(', ')}
- Budget: ${profile.budget}

USER QUERY: "${scenario.query}"
EXPECTED INTENT: ${scenario.expectedIntent}

EXTRACTED FILTERS: ${JSON.stringify(result.filters)}

EVENTS RETURNED (${(result.events || []).length}):
${eventList}

BROADER DATABASE SEARCH (results when filters are loosened):
${broaderList}

CHATBOT RESPONSE: "${result.message}"

Rate on 1-5 scale:
1. RELEVANCE: How relevant are returned events to the query? (1=wrong, 5=perfect)
2. COMPLETENESS: Did the system find all relevant events it could? (1=missed all, 5=found all)
3. AGE_FIT: Are events age-appropriate for kids ages ${profile.children.map((c) => c.age).join(', ')}? (1=wrong, 5=perfect)

DIAGNOSIS (pick one):
- "good_match": Events relevant, system worked well
- "partial_match": Some relevant events but could be better
- "pipeline_issue": Relevant events EXIST in DB (see broader search) but system didn't surface them
- "db_gap": No relevant events exist in the database for this query

Respond ONLY with valid JSON:
{"relevanceScore": <1-5>, "completenessScore": <1-5>, "ageFitScore": <1-5>, "diagnosis": "<good_match|partial_match|pipeline_issue|db_gap>", "explanation": "<1-2 sentences>"}`;

  const judge = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: judgePrompt }],
  });

  try {
    return JSON.parse(judge.choices[0].message.content || '{}');
  } catch {
    return { relevanceScore: 1, completenessScore: 1, ageFitScore: 1, diagnosis: 'pipeline_issue', explanation: 'Judge parse error' };
  }
}

// ─── Summary ───
function generateSummary(results: EvalResult[]): string {
  const n = results.length || 1;
  const avgRelevance = (results.reduce((s, r) => s + r.relevanceScore, 0) / n).toFixed(1);
  const avgCompleteness = (results.reduce((s, r) => s + r.completenessScore, 0) / n).toFixed(1);
  const avgAgeFit = (results.reduce((s, r) => s + r.ageFitScore, 0) / n).toFixed(1);
  const avgLatency = Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / n);

  const diagCounts = { good_match: 0, partial_match: 0, pipeline_issue: 0, db_gap: 0 };
  results.forEach((r) => { diagCounts[r.diagnosis]++; });

  const categories = [...new Set(results.map((r) => r.category))];
  const byCategory = categories.map((cat) => {
    const cr = results.filter((r) => r.category === cat);
    return { category: cat, avgRelevance: (cr.reduce((s, r) => s + r.relevanceScore, 0) / cr.length).toFixed(1), count: cr.length };
  });

  const failures = results.filter((r) => r.relevanceScore <= 2);
  const pipelineIssues = results.filter((r) => r.diagnosis === 'pipeline_issue');
  const dbGaps = results.filter((r) => r.diagnosis === 'db_gap');

  let md = `# Chat Relevance Evaluation Report\n\n`;
  md += `**Date:** ${new Date().toISOString().split('T')[0]}\n`;
  md += `**Endpoint:** ${CHAT_API_URL}\n`;
  md += `**Scenarios tested:** ${results.length}\n`;
  md += `**Avg latency:** ${avgLatency}ms\n\n`;

  md += `## Overall Scores\n\n| Metric | Score (1-5) |\n|--------|------------|\n`;
  md += `| Relevance | **${avgRelevance}** |\n| Completeness | **${avgCompleteness}** |\n| Age Appropriateness | **${avgAgeFit}** |\n\n`;

  md += `## Diagnosis Breakdown\n\n| Diagnosis | Count | % |\n|-----------|-------|---|\n`;
  Object.entries(diagCounts).forEach(([k, v]) => { md += `| ${k} | ${v} | ${((v / n) * 100).toFixed(0)}% |\n`; });

  md += `\n## Scores by Category\n\n| Category | Avg Relevance | Queries |\n|----------|--------------|--------|\n`;
  byCategory.forEach((c) => { md += `| ${c.category} | ${c.avgRelevance} | ${c.count} |\n`; });

  if (failures.length) {
    md += `\n## Failures (Relevance ≤ 2)\n\n`;
    failures.forEach((f) => {
      md += `### Q${f.id}: "${f.query}"\n- **Diagnosis:** ${f.diagnosis}\n- **Filters:** \`${JSON.stringify(f.extractedFilters)}\`\n- **Events returned:** ${f.eventsReturned}\n- **Judge:** ${f.judgeExplanation}\n\n`;
    });
  }
  if (pipelineIssues.length) {
    md += `\n## Pipeline Issues (events exist but weren't found)\n\n`;
    pipelineIssues.forEach((p) => { md += `- **Q${p.id}:** "${p.query}" — ${p.judgeExplanation}\n`; });
  }
  if (dbGaps.length) {
    md += `\n## Database Gaps (no relevant events exist)\n\n`;
    dbGaps.forEach((d) => { md += `- **Q${d.id}:** "${d.query}" — ${d.judgeExplanation}\n`; });
  }

  md += `\n## All Results\n\n| # | Query | Relevance | Diagnosis | Events | Top Event |\n|---|-------|-----------|-----------|--------|----------|\n`;
  results.forEach((r) => {
    md += `| ${r.id} | ${r.query.substring(0, 40)} | ${r.relevanceScore}/5 | ${r.diagnosis} | ${r.eventsReturned} | ${(r.topEvents[0] || 'none').substring(0, 35)} |\n`;
  });

  return md;
}

// ─── Main ───
async function main() {
  console.log('🧪 Starting Chat Relevance Evaluation...\n');
  console.log(`📡 Endpoint: ${CHAT_API_URL}\n`);

  const scenarioData = JSON.parse(fs.readFileSync(SCENARIOS_PATH, 'utf-8'));
  const profile: UserProfile = scenarioData.profile;
  const scenarios: Scenario[] = scenarioData.scenarios;

  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });

  const results: EvalResult[] = [];

  for (const scenario of scenarios) {
    process.stdout.write(`  [${scenario.id}/${scenarios.length}] "${scenario.query}" ... `);

    try {
      const { data: chatResult, latencyMs } = await callChatApi(scenario.query, profile);
      const broaderEvents = await broaderSearch(scenario.query);
      const judgment = await judgeResult(scenario, profile, chatResult, broaderEvents);

      const evalResult: EvalResult = {
        id: scenario.id,
        category: scenario.category,
        query: scenario.query,
        expectedIntent: scenario.expectedIntent,
        extractedFilters: chatResult.filters || {},
        eventsReturned: (chatResult.events || []).length,
        topEvents: (chatResult.events || []).slice(0, 3).map((e) => e.title),
        chatResponse: chatResult.message,
        latencyMs,
        relevanceScore: judgment.relevanceScore,
        completenessScore: judgment.completenessScore,
        ageFitScore: judgment.ageFitScore,
        diagnosis: judgment.diagnosis,
        judgeExplanation: judgment.explanation,
      };
      results.push(evalResult);
      const emoji = judgment.relevanceScore >= 4 ? '✅' : judgment.relevanceScore >= 3 ? '🟡' : '❌';
      console.log(`${emoji} ${judgment.relevanceScore}/5 [${judgment.diagnosis}] ${latencyMs}ms`);
    } catch (err) {
      console.log(`❌ ERROR: ${err}`);
      results.push({
        id: scenario.id, category: scenario.category, query: scenario.query, expectedIntent: scenario.expectedIntent,
        extractedFilters: {}, eventsReturned: 0, topEvents: [], chatResponse: '', latencyMs: 0,
        relevanceScore: 0, completenessScore: 0, ageFitScore: 0, diagnosis: 'pipeline_issue', judgeExplanation: `Error: ${err}`,
      });
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
  console.log(`\n📄 Results saved to ${RESULTS_PATH}`);
  fs.writeFileSync(SUMMARY_PATH, generateSummary(results));
  console.log(`📊 Summary saved to ${SUMMARY_PATH}`);

  const n = results.length;
  const avg = (results.reduce((s, r) => s + r.relevanceScore, 0) / n).toFixed(1);
  const good = results.filter((r) => r.diagnosis === 'good_match').length;
  const partial = results.filter((r) => r.diagnosis === 'partial_match').length;
  const pipeline = results.filter((r) => r.diagnosis === 'pipeline_issue').length;
  const dbGap = results.filter((r) => r.diagnosis === 'db_gap').length;
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  OVERALL RELEVANCE: ${avg}/5`);
  console.log(`  ✅ Good: ${good}  🟡 Partial: ${partial}  🔧 Pipeline: ${pipeline}  📭 DB gap: ${dbGap}`);
  console.log(`${'═'.repeat(50)}\n`);
}

main().catch(console.error);
