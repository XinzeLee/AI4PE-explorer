// Authored coordinates for a conceptual diagram; no model or optimizer was run.
export const DESIGN_NOTICE = 'Conceptual workflow · illustrative feasible candidates';
export const DESIGN_INSIGHTS = ['switch-loss', 'thermal-design', 'emi-design', 'magnetic-design'];
export const DESIGN_GROUPS = [
  { id: 'semiconductor', label: 'Semiconductors', partIds: Array.from({ length: 8 }, (_, i) => `Q${i + 1}`), anchorId: 'Q4', color: '#3479B7' },
  { id: 'magnetic', label: 'Magnetics', partIds: ['T1', 'L1'], anchorId: 'T1', color: '#BE7D24' },
  { id: 'thermal', label: 'Thermal heatsink', partIds: ['HS1'], anchorId: 'HS1', color: '#C85D58' },
  { id: 'emi', label: 'EMI filter', partIds: ['EMI1', 'LCM1', 'CX1', 'CX2'], anchorId: 'LCM1', color: '#8264B0' },
];
export const DESIGN_TARGETS = DESIGN_GROUPS.flatMap(group => group.partIds);
export const DESIGN_DETAIL = 'Component design choices and operating conditions are encoded as model inputs. A neural-network surrogate can estimate performance or multiphysics fields; engineering calculations and constraints then support an optimizer that proposes another design. The displayed candidates and normalized coordinates are authored illustrations. No model, physics solver or optimizer was executed, and the shown nondominated set is not a proven global optimum.';
export const PARETO_CANDIDATES = [
  { id: 'D1', efficiency: 0.15, density: 0.42, feasible: true },
  { id: 'D2', efficiency: 0.22, density: 0.71, feasible: true },
  { id: 'D3', efficiency: 0.31, density: 0.60, feasible: true },
  { id: 'D4', efficiency: 0.38, density: 0.33, feasible: true },
  { id: 'D5', efficiency: 0.45, density: 0.49, feasible: true },
  { id: 'D6', efficiency: 0.53, density: 0.37, feasible: true },
  { id: 'D7', efficiency: 0.58, density: 0.61, feasible: true },
  { id: 'D8', efficiency: 0.63, density: 0.29, feasible: true },
  { id: 'D9', efficiency: 0.70, density: 0.42, feasible: true },
  { id: 'D10', efficiency: 0.76, density: 0.22, feasible: true },
  { id: 'D11', efficiency: 0.84, density: 0.16, feasible: true },
  { id: 'D12', efficiency: 0.36, density: 0.72, feasible: true },
  { id: 'F1', efficiency: 0.24, density: 0.91, feasible: true },
  { id: 'F2', efficiency: 0.43, density: 0.82, feasible: true },
  { id: 'F3', efficiency: 0.62, density: 0.69, feasible: true },
  { id: 'F4', efficiency: 0.79, density: 0.48, feasible: true },
  { id: 'F5', efficiency: 0.92, density: 0.25, feasible: true },
];

// Maximize both objectives. Equal vectors do not dominate each other.
// Results preserve input order and reference the original, unmodified records.
export function getDesignParetoFront(candidates = []) {
  const feasible = candidates.filter(candidate => candidate?.feasible === true &&
    Number.isFinite(candidate.efficiency) && Number.isFinite(candidate.density));
  return feasible.filter(candidate => !feasible.some(other =>
    other.efficiency >= candidate.efficiency && other.density >= candidate.density &&
    (other.efficiency > candidate.efficiency || other.density > candidate.density)
  ));
}
