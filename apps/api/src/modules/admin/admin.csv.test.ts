import { describe, expect, it } from 'vitest';

import {
  buildFullExportCsv,
  buildFullExportFileName,
  csvField,
  FULL_EXPORT_COLUMNS,
} from './admin.csv.js';
import { ADMIN_EXPORT_RECORD_KINDS, type AdminExportRow } from './admin.service.js';
import { BASELINE_PROVENANCE_KEY } from '../patient-profile/baseline-provenance.js';

const ADMIN_ID = '11111111-2222-3333-4444-555555555555';

const zeroCounts = Object.fromEntries(ADMIN_EXPORT_RECORD_KINDS.map((kind) => [kind, 0])) as Record<
  (typeof ADMIN_EXPORT_RECORD_KINDS)[number],
  number
>;

const row = (overrides: Partial<AdminExportRow> = {}): AdminExportRow => ({
  userId: '99999999-8888-7777-6666-555555555555',
  phoneNumber: '+8613900000001',
  email: null,
  accountRole: 'patient',
  accountIsActive: true,
  accountCreatedAt: new Date('2026-01-02T03:04:05.000Z'),
  profileId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  patientCode: 'FSHD-0001',
  fullName: '张三',
  preferredName: null,
  dateOfBirth: null,
  gender: null,
  heightCm: null,
  weightKg: null,
  bloodType: null,
  contactPhone: null,
  contactEmail: null,
  primaryPhysician: null,
  regionProvince: null,
  regionCity: null,
  regionDistrict: null,
  diagnosisStage: null,
  diagnosisDate: null,
  geneticMutation: null,
  notes: null,
  baselinePayload: null,
  aiConsentPersonal: false,
  aiConsentThirdParty: false,
  aiConsentPreciseValues: false,
  clinicalTrialConsent: false,
  dataDonationConsent: false,
  hospitalSyncConsent: false,
  communityShareConsent: false,
  profileCreatedAt: new Date('2026-01-02T03:04:05.000Z'),
  profileUpdatedAt: new Date('2026-02-02T03:04:05.000Z'),
  counts: { ...zeroCounts },
  ...overrides,
});

const cells = (line: string): string[] => {
  // The writer quotes every field, so a naive split is enough for a
  // fixture that contains no escaped quote. The one test that does
  // contain one asserts on the raw line instead.
  expect(line.startsWith('"')).toBe(true);
  return line.slice(1, -1).split('","');
};

const cellAt = (csv: string, lineIndex: number, header: string): string => {
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  const column = FULL_EXPORT_COLUMNS.findIndex((entry) => entry.header === header);
  expect(column).toBeGreaterThanOrEqual(0);
  return cells(lines[lineIndex])[column];
};

describe('csvField', () => {
  it('quotes every field, so a value that gains a comma does not change the line shape', () => {
    expect(csvField('plain')).toBe('"plain"');
    expect(csvField('a,b')).toBe('"a,b"');
  });

  it('doubles an embedded quote rather than truncating the field', () => {
    expect(csvField('她说"我摔了"')).toBe('"她说""我摔了"""');
  });

  it('keeps a newline inside the quoted field instead of splitting the row', () => {
    expect(csvField('第一行\n第二行')).toBe('"第一行\n第二行"');
  });

  it('renders null and undefined as an empty cell, not as the word null', () => {
    expect(csvField(null)).toBe('""');
    expect(csvField(undefined)).toBe('""');
  });

  it('joins an array on semicolons so assistive devices stay in one cell', () => {
    expect(csvField(['轮椅', '踝足矫形器'])).toBe('"轮椅;踝足矫形器"');
  });

  it('serialises an unexpected object instead of writing [object Object]', () => {
    expect(csvField({ d4z4: '6' })).toBe('"{""d4z4"":""6""}"');
  });

  // The patient types their own name and notes. A cell that begins
  // with one of these is a live formula the moment the operator opens
  // the file in Excel.
  it.each(['=1+1', '+1', '-1+1', '@SUM(A1)', '\tvalue', '\rvalue'])(
    'neutralises a formula lead character: %j',
    (value) => {
      expect(csvField(value)).toBe(`"'${value}"`);
    },
  );

  it('leaves a value that merely contains an equals sign alone', () => {
    expect(csvField('身高=170')).toBe('"身高=170"');
  });
});

describe('buildFullExportCsv', () => {
  it('starts with a UTF-8 BOM, so Excel on a Chinese Windows install does not read it as GBK', () => {
    expect(buildFullExportCsv([])).toMatch(/^﻿/);
  });

  it('emits the header row even with no patients', () => {
    const csv = buildFullExportCsv([]);
    const lines = csv.replace(/^﻿/, '').split('\r\n');
    expect(cells(lines[0])[0]).toBe('user_id');
    expect(lines[1]).toBe('');
  });

  it('gives every row the same number of cells as the header', () => {
    const csv = buildFullExportCsv([row(), row({ fullName: 'a,b"c' })]);
    const lines = csv.replace(/^﻿/, '').split('\r\n').filter(Boolean);
    const headerCount = FULL_EXPORT_COLUMNS.length;
    for (const line of lines) {
      // Count separators outside quotes rather than splitting.
      let inQuotes = false;
      let separators = 0;
      for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '"') {
          if (inQuotes && line[index + 1] === '"') {
            index += 1;
            continue;
          }
          inQuotes = !inQuotes;
        } else if (character === ',' && !inQuotes) {
          separators += 1;
        }
      }
      expect(separators).toBe(headerCount - 1);
    }
  });

  it('uses CRLF between rows', () => {
    const csv = buildFullExportCsv([row()]);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.replace(/^﻿/, '').split('\r\n').filter(Boolean)).toHaveLength(2);
  });

  /**
   * node-postgres hands back a `date` column as a JS Date at LOCAL
   * midnight. `toISOString()` on it moves the day backwards anywhere
   * east of UTC, which is everywhere our patients are.
   */
  it('renders a date column as its calendar day, not as a UTC instant', () => {
    const csv = buildFullExportCsv([
      row({ dateOfBirth: new Date(1990, 4, 15), diagnosisDate: new Date(2015, 0, 1) }),
    ]);
    expect(cellAt(csv, 1, 'date_of_birth')).toBe('1990-05-15');
    expect(cellAt(csv, 1, 'diagnosis_date')).toBe('2015-01-01');
  });

  it('reads the baseline sections and the top-level notes out of the stored payload', () => {
    const csv = buildFullExportCsv([
      row({
        baselinePayload: {
          foundation: { birthYear: 1990, regionLabel: '浙江杭州' },
          diseaseBackground: { d4z4: '6', diagnosedFshd: true },
          currentStatus: { assistiveDevices: ['轮椅'], footDrop: false },
          currentChallenges: { fatigue: 3 },
          notes: '电话补录',
        },
      }),
    ]);
    expect(cellAt(csv, 1, 'baseline_birth_year')).toBe('1990');
    expect(cellAt(csv, 1, 'baseline_region_label')).toBe('浙江杭州');
    expect(cellAt(csv, 1, 'baseline_d4z4')).toBe('6');
    expect(cellAt(csv, 1, 'baseline_diagnosed_fshd')).toBe('true');
    expect(cellAt(csv, 1, 'baseline_assistive_devices')).toBe('轮椅');
    expect(cellAt(csv, 1, 'baseline_foot_drop')).toBe('false');
    expect(cellAt(csv, 1, 'baseline_challenge_fatigue')).toBe('3');
    expect(cellAt(csv, 1, 'baseline_notes')).toBe('电话补录');
  });

  /**
   * §B3 in the export. An administrator's value must not leave the
   * platform looking like the patient's own.
   */
  it('carries the admin-entered field list out with the data', () => {
    const csv = buildFullExportCsv([
      row({
        baselinePayload: {
          foundation: { regionLabel: '浙江杭州' },
          [BASELINE_PROVENANCE_KEY]: {
            'foundation.regionLabel': {
              source: 'admin_entered',
              adminUserId: ADMIN_ID,
              at: '2026-08-13T04:11:07.912Z',
            },
          },
        },
      }),
    ]);
    expect(cellAt(csv, 1, 'admin_entered_baseline_fields')).toBe('foundation.regionLabel');
    expect(cellAt(csv, 1, 'unreadable_provenance_baseline_fields')).toBe('');
  });

  it('reports an unparseable marker in its own column, never as an empty one', () => {
    const csv = buildFullExportCsv([
      row({
        baselinePayload: {
          foundation: { regionLabel: '浙江杭州' },
          [BASELINE_PROVENANCE_KEY]: {
            'foundation.regionLabel': { source: 'clinician_entered' },
          },
        },
      }),
    ]);
    // An entry this code cannot read is NOT「没有标记」. Reporting it as
    // an empty admin_entered cell would present an administrator's
    // value as the patient's own.
    expect(cellAt(csv, 1, 'admin_entered_baseline_fields')).toBe('');
    expect(cellAt(csv, 1, 'unreadable_provenance_baseline_fields')).toBe('foundation.regionLabel');
  });

  it('leaves both provenance columns empty for a patient-entered baseline', () => {
    const csv = buildFullExportCsv([
      row({ baselinePayload: { foundation: { regionLabel: '浙江杭州' } } }),
    ]);
    expect(cellAt(csv, 1, 'admin_entered_baseline_fields')).toBe('');
    expect(cellAt(csv, 1, 'unreadable_provenance_baseline_fields')).toBe('');
  });

  it('writes the per-kind record counts', () => {
    const csv = buildFullExportCsv([
      row({ counts: { ...zeroCounts, measurements: 12, falls: 3 } }),
    ]);
    expect(cellAt(csv, 1, 'count_measurements')).toBe('12');
    expect(cellAt(csv, 1, 'count_falls')).toBe('3');
    expect(cellAt(csv, 1, 'count_documents')).toBe('0');
  });

  it('has no duplicate header, which would make one of the two unreadable by name', () => {
    const headers = FULL_EXPORT_COLUMNS.map((column) => column.header);
    expect(new Set(headers).size).toBe(headers.length);
  });
});

describe('buildFullExportFileName', () => {
  it('carries the operator and the timestamp, per §B4', () => {
    const name = buildFullExportFileName(new Date('2026-08-13T04:11:07.912Z'), ADMIN_ID);
    expect(name).toBe(`openrd-patients-20260813T041107Z-by-${ADMIN_ID}.csv`);
  });

  it('uses only characters a Content-Disposition filename and a filesystem accept', () => {
    const name = buildFullExportFileName(new Date('2026-08-13T04:11:07.912Z'), ADMIN_ID);
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});
