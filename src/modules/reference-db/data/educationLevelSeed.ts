// The 9 canonical ISCED 2011 levels (fe-vibes-new-od/index.html:16717-16738).
export interface EducationLevelSeed {
  level: number;
  label: string;
  description: string;
}

export const EDUCATION_LEVEL_SEED: EducationLevelSeed[] = [
  { level: 0, label: "Early childhood education", description: "Education designed to support early development in preparation for participation in school and society." },
  { level: 1, label: "Primary education", description: "Programmes typically designed to give pupils a sound basic education in reading, writing and mathematics." },
  { level: 2, label: "Lower secondary", description: "First stage of secondary education, building on primary with a more subject-oriented curriculum." },
  { level: 3, label: "Upper secondary", description: "Second/final stage of secondary education preparing for tertiary education or the labour market." },
  { level: 4, label: "Post-secondary non-tertiary", description: "Programmes bridging upper secondary and tertiary education, broadening rather than deepening knowledge." },
  { level: 5, label: "Short-cycle tertiary (Diploma)", description: "Short, practically based and occupationally specific tertiary programmes (e.g. diploma / associate)." },
  { level: 6, label: "Bachelor or equivalent", description: "First tertiary degree providing intermediate academic and/or professional knowledge and skills." },
  { level: 7, label: "Master or equivalent", description: "Second tertiary degree providing advanced academic and/or professional knowledge and skills." },
  { level: 8, label: "Doctoral or equivalent", description: "Advanced research qualification leading to an original contribution to knowledge." },
];
