/**
 * Tool wrapper for the medical knowledge retriever.
 *
 * Always advertised — the FSHD KB is public information, no consent
 * gate. The planner is expected to call this for anything that looks
 * like a "what / why / how" question about the disease, treatment, or
 * mechanism, regardless of whether patient data is also requested.
 */

import type { ITool, ToolContext, ToolExecutionResult } from './base.js';
import { ToolValidationError, isPlainObject, safeParseJson } from './base.js';
import type { RetrieveResult } from '../retrievers/base.js';
import type { MedicalKbRetriever } from '../retrievers/medical-kb.js';

interface SearchMedicalKbArgs {
  query: string;
  queries?: string[];
  limit?: number;
  category?: string;
}

/**
 * The corpus's own top-level folders, which the ingester stores verbatim
 * as `kb_chunks.metadata->>'category'` (scripts/kb-ingest.py
 * `_derive_metadata_from_path`).
 *
 * Read out of the live table, not invented. Measured 2026-08-11 over
 * 10,241 chunks / 211 source files with
 *
 *   select coalesce(nullif(metadata->>'category',''),'<root>'), count(*)
 *     from kb_chunks group by 1 order by 2 desc;
 *
 *   文献                5,009    AFO                  550
 *   (corpus root)       1,746    05.相关研究           401
 *   08.无障碍生活         656    04.营养与生活方式     379
 *   06.政策与倡导教育     405    02.临床管理与治疗     342
 *   10.心理支持           170    03.遗传生育           166
 *   01.疾病定义和科普     153    11.病友经验           150
 *   指南共识               51    09.辅助器械            45
 *   孕期                    9    12.资源库               6
 *   07.项目活动             3
 *
 * Why the filter exists at all: the shape of that list IS the problem.
 * 5,009 chunks of English molecular-biology papers — just under half the
 * corpus — sit on the same single cosine axis as the 150 chunks of
 * 病友经验, moderated only by a 0.00–0.03 authority penalty. A patient
 * asking「确诊后怎么调整心态」was competing against half the corpus for
 * eight slots.
 *
 * The 1,746 root-level chunks (papers and abstract books filed directly
 * at the corpus root) carry `category: ""` and therefore match NO value
 * in this list. Any filter excludes them — which is exactly why the
 * description below tells the model to omit the argument when unsure,
 * and why the retriever widens to the whole corpus when a filtered
 * search comes back empty.
 *
 * A chunk count is not a size, and 08.无障碍生活 is the proof: 534 of its
 * 656 chunks are one document,《中国康复辅助器具目录（2023年版）》, split
 * on its own device codes. Median length 119 characters, shortest 35,
 * against a 621–1,105 median in every other category above 100 chunks.
 * Those 534 chunks hold 80,629 characters; the category's eleven other
 * files hold 96,047 in 122. So on chunks 08.无障碍生活 outweighs
 * 11.病友经验 four to one, and on text it does not.
 *
 * That is why the model-facing description below no longer quotes any of
 * these numbers. A census interpolated into a prompt string is stale the
 * next time anyone runs the ingest, nothing can test it (the tool's test
 * can see the string, never the table), and even fresh it is the wrong
 * statistic to route on. The description says what each category holds
 * and what shape it is in; the numbers live here, dated, next to the
 * query that reproduces them.
 */
export const KB_CATEGORIES = [
  '01.疾病定义和科普',
  '02.临床管理与治疗',
  '03.遗传生育',
  '04.营养与生活方式',
  '05.相关研究',
  '06.政策与倡导教育',
  '07.项目活动',
  '08.无障碍生活',
  '09.辅助器械',
  '10.心理支持',
  '11.病友经验',
  '12.资源库',
  'AFO',
  '孕期',
  '指南共识',
  '文献',
] as const;

export const CATEGORY_DESCRIPTION = [
  '可选。把检索限制在知识库的一个类目里。',
  '什么时候用：问题明显落在某一个类目，而且通用检索容易被英文分子生物学文献淹没时（心理、无障碍、政策、病友经历这类中文类目最需要）——「文献」一个类目就占了全库将近一半。',
  '什么时候不要用：不确定、问题跨类目、或者问的是疾病机制/研究进展这种全库都相关的内容——不传这个参数就是全库检索，那是默认且安全的选择。',
  '注意：语料库根目录下还有一批论文和会议摘要集，它们不属于任何类目，一旦加了过滤就搜不到。',
  '可选值：',
  '- 01.疾病定义和科普：FSHD 是什么、分子诊断、分型、事实清单',
  '- 02.临床管理与治疗：康复、手术与麻醉注意事项、评估与随访、治疗选择',
  '- 03.遗传生育：遗传方式、基因检测、遗传咨询、胚胎植入前检测',
  '- 04.营养与生活方式：营养状况、饮食、日常生活方式',
  '- 05.相关研究：在研药物、临床试验、机制研究进展',
  '- 06.政策与倡导教育：中国罕见病政策、医保与审评、患者组织与倡导',
  '- 07.项目活动：本平台的甲基化筛查等项目招募与流程（只有寥寥几条）',
  '- 08.无障碍生活：无障碍环境建设法、残疾人就业与出行；此外绝大部分条目是《中国康复辅助器具目录（2023年版）》的编码表行，一行一个器具编码、很短。问法规和权益时它们是噪音，问「某个辅具在国家目录里属于哪一类」时它们正是答案',
  '- 09.辅助器械：辅助技术与辅具服务（篇幅很小，辅具目录本身在 08. 下）',
  '- 10.心理支持：确诊后的心理调适、怎么跟家人和孩子谈病情',
  '- 11.病友经验：患者自述与经验分享（求医、麻醉、生活）',
  '- 12.资源库：合作门诊、康复医师网络、社区简介等本地资源（只有寥寥几条）',
  '- AFO：踝足矫形器与步态/平衡相关研究',
  '- 孕期：FSHD 女性的怀孕、分娩（只有寥寥几条）',
  '- 指南共识：荷兰 FSHD 指南等成文指南（注意：多数指南其实归档在 01./02./03. 下）',
  '- 文献：英文期刊论文与预印本，绝大多数是分子生物学，也是全库最大的类目',
].join('\n');

const PARAMETERS_SCHEMA = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: "The user's question, rephrased into a single concise search query. Required.",
    },
    queries: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Optional extra phrasings of the same question (synonyms, medical terms, English/Chinese variants). 3-5 entries work well.',
      maxItems: 6,
    },
    limit: {
      type: 'integer',
      description: 'Max chunks to return. Defaults to 8.',
      minimum: 1,
      maximum: 20,
    },
    category: {
      type: 'string',
      enum: [...KB_CATEGORIES],
      description: CATEGORY_DESCRIPTION,
    },
  },
  required: ['query'],
  additionalProperties: false,
} as const;

/**
 * Alias -> canonical category. Built from `KB_CATEGORIES` itself, so it
 * can never drift from the corpus.
 *
 * The only aliases are the same string without its `NN.` filing prefix
 * and a case-folded form: a model that has read the list still writes
 *「病友经验」or「afo」about as often as the exact folder name, and
 * failing that call would spend a whole turn to learn something we
 * already know. This is NOT a keyword->category map — nothing here
 * translates a question into a category, it only canonicalises a value
 * the model already chose.
 */
const CATEGORY_BY_ALIAS = new Map<string, string>();
for (const category of KB_CATEGORIES) {
  CATEGORY_BY_ALIAS.set(category.toLowerCase(), category);
  const withoutPrefix = category.replace(/^\d{2}\./, '');
  if (withoutPrefix !== category) {
    CATEGORY_BY_ALIAS.set(withoutPrefix.toLowerCase(), category);
  }
}

const resolveCategory = (raw: unknown): string | undefined => {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') {
    throw new ToolValidationError('`category` must be a string.');
  }
  const trimmed = raw.trim();
  // An empty string is a legal category in the corpus (the 1,746
  // root-level chunks carry one), but a model emitting "" means「none」,
  // not「search only the root papers」. Read it as omitted.
  if (!trimmed) return undefined;
  const resolved = CATEGORY_BY_ALIAS.get(trimmed.toLowerCase());
  if (!resolved) {
    throw new ToolValidationError(
      `Unknown \`category\` "${trimmed}". Valid values: ${KB_CATEGORIES.join(', ')}. ` +
        'Omit the argument to search the whole knowledge base.',
    );
  }
  return resolved;
};

const validate = (raw: unknown): SearchMedicalKbArgs => {
  if (!isPlainObject(raw)) {
    throw new ToolValidationError('Arguments must be an object.');
  }
  const query = raw.query;
  if (typeof query !== 'string' || !query.trim()) {
    throw new ToolValidationError('`query` must be a non-empty string.');
  }

  let queries: string[] | undefined;
  if (raw.queries !== undefined) {
    if (!Array.isArray(raw.queries)) {
      throw new ToolValidationError('`queries` must be an array of strings.');
    }
    queries = raw.queries
      .map((q) => (typeof q === 'string' ? q.trim() : ''))
      .filter((q) => q.length > 0)
      .slice(0, 6);
    if (queries.length === 0) queries = undefined;
  }

  let limit: number | undefined;
  if (raw.limit !== undefined) {
    if (typeof raw.limit !== 'number' || !Number.isFinite(raw.limit)) {
      throw new ToolValidationError('`limit` must be a number.');
    }
    limit = Math.min(20, Math.max(1, Math.floor(raw.limit)));
  }

  return { query: query.trim(), queries, limit, category: resolveCategory(raw.category) };
};

/**
 * The one-line status the model sees above the chunks.
 *
 * It has to say when the category the model asked for was NOT the
 * category these chunks came from. The retriever widens to the whole
 * corpus rather than report an empty category (see medical-kb.ts), and
 * a model that asked for 11.病友经验, got eight chunks and was told
 * nothing would reasonably present them as 病友经验 material.
 */
const describeRetrieval = (parsed: SearchMedicalKbArgs, retrieval: RetrieveResult): string => {
  const base = `medical_kb: ${retrieval.chunks.length} chunks`;
  if (!parsed.category) return base;
  if (retrieval.metadata?.filterFellBack === true) {
    return `${base}（类目「${parsed.category}」里没有命中，这些结果来自全库检索，不要说成是该类目的资料）`;
  }
  return `${base}（限定类目：${parsed.category}）`;
};

export class SearchMedicalKbTool implements ITool {
  readonly name = 'search_medical_kb';
  readonly description =
    'Search the FSHD medical knowledge base for general medical/clinical information about FSHD: genetics (DUX4, D4Z4, 4q35, haplotype, methylation), symptoms, progression, management, treatment options, and patient-experience guidance. Use this whenever the user asks about the disease itself rather than their personal records. Optionally narrow to one corpus category via `category` — see that parameter for when narrowing helps and when it hurts.';
  readonly parametersSchema: Record<string, unknown> = PARAMETERS_SCHEMA;

  constructor(private readonly retriever: MedicalKbRetriever) {}

  parseArgs(rawJson: string): SearchMedicalKbArgs {
    return validate(safeParseJson(rawJson));
  }

  async execute(args: unknown, ctx: ToolContext): Promise<ToolExecutionResult> {
    const parsed = args as SearchMedicalKbArgs;
    const retrieval = await this.retriever.search(
      {
        question: parsed.query,
        queries: parsed.queries,
        limit: parsed.limit,
        // Only build a filter object when there is something to filter
        // on. An empty `{}` would read as「a filter was sent」 to the
        // retriever's empty-corpus guard.
        filter: parsed.category ? { category: parsed.category } : undefined,
      },
      {
        userId: ctx.userId,
        consentLevel: ctx.consentLevel,
        requestId: ctx.requestId,
        logger: ctx.logger,
        signal: ctx.signal,
      },
    );
    return {
      retrieval,
      display: describeRetrieval(parsed, retrieval),
    };
  }
}
