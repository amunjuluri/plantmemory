import { domToCanvas } from "modern-screenshot";

const MM = 96 / 25.4; // CSS pixels in a millimetre
const A4_PT = [595.28, 841.89];
/** Top and bottom margin of pages after the first; the sheet's own padding is the first
 * page's top margin and every page's side margin. */
const TOP_MM = 10;
const BOTTOM_MM = 12;
/** 240 dpi: small print stays sharp. Phones refuse canvases much over 16 million pixels,
 * and some browsers any side over 16,384, so a long sheet is drawn at a lower resolution. */
const MAX_SCALE = 2.5;
const MAX_PIXELS = 16_000_000;
const MAX_SIDE = 16_384;
/** How full a page must be before the next block, kept whole, moves to the next page. */
const FILL = 0.6;

/**
 * Turns the printed sheet into an A4 PDF, for phones, where the print dialog is clumsy and
 * a file is easier to share or print. The browser draws the sheet as it looks on screen, so
 * every script comes out right. Pages break between steps, rows and sections.
 */
export async function sheetPdf(sheet: HTMLElement): Promise<Blob> {
  // Draw a copy outside the screen: the one on screen is scaled down to fit the phone.
  const holder = document.createElement("div");
  holder.inert = true;
  holder.style.cssText = "position:absolute;top:0;left:-10000px;pointer-events:none";
  const copy = sheet.cloneNode(true) as HTMLElement;
  copy.removeAttribute("data-tour");
  copy.style.boxShadow = "none";
  holder.append(copy);
  document.body.append(holder);
  try {
    await document.fonts.ready;
    const box = copy.getBoundingClientRect();
    const scale = Math.min(
      MAX_SCALE,
      Math.sqrt(MAX_PIXELS / (box.width * box.height)),
      MAX_SIDE / Math.max(box.width, box.height),
    );
    const canvas = await domToCanvas(copy, { scale, backgroundColor: "#ffffff" });
    const pages = slice(canvas, breaks(copy, box), box.width, box.height);
    canvas.width = canvas.height = 0;
    return jpegPdf(pages);
  } finally {
    holder.remove();
  }
}

/** Where a page may start: above a step, a row or a section, and best not inside a block
 * kept whole on paper. */
function breaks(sheet: HTMLElement, box: DOMRect) {
  const top = (el: Element) => el.getBoundingClientRect().top - box.top;
  const all = [...sheet.querySelectorAll("header, section, li, tr, footer")];
  const whole = all.filter((el) => !el.parentElement?.closest(".break-inside-avoid")).map(top);
  return { whole, any: all.map(top) };
}

type Page = { jpeg: Uint8Array<ArrayBuffer>; width: number; height: number };

function slice(canvas: HTMLCanvasElement, cuts: ReturnType<typeof breaks>, width: number, height: number) {
  const k = canvas.width / width;
  const pageHeight = width * (297 / 210);
  const pages: Page[] = [];
  let start = 0;
  while (start < height - 1) {
    const offset = pages.length ? TOP_MM * MM : 0;
    const limit = start + pageHeight - offset - BOTTOM_MM * MM;
    const last = (ys: number[]) => Math.max(0, ...ys.filter((y) => y > start + 1 && y <= limit));
    // Split a block kept whole, like a long safety box, rather than leave a page mostly empty.
    const whole = last(cuts.whole);
    const end =
      height <= limit ? height : whole - start >= FILL * (limit - start) ? whole : last(cuts.any) || whole || limit;
    const page = document.createElement("canvas");
    page.width = canvas.width;
    page.height = Math.round(pageHeight * k);
    const ctx = page.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, page.width, page.height);
    const h = Math.round((end - start) * k);
    ctx.drawImage(canvas, 0, Math.round(start * k), canvas.width, h, 0, Math.round(offset * k), canvas.width, h);
    // Not toBlob: Chrome encodes it only when the page is idle, which can take seconds.
    const jpeg = page.toDataURL("image/jpeg", 0.9);
    if (!jpeg.startsWith("data:image/jpeg")) throw new Error("This phone couldn't draw the sheet.");
    const bytes = Uint8Array.from(atob(jpeg.slice(jpeg.indexOf(",") + 1)), (c) => c.charCodeAt(0));
    pages.push({ jpeg: bytes, width: page.width, height: page.height });
    page.width = page.height = 0;
    start = end;
  }
  return pages;
}

/** A PDF of A4 pages, each one JPEG filling the page. */
function jpegPdf(pages: Page[]): Blob {
  const [w, h] = A4_PT;
  const encoder = new TextEncoder();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array<ArrayBuffer>) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, ...body: (string | Uint8Array<ArrayBuffer>)[]) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    body.forEach(push);
    push("\nendobj\n");
  };

  push("%PDF-1.4\n");
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((page, i) => {
    const id = 3 + i * 3;
    const draw = `q ${w} 0 0 ${h} 0 0 cm /Im Do Q`;
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`,
    );
    object(id + 1, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    object(
      id + 2,
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      page.jpeg,
      "\nendstream",
    );
  });

  const xref = length;
  const size = offsets.length;
  const rows = offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`);
  push(`xref\n0 ${size}\n0000000000 65535 f \n${rows.join("")}`);
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}

/** Saves a file to the phone: the Downloads folder on Android, Files on an iPhone. */
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
