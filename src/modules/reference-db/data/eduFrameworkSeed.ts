// OD `index.html:16786` (Indonesia KKNI special-case) + `16793-16804`
// (AU/GB/MY/IE/SG/ZA SEED map) — national education-qualification frameworks
// mapped to ISCED 2011 levels, seeded once per country.
export interface EduFrameworkLevelSeed { code: string; label: string; isced: number }
export interface EduFrameworkSeed { code: string; framework: string; levels: EduFrameworkLevelSeed[] }

export const EDU_FRAMEWORK_SEED: EduFrameworkSeed[] = [
  {
    code: "ID", framework: "KKNI",
    levels: [
      { code: "Jenjang 2", label: "SMA, SMK", isced: 3 },
      { code: "Jenjang 3", label: "D1", isced: 4 },
      { code: "Jenjang 4", label: "D2", isced: 4 },
      { code: "Jenjang 5", label: "D3", isced: 5 },
      { code: "Jenjang 6", label: "S1, D4", isced: 6 },
      { code: "Jenjang 7", label: "Profesi", isced: 6 },
      { code: "Jenjang 8", label: "S2", isced: 7 },
      { code: "Jenjang 9", label: "S3", isced: 8 },
    ],
  },
  {
    code: "AU", framework: "AQF",
    levels: [
      { code: "AQF 1", label: "Certificate I", isced: 2 },
      { code: "AQF 2", label: "Certificate II", isced: 2 },
      { code: "AQF 3", label: "Certificate III", isced: 3 },
      { code: "AQF 4", label: "Certificate IV", isced: 4 },
      { code: "AQF 5", label: "Diploma", isced: 5 },
      { code: "AQF 6", label: "Advanced Diploma / Associate Degree", isced: 5 },
      { code: "AQF 7", label: "Bachelor Degree", isced: 6 },
      { code: "AQF 8", label: "Bachelor Honours / Grad Cert / Grad Dip", isced: 7 },
      { code: "AQF 9", label: "Masters Degree", isced: 7 },
      { code: "AQF 10", label: "Doctoral Degree", isced: 8 },
    ],
  },
  {
    code: "GB", framework: "RQF",
    levels: [
      { code: "Entry", label: "Entry Level", isced: 1 },
      { code: "Level 1", label: "Level 1 (GCSE 1–3)", isced: 2 },
      { code: "Level 2", label: "Level 2 (GCSE 4–9)", isced: 2 },
      { code: "Level 3", label: "Level 3 (A Level)", isced: 3 },
      { code: "Level 4", label: "Certificate of Higher Education", isced: 5 },
      { code: "Level 5", label: "Foundation Degree / Dip HE", isced: 5 },
      { code: "Level 6", label: "Bachelor Degree", isced: 6 },
      { code: "Level 7", label: "Master Degree", isced: 7 },
      { code: "Level 8", label: "Doctoral Degree", isced: 8 },
    ],
  },
  {
    code: "MY", framework: "MQF",
    levels: [
      { code: "MQF 1", label: "Certificate", isced: 3 },
      { code: "MQF 2", label: "Certificate", isced: 3 },
      { code: "MQF 3", label: "Certificate", isced: 4 },
      { code: "MQF 4", label: "Diploma", isced: 5 },
      { code: "MQF 5", label: "Advanced Diploma", isced: 5 },
      { code: "MQF 6", label: "Bachelor Degree", isced: 6 },
      { code: "MQF 7", label: "Master Degree", isced: 7 },
      { code: "MQF 8", label: "Doctoral Degree", isced: 8 },
    ],
  },
  {
    code: "IE", framework: "NFQ",
    levels: [
      { code: "NFQ 1", label: "Level 1 Certificate", isced: 1 },
      { code: "NFQ 2", label: "Level 2 Certificate", isced: 1 },
      { code: "NFQ 3", label: "Junior Certificate", isced: 2 },
      { code: "NFQ 4", label: "Level 4 Certificate", isced: 3 },
      { code: "NFQ 5", label: "Leaving Certificate", isced: 3 },
      { code: "NFQ 6", label: "Higher / Advanced Certificate", isced: 5 },
      { code: "NFQ 7", label: "Ordinary Bachelor Degree", isced: 6 },
      { code: "NFQ 8", label: "Honours Bachelor Degree", isced: 6 },
      { code: "NFQ 9", label: "Masters Degree", isced: 7 },
      { code: "NFQ 10", label: "Doctoral Degree", isced: 8 },
    ],
  },
  {
    code: "SG", framework: "SGUS",
    levels: [
      { code: "1", label: "PSLE / Primary", isced: 1 },
      { code: "2", label: "GCE N/O-Level", isced: 2 },
      { code: "3", label: "GCE A-Level / Polytechnic Diploma", isced: 3 },
      { code: "4", label: "Diploma", isced: 5 },
      { code: "5", label: "Bachelor Degree", isced: 6 },
      { code: "6", label: "Master Degree", isced: 7 },
      { code: "7", label: "Doctoral Degree", isced: 8 },
    ],
  },
  {
    code: "ZA", framework: "NQF",
    levels: [
      { code: "NQF 1", label: "General Certificate (Grade 9)", isced: 2 },
      { code: "NQF 2", label: "Elementary Certificate", isced: 3 },
      { code: "NQF 3", label: "Intermediate Certificate", isced: 3 },
      { code: "NQF 4", label: "National Senior Certificate (Matric)", isced: 3 },
      { code: "NQF 5", label: "Higher Certificate", isced: 5 },
      { code: "NQF 6", label: "Diploma / Advanced Certificate", isced: 5 },
      { code: "NQF 7", label: "Bachelor Degree / Advanced Diploma", isced: 6 },
      { code: "NQF 8", label: "Honours / Postgraduate Diploma", isced: 7 },
      { code: "NQF 9", label: "Masters Degree", isced: 7 },
      { code: "NQF 10", label: "Doctoral Degree", isced: 8 },
    ],
  },
];
