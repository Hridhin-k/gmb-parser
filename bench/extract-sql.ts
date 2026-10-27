import { createHash } from "node:crypto";

export type ExtractedFunction = {
  language: "sql" | "plpgsql";
  tag: string;
  body: string;
};

/**
 * Read a CREATE FUNCTION body. pg_get_functiondef uses `$function$`.
 * Migration files in this repo use `$$`. Either tag is accepted.
 * A missing tag throws; it does not return an empty body.
 */
export function extractFunctionBody(source: string, filename: string, functionName: string): ExtractedFunction {
  const marker = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${functionName}\\b`,
    "i"
  );
  const found = marker.exec(source);
  if (!found) {
    throw new Error(`${filename}: missing function ${functionName}. The file does not contain that create function statement.`);
  }
  const slice = source.slice(found.index);
  const languageMatch = /language\s+(sql|plpgsql)/i.exec(slice);
  if (!languageMatch) {
    throw new Error(`${filename}: function ${functionName} has no language marker (expected language sql or language plpgsql).`);
  }
  const opener = /as\s+(\$[A-Za-z0-9_]*\$)/i.exec(slice);
  if (!opener || opener.index === undefined) {
    throw new Error(
      `${filename}: function ${functionName} has no dollar-quote opener after AS. Expected AS $tag$ or AS $$.`
    );
  }
  const tag = opener[1];
  const openAt = slice.indexOf(tag, opener.index);
  const bodyStart = openAt + tag.length;
  const closeAt = slice.indexOf(tag, bodyStart);
  if (closeAt < 0) {
    throw new Error(`${filename}: function ${functionName} is missing the closing delimiter ${tag}.`);
  }
  const body = slice.slice(bodyStart, closeAt).trim();
  if (!body) {
    throw new Error(`${filename}: function ${functionName} body between ${tag} is empty.`);
  }
  return { language: languageMatch[1].toLowerCase() as "sql" | "plpgsql", tag, body };
}

/** Split a function body into statements. Semicolons inside quotes or parentheses stay put. */
export function splitSqlStatements(body: string): string[] {
  const statements: string[] = [];
  let current = "";
  let paren = 0;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      current += ch;
      if (ch === quote) {
        if (body[i + 1] === quote) {
          current += body[i + 1];
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "-" && body[i + 1] === "-") {
      const newline = body.indexOf("\n", i);
      const stop = newline < 0 ? body.length : newline;
      current += body.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (ch === "/" && body[i + 1] === "*") {
      const close = body.indexOf("*/", i + 2);
      const stop = close < 0 ? body.length : close + 2;
      current += body.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(") paren += 1;
    if (ch === ")" && paren > 0) paren -= 1;
    if (ch === ";" && paren === 0) {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

export function isExplainableQuery(statement: string): boolean {
  const stripped = statement.replace(/^\s*(--[^\n]*\n\s*)+/, "").trim();
  return /^(with|select)\b/i.test(stripped);
}

/**
 * PL/pgSQL `select ... into target from ...` is not a read-only EXPLAIN target:
 * SELECT INTO would create a table. Drop that one assignment so the plan is of the same select.
 */
export function withoutSelectInto(statement: string): { sql: string; removedInto: string | null } {
  const match = statement.match(/\s+into\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*)*)(?=\s+from\b)/i);
  if (!match || match.index === undefined) return { sql: statement.trim(), removedInto: null };
  const sql = `${statement.slice(0, match.index)} ${statement.slice(match.index + match[0].length)}`.trim();
  return { sql, removedInto: match[1] };
}

/** Replace named parameters with $1..$n. Names are matched longest-first. */
export function toPlaceholders(sql: string, names: string[]): { sql: string; used: string[] } {
  const used = names.filter((name) => new RegExp(`\\b${name}\\b`).test(sql));
  let out = sql;
  const ordered = [...used].sort((a, b) => b.length - a.length);
  for (const name of ordered) {
    const slot = used.indexOf(name) + 1;
    out = out.replace(new RegExp(`\\b${name}\\b`, "g"), `$${slot}`);
  }
  return { sql: out, used };
}

export function substituteParams(sql: string, params: Record<string, string>): string {
  let out = sql;
  const names = Object.keys(params).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const pattern = new RegExp(`\\b${name}\\b`, "g");
    if (!pattern.test(out)) {
      throw new Error(`Parameter ${name} was not found in the SQL being explained.`);
    }
    pattern.lastIndex = 0;
    out = out.replace(pattern, params[name]);
  }
  return out;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
