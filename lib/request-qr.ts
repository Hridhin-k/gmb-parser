import { create } from "qrcode";

export function qrSvg(text: string): string {
  const code = create(text, { errorCorrectionLevel: "M" });
  const size = code.modules.size;
  const cells: string[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (code.modules.get(row, col)) cells.push(`<rect x="${col}" y="${row}" width="1" height="1"/>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/>${cells.join("")}</svg>`;
}

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

export interface QrCard {
  title: string;
  url: string;
}

/** One page per location: the location name, the QR, and the URL. */
export function renderQrPdf(cards: QrCard[]): Uint8Array {
  if (cards.length === 0) throw new Error("No QR cards to render.");
  const objects: string[] = [];
  const pageIds: number[] = [];
  let nextId = 4;
  for (const card of cards) {
    const code = create(card.url, { errorCorrectionLevel: "M" });
    const modules = code.modules.size;
    const pageId = nextId;
    const contentId = nextId + 1;
    nextId += 2;
    pageIds.push(pageId);
    const quiet = 2;
    const span = modules + quiet * 2;
    const cell = 180 / span;
    const originX = (612 - span * cell) / 2;
    const originY = 280;
    const commands: string[] = [
      "BT /F1 18 Tf 72 700 Td",
      `(${escapePdf(card.title)}) Tj`,
      "0 -22 Td /F1 11 Tf",
      "(Scan to review on Google or send private feedback. Both options are on the page.) Tj",
      "ET",
      `${originX} ${originY} ${span * cell} ${span * cell} re 1 g f`,
    ];
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (!code.modules.get(row, col)) continue;
        const x = (originX + (col + quiet) * cell).toFixed(2);
        const y = (originY + (modules - 1 - row + quiet) * cell).toFixed(2);
        commands.push(`${x} ${y} ${cell.toFixed(2)} ${cell.toFixed(2)} re 0 g f`);
      }
    }
    commands.push(`BT /F1 9 Tf 72 80 Td (${escapePdf(card.url)}) Tj ET`);
    const stream = commands.join("\n");
    objects.push(`${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >> endobj`);
    objects.push(`${contentId} 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`);
  }
  const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
  const body = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    `2 0 obj << /Type /Pages /Count ${pageIds.length} /Kids [${kids}] >> endobj`,
    "3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    ...objects,
  ].join("\n");
  const file = `%PDF-1.4\n${body}\n`;
  return new TextEncoder().encode(file);
}
