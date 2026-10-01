import { describe, expect, it } from "vitest";
import { csvEscape, toCsv } from "@/lib/export/csv";
import { attachmentHeader, EXPORT_INFO, EXPORT_TYPES, exportFileName } from "@/lib/export/files";
import { crc32, createZip } from "@/lib/export/zip";

describe("export file names", () => {
  it("names each kind of export", () => {
    expect(exportFileName("transactions", "2026-10-01")).toBe("harbour-transactions-2026-10-01.csv");
    expect(exportFileName("transactions", "2026-10-01", { from: "2026-01-01", to: "2026-09-30" })).toBe("harbour-transactions-2026-01-01_2026-09-30.csv");
    expect(exportFileName("transactions", "2026-10-01", { from: "2026-01-01" })).toBe("harbour-transactions-2026-01-01_2026-10-01.csv");
    expect(exportFileName("budget", "2026-10-01", { month: "2026-09" })).toBe("harbour-budget-2026-09.csv");
    expect(exportFileName("budget", "2026-10-01")).toBe("harbour-budget-2026-10.csv");
    expect(exportFileName("contributions", "2026-10-01")).toBe("harbour-goal-contributions-2026-10-01.csv");
    expect(exportFileName("all", "2026-10-01")).toBe("harbour-export-2026-10-01.zip");
  });

  it("ignores malformed dates and never builds unsafe headers", () => {
    expect(exportFileName("transactions", "2026-10-01", { from: "../../etc" })).toBe("harbour-transactions-2026-10-01.csv");
    expect(attachmentHeader('evil"; name=x.csv')).toBe('attachment; filename="evil___name_x.csv"');
  });

  it("describes every export type", () => {
    for (const t of EXPORT_TYPES) expect(EXPORT_INFO[t].label.length).toBeGreaterThan(0);
    expect(EXPORT_INFO.all.format).toBe("ZIP");
  });
});

describe("CSV writer", () => {
  it("quotes separators and neutralises spreadsheet formulas", () => {
    expect(csvEscape('Café "Le Plateau", Montréal')).toBe('"Café ""Le Plateau"", Montréal"');
    expect(csvEscape("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvEscape("-12.50")).toBe("-12.50");
    expect(csvEscape("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(true)).toBe("true");
  });

  it("starts with a BOM and uses CRLF line endings", () => {
    const csv = toCsv(["Date", "Amount"], [["2026-10-01", "-4.35"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1)).toBe("Date,Amount\r\n2026-10-01,-4.35\r\n");
  });
});

describe("ZIP writer", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("writes a well-formed archive with the given files", () => {
    const zip = createZip([
      { name: "a.csv", content: "x,y\r\n" },
      { name: "b.csv", content: "Hydro-Québec\r\n" },
    ]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const eocd = zip.byteLength - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 10, true)).toBe(2);
    const text = new TextDecoder().decode(zip);
    expect(text).toContain("a.csv");
    expect(text).toContain("Hydro-Québec");
  });
});
