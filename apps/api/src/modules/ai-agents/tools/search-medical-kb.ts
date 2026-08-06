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
 * `_derive_metadata_from_path`). Read out of the live table, not
 * invented — counts measured 2026-08 over 9,594 chunks:
 *
 *   文献                4,818    AFO                  546
 *   (corpus root)       1,751    05.相关研究           494
 *   06.政策与倡导教育     405    04.营养与生活方式     379
 *   02.临床管理与治疗     341    10.心理支持           170
 *   03.遗传生育           166    11.病友经验           150
 *   01.疾病定义和科普     149    08.无障碍生活         122
 *   指南共识               51    09.辅助器械            36
 *   孕期                    7    12.资源库               6
 *   07.项目活动             3
 *
 * Why the filter exists at all: the shape of that list IS the problem.
 * 4,818 chunks of English molecular-biology papers sit on the same
 * single cosine axis as the 150 chunks of 病友经验 and the 122 of
 * 无障碍生活, moderated only by a 0.00–0.03 authority penalty. A patient
 * asking「确诊后怎么调整心态」was competing against half the corpus for
 * eight slots.
 *
 * The 1,751 root-level chunks (papers and abstract books filed directly
 * at the corpus root) carry `category: ""` and therefore match NO value
 * in this list. Any filter excludes them — which is exactly why the
 * description below tells the model to omit the argument when unsure,
 * and why the retriever widens to the whole corpus when a filtered
 * search comes back empty.
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

const CATEGORY_DESCRIPTION = [
  '可选。把检索限制在知识库的一个类目里。',
  '什么时候用：问题明显落在某一个类目，而且通用检索容易被 4,818 条英文分子生物学文献淹没时（心理、无障碍、政策、病友经历这类中文小类目最需要）。',
  '什么时候不要用：不确定、问题跨类目、或者问的是疾病机制/研究进展这种全库都相关的内容——不传这个参数就是全库检索，那是默认且安全的选择。',
  '注意：语料库根目录下还有 1,751 条论文，它们不属于任何类目，一旦加了过滤就搜不到。',
  '可选值（括号内为该类目的 chunk 数）：',
  '- 01.疾病定义和科普（149）：FSHD 是什么、分子诊断、分型、事实清单',
  '- 02.临床管理与治疗（341）：康复、手术与麻醉注意事项、评估与随访、治疗选择',
  '- 03.遗传生育（166）：遗传方式、基因检测、遗传咨询、胚胎植入前检测',
  '- 04.营养与生活方式（379）：营养状况、饮食、日常生活方式',
  '- 05.相关研究（494）：在研药物、临床试验、机制研究进展',
  '- 06.政策与倡导教育（405）：中国罕见病政策、医保与审评、患者组织与倡导',
  '- 07.项目活动（3）：本平台的甲基化筛查等项目招募与流程',
  '- 08.无障碍生活（122）：无障碍环境建设法、残疾人就业与出行、辅具目录',
  '- 09.辅助器械（36）：辅助技术与辅具服务',
  '- 10.心理支持（170）：确诊后的心理调适、怎么跟家人和孩子谈病情',
  '- 11.病友经验（150）：患者自述与经验分享（求医、麻醉、生活）',
  '- 12.资源库（6）：合作门诊、康复医师网络、社区简介等本地资源',
  '- AFO（546）：踝足矫形器与步态/平衡相关研究',
  '- 孕期（7）：FSHD 女性的怀孕、分娩',
  '- 指南共识（51）：荷兰 FSHD 指南等成文指南（注意：多数指南其实归档在 01./02./03. 下）',
  '- 文献（4,818）：英文期刊论文与预印本，绝大多数是分子生物学',
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
  // An empty string is a legal category in the corpus (the 1,751
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
