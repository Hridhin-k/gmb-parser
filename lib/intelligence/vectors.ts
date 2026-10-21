/** Cosine similarity. Magnitude is cancelled, so this matches pgvector cosine distance as 1 - cosine. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  const denom = Math.sqrt(aa) * Math.sqrt(bb);
  if (denom === 0) return 0;
  return dot / denom;
}

/** gemini-embedding-001 truncates to 768 and those vectors are not unit length. */
export function l2normalize(values: readonly number[]): number[] {
  let sum = 0;
  for (const value of values) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm === 0) return values.map(() => 0);
  return values.map((value) => value / norm);
}

/**
 * Keep the leading 768 values. The embedding model is trained so that prefix
 * is the shorter vector. Then normalize, because a 768-d gemini-embedding-001
 * vector is a truncation of a 3072-d unit vector.
 */
export function fitEmbedding(values: readonly number[], dimensions = 768): number[] {
  if (values.length < dimensions) {
    throw new Error(`invalid_response: embedding length ${values.length}`);
  }
  return l2normalize(values.slice(0, dimensions));
}
