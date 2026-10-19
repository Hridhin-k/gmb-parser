/** A small text PDF using the standard Helvetica font. */

function escapePdf(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (char === "\\") out += "\\\\";
    else if (char === "(") out += "\\(";
    else if (char === ")") out += "\\)";
    else if (code >= 32 && code <= 126) out += char;
    else out += "?";
  }
  return out;
}

function wrap(value: string, width: number): string[] {
  const words = value.split(" ").filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

export function renderTextPdf(title: string, lines: string[]): Uint8Array {
  const wrapped = [title, "", ...lines].flatMap((line) => wrap(line, 90));
  const pages: string[][] = [];
  for (let index = 0; index < wrapped.length; index += 46) pages.push(wrapped.slice(index, index + 46));
  if (pages.length === 0) pages.push([title]);

  const objects = new Map<number, string>();
  const kids: string[] = [];
  let nextId = 4;
  for (const page of pages) {
    const pageId = nextId;
    const contentId = nextId + 1;
    nextId += 2;
    kids.push(`${pageId} 0 R`);
    const commands = ["BT", "/F1 11 Tf", "50 760 Td", "14 TL"];
    page.forEach((line, lineIndex) => {
      const text = `(${escapePdf(line)}) Tj`;
      commands.push(lineIndex === 0 ? text : `T* ${text}`);
    });
    commands.push("ET");
    const stream = commands.join("\n");
    objects.set(contentId, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`
    );
  }

  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(2, `<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(" ")}] >>`);
  objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  const count = nextId - 1;
  for (let id = 1; id <= count; id += 1) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects.get(id) ?? "<< >>"}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${count + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let id = 1; id <= count; id += 1) {
    body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer << /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(body);
}
