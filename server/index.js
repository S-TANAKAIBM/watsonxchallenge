const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const https   = require('https');

const app  = express();
const PORT = 3000;

// ---------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------
// Select Territory Focus Products
// ---------------------------------------------------------------
const FOCUS_PRODUCTS = [
  'watsonx Orchestrate',
  'watsonx.governance',
  'watsonx Code Assistant',
  'watsonx.data',
  'Guardium',
  'Planning Analytics',
  'watsonx.data integration',
  'Terraform',
  'Cloudability',
  'Kubecost',
  'Instana',
  'Concert',
  'Vault',
  'Verify',
  'NS1',
  'Maximo',
  'webMethods Hybrid Integration',
  'PowerVS',
  'Fusion',
  'Flash'
];

// ---------------------------------------------------------------
// Config
// ---------------------------------------------------------------
const WATSONX_REGION  = 'jp-tok';
const WATSONX_URL     = `https://${WATSONX_REGION}.ml.cloud.ibm.com/ml/v1/text/generation?version=2024-05-01`;
const IAM_URL         = 'https://iam.cloud.ibm.com/identity/token';
const MODEL_ID        = 'meta-llama/llama-3-3-70b-instruct';
const KARUTE_DIR      = path.join(__dirname, '../karute');
const PROMPT_DIR      = path.join(__dirname, '../demo');
const WEBINAR_FILE    = path.join(__dirname, '../demo/webinars.json');
const REFERENCES_FILE = path.join(__dirname, '../demo/references.json');

if (!fs.existsSync(KARUTE_DIR)) fs.mkdirSync(KARUTE_DIR, { recursive: true });

// ---------------------------------------------------------------
// Helper: HTTP POST (native https, no axios needed)
// ---------------------------------------------------------------
function httpPost(urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const url  = new URL(urlStr);
    const data = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    const req  = https.request({
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers:  { ...headers, 'Content-Length': data.length }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${text}`));
        else resolve(JSON.parse(text));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------
// Helper: Get IAM Token
// ---------------------------------------------------------------
async function getIamToken(apiKey) {
  const res = await httpPost(
    IAM_URL,
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${encodeURIComponent(apiKey)}`
  );
  return res.access_token;
}

// ---------------------------------------------------------------
// Helper: Load prompt rules (up to "# Mode:" line)
// ---------------------------------------------------------------
function loadPromptRules(mode) {
  const files = { onboarding: 'prompt_onboarding_A.txt', nba: 'prompt_nba_B.txt', qbr: 'prompt_qbr_C.txt' };
  const file  = files[mode];
  if (!file) throw new Error(`Unknown mode: ${mode}`);
  const full  = fs.readFileSync(path.join(PROMPT_DIR, file), 'utf8');
  // Extract everything before "# Mode:" line (the rules section)
  const modeIdx = full.indexOf('\n# Mode:');
  return modeIdx >= 0 ? full.slice(0, modeIdx).trimEnd() : full;
}

// ---------------------------------------------------------------
// Helper: Build Webinar section from webinars.json
// ---------------------------------------------------------------
function buildWebinarSection(karute) {
  const webinars = loadWebinars();
  const introduced = karute && karute.introduced_webinars && karute.introduced_webinars.length > 0
    ? karute.introduced_webinars.join('、')
    : 'なし';

  const past   = webinars.filter(w => w.status === '過去' && (w.slide_url || w.video_url));
  const future = webinars.filter(w => w.status === '未来');

  let section = `\n## 利用可能なWebinarリソース\n以下のWebinarを顧客状況に応じて提案に活用すること。\n紹介済みWebinarがある場合は重複して提案しないこと。\n`;

  if (past.length > 0) {
    section += `\n### 過去実施済み（資料・動画を顧客に直接共有可能）\n| 日付 | 製品 | タイトル | 資料 | 動画 |\n|------|------|----------|------|------|\n`;
    past.forEach(w => {
      section += `| ${w.date} | ${w.product} | ${w.title} | ${w.slide_url || 'リンクなし'} | ${w.video_url || 'リンクなし'} |\n`;
    });
  }

  if (future.length > 0) {
    section += `\n### 今後の予定（参加案内として顧客に紹介可能）\n| 日付 | 製品 | タイトル |\n|------|------|----------|\n`;
    future.forEach(w => {
      section += `| ${w.date} | ${w.product} | ${w.title} |\n`;
    });
  }

  section += `\n## 紹介済みWebinar（重複案内防止）\n- 紹介済みWebinar：${introduced}（未記入の場合は「なし」として扱う）\n`;
  section += `\n## Webinar活用ルール\n- 顧客の契約製品と一致するWebinarのみを優先して提案する\n- 契約製品と一致するWebinarがない場合のみ、顧客の課題に関連するWebinarを提案してよい\n- 契約製品と無関係なWebinarは提案しない\n- 過去Webinarは「資料URL」「動画URL」をそのまま提案文に含める\n- 未来Webinarは「参加案内」として提案し、日付・タイトルを明記する\n- 資料・動画リンクがない場合は該当Webinarを提案しない\n- 提案できるWebinarが存在しない場合は「該当するWebinarなし」と明記する\n`;

  return section;
}

// ---------------------------------------------------------------
// Helper: Output format per mode
// ---------------------------------------------------------------
function buildOutputFormat(mode) {
  if (mode === 'onboarding') {
    return `\n## 出力フォーマット（必須）\n1. リスク診断（HIGH / MEDIUM / LOW + 根拠を3点以内で簡潔に）\n2. Human Touchが必要な理由（Tech Touchでは解決できない点を明示）\n3. 今週中に実施すべきCSMアクション（優先度順・期限付き・最大3点）\n   ※該当するWebinar資料・動画・参加案内がある場合はアクションにURLを含める\n4. 30日以内に実施すべきCSMアクション（最大3点）\n5. 顧客への連絡メール文面案（件名と本文）※必ず生成すること・Webinar案内がある場合は本文に含める\n6. 確認すべき追加情報（最大3点）\n`;
  }
  if (mode === 'nba') {
    return `\n## 健全性スコア判定基準（必ず適用すること）\n以下の条件を満たす場合はHIGH RISKと判定する：\n- NPSスコアが0未満 かつ 前回より10ポイント以上低下\n- 競合製品を比較検討中との情報がある\n- 契約更新まで6ヶ月以内\n- 上記3条件が2つ以上重なる場合は必ずHIGH RISKとすること\n\n## 出力フォーマット（必須）\n1. 顧客健全性スコア（HIGH RISK / MEDIUM / HEALTHY + 根拠3点以内）\n2. Human Touchが必要な理由（Tech Touchでは対処できない点を明示）\n3. Next Best Action TOP3（CSMが直接動くべきアクションのみ）\n   各アクションに以下を付記：目的 / 具体的な実施方法 / 期限 / 期待効果\n   ※該当するWebinar資料・動画・参加案内がある場合はアクションにURLを含める\n4. 避けるべきアクション（現状でやるとリスクになること・具体的に記載）\n5. 確認すべき追加情報（最大3点）\n`;
  }
  if (mode === 'qbr') {
    return `\n## 出力フォーマット（必須・スライド枚数は5〜7枚）\n1. エグゼクティブサマリー（3〜5文。経営層向け・顧客のKPIの言葉を使うこと）\n2. 今期の成果サマリー（KPIに対する達成状況を顧客の言葉で・達成/未達を明示）\n3. 課題と対応状況（積み残しを含む・言い訳にならず事実ベースで）\n4. 次期アクションアイテム（担当者・期限付きで3〜5点）\n   ※該当するWebinar資料・動画・参加案内がある場合はアクションにURLを含める\n5. 提案スライド骨子（スライドタイトルと各スライドの要点1〜2行・5〜7枚）\n6. 想定される顧客からの質問と回答案（2〜3点・厳しい質問も含めること）\n7. 確認すべき追加情報（最大3点）\n`;
  }
  return '';
}

// ---------------------------------------------------------------
// Helper: Mode header
// ---------------------------------------------------------------
function buildModeHeader(mode) {
  if (mode === 'onboarding') return `\n\n# Mode: Onboarding Support\n以下の顧客情報をもとに、オンボーディングの進捗を評価し、チャーンリスクと次のアクションを提案してください。\n`;
  if (mode === 'nba')        return `\n\n# Mode: Next Best Action\n以下の顧客情報をもとに、現時点でCSMが取るべき最優先アクション（Next Best Action）を提案してください。\n`;
  if (mode === 'qbr')        return `\n\n# Mode: QBR Preparation\n以下の顧客情報をもとに、四半期ビジネスレビュー（QBR）の資料ドラフトを生成してください。顧客自身のKPIと言葉を使い、成果とネクストステップを明確に伝える構成にしてください。\n`;
  return '';
}

// ---------------------------------------------------------------
// Helper: Load / Save karute
// ---------------------------------------------------------------
function loadKarute(icn) {
  const file = path.join(KARUTE_DIR, `${icn}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveKarute(icn, data) {
  const file = path.join(KARUTE_DIR, `${icn}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ---------------------------------------------------------------
// Helper: Load webinars
// ---------------------------------------------------------------
function loadWebinars() {
  if (!fs.existsSync(WEBINAR_FILE)) return [];
  return JSON.parse(fs.readFileSync(WEBINAR_FILE, 'utf8')).webinars || [];
}

// ---------------------------------------------------------------
// Helper: Load / Save / Add / Delete references
// ---------------------------------------------------------------
function loadReferences() {
  if (!fs.existsSync(REFERENCES_FILE)) return [];
  return JSON.parse(fs.readFileSync(REFERENCES_FILE, 'utf8')).references || [];
}

function saveReferences(refs) {
  const current = fs.existsSync(REFERENCES_FILE)
    ? JSON.parse(fs.readFileSync(REFERENCES_FILE, 'utf8'))
    : {};
  current.references  = refs;
  current.last_updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(REFERENCES_FILE, JSON.stringify(current, null, 2), 'utf8');
}

// ---------------------------------------------------------------
// Helper: Build References section for prompt
// ---------------------------------------------------------------
function buildReferencesSection(products) {
  const all = loadReferences().filter(r => r.enabled);
  if (all.length === 0) return '';

  // 契約製品に関連するものを優先し、残りも含める（全件渡す）
  const productList = (products || '').toLowerCase();
  const matched   = all.filter(r => r.products && r.products.some(p => productList.includes(p.toLowerCase())));
  const unmatched = all.filter(r => !matched.includes(r));
  const ordered   = [...matched, ...unmatched];

  let section = `\n## 参照情報（成功事例・公式事例・BP実績）\n以下の情報をアクション提案・メール文面・QBRドラフトの根拠・説得材料として積極的に活用すること。\n`;

  ordered.forEach(r => {
    const typeLabel = { ibm_case: 'IBM公式事例', bp_case: 'BP実績', partner_case: 'パートナー事例', other: 'その他' }[r.type] || r.type;
    section += `\n### [${typeLabel}] ${r.title}\n`;
    if (r.industry) section += `- 業界：${r.industry}\n`;
    if (r.products && r.products.length > 0) section += `- 関連製品：${r.products.join('、')}\n`;
    section += `- 内容：${r.summary}\n`;
    if (r.url) section += `- 参照URL：${r.url}\n`;
  });

  return section;
}

// ---------------------------------------------------------------
// Helper: Build prompt from form data
// ---------------------------------------------------------------
function buildPrompt(mode, formData, karute) {
  const rules   = loadPromptRules(mode);
  const header  = buildModeHeader(mode);
  const context = buildContext(mode, formData);
  const webinar = buildWebinarSection(karute);
  const refs    = buildReferencesSection(formData.products);
  const format  = buildOutputFormat(mode);

  return rules + header + context + refs + webinar + format;
}

function buildContext(mode, d) {
  if (mode === 'onboarding') {
    return `## 顧客基本情報
- 会社名・業界：${d.company_name || '不明'} / ${d.industry || '不明'}
- 会社規模：${d.company_size || '不明'}
- 契約製品：${d.products || '不明'}
- 契約ライセンス数：${d.license_count || '不明'}
- 契約開始日：${d.contract_start_date || '不明'}
- 導入フェーズ：${d.phase || '不明'}

## 利用状況
- 登録済みユーザー数：${d.registered_users || '不明'}
- 直近30日のアクティブユーザー数：${d.active_users || '不明'}
- ユースケース実装状況：${d.usecase_status || '不明'}
- サポートチケット件数（直近）：${d.ticket_count || '不明'}
- チケットの主な内容：${d.ticket_summary || '不明'}
- NPS / CSATスコア：${d.nps_score || '未回収'}

## 顧客組織
- 主担当者の役職・権限：${d.contact_role || '不明'}
- 社内チャンピオンの有無：${d.champion || '不明'}
- 意思決定者との接触状況：${d.executive_contact || '不明'}

## パートナー・関与者情報
- BP名・会社名：${d.bp_name || '不明'}
- BPの経験レベル：${d.bp_experience || '不明'}
- BPと顧客との関係性：${d.bp_relationship || '不明'}
- IBM-Cの関与：${d.ibm_c_involved || 'なし'}
- TELの関与：${d.tel_involved || 'なし'}

## 活動履歴・文脈
- 直近の議事録サマリー：${d.meeting_notes || '不明'}
- 顧客から挙がっている課題・懸念：${d.customer_concerns || '不明'}
- 類似業界の成功事例：${d.success_cases || '不明'}

`;
  }

  if (mode === 'nba') {
    return `## 顧客基本情報
- 会社名・業界：${d.company_name || '不明'} / ${d.industry || '不明'}
- 会社規模：${d.company_size || '不明'}
- 契約製品・ライセンス数：${d.products || '不明'} / ${d.license_count || '不明'}
- 導入フェーズ：${d.phase || '不明'}
- 契約更新日：${d.renewal_date || '不明'}

## 健全性指標
- 直近30日アクティブユーザー率：${d.active_rate || '不明'}
- NPS / CSATスコア：${d.nps_score || '不明'}
- サポートチケット傾向：${d.ticket_trend || '不明'}
- 前回コンタクトからの経過日数：${d.days_since_contact || '不明'}
- ユースケース実装率：${d.usecase_rate || '不明'}

## パートナー・関与者情報
- BP名・会社名：${d.bp_name || '不明'}
- BPの経験レベル：${d.bp_experience || '不明'}
- BPと顧客との関係性：${d.bp_relationship || '不明'}
- IBM-Cの関与：${d.ibm_c_involved || 'なし'}
- TELの関与：${d.tel_involved || 'なし'}

## リスク・機会シグナル
- 顧客から挙がっている懸念・不満：${d.risk_signals || '不明'}
- 競合・代替ツールの状況：${d.competitor_info || '不明'}
- アップセル・拡張の兆候：${d.upsell_signals || '不明'}
- 予算・投資意向：${d.budget_info || '不明'}

## 活動履歴・文脈
- 直近の議事録サマリー：${d.meeting_notes || '不明'}
- 過去のエスカレーション履歴：${d.escalation_history || '不明'}
- 類似業界の成功事例・ベストプラクティス：${d.success_cases || '不明'}

`;
  }

  if (mode === 'qbr') {
    return `## 顧客基本情報
- 会社名・業界：${d.company_name || '不明'} / ${d.industry || '不明'}
- 契約製品：${d.products || '不明'}
- 対象期間：${d.review_period || '不明'}

## 顧客が定義したKPI・成功指標
${d.customer_kpis || '不明'}

## 今期の実績データ
- アクティブユーザー率：${d.active_rate || '不明'}
- ユースケース実装状況：${d.usecase_status || '不明'}
- サポートチケット件数・傾向：${d.ticket_summary || '不明'}
- NPS / CSATスコア：${d.nps_score || '不明'}
- その他定量実績：${d.other_metrics || '不明'}

## パートナー・関与者情報
- BP名・会社名：${d.bp_name || '不明'}
- BPの経験レベル：${d.bp_experience || '不明'}
- BPと顧客との関係性：${d.bp_relationship || '不明'}
- IBM-Cの関与：${d.ibm_c_involved || 'なし'}
- TELの関与：${d.tel_involved || 'なし'}

## 前回QBRの振り返り
- 前回のアクションアイテムと達成状況：${d.prev_actions || '不明'}

## 次期に向けた情報
- 顧客の次期ビジネス目標：${d.next_biz_goal || '不明'}
- 提案したいオプション・追加製品：${d.upsell_options || '不明'}

`;
  }

  return '';
}

// ---------------------------------------------------------------
// API: GET /api/karute/:icn
// ---------------------------------------------------------------
app.get('/api/karute/:icn', (req, res) => {
  const karute = loadKarute(req.params.icn);
  if (!karute) return res.status(404).json({ error: 'Karute not found' });
  res.json(karute);
});

// ---------------------------------------------------------------
// API: GET /api/webinars
// ---------------------------------------------------------------
app.get('/api/webinars', (req, res) => {
  res.json(loadWebinars());
});

// ---------------------------------------------------------------
// API: GET /api/products  (Focus Product list)
// ---------------------------------------------------------------
app.get('/api/products', (req, res) => {
  res.json(FOCUS_PRODUCTS);
});

// ---------------------------------------------------------------
// API: GET /api/references
// ---------------------------------------------------------------
app.get('/api/references', (req, res) => {
  res.json(loadReferences());
});

// ---------------------------------------------------------------
// API: POST /api/references  (add new)
// ---------------------------------------------------------------
app.post('/api/references', (req, res) => {
  const { title, type, summary, products, industry, url } = req.body;
  if (!title || !summary) return res.status(400).json({ error: 'title and summary are required' });
  const refs = loadReferences();
  const newRef = {
    id:       `ref-${Date.now()}`,
    type:     type || 'other',
    title,
    summary,
    products: Array.isArray(products) ? products : (products ? [products] : []),
    industry: industry || '',
    url:      url || '',
    enabled:  true
  };
  refs.push(newRef);
  saveReferences(refs);
  res.json(newRef);
});

// ---------------------------------------------------------------
// API: PATCH /api/references/:id  (toggle enabled)
// ---------------------------------------------------------------
app.patch('/api/references/:id', (req, res) => {
  const refs = loadReferences();
  const idx  = refs.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  Object.assign(refs[idx], req.body);
  saveReferences(refs);
  res.json(refs[idx]);
});

// ---------------------------------------------------------------
// API: DELETE /api/references/:id
// ---------------------------------------------------------------
app.delete('/api/references/:id', (req, res) => {
  let refs = loadReferences();
  const before = refs.length;
  refs = refs.filter(r => r.id !== req.params.id);
  if (refs.length === before) return res.status(404).json({ error: 'Not found' });
  saveReferences(refs);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// API: POST /api/analyze
// ---------------------------------------------------------------
app.post('/api/analyze', async (req, res) => {
  const { mode, formData, icn } = req.body;

  const apiKey = process.env.WATSONX_API_KEY;
  const projectId = process.env.WATSONX_PROJECT_ID;

  if (!apiKey)     return res.status(500).json({ error: 'WATSONX_API_KEY not set' });
  if (!projectId)  return res.status(500).json({ error: 'WATSONX_PROJECT_ID not set' });
  if (!mode)       return res.status(400).json({ error: 'mode is required' });
  if (!formData)   return res.status(400).json({ error: 'formData is required' });

  try {
    // Load karute if ICN provided
    const karute = icn ? loadKarute(icn) : null;

    // Build prompt
    const prompt = buildPrompt(mode, formData, karute);

    // Get IAM token
    const token = await getIamToken(apiKey);

    // Call Watsonx.ai
    const result = await httpPost(
      WATSONX_URL,
      { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      {
        model_id:   MODEL_ID,
        project_id: projectId,
        input:      prompt,
        parameters: {
          decoding_method:    'greedy',
          max_new_tokens:     1500,
          min_new_tokens:     100,
          repetition_penalty: 1.1
        }
      }
    );

    const generatedText = result.results[0].generated_text;
    const tokenCount    = result.results[0].generated_token_count;

    // Detect risk level
    let riskLevel = 'UNKNOWN';
    if (/HIGH RISK/i.test(generatedText))        riskLevel = 'HIGH RISK';
    else if (/MEDIUM/i.test(generatedText))      riskLevel = 'MEDIUM';
    else if (/HEALTHY|LOW/i.test(generatedText)) riskLevel = 'HEALTHY';

    // Save / update karute if ICN provided
    if (icn) {
      let k = karute || {
        icn,
        company_name:        formData.company_name || '（未入力）',
        contracted_products: [],
        last_updated:        new Date().toISOString().slice(0, 10),
        current_state:       {},
        history:             [],
        introduced_webinars: []
      };
      k.company_name = formData.company_name || k.company_name;
      k.last_updated = new Date().toISOString().slice(0, 10);

      // contracted_products を更新（選択中の製品情報をマージ）
      if (!k.contracted_products) k.contracted_products = [];
      if (formData.products) {
        const existing = k.contracted_products.find(p => p.name === formData.products);
        if (existing) {
          // 既存製品を更新
          if (formData.license_count)       existing.license_count       = formData.license_count;
          if (formData.contract_start_date) existing.contract_start_date = formData.contract_start_date;
          if (formData.renewal_date)        existing.renewal_date        = formData.renewal_date;
        } else {
          // 新製品を追加
          k.contracted_products.push({
            name:                formData.products,
            license_count:       formData.license_count       || '',
            contract_start_date: formData.contract_start_date || '',
            renewal_date:        formData.renewal_date        || ''
          });
        }
      }

      k.current_state = {
        phase:         formData.phase         || k.current_state?.phase,
        active_rate:   formData.active_rate   || k.current_state?.active_rate,
        nps_score:     formData.nps_score     || k.current_state?.nps_score,
        bp_name:       formData.bp_name       || k.current_state?.bp_name,
        bp_experience: formData.bp_experience || k.current_state?.bp_experience
      };
      if (!k.history) k.history = [];
      k.history.push({
        date:       new Date().toISOString().slice(0, 16).replace('T', ' '),
        mode,
        product:    formData.products || '',
        risk_level: riskLevel
      });
      saveKarute(icn, k);
    }

    res.json({ text: generatedText, tokenCount, riskLevel });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// Static files (registered after API routes to avoid interception)
app.use(express.static(path.join(__dirname, '../public')));

// ---------------------------------------------------------------
// Start
// ---------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\nAI Customer Success Coach Server`);
  console.log(`http://localhost:${PORT}`);
  console.log(`\nReady. Open your browser.\n`);
});
