import Papa from 'papaparse';
import { assertCivilDate } from './date';

export type LegacySeverity = 'info' | 'warning' | 'error';

export interface LegacyIssue {
  severity: LegacySeverity;
  code: string;
  message: string;
  source: 'csv' | 'json' | 'crosscheck';
}

export interface LegacyInventory {
  csvSections: Record<string, number>;
  jsonCollections: Record<string, number>;
  detectedMembers: number;
  detectedContributions: number;
  detectedLoans: number;
  detectedPrizes: number;
  paymentMarks: number;
  attachmentReferences: number;
}

export interface LegacyPrevalidationReport {
  generatedAt: string;
  inventory: LegacyInventory;
  issues: LegacyIssue[];
  notes: string[];
}

interface ParsedSection {
  name: string;
  rows: Record<string, string>[];
}

interface LegacyJson {
  socios?: Record<string, unknown>[];
  cuotas?: Record<string, unknown>[];
  prestamos?: Record<string, unknown>[];
  premios?: Record<string, unknown>[];
  movimientos?: Record<string, unknown>[];
  pagos?: Record<string, unknown>;
  [key: string]: unknown;
}

const sectionTitlePattern = /^[A-ZÁÉÍÓÚÑ0-9 _-]+$/;
const monthNames = new Map([
  ['enero', 1],
  ['febrero', 2],
  ['marzo', 3],
  ['abril', 4],
  ['mayo', 5],
  ['junio', 6],
  ['julio', 7],
  ['agosto', 8],
  ['septiembre', 9],
  ['setiembre', 9],
  ['octubre', 10],
  ['noviembre', 11],
  ['diciembre', 12]
]);

export function prevalidateLegacySources(input: { csvText?: string; jsonText?: string; now?: Date }): LegacyPrevalidationReport {
  const issues: LegacyIssue[] = [];
  const notes = [
    'HU-001 solo inspecciona fuentes legacy; no importa operaciones reales ni modifica localStorage anterior.',
    'Las marcas booleanas de pago se reportan como procedencia legacy, no como cobros fechados confirmados.',
    'Las referencias a comprobantes no contienen los bytes de imagen y requieren recuperacion separada.'
  ];

  const csvSections = input.csvText ? parseLegacyCsv(input.csvText, issues) : [];
  const json = input.jsonText ? parseLegacyJson(input.jsonText, issues) : null;

  const csvContributions = csvSections.find((section) => normalizeSectionName(section.name) === 'CUOTAS')?.rows ?? [];
  inspectContributionDates(csvContributions, issues);

  const detectedMembers = new Set<string>();
  for (const row of csvContributions) {
    if (row.Socio) {
      detectedMembers.add(row.Socio.trim().toLocaleLowerCase('es-CO'));
    }
  }
  for (const member of json?.socios ?? []) {
    const name = [member.nombre, member.apellido].filter(Boolean).join(' ').trim();
    if (name) {
      detectedMembers.add(name.toLocaleLowerCase('es-CO'));
    }
  }

  const jsonCollectionCounts = json
    ? Object.fromEntries(
        ['socios', 'cuotas', 'prestamos', 'premios', 'movimientos'].map((key) => [
          key,
          Array.isArray(json[key]) ? json[key].length : 0
        ]),
      )
    : {};

  const paymentMarks = json?.pagos ? Object.keys(json.pagos).length : 0;
  const attachmentReferences = countAttachmentReferences(json);

  if (csvContributions.length > 0 && json?.cuotas && json.cuotas.length !== csvContributions.length) {
    issues.push({
      severity: 'warning',
      code: 'CSV_JSON_CONTRIBUTION_COUNT_DIFF',
      source: 'crosscheck',
      message: `CSV reporta ${csvContributions.length} cuotas y JSON reporta ${json.cuotas.length}; no son respaldos equivalentes.`
    });
  }

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    inventory: {
      csvSections: Object.fromEntries(csvSections.map((section) => [section.name, section.rows.length])),
      jsonCollections: jsonCollectionCounts,
      detectedMembers: detectedMembers.size,
      detectedContributions: csvContributions.length + (json?.cuotas?.length ?? 0),
      detectedLoans: countCsvSection(csvSections, 'PRESTAMOS') + (json?.prestamos?.length ?? 0),
      detectedPrizes: countCsvSection(csvSections, 'PREMIOS') + (json?.premios?.length ?? 0),
      paymentMarks,
      attachmentReferences
    },
    issues,
    notes
  };
}

function parseLegacyCsv(text: string, issues: LegacyIssue[]): ParsedSection[] {
  const cleanText = text.replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/);
  const sections: ParsedSection[] = [];
  let index = 0;

  while (index < lines.length) {
    const title = lines[index]?.trim();
    if (!title) {
      index += 1;
      continue;
    }
    if (!sectionTitlePattern.test(title) || title.includes(',')) {
      issues.push({
        severity: 'warning',
        code: 'CSV_UNEXPECTED_LINE',
        source: 'csv',
        message: `Linea fuera de seccion reconocida: ${title.slice(0, 80)}`
      });
      index += 1;
      continue;
    }

    const header = lines[index + 1];
    const rows: string[] = [];
    index += 2;
    while (index < lines.length) {
      const candidate = lines[index];
      const trimmed = candidate.trim();
      if (trimmed && sectionTitlePattern.test(trimmed) && !trimmed.includes(',')) {
        break;
      }
      if (trimmed) {
        rows.push(candidate);
      }
      index += 1;
    }

    if (!header?.includes(',')) {
      issues.push({
        severity: 'error',
        code: 'CSV_SECTION_WITHOUT_HEADER',
        source: 'csv',
        message: `La seccion ${title} no tiene encabezado CSV valido.`
      });
      continue;
    }

    const parsed = Papa.parse<Record<string, string>>([header, ...rows].join('\n'), {
      header: true,
      skipEmptyLines: true,
      transformHeader: (value) => value.trim(),
      transform: (value) => value.trim()
    });

    for (const error of parsed.errors) {
      issues.push({
        severity: 'error',
        code: 'CSV_PARSE_ERROR',
        source: 'csv',
        message: `${title}: ${error.message}`
      });
    }

    sections.push({ name: title, rows: parsed.data });
  }

  return sections;
}

function parseLegacyJson(text: string, issues: LegacyIssue[]): LegacyJson | null {
  try {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      issues.push({
        severity: 'error',
        code: 'JSON_SCHEMA_ERROR',
        source: 'json',
        message: 'raiz: el respaldo debe ser un objeto JSON.'
      });
      return null;
    }

    const record = parsed as Record<string, unknown>;
    for (const key of ['socios', 'cuotas', 'prestamos', 'premios', 'movimientos']) {
      if (key in record && !Array.isArray(record[key])) {
        issues.push({
          severity: 'error',
          code: 'JSON_SCHEMA_ERROR',
          source: 'json',
          message: `${key}: debe ser una lista.`
        });
      }
    }
    if ('pagos' in record && (!record.pagos || typeof record.pagos !== 'object' || Array.isArray(record.pagos))) {
      issues.push({
        severity: 'error',
        code: 'JSON_SCHEMA_ERROR',
        source: 'json',
        message: 'pagos: debe ser un objeto de marcas legacy.'
      });
    }
    if (issues.some((issue) => issue.source === 'json' && issue.severity === 'error')) {
      return null;
    }
    return record as LegacyJson;
  } catch (error) {
    issues.push({
      severity: 'error',
      code: 'JSON_PARSE_ERROR',
      source: 'json',
      message: error instanceof Error ? error.message : 'JSON ilegible.'
    });
    return null;
  }
}

function inspectContributionDates(rows: Record<string, string>[], issues: LegacyIssue[]) {
  for (const row of rows) {
    if (!row.Fecha || !row.Mes) {
      continue;
    }
    try {
      const date = assertCivilDate(row.Fecha, 'Fecha CSV');
      const actualMonth = Number(date.slice(5, 7));
      const appliedMonth = monthNames.get(row.Mes.toLocaleLowerCase('es-CO'));
      if (appliedMonth && actualMonth < appliedMonth - 1) {
        issues.push({
          severity: 'warning',
          code: 'EARLY_OR_WRONG_MONTH_CONTRIBUTION',
          source: 'csv',
          message: `Aporte de ${row.Socio || 'socio sin nombre'} para ${row.Mes} aparece con fecha ${row.Fecha}; revisar si es anticipo o error.`
        });
      }
    } catch (error) {
      issues.push({
        severity: 'error',
        code: 'CSV_INVALID_DATE',
        source: 'csv',
        message: error instanceof Error ? error.message : 'Fecha invalida en CSV.'
      });
    }
  }
}

function countCsvSection(sections: ParsedSection[], name: string): number {
  return sections.find((section) => normalizeSectionName(section.name) === name)?.rows.length ?? 0;
}

function normalizeSectionName(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();
}

function countAttachmentReferences(json: Record<string, unknown> | null): number {
  if (!json) {
    return 0;
  }
  let count = 0;
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (/comprobante|adjunto|imagen|foto/i.test(key) && nested) {
        count += 1;
      }
      visit(nested);
    }
  };
  visit(json);
  return count;
}
