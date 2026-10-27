import metadata from "./metadata.json";
import { getPool } from "./pool";

type Relation = { name: string; table: string; columns: string[]; references: string[]; many: boolean };
type Table = { columns: Record<string, string>; relations: Relation[] };
const tables: Record<string, Table> = metadata.tables;
type Filter = { column: string; operator: string; value: unknown; negate?: boolean };
type Logic = Filter | { logic: "and" | "or"; children: Logic[] };
type Selection = { name: string; column?: string; table?: string; hint?: string; inner?: boolean; children?: Selection[] };
export type DbError = { message: string; code: string; details: string; hint: string };
type Result = { data: unknown; error: DbError | null; count: number | null; status: number; statusText: string };

function identifier(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(value)) throw new Error(`Invalid database identifier: ${value}`);
  return `"${value}"`;
}
function tableInfo(table: string): Table {
  if (!Object.hasOwn(tables, table)) throw new Error(`Unknown database table: ${table}`);
  return tables[table];
}
function column(table: string, name: string, alias: string): string {
  if (!Object.hasOwn(tableInfo(table).columns, name)) throw new Error(`Unknown column ${table}.${name}`);
  return `${identifier(alias)}.${identifier(name)}`;
}
/** Split the legacy fluent expression syntax without interpreting values as SQL. */
function split(value: string): string[] {
  const result: string[] = [];
  let depth = 0, quoted = false, escaped = false, start = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (escaped) { escaped = false; continue; }
    if (char === "\\" && quoted) { escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    if (quoted) continue;
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (depth < 0) throw new Error("Unbalanced query expression");
    if (char === "," && depth === 0) { result.push(value.slice(start, i).trim()); start = i + 1; }
  }
  if (quoted || depth) throw new Error("Unbalanced query expression");
  result.push(value.slice(start).trim());
  return result.filter(Boolean);
}
function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1).replace(/\\([\\"])/g, "$1") : value;
}
function parseLogic(value: string): Logic {
  const group = /^(and|or)\(([\s\S]*)\)$/.exec(value);
  if (group) return { logic: group[1] as "and" | "or", children: split(group[2]).map(parseLogic) };
  const match = /^([a-zA-Z_][\w.]*)\.(not\.)?(eq|neq|gt|gte|lt|lte|is|in|like|ilike)\.([\s\S]*)$/.exec(value);
  if (!match) throw new Error("Unsupported filter expression");
  const [, name, negate, operator, raw] = match;
  return { column: name, operator, negate: Boolean(negate), value: operator === "in" ? split(raw.slice(1, -1)).map(unquote) : unquote(raw) };
}
function selections(value: string): Selection[] {
  return split(value).map((item) => {
    const open = item.indexOf("(");
    const head = open < 0 ? item : item.slice(0, open);
    const [alias, rest] = head.includes(":") ? head.split(":") : [null, head];
    const [name, ...hints] = rest.split("!");
    return open < 0 ? { name: alias || name, column: name } : {
      name: alias || name, table: name, hint: hints.find((hint) => hint !== "inner" && hint !== "left"),
      inner: hints.includes("inner"), children: selections(item.slice(open + 1, -1)),
    };
  });
}
function relation(table: string, target: string, hint?: string): Relation {
  const candidates = tableInfo(table).relations.filter((r) => r.table === target && (!hint || r.name === hint || r.columns.includes(hint)));
  if (candidates.length !== 1) throw new Error(`Missing or ambiguous relationship ${table}.${target}`);
  return candidates[0];
}

export class SqlQuery implements PromiseLike<Result> {
  private action: "select" | "insert" | "update" | "delete" = "select";
  private selection = "*";
  private returning = false;
  private countMode = false;
  private head = false;
  private filters: Logic[] = [];
  private orders: Array<{ name: string; ascending?: boolean; nullsFirst?: boolean }> = [];
  private take?: number;
  private offset = 0;
  private cardinality: "many" | "single" | "maybe" = "many";
  private payload: Record<string, unknown>[] = [];
  private conflict?: string;
  private ignoreDuplicates = false;
  private parameters: unknown[] = [];
  private aliasCounter = 0;
  constructor(private table: string) { tableInfo(table); }
  select(value = "*", options: { count?: string; head?: boolean } = {}) {
    this.selection = value; this.returning = this.action !== "select";
    this.countMode = Boolean(options.count); this.head = Boolean(options.head); return this;
  }
  insert(value: Record<string, unknown> | Record<string, unknown>[]) {
    this.action = "insert"; this.payload = Array.isArray(value) ? value : [value]; return this;
  }
  upsert(value: Record<string, unknown> | Record<string, unknown>[], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.insert(value); this.conflict = options.onConflict || "id"; this.ignoreDuplicates = Boolean(options.ignoreDuplicates); return this;
  }
  update(value: Record<string, unknown>) { this.action = "update"; this.payload = [value]; return this; }
  delete() { this.action = "delete"; return this; }
  private filter(name: string, operator: string, value: unknown, negate = false) { this.filters.push({ column: name, operator, value, negate }); return this; }
  eq(name: string, value: unknown) { return this.filter(name, "eq", value); }
  neq(name: string, value: unknown) { return this.filter(name, "neq", value); }
  gt(name: string, value: unknown) { return this.filter(name, "gt", value); }
  gte(name: string, value: unknown) { return this.filter(name, "gte", value); }
  lt(name: string, value: unknown) { return this.filter(name, "lt", value); }
  lte(name: string, value: unknown) { return this.filter(name, "lte", value); }
  is(name: string, value: unknown) { return this.filter(name, "is", value); }
  in(name: string, value: unknown[]) { return this.filter(name, "in", value); }
  ilike(name: string, value: string) { return this.filter(name, "ilike", value); }
  like(name: string, value: string) { return this.filter(name, "like", value); }
  not(name: string, operator: string, value: unknown) {
    return this.filter(name, operator, operator === "in" && typeof value === "string" ? split(value.slice(1, -1)).map(unquote) : value, true);
  }
  or(value: string) { this.filters.push({ logic: "or", children: split(value).map(parseLogic) }); return this; }
  order(name: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) { this.orders.push({ name, ...options }); return this; }
  limit(value: number) { this.take = this.integer(value); return this; }
  range(from: number, to: number) { this.offset = this.integer(from); this.take = this.integer(to - from + 1); return this; }
  single() { this.cardinality = "single"; return this; }
  maybeSingle() { this.cardinality = "maybe"; return this; }
  private integer(value: number) { if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid pagination"); return value; }
  private param(value: unknown) { this.parameters.push(value); return `$${this.parameters.length}`; }
  private jsonParam(name: string, value: unknown) {
    column(this.table, name, "t");
    return this.param(value != null && ["json", "jsonb"].includes(tableInfo(this.table).columns[name]) ? JSON.stringify(value) : value);
  }
  private join(r: Relation, parent: string, child: string, parentTable: string) {
    const joins = r.columns.map((name, i) => `${column(r.table, r.references[i], child)} = ${identifier(parent)}.${identifier(name)}`);
    // Nested rows must belong to the same tenant, even if a corrupt FK was inserted.
    if (tables[r.table].columns.workspace_id && tables[parentTable].columns.workspace_id) {
      joins.push(`${identifier(child)}."workspace_id" = ${identifier(parent)}."workspace_id"`);
    }
    return joins.join(" AND ");
  }
  private expression(node: Logic, table: string, alias: string): string {
    if ("logic" in node) return `(${node.children.map((child) => this.expression(child, table, alias)).join(` ${node.logic.toUpperCase()} `) || "FALSE"})`;
    if (node.column.includes(".")) {
      const [target, ...path] = node.column.split(".");
      const r = relation(table, target), child = `f${++this.aliasCounter}`;
      return `EXISTS (SELECT 1 FROM public.${identifier(target)} ${identifier(child)} WHERE ${this.join(r, alias, child, table)} AND ${this.expression({ ...node, column: path.join(".") }, target, child)})`;
    }
    const field = column(table, node.column, alias);
    let sql: string;
    if (node.operator === "is") {
      const v = String(node.value).toLowerCase();
      if (!["null", "true", "false"].includes(v)) throw new Error("IS only supports null or boolean");
      sql = `${field} IS ${v.toUpperCase()}`;
    } else if (node.operator === "in") {
      if (!Array.isArray(node.value)) throw new Error("IN requires a list");
      sql = node.value.length ? `${field} IN (${node.value.map((v) => this.param(v)).join(", ")})` : "FALSE";
    } else {
      const operators: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "LIKE", ilike: "ILIKE" };
      if (!operators[node.operator]) throw new Error("Unsupported filter operator");
      sql = `${field} ${operators[node.operator]} ${this.param(node.value)}`;
    }
    return node.negate ? `NOT (${sql})` : sql;
  }
  private projectedFilters(target: string): Logic[] {
    return this.filters.filter((f): f is Filter => !("logic" in f) && f.column.startsWith(`${target}.`)).map((f) => ({ ...f, column: f.column.slice(target.length + 1) }));
  }
  private projection(items: Selection[], table: string, alias: string): { fields: string[]; required: string[] } {
    const fields: string[] = [], required: string[] = [];
    for (const item of items) {
      if (item.column === "*") { fields.push(`${identifier(alias)}.*`); continue; }
      if (item.column) { fields.push(`${column(table, item.column, alias)} AS ${identifier(item.name)}`); continue; }
      const target = item.table!, r = relation(table, target, item.hint), child = `j${++this.aliasCounter}`;
      const count = item.children?.length === 1 && item.children[0].column === "count";
      const nested = count ? { fields: ["count(*)::integer AS count"], required: [] } : this.projection(item.children!, target, child);
      const conditions = [this.join(r, alias, child, table), ...nested.required, ...this.projectedFilters(target).map((f) => this.expression(f, target, child))];
      const from = `FROM public.${identifier(target)} ${identifier(child)} WHERE ${conditions.join(" AND ")}`;
      const query = `SELECT ${nested.fields.join(", ")} ${from}`;
      const value = r.many || count ? `(SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM (${query}) x)` : `(SELECT to_jsonb(x) FROM (${query} LIMIT 1) x)`;
      fields.push(`${value} AS ${identifier(item.name)}`);
      if (item.inner) required.push(`EXISTS (SELECT 1 ${from})`);
    }
    return { fields, required };
  }
  /** Exposed for SQL contract tests; callers normally await the builder. */
  compile() {
    this.parameters = []; this.aliasCounter = 0;
    const projection = this.projection(selections(this.selection), this.table, "t");
    const conditions = [...this.filters.map((f) => this.expression(f, this.table, "t")), ...projection.required];
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    let source = `public.${identifier(this.table)} AS t`, cte = "";
    if (this.action !== "select") {
      let mutation: string;
      if (this.action === "delete") mutation = `DELETE FROM ${source}${where}`;
      else if (this.action === "update") {
        const entries = Object.entries(this.payload[0]).filter(([, value]) => value !== undefined);
        if (!entries.length) throw new Error("Empty update");
        mutation = `UPDATE ${source} SET ${entries.map(([name, value]) => `${identifier(name)} = ${this.jsonParam(name, value)}`).join(", ")}${where}`;
      } else {
        if (!this.payload.length) throw new Error("Empty insert");
        const keys = [...new Set(this.payload.flatMap((row) => Object.keys(row).filter((key) => row[key] !== undefined)))];
        keys.forEach((key) => column(this.table, key, "t"));
        mutation = `INSERT INTO public.${identifier(this.table)} (${keys.map(identifier).join(", ")}) VALUES ${this.payload.map((row) => `(${keys.map((key) => row[key] === undefined ? "DEFAULT" : this.jsonParam(key, row[key])).join(", ")})`).join(", ")}`;
        if (this.conflict) {
          const keysConflict = this.conflict.split(",").map((key) => key.trim());
          keysConflict.forEach((key) => column(this.table, key, "t"));
          const changes = keys.filter((key) => !keysConflict.includes(key));
          mutation += ` ON CONFLICT (${keysConflict.map(identifier).join(", ")}) DO ` + (this.ignoreDuplicates || !changes.length ? "NOTHING" : `UPDATE SET ${changes.map((key) => `${identifier(key)} = EXCLUDED.${identifier(key)}`).join(", ")}`);
        }
      }
      cte = `WITH changed AS (${mutation} RETURNING *) `; source = "changed AS t";
    }
    const from = ` FROM ${source}${this.action === "select" ? where : ""}`;
    const order = this.orders.length ? ` ORDER BY ${this.orders.map((o) => `${column(this.table, o.name, "t")} ${o.ascending === false ? "DESC" : "ASC"}${o.nullsFirst === undefined ? "" : o.nullsFirst ? " NULLS FIRST" : " NULLS LAST"}`).join(", ")}` : "";
    const pagination = `${this.take === undefined ? "" : ` LIMIT ${this.param(this.take)}`}${this.offset ? ` OFFSET ${this.param(this.offset)}` : ""}`;
    // One statement and one snapshot for both the rows and the total count.
    const count = this.countMode ? `(SELECT count(*)::integer${from})` : "NULL::integer";
    const rows = this.head || (this.action !== "select" && !this.returning) ? "'[]'::jsonb" : `COALESCE((SELECT jsonb_agg(to_jsonb(result)) FROM (SELECT ${projection.fields.join(", ")}${from}${order}${pagination}) result), '[]'::jsonb)`;
    const text = `${cte}SELECT ${count} AS count, ${rows} AS rows`;
    return { text, values: this.parameters };
  }
  async execute(): Promise<Result> {
    try {
      const query = this.compile();
      const { rows: [result] } = await getPool().query(query);
      const rows = result.rows as unknown[];
      if (this.cardinality !== "many" && (rows.length > 1 || (this.cardinality === "single" && !rows.length))) {
        return { data: null, count: result.count, error: { code: "PGRST116", message: "Expected a single database row", details: "", hint: "" }, status: 406, statusText: "Not Acceptable" };
      }
      const data = this.head || (this.action !== "select" && !this.returning) ? null : this.cardinality === "many" ? rows : rows[0] ?? null;
      return { data, error: null, count: result.count, status: 200, statusText: "OK" };
    } catch (error) {
      const e = error as { message: string; code?: string; detail?: string; hint?: string };
      return { data: null, count: null, error: { code: e.code || "DB_QUERY_ERROR", message: e.message, details: e.detail || "", hint: e.hint || "" }, status: 500, statusText: "Database Error" };
    }
  }
  then<T = Result, U = never>(resolve?: ((value: Result) => T | PromiseLike<T>) | null, reject?: ((reason: unknown) => U | PromiseLike<U>) | null): PromiseLike<T | U> {
    return this.execute().then(resolve, reject);
  }
}

export async function callFunction(name: string, args: Record<string, unknown> = {}): Promise<Result> {
  try {
    const fn = (metadata.functions as Record<string, { set: boolean; type: string; args: string[] }>)[name];
    if (!fn || !Object.hasOwn(metadata.functions, name)) throw new Error("Unknown database function");
    const values: unknown[] = [];
    const parameters = Object.entries(args).map(([key, value]) => {
      if (!fn.args?.includes(key)) throw new Error("Unknown database function argument");
      values.push(value); return `${identifier(key)} => $${values.length}`;
    });
    const invocation = `public.${identifier(name)}(${parameters.join(", ")})`;
    const result = await getPool().query(fn.set ? `SELECT * FROM ${invocation}` : `SELECT ${invocation} AS value`, values);
    return { data: fn.set ? result.rows : result.rows[0]?.value ?? null, error: null, count: null, status: 200, statusText: "OK" };
  } catch (error) {
    const e = error as { message: string; code?: string; detail?: string; hint?: string };
    return { data: null, error: { message: e.message, code: e.code || "DB_QUERY_ERROR", details: e.detail || "", hint: e.hint || "" }, count: null, status: 500, statusText: "Database Error" };
  }
}
